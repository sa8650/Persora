import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_USER, SECTION_BY_ID, SECTION_DEFINITIONS } from "./data";
import LandingPage from "./components/LandingPage";
import AuthDialog, { type AuthMode } from "./components/AuthDialog";
import Workspace from "./components/Workspace";
import { deriveAutomaticTimelineEvents, mergeTimelineEvents } from "./lib/timeline";
import PublicBusinessCardPage from "./components/PublicBusinessCardPage";
const AdminConsole = lazy(() => import("./components/AdminConsole"));
const AdminAccessPage = lazy(() => import("./components/AdminAccessPage"));
import PublicInfoPage from "./components/PublicInfoPage";
import { ConfirmDialog, ItemDetailDialog, ItemEditorDialog, ShareManagementDialog, TodoEditorDialog, ToastNotice } from "./components/VaultDialogs";
import type { ActiveScheduleAlert, AppUser, BusinessCardDraft, ContactDraft, ContactImportProgress, DigitalBusinessCard, DocumentTypeOption, MedicalRecord, MedicalRecordDraft, MedicalRecordFile, NotesRecordKind, PersoraContact, SectionId, ShareComment, ShareNotification, SharePermission, SharedVaultEntry, RecordShareEntry, SiteContent, SubscriptionPlan, TimelineDraft, TimelineEvent, TransferProgress, VaultFilePreview, VaultItem, ViewId } from "./types";
import { DEFAULT_SITE_CONTENT } from "./data/siteContent";
import PersoraBootScreen from "./components/PersoraBootScreen";
import {
  deleteOwnAccount,
  deleteVaultFile,
  fetchVaultFile,
  isPagesApiConfigured,
  loadVaultItems,
  loadContacts,
  loadBusinessCards,
  saveBusinessCard,
  deleteBusinessCard,
  saveContactRecord,
  deleteContactRecord,
  mergeContactRecords,
  removeVaultItem,
  saveVaultItem,
  updateProfile,
  updatePassword,
  uploadVaultFile,
  openVaultFile,
  loadSharedItems,
  loadRecordShares,
  createRecordShare,
  revokeRecordShare,
  createDocumentShare,
  changeDocumentSharePermission,
  revokeDocumentShare,
  saveSharedDocument,
  uploadSharedDocumentFile,
  deleteUnattachedSharedUpload,
  loadShareComments,
  addShareComment,
  loadShareNotifications,
  markShareNotificationsRead,
  loadTimelineEvents,
  saveTimelineEvent,
  deleteTimelineEvent,
  uploadTimelineAttachment,
  downloadTimelineAttachment,
  loadMedicalRecords,
  saveMedicalRecord,
  deleteMedicalRecord,
  uploadMedicalRecordFile,
  deleteUnattachedMedicalRecordFile,
  fetchMedicalRecordFile,
  downloadMedicalRecordFile,
} from "./lib/backend";
import { loadAdminBootstrapStatus, loadDocumentTypes, loadPublicPlans, loadPublicSiteContent } from "./lib/cloud";
import { signIn, signOut, signUp, getCurrentUser } from "./lib/auth";
import { getLocalBusinessCards, getLocalContacts, getLocalItems, getLocalProfile, putLocalBusinessCards, putLocalContacts, putLocalItems, putLocalProfile } from "./lib/local-store";

