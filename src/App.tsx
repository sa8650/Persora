import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { DEMO_USER, SECTION_BY_ID, SECTION_DEFINITIONS } from "./data";
import LandingPage from "./components/LandingPage";
import AuthDialog, { type AuthMode } from "./components/AuthDialog";
import Workspace from "./components/Workspace";
import AdminConsole from "./components/AdminConsole";
import AdminAccessPage from "./components/AdminAccessPage";
import PublicInfoPage from "./components/PublicInfoPage";
import { ConfirmDialog, ItemDetailDialog, ItemEditorDialog, ToastNotice } from "./components/VaultDialogs";
import type { AppUser, DocumentTypeOption, SectionId, SiteContent, SubscriptionPlan, VaultFilePreview, VaultItem, ViewId } from "./types";
import { DEFAULT_SITE_CONTENT } from "./data/siteContent";
import {
  deleteOwnAccount,
  deleteVaultFile,
  fetchVaultFile,
  isPagesApiConfigured,
  loadVaultItems,
  removeVaultItem,
  saveVaultItem,
  updateProfile,
  updatePassword,
  uploadVaultFile,
  openVaultFile,
} from "./lib/backend";
import { loadAdminBootstrapStatus, loadDocumentTypes, loadPublicPlans, loadPublicSiteContent } from "./lib/cloud";
import { signIn, signOut, signUp, getCurrentUser } from "./lib/auth";
import { getLocalItems, getLocalProfile, putLocalItems, putLocalProfile } from "./lib/local-store";

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

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authRestoring, setAuthRestoring] = useState(true);
  const [siteContent, setSiteContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [siteContentPath, setSiteContentPath] = useState(isPagesApiConfigured ? "" : "/");
  const [items, setItems] = useState<VaultItem[]>(() => getLocalItems());
  const [view, setView] = useState<ViewId>("dashboard");
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [authBusy, setAuthBusy] = useState(false);
  const [editor, setEditor] = useState<{ section: SectionId; item?: VaultItem } | null>(null);
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
  const publicPage = PUBLIC_PATHS[pathname];
  const siteContentLoading = Boolean(publicPage && isPagesApiConfigured && siteContentPath !== pathname);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind, id: Date.now() + Math.floor(Math.random() * 1000) });
  }, []);

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
    const loadedItems = await loadVaultItems();
    setUser(profile);
    setItems(loadedItems);
    setView(pendingPlanId ? "billing" : "dashboard");
    setAuthOpen(false);
    setSearch("");
  }, [pendingPlanId]);

  useEffect(() => {
    let active = true;
    const restoreLocalDemo = () => {
      const remembered = getLocalProfile();
      if (!remembered) { setItems(getLocalItems()); return; }
      if (remembered.startsWith("demo:")) {
        const [, email, fullName] = remembered.split(":");
        setUser({ ...DEMO_USER, id: `demo-${email}`, email, fullName: fullName || DEMO_USER.fullName, role: "user" });
      } else if (remembered === DEMO_USER.email) {
        setUser(DEMO_USER);
      }
      setItems(getLocalItems());
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
    setView("dashboard");
    setSearch("");
    setAuthOpen(false);
    setEditor(null);
    setFocusedItem(null);
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
    setView("dashboard");
    setEditor(null);
    setFocusedItem(null);
    setFilePreview(null);
    setSearch("");
    notify("You've signed out.");
  };

  const handleSaveItem = async (draft: EditorDraft) => {
    if (!user) throw new Error("Please sign in before adding a record.");
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
        nextFile = await uploadVaultFile(draft.fileUpload);
        uploadedFileKey = nextFile.key;
      }
    } else if (oldItem?.file?.key && !draft.file) {
      localUrlToRevoke = localFiles.current.get(id);
    }

    const candidate: VaultItem = {
      id, section: draft.section, title: draft.title.trim(), subtitle: draft.subtitle,
      metadata: draft.metadata, file: nextFile, favorite: Boolean(draft.favorite),
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
    const payload = { format: "persora-export-v1", exportedAt: new Date().toISOString(), owner: user?.email, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `persora-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    URL.revokeObjectURL(url);
    notify("Your Persora backup has been downloaded.");
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
      putLocalProfile(null); putLocalItems([]); setItems([]); setUser(null); setView("dashboard");
      notify("Your demo account has been cleared from this browser."); return;
    }
    if (!isPagesApiConfigured) throw new Error("The private Pages API is not enabled. Ask an administrator to finish setup.");
    await deleteOwnAccount();
    setUser(null); setItems([]); setView("dashboard");
    notify("Your Persora account has been deleted.");
  };

  const handleChoosePlan = (planId: string) => {
    setPendingPlanId(planId);
    openAuth("signup");
  };
  const navigateWorkspace = (next: ViewId) => {
    setView(next);
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
    {authRestoring || siteContentLoading ? <AppBootScreen /> : adminRoute ? realUser?.role === "admin" ? <AdminConsole user={realUser} onBackToVault={backToVault} onSignOut={() => void handleSignOut()} notify={notify} /> : <AdminAccessPage
      user={realUser}
      status={bootstrapStatus}
      backendConnected={isPagesApiConfigured}
      pagesApiConnected={isPagesApiConfigured}
      onOpenAuth={openAuth}
      onBootstrapComplete={handleBootstrapComplete}
      onBack={backToVault}
      onSignOut={() => void handleSignOut()}
    /> : publicPage ? <PublicInfoPage page={publicPage} content={siteContent} signedIn={Boolean(user)} onHome={openHomeFromPublicPage} onSignIn={() => openAuth("signin")} /> : user ? <Workspace
      user={user}
      items={items}
      view={view}
      search={search}
      pendingPlanId={pendingPlanId}
      onSearch={setSearch}
      onNavigate={navigateWorkspace}
      onAdd={(section) => { setEditor({ section }); setFocusedItem(null); }}
      onOpenItem={(item) => setFocusedItem(item)}
      onEditItem={(item) => { setFocusedItem(null); setEditor({ section: item.section, item }); }}
      onDeleteItem={(item) => setDeleteTarget(item)}
      onToggleFavorite={handleToggleFavorite}
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
      busy={authBusy}
      onClose={() => setAuthOpen(false)}
      onSubmit={handleAuthSubmit}
    />}
    {editor && user && <ItemEditorDialog sectionId={editor.section} item={editor.item} documentTypes={documentTypes} maxUploadMb={maxUploadMb} onClose={() => setEditor(null)} onSave={handleSaveItem} />}
    {focusedItem && <ItemDetailDialog
      item={focusedItem}
      filePreview={filePreview}
      onClose={() => setFocusedItem(null)}
      onEdit={() => { const selected = focusedItem; setFocusedItem(null); setEditor({ section: selected.section, item: selected }); }}
      onDownloadFile={() => void handleDownloadFile(focusedItem)}
    />}
    {deleteTarget && <ConfirmDialog title="Remove this from your vault?" confirmLabel="Delete record" onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDeleteItem()}>
      <p><b>{deleteTarget.title}</b> will be removed from your Persora vault. This can't be undone.</p>
    </ConfirmDialog>}
    {toast && <ToastNotice key={toast.id} message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
  </>;
}

function AppBootScreen() {
  return <main className="app-boot-screen" role="status" aria-live="polite"><span className="app-boot-mark"><ShieldCheck size={24}/></span><b>Persora</b><span>Restoring your private workspace…</span><i/></main>;
}
