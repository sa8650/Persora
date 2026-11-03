// Persora TravelSpace — Comprehensive Unit, Pages Function Routing, Coordinate-Only Map DB,
// Financial, Scheduling, RBAC, Trash, Life Timeline & PostgreSQL (PGlite) Integration Test Suite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createVaultDatabase } from "./password-vault-db.mjs";
import { onRequest as pagesApiOnRequest } from "../functions/api/[[path]].js";
import { handleTravelSpace, exportTravelSpaceData } from "../cloudflare/travel-space.js";
import { handleTimeline } from "../cloudflare/timeline.js";
import {
  TravelValidationError,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsPlaceUrl,
  computeContributionSummary,
  generateTripDays,
  parseGoogleMapsInput,
  sanitizeBudgetCategories,
  sanitizeInitialTasks,
  sanitizeTripDestinations,
  sanitizeTripInput,
  splitEqualMinor,
} from "../cloudflare/travel-space-rules.js";

const ORIGIN = "https://persora.example";

// In-memory R2 VAULT_FILES bucket mock
const bucketMap = new Map();
const vaultFilesMock = {
  async put(key, bytes, meta = {}) {
    bucketMap.set(key, {
      bytes: bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
      httpMetadata: meta.httpMetadata || {},
      customMetadata: meta.customMetadata || {},
    });
  },
  async get(key) {
    const entry = bucketMap.get(key);
    if (!entry) return null;
    return {
      body: entry.bytes,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
    };
  },
  async head(key) {
    const entry = bucketMap.get(key);
    if (!entry) return null;
    return { size: entry.bytes.byteLength, httpMetadata: entry.httpMetadata, customMetadata: entry.customMetadata };
  },
  async delete(key) {
    bucketMap.delete(key);
  },
  async list({ prefix = "" } = {}) {
    const objects = [];
    for (const [key, entry] of bucketMap.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        objects.push({ key, size: entry.bytes.byteLength });
      }
    }
    return { objects, truncated: false };
  },
};

const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SECRET_KEY: "test-service-key",
  AUTH_TOKEN_SECRET: "test-auth-token-secret-32-chars-minimum!!",
  TIMELINE_ENCRYPTION_KEY: "test-timeline-encryption-secret-32-chars-minimum!!",
  VAULT_FILES: vaultFilesMock,
};

const ctx = await createVaultDatabase();
const { db } = ctx;

// Mock external Nominatim / OSRM responses deterministically for map proxy tests
let mockOsrmMode = "road"; // "road" | "fail"
let nominatimCalls = 0;

function buildWhere(searchParams) {
  const clauses = [];
  const params = [];
  for (const [key, val] of searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (!/^[a-z0-9_]+$/i.test(key)) continue;
    if (val.startsWith("eq.")) {
      params.push(val.slice(3));
      clauses.push(`"${key}" = $${params.length}`);
    } else if (val.startsWith("ilike.")) {
      params.push(val.slice(6));
      clauses.push(`"${key}" ilike $${params.length}`);
    } else if (val.startsWith("is.null")) {
      clauses.push(`"${key}" is null`);
    } else if (val.startsWith("in.(") && val.endsWith(")")) {
      const inner = val
        .slice(4, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      if (inner.length === 0) {
        clauses.push("false");
      } else {
        const placeholders = inner.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
        clauses.push(`"${key}" in (${placeholders.join(", ")})`);
      }
    }
  }
  return { sql: clauses.length ? ` where ${clauses.join(" and ")}` : "", params };
}

function buildOrder(orderStr) {
  if (!orderStr) return "";
  const parts = orderStr
    .split(",")
    .map((seg) => {
      const tokens = seg.trim().split(".");
      const col = tokens[0];
      if (!/^[a-z0-9_]+$/i.test(col)) return "";
      const dir = tokens[1] === "desc" ? "desc" : "asc";
      const nulls = tokens[2] === "nullslast" ? " nulls last" : tokens[2] === "nullsfirst" ? " nulls first" : "";
      return `"${col}" ${dir}${nulls}`;
    })
    .filter(Boolean);
  return parts.length ? ` order by ${parts.join(", ")}` : "";
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));

  // Mock Nominatim search endpoint
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    nominatimCalls += 1;
    const q = (url.searchParams.get("q") || "").toLowerCase();
    if (q.includes("sylhet")) {
      return Response.json([
        {
          place_id: 9012,
          name: "Sylhet",
          display_name: "Sylhet, Sylhet Division, Bangladesh",
          lat: "24.8949",
          lon: "91.8687",
        },
      ]);
    }
    return Response.json([]);
  }

  // Mock OSRM routing endpoints (both routing.openstreetmap.de and router.project-osrm.org)
  if (url.hostname.includes("project-osrm.org") || url.hostname.includes("routing.openstreetmap.de")) {
    if (mockOsrmMode === "fail") {
      return new Response("OSRM Temporarily Unavailable", { status: 503 });
    }
    return Response.json({
      code: "Ok",
      routes: [
        {
          distance: 392400,
          duration: 21400,
          geometry: {
            type: "LineString",
            coordinates: [
              [90.4125, 23.8103],
              [91.18, 23.46],
              [91.985, 21.4272],
            ],
          },
          legs: [{ distance: 392400, duration: 21400 }],
        },
      ],
    });
  }

  if (!url.pathname.startsWith("/rest/v1/")) return Response.json([]);
  const sub = url.pathname.slice("/rest/v1/".length);
  const method = (init.method || "GET").toUpperCase();

  if (sub.startsWith("rpc/")) {
    const fn = sub.slice(4);
    const args = init.body ? JSON.parse(init.body) : {};
    try {
      const result = await ctx.rpc(fn, args);
      return Response.json(result ?? null);
    } catch (err) {
      return Response.json({ code: err.code || "P0400", message: err.message }, { status: 400 });
    }
  }

  const table = sub.replace(/[^a-z0-9_]/gi, "");
  await db.exec("set role service_role");
  try {
    if (method === "GET") {
      const { sql: whereSql, params } = buildWhere(url.searchParams);
      const orderSql = buildOrder(url.searchParams.get("order"));
      const limit = url.searchParams.get("limit");
      const limitSql = limit && /^\d+$/.test(limit) ? ` limit ${Number(limit)}` : "";
      const res = await db.query(`select * from public."${table}"${whereSql}${orderSql}${limitSql}`, params);
      return Response.json(res.rows);
    }

    if (method === "POST") {
      const raw = JSON.parse(init.body || "{}");
      if (Array.isArray(raw) && raw.length > 1) {
        const firstKeys = Object.keys(raw[0]).sort().join(",");
        for (let i = 1; i < raw.length; i += 1) {
          if (Object.keys(raw[i]).sort().join(",") !== firstKeys) {
            return Response.json(
              { code: "PGRST102", message: "All object keys must match" },
              { status: 400 },
            );
          }
        }
      }
      const rows = Array.isArray(raw) ? raw : [raw];
      const inserted = [];
      for (const r of rows) {
        const keys = Object.keys(r).filter((k) => r[k] !== undefined);
        const cols = keys.map((k) => `"${k}"`).join(", ");
        const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
        const paramVals = keys.map((k) =>
          r[k] !== null && typeof r[k] === "object" && !Array.isArray(r[k]) ? JSON.stringify(r[k]) : r[k],
        );
        const q = keys.length
          ? `insert into public."${table}" (${cols}) values (${vals}) returning *`
          : `insert into public."${table}" default values returning *`;
        const res = await db.query(q, paramVals);
        inserted.push(res.rows[0]);
      }
      return Response.json(inserted, { status: 201 });
    }

    if (method === "PATCH") {
      const patch = JSON.parse(init.body || "{}");
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      const { sql: whereSql, params: whereParams } = buildWhere(url.searchParams);
      const setParts = keys.map((k, idx) => `"${k}" = $${whereParams.length + idx + 1}`);
      const setVals = keys.map((k) =>
        patch[k] !== null && typeof patch[k] === "object" && !Array.isArray(patch[k])
          ? JSON.stringify(patch[k])
          : patch[k],
      );
      const res = await db.query(
        `update public."${table}" set ${setParts.join(", ")}${whereSql} returning *`,
        [...whereParams, ...setVals],
      );
      return Response.json(res.rows);
    }

    if (method === "DELETE") {
      const { sql: whereSql, params } = buildWhere(url.searchParams);
      await db.query(`delete from public."${table}"${whereSql}`, params);
      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  } catch (err) {
    return Response.json({ code: err.code || "40000", message: err.message }, { status: 400 });
  } finally {
    await db.exec("reset role");
  }
};

