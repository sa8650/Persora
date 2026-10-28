// Persora Customizable Dashboard — shared widget catalog, configuration schemas,
// presets, layout manipulation, and server/client validation rules.
// Pure ES module (no DOM, no Cloudflare-specific globals) so the Worker API,
// browser UI, and Node test suites enforce identical contracts.

export const DASHBOARD_MAX_WIDGETS = 40;
export const DASHBOARD_TITLE_MAX = 120;
export const DASHBOARD_NOTE_MAX = 4000;
export const DASHBOARD_WIDGET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;

export const DASHBOARD_WIDGET_WIDTHS = Object.freeze(["compact", "half", "two-thirds", "full"]);
export const DASHBOARD_WIDGET_HEIGHTS = Object.freeze(["compact", "standard", "expanded"]);

export const WIDTH_SPAN_DESKTOP = Object.freeze({
  compact: 4,
  half: 6,
  "two-thirds": 8,
  full: 12,
});

export const WIDTH_RANK = Object.freeze({
  compact: 0,
  half: 1,
  "two-thirds": 2,
  full: 3,
});

export const DASHBOARD_WIDGET_CATEGORIES = Object.freeze([
  { id: "productivity", label: "Productivity", description: "Daily schedule, tasks, habits, reminders, notes, and projects." },
  { id: "personal-documents", label: "Personal Documents", description: "Expiring IDs, folders, family paperwork, academics, and warranties." },
  { id: "payments-renewals", label: "Payments and Renewals", description: "Loan installments, subscription renewals, and payment summaries." },
  { id: "personal-tools", label: "Personal Tools", description: "Saved links, memberships, contacts, studios, health, and vault status." },
  { id: "connected-services", label: "Connected Services", description: "Cloud storage quota and connected external service status." },
]);

export const QUICK_ACTION_DEFINITIONS = Object.freeze([
  { id: "add-document", label: "Add document", hint: "Smart Scan or upload to vault" },
  { id: "create-task", label: "Create task", hint: "Add a due task with priority" },
  { id: "add-calendar-event", label: "Add calendar event", hint: "Schedule an event or appointment" },
  { id: "create-note", label: "Create note", hint: "Write a private note" },
  { id: "add-reminder", label: "Add reminder", hint: "Set a dated reminder alert" },
  { id: "add-habit", label: "Add habit", hint: "Track a daily or weekly routine" },
  { id: "add-loan", label: "Add loan", hint: "Track borrowed or lent schedules" },
  { id: "open-photo-studio", label: "Open Photo Studio", hint: "Passport, visa & official photos" },
  { id: "open-pdf-studio", label: "Open PDF Studio", hint: "Create, merge & organize PDFs" },
  { id: "open-projects", label: "Open Projects", hint: "Manage project boards & tasks" },
  { id: "open-contacts", label: "Open Contacts", hint: "People, emergency & work directory" },
  { id: "open-tables", label: "Open Persora Table", hint: "Structured sheets & records" },
]);

export const QUICK_ACTION_IDS = Object.freeze(QUICK_ACTION_DEFINITIONS.map((entry) => entry.id));
const QUICK_ACTION_ID_SET = new Set(QUICK_ACTION_IDS);

export const DEFAULT_QUICK_ACTION_IDS = Object.freeze([
  "add-document",
  "create-task",
  "add-calendar-event",
  "create-note",
  "add-habit",
  "add-loan",
  "open-photo-studio",
  "open-pdf-studio",
]);

/**
 * Canonical catalog of all 29 real-data-connected Persora dashboard widgets.
 */
