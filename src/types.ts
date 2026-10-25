import type { LucideIcon } from "lucide-react";

export type SectionId =
  | "documents"
  | "academics"
  | "subscriptions"
  | "family"
  | "purchases"
  | "accounts"
  | "memberships"
  | "wallet-cards"
  | "study"
  | "business-card"
  | "urls"
  | "notes"
  | "personal-finance";

export type ViewId = "dashboard" | SectionId | "contacts" | "settings" | "billing" | "shared" | "timeline" | "medical-records" | "password-manager" | "trash" | "projects" | "photo-studio" | "pdf-studio" | "calendar" | "habits" | "loans" | "tables" | "connections";

/** Content families that flow through the global Trash. */
export type TrashKind = "vault_item" | "contact" | "business_card" | "medical_record" | "timeline_event" | "password_entry" | "photo_studio_photo" | "pdf_studio_document" | "persora_table";

/** Space keys used by Trash entries: vault section ids plus whole-app spaces. */
export type TrashSpace = SectionId | "contacts" | "business-cards" | "medical-records" | "timeline" | "password-manager" | "photo-studio" | "pdf-studio" | "persora-table";

export interface TrashEntry {
  /** Stable id of the original record (restoration re-uses it). */
  id: string;
  kind: TrashKind;
  title: string;
  /** Where it came from: vault section id, or an app space like "contacts". */
  space: TrashSpace | null;
  /** Display name of the original folder, when known. */
  folder: string | null;
  /** Timeline posts also carry the event date (content itself stays encrypted). */
  eventDate?: string | null;
  recordType?: string | null;
  hasFiles?: boolean;
  deletedAt: string;
  expiresAt: string;
}
export type NotesRecordKind = "todo" | "reminder" | "alarm";
export const MEDICAL_RECORD_TYPES = ["Prescription", "Medical Report", "Lab Test", "Imaging / Scan", "Doctor Visit", "Hospital Record", "Vaccination", "Medical Certificate", "Discharge Summary", "Other"] as const;
export type MedicalRecordType = typeof MEDICAL_RECORD_TYPES[number];
export interface MedicalRecordFile { key?: string; name: string; size: number; type: string; localOnly?: boolean }
export interface MedicalRecordLink { recordType: "contact" | "vault_item"; recordId: string; linkKind: "related" | "reminder" }
export interface MedicalRecord {
  id: string; title: string; recordType: MedicalRecordType; recordDate: string; provider: string; hospital: string; specialty: string; notes: string; additionalData: string;
  diagnosis: string; testName: string; testResult: string; medicationNotes: string; followUpDate: string; relatedReminderId?: string;
  file?: MedicalRecordFile; links: MedicalRecordLink[]; folderId?: string; createdAt: string; updatedAt: string;
}
export type MedicalRecordDraft = Omit<MedicalRecord, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null; removeFile?: boolean };
export interface TimelineAttachment { name: string; size: number; type: string; key?: string }
export interface TimelineDraft { id?: string; eventDate: string; title: string; description: string; url: string; linkedRecordIds: string[]; attachment?: TimelineAttachment; attachmentFile?: File | null; removeAttachment?: boolean }
export interface TimelineEvent {
  id: string;
  eventType: "automatic" | "manual";
  eventDate: string;
  title: string;
  description: string;
  url?: string;
  eventKey?: string;
  recordId?: string;
  linkedRecordIds: string[];
  attachment?: TimelineAttachment;
  createdAt: string;
  updatedAt: string;
  pending?: boolean;
}
export interface ActiveScheduleAlert { id: string; item: VaultItem; kind: "reminder" | "alarm"; ringtoneId: string }
export interface AlarmRingtone { id: string; name: string; type: string; size: number }
export type AccountRole = "user" | "admin";
export type SharePermission = "view" | "comment" | "edit";
export type SharedDirection = "incoming" | "outgoing";

export interface ShareUser {
  id: string;
  userId: string;
  email: string;
  fullName: string;
}

export interface SharedVaultEntry {
  shareId: string;
  permission: SharePermission;
  createdAt: string;
  item: VaultItem;
  owner: ShareUser;
  recipient: ShareUser;
  direction: SharedDirection;
}

/** Resource types shared through Persora's record sharing (record_shares). */
export type RecordShareType = "contact" | "business_card" | "photo_studio_photo";

