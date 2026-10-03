import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Activity, AlarmClock, ArrowRight, ArrowUpRight, AtSign, Bell, BellRing, BookOpen, BriefcaseBusiness, Building2, CalendarClock, Check, ChevronRight, Cloud, Code2, ContactRound, Film, Folder, Gamepad2, Globe2, HeartPulse,
  CircleHelp, Clock3, CreditCard, FileText, Fingerprint, Heart, Home, LayoutGrid, Link2, List, Music2, Pin, Play, Search, ShoppingBag, Share2,
  LockKeyhole, LogOut, MoreHorizontal, Plus, Settings, ShieldCheck, Trash2,
  Sparkles, UploadCloud, UserRound, UsersRound, WalletCards, X, type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, SECTION_BY_ID } from "../data";
import type { ActiveScheduleAlert, AppUser, BusinessCardDraft, BusinessSocialPlatform, ContactDraft, ContactImportProgress, DigitalBusinessCard, MedicalRecord, MedicalRecordDraft, NotesRecordKind, PersoraContact, SectionDefinition, SectionId, ShareComment, ShareNotification, SharePermission, SharedVaultEntry, RecordShareEntry, TimelineDraft, TimelineEvent, TransferProgress, VaultFilePreview, VaultFolder, VaultItem, ViewId } from "../types";
import { daysUntil, formatDate, humanSize, initials, notePlainText } from "../lib/utils";
import { BlurFade, MagicCard } from "./magic-ui";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";
import SearchModal, { type SearchFile, type SearchResult, type SearchTag, type QuickAction } from "./SearchModal";
import VaultFolderShelf from "./VaultFolderShelf";
import BillingView from "./BillingView";
import ContactsView from "./ContactsView";
import BusinessCardsView from "./BusinessCardsView";
import TimelineView from "./TimelineView";
import SocialBrandIcon from "./SocialBrandIcon";
import { alarmRingtoneAudioPath } from "../lib/cloud";
import { BUILTIN_RINGTONES, startBuiltinRingtone } from "../lib/ringtone";
import PersonalFinanceView from "./PersonalFinanceView";
import { ItemDetailDialog, ItemEditorDialog } from "./VaultDialogs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";

const MedicalRecordsView = lazy(() => import("./MedicalRecordsView"));

interface WorkspaceProps {
  user: AppUser;
  items: VaultItem[];
  sharedByMe: SharedVaultEntry[];
  sharedWithMe: SharedVaultEntry[];
  recordSharesByMe: RecordShareEntry[];
  recordSharesWithMe: RecordShareEntry[];
  contacts: PersoraContact[];
  businessCards: DigitalBusinessCard[];
  notifications: ShareNotification[];
  ringingSchedules: ActiveScheduleAlert[];
  sharingAvailable: boolean;
  timelineEvents: TimelineEvent[];
  timelineOnline: boolean;
  timelineSaving: boolean;
  onSaveTimelineEvent: (draft: TimelineDraft) => Promise<void>;
  onDeleteTimelineEvent: (event: TimelineEvent) => Promise<void>;
  onOpenTimelineAttachment: (event: TimelineEvent) => void;
  medicalRecords: MedicalRecord[];
  maxUploadMb: number;
  onSaveMedicalRecord: (draft: MedicalRecordDraft) => Promise<MedicalRecord>;
  onDeleteMedicalRecord: (record: MedicalRecord) => Promise<void>;
  onOpenMedicalRecordFile: (record: MedicalRecord) => void;
  onPreviewMedicalRecordFile: (record: MedicalRecord) => Promise<{ blob: Blob; name: string }>;
  onRefreshMedicalRecords: () => Promise<void>;
  view: ViewId;
  search: string;
  pendingPlanId?: string;
  documentEditor: { section: SectionId; item?: VaultItem; initialMetadata?: Record<string, string> } | null;
  documentFocusedItem: VaultItem | null;
  documentFilePreview: VaultFilePreview | null;
  documentTypes: string[];
  documentComments: ShareComment[];
  onCloseDocumentPanel: () => void;
  onManageDocumentSharing: (item: VaultItem) => void;
  onAddDocumentComment: (body: string) => Promise<void>;
  onDownloadDocumentFile: (item: VaultItem) => void;
  onSearch: (value: string) => void;
  onNavigate: (view: ViewId) => void;
  onAdd: (section: SectionId, initialMetadata?: Record<string, string>) => void;
  onSaveItem: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null }, onProgress?: (progress: TransferProgress) => void) => Promise<void>;
  onAddTodo: (kind: NotesRecordKind) => void;
  onEditTodoItem: (item: VaultItem) => void;
  onToggleTodo: (item: VaultItem, completed: boolean) => void;
  onToggleSchedule: (item: VaultItem, enabled: boolean) => void;
  onDismissSchedule: (alert: ActiveScheduleAlert) => void;
  onSnoozeSchedule: (alert: ActiveScheduleAlert) => void;
  onOpenItem: (item: VaultItem) => void;
  onEditItem: (item: VaultItem) => void;
  onDeleteItem: (item: VaultItem) => void;
  onShareItem: (item: VaultItem) => void;
  onOpenSharedEntry: (entry: SharedVaultEntry) => void;
  onChangeSharePermission: (shareId: string, permission: SharePermission) => Promise<void>;
  onRevokeShare: (shareId: string) => Promise<void>;
  onShareRecord: (resourceType: "contact" | "business_card", resourceId: string, recipient: string) => Promise<void>;
  onRevokeRecordShare: (shareId: string) => Promise<void>;
  onMarkNotificationsRead: () => void;
  onToggleFavorite: (item: VaultItem, favorite: boolean) => void;
  onTogglePin: (item: VaultItem, pinned: boolean) => void;
  onMoveVaultItem: (item: VaultItem, folderId: string | null) => Promise<void>;
  onSaveContact: (draft: ContactDraft, onProgress?: (progress: TransferProgress) => void) => Promise<PersoraContact>;
  onDeleteContact: (contact: PersoraContact) => Promise<void>;
  onMergeContacts: (primaryId: string, duplicateIds: string[]) => Promise<void>;
  onImportContacts: (drafts: ContactDraft[], onProgress?: (progress: ContactImportProgress) => void) => Promise<PersoraContact[]>;
  onRefreshContacts: () => Promise<void>;
  onSaveBusinessCard: (draft: BusinessCardDraft, onProgress?: (progress: TransferProgress) => void) => Promise<DigitalBusinessCard>;
  onDeleteBusinessCard: (card: DigitalBusinessCard) => Promise<void>;
  onRefreshBusinessCards: () => Promise<void>;
  onSignOut: () => void;
  onOpenAdmin: () => void;
  onOpenPublicPage: (path: "/privacy" | "/terms" | "/contact") => void;
  onOpenContact: () => void;
  onProfileSave: (values: { fullName: string; timezone: string; avatarUrl: string }) => Promise<void>;
  onPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

