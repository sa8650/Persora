// Persora Docs — End-to-end DB, RLS, sanitization, API routes, opened_at tracking,
// optimistic concurrency, Global Trash, member sharing, public link sharing & export tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createVaultDatabase } from "./password-vault-db.mjs";
import { handleDocs, handlePublicDocs, exportDocsData } from "../cloudflare/docs.js";
import {
  DOC_TEMPLATES,
  DocRuleError,
  blankDocContent,
  buildDocTemplate,
  cleanDocTitle,
  extractDocSummaryMeta,
  renderDocBodySafeHtml,
  renderDocPrintableHtml,
  sanitizeDocContent,
  sanitizeDocHref,
} from "../cloudflare/docs-rules.js";

const ORIGIN = "https://persora.example";
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SECRET_KEY: "test-service-key",
};
const ctx = await createVaultDatabase();
const { db } = ctx;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith("/rest/v1/rpc/")) return Response.json([]);
  const name = url.pathname.split("/").pop();
  const args = init.body ? JSON.parse(init.body) : {};
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

const aliceRow = await ctx.addMember("docs-alice");
const bobRow = await ctx.addMember("docs-bob");
const carolRow = await ctx.addMember("docs-carol");
const eveRow = await ctx.addMember("docs-eve");

async function loadProfile(id) {
  const { rows } = await db.query(
    `select id, login_id, email, full_name from public.profiles where id = $1`,
    [id],
  );
  return rows[0];
}

const alice = await loadProfile(aliceRow.id);
const bob = await loadProfile(bobRow.id);
const carol = await loadProfile(carolRow.id);
const eve = await loadProfile(eveRow.id);
const memberDirectory = [alice, bob, carol, eve];

const notifications = [];
const shareServices = {
  async resolveShareRecipient(rawRecipient, ownerId) {
    const q = String(rawRecipient || "")
      .trim()
      .toLowerCase()
      .replace(/^#/, "");
    if (!q) {
      throw Object.assign(new Error("Enter a Persora 7-digit ID or email."), {
        status: 400,
      });
    }
    const found = memberDirectory.find(
      (m) => m.login_id.toLowerCase() === q || m.email.toLowerCase() === q,
    );
    if (!found) {
      throw Object.assign(new Error("No Persora account matched that ID or email."), {
        status: 404,
      });
    }
    if (found.id === ownerId) {
      throw Object.assign(new Error("You already own this document."), {
        status: 400,
      });
    }
    return found;
  },
  async writeShareNotification(recipientId, actorId, actorName, itemTitle, kind, message) {
    notifications.push({ recipientId, actorId, actorName, itemTitle, kind, message });
  },
};

async function callDocs(method, path, body, who = alice) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await handleDocs(
    new Request(`${ORIGIN}/api${path}`, init),
    who,
    env,
    ORIGIN,
    shareServices,
  );
  const json = await res.json();
  return { status: res.status, body: json };
}

async function callPublicDocs(method, path, body, signedInWho = null) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await handlePublicDocs(
    new Request(`${ORIGIN}/api${path}`, init),
    env,
    ORIGIN,
    signedInWho,
  );
  const json = await res.json();
  return { status: res.status, body: json };
}

test("schema & RLS: Persora Docs tables enforce RLS with persora_jwt_uid() and never use raw auth.uid()", async () => {
  const rls = await db.query(
    `select relname, relrowsecurity from pg_class
     where relnamespace = 'public'::regnamespace
       and relname in ('persora_docs', 'persora_doc_shares', 'persora_doc_share_links')
     order by relname`,
  );
  assert.equal(rls.rows.length, 3);
  for (const row of rls.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);
  }

  const migrationSql = readFileSync(
    new URL("../supabase/migrations/20261028020000_persora_docs.sql", import.meta.url),
    "utf8",
  ).replace(/--.*$/gm, "");
  assert.ok(
    !/\bauth\.uid\s*\(/i.test(migrationSql),
    "Persora Docs migration must use public.persora_jwt_uid(), never raw auth.uid()",
  );
  assert.ok(/public\.persora_jwt_uid\(\)/.test(migrationSql));
});

