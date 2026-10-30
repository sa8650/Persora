// Types for cloudflare/workspace-modules.js (shared by the Pages API and the app).

export type LauncherModuleId =
  | "dashboard" | "calendar" | "habits" | "loans" | "tables" | "forms" | "docs" | "timeline" | "medical-records" | "contacts" | "shared" | "personal-finance"
  | "documents" | "academics" | "family" | "photo-studio" | "audio-space" | "subscriptions" | "purchases" | "accounts"
  | "memberships" | "wallet-cards" | "password-manager" | "projects" | "pdf-studio" | "study" | "notes"
  | "business-card" | "urls" | "connections";

export const LAUNCHER_MODULE_IDS: readonly LauncherModuleId[];
export const DEFAULT_LAUNCHER_FAVORITES: readonly LauncherModuleId[];
export const LAUNCHER_FAVORITES_MAX: number;
export function isLauncherModuleId(value: unknown): value is LauncherModuleId;
export function normalizeLauncherFavorites(value: unknown): LauncherModuleId[] | null;
export function effectiveLauncherFavorites(value: unknown): LauncherModuleId[];
export function splitLauncherModules(favorites: unknown): { favorites: LauncherModuleId[]; others: LauncherModuleId[] };
export function moveFavorite<T>(list: readonly T[], from: number, to: number): T[];
