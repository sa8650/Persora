// Persora TravelSpace — shared, dependency-free domain & financial rules.
//
// Used identically by Cloudflare Pages Functions (cloudflare/travel-space.js),
// the browser workspace (src/lib/travel-space-api.ts), and automated tests so
// date validation, unified task/itinerary scheduling, multi-currency conversion,
// budget allocations, contributions, shared splits, and settlements agree to
// the exact minor currency unit.

export const TRIP_STATUSES = Object.freeze([
  "planning",
  "upcoming",
  "ongoing",
  "completed",
  "cancelled",
]);

export const COMPANION_TYPES = Object.freeze([
  "solo",
  "couple",
  "family",
  "friends",
  "group",
]);

export const TRIP_TYPES = Object.freeze([
  "vacation",
  "business",
  "family-tour",
  "educational",
  "adventure",
  "religious",
  "other",
]);

export const BUDGET_SCOPES = Object.freeze(["none", "personal", "group"]);

export const DEFAULT_BUDGET_CATEGORIES = Object.freeze([
  { name: "Transportation", color: "blue" },
  { name: "Meals", color: "amber" },
  { name: "Activities", color: "teal" },
  { name: "Accommodation", color: "violet" },
  { name: "Others", color: "slate" },
]);

export const TRAVEL_CURRENCIES = Object.freeze([
  "BDT",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "SAR",
  "MYR",
  "THB",
  "CHF",
  "CNY",
]);

export const CURRENCY_SYMBOLS = Object.freeze({
  BDT: "৳",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  AED: "AED ",
  SAR: "SAR ",
  MYR: "RM",
  THB: "฿",
  CHF: "CHF ",
  CNY: "¥",
});

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND"]);
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "OMR"]);

export const TASK_STATUSES = Object.freeze(["todo", "in_progress", "done", "skipped"]);
export const KANBAN_COLUMNS = Object.freeze(["todo", "in_progress", "done"]);
export const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);

export const BOOKING_CATEGORIES = Object.freeze([
  "flight",
  "bus",
  "train",
  "hotel",
  "car_rental",
  "activity",
  "other",
]);

export const BOOKING_STATUSES = Object.freeze([
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "refunded",
]);

export const PAYMENT_STATUSES = Object.freeze([
  "unpaid",
  "partial",
  "paid",
  "refunded",
]);

export const TRAVELLER_ROLES = Object.freeze([
  "owner",
  "editor",
  "expense_contributor",
  "viewer",
]);

export const DOCUMENT_CATEGORIES = Object.freeze([
  "passport",
  "visa",
  "national_id",
  "driving_licence",
  "insurance",
  "ticket",
  "hotel_confirmation",
  "permit",
  "other",
]);

export const EXPLORE_STATUSES = Object.freeze([
  "want_to_visit",
  "planned",
  "visited",
]);

export const EXPLORE_KINDS = Object.freeze([
  "destination",
  "attraction",
  "restaurant",
  "stay",
  "place",
]);

export const MEMORY_TYPES = Object.freeze(["photo", "audio", "journal"]);

/** Offline destination directory so destination search always works without external APIs. */
export const CURATED_DESTINATIONS = Object.freeze([
  { name: "Dhaka", city: "Dhaka", country: "Bangladesh", placeType: "city", latitude: 23.8103, longitude: 90.4125 },
  { name: "Cox's Bazar", city: "Cox's Bazar", country: "Bangladesh", placeType: "city", latitude: 21.4272, longitude: 92.0058 },
  { name: "Himchari National Park", city: "Cox's Bazar", country: "Bangladesh", placeType: "place", latitude: 21.3536, longitude: 92.0252 },
  { name: "Inani Beach", city: "Cox's Bazar", country: "Bangladesh", placeType: "place", latitude: 21.2331, longitude: 92.0475 },
  { name: "Saint Martin's Island", city: "Teknaf", country: "Bangladesh", placeType: "place", latitude: 20.6237, longitude: 92.3234 },
  { name: "Sajek Valley", city: "Rangamati", country: "Bangladesh", placeType: "place", latitude: 23.382, longitude: 92.2938 },
  { name: "Sylhet", city: "Sylhet", country: "Bangladesh", placeType: "city", latitude: 24.8949, longitude: 91.8687 },
  { name: "Srimangal", city: "Moulvibazar", country: "Bangladesh", placeType: "city", latitude: 24.3065, longitude: 91.7296 },
  { name: "Sundarbans", city: "Khulna", country: "Bangladesh", placeType: "place", latitude: 21.9497, longitude: 89.1833 },
  { name: "Bandarban", city: "Bandarban", country: "Bangladesh", placeType: "city", latitude: 22.1953, longitude: 92.2184 },
  { name: "Chittagong", city: "Chittagong", country: "Bangladesh", placeType: "city", latitude: 22.3569, longitude: 91.7832 },
  { name: "Kuakata", city: "Patuakhali", country: "Bangladesh", placeType: "place", latitude: 21.8182, longitude: 90.1198 },
  { name: "Kathmandu", city: "Kathmandu", country: "Nepal", placeType: "city", latitude: 27.7172, longitude: 85.324 },
  { name: "Pokhara", city: "Pokhara", country: "Nepal", placeType: "city", latitude: 28.2096, longitude: 83.9856 },
  { name: "Bangkok", city: "Bangkok", country: "Thailand", placeType: "city", latitude: 13.7563, longitude: 100.5018 },
  { name: "Phuket", city: "Phuket", country: "Thailand", placeType: "city", latitude: 7.8804, longitude: 98.3923 },
  { name: "Singapore", city: "Singapore", country: "Singapore", placeType: "country", latitude: 1.3521, longitude: 103.8198 },
  { name: "Kuala Lumpur", city: "Kuala Lumpur", country: "Malaysia", placeType: "city", latitude: 3.139, longitude: 101.6869 },
  { name: "Dubai", city: "Dubai", country: "United Arab Emirates", placeType: "city", latitude: 25.2048, longitude: 55.2708 },
  { name: "Istanbul", city: "Istanbul", country: "Turkey", placeType: "city", latitude: 41.0082, longitude: 28.9784 },
  { name: "Makkah", city: "Makkah", country: "Saudi Arabia", placeType: "city", latitude: 21.3891, longitude: 39.8579 },
  { name: "Madinah", city: "Madinah", country: "Saudi Arabia", placeType: "city", latitude: 24.5247, longitude: 39.5692 },
  { name: "Tokyo", city: "Tokyo", country: "Japan", placeType: "city", latitude: 35.6762, longitude: 139.6503 },
  { name: "Kyoto", city: "Kyoto", country: "Japan", placeType: "city", latitude: 35.0116, longitude: 135.7681 },
  { name: "London", city: "London", country: "United Kingdom", placeType: "city", latitude: 51.5072, longitude: -0.1276 },
  { name: "Paris", city: "Paris", country: "France", placeType: "city", latitude: 48.8566, longitude: 2.3522 },
  { name: "Rome", city: "Rome", country: "Italy", placeType: "city", latitude: 41.9028, longitude: 12.4964 },
  { name: "New York", city: "New York", country: "United States", placeType: "city", latitude: 40.7128, longitude: -74.006 },
  { name: "Bali", city: "Denpasar", country: "Indonesia", placeType: "place", latitude: -8.4095, longitude: 115.1889 },
  { name: "Maldives", city: "Malé", country: "Maldives", placeType: "country", latitude: 4.1755, longitude: 73.5093 },
]);

