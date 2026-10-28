// Shared, lazy, privacy-safe real-data coordinator for Persora Dashboard widgets.
// Only fetches backend resources needed by currently visible AND non-collapsed
// widgets, deduplicating requests across multiple instances of the same widget type.

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, localDateOf, safeTimeZone } from "../../../cloudflare/calendar-rules.js";
import { CONNECTION_PROVIDERS } from "../../../cloudflare/connections.js";
import type {
  AppUser,
  PdfStudioDocument,
  PhotoStudioPhoto,
  ProjectDetail,
  ProjectSummary,
  ProjectTask,
  StorageUsage,
  VaultFolder,
  VaultFolderScope,
  VaultItem,
} from "../../types";
import {
  CALENDAR_CHANGED_EVENT,
  loadCalendarEvents,
  loadCalendarReminders,
  setCalendarTaskCompletion,
  type CalendarEvent,
  type CalendarReminder,
} from "../../lib/calendar-api";
import {
  isPagesApiConfigured,
  listPdfStudioDocuments,
  listPhotoStudioPhotos,
  listProjects,
  loadProjectDetail,
  loadStorageUsage,
  updateProjectTask,
} from "../../lib/cloud";
import { loadConnections, type ConnectionProvider } from "../../lib/connections-api";
import {
  DASHBOARD_RECENT_OPEN_EVENT,
  readRecentItemAccess,
  type DashboardWidgetInstance,
  type RecentAccessEntry,
} from "../../lib/dashboard-api";
import { loadPageFolders } from "../../lib/folders";
import {
  HABITS_CHANGED_EVENT,
  loadHabits,
  loadHabitReminders,
  saveHabitCheckin,
  type Habit,
  type HabitCheckin,
  type HabitReminder,
} from "../../lib/habit-api";
import {
  LOANS_CHANGED_EVENT,
  loadLoanReminders,
  loadLoans,
  type Loan,
  type LoanReminder,
} from "../../lib/loan-api";
import {
  deviceVaultBackend,
  serverVaultBackend,
  type BackendStatus,
} from "../../lib/password-vault-client";

export interface DomainAsyncState<T> {
  data: T;
  loading: boolean;
  error: string;
  accountRequired: boolean;
  retry: () => void;
}

const FOLDER_SCOPES: VaultFolderScope[] = [
  "documents",
  "academics",
  "purchases",
  "subscriptions",
  "notes",
  "study",
  "contacts",
];

function demoConnectionProviders(): ConnectionProvider[] {
  return CONNECTION_PROVIDERS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor,
    category: entry.category,
    description: entry.description,
    capabilities: [...entry.capabilities],
    available: entry.available,
    enabled: false,
    status: entry.available ? "not_connected" : "coming_soon",
    connection: null,
  }));
}

