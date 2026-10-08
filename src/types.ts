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

export type ViewId = "dashboard" | SectionId | "contacts" | "settings" | "billing" | "shared" | "timeline" | "medical-records";
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

export interface RecordShareEntry {
  shareId: string;
  resourceType: "contact" | "business_card";
  resourceId: string;
  record: PersoraContact | DigitalBusinessCard;
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
  kind: "shared" | "permission_changed" | "unshared" | "reminder" | "alarm";
  itemTitle: string;
  actorName: string;
  message: string;
  createdAt: string;
  readAt?: string;
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

export type VaultFolderScope = SectionId | "contacts" | "business-cards" | "medical-records";
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
export interface AdminConsoleSnapshot {
  metrics: AdminMetrics;
  smartScan: SmartScanAdminSnapshot;
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
