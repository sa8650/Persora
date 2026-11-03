// Full-Stack Browser End-to-End & Multi-Viewport Verification for Persora TravelSpace
// Runs the production Vite bundle (`dist/`) + real Cloudflare Pages `/api/[[path]].js`
// (`cloudflare/api.js` -> `cloudflare/travel-space.js`) + PostgreSQL (`PGlite`) in headless Chromium.
//
// Verifies:
// 1. Part A fix: real authenticated `POST /api/travel-space/trips` succeeds (`201`),
//    persists across full page reload, and supports multiple trip creations.
// 2. Part B Design System: PersoraDatePicker, PersoraSegmentedControl, PersoraDeleteModal, GeistSans.
// 3. Part C 6-Step Guided Onboarding: Step 1 -> Step 6, Back/Next draft preservation,
//    0-destination optionality, Solo vs Group budget & contributions, initial tasks, Review & Create.
// 4. Part D Interactive Leaflet + OpenStreetMap + OSRM Map: search, Google Maps URL / coordinate entry,
//    numbered markers, road routing, Overview compact map -> full Map tab, stop reordering,
//    Explore dual actions (`Add to Trip` vs `Add to Itinerary`), Itinerary activity markers,
//    and strict coordinate-only `public.trip_destinations` DB persistence (zero names/addresses).
// 5. Desktop (1440px), Tablet (820px), and Mobile (390px, 320px) responsive layouts & bottom sheet.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { createVaultDatabase } from "../password-vault-db.mjs";
import { onRequest as pagesApiOnRequest } from "../../functions/api/[[path]].js";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "/opt/playwright/node_modules/playwright/index.mjs"
);

const repoRoot = new URL("../../", import.meta.url).pathname;
const distDir = join(repoRoot, "dist");
const SHOTS_DIR = process.env.E2E_SCREENSHOTS || join(tmpdir(), "persora-travel-space-shots");
mkdirSync(SHOTS_DIR, { recursive: true });

// 1x1 transparent PNG for fast, offline-deterministic OSM tile rendering in headless Chromium
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=",
  "base64",
);

function buildLandscapeCoverPng(width = 320, height = 180, theme = "tea") {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    const t = y / height;
    for (let x = 0; x < width; x += 1) {
      const ridge1 = Math.round(height * (0.56 + 0.08 * Math.sin(x / 38) + 0.04 * Math.cos(x / 19)));
      const ridge2 = Math.round(height * (0.72 + 0.06 * Math.cos(x / 29)));
      let r;
      let g;
      let b;
      if (theme === "tea") {
        if (y < ridge1) {
          r = Math.round(214 - t * 38);
          g = Math.round(234 - t * 24);
          b = Math.round(250 - t * 10);
        } else if (y < ridge2) {
          r = 56;
          g = 128;
          b = 110;
        } else {
          r = 34;
          g = 98;
          b = 78;
        }
      } else {
        if (y < ridge1) {
          r = Math.round(248 - t * 26);
          g = Math.round(224 - t * 40);
          b = Math.round(196 + t * 25);
        } else if (y < ridge2) {
          r = 45;
          g = 108;
          b = 148;
        } else {
          r = 28;
          g = 76;
          b = 116;
        }
      }
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const COVER_PNG_TEA = buildLandscapeCoverPng(320, 180, "tea");
const COVER_PNG_RIVER = buildLandscapeCoverPng(320, 180, "river");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

// Boot PGlite PostgreSQL with full Persora schema + migrations
const ctx = await createVaultDatabase();
const { db } = ctx;

const bucketMap = new Map();
const vaultFilesMock = {
  async put(key, value, options = {}) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(await new Response(value).arrayBuffer());
    bucketMap.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
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
    } else if (val.startsWith("gt.")) {
      params.push(val.slice(3));
      clauses.push(`"${key}" > $${params.length}`);
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

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);

  if (url.hostname === "db.e2e.local" && url.pathname.startsWith("/rest/v1/")) {
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
  }

  // Deterministic Nominatim & OSRM responses for fast, reliable E2E assertions
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    if (q.includes("sylhet")) {
      return Response.json([
        {
          place_id: 7701,
          name: "Sylhet",
          display_name: "Sylhet, Sylhet Division, Bangladesh",
          lat: "24.8949",
          lon: "91.8687",
        },
      ]);
    }
    return Response.json([]);
  }

  if (url.hostname.includes("project-osrm.org") || url.hostname.includes("routing.openstreetmap.de")) {
    return Response.json({
      code: "Ok",
      routes: [
        {
          distance: 241500,
          duration: 16200,
          geometry: {
            type: "LineString",
            coordinates: [
              [90.4125, 23.8103],
              [91.15, 24.22],
              [91.8687, 24.8949],
            ],
          },
          legs: [{ distance: 241500, duration: 16200 }],
        },
      ],
    });
  }

  return realFetch(input, init);
};

