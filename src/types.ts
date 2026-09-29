import type { LucideIcon } from "lucide-react";

export type SectionId =
  | "documents"
  | "academics"
  | "subscriptions"
  | "family"
  | "purchases"
  | "accounts"
  | "memberships"
  | "study"
  | "business-card"
  | "urls";

export type ViewId = "dashboard" | SectionId | "settings" | "billing";
export type AccountRole = "user" | "admin";

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

export interface AppUser {
  id: string;
  userId?: string;
  email: string;
  fullName: string;
  role: AccountRole;
  timezone?: string;
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
export interface BillingSettings { currency: string; manualInstructions: string; billingEnabled: boolean }
export interface StorageSettings { defaultFreeGb: number; maxUploadMb: number }
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
  submitted_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_note?: string | null;
}
export interface StorageUsage { bytesUsed: number; objectCount: number; storageLimitBytes: number; storageLimitGb: number; planName: string }
export interface AdminConsoleSnapshot {
  metrics: AdminMetrics;
  profiles: AdminProfile[];
  events: AdminAuditEvent[];
  plans: SubscriptionPlan[];
  documentTypes: DocumentTypeOption[];
  payments: PaymentRecord[];
  billingSettings: BillingSettings;
  paymentMethods: PaymentMethod[];
  siteContent: SiteContent;
  storageSettings: StorageSettings;
  storage: { status: "connected" | "unavailable"; bytesUsed: number; objectCount: number; usersWithFiles: number; byUser: Record<string, { bytes: number; objects: number }> };
  system: { database: "connected" | "unavailable"; storage: "connected" | "unavailable"; supabaseUrlConfigured: boolean; secretKeyConfigured: boolean };
}
export interface BillingSnapshot {
  subscription: { plan_id: string; plan_name: string; storage_limit_gb: number; status: string; current_period_end: string | null };
  plans: SubscriptionPlan[];
  payments: PaymentRecord[];
  storage: StorageUsage;
  billingSettings: BillingSettings;
  paymentMethods: PaymentMethod[];
  maxUploadMb: number;
}
