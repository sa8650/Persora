import {
  Activity,
  AlarmClock,
  BellRing,
  BookOpen,
  CalendarDays,
  Camera,
  CheckSquare,
  Cloud,
  CreditCard,
  ExternalLink,
  FileClock,
  FileStack,
  FileText,
  FolderKanban,
  FolderOpen,
  GraduationCap,
  HandCoins,
  HardDrive,
  HeartPulse,
  History,
  KeyRound,
  Link2,
  ListChecks,
  Plug,
  Plus,
  Receipt,
  Sheet,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  StickyNote,
  Upload,
  Users,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { DashboardWidgetType, QuickActionId } from "../../lib/dashboard-api";
import type { PersoraTone } from "../../design-system";

export interface WidgetVisualMeta {
  icon: LucideIcon;
  tone: PersoraTone;
}

export const WIDGET_VISUALS: Record<DashboardWidgetType, WidgetVisualMeta> = {
  "quick-actions": { icon: Sparkles, tone: "blue" },
  "calendar-agenda": { icon: CalendarDays, tone: "blue" },
  "tasks-due": { icon: CheckSquare, tone: "emerald" },
  "upcoming-reminders": { icon: BellRing, tone: "amber" },
  "habit-tracker": { icon: ListChecks, tone: "cyan" },
  "quick-note": { icon: StickyNote, tone: "amber" },
  "recently-opened": { icon: History, tone: "blue" },
  "project-progress": { icon: FolderKanban, tone: "violet" },
  "recent-project-activity": { icon: Activity, tone: "violet" },

  "expiring-documents": { icon: FileClock, tone: "rose" },
  "recent-documents": { icon: FileText, tone: "blue" },
  "pinned-folders": { icon: FolderOpen, tone: "cyan" },
  "family-document-overview": { icon: Users, tone: "rose" },
  "academic-records": { icon: GraduationCap, tone: "violet" },
  "warranty-expiry": { icon: ShoppingBag, tone: "amber" },
  "recent-uploads": { icon: Upload, tone: "emerald" },

  "upcoming-loan-installments": { icon: HandCoins, tone: "amber" },
  "subscription-renewals": { icon: CreditCard, tone: "amber" },
  "combined-upcoming-payments": { icon: Receipt, tone: "rose" },
  "payment-status-summary": { icon: WalletCards, tone: "emerald" },

  "favorite-urls": { icon: Link2, tone: "cyan" },
  "digital-memberships": { icon: CreditCard, tone: "blue" },
  "contact-shortcuts": { icon: UsersRound, tone: "blue" },
  "pdf-studio-shortcut": { icon: FileStack, tone: "violet" },
  "photo-studio-shortcut": { icon: Camera, tone: "cyan" },
  "medical-records-shortcut": { icon: HeartPulse, tone: "rose" },
  "password-vault-status": { icon: KeyRound, tone: "emerald" },

  "google-drive-status": { icon: Cloud, tone: "blue" },
  "external-storage-status": { icon: HardDrive, tone: "cyan" },
  "connected-service-shortcuts": { icon: Plug, tone: "violet" },
};

export const QUICK_ACTION_VISUALS: Record<QuickActionId, WidgetVisualMeta> = {
  "add-document": { icon: Plus, tone: "blue" },
  "create-task": { icon: CheckSquare, tone: "emerald" },
  "add-calendar-event": { icon: CalendarDays, tone: "blue" },
  "create-note": { icon: StickyNote, tone: "amber" },
  "add-reminder": { icon: AlarmClock, tone: "amber" },
  "add-habit": { icon: ListChecks, tone: "cyan" },
  "add-loan": { icon: HandCoins, tone: "amber" },
  "open-photo-studio": { icon: Camera, tone: "cyan" },
  "open-pdf-studio": { icon: FileStack, tone: "violet" },
  "open-projects": { icon: FolderKanban, tone: "violet" },
  "open-contacts": { icon: UsersRound, tone: "blue" },
  "open-tables": { icon: Sheet, tone: "emerald" },
};

export { BookOpen, ExternalLink, ShieldAlert };
