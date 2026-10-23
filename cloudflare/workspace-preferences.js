// Persora workspace preferences — Pages API routes.
//
//   GET /workspace/preferences → { launcherFavorites, updatedAt, saved }
//   PUT /workspace/preferences   { launcherFavorites: string[] | null }
//
// api.js authorizes the member first; every query is scoped to that member's
// id. Favorites are validated with the shared rules in workspace-modules.js and
// again by the table constraints (supabase/migrations/202610270001_workspace_preferences.sql).
// `launcherFavorites: null` means "not customized" and the app shows its defaults.

import { normalizeLauncherFavorites } from "./workspace-modules.js";

export const WORKSPACE_PREFERENCES_PATH = "/workspace/preferences";

export class WorkspacePreferencesError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
    },
  });
}
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}
async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}
async function databaseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch { /* generic below */ }
  const code = typeof payload?.code === "string" ? payload.code : "";
  if (code === "42P01" || code === "PGRST205") {
    return new WorkspacePreferencesError("Saving favorites needs the workspace preferences migration (202610270001_workspace_preferences.sql).", 503);
  }
  if (code === "23514") return new WorkspacePreferencesError("Those favorites aren't valid.", 400);
  console.error("Persora workspace preferences request failed", response.status, code, payload?.message || "");
  return new WorkspacePreferencesError("Your preferences couldn't be saved right now. Please try again shortly.", 502);
}
async function readBody(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new WorkspacePreferencesError("Send the preferences as JSON.", 415);
  const text = await request.text();
  if (text.length > 8 * 1024) throw new WorkspacePreferencesError("That request is too large.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new WorkspacePreferencesError("The request body isn't valid JSON.", 400); }
}

export async function loadWorkspacePreferences(userId, env) {
  const response = await dbFetch(`workspace_preferences?user_id=eq.${encodeURIComponent(userId)}&select=launcher_favorites,updated_at&limit=1`, env);
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    launcherFavorites: normalizeLauncherFavorites(row?.launcher_favorites),
    updatedAt: row?.updated_at || null,
    saved: Boolean(row),
  };
}

export async function saveWorkspacePreferences(userId, body, env) {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "launcherFavorites")) {
    throw new WorkspacePreferencesError("Send launcherFavorites.", 400);
  }
  const raw = body.launcherFavorites;
  if (raw !== null && !Array.isArray(raw)) throw new WorkspacePreferencesError("launcherFavorites must be a list of modules or null.", 400);
  if (Array.isArray(raw) && raw.length > 48) throw new WorkspacePreferencesError("That favorites list is too long.", 400);
  const launcherFavorites = normalizeLauncherFavorites(raw);
  const response = await dbFetch("workspace_preferences?on_conflict=user_id", env, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, launcher_favorites: launcherFavorites, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  return { launcherFavorites, updatedAt: Array.isArray(rows) ? rows[0]?.updated_at || null : null, saved: true };
}

/** For the complete account export; an unmigrated database exports nothing. */
export async function exportWorkspacePreferences(userId, env) {
  try {
    const response = await dbFetch(`workspace_preferences?user_id=eq.${encodeURIComponent(userId)}&select=launcher_favorites,updated_at`, env);
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}

export async function handleWorkspacePreferences(request, identity, env, origin) {
  try {
    if (request.method === "GET") return json(await loadWorkspacePreferences(identity.id, env), 200, origin);
    if (request.method === "PUT") return json(await saveWorkspacePreferences(identity.id, await readBody(request), env), 200, origin);
    return json({ error: "That preferences route is not available." }, 405, origin);
  } catch (error) {
    if (error instanceof WorkspacePreferencesError) return json({ error: error.message }, error.status, origin);
    throw error;
  }
}