export class TravelValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "TravelValidationError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Dates & Times
// ---------------------------------------------------------------------------

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function asIsoDateStr(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const ymd = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(str) ? str.slice(0, 10) : str;
  return isValidDate(ymd) ? ymd : null;
}

export function isValidTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function addCalendarDays(dateStr, delta) {
  const s = asIsoDateStr(dateStr) || dateStr;
  const d = new Date(`${s}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function tripDurationDays(startDate, endDate) {
  const s = asIsoDateStr(startDate);
  const e = asIsoDateStr(endDate);
  if (!s || !e || e < s) return 0;
  const a = Date.parse(`${s}T12:00:00.000Z`);
  const b = Date.parse(`${e}T12:00:00.000Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

export function generateTripDays(startDate, endDate) {
  const s = asIsoDateStr(startDate);
  const e = asIsoDateStr(endDate);
  if (!s || !e) return [];
  const count = tripDurationDays(s, e);
  if (count <= 0 || count > 366) return [];
  const days = [];
  for (let i = 0; i < count; i += 1) {
    days.push({
      dayNumber: i + 1,
      date: addCalendarDays(s, i),
    });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Currency & Minor-Unit Arithmetic
// ---------------------------------------------------------------------------

export function normalizeCurrency(code, fallback = "BDT") {
  const clean = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(clean)) return clean;
  return fallback;
}

export function currencyDecimals(currency) {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export function currencyFactor(currency) {
  return 10 ** currencyDecimals(currency);
}

export function toMinor(value, currency = "BDT") {
  if (value === null || value === undefined || value === "") return 0;
  const factor = currencyFactor(currency);
  const num = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(num)) throw new TravelValidationError("Enter a valid numeric amount.");
  return Math.round((num + Number.EPSILON) * factor);
}

export function fromMinor(minor, currency = "BDT") {
  const factor = currencyFactor(currency);
  const rounded = Math.round(Number(minor) || 0);
  return rounded / factor;
}

export function formatTravelMoney(amount, currency = "BDT") {
  const code = normalizeCurrency(currency);
  const decimals = currencyDecimals(code);
  const num = typeof amount === "number" ? amount : Number(amount || 0);
  const safe = Number.isFinite(num) ? num : 0;
  const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals === 0 ? 0 : safe % 1 === 0 ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(safe));
  return `${safe < 0 ? "-" : ""}${symbol}${formatted}`;
}

/**
 * Splits `totalMinor` equally across `count` slots, distributing the integer
 * remainder (+1 minor unit) across the first `remainder` slots so the sum of
 * returned shares ALWAYS equals `totalMinor` with zero rounding loss.
 */
export function splitEqualMinor(totalMinor, count) {
  const n = Math.trunc(Number(count) || 0);
  if (n <= 0) return [];
  const total = Math.round(Number(totalMinor) || 0);
  if (total < 0) throw new TravelValidationError("Split total cannot be negative.");
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const shares = new Array(n);
  for (let i = 0; i < n; i += 1) {
    shares[i] = base + (i < remainder ? 1 : 0);
  }
  return shares;
}

/**
 * Proportionally maps shares in an expense's original currency (`sharesMinor`)
 * into the trip's primary currency (`tripTotalMinor`), conserving the exact sum.
 */
export function convertSharesProportionally(sharesMinor, expenseTotalMinor, tripTotalMinor) {
  if (!sharesMinor.length) return [];
  if (expenseTotalMinor <= 0 || tripTotalMinor <= 0) return sharesMinor.map(() => 0);
  const raw = sharesMinor.map((share) => (share * tripTotalMinor) / expenseTotalMinor);
  const floored = raw.map((val) => Math.floor(val));
  let remainder = Math.round(tripTotalMinor) - floored.reduce((acc, v) => acc + v, 0);
  const order = raw
    .map((val, idx) => ({ idx, frac: val - floored[idx] }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    floored[order[i].idx] += 1;
    remainder -= 1;
  }
  return floored;
}

// ---------------------------------------------------------------------------
// Destinations Search & Normalization
// ---------------------------------------------------------------------------

export function searchCuratedDestinations(query) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return [...CURATED_DESTINATIONS].slice(0, 12);
  return CURATED_DESTINATIONS.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.city.toLowerCase().includes(q) ||
      item.country.toLowerCase().includes(q),
  ).slice(0, 15);
}

export function isValidCoordinatePair(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function roundCoordinate(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

export function formatCoordinatePair(latitude, longitude, decimals = 4) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isValidCoordinatePair(lat, lng)) return "Invalid coordinates";
  return `${lat.toFixed(decimals)}, ${lng.toFixed(decimals)}`;
}

export function formatCoordinateStopLabel(latitude, longitude, index = 0) {
  return `Stop ${index + 1} (${formatCoordinatePair(latitude, longitude, 4)})`;
}

export function parseCoordinateInput(rawInput) {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Match optional lat:/lng: labels or N/S/E/W hemisphere indicators
  const dmsLike = trimmed.match(
    /^\s*(?:lat(?:itude)?\s*[:=]?\s*)?(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?\s*(?:[,;/\s]+)\s*(?:(?:lng|lon|longitude)\s*[:=]?\s*)?(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?\s*$/,
  );
  if (!dmsLike) return null;
  let lat = Number(dmsLike[1]);
  const ns = (dmsLike[2] || "").toUpperCase();
  let lng = Number(dmsLike[3]);
  const ew = (dmsLike[4] || "").toUpperCase();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (ns === "S" && lat > 0) lat = -lat;
  if (ew === "W" && lng > 0) lng = -lng;
  if (!isValidCoordinatePair(lat, lng)) return null;
  return {
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lng),
  };
}

export function parseGoogleMapsInput(rawInput) {
  const text = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!text) {
    return {
      ok: false,
      isShortLink: false,
      extractedQuery: "",
      message: "Enter coordinates or paste a Google Maps URL.",
    };
  }

  // 1. Direct coordinate pair ("35.6762, 139.6503")
  const direct = parseCoordinateInput(text);
  if (direct) {
    return {
      ok: true,
      latitude: direct.latitude,
      longitude: direct.longitude,
      source: "coordinates",
    };
  }

  // 2. Shortened Google Maps URLs require expansion or place search
  if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\b/i.test(text)) {
    return {
      ok: false,
      isShortLink: true,
      extractedQuery: "",
      message:
        "Shortened Google Maps links hide coordinates behind a redirect. Open the link once and copy the full URL from the address bar, or enter coordinates directly.",
    };
  }

  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    decoded = text;
  }

  // 3. Exact Google Maps place pin (!3dLAT!4dLNG — last match corresponds to the selected pin)
  const pinMatches = [...decoded.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  if (pinMatches.length > 0) {
    const last = pinMatches[pinMatches.length - 1];
    const lat = Number(last[1]);
    const lng = Number(last[2]);
    if (isValidCoordinatePair(lat, lng)) {
      let labelHint = "";
      const placeSeg = decoded.match(/\/maps\/place\/([^/@?]+)/i);
      if (placeSeg && placeSeg[1]) {
        labelHint = placeSeg[1].replace(/\+/g, " ").trim();
      }
      return {
        ok: true,
        latitude: roundCoordinate(lat),
        longitude: roundCoordinate(lng),
        labelHint: labelHint || undefined,
        source: "google_maps_pin",
      };
    }
  }

  // 4. URL query params (?q=lat,lng, ?query=lat,lng, ?ll=lat,lng, ?center=lat,lng, ?destination=lat,lng, ?daddr=lat,lng)
  let extractedQuery = "";
  try {
    const parsedUrl = new URL(text);
    for (const key of ["q", "query", "ll", "center", "destination", "daddr", "saddr", "viewpoint"]) {
      const val = parsedUrl.searchParams.get(key);
      if (!val) continue;
      const coord = parseCoordinateInput(val);
      if (coord) {
        return {
          ok: true,
          latitude: coord.latitude,
          longitude: coord.longitude,
          source: "google_maps_query",
        };
      }
      if (!extractedQuery && val.trim()) {
        extractedQuery = val.replace(/\+/g, " ").trim();
      }
    }

    const placePath = parsedUrl.pathname.match(/\/maps\/place\/([^/@]+)/i);
    if (placePath && placePath[1]) {
      const candidate = decodeURIComponent(placePath[1]).replace(/\+/g, " ").trim();
      const coord = parseCoordinateInput(candidate);
      if (coord) {
        return {
          ok: true,
          latitude: coord.latitude,
          longitude: coord.longitude,
          source: "google_maps_place",
        };
      }
      if (!extractedQuery) extractedQuery = candidate;
    }

    const dirSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const dirIdx = dirSegments.findIndex((seg) => seg.toLowerCase() === "dir" || seg.toLowerCase() === "search");
    if (dirIdx >= 0) {
      for (let i = dirIdx + 1; i < dirSegments.length; i += 1) {
        const seg = decodeURIComponent(dirSegments[i]);
        if (seg.startsWith("@")) continue;
        const coord = parseCoordinateInput(seg);
        if (coord) {
          return {
            ok: true,
            latitude: coord.latitude,
            longitude: coord.longitude,
            source: "google_maps_path",
          };
        }
      }
    }
  } catch {
    // Not a full URL; continue regex checks
  }

  // 5. Viewport @lat,lng,zoom pattern in URL
  const atMatch = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\b|$)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidCoordinatePair(lat, lng)) {
      return {
        ok: true,
        latitude: roundCoordinate(lat),
        longitude: roundCoordinate(lng),
        labelHint: extractedQuery || undefined,
        source: "google_maps_viewport",
      };
    }
  }

  return {
    ok: false,
    isShortLink: false,
    extractedQuery,
    message: extractedQuery
      ? `This link contains "${extractedQuery}" without exact coordinates. Search that place name or enter latitude and longitude.`
      : "Could not find valid coordinates in that input. Enter latitude, longitude (e.g. 23.8103, 90.4125) or paste a full Google Maps URL.",
  };
}

