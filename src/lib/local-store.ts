import { INITIAL_ITEMS } from "../data";
import type { VaultItem } from "../types";

const ITEMS_KEY = "persora-demo-items-v1";
const PROFILE_KEY = "persora-demo-profile-v1";

export function getLocalItems(): VaultItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) return INITIAL_ITEMS;
    const parsed = JSON.parse(raw) as VaultItem[];
    return Array.isArray(parsed) ? parsed : INITIAL_ITEMS;
  } catch {
    return INITIAL_ITEMS;
  }
}

export function putLocalItems(items: VaultItem[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // Local demo mode is best-effort; uploaded private files never go to localStorage.
  }
}

export function getLocalProfile(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

export function putLocalProfile(email: string | null): void {
  try {
    if (email) localStorage.setItem(PROFILE_KEY, email);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}
