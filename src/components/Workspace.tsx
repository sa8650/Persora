import StripedPattern from "./StripedPattern";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Activity, AlarmClock, ArrowRight, ArrowUpRight, AtSign, Bell, BellRing, BookOpen, BriefcaseBusiness, Building2, CalendarClock, Check, ChevronRight, Cloud, Code2, ContactRound, FileImage, Film, Folder, Gamepad2, Globe2, HeartPulse,
  CircleHelp, Clock3, CreditCard, FileText, Fingerprint, Heart, Home, LayoutGrid, Link2, List, Music2, Pin, Play, Search, ShoppingBag, Share2,
  LockKeyhole, LogOut, MoreHorizontal, Plus, Settings, ShieldCheck, Trash2,
  Sparkles, UploadCloud, UserRound, UsersRound, WalletCards, X, type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, SECTION_BY_ID, SECTION_DEFINITIONS } from "../data";
import { ADD_DOCUMENT_DESTINATION_EVENT, ADD_DOCUMENT_HANDOFF_EVENT, CONTACT_CATEGORIES, MEDICAL_RECORD_TYPES } from "../types";
import type { ActiveScheduleAlert, AddDocumentFlowDraft, AppUser, BusinessCardDraft, BusinessSocialPlatform, ContactCategory, ContactDraft, ContactImportProgress, DigitalBusinessCard, MedicalRecord, MedicalRecordDraft, MedicalRecordType, NotesRecordKind, PersoraContact, SectionDefinition, SectionId, ShareNotification, SharePermission, SharedVaultEntry, RecordShareEntry, TimelineDraft, TimelineEvent, TransferProgress, SmartScanFieldDefinition, SmartScanResult, VaultFolder, VaultItem, ViewId } from "../types";
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
import { alarmRingtoneAudioPath, isPagesApiConfigured, smartScanDocument } from "../lib/cloud";
import { editorFieldsFor, matchDocumentTypeSuggestion } from "../lib/editorFields";
import { isSmartScanFileSizeAllowed, SMART_SCAN_MAX_FILE_BYTES, supportsSmartScanFile } from "./SmartScan";
import ImagePreview from "./ImagePreview";
import PdfPreview from "./PdfPreview";
import { BUILTIN_RINGTONES, startBuiltinRingtone } from "../lib/ringtone";
import PersonalFinanceView from "./PersonalFinanceView";

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
  documentEditor?: any;
  documentFocusedItem?: any;
  documentFilePreview?: any;
  documentTypes: string[];
  documentComments?: any;
  onCloseDocumentPanel?: () => void;
  onManageDocumentSharing?: (item: VaultItem) => void;
  onAddDocumentComment?: (body: string) => Promise<void>;
  onDownloadDocumentFile?: (item: VaultItem) => void;
  onSearch: (value: string) => void;
  onNavigate: (view: ViewId) => void;
  onAdd: (section: SectionId, initialMetadata?: Record<string, string>, initialFile?: File | null, initialScanResult?: SmartScanResult | null, initialScanComplete?: boolean, initialProtectedKeys?: string[]) => void;
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
  onSendVerificationCode: () => Promise<{ ok: boolean; alreadyVerified?: boolean; expiresInSeconds?: number }>;
  onVerifyEmailCode: (code: string) => Promise<void>;
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
type AddDocumentSpaceKind = "section" | "contacts" | "medical-records" | "business-cards";
interface AddDocumentTypeOption { label: string; value: string; }
interface AddDocumentSpaceOption {
  id: string; label: string; eyebrow: string; description: string; icon: LucideIcon; color: string;
  kind: AddDocumentSpaceKind; section?: SectionDefinition; typeField?: string; types: AddDocumentTypeOption[];
}
type AddDocumentSelection = { space: AddDocumentSpaceOption; type: AddDocumentTypeOption; file?: File; title?: string; additionalData?: string; scanResult?: SmartScanResult | null; initialScanComplete?: boolean; carriedValues?: Record<string, string>; carriedUserEditedKeys?: string[] };

function addDocumentSpaces(documentTypes: string[]): AddDocumentSpaceOption[] {
  const spaces = SECTION_DEFINITIONS.filter((section) => section.id !== "business-card").map((section) => {
    const configuredField: Partial<Record<SectionId, string>> = {
      documents: "type", academics: "type", family: "relationship", accounts: "accountKind",
      "personal-finance": "financeType", memberships: "type", "wallet-cards": "cardType",
      study: "materialType", notes: "recordType", urls: "urlCategory",
    };
    const typeField = configuredField[section.id];
    let types: AddDocumentTypeOption[];
    if (section.id === "notes") types = [{ label: "Note", value: "note" }, { label: "Task", value: "todo" }, { label: "Reminder", value: "reminder" }, { label: "Alarm", value: "alarm" }];
    else if (section.id === "documents") {
      const options = [...new Set([...(documentTypes.length ? documentTypes : section.fields.find((field) => field.key === "type")?.options || []), "CV / Resume", "Other"])];
      types = options.map((value) => ({ label: ["other", "others"].includes(normalizedAddType(value)) ? "Others" : value, value }));
    } else if (section.id === "subscriptions") types = ["Streaming & entertainment", "Software & cloud", "Membership", "Other subscription"].map((value) => ({ label: value, value }));
    else if (section.id === "purchases") types = ["Receipt / invoice", "Warranty record", "Purchase record"].map((value) => ({ label: value, value }));
    else {
      const field = section.fields.find((entry) => entry.key === typeField);
      types = (field?.options || [section.singular.replace(/^./, (first) => first.toUpperCase())]).map((value) => ({ value, label: value }));
    }
    return { id: section.id, label: section.label, eyebrow: section.eyebrow, description: section.description, icon: section.icon, color: section.color, kind: "section" as const, section, typeField, types };
  });
  const aliasOther = (type: AddDocumentTypeOption): AddDocumentTypeOption => normalizedAddType(type.value) === "other" ? { ...type, label: "Others" } : type;
  return [
    ...spaces.map((space) => {
      const types = space.types.map(aliasOther);
      return { ...space, types: types.some((type) => normalizedAddType(type.value) === "other") ? types : [...types, { label: "Others", value: "Other" }] };
    }),
    { id: "contacts", label: "Contacts", eyebrow: "People, organized", description: "Add a person with the matching contact category preselected.", icon: UsersRound, color: "blue", kind: "contacts", types: CONTACT_CATEGORIES.map((value) => aliasOther({ label: value, value })) },
    { id: "medical-records", label: "Medical Records", eyebrow: "Private health archive", description: "Start a health record with the chosen record type and its relevant fields.", icon: HeartPulse, color: "rose", kind: "medical-records", types: MEDICAL_RECORD_TYPES.map((value) => aliasOther({ label: value, value })) },
    { id: "business-cards", label: "Business cards", eyebrow: "Your digital identity", description: "Create a private or shareable digital business card.", icon: BriefcaseBusiness, color: "slate", kind: "business-cards", types: [{ label: "Digital business card", value: "digital-business-card" }] },
  ];
}
function addDocumentFileSpaces(spaces: AddDocumentSpaceOption[]): AddDocumentSpaceOption[] {
  return spaces.filter((space) => (space.kind === "section" && space.id !== "wallet-cards" && space.id !== "business-card") || space.kind === "medical-records")
    .map((space) => space.id === "notes" ? { ...space, types: space.types.filter((entry) => entry.value === "note") } : space);
}
function normalizedAddType(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function matchAddDocumentType(space: AddDocumentSpaceOption, suggestion: string): AddDocumentTypeOption | undefined {
  if (!suggestion.trim()) return undefined;
  const normalized = normalizedAddType(suggestion);
  const direct = space.types.find((entry) => normalizedAddType(entry.label) === normalized || normalizedAddType(entry.value) === normalized);
  if (direct) return direct;
  if (space.id === "documents") {
    const matched = matchDocumentTypeSuggestion(suggestion, space.types.map((entry) => entry.value));
    if (matched) return space.types.find((entry) => entry.value === matched);
  }
  const keywordRules: Array<[RegExp, RegExp]> = [
    [/passport/i, /passport/i], [/\b(nid|national id|identity card)\b/i, /nid|national id/i], [/birth certificate/i, /birth certificate/i],
    [/driv(e|ing).{0,8}(licen[cs]e|permit)|licen[cs]e/i, /driving|licen/i], [/\b(visa|residence permit|work permit)\b/i, /visa|permit/i],
    [/transcript/i, /transcript/i], [/mark\s*sheet/i, /mark sheet/i], [/admission/i, /admission/i], [/degree/i, /degree|bachelor|master/i],
    [/prescription|medicine/i, /prescription/i], [/lab\s*(test|report)|blood test/i, /lab test/i], [/x.?ray|imaging|scan/i, /imaging|scan/i],
    [/vaccin/i, /vaccin/i], [/discharge/i, /discharge summary/i], [/warranty/i, /warranty/i], [/receipt|invoice/i, /receipt|invoice/i],
    [/subscription|streaming/i, /subscription|streaming/i], [/bank account|bank statement/i, /bank account/i], [/photo|lecture|slides/i, /lecture slides|image/i],
  ];
  const matchedRule = keywordRules.find(([source]) => source.test(suggestion));
  if (matchedRule) { const target = space.types.find((entry) => matchedRule[1].test(entry.label) || matchedRule[1].test(entry.value)); if (target) return target; }
  const stopWords = new Set(["document", "record", "file", "card", "certificate", "official", "personal", "other"]);
  const tokens = normalized.split(" ").filter((token) => token.length > 2 && !stopWords.has(token));
  let best: AddDocumentTypeOption | undefined; let bestScore = 0;
  for (const option of space.types) { const text = normalizedAddType(`${option.label} ${option.value}`); const score = tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0); if (score > bestScore) { best = option; bestScore = score; } }
  return bestScore > 0 ? best : undefined;
}
function otherAddDocumentType(space: AddDocumentSpaceOption): AddDocumentTypeOption | undefined {
  return space.types.find((entry) => ["other", "others"].includes(normalizedAddType(entry.value)) || ["other", "others"].includes(normalizedAddType(entry.label)));
}
function addDocumentFileTitle(fileName: string) {
  const dot = fileName.lastIndexOf("."); const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled document";
}
const addDocumentDestinationKeys = new Set(["type", "accountKind", "financeType", "materialType", "relationship", "cardType", "urlCategory", "recordType", "addFlowType"]);
const addDocumentNonDataKeys = new Set(["enabled", "ringtoneId", "ringtoneName", "completed", "favorite", "pinned", "snoozedUntil"]);
function combineCarryData(...blocks: string[]) { return blocks.map((block) => block.trim()).filter(Boolean).filter((block, index, all) => all.indexOf(block) === index).join("\n\n"); }
function mapAddDocumentCarry(space: AddDocumentSpaceOption, type: AddDocumentTypeOption, values: Record<string, string>, scanAdditionalData: string) {
  const allowed = space.kind === "section" && space.section
    ? new Set(editorFieldsFor(space.id as SectionId, type.value, space.id === "accounts" ? type.value : values.accountKind || "", space.id === "personal-finance" ? type.value : values.financeType || "", space.id === "study" ? type.value : values.materialType || "").map((field) => field.key))
    : space.kind === "medical-records" ? new Set(["title", "recordType", "recordDate", "provider", "hospital", "specialty", "diagnosis", "testName", "testResult", "medicationNotes", "followUpDate", "notes", "additionalData"])
      : new Set<string>();
  const mapped: Record<string, string> = {};
  const unmatched: string[] = [];
  Object.entries(values).forEach(([key, value]) => {
    if (!value.trim() || key === "title" || key === "additionalData" || addDocumentNonDataKeys.has(key)) return;
    if (allowed.has(key) && !addDocumentDestinationKeys.has(key)) mapped[key] = value;
    else unmatched.push(`${key}: ${value}`);
  });
  const additionalData = combineCarryData(values.additionalData || "", ...unmatched, scanAdditionalData);
  return { mapped, additionalData };
}
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