export function buildGoogleMapsPlaceUrl(latitude, longitude) {
  if (!isValidCoordinatePair(latitude, longitude)) return "https://www.google.com/maps";
  return `https://www.google.com/maps/search/?api=1&query=${roundCoordinate(latitude)},${roundCoordinate(longitude)}`;
}

export function buildGoogleMapsDirectionsUrl(points, travelMode = "driving") {
  const valid = (Array.isArray(points) ? points : []).filter((p) =>
    p && isValidCoordinatePair(p.latitude, p.longitude),
  );
  if (valid.length === 0) return "https://www.google.com/maps";
  if (valid.length === 1) return buildGoogleMapsPlaceUrl(valid[0].latitude, valid[0].longitude);

  const origin = `${roundCoordinate(valid[0].latitude)},${roundCoordinate(valid[0].longitude)}`;
  const dest = `${roundCoordinate(valid[valid.length - 1].latitude)},${roundCoordinate(valid[valid.length - 1].longitude)}`;
  const mode =
    travelMode === "walking"
      ? "walking"
      : travelMode === "cycling" || travelMode === "bicycling"
        ? "bicycling"
        : "driving";
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination: dest,
    travelmode: mode,
  });
  if (valid.length > 2) {
    const waypoints = valid
      .slice(1, -1)
      .slice(0, 20)
      .map((p) => `${roundCoordinate(p.latitude)},${roundCoordinate(p.longitude)}`)
      .join("|");
    params.set("waypoints", waypoints);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Strictly sanitizes map destinations for persistence (Section 20):
 * ONLY coordinates (`latitude`, `longitude`) and `orderIndex` are kept.
 * Destination names, addresses, cities, and countries are NEVER returned for DB storage.
 */
export function sanitizeTripDestinations(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 60) {
    throw new TravelValidationError("A trip can have up to 60 map stops.");
  }
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (!raw || typeof raw !== "object") continue;
    let lat = raw.latitude === null || raw.latitude === undefined || raw.latitude === "" ? NaN : Number(raw.latitude);
    let lng = raw.longitude === null || raw.longitude === undefined || raw.longitude === "" ? NaN : Number(raw.longitude);

    // If a legacy payload passed only a curated place name, match coordinates from CURATED_DESTINATIONS if available
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && typeof raw.name === "string" && raw.name.trim()) {
      const q = raw.name.trim().toLowerCase();
      const match = CURATED_DESTINATIONS.find((c) => c.name.toLowerCase() === q || c.city.toLowerCase() === q);
      if (match) {
        lat = match.latitude;
        lng = match.longitude;
      }
    }

    if (!isValidCoordinatePair(lat, lng)) {
      throw new TravelValidationError(
        `Destination #${i + 1} requires valid coordinates (latitude -90..90, longitude -180..180).`,
      );
    }

    out.push({
      id: typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id : undefined,
      latitude: roundCoordinate(lat),
      longitude: roundCoordinate(lng),
      orderIndex: out.length,
    });
  }
  return out;
}