export const DASHBOARD_WIDGET_CATALOG = Object.freeze([
  // ── Productivity ──────────────────────────────────────────────────────────
  {
    type: "quick-actions",
    category: "productivity",
    name: "Quick Actions",
    defaultTitle: "Quick Actions",
    description: "One-click shortcuts to create records, schedule events, and launch studios.",
    previewSummary: "Add document · Create task · Calendar · Studios",
    allowMultiple: false,
    minWidth: "half",
    defaultWidth: "full",
    defaultHeight: "compact",
    defaultConfig: {
      actions: [...DEFAULT_QUICK_ACTION_IDS],
      layoutMode: "tiles",
      showDescriptions: true,
    },
    schema: {
      actions: { kind: "idList", allowed: QUICK_ACTION_ID_SET, max: 12, min: 1 },
      layoutMode: { kind: "enum", values: ["tiles", "compact"] },
      showDescriptions: { kind: "boolean" },
    },
  },
  {
    type: "calendar-agenda",
    category: "productivity",
    name: "Calendar Agenda",
    defaultTitle: "Calendar Agenda",
    description: "Upcoming events and appointments from Persora Calendar with date-range filters.",
    previewSummary: "Today · Next 3 days · This week",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      range: "today",
      customDays: 7,
      itemType: "all",
      category: "all",
      limit: 6,
      showLocation: true,
    },
    schema: {
      range: { kind: "enum", values: ["today", "next-3-days", "this-week", "custom"] },
      customDays: { kind: "int", min: 1, max: 30 },
      itemType: { kind: "enum", values: ["all", "event", "appointment", "task"] },
      category: { kind: "enum", values: ["all", "personal", "work", "family", "health", "travel", "social", "other"] },
      limit: { kind: "int", min: 3, max: 15 },
      showLocation: { kind: "boolean" },
    },
  },
  {
    type: "tasks-due",
    category: "productivity",
    name: "Tasks Due",
    defaultTitle: "Tasks",
    description: "Overdue, due today, upcoming, or project-specific tasks you can complete in place.",
    previewSummary: "Check off tasks · Overdue, Today & Projects",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      filter: "all-active",
      projectId: "",
      includeCalendarTasks: true,
      sortBy: "due-asc",
      limit: 6,
      showPriority: true,
    },
    schema: {
      filter: { kind: "enum", values: ["all-active", "overdue", "due-today", "upcoming", "completed", "project"] },
      projectId: { kind: "string", max: 80 },
      includeCalendarTasks: { kind: "boolean" },
      sortBy: { kind: "enum", values: ["due-asc", "priority-desc", "updated-desc"] },
      limit: { kind: "int", min: 3, max: 15 },
      showPriority: { kind: "boolean" },
    },
  },
  {
    type: "upcoming-reminders",
    category: "productivity",
    name: "Upcoming Reminders",
    defaultTitle: "Upcoming Reminders",
    description: "Scheduled personal reminders with dates and alert times, kept separate from tasks and notes.",
    previewSummary: "Reminder titles, dates & alert times",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      windowDays: 30,
      includePaused: false,
      includeModuleReminders: true,
      limit: 6,
    },
    schema: {
      windowDays: { kind: "int", min: 1, max: 180 },
      includePaused: { kind: "boolean" },
      includeModuleReminders: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "habit-tracker",
    category: "productivity",
    name: "Habit Tracker",
    defaultTitle: "Habit Tracker",
    description: "Habits scheduled for today with checkbox, repetition, and numeric check-ins.",
    previewSummary: "Today's habits · Targets & streaks",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      category: "all",
      showCompleted: true,
      showStreaks: true,
      limit: 8,
    },
    schema: {
      category: { kind: "enum", values: ["all", "health", "study", "fitness", "personal", "work"] },
      showCompleted: { kind: "boolean" },
      showStreaks: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 16 },
    },
  },
  {
    type: "quick-note",
    category: "productivity",
    name: "Quick Note",
    defaultTitle: "Quick Note",
    description: "Pin an existing vault note or capture a new private note directly from your dashboard.",
    previewSummary: "Live synced note pad · Saves to Notes",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      noteId: "",
      showTags: true,
    },
    schema: {
      noteId: { kind: "string", max: 120 },
      showTags: { kind: "boolean" },
    },
  },
  {
    type: "recently-opened",
    category: "productivity",
    name: "Recently Opened",
    defaultTitle: "Recently Opened",
    description: "Jump back into records you recently opened or updated across your Persora vault.",
    previewSummary: "Real access & update timestamps",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "full",
    defaultHeight: "compact",
    defaultConfig: {
      sectionFilter: "all",
      sourceMode: "opened-or-updated",
      limit: 6,
      displayMode: "grid",
    },
    schema: {
      sectionFilter: { kind: "enum", values: ["all", "documents", "notes", "academics", "subscriptions", "purchases", "memberships", "urls", "contacts", "personal-finance"] },
      sourceMode: { kind: "enum", values: ["opened-or-updated", "opened-only"] },
      limit: { kind: "int", min: 3, max: 12 },
      displayMode: { kind: "enum", values: ["list", "grid"] },
    },
  },
  {
    type: "project-progress",
    category: "productivity",
    name: "Project Progress",
    defaultTitle: "Project Progress",
    description: "Track completion progress across active Persora Projects and open boards in one click.",
    previewSummary: "Progress bars · Active & completed fields",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      statusFilter: "all",
      sortBy: "updated",
      limit: 5,
    },
    schema: {
      statusFilter: { kind: "enum", values: ["all", "active", "completed"] },
      sortBy: { kind: "enum", values: ["updated", "progress", "name"] },
      limit: { kind: "int", min: 3, max: 12 },
    },
  },
  {
    type: "recent-project-activity",
    category: "productivity",
    name: "Recent Project Activity",
    defaultTitle: "Recent Project Activity",
    description: "Latest real updates and notifications across your shared and personal projects.",
    previewSummary: "Real project events & updates",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      unreadOnly: false,
      limit: 6,
    },
    schema: {
      unreadOnly: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },

  // ── Personal Documents ────────────────────────────────────────────────────
  {
    type: "expiring-documents",
    category: "personal-documents",
    name: "Expiring Documents",
    defaultTitle: "Expiring Documents",
    description: "Passports, IDs, visas, insurance, and memberships approaching their expiry date.",
    previewSummary: "Configurable warning window · Direct record links",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      warningDays: 90,
      includeExpired: true,
      documentCategory: "all",
      includeMemberships: true,
      limit: 6,
    },
    schema: {
      warningDays: { kind: "int", min: 7, max: 730 },
      includeExpired: { kind: "boolean" },
      documentCategory: { kind: "enum", values: ["all", "Passport", "National ID / NID", "Visa", "Driving licence", "Insurance", "Residence permit", "Work permit"] },
      includeMemberships: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "recent-documents",
    category: "personal-documents",
    name: "Recent Documents",
    defaultTitle: "Recent Documents",
    description: "Recently saved or updated personal documents with file-type badges and quick preview.",
    previewSummary: "IDs, passports, certificates & scans",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      documentCategory: "all",
      sortBy: "updated-desc",
      limit: 6,
      showExpiry: true,
    },
    schema: {
      documentCategory: { kind: "enum", values: ["all", "Passport", "National ID / NID", "Birth certificate", "Visa", "Driving licence", "Insurance", "Certificate", "Contract", "CV / Resume"] },
      sortBy: { kind: "enum", values: ["updated-desc", "created-desc", "title-asc"] },
      limit: { kind: "int", min: 3, max: 15 },
      showExpiry: { kind: "boolean" },
    },
  },
  {
    type: "pinned-folders",
    category: "personal-documents",
    name: "Pinned Folders",
    defaultTitle: "Pinned Folders",
    description: "Quick access to pinned folders across Documents, Academics, Purchases, and Studios.",
    previewSummary: "Pinned vault folders & item counts",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "compact",
    defaultConfig: {
      scopeFilter: "all",
      pinnedOnly: true,
      limit: 8,
    },
    schema: {
      scopeFilter: { kind: "enum", values: ["all", "documents", "academics", "purchases", "subscriptions", "notes", "study", "contacts"] },
      pinnedOnly: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 16 },
    },
  },
  {
    type: "family-document-overview",
    category: "personal-documents",
    name: "Family Document Overview",
    defaultTitle: "Family Document Overview",
    description: "Document counts and expiring paperwork grouped by you and your saved family members.",
    previewSummary: "Per-member document & expiry summary",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      warningDays: 90,
      showSelf: true,
      limit: 6,
    },
    schema: {
      warningDays: { kind: "int", min: 14, max: 365 },
      showSelf: { kind: "boolean" },
      limit: { kind: "int", min: 2, max: 12 },
    },
  },
  {
    type: "academic-records",
    category: "personal-documents",
    name: "Academic Records Shortcuts",
    defaultTitle: "Academic Records",
    description: "Certificates, transcripts, degrees, and admission documents ready to open.",
    previewSummary: "Degrees, transcripts & grades",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      recordType: "all",
      showGrade: true,
      limit: 6,
    },
    schema: {
      recordType: { kind: "enum", values: ["all", "SSC / Secondary certificate", "HSC / Higher secondary certificate", "Diploma", "Bachelor's degree", "Master's degree", "PhD", "Transcript", "Certificate", "Training record"] },
      showGrade: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "warranty-expiry",
    category: "personal-documents",
    name: "Warranty Expiry",
    defaultTitle: "Warranty Expiry",
    description: "Track purchase warranties approaching expiration alongside invoices and serial numbers.",
    previewSummary: "Purchases & warranty countdowns",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      warningDays: 180,
      includeExpired: false,
      limit: 6,
    },
    schema: {
      warningDays: { kind: "int", min: 14, max: 1095 },
      includeExpired: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "recent-uploads",
    category: "personal-documents",
    name: "Recent Uploads",
    defaultTitle: "Recent Uploads",
    description: "Latest files and scans attached to records across your private vault.",
    previewSummary: "PDFs, scans & images with file sizes",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      fileCategory: "all",
      limit: 6,
    },
    schema: {
      fileCategory: { kind: "enum", values: ["all", "pdf", "image", "other"] },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },

  // ── Payments and Renewals ─────────────────────────────────────────────────
  {
    type: "upcoming-loan-installments",
    category: "payments-renewals",
    name: "Upcoming Loan Installments",
    defaultTitle: "Upcoming Loan Installments",
    description: "Next due and overdue installments from Persora Loan Tracker with repayment progress.",
    previewSummary: "Borrowed & lent installment schedules",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      direction: "all",
      windowDays: 60,
      limit: 6,
    },
    schema: {
      direction: { kind: "enum", values: ["all", "borrowed", "lent"] },
      windowDays: { kind: "int", min: 7, max: 365 },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "subscription-renewals",
    category: "payments-renewals",
    name: "Subscription Renewals",
    defaultTitle: "Subscription Renewals",
    description: "Upcoming recurring plan renewals, billing cycles, and attached payment methods.",
    previewSummary: "Monthly & annual plan renewal dates",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      cycleFilter: "all",
      windowDays: 60,
      includePastDue: true,
      limit: 6,
    },
    schema: {
      cycleFilter: { kind: "enum", values: ["all", "Monthly", "Quarterly", "Yearly", "Weekly"] },
      windowDays: { kind: "int", min: 7, max: 365 },
      includePastDue: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "combined-upcoming-payments",
    category: "payments-renewals",
    name: "Combined Upcoming Payments",
    defaultTitle: "Upcoming Payments",
    description: "Unified timeline of Loan Tracker installments and Subscription Manager renewals.",
    previewSummary: "Loans + Subscriptions in due-date order",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      paymentSource: "all",
      windowDays: 45,
      includeOverdue: true,
      limit: 6,
    },
    schema: {
      paymentSource: { kind: "enum", values: ["all", "loans-only", "subscriptions-only"] },
      windowDays: { kind: "int", min: 7, max: 365 },
      includeOverdue: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "payment-status-summary",
    category: "payments-renewals",
    name: "Payment Status Summary",
    defaultTitle: "Payment Status Summary",
    description: "At-a-glance status of active subscriptions, loan repayment progress, and finance entries.",
    previewSummary: "Active plans · Loan progress · Overdue count",
    allowMultiple: false,
    minWidth: "half",
    defaultWidth: "full",
    defaultHeight: "compact",
    defaultConfig: {
      showFinanceSummary: true,
      windowDays: 30,
    },
    schema: {
      showFinanceSummary: { kind: "boolean" },
      windowDays: { kind: "int", min: 7, max: 180 },
    },
  },

  // ── Personal Tools ────────────────────────────────────────────────────────
  {
    type: "favorite-urls",
    category: "personal-tools",
    name: "Favorite Personal URLs",
    defaultTitle: "Saved Links",
    description: "Launch your most-used bookmarks, portals, and personal URLs in one click.",
    previewSummary: "Portals, portfolios & bookmarked links",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      urlCategory: "all",
      favoritesOnly: false,
      limit: 6,
    },
    schema: {
      urlCategory: { kind: "enum", values: ["all", "Personal website", "Portfolio", "Government portal", "Business", "Education portal", "Payment link", "GitHub", "LinkedIn"] },
      favoritesOnly: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "digital-memberships",
    category: "personal-tools",
    name: "Digital Membership Shortcuts",
    defaultTitle: "Digital Memberships",
    description: "Quick access to library, gym, club, and loyalty cards from your Membership Wallet.",
    previewSummary: "Member IDs, tiers & renewal status",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      membershipType: "all",
      showMemberId: true,
      limit: 6,
    },
    schema: {
      membershipType: { kind: "enum", values: ["all", "Gym", "Library", "Student", "Professional", "Club", "Loyalty", "Travel", "Insurance"] },
      showMemberId: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "contact-shortcuts",
    category: "personal-tools",
    name: "Contact Shortcuts",
    defaultTitle: "Contact Shortcuts",
    description: "Pin favorite, family, emergency, or work contacts for quick reference.",
    previewSummary: "Favorites, Family & Emergency contacts",
    allowMultiple: true,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      category: "all",
      favoritesOnly: false,
      limit: 6,
    },
    schema: {
      category: { kind: "enum", values: ["all", "Family", "Friends", "Work", "Emergency", "Medical", "Service"] },
      favoritesOnly: { kind: "boolean" },
      limit: { kind: "int", min: 3, max: 15 },
    },
  },
  {
    type: "pdf-studio-shortcut",
    category: "personal-tools",
    name: "PDF Studio Shortcut",
    defaultTitle: "PDF Studio",
    description: "Open PDF Studio to create, merge, watermark, or inspect recent saved PDFs.",
    previewSummary: "Quick launch + recent PDF Studio library",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "compact",
    defaultHeight: "compact",
    defaultConfig: {
      showRecentLibrary: true,
      limit: 3,
    },
    schema: {
      showRecentLibrary: { kind: "boolean" },
      limit: { kind: "int", min: 1, max: 6 },
    },
  },
  {
    type: "photo-studio-shortcut",
    category: "personal-tools",
    name: "Photo Studio Shortcut",
    defaultTitle: "Photo Studio",
    description: "Launch Photo Studio for passport, visa, and ID photos and see recent studio items.",
    previewSummary: "Passport & visa presets + studio library",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "compact",
    defaultHeight: "compact",
    defaultConfig: {
      showRecentLibrary: true,
      limit: 3,
    },
    schema: {
      showRecentLibrary: { kind: "boolean" },
      limit: { kind: "int", min: 1, max: 6 },
    },
  },
  {
    type: "medical-records-shortcut",
    category: "personal-tools",
    name: "Medical Records Shortcut",
    defaultTitle: "Medical Records",
    description: "Privacy-shielded shortcut to your Medical Records archive. Clinical details stay hidden.",
    previewSummary: "Privacy-first · No clinical details shown",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "compact",
    defaultHeight: "compact",
    defaultConfig: {
      showRecordCount: false,
    },
    schema: {
      showRecordCount: { kind: "boolean" },
    },
  },
  {
    type: "password-vault-status",
    category: "personal-tools",
    name: "Password Vault Status",
    defaultTitle: "Password Vault",
    description: "Master-password lock status and recovery readiness. Never exposes passwords or secrets.",
    previewSummary: "Vault lock & setup status · Zero secrets",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "compact",
    defaultHeight: "compact",
    defaultConfig: {
      showRecordCount: true,
    },
    schema: {
      showRecordCount: { kind: "boolean" },
    },
  },

  // ── Connected Services ────────────────────────────────────────────────────
  {
    type: "google-drive-status",
    category: "connected-services",
    name: "Google Drive Connection Status",
    defaultTitle: "Google Drive",
    description: "Current integration status for Google Drive in Persora Connections.",
    previewSummary: "Provider status & Connections shortcut",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "compact",
    defaultHeight: "compact",
    defaultConfig: {
      showCapabilities: true,
    },
    schema: {
      showCapabilities: { kind: "boolean" },
    },
  },
  {
    type: "external-storage-status",
    category: "connected-services",
    name: "External Storage Status",
    defaultTitle: "Storage & Cloud Status",
    description: "Persora vault storage usage, quota progress, and linked external file providers.",
    previewSummary: "Storage quota bar & linked providers",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "compact",
    defaultConfig: {
      showProviders: true,
    },
    schema: {
      showProviders: { kind: "boolean" },
    },
  },
  {
    type: "connected-service-shortcuts",
    category: "connected-services",
    name: "Connected Service Shortcuts",
    defaultTitle: "Connected Services",
    description: "Status and one-click access to EMS Vaultium and external service integrations.",
    previewSummary: "EMS Vaultium & service links",
    allowMultiple: false,
    minWidth: "compact",
    defaultWidth: "half",
    defaultHeight: "standard",
    defaultConfig: {
      hideComingSoon: false,
      limit: 5,
    },
    schema: {
      hideComingSoon: { kind: "boolean" },
      limit: { kind: "int", min: 2, max: 8 },
    },
  },
]);

