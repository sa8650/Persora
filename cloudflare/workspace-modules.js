// Persora app launcher — the shared list of workspace modules and the rules for
// a member's launcher favorites. Dependency-free so the Pages API
// (cloudflare/workspace-preferences.js) and the browser (src/lib/app-launcher.ts)
// validate favorites identically.
//
// Every id is an existing workspace view (src/types.ts ViewId) shown in the
// workspace sidebar. Account pages (Connections, Settings, Plans & billing, Trash) and the
// role-gated admin console are deliberately not launcher modules.

/** Launcher modules in their canonical order (the sidebar's order). */
export const LAUNCHER_MODULE_IDS = Object.freeze([
  "dashboard",
  "calendar",
  "habits",
  "loans",
  "tables",
  "timeline",
  "medical-records",
  "contacts",
  "shared",
  "personal-finance",
  "documents",
  "academics",
  "family",
  "photo-studio",
  "subscriptions",
  "purchases",
  "accounts",
  "memberships",
  "wallet-cards",
  "password-manager",
  "projects",
  "pdf-studio",
  "study",
  "notes",
  "business-card",
  "urls",
]);

/** Shown until a member customizes their favorites: one full 3 × 3 grid. */
export const DEFAULT_LAUNCHER_FAVORITES = Object.freeze([
  "documents",
  "calendar",
  "notes",
  "projects",
  "pdf-studio",
  "photo-studio",
  "password-manager",
  "personal-finance",
  "contacts",
]);

/** Four rows of three keeps the drawer compact however many modules exist. */
export const LAUNCHER_FAVORITES_MAX = 12;

const KNOWN = new Set(LAUNCHER_MODULE_IDS);

export function isLauncherModuleId(value) {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * Normalizes a stored or submitted favorites list.
 * - `null`/`undefined` (or anything that isn't an array) → `null`, meaning "not
 *   customized, use the defaults".
 * - Arrays keep known module ids only, first occurrence wins, capped at
 *   LAUNCHER_FAVORITES_MAX. An empty array is a valid choice (no favorites).
 */
export function normalizeLauncherFavorites(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (!isLauncherModuleId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
    if (result.length >= LAUNCHER_FAVORITES_MAX) break;
  }
  return result;
}

/** The favorites to display: the member's choice, or the defaults. */
export function effectiveLauncherFavorites(value) {
  return normalizeLauncherFavorites(value) ?? [...DEFAULT_LAUNCHER_FAVORITES];
}

/** Splits the module list into favorites and the rest; no module appears twice. */
export function splitLauncherModules(favorites) {
  const pinned = effectiveLauncherFavorites(favorites);
  const pinnedSet = new Set(pinned);
  return { favorites: pinned, others: LAUNCHER_MODULE_IDS.filter((id) => !pinnedSet.has(id)) };
}

/** Returns a copy with the entry at `from` moved to `to` (indices are clamped). */
export function moveFavorite(list, from, to) {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}