async function loadProfile(id) {
  const { rows } = await db.query(`select id, login_id, email, full_name from public.profiles where id = $1`, [id]);
  return rows[0];
}

const ownerMember = await loadProfile((await ctx.addMember("travel-owner")).id);
const editorMember = await loadProfile((await ctx.addMember("travel-editor")).id);
const contribMember = await loadProfile((await ctx.addMember("travel-contrib")).id);
const viewerMember = await loadProfile((await ctx.addMember("travel-viewer")).id);
const outsiderMember = await loadProfile((await ctx.addMember("travel-outsider")).id);

// IMPORTANT: Always send `/api/travel-space/...` URLs so the exact Pages Functions pathname
// contract (`request.url` retaining `/api/...`) is exercised on every single call.
async function api(method, path, body, who = ownerMember) {
  const init = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await handleTravelSpace(
    new Request(`${ORIGIN}/api/travel-space${path}`, init),
    who,
    env,
    ORIGIN,
    { maxUploadMb: 25 },
  );
  const contentType = res.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body: data, headers: res.headers };
}

// ===========================================================================
// 1. SCHEMA, RLS & COORDINATE-ONLY DESTINATION PRIVACY AUDIT (SECTION 20)
// ===========================================================================

test("Schema & RLS: all TravelSpace tables + public.trip_destinations enable RLS with persora_jwt_uid() and strictly enforce coordinate-only destination columns", async () => {
  const rls = await db.query(
    `select relname, relrowsecurity
     from pg_class
     where relnamespace = 'public'::regnamespace
       and relkind = 'r'
       and (relname like 'travel_%' or relname = 'trip_destinations')
     order by relname`,
  );
  assert.equal(rls.rows.length, 14);
  for (const row of rls.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);
  }

  // Verify strict column whitelist on public.trip_destinations:
  // ONLY id, trip_id, latitude, longitude, order_index, created_at, updated_at
  const colsRes = await db.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public' and table_name = 'trip_destinations'
     order by ordinal_position`,
  );
  const colNames = colsRes.rows.map((r) => r.column_name);
  assert.deepEqual(colNames, [
    "id",
    "trip_id",
    "latitude",
    "longitude",
    "order_index",
    "created_at",
    "updated_at",
  ]);
  for (const forbidden of [
    "name",
    "destination_name",
    "place_name",
    "formatted_address",
    "destination_address",
    "location_title",
    "city",
    "country",
  ]) {
    assert.equal(colNames.includes(forbidden), false, `Forbidden column ${forbidden} must not exist`);
  }

  for (const file of [
    "../supabase/migrations/20261102000000_travel_space.sql",
    "../supabase/migrations/20261102120000_travel_space_map_destinations.sql",
  ]) {
    const sql = readFileSync(new URL(file, import.meta.url), "utf8").replace(/--.*$/gm, "");
    assert.ok(!/\bauth\.uid\s*\(/i.test(sql), `${file} must never use raw auth.uid()`);
    assert.ok(/public\.persora_jwt_uid\(\)/.test(sql), `${file} must use public.persora_jwt_uid()`);
  }
});

// ===========================================================================
// 2. PAGES FUNCTIONS `/api/travel-space/*` FULL REQUEST-CHAIN REGRESSION TEST
// ===========================================================================

test("Part A Regression: Pages Function catch-all `/api/travel-space/trips` creates, reloads, and persists multiple trips without `TravelSpace endpoint not found`", async () => {
  // Unauthenticated request to Pages Function -> 401 (never 404 endpoint not found)
  const unauthRes = await pagesApiOnRequest({
    request: new Request(`${ORIGIN}/api/travel-space/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ title: "Unauth Trip", startDate: "2026-11-10", endDate: "2026-11-12" }),
    }),
    env,
    waitUntil() {},
  });
  assert.equal(unauthRes.status, 401);

  // Unknown subroute returns structured 404 ENDPOINT_NOT_FOUND
  const unknownRes = await api("GET", "/nonexistent-route");
  assert.equal(unknownRes.status, 404);
  assert.equal(unknownRes.body.code, "ENDPOINT_NOT_FOUND");

  // Create Trip #1 via `/api/travel-space/trips` with coordinate-only stops (even if extra name fields are passed)
  const tripARes = await api("POST", "/trips", {
    title: "Sylhet Tea Gardens Escape",
    description: "Weekend retreat",
    startDate: "2026-11-14",
    endDate: "2026-11-16",
    companionType: "solo",
    personalBudget: 18000,
    primaryCurrency: "BDT",
    destinations: [
      {
        latitude: 23.8103,
        longitude: 90.4125,
        orderIndex: 0,
        // Even if caller supplies forbidden fields, backend MUST strip and never persist them:
        name: "Should Never Persist",
        destination_name: "Should Never Persist",
        formatted_address: "123 Secret St",
      },
      {
        latitude: 24.8949,
        longitude: 91.8687,
        orderIndex: 1,
      },
    ],
    initialTasks: [{ title: "Confirm train seat", priority: "high" }],
  });
  assert.equal(tripARes.status, 201);
  assert.equal(tripARes.body.destinations.length, 2);
  assert.equal("name" in tripARes.body.destinations[0], false);
  assert.equal("destination_name" in tripARes.body.destinations[0], false);
  assert.equal("formatted_address" in tripARes.body.destinations[0], false);
  assert.equal(tripARes.body.destinations[0].latitude, 23.8103);
  assert.equal(tripARes.body.destinations[0].longitude, 90.4125);
  assert.equal(tripARes.body.destinations[0].orderIndex, 0);
  assert.equal(tripARes.body.destinations[1].orderIndex, 1);

  // Create Trip #2 in sequence (proving multiple trip creations work cleanly)
  const tripBRes = await api("POST", "/trips", {
    title: "Bandarban Cloud Trail",
    startDate: "2026-12-01",
    endDate: "2026-12-03",
    companionType: "couple",
    travelerCount: 2,
    budgetScope: "personal",
    personalBudget: 25000,
    primaryCurrency: "BDT",
    destinations: [], // 0 destinations allowed (Step 2 is optional)
  });
  assert.equal(tripBRes.status, 201);
  assert.equal(tripBRes.body.destinations.length, 0);

  // Reload bootstrap and verify both trips persist cleanly
  const boot = await api("GET", "/bootstrap");
  assert.equal(boot.status, 200);
  assert.ok(boot.body.trips.some((t) => t.id === tripARes.body.trip.id));
  assert.ok(boot.body.trips.some((t) => t.id === tripBRes.body.trip.id));

  // Clean up Trip A & B into Trash so subsequent assertions start clean
  await api("DELETE", `/trips/${tripARes.body.trip.id}`);
  await api("DELETE", `/trips/${tripBRes.body.trip.id}`);
});

// ===========================================================================
// 3. PURE RULES ENGINE: DATES, COORDINATES, GOOGLE MAPS URLS, BUDGETS & SPLITS
// ===========================================================================

test("Pure Rules: validates dates, coordinate-only destinations, Google Maps URL parser/exporter, solo vs group budget scope, and minor-unit splits", () => {
  // End date before start date rejected
  assert.throws(
    () =>
      sanitizeTripInput({
        title: "Invalid Dates",
        startDate: "2026-12-10",
        endDate: "2026-12-05",
        companionType: "solo",
        destinations: [],
      }),
    TravelValidationError,
  );

  // Invalid coordinates rejected
  assert.throws(
    () => sanitizeTripDestinations([{ latitude: 105, longitude: 90.4 }]),
    TravelValidationError,
  );

  // Valid coordinate destinations strip all name/address properties
  const cleanStops = sanitizeTripDestinations([
    { latitude: 23.810331, longitude: 90.412518, name: "Dhaka", formatted_address: "Ignored" },
    { latitude: 21.427229, longitude: 91.984982, place_name: "Cox's Bazar" },
  ]);
  assert.equal(cleanStops.length, 2);
  assert.deepEqual(Object.keys(cleanStops[0]).filter((k) => cleanStops[0][k] !== undefined).sort(), [
    "latitude",
    "longitude",
    "orderIndex",
  ]);
  assert.equal("name" in cleanStops[0], false);
  assert.equal("formatted_address" in cleanStops[0], false);
  assert.equal(cleanStops[0].orderIndex, 0);
  assert.equal(cleanStops[1].orderIndex, 1);

  // Google Maps coordinate & URL parser tests
  const directPair = parseGoogleMapsInput("23.8103, 90.4125");
  assert.equal(directPair.ok, true);
  assert.equal(directPair.latitude, 23.8103);
  assert.equal(directPair.longitude, 90.4125);

  const atUrl = parseGoogleMapsInput("https://www.google.com/maps/place/Cox's+Bazar/@21.4272,91.985,13z");
  assert.equal(atUrl.ok, true);
  assert.equal(atUrl.latitude, 21.4272);
  assert.equal(atUrl.longitude, 91.985);

  const bangUrl = parseGoogleMapsInput(
    "https://www.google.com/maps/place/SomePlace/@21.40,91.90,12z/data=!3d21.427229!4d91.984982",
  );
  assert.equal(bangUrl.ok, true);
  assert.equal(bangUrl.latitude, 21.427229);
  assert.equal(bangUrl.longitude, 91.984982);

  const queryUrl = parseGoogleMapsInput("https://maps.google.com/?q=24.8949,91.8687");
  assert.equal(queryUrl.ok, true);
  assert.equal(queryUrl.latitude, 24.8949);
  assert.equal(queryUrl.longitude, 91.8687);

  const shortUrl = parseGoogleMapsInput("https://maps.app.goo.gl/abc123xyz");
  assert.equal(shortUrl.ok, false);
  assert.equal(shortUrl.isShortLink, true);

  const gmapsPoint = buildGoogleMapsPlaceUrl(23.8103, 90.4125);
  assert.ok(gmapsPoint.includes("23.8103,90.4125"));

  const gmapsDir = buildGoogleMapsDirectionsUrl(
    [
      { latitude: 23.8103, longitude: 90.4125 },
      { latitude: 24.3, longitude: 91.4 },
      { latitude: 24.8949, longitude: 91.8687 },
    ],
    "cycling",
  );
  assert.ok(gmapsDir.includes("origin=23.8103%2C90.4125") || gmapsDir.includes("origin=23.8103,90.4125"));
  assert.ok(gmapsDir.includes("travelmode=bicycling"));

  // Initial tasks sanitizer
  const initTasks = sanitizeInitialTasks([{ title: "Visa photo", priority: "high", dueDate: "2026-11-05" }]);
  assert.equal(initTasks.length, 1);
  assert.equal(initTasks[0].priority, "high");

  // Solo auto-locks travelerCount = 1 and forces group scope back to personal
  const solo = sanitizeTripInput({
    title: "Solo Kyoto Retreat",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    companionType: "solo",
    travelerCount: 5,
    budgetScope: "group",
    personalBudget: 50000,
    primaryCurrency: "BDT",
    destinations: [{ latitude: 35.0116, longitude: 135.7681 }],
  });
  assert.equal(solo.travelerCount, 1);
  assert.equal(solo.budgetScope, "personal");
  assert.equal(generateTripDays(solo.startDate, solo.endDate).length, 3);

  // Equal minor-unit split of 100.00 (10000 paisa) across 3 people -> 3334 + 3333 + 3333 = 10000
  const shares = splitEqualMinor(10000, 3);
  assert.deepEqual(shares, [3334, 3333, 3333]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 10000);

  // Category allocations cannot exceed planned budget
  assert.throws(
    () =>
      sanitizeBudgetCategories(
        [
          { name: "Transportation", allocatedAmount: 35000 },
          { name: "Meals", allocatedAmount: 20000 },
        ],
        5000000,
        "BDT",
      ),
    TravelValidationError,
  );

  // Planned contributions are NEVER treated as collected funds
  const contrib = computeContributionSummary(
    [
      { plannedAmount: 10000, contributedAmount: 4000 },
      { plannedAmount: 10000, contributedAmount: 0 },
    ],
    "BDT",
  );
  assert.equal(contrib.totalPlanned, 20000);
  assert.equal(contrib.totalCollected, 4000);
  assert.equal(contrib.totalPending, 16000);
});

// ===========================================================================
// 4. MAP SEARCH, OSRM ROAD ROUTING & STRAIGHT-LINE FALLBACK PROXIES
// ===========================================================================

test("Map Search & Routing Proxies: caches Nominatim queries, returns road geometry from OSRM, and degrades honestly to straight-line preview on OSRM failure", async () => {
  nominatimCalls = 0;
  const search1 = await api("GET", "/map/search?q=Sylhet+Division");
  assert.equal(search1.status, 200);
  assert.ok(search1.body.results.length >= 1);
  assert.equal(nominatimCalls, 1);

  // Repeat identical query -> served from server cache without hitting Nominatim again
  const search2 = await api("GET", "/map/search?q=sylhet+division");
  assert.equal(search2.status, 200);
  assert.equal(nominatimCalls, 1, "Cached search query must not hit Nominatim a second time");

  // Road routing via OSRM
  mockOsrmMode = "road";
  const routeOk = await api("POST", "/map/route", {
    mode: "driving",
    coordinates: [
      { latitude: 23.8103, longitude: 90.4125 },
      { latitude: 21.4272, longitude: 91.985 },
    ],
  });
  assert.equal(routeOk.status, 200);
  assert.equal(routeOk.body.isFallback, false);
  assert.equal(routeOk.body.distanceMeters, 392400);
  assert.equal(routeOk.body.durationSeconds, 21400);
  assert.equal(routeOk.body.geometry.length, 3);

  // OSRM failure -> returns explicit straight-line fallback (`isFallback: true`, null distance/duration — never invented!)
  mockOsrmMode = "fail";
  const routeFallback = await api("POST", "/map/route", {
    mode: "walking",
    coordinates: [
      { latitude: 23.8103, longitude: 90.4125 },
      { latitude: 21.4272, longitude: 91.985 },
    ],
  });
  assert.equal(routeFallback.status, 200);
  assert.equal(routeFallback.body.isFallback, true);
  assert.equal(routeFallback.body.distanceMeters, null);
  assert.equal(routeFallback.body.durationSeconds, null);
  mockOsrmMode = "road";
});

// ===========================================================================
// 5. CREATE GROUP TRIP + MAP REORDERING + UNIFIED KANBAN <-> ITINERARY SYNC
// ===========================================================================

let sharedTripId = "";

test("Create Group Trip (idempotent) + Coordinate Stop Reordering + Unified Kanban/Itinerary scheduling with zero duplication", async () => {
  const clientTripId = crypto.randomUUID();
  const createRes = await api("POST", "/trips", {
    id: clientTripId,
    title: "Cox's Bazar & Saint Martin Tour",
    description: "Annual coastal friends expedition",
    startDate: "2026-11-20",
    endDate: "2026-11-22",
    companionType: "friends",
    travelerCount: 3,
    tripType: "vacation",
    primaryCurrency: "BDT",
    budgetScope: "group",
    destinations: [
      { latitude: 21.4272, longitude: 91.985, orderIndex: 0 },
      { latitude: 20.6237, longitude: 92.3234, orderIndex: 1 },
    ],
    travellers: [
      { fullName: editorMember.full_name, email: editorMember.email, userId: editorMember.id, role: "editor" },
      { fullName: contribMember.full_name, email: contribMember.email, userId: contribMember.id, role: "expense_contributor" },
    ],
    contributions: [
      { plannedAmount: 15000, contributedAmount: 15000, note: "Owner paid" },
      { plannedAmount: 15000, contributedAmount: 5000, note: "Partial deposit" },
      { plannedAmount: 15000, contributedAmount: 0, note: "Pending" },
    ],
    categories: [
      { name: "Transportation", allocatedAmount: 15000, isDefault: true },
      { name: "Meals", allocatedAmount: 10000, isDefault: true },
      { name: "Accommodation", allocatedAmount: 15000, isDefault: true },
      { name: "Activities", allocatedAmount: 3000, isDefault: true },
      { name: "Others", allocatedAmount: 2000, isDefault: true },
    ],
    initialTasks: [
      { title: "Book ship tickets", priority: "high", status: "todo" },
      { title: "Pack reef-safe sunscreen", priority: "normal", status: "todo" },
    ],
  });

  assert.equal(createRes.status, 201);
  const ws = createRes.body;
  sharedTripId = ws.trip.id;
  assert.equal(sharedTripId, clientTripId);
  assert.equal(ws.trip.status, "planning");
  assert.equal(ws.days.length, 3);
  assert.equal(ws.destinations.length, 2);
  assert.equal(ws.travellers.length, 3);
  assert.equal(ws.items.length, 2);
  assert.equal(ws.budgetOverview.totalPlannedBudget, 45000);
  assert.equal(ws.budgetOverview.totalCollected, 20000);
  assert.equal(ws.budgetOverview.totalPendingContributions, 25000);

  // Reorder destinations via PUT /trips/:id/destinations (Editor allowed, Expense Contributor forbidden)
  const reorderForbidden = await api(
    "PUT",
    `/trips/${sharedTripId}/destinations`,
    {
      destinations: [
        { latitude: 20.6237, longitude: 92.3234, orderIndex: 0 },
        { latitude: 21.4272, longitude: 91.985, orderIndex: 1 },
      ],
    },
    contribMember,
  );
  assert.equal(reorderForbidden.status, 403);

  const reorderOk = await api(
    "PUT",
    `/trips/${sharedTripId}/destinations`,
    {
      destinations: [
        { latitude: 23.8103, longitude: 90.4125, orderIndex: 0 },
        { latitude: 21.4272, longitude: 91.985, orderIndex: 1 },
        { latitude: 20.6237, longitude: 92.3234, orderIndex: 2 },
      ],
    },
    editorMember,
  );
  assert.equal(reorderOk.status, 200);
  assert.equal(reorderOk.body.destinations.length, 3);
  assert.equal(reorderOk.body.destinations[0].latitude, 23.8103);
  assert.equal(reorderOk.body.destinations[2].orderIndex, 2);

  // Idempotent retry with same client ID does NOT duplicate trip or child rows!
  const retryRes = await api("POST", "/trips", { id: clientTripId, title: "Duplicate Attempt" });
  assert.equal(retryRes.status, 201);
  assert.equal(retryRes.body.items.length, 2);

  // Schedule Task #1 onto Day 1 (2026-11-20) WITH coordinates -> SAME record ID, NO duplication!
  const task1 = ws.items[0];
  const schedRes = await api("PATCH", `/trips/${sharedTripId}/items/${task1.id}`, {
    scheduledDate: "2026-11-20",
    startTime: "09:00",
    endTime: "11:00",
    location: "Teknaf Jetty",
    latitude: 20.8644,
    longitude: 92.2985,
  });
  assert.equal(schedRes.status, 200);
  assert.equal(schedRes.body.items.length, 2, "Scheduling must never create duplicate records");
  const updated1 = schedRes.body.items.find((i) => i.id === task1.id);
  assert.equal(updated1.scheduledDate, "2026-11-20");
  assert.equal(updated1.latitude, 20.8644);
  assert.equal(updated1.longitude, 92.2985);

  // Move Task #1 to Kanban 'in_progress' -> scheduledDate & coordinates stay intact!
  const moveColRes = await api("POST", `/trips/${sharedTripId}/items/reorder`, {
    updates: [{ id: task1.id, status: "in_progress", kanbanSortOrder: 0 }],
  });
  assert.equal(moveColRes.status, 200);
  const afterKanban = moveColRes.body.items.find((i) => i.id === task1.id);
  assert.equal(afterKanban.status, "in_progress");
  assert.equal(afterKanban.scheduledDate, "2026-11-20");

  // Add a second overlapping activity on 2026-11-20 (10:00 - 12:00) to verify overlap detection
  const overlapRes = await api("POST", `/trips/${sharedTripId}/items`, {
    title: "Beach kayak session",
    scheduledDate: "2026-11-20",
    startTime: "10:00",
    endTime: "12:00",
    status: "todo",
  });
  assert.equal(overlapRes.status, 201);
  assert.equal(overlapRes.body.overlaps.conflicts.length, 1);

  // Move activity to Day 2 (2026-11-21) -> overlap clears!
  const kayakItem = overlapRes.body.items.find((i) => i.title === "Beach kayak session");
  const moveDayRes = await api("PATCH", `/trips/${sharedTripId}/items/${kayakItem.id}`, {
    scheduledDate: "2026-11-21",
  });
  assert.equal(moveDayRes.body.overlaps.conflicts.length, 0);

  // Unschedule back to task list -> task still exists with scheduledDate = null!
  const unschedRes = await api("PATCH", `/trips/${sharedTripId}/items/${kayakItem.id}`, {
    scheduledDate: null,
  });
  const unschedItem = unschedRes.body.items.find((i) => i.id === kayakItem.id);
  assert.equal(unschedItem.scheduledDate, null);
  assert.equal(unschedItem.startTime, null);
  assert.equal(unschedRes.body.items.length, 3);
});

// ===========================================================================
// 6. EXPENSES, SPLITS, ROUNDING, MULTI-CURRENCY & SETTLEMENTS
// ===========================================================================

test("Expenses, Equal/Custom Splits, Multi-Currency & Settlements", async () => {
  const ws0 = (await api("GET", `/trips/${sharedTripId}`)).body;
  const [ownerTrav, editorTrav, contribTrav] = ws0.travellers;

  const eqRes = await api("POST", `/trips/${sharedTripId}/expenses`, {
    title: "Speedboat charter",
    amount: 1000,
    currency: "BDT",
    expenseDate: "2026-11-20",
    categoryName: "Transportation",
    expenseType: "shared",
    paidByTravellerId: ownerTrav.id,
    splitMethod: "equal",
    participantIds: [ownerTrav.id, editorTrav.id, contribTrav.id],
  });
  assert.equal(eqRes.status, 201);
  const charterExp = eqRes.body.expenses.find((e) => e.title === "Speedboat charter");
  const splitSum = charterExp.splits.reduce((s, x) => s + Math.round(x.shareAmount * 100), 0);
  assert.equal(splitSum, 100000);

  const badCustom = await api("POST", `/trips/${sharedTripId}/expenses`, {
    title: "Bad Custom Split",
    amount: 500,
    currency: "BDT",
    expenseDate: "2026-11-20",
    categoryName: "Meals",
    expenseType: "shared",
    paidByTravellerId: ownerTrav.id,
    splitMethod: "custom",
    customSplits: [
      { travellerId: ownerTrav.id, amount: 200 },
      { travellerId: editorTrav.id, amount: 200 },
    ],
  });
  assert.equal(badCustom.status, 400);

  const usdRes = await api("POST", `/trips/${sharedTripId}/expenses`, {
    title: "Coral reef diving gear",
    amount: 50,
    currency: "USD",
    exchangeRate: 120.5,
    convertedOn: "2026-11-21",
    expenseDate: "2026-11-21",
    categoryName: "Activities",
    expenseType: "shared",
    paidByTravellerId: editorTrav.id,
    splitMethod: "custom",
    customSplits: [
      { travellerId: ownerTrav.id, amount: 20 },
      { travellerId: editorTrav.id, amount: 30 },
    ],
  });
  assert.equal(usdRes.status, 201);
  const usdExp = usdRes.body.expenses.find((e) => e.title === "Coral reef diving gear");
  assert.equal(usdExp.amount, 50);
  assert.equal(usdExp.currency, "USD");
  assert.equal(usdExp.tripAmount, 6025);

  const persRes = await api("POST", `/trips/${sharedTripId}/expenses`, {
    title: "Souvenir shells",
    amount: 600,
    currency: "BDT",
    expenseDate: "2026-11-21",
    categoryName: "Others",
    expenseType: "personal",
    paidByTravellerId: ownerTrav.id,
    paidFromGroupFund: false,
  });
  assert.equal(persRes.status, 201);
  const bOverview = persRes.body.budgetOverview;
  assert.equal(bOverview.totalPlannedBudget, 45000);
  assert.equal(bOverview.personalExpenses, 600);
  assert.equal(bOverview.sharedExpenses, 7025);
  assert.equal(bOverview.budgetUsed, 7025);

  const settleRes = await api("POST", `/trips/${sharedTripId}/settlements`, {
    fromTravellerId: contribTrav.id,
    toTravellerId: ownerTrav.id,
    amount: 333.33,
    settledOn: "2026-11-22",
    method: "bKash",
  });
  assert.equal(settleRes.status, 201);
  const contribAfter = settleRes.body.budgetOverview.balances.find((b) => b.travellerId === contribTrav.id);
  assert.equal(contribAfter.settled, true);
  assert.equal(contribAfter.owes, 0);
});

// ===========================================================================
// 7. MULTI-USER SERVER-SIDE RBAC & PRIVATE FILE PROTECTION
// ===========================================================================

test("Server-side RBAC enforces Owner, Editor, Expense Contributor, Viewer, and Outsider boundaries", async () => {
  const addViewer = await api("POST", `/trips/${sharedTripId}/travellers`, {
    memberQuery: viewerMember.email,
    role: "viewer",
  });
  assert.equal(addViewer.status, 201);

  const outsiderGet = await api("GET", `/trips/${sharedTripId}`, undefined, outsiderMember);
  assert.equal(outsiderGet.status, 404);

  const viewerGet = await api("GET", `/trips/${sharedTripId}`, undefined, viewerMember);
  assert.equal(viewerGet.status, 200);
  const viewerTask = await api("POST", `/trips/${sharedTripId}/items`, { title: "Unauthorized" }, viewerMember);
  assert.equal(viewerTask.status, 403);
  assert.equal(viewerTask.body.code, "PERMISSION_DENIED");

  const contribTrav = viewerGet.body.travellers.find((t) => t.userId === contribMember.id);
  const contribExp = await api(
    "POST",
    `/trips/${sharedTripId}/expenses`,
    {
      title: "Coconut water",
      amount: 120,
      currency: "BDT",
      expenseDate: "2026-11-21",
      categoryName: "Meals",
      expenseType: "personal",
      paidByTravellerId: contribTrav.id,
    },
    contribMember,
  );
  assert.equal(contribExp.status, 201);

  const ownersExpense = contribExp.body.expenses.find((e) => e.title === "Souvenir shells");
  const hijackAttempt = await api(
    "DELETE",
    `/trips/${sharedTripId}/expenses/${ownersExpense.id}`,
    undefined,
    contribMember,
  );
  assert.equal(hijackAttempt.status, 403);

  const editorBooking = await api(
    "POST",
    `/trips/${sharedTripId}/bookings`,
    {
      category: "hotel",
      title: "Sayeman Beach Resort",
      provider: "Sayeman",
      bookingReference: "SBR-8821",
      startDate: "2026-11-20",
      endDate: "2026-11-22",
      price: 18000,
      currency: "BDT",
      paymentStatus: "paid",
      bookingStatus: "confirmed",
    },
    editorMember,
  );
  assert.equal(editorBooking.status, 201);

  const editorDeleteTrip = await api("DELETE", `/trips/${sharedTripId}`, undefined, editorMember);
  assert.equal(editorDeleteTrip.status, 403);

  const privDoc = await api("POST", `/trips/${sharedTripId}/documents`, {
    title: "Owner Passport Scan",
    docCategory: "passport",
    sourceType: "upload",
    isPrivate: true,
  });
  assert.equal(privDoc.status, 201);
  const docId = privDoc.body.documents[0].id;

  const form = new FormData();
  form.set("kind", "document");
  form.set("targetId", docId);
  form.set("file", new File([new Uint8Array([37, 80, 68, 70])], "passport.pdf", { type: "application/pdf" }));
  const uploadRes = await api("POST", `/trips/${sharedTripId}/upload`, form, ownerMember);
  assert.equal(uploadRes.status, 200);
  assert.equal("file_key" in uploadRes.body.documents[0], false);
  assert.equal("fileKey" in uploadRes.body.documents[0], false);

  const viewerFileSteal = await api("GET", `/trips/${sharedTripId}/files/document/${docId}`, undefined, viewerMember);
  assert.equal(viewerFileSteal.status, 403);

  const ownerFileRead = await api("GET", `/trips/${sharedTripId}/files/document/${docId}`, undefined, ownerMember);
  assert.equal(ownerFileRead.status, 200);
});

// ===========================================================================
// 8. EXPLORE DUAL ACTIONS (`add-to-trip` vs `add-to-itinerary`), COMPLETE TRIP, TIMELINE & TRASH
// ===========================================================================

test("Explore dual actions (Add to Trip destinations vs Add to Itinerary items), Complete Trip -> Life Timeline, and 7-day Trash restore", async () => {
  const savePlace = await api("POST", "/explore", {
    name: "Himchari Waterfall",
    kind: "attraction",
    city: "Cox's Bazar",
    country: "Bangladesh",
    status: "want_to_visit",
    estimatedCost: 500,
    currency: "BDT",
    latitude: 21.3514,
    longitude: 92.0256,
  });
  assert.equal(savePlace.status, 201);
  const placeId = savePlace.body.place.id;
  assert.equal(savePlace.body.place.latitude, 21.3514);

  // Action 1: Add to Trip -> appends ONLY coordinates + order_index to public.trip_destinations
  const addStopRes = await api("POST", `/explore/${placeId}/add-to-trip`, {
    tripId: sharedTripId,
  });
  assert.equal(addStopRes.status, 201);
  const newStop = addStopRes.body.destination;
  assert.equal(newStop.latitude, 21.3514);
  assert.equal(newStop.longitude, 92.0256);
  assert.equal(newStop.orderIndex, 3);
  assert.equal("name" in newStop, false);
  const wsAfterStop = (await api("GET", `/trips/${sharedTripId}`)).body;
  assert.equal(wsAfterStop.destinations.length, 4);

  // Action 2: Add to Itinerary -> creates a single travel_trip_items record with coordinates
  const addItinRes = await api("POST", `/explore/${placeId}/add-to-itinerary`, {
    tripId: sharedTripId,
    scheduledDate: "2026-11-21",
  });
  assert.equal(addItinRes.status, 201);
  assert.equal(addItinRes.body.item.scheduledDate, "2026-11-21");
  assert.equal(addItinRes.body.item.latitude, 21.3514);

  // Add a Travel Journal memory
  const memRes = await api("POST", `/trips/${sharedTripId}/memories`, {
    memoryType: "journal",
    title: "Starlight over Saint Martin",
    journalBody: "Clear skies and bioluminescent waves along the coral shore.",
    memoryDate: "2026-11-21",
    favorite: true,
  });
  assert.equal(memRes.status, 201);

  // Complete Trip -> Life Timeline milestone
  const bookingId = memRes.body.bookings[0].id;
  const completeRes = await api("POST", `/trips/${sharedTripId}/complete`, {
    actualReturnDate: "2026-11-22",
    rating: 5,
    completionNotes: "Unforgettable coastal trip with friends.",
    createTimelineEvent: true,
    bookingUpdates: [{ id: bookingId, bookingStatus: "completed" }],
  });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.body.trip.status, "completed");
  assert.ok(completeRes.body.trip.timelineEventId);

  const tlRes = await handleTimeline(
    new Request(`${ORIGIN}/timeline`, { method: "GET" }),
    ownerMember,
    env,
    ORIGIN,
  );
  const tlData = await tlRes.json();
  const tlEvents = Array.isArray(tlData) ? tlData : tlData.events || [];
  assert.ok(tlEvents.some((ev) => ev.id === completeRes.body.trip.timelineEventId));

  // Account Backup Export includes trips, coordinate-only tripDestinations & explorePlaces
  const exported = await exportTravelSpaceData(ownerMember.id, env);
  assert.equal(exported.trips.length, 1);
  assert.equal(exported.tripDestinations.length, 4);
  assert.equal("name" in exported.tripDestinations[0], false);

  // Move Trip to 7-day Global Trash and Restore with ALL coordinate destinations & child relations intact!
  const delRes = await api("DELETE", `/trips/${sharedTripId}`, undefined, ownerMember);
  assert.equal(delRes.status, 200);
  assert.equal((await api("GET", `/trips/${sharedTripId}`, undefined, ownerMember)).status, 404);

  const restoreResult = await ctx.rpc("persora_travel_trip_trash_restore", {
    p_owner: ownerMember.id,
    p_trash_id: sharedTripId,
  });
  assert.equal(restoreResult.ok, true);

  const restoredWs = await api("GET", `/trips/${sharedTripId}`, undefined, ownerMember);
  assert.equal(restoredWs.status, 200);
  assert.equal(restoredWs.body.trip.status, "completed");
  assert.equal(restoredWs.body.destinations.length, 4);
  assert.equal(restoredWs.body.destinations[3].latitude, 21.3514);
  assert.equal(restoredWs.body.travellers.length, 4);
  assert.equal(restoredWs.body.expenses.length, 4);
  assert.equal(restoredWs.body.memories.length, 1);
});

test("Mixed group travellers (owner + unsynced contact + Persora email + temporary + placeholder) pass PostgREST PGRST102 and preserve expense category_id on budget updates", async () => {
  const unsyncedLocalContactId = "11111111-2222-4333-8444-555555555555";
  const createRes = await api("POST", "/trips", {
    title: "Sundarbans River Expedition",
    startDate: "2026-12-10",
    endDate: "2026-12-14",
    companionType: "group",
    travelerCount: 5,
    primaryCurrency: "BDT",
    budgetScope: "group",
    travellers: [
      {
        fullName: "Nadia Contact",
        email: "nadia.local@example.com",
        phone: "+8801711000000",
        contactId: unsyncedLocalContactId,
        role: "editor",
        responsibility: "Logistics",
      },
      {
        fullName: editorMember.full_name,
        email: editorMember.email,
        role: "editor",
      },
      {
        fullName: "Tariq Guest",
        role: "expense_contributor",
      },
    ],
    contributions: [
      { fullName: ownerMember.full_name, plannedAmount: 10000, contributedAmount: 10000 },
      { fullName: "Nadia Contact", plannedAmount: 10000, contributedAmount: 5000 },
      { fullName: editorMember.full_name, plannedAmount: 10000, contributedAmount: 10000 },
      { fullName: "Tariq Guest", plannedAmount: 10000, contributedAmount: 0 },
      { fullName: "Traveller 5", plannedAmount: 10000, contributedAmount: 0 },
    ],
    categories: [
      { name: "Accommodation", color: "blue", isDefault: true, allocatedAmount: 20000 },
      { name: "Boat Charter", color: "emerald", isDefault: false, allocatedAmount: 15000 },
    ],
  });

  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  assert.equal(createRes.body.travellers.length, 5);
  // Unsynced local contact ID falls back to null instead of failing FK 23503
  const nadia = createRes.body.travellers.find((t) => t.fullName === "Nadia Contact");
  assert.ok(nadia);
  assert.equal(nadia.contactId, null);
  // Persora member matched by email gets userId resolved automatically
  const editorTrav = createRes.body.travellers.find((t) => t.email === editorMember.email);
  assert.equal(editorTrav.userId, editorMember.id);
  // 5th traveller auto-populated cleanly with uniform keys
  assert.equal(createRes.body.travellers[4].fullName, "Traveller 5");

  const tripId = createRes.body.trip.id;
  const boatCat = createRes.body.categories.find((c) => c.name === "Boat Charter");
  assert.ok(boatCat?.id);

  const expRes = await api("POST", `/trips/${tripId}/expenses`, {
    title: "Launch cabin deposit",
    amount: 8000,
    currency: "BDT",
    expenseDate: "2026-12-10",
    categoryId: boatCat.id,
    categoryName: boatCat.name,
    expenseType: "shared",
    paidByTravellerId: createRes.body.travellers[0].id,
    paidFromGroupFund: true,
    splitMethod: "equal",
    participantIds: createRes.body.travellers.map((t) => t.id),
  });
  assert.equal(expRes.status, 201);
  assert.equal(expRes.body.expenses[0].categoryId, boatCat.id);

  // Updating budget allocations preserves existing category UUID so expense.categoryId is NOT wiped to null!
  const budgetRes = await api("PUT", `/trips/${tripId}/budget`, {
    budgetScope: "group",
    categories: [
      { id: boatCat.id, name: "Boat Charter", color: "emerald", isDefault: false, allocatedAmount: 18000 },
      { name: "Accommodation", color: "blue", isDefault: true, allocatedAmount: 20000 },
    ],
    contributions: createRes.body.contributions,
  });
  assert.equal(budgetRes.status, 200);
  assert.equal(budgetRes.body.expenses[0].categoryId, boatCat.id);
});

// ===========================================================================
// 10. TRIP COVER IMAGE R2 PERSISTENCE, REPLACE/REMOVE CLEANUP, DUPLICATE & AUTH
// ===========================================================================

test("Trip cover image flow: image-only validation, R2 key-only DB storage, replace/remove cleanup, duplicate reference safety, and unauthorized protection", async () => {
  // 1. Create a trip with no cover -> hasCover is false
  const createRes = await api("POST", "/trips", {
    title: "Saint Martin Coral Reef",
    startDate: "2026-12-20",
    endDate: "2026-12-23",
    companionType: "couple",
    travelerCount: 2,
    primaryCurrency: "BDT",
    budgetScope: "personal",
    personalBudget: 28000,
  });
  assert.equal(createRes.status, 201);
  const tripId = createRes.body.trip.id;
  assert.equal(createRes.body.trip.hasCover, false);
  assert.equal(createRes.body.trip.coverUpdatedAt, null);

  // 2. Reject non-image cover upload (e.g. PDF) with 400 INVALID_IMAGE_TYPE
  const badForm = new FormData();
  badForm.set("kind", "cover");
  badForm.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "itinerary.pdf", { type: "application/pdf" }));
  const badUpload = await api("POST", `/trips/${tripId}/upload`, badForm);
  assert.equal(badUpload.status, 400);
  assert.equal(badUpload.body.code, "INVALID_IMAGE_TYPE");

  // 3. Upload valid PNG cover image -> saved in R2 VAULT_FILES, DB stores ONLY R2 key (never base64/blob/URL)
  const pngBytesA = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const formA = new FormData();
  formA.set("kind", "cover");
  formA.set("file", new File([pngBytesA], "coral-bay.png", { type: "image/png" }));
  const uploadARes = await api("POST", `/trips/${tripId}/upload`, formA);
  assert.equal(uploadARes.status, 200);
  assert.equal(uploadARes.body.trip.hasCover, true);
  assert.equal(uploadARes.body.trip.coverFileName, "coral-bay.png");
  assert.equal(uploadARes.body.trip.coverFileType, "image/png");
  assert.ok(uploadARes.body.trip.coverUpdatedAt);

  const dbRowA = (await db.query(`select cover_file_key, cover_file_name, cover_file_size, cover_file_type from public.travel_trips where id = $1`, [tripId])).rows[0];
  assert.ok(dbRowA.cover_file_key.startsWith(`${ownerMember.id}/travel-space/${tripId}/`));
  assert.ok(!dbRowA.cover_file_key.startsWith("data:"), "DB must never store base64 data URLs");
  assert.ok(!dbRowA.cover_file_key.startsWith("blob:"), "DB must never store temporary blob URLs");
  assert.ok(!dbRowA.cover_file_key.startsWith("http"), "DB must never store signed/public URLs");
  assert.equal(bucketMap.has(dbRowA.cover_file_key), true, "Cover image bytes must exist in private R2");

  // 4. Authorized owner & invited viewer can stream GET /files/cover; outsider gets 404; unauthenticated gets 401
  const addViewer = await api("POST", `/trips/${tripId}/travellers`, {
    memberQuery: viewerMember.email,
    role: "viewer",
  });
  assert.equal(addViewer.status, 201);

  const ownerStream = await api("GET", `/trips/${tripId}/files/cover`, undefined, ownerMember);
  assert.equal(ownerStream.status, 200);
  assert.equal(ownerStream.headers.get("Content-Type"), "image/png");
  assert.equal(ownerStream.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(new Uint8Array(ownerStream.body), pngBytesA);

  const viewerStream = await api("GET", `/trips/${tripId}/files/cover`, undefined, viewerMember);
  assert.equal(viewerStream.status, 200);

  const outsiderStream = await api("GET", `/trips/${tripId}/files/cover`, undefined, outsiderMember);
  assert.equal(outsiderStream.status, 404);

  const unauthStream = await pagesApiOnRequest({
    request: new Request(`${ORIGIN}/api/travel-space/trips/${tripId}/files/cover`, {
      method: "GET",
      headers: { Origin: ORIGIN },
    }),
    env,
    waitUntil() {},
  });
  assert.equal(unauthStream.status, 401);

  // 5. Duplicate trip -> copies cover into an independent R2 object so replacing/removing original never breaks copy
  const dupRes = await api("POST", `/trips/${tripId}/duplicate`);
  assert.equal(dupRes.status, 201);
  const dupTripId = dupRes.body.trip.id;
  assert.equal(dupRes.body.trip.title, "Saint Martin Coral Reef (Copy)");
  assert.equal(dupRes.body.trip.hasCover, true);
  const dupDbRow = (await db.query(`select cover_file_key from public.travel_trips where id = $1`, [dupTripId])).rows[0];
  assert.notEqual(dupDbRow.cover_file_key, dbRowA.cover_file_key, "Duplicated trip gets independent R2 object key");
  assert.equal(bucketMap.has(dupDbRow.cover_file_key), true);

  // 6. Replace cover image on original trip -> saves new R2 key first, deletes old R2 object, preserves duplicate's R2 object
  const webpBytesB = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80]);
  const formB = new FormData();
  formB.set("kind", "cover");
  formB.set("file", new File([webpBytesB], "sunset-shore.webp", { type: "image/webp" }));
  const uploadBRes = await api("POST", `/trips/${tripId}/upload`, formB);
  assert.equal(uploadBRes.status, 200);
  assert.equal(uploadBRes.body.trip.coverFileName, "sunset-shore.webp");
  assert.notEqual(uploadBRes.body.trip.coverUpdatedAt, uploadARes.body.trip.coverUpdatedAt);

  const dbRowB = (await db.query(`select cover_file_key from public.travel_trips where id = $1`, [tripId])).rows[0];
  assert.notEqual(dbRowB.cover_file_key, dbRowA.cover_file_key);
  assert.equal(bucketMap.has(dbRowB.cover_file_key), true, "New cover R2 object must exist");
  assert.equal(bucketMap.has(dbRowA.cover_file_key), false, "Replaced unreferenced cover R2 object must be deleted");
  assert.equal(bucketMap.has(dupDbRow.cover_file_key), true, "Duplicated trip cover R2 object must remain intact");

  // 7. Also verify reference protection if another row still shares the exact R2 key
  await db.query(`update public.travel_trips set cover_file_key = $1 where id = $2`, [dbRowB.cover_file_key, dupTripId]);
  const removeSharedRes = await api("DELETE", `/trips/${tripId}/files/cover`);
  assert.equal(removeSharedRes.status, 200);
  assert.equal(removeSharedRes.body.trip.hasCover, false);
  assert.equal(bucketMap.has(dbRowB.cover_file_key), true, "Must NOT delete R2 object while still referenced by another trip");

  // Removing cover from the remaining referencing trip now deletes the R2 object cleanly
  const removeFinalRes = await api("DELETE", `/trips/${dupTripId}/files/cover`);
  assert.equal(removeFinalRes.status, 200);
  assert.equal(removeFinalRes.body.trip.hasCover, false);
  assert.equal(bucketMap.has(dbRowB.cover_file_key), false, "R2 object deleted once zero references remain");
});

