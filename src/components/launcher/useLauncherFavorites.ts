// Launcher favorites state: shown instantly from this device, kept in sync with
// the member's account (GET/PUT /api/workspace/preferences) so every device
// shows the same favorites. The account copy is only fetched when the member
// shows intent (hovering, focusing or opening the launcher) — never on page load.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppUser } from "../../types";
import { isPagesApiConfigured } from "../../lib/cloud";
import {
  isNewer, loadLauncherPreferences, normalizeLauncherFavorites, readStoredLauncherFavorites, saveLauncherFavorites,
  splitLauncherModules, writeStoredLauncherFavorites, type LauncherModuleId, type StoredLauncherFavorites,
} from "../../lib/app-launcher";

/** local: demo/offline build (this device only) · saved: matches the account · error: account unreachable. */
export type LauncherSyncState = "idle" | "loading" | "saving" | "saved" | "local" | "error";

const REFRESH_AFTER_MS = 5 * 60_000;
const SAVE_DELAY_MS = 450;

export function useLauncherFavorites(user: AppUser) {
  const accountSync = !user.demo && isPagesApiConfigured;
  const [stored, setStored] = useState<StoredLauncherFavorites>(() => readStoredLauncherFavorites(user.id));
  const [sync, setSync] = useState<LauncherSyncState>(accountSync ? "idle" : "local");
  const loadedAt = useRef(0);
  const loading = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  /** A change waiting to be saved (undefined = nothing pending). */
  const pending = useRef<LauncherModuleId[] | null | undefined>(undefined);
  const userId = useRef(user.id);

  const remember = useCallback((entry: StoredLauncherFavorites) => {
    writeStoredLauncherFavorites(userId.current, entry);
    setStored(entry);
  }, []);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const value = pending.current;
    if (value === undefined) return;
    pending.current = undefined;
    saveLauncherFavorites(value).then((result) => {
      if (pending.current !== undefined) return; // a newer change is queued and will win
      loadedAt.current = Date.now();
      remember({ favorites: normalizeLauncherFavorites(result.launcherFavorites), updatedAt: result.updatedAt, synced: true });
      setSync("saved");
    }).catch(() => { if (pending.current === undefined) setSync("error"); });
  }, [remember]);

  // A different member signed in: start from their own device copy.
  useEffect(() => {
    if (userId.current === user.id) return;
    userId.current = user.id;
    pending.current = undefined;
    loadedAt.current = 0;
    setStored(readStoredLauncherFavorites(user.id));
    setSync(accountSync ? "idle" : "local");
  }, [user.id, accountSync]);

  // Never drop a change: save it when the workspace unmounts or the tab is hidden.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); flush(); };
  }, [flush]);

  /** Fetches the account copy (at most every few minutes); newest change wins. */
  const refresh = useCallback(() => {
    if (!accountSync || loading.current || pending.current !== undefined) return;
    if (loadedAt.current && Date.now() - loadedAt.current < REFRESH_AFTER_MS) return;
    loading.current = true;
    setSync((current) => (current === "saved" ? current : "loading"));
    loadLauncherPreferences().then((server) => {
      loadedAt.current = Date.now();
      if (pending.current !== undefined) return;
      const local = readStoredLauncherFavorites(userId.current);
      const localWins = !local.synced && Boolean(local.updatedAt) && (!server.saved || isNewer(local.updatedAt, server.updatedAt));
      if (localWins) {
        // Changed on this device while the account was unreachable: upload it.
        pending.current = local.favorites;
        setSync("saving");
        flush();
        return;
      }
      if (server.saved) remember({ favorites: normalizeLauncherFavorites(server.launcherFavorites), updatedAt: server.updatedAt, synced: true });
      setSync("saved");
    }).catch(() => setSync("error")).finally(() => { loading.current = false; });
  }, [accountSync, flush, remember]);

  /** Sets the favorites (`null` restores the defaults) and saves them. */
  const update = useCallback((next: LauncherModuleId[] | null) => {
    const value = next === null ? null : normalizeLauncherFavorites(next);
    remember({ favorites: value, updatedAt: new Date().toISOString(), synced: false });
    if (!accountSync) return;
    pending.current = value;
    setSync("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [accountSync, flush, remember]);

  const split = useMemo(() => splitLauncherModules(stored.favorites), [stored.favorites]);
  return { favorites: split.favorites, others: split.others, customized: stored.favorites !== null, update, refresh, sync, accountSync };
}
