// Persora Docs — Pages API routes.
//
// Authenticated routes run under /docs for signed-in Persora members and
// enforce document access ('owner' | 'edit' | 'view') server-side and in
// Postgres security-definer RPCs.
// Public link routes run under /public/docs/:token without requiring sign-in
// and enforce link-level 'view' or 'edit' access while stripping private
// account metadata.

import {
  DOC_LIMITS,
  DOC_TEMPLATES,
  DocRuleError,
  buildDocTemplate,
  cleanDocTitle,
  extractDocSummaryMeta,
  sanitizeDocContent,
  sanitizePreviewBlocks,
} from "./docs-rules.js";

export const DOCS_ROUTE_PREFIX = "/docs";
export const PUBLIC_DOCS_ROUTE_PREFIX = "/public/docs";

const MAX_BODY_BYTES = DOC_LIMITS.maxJsonBytes + 128 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const VALID_PERMISSIONS = new Set(["view", "edit"]);

export class DocError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = "DocError";
    this.status = status;
    this.extra = extra;
  }
}

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function generateDocShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return {
    apikey: secret,
    ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }),
    ...extra,
  };
}

function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}

async function databaseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* handled below */
  }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new DocError(message, status >= 400 && status < 600 ? status : 400);
  }
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02" || code === "22003") {
    return new DocError("Those document details aren't valid. Check them and try again.", 400);
  }
  if (code === "23505") {
    return new DocError("That change conflicts with another one. Reload and try again.", 409);
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") {
    return new DocError(
      "Persora Docs needs the Persora database schema (supabase/schema.sql). Ask an administrator to apply it.",
      503,
    );
  }
  console.error("Persora Docs database request failed", response.status, code, message);
  return new DocError("The document database could not complete the request. Please try again shortly.", 502);
}