export function sanitizeInitialTasks(list, { startDate, endDate } = {}) {
  if (!Array.isArray(list)) return [];
  if (list.length > 50) {
    throw new TravelValidationError("You can add up to 50 initial tasks during trip creation.");
  }
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (!raw || typeof raw !== "object") continue;
    const title = String(raw.title || "").trim();
    if (!title) continue;
    if (title.length > 160) {
      throw new TravelValidationError("Task titles must be 160 characters or fewer.");
    }
    const description = String(raw.description || "").trim().slice(0, 1500);
    const priority = TASK_PRIORITIES.includes(raw.priority) ? raw.priority : "normal";
    const dueDate = raw.dueDate ? String(raw.dueDate).trim() : null;
    if (dueDate && !isValidDate(dueDate)) {
      throw new TravelValidationError(`Task "${title}" has an invalid due date.`);
    }
    const scheduledDate = raw.scheduledDate ? String(raw.scheduledDate).trim() : null;
    if (scheduledDate) {
      if (!isValidDate(scheduledDate)) {
        throw new TravelValidationError(`Task "${title}" has an invalid scheduled date.`);
      }
      if (startDate && endDate && (scheduledDate < startDate || scheduledDate > endDate)) {
        throw new TravelValidationError(`Task "${title}" scheduled date must be within the trip dates.`);
      }
    }
    out.push({
      title,
      description,
      priority,
      dueDate: dueDate || null,
      scheduledDate: scheduledDate || null,
      assigneeIndex:
        raw.assigneeIndex !== undefined && raw.assigneeIndex !== null && Number.isInteger(Number(raw.assigneeIndex))
          ? Number(raw.assigneeIndex)
          : null,
      assignedTravellerId:
        typeof raw.assignedTravellerId === "string" && raw.assignedTravellerId ? raw.assignedTravellerId : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trip Input & Budget Rules
// ---------------------------------------------------------------------------

export function sanitizeTripInput(input, { partial = false } = {}) {
  if (!input || typeof input !== "object") {
    throw new TravelValidationError("Provide trip details.");
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!partial || input.title !== undefined) {
    if (!title || title.length > 140) {
      throw new TravelValidationError("Trip title must be between 1 and 140 characters.");
    }
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 2000) {
    throw new TravelValidationError("Trip description must be 2,000 characters or fewer.");
  }

  const startDate = input.startDate ? String(input.startDate).trim() : "";
  const endDate = input.endDate ? String(input.endDate).trim() : "";
  if (!partial || input.startDate !== undefined || input.endDate !== undefined) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      throw new TravelValidationError("Select valid trip start and end dates (YYYY-MM-DD).");
    }
    if (endDate < startDate) {
      throw new TravelValidationError("Trip end date cannot be earlier than the start date.");
    }
    if (tripDurationDays(startDate, endDate) > 366) {
      throw new TravelValidationError("Keep a single trip within 366 days.");
    }
  }

  const companionType = COMPANION_TYPES.includes(input.companionType) ? input.companionType : "solo";
  let travelerCount = Math.trunc(Number(input.travelerCount ?? (companionType === "solo" ? 1 : 2)));
  if (!Number.isFinite(travelerCount) || travelerCount < 1 || travelerCount > 200) {
    throw new TravelValidationError("Number of travellers must be between 1 and 200.");
  }
  // Solo trips always have exactly 1 traveller; non-solo companion types require at least 2 when explicitly set, or >= 1.
  if (companionType === "solo") {
    travelerCount = 1;
  } else if (companionType === "couple" && travelerCount < 2) {
    travelerCount = 2;
  }

  const tripType = input.tripType && TRIP_TYPES.includes(input.tripType) ? input.tripType : null;
  const primaryCurrency = normalizeCurrency(input.primaryCurrency, "BDT");

  let budgetScope = BUDGET_SCOPES.includes(input.budgetScope) ? input.budgetScope : "personal";
  // Solo trips never use Combined Group Budget.
  if (companionType === "solo" && budgetScope === "group") {
    budgetScope = "personal";
  }

  const personalBudgetMinor =
    budgetScope === "personal" && input.personalBudget !== undefined && input.personalBudget !== null && input.personalBudget !== ""
      ? toMinor(input.personalBudget, primaryCurrency)
      : 0;
  if (personalBudgetMinor < 0) {
    throw new TravelValidationError("Personal budget cannot be negative.");
  }

  const status = TRIP_STATUSES.includes(input.status) ? input.status : "planning";
  // Destinations are optional during trip creation (user may continue with 0 destinations)
  const destinations =
    input.destinations !== undefined ? sanitizeTripDestinations(input.destinations) : partial ? undefined : [];
  const initialTasks =
    input.initialTasks !== undefined
      ? sanitizeInitialTasks(input.initialTasks, { startDate, endDate })
      : undefined;

  return {
    title,
    description,
    startDate,
    endDate,
    companionType,
    travelerCount,
    tripType,
    status,
    primaryCurrency,
    budgetScope,
    personalBudgetMinor,
    personalBudget: fromMinor(personalBudgetMinor, primaryCurrency),
    destinations,
    initialTasks,
  };
}

// ---------------------------------------------------------------------------
// Contributions & Category Budget Calculations
// ---------------------------------------------------------------------------

export function computeContributionSummary(contributions, currency = "BDT") {
  let plannedMinor = 0;
  let collectedMinor = 0;
  const rows = (Array.isArray(contributions) ? contributions : []).map((entry) => {
    const pMinor = Math.max(0, toMinor(entry.plannedAmount ?? 0, currency));
    const cMinor = Math.max(0, toMinor(entry.contributedAmount ?? 0, currency));
    const pendingMinor = Math.max(0, pMinor - cMinor);
    const derivedStatus =
      pMinor === 0 && cMinor === 0
        ? "pending"
        : cMinor >= pMinor && pMinor > 0
          ? "paid"
          : cMinor > 0
            ? "partial"
            : "pending";
    plannedMinor += pMinor;
    collectedMinor += cMinor;
    return {
      ...entry,
      plannedMinor: pMinor,
      contributedMinor: cMinor,
      pendingMinor,
      plannedAmount: fromMinor(pMinor, currency),
      contributedAmount: fromMinor(cMinor, currency),
      pendingAmount: fromMinor(pendingMinor, currency),
      status: derivedStatus,
    };
  });

  const pendingMinor = Math.max(0, plannedMinor - collectedMinor);
  return {
    rows,
    totalPlannedMinor: plannedMinor,
    totalCollectedMinor: collectedMinor,
    totalPendingMinor: pendingMinor,
    totalPlanned: fromMinor(plannedMinor, currency),
    totalCollected: fromMinor(collectedMinor, currency),
    totalPending: fromMinor(pendingMinor, currency),
  };
}

export function sanitizeBudgetCategories(categories, plannedBudgetMinor, currency = "BDT") {
  const source =
    Array.isArray(categories) && categories.length > 0
      ? categories
      : DEFAULT_BUDGET_CATEGORIES.map((cat, idx) => ({
          name: cat.name,
          color: cat.color,
          allocatedAmount: 0,
          isDefault: true,
          sortOrder: idx,
        }));

  const seen = new Set();
  const normalized = [];
  let allocatedMinorTotal = 0;

  for (let i = 0; i < source.length && normalized.length < 30; i += 1) {
    const raw = source[i];
    if (!raw || typeof raw !== "object") continue;
    const name = String(raw.name || "").trim();
    if (!name || name.length > 60) {
      throw new TravelValidationError("Budget category names must be between 1 and 60 characters.");
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const allocMinor = Math.max(0, toMinor(raw.allocatedAmount ?? 0, currency));
    allocatedMinorTotal += allocMinor;
    normalized.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : undefined,
      name,
      color: typeof raw.color === "string" && raw.color ? raw.color : "blue",
      isDefault: Boolean(raw.isDefault ?? DEFAULT_BUDGET_CATEGORIES.some((d) => d.name.toLowerCase() === key)),
      allocatedMinor: allocMinor,
      allocatedAmount: fromMinor(allocMinor, currency),
      sortOrder: normalized.length,
    });
  }

  if (plannedBudgetMinor > 0 && allocatedMinorTotal > plannedBudgetMinor) {
    throw new TravelValidationError(
      `Total category allocation (${formatTravelMoney(fromMinor(allocatedMinorTotal, currency), currency)}) cannot exceed the planned budget (${formatTravelMoney(fromMinor(plannedBudgetMinor, currency), currency)}).`,
    );
  }

  const unallocatedMinor = Math.max(0, plannedBudgetMinor - allocatedMinorTotal);
  return {
    categories: normalized,
    allocatedMinor: allocatedMinorTotal,
    unallocatedMinor,
    allocatedTotal: fromMinor(allocatedMinorTotal, currency),
    unallocatedTotal: fromMinor(unallocatedMinor, currency),
  };
}