export function useDashboardData(
  user: AppUser,
  widgets: DashboardWidgetInstance[],
  items: VaultItem[],
  notify: (message: string, kind?: "success" | "error") => void,
) {
  const cloudActive = !user.demo && isPagesApiConfigured;
  const timeZone = useMemo(
    () => safeTimeZone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    [user.timezone],
  );
  const today = useMemo(() => localDateOf(Date.now(), timeZone), [timeZone]);

  // Only visible, expanded widgets trigger backend fetches!
  const activeWidgets = useMemo(
    () => widgets.filter((w) => w.visible !== false && !w.collapsed),
    [widgets],
  );
  const activeTypes = useMemo(() => new Set(activeWidgets.map((w) => w.type)), [activeWidgets]);

  const needsCalendarEvents = useMemo(
    () =>
      activeTypes.has("calendar-agenda") ||
      activeWidgets.some((w) => w.type === "tasks-due" && w.config.includeCalendarTasks !== false),
    [activeTypes, activeWidgets],
  );
  const needsModuleReminders = useMemo(
    () => activeWidgets.some((w) => w.type === "upcoming-reminders" && w.config.includeModuleReminders !== false),
    [activeWidgets],
  );
  const needsHabits = activeTypes.has("habit-tracker");
  const needsLoans =
    activeTypes.has("upcoming-loan-installments") ||
    activeTypes.has("payment-status-summary") ||
    activeWidgets.some(
      (w) => w.type === "combined-upcoming-payments" && w.config.paymentSource !== "subscriptions-only",
    );
  const needsProjects =
    activeTypes.has("project-progress") ||
    activeTypes.has("recent-project-activity") ||
    activeWidgets.some((w) => w.type === "tasks-due" && w.config.filter === "project");
  const selectedProjectIdsKey = useMemo(
    () =>
      Array.from(
        new Set(
          activeWidgets
            .filter((w) => w.type === "tasks-due" && w.config.filter === "project" && typeof w.config.projectId === "string" && w.config.projectId)
            .map((w) => String(w.config.projectId)),
        ),
      )
        .sort()
        .join(","),
    [activeWidgets],
  );
  const needsFolders = activeTypes.has("pinned-folders");
  const needsConnections =
    activeTypes.has("google-drive-status") ||
    activeTypes.has("connected-service-shortcuts") ||
    activeWidgets.some((w) => w.type === "external-storage-status" && w.config.showProviders !== false);
  const needsStorage = activeTypes.has("external-storage-status");
  const needsPdfStudio = activeTypes.has("pdf-studio-shortcut");
  const needsPhotoStudio = activeTypes.has("photo-studio-shortcut");
  const needsPasswordVault = activeTypes.has("password-vault-status");
  const needsRecentOpens = activeTypes.has("recently-opened");

  // ── 1. Calendar Events ─────────────────────────────────────────────────────
  const [calendarNonce, setCalendarNonce] = useState(0);
  const [calendarState, setCalendarState] = useState<{ events: CalendarEvent[]; loading: boolean; error: string }>({
    events: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsCalendarEvents || !cloudActive) return;
    const controller = new AbortController();
    setCalendarState((prev) => ({ ...prev, loading: true, error: "" }));
    const from = addDays(today, -14);
    const to = addDays(today, 31);
    loadCalendarEvents(from, to, controller.signal)
      .then((events) => {
        if (!controller.signal.aborted) setCalendarState({ events, loading: false, error: "" });
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setCalendarState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load calendar events.",
          }));
        }
      });
    return () => controller.abort();
  }, [needsCalendarEvents, cloudActive, today, calendarNonce]);

  useEffect(() => {
    if (!needsCalendarEvents || !cloudActive) return;
    const onChanged = () => setCalendarNonce((n) => n + 1);
    window.addEventListener(CALENDAR_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, onChanged);
  }, [needsCalendarEvents, cloudActive]);

  // ── 2. Module Reminders (Calendar / Habit / Loan scheduled alerts) ─────────
  const [moduleRemindersNonce, setModuleRemindersNonce] = useState(0);
  const [moduleReminders, setModuleReminders] = useState<{
    calendar: CalendarReminder[];
    habits: HabitReminder[];
    loans: LoanReminder[];
  }>({ calendar: [], habits: [], loans: [] });

  useEffect(() => {
    if (!needsModuleReminders || !cloudActive) return;
    let cancelled = false;
    Promise.all([
      loadCalendarReminders().catch(() => [] as CalendarReminder[]),
      loadHabitReminders().catch(() => [] as HabitReminder[]),
      loadLoanReminders().catch(() => [] as LoanReminder[]),
    ]).then(([calendar, habits, loans]) => {
      if (!cancelled) setModuleReminders({ calendar, habits, loans });
    });
    return () => {
      cancelled = true;
    };
  }, [needsModuleReminders, cloudActive, moduleRemindersNonce]);

  // ── 3. Habits ──────────────────────────────────────────────────────────────
  const [habitsNonce, setHabitsNonce] = useState(0);
  const [habitsState, setHabitsState] = useState<{
    habits: Habit[];
    checkins: HabitCheckin[];
    today: string;
    loading: boolean;
    error: string;
  }>({ habits: [], checkins: [], today, loading: false, error: "" });

  useEffect(() => {
    if (!needsHabits || !cloudActive) return;
    const controller = new AbortController();
    setHabitsState((prev) => ({ ...prev, loading: true, error: "" }));
    const from = addDays(today, -35);
    loadHabits(from, today, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setHabitsState({
            habits: payload.habits.filter((h) => !h.archivedAt),
            checkins: payload.checkins,
            today: payload.today || today,
            loading: false,
            error: "",
          });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setHabitsState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load habits.",
          }));
        }
      });
    return () => controller.abort();
  }, [needsHabits, cloudActive, today, habitsNonce]);

  useEffect(() => {
    if (!needsHabits || !cloudActive) return;
    const onChanged = () => setHabitsNonce((n) => n + 1);
    window.addEventListener(HABITS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(HABITS_CHANGED_EVENT, onChanged);
  }, [needsHabits, cloudActive]);

  // ── 4. Loans ───────────────────────────────────────────────────────────────
  const [loansNonce, setLoansNonce] = useState(0);
  const [loansState, setLoansState] = useState<{ loans: Loan[]; today: string; loading: boolean; error: string }>({
    loans: [],
    today,
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsLoans || !cloudActive) return;
    const controller = new AbortController();
    setLoansState((prev) => ({ ...prev, loading: true, error: "" }));
    loadLoans(controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setLoansState({
            loans: payload.loans,
            today: payload.today || today,
            loading: false,
            error: "",
          });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoansState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load loan schedules.",
          }));
        }
      });
    return () => controller.abort();
  }, [needsLoans, cloudActive, today, loansNonce]);

  useEffect(() => {
    if (!needsLoans || !cloudActive) return;
    const onChanged = () => setLoansNonce((n) => n + 1);
    window.addEventListener(LOANS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LOANS_CHANGED_EVENT, onChanged);
  }, [needsLoans, cloudActive]);

  // ── 5. Projects & Project Tasks ────────────────────────────────────────────
  const [projectsNonce, setProjectsNonce] = useState(0);
  const [projectsState, setProjectsState] = useState<{
    projects: ProjectSummary[];
    detailsById: Record<string, ProjectDetail>;
    loading: boolean;
    error: string;
  }>({ projects: [], detailsById: {}, loading: false, error: "" });

  useEffect(() => {
    if (!needsProjects || !cloudActive) return;
    let cancelled = false;
    setProjectsState((prev) => ({ ...prev, loading: true, error: "" }));
    const projectIds = selectedProjectIdsKey ? selectedProjectIdsKey.split(",").filter(Boolean) : [];
    Promise.all([
      listProjects(),
      Promise.all(
        projectIds.map((pid) =>
          loadProjectDetail(pid)
            .then((detail) => [pid, detail] as const)
            .catch(() => null),
        ),
      ),
    ])
      .then(([projects, details]) => {
        if (cancelled) return;
        const detailsById: Record<string, ProjectDetail> = {};
        for (const pair of details) {
          if (pair) detailsById[pair[0]] = pair[1];
        }
        setProjectsState({ projects, detailsById, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setProjectsState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load projects.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsProjects, cloudActive, selectedProjectIdsKey, projectsNonce]);

  // ── 6. Vault Folders (Pinned Folders) ──────────────────────────────────────
  const [foldersNonce, setFoldersNonce] = useState(0);
  const [foldersState, setFoldersState] = useState<{ folders: VaultFolder[]; loading: boolean; error: string }>({
    folders: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsFolders) return;
    let cancelled = false;
    const demoMode = Boolean(user.demo) || !isPagesApiConfigured;
    setFoldersState((prev) => ({ ...prev, loading: true, error: "" }));
    Promise.all(FOLDER_SCOPES.map((scope) => loadPageFolders(user.id, scope, demoMode).catch(() => [] as VaultFolder[])))
      .then((groups) => {
        if (!cancelled) {
          setFoldersState({ folders: groups.flat(), loading: false, error: "" });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFoldersState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load folders.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsFolders, user.id, user.demo, foldersNonce]);

  // ── 7. Connections & Storage ───────────────────────────────────────────────
  const [connectionsNonce, setConnectionsNonce] = useState(0);
  const [connectionsState, setConnectionsState] = useState<{
    providers: ConnectionProvider[];
    loading: boolean;
    error: string;
  }>({ providers: demoConnectionProviders(), loading: false, error: "" });

  useEffect(() => {
    if (!needsConnections) return;
    if (!cloudActive) {
      setConnectionsState({ providers: demoConnectionProviders(), loading: false, error: "" });
      return;
    }
    let cancelled = false;
    setConnectionsState((prev) => ({ ...prev, loading: true, error: "" }));
    loadConnections()
      .then((providers) => {
        if (!cancelled) setConnectionsState({ providers, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setConnectionsState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not check connected services.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsConnections, cloudActive, connectionsNonce]);

  const [storageNonce, setStorageNonce] = useState(0);
  const [storageState, setStorageState] = useState<{
    usage: StorageUsage | null;
    loading: boolean;
    error: string;
  }>({ usage: null, loading: false, error: "" });

  useEffect(() => {
    if (!needsStorage) return;
    if (!cloudActive) {
      const localBytes = items.reduce((sum, entry) => sum + (entry.file?.size || 0), 0);
      const dbBytes = items.length * 1024;
      const limitGb = 5;
      const limitBytes = limitGb * 1024 * 1024 * 1024;
      setStorageState({
        usage: {
          bytesUsed: localBytes + dbBytes,
          fileBytes: localBytes,
          databaseBytes: dbBytes,
          databaseRecordCount: items.length,
          objectCount: items.filter((entry) => Boolean(entry.file)).length,
          storageLimitBytes: limitBytes,
          storageLimitGb: limitGb,
          planName: "Demo workspace",
        },
        loading: false,
        error: "",
      });
      return;
    }
    let cancelled = false;
    setStorageState((prev) => ({ ...prev, loading: true, error: "" }));
    loadStorageUsage()
      .then((usage) => {
        if (!cancelled) setStorageState({ usage, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setStorageState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load storage usage.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsStorage, cloudActive, items, storageNonce]);

  // ── 8. PDF Studio & Photo Studio Libraries ─────────────────────────────────
  const [pdfNonce, setPdfNonce] = useState(0);
  const [pdfState, setPdfState] = useState<{ docs: PdfStudioDocument[]; loading: boolean; error: string }>({
    docs: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsPdfStudio || !cloudActive) return;
    let cancelled = false;
    setPdfState((prev) => ({ ...prev, loading: true, error: "" }));
    listPdfStudioDocuments()
      .then((docs) => {
        if (!cancelled) setPdfState({ docs, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setPdfState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load PDF Studio library.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsPdfStudio, cloudActive, pdfNonce]);

  const [photoNonce, setPhotoNonce] = useState(0);
  const [photoState, setPhotoState] = useState<{ photos: PhotoStudioPhoto[]; loading: boolean; error: string }>({
    photos: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsPhotoStudio || !cloudActive) return;
    let cancelled = false;
    setPhotoState((prev) => ({ ...prev, loading: true, error: "" }));
    listPhotoStudioPhotos()
      .then((photos) => {
        if (!cancelled) setPhotoState({ photos, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setPhotoState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load Photo Studio library.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsPhotoStudio, cloudActive, photoNonce]);

  // ── 9. Password Vault Status (Zero secrets — metadata status only!) ────────
  const [vaultNonce, setVaultNonce] = useState(0);
  const [vaultState, setVaultState] = useState<{ status: BackendStatus | null; loading: boolean; error: string }>({
    status: null,
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!needsPasswordVault) return;
    let cancelled = false;
    const backend = !cloudActive ? deviceVaultBackend(user.id) : serverVaultBackend();
    setVaultState((prev) => ({ ...prev, loading: true, error: "" }));
    backend
      .status()
      .then((status) => {
        if (!cancelled) setVaultState({ status, loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setVaultState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Could not check Password Vault status.",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsPasswordVault, cloudActive, user.id, vaultNonce]);

  // ── 10. Real Recently Opened Log ───────────────────────────────────────────
  const [recentOpens, setRecentOpens] = useState<RecentAccessEntry[]>(() => readRecentItemAccess(user.id));

  useEffect(() => {
    setRecentOpens(readRecentItemAccess(user.id));
  }, [user.id, needsRecentOpens]);

  useEffect(() => {
    if (!needsRecentOpens) return;
    const refreshOpens = () => setRecentOpens(readRecentItemAccess(user.id));
    window.addEventListener(DASHBOARD_RECENT_OPEN_EVENT, refreshOpens);
    return () => window.removeEventListener(DASHBOARD_RECENT_OPEN_EVENT, refreshOpens);
  }, [needsRecentOpens, user.id]);

  // ── Real Mutations from Dashboard Widgets ──────────────────────────────────
  const toggleCalendarTask = useCallback(
    async (event: CalendarEvent, completed: boolean) => {
      try {
        await setCalendarTaskCompletion(event.id, completed, event.revision);
        window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT));
        setCalendarNonce((n) => n + 1);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not update calendar task.", "error");
      }
    },
    [notify],
  );

  const checkinHabit = useCallback(
    async (habitId: string, body: { completed: boolean } | { value: number }) => {
      try {
        await saveHabitCheckin(habitId, habitsState.today || today, body);
        window.dispatchEvent(new CustomEvent(HABITS_CHANGED_EVENT));
        setHabitsNonce((n) => n + 1);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not record habit check-in.", "error");
      }
    },
    [habitsState.today, notify, today],
  );

  const toggleProjectTask = useCallback(
    async (projectId: string, task: ProjectTask, completed: boolean) => {
      try {
        await updateProjectTask(projectId, task.id, { status: completed ? "complete" : "todo" });
        setProjectsNonce((n) => n + 1);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not update project task.", "error");
      }
    },
    [notify],
  );

  return {
    cloudActive,
    timeZone,
    today,
    calendar: {
      data: calendarState.events,
      loading: calendarState.loading,
      error: calendarState.error,
      accountRequired: !cloudActive,
      retry: () => setCalendarNonce((n) => n + 1),
    } satisfies DomainAsyncState<CalendarEvent[]>,
    moduleReminders: {
      data: moduleReminders,
      retry: () => setModuleRemindersNonce((n) => n + 1),
    },
    habits: {
      data: { habits: habitsState.habits, checkins: habitsState.checkins, today: habitsState.today || today },
      loading: habitsState.loading,
      error: habitsState.error,
      accountRequired: !cloudActive,
      retry: () => setHabitsNonce((n) => n + 1),
    },
    loans: {
      data: { loans: loansState.loans, today: loansState.today || today },
      loading: loansState.loading,
      error: loansState.error,
      accountRequired: !cloudActive,
      retry: () => setLoansNonce((n) => n + 1),
    },
    projects: {
      data: { projects: projectsState.projects, detailsById: projectsState.detailsById },
      loading: projectsState.loading,
      error: projectsState.error,
      accountRequired: !cloudActive,
      retry: () => setProjectsNonce((n) => n + 1),
    },
    folders: {
      data: foldersState.folders,
      loading: foldersState.loading,
      error: foldersState.error,
      accountRequired: false,
      retry: () => setFoldersNonce((n) => n + 1),
    } satisfies DomainAsyncState<VaultFolder[]>,
    connections: {
      data: connectionsState.providers,
      loading: connectionsState.loading,
      error: connectionsState.error,
      accountRequired: false,
      retry: () => setConnectionsNonce((n) => n + 1),
    } satisfies DomainAsyncState<ConnectionProvider[]>,
    storage: {
      data: storageState.usage,
      loading: storageState.loading,
      error: storageState.error,
      accountRequired: false,
      retry: () => setStorageNonce((n) => n + 1),
    } satisfies DomainAsyncState<StorageUsage | null>,
    pdfStudio: {
      data: pdfState.docs,
      loading: pdfState.loading,
      error: pdfState.error,
      accountRequired: !cloudActive,
      retry: () => setPdfNonce((n) => n + 1),
    } satisfies DomainAsyncState<PdfStudioDocument[]>,
    photoStudio: {
      data: photoState.photos,
      loading: photoState.loading,
      error: photoState.error,
      accountRequired: !cloudActive,
      retry: () => setPhotoNonce((n) => n + 1),
    } satisfies DomainAsyncState<PhotoStudioPhoto[]>,
    passwordVault: {
      data: vaultState.status,
      loading: vaultState.loading,
      error: vaultState.error,
      accountRequired: false,
      retry: () => setVaultNonce((n) => n + 1),
    } satisfies DomainAsyncState<BackendStatus | null>,
    recentOpens,
    toggleCalendarTask,
    checkinHabit,
    toggleProjectTask,
  };
}

export type DashboardDataBundle = ReturnType<typeof useDashboardData>;