interface ToastState { message: string; kind: "success" | "error"; id: number }
type EditorDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null };
type AppPath = "/" | "/admin" | "/privacy" | "/terms" | "/contact";
type PublicPage = "privacy" | "terms" | "contact";
const PUBLIC_PATHS: Record<string, PublicPage> = { "/privacy": "privacy", "/terms": "terms", "/contact": "contact" };
const baseDocumentTypes = SECTION_BY_ID.documents.fields.find((field) => field.key === "type")?.options || [];
const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
  });
}
function contactPhotoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("Could not read the selected contact photo.")); reader.readAsDataURL(file);
  });
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authRestoring, setAuthRestoring] = useState(true);
  const [siteContent, setSiteContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [siteContentPath, setSiteContentPath] = useState(isPagesApiConfigured ? "" : "/");
  const [items, setItems] = useState<VaultItem[]>(() => getLocalItems());
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([]);
  const medicalRecordsRef = useRef(medicalRecords);
  const demoMedicalFiles = useRef<Map<string, File>>(new Map());
  const commitMedicalRecords = useCallback((next: MedicalRecord[]) => { medicalRecordsRef.current = next; setMedicalRecords(next); }, []);
  const [timelineOnline, setTimelineOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [timelineSaving, setTimelineSaving] = useState(false);
  const [timelineClock, setTimelineClock] = useState(() => Date.now());
  const [contacts, setContacts] = useState<PersoraContact[]>(() => getLocalContacts("demo-amina"));
  const [businessCards, setBusinessCards] = useState<DigitalBusinessCard[]>(() => getLocalBusinessCards("demo-amina"));
  const businessCardsRef = useRef(businessCards);
  const commitBusinessCards = useCallback((next: DigitalBusinessCard[]) => { businessCardsRef.current = next; setBusinessCards(next); }, []);
  const contactsRef = useRef(contacts);
  const commitContacts = useCallback((next: PersoraContact[]) => { contactsRef.current = next; setContacts(next); }, []);
  const [sharedByMe, setSharedByMe] = useState<SharedVaultEntry[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedVaultEntry[]>([]);
  const [recordSharesByMe, setRecordSharesByMe] = useState<RecordShareEntry[]>([]);
  const [recordSharesWithMe, setRecordSharesWithMe] = useState<RecordShareEntry[]>([]);
  const [shareNotifications, setShareNotifications] = useState<ShareNotification[]>([]);
  const [localScheduleNotifications, setLocalScheduleNotifications] = useState<ShareNotification[]>([]);
  const [ringingSchedules, setRingingSchedules] = useState<ActiveScheduleAlert[]>([]);
  const [scheduleNotificationOwner, setScheduleNotificationOwner] = useState("");
  const [shareComments, setShareComments] = useState<ShareComment[]>([]);
  const [shareTarget, setShareTarget] = useState<VaultItem | null>(null);
  const [view, setView] = useState<ViewId>("dashboard");
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [authBusy, setAuthBusy] = useState(false);
  const [editor, setEditor] = useState<{ section: SectionId; item?: VaultItem } | null>(null);
  const [todoEditor, setTodoEditor] = useState<VaultItem | null | false>(false);
  const [todoEditorType, setTodoEditorType] = useState<NotesRecordKind>("todo");
  const [focusedItem, setFocusedItem] = useState<VaultItem | null>(null);
  const [filePreview, setFilePreview] = useState<VaultFilePreview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [documentTypes, setDocumentTypes] = useState<string[]>(baseDocumentTypes);
  const [publicPlans, setPublicPlans] = useState<SubscriptionPlan[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState(25);
  const [pendingPlanId, setPendingPlanId] = useState("");
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));
  const [bootstrapStatus, setBootstrapStatus] = useState<{ initialized: boolean | null; enabled: boolean }>({ initialized: null, enabled: false });
  const localFiles = useRef<Map<string, string>>(new Map());
  const adminRoute = pathname === "/admin";
  const publicCardId = pathname.match(/^\/BusinessCard\/([A-F0-9]{32})$/i)?.[1].toUpperCase() || "";
  const publicPage = PUBLIC_PATHS[pathname];
  const siteContentLoading = Boolean(publicPage && isPagesApiConfigured && siteContentPath !== pathname);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind, id: Date.now() + Math.floor(Math.random() * 1000) });
  }, []);
  const timelineSyncInFlight = useRef(false);
  const refreshTimeline = useCallback(async () => {
    if (!user || user.demo || !isPagesApiConfigured || timelineSyncInFlight.current) return;
    timelineSyncInFlight.current = true;
    try { setTimelineEvents(await loadTimelineEvents()); setTimelineOnline(true); }
    catch (error) { if ((typeof navigator !== "undefined" && !navigator.onLine) || error instanceof TypeError) setTimelineOnline(false); }
    finally { timelineSyncInFlight.current = false; }
  }, [user?.id, user?.demo]);
  const automaticTimelineEvents = useMemo(() => deriveAutomaticTimelineEvents(items, user?.timezone), [items, user?.timezone, timelineClock]);
  const displayTimelineEvents = useMemo(() => mergeTimelineEvents(timelineEvents, automaticTimelineEvents, timelineOnline), [timelineEvents, automaticTimelineEvents, timelineOnline]);

  useEffect(() => { const timer = window.setInterval(() => setTimelineClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const offline = () => setTimelineOnline(false);
    const online = () => { setTimelineOnline(true); void refreshTimeline(); };
    window.addEventListener("offline", offline); window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, [refreshTimeline]);
  useEffect(() => {
    setTimelineEvents([]);
    if (user && !user.demo && isPagesApiConfigured) void refreshTimeline();
  }, [user?.id, user?.demo, refreshTimeline]);
  useEffect(() => {
    if (!user || user.demo || !isPagesApiConfigured || !timelineOnline || !automaticTimelineEvents.length) return;
    const known = new Set(timelineEvents.map((event) => event.eventKey).filter(Boolean));
    if (automaticTimelineEvents.some((event) => !known.has(event.eventKey))) void refreshTimeline();
  }, [user?.id, user?.demo, timelineOnline, automaticTimelineEvents, timelineEvents, refreshTimeline]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onPopState = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const goToPath = (path: AppPath) => {
    if (normalizePath(window.location.pathname) !== path) window.history.pushState({}, "", path);
    setPathname(path);
    setSearch("");
  };

  const applyUser = useCallback(async (profile: AppUser) => {
    const [loadedItems, extraResults] = await Promise.all([
      loadVaultItems(),
      Promise.allSettled([loadSharedItems("outgoing"), loadSharedItems("incoming"), loadShareNotifications(), loadContacts(), loadBusinessCards(), loadRecordShares("outgoing"), loadRecordShares("incoming"), loadMedicalRecords()]),
    ]);
    const [outgoing, incoming, notifications, loadedContacts, loadedBusinessCards, outgoingRecords, incomingRecords, loadedMedicalRecords] = extraResults;
    setUser(profile);
    setRingingSchedules([]);
    setLocalScheduleNotifications([]);
    setItems(loadedItems);
    setSharedByMe(outgoing.status === "fulfilled" ? outgoing.value : []);
    setSharedWithMe(incoming.status === "fulfilled" ? incoming.value : []);
    setShareNotifications(notifications.status === "fulfilled" ? notifications.value : []);
    setRecordSharesByMe(outgoingRecords.status === "fulfilled" ? outgoingRecords.value : []);
    setRecordSharesWithMe(incomingRecords.status === "fulfilled" ? incomingRecords.value : []);
    commitContacts(loadedContacts.status === "fulfilled" ? loadedContacts.value : []);
    commitBusinessCards(loadedBusinessCards.status === "fulfilled" ? loadedBusinessCards.value : []);
    commitMedicalRecords(loadedMedicalRecords.status === "fulfilled" ? loadedMedicalRecords.value : []);
    demoMedicalFiles.current.clear();
    setView(pendingPlanId ? "billing" : "dashboard");
    setAuthOpen(false);
    setSearch("");
  }, [pendingPlanId, commitContacts, commitBusinessCards, commitMedicalRecords]);

  useEffect(() => {
    let active = true;
    const restoreLocalDemo = () => {
      const remembered = getLocalProfile();
      if (!remembered) { setItems(getLocalItems()); commitContacts(getLocalContacts(DEMO_USER.id)); commitBusinessCards(getLocalBusinessCards(DEMO_USER.id)); commitMedicalRecords([]); demoMedicalFiles.current.clear(); return; }
      let ownerId = DEMO_USER.id;
      if (remembered.startsWith("demo:")) {
        const [, email, fullName] = remembered.split(":");
        ownerId = `demo-${email}`;
        setUser({ ...DEMO_USER, id: ownerId, email, fullName: fullName || DEMO_USER.fullName, role: "user" });
      } else if (remembered === DEMO_USER.email) {
        setUser(DEMO_USER);
      }
      setItems(getLocalItems());
      commitContacts(getLocalContacts(ownerId));
      commitBusinessCards(getLocalBusinessCards(ownerId));
      commitMedicalRecords([]); demoMedicalFiles.current.clear();
    };
    const restore = async () => {
      try {
        if (!isPagesApiConfigured) { restoreLocalDemo(); return; }
        const profile = await getCurrentUser();
        if (!active) return;
        if (profile) await applyUser(profile);
        else restoreLocalDemo();
      } catch (error) {
        if (!active) return;
        setItems(getLocalItems());
        notify(error instanceof Error ? `Couldn't reconnect to Persora: ${error.message}` : "Couldn't reconnect to Persora.", "error");
      } finally {
        if (active) setAuthRestoring(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, [applyUser, notify]);

  useEffect(() => {
    if (!isPagesApiConfigured) return;
    let active = true;
    void loadPublicPlans().then((result) => {
      if (active) { setPublicPlans(result.plans); setBillingEnabled(result.billingEnabled); setMaxUploadMb(result.maxUploadMb); }
    }).catch(() => { if (active) { setPublicPlans([]); setBillingEnabled(false); } });
    void loadDocumentTypes().then((rows: DocumentTypeOption[]) => {
      if (active) setDocumentTypes(rows.filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order).map((row) => row.name));
    }).catch(() => { /* The built-in document choices remain available if catalog setup is pending. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || user.demo || !isPagesApiConfigured) return;
    let active = true;
    const refresh = () => { void loadShareNotifications().then((rows) => { if (active) setShareNotifications(rows); }).catch(() => {}); };
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, user?.demo]);

  useEffect(() => {
    if (!user || user.demo || !isPagesApiConfigured) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadContacts().then((rows) => { if (active) commitContacts(rows); }).catch(() => {});
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [user?.id, user?.demo, commitContacts]);

  useEffect(() => {
    if (!user || user.demo || !isPagesApiConfigured) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadMedicalRecords().then((rows) => { if (active) commitMedicalRecords(rows); }).catch(() => {});
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [user?.id, user?.demo, commitMedicalRecords]);

  useEffect(() => {
    if (!publicPage || !isPagesApiConfigured) return;
    let active = true;
    void loadPublicSiteContent().then((content) => {
      if (active) { setSiteContent(content); setSiteContentPath(pathname); }
    }).catch(() => {
      if (active) setSiteContentPath(pathname);
    });
    return () => { active = false; };
  }, [publicPage, pathname]);

  useEffect(() => {
    if (!publicPage && siteContentPath) setSiteContentPath("");
  }, [publicPage, siteContentPath]);

  useEffect(() => {
    if (!adminRoute || !isPagesApiConfigured) { setBootstrapStatus({ initialized: null, enabled: false }); return; }
    let active = true;
    void loadAdminBootstrapStatus().then((status) => { if (active) setBootstrapStatus(status); })
      .catch(() => { if (active) setBootstrapStatus({ initialized: null, enabled: false }); });
    return () => { active = false; };
  }, [adminRoute]);

  const completeDemo = () => {
    setUser(DEMO_USER);
    setItems(getLocalItems());
commitContacts(getLocalContacts(DEMO_USER.id));
    commitBusinessCards(getLocalBusinessCards(DEMO_USER.id));
    commitMedicalRecords([]); demoMedicalFiles.current.clear();
    setSharedByMe([]); setSharedWithMe([]); setRecordSharesByMe([]); setRecordSharesWithMe([]); setShareNotifications([]); setShareComments([]);
    setView("dashboard");
    setSearch("");
    setAuthOpen(false);
    setEditor(null);
    setTodoEditor(false);
    setFocusedItem(null);
    setShareTarget(null);
    setPendingPlanId("");
    putLocalProfile(`demo:${DEMO_USER.email}:${DEMO_USER.fullName}`);
    notify("Welcome to your Persora demo space.");
  };

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const handleAuthSubmit = async (mode: AuthMode, values: { fullName: string; email: string; identifier: string; password: string }): Promise<void> => {
    setAuthBusy(true);
    try {
      const profile = mode === "signup"
        ? await signUp(values.fullName, values.email, values.password)
        : await signIn(values.identifier, values.password);
      await applyUser(profile);
      if (mode === "signup") notify(`Your Persora ID is ${profile.userId}. Save it to sign in next time.`);
    } finally { setAuthBusy(false); }
  };

  const handleSignOut = async () => {
    try { if (!user?.demo && isPagesApiConfigured) await signOut(); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't sign out cleanly.", "error"); }
    putLocalProfile(null);
    setUser(null);
    setItems(getLocalItems());
    commitContacts([]);
    commitBusinessCards([]);
    commitMedicalRecords([]); demoMedicalFiles.current.clear();
    setSharedByMe([]); setSharedWithMe([]); setRecordSharesByMe([]); setRecordSharesWithMe([]); setShareNotifications([]); setLocalScheduleNotifications([]); setRingingSchedules([]); setShareComments([]); setShareTarget(null);
    setView("dashboard");
    setEditor(null);
    setTodoEditor(false);
    setFocusedItem(null);
    setFilePreview(null);
    setSearch("");
    notify("You've signed out.");
  };

  const handleSaveItem = async (draft: EditorDraft, onUploadProgress?: (progress: TransferProgress) => void) => {
    if (!user) throw new Error("Please sign in before adding a record.");
    const sharedAccess = draft.sharedAccess;
    if (sharedAccess?.direction === "incoming") {
      if (user.demo || sharedAccess.permission !== "edit") throw new Error("This share does not allow editing.");
      const id = draft.id || "";
      let nextFile = draft.file;
      let uploaded: string | undefined;
      if (draft.fileUpload) {
        nextFile = await uploadSharedDocumentFile(sharedAccess.shareId, draft.fileUpload, onUploadProgress);
        uploaded = nextFile.key;
      }
      const candidate: VaultItem = {
        id, section: draft.section, title: draft.title.trim(), subtitle: draft.subtitle,
        metadata: draft.metadata, file: nextFile, favorite: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      try {
        const saved = await saveSharedDocument(sharedAccess.shareId, candidate);
        saved.sharedAccess = sharedAccess;
        setSharedWithMe((current) => current.map((entry) => entry.shareId === sharedAccess.shareId ? { ...entry, item: saved } : entry));
        setEditor(null); setFocusedItem(null);
        notify("Your changes are saved to the original owner's document.");
      } catch (error) {
        if (uploaded) { try { await deleteUnattachedSharedUpload(sharedAccess.shareId, uploaded); } catch { /* File cleanup can be retried; the owner's record remains untouched. */ } }
        throw error;
      }
      return;
    }
    const oldItem = draft.id ? items.find((entry) => entry.id === draft.id) : undefined;
    const id = draft.id || createId();
    const now = new Date().toISOString();
    let nextFile = draft.file;
    let uploadedFileKey: string | undefined;
    let localUrlToRevoke: string | undefined;
    if (draft.fileUpload) {
      if (user.demo) {
        const previousUrl = localFiles.current.get(id);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const url = URL.createObjectURL(draft.fileUpload);
        localFiles.current.set(id, url);
        nextFile = { name: draft.fileUpload.name, size: draft.fileUpload.size, type: draft.fileUpload.type, localOnly: true };
      } else {
        if (!isPagesApiConfigured) throw new Error("Enable the Persora Pages API to securely attach files. Your file has not been saved.");
        nextFile = await uploadVaultFile(draft.fileUpload, onUploadProgress);
        uploadedFileKey = nextFile.key;
      }
    } else if (oldItem?.file?.key && !draft.file) {
      localUrlToRevoke = localFiles.current.get(id);
    }

    const candidate: VaultItem = {
      id, section: draft.section, title: draft.title.trim(), subtitle: draft.subtitle,
      metadata: draft.metadata, file: nextFile, favorite: Boolean(draft.favorite), pinned: Boolean(draft.pinned),
      createdAt: oldItem?.createdAt || now, updatedAt: now,
    };

    if (user.demo) {
      const next = oldItem ? items.map((entry) => entry.id === id ? candidate : entry) : [candidate, ...items];
      if (oldItem?.file?.localOnly && !candidate.file) {
        const url = localFiles.current.get(id);
        if (url) URL.revokeObjectURL(url);
        localFiles.current.delete(id);
      }
      setItems(next);
      putLocalItems(next);
    } else {
      try {
        const saved = await saveVaultItem(candidate);
        const next = oldItem ? items.map((entry) => entry.id === id ? saved : entry) : [saved, ...items];
        setItems(next);
        setSharedByMe((current) => current.map((entry) => entry.item.id === saved.id ? { ...entry, item: saved } : entry));
        if (oldItem?.file?.key && oldItem.file.key !== saved.file?.key) {
          try { await deleteVaultFile(oldItem.file.key); } catch { /* The record is saved; file cleanup can be retried. */ }
        }
      } catch (error) {
        if (uploadedFileKey) { try { await deleteVaultFile(uploadedFileKey); } catch { /* Ignore secondary cleanup failure. */ } }
        throw error;
      }
    }
    if (localUrlToRevoke) { URL.revokeObjectURL(localUrlToRevoke); localFiles.current.delete(id); }
    setEditor(null);
    setFocusedItem(null);
    notify(oldItem ? "Your changes are saved." : `${candidate.title} is safely in your vault.`);
  };

  const handleMoveVaultItem = async (item: VaultItem, folderId: string | null) => {
    if (!user) throw new Error("Sign in before moving a record.");
    const updated: VaultItem = { ...item, folderId: folderId || undefined, updatedAt: new Date().toISOString() };
    if (user.demo) {
      const next = items.map((entry) => entry.id === item.id ? updated : entry);
      setItems(next); putLocalItems(next); return;
    }
    if (!isPagesApiConfigured) throw new Error("Connect the Persora cloud API to move private records between folders.");
    const saved = await saveVaultItem(updated);
    setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
    setSharedByMe((current) => current.map((entry) => entry.item.id === saved.id ? { ...entry, item: saved } : entry));
  };

  const handleDeleteItem = async () => {
    if (!deleteTarget || !user) return;
    const target = deleteTarget;
    let cleanupMessage = "";
    try {
      if (user.demo) {
        const next = items.filter((entry) => entry.id !== target.id);
        setItems(next); putLocalItems(next);
        const url = localFiles.current.get(target.id);
        if (url) URL.revokeObjectURL(url);
        localFiles.current.delete(target.id);
      } else {
        await removeVaultItem(target.id);
        setItems((current) => current.filter((entry) => entry.id !== target.id));
        if (target.file?.key) {
          try { await deleteVaultFile(target.file.key); }
          catch (error) { cleanupMessage = error instanceof Error ? `Record removed, but file cleanup needs attention: ${error.message}` : "Record removed, but file cleanup needs attention."; }
        }
      }
      setSharedByMe((current) => current.filter((entry) => entry.item.id !== target.id));
      setDeleteTarget(null);
      setFocusedItem(null);
      notify(cleanupMessage || "The record has been removed from your vault.", cleanupMessage ? "error" : "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't remove that record. Please try again.", "error"); }
  };

  const handleToggleFavorite = async (item: VaultItem, favorite: boolean) => {
    if (!user) return;
    const updated = { ...item, favorite, updatedAt: new Date().toISOString() };
    if (user.demo) {
      const next = items.map((entry) => entry.id === item.id ? updated : entry);
      setItems(next); putLocalItems(next); return;
    }
    try {
      const saved = await saveVaultItem(updated);
      setItems((current) => current.map((entry) => entry.id === item.id ? saved : entry));
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update favorite.", "error"); }
  };

  const handleToggleTodo = async (item: VaultItem, completed: boolean) => {
    if (!user) return;
    const updated: VaultItem = { ...item, metadata: { ...item.metadata, completed: completed ? "true" : "false" }, updatedAt: new Date().toISOString() };
    if (user.demo) {
      const next = items.map((entry) => entry.id === item.id ? updated : entry);
      setItems(next); putLocalItems(next); return;
    }
    try {
      const saved = await saveVaultItem(updated);
      setItems((current) => current.map((entry) => entry.id === item.id ? saved : entry));
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update the task.", "error"); }
  };

  const handleToggleSchedule = async (item: VaultItem, enabled: boolean) => {
    if (!user) return;
    const updated: VaultItem = { ...item, metadata: { ...item.metadata, enabled: enabled ? "true" : "false" }, updatedAt: new Date().toISOString() };
    if (user.demo) {
      const next = items.map((entry) => entry.id === item.id ? updated : entry);
      setItems(next); putLocalItems(next); return;
    }
    try {
      const saved = await saveVaultItem(updated);
      setItems((current) => current.map((entry) => entry.id === item.id ? saved : entry));
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update this schedule.", "error"); }
  };

  const handleSnoozeSchedule = async (alert: ActiveScheduleAlert) => {
    if (!user) return;
    const updated: VaultItem = { ...alert.item, metadata: { ...alert.item.metadata, enabled: "true", snoozedUntil: new Date(Date.now() + 5 * 60_000).toISOString() }, updatedAt: new Date().toISOString() };
    try {
      if (user.demo) { const next = items.map((entry) => entry.id === updated.id ? updated : entry); setItems(next); putLocalItems(next); }
      else { const saved = await saveVaultItem(updated); setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry)); }
      setRingingSchedules((current) => current.filter((entry) => entry.id !== alert.id));
      notify(`Snoozed “${alert.item.title}” for 5 minutes.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't snooze this alert.", "error"); }
  };

  const handleDismissSchedule = async (alert: ActiveScheduleAlert) => {
    setRingingSchedules((current) => current.filter((entry) => entry.id !== alert.id));
    if (!user || (alert.kind === "alarm" && Boolean(alert.item.metadata.repeatDays))) return;
    const updated: VaultItem = { ...alert.item, metadata: { ...alert.item.metadata, enabled: "false" }, updatedAt: new Date().toISOString() };
    try {
      if (user.demo) { const next = items.map((entry) => entry.id === updated.id ? updated : entry); setItems(next); putLocalItems(next); }
      else { const saved = await saveVaultItem(updated); setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry)); }
    } catch (error) { notify(error instanceof Error ? error.message : "The alert was dismissed, but its schedule could not be updated.", "error"); }
  };

  useEffect(() => {
    const owner = user?.id || "";
    if (!owner) { setLocalScheduleNotifications([]); setScheduleNotificationOwner(""); return; }
    try {
      const raw = localStorage.getItem(`persora-schedule-notifications:${owner}`);
      setLocalScheduleNotifications(raw ? JSON.parse(raw) as ShareNotification[] : []);
    } catch { setLocalScheduleNotifications([]); }
    setScheduleNotificationOwner(owner);
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || scheduleNotificationOwner !== user.id) return;
    try { localStorage.setItem(`persora-schedule-notifications:${user.id}`, JSON.stringify(localScheduleNotifications.slice(0, 30))); } catch { /* Notifications are a convenience; schedules themselves remain saved. */ }
  }, [user?.id, scheduleNotificationOwner, localScheduleNotifications]);
  useEffect(() => {
    if (!user) return;
    const checkSchedules = () => {
      const now = new Date();
      const occurrence = (item: VaultItem): { at: Date; key: string } | null => {
        const snoozedUntil = item.metadata.snoozedUntil ? new Date(item.metadata.snoozedUntil) : null;
        if (snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil.getTime() >= now.getTime() - 86400000) return { at: snoozedUntil, key: `snooze-${snoozedUntil.toISOString()}` };
        if (item.metadata.recordType === "reminder") {
          const at = new Date(item.metadata.reminderAt || "");
          return Number.isNaN(at.getTime()) ? null : { at, key: at.toISOString() };
        }
        if (item.metadata.recordType !== "alarm" || !item.metadata.alarmTime) return null;
        const [hours, minutes] = item.metadata.alarmTime.split(":").map(Number);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        const repeatDays = (item.metadata.repeatDays || "").split(",").filter(Boolean);
        if (!repeatDays.length) {
          if (!item.metadata.alarmDate) return null;
          const at = new Date(`${item.metadata.alarmDate}T${item.metadata.alarmTime}`);
          return Number.isNaN(at.getTime()) ? null : { at, key: at.toISOString() };
        }
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (!repeatDays.includes(String(at.getDay()))) return null;
        return { at, key: at.toISOString() };
      };
      let fired: string[] = [];
      try { fired = JSON.parse(localStorage.getItem(`persora-fired-schedules:${user.id}`) || "[]") as string[]; } catch { fired = []; }
      const newlyFired: string[] = [];
      for (const item of items) {
        const type = item.metadata.recordType;
        if ((type !== "reminder" && type !== "alarm") || item.metadata.enabled === "false") continue;
        const event = occurrence(item);
        if (!event || event.at.getTime() > now.getTime() || now.getTime() - event.at.getTime() > (event.key.startsWith("snooze-") ? 86400000 : 120000)) continue;
        const key = `${item.id}:${event.key}`;
        if (fired.includes(key)) continue;
        fired.push(key); newlyFired.push(key);
        const kind = type as "reminder" | "alarm";
        const entry: ShareNotification = { id: `schedule:${key}`, kind, itemTitle: item.title, actorName: item.title, message: kind === "reminder" ? "Your reminder is due now." : "Your alarm is ringing.", createdAt: now.toISOString() };
        setLocalScheduleNotifications((current) => [entry, ...current.filter((existing) => existing.id !== entry.id)].slice(0, 30));
        setRingingSchedules((current) => current.some((alert) => alert.id === entry.id) ? current : [...current, { id: entry.id, item, kind, ringtoneId: item.metadata.ringtoneId || "builtin-soft" }]);
        notify(entry.message === "Your alarm is ringing." ? `Alarm: ${item.title}` : `Reminder: ${item.title}`);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") { try { new Notification(kind === "alarm" ? `Alarm: ${item.title}` : `Reminder: ${item.title}`, { body: item.metadata.todoDetails || (kind === "alarm" ? "Your Persora alarm is due." : "Your Persora reminder is due.") }); } catch { /* The in-app notification remains available. */ } }
      }
      if (newlyFired.length) { try { localStorage.setItem(`persora-fired-schedules:${user.id}`, JSON.stringify(fired.slice(-500))); } catch { /* In-app dedupe is best-effort. */ } }
    };
    checkSchedules();
    const timer = window.setInterval(checkSchedules, 15000);
    return () => window.clearInterval(timer);
  }, [user?.id, items]);

  const handleTogglePin = async (item: VaultItem, pinned: boolean) => {
    const updated = { ...item, pinned, updatedAt: new Date().toISOString() };
    if (user?.demo) {
      const next = items.map((entry) => entry.id === item.id ? updated : entry);
      setItems(next); putLocalItems(next); return;
    }
    if (!user) return;
    try {
      const saved = await saveVaultItem(updated);
      setItems((current) => current.map((entry) => entry.id === item.id ? saved : entry));
      setSharedByMe((current) => current.map((entry) => entry.item.id === saved.id ? { ...entry, item: saved } : entry));
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update note pin.", "error"); }
  };

  const handleSaveContact = async (draft: ContactDraft, onUploadProgress?: (progress: TransferProgress) => void) => {
    if (!user) throw new Error("Please sign in before saving contacts.");
    const existing = draft.id ? contactsRef.current.find((contact) => contact.id === draft.id) : undefined;
    const photoFile = draft.photoFile || null;
    if (user.demo) {
      const photoDataUrl = draft.clearPhoto ? undefined : photoFile ? await contactPhotoDataUrl(photoFile) : draft.photoDataUrl || existing?.photoDataUrl;
      const now = new Date().toISOString();
      const saved: PersoraContact = {
        id: draft.id || createId(), name: draft.name.trim(), phoneNumbers: draft.phoneNumbers, email: draft.email.trim(),
        company: draft.company.trim(), jobTitle: draft.jobTitle.trim(), address: draft.address.trim(), birthday: draft.birthday,
        notes: draft.notes.trim(), category: draft.category, favorite: Boolean(draft.favorite),
        ...(photoDataUrl ? { photoDataUrl } : {}), ...(draft.folderId ? { folderId: draft.folderId } : {}), createdAt: existing?.createdAt || now, updatedAt: now,
      };
      const current = contactsRef.current;
      const next = existing ? current.map((contact) => contact.id === saved.id ? saved : contact) : [saved, ...current];
      commitContacts(next); putLocalContacts(user.id, next);
      return saved;
    }
    if (!isPagesApiConfigured) throw new Error("Contact sync is unavailable until the Persora cloud API is enabled.");
    let photoKey = draft.clearPhoto ? undefined : draft.photoKey || existing?.photoKey;
    let uploadedKey = "";
    if (photoFile) {
      const uploaded = await uploadVaultFile(photoFile, onUploadProgress);
      photoKey = uploaded.key;
      uploadedKey = uploaded.key || "";
    }
    try {
      const saved = await saveContactRecord({
        ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), phoneNumbers: draft.phoneNumbers, email: draft.email.trim(),
        company: draft.company.trim(), jobTitle: draft.jobTitle.trim(), address: draft.address.trim(), birthday: draft.birthday,
        notes: draft.notes.trim(), category: draft.category, favorite: Boolean(draft.favorite), photoKey, folderId: draft.folderId,
      });
      const current = contactsRef.current;
      const next = existing ? current.map((contact) => contact.id === saved.id ? saved : contact) : [saved, ...current];
      commitContacts(next);
      return saved;
    } catch (error) {
      if (uploadedKey) { try { await deleteVaultFile(uploadedKey); } catch { /* Clean up orphaned photo later if this fails. */ } }
      throw error;
    }
  };

  const handleDeleteContact = async (contact: PersoraContact) => {
    if (!user) throw new Error("Please sign in before deleting contacts.");
    if (!user.demo) await deleteContactRecord(contact.id);
    const next = contactsRef.current.filter((entry) => entry.id !== contact.id);
    commitContacts(next);
    if (user.demo) putLocalContacts(user.id, next);
  };

  const handleMergeContacts = async (primaryId: string, duplicateIds: string[]) => {
    if (!user) throw new Error("Please sign in before merging contacts.");
    if (!user.demo) {
      const saved = await mergeContactRecords(primaryId, duplicateIds);
      const removeIds = new Set(duplicateIds);
      commitContacts(contactsRef.current.filter((contact) => !removeIds.has(contact.id) && contact.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name)));
      return;
    }
    const groupIds = new Set([primaryId, ...duplicateIds]);
    const group = contactsRef.current.filter((contact) => groupIds.has(contact.id));
    const primary = group.find((contact) => contact.id === primaryId);
    if (!primary) throw new Error("The contact to keep could not be found.");
    const phones = new Map<string, PersoraContact["phoneNumbers"][number]>();
    group.forEach((contact) => contact.phoneNumbers.forEach((phone) => { const key = phone.number.replace(/\D/g, ""); if (key && !phones.has(key)) phones.set(key, phone); }));
    const merged: PersoraContact = {
      ...primary, phoneNumbers: [...phones.values()], email: primary.email || group.find((contact) => contact.email)?.email || "",
      company: primary.company || group.find((contact) => contact.company)?.company || "",
      jobTitle: primary.jobTitle || group.find((contact) => contact.jobTitle)?.jobTitle || "",
      address: primary.address || group.find((contact) => contact.address)?.address || "",
      birthday: primary.birthday || group.find((contact) => contact.birthday)?.birthday || "",
      notes: [...new Set(group.filter((contact) => contact.notes.trim()).map((contact) => contact.id === primary.id ? contact.notes.trim() : `${contact.name}: ${contact.notes.trim()}`))].join("\n\n"),
      photoKey: primary.photoKey || group.find((contact) => contact.photoKey)?.photoKey,
      photoDataUrl: primary.photoDataUrl || group.find((contact) => contact.photoDataUrl)?.photoDataUrl,
      favorite: group.some((contact) => contact.favorite), updatedAt: new Date().toISOString(),
    };
    const next = [merged, ...contactsRef.current.filter((contact) => !groupIds.has(contact.id))];
    commitContacts(next); putLocalContacts(user.id, next);
  };

  const handleImportContacts = async (drafts: ContactDraft[], onProgress?: (progress: ContactImportProgress) => void) => {
    if (!drafts.length) throw new Error("No contacts were selected for import.");
    const imported: PersoraContact[] = [];
    const startedAt = performance.now();
    const emitProgress = (completed: number, fraction: number, currentName: string) => {
      const elapsed = Math.max(0.1, (performance.now() - startedAt) / 1000);
      const safeFraction = Math.max(0, Math.min(1, fraction));
      const rate = safeFraction / elapsed;
      onProgress?.({ completed, total: drafts.length, percent: Math.round(safeFraction * 100), remainingSeconds: rate > 0 ? Math.max(0, (1 - safeFraction) / rate) : null, currentName });
    };
    emitProgress(0, 0, drafts[0]?.name || "");
    for (let index = 0; index < drafts.length; index++) {
      const draft = drafts[index];
      const photoProgress = (progress: TransferProgress) => emitProgress(index, (index + progress.percent / 100) / drafts.length, draft.name);
      imported.push(await handleSaveContact({ ...draft, id: undefined }, photoProgress));
      const completed = index + 1;
      emitProgress(completed, completed / drafts.length, drafts[completed]?.name || "");
    }
    return imported;
  };

  const handleRefreshContacts = async () => {
    if (!user) throw new Error("Sign in to sync your contacts.");
    if (user.demo) { commitContacts(getLocalContacts(user.id)); return; }
    const rows = await loadContacts(); commitContacts(rows);
  };

  const handleSaveBusinessCard = async (draft: BusinessCardDraft, onUploadProgress?: (progress: TransferProgress) => void): Promise<DigitalBusinessCard> => {
    if (!user) throw new Error("Please sign in before saving a business card.");
    const existing = draft.id ? businessCardsRef.current.find((card) => card.id === draft.id) : undefined;
    const profileFile = draft.profilePhotoFile || null;
    const logoFile = draft.businessLogoFile || null;
    if (user.demo) {
      const profilePhotoDataUrl = draft.clearProfilePhoto ? undefined : profileFile ? await contactPhotoDataUrl(profileFile) : draft.profilePhotoDataUrl || existing?.profilePhotoDataUrl;
      const businessLogoDataUrl = draft.clearBusinessLogo ? undefined : logoFile ? await contactPhotoDataUrl(logoFile) : draft.businessLogoDataUrl || existing?.businessLogoDataUrl;
      const now = new Date().toISOString();
      const saved: DigitalBusinessCard = {
        id: draft.id || createId(), isPublic: false, style: draft.style || "garden", fullName: draft.fullName.trim(), jobTitle: draft.jobTitle.trim(), company: draft.company.trim(),
        phoneNumbers: draft.phoneNumbers, email: draft.email.trim(), websites: draft.websites, socialLinks: draft.socialLinks,
        address: draft.address.trim(), bio: draft.bio.trim(), customLinks: draft.customLinks,
        ...(profilePhotoDataUrl ? { profilePhotoDataUrl } : {}), ...(businessLogoDataUrl ? { businessLogoDataUrl } : {}),
        createdAt: existing?.createdAt || now, updatedAt: now, ...(draft.folderId ? { folderId: draft.folderId } : {}),
      };
      const current = businessCardsRef.current;
      const next = existing ? current.map((card) => card.id === saved.id ? saved : card) : [saved, ...current];
      commitBusinessCards(next); putLocalBusinessCards(user.id, next); return saved;
    }
    if (!isPagesApiConfigured) throw new Error("Connect the Persora cloud API before saving or publishing business cards.");
    let profilePhotoKey = draft.clearProfilePhoto ? undefined : draft.profilePhotoKey || existing?.profilePhotoKey;
    let businessLogoKey = draft.clearBusinessLogo ? undefined : draft.businessLogoKey || existing?.businessLogoKey;
    const uploadedKeys: string[] = [];
    const files = [profileFile, logoFile].filter((file): file is File => Boolean(file));
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    const start = performance.now(); let completedBytes = 0;
    const uploadCardImage = async (file: File) => {
      const uploaded = await uploadVaultFile(file, (part) => {
        const loaded = completedBytes + part.loaded; const elapsed = Math.max(0.1, (performance.now() - start) / 1000); const rate = loaded / elapsed;
        onUploadProgress?.({ loaded, total: totalBytes, percent: totalBytes ? Math.round(loaded / totalBytes * 100) : 0, remainingSeconds: rate ? Math.max(0, (totalBytes - loaded) / rate) : null });
      });
      if (!uploaded.key) throw new Error("The uploaded card image did not return a storage key.");
      completedBytes += file.size; uploadedKeys.push(uploaded.key);
      return uploaded.key;
    };
    try {
      if (profileFile) profilePhotoKey = await uploadCardImage(profileFile);
      if (logoFile) businessLogoKey = await uploadCardImage(logoFile);
      const payload: BusinessCardDraft = {
        ...draft, profilePhotoKey, businessLogoKey,
        profilePhotoDataUrl: undefined, businessLogoDataUrl: undefined,
        profilePhotoFile: undefined, businessLogoFile: undefined,
      };
      const saved = await saveBusinessCard(payload);
      const current = businessCardsRef.current;
      const next = existing ? current.map((card) => card.id === saved.id ? saved : card) : [saved, ...current];
      commitBusinessCards(next); return saved;
    } catch (error) {
      for (const key of uploadedKeys) { try { await deleteVaultFile(key); } catch { /* Orphaned upload cleanup can be retried. */ } }
      throw error;
    }
  };

  const handleDeleteBusinessCard = async (card: DigitalBusinessCard) => {
    if (!user) throw new Error("Please sign in before deleting business cards.");
    if (!user.demo) await deleteBusinessCard(card.id);
    const next = businessCardsRef.current.filter((entry) => entry.id !== card.id);
    commitBusinessCards(next);
    if (user.demo) putLocalBusinessCards(user.id, next);
  };

  const handleRefreshBusinessCards = async () => {
    if (!user) throw new Error("Sign in to sync your business cards.");
    if (user.demo) { commitBusinessCards(getLocalBusinessCards(user.id)); return; }
    const rows = await loadBusinessCards(); commitBusinessCards(rows);
  };

  const handleSaveMedicalRecord = async (draft: MedicalRecordDraft): Promise<MedicalRecord> => {
    if (!user) throw new Error("Sign in before adding medical records.");
    const existing = draft.id ? medicalRecordsRef.current.find((record) => record.id === draft.id) : undefined;
    if (user.demo) {
      const id = draft.id || createId();
      const now = new Date().toISOString();
      let file: MedicalRecordFile | undefined = draft.removeFile ? undefined : draft.file || existing?.file;
      if (draft.fileUpload) {
        demoMedicalFiles.current.set(id, draft.fileUpload);
        file = { name: draft.fileUpload.name, size: draft.fileUpload.size, type: draft.fileUpload.type || "application/octet-stream", localOnly: true };
      } else if (draft.removeFile) demoMedicalFiles.current.delete(id);
      const saved: MedicalRecord = {
        id, title: draft.title.trim(), recordType: draft.recordType, recordDate: draft.recordDate,
        provider: draft.provider, hospital: draft.hospital, specialty: draft.specialty, notes: draft.notes,
        diagnosis: draft.diagnosis, testName: draft.testName, testResult: draft.testResult, medicationNotes: draft.medicationNotes,
        followUpDate: draft.followUpDate, ...(draft.relatedReminderId ? { relatedReminderId: draft.relatedReminderId } : {}),
        ...(file ? { file } : {}), links: draft.links.filter((link) => link.linkKind !== "reminder"), ...(draft.folderId ? { folderId: draft.folderId } : {}), createdAt: existing?.createdAt || now, updatedAt: now,
      };
      const next = existing ? medicalRecordsRef.current.map((record) => record.id === saved.id ? saved : record) : [saved, ...medicalRecordsRef.current];
      commitMedicalRecords(next); return saved;
    }
    if (!isPagesApiConfigured) throw new Error("Medical record storage is unavailable until the Persora cloud API is enabled.");
    let uploadedKey = "";
    let file = draft.removeFile ? undefined : draft.file || existing?.file;
    try {
      if (draft.fileUpload) { file = await uploadMedicalRecordFile(draft.fileUpload); uploadedKey = file.key || ""; }
      const saved = await saveMedicalRecord({ ...draft, file, fileUpload: undefined, removeFile: Boolean(draft.removeFile) });
      const next = existing ? medicalRecordsRef.current.map((record) => record.id === saved.id ? saved : record) : [saved, ...medicalRecordsRef.current];
      commitMedicalRecords(next); return saved;
    } catch (error) {
      if (uploadedKey) { try { await deleteUnattachedMedicalRecordFile(uploadedKey); } catch { /* The upload can be removed later if saving is retried. */ } }
      throw error;
    }
  };

  const handleDeleteMedicalRecord = async (record: MedicalRecord) => {
    if (!user) throw new Error("Sign in before deleting medical records.");
    if (!user.demo) await deleteMedicalRecord(record.id);
    else demoMedicalFiles.current.delete(record.id);
    commitMedicalRecords(medicalRecordsRef.current.filter((entry) => entry.id !== record.id));
  };

  const handleRefreshMedicalRecords = async () => {
    if (!user) throw new Error("Sign in to sync medical records.");
    if (user.demo) return;
    commitMedicalRecords(await loadMedicalRecords());
  };

  const handleOpenMedicalRecordFile = async (record: MedicalRecord) => {
    if (user?.demo) {
      const file = demoMedicalFiles.current.get(record.id);
      if (!file) { notify("This demo attachment is no longer available after refreshing the page.", "error"); return; }
      const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); return;
    }
    try { await downloadMedicalRecordFile(record.id); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't open the medical record file.", "error"); }
  };

  const handlePreviewMedicalRecordFile = async (record: MedicalRecord): Promise<{ blob: Blob; name: string }> => {
    if (user?.demo) {
      const file = demoMedicalFiles.current.get(record.id);
      if (!file) throw new Error("This demo attachment is no longer available after refreshing the page.");
      return { blob: file, name: file.name };
    }
    return fetchMedicalRecordFile(record.id);
  };

  const handleSaveTimelineEvent = async (draft: TimelineDraft) => {
    if (!user || user.demo || !isPagesApiConfigured) throw new Error("Encrypted timeline posts require a signed-in Persora cloud account.");
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the internet to post or edit a timeline event. Offline automatic dates are queued locally.");
    setTimelineSaving(true);
    let uploadedKey = "";
    try {
      let attachment = draft.removeAttachment ? undefined : draft.attachment;
      if (draft.attachmentFile) { attachment = await uploadTimelineAttachment(draft.attachmentFile); uploadedKey = attachment.key || ""; }
      const saved = await saveTimelineEvent({ ...draft, attachment, attachmentFile: undefined });
      setTimelineEvents((current) => [saved, ...current.filter((event) => event.id !== saved.id)]);
      notify(draft.id ? "Timeline event updated." : "Timeline event posted.");
    } catch (error) {
      if ((typeof navigator !== "undefined" && !navigator.onLine) || error instanceof TypeError) setTimelineOnline(false);
      if (uploadedKey) { try { await deleteVaultFile(uploadedKey); } catch { /* Private orphan cleanup can be retried. */ } }
      throw error;
    } finally { setTimelineSaving(false); }
  };
  const handleDeleteTimelineEvent = async (event: TimelineEvent) => {
    if (!user || user.demo || event.eventType !== "manual") throw new Error("Only manual posts in your cloud timeline can be deleted.");
    await deleteTimelineEvent(event.id);
    setTimelineEvents((current) => current.filter((entry) => entry.id !== event.id));
    notify("Timeline event deleted.");
  };

  const refreshSharing = async () => {
    if (!user || user.demo || !isPagesApiConfigured) return;
    const [outgoing, incoming, notifications, outgoingRecords, incomingRecords] = await Promise.all([loadSharedItems("outgoing"), loadSharedItems("incoming"), loadShareNotifications(), loadRecordShares("outgoing"), loadRecordShares("incoming")]);
    setSharedByMe(outgoing); setSharedWithMe(incoming); setShareNotifications(notifications); setRecordSharesByMe(outgoingRecords); setRecordSharesWithMe(incomingRecords);
  };
  const handleOpenSharedEntry = (entry: SharedVaultEntry) => {
    setFocusedItem({ ...entry.item, sharedAccess: { shareId: entry.shareId, permission: entry.permission, direction: entry.direction, owner: entry.owner, recipient: entry.recipient } });
  };
  const handleShareItem = (item: VaultItem) => {
    if (user?.demo || !isPagesApiConfigured) { notify("Sharing requires a signed-in Persora account with the cloud API enabled.", "error"); return; }
    setShareTarget(item);
  };
  const handleShareRecord = async (resourceType: "contact" | "business_card", resourceId: string, recipient: string) => {
    if (user?.demo || !isPagesApiConfigured) throw new Error("Sharing requires a signed-in Persora cloud account.");
    await createRecordShare(resourceType, resourceId, recipient);
    await refreshSharing();
    notify(`${resourceType === "contact" ? "Contact" : "Business card"} shared successfully.`);
  };
  const handleRevokeRecordShare = async (shareId: string) => {
    await revokeRecordShare(shareId);
    await refreshSharing();
    notify("Access to this record has been stopped.");
  };
  const handleCreateShare = async (recipient: string, permission: SharePermission) => {
    if (!shareTarget) return;
    await createDocumentShare(shareTarget.id, recipient, permission);
    await refreshSharing();
    notify("Document shared successfully.");
  };
  const handleChangeSharePermission = async (shareId: string, permission: SharePermission) => {
    await changeDocumentSharePermission(shareId, permission);
    await refreshSharing();
    notify("Sharing permission updated.");
  };
  const handleRevokeShare = async (shareId: string) => {
    await revokeDocumentShare(shareId);
    await refreshSharing();
    notify("Access to this document has been stopped.");
  };
  const handleMarkNotificationsRead = async () => {
    const now = new Date().toISOString();
    setLocalScheduleNotifications((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt || now })));
    setShareNotifications((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt || now })));
    if (!user || user.demo || !isPagesApiConfigured) return;
    try { await markShareNotificationsRead(); await refreshSharing(); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't update notifications.", "error"); }
  };
  const handleAddShareComment = async (body: string) => {
    const access = focusedItem?.sharedAccess;
    if (!access) throw new Error("Open a shared document to comment.");
    const comment = await addShareComment(access.shareId, body);
    setShareComments((current) => [...current, comment]);
  };

  useEffect(() => {
    const access = focusedItem?.sharedAccess;
    if (!access || !isPagesApiConfigured) { setShareComments([]); return; }
    let active = true;
    void loadShareComments(access.shareId).then((rows) => { if (active) setShareComments(rows); })
      .catch((error) => { if (active) { setShareComments([]); notify(error instanceof Error ? error.message : "Couldn't load comments.", "error"); } });
    return () => { active = false; };
  }, [focusedItem?.sharedAccess?.shareId]);

  useEffect(() => {
    const item = focusedItem;
    if (!item?.file) { setFilePreview(null); return; }
    let disposed = false;
    let previewUrl: string | undefined;
    setFilePreview({ status: "loading", name: item.file.name, type: item.file.type });
    const showError = (message: string, status: "error" | "unavailable" = "error") => {
      if (!disposed) setFilePreview({ status, name: item.file!.name, type: item.file!.type, message });
    };
    const fetchPreview = async () => {
      try {
        if (item.file!.localOnly) {
          const localUrl = localFiles.current.get(item.id);
          if (!localUrl) { showError("This sample attachment has no file bytes. Upload the real document to preview it.", "unavailable"); return; }
          if (!disposed) setFilePreview({ status: "ready", src: localUrl, name: item.file!.name, type: item.file!.type });
          return;
        }
        if (!isPagesApiConfigured) { showError("The private Pages API is not enabled."); return; }
        const { blob, name } = await fetchVaultFile(item.file!.key || "");
        previewUrl = URL.createObjectURL(blob);
        if (!disposed) setFilePreview({ status: "ready", src: previewUrl, name, type: blob.type || item.file!.type });
      } catch (error) { showError(error instanceof Error ? error.message : "This private attachment couldn't be opened."); }
    };
    void fetchPreview();
    return () => { disposed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [focusedItem?.id, focusedItem?.file?.key, focusedItem?.file?.name, focusedItem?.file?.type, focusedItem?.file?.localOnly]);

  const handleDownloadFile = async (item: VaultItem) => {
    if (!item.file) return;
    if (item.file.localOnly) {
      const localUrl = localFiles.current.get(item.id);
      if (!localUrl) { notify("This sample attachment does not contain a file to download.", "error"); return; }
      const anchor = document.createElement("a"); anchor.href = localUrl; anchor.download = item.file.name; anchor.click(); return;
    }
    if (!isPagesApiConfigured) { notify("The private Pages API is not enabled.", "error"); return; }
    try { await openVaultFile(item.file.key || ""); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't download this file.", "error"); }
  };

  const handleProfileSave = async (values: { fullName: string; timezone: string }) => {
    if (!user) return;
    if (!user.demo) await updateProfile(values);
    setUser((current) => current ? { ...current, fullName: values.fullName.trim(), timezone: values.timezone } : current);
    if (user.demo) putLocalProfile(`demo:${user.email}:${values.fullName.trim()}`);
  };

  const handlePasswordChange = async (currentPassword: string, newPassword: string) => {
    if (!user || user.demo) throw new Error("Password changes are unavailable in the demo workspace.");
    await updatePassword(currentPassword, newPassword);
  };

  const handleExport = () => {
    if (user && !user.demo && isPagesApiConfigured) {
      const anchor = document.createElement("a"); anchor.href = "/api/account/export"; anchor.download = `persora-export-${new Date().toISOString().slice(0, 10)}.tar`; anchor.click();
      notify("Your complete Persora export is being prepared, including your private file attachments.");
      return;
    }
    const payload = { format: "persora-complete-export-v1", exportedAt: new Date().toISOString(), account: { email: user?.email, fullName: user?.fullName }, data: { vaultItems: items, contacts, businessCards, medicalRecords } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `persora-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Your complete demo records have been downloaded as JSON.");
  };

  const handleImport = async (file: File) => {
    const raw = JSON.parse(await file.text()) as { format?: string; items?: unknown };
    if (!raw || raw.format !== "persora-export-v1" || !Array.isArray(raw.items)) throw new Error("Choose a valid Persora JSON backup.");
    if (!user) throw new Error("Please sign in before importing data.");
    const allowedSections = new Set(SECTION_DEFINITIONS.map((section) => section.id));
    const imported: VaultItem[] = raw.items.map((row) => {
      if (!row || typeof row !== "object") throw new Error("This backup contains an invalid record.");
      const candidate = row as Partial<VaultItem>;
      if (!candidate.section || !allowedSections.has(candidate.section) || typeof candidate.title !== "string" || !candidate.metadata || typeof candidate.metadata !== "object" || Array.isArray(candidate.metadata)) throw new Error("This backup contains an invalid record.");
      const metadata = Object.fromEntries(Object.entries(candidate.metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      return { id: createId(), section: candidate.section, title: candidate.title.slice(0, 240), subtitle: typeof candidate.subtitle === "string" ? candidate.subtitle : undefined, metadata, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), favorite: Boolean(candidate.favorite) };
    });
    if (user.demo) {
      const next = [...imported, ...items]; setItems(next); putLocalItems(next);
    } else {
      const saved: VaultItem[] = [];
      for (const item of imported) saved.push(await saveVaultItem(item));
      setItems((current) => [...saved, ...current]);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (user.demo) {
      putLocalProfile(null); putLocalItems([]); putLocalBusinessCards(user.id, []); setItems([]); setUser(null); commitBusinessCards([]); commitMedicalRecords([]); demoMedicalFiles.current.clear(); setSharedByMe([]); setSharedWithMe([]); setRecordSharesByMe([]); setRecordSharesWithMe([]); setShareNotifications([]); setView("dashboard");
      notify("Your demo account has been cleared from this browser."); return;
    }
    if (!isPagesApiConfigured) throw new Error("The private Pages API is not enabled. Ask an administrator to finish setup.");
    await deleteOwnAccount();
    setUser(null); setItems([]); commitBusinessCards([]); commitMedicalRecords([]); demoMedicalFiles.current.clear(); setSharedByMe([]); setSharedWithMe([]); setRecordSharesByMe([]); setRecordSharesWithMe([]); setShareNotifications([]); setView("dashboard");
    notify("Your Persora account has been deleted.");
  };

  const handleChoosePlan = (planId: string) => {
    setPendingPlanId(planId);
    openAuth("signup");
  };
  const navigateWorkspace = (next: ViewId) => {
    setView(next);
    if (next === "shared") void refreshSharing().catch((error) => notify(error instanceof Error ? error.message : "Couldn't refresh shared documents.", "error"));
    if (next === "contacts") void handleRefreshContacts().catch((error) => notify(error instanceof Error ? error.message : "Couldn't sync contacts.", "error"));
    if (next === "business-card") void handleRefreshBusinessCards().catch((error) => notify(error instanceof Error ? error.message : "Couldn't sync business cards.", "error"));
    if (next === "medical-records") void handleRefreshMedicalRecords().catch((error) => notify(error instanceof Error ? error.message : "Couldn't sync medical records.", "error"));
    if (pathname !== "/") goToPath("/");
  };
  const navigateAdmin = () => goToPath("/admin");
  const backToVault = () => { goToPath("/"); setView("dashboard"); };
  const openHomeFromPublicPage = () => { goToPath("/"); if (user) setView("dashboard"); };
  const openContactPage = () => goToPath("/contact");
  const handleBootstrapComplete = async () => {
    setBootstrapStatus({ initialized: true, enabled: true });
    const profile = await getCurrentUser();
    if (profile) setUser(profile);
  };

  const renderLanding = () => <LandingPage
    onSignIn={() => openAuth("signin")}
    onGetStarted={() => openAuth("signup")}
    onDemo={completeDemo}
    plans={publicPlans}
    billingEnabled={billingEnabled}
    maxUploadMb={maxUploadMb}
    onChoosePlan={handleChoosePlan}
  />;

  const realUser = user?.demo ? null : user;
  return <>
    {publicCardId ? <PublicBusinessCardPage cardId={publicCardId}/> : authRestoring || siteContentLoading ? <PersoraBootScreen /> : adminRoute ? realUser?.role === "admin" ? <Suspense fallback={<PersoraBootScreen />}><AdminConsole user={realUser} onBackToVault={backToVault} onSignOut={() => void handleSignOut()} notify={notify} /></Suspense> : <Suspense fallback={<PersoraBootScreen />}><AdminAccessPage
      user={realUser}
      status={bootstrapStatus}
      backendConnected={isPagesApiConfigured}
      pagesApiConnected={isPagesApiConfigured}
      onOpenAuth={openAuth}
      onBootstrapComplete={handleBootstrapComplete}
      onBack={backToVault}
      onSignOut={() => void handleSignOut()}
    /></Suspense> : publicPage ? <PublicInfoPage page={publicPage} content={siteContent} signedIn={Boolean(user)} onHome={openHomeFromPublicPage} onSignIn={() => openAuth("signin")} /> : user ? <Workspace
      user={user}
      items={items}
      sharedByMe={sharedByMe}
      sharedWithMe={sharedWithMe}
      recordSharesByMe={recordSharesByMe}
      recordSharesWithMe={recordSharesWithMe}
      contacts={contacts}
      businessCards={businessCards}
      notifications={[...localScheduleNotifications, ...shareNotifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      ringingSchedules={ringingSchedules}
      sharingAvailable={!user.demo && isPagesApiConfigured}
      timelineEvents={displayTimelineEvents}
      timelineOnline={timelineOnline}
      timelineSaving={timelineSaving}
      onSaveTimelineEvent={handleSaveTimelineEvent}
      onDeleteTimelineEvent={handleDeleteTimelineEvent}
      onOpenTimelineAttachment={(event) => { void downloadTimelineAttachment(event.id).catch((error) => notify(error instanceof Error ? error.message : "Couldn't open timeline attachment.", "error")); }}
      medicalRecords={medicalRecords}
      maxUploadMb={maxUploadMb}
      onSaveMedicalRecord={handleSaveMedicalRecord}
      onDeleteMedicalRecord={handleDeleteMedicalRecord}
      onOpenMedicalRecordFile={(record) => { void handleOpenMedicalRecordFile(record); }}
      onPreviewMedicalRecordFile={handlePreviewMedicalRecordFile}
      onRefreshMedicalRecords={handleRefreshMedicalRecords}
      view={view}
      search={search}
      pendingPlanId={pendingPlanId}
      onSearch={setSearch}
      onNavigate={navigateWorkspace}
      onAdd={(section) => { setEditor({ section }); setFocusedItem(null); }}
      onAddTodo={(kind = "todo") => { setTodoEditorType(kind); setTodoEditor(null); setFocusedItem(null); }}
      onEditTodoItem={(item) => { const type = item.metadata.recordType; setTodoEditorType(type === "reminder" || type === "alarm" ? type : "todo"); setTodoEditor(item); setFocusedItem(null); }}
      onToggleTodo={handleToggleTodo}
      onToggleSchedule={handleToggleSchedule}
      onDismissSchedule={handleDismissSchedule}
      onSnoozeSchedule={handleSnoozeSchedule}
      onOpenItem={(item) => setFocusedItem(item)}
      onEditItem={(item) => { setFocusedItem(null); const kind = item.metadata.recordType; if (item.section === "notes" && ["todo", "reminder", "alarm"].includes(kind || "")) { setTodoEditorType(kind === "reminder" || kind === "alarm" ? kind : "todo"); setTodoEditor(item); } else setEditor({ section: item.section, item }); }}
      onDeleteItem={(item) => setDeleteTarget(item)}
      onShareItem={handleShareItem}
      onOpenSharedEntry={handleOpenSharedEntry}
      onChangeSharePermission={handleChangeSharePermission}
      onRevokeShare={handleRevokeShare}
      onShareRecord={handleShareRecord}
      onRevokeRecordShare={handleRevokeRecordShare}
      onMarkNotificationsRead={() => void handleMarkNotificationsRead()}
      onToggleFavorite={handleToggleFavorite}
      onTogglePin={handleTogglePin}
      onMoveVaultItem={handleMoveVaultItem}
      onSaveContact={handleSaveContact}
      onDeleteContact={handleDeleteContact}
      onMergeContacts={handleMergeContacts}
      onImportContacts={handleImportContacts}
      onRefreshContacts={handleRefreshContacts}
      onSaveBusinessCard={handleSaveBusinessCard}
      onDeleteBusinessCard={handleDeleteBusinessCard}
      onRefreshBusinessCards={handleRefreshBusinessCards}
      onSignOut={() => void handleSignOut()}
      onOpenAdmin={navigateAdmin}
      onOpenPublicPage={goToPath}
      onOpenContact={openContactPage}
      onProfileSave={handleProfileSave}
      onPasswordChange={handlePasswordChange}
      onExport={handleExport}
      onImport={handleImport}
      onDeleteAccount={handleDeleteAccount}
      notify={notify}
    /> : renderLanding()}
    {authOpen && <AuthDialog
      initialMode={authMode}
      connected={isPagesApiConfigured}
      variant={adminRoute ? "admin" : "user"}
      busy={authBusy}
      onClose={() => setAuthOpen(false)}
      onSubmit={handleAuthSubmit}
    />}
    {editor && user && <ItemEditorDialog sectionId={editor.section} item={editor.item} documentTypes={documentTypes} maxUploadMb={maxUploadMb} onClose={() => setEditor(null)} onSave={handleSaveItem} />}
    {todoEditor !== false && user && <TodoEditorDialog key={`${todoEditorType}:${todoEditor?.id || "new"}`} kind={todoEditorType} item={todoEditor || undefined} onClose={() => setTodoEditor(false)} onSave={async (draft) => { await handleSaveItem(draft); setTodoEditor(false); }} />}
    {focusedItem && <ItemDetailDialog
      item={focusedItem}
      filePreview={filePreview}
      shareAccess={focusedItem.sharedAccess}
      comments={shareComments}
      onAddComment={handleAddShareComment}
      onManageSharing={() => setShareTarget(focusedItem)}
      onClose={() => setFocusedItem(null)}
      onEdit={() => { const selected = focusedItem; setFocusedItem(null); const kind = selected.metadata.recordType; if (selected.section === "notes" && ["todo", "reminder", "alarm"].includes(kind || "")) { setTodoEditorType(kind === "reminder" || kind === "alarm" ? kind : "todo"); setTodoEditor(selected); } else setEditor({ section: selected.section, item: selected }); }}
      onDownloadFile={() => void handleDownloadFile(focusedItem)}
    />}
    {shareTarget && <ShareManagementDialog
      item={shareTarget}
      shares={sharedByMe.filter((entry) => entry.item.id === shareTarget.id)}
      available={!user?.demo && isPagesApiConfigured}
      onShare={handleCreateShare}
      onPermissionChange={handleChangeSharePermission}
      onRevoke={handleRevokeShare}
      onClose={() => setShareTarget(null)}
    />}
    {deleteTarget && <ConfirmDialog title="Remove this from your vault?" confirmLabel="Delete record" onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDeleteItem()}>
      <p><b>{deleteTarget.title}</b> will be removed from your Persora vault. This can't be undone.</p>
    </ConfirmDialog>}
    {toast && <ToastNotice key={toast.id} message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
  </>;
}