export const DASHBOARD_WIDGET_TYPES = Object.freeze(DASHBOARD_WIDGET_CATALOG.map((entry) => entry.type));
export const DASHBOARD_WIDGET_BY_TYPE = Object.freeze(
  Object.fromEntries(DASHBOARD_WIDGET_CATALOG.map((entry) => [entry.type, entry])),
);

export function isDashboardWidgetType(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DASHBOARD_WIDGET_BY_TYPE, value);
}

export function isDashboardWidth(value) {
  return DASHBOARD_WIDGET_WIDTHS.includes(value);
}

export function isDashboardHeight(value) {
  return DASHBOARD_WIDGET_HEIGHTS.includes(value);
}

export function clampWidgetWidth(type, requestedWidth) {
  const meta = DASHBOARD_WIDGET_BY_TYPE[type];
  if (!meta) return "half";
  const width = isDashboardWidth(requestedWidth) ? requestedWidth : meta.defaultWidth;
  if (WIDTH_RANK[width] < WIDTH_RANK[meta.minWidth]) return meta.minWidth;
  return width;
}

export class DashboardValidationError extends Error {
  constructor(message, status = 400, code = "invalid_dashboard") {
    super(message);
    this.name = "DashboardValidationError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Validates and normalizes a widget's `config` object strictly against its catalog schema.
 * Rejects unknown keys or wrong types when `strict` is true (used by the server API).
 */
export function normalizeWidgetConfig(type, rawConfig, { strict = false } = {}) {
  const meta = DASHBOARD_WIDGET_BY_TYPE[type];
  if (!meta) throw new DashboardValidationError(`Unsupported widget type: ${String(type)}.`);
  if (rawConfig === undefined || rawConfig === null) return structuredCloneConfig(meta.defaultConfig);
  if (typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new DashboardValidationError(`Configuration for "${type}" must be an object.`);
  }
  const proto = Object.getPrototypeOf(rawConfig);
  if (proto !== null && proto !== Object.prototype) {
    throw new DashboardValidationError(`Invalid configuration object for "${type}".`);
  }

  const schema = meta.schema;
  if (strict) {
    for (const key of Object.keys(rawConfig)) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        throw new DashboardValidationError(`Unknown configuration field "${key}" on widget "${type}".`);
      }
    }
  }

  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const hasValue = Object.prototype.hasOwnProperty.call(rawConfig, key) && rawConfig[key] !== undefined;
    const raw = hasValue ? rawConfig[key] : meta.defaultConfig[key];

