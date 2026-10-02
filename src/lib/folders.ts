import type { VaultFolder, VaultFolderDraft, VaultFolderScope } from "../types";
import { deleteVaultFolder, loadVaultFolders, saveVaultFolder } from "./cloud";

export const VAULT_FOLDER_COLORS: { value: VaultFolder["color"]; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "sky", label: "Sky" },
  { value: "teal", label: "Teal" },
  { value: "violet", label: "Violet" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "slate", label: "Slate" },
  { value: "mint", label: "Mint" },
];

function storageKey(userId: string, scope: VaultFolderScope) {
  return `persora-page-folders:v1:${encodeURIComponent(userId)}:${scope}`;
}

function readLocal(userId: string, scope: VaultFolderScope): VaultFolder[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId, scope)) || "[]") as VaultFolder[];
    return Array.isArray(value) ? value.filter((folder) => folder && folder.scope === scope && typeof folder.id === "string" && typeof folder.name === "string") : [];
  } catch { return []; }
}

function writeLocal(userId: string, scope: VaultFolderScope, folders: VaultFolder[]) {
  try { localStorage.setItem(storageKey(userId, scope), JSON.stringify(folders)); }
  catch { /* Demo folder persistence is best-effort in browser storage. */ }
}

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `local-${crypto.randomUUID()}` : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function loadPageFolders(userId: string, scope: VaultFolderScope, demoMode: boolean): Promise<VaultFolder[]> {
  if (demoMode) return readLocal(userId, scope).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  return loadVaultFolders(scope);
}

export async function savePageFolder(userId: string, scope: VaultFolderScope, demoMode: boolean, draft: VaultFolderDraft): Promise<VaultFolder> {
  const name = draft.name.trim();
  if (!name || name.length > 64) throw new Error("Enter a folder name between 1 and 64 characters.");
  const color = VAULT_FOLDER_COLORS.some((entry) => entry.value === draft.color) ? draft.color : "blue";
  const value: VaultFolderDraft = { ...draft, scope, name, color };
  if (!demoMode) return saveVaultFolder(value);
  const folders = readLocal(userId, scope);
  const duplicate = folders.find((folder) => folder.id !== value.id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (duplicate) throw new Error("A folder with that name already exists in this page.");
  const now = new Date().toISOString();
  const saved: VaultFolder = { ...value, id: value.id || localId(), createdAt: folders.find((folder) => folder.id === value.id)?.createdAt || now, updatedAt: now };
  writeLocal(userId, scope, value.id ? folders.map((folder) => folder.id === saved.id ? saved : folder) : [...folders, saved]);
  return saved;
}

export async function removePageFolder(userId: string, scope: VaultFolderScope, demoMode: boolean, id: string): Promise<void> {
  if (!demoMode) { await deleteVaultFolder(id, scope); return; }
  writeLocal(userId, scope, readLocal(userId, scope).filter((folder) => folder.id !== id));
}
