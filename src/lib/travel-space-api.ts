// Persora TravelSpace — strongly typed client & dual cloud/local repository.
//
// In cloud mode (!user.demo && isPagesApiConfigured), every operation runs
// against /api/travel-space/* (Supabase Postgres + RLS + R2 VAULT_FILES).
// In demo / offline preview mode, operations run against localStorage using
// the exact same pure validation & minor-unit math from travel-space-rules.js,
// starting with zero hardcoded fake trips.

import {
  BOOKING_CATEGORIES,
  BOOKING_STATUSES,
  DOCUMENT_CATEGORIES,
  EXPLORE_KINDS,
  EXPLORE_STATUSES,
  MEMORY_TYPES,
  PAYMENT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TRAVELLER_ROLES,
  TRIP_STATUSES,
  computeContributionSummary,
  computeTripBudgetOverview,
  detectScheduleOverlaps,
  formatCoordinatePair,
  formatCoordinateStopLabel,
  fromMinor,
  generateTripDays,
  isValidCoordinatePair,
  isValidDate,
  normalizeCurrency,
  normalizeExpenseInput,
  roundCoordinate,
  sanitizeBudgetCategories,
  sanitizeTripDestinations,
  sanitizeTripInput,
  searchCuratedDestinations,
  toMinor,
  tripDurationDays,
  type BookingCategory,
  type BookingStatus,
  type BudgetScope,
  type CompanionType,
  type DocumentCategory,
  type ExploreKind,
  type ExploreStatus,
  type MemoryType,
  type PaymentStatus,
  type TaskPriority,
  type TaskStatus,
  type TravelRouteMode,
  type TravellerRole,
  type TripStatus,
  type TripType,
} from "../../cloudflare/travel-space-rules.js";
import type { AppUser } from "../types";
import { buildTrashEntry, pushLocalTrash } from "./local-trash";
import {
  isPagesApiConfigured,
  PagesApiError,
  pagesApiRequest,
  uploadMultipart,
} from "./cloud";
import type { TransferProgress } from "../types";

/**
 * Coordinate-only persisted destination record (Section 20).
 * Never persists destination names or addresses in DB or localStorage.
 */
export interface TravelDestination {
  id: string;
  tripId: string;
  latitude: number;
  longitude: number;
  orderIndex: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface MapSearchResult {
  id: string;
  label: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  source: "nominatim" | "curated" | "coordinates" | "google_maps";
}

export interface MapSearchResponse {
  results: MapSearchResult[];
  degraded?: boolean;
  warning?: string;
}

export interface MapRouteResponse {
  ok: boolean;
  mode: TravelRouteMode;
  isFallback: boolean;
  fallbackReason?: string | null;
  geometry: [number, number][];
  legs: Array<{ distanceMeters: number | null; durationSeconds: number | null }>;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export class TravelSpaceClientError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "TRAVEL_SPACE_ERROR") {
    super(message);
    this.name = "TravelSpaceClientError";
    this.status = status;
    this.code = code;
  }
}

// Volatile in-memory UI labels during active search/selection ONLY — never persisted!
const EPHEMERAL_STOP_LABELS = new Map<string, string>();

function coordLookupKey(latitude: number, longitude: number): string {
  return `${roundCoordinate(latitude).toFixed(5)},${roundCoordinate(longitude).toFixed(5)}`;
}

export function rememberEphemeralStopLabel(latitude: number, longitude: number, label?: string | null): void {
  if (!label || !isValidCoordinatePair(latitude, longitude)) return;
  const clean = label.trim();
  if (!clean) return;
  EPHEMERAL_STOP_LABELS.set(coordLookupKey(latitude, longitude), clean.slice(0, 120));
}

function getEphemeralStopLabel(latitude: number, longitude: number): string | null {
  if (!isValidCoordinatePair(latitude, longitude)) return null;
  return EPHEMERAL_STOP_LABELS.get(coordLookupKey(latitude, longitude)) || null;
}

export function getDestinationStopLabel(
  dest: { latitude: number; longitude: number },
  index: number,
): string {
  const ephemeral = getEphemeralStopLabel(dest.latitude, dest.longitude);
  return ephemeral ? ephemeral : formatCoordinateStopLabel(dest.latitude, dest.longitude, index);
}