    if (rule.kind === "boolean") {
      if (strict && hasValue && typeof raw !== "boolean") {
        throw new DashboardValidationError(`Field "${key}" on "${type}" must be a boolean.`);
      }
      out[key] = Boolean(raw);
    } else if (rule.kind === "enum") {
      if (!rule.values.includes(raw)) {
        if (strict && hasValue) {
          throw new DashboardValidationError(`Field "${key}" on "${type}" has an unsupported option.`);
        }
        out[key] = meta.defaultConfig[key];
      } else {
        out[key] = raw;
      }
    } else if (rule.kind === "int") {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num) || (strict && hasValue && (!Number.isInteger(raw) || raw < rule.min || raw > rule.max))) {
        if (strict && hasValue) {
          throw new DashboardValidationError(`Field "${key}" on "${type}" must be an integer between ${rule.min} and ${rule.max}.`);
        }
        out[key] = meta.defaultConfig[key];
      } else {
        out[key] = Math.max(rule.min, Math.min(rule.max, Math.round(num)));
      }
    } else if (rule.kind === "string") {
      if (strict && hasValue && typeof raw !== "string") {
        throw new DashboardValidationError(`Field "${key}" on "${type}" must be text.`);
      }
      const text = typeof raw === "string" ? raw.trim() : "";
      if (strict && text.length > rule.max) {
        throw new DashboardValidationError(`Field "${key}" on "${type}" exceeds ${rule.max} characters.`);
      }
      out[key] = text.slice(0, rule.max);
    } else if (rule.kind === "idList") {
      if (!Array.isArray(raw)) {
        if (strict && hasValue) {
          throw new DashboardValidationError(`Field "${key}" on "${type}" must be a list.`);
        }
        out[key] = [...meta.defaultConfig[key]];
      } else {
        const seen = new Set();
        const list = [];
        for (const entry of raw) {
          if (typeof entry !== "string" || !rule.allowed.has(entry)) {
            if (strict) throw new DashboardValidationError(`Unsupported shortcut "${String(entry)}" on "${type}".`);
            continue;
          }
          if (seen.has(entry)) continue;
          seen.add(entry);
          list.push(entry);
          if (list.length >= rule.max) break;
        }
        if (list.length < (rule.min || 0)) {
          if (strict && hasValue) {
            throw new DashboardValidationError(`Select at least ${rule.min} item for "${key}" on "${type}".`);
          }
          out[key] = [...meta.defaultConfig[key]];
        } else {
          out[key] = list;
        }
      }
    }
  }
  return out;
}