test("docs-rules: sanitizes AST, strips unsafe scripts/links/styles, extracts previews, and escapes HTML", () => {
  assert.equal(sanitizeDocHref("javascript:alert(1)"), null);
  assert.equal(sanitizeDocHref("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(sanitizeDocHref("vbscript:msgbox(1)"), null);
  assert.equal(sanitizeDocHref("https://persora.app/docs"), "https://persora.app/docs");
  assert.equal(sanitizeDocHref("mailto:hello@persora.app"), "mailto:hello@persora.app");
  assert.equal(sanitizeDocHref("example.com/guide"), null);
  assert.equal(
    sanitizeDocHref("example.com/guide", { autoHttps: true }),
    "https://example.com/guide",
  );

  const dirty = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { variant: "title", textAlign: "center", onclick: "evil()" },
        content: [
          {
            type: "text",
            text: "Quarterly <script>alert(1)</script> Review",
            marks: [{ type: "bold" }, { type: "unknownMark" }],
          },
        ],
      },
      {
        type: "script",
        content: [{ type: "text", text: "stealCookies()" }],
      },
      {
        type: "heading",
        attrs: { level: 9, textAlign: "right" },
        content: [
          {
            type: "text",
            text: "Key Highlights",
            marks: [
              { type: "textStyle", attrs: { color: "#1a73e8", fontSize: "18pt", evil: "1" } },
              { type: "highlight", attrs: { color: "#fef08a" } },
              { type: "link", attrs: { href: "javascript:evil()" } },
            ],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Visit safe link",
                    marks: [{ type: "link", attrs: { href: "https://persora.app" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const clean = sanitizeDocContent(dirty);
  assert.equal(clean.content.length, 3, "unknown script node must be stripped");
  assert.equal(clean.content[0].attrs.variant, "title");
  assert.equal(clean.content[0].attrs.onclick, undefined);
  assert.equal(clean.content[1].attrs.level, 1, "invalid heading level must normalize to 1..3");
  const headingMarks = clean.content[1].content[0].marks;
  assert.equal(
    headingMarks.some((m) => m.type === "link"),
    false,
    "javascript: link mark must be stripped",
  );

  const meta = extractDocSummaryMeta(clean);
  assert.equal(meta.previewBlocks[0].style, "title");
  assert.match(meta.snippet, /Quarterly <script>alert\(1\)<\/script> Review/);
  assert.ok(meta.wordCount >= 6);

  const bodyHtml = renderDocBodySafeHtml(clean);
  assert.ok(!bodyHtml.includes("<script>"), "rendered HTML must escape raw <script> tags");
  assert.match(bodyHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(bodyHtml, /href="https:\/\/persora\.app\/?"/);

  const printable = renderDocPrintableHtml("<img src=x onerror=alert(1)>", clean);
  assert.ok(!printable.includes("<img src=x"), "print HTML title must be escaped");
  assert.match(printable, /&lt;img src=x onerror=alert\(1\)&gt;/);

  for (const tpl of DOC_TEMPLATES) {
    const built = buildDocTemplate(tpl.id, "2026-10-28");
    assert.ok(built.title.length > 0);
    assert.equal(built.content.type, "doc");
  }
  assert.throws(() => cleanDocTitle("", { allowEmptyDefault: false }), DocRuleError);
});

test("CRUD, validation, opened_at vs preview=1, search/filters, duplicate, optimistic concurrency, Trash & export", async () => {
  // Reject invalid payloads
  const badTpl = await callDocs("POST", "/docs", { templateId: "non-existent" }, alice);
  assert.equal(badTpl.status, 400);

  const badFilter = await callDocs("GET", "/docs?filter=invalid", undefined, alice);
  assert.equal(badFilter.status, 400);

  // Create blank + templated docs
  const createdBlank = await callDocs("POST", "/docs", { id: crypto.randomUUID() }, alice);
  assert.equal(createdBlank.status, 201);
  assert.equal(createdBlank.body.doc.title, "Untitled document");
  assert.equal(createdBlank.body.doc.revision, 1);

  const briefRes = await callDocs(
    "POST",
    "/docs",
    { id: crypto.randomUUID(), templateId: "project-proposal", title: "Apollo Launch Plan" },
    alice,
  );
  assert.equal(briefRes.status, 201);
  const docId = briefRes.body.doc.id;
  assert.equal(briefRes.body.doc.title, "Apollo Launch Plan");
  assert.ok(briefRes.body.doc.previewBlocks.length > 0);
  assert.ok(briefRes.body.doc.wordCount > 5);

  // Unauthorized user cannot read, update, or delete Alice's private document
  assert.equal((await callDocs("GET", `/docs/${docId}`, undefined, eve)).status, 404);
  assert.equal(
    (
      await callDocs(
        "PUT",
        `/docs/${docId}/content`,
        { baseRevision: 1, content: blankDocContent() },
        eve,
      )
    ).status,
    404,
  );
  assert.equal((await callDocs("DELETE", `/docs/${docId}`, undefined, eve)).status, 404);

  // Check opened_at behavior: ?preview=1 does NOT advance openedAt, full GET DOES advance openedAt
  await db.query(
    `update public.persora_docs set opened_at = '2026-01-01T00:00:00.000Z' where id = $1`,
    [docId],
  );
  const previewGet = await callDocs("GET", `/docs/${docId}?preview=1`, undefined, alice);
  assert.equal(previewGet.status, 200);
  const afterPreviewRow = await db.query(
    `select opened_at from public.persora_docs where id = $1`,
    [docId],
  );
  assert.equal(
    new Date(afterPreviewRow.rows[0].opened_at).toISOString(),
    "2026-01-01T00:00:00.000Z",
    "?preview=1 must not mutate opened_at",
  );

  const openGet = await callDocs("GET", `/docs/${docId}`, undefined, alice);
  assert.equal(openGet.status, 200);
  assert.ok(
    Date.parse(openGet.body.doc.openedAt) > Date.parse("2026-01-01T00:00:00.000Z"),
    "opening a document must advance opened_at",
  );

  // Autosave content + optimistic revision check
  const saveRes = await callDocs(
    "PUT",
    `/docs/${docId}/content`,
    {
      title: "Apollo Launch Plan v2",
      expectedRevision: 1,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { docStyle: "title" },
            content: [{ type: "text", text: "Apollo Launch Plan v2" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Ship Persora Docs with clean autosave." }],
          },
        ],
      },
    },
    alice,
  );
  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.body.doc.revision, 2);
  assert.match(saveRes.body.doc.snippet, /Ship Persora Docs with clean autosave/);

  // Stale expectedRevision returns 409 Conflict
  const staleRes = await callDocs(
    "PUT",
    `/docs/${docId}/content`,
    {
      expectedRevision: 1,
      content: blankDocContent(),
    },
    alice,
  );
  assert.equal(staleRes.status, 409);

  // Star, rename, search, and filter
  const starRes = await callDocs("PATCH", `/docs/${docId}`, { starred: true }, alice);
  assert.equal(starRes.status, 200);
  assert.equal(starRes.body.doc.starred, true);

  const starredList = await callDocs("GET", "/docs?filter=starred", undefined, alice);
  assert.equal(starredList.status, 200);
  assert.equal(starredList.body.docs.length, 1);
  assert.equal(starredList.body.docs[0].id, docId);
  assert.equal(
    Object.hasOwn(starredList.body.docs[0], "content"),
    false,
    "dashboard list must omit full document AST",
  );

  const searchList = await callDocs("GET", "/docs?q=autosave", undefined, alice);
  assert.equal(searchList.status, 200);
  assert.equal(searchList.body.docs.length, 1);
  assert.equal(searchList.body.docs[0].id, docId);

  // Duplicate
  const dupRes = await callDocs(
    "POST",
    `/docs/${docId}/duplicate`,
    { id: crypto.randomUUID(), title: "Copy of Apollo Launch Plan" },
    alice,
  );
  assert.equal(dupRes.status, 201);
  assert.equal(dupRes.body.doc.title, "Copy of Apollo Launch Plan");

  // Account export includes owned active docs
  const exported = await exportDocsData(alice.id, env);
  assert.equal(exported.docs.length, 3);

  // Move to Trash & restore
  const delRes = await callDocs("DELETE", `/docs/${docId}`, undefined, alice);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.trashed, true);

  const trashRow = await db.query(
    `select id, kind, context->>'space' as space, title from public.trash_items where id = $1 and owner_id = $2`,
    [docId, alice.id],
  );
  assert.equal(trashRow.rows.length, 1);
  assert.equal(trashRow.rows[0].kind, "persora_doc");
  assert.equal(trashRow.rows[0].space, "persora-docs");

  assert.equal((await callDocs("GET", `/docs/${docId}`, undefined, alice)).status, 404);

  await ctx.rpc("persora_doc_trash_restore", {
    p_owner: alice.id,
    p_trash_id: trashRow.rows[0].id,
  });
  const restoredGet = await callDocs("GET", `/docs/${docId}`, undefined, alice);
  assert.equal(restoredGet.status, 200);
  assert.equal(restoredGet.body.doc.title, "Apollo Launch Plan v2");
});

test("member sharing & public link sharing: enforces view/edit permissions, token rotation, and revocation", async () => {
  const createRes = await callDocs(
    "POST",
    "/docs",
    { id: crypto.randomUUID(), title: "Team Architecture Spec" },
    alice,
  );
  assert.equal(createRes.status, 201);
  const docId = createRes.body.doc.id;

  // Share with Bob as viewer
  const shareBob = await callDocs(
    "POST",
    `/docs/${docId}/sharing/members`,
    { recipient: bob.email, permission: "view" },
    alice,
  );
  assert.equal(shareBob.status, 201);
  assert.equal(shareBob.body.share.permission, "view");
  const bobShareId = shareBob.body.share.id;

  // Owner sees hasShares=true, shared=false; Bob sees shared=true in filter=shared
  const aliceSharedFilter = await callDocs("GET", "/docs?filter=shared", undefined, alice);
  assert.ok(aliceSharedFilter.body.docs.some((d) => d.id === docId && d.hasShares === true));

  const bobSharedFilter = await callDocs("GET", "/docs?filter=shared", undefined, bob);
  assert.equal(bobSharedFilter.body.docs.length, 1);
  assert.equal(bobSharedFilter.body.docs[0].id, docId);
  assert.equal(bobSharedFilter.body.docs[0].shared, true);
  assert.equal(bobSharedFilter.body.docs[0].permission, "view");

  // Viewer Bob can read, cannot edit content, rename, or delete
  assert.equal((await callDocs("GET", `/docs/${docId}`, undefined, bob)).status, 200);
  assert.equal(
    (
      await callDocs(
        "PUT",
        `/docs/${docId}/content`,
        { baseRevision: 1, content: blankDocContent() },
        bob,
      )
    ).status,
    403,
  );
  assert.equal(
    (await callDocs("PATCH", `/docs/${docId}`, { title: "Bob Hijack" }, bob)).status,
    403,
  );
  assert.equal((await callDocs("DELETE", `/docs/${docId}`, undefined, bob)).status, 404);

  // Upgrade Bob to edit permission
  const upgradeBob = await callDocs(
    "PATCH",
    `/docs/${docId}/sharing/members/${bobShareId}`,
    { permission: "edit" },
    alice,
  );
  assert.equal(upgradeBob.status, 200);
  assert.equal(upgradeBob.body.share.permission, "edit");

  // Editor Bob can edit content & title, still cannot delete or manage sharing
  const bobSave = await callDocs(
    "PUT",
    `/docs/${docId}/content`,
    {
      baseRevision: 1,
      title: "Team Architecture Spec (Updated by Bob)",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Bob added implementation notes." }],
          },
        ],
      },
    },
    bob,
  );
  assert.equal(bobSave.status, 200);
  assert.equal(bobSave.body.doc.revision, 2);
  assert.equal((await callDocs("DELETE", `/docs/${docId}`, undefined, bob)).status, 404);
  assert.equal((await callDocs("GET", `/docs/${docId}/sharing`, undefined, bob)).status, 404);

  // Revoke Bob's share -> immediate 404
  const revokeBob = await callDocs(
    "DELETE",
    `/docs/${docId}/sharing/members/${bobShareId}`,
    undefined,
    alice,
  );
  assert.equal(revokeBob.status, 200);
  assert.equal((await callDocs("GET", `/docs/${docId}`, undefined, bob)).status, 404);

  // Public share link: enable view-only link
  const enableViewLink = await callDocs(
    "PUT",
    `/docs/${docId}/sharing/link`,
    { enabled: true, permission: "view" },
    alice,
  );
  assert.equal(enableViewLink.status, 200);
  const token1 = enableViewLink.body.link.shareToken;
  assert.ok(token1 && token1.length >= 24);

  const pubRead = await callPublicDocs("GET", `/public/docs/${token1}`);
  assert.equal(pubRead.status, 200);
  assert.equal(pubRead.body.permission, "view");
  assert.equal(pubRead.body.doc.title, "Team Architecture Spec (Updated by Bob)");

  // Anonymous write to view-only link is rejected (403)
  const pubBlockedWrite = await callPublicDocs("PUT", `/public/docs/${token1}/content`, {
    baseRevision: 2,
    content: blankDocContent(),
  });
  assert.equal(pubBlockedWrite.status, 403);

  // Switch public link to edit + rotate token -> old token becomes 404, new token allows edit
  const rotateEditLink = await callDocs(
    "PUT",
    `/docs/${docId}/sharing/link`,
    { enabled: true, permission: "edit", regenerate: true },
    alice,
  );
  assert.equal(rotateEditLink.status, 200);
  const token2 = rotateEditLink.body.link.shareToken;
  assert.notEqual(token2, token1);
  assert.equal((await callPublicDocs("GET", `/public/docs/${token1}`)).status, 404);

  const pubSave = await callPublicDocs("PUT", `/public/docs/${token2}/content`, {
    title: "Team Architecture Spec (Public Edit)",
    expectedRevision: 2,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Edited via shared link." }],
        },
      ],
    },
  });
  assert.equal(pubSave.status, 200);
  assert.equal(pubSave.body.doc.revision, 3);

  // Disable public link -> 404
  await callDocs(
    "PUT",
    `/docs/${docId}/sharing/link`,
    { enabled: false, permission: "view" },
    alice,
  );
  assert.equal((await callPublicDocs("GET", `/public/docs/${token2}`)).status, 404);
});