export function describeTravelError(err: unknown, fallback = "Could not complete that TravelSpace action."): string {
  if (err instanceof TravelSpaceClientError) {
    if (err.code === "ENDPOINT_NOT_FOUND") {
      return "TravelSpace service endpoint is unavailable (404). Refresh the page or verify the API deployment.";
    }
    if (err.code === "AUTH_REQUIRED" || err.status === 401) {
      return "Authentication is required. Sign in again to continue.";
    }
    if (err.code === "PERMISSION_DENIED" || err.status === 403) {
      return err.message || "You do not have permission to perform this action on this trip.";
    }
    if (err.code === "NETWORK_UNAVAILABLE") {
      return "Network connection unavailable. Check your internet connection and try again.";
    }
    if (err.code === "GEOCODING_UNAVAILABLE") {
      return err.message || "Destination search is temporarily unavailable. Enter coordinates or click on the map.";
    }
    if (err.code === "ROUTING_UNAVAILABLE") {
      return err.message || "Map road routing is temporarily unavailable; showing straight-line preview.";
    }
    if (err.code === "DB_OPERATION_FAILED" || err.code === "DB_SCHEMA_OUTDATED") {
      return err.message || "Database operation failed while saving trip data.";
    }
    return err.message || fallback;
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Network connection unavailable. Check your internet connection and try again.";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

async function travelApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await pagesApiRequest(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof PagesApiError) {
      const resolvedCode =
        err.code ||
        (err.status === 401
          ? "AUTH_REQUIRED"
          : err.status === 403
            ? "PERMISSION_DENIED"
            : err.status === 404
              ? /endpoint not found/i.test(err.message)
                ? "ENDPOINT_NOT_FOUND"
                : "NOT_FOUND"
              : err.status >= 500
                ? "DB_OPERATION_FAILED"
                : "VALIDATION_ERROR");
      throw new TravelSpaceClientError(err.message, err.status, resolvedCode);
    }
    const msg = err instanceof Error ? err.message : "";
    if (/fetch|network|failed to fetch|networkerror/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      throw new TravelSpaceClientError(
        "Network connection unavailable. Check your internet connection and try again.",
        0,
        "NETWORK_UNAVAILABLE",
      );
    }
    throw new TravelSpaceClientError(msg || "TravelSpace request failed.", 400, "VALIDATION_ERROR");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface TravelTraveller {
  id: string;
  tripId: string;
  userId: string | null;
  contactId: string | null;
  familyItemId: string | null;
  fullName: string;
  email: string;
  phone: string;
  role: TravellerRole;
  isOwner: boolean;
  responsibility: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  inviteStatus: "active" | "invited";
  sortOrder: number;
}

export interface TravelBudgetCategory {
  id: string;
  tripId: string;
  name: string;
  allocatedAmount: number;
  color: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface TravelContribution {
  id?: string;
  tripId?: string;
  travellerId: string;
  plannedAmount: number;
  contributedAmount: number;
  pendingAmount: number;
  status: "pending" | "partial" | "paid";
  contributedOn: string | null;
  note: string;
}

export interface TravelBooking {
  id: string;
  tripId: string;
  category: BookingCategory;
  title: string;
  provider: string;
  bookingReference: string;
  bookingDate: string | null;
  startDate: string | null;
  endDate: string | null;
  startAtText: string;
  endAtText: string;
  location: string;
  price: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  travellerIds: string[];
  membershipItemId: string | null;
  contactDetails: string;
  notes: string;
  refundAmount: number | null;
  cancellationNote: string;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  attachmentFileType: string | null;
  localDataUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Single unified Task & Itinerary Activity record (never duplicated). */
export interface TravelItem {
  id: string;
  tripId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  daySortOrder: number;
  kanbanSortOrder: number;
  assigneeTravellerId: string | null;
  bookingId: string | null;
  estimatedCost: number | null;
  notes: string;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  attachmentFileType: string | null;
  linkedVaultNoteId: string | null;
  syncedCalendarEventId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  tripTitle?: string;
}

export interface TravelExpenseSplit {
  id?: string;
  travellerId: string;
  shareAmount: number;
  tripShareAmount: number;
}

export interface TravelExpense {
  id: string;
  tripId: string;
  title: string;
  amount: number;
  currency: string;
  tripAmount: number;
  exchangeRate: number;
  convertedOn: string;
  expenseDate: string;
  categoryId: string | null;
  categoryName: string;
  expenseType: "personal" | "shared";
  paidByTravellerId: string;
  paidFromGroupFund: boolean;
  splitMethod: "none" | "equal" | "custom";
  paymentMethod: string;
  linkedFinanceItemId: string | null;
  hasReceipt: boolean;
  receiptFileName: string | null;
  receiptFileType: string | null;
  localReceiptDataUrl?: string | null;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  splits: TravelExpenseSplit[];
  tripTitle?: string;
}

export interface TravelSettlement {
  id: string;
  tripId: string;
  fromTravellerId: string;
  toTravellerId: string;
  amount: number;
  currency: string;
  status: "pending" | "completed";
  settledOn: string;
  method: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface TravelDocument {
  id: string;
  tripId: string;
  title: string;
  docCategory: DocumentCategory;
  sourceType: "upload" | "vault_item";
  linkedVaultItemId: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  localDataUrl?: string | null;
  travellerId: string | null;
  bookingId: string | null;
  activityId: string | null;
  documentNumber: string;
  expiryDate: string | null;
  reminderDaysBefore: number | null;
  isPrivate: boolean;
  notes: string;
  createdBy: string | null;
  createdAt: string;
}

export interface TravelMemory {
  id: string;
  tripId: string;
  memoryType: MemoryType;
  title: string;
  caption: string;
  journalBody: string;
  memoryDate: string | null;
  dayNumber: number | null;
  location: string;
  favorite: boolean;
  sourceType: "upload" | "photo_studio" | "audio_space" | "vault_item" | "journal";
  linkedPhotoId: string | null;
  linkedAudioId: string | null;
  linkedVaultItemId: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  localDataUrl?: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TravelExplorePlace {
  id: string;
  userId: string;
  name: string;
  kind: ExploreKind;
  country: string;
  city: string;
  status: ExploreStatus;
  tripId: string | null;
  estimatedCost: number | null;
  currency: string;
  referenceUrl: string;
  linkedUrlItemId: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TravelTripSummary {
  id: string;
  ownerId: string;
  myRole: TravellerRole;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  companionType: CompanionType;
  travelerCount: number;
  tripType: TripType | null;
  status: TripStatus;
  primaryCurrency: string;
  budgetScope: BudgetScope;
  personalBudget: number;
  hasCover: boolean;
  coverFileName: string | null;
  coverFileSize?: number | null;
  coverFileType: string | null;
  coverUpdatedAt?: string | null;
  localCoverDataUrl?: string | null;
  actualReturnDate: string | null;
  rating: number | null;
  completionNotes: string;
  summarySnapshot: Record<string, any> | null;
  timelineEventId: string | null;
  createdAt: string;
  updatedAt: string;
  destinations: TravelDestination[];
  taskTotal?: number;
  taskDone?: number;
  progressPercent?: number;
  totalSpent?: number;
  plannedBudget?: number;
}

export interface TravelBudgetOverview {
  currency: string;
  budgetScope: BudgetScope;
  totalPlannedBudget: number;
  totalCollected: number;
  totalPendingContributions: number;
  totalAllocated: number;
  unallocated: number;
  totalExpenses: number;
  personalExpenses: number;
  sharedExpenses: number;
  budgetUsed: number;
  remainingBudget: number;
  usagePercent: number;
  budgetAlert: "ok" | "warning" | "exceeded";
  categories: Array<{
    id?: string;
    name: string;
    color: string;
    isDefault: boolean;
    allocated: number;
    spent: number;
    totalRecordedSpent: number;
    remaining: number;
    usagePercent: number;
    alertStatus: "ok" | "warning" | "exceeded";
  }>;
  contributions: TravelContribution[];
  balances: Array<{
    travellerId: string;
    fullName: string;
    totalPaid: number;
    personalSpent: number;
    totalShare: number;
    settlementsPaid: number;
    settlementsReceived: number;
    netMinor: number;
    netBalance: number;
    owesMinor: number;
    owes: number;
    shouldReceiveMinor: number;
    shouldReceive: number;
    settled: boolean;
  }>;
  suggestedSettlements: Array<{
    fromTravellerId: string;
    fromName: string;
    toTravellerId: string;
    toName: string;
    amountMinor: number;
    amount: number;
    currency: string;
  }>;
}

export interface TravelWorkspace {
  trip: TravelTripSummary;
  role: TravellerRole;
  days: { dayNumber: number; date: string }[];
  destinations: TravelDestination[];
  travellers: TravelTraveller[];
  categories: TravelBudgetCategory[];
  contributions: TravelContribution[];
  bookings: TravelBooking[];
  items: TravelItem[];
  expenses: TravelExpense[];
  settlements: TravelSettlement[];
  documents: TravelDocument[];
  memories: TravelMemory[];
  budgetOverview: TravelBudgetOverview;
  overlaps: {
    overlappingIds: string[];
    conflicts: Array<{
      date: string;
      firstId: string;
      firstTitle: string;
      secondId: string;
      secondTitle: string;
    }>;
  };
}

export interface TravelBootstrap {
  trips: TravelTripSummary[];
  explorePlaces: TravelExplorePlace[];
  upcomingActivities: TravelItem[];
  recentExpenses: TravelExpense[];
}

function isLocalMode(user: AppUser) {
  return Boolean(user.demo) || !isPagesApiConfigured;
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Local / Demo Store (Zero Hardcoded Fake Data; Exact Same Rules Engine)
// ---------------------------------------------------------------------------

interface LocalTripRecord {
  trip: TravelTripSummary;
  destinations: TravelDestination[];
  travellers: TravelTraveller[];
  categories: TravelBudgetCategory[];
  contributions: TravelContribution[];
  bookings: TravelBooking[];
  items: TravelItem[];
  expenses: TravelExpense[];
  settlements: TravelSettlement[];
  documents: TravelDocument[];
  memories: TravelMemory[];
}

interface LocalTravelStore {
  trips: Record<string, LocalTripRecord>;
  explorePlaces: TravelExplorePlace[];
}

function localKey(userId: string) {
  return `persora-travel-space-v1:${userId}`;
}

function readLocalStore(userId: string): LocalTravelStore {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return { trips: {}, explorePlaces: [] };
    const parsed = JSON.parse(raw) as LocalTravelStore;
    return {
      trips: parsed?.trips && typeof parsed.trips === "object" ? parsed.trips : {},
      explorePlaces: Array.isArray(parsed?.explorePlaces) ? parsed.explorePlaces : [],
    };
  } catch {
    return { trips: {}, explorePlaces: [] };
  }
}

function writeLocalStore(userId: string, store: LocalTravelStore) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(store));
  } catch {
    // quota fallback
  }
}

function normalizeStoredDestinations(tripId: string, rawList: any[]): TravelDestination[] {
  if (!Array.isArray(rawList)) return [];
  const out: TravelDestination[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const d = rawList[i];
    if (!d || typeof d !== "object") continue;
    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    if (!isValidCoordinatePair(lat, lng)) continue;
    out.push({
      id: typeof d.id === "string" && d.id ? d.id : uid(),
      tripId,
      latitude: roundCoordinate(lat),
      longitude: roundCoordinate(lng),
      orderIndex: Number.isFinite(Number(d.orderIndex ?? d.sortOrder)) ? Number(d.orderIndex ?? d.sortOrder) : out.length,
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
    });
  }
  out.sort((a, b) => a.orderIndex - b.orderIndex);
  return out.map((item, idx) => ({ ...item, orderIndex: idx }));
}

function hydrateLocalWorkspace(rec: LocalTripRecord): TravelWorkspace {
  const orderedDestinations = normalizeStoredDestinations(rec.trip.id, rec.destinations);
  const trip = {
    ...rec.trip,
    durationDays: tripDurationDays(rec.trip.startDate, rec.trip.endDate),
    destinations: orderedDestinations,
  };
  const budgetOverview = computeTripBudgetOverview({
    trip,
    travellers: rec.travellers,
    categories: rec.categories,
    contributions: rec.contributions,
    expenses: rec.expenses,
    settlements: rec.settlements,
  });
  return {
    trip,
    role: "owner",
    days: generateTripDays(trip.startDate, trip.endDate),
    destinations: orderedDestinations,
    travellers: [...rec.travellers].sort((a, b) => a.sortOrder - b.sortOrder),
    categories: [...rec.categories].sort((a, b) => a.sortOrder - b.sortOrder),
    contributions: budgetOverview.contributions,
    bookings: [...rec.bookings],
    items: [...rec.items],
    expenses: [...rec.expenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    settlements: [...rec.settlements].sort((a, b) => b.settledOn.localeCompare(a.settledOn)),
    documents: [...rec.documents],
    memories: [...rec.memories],
    budgetOverview,
    overlaps: detectScheduleOverlaps(rec.items),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Public API Functions
// ---------------------------------------------------------------------------

export async function loadTravelBootstrap(user: AppUser): Promise<TravelBootstrap> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelBootstrap>("/travel-space/bootstrap");
  }
  const store = readLocalStore(user.id);
  const trips: TravelTripSummary[] = [];
  const upcomingActivities: TravelItem[] = [];
  const recentExpenses: TravelExpense[] = [];

  for (const rec of Object.values(store.trips)) {
    const ws = hydrateLocalWorkspace(rec);
    const done = ws.items.filter((i) => i.status === "done").length;
    trips.push({
      ...ws.trip,
      taskTotal: ws.items.length,
      taskDone: done,
      progressPercent: ws.items.length > 0 ? Math.round((done / ws.items.length) * 100) : 0,
      totalSpent: ws.budgetOverview.totalExpenses,
      plannedBudget: ws.budgetOverview.totalPlannedBudget,
    });
    for (const item of ws.items) {
      if (item.scheduledDate && item.status !== "done" && item.status !== "skipped") {
        upcomingActivities.push({ ...item, tripTitle: ws.trip.title });
      }
    }
    for (const exp of ws.expenses) {
      recentExpenses.push({ ...exp, tripTitle: ws.trip.title });
    }
  }
  trips.sort((a, b) => a.startDate.localeCompare(b.startDate));
  upcomingActivities.sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  recentExpenses.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));

  return {
    trips,
    explorePlaces: store.explorePlaces,
    upcomingActivities: upcomingActivities.slice(0, 8),
    recentExpenses: recentExpenses.slice(0, 8),
  };
}

export async function loadTripWorkspace(user: AppUser, tripId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}`);
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  return hydrateLocalWorkspace(rec);
}

export async function createTrip(user: AppUser, payload: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>("/travel-space/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  const store = readLocalStore(user.id);
  if (payload.id && store.trips[payload.id]) {
    return hydrateLocalWorkspace(store.trips[payload.id]);
  }
  const parsed = sanitizeTripInput(payload, { partial: false });
  const tripId = payload.id || uid();
  const now = new Date().toISOString();
  const currency = parsed.primaryCurrency;

  const travellers: TravelTraveller[] = [
    {
      id: uid(),
      tripId,
      userId: user.id,
      contactId: null,
      familyItemId: null,
      fullName: String(payload.ownerName || user.fullName || user.email || "Me").trim() || "Me",
      email: user.email || "",
      phone: "",
      role: "owner",
      isOwner: true,
      responsibility: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      inviteStatus: "active",
      sortOrder: 0,
    },
  ];
  if (parsed.companionType !== "solo") {
    const rawTravs = Array.isArray(payload.travellers) ? payload.travellers : [];
    for (const tr of rawTravs) {
      if (!tr || tr.isOwner) continue;
      const nm = String(tr.fullName || tr.name || "").trim();
      if (!nm) continue;
      travellers.push({
        id: uid(),
        tripId,
        userId: tr.userId || null,
        contactId: tr.contactId || null,
        familyItemId: tr.familyItemId || null,
        fullName: nm,
        email: String(tr.email || ""),
        phone: String(tr.phone || ""),
        role: TRAVELLER_ROLES.includes(tr.role) && tr.role !== "owner" ? tr.role : "editor",
        isOwner: false,
        responsibility: String(tr.responsibility || ""),
        emergencyContactName: "",
        emergencyContactPhone: "",
        inviteStatus: "active",
        sortOrder: travellers.length,
      });
    }
    while (travellers.length < parsed.travelerCount && travellers.length < 50) {
      travellers.push({
        id: uid(),
        tripId,
        userId: null,
        contactId: null,
        familyItemId: null,
        fullName: `Traveller ${travellers.length + 1}`,
        email: "",
        phone: "",
        role: "viewer",
        isOwner: false,
        responsibility: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
        inviteStatus: "active",
        sortOrder: travellers.length,
      });
    }
  }

  const rawContribs = Array.isArray(payload.contributions) ? payload.contributions : [];
  let plannedBudgetMinor = parsed.personalBudgetMinor;
  if (parsed.budgetScope === "group") {
    plannedBudgetMinor = computeContributionSummary(rawContribs, currency).totalPlannedMinor;
  } else if (parsed.budgetScope === "none") {
    plannedBudgetMinor = 0;
  }
  const catData = sanitizeBudgetCategories(payload.categories, plannedBudgetMinor, currency);

  const destinations: TravelDestination[] = (parsed.destinations || []).map((d: any, idx: number) => ({
    id: uid(),
    tripId,
    latitude: d.latitude,
    longitude: d.longitude,
    orderIndex: idx,
    createdAt: now,
    updatedAt: now,
  }));

  const categories: TravelBudgetCategory[] = catData.categories.map((c: any, idx: number) => ({
    id: uid(),
    tripId,
    name: c.name,
    allocatedAmount: c.allocatedAmount,
    color: c.color,
    isDefault: c.isDefault,
    sortOrder: idx,
  }));

  const contributions: TravelContribution[] =
    parsed.budgetScope === "group"
      ? travellers.map((tr, idx) => {
          const match = rawContribs[idx] || {};
          const row = computeContributionSummary([match], currency).rows[0];
          return {
            id: uid(),
            tripId,
            travellerId: tr.id,
            plannedAmount: row.plannedAmount,
            contributedAmount: row.contributedAmount,
            pendingAmount: row.pendingAmount,
            status: row.status,
            contributedOn: match.contributedOn || null,
            note: String(match.note || ""),
          };
        })
      : [];

  const items: TravelItem[] = (Array.isArray(payload.initialTasks) ? payload.initialTasks : [])
    .filter((t: any) => t && String(t.title || "").trim())
    .map((t: any, idx: number) => {
      const aIdx = typeof t.assigneeIndex === "number" ? t.assigneeIndex : -1;
      return {
        id: uid(),
        tripId,
        title: String(t.title).trim(),
        description: String(t.description || ""),
        status: TASK_STATUSES.includes(t.status) ? t.status : "todo",
        priority: TASK_PRIORITIES.includes(t.priority) ? t.priority : "normal",
        dueDate: t.dueDate && isValidDate(t.dueDate) ? t.dueDate : null,
        scheduledDate: null,
        startTime: null,
        endTime: null,
        location: "",
        latitude: null,
        longitude: null,
        daySortOrder: 0,
        kanbanSortOrder: idx,
        assigneeTravellerId: aIdx >= 0 && travellers[aIdx] ? travellers[aIdx].id : null,
        bookingId: null,
        estimatedCost: null,
        notes: "",
        hasAttachment: false,
        attachmentFileName: null,
        attachmentFileType: null,
        linkedVaultNoteId: null,
        syncedCalendarEventId: null,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      };
    });

  const trip: TravelTripSummary = {
    id: tripId,
    ownerId: user.id,
    myRole: "owner",
    title: parsed.title,
    description: parsed.description,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    durationDays: tripDurationDays(parsed.startDate, parsed.endDate),
    companionType: parsed.companionType,
    travelerCount: Math.max(parsed.travelerCount, travellers.length),
    tripType: parsed.tripType,
    status: "planning",
    primaryCurrency: currency,
    budgetScope: parsed.budgetScope,
    personalBudget: parsed.personalBudget,
    hasCover: false,
    coverFileName: null,
    coverFileType: null,
    actualReturnDate: null,
    rating: null,
    completionNotes: "",
    summarySnapshot: null,
    timelineEventId: null,
    createdAt: now,
    updatedAt: now,
    destinations,
  };

  store.trips[tripId] = {
    trip,
    destinations,
    travellers,
    categories,
    contributions,
    bookings: [],
    items,
    expenses: [],
    settlements: [],
    documents: [],
    memories: [],
  };
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(store.trips[tripId]);
}

export async function updateTrip(user: AppUser, tripId: string, patch: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const merged = sanitizeTripInput(
    {
      title: patch.title ?? rec.trip.title,
      description: patch.description ?? rec.trip.description,
      startDate: patch.startDate ?? rec.trip.startDate,
      endDate: patch.endDate ?? rec.trip.endDate,
      companionType: patch.companionType ?? rec.trip.companionType,
      travelerCount: patch.travelerCount ?? rec.trip.travelerCount,
      tripType: patch.tripType === undefined ? rec.trip.tripType : patch.tripType,
      status: patch.status ?? rec.trip.status,
      primaryCurrency: patch.primaryCurrency ?? rec.trip.primaryCurrency,
      budgetScope: patch.budgetScope ?? rec.trip.budgetScope,
      personalBudget: patch.personalBudget ?? rec.trip.personalBudget,
    },
    { partial: true },
  );
  rec.trip = {
    ...rec.trip,
    title: merged.title,
    description: merged.description,
    startDate: merged.startDate,
    endDate: merged.endDate,
    companionType: merged.companionType,
    travelerCount: merged.travelerCount,
    tripType: merged.tripType,
    status: TRIP_STATUSES.includes(patch.status) ? patch.status : rec.trip.status,
    primaryCurrency: merged.primaryCurrency,
    budgetScope: merged.budgetScope,
    personalBudget: merged.personalBudget,
    updatedAt: new Date().toISOString(),
  };
  if (Array.isArray(patch.destinations)) {
    const dests = sanitizeTripDestinations(patch.destinations);
    const nowIso = new Date().toISOString();
    rec.destinations = dests.map((d: any, idx: number) => ({
      id: d.id || uid(),
      tripId,
      latitude: d.latitude,
      longitude: d.longitude,
      orderIndex: idx,
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
  }
  if (Array.isArray(patch.categories) || Array.isArray(patch.contributions)) {
    const contribSummary = computeContributionSummary(patch.contributions || rec.contributions, merged.primaryCurrency);
    const plannedMinor =
      merged.budgetScope === "group"
        ? contribSummary.totalPlannedMinor
        : merged.budgetScope === "personal"
          ? merged.personalBudgetMinor
          : 0;
    if (Array.isArray(patch.categories)) {
      const catData = sanitizeBudgetCategories(patch.categories, plannedMinor, merged.primaryCurrency);
      const existingByName = new Map(rec.categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
      rec.categories = catData.categories.map((c: any, idx: number) => ({
        id: c.id || existingByName.get(c.name.trim().toLowerCase()) || uid(),
        tripId,
        name: c.name,
        allocatedAmount: c.allocatedAmount,
        color: c.color,
        isDefault: c.isDefault,
        sortOrder: idx,
      }));
      const keptIds = new Set(rec.categories.map((c) => c.id));
      rec.expenses = rec.expenses.map((exp) =>
        exp.categoryId && !keptIds.has(exp.categoryId) ? { ...exp, categoryId: null } : exp,
      );
    }
    if (Array.isArray(patch.contributions)) {
      rec.contributions = contribSummary.rows.map((r: any, idx: number) => ({
        id: r.id || uid(),
        tripId,
        travellerId: r.travellerId || rec.travellers[idx]?.id || uid(),
        plannedAmount: r.plannedAmount,
        contributedAmount: r.contributedAmount,
        pendingAmount: r.pendingAmount,
        status: r.status,
        contributedOn: r.contributedOn || null,
        note: String(r.note || ""),
      }));
    }
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function updateTripDestinations(
  user: AppUser,
  tripId: string,
  destinations: ReadonlyArray<{ id?: string; latitude: number; longitude: number }>,
): Promise<TravelWorkspace> {
  const sanitized = sanitizeTripDestinations(destinations);
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/destinations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinations: sanitized }),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const nowIso = new Date().toISOString();
  rec.destinations = sanitized.map((d, idx) => ({
    id: d.id || uid(),
    tripId,
    latitude: d.latitude,
    longitude: d.longitude,
    orderIndex: idx,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  rec.trip.updatedAt = nowIso;
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

// ---------------------------------------------------------------------------
// Configurable Map Tile, Geocoding & OSRM Routing Providers (Client + Cloud)
// ---------------------------------------------------------------------------

const CLIENT_SEARCH_CACHE = new Map<string, { at: number; data: MapSearchResponse }>();
const CLIENT_ROUTE_CACHE = new Map<string, { at: number; data: MapRouteResponse }>();
let lastClientNominatimAt = 0;

export function getMapTileConfig(): { url: string; attribution: string; maxZoom: number } {
  const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  return {
    url: envMeta.VITE_TRAVEL_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      envMeta.VITE_TRAVEL_TILE_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
  };
}

export async function searchMapDestinations(
  user: AppUser,
  query: string,
  signal?: AbortSignal,
): Promise<MapSearchResponse> {
  const clean = query.trim();
  if (clean.length < 2) return { results: [] };

  const key = clean.toLowerCase().slice(0, 140);
  const cached = CLIENT_SEARCH_CACHE.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return cached.data;
  }

  const curatedHits: MapSearchResult[] = searchCuratedDestinations(clean)
    .filter((c) => isValidCoordinatePair(c.latitude, c.longitude))
    .map((c, idx) => ({
      id: `curated-${idx}-${c.latitude}-${c.longitude}`,
      label: c.name,
      subtitle: [c.city !== c.name ? c.city : "", c.country].filter(Boolean).join(", "),
      latitude: roundCoordinate(c.latitude!),
      longitude: roundCoordinate(c.longitude!),
      source: "curated" as const,
    }));

  if (!isLocalMode(user)) {
    const res = await travelApiJson<MapSearchResponse>(
      `/travel-space/map/search?q=${encodeURIComponent(clean)}`,
      { method: "GET", signal },
    );
    CLIENT_SEARCH_CACHE.set(key, { at: Date.now(), data: res });
    return res;
  }

  // Demo / offline-capable mode: rate-spaced Nominatim + curated destinations
  const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const geocoderBase = envMeta.VITE_TRAVEL_GEOCODING_URL || "https://nominatim.openstreetmap.org/search";

  if (Date.now() - lastClientNominatimAt < 950 && curatedHits.length >= 3) {
    return { results: curatedHits, degraded: false };
  }

  try {
    lastClientNominatimAt = Date.now();
    const url = new URL(geocoderBase);
    url.searchParams.set("q", clean.slice(0, 140));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "7");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      method: "GET",
      signal,
      headers: { Accept: "application/json", "Accept-Language": "en" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const remote: MapSearchResult[] = (Array.isArray(payload) ? payload : [])
      .map((item: any, idx: number): MapSearchResult | null => {
        const lat = Number(item?.lat);
        const lng = Number(item?.lon);
        if (!isValidCoordinatePair(lat, lng)) return null;
        const displayName = String(item?.display_name || item?.name || "").trim();
        const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
        return {
          id: `osm-${item?.place_id || idx}-${roundCoordinate(lat)}-${roundCoordinate(lng)}`,
          label: String(item?.name || parts[0] || formatCoordinatePair(lat, lng)).trim(),
          subtitle: parts.slice(1, 4).join(", "),
          latitude: roundCoordinate(lat),
          longitude: roundCoordinate(lng),
          source: "nominatim",
        };
      })
      .filter((x): x is MapSearchResult => x !== null);

    const merged: MapSearchResult[] = [];
    const seen = new Set<string>();
    for (const item of [...remote, ...curatedHits]) {
      const k = `${item.latitude.toFixed(3)},${item.longitude.toFixed(3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(item);
      if (merged.length >= 8) break;
    }
    const out: MapSearchResponse = { results: merged, degraded: false };
    CLIENT_SEARCH_CACHE.set(key, { at: Date.now(), data: out });
    return out;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (curatedHits.length > 0) {
      return {
        results: curatedHits,
        degraded: true,
        warning: "Live place search is unavailable; showing built-in destinations.",
      };
    }
    throw new TravelSpaceClientError(
      "Destination search service is temporarily unavailable. Enter coordinates, paste a Google Maps URL, or click on the map.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }
}

export async function fetchMapRoute(
  user: AppUser,
  coordinates: ReadonlyArray<{ latitude: number; longitude: number }>,
  mode: TravelRouteMode = "driving",
  signal?: AbortSignal,
): Promise<MapRouteResponse> {
  const valid = coordinates
    .filter((p) => p && isValidCoordinatePair(p.latitude, p.longitude))
    .map((p) => ({ latitude: roundCoordinate(p.latitude), longitude: roundCoordinate(p.longitude) }));

  if (valid.length < 2) {
    return {
      ok: true,
      mode,
      isFallback: false,
      geometry: valid.map((p) => [p.latitude, p.longitude]),
      legs: [],
      distanceMeters: null,
      durationSeconds: null,
    };
  }

  const coordKey = valid.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const cacheKey = `${mode}:${coordKey}`;
  const cached = CLIENT_ROUTE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < 20 * 60 * 1000) {
    return cached.data;
  }

  if (!isLocalMode(user)) {
    try {
      const res = await travelApiJson<MapRouteResponse>("/travel-space/map/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: valid, mode }),
        signal,
      });
      CLIENT_ROUTE_CACHE.set(cacheKey, { at: Date.now(), data: res });
      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return {
        ok: true,
        mode,
        isFallback: true,
        fallbackReason: "Road routing service is currently unavailable; showing straight-line preview.",
        geometry: valid.map((p) => [p.latitude, p.longitude]),
        legs: [],
        distanceMeters: null,
        durationSeconds: null,
      };
    }
  }

  // Local / Demo mode OSRM call with honest straight-line fallback
  const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const candidates =
    mode === "walking"
      ? [
          `${envMeta.VITE_TRAVEL_OSRM_WALKING_URL || envMeta.VITE_TRAVEL_OSRM_URL || "https://routing.openstreetmap.de/routed-foot"}/route/v1/driving/${coordKey}?overview=full&geometries=geojson&steps=false`,
          `https://router.project-osrm.org/route/v1/foot/${coordKey}?overview=full&geometries=geojson&steps=false`,
        ]
      : mode === "cycling"
        ? [
            `${envMeta.VITE_TRAVEL_OSRM_CYCLING_URL || envMeta.VITE_TRAVEL_OSRM_URL || "https://routing.openstreetmap.de/routed-bike"}/route/v1/driving/${coordKey}?overview=full&geometries=geojson&steps=false`,
            `https://router.project-osrm.org/route/v1/bike/${coordKey}?overview=full&geometries=geojson&steps=false`,
          ]
        : [
            `${envMeta.VITE_TRAVEL_OSRM_DRIVING_URL || envMeta.VITE_TRAVEL_OSRM_URL || "https://routing.openstreetmap.de/routed-car"}/route/v1/driving/${coordKey}?overview=full&geometries=geojson&steps=false`,
            `https://router.project-osrm.org/route/v1/driving/${coordKey}?overview=full&geometries=geojson&steps=false`,
          ];

  for (const routeUrl of candidates) {
    try {
      const response = await fetch(routeUrl, {
        method: "GET",
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const first = Array.isArray(data?.routes) ? data.routes[0] : null;
      const rawCoords = first?.geometry?.coordinates;
      if (!first || !Array.isArray(rawCoords) || rawCoords.length < 2) continue;
      const geometry: [number, number][] = rawCoords
        .map((pair: any) =>
          Array.isArray(pair) && isValidCoordinatePair(pair[1], pair[0])
            ? ([roundCoordinate(pair[1]), roundCoordinate(pair[0])] as [number, number])
            : null,
        )
        .filter((x: [number, number] | null): x is [number, number] => Boolean(x));
      if (geometry.length < 2) continue;
      const out: MapRouteResponse = {
        ok: true,
        mode,
        isFallback: false,
        fallbackReason: null,
        geometry,
        legs: Array.isArray(first.legs)
          ? first.legs.map((leg: any) => ({
              distanceMeters: Number.isFinite(Number(leg?.distance)) ? Math.round(Number(leg.distance)) : null,
              durationSeconds: Number.isFinite(Number(leg?.duration)) ? Math.round(Number(leg.duration)) : null,
            }))
          : [],
        distanceMeters: Number.isFinite(Number(first.distance)) ? Math.round(Number(first.distance)) : null,
        durationSeconds: Number.isFinite(Number(first.duration)) ? Math.round(Number(first.duration)) : null,
      };
      CLIENT_ROUTE_CACHE.set(cacheKey, { at: Date.now(), data: out });
      return out;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
    }
  }

  return {
    ok: true,
    mode,
    isFallback: true,
    fallbackReason:
      "Road route is unavailable between these stops (water crossing or routing service unreachable). Showing straight-line preview.",
    geometry: valid.map((p) => [p.latitude, p.longitude]),
    legs: [],
    distanceMeters: null,
    durationSeconds: null,
  };
}

export async function duplicateTrip(user: AppUser, tripId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }
  const store = readLocalStore(user.id);
  const src = store.trips[tripId];
  if (!src) throw new Error("Trip not found.");
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const copyTitle = `${(src.trip.title || "Trip").trim().slice(0, 130)} (Copy)`.slice(0, 140);
  const cloned: LocalTripRecord = JSON.parse(JSON.stringify(src));
  cloned.trip.id = newId;
  cloned.trip.title = copyTitle;
  cloned.trip.status = "planning";
  cloned.trip.actualReturnDate = null;
  cloned.trip.rating = null;
  cloned.trip.completionNotes = "";
  cloned.trip.summarySnapshot = null;
  cloned.trip.timelineEventId = null;
  cloned.trip.createdAt = now;
  cloned.trip.updatedAt = now;
  if (cloned.trip.hasCover) {
    cloned.trip.coverUpdatedAt = `${now}:${cloned.trip.coverFileSize || 0}:${cloned.trip.coverFileName || ""}`;
  }
  cloned.destinations = cloned.destinations.map((d, idx) => ({
    ...d,
    id: crypto.randomUUID(),
    tripId: newId,
    orderIndex: idx,
  }));
  cloned.travellers = cloned.travellers.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    tripId: newId,
  }));
  cloned.categories = cloned.categories.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
    tripId: newId,
  }));
  cloned.items = cloned.items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    tripId: newId,
    status: "todo",
    syncedCalendarEventId: null,
  }));
  cloned.contributions = [];
  cloned.expenses = [];
  cloned.settlements = [];
  cloned.bookings = [];
  cloned.documents = [];
  cloned.memories = [];
  store.trips[newId] = cloned;
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(cloned);
}

