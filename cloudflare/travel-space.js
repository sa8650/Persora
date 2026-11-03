// Persora TravelSpace — Cloudflare Pages Worker API routes.
//
// Enforces server-side RBAC (owner, editor, expense_contributor, viewer),
// validates dates, budgets, multi-currency expenses, equal/custom minor-unit
// splits, settlements, unified task/itinerary scheduling, private R2 uploads,
// global 7-day Trash, and Life Timeline milestone creation on trip completion.

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
  TravelValidationError,
  canRolePerform,
  computeContributionSummary,
  computeTripBudgetOverview,
  detectScheduleOverlaps,
  formatCoordinatePair,
  fromMinor,
  generateTripDays,
  isValidCoordinatePair,
  isValidDate,
  isValidTime,
  normalizeCurrency,
  normalizeExpenseInput,
  roundCoordinate,
  sanitizeBudgetCategories,
  sanitizeInitialTasks,
  sanitizeTripDestinations,
  sanitizeTripInput,
  searchCuratedDestinations,
  toMinor,
  tripDurationDays,
} from "./travel-space-rules.js";
import { handleTimeline } from "./timeline.js";

export const TRAVEL_SPACE_ROUTE_PREFIX = "/travel-space";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_COVER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_UPLOAD_TYPES = new Set([
  ...ALLOWED_COVER_IMAGE_TYPES,
  "application/pdf",
]);
const MAX_COVER_IMAGE_MB = 15;

const GEOCODE_CACHE = new Map();
const GEOCODE_CACHE_TTL_MS = 15 * 60 * 1000;
const ROUTE_CACHE = new Map();
const ROUTE_CACHE_TTL_MS = 30 * 60 * 1000;
let lastNominatimCallAt = 0;

function cacheGet(map, key, ttlMs) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value, maxEntries = 250) {
  if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { at: Date.now(), value });
}

export class TravelSpaceError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.name = "TravelSpaceError";
    this.status = status;
    this.code =
      code ||
      (status === 401
        ? "AUTH_REQUIRED"
        : status === 403
          ? "PERMISSION_DENIED"
          : status === 404
            ? "NOT_FOUND"
            : status >= 500
              ? "SERVER_ERROR"
              : "VALIDATION_ERROR");
  }
}

function headersFor(origin, extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    ...extra,
  };
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: headersFor(origin) });
}

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return {
    apikey: secret,
    ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }),
    ...extra,
  };
}

function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}

async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}

async function databaseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // fallback below
  }
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (message && code.startsWith("P04")) {
    const status = Number(code.slice(1)) || 400;
    return new TravelSpaceError(
      message,
      status >= 400 && status < 600 ? status : 400,
      status === 403 ? "PERMISSION_DENIED" : status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
    );
  }
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") {
    return new TravelSpaceError(
      "TravelSpace needs the latest Persora database migration (20261102120000_travel_space_map_destinations.sql).",
      503,
      "DB_SCHEMA_OUTDATED",
    );
  }
  console.error("Persora TravelSpace DB error", { status: response.status, code });
  return new TravelSpaceError(
    message || "TravelSpace database operation failed.",
    502,
    "DB_OPERATION_FAILED",
  );
}