/** Display metadata of a Photo Studio photo shared with a member (no storage key). */
export interface SharedPhotoRecord {
  id: string;
  title: string;
  category: string;
  fileType: string;
  fileSize: number;
  width: number;
  height: number;
  dpi: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordShareEntry {
  shareId: string;
  resourceType: RecordShareType;
  resourceId: string;
  record: PersoraContact | DigitalBusinessCard | SharedPhotoRecord;
  owner: ShareUser;
  recipient: ShareUser;
  direction: SharedDirection;
  createdAt: string;
}

export interface SharedItemAccess {
  shareId: string;
  permission: SharePermission;
  direction: SharedDirection;
  owner: ShareUser;
  recipient: ShareUser;
}

export interface ShareNotification {
  id: string;
  kind: "shared" | "permission_changed" | "unshared" | "reminder" | "alarm" | "project" | "access_removed" | "calendar" | "habit" | "loan";
  /** Calendar reminders: the local date to open. */
  calendarDate?: string;
  /** Habit reminders: the local date the reminder was for. */
  habitDate?: string;
  /** Loan reminders: the loan to open. */
  loanId?: string;
  itemTitle: string;
  actorName: string;
  message: string;
  createdAt: string;
  readAt?: string;
  projectId?: string | null;
  projectName?: string;
  projectEventKind?: string;
  fieldId?: string;
  subtaskId?: string;
}

export interface ShareComment {
  id: string;
  shareId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export type SmartScanConfidence = "high" | "medium" | "low";

export interface SmartScanFieldDefinition {
  key: string;
  label: string;
  kind?: string;
  options?: string[];
}

export interface SmartScanFieldResult {
  value: string;
  confidence: SmartScanConfidence;
  evidence?: string;
  reason?: string;
}

export interface SmartScanResult {
  documentType: string;
  documentTypeConfidence: SmartScanConfidence;
  fields: Record<string, SmartScanFieldResult>;
  warnings: string[];
  cached: boolean;
  ocrCached?: boolean;
  pagesProcessed?: number;
  cacheWarning?: string;
}

export const ADD_DOCUMENT_DESTINATION_EVENT = "persora:add-document-destination";
export const ADD_DOCUMENT_HANDOFF_EVENT = "persora:add-document-handoff";

export interface AddDocumentFlowDraft {
  file: File;
  spaceId: string;
  typeValue: string;
  scanResult: SmartScanResult | null;
  scanError?: string;
  scanAttempted: boolean;
  values: Record<string, string>;
  userEditedKeys?: string[];
}

export interface VaultFile {
  key?: string;
  name: string;
  size?: number;
  type?: string;
  localOnly?: boolean;
}

export interface VaultFilePreview {
  status: "loading" | "ready" | "unavailable" | "error";
  src?: string;
  name: string;
  type?: string;
  message?: string;
}

export const CONTACT_CATEGORIES = ["Family", "Friends", "Work", "Clients", "Suppliers", "Students", "Other"] as const;
export type ContactCategory = typeof CONTACT_CATEGORIES[number];
export interface ContactPhone { label: string; number: string }
export interface TransferProgress { loaded: number; total: number; percent: number; remainingSeconds: number | null }
export interface ContactImportProgress { completed: number; total: number; percent: number; remainingSeconds: number | null; currentName: string }
export type BusinessSocialPlatform = "Facebook" | "Instagram" | "LinkedIn" | "X" | "YouTube" | "TikTok" | "WhatsApp" | "Telegram" | "GitHub" | "Pinterest";
export type BusinessCardStyle = "garden" | "minimal" | "midnight" | "terracotta";
export interface BusinessSocialLink { platform: BusinessSocialPlatform; url: string }
export interface BusinessCustomLink { label: string; url: string }
export interface DigitalBusinessCard {
  id: string;
  cardId?: string;
  isPublic: boolean;
  style: BusinessCardStyle;
  fullName: string;
  profilePhotoKey?: string;
  profilePhotoDataUrl?: string;
  businessLogoKey?: string;
  businessLogoDataUrl?: string;
  jobTitle: string;
  company: string;
  phoneNumbers: ContactPhone[];
  email: string;
  websites: string[];
  socialLinks: BusinessSocialLink[];
  address: string;
  bio: string;
  customLinks: BusinessCustomLink[];
  createdAt: string;
  updatedAt: string;
  folderId?: string;
}
export type BusinessCardDraft = Omit<DigitalBusinessCard, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  profilePhotoFile?: File | null;
  businessLogoFile?: File | null;
  clearProfilePhoto?: boolean;
  clearBusinessLogo?: boolean;
};
export interface PublicDigitalBusinessCard extends Omit<DigitalBusinessCard, "id" | "profilePhotoKey" | "businessLogoKey" | "createdAt" | "updatedAt"> {
  profilePhotoUrl?: string;
  businessLogoUrl?: string;
}
export interface PersoraContact {
  id: string;
  name: string;
  phoneNumbers: ContactPhone[];
  email: string;
  company: string;
  jobTitle: string;
  address: string;
  birthday: string;
  notes: string;
  category: ContactCategory;
  photoKey?: string;
  photoDataUrl?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  folderId?: string;
}
export type ContactDraft = Omit<PersoraContact, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  photoFile?: File | null;
  clearPhoto?: boolean;
};