const viewInfo: Record<string, { title: string; eyebrow: string; icon: LucideIcon }> = {
  dashboard: { title: "Overview", eyebrow: "Your personal dashboard", icon: Home },
  settings: { title: "Settings", eyebrow: "Your account & preferences", icon: Settings },
  billing: { title: "Plans & billing", eyebrow: "Your storage subscription", icon: CreditCard },
  shared: { title: "Shared documents", eyebrow: "Documents shared with you and by you", icon: Share2 },
  timeline: { title: "Life Timeline", eyebrow: "Your private chronology", icon: CalendarClock },
  "medical-records": { title: "Medical Records", eyebrow: "Your private health archive", icon: HeartPulse },
  contacts: { title: "Contacts", eyebrow: "Your people, organized", icon: UsersRound },
  "business-card": { title: "Digital business cards", eyebrow: "Your digital identity", icon: BriefcaseBusiness },
};
const colors: Record<string, string> = { notes: "tag-yellow", documents: "tag-blue", academics: "tag-violet", subscriptions: "tag-orange", family: "tag-rose", purchases: "tag-blue", accounts: "tag-indigo", memberships: "tag-blue", "wallet-cards": "tag-blue", study: "tag-sky", "business-card": "tag-slate", urls: "tag-cyan", "personal-finance": "tag-blue" };
const SOCIAL_ACCOUNT_TYPES = new Set<BusinessSocialPlatform>(["Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "WhatsApp", "Telegram", "GitHub", "Pinterest"]);
function AccountTypeMark({ type }: { type: string }) {
  if (SOCIAL_ACCOUNT_TYPES.has(type as BusinessSocialPlatform)) return <SocialBrandIcon platform={type as BusinessSocialPlatform} size={17}/>;
  const Icon = type === "Google" || type === "Gmail" || type === "Email" ? AtSign
    : type === "Banking / payments" || type === "PayPal" ? CreditCard
      : type === "Shopping" || type === "Amazon" ? ShoppingBag
        : type === "Education" ? BookOpen
          : type === "Work" || type === "Freelance" || type === "Business" ? BriefcaseBusiness
            : type === "Cloud services" || type === "Microsoft" || type === "Apple" ? Cloud
              : type === "Developer" ? Code2
                : type === "Gaming" || type === "Discord" || type === "Reddit" ? Gamepad2
                  : type === "Streaming" || type === "Netflix" || type === "Spotify" ? Film
                    : type === "Government" ? Building2 : Globe2;
  return <Icon size={17}/>;
}
const getSection = (view: ViewId): SectionDefinition | null => view !== "business-card" && view in SECTION_BY_ID ? SECTION_BY_ID[view as SectionId] : null;
type ViewMode = "cards" | "list";
function readPageView(userId: string, pageId: string): ViewMode {
  try { return localStorage.getItem(`persora-view:${userId}:${pageId}`) === "list" ? "list" : "cards"; } catch { return "cards"; }
}
function usePageView(userId: string, pageId: string): [ViewMode, (mode: ViewMode) => void] {
  const key = `${userId}:${pageId}`;
  const [mode, setMode] = useState<ViewMode>(() => readPageView(userId, pageId));
  useEffect(() => { setMode(readPageView(userId, pageId)); }, [key]);
  const update = (next: ViewMode) => { setMode(next); try { localStorage.setItem(`persora-view:${userId}:${pageId}`, next); } catch { /* View preferences are a convenience; layout still changes this session. */ } };
  return [mode, update];
}
function ViewModeToggle({ mode, onChange, label }: { mode: ViewMode; onChange: (mode: ViewMode) => void; label: string }) {
  return <div className="view-mode-toggle" role="group" aria-label={label}>
    <button type="button" className={mode === "cards" ? "is-active" : ""} onClick={() => onChange("cards")} aria-label="Card view" aria-pressed={mode === "cards"} title="Card view"><LayoutGrid size={15}/></button>
    <button type="button" className={mode === "list" ? "is-active" : ""} onClick={() => onChange("list")} aria-label="List view" aria-pressed={mode === "list"} title="List view"><List size={16}/></button>
  </div>;
}
const greeting = (name: string) => `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}, ${name.split(" ")[0]}`;
const PROFILE_AVATAR_EMOJI = ["🌿", "✨", "🦋", "🌸", "⭐", "😊", "💙", "🧡", "🌊", "🎨", "🐱", "🚀"];
const PROFILE_AVATAR_DICEBEAR = [
  { id: "1", name: "Felix", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix" },
  { id: "2", name: "Aneka", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka" },
  { id: "3", name: "Oliver", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver" },
  { id: "4", name: "Zoe", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe" },
  { id: "5", name: "Leo", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Leo" },
  { id: "6", name: "Mia", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Mia" },
  { id: "7", name: "Noah", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Noah" },
  { id: "8", name: "Ava", image: "https://api.dicebear.com/7.x/adventurer/svg?seed=Ava" },
] as const;

function AccountAvatarContent({ user }: { user: AppUser }) {
  const avatarUrl = user.avatarUrl || "";
  if (avatarUrl.startsWith("emoji:")) return <span className="account-avatar-emoji" aria-hidden="true">{avatarUrl.slice(6)}</span>;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(avatarUrl)) return <img className="account-avatar-photo" src={avatarUrl} alt="" aria-hidden="true"/>;
  const diceBearAvatar = PROFILE_AVATAR_DICEBEAR.find((avatar) => avatar.image === avatarUrl);
  if (diceBearAvatar) return <img className="account-avatar-dicebear" src={diceBearAvatar.image} alt="" aria-hidden="true" referrerPolicy="no-referrer"/>;
  return <span className="account-avatar-initials" aria-hidden="true">{initials(user.fullName)}</span>;
}

async function encodeProfilePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WEBP photo.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Profile photos must be 8 MB or smaller.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - side) / 2;
    const sourceY = (bitmap.height - side) / 2;
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const makeSquare = (size: number) => {
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser couldn't prepare this photo.");
      context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, size, size);
    };
    makeSquare(256);
    let blob = await encode("image/webp", 0.8);
    if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.8);
    if (!blob) throw new Error("Your browser couldn't prepare this photo.");
    if (blob.size > 56 * 1024) blob = await encode(blob.type, 0.62);
    if (!blob || blob.size > 56 * 1024) {
      makeSquare(192);
      blob = await encode("image/jpeg", 0.58);
    }
    if (!blob || blob.size > 56 * 1024) throw new Error("This photo couldn't be compressed to a small profile image. Try another photo.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("The selected photo couldn't be read."));
      reader.readAsDataURL(blob);
    });
    if (dataUrl.length > 80000) throw new Error("This photo is too large after compression. Try another one.");
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

export default function Workspace({ user, items, sharedByMe, sharedWithMe, recordSharesByMe, recordSharesWithMe, contacts, businessCards, notifications, ringingSchedules, sharingAvailable, timelineEvents, timelineOnline, timelineSaving, onSaveTimelineEvent, onDeleteTimelineEvent, onOpenTimelineAttachment, medicalRecords, maxUploadMb, onSaveMedicalRecord, onDeleteMedicalRecord, onOpenMedicalRecordFile, onPreviewMedicalRecordFile, onRefreshMedicalRecords, view, search, pendingPlanId, documentEditor, documentFocusedItem, documentFilePreview, documentTypes, documentComments, onCloseDocumentPanel, onManageDocumentSharing, onAddDocumentComment, onDownloadDocumentFile, onSearch, onNavigate, onAdd, onSaveItem, onAddTodo, onEditTodoItem, onToggleTodo, onToggleSchedule, onDismissSchedule, onSnoozeSchedule, onOpenItem, onEditItem, onDeleteItem, onShareItem, onOpenSharedEntry, onChangeSharePermission, onRevokeShare, onShareRecord, onRevokeRecordShare, onMarkNotificationsRead, onToggleFavorite, onTogglePin, onMoveVaultItem, onSaveContact, onDeleteContact, onMergeContacts, onImportContacts, onRefreshContacts, onSaveBusinessCard, onDeleteBusinessCard, onRefreshBusinessCards, onSignOut, onOpenAdmin, onOpenPublicPage, onOpenContact, onProfileSave, onPasswordChange, onExport, onImport, onDeleteAccount, notify }: WorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [compactDocumentPanels, setCompactDocumentPanels] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  const section = getSection(view);
  const activeDocumentEditor = view === "documents" && documentEditor?.section === "documents" ? documentEditor : null;
  const activeDocumentItem = view === "documents" && documentFocusedItem?.section === "documents" ? documentFocusedItem : null;
  const hasDocumentPanel = Boolean(activeDocumentEditor || activeDocumentItem);
  const titleInfo = section ? { title: section.label, eyebrow: section.eyebrow, icon: section.icon } : viewInfo[view] || viewInfo.dashboard;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setCompactDocumentPanels(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [sidebarOpen]);
  const updateView = (next: ViewId) => { onNavigate(next); setSidebarOpen(false); onSearch(""); setProfileMenu(false); };
  const searchEntries: { result: SearchResult; select: () => void }[] = [
    ...[...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
      const searchText = Object.entries(item.metadata)
        .filter(([key]) => {
          if (item.section === "wallet-cards") return ["network", "cardType", "issuer", "currency"].includes(key);
          if (item.section === "accounts" && item.metadata.accountKind === "Bank Account") return !["accountNumber", "routingNumber", "swiftCode", "iban"].includes(key);
          return true;
        })
        .map(([key, value]) => `${key} ${item.section === "notes" && key === "content" ? notePlainText(value) : value}`)
        .join(" ");
      return { result: { name: item.title, meta: [SECTION_BY_ID[item.section].label, item.subtitle, item.file?.name ? `File · ${item.file.name}` : ""].filter(Boolean).join(" · "), searchText, href: `persora:vault:${item.id}` }, select: () => onOpenItem(item) };
    }),
    ...[...contacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((contact) => ({ result: { name: contact.name, meta: [contact.jobTitle, contact.company, contact.email].filter(Boolean).join(" · ") || "Contact", searchText: [contact.phoneNumbers.map((phone) => phone.number).join(" "), contact.address, contact.notes, contact.category].filter(Boolean).join(" "), href: `persora:contact:${contact.id}` }, select: () => updateView("contacts") })),
    ...[...businessCards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((card) => ({ result: { name: card.fullName, meta: [card.jobTitle, card.company, card.email].filter(Boolean).join(" · ") || "Business card", searchText: [card.phoneNumbers.map((phone) => phone.number).join(" "), card.websites.join(" "), card.address, card.bio].filter(Boolean).join(" "), href: `persora:business-card:${card.id}` }, select: () => updateView("business-card") })),
  ];
  const searchResults = searchEntries.map((entry) => entry.result);
  const searchTags: SearchTag[] = [
    { label: "Records", icon: <FileText className="h-4 w-4"/> },
    { label: "People", icon: <UsersRound className="h-4 w-4"/> },
    { label: "Files", icon: <Folder className="h-4 w-4"/> },
  ];
  const searchQuickActions: QuickAction[] = [
    { label: "Create a note", icon: <FileText className="h-4 w-4"/>, shortcut: "N", onClick: () => { onSearch(""); onAdd("notes"); } },
    { label: "Add a document", icon: <Plus className="h-4 w-4"/>, shortcut: "D", onClick: () => { onSearch(""); onAdd("documents"); } },
    { label: "Open contacts", icon: <UsersRound className="h-4 w-4"/>, shortcut: "P", onClick: () => updateView("contacts") },
  ];
  const searchFiles: SearchFile[] = [...items].filter((item) => item.file).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map((item) => {
    const fileName = item.file?.name || "Attachment";
    const dot = fileName.lastIndexOf(".");
    const hasExtension = dot > 0;
    return {
      name: hasExtension ? fileName.slice(0, dot) : fileName,
      ext: hasExtension ? fileName.slice(dot) : undefined,
      icon: <FileText className="h-[15px] w-[15px]"/>,
      onOpen: () => onOpenItem(item),
      onShare: () => onShareItem(item),
    };
  });
  const sidebarLink = (id: ViewId, label: string, Icon: LucideIcon, count?: number) => <button key={id} className={`sidebar-link ${view === id ? "active" : ""}`} onClick={() => updateView(id)} aria-current={view === id ? "page" : undefined}><Icon size={17}/><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>;
  const sectionView = section && section.id !== "personal-finance" ? <SectionView userId={user.id} demoMode={user.demo || false} section={section} items={items.filter((item) => item.section === section.id)} query={search} onAdd={onAdd} onAddTodo={onAddTodo} onEditTodoItem={onEditTodoItem} onToggleTodo={onToggleTodo} onToggleSchedule={onToggleSchedule} onOpenItem={onOpenItem} onEditItem={onEditItem} onDeleteItem={onDeleteItem} onShareItem={onShareItem} onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} onMoveItem={onMoveVaultItem} notify={notify}/> : null;
  const documentPanelContent = activeDocumentEditor ? <ItemEditorDialog key={`document-editor-${activeDocumentEditor.item?.id || "new"}`} sectionId="documents" item={activeDocumentEditor.item} initialMetadata={activeDocumentEditor.initialMetadata} documentTypes={documentTypes} maxUploadMb={maxUploadMb} presentation="panel" onClose={onCloseDocumentPanel} onSave={onSaveItem}/> : activeDocumentItem ? <ItemDetailDialog key={`document-view-${activeDocumentItem.id}`} item={activeDocumentItem} filePreview={documentFilePreview} shareAccess={activeDocumentItem.sharedAccess} comments={documentComments} presentation="panel" onClose={onCloseDocumentPanel} onEdit={() => onEditItem(activeDocumentItem)} onDownloadFile={() => onDownloadDocumentFile(activeDocumentItem)} onManageSharing={() => onManageDocumentSharing(activeDocumentItem)} onAddComment={onAddDocumentComment}/> : null;
  const documentWorkspace = section?.id === "documents" && sectionView ? <ResizablePanelGroup id="documents-panel-group" orientation="horizontal" className={`documents-resizable-group ${hasDocumentPanel ? "documents-panels-active" : ""}`} style={hasDocumentPanel ? { height: "100%", minHeight: 0, maxHeight: "none", overflow: "hidden" } : { height: "auto", minHeight: 0, maxHeight: "none", overflow: "visible" }}>
    <ResizablePanel id="documents-list-panel" className={`documents-list-panel ${hasDocumentPanel ? "documents-list-panel-active" : ""}`} defaultSize={hasDocumentPanel ? (compactDocumentPanels ? "28%" : "64%") : "100%"} minSize={hasDocumentPanel ? (compactDocumentPanels ? "12%" : "40%") : "100%"} maxSize={hasDocumentPanel ? (compactDocumentPanels ? "62%" : "72%") : "100%"}>
      {sectionView}
    </ResizablePanel>
    {hasDocumentPanel && <><ResizableHandle withHandle aria-label="Resize the document list and details"/><ResizablePanel id="document-side-panel" className="document-side-panel" defaultSize={compactDocumentPanels ? "72%" : "36%"} minSize={compactDocumentPanels ? "38%" : "320px"} maxSize={compactDocumentPanels ? "90%" : "720px"}>
      <div className="documents-panel-content">{documentPanelContent}</div>
    </ResizablePanel></>}
  </ResizablePanelGroup> : sectionView;

  return <div className="workspace-shell">
    {sidebarOpen && <button className="mobile-sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`workspace-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-header"><button className="workspace-brand" onClick={() => updateView("dashboard")}><span className="brand-mark"><ShieldCheck size={19}/></span><span>persora</span><span className="brand-period">.</span></button></div>
      <nav className="sidebar-nav" aria-label="Workspace navigation">
        <div className="sidebar-group sidebar-primary-group"><div className="nav-group-label">Workspace</div>{sidebarLink("dashboard", "Overview", Home)}</div>
        <div className="sidebar-group"><div className="nav-group-label">Health &amp; history</div>{sidebarLink("timeline", "Life Timeline", CalendarClock)}{sidebarLink("medical-records", "Medical Records", HeartPulse, medicalRecords.length || undefined)}</div>
        <div className="sidebar-group"><div className="nav-group-label">People &amp; sharing</div>{sidebarLink("contacts", "Contacts", UsersRound, contacts.length)}{sidebarLink("shared", "Shared documents", Share2, sharedWithMe.length || undefined)}</div>
        {NAV_GROUPS.map((group) => <div className="sidebar-group" key={group.label}><div className="nav-group-label">{group.label}</div>{group.ids.map((id) => { const def = SECTION_BY_ID[id]; const count = id === "documents" ? items.filter((item) => item.section === id).length : undefined; return sidebarLink(id, def.label, def.icon, count); })}</div>)}
        <div className="sidebar-group sidebar-account-group"><div className="nav-group-label">Account</div>{sidebarLink("billing", "Plans & billing", CreditCard)}{sidebarLink("settings", "Settings", Settings)}{user.role === "admin" && <button className="sidebar-link admin-link" onClick={onOpenAdmin}><ShieldCheck size={17}/><span>Administrator</span><span className="admin-nav-dot"/></button>}</div>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-secure-card"><span className="secure-card-icon"><ShieldCheck size={16}/></span><div><b>Your vault is private</b><small>Only you have access</small></div><span className="secure-mini-check"><Check size={11}/></span></div><div className="sidebar-profile-wrap">{profileMenu && <div className="user-popover"><div className="user-popover-header"><span className="avatar avatar-small"><AccountAvatarContent user={user}/></span><div><strong>{user.fullName}</strong><small>{user.email}</small></div></div>{user.role === "admin" && <button onClick={onOpenAdmin}><ShieldCheck size={15}/> Administrator console</button>}<button onClick={() => updateView("billing")}><CreditCard size={15}/> Plans &amp; billing</button><button onClick={() => updateView("settings")}><Settings size={15}/> Account settings</button><button className="popover-logout" onClick={onSignOut}><LogOut size={15}/> Sign out</button></div>}<button className="sidebar-profile" onClick={() => setProfileMenu((open) => !open)}><span className="avatar"><AccountAvatarContent user={user}/></span><span className="profile-copy"><b>{user.fullName}</b><small>{user.role === "admin" ? "Administrator" : "Personal account"}</small></span><MoreHorizontal size={19}/></button></div></div>
    </aside>
    <div className="workspace-main"><header className="workspace-topbar"><button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open workspace sections" aria-expanded={sidebarOpen}>Sections</button><div className={`breadcrumb-area ${section ? "breadcrumb-section-hidden" : ""}`}><span className="breadcrumb-overline">{titleInfo.eyebrow}</span><div className="breadcrumb-title"><h1>{titleInfo.title}</h1>{view === "dashboard" && <span className="live-pill"><span/>Private workspace</span>}</div></div><div className="topbar-actions"><button type="button" className="global-search-trigger" onClick={() => setSearchModalOpen(true)} aria-label="Search your vault" aria-haspopup="dialog" aria-expanded={searchModalOpen}><Search size={16}/><span>Search your vault…</span><kbd>Ctrl/⌘ K</kbd></button><div className="notification-wrap"><button className={`notification-button icon-button ${notificationOpen ? "button-pressed" : ""}`} onClick={() => { const opening = !notificationOpen; setNotificationOpen(opening); if (opening) onMarkNotificationsRead(); }} aria-label={`Notifications${notifications.some((notification) => !notification.readAt) ? ", unread updates" : ""}`} aria-expanded={notificationOpen}><Bell size={17}/>{notifications.some((notification) => !notification.readAt) && <span className="notification-dot"/>}</button>{notificationOpen && <div className="notification-popover"><div className="notification-head"><div><b>Notifications</b><span>Reminders, alarms, and sharing activity</span></div><div className="notification-head-actions">{notificationPermission === "default" && <button className="notification-enable" onClick={async () => { try { const permission = await Notification.requestPermission(); setNotificationPermission(permission); if (permission === "granted") notify("Desktop notifications are enabled."); } catch { notify("Browser notifications are unavailable here.", "error"); } }}>Enable alerts</button>}<button className="plain-icon" onClick={() => setNotificationOpen(false)} aria-label="Close notifications">×</button></div></div>{notifications.length ? notifications.slice(0, 12).map((notification) => <button className="notification-row" key={notification.id} onClick={() => { const scheduleItem = notification.kind === "reminder" || notification.kind === "alarm" ? items.find((item) => notification.id.startsWith(`schedule:${item.id}:`)) : undefined; if (scheduleItem) onOpenItem(scheduleItem); else if (notification.kind === "reminder" || notification.kind === "alarm") updateView("notes"); else updateView("shared"); setNotificationOpen(false); }}><span className={`notification-icon ${notification.kind === "reminder" ? "tag-orange" : notification.kind === "alarm" ? "tag-violet" : "tag-blue"}`}>{notification.kind === "reminder" ? <BellRing size={14}/> : notification.kind === "alarm" ? <AlarmClock size={14}/> : <Share2 size={14}/>}</span><span><b>{notification.actorName}</b><small>{notification.message}</small></span><span className="notification-time">{new Date(notification.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>) : <div className="notification-empty">You're all caught up.</div>}{(notificationPermission === "unsupported" || notificationPermission === "denied") && <div className="notification-footnote">{notificationPermission === "denied" ? "Desktop alerts are blocked by your browser settings. In-app reminders still work while Persora is open." : "Desktop alerts aren’t supported in this browser. In-app reminders still work while Persora is open."}</div>}</div>}</div><button className="topbar-avatar avatar" onClick={() => updateView("settings")} aria-label="Open account settings"><AccountAvatarContent user={user}/></button></div></header>
      <main className={`workspace-content ${view === "documents" && hasDocumentPanel ? "workspace-content-document-split" : ""}`}>{view === "dashboard" && <DashboardView user={user} items={items} onNavigate={updateView} onOpenItem={onOpenItem} onAdd={onAdd} onToggleFavorite={onToggleFavorite}/>} {view === "timeline" && <TimelineView events={timelineEvents} items={items} online={timelineOnline} canPost={!user.demo && sharingAvailable} saving={timelineSaving} onSave={onSaveTimelineEvent} onDelete={onDeleteTimelineEvent} onOpenItem={onOpenItem} onOpenAttachment={onOpenTimelineAttachment} notify={notify}/>} {view === "medical-records" && <Suspense fallback={<div className="medical-loading">Loading your private health archive…</div>}><MedicalRecordsView userId={user.id} records={medicalRecords} contacts={contacts} items={items} demoMode={user.demo || false} connected={sharingAvailable} maxUploadMb={maxUploadMb} onRefresh={onRefreshMedicalRecords} onSave={onSaveMedicalRecord} onDelete={onDeleteMedicalRecord} onOpenFile={onOpenMedicalRecordFile} onPreviewFile={onPreviewMedicalRecordFile} notify={notify}/></Suspense>} {view === "personal-finance" && <PersonalFinanceView items={items} contacts={contacts} onSave={onSaveItem} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} onNavigate={updateView}/>} {documentWorkspace} {view === "shared" && <SharedDocumentsView userId={user.id} outgoing={sharedByMe} incoming={sharedWithMe} recordOutgoing={recordSharesByMe} recordIncoming={recordSharesWithMe} publicCards={businessCards.filter((card) => card.isPublic)} available={sharingAvailable} onOpen={onOpenSharedEntry} onPermissionChange={onChangeSharePermission} onRevoke={onRevokeShare} onRevokeRecord={onRevokeRecordShare}/>} {view === "contacts" && <ContactsView userId={user.id} contacts={contacts} demoMode={user.demo || false} connected={sharingAvailable} onSave={onSaveContact} onDelete={onDeleteContact} onShare={(contact, recipient) => onShareRecord("contact", contact.id, recipient)} onMerge={onMergeContacts} onImport={onImportContacts} onRefresh={onRefreshContacts} notify={notify}/>} {view === "business-card" && <BusinessCardsView userId={user.id} cards={businessCards} demoMode={user.demo || false} connected={sharingAvailable} onSave={onSaveBusinessCard} onDelete={onDeleteBusinessCard} onShare={(card, recipient) => onShareRecord("business_card", card.id, recipient)} onRefresh={onRefreshBusinessCards} notify={notify}/>} {view === "billing" && <BillingView initialPlanId={pendingPlanId} notify={notify}/>} {view === "settings" && <SettingsView user={user} items={items} onProfileSave={onProfileSave} onPasswordChange={onPasswordChange} onExport={onExport} onImport={onImport} onDeleteAccount={onDeleteAccount} onOpenContact={onOpenContact} notify={notify}/>}</main>
      <footer className="workspace-footer"><span className="workspace-footer-brand">Persora</span><span>Powered by Dexter Studio</span><span className="workspace-footer-security"><ShieldCheck size={13}/> Sherlock Security System</span><nav aria-label="Legal and contact"><button onClick={() => onOpenPublicPage("/privacy")}>Privacy</button><button onClick={() => onOpenPublicPage("/terms")}>Terms</button><button onClick={onOpenContact}>Contact</button></nav></footer>
    </div>
    <ModalPortal><SearchModal modal open={searchModalOpen} onOpenChange={(open) => { setSearchModalOpen(open); if (!open) onSearch(""); }} hotkey="k" placeholder="Search records, people, files…" tags={searchTags} results={searchResults} quickActions={searchQuickActions} files={searchFiles} defaultQuery={search} onQueryChange={onSearch} onSelectResult={(result) => searchEntries.find((entry) => entry.result.href === result.href)?.select()} overlayClassName="z-[100]"/></ModalPortal>
    {ringingSchedules[0] && <RingingScheduleDialog alert={ringingSchedules[0]} onDismiss={() => onDismissSchedule(ringingSchedules[0])} onSnooze={() => onSnoozeSchedule(ringingSchedules[0])}/ >}
  </div>;
}

function DashboardView({ user, items, onNavigate, onOpenItem, onAdd, onToggleFavorite }: { user: AppUser; items: VaultItem[]; onNavigate: (view: ViewId) => void; onOpenItem: (item: VaultItem) => void; onAdd: (section: SectionId) => void; onToggleFavorite: (item: VaultItem, favorite: boolean) => void }) {
  const docs = items.filter((item) => item.section === "documents");
  const subscriptions = items.filter((item) => item.section === "subscriptions");
  const upcoming = items.filter((item) => {
    const kind = item.metadata.recordType;
    if (kind === "todo" && item.metadata.completed === "true") return false;
    if ((kind === "reminder" || kind === "alarm") && item.metadata.enabled === "false") return false;
    const at = dashboardItemDate(item);
    const days = at ? Math.floor((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date().setHours(0,0,0,0)) / 86400000) : null;
    return days !== null && days >= 0 && days <= 45;
  }).sort((a,b) => (dashboardItemDate(a)?.getTime() || Infinity) - (dashboardItemDate(b)?.getTime() || Infinity)).slice(0, 4);
  const metrics = [
    { title: "Documents saved", count: docs.length, id: "documents" as ViewId, icon: FileText, color: "mint", note: "Your important papers" },
    { title: "Subscriptions", count: subscriptions.length, id: "subscriptions" as ViewId, icon: WalletCards, color: "peach", note: "Plans and renewals" },
    { title: "Academic records", count: items.filter((item) => item.section === "academics").length, id: "academics" as ViewId, icon: BookOpen, color: "lavender", note: "Your learning journey" },
    { title: "Saved links", count: items.filter((item) => item.section === "urls").length, id: "urls" as ViewId, icon: Link2, color: "blue", note: "Useful things, one click away" },
  ];
  const recent = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const favorites = items.filter((item) => item.favorite).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  return <div className="dashboard-view"><div className="dashboard-welcome-row"><div><div className="welcome-overline"><span className="welcome-spark"><Sparkles size={13}/></span>Your personal space · {new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}</div><h2>{greeting(user.fullName)}<span className="greeting-period">.</span></h2><p>Everything important, gathered in one thoughtful place.</p></div><div className="welcome-actions"><button className="quiet-button" onClick={() => onNavigate("settings")}><Settings size={16}/> Preferences</button><button className="main-add-button" onClick={() => onAdd("documents")}><Plus size={17}/> Add something</button></div></div>
    <div className="metric-grid">{metrics.map(({ title, count, id, icon: Icon, color, note }, index) => <BlurFade key={id} delay={index * 65}><MagicCard className={`metric-card metric-${color}`} onClick={() => onNavigate(id)} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onNavigate(id)}><div className="metric-card-heading"><span className="metric-icon-box"><Icon size={17}/></span></div><div className="metric-card-value">{count.toString().padStart(2, "0")}</div><div className="metric-label">{title}</div><div className="metric-meta">{note}<ArrowUpRight size={13}/></div></MagicCard></BlurFade>)}</div>
    <div className="dashboard-grid-main"><section className="dashboard-panel upcoming-panel"><div className="panel-heading"><div><span className="panel-kicker">A gentle nudge</span><h3>Coming up soon <span className="panel-count">{upcoming.length}</span></h3></div><button className="panel-link" onClick={() => upcoming.length ? onNavigate(upcoming[0].section) : onAdd("documents")}>{upcoming.length ? "Open next" : "Add a document"} <ArrowRight size={14}/></button></div>{upcoming.length ? <div className="upcoming-list">{upcoming.map((item) => { const config = SECTION_BY_ID[item.section]; const Icon = item.metadata.recordType === "alarm" ? AlarmClock : item.metadata.recordType === "reminder" ? BellRing : config.icon; const at = dashboardItemDate(item); const label = item.metadata.recordType === "todo" ? "Task due" : item.metadata.recordType === "reminder" ? "Reminder" : item.metadata.recordType === "alarm" ? "Alarm" : config.label; return <button className="upcoming-row" key={item.id} onClick={() => onOpenItem(item)}><span className={`upcoming-icon ${colors[item.section]}`}><Icon size={16}/></span><span className="upcoming-main"><b>{item.title}</b><small>{label}{at ? ` · ${at.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</small></span><span className="upcoming-date"><CalendarClock size={13}/>{at ? item.metadata.recordType === "reminder" || item.metadata.recordType === "alarm" ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : formatDate(item.metadata.dueDate || item.metadata[config.dateKey || ""] || at.toISOString().slice(0,10)) : "Soon"}</span></button>; })}</div> : <div className="empty-upcoming"><div className="empty-sun"><Check size={17}/></div><div><b>A clear horizon.</b><span>No dates need your attention just yet.</span></div></div>}</section><section className="dashboard-panel recent-panel"><div className="panel-heading"><div><span className="panel-kicker">All your spaces, one view</span><h3>Recently updated</h3></div><span className="recent-month">{new Date().toLocaleDateString("en", { month: "long" })}</span></div><div className="recent-list">{recent.map((item) => { const Icon = SECTION_BY_ID[item.section].icon; return <button className="recent-row" key={item.id} onClick={() => onOpenItem(item)}><span className={`recent-icon ${colors[item.section]}`}><Icon size={15}/></span><span className="recent-info"><b>{item.title}</b><small>{SECTION_BY_ID[item.section].label}</small></span>{item.file && <FileText size={14}/>}<ArrowUpRight size={14}/></button>; })}{!recent.length && <div className="dashboard-empty-state"><FileText size={17}/><span>Your saved records will appear here.</span></div>}</div></section></div>
    <section className="dashboard-panel favorites-panel"><div className="panel-heading"><div><span className="panel-kicker">Kept close</span><h3>Favorites <span className="panel-count">{items.filter((item) => item.favorite).length}</span></h3></div></div>{favorites.length ? <div className="favorite-dashboard-list">{favorites.map((item) => { const Icon = SECTION_BY_ID[item.section].icon; return <div className="favorite-dashboard-row" key={item.id}><button className="favorite-dashboard-open" onClick={() => onOpenItem(item)}><span className={`favorite-dashboard-icon ${colors[item.section]}`}><Icon size={15}/></span><span><b>{item.title}</b><small>{item.file ? `File · ${item.file.name}` : SECTION_BY_ID[item.section].label}</small></span><ArrowUpRight size={14}/></button><button className="favorite-dashboard-remove" onClick={() => onToggleFavorite(item, false)} aria-label={`Remove ${item.title} from favorites`} title="Remove from favorites"><Heart size={15} fill="currentColor"/></button></div>; })}</div> : <div className="dashboard-favorites-empty"><Heart size={17}/><span>Favorite records and attached files will stay handy here. Use the heart on any record to add it.</span></div>}</section>
    <div className="dashboard-grid-secondary"><section className="dashboard-panel spaces-panel"><div className="panel-heading"><div><span className="panel-kicker">Every part of life</span><h3>Your spaces</h3></div></div><div className="spaces-grid">{NAV_GROUPS.flatMap((group) => group.ids).slice(0, 9).map((id) => { const section = SECTION_BY_ID[id]; const Icon = section.icon; return <button className="space-tile" key={id} onClick={() => onNavigate(id)}><span className={`space-tile-icon space-${section.color}`}><Icon size={16}/></span><span className="space-tile-copy"><b>{section.label}</b><small>{section.eyebrow}</small></span><span className="space-tile-count">{items.filter((item) => item.section === id).length}</span><ChevronRight size={15}/></button>; })}</div></section><section className="dashboard-panel dashboard-quick-capture-panel"><div className="panel-heading"><div><span className="panel-kicker">A little less typing</span><h3>Quick actions</h3></div><Sparkles size={17}/></div><div className="dashboard-quick-actions"><button className="dashboard-quick-action" onClick={() => onAdd("documents")}><span className="dashboard-quick-action-icon quick-action-blue"><FileText size={15}/></span><span><b>Smart Scan a document</b><small>Attach a photo or PDF to suggest fields</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("academics")}><span className="dashboard-quick-action-icon quick-action-violet"><BookOpen size={15}/></span><span><b>Add an academic record</b><small>Keep applications and results together</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("memberships")}><span className="dashboard-quick-action-icon quick-action-amber"><CreditCard size={15}/></span><span><b>Save a membership</b><small>Store membership details and dates</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("study")}><span className="dashboard-quick-action-icon quick-action-mint"><BookOpen size={15}/></span><span><b>Save study material</b><small>Keep learning files easy to find</small></span><ArrowRight size={14}/></button></div><div className="dashboard-quick-note"><ShieldCheck size={13}/> Scan suggestions stay editable and require your review.</div></section></div>
  </div>;
}

function dashboardItemDate(item: VaultItem): Date | null {
  const kind = item.metadata.recordType;
  if (kind === "reminder" || kind === "alarm") return nextScheduleDate(item);
  const value = kind === "todo" ? item.metadata.dueDate : item.metadata[SECTION_BY_ID[item.section]?.dateKey || ""];
  if (!value) return null;
  const date = new Date(`${value.slice(0,10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function RingingScheduleDialog({ alert, onDismiss, onSnooze }: { alert: ActiveScheduleAlert; onDismiss: () => void; onSnooze: () => void }) {
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopToneRef = useRef<(() => void) | null>(null);
  const title = alert.kind === "alarm" ? "Alarm is ringing" : "Reminder is due";
  const ringtoneName = alert.item.metadata.ringtoneName || BUILTIN_RINGTONES.find((tone) => tone.id === alert.ringtoneId)?.name || "Selected ringtone";
  const playSound = async () => {
    setSoundBlocked(false);
    try {
      if (alert.ringtoneId.startsWith("builtin-")) stopToneRef.current = startBuiltinRingtone(alert.ringtoneId);
      else {
        const audio = new Audio(alarmRingtoneAudioPath(alert.ringtoneId));
        audioRef.current = audio; audio.loop = true; audio.volume = 0.8;
        await audio.play();
      }
    } catch { setSoundBlocked(true); }
  };
  useEffect(() => { void playSound(); return () => { audioRef.current?.pause(); stopToneRef.current?.(); }; }, [alert.id, alert.ringtoneId]);
  return <div className="ringing-backdrop" role="presentation"><section className={`ringing-dialog ringing-${alert.kind}`} role="alertdialog" aria-modal="true" aria-labelledby="ringing-title"><div className="ringing-pulse"><span/><AlarmClock size={26}/></div><span className="ringing-eyebrow">PERSORA · {alert.kind.toUpperCase()}</span><h2 id="ringing-title">{title}</h2><p className="ringing-item-title">{alert.item.title}</p>{alert.item.metadata.todoDetails && <p className="ringing-details">{alert.item.metadata.todoDetails}</p>}<div className="ringing-tone"><Music2 size={14}/>{ringtoneName}</div><div className="ringing-now">{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>{soundBlocked && <button className="ringing-start-sound" onClick={() => void playSound()}><Play size={14}/> Tap to start ringtone</button>}<div className="ringing-actions"><button className="ringing-snooze" onClick={onSnooze}><span>5</span> Snooze 5 min</button><button className="ringing-dismiss" onClick={onDismiss}>Dismiss</button></div><small className="ringing-browser-note">Sound repeats until dismissed or snoozed. Keep Persora open for alarms to run.</small></section></div>;
}

function nextScheduleDate(item: VaultItem): Date | null {
  const snoozedUntil = item.metadata.snoozedUntil ? new Date(item.metadata.snoozedUntil) : null;
  if (snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil.getTime() >= Date.now() - 86400000) return snoozedUntil;
  if (item.metadata.recordType === "reminder") {
    const date = new Date(item.metadata.reminderAt || "");
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (item.metadata.recordType !== "alarm" || !item.metadata.alarmTime) return null;
  const [hour, minute] = item.metadata.alarmTime.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const repeat = (item.metadata.repeatDays || "").split(",").filter(Boolean);
  if (!repeat.length) {
    if (!item.metadata.alarmDate) return null;
    const date = new Date(`${item.metadata.alarmDate}T${item.metadata.alarmTime}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const now = new Date();
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0);
    if (repeat.includes(String(candidate.getDay())) && candidate.getTime() >= now.getTime()) return candidate;
  }
  return null;
}
function ScheduleCard({ item, kind, viewMode, onEdit, onDelete, onToggle, folders, folderId, onMoveFolder }: { item: VaultItem; kind: "reminder" | "alarm"; viewMode: ViewMode; onEdit: () => void; onDelete: () => void; onToggle: (enabled: boolean) => void; folders: VaultFolder[]; folderId?: string; onMoveFolder: (folderId: string | null) => void }) {
  const isAlarm = kind === "alarm";
  const enabled = item.metadata.enabled !== "false";
  const next = nextScheduleDate(item);
  const repeat = (item.metadata.repeatDays || "").split(",").filter(Boolean).map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(day)]).filter(Boolean);
  const timeLabel = isAlarm ? item.metadata.alarmTime : next?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateLabel = isAlarm ? repeat.length ? `Repeats ${repeat.join(" · ")}` : item.metadata.alarmDate ? formatDate(item.metadata.alarmDate) : "One-time alarm" : next ? next.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "Date unavailable";
  const Icon = isAlarm ? AlarmClock : BellRing;
  return <article className={`schedule-card ${!enabled ? "schedule-card-paused" : ""} ${viewMode === "list" ? "schedule-card-row" : ""}`}>
    <span className={`schedule-card-icon ${isAlarm ? "schedule-alarm-icon" : "schedule-reminder-icon"}`}><Icon size={18}/></span>
    <div className="schedule-card-copy"><b>{item.title}</b>{item.metadata.todoDetails && <p>{item.metadata.todoDetails}</p>}<span className="schedule-card-time"><strong>{timeLabel || "Set a time"}</strong><i>·</i>{dateLabel}</span><span className="schedule-card-tone"><Music2 size={12}/>{item.metadata.ringtoneName || "Persora soft chime"}</span></div>
    <div className="schedule-card-actions"><button className={`schedule-toggle ${enabled ? "is-on" : ""}`} type="button" role="switch" aria-checked={enabled} aria-label={`${enabled ? "Pause" : "Enable"} ${kind} ${item.title}`} onClick={() => onToggle(!enabled)}><span/></button><MoreOptionsMenu label={`${item.title} options`} actions={[{ label: `Edit ${kind}`, onSelect: onEdit }, { label: `Delete ${kind}`, danger: true, onSelect: onDelete }]} folders={folders} folderId={folderId} onMoveFolder={onMoveFolder}/></div>
  </article>;
}

function SectionView({ userId, demoMode, section, items, query, onAdd, onAddTodo, onEditTodoItem, onToggleTodo, onToggleSchedule, onOpenItem, onEditItem, onDeleteItem, onShareItem, onToggleFavorite, onTogglePin, onMoveItem, notify }: { userId: string; demoMode: boolean; section: SectionDefinition; items: VaultItem[]; query: string; onAdd: (id: SectionId, initialMetadata?: Record<string, string>) => void; onAddTodo: (kind: NotesRecordKind) => void; onEditTodoItem: (item: VaultItem) => void; onToggleTodo: (item: VaultItem, completed: boolean) => void; onToggleSchedule: (item: VaultItem, enabled: boolean) => void; onOpenItem: (item: VaultItem) => void; onEditItem: (item: VaultItem) => void; onDeleteItem: (item: VaultItem) => void; onShareItem: (item: VaultItem) => void; onToggleFavorite: (item: VaultItem, favorite: boolean) => void; onTogglePin: (item: VaultItem, pinned: boolean) => void; onMoveItem: (item: VaultItem, folderId: string | null) => Promise<void>; notify: (message: string, kind?: "success" | "error") => void }) {
  const [filter, setFilter] = useState<"all" | "upcoming" | "files" | "active" | "completed">("all");
  const [visibleCount, setVisibleCount] = useState(24);
  const [notesTab, setNotesTab] = useState<"notes" | NotesRecordKind>("notes");
  const [accountTab, setAccountTab] = useState<"internet" | "bank">("internet");
  const [viewMode, setViewMode] = usePageView(userId, section.id);
  const isAccountsSection = section.id === "accounts";
  const isWalletCardsSection = section.id === "wallet-cards";
  const effectiveViewMode: ViewMode = isWalletCardsSection ? "cards" : viewMode;
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const folderItems = selectedFolderId ? items.filter((item) => item.folderId === selectedFolderId) : items;
  const isNotesSection = section.id === "notes";
  const isTodoView = isNotesSection && notesTab === "todo";
  const isScheduleView = isNotesSection && (notesTab === "reminder" || notesTab === "alarm");
  const noteItems = isNotesSection ? folderItems.filter((item) => !["todo", "reminder", "alarm"].includes(item.metadata.recordType || "")) : folderItems;
  const accountItems = isAccountsSection ? folderItems.filter((item) => (item.metadata.accountKind === "Bank Account" ? "bank" : "internet") === accountTab) : [];
  const todoItems = isNotesSection ? folderItems.filter((item) => item.metadata.recordType === "todo") : [];
  const reminderItems = isNotesSection ? folderItems.filter((item) => item.metadata.recordType === "reminder") : [];
  const alarmItems = isNotesSection ? folderItems.filter((item) => item.metadata.recordType === "alarm") : [];
  const scheduleItems = notesTab === "reminder" ? reminderItems : alarmItems;
  const activeTodoCount = todoItems.filter((item) => item.metadata.completed !== "true").length;
  const activeScheduleCount = scheduleItems.filter((item) => item.metadata.enabled !== "false").length;
  const baseItems = isAccountsSection ? accountItems : isTodoView ? todoItems : isScheduleView ? scheduleItems : noteItems;
  const sortedItems = isTodoView
    ? [...baseItems].sort((a, b) => Number(a.metadata.completed === "true") - Number(b.metadata.completed === "true") || (a.metadata.dueDate || "9999").localeCompare(b.metadata.dueDate || "9999"))
    : isScheduleView ? [...baseItems].sort((a,b) => (nextScheduleDate(a)?.getTime() || 0) - (nextScheduleDate(b)?.getTime() || 0))
      : section.id === "notes" ? [...baseItems].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt)) : baseItems;
  const filtered = sortedItems.filter((item) => {
    const needle = query.toLowerCase().trim();
    if (needle && !`${item.title} ${Object.values(item.metadata).join(" ")}`.toLowerCase().includes(needle)) return false;
    if (isTodoView && filter === "active") return item.metadata.completed !== "true";
    if (isTodoView && filter === "completed") return item.metadata.completed === "true";
    if (isScheduleView && filter === "active") return item.metadata.enabled !== "false";
    if (isScheduleView && filter === "completed") return item.metadata.enabled === "false";
    if (isScheduleView && filter === "upcoming") { const at = nextScheduleDate(item); return item.metadata.enabled !== "false" && Boolean(at && at.getTime() >= Date.now() && at.getTime() <= Date.now() + 7 * 86400000); }
    if (!isTodoView && !isScheduleView && filter === "files") return Boolean(item.file);
    if (!isNotesSection && filter === "upcoming") { const date = section.dateKey ? item.metadata[section.dateKey] : undefined; const days = daysUntil(date); return days !== null && days >= 0 && days <= 60; }
    return true;
  });
  useEffect(() => { setVisibleCount(24); }, [filter, query, section.id, notesTab]);
  useEffect(() => { setFilter("all"); setNotesTab("notes"); setAccountTab("internet"); setSelectedFolderId(""); setFolders([]); }, [section.id, userId]);
  const visibleItems = filtered.slice(0, visibleCount);
  const folderCounts = Object.fromEntries(folders.map((folder) => [folder.id, items.filter((item) => item.folderId === folder.id).length]));
  const moveItemToFolder = async (item: VaultItem, folderId: string | null) => {
    try { await onMoveItem(item, folderId); const name = folderId ? folders.find((folder) => folder.id === folderId)?.name : "All records"; notify(name ? `Moved to ${name}.` : "Record moved out of its folder."); }
    catch (error) { notify(error instanceof Error ? error.message : "The record could not be moved.", "error"); }
  };
  const addSectionRecord = () => {
    if (isTodoView || isScheduleView) onAddTodo(isTodoView ? "todo" : notesTab as NotesRecordKind);
    else if (isAccountsSection) onAdd(section.id, { accountKind: accountTab === "bank" ? "Bank Account" : "Internet Account" });
    else onAdd(section.id);
  };
  const Icon = section.icon;
  return <div className="section-view">
    <div className="section-page-heading"><div><div className="section-page-eyebrow"><span className={`section-mini-icon ${colors[section.id]}`}><Icon size={13}/></span>{section.eyebrow}</div><h2>{section.id === "documents" ? "Your important things, in one safe place." : section.id === "subscriptions" ? "Know what's coming. Keep it all in check." : section.id === "notes" ? "Tasks, reminders, and notes, kept in one place." : `${section.label}, all in one place.`}</h2><p>{section.id === "notes" ? "Keep tasks moving, set reminders and alarms, and save notes in one private, searchable space." : section.description}</p></div><div className="section-heading-aside"><div className={`section-aside-art aside-${section.color}`}><div className="aside-orbit"/><Icon size={44} strokeWidth={1.1}/><div className="aside-art-bottom"><span>PERSONAL</span><span>{String(items.length).padStart(2,"0")}</span></div></div><div className="aside-note"><LockKeyhole size={13}/><span>Organized for you. Private by default.</span></div></div></div>
    {isNotesSection && <div className="notes-section-tabs" role="tablist" aria-label="Tasks and notes">
      <button type="button" role="tab" aria-selected={notesTab === "todo"} className={notesTab === "todo" ? "is-active" : ""} onClick={() => { setNotesTab("todo"); setFilter("all"); }}><Check size={15}/> Tasks <span>{activeTodoCount}</span></button>
      <button type="button" role="tab" aria-selected={notesTab === "notes"} className={notesTab === "notes" ? "is-active" : ""} onClick={() => { setNotesTab("notes"); setFilter("all"); }}><FileText size={15}/> Notes <span>{noteItems.length}</span></button>
      <button type="button" role="tab" aria-selected={notesTab === "reminder"} className={notesTab === "reminder" ? "is-active" : ""} onClick={() => { setNotesTab("reminder"); setFilter("all"); }}><BellRing size={15}/> Reminders <span>{reminderItems.filter((item) => item.metadata.enabled !== "false").length}</span></button>
      <button type="button" role="tab" aria-selected={notesTab === "alarm"} className={notesTab === "alarm" ? "is-active" : ""} onClick={() => { setNotesTab("alarm"); setFilter("all"); }}><AlarmClock size={15}/> Alarms <span>{alarmItems.filter((item) => item.metadata.enabled !== "false").length}</span></button>
    </div>}
    {isAccountsSection && <div className="accounts-section-tabs" role="tablist" aria-label="Account type">
      <button type="button" role="tab" aria-selected={accountTab === "internet"} className={accountTab === "internet" ? "is-active" : ""} onClick={() => { setAccountTab("internet"); setFilter("all"); }}><Globe2 size={15}/> Internet Account <span>{folderItems.filter((item) => item.metadata.accountKind !== "Bank Account").length}</span></button>
      <button type="button" role="tab" aria-selected={accountTab === "bank"} className={accountTab === "bank" ? "is-active" : ""} onClick={() => { setAccountTab("bank"); setFilter("all"); }}><Building2 size={15}/> Bank Account <span>{folderItems.filter((item) => item.metadata.accountKind === "Bank Account").length}</span></button>
    </div>}
    <VaultFolderShelf userId={userId} scope={section.id} pageLabel={section.label} demoMode={demoMode} totalCount={items.length} folderCounts={folderCounts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify}/>
    <div className="section-toolbar"><div className="filter-tabs">{isAccountsSection ? <span className="accounts-filter-count">{baseItems.length} {accountTab === "bank" ? "bank accounts" : "internet accounts"}</span> : isTodoView ? <>
      <button className={filter === "all" ? "filter-active" : ""} onClick={() => setFilter("all")}>All tasks<span>{todoItems.length}</span></button>
      <button className={filter === "active" ? "filter-active" : ""} onClick={() => setFilter("active")}>Active<span>{activeTodoCount}</span></button>
      <button className={filter === "completed" ? "filter-active" : ""} onClick={() => setFilter("completed")}>Completed<span>{todoItems.length - activeTodoCount}</span></button>
    </> : isScheduleView ? <>
      <button className={filter === "all" ? "filter-active" : ""} onClick={() => setFilter("all")}>All {notesTab === "alarm" ? "alarms" : "reminders"}<span>{scheduleItems.length}</span></button>
      <button className={filter === "active" ? "filter-active" : ""} onClick={() => setFilter("active")}>On<span>{activeScheduleCount}</span></button>
      <button className={filter === "upcoming" ? "filter-active" : ""} onClick={() => setFilter("upcoming")}>Next 7 days<span>{scheduleItems.filter((item) => { const at = nextScheduleDate(item); return item.metadata.enabled !== "false" && Boolean(at && at.getTime() >= Date.now() && at.getTime() <= Date.now() + 7 * 86400000); }).length}</span></button>
      <button className={filter === "completed" ? "filter-active" : ""} onClick={() => setFilter("completed")}>Paused<span>{scheduleItems.length - activeScheduleCount}</span></button>
    </> : <>
      <button className={filter === "all" ? "filter-active" : ""} onClick={() => setFilter("all")}>All {isNotesSection ? "notes" : isAccountsSection ? accountTab === "bank" ? "bank accounts" : "internet accounts" : section.label}<span>{baseItems.length}</span></button>
      {section.dateKey && <button className={filter === "upcoming" ? "filter-active" : ""} onClick={() => setFilter("upcoming")}>Coming up<span>{noteItems.filter((item) => { const days = daysUntil(item.metadata[section.dateKey!]); return days !== null && days >= 0 && days <= 60; }).length}</span></button>}
      <button className={filter === "files" ? "filter-active" : ""} onClick={() => setFilter("files")}>With files<span>{baseItems.filter((item) => item.file).length}</span></button>
    </>}</div><div className="section-toolbar-actions">{!isWalletCardsSection && <ViewModeToggle mode={effectiveViewMode} onChange={setViewMode} label={`${section.label} layout`}/>}<button className="section-add-button" onClick={addSectionRecord}><Plus size={16}/> Add {isTodoView ? "task" : isScheduleView ? notesTab : isAccountsSection ? accountTab === "bank" ? "bank account" : "internet account" : section.singular}</button></div></div>
    <div className="section-list-meta"><span><b>{filtered.length.toString().padStart(2,"0")}</b> {isTodoView ? filtered.length === 1 ? "task" : "tasks" : isScheduleView ? filtered.length === 1 ? notesTab : `${notesTab}s` : filtered.length === 1 ? section.singular : isNotesSection ? "notes" : section.label.toLowerCase()}</span><span className="list-meta-private"><LockKeyhole size={12}/> Private to you</span></div>
    {filtered.length ? <><div className={`${isTodoView ? "todo-items-grid" : isScheduleView ? "schedule-items-grid" : "vault-items-grid"} ${effectiveViewMode === "list" ? isTodoView ? "todo-list-view" : isScheduleView ? "schedule-list-view" : "vault-list-view" : ""}`}>{visibleItems.map((item, index) => isTodoView
      ? <TodoTaskCard key={item.id} item={item} viewMode={effectiveViewMode} onToggle={(completed) => onToggleTodo(item, completed)} onEdit={() => onEditTodoItem(item)} onDelete={() => onDeleteItem(item)} folders={folders} folderId={item.folderId} onMoveFolder={(folderId) => void moveItemToFolder(item, folderId)}/>
      : isScheduleView ? <ScheduleCard key={item.id} item={item} kind={notesTab as "reminder" | "alarm"} viewMode={effectiveViewMode} onEdit={() => onEditTodoItem(item)} onDelete={() => onDeleteItem(item)} onToggle={(enabled) => onToggleSchedule(item, enabled)} folders={folders} folderId={item.folderId} onMoveFolder={(folderId) => void moveItemToFolder(item, folderId)}/>
      : section.id === "wallet-cards" ? <WalletCardItemCard key={item.id} item={item} index={index} onOpen={() => onOpenItem(item)} onEdit={() => onEditItem(item)} onDelete={() => onDeleteItem(item)} folders={folders} folderId={item.folderId} onMoveFolder={(folderId) => void moveItemToFolder(item, folderId)}/>
      : section.id === "memberships" ? <MembershipItemCard key={item.id} item={item} index={index} viewMode={effectiveViewMode} onOpen={() => onOpenItem(item)} onEdit={() => onEditItem(item)} onDelete={() => onDeleteItem(item)} onShare={() => onShareItem(item)} onToggleFavorite={(favorite) => { onToggleFavorite(item, favorite); notify(favorite ? "Added to favorites." : "Removed from favorites."); }} folders={folders} folderId={item.folderId} onMoveFolder={(folderId) => void moveItemToFolder(item, folderId)}/>
      : <ItemCard key={item.id} item={item} section={section} index={index} onOpen={() => onOpenItem(item)} onEdit={() => onEditItem(item)} onDelete={() => onDeleteItem(item)} onShare={() => onShareItem(item)} onTogglePin={(pinned) => onTogglePin(item, pinned)} onToggleFavorite={(favorite) => { onToggleFavorite(item, favorite); notify(favorite ? "Added to favorites." : "Removed from favorites."); }} folders={folders} folderId={item.folderId} onMoveFolder={(folderId) => void moveItemToFolder(item, folderId)}/> )}</div>{visibleItems.length < filtered.length && <div className="vault-load-more"><button onClick={() => setVisibleCount((count) => count + 24)}>Show {Math.min(24, filtered.length - visibleItems.length)} more <span>({filtered.length - visibleItems.length} left)</span></button></div>}</> : <div className="section-empty"><div className="empty-icon-stack"><div className={`empty-icon-circle ${colors[section.id]}`}>{isScheduleView ? notesTab === "alarm" ? <AlarmClock size={21}/> : <BellRing size={21}/> : <Icon size={21}/>}</div><span>✦</span></div><h3>{query ? "Nothing matches just yet" : isTodoView ? filter === "completed" ? "No completed tasks yet" : "Your next steps start here." : isScheduleView ? `No ${notesTab}s here yet.` : isAccountsSection ? accountTab === "bank" ? "Your bank account space is ready." : "Your internet accounts space is ready." : `Your ${section.label.toLowerCase()} space is ready.`}</h3><p>{query ? "Try another search or clear the filter." : isTodoView ? "Add a task to keep your next step visible. You can check it off whenever it's done." : isScheduleView ? `Add a ${notesTab} to keep an important time on your radar.` : isAccountsSection ? accountTab === "bank" ? "Save account holder, branch, routing and account details without storing login credentials." : "Save service names and sign-in links. Keep passwords and one-time codes out of the vault." : `Start by adding a ${section.singular}. Persora will keep it tidy from there.`}</p><button className="section-add-button" onClick={addSectionRecord}><Plus size={16}/> {isTodoView ? "Add your first task" : isScheduleView ? `Add your first ${notesTab}` : isAccountsSection ? accountTab === "bank" ? "Add your first bank account" : "Add your first internet account" : `Add your first ${section.singular}`}</button></div>}
  </div>;
}

function TodoTaskCard({ item, viewMode, onToggle, onEdit, onDelete, folders, folderId, onMoveFolder }: { item: VaultItem; viewMode: ViewMode; onToggle: (completed: boolean) => void; onEdit: () => void; onDelete: () => void; folders: VaultFolder[]; folderId?: string; onMoveFolder: (folderId: string | null) => void }) {
  const completed = item.metadata.completed === "true";
  const dueDate = item.metadata.dueDate;
  const dueDays = daysUntil(dueDate);
  return <article className={`todo-task-card ${completed ? "todo-completed" : ""} ${viewMode === "list" ? "todo-task-row" : ""}`}>
    <button type="button" className="todo-check-button" aria-label={completed ? `Mark ${item.title} active` : `Complete ${item.title}`} aria-pressed={completed} onClick={() => onToggle(!completed)}><Check size={15}/></button>
    <div className="todo-task-copy"><b>{item.title}</b>{item.metadata.todoDetails && <p>{item.metadata.todoDetails}</p>}
      {dueDate && <span className={`todo-due-date ${!completed && dueDays !== null && dueDays < 0 ? "is-overdue" : !completed && dueDays !== null && dueDays <= 1 ? "is-soon" : ""}`}><CalendarClock size={13}/>{completed ? `Due ${formatDate(dueDate)}` : dueDays === 0 ? "Due today" : dueDays === 1 ? "Due tomorrow" : dueDays !== null && dueDays < 0 ? `Overdue · ${formatDate(dueDate)}` : `Due ${formatDate(dueDate)}`}</span>}
    </div>
    <div className="todo-task-actions"><MoreOptionsMenu label={`${item.title} options`} actions={[{ label: "Edit task", onSelect: onEdit }, { label: "Delete task", danger: true, onSelect: onDelete }]} folders={folders} folderId={folderId} onMoveFolder={onMoveFolder}/></div>
  </article>;
}

function MembershipItemCard({ item, index, viewMode, onOpen, onEdit, onDelete, onShare, onToggleFavorite, folders, folderId, onMoveFolder }: { item: VaultItem; index: number; viewMode: ViewMode; onOpen: () => void; onEdit: () => void; onDelete: () => void; onShare: () => void; onToggleFavorite: (favorite: boolean) => void; folders: VaultFolder[]; folderId?: string; onMoveFolder: (folderId: string | null) => void }) {
  const type = item.metadata.type || "Membership";
  const typeSlug = type.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const memberId = item.metadata.memberId || "MEMBER";
  const expiry = item.metadata.expiryDate ? formatDate(item.metadata.expiryDate) : "No expiry date";
  return <BlurFade delay={Math.min(index * 10, 100)}><MagicCard className={`membership-wallet-card membership-${typeSlug} ${viewMode === "list" ? "membership-wallet-row" : ""}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen()} glowColor="rgba(255,255,255,.18)">
    <div className="membership-card-face"><div className="membership-card-head"><span className="membership-brand-mark"><CreditCard size={18}/></span><span className="membership-type-label">{type} · MEMBER</span><div className="membership-card-actions"><button type="button" className={`tiny-action favorite-action ${item.favorite ? "is-favorite" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(!item.favorite); }} aria-label={item.favorite ? "Remove membership from favorites" : "Add membership to favorites"}><Heart size={14} fill={item.favorite ? "currentColor" : "none"}/></button><MoreOptionsMenu label="Membership options" actions={[{ label: "Edit membership", onSelect: onEdit }, { label: "Share / manage access", icon: Share2, onSelect: onShare }, { label: "Delete membership", icon: Trash2, danger: true, onSelect: onDelete }]} folders={folders} folderId={folderId} onMoveFolder={onMoveFolder}/></div></div><div className="membership-card-main"><h3>{item.title}</h3><p>{item.metadata.organization || "Membership wallet"}</p></div><div className="membership-card-id"><span><small>MEMBER ID</small><b>{memberId}</b></span><span className="membership-barcode" aria-hidden="true"/></div><span className="membership-orbit" aria-hidden="true"/></div>
    <div className="membership-card-footer"><span><small>MEMBERSHIP LEVEL</small><b>{item.metadata.level || "Standard"}</b></span><span><small>VALID THROUGH</small><b>{expiry}</b></span><button type="button" className="membership-open-button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>View <ArrowUpRight size={13}/></button></div>
  </MagicCard></BlurFade>;
}

function ItemCard({ item, section, index, onOpen, onEdit, onDelete, onShare, onTogglePin, onToggleFavorite, folders, folderId, onMoveFolder }: { item: VaultItem; section: SectionDefinition; index: number; onOpen: () => void; onEdit: () => void; onDelete: () => void; onShare: () => void; onTogglePin: (pinned: boolean) => void; onToggleFavorite: (favorite: boolean) => void; folders: VaultFolder[]; folderId?: string; onMoveFolder: (folderId: string | null) => void }) {
  const Icon = section.icon;
  const itemType = (item.metadata.type || "").toLowerCase();
  const isCv = section.id === "documents" && /^(cv|resume)/.test(itemType);
  const isAdmission = section.id === "academics" && itemType.includes("admission");
  const isBankAccount = section.id === "accounts" && item.metadata.accountKind === "Bank Account";
  const accountType = section.id === "accounts" ? isBankAccount ? item.metadata.bankAccountType || "Bank Account" : item.metadata.accountType || "Other" : "";
  const accountTypeSlug = accountType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "other");
  const previewKeys = isCv ? ["targetRole", "location", "email"] : isAdmission ? ["institution", "program", "admissionSession"] : isBankAccount ? ["branch", "currency", "routingNumber"] : section.id === "accounts" ? section.previewKeys.filter((key) => !["accountType", "bankAccountType"].includes(key)) : section.previewKeys;
  const preview = previewKeys.filter((key) => item.metadata[key]).slice(0, 2);
  const subtitle = item.subtitle || (section.id === "notes" ? notePlainText(item.metadata.content) || section.eyebrow : isBankAccount ? [item.metadata.bankName, item.metadata.accountHolder].filter(Boolean).join(" · ") || "Bank account" : section.id === "accounts" ? item.metadata.username || item.metadata.email || section.eyebrow : preview.length ? item.metadata[preview[0]] : section.eyebrow);
  const date = section.dateKey ? item.metadata[section.dateKey] : "";
  const days = daysUntil(date);
  return <BlurFade delay={Math.min(index * 10, 100)}><MagicCard className={`vault-item-card card-${section.color}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen()}><div className="vault-card-top"><div className="vault-card-brandline"><div className={`vault-card-icon ${colors[section.id]} ${accountType ? `account-brand-${accountTypeSlug}` : ""}`}>{isBankAccount ? <Building2 size={17}/> : accountType ? <AccountTypeMark type={accountType}/> : <Icon size={17}/>}</div>{accountType && <span className="account-type-label">{accountType}</span>}</div><div className="vault-card-actions">{section.id === "notes" && <button className={`tiny-action pin-action ${item.pinned ? "is-pinned" : ""}`} onClick={(event) => { event.stopPropagation(); onTogglePin(!item.pinned); }} aria-label={item.pinned ? "Unpin note" : "Pin note"} title={item.pinned ? "Unpin note" : "Pin note"}><Pin size={14} fill={item.pinned ? "currentColor" : "none"}/></button>}<button className={`tiny-action favorite-action ${item.favorite ? "is-favorite" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(!item.favorite); }} aria-label="Toggle favorite"><Heart size={15} fill={item.favorite ? "currentColor" : "none"}/></button><MoreOptionsMenu label="Item options" actions={[{ label: "Edit details", onSelect: onEdit }, { label: "Share / manage access", icon: Share2, onSelect: onShare }, ...(item.file ? [{ label: "View attachment", icon: FileText, onSelect: onOpen }] : []), { label: "Delete record", icon: Trash2, danger: true, onSelect: onDelete }]} folders={folders} folderId={folderId} onMoveFolder={onMoveFolder}/></div></div><div className="vault-card-copy"><h3>{item.title}</h3><p>{subtitle}</p></div><div className="vault-card-metadata">{preview.map((key) => <span className="metadata-chip" key={key}><i/>{key.toLowerCase().includes("date") || key.toLowerCase().includes("expiry") ? formatDate(item.metadata[key]) : item.metadata[key]}</span>)}</div><div className="vault-card-bottom"><span className="saved-label">{item.file ? <button className="file-chip" onClick={(event) => { event.stopPropagation(); onOpen(); }}><FileText size={13}/><span>{item.file.name}</span><small>{humanSize(item.file.size)}</small></button> : <><span className="saved-dot"/>Saved to your vault</>}</span>{days !== null && <span className={`card-date-badge ${days < 0 ? "date-expired" : days <= 30 ? "date-soon" : "date-normal"}`}>{days < 0 ? "Expired" : days === 0 ? "Due today" : `${days} days`}</span>}</div></MagicCard></BlurFade>;
}

function WalletCardItemCard({ item, index, onOpen, onEdit, onDelete, folders, folderId, onMoveFolder }: { item: VaultItem; index: number; onOpen: () => void; onEdit: () => void; onDelete: () => void; folders: VaultFolder[]; folderId?: string; onMoveFolder: (folderId: string | null) => void }) {
  const network = item.metadata.network || "Other";
  const networkSlug = network.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const mastercard = network.toLowerCase() === "mastercard";
  const cardholder = item.metadata.cardholder || item.title || "CARDHOLDER";
  const lastFour = /^\d{4}$/.test(item.metadata.lastFour || "") ? item.metadata.lastFour : "••••";
  const expiry = item.metadata.expiry || [item.metadata.expiryMonth, item.metadata.expiryYear ? item.metadata.expiryYear.slice(-2) : ""].filter(Boolean).join("/") || "••/••";
  return <BlurFade delay={Math.min(index * 10, 100)}><MagicCard className="wallet-card-tile">
    <button type="button" className={`wallet-card-face wallet-brand-${networkSlug}`} onClick={onOpen} aria-label={`View card for ${cardholder}`}>
      <div className="wallet-card-head"><span>{item.metadata.issuer || "PERSORA WALLET"}</span><span className={`wallet-card-network-mark wallet-network-${networkSlug}`} aria-label={`${network} card network`}>{mastercard ? <span className="wallet-mastercard-mark"><i/><i/></span> : network.toUpperCase()}</span></div>
      <span className="wallet-card-chip" aria-hidden="true"><i/></span>
      <div className="wallet-card-number">••••&nbsp;&nbsp; ••••&nbsp;&nbsp; ••••&nbsp;&nbsp; {lastFour}</div>
      <div className="wallet-card-details"><span><b>{cardholder}</b></span><span><b>{expiry}</b></span></div>
    </button>
    <div className="wallet-card-tile-footer"><span className="wallet-card-security-label"><ShieldCheck size={12}/><small>SHERLOCK SECURITY SYSTEM</small></span><MoreOptionsMenu label={`${item.title} options`} actions={[{ label: "Edit card", onSelect: onEdit }, { label: "Delete card", danger: true, onSelect: onDelete }]} folders={folders} folderId={folderId} onMoveFolder={onMoveFolder}/></div>
  </MagicCard></BlurFade>;
}

function SharedDocumentsView({ userId, outgoing, incoming, recordOutgoing, recordIncoming, publicCards, available, onOpen, onPermissionChange, onRevoke, onRevokeRecord }: { userId: string; outgoing: SharedVaultEntry[]; incoming: SharedVaultEntry[]; recordOutgoing: RecordShareEntry[]; recordIncoming: RecordShareEntry[]; publicCards: DigitalBusinessCard[]; available: boolean; onOpen: (entry: SharedVaultEntry) => void; onPermissionChange: (shareId: string, permission: SharePermission) => Promise<void>; onRevoke: (shareId: string) => Promise<void>; onRevokeRecord: (shareId: string) => Promise<void> }) {
  const [tab, setTab] = useState<"outgoing" | "incoming" | "public">("outgoing");
  const [viewMode, setViewMode] = usePageView(userId, "shared");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<RecordShareEntry | null>(null);
  const entries = tab === "outgoing" ? outgoing : incoming;
  const recordEntries = tab === "outgoing" ? recordOutgoing : recordIncoming;
  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The sharing change could not be saved."); }
    finally { setBusyId(""); }
  };
  const recordName = (entry: RecordShareEntry) => entry.resourceType === "contact" ? (entry.record as PersoraContact).name : (entry.record as DigitalBusinessCard).fullName;
  const recordMeta = (entry: RecordShareEntry) => entry.resourceType === "contact" ? [((entry.record as PersoraContact).phoneNumbers[0]?.number), (entry.record as PersoraContact).email].filter(Boolean).join(" · ") || "Contact details shared" : [[(entry.record as DigitalBusinessCard).jobTitle, (entry.record as DigitalBusinessCard).company].filter(Boolean).join(" · "), (entry.record as DigitalBusinessCard).email].filter(Boolean).join(" · ") || "Business card details shared";
  return <div className="shared-view">
    <div className="shared-page-hero"><div className="shared-page-hero-copy"><span className="section-eyebrow">Persora sharing</span><h2>Your connections,<br/>shared thoughtfully.</h2><p>Manage documents and selected contacts shared with Persora members, and review the cards you have published publicly.</p></div><div className="shared-hero-art" aria-hidden="true"><Share2 size={36}/><span>{incoming.length + outgoing.length + recordOutgoing.length + recordIncoming.length + publicCards.length}</span><small>SHARES &amp; PUBLIC CARDS</small></div></div>
    <div className="shared-controls-row"><div className="shared-tabs" role="tablist" aria-label="Shared documents"><button role="tab" aria-selected={tab === "outgoing"} className={tab === "outgoing" ? "active" : ""} onClick={() => { setTab("outgoing"); setError(""); }}>Shared by me <span>{outgoing.length + recordOutgoing.length}</span></button><button role="tab" aria-selected={tab === "incoming"} className={tab === "incoming" ? "active" : ""} onClick={() => { setTab("incoming"); setError(""); }}>Shared with me <span>{incoming.length + recordIncoming.length}</span></button><button role="tab" aria-selected={tab === "public"} className={tab === "public" ? "active" : ""} onClick={() => { setTab("public"); setError(""); }}>Shared in Public <span>{publicCards.length}</span></button></div><ViewModeToggle mode={viewMode} onChange={setViewMode} label="Shared documents layout"/></div>
    {!available && <div className="share-backend-notice"><ShieldCheck size={16}/><span>Persora member sharing is available for signed-in accounts when the cloud API is enabled. Demo public cards are local-only.</span></div>}
    {error && <div className="form-alert error-alert share-page-error" role="alert">{error}</div>}
    {tab === "public" ? (publicCards.length ? (
      <div className={`shared-record-list ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
        {publicCards.map((card) => <MagicCard className="shared-record-shell" key={card.id}>
          <article className="shared-record shared-record-public">
            <span className="shared-record-icon tag-blue"><BriefcaseBusiness size={18}/></span>
            <span className="shared-record-copy"><b>{card.fullName}</b><small>{[card.jobTitle, card.company].filter(Boolean).join(" · ") || "Public digital business card"}</small><small className="shared-public-url">/BusinessCard/{card.cardId}</small></span>
            {card.cardId && <a className="shared-open-button" href={`${window.location.origin}/BusinessCard/${card.cardId}`} target="_blank" rel="noreferrer">View public <ArrowUpRight size={14}/></a>}
          </article>
        </MagicCard>)}
      </div>
    ) : <div className="shared-empty"><span><Globe2 size={22}/></span><h3>No business cards are public</h3><p>Turn on Make Public in a card’s editor. Any public cards you own will appear here.</p></div>) : (
      <>
        {entries.length > 0 && <div className={`shared-record-list ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
          {entries.map((entry) => <MagicCard className="shared-record-shell" key={entry.shareId}>
            <article className="shared-record">
              <button className="shared-record-open" onClick={() => onOpen(entry)}><span className={`shared-record-icon ${colors[entry.item.section]}`}><FileText size={18}/></span><span className="shared-record-copy"><b>{entry.item.title}</b><small>{SECTION_BY_ID[entry.item.section].label} · {entry.item.file?.name || (entry.item.metadata.type || "Persora record")}</small></span><ArrowUpRight size={16}/></button>
              <div className="shared-record-meta"><span className="shared-person"><span>{tab === "outgoing" ? "Shared with" : "Shared by"}</span><b>{tab === "outgoing" ? entry.recipient.fullName : entry.owner.fullName}</b><small>{tab === "outgoing" ? entry.recipient.email : entry.owner.email} · ID {tab === "outgoing" ? entry.recipient.userId : entry.owner.userId}</small></span><span className={`permission-badge permission-${entry.permission}`}>{entry.permission === "edit" ? "Can edit" : entry.permission === "comment" ? "Can comment" : "Can view"}</span></div>
              {tab === "outgoing" && <div className="shared-record-controls"><label>Access<select value={entry.permission} disabled={busyId === entry.shareId} onChange={(event) => void run(entry.shareId, () => onPermissionChange(entry.shareId, event.target.value as SharePermission))}><option value="view">View</option><option value="comment">Comment</option><option value="edit">Edit</option></select></label><button className="share-stop-button" disabled={busyId === entry.shareId} onClick={() => void run(entry.shareId, () => onRevoke(entry.shareId))}>{busyId === entry.shareId ? "Saving…" : "Stop sharing"}</button></div>}
              {tab === "incoming" && <div className="shared-record-controls"><span className="shared-permission-note">Your access: <b>{entry.permission}</b>{entry.permission === "edit" ? " · edits stay with the original owner" : entry.permission === "comment" ? " · comments are enabled" : " · view only"}</span><button className="shared-open-button" onClick={() => onOpen(entry)}>Open document <ArrowRight size={14}/></button></div>}
            </article>
          </MagicCard>)}
        </div>}
        {recordEntries.length > 0 && <div className={`shared-record-list shared-record-list-structured ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
          {recordEntries.map((entry) => <MagicCard className="shared-record-shell" key={entry.shareId}>
            <article className="shared-record">
              <span className={`shared-record-icon ${entry.resourceType === "contact" ? "tag-blue" : "tag-slate"}`}>{entry.resourceType === "contact" ? <ContactRound size={18}/> : <BriefcaseBusiness size={18}/>}</span>
              <span className="shared-record-copy"><b>{recordName(entry)}</b><small>{entry.resourceType === "contact" ? "Shared contact" : "Shared business card"} · {tab === "outgoing" ? `with ${entry.recipient.fullName}` : `by ${entry.owner.fullName}`}</small><small>{recordMeta(entry)}</small></span>
              <button className="shared-open-button" onClick={() => setSelectedRecord(entry)}>View details</button>
              {tab === "outgoing" ? <button className="share-stop-button" disabled={busyId === entry.shareId} onClick={() => void run(entry.shareId, () => onRevokeRecord(entry.shareId))}>{busyId === entry.shareId ? "Removing…" : "Stop sharing"}</button> : <span className="permission-badge permission-view">Shared with you</span>}
            </article>
          </MagicCard>)}
        </div>}
        {!entries.length && !recordEntries.length && <div className="shared-empty"><span><Share2 size={22}/></span><h3>{tab === "outgoing" ? "Nothing shared yet" : "No one has shared with you yet"}</h3><p>{tab === "outgoing" ? "Use Share on a document, contact, or business card to give another Persora member access." : "Documents, contacts, and business cards shared with your account will appear here."}</p></div>}
      </>
    )}
    {selectedRecord && <ModalPortal><SharedRecordDetailsDialog entry={selectedRecord} onClose={() => setSelectedRecord(null)}/></ModalPortal>}
  </div>;
}

function SharedRecordDetailsDialog({ entry, onClose }: { entry: RecordShareEntry; onClose: () => void }) {
  const rows: [string, string][] = [];
  if (entry.resourceType === "contact") {
    const contact = entry.record as PersoraContact;
    if (contact.phoneNumbers.length) rows.push(["Phone numbers", contact.phoneNumbers.map((phone) => `${phone.label}: ${phone.number}`).join(" · ")]);
    if (contact.email) rows.push(["Email", contact.email]);
    if (contact.company) rows.push(["Company", contact.company]);
    if (contact.jobTitle) rows.push(["Job title", contact.jobTitle]);
    if (contact.address) rows.push(["Address", contact.address]);
    if (contact.birthday) rows.push(["Birthday", contact.birthday]);
    if (contact.category) rows.push(["Category", contact.category]);
    if (contact.notes) rows.push(["Notes", contact.notes]);
  } else {
    const card = entry.record as DigitalBusinessCard;
    if (card.jobTitle) rows.push(["Job title", card.jobTitle]);
    if (card.company) rows.push(["Company", card.company]);
    if (card.phoneNumbers.length) rows.push(["Phone numbers", card.phoneNumbers.map((phone) => `${phone.label}: ${phone.number}`).join(" · ")]);
    if (card.email) rows.push(["Email", card.email]);
    if (card.websites.length) rows.push(["Websites", card.websites.join(" · ")]);
    if (card.address) rows.push(["Address", card.address]);
    if (card.bio) rows.push(["About", card.bio]);
    if (card.socialLinks.length) rows.push(["Social", card.socialLinks.map((link) => `${link.platform}: ${link.url}`).join(" · ")]);
    if (card.customLinks.length) rows.push(["Other links", card.customLinks.map((link) => `${link.label}: ${link.url}`).join(" · ")]);
  }
  const title = entry.resourceType === "contact" ? (entry.record as PersoraContact).name : (entry.record as DigitalBusinessCard).fullName;
  return <div className="modal-backdrop record-share-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="record-share-details" role="dialog" aria-modal="true" aria-labelledby="shared-record-title"><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button><span className="section-eyebrow">{entry.resourceType === "contact" ? "Shared contact" : "Shared business card"}</span><h2 id="shared-record-title">{title}</h2><p>Shared {entry.direction === "incoming" ? `with you by ${entry.owner.fullName}` : `with ${entry.recipient.fullName}`} · {formatDate(entry.createdAt)}</p>{rows.length ? <div>{rows.map(([label, value]) => <section key={label}><small>{label}</small><span>{value}</span></section>)}</div> : <p>No additional details were included.</p>}<button className="shared-open-button" onClick={onClose}>Close</button></section></div>;
}

function SettingsView({ user, items, onProfileSave, onPasswordChange, onExport, onImport, onDeleteAccount, onOpenContact, notify }: { user: AppUser; items: VaultItem[]; onProfileSave: (values: { fullName: string; timezone: string; avatarUrl: string }) => Promise<void>; onPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>; onExport: () => void; onImport: (file: File) => Promise<void>; onDeleteAccount: () => Promise<void>; onOpenContact: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [timezone, setTimezone] = useState(user.timezone || "Asia/Dhaka");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "");
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = async () => { setSaving(true); try { await onProfileSave({ fullName, timezone, avatarUrl }); notify("Your profile has been updated."); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't save profile.", "error"); } finally { setSaving(false); } };
  const chooseAvatarPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setAvatarProcessing(true); setAvatarError("");
    try { setAvatarUrl(await encodeProfilePhoto(file)); }
    catch (error) { setAvatarError(error instanceof Error ? error.message : "Couldn't process that photo."); }
    finally { setAvatarProcessing(false); }
  };
  const avatarPreviewUser = { ...user, fullName, avatarUrl };
  const copyUserId = async () => { if (!user.userId) return; try { await navigator.clipboard.writeText(user.userId); notify("Your Persora ID has been copied."); } catch { notify("Copy is unavailable here. Select and copy your ID manually.", "error"); } };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) { notify("The new passwords don't match.", "error"); return; }
    setPasswordSaving(true);
    try {
      await onPasswordChange(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      notify("Password updated. Other sessions have been signed out.");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update your password.", "error"); }
    finally { setPasswordSaving(false); }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { await onImport(file); notify("Your data import is ready."); } catch (error) { notify(error instanceof Error ? error.message : "Import failed.", "error"); } finally { event.currentTarget.value = ""; } };
  const deleteAccount = async () => { try { await onDeleteAccount(); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't delete this account.", "error"); } };
  return <div className="settings-view"><div className="settings-intro settings-profile-hero"><div className="profile-hero-identity"><span className="profile-avatar-large account-avatar-large"><AccountAvatarContent user={avatarPreviewUser}/></span><div><span className="profile-hero-eyebrow">PERSONAL PROFILE</span><h2>{fullName || user.fullName}</h2><p>{user.email}</p><span className={`profile-account-badge ${user.demo ? "is-demo" : ""}`}><i/>{user.demo ? "Demo workspace" : "Active Persora account"}</span></div></div><div className="profile-hero-summary"><span className="profile-summary-label">ACCOUNT TIME ZONE</span><b>{timezone.replace(/_/g, " ")}</b><small>Changes to your profile are private.</small></div></div><div className="settings-layout"><div className="settings-main-column"><section className="settings-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-blue"><UserRound size={17}/></span><div><h3>Profile information</h3><p>Manage the identity and locale linked to your account.</p></div></div><span className="settings-card-status"><span/>PRIVATE PROFILE</span></div><div className="settings-profile-photo"><div className="settings-avatar-main"><span className="avatar settings-avatar-preview"><AccountAvatarContent user={avatarPreviewUser}/></span><span><b>Profile photo or emoji</b><small>Shown in your workspace navigation and saved with your profile.</small></span></div><div className="settings-avatar-actions"><label className="settings-avatar-upload"><UploadCloud size={14}/>{avatarProcessing ? "Preparing…" : "Upload photo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatarPhoto(event)} disabled={avatarProcessing || saving}/></label><button type="button" className="settings-avatar-initials" onClick={() => { setAvatarUrl(""); setAvatarError(""); }}>Use initials</button></div><div className="settings-avatar-emoji-options" role="group" aria-label="Choose a profile emoji">{PROFILE_AVATAR_EMOJI.map((emoji) => <button type="button" key={emoji} className={avatarUrl === `emoji:${emoji}` ? "is-selected" : ""} onClick={() => { setAvatarUrl(`emoji:${emoji}`); setAvatarError(""); }} aria-label={`Choose profile emoji ${emoji}`} aria-pressed={avatarUrl === `emoji:${emoji}`}>{emoji}</button>)}</div><div className="settings-avatar-dicebear"><span className="settings-avatar-dicebear-label">DiceBear Adventurer</span><div className="settings-avatar-dicebear-options" role="group" aria-label="Choose a DiceBear Adventurer avatar">{PROFILE_AVATAR_DICEBEAR.map((avatar) => <button type="button" key={avatar.id} className={avatarUrl === avatar.image ? "is-selected" : ""} onClick={() => { setAvatarUrl(avatar.image); setAvatarError(""); }} aria-label={`Choose ${avatar.name} DiceBear Adventurer avatar`} aria-pressed={avatarUrl === avatar.image} title={avatar.name}><img src={avatar.image} alt="" referrerPolicy="no-referrer"/></button>)}</div></div>{avatarProcessing && <span className="settings-avatar-message" role="status">Preparing a small square profile photo…</span>}{avatarError && <span className="settings-avatar-error" role="alert">{avatarError}</span>}</div><div className="settings-form-grid profile-form-grid"><label className="field-label">Full name<input value={fullName} maxLength={100} onChange={(event) => setFullName(event.target.value)} /></label><label className="field-label">Email address<div className="settings-readonly">{user.email}<LockKeyhole size={13}/></div></label><label className="field-label">Persora ID<div className="settings-readonly settings-id-value"><strong>{user.userId || "Demo workspace"}</strong>{user.userId && <button type="button" className="settings-id-copy" onClick={() => void copyUserId()}>Copy</button>}</div></label><label className="field-label settings-timezone">Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Dhaka">Asia/Dhaka · Bangladesh</option><option value="Asia/Kolkata">Asia/Kolkata · India</option><option value="Asia/Singapore">Asia/Singapore</option><option value="Europe/London">Europe/London</option><option value="UTC">UTC</option></select></label></div><div className="settings-card-footer"><span>Changes are private to your account.</span><button className="settings-save-button" onClick={() => void save()} disabled={saving || avatarProcessing}>{saving ? "Saving…" : <>Save changes <ArrowRight size={14}/></>}</button></div></section><section className="settings-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-blue"><ShieldCheck size={17}/></span><div><h3>Your account &amp; privacy</h3><p>How Persora keeps your space safe.</p></div></div></div><div className="security-rows"><div className="security-row"><span className="security-row-icon"><LockKeyhole size={15}/></span><div><b>Sign-in security</b><small>{user.demo ? "Local sample session" : "7-digit Persora ID · protected server session"}</small></div><span className="security-row-tag"><span/>ACTIVE</span></div><div className="security-row"><span className="security-row-icon"><Fingerprint size={15}/></span><div><b>Personal vault</b><small>{items.length} items across {new Set(items.map((item) => item.section)).size} spaces</small></div><span className="security-row-tag tag-blue-text"><span/>PRIVATE</span></div><div className="security-row"><span className="security-row-icon"><Activity size={15}/></span><div><b>Data access</b><small>Vault access is restricted to your signed-in account.</small></div><span className="security-row-tag">OWNER ONLY</span></div></div>{!user.demo && <form className="settings-password-form" onSubmit={(event) => void changePassword(event)}><h4>Change password</h4><div className="settings-password-grid"><label className="field-label">Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={72} required /></label><label className="field-label">New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={72} required /></label><label className="field-label">Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={72} required /></label></div><button className="settings-save-button" disabled={passwordSaving}>{passwordSaving ? "Updating…" : <>Update password <ArrowRight size={14}/></>}</button></form>}<div className="account-security-note"><ShieldCheck size={14}/><span>Persora never asks for or stores your other online account passwords.</span></div></section><section className="settings-card data-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-peach"><FileText size={17}/></span><div><h3>Your data, your call</h3><p>Export or restore your vault data.</p></div></div></div><div className="data-action-row"><div><b>Download a backup</b><small>Export all records; cloud backups also include attached files.</small></div><button className="outline-action-button" onClick={onExport}>Export data</button></div><label className="data-action-row import-row"><div><b>Import a backup</b><small>Restore a Persora JSON export in this account.</small></div><span className="outline-action-button">Choose file<input type="file" accept=".json,application/json" onChange={(event) => void importFile(event)}/></span></label></section><section className="settings-card danger-zone-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-red"><Trash2 size={17}/></span><div><h3>Delete your account</h3><p>Permanently remove this account and its personal data.</p></div></div></div>{!confirmDelete ? <div className="danger-action-row"><span>This can't be undone. Export a backup first.</span><button className="danger-outline-button" onClick={() => setConfirmDelete(true)}>Delete account</button></div> : <div className="delete-confirm-inline"><b>Are you sure? This permanently deletes your vault and files.</b><button className="danger-outline-button" onClick={() => void deleteAccount()}>Yes, delete account</button><button className="quiet-button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}</section></div><aside className="settings-side-column"><div className="settings-side-card plan-side-card"><div className="plan-sparkle"><Sparkles size={16}/></div><span className="plan-label">YOUR PERSONAL SPACE</span><h3>Calm looks good on you.</h3><p>Everything here is yours to organize, in your own time.</p><div className="plan-side-divider"/><div className="plan-stats"><span>Available spaces</span><b>{Object.keys(SECTION_BY_ID).length}</b></div><div className="plan-stats"><span>Items saved</span><b>{items.length}</b></div><div className="plan-side-foot"><LockKeyhole size={12}/> Private by default</div></div><div className="settings-side-card timezone-card"><div className="timezone-card-icon"><Clock3 size={16}/></div><span className="plan-label">LOCAL TIME</span><h3>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date())}</h3><p>{timezone.replace("_", " ")}</p></div><div className="settings-help-card"><span><CircleHelp size={15}/></span><div><b>Need a hand?</b><small>Your privacy and data belong to you.</small><button onClick={onOpenContact}>Get in touch <ArrowRight size={13}/></button></div></div></aside></div></div>;
}