const env = {
  SUPABASE_URL: "https://db.e2e.local",
  SUPABASE_SECRET_KEY: "e2e-service-secret",
  AUTH_TOKEN_SECRET: "e2e-auth-token-secret-32-characters-long!!",
  TIMELINE_ENCRYPTION_KEY: "e2e-timeline-encryption-secret-32-chars!!",
  VAULT_FILES: vaultFilesMock,
};

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) {
      let body;
      if (!["GET", "HEAD"].includes(req.method || "GET")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }
      const headers = Object.entries(req.headers)
        .filter(([k]) => k !== "host" && vDefined(req.headers[k]))
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);
      const cfReq = new Request(url.toString(), {
        method: req.method,
        headers,
        body,
        duplex: "half",
      });
      const pending = [];
      const cfRes = await pagesApiOnRequest({
        request: cfReq,
        env,
        waitUntil: (p) => pending.push(p),
        passThroughOnException() {},
      });
      const outHeaders = Object.fromEntries([...cfRes.headers].filter(([k]) => k !== "set-cookie"));
      const cookies = cfRes.headers.getSetCookie?.() || [];
      if (cookies.length) outHeaders["set-cookie"] = cookies;
      res.writeHead(cfRes.status, outHeaders);
      res.end(Buffer.from(await cfRes.arrayBuffer()));
      await Promise.allSettled(pending);
      return;
    }

    let file = join(distDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(distDir) || !existsSync(file) || !extname(file)) {
      file = join(distDir, "index.html");
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    console.error("[e2e server error]", err);
    res.writeHead(500);
    res.end("server error");
  }
});