export interface VaultItem {
  id: string;
  section: SectionId;
  title: string;
  subtitle?: string;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  file?: VaultFile;
  favorite?: boolean;
  pinned?: boolean;
  folderId?: string;
  /** Client-only access context for a shared record; never determines server authorization. */
  sharedAccess?: SharedItemAccess;
}

export interface FieldDefinition {
  key: string;
  label: string;
  kind: "text" | "email" | "url" | "date" | "textarea" | "select" | "number";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
}

export interface SectionDefinition {
  id: SectionId;
  label: string;
  eyebrow: string;
  singular: string;
  description: string;
  icon: LucideIcon;
  color: string;
  titleLabel: string;
  fields: FieldDefinition[];
  previewKeys: string[];
  dateKey?: string;
}

export type VaultFolderScope = SectionId | "contacts" | "business-cards" | "medical-records" | "password-manager" | "photo-studio" | "pdf-studio";
export type VaultFolderColor = "blue" | "sky" | "teal" | "violet" | "amber" | "rose" | "slate" | "mint";
export interface VaultFolder {
  id: string;
  scope: VaultFolderScope;
  name: string;
  color: VaultFolderColor;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
export type VaultFolderDraft = Omit<VaultFolder, "id" | "createdAt" | "updatedAt"> & { id?: string };

export interface AppUser {
  id: string;
  userId?: string;
  email: string;
  fullName: string;
  role: AccountRole;
  timezone?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  uploadsEnabled?: boolean;
  demo?: boolean;
}

export interface AdminProfile {
  id: string;
  login_id: string;
  email: string;
  full_name: string;
  role: AccountRole;
  account_status: "active" | "suspended";
  created_at: string;
  storage_bytes?: number;
  storage_file_bytes?: number;
  storage_database_bytes?: number;
}

export interface AdminMetrics { totalAccounts: number; activeAccounts: number; vaultEntries: number; pendingPayments: number }

export interface AdminAuditEvent { id: string; actor_email: string; event_type: string; target_user_id: string | null; target_email: string; created_at: string; details: Record<string, unknown> }

export interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  storage_gb: number;
  price_per_gb_monthly: number;
  active: boolean;
  sort_order: number;
  monthly_price: number;
  currency: string;
}