// ---------------------------------------------------------------------------
// Expenses, Multi-Currency Conversion, Splits & Settlements
// ---------------------------------------------------------------------------

export function normalizeExpenseInput(input, trip, validTravellerIds) {
  if (!input || typeof input !== "object") {
    throw new TravelValidationError("Provide expense details.");
  }
  const title = String(input.title || "").trim();
  if (!title || title.length > 160) {
    throw new TravelValidationError("Enter what the expense was for (1–160 characters).");
  }
  const currency = normalizeCurrency(input.currency, trip.primaryCurrency);
  const amountMinor = toMinor(input.amount, currency);
  if (amountMinor <= 0) {
    throw new TravelValidationError("Expense amount must be greater than zero.");
  }

  const expenseDate = String(input.expenseDate || "").trim();
  if (!isValidDate(expenseDate)) {
    throw new TravelValidationError("Choose a valid expense date.");
  }

  const primaryCurrency = normalizeCurrency(trip.primaryCurrency, "BDT");
  let exchangeRate = 1;
  let convertedOn = expenseDate;
  let tripAmountMinor = amountMinor;

  if (currency !== primaryCurrency) {
    if (input.convertedAmount !== undefined && input.convertedAmount !== null && input.convertedAmount !== "") {
      tripAmountMinor = toMinor(input.convertedAmount, primaryCurrency);
      if (tripAmountMinor <= 0) {
        throw new TravelValidationError(`Converted ${primaryCurrency} amount must be greater than zero.`);
      }
      const origNum = fromMinor(amountMinor, currency);
      const convNum = fromMinor(tripAmountMinor, primaryCurrency);
      exchangeRate = Number((convNum / origNum).toFixed(6));
    } else if (input.exchangeRate !== undefined && input.exchangeRate !== null && input.exchangeRate !== "") {
      const rate = Number(input.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new TravelValidationError("Exchange rate must be a positive number.");
      }
      exchangeRate = Number(rate.toFixed(6));
      const convValue = fromMinor(amountMinor, currency) * exchangeRate;
      tripAmountMinor = toMinor(convValue, primaryCurrency);
      if (tripAmountMinor <= 0) {
        throw new TravelValidationError("Converted amount is too small in the trip's primary currency.");
      }
    } else {
      throw new TravelValidationError(
        `Enter an exchange rate or converted ${primaryCurrency} amount for ${currency} expenses.`,
      );
    }
    if (input.convertedOn && isValidDate(String(input.convertedOn))) {
      convertedOn = String(input.convertedOn);
    }
  }

  const travellerSet = new Set(validTravellerIds || []);
  const paidByTravellerId = String(input.paidByTravellerId || "").trim();
  if (!paidByTravellerId || (travellerSet.size > 0 && !travellerSet.has(paidByTravellerId))) {
    throw new TravelValidationError("Select which traveller paid this expense.");
  }

  let expenseType = input.expenseType === "shared" ? "shared" : "personal";
  if (trip.companionType === "solo" && expenseType === "shared") {
    throw new TravelValidationError("Shared expenses are only available on multi-traveller trips.");
  }

  const paidFromGroupFund = Boolean(
    trip.budgetScope === "group" && (expenseType === "shared" || input.paidFromGroupFund),
  );

  const categoryName = String(input.categoryName || "Others").trim().slice(0, 60) || "Others";
  const categoryId = typeof input.categoryId === "string" && input.categoryId ? input.categoryId : null;
  const paymentMethod = String(input.paymentMethod || "").trim().slice(0, 60);
  const notes = String(input.notes || "").trim().slice(0, 1000);

  let splitMethod = "none";
  let splits = [];

  if (expenseType === "shared") {
    splitMethod = input.splitMethod === "custom" ? "custom" : "equal";
    if (splitMethod === "equal") {
      const participantIds = Array.isArray(input.participantIds)
        ? [...new Set(input.participantIds.map((id) => String(id).trim()).filter(Boolean))]
        : [];
      if (participantIds.length < 1) {
        throw new TravelValidationError("Select at least one traveller to split this shared expense between.");
      }
      if (travellerSet.size > 0 && participantIds.some((id) => !travellerSet.has(id))) {
        throw new TravelValidationError("All split participants must belong to this trip.");
      }
      const shareMinors = splitEqualMinor(amountMinor, participantIds.length);
      const tripShareMinors = convertSharesProportionally(shareMinors, amountMinor, tripAmountMinor);
      splits = participantIds.map((travellerId, idx) => ({
        travellerId,
        shareMinor: shareMinors[idx],
        shareAmount: fromMinor(shareMinors[idx], currency),
        tripShareMinor: tripShareMinors[idx],
        tripShareAmount: fromMinor(tripShareMinors[idx], primaryCurrency),
      }));
    } else {
      const rawSplits = Array.isArray(input.customSplits) ? input.customSplits : [];
      const seen = new Set();
      const parsed = [];
      let sumMinor = 0;
      for (const item of rawSplits) {
        if (!item || typeof item !== "object") continue;
        const tid = String(item.travellerId || "").trim();
        if (!tid || seen.has(tid)) continue;
        if (travellerSet.size > 0 && !travellerSet.has(tid)) {
          throw new TravelValidationError("All split participants must belong to this trip.");
        }
        const sMinor = toMinor(item.amount ?? item.shareAmount ?? 0, currency);
        if (sMinor < 0) {
          throw new TravelValidationError("Individual split shares cannot be negative.");
        }
        if (sMinor === 0) continue;
        seen.add(tid);
        sumMinor += sMinor;
        parsed.push({ travellerId: tid, shareMinor: sMinor });
      }
      if (parsed.length === 0) {
        throw new TravelValidationError("Allocate custom shares to at least one traveller.");
      }
      if (sumMinor !== amountMinor) {
        throw new TravelValidationError(
          `Custom split shares (${formatTravelMoney(fromMinor(sumMinor, currency), currency)}) must equal the total expense (${formatTravelMoney(fromMinor(amountMinor, currency), currency)}).`,
        );
      }
      const tripShareMinors = convertSharesProportionally(
        parsed.map((p) => p.shareMinor),
        amountMinor,
        tripAmountMinor,
      );
      splits = parsed.map((p, idx) => ({
        travellerId: p.travellerId,
        shareMinor: p.shareMinor,
        shareAmount: fromMinor(p.shareMinor, currency),
        tripShareMinor: tripShareMinors[idx],
        tripShareAmount: fromMinor(tripShareMinors[idx], primaryCurrency),
      }));
    }
  }

  return {
    title,
    amountMinor,
    amount: fromMinor(amountMinor, currency),
    currency,
    tripAmountMinor,
    tripAmount: fromMinor(tripAmountMinor, primaryCurrency),
    exchangeRate,
    convertedOn,
    expenseDate,
    categoryId,
    categoryName,
    expenseType,
    paidByTravellerId,
    paidFromGroupFund,
    splitMethod,
    paymentMethod,
    notes,
    splits,
  };
}

