// Persora Customizable Dashboard — Pages API routes & backup export.
//
// Security model:
//   * Every route requires a server-verified Persora session (`identity` from
//     `authorize(request, env)` in `cloudflare/api.js`).
//   * Client-supplied `user_id` / `userId` fields in request bodies or query
//     strings are unconditionally ignored; `p_owner` is always `identity.id`.
//   * Every widget type, ID, width, height, and per-widget config object is
//     strictly validated against `cloudflare/dashboard-rules.js` before any
//     database call, and enforced again by Postgres CHECK constraints + RLS.
//   * Concurrent edits across tabs/devices are guarded by `expectedRevision`
//     (`409 Conflict` with the latest authoritative server snapshot).

import {
  DASHBOARD_WIDGET_BY_TYPE,
  DashboardValidationError,
  clampWidgetWidth,
  createDefaultDashboardLayout,
  isDashboardHeight,
  isDashboardPresetId,
  isDashboardWidgetType,
  normalizeWidgetConfig,
  validateDashboardSavePayload,
} from "./dashboard-rules.js";

export const DASHBOARD_ROUTE_PREFIX = "/dashboard";
const MAX_BODY_BYTES = 64 * 1024;

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

async function callRpc(env, fn, args) {
  const response = await fetch(dbUrl(env, `rpc/${fn}`), {
    method: "POST",
    headers: dbHeaders(env, { "Content-Type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (response.ok) {
    return response.json();
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* generic fallback below */
  }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (code === "P0409") {
    throw new DashboardValidationError(message || "Your dashboard was updated on another device.", 409, "revision_conflict");
  }
  if (code === "P0404") {
    throw new DashboardValidationError(message || "Dashboard owner was not found.", 404, "not_found");
  }
  if (code === "P0400" || code === "23514" || code === "22P02") {
    throw new DashboardValidationError(message || "Invalid dashboard configuration.", 400, "invalid_dashboard");
  }
  if (code === "PGRST202" || code === "42883" || /persora_dashboard_/i.test(message)) {
    throw new DashboardValidationError(
      "Dashboard customization storage is not ready yet. Run the latest Supabase migration.",
      503,
      "unmigrated",
    );
  }
  throw new DashboardValidationError("Could not persist your dashboard right now. Please try again.", 502, "storage_error");
}

function formatSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !raw.customized) {
    return createDefaultDashboardLayout();
  }
  const activePreset = raw.activePreset === "custom" || isDashboardPresetId(raw.activePreset)
    ? raw.activePreset
    : "custom";
  const revision = Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 1;
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  const rawWidgets = Array.isArray(raw.widgets) ? raw.widgets : [];
  const widgets = [];
  for (const entry of rawWidgets) {
    if (!entry || typeof entry !== "object" || !isDashboardWidgetType(entry.type)) continue;
    const meta = DASHBOARD_WIDGET_BY_TYPE[entry.type];
    widgets.push({
      id: String(entry.id),
      type: entry.type,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : meta.defaultTitle,
      config: normalizeWidgetConfig(entry.type, entry.config, { strict: false }),
      position: widgets.length,
      width: clampWidgetWidth(entry.type, entry.width),
      height: isDashboardHeight(entry.height) ? entry.height : meta.defaultHeight,
      visible: entry.visible === undefined ? true : Boolean(entry.visible),
      collapsed: entry.collapsed === undefined ? false : Boolean(entry.collapsed),
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : undefined,
    });
  }
  return {
    customized: true,
    activePreset,
    revision,
    updatedAt,
    widgets,
  };
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new DashboardValidationError("Dashboard payload is too large.", 413, "payload_too_large");
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DashboardValidationError("Invalid JSON request body.", 400, "invalid_json");
  }
}

export async function handleDashboard(request, identity, env, origin) {
  if (!identity || !identity.id) {
    return json({ error: "Sign in to access your dashboard." }, 401, origin);
  }
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api/, "");

  try {
    if (subpath === "/dashboard" && request.method === "GET") {
      const snapshot = await callRpc(env, "persora_dashboard_load", { p_owner: identity.id });
      return json(formatSnapshot(snapshot), 200, origin);
    }

    if (subpath === "/dashboard" && request.method === "PUT") {
      const body = await readJsonBody(request);
      const validated = validateDashboardSavePayload(body, { strict: true });
      try {
        const saved = await callRpc(env, "persora_dashboard_save", {
          p_owner: identity.id,
          p_active_preset: validated.activePreset,
          p_expected_revision: validated.expectedRevision,
          p_widgets: validated.widgets,
        });
        return json(formatSnapshot(saved), 200, origin);
      } catch (err) {
        if (err instanceof DashboardValidationError && err.status === 409) {
          let current = null;
          try {
            current = formatSnapshot(await callRpc(env, "persora_dashboard_load", { p_owner: identity.id }));
          } catch {
            current = null;
          }
          return json({ error: err.message, code: err.code, current }, 409, origin);
        }
        throw err;
      }
    }

    if (subpath === "/dashboard/reset" && request.method === "POST") {
      const body = await readJsonBody(request);
      const expectedRevision = body && body.expectedRevision !== undefined && body.expectedRevision !== null
        ? (Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0
          ? body.expectedRevision
          : (() => { throw new DashboardValidationError("expectedRevision must be a non-negative integer or null."); })())
        : null;
      const reset = await callRpc(env, "persora_dashboard_reset", {
        p_owner: identity.id,
        p_expected_revision: expectedRevision,
      });
      return json(formatSnapshot(reset), 200, origin);
    }

    return json({ error: "Route not found." }, 404, origin);
  } catch (err) {
    if (err instanceof DashboardValidationError) {
      return json({ error: err.message, code: err.code }, err.status, origin);
    }
    return json({ error: "Dashboard service error." }, 500, origin);
  }
}

export async function exportDashboardData(userId, env) {
  try {
    const raw = await callRpc(env, "persora_dashboard_load", { p_owner: userId });
    return formatSnapshot(raw);
  } catch {
    return null;
  }
}