export async function deleteTrip(user: AppUser, tripId: string): Promise<void> {
  invalidateTripCoverCache(user.id, tripId);
  if (!isLocalMode(user)) {
    await travelApiJson(`/travel-space/trips/${encodeURIComponent(tripId)}`, { method: "DELETE" });
    return;
  }
  const store = readLocalStore(user.id);
  const existing = store.trips[tripId];
  if (existing) {
    pushLocalTrash(
      user.id,
      buildTrashEntry({
        id: tripId,
        kind: "travel_trip",
        title: existing.trip.title || "Untitled Trip",
        space: "travel-space",
        eventDate: existing.trip.startDate || null,
        payload: existing,
      }),
    );
  }
  delete store.trips[tripId];
  writeLocalStore(user.id, store);
}

export function restoreLocalDemoTrip(userId: string, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const rec = payload as LocalTripRecord;
  if (!rec.trip?.id) return;
  const store = readLocalStore(userId);
  store.trips[rec.trip.id] = rec;
  writeLocalStore(userId, store);
}

export async function saveTripBudget(user: AppUser, tripId: string, payload: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const currency = rec.trip.primaryCurrency;
  const scope: BudgetScope =
    rec.trip.companionType === "solo" && payload.budgetScope === "group"
      ? "personal"
      : payload.budgetScope || rec.trip.budgetScope;
  const pMinor = scope === "personal" ? Math.max(0, toMinor(payload.personalBudget ?? rec.trip.personalBudget, currency)) : 0;
  const contribSummary = computeContributionSummary(payload.contributions || rec.contributions, currency);
  const plannedMinor = scope === "group" ? contribSummary.totalPlannedMinor : scope === "personal" ? pMinor : 0;
  const catData = sanitizeBudgetCategories(payload.categories ?? rec.categories, plannedMinor, currency);

  const existingByName = new Map(rec.categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  rec.trip.budgetScope = scope;
  rec.trip.personalBudget = fromMinor(pMinor, currency);
  rec.categories = catData.categories.map((c: any, idx: number) => ({
    id: c.id || existingByName.get(c.name.trim().toLowerCase()) || uid(),
    tripId,
    name: c.name,
    allocatedAmount: c.allocatedAmount,
    color: c.color,
    isDefault: c.isDefault,
    sortOrder: idx,
  }));
  const keptIds = new Set(rec.categories.map((c) => c.id));
  rec.expenses = rec.expenses.map((exp) =>
    exp.categoryId && !keptIds.has(exp.categoryId) ? { ...exp, categoryId: null } : exp,
  );
  if (Array.isArray(payload.contributions)) {
    rec.contributions = contribSummary.rows.map((r: any) => ({
      id: r.id || uid(),
      tripId,
      travellerId: r.travellerId,
      plannedAmount: r.plannedAmount,
      contributedAmount: r.contributedAmount,
      pendingAmount: r.pendingAmount,
      status: r.status,
      contributedOn: r.contributedOn || null,
      note: String(r.note || ""),
    }));
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function createTripItem(user: AppUser, tripId: string, body: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const title = String(body.title || "").trim();
  if (!title) throw new Error("Enter a title.");
  const now = new Date().toISOString();
  rec.items.push({
    id: uid(),
    tripId,
    title,
    description: String(body.description || ""),
    status: TASK_STATUSES.includes(body.status) ? body.status : "todo",
    priority: TASK_PRIORITIES.includes(body.priority) ? body.priority : "normal",
    dueDate: body.dueDate || null,
    scheduledDate: body.scheduledDate || null,
    startTime: body.scheduledDate ? body.startTime || null : null,
    endTime: body.scheduledDate ? body.endTime || null : null,
    location: String(body.location || ""),
    latitude: body.latitude !== undefined && body.latitude !== "" && body.latitude !== null ? Number(body.latitude) : null,
    longitude: body.longitude !== undefined && body.longitude !== "" && body.longitude !== null ? Number(body.longitude) : null,
    daySortOrder: Number(body.daySortOrder ?? rec.items.length),
    kanbanSortOrder: Number(body.kanbanSortOrder ?? rec.items.length),
    assigneeTravellerId: body.assigneeTravellerId || null,
    bookingId: body.bookingId || null,
    estimatedCost: body.estimatedCost !== undefined && body.estimatedCost !== "" && body.estimatedCost !== null ? Number(body.estimatedCost) : null,
    notes: String(body.notes || ""),
    hasAttachment: false,
    attachmentFileName: null,
    attachmentFileType: null,
    linkedVaultNoteId: body.linkedVaultNoteId || null,
    syncedCalendarEventId: body.syncedCalendarEventId || null,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function updateTripItem(user: AppUser, tripId: string, itemId: string, patch: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const idx = rec.items.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error("Item not found.");
  const cur = rec.items[idx];
  const nextScheduled = patch.scheduledDate === undefined ? cur.scheduledDate : patch.scheduledDate || null;
  rec.items[idx] = {
    ...cur,
    ...(patch.title !== undefined ? { title: String(patch.title).trim() } : {}),
    ...(patch.description !== undefined ? { description: String(patch.description) } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
    scheduledDate: nextScheduled,
    startTime: nextScheduled ? (patch.startTime !== undefined ? patch.startTime || null : cur.startTime) : null,
    endTime: nextScheduled ? (patch.endTime !== undefined ? patch.endTime || null : cur.endTime) : null,
    ...(patch.location !== undefined ? { location: String(patch.location) } : {}),
    ...(patch.latitude !== undefined ? { latitude: patch.latitude === "" || patch.latitude === null ? null : Number(patch.latitude) } : {}),
    ...(patch.longitude !== undefined ? { longitude: patch.longitude === "" || patch.longitude === null ? null : Number(patch.longitude) } : {}),
    ...(patch.daySortOrder !== undefined ? { daySortOrder: Number(patch.daySortOrder) || 0 } : {}),
    ...(patch.kanbanSortOrder !== undefined ? { kanbanSortOrder: Number(patch.kanbanSortOrder) || 0 } : {}),
    ...(patch.assigneeTravellerId !== undefined ? { assigneeTravellerId: patch.assigneeTravellerId || null } : {}),
    ...(patch.bookingId !== undefined ? { bookingId: patch.bookingId || null } : {}),
    ...(patch.estimatedCost !== undefined ? { estimatedCost: patch.estimatedCost === "" || patch.estimatedCost === null ? null : Number(patch.estimatedCost) } : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
    ...(patch.linkedVaultNoteId !== undefined ? { linkedVaultNoteId: patch.linkedVaultNoteId || null } : {}),
    ...(patch.syncedCalendarEventId !== undefined ? { syncedCalendarEventId: patch.syncedCalendarEventId || null } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function reorderTripItems(
  user: AppUser,
  tripId: string,
  updates: Array<{ id: string; status?: TaskStatus; scheduledDate?: string | null; daySortOrder?: number; kanbanSortOrder?: number }>,
): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/items/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  for (const u of updates) {
    const item = rec.items.find((i) => i.id === u.id);
    if (!item) continue;
    if (u.status !== undefined) item.status = u.status;
    if (u.scheduledDate !== undefined) {
      item.scheduledDate = u.scheduledDate || null;
      if (!item.scheduledDate) {
        item.startTime = null;
        item.endTime = null;
      }
    }
    if (u.daySortOrder !== undefined) item.daySortOrder = u.daySortOrder;
    if (u.kanbanSortOrder !== undefined) item.kanbanSortOrder = u.kanbanSortOrder;
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripItem(user: AppUser, tripId: string, itemId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.items = rec.items.filter((i) => i.id !== itemId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function saveTripExpense(
  user: AppUser,
  tripId: string,
  body: Record<string, any>,
  expenseId?: string,
): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    const path = expenseId
      ? `/travel-space/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`
      : `/travel-space/trips/${encodeURIComponent(tripId)}/expenses`;
    return travelApiJson<TravelWorkspace>(path, {
      method: expenseId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const parsed = normalizeExpenseInput(
    body,
    rec.trip,
    rec.travellers.map((t) => t.id),
  );
  const now = new Date().toISOString();
  const nextExp: TravelExpense = {
    id: expenseId || uid(),
    tripId,
    title: parsed.title,
    amount: parsed.amount,
    currency: parsed.currency,
    tripAmount: parsed.tripAmount,
    exchangeRate: parsed.exchangeRate,
    convertedOn: parsed.convertedOn,
    expenseDate: parsed.expenseDate,
    categoryId: parsed.categoryId,
    categoryName: parsed.categoryName,
    expenseType: parsed.expenseType,
    paidByTravellerId: parsed.paidByTravellerId,
    paidFromGroupFund: parsed.paidFromGroupFund,
    splitMethod: parsed.splitMethod,
    paymentMethod: parsed.paymentMethod,
    linkedFinanceItemId: body.linkedFinanceItemId || null,
    hasReceipt: false,
    receiptFileName: null,
    receiptFileType: null,
    notes: parsed.notes,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    splits: parsed.splits.map((s: any) => ({
      id: uid(),
      travellerId: s.travellerId,
      shareAmount: s.shareAmount,
      tripShareAmount: s.tripShareAmount,
    })),
  };
  if (expenseId) {
    const idx = rec.expenses.findIndex((e) => e.id === expenseId);
    if (idx >= 0) {
      nextExp.hasReceipt = rec.expenses[idx].hasReceipt;
      nextExp.receiptFileName = rec.expenses[idx].receiptFileName;
      nextExp.localReceiptDataUrl = rec.expenses[idx].localReceiptDataUrl;
      rec.expenses[idx] = nextExp;
    }
  } else {
    rec.expenses.push(nextExp);
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripExpense(user: AppUser, tripId: string, expenseId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.expenses = rec.expenses.filter((e) => e.id !== expenseId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function createTripSettlement(user: AppUser, tripId: string, body: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const amtMinor = toMinor(body.amount, rec.trip.primaryCurrency);
  if (amtMinor <= 0) throw new Error("Settlement amount must be greater than zero.");
  if (!body.fromTravellerId || !body.toTravellerId || body.fromTravellerId === body.toTravellerId) {
    throw new Error("Choose distinct payer and recipient travellers.");
  }
  rec.settlements.push({
    id: uid(),
    tripId,
    fromTravellerId: body.fromTravellerId,
    toTravellerId: body.toTravellerId,
    amount: fromMinor(amtMinor, rec.trip.primaryCurrency),
    currency: rec.trip.primaryCurrency,
    status: body.status === "pending" ? "pending" : "completed",
    settledOn: body.settledOn || new Date().toISOString().slice(0, 10),
    method: String(body.method || ""),
    note: String(body.note || ""),
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  });
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripSettlement(user: AppUser, tripId: string, settlementId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/settlements/${encodeURIComponent(settlementId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.settlements = rec.settlements.filter((s) => s.id !== settlementId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function saveTripBooking(
  user: AppUser,
  tripId: string,
  body: Record<string, any>,
  bookingId?: string,
): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    const path = bookingId
      ? `/travel-space/trips/${encodeURIComponent(tripId)}/bookings/${encodeURIComponent(bookingId)}`
      : `/travel-space/trips/${encodeURIComponent(tripId)}/bookings`;
    return travelApiJson<TravelWorkspace>(path, {
      method: bookingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const now = new Date().toISOString();
  const title = String(body.title || "").trim();
  if (!title) throw new Error("Enter a booking title.");
  const entry: TravelBooking = {
    id: bookingId || uid(),
    tripId,
    category: BOOKING_CATEGORIES.includes(body.category) ? body.category : "other",
    title,
    provider: String(body.provider || ""),
    bookingReference: String(body.bookingReference || ""),
    bookingDate: body.bookingDate || null,
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    startAtText: String(body.startAtText || ""),
    endAtText: String(body.endAtText || ""),
    location: String(body.location || ""),
    price: body.price !== undefined && body.price !== "" && body.price !== null ? Number(body.price) : null,
    currency: normalizeCurrency(body.currency, rec.trip.primaryCurrency),
    paymentStatus: PAYMENT_STATUSES.includes(body.paymentStatus) ? body.paymentStatus : "unpaid",
    bookingStatus: BOOKING_STATUSES.includes(body.bookingStatus) ? body.bookingStatus : "confirmed",
    travellerIds: Array.isArray(body.travellerIds) ? body.travellerIds : [],
    membershipItemId: body.membershipItemId || null,
    contactDetails: String(body.contactDetails || ""),
    notes: String(body.notes || ""),
    refundAmount: body.refundAmount !== undefined && body.refundAmount !== "" && body.refundAmount !== null ? Number(body.refundAmount) : null,
    cancellationNote: String(body.cancellationNote || ""),
    hasAttachment: false,
    attachmentFileName: null,
    attachmentFileType: null,
    createdAt: now,
    updatedAt: now,
  };
  if (bookingId) {
    const idx = rec.bookings.findIndex((b) => b.id === bookingId);
    if (idx >= 0) {
      entry.hasAttachment = rec.bookings[idx].hasAttachment;
      entry.attachmentFileName = rec.bookings[idx].attachmentFileName;
      entry.localDataUrl = rec.bookings[idx].localDataUrl;
      rec.bookings[idx] = entry;
    }
  } else {
    rec.bookings.push(entry);
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripBooking(user: AppUser, tripId: string, bookingId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/bookings/${encodeURIComponent(bookingId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.bookings = rec.bookings.filter((b) => b.id !== bookingId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function saveTripTraveller(
  user: AppUser,
  tripId: string,
  body: Record<string, any>,
  travellerId?: string,
): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    const path = travellerId
      ? `/travel-space/trips/${encodeURIComponent(tripId)}/travellers/${encodeURIComponent(travellerId)}`
      : `/travel-space/trips/${encodeURIComponent(tripId)}/travellers`;
    return travelApiJson<TravelWorkspace>(path, {
      method: travellerId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  if (travellerId) {
    const idx = rec.travellers.findIndex((t) => t.id === travellerId);
    if (idx >= 0) {
      const cur = rec.travellers[idx];
      rec.travellers[idx] = {
        ...cur,
        ...(body.fullName !== undefined ? { fullName: String(body.fullName).trim() } : {}),
        ...(body.email !== undefined ? { email: String(body.email) } : {}),
        ...(body.phone !== undefined ? { phone: String(body.phone) } : {}),
        ...(body.responsibility !== undefined ? { responsibility: String(body.responsibility) } : {}),
        ...(body.emergencyContactName !== undefined ? { emergencyContactName: String(body.emergencyContactName) } : {}),
        ...(body.emergencyContactPhone !== undefined ? { emergencyContactPhone: String(body.emergencyContactPhone) } : {}),
        ...(body.role && !cur.isOwner ? { role: body.role } : {}),
      };
    }
  } else {
    const nm = String(body.fullName || body.memberQuery || "").trim();
    if (!nm) throw new Error("Enter the traveller's name.");
    rec.travellers.push({
      id: uid(),
      tripId,
      userId: null,
      contactId: body.contactId || null,
      familyItemId: body.familyItemId || null,
      fullName: nm,
      email: String(body.email || ""),
      phone: String(body.phone || ""),
      role: TRAVELLER_ROLES.includes(body.role) && body.role !== "owner" ? body.role : "viewer",
      isOwner: false,
      responsibility: String(body.responsibility || ""),
      emergencyContactName: String(body.emergencyContactName || ""),
      emergencyContactPhone: String(body.emergencyContactPhone || ""),
      inviteStatus: "active",
      sortOrder: rec.travellers.length,
    });
    if (rec.travellers.length > rec.trip.travelerCount) {
      rec.trip.travelerCount = rec.travellers.length;
      if (rec.trip.companionType === "solo") rec.trip.companionType = "friends";
    }
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripTraveller(user: AppUser, tripId: string, travellerId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/travellers/${encodeURIComponent(travellerId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const target = rec.travellers.find((t) => t.id === travellerId);
  if (target?.isOwner) throw new Error("The trip owner cannot be removed.");
  rec.travellers = rec.travellers.filter((t) => t.id !== travellerId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function createTripDocument(user: AppUser, tripId: string, body: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  const title = String(body.title || "").trim();
  if (!title) throw new Error("Enter a document title.");
  const sourceType = body.sourceType === "vault_item" && body.linkedVaultItemId ? "vault_item" : "upload";
  rec.documents.unshift({
    id: uid(),
    tripId,
    title,
    docCategory: DOCUMENT_CATEGORIES.includes(body.docCategory) ? body.docCategory : "other",
    sourceType,
    linkedVaultItemId: sourceType === "vault_item" ? body.linkedVaultItemId : null,
    hasFile: sourceType === "vault_item",
    fileName: null,
    fileSize: null,
    fileType: null,
    travellerId: body.travellerId || null,
    bookingId: body.bookingId || null,
    activityId: body.activityId || null,
    documentNumber: String(body.documentNumber || ""),
    expiryDate: body.expiryDate || null,
    reminderDaysBefore: body.reminderDaysBefore ? Number(body.reminderDaysBefore) : null,
    isPrivate: Boolean(body.isPrivate),
    notes: String(body.notes || ""),
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  });
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripDocument(user: AppUser, tripId: string, docId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(docId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.documents = rec.documents.filter((d) => d.id !== docId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function saveTripMemory(
  user: AppUser,
  tripId: string,
  body: Record<string, any>,
  memoryId?: string,
): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    const path = memoryId
      ? `/travel-space/trips/${encodeURIComponent(tripId)}/memories/${encodeURIComponent(memoryId)}`
      : `/travel-space/trips/${encodeURIComponent(tripId)}/memories`;
    return travelApiJson<TravelWorkspace>(path, {
      method: memoryId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  if (memoryId) {
    const idx = rec.memories.findIndex((m) => m.id === memoryId);
    if (idx >= 0) {
      rec.memories[idx] = {
        ...rec.memories[idx],
        ...(body.title !== undefined ? { title: String(body.title).trim() } : {}),
        ...(body.caption !== undefined ? { caption: String(body.caption) } : {}),
        ...(body.journalBody !== undefined ? { journalBody: String(body.journalBody) } : {}),
        ...(body.memoryDate !== undefined ? { memoryDate: body.memoryDate || null } : {}),
        ...(body.location !== undefined ? { location: String(body.location) } : {}),
        ...(body.favorite !== undefined ? { favorite: Boolean(body.favorite) } : {}),
      };
    }
  } else {
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Enter a title.");
    const memoryType: MemoryType = MEMORY_TYPES.includes(body.memoryType) ? body.memoryType : "journal";
    rec.memories.push({
      id: uid(),
      tripId,
      memoryType,
      title,
      caption: String(body.caption || ""),
      journalBody: String(body.journalBody || ""),
      memoryDate: body.memoryDate || null,
      dayNumber: body.dayNumber ? Number(body.dayNumber) : null,
      location: String(body.location || ""),
      favorite: Boolean(body.favorite),
      sourceType: body.sourceType || (memoryType === "journal" ? "journal" : "upload"),
      linkedPhotoId: body.linkedPhotoId || null,
      linkedAudioId: body.linkedAudioId || null,
      linkedVaultItemId: body.linkedVaultItemId || null,
      hasFile: Boolean(body.linkedPhotoId || body.linkedAudioId),
      fileName: null,
      fileSize: null,
      fileType: null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    });
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function deleteTripMemory(user: AppUser, tripId: string, memoryId: string): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.memories = rec.memories.filter((m) => m.id !== memoryId);
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function completeTripFlow(user: AppUser, tripId: string, body: Record<string, any>): Promise<TravelWorkspace> {
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(`/travel-space/trips/${encodeURIComponent(tripId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  if (Array.isArray(body.bookingUpdates)) {
    for (const bu of body.bookingUpdates) {
      const b = rec.bookings.find((x) => x.id === bu.id);
      if (b) {
        if (bu.bookingStatus) b.bookingStatus = bu.bookingStatus;
        if (bu.refundAmount !== undefined) b.refundAmount = bu.refundAmount === "" || bu.refundAmount === null ? null : Number(bu.refundAmount);
        if (bu.cancellationNote !== undefined) b.cancellationNote = String(bu.cancellationNote);
      }
    }
  }
  const hydrated = hydrateLocalWorkspace(rec);
  const actualReturnDate = body.actualReturnDate || rec.trip.endDate;
  rec.trip.status = "completed";
  rec.trip.actualReturnDate = actualReturnDate;
  rec.trip.rating = body.rating ? Number(body.rating) : null;
  rec.trip.completionNotes = String(body.completionNotes || "");
  rec.trip.summarySnapshot = {
    completedAt: new Date().toISOString(),
    destinations: hydrated.destinations
      .map((d, idx) => `Stop ${idx + 1} (${formatCoordinatePair(d.latitude, d.longitude)})`)
      .join(" → "),
    destinationCount: hydrated.destinations.length,
    startDate: rec.trip.startDate,
    actualReturnDate,
    durationDays: tripDurationDays(rec.trip.startDate, actualReturnDate),
    travellerCount: hydrated.travellers.length,
    activitiesCompleted: hydrated.items.filter((i) => i.status === "done").length,
    activitiesTotal: hydrated.items.length,
    totalPlannedBudget: hydrated.budgetOverview.totalPlannedBudget,
    totalExpenses: hydrated.budgetOverview.totalExpenses,
    personalExpenses: hydrated.budgetOverview.personalExpenses,
    sharedExpenses: hydrated.budgetOverview.sharedExpenses,
    currency: rec.trip.primaryCurrency,
    unsettledCount: hydrated.budgetOverview.suggestedSettlements.length,
    photosAndMemoriesCount: hydrated.memories.length,
  };
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export const ALLOWED_TRIP_COVER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
export const MAX_TRIP_COVER_MB = 15;
export const MAX_TRIP_COVER_BYTES = MAX_TRIP_COVER_MB * 1024 * 1024;

export function validateTripCoverFile(file: File | null | undefined): string | null {
  if (!file) return "Choose an image file to upload.";
  if (file.size <= 0) return "The selected image file is empty.";
  const mime = String(file.type || "").toLowerCase();
  if (!ALLOWED_TRIP_COVER_TYPES.has(mime)) {
    return "Choose a JPG, PNG, WebP, or GIF image for the trip cover.";
  }
  if (file.size > MAX_TRIP_COVER_BYTES) {
    return `Trip cover image must be ${MAX_TRIP_COVER_MB} MB or smaller.`;
  }
  return null;
}

// Volatile in-memory authenticated object-URL cache for trip cover images.
// Never persisted to storage; automatically invalidated on replace/remove/user switch.
const COVER_OBJECT_URLS = new Map<string, string>();
const COVER_IN_FLIGHT = new Map<string, Promise<string>>();
let lastCachedCoverUserId: string | null = null;

function ensureCoverCacheUser(userId: string) {
  if (lastCachedCoverUserId && lastCachedCoverUserId !== userId) {
    clearTripCoverCache();
  }
  lastCachedCoverUserId = userId;
}

export function clearTripCoverCache(): void {
  for (const url of COVER_OBJECT_URLS.values()) {
    if (url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    }
  }
  COVER_OBJECT_URLS.clear();
  COVER_IN_FLIGHT.clear();
}

export function invalidateTripCoverCache(userId: string, tripId: string): void {
  const prefix = `${userId}:${tripId}:`;
  for (const [key, url] of Array.from(COVER_OBJECT_URLS.entries())) {
    if (key.startsWith(prefix)) {
      if (url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors
        }
      }
      COVER_OBJECT_URLS.delete(key);
    }
  }
  for (const key of Array.from(COVER_IN_FLIGHT.keys())) {
    if (key.startsWith(prefix)) {
      COVER_IN_FLIGHT.delete(key);
    }
  }
}

export async function resolveTripCoverUrl(
  user: AppUser,
  trip: Pick<TravelTripSummary, "id" | "hasCover" | "coverUpdatedAt" | "updatedAt" | "localCoverDataUrl">,
): Promise<string | null> {
  if (!trip.hasCover) return null;
  if (trip.localCoverDataUrl) return trip.localCoverDataUrl;
  if (isLocalMode(user)) return null;

  ensureCoverCacheUser(user.id);
  const version = trip.coverUpdatedAt || trip.updatedAt || "v1";
  const cacheKey = `${user.id}:${trip.id}:${version}`;
  const cached = COVER_OBJECT_URLS.get(cacheKey);
  if (cached) return cached;

  const inflight = COVER_IN_FLIGHT.get(cacheKey);
  if (inflight) return inflight;

  const requestPromise = (async () => {
    try {
      const res = await pagesApiRequest(
        `/travel-space/trips/${encodeURIComponent(trip.id)}/files/cover`,
        { method: "GET" },
      );
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error("Empty cover image response.");
      // Revoke any older version for the same trip before caching the new version
      invalidateTripCoverCache(user.id, trip.id);
      const objectUrl = URL.createObjectURL(blob);
      COVER_OBJECT_URLS.set(cacheKey, objectUrl);
      return objectUrl;
    } finally {
      COVER_IN_FLIGHT.delete(cacheKey);
    }
  })();

  COVER_IN_FLIGHT.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function uploadTripAttachment(
  user: AppUser,
  tripId: string,
  kind: "cover" | "booking" | "expense_receipt" | "document" | "memory",
  file: File,
  targetId?: string,
  options?: {
    onProgress?: (progress: TransferProgress) => void;
    signal?: AbortSignal;
  },
): Promise<TravelWorkspace> {
  if (kind === "cover") {
    const validationErr = validateTripCoverFile(file);
    if (validationErr) {
      throw new TravelSpaceClientError(validationErr, 400, "INVALID_IMAGE_TYPE");
    }
  }

  if (!isLocalMode(user)) {
    const form = new FormData();
    form.set("kind", kind);
    if (targetId) form.set("targetId", targetId);
    form.set("file", file);
    try {
      const ws = await uploadMultipart<TravelWorkspace>(
        `/travel-space/trips/${encodeURIComponent(tripId)}/upload`,
        form,
        options?.onProgress,
        "POST",
      );
      if (kind === "cover") {
        invalidateTripCoverCache(user.id, tripId);
      }
      return ws;
    } catch (err) {
      if (err instanceof PagesApiError) {
        throw new TravelSpaceClientError(err.message, err.status, err.code || "UPLOAD_FAILED");
      }
      throw err;
    }
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  options?.onProgress?.({ loaded: Math.round(file.size * 0.5), total: file.size, percent: 50, remainingSeconds: 0 });
  const dataUrl = await readFileAsDataUrl(file);
  options?.onProgress?.({ loaded: file.size, total: file.size, percent: 100, remainingSeconds: 0 });
  const now = new Date().toISOString();
  if (kind === "cover") {
    rec.trip.hasCover = true;
    rec.trip.coverFileName = file.name;
    rec.trip.coverFileSize = file.size;
    rec.trip.coverFileType = file.type;
    rec.trip.updatedAt = now;
    rec.trip.coverUpdatedAt = `${now}:${file.size}:${file.name}`;
    rec.trip.localCoverDataUrl = dataUrl;
    invalidateTripCoverCache(user.id, tripId);
  } else if (kind === "booking" && targetId) {
    const b = rec.bookings.find((x) => x.id === targetId);
    if (b) {
      b.hasAttachment = true;
      b.attachmentFileName = file.name;
      b.attachmentFileType = file.type;
      b.localDataUrl = dataUrl;
    }
  } else if (kind === "expense_receipt" && targetId) {
    const e = rec.expenses.find((x) => x.id === targetId);
    if (e) {
      e.hasReceipt = true;
      e.receiptFileName = file.name;
      e.receiptFileType = file.type;
      e.localReceiptDataUrl = dataUrl;
    }
  } else if (kind === "document" && targetId) {
    const d = rec.documents.find((x) => x.id === targetId);
    if (d) {
      d.hasFile = true;
      d.fileName = file.name;
      d.fileSize = file.size;
      d.fileType = file.type;
      d.localDataUrl = dataUrl;
    }
  } else if (kind === "memory" && targetId) {
    const m = rec.memories.find((x) => x.id === targetId);
    if (m) {
      m.hasFile = true;
      m.fileName = file.name;
      m.fileSize = file.size;
      m.fileType = file.type;
      m.localDataUrl = dataUrl;
    }
  }
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function removeTripCover(
  user: AppUser,
  tripId: string,
): Promise<TravelWorkspace> {
  invalidateTripCoverCache(user.id, tripId);
  if (!isLocalMode(user)) {
    return travelApiJson<TravelWorkspace>(
      `/travel-space/trips/${encodeURIComponent(tripId)}/files/cover`,
      { method: "DELETE" },
    );
  }
  const store = readLocalStore(user.id);
  const rec = store.trips[tripId];
  if (!rec) throw new Error("Trip not found.");
  rec.trip.hasCover = false;
  rec.trip.coverFileName = null;
  rec.trip.coverFileSize = null;
  rec.trip.coverFileType = null;
  rec.trip.coverUpdatedAt = null;
  rec.trip.localCoverDataUrl = null;
  rec.trip.updatedAt = new Date().toISOString();
  writeLocalStore(user.id, store);
  return hydrateLocalWorkspace(rec);
}

export async function openTripFile(
  user: AppUser,
  tripId: string,
  kind: "cover" | "booking" | "expense_receipt" | "document" | "memory",
  targetId?: string,
  localDataUrl?: string | null,
): Promise<string> {
  if (localDataUrl) return localDataUrl;
  if (isLocalMode(user)) throw new Error("No local preview available.");
  const suffix = targetId ? `/${encodeURIComponent(targetId)}` : "";
  const res = await pagesApiRequest(`/travel-space/trips/${encodeURIComponent(tripId)}/files/${kind}${suffix}`, {
    method: "GET",
  });
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Explore Wishlist CRUD
export async function saveExplorePlace(
  user: AppUser,
  body: Record<string, any>,
  placeId?: string,
): Promise<TravelExplorePlace> {
  if (!isLocalMode(user)) {
    const path = placeId ? `/travel-space/explore/${encodeURIComponent(placeId)}` : "/travel-space/explore";
    const res = await travelApiJson<{ place: TravelExplorePlace }>(path, {
      method: placeId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.place;
  }
  const store = readLocalStore(user.id);
  const now = new Date().toISOString();
  if (placeId) {
    const idx = store.explorePlaces.findIndex((p) => p.id === placeId);
    if (idx < 0) throw new Error("Place not found.");
    store.explorePlaces[idx] = {
      ...store.explorePlaces[idx],
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.country !== undefined ? { country: String(body.country) } : {}),
      ...(body.city !== undefined ? { city: String(body.city) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.tripId !== undefined ? { tripId: body.tripId || null } : {}),
      ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost === "" || body.estimatedCost === null ? null : Number(body.estimatedCost) } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.referenceUrl !== undefined ? { referenceUrl: String(body.referenceUrl) } : {}),
      ...(body.linkedUrlItemId !== undefined ? { linkedUrlItemId: body.linkedUrlItemId || null } : {}),
      ...(body.latitude !== undefined || body.longitude !== undefined
        ? {
            latitude:
              body.latitude === null || body.latitude === "" || !isValidCoordinatePair(body.latitude, body.longitude)
                ? null
                : roundCoordinate(Number(body.latitude)),
            longitude:
              body.longitude === null || body.longitude === "" || !isValidCoordinatePair(body.latitude, body.longitude)
                ? null
                : roundCoordinate(Number(body.longitude)),
          }
        : {}),
      ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      ...(body.favorite !== undefined ? { favorite: Boolean(body.favorite) } : {}),
      updatedAt: now,
    };
    writeLocalStore(user.id, store);
    return store.explorePlaces[idx];
  }
  const hasCoords =
    body.latitude !== undefined &&
    body.latitude !== null &&
    body.latitude !== "" &&
    body.longitude !== undefined &&
    body.longitude !== null &&
    body.longitude !== "" &&
    isValidCoordinatePair(body.latitude, body.longitude);
  const place: TravelExplorePlace = {
    id: uid(),
    userId: user.id,
    name: String(body.name || "").trim(),
    kind: EXPLORE_KINDS.includes(body.kind) ? body.kind : "destination",
    country: String(body.country || ""),
    city: String(body.city || ""),
    status: EXPLORE_STATUSES.includes(body.status) ? body.status : "want_to_visit",
    tripId: body.tripId || null,
    estimatedCost: body.estimatedCost !== undefined && body.estimatedCost !== "" && body.estimatedCost !== null ? Number(body.estimatedCost) : null,
    currency: normalizeCurrency(body.currency, "BDT"),
    referenceUrl: String(body.referenceUrl || ""),
    linkedUrlItemId: body.linkedUrlItemId || null,
    latitude: hasCoords ? roundCoordinate(Number(body.latitude)) : null,
    longitude: hasCoords ? roundCoordinate(Number(body.longitude)) : null,
    notes: String(body.notes || ""),
    favorite: Boolean(body.favorite),
    createdAt: now,
    updatedAt: now,
  };
  store.explorePlaces.unshift(place);
  writeLocalStore(user.id, store);
  return place;
}

export async function deleteExplorePlace(user: AppUser, placeId: string): Promise<void> {
  if (!isLocalMode(user)) {
    await travelApiJson(`/travel-space/explore/${encodeURIComponent(placeId)}`, { method: "DELETE" });
    return;
  }
  const store = readLocalStore(user.id);
  store.explorePlaces = store.explorePlaces.filter((p) => p.id !== placeId);
  writeLocalStore(user.id, store);
}

/**
 * Adds a saved Explore place to a Trip's coordinate-only map destinations (Section 21: "Add to Trip").
 * Never persists destination names or addresses in `trip_destinations`.
 */
export async function addExplorePlaceToTrip(
  user: AppUser,
  placeId: string,
  tripId: string,
  coordinates?: { latitude: number; longitude: number },
): Promise<void> {
  if (!isLocalMode(user)) {
    await travelApiJson(`/travel-space/explore/${encodeURIComponent(placeId)}/add-to-trip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tripId,
        target: "destination",
        ...(coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
      }),
    });
    return;
  }
  const store = readLocalStore(user.id);
  const place = store.explorePlaces.find((p) => p.id === placeId);
  const rec = store.trips[tripId];
  if (!place || !rec) throw new Error("Select a valid trip.");

  let lat = coordinates?.latitude ?? place.latitude ?? NaN;
  let lng = coordinates?.longitude ?? place.longitude ?? NaN;
  if (!isValidCoordinatePair(lat, lng)) {
    const hit = searchCuratedDestinations(place.name || place.city || "")[0];
    if (hit && isValidCoordinatePair(hit.latitude, hit.longitude)) {
      lat = hit.latitude!;
      lng = hit.longitude!;
    }
  }
  if (!isValidCoordinatePair(lat, lng)) {
    throw new Error("Pin coordinates on this Explore place before adding it as a map destination stop.");
  }

  rememberEphemeralStopLabel(lat, lng, place.name);
  const nowIso = new Date().toISOString();
  rec.destinations = [
    ...normalizeStoredDestinations(tripId, rec.destinations),
    {
      id: uid(),
      tripId,
      latitude: roundCoordinate(lat),
      longitude: roundCoordinate(lng),
      orderIndex: rec.destinations.length,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
  writeLocalStore(user.id, store);
  await saveExplorePlace(user, { status: "planned", tripId }, placeId);
}

/**
 * Adds a saved Explore place as a scheduled activity in `travel_trip_items` (Section 21: "Add to Itinerary").
 */
export async function addExplorePlaceToItinerary(
  user: AppUser,
  placeId: string,
  tripId: string,
  scheduledDate?: string,
  coordinates?: { latitude: number; longitude: number },
): Promise<void> {
  if (!isLocalMode(user)) {
    await travelApiJson(`/travel-space/explore/${encodeURIComponent(placeId)}/add-to-itinerary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tripId,
        target: "itinerary",
        scheduledDate,
        ...(coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
      }),
    });
    return;
  }
  const store = readLocalStore(user.id);
  const place = store.explorePlaces.find((p) => p.id === placeId);
  const rec = store.trips[tripId];
  if (!place || !rec) throw new Error("Select a valid trip.");
  let lat = coordinates?.latitude ?? place.latitude ?? null;
  let lng = coordinates?.longitude ?? place.longitude ?? null;
  if (!isValidCoordinatePair(lat, lng)) {
    const hit = searchCuratedDestinations(place.name || place.city || "")[0];
    if (hit && isValidCoordinatePair(hit.latitude, hit.longitude)) {
      lat = hit.latitude;
      lng = hit.longitude;
    }
  }
  await createTripItem(user, tripId, {
    title: place.name,
    description: place.notes,
    scheduledDate: scheduledDate || rec.trip.startDate,
    location: [place.city, place.country].filter(Boolean).join(", ") || place.name,
    latitude: isValidCoordinatePair(lat, lng) ? roundCoordinate(lat!) : null,
    longitude: isValidCoordinatePair(lat, lng) ? roundCoordinate(lng!) : null,
    estimatedCost: place.estimatedCost,
  });
  await saveExplorePlace(user, { status: "planned", tripId }, placeId);
}

// Cross-module library loaders (Photo Studio & AudioSpace) without duplicating files
export async function loadLinkablePhotos(user: AppUser): Promise<Array<{ id: string; title: string; fileName: string }>> {
  if (isLocalMode(user)) return [];
  try {
    const data = await travelApiJson<{ photos?: any[] }>("/photo-studio/photos");
    return (data.photos || []).map((p) => ({
      id: p.id,
      title: p.title || p.fileName || "Studio Photo",
      fileName: p.fileName || "",
    }));
  } catch {
    return [];
  }
}

export async function loadLinkableAudios(user: AppUser): Promise<Array<{ id: string; title: string; source: string }>> {
  if (isLocalMode(user)) return [];
  try {
    const data = await travelApiJson<{ items?: any[] }>("/audio-space/audios");
    return (data.items || []).map((a) => ({
      id: a.id,
      title: a.title || "Audio recording",
      source: a.source || "upload",
    }));
  } catch {
    return [];
  }
}
