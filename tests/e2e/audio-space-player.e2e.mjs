// Full-Stack Browser End-to-End Verification for AudioSpace Player & Dynamic Island Now Playing
// Runs the production Vite bundle (`dist/`) + real Cloudflare Pages `/api/[[path]].js`
// (`cloudflare/api.js` -> `cloudflare/audio-space.js`) + PostgreSQL (`PGlite`) + R2 bucket in Chromium.
//
// Verifies:
// 1. Minimal Vengeance UI-inspired AudioSpace floating glass player (`section.as-mini-player`):
//    - Hidden when idle; compact (~420px), collapsed mini-pill (~196px), and expanded states;
//    - Obsolete oversized `.as-player-main` global toolbar is completely absent;
//    - Shows title, animated equalizer, transport, seekable progress bar, ±10s skip, volume, and speed;
//    - Persists across AudioSpace sections (`Overview`, `All Audio`, `Favorites`, `My Recordings`, `Recent`).
// 2. Scoped visibility & uninterrupted background playback:
//    - Navigating to Dashboard, Persora Docs, Projects, and Settings hides `.as-mini-player` completely
//      while the single workspace `HTMLAudioElement` continues playing without reload or reset.
// 3. Dynamic Island — Now Playing integration:
//    - Never auto-expands on navigation;
//    - Collapsed pill preserves Persora logo position + tiny animated equalizer beside it while playing,
//      zero overlap with unread notification dot, and clean (no moving equalizer) when paused;
//    - Expanded panel displays compact Now Playing (artwork/badge, title, equalizer, prev/play-pause/next,
//      seekable progress bar, time) alongside ALL existing Dynamic Island controls (Search, Theme,
//      Notifications, Add document, App Launcher, Account menu) without crowding or popover overlap.
// 4. Returning to AudioSpace restores `.as-mini-player` with the same track and preserved playback time.
// 5. Desktop (`1366×820`) & Mobile (`390×844` and `320×640`) + Light & Dark themes with zero overflow.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { createVaultDatabase } from "../password-vault-db.mjs";
import { onRequest as pagesApiOnRequest } from "../../functions/api/[[path]].js";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "/opt/playwright/node_modules/playwright/index.mjs"
);

const repoRoot = new URL("../../", import.meta.url).pathname;
const distDir = join(repoRoot, "dist");
const SHOTS_DIR = process.env.E2E_SCREENSHOTS || join(tmpdir(), "persora-audio-space-shots");
mkdirSync(SHOTS_DIR, { recursive: true });

const step = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(fn, check, label, timeout = 8000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await fn();
    if (check(last)) return last;
    await sleep(100);
  }
  assert.fail(`${label}: last value = ${JSON.stringify(last)}`);
}

// Synthesize a valid 16-bit mono PCM WAV with audible harmonic sine waves so Chromium
// decodes real audio samples, advances currentTime, and computes AudioContext peaks.
function buildSineWavBytes(seconds = 14, freqHz = 440, sampleRate = 16000) {
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (text, offset) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii("RIFF", 0);
  view.setUint32(4, 36 + dataSize, true);
  ascii("WAVE", 8);
  ascii("fmt ", 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii("data", 36);
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const envelope = 0.45 + 0.35 * Math.sin(2 * Math.PI * 1.25 * t);
    const wave = Math.sin(2 * Math.PI * freqHz * t) * 0.6 + Math.sin(2 * Math.PI * (freqHz * 1.5) * t) * 0.25;
    const sample = Math.max(-1, Math.min(1, wave * envelope));
    view.setInt16(44 + i * 2, Math.round(sample * 24000), true);
  }
  return bytes;
}