/**
 * Computes each traveller's paid total, share total, settlement adjustments,
 * net balance (owes vs should receive), and minimal settlement suggestions.
 */
export function computeTravellerBalances(travellers, expenses, settlements, primaryCurrency = "BDT") {
  const map = new Map();
  for (const t of travellers || []) {
    map.set(t.id, {
      travellerId: t.id,
      fullName: t.fullName || t.name || "Traveller",
      paidSharedMinor: 0,
      paidPersonalMinor: 0,
      shareMinor: 0,
      settlementsPaidMinor: 0,
      settlementsReceivedMinor: 0,
    });
  }

  for (const exp of expenses || []) {
    const tripMinor = toMinor(exp.tripAmount ?? exp.amount ?? 0, primaryCurrency);
    const payer = map.get(exp.paidByTravellerId);
    if (exp.expenseType === "shared") {
      if (payer) payer.paidSharedMinor += tripMinor;
      const splits = Array.isArray(exp.splits) ? exp.splits : [];
      for (const sp of splits) {
        const member = map.get(sp.travellerId);
        if (member) {
          member.shareMinor += toMinor(sp.tripShareAmount ?? sp.shareAmount ?? 0, primaryCurrency);
        }
      }
    } else if (payer) {
      payer.paidPersonalMinor += tripMinor;
    }
  }

  for (const st of settlements || []) {
    if (st.status !== "completed") continue;
    const sMinor = toMinor(st.amount ?? 0, primaryCurrency);
    if (sMinor <= 0) continue;
    const from = map.get(st.fromTravellerId);
    const to = map.get(st.toTravellerId);
    if (from) from.settlementsPaidMinor += sMinor;
    if (to) to.settlementsReceivedMinor += sMinor;
  }

  const balances = [];
  for (const entry of map.values()) {
    const netMinor =
      entry.paidSharedMinor -
      entry.shareMinor +
      entry.settlementsPaidMinor -
      entry.settlementsReceivedMinor;
    const owesMinor = netMinor < 0 ? -netMinor : 0;
    const shouldReceiveMinor = netMinor > 0 ? netMinor : 0;
    balances.push({
      travellerId: entry.travellerId,
      fullName: entry.fullName,
      totalPaid: fromMinor(entry.paidSharedMinor, primaryCurrency),
      personalSpent: fromMinor(entry.paidPersonalMinor, primaryCurrency),
      totalShare: fromMinor(entry.shareMinor, primaryCurrency),
      settlementsPaid: fromMinor(entry.settlementsPaidMinor, primaryCurrency),
      settlementsReceived: fromMinor(entry.settlementsReceivedMinor, primaryCurrency),
      netMinor,
      netBalance: fromMinor(netMinor, primaryCurrency),
      owesMinor,
      owes: fromMinor(owesMinor, primaryCurrency),
      shouldReceiveMinor,
      shouldReceive: fromMinor(shouldReceiveMinor, primaryCurrency),
      settled: netMinor === 0,
    });
  }

  const debtors = balances
    .filter((b) => b.owesMinor > 0)
    .map((b) => ({ ...b, rem: b.owesMinor }))
    .sort((a, b) => b.rem - a.rem);
  const creditors = balances
    .filter((b) => b.shouldReceiveMinor > 0)
    .map((b) => ({ ...b, rem: b.shouldReceiveMinor }))
    .sort((a, b) => b.rem - a.rem);

  const suggestedSettlements = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].rem, creditors[ci].rem);
    if (transfer > 0) {
      suggestedSettlements.push({
        fromTravellerId: debtors[di].travellerId,
        fromName: debtors[di].fullName,
        toTravellerId: creditors[ci].travellerId,
        toName: creditors[ci].fullName,
        amountMinor: transfer,
        amount: fromMinor(transfer, primaryCurrency),
        currency: primaryCurrency,
      });
    }
    debtors[di].rem -= transfer;
    creditors[ci].rem -= transfer;
    if (debtors[di].rem <= 0) di += 1;
    if (creditors[ci].rem <= 0) ci += 1;
  }

  return { balances, suggestedSettlements };
}