async function rpc(name, args, env) {
  const response = await fetch(dbUrl(env, `rpc/${name}`), {
    method: "POST",
    headers: dbHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (!response.ok) throw await databaseError(response);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new DocError("This document is too large to send at once.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new DocError("This document is too large to send at once.", 413);
  }
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new DocError("The request could not be read.", 400);
  }
}

function actorDisplayName(identity) {
  const name = typeof identity?.full_name === "string" ? identity.full_name.trim() : "";
  if (name) return name;
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";
  if (email.includes("@")) return email.split("@")[0];
  return "A Persora member";
}

function docSummaryView(row) {
  const shared = Boolean(row.shared);
  return {
    id: String(row.id),
    title: String(row.title || "Untitled document"),
    starred: Boolean(row.starred),
    previewBlocks: sanitizePreviewBlocks(row.preview_blocks),
    snippet: typeof row.snippet === "string" ? row.snippet : "",
    wordCount: Math.max(0, Number(row.word_count) || 0),
    revision: Math.max(1, Number(row.revision) || 1),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    openedAt: String(row.opened_at || row.updated_at || ""),
    shared,
    hasShares: Boolean(row.has_shares || shared),
    permission: row.permission === "edit" || row.permission === "view" ? row.permission : "owner",
    ...(shared
      ? {
          shareId: row.share_id ? String(row.share_id) : null,
          ownerId: row.owner_id ? String(row.owner_id) : null,
          ownerName: row.owner_name ? String(row.owner_name) : "Persora Member",
          ownerLoginId: row.owner_login_id ? String(row.owner_login_id) : null,
        }
      : {}),
  };
}

function docDetailView(row) {
  return {
    ...docSummaryView(row),
    content: sanitizeDocContent(row.content),
  };
}

function shareMemberView(row) {
  return {
    id: String(row.id),
    recipientId: String(row.recipient_id),
    recipientName: String(row.recipient_name || "Persora Member"),
    recipientLoginId: row.recipient_login_id ? String(row.recipient_login_id) : null,
    recipientEmail: String(row.recipient_email || ""),
    permission: row.permission === "edit" ? "edit" : "view",
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function shareLinkView(link) {
  return {
    enabled: Boolean(link?.enabled),
    permission: link?.permission === "edit" ? "edit" : "view",
    shareToken: link?.enabled && typeof link?.share_token === "string" ? link.share_token : null,
    updatedAt: typeof link?.updated_at === "string" ? link.updated_at : null,
  };
}

async function handleDocSharing(request, identity, docId, tailSegments, env, origin, services) {
  const method = request.method;

  if (!tailSegments.length && method === "GET") {
    const state = await rpc("persora_doc_sharing_get", { p_owner: identity.id, p_doc_id: docId }, env);
    return json(
      {
        docId: state.doc_id,
        docTitle: state.doc_title,
        shares: (Array.isArray(state.shares) ? state.shares : []).map(shareMemberView),
        link: shareLinkView(state.link),
      },
      200,
      origin,
    );
  }

  if (tailSegments.length === 1 && tailSegments[0] === "members" && method === "POST") {
    const body = await readJson(request, 16 * 1024);
    const permission = typeof body.permission === "string" ? body.permission.trim() : "view";
    if (!VALID_PERMISSIONS.has(permission)) {
      throw new DocRuleError("Choose view or edit permission.");
    }
    if (typeof services?.resolveShareRecipient !== "function") {
      throw new DocError("Member lookup is unavailable right now.", 503);
    }
    const recipient = await services.resolveShareRecipient(body.recipient, identity.id, env);
    const res = await rpc(
      "persora_doc_share_upsert",
      {
        p_owner: identity.id,
        p_doc_id: docId,
        p_recipient: recipient.id,
        p_permission: permission,
      },
      env,
    );
    if (typeof services?.writeShareNotification === "function") {
      const actor = actorDisplayName(identity);
      const label = permission === "edit" ? "edit" : "view-only";
      await services
        .writeShareNotification(
          recipient.id,
          identity.id,
          actor,
          res.doc_title || "Document",
          res.created ? "shared" : "permission_changed",
          res.created
            ? `${actor} shared the Persora Docs document "${res.doc_title || "Document"}" with ${label} access.`
            : `${actor} updated your access on Persora Docs document "${res.doc_title || "Document"}" to ${label}.`,
          env,
        )
        .catch(() => {});
    }
    return json(
      { ok: true, created: Boolean(res.created), share: shareMemberView(res.share) },
      res.created ? 201 : 200,
      origin,
    );
  }

  if (tailSegments.length === 2 && tailSegments[0] === "members") {
    const shareId = tailSegments[1];
    if (!isUuid(shareId)) return json({ error: "Choose a valid share entry." }, 400, origin);

    if (method === "PATCH") {
      const body = await readJson(request, 16 * 1024);
      const permission = typeof body.permission === "string" ? body.permission.trim() : "";
      if (!VALID_PERMISSIONS.has(permission)) {
        throw new DocRuleError("Choose view or edit permission.");
      }
      const res = await rpc(
        "persora_doc_share_update",
        {
          p_owner: identity.id,
          p_doc_id: docId,
          p_share_id: shareId,
          p_permission: permission,
        },
        env,
      );
      if (typeof services?.writeShareNotification === "function" && res.share?.recipient_id) {
        const actor = actorDisplayName(identity);
        const label = permission === "edit" ? "edit" : "view-only";
        await services
          .writeShareNotification(
            res.share.recipient_id,
            identity.id,
            actor,
            res.doc_title || "Document",
            "permission_changed",
            `${actor} updated your access on Persora Docs document "${res.doc_title || "Document"}" to ${label}.`,
            env,
          )
          .catch(() => {});
      }
      return json({ ok: true, share: shareMemberView(res.share) }, 200, origin);
    }

    if (method === "DELETE") {
      const res = await rpc(
        "persora_doc_share_revoke",
        {
          p_owner: identity.id,
          p_doc_id: docId,
          p_share_id: shareId,
        },
        env,
      );
      if (typeof services?.writeShareNotification === "function" && res.recipient_id) {
        const actor = actorDisplayName(identity);
        await services
          .writeShareNotification(
            res.recipient_id,
            identity.id,
            actor,
            res.doc_title || "Document",
            "unshared",
            `${actor} removed your access to Persora Docs document "${res.doc_title || "Document"}".`,
            env,
          )
          .catch(() => {});
      }
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "Method not allowed." }, 405, origin);
  }

  if (tailSegments.length === 1 && tailSegments[0] === "link" && method === "PUT") {
    const body = await readJson(request, 16 * 1024);
    const enabled = Boolean(body.enabled);
    const permission = body.permission === undefined ? "view" : String(body.permission).trim();
    if (!VALID_PERMISSIONS.has(permission)) {
      throw new DocRuleError("Link permission must be view or edit.");
    }
    const regenerate = Boolean(body.regenerate);
    const current = await rpc("persora_doc_sharing_get", { p_owner: identity.id, p_doc_id: docId }, env);
    const needsNewToken = regenerate || !enabled || !current?.link?.share_token;
    const token = needsNewToken ? generateDocShareToken() : null;
    const updated = await rpc(
      "persora_doc_link_configure",
      {
        p_owner: identity.id,
        p_doc_id: docId,
        p_enabled: enabled,
        p_permission: permission,
        p_token: token,
      },
      env,
    );
    return json({ ok: true, link: shareLinkView(updated) }, 200, origin);
  }

  return json({ error: "That sharing route is not available." }, 404, origin);
}

/** Public /api/public/docs/:token routes (no sign-in required; enforces view or edit link permission). */
export async function handlePublicDocs(request, env, origin) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PUBLIC_DOCS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;

  try {
    const token = segments[0] || "";
    if (!SHARE_TOKEN_RE.test(token)) {
      return json({ error: "This shared document link is unavailable, disabled, or has been revoked." }, 404, origin);
    }

    if (segments.length === 1) {
      if (method !== "GET") return json({ error: "Method not allowed." }, 405, origin);
      const res = await rpc("persora_doc_public_get", { p_token: token }, env);
      return json(
        {
          permission: res.permission === "edit" ? "edit" : "view",
          ownerName: String(res.owner_name || "Persora Member"),
          doc: {
            id: String(res.doc.id),
            title: String(res.doc.title || "Untitled document"),
            content: sanitizeDocContent(res.doc.content),
            wordCount: Math.max(0, Number(res.doc.word_count) || 0),
            revision: Math.max(1, Number(res.doc.revision) || 1),
            updatedAt: String(res.doc.updated_at || ""),
          },
        },
        200,
        origin,
      );
    }

    if (segments.length === 2 && segments[1] === "content" && method === "PUT") {
      const body = await readJson(request, MAX_BODY_BYTES);
      const baseRevision = Number(body.baseRevision ?? body.expectedRevision);
      if (!Number.isInteger(baseRevision) || baseRevision < 1) {
        throw new DocRuleError("Include a valid baseRevision.");
      }
      const batchId = isUuid(body.batchId) ? body.batchId : crypto.randomUUID();
      const title = body.title !== undefined ? cleanDocTitle(body.title) : null;
      const content = sanitizeDocContent(body.content);
      const summary = extractDocSummaryMeta(content);

      const saved = await rpc(
        "persora_doc_public_save",
        {
          p_token: token,
          p_base: baseRevision,
          p_batch: batchId,
          p_title: title,
          p_content: content,
          p_preview_blocks: summary.previewBlocks,
          p_snippet: summary.snippet,
          p_word_count: summary.wordCount,
        },
        env,
      );

      if (saved.conflict) {
        return json({ ok: false, conflict: true, doc: docSummaryView(saved.doc) }, 409, origin);
      }
      return json({ ok: true, replayed: Boolean(saved.replayed), doc: docSummaryView(saved.doc) }, 200, origin);
    }

    return json({ error: "That shared document route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof DocRuleError) return json({ error: error.message }, error.status || 400, origin);
    if (error instanceof DocError) return json({ error: error.message, ...(error.extra || {}) }, error.status, origin);
    console.error("Persora public docs route failed", error);
    return json({ error: "The shared document could not be loaded right now." }, 500, origin);
  }
}

/** Account export helper (degrades cleanly if schema not yet migrated). */
export async function exportDocsData(userId, env) {
  try {
    const data = await rpc("persora_docs_export", { p_owner: userId }, env);
    return {
      docs: Array.isArray(data?.docs) ? data.docs : [],
    };
  } catch (error) {
    if (error instanceof DocError && error.status === 503) {
      return { docs: [] };
    }
    throw error;
  }
}

/** Authenticated /api/docs routes. */
export async function handleDocs(request, identity, env, origin, services = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(DOCS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const method = request.method;

  try {
    if (!identity?.id || !isUuid(identity.id)) {
      return json({ error: "Sign in to open Persora Docs." }, 401, origin);
    }

    // /docs (GET list, POST create)
    if (segments.length === 0) {
      if (method === "GET") {
        const filterParam = (url.searchParams.get("filter") || "all").trim().toLowerCase();
        if (filterParam !== "all" && filterParam !== "starred" && filterParam !== "shared") {
          throw new DocRuleError("Filter must be all, starred, or shared.");
        }
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const rows = await rpc("persora_docs_list", { p_owner: identity.id }, env);
        let docs = (Array.isArray(rows) ? rows : []).map(docSummaryView);
        if (filterParam === "starred") {
          docs = docs.filter((d) => d.starred);
        } else if (filterParam === "shared") {
          docs = docs.filter((d) => d.shared || d.hasShares);
        }
        if (q) {
          docs = docs.filter(
            (d) =>
              d.title.toLowerCase().includes(q) ||
              (d.snippet && d.snippet.toLowerCase().includes(q)),
          );
        }
        return json({ docs }, 200, origin);
      }
      if (method === "POST") {
        const body = await readJson(request, MAX_BODY_BYTES);
        const id = body.id !== undefined ? body.id : crypto.randomUUID();
        if (!isUuid(id)) throw new DocRuleError("The new document needs a valid id.");
        let templateContent = null;
        let templateTitle = null;
        if (body.templateId !== undefined && body.templateId !== null) {
          const tplId = String(body.templateId).trim();
          if (!DOC_TEMPLATES.some((t) => t.id === tplId)) {
            throw new DocRuleError("Choose a valid document template.");
          }
          const built = buildDocTemplate(tplId, new Date().toISOString().slice(0, 10));
          templateContent = built.content;
          templateTitle = built.title;
        }
        const title = cleanDocTitle(body.title ?? templateTitle, { allowEmptyDefault: true });
        const starred = body.starred === true;
        const content = sanitizeDocContent(body.content ?? templateContent);
        const summary = extractDocSummaryMeta(content);
        const created = await rpc(
          "persora_doc_create",
          {
            p_owner: identity.id,
            p_id: id,
            p_title: title,
            p_starred: starred,
            p_content: content,
            p_preview_blocks: summary.previewBlocks,
            p_snippet: summary.snippet,
            p_word_count: summary.wordCount,
          },
          env,
        );
        return json({ doc: docDetailView(created.doc) }, 201, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const docId = segments[0];
    if (!isUuid(docId)) {
      return json({ error: "Choose a valid document." }, 400, origin);
    }

    // /docs/:id (GET detail/preview, PATCH info, DELETE to Trash)
    if (segments.length === 1) {
      if (method === "GET") {
        const isPreview = url.searchParams.get("preview") === "1" || url.searchParams.get("touch") === "0";
        const detail = await rpc(
          "persora_doc_get",
          {
            p_owner: identity.id,
            p_id: docId,
            p_touch: !isPreview,
          },
          env,
        );
        return json({ doc: docDetailView(detail.doc) }, 200, origin);
      }
      if (method === "PATCH") {
        const body = await readJson(request, 16 * 1024);
        const hasTitle = body.title !== undefined;
        const hasStarred = body.starred !== undefined;
        if (!hasTitle && !hasStarred) {
          throw new DocRuleError("Include a document title or starred status to update.");
        }
        const title = hasTitle ? cleanDocTitle(body.title) : null;
        if (hasStarred && typeof body.starred !== "boolean") {
          throw new DocRuleError("Starred status must be true or false.");
        }
        const starred = hasStarred ? body.starred : null;
        const updated = await rpc(
          "persora_doc_update_info",
          {
            p_owner: identity.id,
            p_id: docId,
            p_title: title,
            p_starred: starred,
          },
          env,
        );
        return json({ doc: docSummaryView(updated) }, 200, origin);
      }
      if (method === "DELETE") {
        const trash = await rpc("persora_doc_trash_move", { p_owner: identity.id, p_id: docId }, env);
        return json({ ok: true, trashed: true, trash }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    // /docs/:id/content (PUT autosave)
    if (segments.length === 2 && segments[1] === "content") {
      if (method !== "PUT") return json({ error: "Method not allowed." }, 405, origin);
      const body = await readJson(request, MAX_BODY_BYTES);
      const baseRevision = Number(body.baseRevision ?? body.expectedRevision);
      if (!Number.isInteger(baseRevision) || baseRevision < 1) {
        throw new DocRuleError("Include a valid baseRevision.");
      }
      const batchId = isUuid(body.batchId) ? body.batchId : crypto.randomUUID();
      const title = body.title !== undefined ? cleanDocTitle(body.title) : null;
      const content = sanitizeDocContent(body.content);
      const summary = extractDocSummaryMeta(content);

      const saved = await rpc(
        "persora_doc_save",
        {
          p_owner: identity.id,
          p_id: docId,
          p_base: baseRevision,
          p_batch: batchId,
          p_title: title,
          p_content: content,
          p_preview_blocks: summary.previewBlocks,
          p_snippet: summary.snippet,
          p_word_count: summary.wordCount,
        },
        env,
      );

      if (saved.conflict) {
        return json({ ok: false, conflict: true, doc: docSummaryView(saved.doc) }, 409, origin);
      }
      return json({ ok: true, replayed: Boolean(saved.replayed), doc: docSummaryView(saved.doc) }, 200, origin);
    }

    // /docs/:id/duplicate (POST)
    if (segments.length === 2 && segments[1] === "duplicate") {
      if (method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
      const body = await readJson(request, 16 * 1024);
      const newId = body.id !== undefined ? body.id : crypto.randomUUID();
      if (!isUuid(newId)) throw new DocRuleError("Provide a valid id for the duplicated document.");
      const title = body.title !== undefined && body.title !== null && String(body.title).trim()
        ? cleanDocTitle(body.title)
        : null;
      const duplicated = await rpc(
        "persora_doc_duplicate",
        {
          p_owner: identity.id,
          p_source: docId,
          p_new_id: newId,
          p_title: title,
        },
        env,
      );
      return json({ doc: docSummaryView(duplicated.doc) }, 201, origin);
    }

    // /docs/:id/sharing/*
    if (segments[1] === "sharing") {
      return await handleDocSharing(request, identity, docId, segments.slice(2), env, origin, services);
    }

    return json({ error: "That document route is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof DocRuleError) return json({ error: error.message }, error.status || 400, origin);
    if (error instanceof DocError) return json({ error: error.message, ...(error.extra || {}) }, error.status, origin);
    if (error && typeof error === "object" && typeof error.status === "number" && typeof error.message === "string") {
      return json({ error: error.message }, error.status, origin);
    }
    console.error("Persora Docs route failed", error);
    return json({ error: "Persora Docs could not complete that request right now." }, 500, origin);
  }
}