export interface DocumentTypeOption { id: string; name: string; active: boolean; sort_order: number }
export interface PaymentMethod {
  id: string;
  name: string;
  accountName: string;
  accountIdentifier: string;
  instructions: string;
  active: boolean;
  sort_order: number;
}
export interface SiteContent {
  privacyTitle: string;
  privacyBody: string;
  termsTitle: string;
  termsBody: string;
  contactTitle: string;
  contactBody: string;
  contactEmail: string;
  contactPhone: string;
  contactWhatsApp: string;
  contactAddress: string;
}
export interface BillingSettings { currency: string; manualInstructions: string; billingEnabled: boolean; minTermMonths: number; maxTermMonths: number }
export interface StorageSettings { defaultFreeGb: number; maxUploadMb: number }
export interface EmailSettings { verificationEnabled: boolean; senderName: string; senderEmail: string; replyToEmail: string; replyToName: string }
export interface PaymentRecord {
  id: string;
  user_id: string;
  email: string;
  plan_id: string;
  plan_name: string;
  storage_gb: number;
  amount: number;
  currency: string;
  method: string;
  reference: string;
  status: "pending" | "approved" | "rejected";
  billing_period?: "monthly" | "yearly";
  duration_count?: number;
  term_months?: number;
  submitted_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_note?: string | null;
}
export interface StorageUsage { bytesUsed: number; fileBytes: number; databaseBytes: number; databaseRecordCount: number; objectCount: number; storageLimitBytes: number; storageLimitGb: number; planName: string }
export interface SmartScanUsage { enabled: boolean; scans: number; ocrRuns: number; aiExtractions: number; lastScannedAt: string | null }
export interface SmartScanAdminSnapshot { enabled: boolean; usageAvailable: boolean; totals: { scans: number; ocrRuns: number; aiExtractions: number }; byUser: Record<string, SmartScanUsage> }
export interface AiControls { passwordSuggestions: boolean; smartScanOcr: boolean; smartScanExtraction: boolean; photoBackgroundRemoval: boolean }
export interface AiProvidersSnapshot { workersAiConfigured: boolean; azureDocumentIntelligenceConfigured: boolean; photoBackgroundProviders?: string[] }
export interface AdminConsoleSnapshot {
  metrics: AdminMetrics;
  smartScan: SmartScanAdminSnapshot;
  aiControls?: AiControls;
  aiProviders?: AiProvidersSnapshot;
  profiles: AdminProfile[];
  events: AdminAuditEvent[];
  plans: SubscriptionPlan[];
  documentTypes: DocumentTypeOption[];
  payments: PaymentRecord[];
  billingSettings: BillingSettings;
  paymentMethods: PaymentMethod[];
  siteContent: SiteContent;
  emailSettings: EmailSettings;
  storageSettings: StorageSettings;
  storage: { status: "connected" | "unavailable"; databaseStatus: "connected" | "unavailable"; bytesUsed: number; databaseBytesUsed: number; databaseRecordCount: number; totalBytesUsed: number; objectCount: number; usersWithFiles: number; byUser: Record<string, { bytes: number; objects: number; databaseBytes: number; databaseRecords: number; totalBytes: number }> };
  system: { database: "connected" | "unavailable"; storage: "connected" | "unavailable"; supabaseUrlConfigured: boolean; secretKeyConfigured: boolean; brevoApiKeyConfigured: boolean };
}
export interface BillingSnapshot {
  subscription: { plan_id: string; plan_name: string; storage_limit_gb: number; status: string; current_period_end: string | null };
  plans: SubscriptionPlan[];
  payments: PaymentRecord[];
  storage: StorageUsage;
  uploadsEnabled: boolean;
  billingSettings: BillingSettings;
  paymentMethods: PaymentMethod[];
  maxUploadMb: number;
}