async function listRows(path, env) {
  const response = await dbFetch(path, env);
  if (!response.ok) throw await databaseError(response);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function insertRows(table, body, env) {
  if (Array.isArray(body) && body.length > 1) {
    const expectedKeys = Object.keys(body[0]).sort().join(",");
    for (let i = 1; i < body.length; i += 1) {
      const rowKeys = Object.keys(body[i]).sort().join(",");
      if (rowKeys !== expectedKeys) {
        throw new TravelSpaceError(
          `Internal batch insert key mismatch for ${table}.`,
          500,
          "BATCH_KEYS_MISMATCH",
        );
      }
    }
  }
  const response = await dbFetch(table, env, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}

async function patchRows(path, body, env) {
  const response = await dbFetch(path, env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await databaseError(response);
  return response.json();
}

async function deleteRows(path, env) {
  const response = await dbFetch(path, env, { method: "DELETE" });
  if (!response.ok) throw await databaseError(response);
}

async function rpc(name, args, env) {
  const response = await dbFetch(`rpc/${name}`, env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (!response.ok) throw await databaseError(response);
  if (response.status === 204) return null;
  return response.json();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new TravelSpaceError("Send a valid JSON request body.", 400);
  }
}

// ---------------------------------------------------------------------------
// Row Serializers (never leak raw R2 file_key values to clients)
// ---------------------------------------------------------------------------

function isoDateOut(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val.toISOString().slice(0, 10);
  const str = String(val).trim();
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(str) ? str.slice(0, 10) : str;
}

function mapTripRow(row, myRole = "owner", extra = {}) {
  const startDate = isoDateOut(row.start_date);
  const endDate = isoDateOut(row.end_date);
  return {
    id: row.id,
    ownerId: row.owner_id,
    myRole,
    title: row.title,
    description: row.description || "",
    startDate,
    endDate,
    durationDays: tripDurationDays(startDate, endDate),
    companionType: row.companion_type,
    travelerCount: Number(row.traveler_count) || 1,
    tripType: row.trip_type || null,
    status: row.status,
    primaryCurrency: row.primary_currency || "BDT",
    budgetScope: row.budget_scope || "personal",
    personalBudget: Number(row.personal_budget || 0),
    hasCover: Boolean(row.cover_file_key),
    coverFileName: row.cover_file_name || null,
    coverFileSize: row.cover_file_size ? Number(row.cover_file_size) : null,
    coverFileType: row.cover_file_type || null,
    coverUpdatedAt: row.cover_file_key
      ? `${row.updated_at || ""}:${row.cover_file_size || 0}:${row.cover_file_name || ""}`
      : null,
    actualReturnDate: isoDateOut(row.actual_return_date),
    rating: row.rating ? Number(row.rating) : null,
    completionNotes: row.completion_notes || "",
    summarySnapshot: row.summary_snapshot || null,
    timelineEventId: row.timeline_event_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function mapDestinationRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    orderIndex: Number(row.order_index ?? 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapTravellerRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id || null,
    contactId: row.contact_id || null,
    familyItemId: row.family_item_id || null,
    fullName: row.full_name,
    email: row.email || "",
    phone: row.phone || "",
    role: row.role || "viewer",
    isOwner: Boolean(row.is_owner),
    responsibility: row.responsibility || "",
    emergencyContactName: row.emergency_contact_name || "",
    emergencyContactPhone: row.emergency_contact_phone || "",
    inviteStatus: row.invite_status || "active",
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapCategoryRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    allocatedAmount: Number(row.allocated_amount || 0),
    color: row.color || "blue",
    isDefault: Boolean(row.is_default),
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapContributionRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    travellerId: row.traveller_id,
    plannedAmount: Number(row.planned_amount || 0),
    contributedAmount: Number(row.contributed_amount || 0),
    status: row.status || "pending",
    contributedOn: isoDateOut(row.contributed_on),
    note: row.note || "",
  };
}

function mapBookingRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category || "other",
    title: row.title,
    provider: row.provider || "",
    bookingReference: row.booking_reference || "",
    bookingDate: isoDateOut(row.booking_date),
    startDate: isoDateOut(row.start_date),
    endDate: isoDateOut(row.end_date),
    startAtText: row.start_at_text || "",
    endAtText: row.end_at_text || "",
    location: row.location || "",
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    currency: row.currency || "BDT",
    paymentStatus: row.payment_status || "unpaid",
    bookingStatus: row.booking_status || "confirmed",
    travellerIds: Array.isArray(row.traveller_ids) ? row.traveller_ids : [],
    membershipItemId: row.membership_item_id || null,
    contactDetails: row.contact_details || "",
    notes: row.notes || "",
    refundAmount: row.refund_amount === null || row.refund_amount === undefined ? null : Number(row.refund_amount),
    cancellationNote: row.cancellation_note || "",
    hasAttachment: Boolean(row.attachment_file_key),
    attachmentFileName: row.attachment_file_name || null,
    attachmentFileType: row.attachment_file_type || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItemRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    description: row.description || "",
    status: row.status || "todo",
    priority: row.priority || "normal",
    dueDate: isoDateOut(row.due_date),
    scheduledDate: isoDateOut(row.scheduled_date),
    startTime: row.start_time || null,
    endTime: row.end_time || null,
    location: row.location || "",
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    daySortOrder: Number(row.day_sort_order || 0),
    kanbanSortOrder: Number(row.kanban_sort_order || 0),
    assigneeTravellerId: row.assignee_traveller_id || null,
    bookingId: row.booking_id || null,
    estimatedCost: row.estimated_cost === null || row.estimated_cost === undefined ? null : Number(row.estimated_cost),
    notes: row.notes || "",
    hasAttachment: Boolean(row.attachment_file_key),
    attachmentFileName: row.attachment_file_name || null,
    attachmentFileType: row.attachment_file_type || null,
    linkedVaultNoteId: row.linked_vault_note_id || null,
    syncedCalendarEventId: row.synced_calendar_event_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExpenseRow(row, splits = []) {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    amount: Number(row.amount || 0),
    currency: row.currency,
    tripAmount: Number(row.trip_amount || 0),
    exchangeRate: Number(row.exchange_rate || 1),
    convertedOn: isoDateOut(row.converted_on),
    expenseDate: isoDateOut(row.expense_date),
    categoryId: row.category_id || null,
    categoryName: row.category_name || "Others",
    expenseType: row.expense_type || "personal",
    paidByTravellerId: row.paid_by_traveller_id,
    paidFromGroupFund: Boolean(row.paid_from_group_fund),
    splitMethod: row.split_method || "none",
    paymentMethod: row.payment_method || "",
    linkedFinanceItemId: row.linked_finance_item_id || null,
    hasReceipt: Boolean(row.receipt_file_key),
    receiptFileName: row.receipt_file_name || null,
    receiptFileType: row.receipt_file_type || null,
    notes: row.notes || "",
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    splits: splits.map((s) => ({
      id: s.id,
      travellerId: s.traveller_id,
      shareAmount: Number(s.share_amount || 0),
      tripShareAmount: Number(s.trip_share_amount || 0),
    })),
  };
}

function mapSettlementRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    fromTravellerId: row.from_traveller_id,
    toTravellerId: row.to_traveller_id,
    amount: Number(row.amount || 0),
    currency: row.currency || "BDT",
    status: row.status || "completed",
    settledOn: isoDateOut(row.settled_on),
    method: row.method || "",
    note: row.note || "",
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function mapDocumentRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    docCategory: row.doc_category || "other",
    sourceType: row.source_type || "upload",
    linkedVaultItemId: row.linked_vault_item_id || null,
    hasFile: Boolean(row.file_key || row.linked_vault_item_id),
    fileName: row.file_name || null,
    fileSize: row.file_size ? Number(row.file_size) : null,
    fileType: row.file_type || null,
    travellerId: row.traveller_id || null,
    bookingId: row.booking_id || null,
    activityId: row.activity_id || null,
    documentNumber: row.document_number || "",
    expiryDate: isoDateOut(row.expiry_date),
    reminderDaysBefore: row.reminder_days_before === null || row.reminder_days_before === undefined ? null : Number(row.reminder_days_before),
    isPrivate: Boolean(row.is_private),
    notes: row.notes || "",
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function mapMemoryRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    memoryType: row.memory_type || "journal",
    title: row.title,
    caption: row.caption || "",
    journalBody: row.journal_body || "",
    memoryDate: isoDateOut(row.memory_date),
    dayNumber: row.day_number ? Number(row.day_number) : null,
    location: row.location || "",
    favorite: Boolean(row.favorite),
    sourceType: row.source_type || "journal",
    linkedPhotoId: row.linked_photo_id || null,
    linkedAudioId: row.linked_audio_id || null,
    linkedVaultItemId: row.linked_vault_item_id || null,
    hasFile: Boolean(row.file_key || row.linked_photo_id || row.linked_audio_id),
    fileName: row.file_name || null,
    fileSize: row.file_size ? Number(row.file_size) : null,
    fileType: row.file_type || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function mapExploreRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind || "destination",
    country: row.country || "",
    city: row.city || "",
    status: row.status || "want_to_visit",
    tripId: row.trip_id || null,
    estimatedCost: row.estimated_cost === null || row.estimated_cost === undefined ? null : Number(row.estimated_cost),
    currency: row.currency || "BDT",
    referenceUrl: row.reference_url || "",
    linkedUrlItemId: row.linked_url_item_id || null,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    notes: row.notes || "",
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access Control & Workspace Hydration
// ---------------------------------------------------------------------------

async function resolveTripAccess(tripId, userId, env) {
  if (!isUuid(tripId)) throw new TravelSpaceError("Trip not found.", 404);
  const trips = await listRows(`travel_trips?id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`, env);
  const trip = trips[0];
  if (!trip) throw new TravelSpaceError("Trip not found.", 404);

  const memberRows = await listRows(
    `travel_trip_travellers?trip_id=eq.${encodeURIComponent(tripId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=5`,
    env,
  );
  if (trip.owner_id === userId) {
    return { trip, role: "owner", memberTraveller: memberRows[0] || null };
  }
  if (!memberRows.length) {
    throw new TravelSpaceError("Trip not found.", 404);
  }
  const rank = { owner: 1, editor: 2, expense_contributor: 3, viewer: 4 };
  memberRows.sort((a, b) => (rank[a.role] || 9) - (rank[b.role] || 9));
  return { trip, role: memberRows[0].role, memberTraveller: memberRows[0] };
}

function requireRole(role, action) {
  if (!canRolePerform(role, action)) {
    throw new TravelSpaceError("Your role on this trip does not permit that action.", 403);
  }
}

async function loadHydratedTripWorkspace(tripId, userId, env) {
  const { trip, role } = await resolveTripAccess(tripId, userId, env);
  const enc = encodeURIComponent(tripId);
  const [
    destRows,
    travRows,
    catRows,
    contribRows,
    bookingRows,
    itemRows,
    expenseRows,
    splitRows,
    settlementRows,
    docRows,
    memoryRows,
  ] = await Promise.all([
    listRows(`trip_destinations?trip_id=eq.${enc}&select=*&order=order_index.asc`, env),
    listRows(`travel_trip_travellers?trip_id=eq.${enc}&select=*&order=sort_order.asc,created_at.asc`, env),
    listRows(`travel_trip_budget_categories?trip_id=eq.${enc}&select=*&order=sort_order.asc`, env),
    listRows(`travel_trip_contributions?trip_id=eq.${enc}&select=*`, env),
    listRows(`travel_trip_bookings?trip_id=eq.${enc}&select=*&order=start_date.asc.nullslast,created_at.asc`, env),
    listRows(`travel_trip_items?trip_id=eq.${enc}&select=*&order=day_sort_order.asc,kanban_sort_order.asc,created_at.asc`, env),
    listRows(`travel_trip_expenses?trip_id=eq.${enc}&select=*&order=expense_date.desc,created_at.desc`, env),
    listRows(`travel_trip_expense_splits?trip_id=eq.${enc}&select=*`, env),
    listRows(`travel_trip_settlements?trip_id=eq.${enc}&select=*&order=settled_on.desc,created_at.desc`, env),
    listRows(`travel_trip_documents?trip_id=eq.${enc}&select=*&order=created_at.desc`, env),
    listRows(`travel_trip_memories?trip_id=eq.${enc}&select=*&order=memory_date.asc.nullslast,created_at.asc`, env),
  ]);

  const splitsByExpense = new Map();
  for (const sp of splitRows) {
    const arr = splitsByExpense.get(sp.expense_id) || [];
    arr.push(sp);
    splitsByExpense.set(sp.expense_id, arr);
  }

  const visibleDocRows = docRows.filter(
    (d) => !d.is_private || role === "owner" || d.created_by === userId,
  );

  const destinations = destRows.map(mapDestinationRow);
  const travellers = travRows.map(mapTravellerRow);
  const categories = catRows.map(mapCategoryRow);
  const contributions = contribRows.map(mapContributionRow);
  const bookings = bookingRows.map(mapBookingRow);
  const items = itemRows.map(mapItemRow);
  const expenses = expenseRows.map((row) => mapExpenseRow(row, splitsByExpense.get(row.id) || []));
  const settlements = settlementRows.map(mapSettlementRow);
  const documents = visibleDocRows.map(mapDocumentRow);
  const memories = memoryRows.map(mapMemoryRow);

  const mappedTrip = mapTripRow(trip, role, {
    destinations,
  });

  const budgetOverview = computeTripBudgetOverview({
    trip: mappedTrip,
    travellers,
    categories,
    contributions,
    expenses,
    settlements,
  });

  const overlaps = detectScheduleOverlaps(items);
  const days = generateTripDays(mappedTrip.startDate, mappedTrip.endDate);

  return {
    trip: mappedTrip,
    role,
    days,
    destinations,
    travellers,
    categories,
    contributions: budgetOverview.contributions,
    bookings,
    items,
    expenses,
    settlements,
    documents,
    memories,
    budgetOverview,
    overlaps,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap (Overview + My Trips + Explore)
// ---------------------------------------------------------------------------

async function handleBootstrap(identity, env) {
  const uid = encodeURIComponent(identity.id);
  const [ownedTrips, memberRows, exploreRows] = await Promise.all([
    listRows(`travel_trips?owner_id=eq.${uid}&select=*&order=start_date.asc`, env),
    listRows(`travel_trip_travellers?user_id=eq.${uid}&select=trip_id,role`, env),
    listRows(`travel_explore_places?user_id=eq.${uid}&select=*&order=created_at.desc`, env),
  ]);

  const roleByTrip = new Map();
  for (const m of memberRows) {
    if (!roleByTrip.has(m.trip_id)) roleByTrip.set(m.trip_id, m.role);
  }
  for (const t of ownedTrips) {
    roleByTrip.set(t.id, "owner");
  }

  const sharedTripIds = [...roleByTrip.keys()].filter(
    (tid) => !ownedTrips.some((t) => t.id === tid),
  );
  let sharedTrips = [];
  if (sharedTripIds.length > 0) {
    const inList = sharedTripIds.map((id) => encodeURIComponent(id)).join(",");
    sharedTrips = await listRows(`travel_trips?id=in.(${inList})&select=*&order=start_date.asc`, env);
  }

  const allTrips = [...ownedTrips, ...sharedTrips];
  if (allTrips.length === 0) {
    return {
      trips: [],
      explorePlaces: exploreRows.map(mapExploreRow),
      upcomingActivities: [],
      recentExpenses: [],
    };
  }

  const tripIdsCsv = allTrips.map((t) => encodeURIComponent(t.id)).join(",");
  const [destRows, itemRows, expRows, contribRows] = await Promise.all([
    listRows(`trip_destinations?trip_id=in.(${tripIdsCsv})&select=*&order=order_index.asc`, env),
    listRows(`travel_trip_items?trip_id=in.(${tripIdsCsv})&select=*&order=scheduled_date.asc.nullslast,day_sort_order.asc`, env),
    listRows(`travel_trip_expenses?trip_id=in.(${tripIdsCsv})&select=*&order=expense_date.desc,created_at.desc`, env),
    listRows(`travel_trip_contributions?trip_id=in.(${tripIdsCsv})&select=trip_id,planned_amount,contributed_amount`, env),
  ]);

  const destByTrip = new Map();
  for (const d of destRows) {
    const arr = destByTrip.get(d.trip_id) || [];
    arr.push(mapDestinationRow(d));
    destByTrip.set(d.trip_id, arr);
  }

  const itemsByTrip = new Map();
  for (const it of itemRows) {
    const arr = itemsByTrip.get(it.trip_id) || [];
    arr.push(mapItemRow(it));
    itemsByTrip.set(it.trip_id, arr);
  }

  const expByTrip = new Map();
  for (const ex of expRows) {
    const arr = expByTrip.get(ex.trip_id) || [];
    arr.push(ex);
    expByTrip.set(ex.trip_id, arr);
  }

  const contribByTrip = new Map();
  for (const c of contribRows) {
    const arr = contribByTrip.get(c.trip_id) || [];
    arr.push(c);
    contribByTrip.set(c.trip_id, arr);
  }

  const tripTitleMap = new Map(allTrips.map((t) => [t.id, t.title]));

  const trips = allTrips.map((t) => {
    const tItems = itemsByTrip.get(t.id) || [];
    const doneCount = tItems.filter((i) => i.status === "done").length;
    const tExps = expByTrip.get(t.id) || [];
    const totalSpent = tExps.reduce((sum, e) => sum + Number(e.trip_amount || 0), 0);
    const tContribs = contribByTrip.get(t.id) || [];
    const plannedBudget =
      t.budget_scope === "group"
        ? tContribs.reduce((sum, c) => sum + Number(c.planned_amount || 0), 0)
        : t.budget_scope === "personal"
          ? Number(t.personal_budget || 0)
          : 0;
    return mapTripRow(t, roleByTrip.get(t.id) || "viewer", {
      destinations: destByTrip.get(t.id) || [],
      taskTotal: tItems.length,
      taskDone: doneCount,
      progressPercent: tItems.length > 0 ? Math.round((doneCount / tItems.length) * 100) : 0,
      totalSpent,
      plannedBudget,
    });
  });

  const upcomingActivities = itemRows
    .map(mapItemRow)
    .filter((i) => i.scheduledDate && i.status !== "done" && i.status !== "skipped")
    .slice(0, 8)
    .map((i) => ({ ...i, tripTitle: tripTitleMap.get(i.tripId) || "Trip" }));

  const recentExpenses = expRows.slice(0, 8).map((row) => ({
    ...mapExpenseRow(row, []),
    tripTitle: tripTitleMap.get(row.trip_id) || "Trip",
  }));

  return {
    trips,
    explorePlaces: exploreRows.map(mapExploreRow),
    upcomingActivities,
    recentExpenses,
  };
}

// ---------------------------------------------------------------------------
// Create Trip (Atomic Sequence + Idempotent Client ID Support)
// ---------------------------------------------------------------------------

function buildTravellerInsertRow(tripId, fields) {
  return {
    trip_id: tripId,
    user_id: isUuid(fields.user_id) ? fields.user_id : null,
    contact_id: isUuid(fields.contact_id) ? fields.contact_id : null,
    family_item_id: isUuid(fields.family_item_id) ? fields.family_item_id : null,
    full_name: String(fields.full_name || "").trim().slice(0, 120),
    email: String(fields.email || "").trim().slice(0, 160),
    phone: String(fields.phone || "").trim().slice(0, 40),
    role: TRAVELLER_ROLES.includes(fields.role) ? fields.role : "viewer",
    is_owner: Boolean(fields.is_owner),
    responsibility: String(fields.responsibility || "").trim().slice(0, 120),
    emergency_contact_name: String(fields.emergency_contact_name || "").trim().slice(0, 120),
    emergency_contact_phone: String(fields.emergency_contact_phone || "").trim().slice(0, 40),
    invite_status: fields.invite_status === "invited" ? "invited" : "active",
    sort_order: Number.isFinite(Number(fields.sort_order)) ? Math.trunc(Number(fields.sort_order)) : 0,
  };
}

async function resolveOwnedRecordIds(table, userId, candidateIds, env) {
  const uniqueIds = Array.from(new Set((candidateIds || []).filter(isUuid)));
  if (uniqueIds.length === 0) return new Set();
  const rows = await listRows(
    `${table}?user_id=eq.${encodeURIComponent(userId)}&id=in.(${uniqueIds.join(",")})&select=id`,
    env,
  ).catch(() => []);
  return new Set(rows.map((r) => r.id).filter(isUuid));
}

async function syncTripBudgetCategories(tripId, categories, env) {
  const existing = await listRows(
    `travel_trip_budget_categories?trip_id=eq.${encodeURIComponent(tripId)}&select=id,name`,
    env,
  );
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const existingByName = new Map(existing.map((row) => [String(row.name || "").trim().toLowerCase(), row]));
  const keptIds = new Set();
  const toInsert = [];

  for (let idx = 0; idx < categories.length; idx += 1) {
    const cat = categories[idx];
    const matched =
      (cat.id && existingById.get(cat.id)) ||
      existingByName.get(String(cat.name || "").trim().toLowerCase());
    if (matched && !keptIds.has(matched.id)) {
      keptIds.add(matched.id);
      await patchRows(
        `travel_trip_budget_categories?id=eq.${encodeURIComponent(matched.id)}&trip_id=eq.${encodeURIComponent(tripId)}`,
        {
          name: cat.name,
          allocated_amount: cat.allocatedAmount,
          color: cat.color,
          is_default: cat.isDefault,
          sort_order: idx,
          updated_at: new Date().toISOString(),
        },
        env,
      );
    } else {
      toInsert.push({
        trip_id: tripId,
        name: cat.name,
        allocated_amount: cat.allocatedAmount,
        color: cat.color,
        is_default: cat.isDefault,
        sort_order: idx,
      });
    }
  }

  for (const row of existing) {
    if (!keptIds.has(row.id)) {
      await deleteRows(
        `travel_trip_budget_categories?id=eq.${encodeURIComponent(row.id)}&trip_id=eq.${encodeURIComponent(tripId)}`,
        env,
      );
    }
  }

  if (toInsert.length > 0) {
    await insertRows("travel_trip_budget_categories", toInsert, env);
  }
}

async function deleteCoverObjectIfUnreferenced(fileKey, env) {
  if (!fileKey || !env?.VAULT_FILES) return false;
  try {
    const activeRefs = await listRows(
      `travel_trips?cover_file_key=eq.${encodeURIComponent(fileKey)}&select=id&limit=1`,
      env,
    );
    if (activeRefs.length > 0) return false;

    const trashRows = await listRows(
      `trash_items?kind=eq.travel_trip&select=id,payload`,
      env,
    ).catch(() => []);
    for (const tr of trashRows) {
      const trashedKey = tr?.payload?.trip?.cover_file_key;
      if (trashedKey && trashedKey === fileKey) return false;
    }

    await env.VAULT_FILES.delete(fileKey);
    return true;
  } catch {
    return false;
  }
}

async function handleDuplicateTrip(sourceTripId, identity, env) {
  const { trip: sourceRow } = await resolveTripAccess(sourceTripId, identity.id, env);
  const sourceWs = await loadHydratedTripWorkspace(sourceTripId, identity.id, env);
  const copyTitle = `${String(sourceRow.title || "Trip").trim().slice(0, 130)} (Copy)`.slice(0, 140);
  const ownerName =
    String(identity.full_name || identity.email || "Me").trim().slice(0, 120) || "Me";

  const createdTrips = await insertRows(
    "travel_trips",
    {
      owner_id: identity.id,
      title: copyTitle,
      description: sourceRow.description || "",
      start_date: isoDateOut(sourceRow.start_date),
      end_date: isoDateOut(sourceRow.end_date),
      companion_type: sourceRow.companion_type || "solo",
      traveler_count: Math.max(1, Number(sourceRow.traveler_count) || 1),
      trip_type: sourceRow.trip_type || null,
      status: "planning",
      primary_currency: sourceRow.primary_currency || "BDT",
      budget_scope: sourceRow.budget_scope || "personal",
      personal_budget: Number(sourceRow.personal_budget || 0),
    },
    env,
  );
  const newTrip = createdTrips[0];
  const newTripId = newTrip.id;

  try {
    if (sourceRow.cover_file_key && env?.VAULT_FILES) {
      try {
        const srcObj = await env.VAULT_FILES.get(sourceRow.cover_file_key);
        if (srcObj) {
          const safeName = String(sourceRow.cover_file_name || "cover.jpg")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .slice(0, 100);
          const newCoverKey = `${identity.id}/travel-space/${newTripId}/${crypto.randomUUID()}-${safeName}`;
          const bytes =
            typeof srcObj.arrayBuffer === "function"
              ? await srcObj.arrayBuffer()
              : await new Response(srcObj.body).arrayBuffer();
          const mime = sourceRow.cover_file_type || srcObj.httpMetadata?.contentType || "image/jpeg";
          await env.VAULT_FILES.put(newCoverKey, bytes, {
            httpMetadata: { contentType: mime },
            customMetadata: { ownerId: identity.id, tripId: newTripId, uploadedBy: identity.id },
          });
          await patchRows(
            `travel_trips?id=eq.${encodeURIComponent(newTripId)}`,
            {
              cover_file_key: newCoverKey,
              cover_file_name: safeName,
              cover_file_size: bytes.byteLength || Number(sourceRow.cover_file_size) || 0,
              cover_file_type: mime,
              updated_at: new Date().toISOString(),
            },
            env,
          );
        }
      } catch (coverCopyErr) {
        console.warn("Duplicate trip cover copy warning:", coverCopyErr?.message || coverCopyErr);
      }
    }

    if (sourceWs.destinations.length > 0) {
      await insertRows(
        "trip_destinations",
        sourceWs.destinations.map((d, idx) => ({
          trip_id: newTripId,
          latitude: d.latitude,
          longitude: d.longitude,
          order_index: idx,
        })),
        env,
      );
    }

    const travellersToInsert = [
      buildTravellerInsertRow(newTripId, {
        user_id: identity.id,
        full_name: ownerName,
        email: String(identity.email || ""),
        role: "owner",
        is_owner: true,
        invite_status: "active",
        sort_order: 0,
      }),
      ...sourceWs.travellers
        .filter((t) => !t.isOwner && t.userId !== identity.id)
        .map((t, idx) =>
          buildTravellerInsertRow(newTripId, {
            full_name: t.fullName,
            email: t.email,
            phone: t.phone,
            role: t.role === "owner" ? "editor" : t.role,
            is_owner: false,
            responsibility: t.responsibility,
            emergency_contact_name: t.emergencyContactName,
            emergency_contact_phone: t.emergencyContactPhone,
            invite_status: "pending",
            sort_order: idx + 1,
          }),
        ),
    ];
    await insertRows("travel_trip_travellers", travellersToInsert, env);

    if (sourceWs.categories.length > 0) {
      await insertRows(
        "travel_trip_budget_categories",
        sourceWs.categories.map((c, idx) => ({
          trip_id: newTripId,
          name: c.name,
          allocated_amount: c.allocatedAmount,
          color: c.color,
          is_default: c.isDefault,
          sort_order: idx,
        })),
        env,
      );
    }

    if (sourceWs.items.length > 0) {
      await insertRows(
        "travel_trip_items",
        sourceWs.items.map((item, idx) => ({
          trip_id: newTripId,
          title: item.title,
          description: item.description || "",
          status: "todo",
          priority: item.priority || "normal",
          due_date: item.dueDate || null,
          scheduled_date: item.scheduledDate || null,
          start_time: item.startTime || null,
          end_time: item.endTime || null,
          location: item.location || "",
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          estimated_cost: item.estimatedCost ?? null,
          notes: item.notes || "",
          kanban_sort_order: idx,
          day_sort_order: item.daySortOrder ?? idx,
          created_by: identity.id,
        })),
        env,
      );
    }
  } catch (err) {
    await deleteRows(`travel_trips?id=eq.${encodeURIComponent(newTripId)}`, env).catch(() => {});
    throw err;
  }

  return loadHydratedTripWorkspace(newTripId, identity.id, env);
}

async function handleCreateTrip(identity, body, env) {
  if (body?.id && isUuid(body.id)) {
    const existing = await listRows(
      `travel_trips?id=eq.${encodeURIComponent(body.id)}&owner_id=eq.${encodeURIComponent(identity.id)}&select=id&limit=1`,
      env,
    );
    if (existing.length > 0) {
      return loadHydratedTripWorkspace(body.id, identity.id, env);
    }
  }

  const parsed = sanitizeTripInput(body, { partial: false });
  const currency = parsed.primaryCurrency;

  // Build initial travellers list (creator is always Owner #1).
  // Every element in `travellersToCreate` MUST share the exact same key set so
  // PostgREST bulk insert never rejects with PGRST102 ("All object keys must match").
  const rawTravellers = Array.isArray(body.travellers) ? body.travellers : [];
  const ownerName =
    String(body.ownerName || identity.full_name || identity.email || "Me").trim().slice(0, 120) || "Me";
  const ownerEmailLower = String(identity.email || "").trim().toLowerCase();

  // Verify any referenced contact_id / family_item_id exist in cloud DB for this user
  // (protects against local/unsynced contact UUIDs causing 23503 FK errors).
  const candidateContactIds = rawTravellers.map((tr) => tr?.contactId).filter(isUuid);
  const candidateFamilyIds = rawTravellers.map((tr) => tr?.familyItemId).filter(isUuid);
  const [validContactIds, validFamilyIds] = await Promise.all([
    resolveOwnedRecordIds("contacts", identity.id, candidateContactIds, env),
    resolveOwnedRecordIds("vault_items", identity.id, candidateFamilyIds, env),
  ]);

  const travellersDraft = [
    {
      user_id: identity.id,
      contact_id: null,
      family_item_id: null,
      full_name: ownerName,
      email: String(identity.email || ""),
      phone: "",
      role: "owner",
      is_owner: true,
      responsibility: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      invite_status: "active",
      sort_order: 0,
    },
  ];

  if (parsed.companionType !== "solo") {
    for (let i = 0; i < rawTravellers.length && travellersDraft.length < 200; i += 1) {
      const tr = rawTravellers[i];
      if (!tr || typeof tr !== "object" || tr.isOwner) continue;
      const name = String(tr.fullName || tr.name || "").trim().slice(0, 120);
      if (!name) continue;
      const email = String(tr.email || "").trim().slice(0, 160);
      let resolvedUserId = isUuid(tr.userId) ? tr.userId : null;
      if (!resolvedUserId && email && email.includes("@")) {
        const matchedProfiles = await listRows(
          `profiles?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`,
          env,
        ).catch(() => []);
        if (matchedProfiles.length > 0 && isUuid(matchedProfiles[0].id)) {
          resolvedUserId = matchedProfiles[0].id;
        }
      }
      // Skip duplicate entry if the creator inadvertently added themselves again
      if (
        (resolvedUserId && resolvedUserId === identity.id) ||
        (ownerEmailLower && email.toLowerCase() === ownerEmailLower)
      ) {
        continue;
      }

      const role = TRAVELLER_ROLES.includes(tr.role) && tr.role !== "owner" ? tr.role : "editor";
      travellersDraft.push({
        user_id: resolvedUserId,
        contact_id: isUuid(tr.contactId) && validContactIds.has(tr.contactId) ? tr.contactId : null,
        family_item_id: isUuid(tr.familyItemId) && validFamilyIds.has(tr.familyItemId) ? tr.familyItemId : null,
        full_name: name,
        email,
        phone: String(tr.phone || "").trim().slice(0, 40),
        role,
        is_owner: false,
        responsibility: String(tr.responsibility || "").trim().slice(0, 120),
        emergency_contact_name: String(tr.emergencyContactName || "").trim().slice(0, 120),
        emergency_contact_phone: String(tr.emergencyContactPhone || "").trim().slice(0, 40),
        invite_status: "active",
        sort_order: travellersDraft.length,
      });
    }
    // Auto-populate placeholder companions if user specified travelerCount > travellersDraft.length
    while (travellersDraft.length < parsed.travelerCount && travellersDraft.length < 50) {
      const idx = travellersDraft.length + 1;
      travellersDraft.push({
        user_id: null,
        contact_id: null,
        family_item_id: null,
        full_name: `Traveller ${idx}`,
        email: "",
        phone: "",
        role: "viewer",
        is_owner: false,
        responsibility: "",
        emergency_contact_name: "",
        emergency_contact_phone: "",
        invite_status: "active",
        sort_order: travellersDraft.length,
      });
    }
  }

  // Validate group contributions & planned budget BEFORE inserting
  const rawContributions = Array.isArray(body.contributions) ? body.contributions : [];
  let plannedBudgetMinor = parsed.personalBudgetMinor;
  if (parsed.budgetScope === "group") {
    const contribSummary = computeContributionSummary(rawContributions, currency);
    plannedBudgetMinor = contribSummary.totalPlannedMinor;
  } else if (parsed.budgetScope === "none") {
    plannedBudgetMinor = 0;
  }

  const sanitizedCats = sanitizeBudgetCategories(body.categories, plannedBudgetMinor, currency);
  const sanitizedInitialTasks = sanitizeInitialTasks(body.initialTasks, {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  });

  // Insert Trip
  const tripPayload = {
    ...(body?.id && isUuid(body.id) ? { id: body.id } : {}),
    owner_id: identity.id,
    title: parsed.title,
    description: parsed.description,
    start_date: parsed.startDate,
    end_date: parsed.endDate,
    companion_type: parsed.companionType,
    traveler_count: Math.max(parsed.travelerCount, travellersDraft.length),
    trip_type: parsed.tripType,
    status: "planning",
    primary_currency: currency,
    budget_scope: parsed.budgetScope,
    personal_budget: parsed.personalBudget,
  };
  const createdTrips = await insertRows("travel_trips", tripPayload, env);
  const createdTrip = createdTrips[0];
  const tripId = createdTrip.id;

  try {
    // Coordinate-only map destinations (Section 20: strictly id, trip_id, latitude, longitude, order_index)
    if (Array.isArray(parsed.destinations) && parsed.destinations.length > 0) {
      await insertRows(
        "trip_destinations",
        parsed.destinations.map((d, idx) => ({
          trip_id: tripId,
          latitude: d.latitude,
          longitude: d.longitude,
          order_index: idx,
        })),
        env,
      );
    }

    // Travellers (strictly uniform object keys via buildTravellerInsertRow)
    const insertedTravellers = await insertRows(
      "travel_trip_travellers",
      travellersDraft.map((tr, idx) => buildTravellerInsertRow(tripId, { ...tr, sort_order: idx })),
      env,
    );

    // Budget Categories
    if (sanitizedCats.categories.length > 0) {
      await insertRows(
        "travel_trip_budget_categories",
        sanitizedCats.categories.map((c, idx) => ({
          trip_id: tripId,
          name: c.name,
          allocated_amount: c.allocatedAmount,
          color: c.color,
          is_default: c.isDefault,
          sort_order: idx,
        })),
        env,
      );
    }

    // Group Contributions
    if (parsed.budgetScope === "group" && insertedTravellers.length > 0) {
      const contribRowsToInsert = insertedTravellers.map((tr, idx) => {
        const match =
          rawContributions[idx] ||
          rawContributions.find(
            (rc) =>
              rc &&
              typeof rc.fullName === "string" &&
              rc.fullName.trim().toLowerCase() === tr.full_name.toLowerCase(),
          ) ||
          {};
        const summary = computeContributionSummary([match], currency).rows[0];
        return {
          trip_id: tripId,
          traveller_id: tr.id,
          planned_amount: summary.plannedAmount,
          contributed_amount: summary.contributedAmount,
          status: summary.status,
          contributed_on: match.contributedOn && isValidDate(match.contributedOn) ? match.contributedOn : null,
          note: String(match.note || "").trim().slice(0, 300),
        };
      });
      await insertRows("travel_trip_contributions", contribRowsToInsert, env);
    }

    // Initial Tasks (unified travel_trip_items)
    if (sanitizedInitialTasks.length > 0) {
      const validTasks = sanitizedInitialTasks.map((task, idx) => {
        const assignee =
          task.assigneeIndex !== null && task.assigneeIndex >= 0 && insertedTravellers[task.assigneeIndex]
            ? insertedTravellers[task.assigneeIndex].id
            : task.assignedTravellerId && insertedTravellers.some((t) => t.id === task.assignedTravellerId)
              ? task.assignedTravellerId
              : null;
        return {
          trip_id: tripId,
          title: task.title,
          description: task.description,
          status: "todo",
          priority: task.priority,
          due_date: task.dueDate,
          scheduled_date: task.scheduledDate,
          kanban_sort_order: idx,
          assignee_traveller_id: assignee,
          created_by: identity.id,
        };
      });
      await insertRows("travel_trip_items", validTasks, env);
    }
  } catch (err) {
    await deleteRows(`travel_trips?id=eq.${encodeURIComponent(tripId)}`, env).catch(() => {});
    throw err;
  }

  return loadHydratedTripWorkspace(tripId, identity.id, env);
}

// ---------------------------------------------------------------------------
// Map Destination Search & Road-Following OSRM Routing (Configurable + Cached)
// ---------------------------------------------------------------------------

async function handleMapSearch(url, env) {
  const query = String(url.searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return { results: [], degraded: false };
  }
  const normalizedKey = query.toLowerCase().slice(0, 140);
  const cached = cacheGet(GEOCODE_CACHE, normalizedKey, GEOCODE_CACHE_TTL_MS);
  if (cached) return cached;

  const curated = searchCuratedDestinations(query)
    .filter((c) => isValidCoordinatePair(c.latitude, c.longitude))
    .map((c, idx) => ({
      id: `curated-${idx}-${c.latitude}-${c.longitude}`,
      label: c.name,
      subtitle: [c.city !== c.name ? c.city : "", c.country].filter(Boolean).join(", "),
      latitude: roundCoordinate(c.latitude),
      longitude: roundCoordinate(c.longitude),
      source: "curated",
    }));

  const geocoderBase = String(
    env?.TRAVEL_GEOCODING_URL || "https://nominatim.openstreetmap.org/search",
  ).trim();
  if (env?.TRAVEL_DISABLE_EXTERNAL_MAP === "true" || !geocoderBase) {
    const localOnly = { results: curated, degraded: false };
    cacheSet(GEOCODE_CACHE, normalizedKey, localOnly);
    return localOnly;
  }

  // Respect public Nominatim usage policy: minimum spacing + descriptive User-Agent + result caching
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < 950 && curated.length >= 3) {
    return { results: curated, degraded: false };
  }

  try {
    lastNominatimCallAt = Date.now();
    const searchUrl = new URL(geocoderBase);
    searchUrl.searchParams.set("q", query.slice(0, 140));
    searchUrl.searchParams.set("format", "jsonv2");
    searchUrl.searchParams.set("limit", "7");
    searchUrl.searchParams.set("addressdetails", "1");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(searchUrl.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Accept-Language": "en",
          "User-Agent": String(env?.TRAVEL_GEOCODING_USER_AGENT || "PersoraTravelSpace/1.0 (+https://persora.pages.dev)"),
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Geocoder returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const remoteItems = (Array.isArray(payload) ? payload : [])
      .map((item, idx) => {
        const lat = Number(item?.lat);
        const lng = Number(item?.lon);
        if (!isValidCoordinatePair(lat, lng)) return null;
        const displayName = String(item?.display_name || item?.name || "").trim();
        const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
        const label = String(item?.name || parts[0] || formatCoordinatePair(lat, lng)).trim();
        const subtitle = parts.slice(1, 4).join(", ");
        return {
          id: `osm-${item?.place_id || idx}-${roundCoordinate(lat)}-${roundCoordinate(lng)}`,
          label,
          subtitle,
          latitude: roundCoordinate(lat),
          longitude: roundCoordinate(lng),
          source: "nominatim",
        };
      })
      .filter(Boolean);

    const dedup = [];
    const seenCoords = new Set();
    for (const entry of [...remoteItems, ...curated]) {
      const coordKey = `${entry.latitude.toFixed(3)},${entry.longitude.toFixed(3)}`;
      if (seenCoords.has(coordKey)) continue;
      seenCoords.add(coordKey);
      dedup.push(entry);
      if (dedup.length >= 8) break;
    }

    const out = { results: dedup, degraded: false };
    cacheSet(GEOCODE_CACHE, normalizedKey, out);
    return out;
  } catch (err) {
    console.warn("TravelSpace geocoding provider warning:", err?.message || "request failed");
    if (curated.length > 0) {
      return {
        results: curated,
        degraded: true,
        warning: "Live place search is temporarily unavailable; showing built-in destinations.",
      };
    }
    throw new TravelSpaceError(
      "Destination search service is temporarily unavailable. Enter coordinates, paste a Google Maps URL, or click directly on the map.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }
}

async function fetchOsrmRoute(baseUrl, profile, coordParam) {
  const cleanBase = String(baseUrl || "").replace(/\/$/, "");
  const routeUrl = `${cleanBase}/route/v1/${profile}/${coordParam}?overview=full&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(routeUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PersoraTravelSpace/1.0 (+https://persora.pages.dev)",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const first = Array.isArray(data?.routes) ? data.routes[0] : null;
    const rawCoords = first?.geometry?.coordinates;
    if (!first || !Array.isArray(rawCoords) || rawCoords.length < 2) return null;
    const geometry = rawCoords
      .map((pair) =>
        Array.isArray(pair) && isValidCoordinatePair(pair[1], pair[0])
          ? [roundCoordinate(pair[1]), roundCoordinate(pair[0])]
          : null,
      )
      .filter(Boolean);
    if (geometry.length < 2) return null;
    const legs = Array.isArray(first.legs)
      ? first.legs.map((leg) => ({
          distanceMeters: Number.isFinite(Number(leg?.distance)) ? Math.round(Number(leg.distance)) : null,
          durationSeconds: Number.isFinite(Number(leg?.duration)) ? Math.round(Number(leg.duration)) : null,
        }))
      : [];
    return {
      geometry,
      distanceMeters: Number.isFinite(Number(first.distance)) ? Math.round(Number(first.distance)) : null,
      durationSeconds: Number.isFinite(Number(first.duration)) ? Math.round(Number(first.duration)) : null,
      legs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleMapRoute(body, env) {
  const mode = ["driving", "walking", "cycling"].includes(body?.mode) ? body.mode : "driving";
  const rawPoints = Array.isArray(body?.coordinates) ? body.coordinates : [];
  const points = rawPoints
    .map((p) =>
      p && isValidCoordinatePair(p.latitude, p.longitude)
        ? { latitude: roundCoordinate(p.latitude), longitude: roundCoordinate(p.longitude) }
        : null,
    )
    .filter(Boolean);

  if (points.length < 2) {
    return {
      ok: true,
      mode,
      isFallback: false,
      geometry: points.map((p) => [p.latitude, p.longitude]),
      legs: [],
      distanceMeters: null,
      durationSeconds: null,
    };
  }
  if (points.length > 25) {
    throw new TravelSpaceError("Road routing supports up to 25 stops at once.", 400, "VALIDATION_ERROR");
  }

  const coordParam = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const cacheKey = `${mode}:${coordParam}`;
  const cached = cacheGet(ROUTE_CACHE, cacheKey, ROUTE_CACHE_TTL_MS);
  if (cached) return cached;

  if (env?.TRAVEL_DISABLE_EXTERNAL_MAP !== "true") {
    const candidates =
      mode === "walking"
        ? [
            { base: env?.TRAVEL_OSRM_WALKING_URL || env?.TRAVEL_OSRM_BASE_URL || "https://routing.openstreetmap.de/routed-foot", profile: "driving" },
            { base: env?.TRAVEL_OSRM_BASE_URL || "https://router.project-osrm.org", profile: "foot" },
          ]
        : mode === "cycling"
          ? [
              { base: env?.TRAVEL_OSRM_CYCLING_URL || env?.TRAVEL_OSRM_BASE_URL || "https://routing.openstreetmap.de/routed-bike", profile: "driving" },
              { base: env?.TRAVEL_OSRM_BASE_URL || "https://router.project-osrm.org", profile: "bike" },
            ]
          : [
              { base: env?.TRAVEL_OSRM_DRIVING_URL || env?.TRAVEL_OSRM_BASE_URL || "https://routing.openstreetmap.de/routed-car", profile: "driving" },
              { base: env?.TRAVEL_OSRM_BASE_URL || "https://router.project-osrm.org", profile: "driving" },
            ];

    for (const candidate of candidates) {
      const routed = await fetchOsrmRoute(candidate.base, candidate.profile, coordParam);
      if (routed) {
        const result = {
          ok: true,
          mode,
          isFallback: false,
          fallbackReason: null,
          geometry: routed.geometry,
          legs: routed.legs,
          distanceMeters: routed.distanceMeters,
          durationSeconds: routed.durationSeconds,
        };
        cacheSet(ROUTE_CACHE, cacheKey, result, 200);
        return result;
      }
    }
  }

  // Straight-line fallback: NEVER invent road geometry, distance, or duration
  return {
    ok: true,
    mode,
    isFallback: true,
    fallbackReason:
      "Road route is unavailable between these stops (water crossing or routing service unreachable). Showing straight-line preview.",
    geometry: points.map((p) => [p.latitude, p.longitude]),
    legs: [],
    distanceMeters: null,
    durationSeconds: null,
  };
}

// ---------------------------------------------------------------------------
// Main Request Router
// ---------------------------------------------------------------------------

export async function handleTravelSpace(request, identity, env, origin, uploadQuota = null) {
  if (!identity || !identity.id) {
    return json(
      { error: "Sign in to access TravelSpace.", code: "AUTH_REQUIRED" },
      401,
      origin,
    );
  }

  const url = new URL(request.url);
  // Strip leading /api when forwarded from Cloudflare Pages Functions (functions/api/[[path]].js -> cloudflare/api.js)
  let pathname = url.pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    pathname = pathname.slice(4) || "/";
  }
  const sub = pathname.startsWith(TRAVEL_SPACE_ROUTE_PREFIX)
    ? pathname.slice(TRAVEL_SPACE_ROUTE_PREFIX.length).replace(/\/+$/, "") || "/"
    : "/";
  const method = request.method.toUpperCase();

  try {
    // GET /travel-space/bootstrap
    if (sub === "/bootstrap" && method === "GET") {
      return json(await handleBootstrap(identity, env), 200, origin);
    }

    // GET /travel-space/map/search?q=...
    if (sub === "/map/search" && method === "GET") {
      return json(await handleMapSearch(url, env), 200, origin);
    }

    // POST /travel-space/map/route
    if (sub === "/map/route" && method === "POST") {
      const body = await readJson(request);
      return json(await handleMapRoute(body, env), 200, origin);
    }

    // POST /travel-space/trips
    if (sub === "/trips" && method === "POST") {
      const body = await readJson(request);
      const workspace = await handleCreateTrip(identity, body, env);
      return json(workspace, 201, origin);
    }

    // Explore Places routes
    if (sub === "/explore" && method === "POST") {
      const body = await readJson(request);
      const name = String(body.name || "").trim();
      if (!name || name.length > 140) throw new TravelSpaceError("Enter a destination or place name (1–140 chars).", 400);
      const hasCoords =
        body.latitude !== undefined &&
        body.latitude !== null &&
        body.latitude !== "" &&
        body.longitude !== undefined &&
        body.longitude !== null &&
        body.longitude !== "" &&
        isValidCoordinatePair(body.latitude, body.longitude);
      const rows = await insertRows(
        "travel_explore_places",
        {
          user_id: identity.id,
          name,
          kind: EXPLORE_KINDS.includes(body.kind) ? body.kind : "destination",
          country: String(body.country || "").trim().slice(0, 80),
          city: String(body.city || "").trim().slice(0, 80),
          status: EXPLORE_STATUSES.includes(body.status) ? body.status : "want_to_visit",
          trip_id: isUuid(body.tripId) ? body.tripId : null,
          estimated_cost:
            body.estimatedCost !== undefined && body.estimatedCost !== null && body.estimatedCost !== ""
              ? Math.max(0, Number(body.estimatedCost) || 0)
              : null,
          currency: normalizeCurrency(body.currency, "BDT"),
          reference_url: String(body.referenceUrl || "").trim().slice(0, 1000),
          linked_url_item_id: isUuid(body.linkedUrlItemId) ? body.linkedUrlItemId : null,
          latitude: hasCoords ? roundCoordinate(body.latitude) : null,
          longitude: hasCoords ? roundCoordinate(body.longitude) : null,
          notes: String(body.notes || "").trim().slice(0, 1000),
          favorite: Boolean(body.favorite),
        },
        env,
      );
      return json({ place: mapExploreRow(rows[0]) }, 201, origin);
    }

    const exploreMatch = sub.match(/^\/explore\/([0-9a-f-]+)(?:\/(add-to-trip|add-to-itinerary))?$/i);
    if (exploreMatch) {
      const placeId = exploreMatch[1];
      const action = exploreMatch[2];
      if (!isUuid(placeId)) throw new TravelSpaceError("Saved place not found.", 404);
      const existing = await listRows(
        `travel_explore_places?id=eq.${encodeURIComponent(placeId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=*&limit=1`,
        env,
      );
      if (!existing.length) throw new TravelSpaceError("Saved place not found.", 404);
      const place = existing[0];

      if ((action === "add-to-trip" || action === "add-to-itinerary") && method === "POST") {
        const body = await readJson(request);
        const { trip, role } = await resolveTripAccess(body.tripId, identity.id, env);
        const target =
          action === "add-to-itinerary"
            ? "itinerary"
            : body.target === "destination"
              ? "destination"
              : body.target === "itinerary"
                ? "itinerary"
                : body.scheduledDate
                  ? "itinerary"
                  : "destination";

        let lat =
          body.latitude !== undefined && body.latitude !== null && body.latitude !== ""
            ? Number(body.latitude)
            : place.latitude !== null && place.latitude !== undefined
              ? Number(place.latitude)
              : NaN;
        let lng =
          body.longitude !== undefined && body.longitude !== null && body.longitude !== ""
            ? Number(body.longitude)
            : place.longitude !== null && place.longitude !== undefined
              ? Number(place.longitude)
              : NaN;

        if (!isValidCoordinatePair(lat, lng)) {
          const curatedHit = searchCuratedDestinations(place.name || place.city || "")[0];
          if (curatedHit && isValidCoordinatePair(curatedHit.latitude, curatedHit.longitude)) {
            lat = curatedHit.latitude;
            lng = curatedHit.longitude;
          }
        }

        if (target === "destination") {
          requireRole(role, "edit_trip");
          if (!isValidCoordinatePair(lat, lng)) {
            throw new TravelSpaceError(
              "Select map coordinates for this place before adding it as a trip destination stop.",
              400,
              "VALIDATION_ERROR",
            );
          }
          const existingStops = await listRows(
            `trip_destinations?trip_id=eq.${encodeURIComponent(trip.id)}&select=id,order_index&order=order_index.asc`,
            env,
          );
          const createdStops = await insertRows(
            "trip_destinations",
            {
              trip_id: trip.id,
              latitude: roundCoordinate(lat),
              longitude: roundCoordinate(lng),
              order_index: existingStops.length,
            },
            env,
          );
          await patchRows(
            `travel_explore_places?id=eq.${encodeURIComponent(placeId)}&user_id=eq.${encodeURIComponent(identity.id)}`,
            { status: "planned", trip_id: trip.id, updated_at: new Date().toISOString() },
            env,
          );
          return json({ destination: mapDestinationRow(createdStops[0]) }, 201, origin);
        }

        requireRole(role, "edit_itinerary");
        const scheduledDate =
          body.scheduledDate && isValidDate(body.scheduledDate) ? body.scheduledDate : isoDateOut(trip.start_date);
        const createdItems = await insertRows(
          "travel_trip_items",
          {
            trip_id: trip.id,
            title: place.name,
            description: place.notes || "",
            status: "todo",
            priority: "normal",
            scheduled_date: scheduledDate,
            location: [place.city, place.country].filter(Boolean).join(", ") || place.name,
            latitude: isValidCoordinatePair(lat, lng) ? roundCoordinate(lat) : null,
            longitude: isValidCoordinatePair(lat, lng) ? roundCoordinate(lng) : null,
            estimated_cost: place.estimated_cost,
            notes: place.reference_url ? `Ref: ${place.reference_url}` : "",
            created_by: identity.id,
          },
          env,
        );
        await patchRows(
          `travel_explore_places?id=eq.${encodeURIComponent(placeId)}&user_id=eq.${encodeURIComponent(identity.id)}`,
          { status: "planned", trip_id: trip.id, updated_at: new Date().toISOString() },
          env,
        );
        return json({ item: mapItemRow(createdItems[0]) }, 201, origin);
      }

      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.name !== undefined) {
          const nm = String(body.name || "").trim();
          if (!nm || nm.length > 140) throw new TravelSpaceError("Enter a valid place name.", 400);
          patch.name = nm;
        }
        if (body.kind !== undefined && EXPLORE_KINDS.includes(body.kind)) patch.kind = body.kind;
        if (body.country !== undefined) patch.country = String(body.country || "").trim().slice(0, 80);
        if (body.city !== undefined) patch.city = String(body.city || "").trim().slice(0, 80);
        if (body.status !== undefined && EXPLORE_STATUSES.includes(body.status)) patch.status = body.status;
        if (body.tripId !== undefined) patch.trip_id = isUuid(body.tripId) ? body.tripId : null;
        if (body.estimatedCost !== undefined) {
          patch.estimated_cost =
            body.estimatedCost === null || body.estimatedCost === "" ? null : Math.max(0, Number(body.estimatedCost) || 0);
        }
        if (body.currency !== undefined) patch.currency = normalizeCurrency(body.currency, "BDT");
        if (body.referenceUrl !== undefined) patch.reference_url = String(body.referenceUrl || "").trim().slice(0, 1000);
        if (body.linkedUrlItemId !== undefined) {
          patch.linked_url_item_id = isUuid(body.linkedUrlItemId) ? body.linkedUrlItemId : null;
        }
        if (body.latitude !== undefined || body.longitude !== undefined) {
          if (body.latitude === null || body.longitude === null || body.latitude === "" || body.longitude === "") {
            patch.latitude = null;
            patch.longitude = null;
          } else if (isValidCoordinatePair(body.latitude, body.longitude)) {
            patch.latitude = roundCoordinate(body.latitude);
            patch.longitude = roundCoordinate(body.longitude);
          }
        }
        if (body.notes !== undefined) patch.notes = String(body.notes || "").trim().slice(0, 1000);
        if (body.favorite !== undefined) patch.favorite = Boolean(body.favorite);
        const updated = await patchRows(
          `travel_explore_places?id=eq.${encodeURIComponent(placeId)}&user_id=eq.${encodeURIComponent(identity.id)}`,
          patch,
          env,
        );
        return json({ place: mapExploreRow(updated[0]) }, 200, origin);
      }

      if (method === "DELETE") {
        await deleteRows(
          `travel_explore_places?id=eq.${encodeURIComponent(placeId)}&user_id=eq.${encodeURIComponent(identity.id)}`,
          env,
        );
        return json({ ok: true }, 200, origin);
      }
    }

    // Trip-scoped routes: /trips/:tripId/...
    const tripMatch = sub.match(/^\/trips\/([0-9a-f-]+)(?:\/(.*))?$/i);
    if (!tripMatch) {
      throw new TravelSpaceError("TravelSpace endpoint not found.", 404, "ENDPOINT_NOT_FOUND");
    }

    const tripId = tripMatch[1];
    const rest = tripMatch[2] || "";

    // GET /trips/:tripId
    if (!rest && method === "GET") {
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    // PUT /trips/:tripId/destinations -> Replace ordered coordinate-only destinations
    if (rest === "destinations" && method === "PUT") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_trip");
      const body = await readJson(request);
      const dests = sanitizeTripDestinations(body?.destinations || []);
      await deleteRows(`trip_destinations?trip_id=eq.${encodeURIComponent(tripId)}`, env);
      if (dests.length > 0) {
        await insertRows(
          "trip_destinations",
          dests.map((d, idx) => ({
            trip_id: tripId,
            latitude: d.latitude,
            longitude: d.longitude,
            order_index: idx,
          })),
          env,
        );
      }
      await patchRows(
        `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
        { updated_at: new Date().toISOString() },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    // PATCH /trips/:tripId
    if (!rest && method === "PATCH") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_trip");
      const body = await readJson(request);
      const merged = sanitizeTripInput(
        {
          title: body.title ?? trip.title,
          description: body.description ?? trip.description,
          startDate: body.startDate ?? trip.start_date,
          endDate: body.endDate ?? trip.end_date,
          companionType: body.companionType ?? trip.companion_type,
          travelerCount: body.travelerCount ?? trip.traveler_count,
          tripType: body.tripType === undefined ? trip.trip_type : body.tripType,
          status: body.status ?? trip.status,
          primaryCurrency: body.primaryCurrency ?? trip.primary_currency,
          budgetScope: body.budgetScope ?? trip.budget_scope,
          personalBudget: body.personalBudget ?? trip.personal_budget,
          destinations: body.destinations,
        },
        { partial: true },
      );

      const patch = {
        title: merged.title,
        description: merged.description,
        start_date: merged.startDate,
        end_date: merged.endDate,
        companion_type: merged.companionType,
        traveler_count: merged.travelerCount,
        trip_type: merged.tripType,
        status: TRIP_STATUSES.includes(body.status) ? body.status : trip.status,
        primary_currency: merged.primaryCurrency,
        budget_scope: merged.budgetScope,
        personal_budget: merged.personalBudget,
        updated_at: new Date().toISOString(),
      };
      await patchRows(`travel_trips?id=eq.${encodeURIComponent(tripId)}`, patch, env);

      if (Array.isArray(body.destinations)) {
        const dests = sanitizeTripDestinations(body.destinations);
        await deleteRows(`trip_destinations?trip_id=eq.${encodeURIComponent(tripId)}`, env);
        if (dests.length > 0) {
          await insertRows(
            "trip_destinations",
            dests.map((d, idx) => ({
              trip_id: tripId,
              latitude: d.latitude,
              longitude: d.longitude,
              order_index: idx,
            })),
            env,
          );
        }
      }

      if (Array.isArray(body.categories) || Array.isArray(body.contributions)) {
        const rawContribs = Array.isArray(body.contributions) ? body.contributions : [];
        const contribSummary = computeContributionSummary(rawContribs, merged.primaryCurrency);
        const plannedMinor =
          merged.budgetScope === "group"
            ? contribSummary.totalPlannedMinor
            : merged.budgetScope === "personal"
              ? merged.personalBudgetMinor
              : 0;
        if (Array.isArray(body.categories)) {
          const sanitizedCats = sanitizeBudgetCategories(body.categories, plannedMinor, merged.primaryCurrency);
          await syncTripBudgetCategories(tripId, sanitizedCats.categories, env);
        }
        if (Array.isArray(body.contributions)) {
          await deleteRows(`travel_trip_contributions?trip_id=eq.${encodeURIComponent(tripId)}`, env);
          const validRows = contribSummary.rows
            .filter((r) => isUuid(r.travellerId))
            .map((r) => ({
              trip_id: tripId,
              traveller_id: r.travellerId,
              planned_amount: r.plannedAmount,
              contributed_amount: r.contributedAmount,
              status: r.status,
              contributed_on: r.contributedOn && isValidDate(r.contributedOn) ? r.contributedOn : null,
              note: String(r.note || "").trim().slice(0, 300),
            }));
          if (validRows.length > 0) {
            await insertRows("travel_trip_contributions", validRows, env);
          }
        }
      }

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    // POST /trips/:tripId/duplicate -> Duplicate trip (with independent R2 cover copy)
    if (rest === "duplicate" && method === "POST") {
      return json(await handleDuplicateTrip(tripId, identity, env), 201, origin);
    }

    // DELETE /trips/:tripId -> Soft-delete to 7-day Trash (Owner only)
    if (!rest && method === "DELETE") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "delete_trip");
      const trash = await rpc("persora_travel_trip_trash_move", { p_owner: identity.id, p_id: tripId }, env);
      return json({ ok: true, trash }, 200, origin);
    }

    // PUT /trips/:tripId/budget -> Budget scope, personalBudget, categories, contributions
    if (rest === "budget" && method === "PUT") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_budget");
      const body = await readJson(request);
      const currency = trip.primary_currency || "BDT";
      let budgetScope = ["none", "personal", "group"].includes(body.budgetScope)
        ? body.budgetScope
        : trip.budget_scope;
      if (trip.companion_type === "solo" && budgetScope === "group") {
        budgetScope = "personal";
      }

      const personalBudgetMinor =
        budgetScope === "personal" ? Math.max(0, toMinor(body.personalBudget ?? trip.personal_budget ?? 0, currency)) : 0;

      const rawContribs = Array.isArray(body.contributions) ? body.contributions : [];
      const contribSummary = computeContributionSummary(rawContribs, currency);
      const plannedMinor =
        budgetScope === "group"
          ? contribSummary.totalPlannedMinor
          : budgetScope === "personal"
            ? personalBudgetMinor
            : 0;

      const sanitizedCats = sanitizeBudgetCategories(body.categories, plannedMinor, currency);

      await patchRows(
        `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
        {
          budget_scope: budgetScope,
          personal_budget: fromMinor(personalBudgetMinor, currency),
          updated_at: new Date().toISOString(),
        },
        env,
      );

      if (Array.isArray(body.categories)) {
        await syncTripBudgetCategories(tripId, sanitizedCats.categories, env);
      }

      if (Array.isArray(body.contributions)) {
        await deleteRows(`travel_trip_contributions?trip_id=eq.${encodeURIComponent(tripId)}`, env);
        const validRows = contribSummary.rows
          .filter((r) => isUuid(r.travellerId))
          .map((r) => ({
            trip_id: tripId,
            traveller_id: r.travellerId,
            planned_amount: r.plannedAmount,
            contributed_amount: r.contributedAmount,
            status: r.status,
            contributed_on: r.contributedOn && isValidDate(r.contributedOn) ? r.contributedOn : null,
            note: String(r.note || "").trim().slice(0, 300),
          }));
        if (validRows.length > 0) {
          await insertRows("travel_trip_contributions", validRows, env);
        }
      }

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    // Unified Tasks & Itinerary Items (/items, /items/reorder, /items/:id)
    if (rest === "items" && method === "POST") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_itinerary");
      const body = await readJson(request);
      const title = String(body.title || "").trim();
      if (!title || title.length > 180) throw new TravelSpaceError("Enter a task or activity title (1–180 chars).", 400);
      if (body.startTime && !isValidTime(body.startTime)) throw new TravelSpaceError("Invalid start time (HH:MM).", 400);
      if (body.endTime && !isValidTime(body.endTime)) throw new TravelSpaceError("Invalid end time (HH:MM).", 400);
      if (body.startTime && body.endTime && body.endTime < body.startTime) {
        throw new TravelSpaceError("Activity end time cannot be earlier than start time.", 400);
      }

      await insertRows(
        "travel_trip_items",
        {
          trip_id: tripId,
          title,
          description: String(body.description || "").trim().slice(0, 1500),
          status: TASK_STATUSES.includes(body.status) ? body.status : "todo",
          priority: TASK_PRIORITIES.includes(body.priority) ? body.priority : "normal",
          due_date: body.dueDate && isValidDate(body.dueDate) ? body.dueDate : null,
          scheduled_date: body.scheduledDate && isValidDate(body.scheduledDate) ? body.scheduledDate : null,
          start_time: body.scheduledDate && body.startTime ? body.startTime : null,
          end_time: body.scheduledDate && body.endTime ? body.endTime : null,
          location: String(body.location || "").trim().slice(0, 200),
          latitude: Number.isFinite(Number(body.latitude)) && body.latitude !== "" && body.latitude !== null ? Number(body.latitude) : null,
          longitude: Number.isFinite(Number(body.longitude)) && body.longitude !== "" && body.longitude !== null ? Number(body.longitude) : null,
          day_sort_order: Number(body.daySortOrder || 0),
          kanban_sort_order: Number(body.kanbanSortOrder || 0),
          assignee_traveller_id: isUuid(body.assigneeTravellerId) ? body.assigneeTravellerId : null,
          booking_id: isUuid(body.bookingId) ? body.bookingId : null,
          estimated_cost:
            body.estimatedCost !== undefined && body.estimatedCost !== null && body.estimatedCost !== ""
              ? Math.max(0, Number(body.estimatedCost) || 0)
              : null,
          notes: String(body.notes || "").trim().slice(0, 1500),
          linked_vault_note_id: isUuid(body.linkedVaultNoteId) ? body.linkedVaultNoteId : null,
          synced_calendar_event_id: isUuid(body.syncedCalendarEventId) ? body.syncedCalendarEventId : null,
          created_by: identity.id,
        },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    if (rest === "items/reorder" && method === "POST") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_itinerary");
      const body = await readJson(request);
      const updates = Array.isArray(body.updates) ? body.updates : [];
      for (const u of updates.slice(0, 150)) {
        if (!u || !isUuid(u.id)) continue;
        const patch = { updated_at: new Date().toISOString() };
        if (u.status !== undefined && TASK_STATUSES.includes(u.status)) patch.status = u.status;
        if (u.scheduledDate !== undefined) {
          patch.scheduled_date = u.scheduledDate && isValidDate(u.scheduledDate) ? u.scheduledDate : null;
          if (!patch.scheduled_date) {
            patch.start_time = null;
            patch.end_time = null;
          }
        }
        if (u.daySortOrder !== undefined) patch.day_sort_order = Number(u.daySortOrder) || 0;
        if (u.kanbanSortOrder !== undefined) patch.kanban_sort_order = Number(u.kanbanSortOrder) || 0;
        await patchRows(
          `travel_trip_items?id=eq.${encodeURIComponent(u.id)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
      }
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    const itemMatch = rest.match(/^items\/([0-9a-f-]+)$/i);
    if (itemMatch) {
      const itemId = itemMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_itinerary");
      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) {
          const t = String(body.title || "").trim();
          if (!t || t.length > 180) throw new TravelSpaceError("Enter a valid title.", 400);
          patch.title = t;
        }
        if (body.description !== undefined) patch.description = String(body.description || "").trim().slice(0, 1500);
        if (body.status !== undefined && TASK_STATUSES.includes(body.status)) patch.status = body.status;
        if (body.priority !== undefined && TASK_PRIORITIES.includes(body.priority)) patch.priority = body.priority;
        if (body.dueDate !== undefined) patch.due_date = body.dueDate && isValidDate(body.dueDate) ? body.dueDate : null;
        if (body.scheduledDate !== undefined) {
          patch.scheduled_date = body.scheduledDate && isValidDate(body.scheduledDate) ? body.scheduledDate : null;
          if (!patch.scheduled_date) {
            patch.start_time = null;
            patch.end_time = null;
          }
        }
        if (body.startTime !== undefined) {
          if (body.startTime && !isValidTime(body.startTime)) throw new TravelSpaceError("Invalid start time.", 400);
          patch.start_time = body.startTime || null;
        }
        if (body.endTime !== undefined) {
          if (body.endTime && !isValidTime(body.endTime)) throw new TravelSpaceError("Invalid end time.", 400);
          patch.end_time = body.endTime || null;
        }
        if (body.location !== undefined) patch.location = String(body.location || "").trim().slice(0, 200);
        if (body.latitude !== undefined) {
          patch.latitude = body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
        }
        if (body.longitude !== undefined) {
          patch.longitude = body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
        }
        if (body.daySortOrder !== undefined) patch.day_sort_order = Number(body.daySortOrder) || 0;
        if (body.kanbanSortOrder !== undefined) patch.kanban_sort_order = Number(body.kanbanSortOrder) || 0;
        if (body.assigneeTravellerId !== undefined) {
          patch.assignee_traveller_id = isUuid(body.assigneeTravellerId) ? body.assigneeTravellerId : null;
        }
        if (body.bookingId !== undefined) patch.booking_id = isUuid(body.bookingId) ? body.bookingId : null;
        if (body.estimatedCost !== undefined) {
          patch.estimated_cost =
            body.estimatedCost === null || body.estimatedCost === "" ? null : Math.max(0, Number(body.estimatedCost) || 0);
        }
        if (body.notes !== undefined) patch.notes = String(body.notes || "").trim().slice(0, 1500);
        if (body.linkedVaultNoteId !== undefined) {
          patch.linked_vault_note_id = isUuid(body.linkedVaultNoteId) ? body.linkedVaultNoteId : null;
        }
        if (body.syncedCalendarEventId !== undefined) {
          patch.synced_calendar_event_id = isUuid(body.syncedCalendarEventId) ? body.syncedCalendarEventId : null;
        }
        await patchRows(
          `travel_trip_items?id=eq.${encodeURIComponent(itemId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_items?id=eq.${encodeURIComponent(itemId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Expenses (/expenses, /expenses/:id)
    if (rest === "expenses" && method === "POST") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "create_expense");
      const body = await readJson(request);
      const travRows = await listRows(
        `travel_trip_travellers?trip_id=eq.${encodeURIComponent(tripId)}&select=id`,
        env,
      );
      const mappedTrip = mapTripRow(trip, role);
      const parsed = normalizeExpenseInput(
        body,
        mappedTrip,
        travRows.map((t) => t.id),
      );
      const created = await insertRows(
        "travel_trip_expenses",
        {
          trip_id: tripId,
          title: parsed.title,
          amount: parsed.amount,
          currency: parsed.currency,
          trip_amount: parsed.tripAmount,
          exchange_rate: parsed.exchangeRate,
          converted_on: parsed.convertedOn,
          expense_date: parsed.expenseDate,
          category_id: isUuid(parsed.categoryId) ? parsed.categoryId : null,
          category_name: parsed.categoryName,
          expense_type: parsed.expenseType,
          paid_by_traveller_id: parsed.paidByTravellerId,
          paid_from_group_fund: parsed.paidFromGroupFund,
          split_method: parsed.splitMethod,
          payment_method: parsed.paymentMethod,
          linked_finance_item_id: isUuid(body.linkedFinanceItemId) ? body.linkedFinanceItemId : null,
          notes: parsed.notes,
          created_by: identity.id,
        },
        env,
      );
      const expRow = created[0];
      if (parsed.splits.length > 0) {
        await insertRows(
          "travel_trip_expense_splits",
          parsed.splits.map((s) => ({
            expense_id: expRow.id,
            trip_id: tripId,
            traveller_id: s.travellerId,
            share_amount: s.shareAmount,
            trip_share_amount: s.tripShareAmount,
          })),
          env,
        );
      }
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const expMatch = rest.match(/^expenses\/([0-9a-f-]+)$/i);
    if (expMatch) {
      const expenseId = expMatch[1];
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      const existingRows = await listRows(
        `travel_trip_expenses?id=eq.${encodeURIComponent(expenseId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
        env,
      );
      if (!existingRows.length) throw new TravelSpaceError("Expense not found.", 404);
      const existing = existingRows[0];
      if (role === "expense_contributor") {
        if (existing.created_by !== identity.id) {
          throw new TravelSpaceError("Expense contributors can only modify expenses they recorded.", 403);
        }
      } else {
        requireRole(role, "edit_expense");
      }

      if (method === "PATCH") {
        const body = await readJson(request);
        const travRows = await listRows(
          `travel_trip_travellers?trip_id=eq.${encodeURIComponent(tripId)}&select=id`,
          env,
        );
        const mappedTrip = mapTripRow(trip, role);
        const parsed = normalizeExpenseInput(
          body,
          mappedTrip,
          travRows.map((t) => t.id),
        );
        await patchRows(
          `travel_trip_expenses?id=eq.${encodeURIComponent(expenseId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          {
            title: parsed.title,
            amount: parsed.amount,
            currency: parsed.currency,
            trip_amount: parsed.tripAmount,
            exchange_rate: parsed.exchangeRate,
            converted_on: parsed.convertedOn,
            expense_date: parsed.expenseDate,
            category_id: isUuid(parsed.categoryId) ? parsed.categoryId : null,
            category_name: parsed.categoryName,
            expense_type: parsed.expenseType,
            paid_by_traveller_id: parsed.paidByTravellerId,
            paid_from_group_fund: parsed.paidFromGroupFund,
            split_method: parsed.splitMethod,
            payment_method: parsed.paymentMethod,
            linked_finance_item_id:
              body.linkedFinanceItemId === undefined
                ? existing.linked_finance_item_id
                : isUuid(body.linkedFinanceItemId)
                  ? body.linkedFinanceItemId
                  : null,
            notes: parsed.notes,
            updated_at: new Date().toISOString(),
          },
          env,
        );
        await deleteRows(`travel_trip_expense_splits?expense_id=eq.${encodeURIComponent(expenseId)}`, env);
        if (parsed.splits.length > 0) {
          await insertRows(
            "travel_trip_expense_splits",
            parsed.splits.map((s) => ({
              expense_id: expenseId,
              trip_id: tripId,
              traveller_id: s.travellerId,
              share_amount: s.shareAmount,
              trip_share_amount: s.tripShareAmount,
            })),
            env,
          );
        }
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }

      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_expenses?id=eq.${encodeURIComponent(expenseId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Settlements (/settlements, /settlements/:id)
    if (rest === "settlements" && method === "POST") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_settlements");
      const body = await readJson(request);
      if (!isUuid(body.fromTravellerId) || !isUuid(body.toTravellerId) || body.fromTravellerId === body.toTravellerId) {
        throw new TravelSpaceError("Choose distinct payer and recipient travellers for a settlement.", 400);
      }
      const currency = trip.primary_currency || "BDT";
      const amtMinor = toMinor(body.amount, currency);
      if (amtMinor <= 0) throw new TravelSpaceError("Settlement amount must be greater than zero.", 400);
      const settledOn = body.settledOn && isValidDate(body.settledOn) ? body.settledOn : new Date().toISOString().slice(0, 10);
      await insertRows(
        "travel_trip_settlements",
        {
          trip_id: tripId,
          from_traveller_id: body.fromTravellerId,
          to_traveller_id: body.toTravellerId,
          amount: fromMinor(amtMinor, currency),
          currency,
          status: body.status === "pending" ? "pending" : "completed",
          settled_on: settledOn,
          method: String(body.method || "").trim().slice(0, 60),
          note: String(body.note || "").trim().slice(0, 300),
          created_by: identity.id,
        },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const settleMatch = rest.match(/^settlements\/([0-9a-f-]+)$/i);
    if (settleMatch) {
      const settlementId = settleMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_settlements");
      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.status === "pending" || body.status === "completed") patch.status = body.status;
        if (body.note !== undefined) patch.note = String(body.note || "").trim().slice(0, 300);
        await patchRows(
          `travel_trip_settlements?id=eq.${encodeURIComponent(settlementId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_settlements?id=eq.${encodeURIComponent(settlementId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Bookings (/bookings, /bookings/:id)
    if (rest === "bookings" && method === "POST") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_bookings");
      const body = await readJson(request);
      const title = String(body.title || "").trim();
      if (!title || title.length > 160) throw new TravelSpaceError("Enter a booking title (1–160 chars).", 400);
      await insertRows(
        "travel_trip_bookings",
        {
          trip_id: tripId,
          category: BOOKING_CATEGORIES.includes(body.category) ? body.category : "other",
          title,
          provider: String(body.provider || "").trim().slice(0, 120),
          booking_reference: String(body.bookingReference || "").trim().slice(0, 80),
          booking_date: body.bookingDate && isValidDate(body.bookingDate) ? body.bookingDate : null,
          start_date: body.startDate && isValidDate(body.startDate) ? body.startDate : null,
          end_date: body.endDate && isValidDate(body.endDate) ? body.endDate : null,
          start_at_text: String(body.startAtText || "").trim().slice(0, 60),
          end_at_text: String(body.endAtText || "").trim().slice(0, 60),
          location: String(body.location || "").trim().slice(0, 200),
          price: body.price !== undefined && body.price !== null && body.price !== "" ? Math.max(0, Number(body.price) || 0) : null,
          currency: normalizeCurrency(body.currency, trip.primary_currency || "BDT"),
          payment_status: PAYMENT_STATUSES.includes(body.paymentStatus) ? body.paymentStatus : "unpaid",
          booking_status: BOOKING_STATUSES.includes(body.bookingStatus) ? body.bookingStatus : "confirmed",
          traveller_ids: Array.isArray(body.travellerIds) ? body.travellerIds.filter(isUuid) : [],
          membership_item_id: isUuid(body.membershipItemId) ? body.membershipItemId : null,
          contact_details: String(body.contactDetails || "").trim().slice(0, 300),
          notes: String(body.notes || "").trim().slice(0, 1000),
          created_by: identity.id,
        },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const bookingMatch = rest.match(/^bookings\/([0-9a-f-]+)$/i);
    if (bookingMatch) {
      const bookingId = bookingMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_bookings");
      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) {
          const t = String(body.title || "").trim();
          if (!t || t.length > 160) throw new TravelSpaceError("Enter a valid booking title.", 400);
          patch.title = t;
        }
        if (body.category !== undefined && BOOKING_CATEGORIES.includes(body.category)) patch.category = body.category;
        if (body.provider !== undefined) patch.provider = String(body.provider || "").trim().slice(0, 120);
        if (body.bookingReference !== undefined) patch.booking_reference = String(body.bookingReference || "").trim().slice(0, 80);
        if (body.bookingDate !== undefined) patch.booking_date = body.bookingDate && isValidDate(body.bookingDate) ? body.bookingDate : null;
        if (body.startDate !== undefined) patch.start_date = body.startDate && isValidDate(body.startDate) ? body.startDate : null;
        if (body.endDate !== undefined) patch.end_date = body.endDate && isValidDate(body.endDate) ? body.endDate : null;
        if (body.startAtText !== undefined) patch.start_at_text = String(body.startAtText || "").trim().slice(0, 60);
        if (body.endAtText !== undefined) patch.end_at_text = String(body.endAtText || "").trim().slice(0, 60);
        if (body.location !== undefined) patch.location = String(body.location || "").trim().slice(0, 200);
        if (body.price !== undefined) {
          patch.price = body.price === null || body.price === "" ? null : Math.max(0, Number(body.price) || 0);
        }
        if (body.currency !== undefined) patch.currency = normalizeCurrency(body.currency, "BDT");
        if (body.paymentStatus !== undefined && PAYMENT_STATUSES.includes(body.paymentStatus)) patch.payment_status = body.paymentStatus;
        if (body.bookingStatus !== undefined && BOOKING_STATUSES.includes(body.bookingStatus)) patch.booking_status = body.bookingStatus;
        if (body.travellerIds !== undefined && Array.isArray(body.travellerIds)) patch.traveller_ids = body.travellerIds.filter(isUuid);
        if (body.membershipItemId !== undefined) patch.membership_item_id = isUuid(body.membershipItemId) ? body.membershipItemId : null;
        if (body.contactDetails !== undefined) patch.contact_details = String(body.contactDetails || "").trim().slice(0, 300);
        if (body.notes !== undefined) patch.notes = String(body.notes || "").trim().slice(0, 1000);
        if (body.refundAmount !== undefined) {
          patch.refund_amount = body.refundAmount === null || body.refundAmount === "" ? null : Math.max(0, Number(body.refundAmount) || 0);
        }
        if (body.cancellationNote !== undefined) patch.cancellation_note = String(body.cancellationNote || "").trim().slice(0, 500);
        await patchRows(
          `travel_trip_bookings?id=eq.${encodeURIComponent(bookingId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_bookings?id=eq.${encodeURIComponent(bookingId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Travellers & Roles (/travellers, /travellers/:id)
    if (rest === "travellers" && method === "POST") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_travellers");
      const body = await readJson(request);
      let resolvedUserId = isUuid(body.userId) ? body.userId : null;
      let resolvedName = String(body.fullName || "").trim();
      let resolvedEmail = String(body.email || "").trim().slice(0, 160);

      // Optional Persora member lookup by email or login_id
      if (!resolvedUserId && body.memberQuery) {
        const q = String(body.memberQuery).trim();
        const isLoginId = /^\d{7}$/.test(q);
        const found = await listRows(
          isLoginId
            ? `profiles?login_id=eq.${encodeURIComponent(q)}&select=id,full_name,email&limit=1`
            : `profiles?email=ilike.${encodeURIComponent(q)}&select=id,full_name,email&limit=1`,
          env,
        );
        if (!found.length) {
          throw new TravelSpaceError("No active Persora member matched that email or Persora ID.", 404);
        }
        resolvedUserId = found[0].id;
        if (!resolvedName) resolvedName = found[0].full_name || found[0].email;
        if (!resolvedEmail) resolvedEmail = found[0].email || "";
      }

      if (!resolvedName || resolvedName.length > 120) {
        throw new TravelSpaceError("Enter the traveller's name (1–120 characters).", 400);
      }
      const assignedRole =
        role === "owner" && TRAVELLER_ROLES.includes(body.role) && body.role !== "owner"
          ? body.role
          : "viewer";

      const [validContactIds, validFamilyIds, currentTravsBefore] = await Promise.all([
        resolveOwnedRecordIds("contacts", identity.id, [body.contactId], env),
        resolveOwnedRecordIds("vault_items", identity.id, [body.familyItemId], env),
        listRows(`travel_trip_travellers?trip_id=eq.${encodeURIComponent(tripId)}&select=id`, env),
      ]);

      await insertRows(
        "travel_trip_travellers",
        buildTravellerInsertRow(tripId, {
          user_id: resolvedUserId,
          contact_id: isUuid(body.contactId) && validContactIds.has(body.contactId) ? body.contactId : null,
          family_item_id: isUuid(body.familyItemId) && validFamilyIds.has(body.familyItemId) ? body.familyItemId : null,
          full_name: resolvedName,
          email: resolvedEmail,
          phone: body.phone,
          role: assignedRole,
          is_owner: false,
          responsibility: body.responsibility,
          emergency_contact_name: body.emergencyContactName,
          emergency_contact_phone: body.emergencyContactPhone,
          invite_status: "active",
          sort_order: currentTravsBefore.length,
        }),
        env,
      );

      // Keep traveler_count synced upward if needed
      const nextCount = currentTravsBefore.length + 1;
      if (nextCount > Number(trip.traveler_count || 1)) {
        await patchRows(
          `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
          {
            traveler_count: nextCount,
            companion_type: trip.companion_type === "solo" ? "friends" : trip.companion_type,
            updated_at: new Date().toISOString(),
          },
          env,
        );
      }

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const travMatch = rest.match(/^travellers\/([0-9a-f-]+)$/i);
    if (travMatch) {
      const travellerId = travMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_travellers");
      const targetRows = await listRows(
        `travel_trip_travellers?id=eq.${encodeURIComponent(travellerId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
        env,
      );
      if (!targetRows.length) throw new TravelSpaceError("Traveller not found.", 404);
      const target = targetRows[0];

      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.fullName !== undefined) {
          const nm = String(body.fullName || "").trim();
          if (!nm || nm.length > 120) throw new TravelSpaceError("Enter a valid traveller name.", 400);
          patch.full_name = nm;
        }
        if (body.email !== undefined) patch.email = String(body.email || "").trim().slice(0, 160);
        if (body.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 40);
        if (body.responsibility !== undefined) patch.responsibility = String(body.responsibility || "").trim().slice(0, 120);
        if (body.emergencyContactName !== undefined) {
          patch.emergency_contact_name = String(body.emergencyContactName || "").trim().slice(0, 120);
        }
        if (body.emergencyContactPhone !== undefined) {
          patch.emergency_contact_phone = String(body.emergencyContactPhone || "").trim().slice(0, 40);
        }
        if (body.role !== undefined && body.role !== target.role) {
          requireRole(role, "manage_roles");
          if (target.is_owner) {
            throw new TravelSpaceError("The trip creator always remains the Owner.", 400);
          }
          if (!TRAVELLER_ROLES.includes(body.role) || body.role === "owner") {
            throw new TravelSpaceError("Choose a valid member role (editor, expense_contributor, or viewer).", 400);
          }
          patch.role = body.role;
        }
        await patchRows(
          `travel_trip_travellers?id=eq.${encodeURIComponent(travellerId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }

      if (method === "DELETE") {
        if (target.is_owner) {
          throw new TravelSpaceError("The trip owner cannot be removed from the trip.", 400);
        }
        requireRole(role, "manage_roles");
        await deleteRows(
          `travel_trip_travellers?id=eq.${encodeURIComponent(travellerId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Documents (/documents, /documents/:id)
    if (rest === "documents" && method === "POST") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_documents");
      const body = await readJson(request);
      const title = String(body.title || "").trim();
      if (!title || title.length > 160) throw new TravelSpaceError("Enter a document title (1–160 chars).", 400);
      const sourceType = body.sourceType === "vault_item" && isUuid(body.linkedVaultItemId) ? "vault_item" : "upload";
      await insertRows(
        "travel_trip_documents",
        {
          trip_id: tripId,
          title,
          doc_category: DOCUMENT_CATEGORIES.includes(body.docCategory) ? body.docCategory : "other",
          source_type: sourceType,
          linked_vault_item_id: sourceType === "vault_item" ? body.linkedVaultItemId : null,
          traveller_id: isUuid(body.travellerId) ? body.travellerId : null,
          booking_id: isUuid(body.bookingId) ? body.bookingId : null,
          activity_id: isUuid(body.activityId) ? body.activityId : null,
          document_number: String(body.documentNumber || "").trim().slice(0, 80),
          expiry_date: body.expiryDate && isValidDate(body.expiryDate) ? body.expiryDate : null,
          reminder_days_before:
            body.reminderDaysBefore !== undefined && body.reminderDaysBefore !== null && body.reminderDaysBefore !== ""
              ? Math.max(0, Math.trunc(Number(body.reminderDaysBefore) || 0))
              : null,
          is_private: Boolean(body.isPrivate),
          notes: String(body.notes || "").trim().slice(0, 1000),
          created_by: identity.id,
        },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const docMatch = rest.match(/^documents\/([0-9a-f-]+)$/i);
    if (docMatch) {
      const docId = docMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_documents");
      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_documents?id=eq.${encodeURIComponent(docId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) patch.title = String(body.title || "").trim().slice(0, 160);
        if (body.docCategory !== undefined && DOCUMENT_CATEGORIES.includes(body.docCategory)) patch.doc_category = body.docCategory;
        if (body.travellerId !== undefined) patch.traveller_id = isUuid(body.travellerId) ? body.travellerId : null;
        if (body.bookingId !== undefined) patch.booking_id = isUuid(body.bookingId) ? body.bookingId : null;
        if (body.activityId !== undefined) patch.activity_id = isUuid(body.activityId) ? body.activityId : null;
        if (body.documentNumber !== undefined) patch.document_number = String(body.documentNumber || "").trim().slice(0, 80);
        if (body.expiryDate !== undefined) patch.expiry_date = body.expiryDate && isValidDate(body.expiryDate) ? body.expiryDate : null;
        if (body.isPrivate !== undefined) patch.is_private = Boolean(body.isPrivate);
        if (body.notes !== undefined) patch.notes = String(body.notes || "").trim().slice(0, 1000);
        await patchRows(
          `travel_trip_documents?id=eq.${encodeURIComponent(docId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Memories & Travel Journal (/memories, /memories/:id)
    if (rest === "memories" && method === "POST") {
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_memories");
      const body = await readJson(request);
      const title = String(body.title || "").trim();
      if (!title || title.length > 160) throw new TravelSpaceError("Enter a memory or journal title (1–160 chars).", 400);
      const memoryType = MEMORY_TYPES.includes(body.memoryType) ? body.memoryType : "journal";
      const sourceType = ["upload", "photo_studio", "audio_space", "vault_item", "journal"].includes(body.sourceType)
        ? body.sourceType
        : memoryType === "journal"
          ? "journal"
          : "upload";
      await insertRows(
        "travel_trip_memories",
        {
          trip_id: tripId,
          memory_type: memoryType,
          title,
          caption: String(body.caption || "").trim().slice(0, 600),
          journal_body: String(body.journalBody || "").trim().slice(0, 12000),
          memory_date: body.memoryDate && isValidDate(body.memoryDate) ? body.memoryDate : null,
          day_number: body.dayNumber ? Math.max(1, Math.trunc(Number(body.dayNumber) || 1)) : null,
          location: String(body.location || "").trim().slice(0, 160),
          favorite: Boolean(body.favorite),
          source_type: sourceType,
          linked_photo_id: isUuid(body.linkedPhotoId) ? body.linkedPhotoId : null,
          linked_audio_id: isUuid(body.linkedAudioId) ? body.linkedAudioId : null,
          linked_vault_item_id: isUuid(body.linkedVaultItemId) ? body.linkedVaultItemId : null,
          created_by: identity.id,
        },
        env,
      );
      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 201, origin);
    }

    const memMatch = rest.match(/^memories\/([0-9a-f-]+)$/i);
    if (memMatch) {
      const memoryId = memMatch[1];
      const { role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_memories");
      if (method === "PATCH") {
        const body = await readJson(request);
        const patch = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) patch.title = String(body.title || "").trim().slice(0, 160);
        if (body.caption !== undefined) patch.caption = String(body.caption || "").trim().slice(0, 600);
        if (body.journalBody !== undefined) patch.journal_body = String(body.journalBody || "").trim().slice(0, 12000);
        if (body.memoryDate !== undefined) patch.memory_date = body.memoryDate && isValidDate(body.memoryDate) ? body.memoryDate : null;
        if (body.location !== undefined) patch.location = String(body.location || "").trim().slice(0, 160);
        if (body.favorite !== undefined) patch.favorite = Boolean(body.favorite);
        await patchRows(
          `travel_trip_memories?id=eq.${encodeURIComponent(memoryId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          patch,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
      if (method === "DELETE") {
        await deleteRows(
          `travel_trip_memories?id=eq.${encodeURIComponent(memoryId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
          env,
        );
        return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
      }
    }

    // Complete Trip Flow (/complete) + Life Timeline Integration
    if (rest === "complete" && method === "POST") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "complete_trip");
      const body = await readJson(request);

      const actualReturnDate =
        body.actualReturnDate && isValidDate(body.actualReturnDate)
          ? body.actualReturnDate
          : trip.end_date;
      const rating =
        body.rating !== undefined && body.rating !== null && body.rating !== ""
          ? Math.min(5, Math.max(1, Math.trunc(Number(body.rating) || 5)))
          : null;
      const completionNotes = String(body.completionNotes || "").trim().slice(0, 3000);

      // Optional booking status updates submitted in Step 3
      if (Array.isArray(body.bookingUpdates)) {
        for (const bu of body.bookingUpdates.slice(0, 100)) {
          if (!bu || !isUuid(bu.id)) continue;
          const bPatch = { updated_at: new Date().toISOString() };
          if (BOOKING_STATUSES.includes(bu.bookingStatus)) bPatch.booking_status = bu.bookingStatus;
          if (bu.refundAmount !== undefined) {
            bPatch.refund_amount = bu.refundAmount === null || bu.refundAmount === "" ? null : Math.max(0, Number(bu.refundAmount) || 0);
          }
          if (bu.cancellationNote !== undefined) {
            bPatch.cancellation_note = String(bu.cancellationNote || "").trim().slice(0, 500);
          }
          await patchRows(
            `travel_trip_bookings?id=eq.${encodeURIComponent(bu.id)}&trip_id=eq.${encodeURIComponent(tripId)}`,
            bPatch,
            env,
          );
        }
      }

      // Compute final snapshot
      const hydrated = await loadHydratedTripWorkspace(tripId, identity.id, env);
      const destNames = hydrated.destinations
        .map((d, idx) => `Stop ${idx + 1} (${formatCoordinatePair(d.latitude, d.longitude)})`)
        .join(" → ");
      const summarySnapshot = {
        completedAt: new Date().toISOString(),
        destinations: destNames,
        destinationCount: hydrated.destinations.length,
        startDate: hydrated.trip.startDate,
        actualReturnDate,
        durationDays: tripDurationDays(hydrated.trip.startDate, actualReturnDate),
        travellerCount: hydrated.travellers.length,
        activitiesCompleted: hydrated.items.filter((i) => i.status === "done").length,
        activitiesTotal: hydrated.items.length,
        totalPlannedBudget: hydrated.budgetOverview.totalPlannedBudget,
        totalExpenses: hydrated.budgetOverview.totalExpenses,
        personalExpenses: hydrated.budgetOverview.personalExpenses,
        sharedExpenses: hydrated.budgetOverview.sharedExpenses,
        currency: hydrated.trip.primaryCurrency,
        unsettledCount: hydrated.budgetOverview.suggestedSettlements.length,
        photosAndMemoriesCount: hydrated.memories.length,
      };

      // Add or update linked Persora Life Timeline milestone (encrypted via timeline service)
      let timelineEventId = trip.timeline_event_id || null;
      if (body.createTimelineEvent !== false && env.TIMELINE_ENCRYPTION_KEY && identity.id === trip.owner_id) {
        try {
          const tlTitle = `Completed Trip: ${hydrated.trip.title}`;
          const tlDesc = [
            destNames ? `Destinations: ${destNames}` : "",
            `Dates: ${hydrated.trip.startDate} to ${actualReturnDate} (${summarySnapshot.durationDays} days)`,
            `Travellers: ${hydrated.travellers.length}`,
            completionNotes ? `Notes: ${completionNotes}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const tlReq = new Request("https://persora.internal/timeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: timelineEventId || undefined,
              eventDate: isoDateOut(actualReturnDate),
              title: tlTitle.slice(0, 180),
              description: tlDesc.slice(0, 3500),
              url: `${origin || "https://persora.pages.dev"}/?view=travel-space&trip=${tripId}`,
              linkedRecordIds: [],
            }),
          });
          const tlRes = await handleTimeline(tlReq, identity, env, origin);
          if (tlRes.ok) {
            const tlJson = await tlRes.json();
            if (tlJson?.id) timelineEventId = tlJson.id;
            else if (tlJson?.event?.id) timelineEventId = tlJson.event.id;
          }
        } catch (tlErr) {
          console.warn("Life Timeline milestone sync warning:", tlErr?.message || tlErr);
        }
      }

      await patchRows(
        `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
        {
          status: "completed",
          actual_return_date: actualReturnDate,
          rating,
          completion_notes: completionNotes,
          summary_snapshot: summarySnapshot,
          timeline_event_id: timelineEventId,
          updated_at: new Date().toISOString(),
        },
        env,
      );

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    // Private R2 File Upload (/upload), Cover Removal (DELETE /files/cover), & Authorized Streaming (/files/:kind/:targetId)
    if (rest === "upload" && method === "POST") {
      if (!env.VAULT_FILES) throw new TravelSpaceError("Private file storage is not configured.", 503);
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      const form = await request.formData();
      const kind = String(form.get("kind") || "");
      const targetId = String(form.get("targetId") || "");
      const file = form.get("file");

      if (!(file instanceof File) || file.size <= 0) {
        throw new TravelSpaceError("Choose a non-empty file to upload.", 400);
      }

      const mime = String(file.type || "application/octet-stream").toLowerCase();
      if (kind === "cover") {
        if (!ALLOWED_COVER_IMAGE_TYPES.has(mime)) {
          throw new TravelSpaceError("Upload a JPG, PNG, WebP, or GIF image for the trip cover.", 400, "INVALID_IMAGE_TYPE");
        }
        const coverMaxMb = Math.min(MAX_COVER_IMAGE_MB, Number(uploadQuota?.maxUploadMb) || MAX_COVER_IMAGE_MB);
        const coverMaxBytes = coverMaxMb * 1024 * 1024;
        if (file.size > coverMaxBytes) {
          throw new TravelSpaceError(`Trip cover image must be ${coverMaxMb} MB or smaller.`, 413, "FILE_TOO_LARGE");
        }
      } else {
        const maxBytes = Math.min(150, Number(uploadQuota?.maxUploadMb) || 25) * 1024 * 1024;
        if (file.size > maxBytes) {
          throw new TravelSpaceError(`File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`, 413, "FILE_TOO_LARGE");
        }
        if (!ALLOWED_UPLOAD_TYPES.has(mime)) {
          throw new TravelSpaceError("Upload a JPG, PNG, WebP, GIF image, or PDF document.", 400, "INVALID_FILE_TYPE");
        }
      }

      if (kind === "expense_receipt") {
        if (role !== "owner" && role !== "editor" && role !== "expense_contributor") {
          throw new TravelSpaceError("You do not have permission to upload receipts.", 403);
        }
      } else {
        requireRole(role, "edit_trip");
      }

      if (typeof uploadQuota?.storageUsage === "function") {
        const usage = await uploadQuota.storageUsage(trip.owner_id, env.VAULT_FILES, env);
        const limitBytes = Number(usage?.storageLimitBytes || 0);
        const usedBytes = Number(usage?.bytesUsed || 0);
        if (Number.isFinite(limitBytes) && limitBytes > 0 && usedBytes + file.size > limitBytes) {
          throw new TravelSpaceError("This upload exceeds your available Persora storage quota.", 413, "STORAGE_QUOTA_EXCEEDED");
        }
      }

      const previousCoverKey = kind === "cover" ? (trip.cover_file_key || null) : null;
      const safeName = String(file.name || (kind === "cover" ? "cover.jpg" : "attachment"))
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .slice(0, 100);
      const key = `${trip.owner_id}/travel-space/${tripId}/${crypto.randomUUID()}-${safeName}`;
      const bytes = await file.arrayBuffer();
      await env.VAULT_FILES.put(key, bytes, {
        httpMetadata: { contentType: mime },
        customMetadata: { ownerId: trip.owner_id, tripId, uploadedBy: identity.id },
      });

      try {
        if (kind === "cover") {
          await patchRows(
            `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
            {
              cover_file_key: key,
              cover_file_name: safeName,
              cover_file_size: file.size,
              cover_file_type: mime,
              updated_at: new Date().toISOString(),
            },
            env,
          );
        } else if (kind === "booking" && isUuid(targetId)) {
          await patchRows(
            `travel_trip_bookings?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
            { attachment_file_key: key, attachment_file_name: safeName, attachment_file_size: file.size, attachment_file_type: mime },
            env,
          );
        } else if (kind === "expense_receipt" && isUuid(targetId)) {
          await patchRows(
            `travel_trip_expenses?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
            { receipt_file_key: key, receipt_file_name: safeName, receipt_file_size: file.size, receipt_file_type: mime },
            env,
          );
        } else if (kind === "document" && isUuid(targetId)) {
          await patchRows(
            `travel_trip_documents?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
            { file_key: key, file_name: safeName, file_size: file.size, file_type: mime, source_type: "upload" },
            env,
          );
        } else if (kind === "memory" && isUuid(targetId)) {
          await patchRows(
            `travel_trip_memories?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}`,
            { file_key: key, file_name: safeName, file_size: file.size, file_type: mime, source_type: "upload" },
            env,
          );
        } else {
          throw new TravelSpaceError("Specify a valid attachment target.", 400);
        }
      } catch (err) {
        await env.VAULT_FILES.delete(key).catch(() => {});
        throw err;
      }

      // Only AFTER the new database reference is saved successfully, safely remove
      // the replaced cover object if no other trip or trash item references it.
      if (previousCoverKey && previousCoverKey !== key) {
        await deleteCoverObjectIfUnreferenced(previousCoverKey, env);
      }

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    if (rest === "files/cover" && method === "DELETE") {
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);
      requireRole(role, "edit_trip");
      const previousCoverKey = trip.cover_file_key || null;

      await patchRows(
        `travel_trips?id=eq.${encodeURIComponent(tripId)}`,
        {
          cover_file_key: null,
          cover_file_name: null,
          cover_file_size: null,
          cover_file_type: null,
          updated_at: new Date().toISOString(),
        },
        env,
      );

      if (previousCoverKey) {
        await deleteCoverObjectIfUnreferenced(previousCoverKey, env);
      }

      return json(await loadHydratedTripWorkspace(tripId, identity.id, env), 200, origin);
    }

    const fileMatch = rest.match(/^files\/(cover|booking|expense_receipt|document|memory)(?:\/([0-9a-f-]+))?$/i);
    if (fileMatch && method === "GET") {
      if (!env.VAULT_FILES) throw new TravelSpaceError("Private file storage is not configured.", 503);
      const kind = fileMatch[1];
      const targetId = fileMatch[2];
      const { trip, role } = await resolveTripAccess(tripId, identity.id, env);

      let key = null;
      let fileName = "file";
      let contentType = "application/octet-stream";

      if (kind === "cover") {
        key = trip.cover_file_key;
        fileName = trip.cover_file_name || "cover";
        contentType = trip.cover_file_type || contentType;
      } else if (kind === "booking" && isUuid(targetId)) {
        const rows = await listRows(
          `travel_trip_bookings?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
          env,
        );
        key = rows[0]?.attachment_file_key;
        fileName = rows[0]?.attachment_file_name || "booking";
        contentType = rows[0]?.attachment_file_type || contentType;
      } else if (kind === "expense_receipt" && isUuid(targetId)) {
        const rows = await listRows(
          `travel_trip_expenses?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
          env,
        );
        key = rows[0]?.receipt_file_key;
        fileName = rows[0]?.receipt_file_name || "receipt";
        contentType = rows[0]?.receipt_file_type || contentType;
      } else if (kind === "document" && isUuid(targetId)) {
        const rows = await listRows(
          `travel_trip_documents?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
          env,
        );
        const doc = rows[0];
        if (doc?.is_private && role !== "owner" && doc.created_by !== identity.id) {
          throw new TravelSpaceError("This private document is restricted.", 403);
        }
        if (doc?.source_type === "vault_item" && doc.linked_vault_item_id) {
          const vRows = await listRows(
            `vault_items?id=eq.${encodeURIComponent(doc.linked_vault_item_id)}&select=file_key,file_name,file_type&limit=1`,
            env,
          );
          key = vRows[0]?.file_key;
          fileName = vRows[0]?.file_name || doc.title;
          contentType = vRows[0]?.file_type || contentType;
        } else {
          key = doc?.file_key;
          fileName = doc?.file_name || doc?.title || "document";
          contentType = doc?.file_type || contentType;
        }
      } else if (kind === "memory" && isUuid(targetId)) {
        const rows = await listRows(
          `travel_trip_memories?id=eq.${encodeURIComponent(targetId)}&trip_id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,
          env,
        );
        const mem = rows[0];
        if (mem?.source_type === "photo_studio" && mem.linked_photo_id) {
          const pRows = await listRows(
            `photo_studio_photos?id=eq.${encodeURIComponent(mem.linked_photo_id)}&select=file_key,file_name,file_type&limit=1`,
            env,
          );
          key = pRows[0]?.file_key;
          fileName = pRows[0]?.file_name || mem.title;
          contentType = pRows[0]?.file_type || contentType;
        } else if (mem?.source_type === "audio_space" && mem.linked_audio_id) {
          const aRows = await listRows(
            `audio_space_items?id=eq.${encodeURIComponent(mem.linked_audio_id)}&select=file_key,file_name,file_type&limit=1`,
            env,
          );
          key = aRows[0]?.file_key;
          fileName = aRows[0]?.file_name || mem.title;
          contentType = aRows[0]?.file_type || contentType;
        } else {
          key = mem?.file_key;
          fileName = mem?.file_name || mem?.title || "memory";
          contentType = mem?.file_type || contentType;
        }
      }

      if (!key) throw new TravelSpaceError("Attached file not found.", 404);
      if (kind === "cover" && !String(key).startsWith(`${trip.owner_id}/travel-space/`)) {
        throw new TravelSpaceError("Attached file not found.", 404);
      }
      const obj = await env.VAULT_FILES.get(key);
      if (!obj) throw new TravelSpaceError("Stored file could not be found.", 404);

      const resolvedType = obj.httpMetadata?.contentType || contentType;
      const safeType = ALLOWED_UPLOAD_TYPES.has(String(resolvedType).toLowerCase())
        ? String(resolvedType).toLowerCase()
        : "application/octet-stream";

      return new Response(obj.body, {
        status: 200,
        headers: headersFor(origin, {
          "Content-Type": safeType,
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="${String(fileName).replace(/["\r\n]/g, "")}"`,
          "X-Content-Type-Options": "nosniff",
        }),
      });
    }

    throw new TravelSpaceError("TravelSpace endpoint not found.", 404, "ENDPOINT_NOT_FOUND");
  } catch (error) {
    if (error instanceof TravelValidationError) {
      return json(
        { error: error.message, code: "VALIDATION_ERROR" },
        error.status || 400,
        origin,
      );
    }
    if (error instanceof TravelSpaceError) {
      return json(
        { error: error.message, code: error.code || "TRAVEL_SPACE_ERROR" },
        error.status || 400,
        origin,
      );
    }
    console.error("TravelSpace route failure:", {
      method,
      sub,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return json(
      {
        error: "TravelSpace could not complete that request due to a server error.",
        code: "SERVER_ERROR",
      },
      500,
      origin,
    );
  }
}

export async function exportTravelSpaceData(userId, env) {
  try {
    return (await rpc("persora_travel_space_export", { p_owner: userId }, env)) || { trips: [], explorePlaces: [] };
  } catch {
    return { trips: [], explorePlaces: [] };
  }
}