function createMemoryR2Bucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const buf =
        value instanceof Uint8Array
          ? new Uint8Array(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes: buf, ...options });
    },
    async delete(key) {
      if (Array.isArray(key)) key.forEach((k) => objects.delete(k));
      else objects.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const listed = [];
      for (const [key, entry] of objects.entries()) {
        if (key.startsWith(prefix)) listed.push({ key, size: entry.bytes.byteLength });
      }
      return { objects: listed, truncated: false };
    },
    async head(key) {
      const entry = objects.get(key);
      return entry
        ? { size: entry.bytes.byteLength, customMetadata: entry.customMetadata, httpMetadata: entry.httpMetadata }
        : null;
    },
    async get(key, options = {}) {
      const entry = objects.get(key);
      if (!entry) return null;
      let slice = entry.bytes;
      if (options?.range) {
        const start = Math.max(0, options.range.offset ?? 0);
        const length = options.range.length ?? Math.max(0, entry.bytes.byteLength - start);
        slice = entry.bytes.slice(start, start + length);
      }
      return {
        body: new Blob([slice]).stream(),
        size: entry.bytes.byteLength,
        customMetadata: entry.customMetadata,
        httpMetadata: entry.httpMetadata,
      };
    },
  };
}

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

const ctx = await createVaultDatabase();
const { db } = ctx;

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
      const nulls =
        tokens[2] === "nullslast" ? " nulls last" : tokens[2] === "nullsfirst" ? " nulls first" : "";
      return `"${col}" ${dir}${nulls}`;
    })
    .filter(Boolean);
  return parts.length ? ` order by ${parts.join(", ")}` : "";
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? String(input) : input.url,
  );
  if (url.hostname === "db.e2e.local" && url.pathname.startsWith("/rest/v1/")) {
    const sub = url.pathname.slice("/rest/v1/".length);
    const method = (init.method || "GET").toUpperCase();

    if (sub.startsWith("rpc/")) {
      const fn = sub.slice(4);
      const args = init.body ? JSON.parse(init.body) : {};
      if (fn === "persora_audio_space_save" && Array.isArray(args.p_tags)) {
        args.p_tags = `{${args.p_tags.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(",")}}`;
      }
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
        const res = await db.query(
          `select * from public."${table}"${whereSql}${orderSql}${limitSql}`,
          params,
        );
        return Response.json(res.rows);
      }
      if (method === "POST") {
        const raw = JSON.parse(init.body || "{}");
        const rows = Array.isArray(raw) ? raw : [raw];
        const inserted = [];
        for (const r of rows) {
          const keys = Object.keys(r).filter((k) => r[k] !== undefined);
          const cols = keys.map((k) => `"${k}"`).join(", ");
          const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
          const paramVals = keys.map((k) =>
            r[k] !== null && typeof r[k] === "object" && !Array.isArray(r[k])
              ? JSON.stringify(r[k])
              : r[k],
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
  return realFetch(input, init);
};

const r2Bucket = createMemoryR2Bucket();
const env = {
  SUPABASE_URL: "https://db.e2e.local",
  SUPABASE_SECRET_KEY: "e2e-service-secret",
  AUTH_TOKEN_SECRET: "e2e-auth-token-secret-32-characters-long!!",
  TIMELINE_ENCRYPTION_KEY: "e2e-timeline-encryption-secret-32-chars!!",
  VAULT_FILES: r2Bucket,
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
        .filter(([k, v]) => k !== "host" && v !== undefined && v !== null)
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
    console.error("[audio-space e2e server error]", err);
    res.writeHead(500);
    res.end("server error");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

// Register a test user and seed 2 private R2-backed WAV tracks + 1 unread notification
const userEmail = `ari-${Date.now()}@persora.test`;
const userPassword = "Correct-Horse-Battery-9!";
const regRes = await realFetch(`${BASE_URL}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE_URL },
  body: JSON.stringify({
    fullName: "Ariana Chowdhury",
    email: userEmail,
    password: userPassword,
  }),
});
assert.equal(regRes.status, 201, `Expected 201 from /api/auth/register, got ${regRes.status}`);
const regJson = await regRes.json();
const rawSetCookie = regRes.headers.getSetCookie()[0];
const [cookiePair] = rawSetCookie.split(";");
const eqIdx = cookiePair.indexOf("=");
const sessionCookieName = cookiePair.slice(0, eqIdx);
const sessionCookieValue = cookiePair.slice(eqIdx + 1);
const cookieHeader = `${sessionCookieName}=${sessionCookieValue}`;

// Ensure Plus storage plan so R2 uploads are unlocked
await db.exec("set role service_role");
const userRow = (await db.query(`select id from public.profiles where email = $1`, [userEmail])).rows[0];
const planRes = await db.query(`select id from public.subscription_plans where slug <> 'free' limit 1`);
let planId = planRes.rows[0]?.id;
if (!planId) {
  const insPlan = await db.query(
    `insert into public.subscription_plans (slug, name, storage_gb, price_per_gb_monthly) values ('plus', 'Plus', 10, 0.5) returning id`,
  );
  planId = insPlan.rows[0].id;
}
await db.query(
  `insert into public.user_subscriptions (user_id, plan_id, storage_limit_gb, status, current_period_end)
   values ($1, $2, 10, 'active', now() + interval '30 days')
   on conflict (user_id) do update set plan_id = $2, storage_limit_gb = 10, status = 'active', current_period_end = now() + interval '30 days'`,
  [userRow.id, planId],
);
await db.query(
  `insert into public.share_notifications (recipient_id, actor_name, kind, item_title, message)
   values ($1, 'Rafi Ahmed', 'shared', 'Q4 Deck', 'Shared Q4 Deck with you')`,
  [userRow.id],
);
await db.exec("reset role");

async function uploadTrack({ title, source, favorite, freqHz, fileName }) {
  const wav = buildSineWavBytes(14, freqHz);
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), fileName);
  form.append(
    "meta",
    JSON.stringify({
      title,
      description: "Private AudioSpace E2E fixture",
      folderId: null,
      newFolder: null,
      tags: ["strategy", "q4"],
      favorite,
      source,
      duration: 14,
      fileName,
    }),
  );
  const res = await realFetch(`${BASE_URL}/api/audio-space/audios`, {
    method: "POST",
    headers: { Cookie: cookieHeader, Origin: BASE_URL },
    body: form,
  });
  assert.equal(res.status, 201, `Upload failed (${res.status}): ${await res.clone().text()}`);
  return (await res.json()).item;
}

const trackOne = await uploadTrack({
  title: "Founder Keynote — Q4 Strategy",
  source: "upload",
  favorite: true,
  freqHz: 440,
  fileName: "founder-keynote.wav",
});
await sleep(25);
const trackTwo = await uploadTrack({
  title: "Architecture Voice Memo",
  source: "recording",
  favorite: false,
  freqHz: 587,
  fileName: "architecture-memo.wav",
});

// Attach miniature SVG data-URI artwork to trackOne so cover-artwork rendering is exercised too
const coverDataUri =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><circle cx="32" cy="32" r="14" fill="rgba(255,255,255,0.22)"/><circle cx="32" cy="32" r="5" fill="#fff"/></svg>`,
  );
await db.exec("set role service_role");
await db.query(
  `update public.audio_space_items set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{artworkUrl}', to_jsonb($2::text)) where id = $1`,
  [trackOne.id, coverDataUri],
);
await db.exec("reset role");
void regJson;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 820 },
  });
  await context.addCookies([
    { name: sessionCookieName, value: sessionCookieValue, domain: "127.0.0.1", path: "/" },
  ]);

  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  // Instrument HTMLAudioElement creation so we prove there is ONLY ONE engine across all navigation
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__persoraAudioInstances = [];
    window.Audio = function InstrumentedAudio(...args) {
      const instance = new NativeAudio(...args);
      window.__persoraAudioInstances.push(instance);
      return instance;
    };
    window.Audio.prototype = NativeAudio.prototype;
  });

  const snap = async (targetPage, name) => {
    await targetPage.waitForTimeout(260);
    await targetPage.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  };

  // 1. Idle state on Dashboard & AudioSpace
  step("1. Verify idle state: no floating player rendered and Dynamic Island shows clean logo + unread dot");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: "visible" });
  assert.equal(await page.locator(".as-mini-player").count(), 0, "No AudioSpace player when idle");
  assert.equal(await page.locator(".as-player-main").count(), 0, "Legacy .as-player-main never exists");
  assert.equal(await page.locator(".island-face-eq").count(), 0, "No equalizer on collapsed island when idle");

  // Navigate to AudioSpace
  await page.locator('nav[aria-label="Workspace navigation"]').getByRole("button", { name: "AudioSpace", exact: true }).click();
  await page.getByRole("heading", { name: "AudioSpace", level: 2 }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".as-mini-player").count(), 0, "Still no player before starting playback");
  ok("Idle state verified on both Dashboard and AudioSpace");

  // 2. Start playing inside AudioSpace & test compact / collapsed / expanded states
  step("2. Start playback in AudioSpace and verify minimal collapsible glass player");
  await page.locator(".as-section-tabs").getByRole("tab", { name: /^All Audio/ }).click();
  await page.getByRole("button", { name: `Play ${trackOne.title}` }).first().click();

  const miniPlayer = page.locator("section.as-mini-player");
  await miniPlayer.waitFor({ state: "visible" });

  // Wait for audio to actively start playing and advance currentTime
  await eventually(
    () =>
      page.evaluate(() => {
        const audio = window.__persoraAudioInstances?.[0];
        return audio ? { count: window.__persoraAudioInstances.length, paused: audio.paused, time: audio.currentTime } : null;
      }),
    (state) => Boolean(state && state.count === 1 && !state.paused && state.time > 0.15),
    "Audio element starts playing and advances currentTime",
  );

  // Check compact player dimensions & placement (bottom-center floating card ~420px, NOT ~1178px)
  const compactBox = await miniPlayer.boundingBox();
  const mainBox = await page.locator(".workspace-main").boundingBox();
  assert.ok(compactBox && mainBox, "Player and workspace-main bounding boxes exist");
  assert.ok(compactBox.width >= 380 && compactBox.width <= 435, `Expected compact width ~420px, got ${compactBox.width}`);
  assert.ok(compactBox.height >= 52 && compactBox.height <= 74, `Expected compact height ~58-66px, got ${compactBox.height}`);
  const playerCenter = compactBox.x + compactBox.width / 2;
  const mainCenter = mainBox.x + mainBox.width / 2;
  assert.ok(Math.abs(playerCenter - mainCenter) <= 6, `Player centered over workspace column (delta=${Math.abs(playerCenter - mainCenter)})`);
  assert.equal(await page.locator(".as-player-main").count(), 0, "Obsolete .as-player-main absent");

  // Equalizer running in AudioSpace player, while Dynamic Island stays clean inside AudioSpace
  assert.equal(await miniPlayer.locator(".as-audio-eq").getAttribute("data-playing"), "true");
  assert.match(await miniPlayer.locator(".as-mini-title").textContent() || "", /Founder Keynote/);
  assert.equal(await miniPlayer.locator(".as-artwork-badge.has-image img").count(), 1, "Track cover artwork renders");
  assert.equal(await page.locator(".island-face-eq").count(), 0, "Collapsed island has no duplicate equalizer while inside AudioSpace");
  await snap(page, "01-audiospace-compact-light");
  ok(`Compact glass player verified (${Math.round(compactBox.width)}×${Math.round(compactBox.height)}px, centered)`);

  // Collapse to Vengeance UI mini-pill (~196px) and re-expand
  await miniPlayer.getByRole("button", { name: "Minimize player" }).click();
  await eventually(
    async () => (await miniPlayer.boundingBox())?.width ?? 0,
    (w) => w >= 180 && w <= 212,
    "Mini-pill collapsed width ~196px",
  );
  await snap(page, "02-audiospace-collapsed-pill-light");
  await miniPlayer.getByRole("button", { name: "Expand player" }).click();
  await eventually(
    async () => (await miniPlayer.boundingBox())?.width ?? 0,
    (w) => w >= 380 && w <= 435,
    "Restored compact width ~420px",
  );

  // Open secondary drawer (expanded player mode) and test seek, volume, and playback speed
  await miniPlayer.getByRole("button", { name: "More audio controls" }).click();
  await miniPlayer.locator(".as-mini-drawer").waitFor({ state: "visible" });
  await snap(page, "03-audiospace-expanded-drawer-light");

  await miniPlayer.getByRole("combobox", { name: "Playback speed" }).selectOption("1.25");
  const rateNow = await page.evaluate(() => window.__persoraAudioInstances[0].playbackRate);
  assert.equal(rateNow, 1.25, "Playback speed updated on single HTMLAudioElement");

  await miniPlayer.getByRole("slider", { name: "Volume" }).fill("0.7");
  await miniPlayer.getByRole("slider", { name: "Volume" }).dispatchEvent("change");
  await miniPlayer.getByRole("button", { name: "Hide extra audio controls" }).click();

  // Persist across AudioSpace internal sections (Favorites, My Recordings, Recent)
  for (const tabName of [/^Favorites/, /^My Recordings/, /^Recent/, /^All Audio/]) {
    await page.locator(".as-section-tabs").getByRole("tab", { name: tabName }).click();
    assert.equal(await miniPlayer.isVisible(), true, `Player stays visible on AudioSpace section ${tabName}`);
  }
  ok("Collapsed pill, expanded drawer, speed/volume, and AudioSpace section persistence verified");

  // 3. Navigate away from AudioSpace -> Dashboard, Docs, Projects, Settings
  step("3. Navigate across workspace pages: full player disappears, audio continues, Dynamic Island shows equalizer");
  const timeBeforeLeave = await page.evaluate(() => window.__persoraAudioInstances[0].currentTime);

  for (const navLabel of ["Overview", "Persora Docs", "Projects", "Settings", "Overview"]) {
    await page.locator('nav[aria-label="Workspace navigation"]').getByRole("button", { name: navLabel, exact: true }).click();
    await page.waitForTimeout(160);
    assert.equal(await page.locator(".as-mini-player").count(), 0, `AudioSpace player hidden on ${navLabel}`);
    assert.equal(await page.locator(".as-player-main").count(), 0, `No legacy player on ${navLabel}`);
    // Dynamic Island must NOT auto-expand on page navigation
    assert.equal(
      await page.getByRole("button", { name: /^Open workspace controls/ }).getAttribute("aria-expanded"),
      "false",
      `Dynamic Island did not auto-expand when navigating to ${navLabel}`,
    );
  }

  const stateOnDashboard = await page.evaluate(() => ({
    instances: window.__persoraAudioInstances.length,
    paused: window.__persoraAudioInstances[0].paused,
    currentTime: window.__persoraAudioInstances[0].currentTime,
  }));
  assert.equal(stateOnDashboard.instances, 1, "Still a single HTMLAudioElement across all page navigations");
  assert.equal(stateOnDashboard.paused, false, "Audio continues playing uninterrupted on Dashboard");
  assert.ok(stateOnDashboard.currentTime > timeBeforeLeave, "Playback time continued advancing smoothly");

  // Verify collapsed Dynamic Island shows Persora logo + tiny animated equalizer + unread dot with ZERO overlap
  const islandFace = page.locator(".dynamic-island-anchor .island-face");
  const markBox = await islandFace.locator(".island-mark").boundingBox();
  const eqBox = await islandFace.locator(".island-face-eq").boundingBox();
  const dotBox = await islandFace.locator(".island-face-dot").boundingBox();
  assert.ok(markBox && eqBox && dotBox, "Persora mark, equalizer, and unread dot all present in collapsed pill");
  assert.equal(await islandFace.locator(".island-face-eq").getAttribute("data-playing"), "true");
  assert.ok(markBox.x + markBox.width <= eqBox.x, "Persora mark sits cleanly to the left of equalizer without overlap");
  assert.ok(eqBox.x + eqBox.width <= dotBox.x, "Equalizer sits cleanly to the left of unread notification dot without overlap");
  assert.equal((await islandFace.textContent() || "").trim(), "", "Collapsed pill displays no track title text");
  assert.equal(await islandFace.locator("img").count(), 0, "Collapsed pill displays no album artwork");
  await snap(page, "04-dashboard-collapsed-island-playing-light");
  ok("Collapsed Dynamic Island verified (logo preserved, animated equalizer active, zero overlap)");

  // 4. Expand Dynamic Island on Dashboard -> test Now Playing + existing island controls
  step("4. Expand Dynamic Island: verify Now Playing + existing controls (Search, Theme, Notifications, Launcher, Avatar)");
  await page.getByRole("button", { name: /^Open workspace controls/ }).click();
  const nowPlaying = page.locator(".dynamic-island-anchor .island-now-playing");
  await nowPlaying.waitFor({ state: "visible" });

  assert.match(await nowPlaying.locator(".island-np-title").textContent() || "", /Founder Keynote/);
  assert.equal(await nowPlaying.locator(".as-artwork-badge.has-image img").count(), 1, "Miniature artwork visible in expanded island");
  assert.equal(await nowPlaying.locator(".as-audio-eq").getAttribute("data-playing"), "true");

  // Verify all existing Dynamic Island controls remain visible and aligned in .island-actions
  const islandActions = page.locator(".dynamic-island-anchor .island-actions");
  assert.equal(await islandActions.locator(".global-search-trigger").isVisible(), true);
  assert.equal(await islandActions.locator(".ds-theme-toggle").isVisible(), true);
  assert.equal(await islandActions.locator(".notification-button").isVisible(), true);
  assert.equal(await islandActions.getByRole("button", { name: "Add document" }).isVisible(), true);
  assert.equal(await islandActions.getByRole("button", { name: "Persora apps", exact: true }).isVisible(), true);
  assert.equal(await islandActions.locator(".island-avatar").isVisible(), true);
  await snap(page, "05-dashboard-expanded-island-now-playing-light");

  // Verify App Launcher opens cleanly right beneath .island-actions without overlapping Now Playing
  await islandActions.getByRole("button", { name: "Persora apps", exact: true }).click();
  const launcherPanel = page.locator(".app-launcher-panel");
  await launcherPanel.waitFor({ state: "visible" });
  const [npBox, launcherBox] = [await nowPlaying.boundingBox(), await launcherPanel.boundingBox()];
  assert.ok(npBox && launcherBox && launcherBox.y >= npBox.y + npBox.height, "App Launcher opens below island without overlapping Now Playing");
  await page.keyboard.press("Escape");
  await sleep(220);

  // Pause from Dynamic Island -> verify paused state in expanded & collapsed modes
  await nowPlaying.getByRole("button", { name: "Pause", exact: true }).click();
  await eventually(
    () => page.evaluate(() => window.__persoraAudioInstances[0].paused),
    (paused) => paused === true,
    "Audio paused from Dynamic Island",
  );
  assert.equal(await nowPlaying.locator(".as-audio-eq").getAttribute("data-playing"), "false", "Expanded equalizer stops when paused");

  // Collapse island while paused -> collapsed island stays clean (no equalizer when paused)
  await page.locator("main.workspace-content").click({ position: { x: 24, y: 240 } });
  await eventually(
    () => page.getByRole("button", { name: /^Open workspace controls/ }).getAttribute("aria-expanded"),
    (exp) => exp === "false",
    "Island collapsed on outside click",
  );
  assert.equal(await page.locator(".island-face-eq").count(), 0, "Collapsed island hides equalizer when audio is paused");

  // Re-open island -> Now Playing is still available so user can resume, switch tracks, and seek!
  await page.getByRole("button", { name: /^Open workspace controls/ }).click();
  await nowPlaying.waitFor({ state: "visible" });
  await nowPlaying.getByRole("button", { name: "Play", exact: true }).click();
  await eventually(
    () => page.evaluate(() => !window.__persoraAudioInstances[0].paused),
    Boolean,
    "Audio resumed from Dynamic Island",
  );

  // Switch to Next track ("Architecture Voice Memo") directly from Dynamic Island
  await nowPlaying.getByRole("button", { name: "Next track" }).click();
  await eventually(
    async () => (await nowPlaying.locator(".island-np-title").textContent()) || "",
    (t) => t.includes("Architecture Voice Memo"),
    "Switched to next track from Dynamic Island",
  );

  // Seek to 6.2s via Dynamic Island seek slider
  const seekSlider = nowPlaying.getByRole("slider", { name: "Seek audio position" });
  await eventually(
    () => seekSlider.evaluate((el) => !el.disabled && Number(el.max) >= 10),
    Boolean,
    "Seek slider enabled once track duration is ready",
  );
  await seekSlider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "6.2");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const afterSeek = await page.evaluate(() => window.__persoraAudioInstances[0].currentTime);
  assert.ok(afterSeek >= 5.8, `Expected seeked time >= 5.8s, got ${afterSeek}`);

  // Switch to Dark theme right from Dynamic Island and capture dark-mode screenshots!
  await islandActions.locator(".ds-theme-toggle").click();
  await page.waitForTimeout(200);
  await snap(page, "06-dashboard-expanded-island-dark");

  // 5. Return to AudioSpace via clicking Now Playing lead -> verify track & playback position restored
  step("5. Return to AudioSpace and verify active track + playback position are seamlessly restored");
  await nowPlaying.getByRole("button", { name: /Open Architecture Voice Memo in AudioSpace/ }).click();
  await page.getByRole("heading", { name: "AudioSpace", level: 2 }).waitFor({ state: "visible" });
  await miniPlayer.waitFor({ state: "visible" });
  assert.match(await miniPlayer.locator(".as-mini-title").textContent() || "", /Architecture Voice Memo/);
  const timeBackInAudioSpace = await page.evaluate(() => window.__persoraAudioInstances[0].currentTime);
  assert.ok(timeBackInAudioSpace >= 6.0, `Playback position preserved on return (${timeBackInAudioSpace.toFixed(2)}s)`);
  assert.equal(await page.evaluate(() => window.__persoraAudioInstances.length), 1, "Still single HTMLAudioElement");
  await snap(page, "07-audiospace-restored-dark");
  ok("AudioSpace player restored with exact track and preserved playback position in Dark theme");

  // 6. Mobile responsiveness (390×844 & 320×640) in both AudioSpace and Dynamic Island
  step("6. Verify mobile viewports (390×844 and 320×640) for AudioSpace player & Dynamic Island Now Playing");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(240);
  const mobileOverflowAudio = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(mobileOverflowAudio, true, "Zero horizontal overflow in AudioSpace at 390px");
  await snap(page, "08-mobile-390-audiospace-dark");

  // Navigate to Dashboard on mobile via Dynamic Island -> Open workspace sections -> Overview
  await page.getByRole("button", { name: /^Open workspace controls/ }).click();
  await page.locator(".dynamic-island-anchor .island-sections").click();
  await page.locator('nav[aria-label="Workspace navigation"]').getByRole("button", { name: "Overview", exact: true }).click();
  await page.waitForTimeout(240);
  assert.equal(await page.locator(".as-mini-player").count(), 0, "AudioSpace player hidden on mobile Dashboard");
  assert.equal(await page.locator(".island-face-eq").getAttribute("data-playing"), "true", "Mobile collapsed island shows animated equalizer");

  // Expand Dynamic Island on 390px and 320px narrow phone
  await page.getByRole("button", { name: /^Open workspace controls/ }).click();
  await nowPlaying.waitFor({ state: "visible" });
  await snap(page, "09-mobile-390-expanded-island-dark");

  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(240);
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(narrowOverflow, true, "Zero horizontal overflow with expanded Now Playing island at 320px");
  const narrowIslandBox = await page.locator(".dynamic-island-anchor .island-shell").boundingBox();
  assert.ok(narrowIslandBox && narrowIslandBox.x >= 0 && narrowIslandBox.x + narrowIslandBox.width <= 320.5, "320px island fits cleanly inside viewport");

  // Close audio player from Dynamic Island (`×`) -> Now Playing disappears cleanly
  await nowPlaying.getByRole("button", { name: "Close audio player" }).click();
  await eventually(
    () => nowPlaying.count(),
    (c) => c === 0,
    "Closing audio from Dynamic Island removes Now Playing section",
  );
  ok("Mobile 390px & 320px viewports and Close behavior verified");

  assert.deepEqual(errors, [], `Unexpected browser errors:\n${errors.join("\n")}`);
  console.log(`\n✅ All AudioSpace Player & Dynamic Island E2E checks passed! Screenshots in ${SHOTS_DIR}\n`);
} finally {
  await browser.close();
  server.close();
  await ctx.close?.();
}