function structuredCloneConfig(config) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/**
 * Presets — every preset uses real supported library widgets and clean 12-column spans.
 * `balanced` doubles as the Default Dashboard for first-time users (8 widgets).
 */
export const DASHBOARD_PRESETS = Object.freeze([
  {
    id: "balanced",
    name: "Balanced",
    badge: "Default",
    description: "Daily schedule, tasks, habits, reminders, expiring paperwork, upcoming payments, and recent records.",
    widgets: [
      { id: "w-quick-actions", type: "quick-actions", title: "Quick Actions", width: "full", height: "compact", config: {} },
      { id: "w-today-schedule", type: "calendar-agenda", title: "Today's Schedule", width: "half", height: "standard", config: { range: "today", limit: 6 } },
      { id: "w-tasks", type: "tasks-due", title: "Tasks", width: "half", height: "standard", config: { filter: "all-active", limit: 6 } },
      { id: "w-habits", type: "habit-tracker", title: "Habit Tracker", width: "half", height: "standard", config: { showStreaks: true } },
      { id: "w-reminders", type: "upcoming-reminders", title: "Upcoming Reminders", width: "half", height: "standard", config: { windowDays: 30, limit: 5 } },
      { id: "w-expiring-docs", type: "expiring-documents", title: "Expiring Documents", width: "half", height: "standard", config: { warningDays: 90, includeExpired: true } },
      { id: "w-upcoming-payments", type: "combined-upcoming-payments", title: "Upcoming Payments", width: "half", height: "standard", config: { paymentSource: "all", windowDays: 45 } },
      { id: "w-recently-opened", type: "recently-opened", title: "Recently Opened", width: "full", height: "compact", config: { displayMode: "grid", limit: 6 } },
    ],
  },
  {
    id: "productivity",
    name: "Productivity",
    badge: "Focus",
    description: "Execution-focused view with agenda, tasks, habits, reminders, active projects, and quick notes.",
    widgets: [
      { id: "w-prod-actions", type: "quick-actions", title: "Quick Actions", width: "full", height: "compact", config: { actions: ["create-task", "add-calendar-event", "create-note", "add-reminder", "add-habit", "open-projects", "add-document", "open-tables"] } },
      { id: "w-prod-agenda", type: "calendar-agenda", title: "Today's Schedule", width: "half", height: "standard", config: { range: "next-3-days", limit: 7 } },
      { id: "w-prod-tasks", type: "tasks-due", title: "Tasks Due", width: "half", height: "standard", config: { filter: "all-active", limit: 8 } },
      { id: "w-prod-habits", type: "habit-tracker", title: "Habit Tracker", width: "half", height: "standard", config: { showStreaks: true } },
      { id: "w-prod-reminders", type: "upcoming-reminders", title: "Upcoming Reminders", width: "half", height: "standard", config: { windowDays: 14 } },
      { id: "w-prod-projects", type: "project-progress", title: "Project Progress", width: "half", height: "standard", config: { statusFilter: "active", sortBy: "updated" } },
      { id: "w-prod-activity", type: "recent-project-activity", title: "Recent Project Activity", width: "half", height: "standard", config: { limit: 6 } },
      { id: "w-prod-note", type: "quick-note", title: "Quick Note", width: "full", height: "compact", config: {} },
    ],
  },
  {
    id: "personal-records",
    name: "Personal Records",
    badge: "Vault",
    description: "Centered on identity documents, pinned folders, family paperwork, academics, warranties, and private archives.",
    widgets: [
      { id: "w-rec-actions", type: "quick-actions", title: "Quick Actions", width: "full", height: "compact", config: { actions: ["add-document", "open-pdf-studio", "open-photo-studio", "open-contacts", "create-note", "add-reminder"] } },
      { id: "w-rec-expiring", type: "expiring-documents", title: "Expiring Documents", width: "half", height: "standard", config: { warningDays: 180, includeExpired: true } },
      { id: "w-rec-docs", type: "recent-documents", title: "Recent Documents", width: "half", height: "standard", config: { limit: 6 } },
      { id: "w-rec-folders", type: "pinned-folders", title: "Pinned Folders", width: "half", height: "compact", config: { pinnedOnly: true } },
      { id: "w-rec-family", type: "family-document-overview", title: "Family Document Overview", width: "half", height: "standard", config: { warningDays: 120 } },
      { id: "w-rec-warranty", type: "warranty-expiry", title: "Warranty Expiry", width: "half", height: "standard", config: { warningDays: 180 } },
      { id: "w-rec-academics", type: "academic-records", title: "Academic Records", width: "half", height: "standard", config: { showGrade: true } },
      { id: "w-rec-medical", type: "medical-records-shortcut", title: "Medical Records", width: "compact", height: "compact", config: { showRecordCount: false } },
      { id: "w-rec-vault", type: "password-vault-status", title: "Password Vault", width: "compact", height: "compact", config: { showRecordCount: true } },
      { id: "w-rec-storage", type: "external-storage-status", title: "Storage & Cloud Status", width: "compact", height: "compact", config: { showProviders: true } },
    ],
  },
  {
    id: "payments-and-renewals",
    name: "Payments and Renewals",
    badge: "Finance",
    description: "Stay ahead of loan installments, recurring subscriptions, expiring warranties, and memberships.",
    widgets: [
      { id: "w-pay-summary", type: "payment-status-summary", title: "Payment Status Summary", width: "full", height: "compact", config: { showFinanceSummary: true, windowDays: 30 } },
      { id: "w-pay-combined", type: "combined-upcoming-payments", title: "Upcoming Payments", width: "half", height: "standard", config: { paymentSource: "all", windowDays: 60 } },
      { id: "w-pay-loans", type: "upcoming-loan-installments", title: "Upcoming Loan Installments", width: "half", height: "standard", config: { direction: "all", windowDays: 90 } },
      { id: "w-pay-subs", type: "subscription-renewals", title: "Subscription Renewals", width: "half", height: "standard", config: { windowDays: 60 } },
      { id: "w-pay-warranty", type: "warranty-expiry", title: "Warranty Expiry", width: "half", height: "standard", config: { warningDays: 180 } },
      { id: "w-pay-memberships", type: "digital-memberships", title: "Digital Memberships", width: "full", height: "compact", config: { showMemberId: true } },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    badge: "Calm",
    description: "Clean, quiet essentials: quick shortcuts, today's schedule, active tasks, and upcoming reminders.",
    widgets: [
      { id: "w-min-actions", type: "quick-actions", title: "Quick Actions", width: "full", height: "compact", config: { actions: ["add-document", "create-task", "add-calendar-event", "create-note"], layoutMode: "compact", showDescriptions: false } },
      { id: "w-min-schedule", type: "calendar-agenda", title: "Today's Schedule", width: "half", height: "standard", config: { range: "today", limit: 5 } },
      { id: "w-min-tasks", type: "tasks-due", title: "Tasks", width: "half", height: "standard", config: { filter: "due-today", limit: 5 } },
      { id: "w-min-reminders", type: "upcoming-reminders", title: "Upcoming Reminders", width: "full", height: "compact", config: { windowDays: 14, limit: 4 } },
    ],
  },
]);

export const DASHBOARD_PRESET_IDS = Object.freeze(DASHBOARD_PRESETS.map((entry) => entry.id));
export const DASHBOARD_PRESET_BY_ID = Object.freeze(
  Object.fromEntries(DASHBOARD_PRESETS.map((entry) => [entry.id, entry])),
);

export function isDashboardPresetId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DASHBOARD_PRESET_BY_ID, value);
}

