import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUser } from "../../types";
import {
  DashboardConflictError,
  buildPresetWidgets,
  createDefaultDashboardLayout,
  createWidgetFromLibrary,
  duplicateWidgetInstance,
  isPagesApiConfigured,
  loadDashboardConfig,
  moveWidgetById,
  readStoredDashboardLayout,
  removeWidgetInstance,
  reorderWidgets,
  resetDashboardConfig,
  sanitizeSnapshot,
  saveDashboardConfigConflictSafe,
  stepWidgetOrder,
  updateWidgetInstance,
  writeStoredDashboardLayout,
  type DashboardLayoutSnapshot,
  type DashboardPresetId,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
} from "../../lib/dashboard-api";

export type DashboardSaveState =
  | "loading"
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "local";

const DEBOUNCE_SAVE_MS = 600;

export function useDashboardLayout(
  user: AppUser,
  notify: (message: string, kind?: "success" | "error") => void,
) {
  const accountSync = !user.demo && isPagesApiConfigured;

  const [snapshot, setSnapshot] = useState<DashboardLayoutSnapshot>(() => {
    const cached = readStoredDashboardLayout(user.id);
    return cached ? cached.snapshot : createDefaultDashboardLayout();
  });
  const [saveState, setSaveState] = useState<DashboardSaveState>(() =>
    accountSync ? "loading" : "local",
  );
  const [saveError, setSaveError] = useState<string>("");
  const [conflictSnapshot, setConflictSnapshot] = useState<DashboardLayoutSnapshot | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Snapshot before entering Edit Dashboard mode so Cancel restores cleanly.
  const editBaselineRef = useRef<DashboardLayoutSnapshot | null>(null);
  const revisionRef = useRef<number>(snapshot.revision);
  const pendingPayloadRef = useRef<{
    activePreset: DashboardPresetId | "custom";
    widgets: DashboardWidgetInstance[];
  } | null>(null);
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(false);
  const userIdRef = useRef(user.id);

  revisionRef.current = snapshot.revision;

  const commitLocal = useCallback(
    (next: DashboardLayoutSnapshot, synced: boolean) => {
      revisionRef.current = next.revision;
      setSnapshot(next);
      writeStoredDashboardLayout(userIdRef.current, { snapshot: next, synced });
    },
    [],
  );

  // Persist pending layout changes to Supabase (never reports "saved" until HTTP 200).
  const flushSave = useCallback(
    async (overrideRevision?: number | null): Promise<boolean> => {
      window.clearTimeout(debounceTimerRef.current);
      const pending = pendingPayloadRef.current;
      if (!pending) return true;
      if (!accountSync) {
        pendingPayloadRef.current = null;
        setSaveState("local");
        return true;
      }
      if (inFlightRef.current) return false;

      inFlightRef.current = true;
      setSaveState("saving");
      setSaveError("");

      const payloadToSave = pending;
      pendingPayloadRef.current = null;

      try {
        const expectedRevision = overrideRevision !== undefined ? overrideRevision : revisionRef.current;
        const saved = await saveDashboardConfigConflictSafe({
          activePreset: payloadToSave.activePreset,
          expectedRevision,
          widgets: payloadToSave.widgets,
        });

        // If another edit happened while saving, queue the newer payload next.
        if (pendingPayloadRef.current) {
          revisionRef.current = saved.revision;
          inFlightRef.current = false;
          return flushSave();
        }

        commitLocal(saved, true);
        setConflictSnapshot(null);
        setSaveState("saved");
        return true;
      } catch (err) {
        if (err instanceof DashboardConflictError) {
          // Keep user's in-memory widgets intact; surface conflict resolution.
          pendingPayloadRef.current = payloadToSave;
          if (err.current) {
            revisionRef.current = err.current.revision;
            setConflictSnapshot(err.current);
          }
          setSaveError(err.message);
          setSaveState("conflict");
          return false;
        }
        // Preserve in-memory layout & pending payload so Retry works cleanly!
        if (!pendingPayloadRef.current) {
          pendingPayloadRef.current = payloadToSave;
        }
        const message = err instanceof Error ? err.message : "Could not save dashboard changes.";
        setSaveError(message);
        setSaveState("error");
        return false;
      } finally {
        inFlightRef.current = false;
      }
    },
    [accountSync, commitLocal],
  );

  const schedulePersist = useCallback(
    (
      nextWidgets: DashboardWidgetInstance[],
      activePreset: DashboardPresetId | "custom" = "custom",
      immediate = false,
    ) => {
      const optimistic: DashboardLayoutSnapshot = {
        customized: true,
        activePreset,
        revision: revisionRef.current,
        updatedAt: new Date().toISOString(),
        widgets: nextWidgets,
      };
      commitLocal(optimistic, !accountSync);

      if (!accountSync) {
        setSaveState("local");
        return;
      }

      pendingPayloadRef.current = { activePreset, widgets: nextWidgets };
      setSaveState("saving");
      setSaveError("");
      window.clearTimeout(debounceTimerRef.current);
      if (immediate) {
        void flushSave();
      } else {
        debounceTimerRef.current = window.setTimeout(() => {
          void flushSave();
        }, DEBOUNCE_SAVE_MS);
      }
    },
    [accountSync, commitLocal, flushSave],
  );

  // Initial load & account switch
  useEffect(() => {
    const switchedUser = userIdRef.current !== user.id;
    userIdRef.current = user.id;
    window.clearTimeout(debounceTimerRef.current);
    pendingPayloadRef.current = null;
    setConflictSnapshot(null);
    setSaveError("");

    if (switchedUser) {
      setIsEditing(false);
      editBaselineRef.current = null;
      const cached = readStoredDashboardLayout(user.id);
      setSnapshot(cached ? cached.snapshot : createDefaultDashboardLayout());
    }

    if (!accountSync) {
      setSaveState("local");
      return;
    }

    const controller = new AbortController();
    setSaveState("loading");
    loadDashboardConfig(controller.signal)
      .then((remote) => {
        if (controller.signal.aborted) return;
        const local = readStoredDashboardLayout(user.id);
        // If local had unsynced offline edits, keep them queued for upload against latest revision.
        if (local && !local.synced && local.snapshot.customized) {
          revisionRef.current = remote.revision;
          setSnapshot(local.snapshot);
          pendingPayloadRef.current = {
            activePreset: local.snapshot.activePreset,
            widgets: local.snapshot.widgets,
          };
          void flushSave(remote.revision);
          return;
        }
        const normalized = sanitizeSnapshot(remote);
        commitLocal(normalized, true);
        setSaveState(normalized.customized ? "saved" : "idle");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setSaveError(err instanceof Error ? err.message : "Could not load your saved dashboard.");
        setSaveState("error");
      });

    return () => controller.abort();
  }, [user.id, accountSync, commitLocal, flushSave]);

  // Cross-tab / cross-device sync on window focus when idle (never overwrites active edits)
  useEffect(() => {
    if (!accountSync) return;
    const onFocus = () => {
      if (isEditing || pendingPayloadRef.current || inFlightRef.current) return;
      loadDashboardConfig()
        .then((remote) => {
          if (isEditing || pendingPayloadRef.current || inFlightRef.current) return;
          const normalized = sanitizeSnapshot(remote);
          if (normalized.revision !== revisionRef.current) {
            commitLocal(normalized, true);
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [accountSync, commitLocal, isEditing]);

  // Flush queued saves if page hides/unmounts
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && pendingPayloadRef.current) {
        void flushSave();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(debounceTimerRef.current);
    };
  }, [flushSave]);

  // ── Edit Mode lifecycle ────────────────────────────────────────────────────
  const enterEditMode = useCallback(() => {
    editBaselineRef.current = structuredCloneSnapshot(snapshot);
    setIsEditing(true);
  }, [snapshot]);

  const saveAndExitEditMode = useCallback(async () => {
    if (pendingPayloadRef.current) {
      const ok = await flushSave();
      if (!ok) {
        notify("Could not save dashboard changes. Your layout is kept in memory — use Retry.", "error");
        return;
      }
    }
    editBaselineRef.current = null;
    setIsEditing(false);
  }, [flushSave, notify]);

  const cancelEditMode = useCallback(() => {
    window.clearTimeout(debounceTimerRef.current);
    pendingPayloadRef.current = null;
    const baseline = editBaselineRef.current;
    editBaselineRef.current = null;
    setIsEditing(false);
    if (baseline) {
      schedulePersist(baseline.widgets, baseline.activePreset, true);
    }
  }, [schedulePersist]);

  // ── Widget mutations ───────────────────────────────────────────────────────
  const addWidget = useCallback(
    (type: DashboardWidgetType, overrides?: Partial<DashboardWidgetInstance>) => {
      try {
        const created = createWidgetFromLibrary(type, snapshot.widgets, overrides);
        const next = [...snapshot.widgets, created];
        schedulePersist(next, "custom", false);
        notify(`Added "${created.title}" to your dashboard.`);
        return created;
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not add widget.", "error");
        return null;
      }
    },
    [notify, schedulePersist, snapshot.widgets],
  );

  const reorderByIndex = useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = reorderWidgets(snapshot.widgets, fromIndex, toIndex);
      if (next === snapshot.widgets) return;
      schedulePersist(next, "custom", false);
    },
    [schedulePersist, snapshot.widgets],
  );

  const moveById = useCallback(
    (id: string, targetId: string) => {
      const next = moveWidgetById(snapshot.widgets, id, targetId);
      if (next === snapshot.widgets) return;
      schedulePersist(next, "custom", false);
    },
    [schedulePersist, snapshot.widgets],
  );

  const stepOrder = useCallback(
    (id: string, delta: -1 | 1) => {
      const next = stepWidgetOrder(snapshot.widgets, id, delta);
      if (next === snapshot.widgets) return;
      schedulePersist(next, "custom", false);
    },
    [schedulePersist, snapshot.widgets],
  );

  const updateWidget = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<DashboardWidgetInstance, "title" | "width" | "height" | "config" | "visible" | "collapsed">
      >,
    ) => {
      const next = updateWidgetInstance(snapshot.widgets, id, patch);
      schedulePersist(next, snapshot.activePreset === "balanced" && !snapshot.customized ? "custom" : snapshot.activePreset, false);
    },
    [schedulePersist, snapshot.activePreset, snapshot.customized, snapshot.widgets],
  );

  const duplicateWidget = useCallback(
    (id: string) => {
      try {
        const next = duplicateWidgetInstance(snapshot.widgets, id);
        schedulePersist(next, "custom", false);
        notify("Widget duplicated.");
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not duplicate widget.", "error");
      }
    },
    [notify, schedulePersist, snapshot.widgets],
  );

  const removeWidget = useCallback(
    (id: string) => {
      const target = snapshot.widgets.find((w) => w.id === id);
      const next = removeWidgetInstance(snapshot.widgets, id);
      schedulePersist(next, "custom", false);
      if (target) notify(`Removed "${target.title}" from dashboard.`);
    },
    [notify, schedulePersist, snapshot.widgets],
  );

  const applyPreset = useCallback(
    (presetId: DashboardPresetId) => {
      const widgets = buildPresetWidgets(presetId, { freshIds: true });
      schedulePersist(widgets, presetId, true);
      notify(`Applied "${presetId.replace(/-/g, " ")}" dashboard preset.`);
    },
    [notify, schedulePersist],
  );

  const resetToDefault = useCallback(async () => {
    window.clearTimeout(debounceTimerRef.current);
    pendingPayloadRef.current = null;
    const freshDefault = createDefaultDashboardLayout();

    if (!accountSync) {
      commitLocal(freshDefault, true);
      setIsEditing(false);
      editBaselineRef.current = null;
      setSaveState("local");
      notify("Dashboard reset to the default layout.");
      return;
    }

    setSaveState("saving");
    setSaveError("");
    try {
      const reset = await resetDashboardConfig(revisionRef.current);
      commitLocal(reset, true);
      setConflictSnapshot(null);
      setIsEditing(false);
      editBaselineRef.current = null;
      setSaveState("saved");
      notify("Dashboard reset to the default layout.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not reset dashboard.");
      setSaveState("error");
      notify("Could not reset dashboard right now. Please retry.", "error");
    }
  }, [accountSync, commitLocal, notify]);

  const retrySave = useCallback(() => {
    if (!pendingPayloadRef.current && snapshot.customized) {
      pendingPayloadRef.current = {
        activePreset: snapshot.activePreset,
        widgets: snapshot.widgets,
      };
    }
    void flushSave();
  }, [flushSave, snapshot.activePreset, snapshot.customized, snapshot.widgets]);

  const resolveConflictKeepMine = useCallback(() => {
    const latestRev = conflictSnapshot ? conflictSnapshot.revision : null;
    pendingPayloadRef.current = {
      activePreset: snapshot.activePreset,
      widgets: snapshot.widgets,
    };
    void flushSave(latestRev);
  }, [conflictSnapshot, flushSave, snapshot.activePreset, snapshot.widgets]);

  const resolveConflictReloadServer = useCallback(() => {
    window.clearTimeout(debounceTimerRef.current);
    pendingPayloadRef.current = null;
    if (conflictSnapshot) {
      commitLocal(conflictSnapshot, true);
      setConflictSnapshot(null);
      setSaveError("");
      setSaveState("saved");
    } else {
      loadDashboardConfig()
        .then((remote) => {
          commitLocal(sanitizeSnapshot(remote), true);
          setConflictSnapshot(null);
          setSaveError("");
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }
  }, [commitLocal, conflictSnapshot]);

  return {
    widgets: snapshot.widgets.filter((w) => w.visible !== false),
    allWidgets: snapshot.widgets,
    customized: snapshot.customized,
    activePreset: snapshot.activePreset,
    revision: snapshot.revision,
    accountSync,
    saveState,
    saveError,
    conflictSnapshot,
    isEditing,
    enterEditMode,
    saveAndExitEditMode,
    cancelEditMode,
    addWidget,
    reorderByIndex,
    moveById,
    stepOrder,
    updateWidget,
    duplicateWidget,
    removeWidget,
    applyPreset,
    resetToDefault,
    retrySave,
    resolveConflictKeepMine,
    resolveConflictReloadServer,
  };
}

function structuredCloneSnapshot(snap: DashboardLayoutSnapshot): DashboardLayoutSnapshot {
  return {
    ...snap,
    widgets: snap.widgets.map((w) => ({
      ...w,
      config: { ...w.config, ...(Array.isArray(w.config.actions) ? { actions: [...(w.config.actions as string[])] } : {}) },
    })),
  };
}
