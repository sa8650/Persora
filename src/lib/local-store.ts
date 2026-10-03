import { INITIAL_ITEMS } from "../data";
import type { DigitalBusinessCard, PersoraContact, VaultItem } from "../types";

const ITEMS_KEY = "persora-demo-items-v1";
const CONTACTS_KEY = "persora-local-contacts-v1";
const BUSINESS_CARDS_KEY = "persora-local-business-cards-v1";
const PROFILE_KEY = "persora-demo-profile-v1";
const PROFILE_AVATAR_KEY = "persora-profile-avatar-v1";

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

export function getLocalContacts(ownerId = "demo-amina"): PersoraContact[] {
  try {
    const raw = localStorage.getItem(`${CONTACTS_KEY}:${ownerId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersoraContact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function putLocalContacts(ownerId: string, contacts: PersoraContact[]): void {
  try { localStorage.setItem(`${CONTACTS_KEY}:${ownerId}`, JSON.stringify(contacts)); }
  catch { /* Demo photos are best-effort in browser storage; cloud contacts use private R2. */ }
}

export function getLocalBusinessCards(ownerId = "demo-amina"): DigitalBusinessCard[] {
  try {
    const raw = localStorage.getItem(`${BUSINESS_CARDS_KEY}:${ownerId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DigitalBusinessCard[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function putLocalBusinessCards(ownerId: string, cards: DigitalBusinessCard[]): void {
  try { localStorage.setItem(`${BUSINESS_CARDS_KEY}:${ownerId}`, JSON.stringify(cards)); }
  catch { /* Local demo images are best-effort and never synced. */ }
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

export function getLocalAvatar(ownerId: string): string {
  try { return localStorage.getItem(`${PROFILE_AVATAR_KEY}:${ownerId}`) || ""; }
  catch { return ""; }
}

export function putLocalAvatar(ownerId: string, avatarUrl: string | null): void {
  try {
    const key = `${PROFILE_AVATAR_KEY}:${ownerId}`;
    if (avatarUrl) localStorage.setItem(key, avatarUrl);
    else localStorage.removeItem(key);
  } catch {
    // Demo profile photos are best-effort and remain local to this browser.
  }
}