/**
 * Full trip financial summary: strictly derived from planned budget /
 * contributions, category allocations, expenses, and settlements.
 * Never derives total budget from actual expenses and never treats pending
 * contributions as collected funds.
 */
export function computeTripBudgetOverview({
  trip,
  travellers = [],
  categories = [],
  contributions = [],
  expenses = [],
  settlements = [],
}) {
  const currency = normalizeCurrency(trip?.primaryCurrency, "BDT");
  const ownerTraveller = travellers.find((t) => t.isOwner) || travellers[0] || null;
  const contribSummary = computeContributionSummary(contributions, currency);

  let totalPlannedBudgetMinor = 0;
  if (trip?.budgetScope === "group") {
    totalPlannedBudgetMinor = contribSummary.totalPlannedMinor;
  } else if (trip?.budgetScope === "personal") {
    totalPlannedBudgetMinor = toMinor(trip.personalBudget ?? 0, currency);
  }

  let totalAllocatedMinor = 0;
  const categoryMap = new Map();
  for (const cat of categories) {
    const allocMinor = Math.max(0, toMinor(cat.allocatedAmount ?? 0, currency));
    totalAllocatedMinor += allocMinor;
    categoryMap.set(cat.name.toLowerCase(), {
      id: cat.id,
      name: cat.name,
      color: cat.color || "blue",
      isDefault: Boolean(cat.isDefault),
      allocatedMinor: allocMinor,
      spentMinor: 0,
      budgetEligibleSpentMinor: 0,
    });
  }

  let totalExpensesMinor = 0;
  let personalExpensesMinor = 0;
  let sharedExpensesMinor = 0;
  let budgetUsedMinor = 0;

  for (const exp of expenses) {
    const tripMinor = toMinor(exp.tripAmount ?? exp.amount ?? 0, currency);
    totalExpensesMinor += tripMinor;
    if (exp.expenseType === "shared") {
      sharedExpensesMinor += tripMinor;
    } else {
      personalExpensesMinor += tripMinor;
    }

    // Eligible spend against the managed budget scope:
    let eligibleMinor = 0;
    if (trip?.budgetScope === "personal") {
      if (exp.expenseType === "personal") {
        if (!ownerTraveller || exp.paidByTravellerId === ownerTraveller.id) {
          eligibleMinor = tripMinor;
        }
      } else if (ownerTraveller && Array.isArray(exp.splits)) {
        const mySplit = exp.splits.find((s) => s.travellerId === ownerTraveller.id);
        if (mySplit) {
          eligibleMinor = toMinor(mySplit.tripShareAmount ?? mySplit.shareAmount ?? 0, currency);
        }
      }
    } else if (trip?.budgetScope === "group") {
      if (exp.expenseType === "shared" || exp.paidFromGroupFund) {
        eligibleMinor = tripMinor;
      }
    } else {
      eligibleMinor = tripMinor;
    }
    budgetUsedMinor += eligibleMinor;

    const catKey = String(exp.categoryName || "Others").trim().toLowerCase();
    if (!categoryMap.has(catKey)) {
      categoryMap.set(catKey, {
        id: exp.categoryId || undefined,
        name: exp.categoryName || "Others",
        color: "slate",
        isDefault: false,
        allocatedMinor: 0,
        spentMinor: 0,
        budgetEligibleSpentMinor: 0,
      });
    }
    const bucket = categoryMap.get(catKey);
    bucket.spentMinor += tripMinor;
    bucket.budgetEligibleSpentMinor += eligibleMinor;
  }

  const remainingBudgetMinor = totalPlannedBudgetMinor - budgetUsedMinor;
  const unallocatedMinor = Math.max(0, totalPlannedBudgetMinor - totalAllocatedMinor);
  const usagePercent =
    totalPlannedBudgetMinor > 0
      ? Math.round((budgetUsedMinor / totalPlannedBudgetMinor) * 1000) / 10
      : 0;

  const categoryBreakdown = [...categoryMap.values()].map((cat) => {
    const pct =
      cat.allocatedMinor > 0
        ? Math.round((cat.budgetEligibleSpentMinor / cat.allocatedMinor) * 1000) / 10
        : 0;
    const status =
      cat.allocatedMinor > 0 && cat.budgetEligibleSpentMinor > cat.allocatedMinor
        ? "exceeded"
        : cat.allocatedMinor > 0 && pct >= 85
          ? "warning"
          : "ok";
    return {
      id: cat.id,
      name: cat.name,
      color: cat.color,
      isDefault: cat.isDefault,
      allocated: fromMinor(cat.allocatedMinor, currency),
      spent: fromMinor(cat.budgetEligibleSpentMinor, currency),
      totalRecordedSpent: fromMinor(cat.spentMinor, currency),
      remaining: fromMinor(cat.allocatedMinor - cat.budgetEligibleSpentMinor, currency),
      usagePercent: pct,
      alertStatus: status,
    };
  });

  const { balances, suggestedSettlements } = computeTravellerBalances(
    travellers,
    expenses,
    settlements,
    currency,
  );

  return {
    currency,
    budgetScope: trip?.budgetScope || "none",
    totalPlannedBudget: fromMinor(totalPlannedBudgetMinor, currency),
    totalCollected: contribSummary.totalCollected,
    totalPendingContributions: contribSummary.totalPending,
    totalAllocated: fromMinor(totalAllocatedMinor, currency),
    unallocated: fromMinor(unallocatedMinor, currency),
    totalExpenses: fromMinor(totalExpensesMinor, currency),
    personalExpenses: fromMinor(personalExpensesMinor, currency),
    sharedExpenses: fromMinor(sharedExpensesMinor, currency),
    budgetUsed: fromMinor(budgetUsedMinor, currency),
    remainingBudget: fromMinor(remainingBudgetMinor, currency),
    usagePercent,
    budgetAlert:
      totalPlannedBudgetMinor > 0 && budgetUsedMinor > totalPlannedBudgetMinor
        ? "exceeded"
        : totalPlannedBudgetMinor > 0 && usagePercent >= 85
          ? "warning"
          : "ok",
    categories: categoryBreakdown,
    contributions: contribSummary.rows,
    balances,
    suggestedSettlements,
  };
}