// ---------------------------------------------------------------------------
// Projects (2026-10-22)
// ---------------------------------------------------------------------------
export type ProjectKind = "personal" | "shared";
export type ProjectFieldStatus = "planning" | "in-progress" | "in-review" | "blocked" | "completed";
export type ProjectMemberRole = "editor" | "commenter" | "viewer";
export type ProjectAccessRole = ProjectMemberRole | "owner";
export type ProjectFolderColor = "cyan" | "purple" | "pink" | "blue" | "orange" | "green";
export interface ProjectRecord { id: string; owner_id: string; name: string; description: string; kind: ProjectKind; created_at: string; updated_at: string }
export interface ProjectAccess { owner: boolean; role: ProjectAccessRole; canCreateFields: boolean; canRequest?: boolean }
export interface ProjectStats { fields: number; completed: number; inReview: number; members: number; pendingRequests: number; subtasksTotal?: number; subtasksCompleted?: number }
export interface ProjectSummary extends ProjectRecord { access: { owner: boolean; role: ProjectAccessRole; canCreateFields: boolean }; stats: ProjectStats }
export interface ProjectMember { userId: string; role: ProjectMemberRole; canCreateFields: boolean; invitedBy: string | null; createdAt: string; name: string; email: string; loginId: string; avatarUrl?: string }
export interface ProjectFolder { id: string; project_id: string; name: string; color: ProjectFolderColor; created_by: string | null; created_at: string; updated_at: string; fieldCount?: number }
export interface ProjectFieldComment { id: string; field_id: string; author_id: string; author_name: string; body: string; created_at: string; updated_at: string }
export interface ProjectSubtask {
  id: string; project_id: string; field_id: string; title: string; completed: boolean; sort_order: number;
  assignee_id: string | null; created_by: string; created_at: string; updated_at: string;
  assigneeName?: string | null; creatorName?: string;
}
export interface ProjectFieldAttachment {
  id: string; project_id: string; field_id: string; uploader_id: string; uploaderName: string;
  file_name: string; file_size: number; file_type: string; created_at: string;
}
export interface ProjectNotification {
  id: string; kind: string; actorName: string; title: string; message: string; createdAt: string; readAt?: string;
  projectId: string | null; projectName: string; fieldId?: string; subtaskId?: string;
}
export interface ProjectNotificationPreferences {
  membership: boolean; assignments: boolean; requests: boolean; subtasks: boolean;
  comments: boolean; attachments: boolean; deadlines: boolean; updates: boolean;
}
export interface ProjectField { 
  id: string; project_id: string; folder_id: string | null; title: string; description: string;
  status: ProjectFieldStatus; progress: number; creator_id: string; creator_name: string;
  assignee_id: string | null; due_date: string | null; created_at: string; updated_at: string;
  assigneeName?: string | null; mine?: { pinned: boolean; favourite: boolean }; commentCount?: number; comments?: ProjectFieldComment[];
  subtasks?: ProjectSubtask[]; attachments?: ProjectFieldAttachment[];
}
export interface ProjectFieldRequest {
  id: string; project_id: string; requester_id: string; requester_name: string; note: string;
  payload: { title?: string; description?: string; folder_id?: string; status?: ProjectFieldStatus; progress?: number; assignee_id?: string; due_date?: string };
  status: "pending" | "approved" | "rejected"; resolution_note: string; field_id: string | null; created_at: string; resolved_at: string | null;
}
export interface ProjectActivity { id: string; actor_id: string | null; actor_name: string; action: string; target: string; created_at: string }
export interface ProjectDetail {
  project: ProjectRecord;
  access: ProjectAccess;
  owner: { id: string; name: string; email: string; loginId: string; avatarUrl?: string } | null;
  members: ProjectMember[];
  folders: ProjectFolder[];
  fields: ProjectField[];
  requests: ProjectFieldRequest[];
  activity: ProjectActivity[];
  /** Display name + chosen profile picture (photo, emoji, avatar) for everyone the project references. */
  people?: Record<string, ProjectPerson>;
}
export interface ProjectPerson { name: string; avatarUrl: string }

// ---------------------------------------------------------------------------
// Photo Studio (2026-10-22)
// ---------------------------------------------------------------------------
export type PhotoCategory = "passport" | "stamp" | "visa" | "id-card" | "job-application" | "other";

/** A saved official photograph (one R2 object + one database row). */
export interface PhotoStudioPhoto {
  id: string;
  folderId: string | null;
  /** The saved photo this version was edited from (originals are never modified). */
  sourcePhotoId: string | null;
  title: string;
  category: PhotoCategory;
  notes: string;
  fileName: string;
  fileSize: number;
  fileType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  dpi: number | null;
  metadata: Record<string, unknown>;
  editSettings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A PDF saved to the PDF Studio library (2026-10-23). */
export interface PdfStudioDocument {
  id: string;
  folderId: string | null;
  title: string;
  notes: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  /** Small first-page JPEG preview (data URL) rendered in the browser at save time. */
  thumbnail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Save-form fields for "Save to Persora" (new PDF) and "Edit details". */
export interface PdfStudioSaveInput {
  title: string;
  notes: string;
  folderId: string | null;
  newFolder: { name: string; color: VaultFolderColor } | null;
}

/** File facts sent with each saved PDF; the server verifies the bytes. */
export interface PdfStudioFileMeta {
  pageCount: number;
  thumbnail: string | null;
  fileName: string;
  metadata: Record<string, unknown>;
}

/** Organise-form fields shared by Upload & Organize and Save & Organize. */
export interface PhotoStudioSaveInput {
  title: string;
  category: PhotoCategory;
  notes: string;
  folderId: string | null;
  newFolder: { name: string; color: VaultFolderColor } | null;
  sourcePhotoId: string | null;
  dpi: number | null;
  fileName: string;
  metadata: Record<string, unknown>;
  editSettings: Record<string, unknown>;
}