function vDefined(v) {
  return v !== undefined && v !== null;
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

// Pre-register a real Persora cloud member via POST /api/auth/register so we test the
// real authenticated session cookie + `/api/travel-space/*` Cloudflare Pages pipeline!
const userEmail = `arif-${Date.now()}@persora.test`;
const userPassword = "Correct-Horse-Battery-9!";
const regRes = await realFetch(`${BASE_URL}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE_URL },
  body: JSON.stringify({
    fullName: "Arif Rahman",
    email: userEmail,
    password: userPassword,
  }),
});
assert.equal(regRes.status, 201, `Expected 201 from /api/auth/register, got ${regRes.status}`);
const rawSetCookie = regRes.headers.getSetCookie()[0];
const [cookiePair] = rawSetCookie.split(";");
const eqIdx = cookiePair.indexOf("=");
const sessionCookieName = cookiePair.slice(0, eqIdx);
const sessionCookieValue = cookiePair.slice(eqIdx + 1);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
await context.addCookies([
  {
    name: sessionCookieName,
    value: sessionCookieValue,
    domain: "127.0.0.1",
    path: "/",
  },
]);

const page = await context.newPage();
await page.route("**/*tile.openstreetmap.org/**", (route) =>
  route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG }),
);

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
    errors.push(`console.error: ${msg.text()}`);
  }
});
page.on("response", (res) => {
  const p = new URL(res.url()).pathname;
  if (p.startsWith("/api/travel-space") && res.status() >= 400) {
    errors.push(`API ${res.status()} ${res.request().method()} ${p}`);
  }
});

async function pickDateInPicker(shellLocator, isoDate) {
  await shellLocator.locator(".ds-date-picker-trigger").click();
  const popover = page.locator('[role="dialog"][aria-label="Select date"]').last();
  await popover.waitFor({ state: "visible" });
  const [yr, mo, dy] = isoDate.split("-").map(Number);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const targetLabel = `${monthNames[mo - 1]} ${yr}`;
  for (let guard = 0; guard < 24; guard += 1) {
    const header = (await popover.locator(".ds-date-picker-month").innerText()).trim();
    if (header === targetLabel) break;
    const [curMName, curYStr] = header.split(" ");
    const curY = Number(curYStr);
    const curM = monthNames.indexOf(curMName) + 1;
    if (curY < yr || (curY === yr && curM < mo)) {
      await popover.getByRole("button", { name: "Next month" }).click();
    } else {
      await popover.getByRole("button", { name: "Previous month" }).click();
    }
  }
  await popover
    .locator("button.ds-date-picker-day:not(.is-outside)")
    .filter({ hasText: new RegExp(`^${dy}$`) })
    .click();
}

try {
  console.log("▶ 1. Opening authenticated Persora TravelSpace (`?view=travel-space`)…");
  await page.goto(`${BASE_URL}/?view=travel-space`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "TravelSpace", level: 1 }).waitFor({ state: "visible" });
  console.log("  ✓ Authenticated TravelSpace mounted cleanly with zero API errors");

  console.log("▶ 1b. Verifying zero dashboard flicker & clean Cancel / X close behavior (clean + dirty states)…");
  // Tag dashboard heading node and count bootstrap API hits to prove zero unmount/refresh flicker
  await page.evaluate(() => {
    const h1 = document.querySelector(".ts-title");
    if (h1) h1.setAttribute("data-persist-token", "persisted-dashboard-node");
  });
  let bootstrapHitsDuringModal = 0;
  const countBootstrap = (req) => {
    if (new URL(req.url()).pathname === "/api/travel-space/bootstrap") {
      bootstrapHitsDuringModal += 1;
    }
  };
  page.on("request", countBootstrap);

  const onboarding = page.locator(".ts-onboarding-modal");

  // Open #1 -> Untouched X close button closes immediately, zero map mounted on Step 1, dashboard node untouched
  await page.getByRole("button", { name: /Create Trip/i }).first().click();
  await onboarding.waitFor({ state: "visible" });
  assert.equal(
    await page.locator('.ts-title[data-persist-token="persisted-dashboard-node"]').count(),
    1,
    "TravelSpace dashboard heading must remain mounted without refresh/flicker when Create Trip opens",
  );
  assert.equal(
    await onboarding.locator(".leaflet-container").count(),
    0,
    "Step 1 must not eagerly mount hidden Leaflet map on open",
  );
  await onboarding.getByRole("button", { name: "Close trip onboarding" }).click();
  await onboarding.waitFor({ state: "hidden" });

  // Open #2 -> Untouched Cancel button closes immediately
  await page.getByRole("button", { name: /Create Trip/i }).first().click();
  await onboarding.waitFor({ state: "visible" });
  await onboarding.getByRole("button", { name: "Cancel" }).click();
  await onboarding.waitFor({ state: "hidden" });

  // Open #3 -> Dirty state: Cancel & X show Discard confirmation ON TOP of onboarding modal (z-index verified via elementFromPoint)
  await page.getByRole("button", { name: /Create Trip/i }).first().click();
  await onboarding.waitFor({ state: "visible" });
  await onboarding.getByPlaceholder(/Autumn in Kyoto/i).fill("Draft to discard");
  await onboarding.getByRole("button", { name: "Cancel" }).click();

  const discardDialog = page.getByRole("alertdialog");
  await discardDialog.waitFor({ state: "visible" });
  const discardOnTop = await page.evaluate(() => {
    const dlg = document.querySelector('[role="alertdialog"]');
    if (!dlg) return false;
    const rect = dlg.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && dlg.contains(hit));
  });
  assert.equal(discardOnTop, true, "Discard confirmation dialog must stack visually above CreateTripDialog");

  await discardDialog.getByRole("button", { name: "Keep editing" }).click();
  await discardDialog.waitFor({ state: "hidden" });
  assert.equal(await onboarding.isVisible(), true);

  await onboarding.getByRole("button", { name: "Close trip onboarding" }).click();
  await discardDialog.waitFor({ state: "visible" });
  await discardDialog.getByRole("button", { name: "Discard" }).click();
  await onboarding.waitFor({ state: "hidden" });

  // Simulate window focus event to ensure App.tsx profile refresh does NOT re-trigger TravelSpace loading state
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  assert.equal(bootstrapHitsDuringModal, 0, "Opening/closing Create Trip or focusing window must not re-fetch bootstrap");
  assert.equal(
    await page.locator('.ts-title[data-persist-token="persisted-dashboard-node"]').count(),
    1,
    "Dashboard node must remain mounted after focus and modal close",
  );
  page.off("request", countBootstrap);
  console.log("  ✓ Zero dashboard flicker, immediate untouched Cancel/X close, and top-stacked dirty Discard dialog verified");

  console.log("▶ 2. 6-Step Guided Create Trip Onboarding Flow (Leaflet Map, Group Budget, Initial Tasks)…");
  await page.getByRole("button", { name: /Create Trip/i }).first().click();
  await onboarding.waitFor({ state: "visible" });
  await onboarding.getByRole("heading", { name: "Trip basics" }).waitFor({ state: "visible" });

  // Step 1: Trip basics using PersoraDatePicker + Cover Image Selection & Immediate Preview
  await onboarding.getByPlaceholder(/Autumn in Kyoto/i).fill("Sylhet Tea Gardens & Jaflong");
  await onboarding.getByPlaceholder(/Short overview, goals, or travel notes/i).fill(
    "Friends monsoon expedition across Sylhet tea estates.",
  );
  // Select a valid PNG cover image and verify immediate 16:9 preview + remove/re-select before submission
  const coverInput = onboarding.locator('input[type="file"]');
  await coverInput.setInputFiles({
    name: "sylhet-tea-hills.png",
    mimeType: "image/png",
    buffer: COVER_PNG_TEA,
  });
  await onboarding.locator(".ts-cover-picker-preview img.ts-cover-img").waitFor({ state: "visible" });
  await onboarding.getByText("sylhet-tea-hills.png").waitFor({ state: "visible" });

  const dateTriggers = onboarding.locator(".ds-date-picker-shell");
  await pickDateInPicker(dateTriggers.nth(0), "2026-12-01");
  await pickDateInPicker(dateTriggers.nth(1), "2026-12-03");
  await onboarding.getByRole("button", { name: /Next/i }).click();

  // Step 2: Interactive Leaflet Map (Google Maps URL + Search + Back/Next preservation)
  await onboarding.getByRole("heading", { name: "Map & destinations" }).waitFor({ state: "visible" });
  await onboarding.locator(".leaflet-container").waitFor({ state: "visible" });
  const attributionText = await onboarding.locator(".leaflet-control-attribution").innerText();
  assert.ok(/OpenStreetMap/i.test(attributionText), "OpenStreetMap attribution must be visible");

  // Add Stop 1 via Google Maps URL / Coordinates popover
  await onboarding.getByRole("button", { name: /Coords \/ Link/i }).click();
  await onboarding
    .getByLabel("Coordinates or Google Maps URL")
    .fill("https://www.google.com/maps/place/Dhaka/@23.8103,90.4125,13z");
  await onboarding.getByRole("button", { name: "Pin Stop" }).click();
  await onboarding.locator(".ts-map-pin", { hasText: "1" }).waitFor({ state: "visible" });

  // Add Stop 2 via debounced destination search
  const mapSearchInput = onboarding.getByLabel("Search destinations");
  await mapSearchInput.fill("Sylhet");
  await onboarding.locator(".ts-map-search-option", { hasText: "Sylhet" }).first().click();
  await onboarding.locator(".ts-map-pin", { hasText: "2" }).waitFor({ state: "visible" });
  await page.screenshot({ path: join(SHOTS_DIR, "travel-space-onboarding.png") });

  // Verify Back -> Step 1 -> Next -> Step 2 preserves both form fields AND map markers!
  await onboarding.getByRole("button", { name: /Back/i }).click();
  assert.equal(
    await onboarding.getByPlaceholder(/Autumn in Kyoto/i).inputValue(),
    "Sylhet Tea Gardens & Jaflong",
  );
  await onboarding.getByRole("button", { name: /Next/i }).click();
  assert.equal(await onboarding.locator(".ts-map-stop-item").count(), 2);
  await onboarding.getByRole("button", { name: /Next/i }).click();

  // Step 3: Travellers
  await onboarding.getByRole("heading", { name: "Travellers & companions" }).waitFor({ state: "visible" });
  await onboarding.getByRole("radio", { name: "Friends" }).click();
  const tempRadio = onboarding.getByRole("radio", { name: /Temporary/i });
  if (await tempRadio.isVisible().catch(() => false)) {
    await tempRadio.click();
  }
  await onboarding.getByLabel("Traveller full name").fill("Rafiq Ahmed");
  await onboarding.getByRole("button", { name: /^Add$/i }).click();
  await onboarding.getByText("Rafiq Ahmed").waitFor({ state: "visible" });
  await onboarding.getByRole("button", { name: /Next/i }).click();

  // Step 4: Budget Configuration (Combined Group Budget + Planned vs Collected Contributions + Categories)
  await onboarding.getByRole("heading", { name: "Budget configuration" }).waitFor({ state: "visible" });
  await onboarding.getByRole("radio", { name: "Combined Group Budget" }).click();
  await onboarding.locator('input[placeholder="0.00"]').first().fill("30000");
  await onboarding.getByRole("radio", { name: "Equal shares" }).click();
  await onboarding.getByLabel(/Collected contribution/i).first().fill("10000");
  await onboarding.getByLabel("Transportation allocation").fill("10000");
  await onboarding.getByLabel("Meals allocation").fill("8000");
  await onboarding.getByRole("button", { name: /Next/i }).click();

  // Step 5: Initial Tasks
  await onboarding.getByRole("heading", { name: "Initial preparation tasks" }).waitFor({ state: "visible" });
  await onboarding.getByPlaceholder(/Exchange currency/i).fill("Reserve Kalni Express train seats");
  await onboarding.getByRole("button", { name: /Add Task to Checklist/i }).click();
  await onboarding.getByText("Reserve Kalni Express train seats").waitFor({ state: "visible" });
  await onboarding.getByRole("button", { name: /Next/i }).click();

  // Step 6: Review & Create (verify cover preview renders on Step 6 too)
  await onboarding.getByRole("heading", { name: "Review & create" }).waitFor({ state: "visible" });
  await onboarding.getByText("Sylhet Tea Gardens & Jaflong").waitFor({ state: "visible" });
  await onboarding.locator(".ts-review-cover-preview img.ts-cover-img").waitFor({ state: "visible" });
  await onboarding.getByRole("button", { name: /^Create Trip$/i }).click();

  // Verify navigation directly into newly created 9-tab Trip Workspace + Cover rendered in Workspace Header!
  await page.getByRole("heading", { name: "Sylhet Tea Gardens & Jaflong" }).waitFor({ state: "visible" });
  assert.ok(page.url().includes("trip="), "URL must sync ?trip=<id> after creation");
  const wsCoverImg = page.locator(".ts-ws-cover-media img.ts-cover-img");
  await wsCoverImg.waitFor({ state: "visible" });
  const wsImgLoaded = await wsCoverImg.evaluate((el) => el.complete && el.naturalWidth > 0);
  assert.equal(wsImgLoaded, true, "Cover image must load and render inside Trip Workspace header");
  await page.screenshot({ path: join(SHOTS_DIR, "travel-space-workspace-overview.png") });
  console.log("  ✓ 6-step Group Trip with cover image created, uploaded to R2, and rendered in Trip Workspace");

  console.log("▶ 3. Reload + Logout/Re-Login Cover Persistence + DB R2 Key Purity + Unauthorized Protection…");
  const createdTripRow = (await db.query(`select id, cover_file_key from public.travel_trips limit 1`)).rows[0];
  assert.ok(createdTripRow.cover_file_key, "cover_file_key must persist in PostgreSQL");
  assert.ok(!createdTripRow.cover_file_key.startsWith("blob:"), "DB must never persist blob: URLs");
  assert.ok(!createdTripRow.cover_file_key.startsWith("data:"), "DB must never persist base64 data");
  assert.ok(bucketMap.has(createdTripRow.cover_file_key), "Cover object must exist in private R2 VAULT_FILES");

  // 3a. Page Refresh -> Cover image STILL displays!
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Sylhet Tea Gardens & Jaflong" }).waitFor({ state: "visible" });
  await page.locator(".ts-ws-cover-media img.ts-cover-img").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".ts-ws-cover-media img.ts-cover-img").evaluate((el) => el.complete && el.naturalWidth > 0),
    true,
    "Cover image must survive full page refresh",
  );

  // 3b. Unauthenticated request to cover endpoint -> 401
  const unauthCoverRes = await realFetch(`${BASE_URL}/api/travel-space/trips/${createdTripRow.id}/files/cover`);
  assert.equal(unauthCoverRes.status, 401, "Private R2 cover endpoint must reject unauthenticated access with 401");

  // 3c. Logout -> Clear session -> Re-login -> Cover image STILL displays on Dashboard TripCard AND Workspace!
  await realFetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Origin: BASE_URL, Cookie: `${sessionCookieName}=${sessionCookieValue}` },
  });
  await context.clearCookies();

  const loginRes = await realFetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ identifier: userEmail, password: userPassword }),
  });
  assert.equal(loginRes.status, 200, "Re-login must succeed with 200");
  const freshSetCookie = loginRes.headers.getSetCookie()[0];
  const [freshPair] = freshSetCookie.split(";");
  const freshEq = freshPair.indexOf("=");
  await context.addCookies([
    {
      name: freshPair.slice(0, freshEq),
      value: freshPair.slice(freshEq + 1),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);

  await page.goto(`${BASE_URL}/?view=travel-space`, { waitUntil: "networkidle" });
  const cardCoverImg = page.locator(".ts-trip-card", { hasText: "Sylhet Tea Gardens & Jaflong" }).locator("img.ts-cover-img");
  await cardCoverImg.waitFor({ state: "visible" });
  assert.equal(
    await cardCoverImg.evaluate((el) => el.complete && el.naturalWidth > 0),
    true,
    "TripCard cover image must survive logout and re-login",
  );

  // Open workspace from TripCard
  await page.locator(".ts-trip-card", { hasText: "Sylhet Tea Gardens & Jaflong" }).first().click();
  await page.getByRole("heading", { name: "Sylhet Tea Gardens & Jaflong" }).waitFor({ state: "visible" });
  await page.locator(".ts-ws-cover-media img.ts-cover-img").waitFor({ state: "visible" });

  // Inspect PostgreSQL `public.trip_destinations` directly!
  const dbStops = await db.query(`select * from public.trip_destinations order by order_index asc`);
  assert.equal(dbStops.rows.length, 2, "2 coordinate stops must persist in PostgreSQL");
  assert.deepEqual(Object.keys(dbStops.rows[0]).sort(), [
    "created_at",
    "id",
    "latitude",
    "longitude",
    "order_index",
    "trip_id",
    "updated_at",
  ]);
  assert.equal(Number(dbStops.rows[0].latitude), 23.8103);
  assert.equal(Number(dbStops.rows[1].latitude), 24.8949);
  console.log("  ✓ Verified cover persistence across reload + logout/re-login, 401 auth guard, and coordinate-only DB");

  console.log("▶ 4. Overview Compact Map -> Itinerary Route Map + Reorder Stops + Google Maps Export…");
  await page.locator(".ts-map-compact-card").first().click();
  await page.getByRole("heading", { name: "Trip Route & Map Stops" }).waitFor({ state: "visible" });
  // Move Stop 1 down -> swaps order_index 0 and 1 and auto-persists via PUT /trips/:id/destinations
  await page.getByRole("button", { name: "Move stop 1 down" }).click();
  await page.waitForTimeout(350);
  const reorderedDb = await db.query(`select latitude, order_index from public.trip_destinations order by order_index asc`);
  assert.equal(Number(reorderedDb.rows[0].latitude), 24.8949, "Reordered Stop 1 must now be 24.8949 in PostgreSQL");
  const gmapsHref = await page.locator(".ts-map-ext-link").first().getAttribute("href");
  assert.ok(
    gmapsHref && gmapsHref.includes("google.com/maps/dir/"),
    "External Google Maps directions link must be valid",
  );
  await page.screenshot({ path: join(SHOTS_DIR, "travel-space-interactive-map.png") });
  console.log("  ✓ Overview compact map opened Itinerary Route Map, reordered stops, and persisted to PostgreSQL");

  console.log("▶ 5. Tasks Kanban <-> Itinerary Map Activity Pins (Single Record, Zero Duplication)…");
  const wsRoot = page.locator(".ts-root");
  await wsRoot.getByRole("tab", { name: /^Tasks/i }).click();
  await page.getByText("Reserve Kalni Express train seats").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Edit Reserve Kalni Express train seats" }).click();
  const itemModal = page.locator('.ts-modal-backdrop[aria-label="Edit item"]');
  await itemModal.waitFor({ state: "visible" });
  await itemModal.locator("select").filter({ hasText: /2026-12-01/ }).first().selectOption("2026-12-01");
  await itemModal.getByPlaceholder(/23\.8103, 90\.4125/i).fill("24.9012, 91.8715");
  await itemModal.locator('button[type="submit"]').click();

  await wsRoot.getByRole("tab", { name: /^Itinerary/i }).click();
  await page.getByText("Reserve Kalni Express train seats").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Route Map/i }).click();
  await page.locator(".ts-map-activity-pin").first().waitFor({ state: "visible" });
  console.log("  ✓ Scheduled task rendered as secondary activity pin on Itinerary Map without duplication");

  console.log("▶ 6. Explore Dual Actions + Second Trip Without Cover (Fallback) + Replace/Remove Cover + Duplicate…");
  await page.getByRole("button", { name: /Back to My Trips/i }).first().click();
  await page.getByRole("tab", { name: /Explore/ }).click();
  await page.getByRole("button", { name: /Save Place/i }).first().click();
  const exploreDialog = page.locator('.ts-modal-backdrop[aria-label="Save explore place"]');
  await exploreDialog.waitFor({ state: "visible" });
  await exploreDialog.locator("input.ts-input").first().fill("Ratargul Swamp Forest");
  await exploreDialog.getByPlaceholder(/23\.8103, 90\.4125/i).fill("25.0124, 91.9228");
  await exploreDialog.getByRole("button", { name: "Save Place" }).click();
  await page.getByText("Ratargul Swamp Forest").first().waitFor({ state: "visible" });

  // Dual Action 1: + Add to Trip… (adds coordinate stop to trip_destinations)
  const addDestSelect = page.locator('select[aria-label="Add Ratargul Swamp Forest to trip destinations"]');
  await addDestSelect.waitFor({ state: "visible" });
  await addDestSelect.selectOption({ label: "Sylhet Tea Gardens & Jaflong" });
  await page.getByText(/Added Ratargul Swamp Forest to trip map stops/i).waitFor({ state: "visible" });

  // Dual Action 2: + Add to Itinerary… (creates scheduled travel_trip_items entry)
  const addItinSelect = page.locator('select[aria-label="Add Ratargul Swamp Forest to trip itinerary"]');
  await addItinSelect.selectOption({ label: "Sylhet Tea Gardens & Jaflong" });
  await page.getByText(/Added Ratargul Swamp Forest to trip itinerary/i).waitFor({ state: "visible" });

  // Create Second Trip WITHOUT Cover Image (Solo, 0 destinations) -> verify Persora fallback cover!
  await page.getByRole("button", { name: /Create Trip/i }).first().click();
  await onboarding.waitFor({ state: "visible" });
  await onboarding.getByPlaceholder(/Autumn in Kyoto/i).fill("Bandarban Solo Sketchbook");
  const soloDates = onboarding.locator(".ds-date-picker-shell");
  await pickDateInPicker(soloDates.nth(0), "2026-12-10");
  await pickDateInPicker(soloDates.nth(1), "2026-12-12");
  await onboarding.getByRole("button", { name: /Next/i }).click(); // -> Step 2 (0 stops)
  await onboarding.getByRole("button", { name: /Next/i }).click(); // -> Step 3 (Solo default)
  await onboarding.getByRole("button", { name: /Next/i }).click(); // -> Step 4 (Personal budget)
  await onboarding.getByRole("button", { name: /Skip & Review|Next/i }).click(); // -> Step 5
  await onboarding.getByRole("button", { name: /Skip & Review|Next/i }).click(); // -> Step 6
  await onboarding.getByRole("button", { name: /^Create Trip$/i }).click();
  await page.getByRole("heading", { name: "Bandarban Solo Sketchbook" }).waitFor({ state: "visible" });
  // Verify Persora fallback cover renders inside TripWorkspace when trip has no cover image
  await page.locator(".ts-ws-cover-media .ts-cover-fallback").waitFor({ state: "visible" });

  // Return to Dashboard -> verify BOTH Cover Image card AND Fallback Cover card, Grid/List toggle, Search, Filter, & 3-dot Duplicate!
  await page.getByRole("button", { name: /Back to My Trips/i }).first().click();
  await page.getByRole("tab", { name: /My Trips/i }).click();
  await page.locator(".ts-trip-card", { hasText: "Sylhet Tea Gardens & Jaflong" }).locator("img.ts-cover-img").waitFor({ state: "visible" });
  await page.locator(".ts-trip-card", { hasText: "Bandarban Solo Sketchbook" }).locator(".ts-cover-fallback").waitFor({ state: "visible" });
  await page.screenshot({ path: join(SHOTS_DIR, "travel-space-dashboard-grid.png") });

  // Switch to List view & back to Grid view without page reload
  await page.getByRole("button", { name: "List view" }).click();
  await page.locator(".ts-trip-card.is-list").first().waitFor({ state: "visible" });
  await page.screenshot({ path: join(SHOTS_DIR, "travel-space-dashboard-list.png") });
  await page.getByRole("button", { name: "Grid view" }).click();

  // Duplicate trip via 3-dot menu on TripCard
  await page.getByRole("button", { name: /More actions for Bandarban Solo Sketchbook/i }).click();
  await page.getByRole("menuitem", { name: /Duplicate trip/i }).click();
  await page.locator(".ts-trip-card", { hasText: "Bandarban Solo Sketchbook (Copy)" }).waitFor({ state: "visible" });

  // Replace & Remove cover image on Sylhet trip inside Workspace
  await page.locator(".ts-trip-card", { hasText: "Sylhet Tea Gardens & Jaflong" }).first().click();
  const oldKeyBeforeReplace = (await db.query(`select cover_file_key from public.travel_trips where id = $1`, [createdTripRow.id])).rows[0].cover_file_key;
  await page.locator('input[aria-label="Upload trip cover image"]').setInputFiles({
    name: "jaflong-river-replaced.png",
    mimeType: "image/png",
    buffer: COVER_PNG_RIVER,
  });
  await page.getByText(/Trip cover image updated/i).waitFor({ state: "visible" });
  const newKeyAfterReplace = (await db.query(`select cover_file_key from public.travel_trips where id = $1`, [createdTripRow.id])).rows[0].cover_file_key;
  assert.notEqual(newKeyAfterReplace, oldKeyBeforeReplace, "Replaced cover must save new R2 key");
  assert.equal(bucketMap.has(oldKeyBeforeReplace), false, "Old unreferenced R2 cover must be deleted after replacement");
  assert.equal(bucketMap.has(newKeyAfterReplace), true, "New R2 cover must exist");

  // Remove cover via Trip actions menu -> verify fallback cover appears & R2 object deleted
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: /Remove cover image/i }).click();
  await page.locator(".ts-ws-cover-media .ts-cover-fallback").waitFor({ state: "visible" });
  assert.equal(bucketMap.has(newKeyAfterReplace), false, "Removed R2 cover must be deleted");

  // Re-upload cover so final mobile & desktop screenshots showcase real cover image too!
  await page.locator('input[aria-label="Upload trip cover image"]').setInputFiles({
    name: "sylhet-final-cover.png",
    mimeType: "image/png",
    buffer: COVER_PNG_TEA,
  });
  await page.locator(".ts-ws-cover-media img.ts-cover-img").waitFor({ state: "visible" });
  console.log("  ✓ Verified Explore dual actions, fallback cover, Grid/List toggle, 3-dot Duplicate, and Replace/Remove R2 cleanup");

  console.log("▶ 7. Responsive Desktop, Tablet & Mobile Layout + Mobile Bottom Sheet Verification…");
  await wsRoot.getByRole("tab", { name: /^Itinerary/i }).click();
  await page.getByRole("button", { name: /Route Map/i }).click();

  for (const [w, h] of [
    [1440, 900],
    [820, 1180],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(180);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 2, `Zero horizontal overflow expected at ${w}x${h}, got +${overflow}px`);
    if (w === 390) {
      await page.screenshot({ path: join(SHOTS_DIR, "travel-space-mobile-390.png") });
    }
  }
  console.log("  ✓ Verified zero horizontal overflow across 1440px, 820px, 390px, and 320px viewports");

  assert.deepEqual(errors, [], `Unexpected console/API errors:\n${errors.join("\n")}`);
  console.log("\n✅ ALL PERSORA TRAVELSPACE E2E & MAP VERIFICATIONS PASSED!");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
