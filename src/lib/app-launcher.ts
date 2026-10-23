// Persora app launcher — module catalogue and favorites persistence (browser side).
//
// The module list and favorites rules live in cloudflare/workspace-modules.js so
// the Pages API validates exactly what the app saves. Labels come from the same
// sources as the workspace sidebar (SECTION_BY_ID for vault sections, the
// sidebar's own names for everything else), and every module opens through the
// workspace's existing navigation (Workspace → updateView → App navigateWorkspace).
import {
  LAUNCHER_MODULE_IDS, normalizeLauncherFavorites, type LauncherModuleId,
} from "../../cloudflare/workspace-modules.js";
import { SECTION_BY_ID } from "../data";
import type { SectionId, ViewId } from "../types";
import { pagesApiJson } from "./cloud";

export type { LauncherModuleId } from "../../cloudflare/workspace-modules.js";
export {
  DEFAULT_LAUNCHER_FAVORITES, LAUNCHER_FAVORITES_MAX, LAUNCHER_MODULE_IDS, effectiveLauncherFavorites, moveFavorite,
  normalizeLauncherFavorites, splitLauncherModules,
} from "../../cloudflare/workspace-modules.js";

// Compile-time guarantee that every launcher module is a real workspace view.
type AssertViews<T extends ViewId> = T;
export type LauncherView = AssertViews<LauncherModuleId>;

export interface LauncherModule {
  id: LauncherModuleId;
  label: string;
  /** One short line for the tooltip. */
  hint: string;
}

/** Workspace views that aren't vault sections, named exactly as in the sidebar. */
const VIEW_MODULES: Partial<Record<LauncherModuleId, { label: string; hint: string }>> = {
  dashboard: { label: "Overview", hint: "Your private workspace at a glance" },
  calendar: { label: "Calendar", hint: "Events, tasks and appointments" },
  timeline: { label: "Life Timeline", hint: "Milestones and memories in order" },
  "medical-records": { label: "Medical Records", hint: "Health history and reports" },
  contacts: { label: "Contacts", hint: "The people in your life" },
  shared: { label: "Shared documents", hint: "Shared with you and by you" },
  "photo-studio": { label: "Photo Studio", hint: "Edit and enhance photos" },
  "password-manager": { label: "Password Manager", hint: "Encrypted logins and secrets" },
  projects: { label: "Projects", hint: "Plan and track work together" },
  "pdf-studio": { label: "PDF Studio", hint: "Edit, build and secure PDFs" },
};

/** Tooltip lines for vault sections (labels themselves come from SECTION_BY_ID). */
const SECTION_HINTS: Partial<Record<LauncherModuleId, string>> = {
  documents: "Identity and important paperwork",
  academics: "Certificates, transcripts and results",
  family: "Family members and their records",
  subscriptions: "Renewals, costs and payment methods",
  purchases: "Invoices, serials and warranties",
  accounts: "Online accounts and bank details",
  "personal-finance": "Income, spending, assets and debt",
  memberships: "Membership IDs and loyalty cards",
  "wallet-cards": "Masked card references",
  study: "Notes, books and lecture slides",
  notes: "Tasks, reminders and notes",
  "business-card": "Your shareable profile card",
  urls: "Links worth keeping",
};

export const LAUNCHER_MODULES: readonly LauncherModule[] = LAUNCHER_MODULE_IDS.map((id) => {
  const view = VIEW_MODULES[id];
  if (view) return { id, ...view };
  const section = SECTION_BY_ID[id as SectionId];
  return { id, label: section.label, hint: SECTION_HINTS[id] || section.eyebrow };
});

export const LAUNCHER_MODULE_BY_ID = Object.fromEntries(LAUNCHER_MODULES.map((module) => [module.id, module])) as Record<LauncherModuleId, LauncherModule>;

// ---------------------------------------------------------------------------
// Persistence: this device first (instant), the account copy is the source of
// truth across devices — newest change wins, like Calendar's filter settings.
// ---------------------------------------------------------------------------

export interface LauncherPreferences {
  /** null = not customized (defaults are shown). */
  launcherFavorites: LauncherModuleId[] | null;
  updatedAt: string | null;
  saved: boolean;
}

export interface StoredLauncherFavorites {
  favorites: LauncherModuleId[] | null;
  updatedAt: string | null;
  /** True once this device's copy matches the account copy. */
  synced: boolean;
}

export const launcherStorageKey = (userId: string) => `persora-launcher-favorites:${userId}`;

export function readStoredLauncherFavorites(userId: string): StoredLauncherFavorites {
  try {
    const raw = JSON.parse(localStorage.getItem(launcherStorageKey(userId)) || "null") as Record<string, unknown> | null;
    return {
      favorites: normalizeLauncherFavorites(raw?.favorites),
      updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
      synced: raw?.synced === true,
    };
  } catch {
    return { favorites: null, updatedAt: null, synced: false };
  }
}

export function writeStoredLauncherFavorites(userId: string, value: StoredLauncherFavorites) {
  try { localStorage.setItem(launcherStorageKey(userId), JSON.stringify(value)); } catch { /* a preference only */ }
}

/** True when `a` is a strictly newer timestamp than `b`. */
export const isNewer = (a: string | null, b: string | null) => Boolean(a) && (!b || Date.parse(a as string) > Date.parse(b));

export function loadLauncherPreferences(): Promise<LauncherPreferences> {
  return pagesApiJson<LauncherPreferences>("/workspace/preferences");
}

export function saveLauncherFavorites(launcherFavorites: LauncherModuleId[] | null): Promise<LauncherPreferences> {
  return pagesApiJson<LauncherPreferences>("/workspace/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ launcherFavorites }),
  });
}