// ---------------------------------------------------------------------------
// Unified Task / Itinerary Activity Helpers & Overlap Detection
// ---------------------------------------------------------------------------

export function detectScheduleOverlaps(items) {
  const byDate = new Map();
  for (const item of items || []) {
    if (!item.scheduledDate || item.status === "skipped") continue;
    if (!isValidTime(item.startTime) || !isValidTime(item.endTime)) continue;
    if (item.endTime <= item.startTime) continue;
    const list = byDate.get(item.scheduledDate) || [];
    list.push(item);
    byDate.set(item.scheduledDate, list);
  }

  const overlappingIds = new Set();
  const conflicts = [];
  for (const [date, list] of byDate.entries()) {
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (sorted[j].startTime < sorted[i].endTime) {
          overlappingIds.add(sorted[i].id);
          overlappingIds.add(sorted[j].id);
          conflicts.push({
            date,
            firstId: sorted[i].id,
            firstTitle: sorted[i].title,
            secondId: sorted[j].id,
            secondTitle: sorted[j].title,
          });
        }
      }
    }
  }
  return { overlappingIds: [...overlappingIds], conflicts };
}

export function canRolePerform(role, action) {
  if (role === "owner") return true;
  if (role === "editor") {
    return ![
      "delete_trip",
      "manage_roles",
      "delete_owner",
    ].includes(action);
  }
  if (role === "expense_contributor") {
    return ["view", "create_expense", "edit_own_expense"].includes(action);
  }
  if (role === "viewer") {
    return action === "view";
  }
  return false;
}