export default function Workspace({ user, items, sharedByMe, sharedWithMe, recordSharesByMe, recordSharesWithMe, contacts, businessCards, notifications, ringingSchedules, sharingAvailable, timelineEvents, timelineOnline, timelineSaving, onSaveTimelineEvent, onDeleteTimelineEvent, onOpenTimelineAttachment, medicalRecords, maxUploadMb, onSaveMedicalRecord, onDeleteMedicalRecord, onOpenMedicalRecordFile, onPreviewMedicalRecordFile, onRefreshMedicalRecords, view, search, pendingPlanId, documentTypes, onSearch, onNavigate, onAdd, onSaveItem, onAddTodo, onEditTodoItem, onToggleTodo, onToggleSchedule, onDismissSchedule, onSnoozeSchedule, onOpenItem, onEditItem, onDeleteItem, onShareItem, onOpenSharedEntry, onChangeSharePermission, onRevokeShare, onShareRecord, onRevokeRecordShare, onMarkNotificationsRead, onToggleFavorite, onTogglePin, onMoveVaultItem, onSaveContact, onDeleteContact, onMergeContacts, onImportContacts, onRefreshContacts, onSaveBusinessCard, onDeleteBusinessCard, onRefreshBusinessCards, onSignOut, onOpenAdmin, onOpenPublicPage, onOpenContact, onProfileSave, onSendVerificationCode, onVerifyEmailCode, onPasswordChange, onExport, onImport, onDeleteAccount, notify }: WorkspaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [addDocumentOpen, setAddDocumentOpen] = useState(false);
  const [addDocumentDraft, setAddDocumentDraft] = useState<AddDocumentFlowDraft | null>(null);
  const [pendingContactAdd, setPendingContactAdd] = useState<ContactCategory | null>(null);
  const [pendingMedicalAdd, setPendingMedicalAdd] = useState<MedicalRecordType | null>(null);
  const [pendingMedicalFile, setPendingMedicalFile] = useState<File | null>(null);
  const [pendingMedicalTitle, setPendingMedicalTitle] = useState("");
  const [pendingMedicalAdditionalData, setPendingMedicalAdditionalData] = useState("");
  const [pendingMedicalScanResult, setPendingMedicalScanResult] = useState<SmartScanResult | null>(null);
  const [pendingMedicalScanComplete, setPendingMedicalScanComplete] = useState(false);
  const [pendingMedicalValues, setPendingMedicalValues] = useState<Record<string, string> | null>(null);
  const [pendingMedicalProtectedKeys, setPendingMedicalProtectedKeys] = useState<string[]>([]);
  const [pendingBusinessCardCreate, setPendingBusinessCardCreate] = useState(0);
  const section = getSection(view);
      const familyMembers = useMemo(() => items.filter((item) => item.section === "family"), [items]);
  const canUpload = !user.demo && user.uploadsEnabled === true;
  const titleInfo = section ? { title: section.label, eyebrow: section.eyebrow, icon: section.icon } : viewInfo[view] || viewInfo.dashboard;
    useEffect(() => {
    if (!sidebarOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [sidebarOpen]);
  const updateView = (next: ViewId) => { onNavigate(next); setSidebarOpen(false); onSearch(""); setProfileMenu(false); };
  const openAddDocument = (draft: AddDocumentFlowDraft | null = null) => { setAddDocumentDraft(draft); setAddDocumentOpen(true); };
  useEffect(() => {
    const handleDestinationChange = (event: Event) => {
      const draft = (event as CustomEvent<AddDocumentFlowDraft>).detail;
      if (!draft?.file) return;
      openAddDocument(draft);
    };
    window.addEventListener(ADD_DOCUMENT_DESTINATION_EVENT, handleDestinationChange);
    return () => window.removeEventListener(ADD_DOCUMENT_DESTINATION_EVENT, handleDestinationChange);
  }, []);
  const handleAddDocumentSelection = ({ space, type, file, title, additionalData, scanResult, initialScanComplete, carriedValues = {}, carriedUserEditedKeys = [] }: AddDocumentSelection) => {
    const previousDraft = addDocumentDraft;
    if (previousDraft) window.dispatchEvent(new CustomEvent(ADD_DOCUMENT_HANDOFF_EVENT, { detail: previousDraft.spaceId }));
    setAddDocumentOpen(false);
    setAddDocumentDraft(null);
    const carried = mapAddDocumentCarry(space, type, carriedValues, scanResult?.fields.additionalData?.value || "");
    const mergedAdditionalData = combineCarryData(additionalData || "", carried.additionalData);
    const finalTitle = carriedValues.title?.trim() || title || (file ? addDocumentFileTitle(file.name) : "");
    if (space.kind === "contacts") {
      setPendingContactAdd(type.value as ContactCategory);
      updateView("contacts");
      return;
    }
    if (space.kind === "medical-records") {
      const medicalValues = { ...carried.mapped, title: finalTitle, recordType: type.value, additionalData: mergedAdditionalData };
      setPendingMedicalAdd(type.value as MedicalRecordType);
      setPendingMedicalFile(file || null);
      setPendingMedicalTitle(finalTitle);
      setPendingMedicalAdditionalData(mergedAdditionalData);
      setPendingMedicalScanResult(scanResult || null);
      setPendingMedicalScanComplete(Boolean(initialScanComplete));
      setPendingMedicalValues(medicalValues);
      setPendingMedicalProtectedKeys(carriedUserEditedKeys);
      updateView("medical-records");
      return;
    }
    if (space.kind === "business-cards") {
      setPendingBusinessCardCreate((request) => request + 1);
      updateView("business-card");
      return;
    }
    const metadata: Record<string, string> = { ...carried.mapped };
    if (space.typeField) metadata[space.typeField] = type.value;
    else metadata.addFlowType = type.label;
    if (space.id === "notes") metadata.recordType = type.value;
    if (file) {
      metadata.title = finalTitle;
      metadata.additionalData = mergedAdditionalData;
    }
    onAdd(space.id as SectionId, metadata, file, scanResult || null, Boolean(initialScanComplete), carriedUserEditedKeys);
  };
  const searchEntries: { result: SearchResult; select: () => void }[] = [
    ...[...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
      const searchText = Object.entries(item.metadata)
        .filter(([key]) => {
          if (item.section === "wallet-cards") return ["network", "cardType", "issuer", "currency"].includes(key);
          if (item.section === "accounts" && item.metadata.accountKind === "Bank Account") return !["accountNumber", "routingNumber", "swiftCode", "iban"].includes(key);
          return true;
        })
        .map(([key, value]) => `${key} ${key === "member" ? (value === "me" || value === "Me" ? "Me" : familyMembers.find((member) => member.id === value)?.title || (/^[0-9a-f-]{30,}$/i.test(value) ? "family member" : value)) : item.section === "notes" && key === "content" ? notePlainText(value) : value}`)
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
    { label: "Add a document", icon: <Plus className="h-4 w-4"/>, shortcut: "D", onClick: () => { onSearch(""); openAddDocument(); } },
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
  const documentWorkspace = sectionView;

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
    <div className="workspace-main relative"><StripedPattern className="workspace-striped-pattern pointer-events-none" /><header className="workspace-topbar"><button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open workspace sections" aria-expanded={sidebarOpen}>Sections</button><div className={`breadcrumb-area ${section ? "breadcrumb-section-hidden" : ""}`}><span className="breadcrumb-overline">{titleInfo.eyebrow}</span><div className="breadcrumb-title"><h1>{titleInfo.title}</h1>{view === "dashboard" && <span className="live-pill"><span/>Private workspace</span>}</div></div><div className="topbar-actions"><button type="button" className="workspace-add-document" onClick={() => openAddDocument()} aria-haspopup="dialog" aria-expanded={addDocumentOpen} aria-controls="add-document-drawer"><Plus size={15}/><span>Add document</span></button><button type="button" className="global-search-trigger" onClick={() => setSearchModalOpen(true)} aria-label="Search your vault" aria-haspopup="dialog" aria-expanded={searchModalOpen}><Search size={16}/><span>Search your vault…</span><kbd>Ctrl/⌘ K</kbd></button><div className="notification-wrap"><button className={`notification-button icon-button ${notificationOpen ? "button-pressed" : ""}`} onClick={() => { const opening = !notificationOpen; setNotificationOpen(opening); if (opening) onMarkNotificationsRead(); }} aria-label={`Notifications${notifications.some((notification) => !notification.readAt) ? ", unread updates" : ""}`} aria-expanded={notificationOpen}><Bell size={17}/>{notifications.some((notification) => !notification.readAt) && <span className="notification-dot"/>}</button>{notificationOpen && <div className="notification-popover"><div className="notification-head"><div><b>Notifications</b><span>Reminders, alarms, and sharing activity</span></div><div className="notification-head-actions">{notificationPermission === "default" && <button className="notification-enable" onClick={async () => { try { const permission = await Notification.requestPermission(); setNotificationPermission(permission); if (permission === "granted") notify("Desktop notifications are enabled."); } catch { notify("Browser notifications are unavailable here.", "error"); } }}>Enable alerts</button>}<button className="plain-icon" onClick={() => setNotificationOpen(false)} aria-label="Close notifications">×</button></div></div>{notifications.length ? notifications.slice(0, 12).map((notification) => <button className="notification-row" key={notification.id} onClick={() => { const scheduleItem = notification.kind === "reminder" || notification.kind === "alarm" ? items.find((item) => notification.id.startsWith(`schedule:${item.id}:`)) : undefined; if (scheduleItem) onOpenItem(scheduleItem); else if (notification.kind === "reminder" || notification.kind === "alarm") updateView("notes"); else updateView("shared"); setNotificationOpen(false); }}><span className={`notification-icon ${notification.kind === "reminder" ? "tag-orange" : notification.kind === "alarm" ? "tag-violet" : "tag-blue"}`}>{notification.kind === "reminder" ? <BellRing size={14}/> : notification.kind === "alarm" ? <AlarmClock size={14}/> : <Share2 size={14}/>}</span><span><b>{notification.actorName}</b><small>{notification.message}</small></span><span className="notification-time">{new Date(notification.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>) : <div className="notification-empty">You're all caught up.</div>}{(notificationPermission === "unsupported" || notificationPermission === "denied") && <div className="notification-footnote">{notificationPermission === "denied" ? "Desktop alerts are blocked by your browser settings. In-app reminders still work while Persora is open." : "Desktop alerts aren’t supported in this browser. In-app reminders still work while Persora is open."}</div>}</div>}</div><button className="topbar-avatar avatar" onClick={() => updateView("settings")} aria-label="Open account settings"><AccountAvatarContent user={user}/></button></div></header>
      <main className={`workspace-content `}>{view === "dashboard" && <DashboardView user={user} items={items} onNavigate={updateView} onOpenItem={onOpenItem} onAdd={onAdd} onAddDocument={() => openAddDocument()} onToggleFavorite={onToggleFavorite}/>} {view === "timeline" && <TimelineView events={timelineEvents} items={items} online={timelineOnline} canPost={!user.demo && sharingAvailable} canUpload={canUpload} onUpgrade={!user.demo ? () => updateView("billing") : undefined} saving={timelineSaving} onSave={onSaveTimelineEvent} onDelete={onDeleteTimelineEvent} onOpenItem={onOpenItem} onOpenAttachment={onOpenTimelineAttachment} notify={notify}/>} {view === "medical-records" && <Suspense fallback={<div className="medical-loading">Loading your private health archive…</div>}><MedicalRecordsView userId={user.id} records={medicalRecords} contacts={contacts} items={items} demoMode={user.demo || false} connected={sharingAvailable} maxUploadMb={maxUploadMb} canUpload={canUpload} onUpgrade={!user.demo ? () => updateView("billing") : undefined} initialAddType={pendingMedicalAdd} initialAddFile={pendingMedicalFile} initialAddTitle={pendingMedicalTitle} initialAddAdditionalData={pendingMedicalAdditionalData} initialAddScanResult={pendingMedicalScanResult} initialAddScanComplete={pendingMedicalScanComplete} initialAddValues={pendingMedicalValues} initialAddProtectedKeys={pendingMedicalProtectedKeys} onAddRequestHandled={() => { setPendingMedicalAdd(null); setPendingMedicalFile(null); setPendingMedicalTitle(""); setPendingMedicalAdditionalData(""); setPendingMedicalScanResult(null); setPendingMedicalScanComplete(false); setPendingMedicalValues(null); setPendingMedicalProtectedKeys([]); }} onChangeAddDocumentDestination={(draft) => window.dispatchEvent(new CustomEvent(ADD_DOCUMENT_DESTINATION_EVENT, { detail: draft }))} onRefresh={onRefreshMedicalRecords} onSave={onSaveMedicalRecord} onDelete={onDeleteMedicalRecord} onOpenFile={onOpenMedicalRecordFile} onPreviewFile={onPreviewMedicalRecordFile} notify={notify}/></Suspense>} {view === "personal-finance" && <PersonalFinanceView items={items} contacts={contacts} onSave={onSaveItem} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} onNavigate={updateView}/>} {documentWorkspace} {view === "shared" && <SharedDocumentsView userId={user.id} outgoing={sharedByMe} incoming={sharedWithMe} recordOutgoing={recordSharesByMe} recordIncoming={recordSharesWithMe} publicCards={businessCards.filter((card) => card.isPublic)} available={sharingAvailable} onOpen={onOpenSharedEntry} onPermissionChange={onChangeSharePermission} onRevoke={onRevokeShare} onRevokeRecord={onRevokeRecordShare}/>} {view === "contacts" && <ContactsView userId={user.id} contacts={contacts} demoMode={user.demo || false} connected={sharingAvailable} canUpload={canUpload} onUpgrade={!user.demo ? () => updateView("billing") : undefined} initialAddCategory={pendingContactAdd} onAddRequestHandled={() => setPendingContactAdd(null)} onSave={onSaveContact} onDelete={onDeleteContact} onShare={(contact, recipient) => onShareRecord("contact", contact.id, recipient)} onMerge={onMergeContacts} onImport={onImportContacts} onRefresh={onRefreshContacts} notify={notify}/>} {view === "business-card" && <BusinessCardsView userId={user.id} cards={businessCards} demoMode={user.demo || false} connected={sharingAvailable} canUpload={canUpload} onUpgrade={!user.demo ? () => updateView("billing") : undefined} initialCreateRequestId={pendingBusinessCardCreate} onAddRequestHandled={() => setPendingBusinessCardCreate(0)} onSave={onSaveBusinessCard} onDelete={onDeleteBusinessCard} onShare={(card, recipient) => onShareRecord("business_card", card.id, recipient)} onRefresh={onRefreshBusinessCards} notify={notify}/>} {view === "billing" && <BillingView initialPlanId={pendingPlanId} notify={notify}/>} {view === "settings" && <SettingsView user={user} items={items} onProfileSave={onProfileSave} onSendVerificationCode={onSendVerificationCode} onVerifyEmailCode={onVerifyEmailCode} onPasswordChange={onPasswordChange} onExport={onExport} onImport={onImport} onDeleteAccount={onDeleteAccount} onOpenContact={onOpenContact} notify={notify}/>}</main>
      <footer className="workspace-footer"><span className="workspace-footer-brand">Persora</span><span>Powered by Dexter Studio</span><span className="workspace-footer-security"><ShieldCheck size={13}/> Sherlock Security System</span><nav aria-label="Legal and contact"><button onClick={() => onOpenPublicPage("/privacy")}>Privacy</button><button onClick={() => onOpenPublicPage("/terms")}>Terms</button><button onClick={onOpenContact}>Contact</button></nav></footer>
    </div>
    <ModalPortal><SearchModal modal open={searchModalOpen} onOpenChange={(open) => { setSearchModalOpen(open); if (!open) onSearch(""); }} hotkey="k" placeholder="Search records, people, files…" tags={searchTags} results={searchResults} quickActions={searchQuickActions} files={searchFiles} defaultQuery={search} onQueryChange={onSearch} onSelectResult={(result) => searchEntries.find((entry) => entry.result.href === result.href)?.select()} overlayClassName="z-[100]"/></ModalPortal>
    {addDocumentOpen && <AddDocumentDrawer key={addDocumentDraft ? `change:${addDocumentDraft.spaceId}:${addDocumentDraft.typeValue}:${addDocumentDraft.file.name}` : "new"} initialDraft={addDocumentDraft} documentTypes={documentTypes} canUpload={canUpload} maxUploadMb={maxUploadMb} onUpgrade={!user.demo ? () => { setAddDocumentOpen(false); setAddDocumentDraft(null); updateView("billing"); } : undefined} onClose={() => { setAddDocumentOpen(false); setAddDocumentDraft(null); }} onContinue={handleAddDocumentSelection}/>}
    {ringingSchedules[0] && <RingingScheduleDialog alert={ringingSchedules[0]} onDismiss={() => onDismissSchedule(ringingSchedules[0])} onSnooze={() => onSnoozeSchedule(ringingSchedules[0])}/ >}
  </div>;
}

function AddDocumentDrawer({ initialDraft, documentTypes, canUpload, maxUploadMb, onUpgrade, onClose, onContinue }: { initialDraft: AddDocumentFlowDraft | null; documentTypes: string[]; canUpload: boolean; maxUploadMb: number; onUpgrade?: () => void; onClose: () => void; onContinue: (selection: AddDocumentSelection) => void }) {
  const spaces = useMemo(() => addDocumentSpaces(documentTypes), [documentTypes]);
  const fileSpaces = useMemo(() => addDocumentFileSpaces(spaces), [spaces]);
  const [step, setStep] = useState<"choose" | "preview" | "destination">(initialDraft ? "destination" : "choose");
  const [destinationMode, setDestinationMode] = useState<"file" | "manual">("file");
  const [file, setFile] = useState<File | null>(initialDraft?.file || null);
  const [spaceId, setSpaceId] = useState(initialDraft?.spaceId || "");
  const [typeValue, setTypeValue] = useState(initialDraft?.typeValue || "");
  const [scanResult, setScanResult] = useState<SmartScanResult | null>(initialDraft?.scanResult || null);
  const [scanError, setScanError] = useState(initialDraft?.scanError || "");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanAttempted, setScanAttempted] = useState(Boolean(initialDraft?.scanAttempted));
  const [previewReady, setPreviewReady] = useState(Boolean(initialDraft));
  const [selectionTouched, setSelectionTouched] = useState(!initialDraft);
  const previewFileRef = useRef<File | null>(initialDraft?.file || null);
  const scanStartedRef = useRef<File | null>(null);
  const handoffStartedRef = useRef(false);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  const activeSpaces = destinationMode === "file" ? fileSpaces : spaces;
  const space = activeSpaces.find((entry) => entry.id === spaceId);
  const type = space?.types.find((entry) => entry.value === typeValue);
  const isPdf = Boolean(file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name)));
  const isBrowserImage = Boolean(file && (["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp"].includes(file.type.toLowerCase()) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)));
  const canScanFile = Boolean(file && canUpload && isPagesApiConfigured && supportsSmartScanFile(file) && isSmartScanFileSizeAllowed(file.size));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); drawer.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || active === drawer || !drawer.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === drawer || !drawer.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    drawerRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const acceptFile = (candidate?: File) => {
    if (!candidate) return;
    if (!canUpload) { setFileError("New file uploads require an active paid plan."); return; }
    const limit = Math.max(1, Number(maxUploadMb) || 25) * 1024 * 1024;
    if (candidate.size > limit) { setFileError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setFile(candidate); previewFileRef.current = candidate; setFileError(""); setScanResult(null); setScanError(""); setScanAttempted(false); setPreviewReady(false);
    scanStartedRef.current = null; handoffStartedRef.current = false; setSelectionTouched(true); setSpaceId(""); setTypeValue(""); setDestinationMode("file"); setStep("preview");
  };
  const chooseSpace = (nextId: string) => {
    setSelectionTouched(true); handoffStartedRef.current = false; setSpaceId(nextId);
    const nextSpace = activeSpaces.find((entry) => entry.id === nextId);
    const guessed = nextSpace && scanResult?.documentType ? matchAddDocumentType(nextSpace, scanResult.documentType) : undefined;
    setTypeValue(scanResult && nextSpace ? (guessed || otherAddDocumentType(nextSpace))?.value || "" : "");
  };
  const runSmartScan = useCallback(async (retry = false) => {
    const sourceFile = file;
    if (!sourceFile || scanBusy) return;
    if (!canUpload || !isPagesApiConfigured || !supportsSmartScanFile(sourceFile) || !isSmartScanFileSizeAllowed(sourceFile.size)) {
      setScanResult(null); setScanError("Smart Scan isn't available for this file. Choose a destination and continue manually."); setSpaceId(""); setTypeValue(""); setScanAttempted(true); setStep("destination"); return;
    }
    if (!retry && scanStartedRef.current === sourceFile) return;
    scanStartedRef.current = sourceFile; setScanAttempted(true); setScanBusy(true); setScanError("");
    try {
      const fields: SmartScanFieldDefinition[] = [
        { key: "suggestedSpace", label: "Best-fit Persora space", kind: "select", options: fileSpaces.map((entry) => entry.label) },
        { key: "additionalData", label: "Additional Data", kind: "textarea" },
      ];
      const result = await smartScanDocument(sourceFile, "documents", fields, retry);
      setScanResult(result);
      const suggestedSpace = fileSpaces.find((entry) => entry.label.toLocaleLowerCase() === result.fields.suggestedSpace?.value.trim().toLocaleLowerCase());
      const typeMatches = result.documentType ? fileSpaces.map((entry) => ({ space: entry, type: matchAddDocumentType(entry, result.documentType) })).filter((entry) => entry.type) : [];
      const documentsSpace = fileSpaces.find((entry) => entry.id === "documents");
      const classifiedType = suggestedSpace ? matchAddDocumentType(suggestedSpace, result.documentType) : undefined;
      const inferred = typeMatches.length === 1 ? typeMatches[0] : undefined;
      const recognizedSpace = classifiedType ? suggestedSpace : inferred?.space;
      const recognizedType = classifiedType || inferred?.type;
      const recommendedSpace = recognizedSpace || documentsSpace;
      const recommendedType = recognizedType || (documentsSpace ? otherAddDocumentType(documentsSpace) : undefined);
      setSpaceId(recommendedSpace?.id || ""); setTypeValue(recommendedType?.value || ""); setScanError(""); setStep("destination");
    } catch {
      setScanResult(null); setScanError("Smart Scan couldn't read this file. Choose a space and type manually."); setSpaceId(""); setTypeValue(""); setStep("destination");
    } finally { setScanBusy(false); }
  }, [file, scanBusy, canUpload, fileSpaces]);

  useEffect(() => {
    if (step !== "preview" || !file || !previewReady || !canScanFile || scanBusy || scanStartedRef.current === file) return;
    void runSmartScan(false);
  }, [step, file, previewReady, canScanFile, scanBusy, runSmartScan]);
  useEffect(() => {
    if (step !== "preview" || !file || isPdf || isBrowserImage) return;
    const frame = window.requestAnimationFrame(() => { if (previewFileRef.current === file) setPreviewReady(true); });
    return () => window.cancelAnimationFrame(frame);
  }, [step, file, isPdf, isBrowserImage]);

  const continueToEditor = () => {
    if (!space || !type) return;
    const initialScanComplete = Boolean(file && (scanError || (!scanResult && (scanAttempted || initialDraft?.scanAttempted))));
    const carriedValues = initialDraft?.values || {};
    const mergedAdditionalData = combineCarryData(carriedValues.additionalData || "", scanResult?.fields.additionalData?.value || "");
    onContinue({
      space, type,
      ...(file ? { file, title: carriedValues.title || addDocumentFileTitle(file.name), additionalData: mergedAdditionalData, scanResult: scanError ? null : scanResult, initialScanComplete } : {}),
      carriedValues,
      carriedUserEditedKeys: initialDraft?.userEditedKeys || [],
    });
  };
  useEffect(() => {
    if (step !== "destination" || scanBusy || !space || !type || handoffStartedRef.current) return;
    if (initialDraft && !selectionTouched) return;
    const readyToOpen = destinationMode === "manual" || !file || scanAttempted || Boolean(scanError);
    if (!readyToOpen) return;
    handoffStartedRef.current = true;
    continueToEditor();
  }, [step, scanBusy, spaceId, typeValue, destinationMode, file, scanAttempted, scanError, selectionTouched]);
  const useManualDestination = () => {
    setFile(null); previewFileRef.current = null; setDestinationMode("manual"); setScanResult(null); setScanError(""); setScanAttempted(false); setPreviewReady(false); scanStartedRef.current = null; handoffStartedRef.current = false; setSelectionTouched(true); setSpaceId(""); setTypeValue(""); setStep("destination");
  };

  return <ModalPortal><div className="add-document-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside id="add-document-drawer" ref={drawerRef} tabIndex={-1} className="add-document-drawer" role="dialog" aria-modal="true" aria-labelledby="add-document-drawer-title">
      <header className="add-document-drawer-header"><span className="add-document-drawer-mark"><FileText size={19}/></span><div><span className="section-eyebrow">NEW VAULT ENTRY</span><h2 id="add-document-drawer-title">Add document</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close add document drawer"><X size={18}/></button></header>
      <div className="add-document-drawer-body">
        {step === "choose" && <>
          <p className="add-document-drawer-intro">Start with a file. Persora previews it locally, then Smart Scan can suggest the best space and document type.</p>
          <div className="add-document-methods">
            <button type="button" className="add-document-method-card is-primary" onClick={() => fileInputRef.current?.click()} disabled={!canUpload}><span className="add-document-method-icon"><UploadCloud size={18}/></span><span><b>Choose File</b><small>Preview, scan and review before saving</small></span><ArrowRight size={16}/></button>
            <button type="button" className="add-document-method-card is-deferred" disabled aria-disabled="true"><span className="add-document-method-icon"><Sparkles size={18}/></span><span><b>Scan &amp; Upload</b><small>Coming soon</small></span><span className="add-document-coming-soon">SOON</span></button>
          </div>
          <input ref={fileInputRef} className="add-document-hidden-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,application/pdf,image/*" onChange={(event) => { acceptFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/>
          {fileError && <p className="add-document-inline-error" role="alert">{fileError}</p>}
          {!canUpload && <div className="add-document-upload-locked"><LockKeyhole size={15}/><span>New uploads require an active paid plan.</span>{onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}</div>}
          <button type="button" className="add-document-manual-link" onClick={useManualDestination}>Add a record without a file</button>
        </>}
        {step === "preview" && file && <>
          <p className="add-document-drawer-intro">Review your file before sending it to Smart Scan. The original stays in this browser until you Save the finished record.</p>
          <div className="add-document-file-preview">{isPdf && previewUrl ? <PdfPreview src={previewUrl} name={file.name} onReady={() => { if (previewFileRef.current === file) setPreviewReady(true); }}/> : isBrowserImage && previewUrl ? <ImagePreview src={previewUrl} name={file.name} onReady={() => { if (previewFileRef.current === file) setPreviewReady(true); }}/> : <div className="add-document-preview-unavailable"><FileImage size={25}/><b>{file.name}</b><span>This format can't be rendered in the browser, but the file remains local until you continue.</span></div>}</div>
          <div className="add-document-file-meta"><span className="add-document-file-icon"><FileText size={17}/></span><span><b>{file.name}</b><small>{humanSize(file.size)} · Previewed locally</small></span><button type="button" className="upload-replace" onClick={() => fileInputRef.current?.click()} disabled={!canUpload || scanBusy}>Change file</button></div>
          <input ref={fileInputRef} className="add-document-hidden-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,application/pdf,image/*" onChange={(event) => { acceptFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/>
          {file.size > SMART_SCAN_MAX_FILE_BYTES && <p className="add-document-scan-hint">Smart Scan supports files up to 7 MB. You can still choose a destination and save this file.</p>}
          {!isPagesApiConfigured && <p className="add-document-scan-hint">Smart Scan isn't connected right now. You can choose a destination manually.</p>}
          {scanBusy && <div className="add-document-scan-running" role="status"><span className="spinner"/><span><b>Uploading to Smart Scan…</b><small>OCR will start automatically. The vault copy is not stored until you Save.</small></span></div>}
        </>}
        {step === "destination" && <>
          {destinationMode === "file" && !scanError && scanResult && (scanResult.documentType || scanResult.fields.suggestedSpace?.value) && <div className="add-document-suggestion" role="status"><Sparkles size={15}/><span><b>{scanResult.documentType ? `Smart Scan suggests ${scanResult.documentType}` : "Smart Scan suggested a destination"}</b><small>{[scanResult.documentType ? `${scanResult.documentTypeConfidence} confidence` : "", scanResult.fields.suggestedSpace?.value ? `Space: ${scanResult.fields.suggestedSpace.value}` : "", "You can change either selection below"].filter(Boolean).join(" · ")}</small></span></div>}
          {destinationMode === "file" && scanError && <p className="add-document-scan-fallback" role="status">Smart Scan couldn't suggest a destination. Choose a Space and Document Type to continue.</p>}
          <label className="add-document-flow-field"><span><i>01</i> Space</span><select value={spaceId} onChange={(event) => chooseSpace(event.target.value)}><option value="">Choose a space…</option>{(destinationMode === "file" ? fileSpaces : spaces).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          {space && <label className="add-document-flow-field add-document-type-field"><span><i>02</i> Document Type</span><select value={typeValue} onChange={(event) => { setSelectionTouched(true); handoffStartedRef.current = false; setTypeValue(event.target.value); }}><option value="">Choose a type…</option>{space.types.map((entry) => <option key={`${space.id}:${entry.value}`} value={entry.value}>{entry.label}</option>)}</select></label>}
          {destinationMode === "file" && !scanError && <div className="add-document-private-note"><ShieldCheck size={14}/><span>The scanned values stay editable. Your original file is stored only when you save the selected record.</span></div>}
        </>}
      </div>
      <footer className="add-document-drawer-footer">
        {step === "choose" && <><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><span className="add-document-footer-hint">Choose File to preview locally</span></>}
        {step === "preview" && <><button type="button" className="quiet-button" disabled={scanBusy} onClick={() => { setStep("choose"); setFile(null); previewFileRef.current = null; setScanError(""); setScanAttempted(false); setPreviewReady(false); scanStartedRef.current = null; }}>Back</button><button type="button" className="main-add-button" disabled={scanBusy || (canScanFile && !previewReady)} onClick={() => canScanFile ? void runSmartScan(Boolean(scanError || scanResult)) : (setScanError("Smart Scan isn't available for this file. Choose a space and type manually."), setScanAttempted(true), setStep("destination"))}>{scanBusy ? <><span className="spinner"/> Scanning…</> : canScanFile ? <>{previewReady ? scanAttempted ? "Scan again" : "Scan now" : "Preparing preview…"} <Sparkles size={15}/></> : <>Choose destination <ArrowRight size={15}/></>}</button></>}
        {step === "destination" && <><button type="button" className="quiet-button" onClick={() => { if (file) setStep("preview"); else { setStep("choose"); setDestinationMode("file"); } }}>{file ? "Back to preview" : "Back"}</button><span className="add-document-footer-hint">Fields open automatically when ready</span></>}
      </footer>
    </aside>
  </div></ModalPortal>;
}

function DashboardView({ user, items, onNavigate, onOpenItem, onAdd, onAddDocument, onToggleFavorite }: { user: AppUser; items: VaultItem[]; onNavigate: (view: ViewId) => void; onOpenItem: (item: VaultItem) => void; onAdd: (section: SectionId) => void; onAddDocument: () => void; onToggleFavorite: (item: VaultItem, favorite: boolean) => void }) {
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
  return <div className="dashboard-view"><div className="dashboard-welcome-row"><div><div className="welcome-overline"><span className="welcome-spark"><Sparkles size={13}/></span>Your personal space · {new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}</div><h2>{greeting(user.fullName)}<span className="greeting-period">.</span></h2><p>Everything important, gathered in one thoughtful place.</p></div><div className="welcome-actions"><button className="quiet-button" onClick={() => onNavigate("settings")}><Settings size={16}/> Preferences</button><button className="main-add-button" onClick={onAddDocument}><Plus size={17}/> Add document</button></div></div>
    <div className="metric-grid">{metrics.map(({ title, count, id, icon: Icon, color, note }, index) => <BlurFade key={id} delay={index * 65}><MagicCard className={`metric-card metric-${color}`} onClick={() => onNavigate(id)} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onNavigate(id)}><div className="metric-card-heading"><span className="metric-icon-box"><Icon size={17}/></span></div><div className="metric-card-value">{count.toString().padStart(2, "0")}</div><div className="metric-label">{title}</div><div className="metric-meta">{note}<ArrowUpRight size={13}/></div></MagicCard></BlurFade>)}</div>
    <div className="dashboard-grid-main"><section className="dashboard-panel upcoming-panel"><div className="panel-heading"><div><span className="panel-kicker">A gentle nudge</span><h3>Coming up soon <span className="panel-count">{upcoming.length}</span></h3></div><button className="panel-link" onClick={() => upcoming.length ? onNavigate(upcoming[0].section) : onAddDocument()}>{upcoming.length ? "Open next" : "Add a document"} <ArrowRight size={14}/></button></div>{upcoming.length ? <div className="upcoming-list">{upcoming.map((item) => { const config = SECTION_BY_ID[item.section]; const Icon = item.metadata.recordType === "alarm" ? AlarmClock : item.metadata.recordType === "reminder" ? BellRing : config.icon; const at = dashboardItemDate(item); const label = item.metadata.recordType === "todo" ? "Task due" : item.metadata.recordType === "reminder" ? "Reminder" : item.metadata.recordType === "alarm" ? "Alarm" : config.label; return <button className="upcoming-row" key={item.id} onClick={() => onOpenItem(item)}><span className={`upcoming-icon ${colors[item.section]}`}><Icon size={16}/></span><span className="upcoming-main"><b>{item.title}</b><small>{label}{at ? ` · ${at.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</small></span><span className="upcoming-date"><CalendarClock size={13}/>{at ? item.metadata.recordType === "reminder" || item.metadata.recordType === "alarm" ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : formatDate(item.metadata.dueDate || item.metadata[config.dateKey || ""] || at.toISOString().slice(0,10)) : "Soon"}</span></button>; })}</div> : <div className="empty-upcoming"><div className="empty-sun"><Check size={17}/></div><div><b>A clear horizon.</b><span>No dates need your attention just yet.</span></div></div>}</section><section className="dashboard-panel recent-panel"><div className="panel-heading"><div><span className="panel-kicker">All your spaces, one view</span><h3>Recently updated</h3></div><span className="recent-month">{new Date().toLocaleDateString("en", { month: "long" })}</span></div><div className="recent-list">{recent.map((item) => { const Icon = SECTION_BY_ID[item.section].icon; return <button className="recent-row" key={item.id} onClick={() => onOpenItem(item)}><span className={`recent-icon ${colors[item.section]}`}><Icon size={15}/></span><span className="recent-info"><b>{item.title}</b><small>{SECTION_BY_ID[item.section].label}</small></span>{item.file && <FileText size={14}/>}<ArrowUpRight size={14}/></button>; })}{!recent.length && <div className="dashboard-empty-state"><FileText size={17}/><span>Your saved records will appear here.</span></div>}</div></section></div>
    <section className="dashboard-panel favorites-panel"><div className="panel-heading"><div><span className="panel-kicker">Kept close</span><h3>Favorites <span className="panel-count">{items.filter((item) => item.favorite).length}</span></h3></div></div>{favorites.length ? <div className="favorite-dashboard-list">{favorites.map((item) => { const Icon = SECTION_BY_ID[item.section].icon; return <div className="favorite-dashboard-row" key={item.id}><button className="favorite-dashboard-open" onClick={() => onOpenItem(item)}><span className={`favorite-dashboard-icon ${colors[item.section]}`}><Icon size={15}/></span><span><b>{item.title}</b><small>{item.file ? `File · ${item.file.name}` : SECTION_BY_ID[item.section].label}</small></span><ArrowUpRight size={14}/></button><button className="favorite-dashboard-remove" onClick={() => onToggleFavorite(item, false)} aria-label={`Remove ${item.title} from favorites`} title="Remove from favorites"><Heart size={15} fill="currentColor"/></button></div>; })}</div> : <div className="dashboard-favorites-empty"><Heart size={17}/><span>Favorite records and attached files will stay handy here. Use the heart on any record to add it.</span></div>}</section>
    <div className="dashboard-grid-secondary"><section className="dashboard-panel spaces-panel"><div className="panel-heading"><div><span className="panel-kicker">Every part of life</span><h3>Your spaces</h3></div></div><div className="spaces-grid">{NAV_GROUPS.flatMap((group) => group.ids).slice(0, 9).map((id) => { const section = SECTION_BY_ID[id]; const Icon = section.icon; return <button className="space-tile" key={id} onClick={() => onNavigate(id)}><span className={`space-tile-icon space-${section.color}`}><Icon size={16}/></span><span className="space-tile-copy"><b>{section.label}</b><small>{section.eyebrow}</small></span><span className="space-tile-count">{items.filter((item) => item.section === id).length}</span><ChevronRight size={15}/></button>; })}</div></section><section className="dashboard-panel dashboard-quick-capture-panel"><div className="panel-heading"><div><span className="panel-kicker">A little less typing</span><h3>Quick actions</h3></div><Sparkles size={17}/></div><div className="dashboard-quick-actions"><button className="dashboard-quick-action" onClick={onAddDocument}><span className="dashboard-quick-action-icon quick-action-blue"><FileText size={15}/></span><span><b>Smart Scan a document</b><small>Attach a photo or PDF to suggest fields</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("academics")}><span className="dashboard-quick-action-icon quick-action-violet"><BookOpen size={15}/></span><span><b>Add an academic record</b><small>Keep applications and results together</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("memberships")}><span className="dashboard-quick-action-icon quick-action-amber"><CreditCard size={15}/></span><span><b>Save a membership</b><small>Store membership details and dates</small></span><ArrowRight size={14}/></button><button className="dashboard-quick-action" onClick={() => onAdd("study")}><span className="dashboard-quick-action-icon quick-action-mint"><BookOpen size={15}/></span><span><b>Save study material</b><small>Keep learning files easy to find</small></span><ArrowRight size={14}/></button></div><div className="dashboard-quick-note"><ShieldCheck size={13}/> Scan suggestions stay editable and require your review.</div></section></div>
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
      <div className="shared-category-group">
        <div className="shared-category-header"><span className="shared-category-title">PUBLIC DIGITAL BUSINESS CARDS</span><span className="shared-category-count">{publicCards.length}</span></div>
        <div className={`shared-record-list ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
          {publicCards.map((card) => <MagicCard className="shared-record-shell" key={card.id}>
            <article className="shared-record shared-record-public">
              <div className="shared-record-main">
                <span className="shared-record-icon tag-blue"><BriefcaseBusiness size={20}/></span>
                <div className="shared-record-copy">
                  <div className="shared-record-title-row"><b>{card.fullName}</b><span className="shared-type-chip">Business card</span></div>
                  <small>{[card.jobTitle, card.company].filter(Boolean).join(" · ") || "Public digital business card"}</small>
                  <small className="shared-public-url">/BusinessCard/{card.cardId}</small>
                </div>
                <div className="shared-record-main-action">{card.cardId && <a className="shared-open-button" href={`${window.location.origin}/BusinessCard/${card.cardId}`} target="_blank" rel="noreferrer">View public <ArrowUpRight size={13}/></a>}</div>
              </div>
              <div className="shared-record-meta">
                <div className="shared-person">
                  <small>VISIBILITY</small>
                  <b>Public web link</b>
                  <span>Anyone with this link can view your business card.</span>
                </div>
                <span className="permission-badge permission-public">Public</span>
              </div>
            </article>
          </MagicCard>)}
        </div>
      </div>
    ) : <div className="shared-empty"><span><Globe2 size={22}/></span><h3>No business cards are public</h3><p>Turn on Make Public in a card’s editor. Any public cards you own will appear here.</p></div>) : (
      <>
        {entries.length > 0 && (
          <div className="shared-category-group">
            <div className="shared-category-header"><span className="shared-category-title">DOCUMENTS &amp; VAULT RECORDS</span><span className="shared-category-count">{entries.length}</span></div>
            <div className={`shared-record-list ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
              {entries.map((entry) => {
                const sectionDef = SECTION_BY_ID[entry.item.section];
                const SectionIcon = sectionDef?.icon || FileText;
                const person = tab === "outgoing" ? entry.recipient : entry.owner;
                return (
                  <MagicCard className="shared-record-shell" key={entry.shareId}>
                    <article className="shared-record">
                      <div className="shared-record-main">
                        <span className={`shared-record-icon ${colors[entry.item.section] || "tag-blue"}`}><SectionIcon size={20}/></span>
                        <div className="shared-record-copy">
                          <div className="shared-record-title-row">
                            <b onClick={() => onOpen(entry)} style={{cursor:"pointer"}}>{entry.item.title}</b>
                            <span className="shared-type-chip">{sectionDef?.label || "Document"}</span>
                          </div>
                          <small>{entry.item.file?.name || entry.item.metadata.type || `${sectionDef?.label} record`}</small>
                          {entry.item.file?.size && <small className="shared-record-detail">{humanSize(entry.item.file.size)} · Vault file</small>}
                        </div>
                        <div className="shared-record-main-action">
                          <button type="button" className="shared-open-button" onClick={() => onOpen(entry)}>Open <ArrowUpRight size={13}/></button>
                        </div>
                      </div>
                      <div className="shared-record-meta">
                        <div className="shared-person">
                          <small>{tab === "outgoing" ? "SHARED WITH" : "SHARED BY"}</small>
                          <b>{person.fullName}</b>
                          <span>{person.email} · ID {person.userId}</span>
                        </div>
                        <span className={`permission-badge permission-${entry.permission}`}>{entry.permission === "edit" ? "Can edit" : entry.permission === "comment" ? "Can comment" : "Can view"}</span>
                      </div>
                      <div className="shared-record-controls">
                        {tab === "outgoing" ? (
                          <>
                            <label className="shared-access-control">Permission:
                              <select value={entry.permission} disabled={busyId === entry.shareId} onChange={(event) => void run(entry.shareId, () => onPermissionChange(entry.shareId, event.target.value as SharePermission))}>
                                <option value="view">View</option>
                                <option value="comment">Comment</option>
                                <option value="edit">Edit</option>
                              </select>
                            </label>
                            <button type="button" className="share-stop-button" disabled={busyId === entry.shareId} onClick={() => void run(entry.shareId, () => onRevoke(entry.shareId))}>{busyId === entry.shareId ? "Saving…" : "Revoke access"}</button>
                          </>
                        ) : (
                          <>
                            <span className="shared-permission-note">Access: <b>Can {entry.permission}</b></span>
                            <button type="button" className="shared-open-button" onClick={() => onOpen(entry)}>View record <ArrowRight size={13}/></button>
                          </>
                        )}
                      </div>
                    </article>
                  </MagicCard>
                );
              })}
            </div>
          </div>
        )}

        {recordEntries.length > 0 && (
          <div className="shared-category-group" style={{marginTop:"18px"}}>
            <div className="shared-category-header"><span className="shared-category-title">CONTACTS &amp; CARDS</span><span className="shared-category-count">{recordEntries.length}</span></div>
            <div className={`shared-record-list shared-record-list-structured ${viewMode === "cards" ? "shared-card-layout" : "shared-list-layout"}`}>
              {recordEntries.map((entry) => {
                const isContact = entry.resourceType === "contact";
                const person = tab === "outgoing" ? entry.recipient : entry.owner;
                return (
                  <MagicCard className="shared-record-shell" key={entry.shareId}>
                    <article className="shared-record">
                      <div className="shared-record-main">
                        <span className={`shared-record-icon ${isContact ? "tag-blue" : "tag-slate"}`}>{isContact ? <ContactRound size={20}/> : <BriefcaseBusiness size={20}/>}</span>
                        <div className="shared-record-copy">
                          <div className="shared-record-title-row">
                            <b onClick={() => setSelectedRecord(entry)} style={{cursor:"pointer"}}>{recordName(entry)}</b>
                            <span className="shared-type-chip">{isContact ? "Contact" : "Business card"}</span>
                          </div>
                          <small>{recordMeta(entry)}</small>
                        </div>
                        <div className="shared-record-main-action">
                          <button type="button" className="shared-open-button" onClick={() => setSelectedRecord(entry)}>Details <ArrowUpRight size={13}/></button>
                        </div>
                      </div>
                      <div className="shared-record-meta">
                        <div className="shared-person">
                          <small>{tab === "outgoing" ? "SHARED WITH" : "SHARED BY"}</small>
                          <b>{person.fullName}</b>
                          <span>{person.email} · ID {person.userId}</span>
                        </div>
                        <span className="permission-badge permission-view">Can view</span>
                      </div>
                      <div className="shared-record-controls">
                        {tab === "outgoing" ? (
                          <>
                            <span className="shared-permission-note">Selective detail share</span>
                            <button type="button" className="share-stop-button" disabled={busyId === entry.shareId} onClick={() => void run(entry.shareId, () => onRevokeRecord(entry.shareId))}>{busyId === entry.shareId ? "Removing…" : "Revoke share"}</button>
                          </>
                        ) : (
                          <>
                            <span className="shared-permission-note">Shared privately with your account</span>
                            <button type="button" className="shared-open-button" onClick={() => setSelectedRecord(entry)}>View details <ArrowRight size={13}/></button>
                          </>
                        )}
                      </div>
                    </article>
                  </MagicCard>
                );
              })}
            </div>
          </div>
        )}

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

function SettingsView({ user, items, onProfileSave, onSendVerificationCode, onVerifyEmailCode, onPasswordChange, onExport, onImport, onDeleteAccount, onOpenContact, notify }: { user: AppUser; items: VaultItem[]; onProfileSave: (values: { fullName: string; timezone: string; avatarUrl: string }) => Promise<void>; onSendVerificationCode: () => Promise<{ ok: boolean; alreadyVerified?: boolean; expiresInSeconds?: number }>; onVerifyEmailCode: (code: string) => Promise<void>; onPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>; onExport: () => void; onImport: (file: File) => Promise<void>; onDeleteAccount: () => Promise<void>; onOpenContact: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [timezone, setTimezone] = useState(user.timezone || "Asia/Dhaka");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "");
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      if (fullName.trim() !== user.fullName || timezone !== user.timezone || avatarUrl !== user.avatarUrl) {
        await onProfileSave({ fullName: fullName.trim(), timezone, avatarUrl });
      }
      if (newPassword) {
        if (!currentPassword) throw new Error("Enter your current password to change password.");
        if (newPassword.length < 12) throw new Error("New password must be at least 12 characters.");
        if (newPassword !== confirmPassword) throw new Error("New passwords do not match.");
        await onPasswordChange(currentPassword, newPassword);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
      setEditingProfile(false);
      notify("Your profile has been updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't save profile.", "error");
    } finally {
      setSaving(false);
    }
  };
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
  const requestEmailVerification = async () => {
    setVerificationBusy(true);
    try {
      const result = await onSendVerificationCode();
      if (result.alreadyVerified) { notify("This email address is already verified."); setVerificationRequested(false); }
      else { setVerificationRequested(true); notify("A verification code was sent to your email."); }
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't send a verification code.", "error"); }
    finally { setVerificationBusy(false); }
  };
  const verifyEmail = async () => {
    setVerificationBusy(true);
    try { await onVerifyEmailCode(verificationCode); setVerificationCode(""); setVerificationRequested(false); notify("Email address verified."); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't verify that code.", "error"); }
    finally { setVerificationBusy(false); }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { await onImport(file); notify("Your data import is ready."); } catch (error) { notify(error instanceof Error ? error.message : "Import failed.", "error"); } finally { event.currentTarget.value = ""; } };
  const deleteAccount = async () => { try { await onDeleteAccount(); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't delete this account.", "error"); } };
  return <div className="settings-view"><div className="settings-intro settings-profile-hero"><div className="profile-hero-identity"><span className="profile-avatar-large account-avatar-large"><AccountAvatarContent user={avatarPreviewUser}/></span><div><span className="profile-hero-eyebrow">PERSONAL PROFILE</span><h2>{fullName || user.fullName}</h2><p>{user.email}</p><span className={`profile-account-badge ${user.demo ? "is-demo" : ""}`}><i/>{user.demo ? "Demo workspace" : "Active Persora account"}</span></div></div><div className="profile-hero-summary"><span className="profile-summary-label">ACCOUNT TIME ZONE</span><b>{timezone.replace(/_/g, " ")}</b><small>Changes to your profile are private.</small><button type="button" className="settings-edit-profile-btn" onClick={() => setEditingProfile((cur) => !cur)}>{editingProfile ? "Done editing" : "Edit profile"}</button></div></div><div className="settings-layout"><div className="settings-main-column"><section className="settings-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-blue"><UserRound size={17}/></span><div><h3>Profile information</h3><p>Manage the identity and locale linked to your account.</p></div></div><div style={{display:"flex",alignItems:"center",gap:"8px"}}><button type="button" className="settings-edit-profile-btn" onClick={() => setEditingProfile((cur) => !cur)}>{editingProfile ? "Cancel edit" : "Edit"}</button><span className="settings-card-status"><span/>PRIVATE PROFILE</span></div></div>{!editingProfile ? (
  <div className="settings-readonly-profile">
    <div className="settings-profile-photo" style={{marginBottom:"12px"}}><div className="settings-avatar-main"><span className="avatar settings-avatar-preview"><AccountAvatarContent user={avatarPreviewUser}/></span><div><b>{fullName || user.fullName}</b><small>{user.email} · Persora ID {user.userId || "Demo"}</small></div></div></div>
    <div className="settings-form-grid profile-form-grid">
      <div className="field-label">Full name<div className="settings-readonly">{fullName || user.fullName}</div></div>
      <div className="field-label">Email address<div className="settings-readonly">{user.email}<LockKeyhole size={13}/></div>{!user.demo && (user.emailVerified ? <span className="settings-email-verified">Verified</span> : <div className="settings-email-verification">{verificationRequested && <div className="settings-verification-code"><input aria-label="Email verification code" inputMode="numeric" maxLength={8} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Verification code"/><button type="button" className="settings-id-copy" onClick={() => void verifyEmail()} disabled={verificationBusy || verificationCode.length < 6}>Verify</button></div>}<button type="button" className="settings-id-copy" onClick={() => void requestEmailVerification()} disabled={verificationBusy}>{verificationBusy ? "Sending…" : verificationRequested ? "Resend code" : "Verify email"}</button></div>)}</div>
      <div className="field-label">Persora ID<div className="settings-readonly settings-id-value"><strong>{user.userId || "Demo workspace"}</strong>{user.userId && <button type="button" className="settings-id-copy" onClick={() => void copyUserId()}>Copy</button>}</div></div>
      <div className="field-label">Time zone<div className="settings-readonly">{timezone.replace(/_/g, " ")}</div></div>
    </div>
  </div>
) : (
  <div className="settings-edit-profile-area">
    <div className="settings-profile-photo"><div className="settings-avatar-main"><span className="avatar settings-avatar-preview"><AccountAvatarContent user={avatarPreviewUser}/></span><span><b>Profile photo or emoji</b><small>Shown in your workspace navigation and saved with your profile.</small></span></div><div className="settings-avatar-actions"><label className="settings-avatar-upload"><UploadCloud size={14}/>{avatarProcessing ? "Preparing…" : "Upload photo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatarPhoto(event)} disabled={avatarProcessing || saving}/></label><button type="button" className="settings-avatar-initials" onClick={() => { setAvatarUrl(""); setAvatarError(""); }}>Use initials</button></div><div className="settings-avatar-emoji-options" role="group" aria-label="Choose a profile emoji">{PROFILE_AVATAR_EMOJI.map((emoji) => <button type="button" key={emoji} className={avatarUrl === `emoji:${emoji}` ? "is-selected" : ""} onClick={() => { setAvatarUrl(`emoji:${emoji}`); setAvatarError(""); }} aria-label={`Choose profile emoji ${emoji}`} aria-pressed={avatarUrl === `emoji:${emoji}`}>{emoji}</button>)}</div><div className="settings-avatar-dicebear"><span className="settings-avatar-dicebear-label">DiceBear Adventurer</span><div className="settings-avatar-dicebear-options" role="group" aria-label="Choose a DiceBear Adventurer avatar">{PROFILE_AVATAR_DICEBEAR.map((avatar) => <button type="button" key={avatar.id} className={avatarUrl === avatar.image ? "is-selected" : ""} onClick={() => { setAvatarUrl(avatar.image); setAvatarError(""); }} aria-label={`Choose ${avatar.name} DiceBear Adventurer avatar`} aria-pressed={avatarUrl === avatar.image} title={avatar.name}><img src={avatar.image} alt="" referrerPolicy="no-referrer"/></button>)}</div></div>{avatarProcessing && <span className="settings-avatar-message" role="status">Preparing a small square profile photo…</span>}{avatarError && <span className="settings-avatar-error" role="alert">{avatarError}</span>}</div>
    <div className="settings-form-grid profile-form-grid">
      <label className="field-label">Full name<input value={fullName} maxLength={100} onChange={(event) => setFullName(event.target.value)} /></label>
      <label className="field-label">Email address<div className="settings-readonly">{user.email}<LockKeyhole size={13}/></div></label>
      <label className="field-label">Persora ID<div className="settings-readonly settings-id-value"><strong>{user.userId || "Demo workspace"}</strong>{user.userId && <button type="button" className="settings-id-copy" onClick={() => void copyUserId()}>Copy</button>}</div></label>
      <label className="field-label settings-timezone">Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Dhaka">Asia/Dhaka · Bangladesh</option><option value="Asia/Kolkata">Asia/Kolkata · India</option><option value="Asia/Singapore">Asia/Singapore</option><option value="Europe/London">Europe/London</option><option value="UTC">UTC</option></select></label>
      <div className="field-label field-wide" style={{gridColumn:"1 / -1",marginTop:"8px"}}>
        <span style={{fontWeight:600,fontSize:"12px",color:"#202124",marginBottom:"4px",display:"block"}}>Change account password</span>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:"8px"}}>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" maxLength={72}/>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (12+ chars)" minLength={12} maxLength={72}/>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" minLength={12} maxLength={72}/>
        </div>
      </div>
    </div>
    <div className="settings-card-footer"><span>Changes sync across website and mobile app.</span><button className="settings-save-button" onClick={() => void save()} disabled={saving || avatarProcessing}>{saving ? "Saving…" : <>Save changes <ArrowRight size={14}/></>}</button></div>
  </div>
)}</section><section className="settings-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-blue"><ShieldCheck size={17}/></span><div><h3>Your account &amp; privacy</h3><p>How Persora keeps your space safe.</p></div></div></div><div className="security-rows"><div className="security-row"><span className="security-row-icon"><LockKeyhole size={15}/></span><div><b>Sign-in security</b><small>{user.demo ? "Local sample session" : "7-digit Persora ID · protected server session"}</small></div><span className="security-row-tag"><span/>ACTIVE</span></div><div className="security-row"><span className="security-row-icon"><Fingerprint size={15}/></span><div><b>Personal vault</b><small>{items.length} items across {new Set(items.map((item) => item.section)).size} spaces</small></div><span className="security-row-tag tag-blue-text"><span/>PRIVATE</span></div><div className="security-row"><span className="security-row-icon"><Activity size={15}/></span><div><b>Data access</b><small>Vault access is restricted to your signed-in account.</small></div><span className="security-row-tag">OWNER ONLY</span></div></div><div className="account-security-note"><ShieldCheck size={14}/><span>Persora never asks for or stores your other online account passwords.</span></div></section><section className="settings-card data-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-peach"><FileText size={17}/></span><div><h3>Your data, your call</h3><p>Export or restore your vault data.</p></div></div></div><div className="data-action-row"><div><b>Download a backup</b><small>Export all records; cloud backups also include attached files.</small></div><button className="outline-action-button" onClick={onExport}>Export data</button></div><label className="data-action-row import-row"><div><b>Import a backup</b><small>Restore a Persora JSON export in this account.</small></div><span className="outline-action-button">Choose file<input type="file" accept=".json,application/json" onChange={(event) => void importFile(event)}/></span></label></section><section className="settings-card danger-zone-card"><div className="settings-card-header"><div><span className="settings-card-icon icon-soft-red"><Trash2 size={17}/></span><div><h3>Delete your account</h3><p>Permanently remove this account and its personal data.</p></div></div></div>{!confirmDelete ? <div className="danger-action-row"><span>This can't be undone. Export a backup first.</span><button className="danger-outline-button" onClick={() => setConfirmDelete(true)}>Delete account</button></div> : <div className="delete-confirm-inline"><b>Are you sure? This permanently deletes your vault and files.</b><button className="danger-outline-button" onClick={() => void deleteAccount()}>Yes, delete account</button><button className="quiet-button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}</section></div><aside className="settings-side-column"><div className="settings-side-card plan-side-card"><div className="plan-sparkle"><Sparkles size={16}/></div><span className="plan-label">YOUR PERSONAL SPACE</span><h3>Calm looks good on you.</h3><p>Everything here is yours to organize, in your own time.</p><div className="plan-side-divider"/><div className="plan-stats"><span>Available spaces</span><b>{Object.keys(SECTION_BY_ID).length}</b></div><div className="plan-stats"><span>Items saved</span><b>{items.length}</b></div><div className="plan-side-foot"><LockKeyhole size={12}/> Private by default</div></div><div className="settings-side-card timezone-card"><div className="timezone-card-icon"><Clock3 size={16}/></div><span className="plan-label">LOCAL TIME</span><h3>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date())}</h3><p>{timezone.replace("_", " ")}</p></div><div className="settings-help-card"><span><CircleHelp size={15}/></span><div><b>Need a hand?</b><small>Your privacy and data belong to you.</small><button onClick={onOpenContact}>Get in touch <ArrowRight size={13}/></button></div></div></aside></div></div>;
}