export function generateWidgetId(type = "widget") {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const safePrefix = String(type || "widget").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "widget";
  return `w-${safePrefix}-${rand}`;
}

export function buildPresetWidgets(presetId = "balanced", { freshIds = false, now = new Date().toISOString() } = {}) {
  const preset = DASHBOARD_PRESET_BY_ID[presetId] || DASHBOARD_PRESET_BY_ID.balanced;
  return preset.widgets.map((entry, index) => {
    const meta = DASHBOARD_WIDGET_BY_TYPE[entry.type];
    return {
      id: freshIds ? generateWidgetId(entry.type) : entry.id,
      type: entry.type,
      title: entry.title || meta.defaultTitle,
      config: normalizeWidgetConfig(entry.type, entry.config, { strict: false }),
      position: index,
      width: clampWidgetWidth(entry.type, entry.width || meta.defaultWidth),
      height: isDashboardHeight(entry.height) ? entry.height : meta.defaultHeight,
      visible: true,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function createDefaultDashboardLayout(now = new Date().toISOString()) {
  return {
    customized: false,
    activePreset: "balanced",
    revision: 0,
    updatedAt: null,
    widgets: buildPresetWidgets("balanced", { freshIds: false, now }),
  };
}

export function createWidgetFromLibrary(type, existingWidgets = [], overrides = {}) {
  const meta = DASHBOARD_WIDGET_BY_TYPE[type];
  if (!meta) throw new DashboardValidationError(`Unsupported widget type: ${String(type)}.`);
  if (!meta.allowMultiple && existingWidgets.some((entry) => entry.type === type && entry.visible !== false)) {
    throw new DashboardValidationError(`${meta.name} is already on your dashboard.`);
  }
  const now = new Date().toISOString();
  const id = overrides.id && DASHBOARD_WIDGET_ID_RE.test(overrides.id) ? overrides.id : generateWidgetId(type);
  const title = typeof overrides.title === "string" && overrides.title.trim()
    ? overrides.title.trim().slice(0, DASHBOARD_TITLE_MAX)
    : meta.defaultTitle;
  return {
    id,
    type,
    title,
    config: normalizeWidgetConfig(type, overrides.config, { strict: false }),
    position: existingWidgets.length,
    width: clampWidgetWidth(type, overrides.width || meta.defaultWidth),
    height: isDashboardHeight(overrides.height) ? overrides.height : meta.defaultHeight,
    visible: overrides.visible !== undefined ? Boolean(overrides.visible) : true,
    collapsed: overrides.collapsed !== undefined ? Boolean(overrides.collapsed) : false,
    createdAt: now,
    updatedAt: now,
  };
}

export function reindexWidgets(widgets) {
  return widgets.map((widget, index) => ({ ...widget, position: index }));
}

export function reorderWidgets(widgets, fromIndex, toIndex) {
  if (!Array.isArray(widgets) || widgets.length <= 1) return widgets;
  const from = Math.max(0, Math.min(widgets.length - 1, Math.trunc(fromIndex)));
  const to = Math.max(0, Math.min(widgets.length - 1, Math.trunc(toIndex)));
  if (from === to) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return reindexWidgets(next);
}

export function moveWidgetById(widgets, id, targetId) {
  const from = widgets.findIndex((entry) => entry.id === id);
  const to = widgets.findIndex((entry) => entry.id === targetId);
  if (from < 0 || to < 0 || from === to) return widgets;
  return reorderWidgets(widgets, from, to);
}

export function stepWidgetOrder(widgets, id, delta) {
  const from = widgets.findIndex((entry) => entry.id === id);
  if (from < 0) return widgets;
  const to = Math.max(0, Math.min(widgets.length - 1, from + delta));
  if (from === to) return widgets;
  return reorderWidgets(widgets, from, to);
}

export function duplicateWidgetInstance(widgets, id, customNewId = "") {
  const index = widgets.findIndex((entry) => entry.id === id);
  if (index < 0) return widgets;
  const source = widgets[index];
  if (widgets.length >= DASHBOARD_MAX_WIDGETS) {
    throw new DashboardValidationError(`A dashboard can contain up to ${DASHBOARD_MAX_WIDGETS} widgets.`);
  }
  const now = new Date().toISOString();
  const baseTitle = source.title.replace(/\s*\(Copy(?:\s+\d+)?\)$/i, "").trim();
  const copyTitle = `${baseTitle} (Copy)`.slice(0, DASHBOARD_TITLE_MAX);
  let newId = customNewId && DASHBOARD_WIDGET_ID_RE.test(customNewId) ? customNewId : generateWidgetId(source.type);
  while (widgets.some((entry) => entry.id === newId)) {
    newId = generateWidgetId(source.type);
  }
  const copy = {
    ...source,
    id: newId,
    title: copyTitle,
    config: normalizeWidgetConfig(source.type, source.config, { strict: false }),
    collapsed: Boolean(source.collapsed),
    visible: true,
    createdAt: now,
    updatedAt: now,
  };
  const next = [...widgets];
  next.splice(index + 1, 0, copy);
  return reindexWidgets(next);
}

export function removeWidgetInstance(widgets, id) {
  const filtered = widgets.filter((entry) => entry.id !== id);
  return reindexWidgets(filtered);
}

export function updateWidgetInstance(widgets, id, patch) {
  const now = new Date().toISOString();
  return widgets.map((entry) => {
    if (entry.id !== id) return entry;
    const meta = DASHBOARD_WIDGET_BY_TYPE[entry.type];
    const nextTitle = typeof patch.title === "string"
      ? (patch.title.trim().slice(0, DASHBOARD_TITLE_MAX) || meta.defaultTitle)
      : entry.title;
    const nextWidth = patch.width !== undefined ? clampWidgetWidth(entry.type, patch.width) : entry.width;
    const nextHeight = patch.height !== undefined && isDashboardHeight(patch.height) ? patch.height : entry.height;
    const nextConfig = patch.config !== undefined
      ? normalizeWidgetConfig(entry.type, patch.config, { strict: false })
      : entry.config;
    return {
      ...entry,
      title: nextTitle,
      width: nextWidth,
      height: nextHeight,
      config: nextConfig,
      visible: patch.visible !== undefined ? Boolean(patch.visible) : entry.visible,
      collapsed: patch.collapsed !== undefined ? Boolean(patch.collapsed) : entry.collapsed,
      updatedAt: now,
    };
  });
}

/**
 * Full strict server/client payload validator for PUT /api/dashboard.
 * Never trusts client-provided user IDs; enforces widget count, IDs, types,
 * minimum readable widths, heights, and strict per-widget config schemas.
 */
export function validateDashboardSavePayload(body, { strict = true } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DashboardValidationError("Dashboard payload must be a JSON object.");
  }
  if (!Array.isArray(body.widgets)) {
    throw new DashboardValidationError("Dashboard widgets must be an array.");
  }
  if (body.widgets.length > DASHBOARD_MAX_WIDGETS) {
    throw new DashboardValidationError(`Dashboards can hold at most ${DASHBOARD_MAX_WIDGETS} widgets.`);
  }

  let activePreset = "custom";
  if (body.activePreset !== undefined && body.activePreset !== null && body.activePreset !== "") {
    if (body.activePreset === "custom" || isDashboardPresetId(body.activePreset)) {
      activePreset = body.activePreset;
    } else if (strict) {
      throw new DashboardValidationError(`Unsupported dashboard preset "${String(body.activePreset)}".`);
    }
  }

  let expectedRevision = null;
  if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
      throw new DashboardValidationError("expectedRevision must be a non-negative integer or null.");
    }
    expectedRevision = body.expectedRevision;
  }

  const seenIds = new Set();
  const normalizedWidgets = body.widgets.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DashboardValidationError(`Widget at index ${index} must be an object.`);
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!DASHBOARD_WIDGET_ID_RE.test(id)) {
      throw new DashboardValidationError(`Widget at index ${index} has an invalid ID.`);
    }
    if (seenIds.has(id)) {
      throw new DashboardValidationError(`Duplicate widget ID "${id}".`);
    }
    seenIds.add(id);

    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    if (!isDashboardWidgetType(type)) {
      throw new DashboardValidationError(`Unsupported widget type "${type}".`);
    }
    const meta = DASHBOARD_WIDGET_BY_TYPE[type];

    if (strict && raw.width !== undefined && !isDashboardWidth(raw.width)) {
      throw new DashboardValidationError(`Invalid width "${String(raw.width)}" on widget "${id}".`);
    }
    if (strict && raw.height !== undefined && !isDashboardHeight(raw.height)) {
      throw new DashboardValidationError(`Invalid height "${String(raw.height)}" on widget "${id}".`);
    }

    const width = clampWidgetWidth(type, raw.width || meta.defaultWidth);
    const height = isDashboardHeight(raw.height) ? raw.height : meta.defaultHeight;

    if (strict && raw.title !== undefined && typeof raw.title !== "string") {
      throw new DashboardValidationError(`Widget title on "${id}" must be text.`);
    }
    const rawTitle = typeof raw.title === "string" ? raw.title.trim() : "";
    if (strict && rawTitle.length > DASHBOARD_TITLE_MAX) {
      throw new DashboardValidationError(`Widget title on "${id}" exceeds ${DASHBOARD_TITLE_MAX} characters.`);
    }
    const title = (rawTitle || meta.defaultTitle).slice(0, DASHBOARD_TITLE_MAX);

    if (strict && raw.visible !== undefined && typeof raw.visible !== "boolean") {
      throw new DashboardValidationError(`Field "visible" on widget "${id}" must be a boolean.`);
    }
    if (strict && raw.collapsed !== undefined && typeof raw.collapsed !== "boolean") {
      throw new DashboardValidationError(`Field "collapsed" on widget "${id}" must be a boolean.`);
    }

    const config = normalizeWidgetConfig(type, raw.config, { strict });
    const serializedConfig = JSON.stringify(config);
    if (serializedConfig.length > 6000) {
      throw new DashboardValidationError(`Configuration for widget "${id}" is too large.`);
    }

    return {
      id,
      type,
      title,
      config,
      position: index,
      width,
      height,
      visible: raw.visible === undefined ? true : Boolean(raw.visible),
      collapsed: raw.collapsed === undefined ? false : Boolean(raw.collapsed),
    };
  });

  return {
    activePreset,
    expectedRevision,
    widgets: normalizedWidgets,
  };
}
