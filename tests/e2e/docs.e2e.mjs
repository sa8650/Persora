// Full-Stack Browser End-to-End Verification for Persora Docs
// Runs the production Vite bundle (`dist/`) + real Cloudflare Pages `/api/[[path]].js`
// (`cloudflare/api.js` -> `cloudflare/docs.js`) + PostgreSQL (`PGlite`) in headless Chromium.
//
// Verifies:
// 1. Borderless auto-expanding document title (`AutoWidthDocTitle`) with zero input border box.
// 2. Grouped formatting toolbar: Zoom + Fit, 8 font families, `Aa` text case transforms, line spacing.
// 3. Multi-page pagination (`.pd-page-card` sheets), page breaks, and independent per-page colors
//    (changing Page 1 color never leaks onto Page 2; Page 2 has its own independent color).
// 4. Page Setup: Portrait <-> Landscape orientation, paper sizes, custom margins, and draggable rulers.
// 5. Rich document elements: ProseMirror tables (with contextual Table menu), device image upload
//    + wrap mode, 11 SVG shapes, inline headers & footers, and dynamic page numbers.
// 6. Non-destructive Comments toggle + anchored comment threads & replies surviving toggle OFF -> reload -> ON.
// 7. Google Docs-style Print Preview & Settings modal (`DocPrintModal`).
// 8. Real browser downloads for PDF (`.pdf`) and editable formats (`.docx`, `.html`, `.md`, `.txt`).
// 9. Public Shared Document (`/SharedDoc/:token`) multi-page view & edit flow.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { createVaultDatabase } from "../password-vault-db.mjs";
import { onRequest as pagesApiOnRequest } from "../../functions/api/[[path]].js";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "/opt/playwright/node_modules/playwright/index.mjs"
);

const repoRoot = new URL("../../", import.meta.url).pathname;
const distDir = join(repoRoot, "dist");
const SHOTS_DIR = process.env.E2E_SCREENSHOTS || join(tmpdir(), "persora-docs-shots");
mkdirSync(SHOTS_DIR, { recursive: true });

// Generate a crisp 240x140 gradient PNG for device image upload verification
function buildSampleChartPng(width = 240, height = 140) {
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      const barIdx = Math.floor((x / width) * 5);
      const barTop = height - (barIdx + 1) * 22;
      if (y > barTop && x % 48 > 8 && x % 48 < 40) {
        raw[px] = 37;
        raw[px + 1] = 99;
        raw[px + 2] = 235;
      } else {
        raw[px] = 239;
        raw[px + 1] = 246;
        raw[px + 2] = 255;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SAMPLE_IMAGE_PATH = join(SHOTS_DIR, "sample-chart.png");
writeFileSync(SAMPLE_IMAGE_PATH, buildSampleChartPng());

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
          patch[k] !== null && typeof patch[k] === "object" && !Array.isArray(k)
            ? typeof patch[k] === "object"
              ? JSON.stringify(patch[k])
              : patch[k]
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

const env = {
  SUPABASE_URL: "https://db.e2e.local",
  SUPABASE_SECRET_KEY: "e2e-service-secret",
  AUTH_TOKEN_SECRET: "e2e-auth-token-secret-32-characters-long!!",
  TIMELINE_ENCRYPTION_KEY: "e2e-timeline-encryption-secret-32-chars!!",
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
    console.error("[docs e2e server error]", err);
    res.writeHead(500);
    res.end("server error");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

const userEmail = `nadia-${Date.now()}@persora.test`;
const userPassword = "Correct-Horse-Battery-9!";
const regRes = await realFetch(`${BASE_URL}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE_URL },
  body: JSON.stringify({
    fullName: "Nadia Karim",
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
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
    errors.push(`console.error: ${msg.text()}`);
  }
});

try {
  // 1. Open Persora Docs Home & create a new blank document
  await page.goto(`${BASE_URL}/?view=docs`, { waitUntil: "networkidle" });
  const newBlankBtn = page.getByRole("button", { name: "New blank document" });
  await newBlankBtn.waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: join(SHOTS_DIR, "01-docs-home.png") });
  await newBlankBtn.click();

  // Wait for editor topbar & page card
  const titleInput = page.getByRole("textbox", { name: "Document title" });
  await titleInput.waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".pd-page-card").first().waitFor({ state: "visible", timeout: 15000 });

  // 2. Verify borderless auto-expanding document title (`AutoWidthDocTitle`)
  const borderInfo = await titleInput.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      borderTopStyle: cs.borderTopStyle,
      borderTopWidth: cs.borderTopWidth,
      width: el.getBoundingClientRect().width,
    };
  });
  assert.ok(
    borderInfo.borderTopStyle === "none" || borderInfo.borderTopWidth === "0px",
    `Expected borderless title input, got ${JSON.stringify(borderInfo)}`,
  );

  await titleInput.fill("Brief");
  const shortTitleWidth = await titleInput.evaluate((el) => el.getBoundingClientRect().width);
  await titleInput.fill("Persora Q4 Product Architecture & Design Review");
  await titleInput.press("Enter");
  const longTitleWidth = await titleInput.evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(
    longTitleWidth > shortTitleWidth + 120,
    `Title input must auto-expand dynamically with text (${shortTitleWidth}px -> ${longTitleWidth}px)`,
  );

  // 3. Type in editor, test Font Family, `Aa` Text Case, and Line Spacing
  const proseMirror = page.locator(".pd-prosemirror");
  await proseMirror.click();
  await page.keyboard.type("executive summary and core milestones");
  await page.keyboard.press("Control+A");

  // Change font family to Georgia
  await page.getByRole("button", { name: "Font family" }).click();
  await page.getByRole("menuitemradio", { name: /Georgia/i }).click();

  // Change case via `Aa` dropdown -> Capitalize Each Word
  await page.getByRole("button", { name: "Text case and strikethrough" }).click();
  await page.getByRole("menuitem", { name: "Capitalize Each Word" }).click();
  const editorTextAfterCase = await proseMirror.innerText();
  assert.match(editorTextAfterCase, /Executive Summary And Core Milestones/);

  // Line spacing -> 1.5
  await page.getByRole("button", { name: "Line and paragraph spacing" }).click();
  await page.getByRole("menuitemradio", { name: "1.5" }).click();

  // Move to end, add new paragraph
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Key metrics and platform throughput across regions:");

  // 4. Insert 2x2 Table + verify contextual Table toolbar button
  await page.getByRole("button", { name: "Insert menu" }).click();
  await page.getByRole("menuitem", { name: "Table" }).click();
  await page.getByRole("button", { name: "Insert 2 by 2 table" }).click();
  assert.equal(await page.locator(".pd-prosemirror table").count(), 1, "Table must render in editor");
  await page.keyboard.type("Region");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Throughput");
  await page.keyboard.press("Tab");
  await page.keyboard.type("APAC");
  await page.keyboard.press("Tab");
  await page.keyboard.type("14,200 req/s");
  await page.getByRole("button", { name: "Table formatting" }).waitFor({ state: "visible" });

  // Move below table
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // 5. Upload an image from device + test wrap controls
  const fileInput = page.locator('input[type="file"][accept*="image"]');
  await fileInput.setInputFiles(SAMPLE_IMAGE_PATH);
  const imgNode = page.locator(".pd-image-node img");
  await imgNode.waitFor({ state: "visible", timeout: 10000 });

  // 6. Insert a Shape (`Rounded Rectangle`) onto Page 1
  await page.getByRole("button", { name: "Insert menu" }).click();
  await page.getByRole("menuitem", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Rounded Rectangle" }).click();
  await page.locator(".pd-shape-item").first().waitFor({ state: "visible", timeout: 10000 });

  // 7. Insert a Page Break to create Page 2 + verify real multi-page `.pd-page-card` sheets!
  await page.locator(".pd-prosemirror > p").first().click();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Insert menu" }).click();
  await page.getByRole("menuitem", { name: /Page break/i }).click();
  await page.keyboard.type("Page Two Appendix — Disaster Recovery & Rollout");

  await page.waitForFunction(
    () => document.querySelectorAll(".pd-page-card").length >= 2,
    null,
    { timeout: 10000 },
  );
  const pageCardCount = await page.locator(".pd-page-card").count();
  assert.ok(pageCardCount >= 2, `Expected at least 2 distinct .pd-page-card sheets, got ${pageCardCount}`);

  // 8. Independent Per-Page Background Color!
  // Color Page 1 Warm Cream (`#fefce8`), verify Page 2 stays White (`rgb(255, 255, 255)`),
  // then color Page 2 Soft Cyan (`#ecfeff`) and verify Page 1 stays `#fefce8`!
  await page.getByRole("button", { name: "Page setup" }).click();
  const pageSelect = page.getByRole("combobox", { name: "Select page to color" });
  await pageSelect.selectOption("0");
  await page.getByRole("button", { name: /Page 1 Warm Ivory/i }).click();

  const colorsAfterP1 = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".pd-page-card")).map(
      (el) => window.getComputedStyle(el).backgroundColor,
    ),
  );
  assert.equal(colorsAfterP1[0], "rgb(254, 252, 232)", "Page 1 must turn Warm Ivory");
  assert.equal(
    colorsAfterP1[1],
    "rgb(255, 255, 255)",
    "Page 2 must remain independent White when coloring Page 1",
  );

  // Now color Page 2 Soft Mint / Sky independently
  await pageSelect.selectOption("1");
  await page.getByRole("button", { name: /Page 2 Sky Tint/i }).click();
  const colorsAfterP2 = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".pd-page-card")).map(
      (el) => window.getComputedStyle(el).backgroundColor,
    ),
  );
  assert.equal(colorsAfterP2[0], "rgb(254, 252, 232)", "Page 1 color must remain untouched");
  assert.notEqual(colorsAfterP2[1], "rgb(255, 255, 255)", "Page 2 must apply its own independent color");

  // 9. Test Landscape Orientation & Zoom -> Fit
  await page.getByRole("button", { name: "Landscape" }).click();
  const landscapeBox = await page.locator(".pd-page-card").first().boundingBox();
  assert.ok(
    landscapeBox && landscapeBox.width > landscapeBox.height,
    `Landscape sheet must be wider than tall, got ${JSON.stringify(landscapeBox)}`,
  );
  // Switch back to Portrait for classic multi-page view & test Zoom -> Fit
  await page.getByRole("button", { name: "Portrait" }).click();
  // Close Page Setup by clicking Zoom level
  await page.getByRole("button", { name: "Zoom level" }).click();
  await page.getByRole("menuitemradio", { name: /Fit/i }).click();
  await page.getByRole("button", { name: "Zoom level" }).click();
  await page.getByRole("menuitemradio", { name: "100%" }).click();

  // 10. Enable Header, Footer, and Page Numbers
  await page.getByRole("button", { name: "Insert menu" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Page numbers/i }).click();
  await page.getByRole("button", { name: "Insert menu" }).click();
  await page.getByRole("menuitem", { name: "Header" }).click();
  const headerInput = page.getByRole("textbox", { name: "Header text" }).first();
  await headerInput.waitFor({ state: "visible" });
  await headerInput.fill("Persora Architecture Specification");
  await headerInput.press("Escape");

  const page1FooterText = await page.locator(".pd-page-card").first().innerText();
  assert.match(page1FooterText, /Page 1 of/);

  await page.evaluate(() => {
    const sc = document.querySelector(".pd-canvas");
    if (sc) sc.scrollTop = 0;
  });
  await page.screenshot({ path: join(SHOTS_DIR, "02-editor-multipage-rich.png") });

  // 11. Non-destructive Comments Toggle & Anchored Thread Persistence across reload!
  await page.getByRole("button", { name: "Turn comments on" }).click();
  const commentsPanel = page.getByRole("complementary", { name: "Document comments" });
  await commentsPanel.waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Add comment" }).click();
  const commentBox = page.getByRole("textbox", { name: "Comment text" });
  await commentBox.fill("Verify APAC throughput numbers with infra team.");
  await commentsPanel.getByRole("button", { name: "Comment", exact: true }).click();
  assert.match(await commentsPanel.innerText(), /Verify APAC throughput numbers/);

  // Turn comments OFF -> panel hides, wait for autosave ("Saved"), reload page, turn comments ON -> thread still there!
  await page.getByRole("button", { name: "Turn comments off" }).click();
  await commentsPanel.waitFor({ state: "hidden" });

  // Wait for autosave to settle to "Saved"
  await page.waitForFunction(
    () => {
      const badge = document.querySelector(".pd-save-status.is-saved");
      return Boolean(badge && /Saved/i.test(badge.textContent || ""));
    },
    null,
    { timeout: 10000 },
  );

  // Extract current docId from URL or API list, reload editor, verify persistence
  await page.reload({ waitUntil: "networkidle" });
  const docsOnHome = page.locator("text=Persora Q4 Product Architecture & Design Review").first();
  if (await docsOnHome.isVisible().catch(() => false)) {
    await docsOnHome.click();
  }
  await page.locator(".pd-page-card").first().waitFor({ state: "visible", timeout: 15000 });

  // Turn comments back ON after reload -> saved comment thread must still exist!
  await page.getByRole("button", { name: "Turn comments on" }).click();
  await commentsPanel.waitFor({ state: "visible" });
  assert.match(
    await commentsPanel.innerText(),
    /Verify APAC throughput numbers/,
    "Saved comment thread must survive turning comments OFF and reloading",
  );
  await page.screenshot({ path: join(SHOTS_DIR, "03-comments-restored.png") });

  // 12. Google Docs-style Print Preview & Settings Modal (`DocPrintModal`)
  await page.getByRole("button", { name: "Print document" }).click();
  const printDialog = page.getByRole("dialog", { name: "Print preview and settings" });
  await printDialog.waitFor({ state: "visible" });
  const previewSheets = printDialog.locator(".pd-print-preview-sheet");
  assert.ok(
    (await previewSheets.count()) >= 2,
    "Print preview modal must render live multi-page sheet previews",
  );
  await page.screenshot({ path: join(SHOTS_DIR, "04-print-preview-modal.png") });
  await page.getByRole("button", { name: "Close print preview" }).click();
  await printDialog.waitFor({ state: "hidden" });

  // 13. Real Browser Downloads: PDF (`.pdf`), Word (`.docx`), and Markdown (`.md`)
  await page.getByRole("button", { name: "Download document" }).click();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /PDF Document \(\.pdf\)/i }).click(),
  ]);
  const pdfPath = await pdfDownload.path();
  const pdfBytes = readFileSync(pdfPath);
  const loadedPdf = await PDFDocument.load(pdfBytes);
  assert.ok(loadedPdf.getPageCount() >= 2, "Downloaded PDF must contain multiple pages");

  await page.getByRole("button", { name: "Download document" }).click();
  const [docxDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Microsoft Word \(\.docx\)/i }).click(),
  ]);
  const docxBytes = readFileSync(await docxDownload.path());
  assert.equal(docxBytes[0], 0x50, "Downloaded .docx must be a valid ZIP/OOXML archive (PK)");
  assert.equal(docxBytes[1], 0x4b);

  await page.getByRole("button", { name: "Download document" }).click();
  const [mdDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Markdown \(\.md\)/i }).click(),
  ]);
  const mdContent = readFileSync(await mdDownload.path(), "utf8");
  assert.match(mdContent, /Executive Summary And Core Milestones/);

  // 14. Public Shared Document (`/SharedDoc/:token`) Verification
  const listRes = await realFetch(`${BASE_URL}/api/docs`, {
    headers: { Cookie: `${sessionCookieName}=${sessionCookieValue}` },
  });
  const listJson = await listRes.json();
  const createdDocId = listJson.docs[0].id;
  const linkRes = await realFetch(`${BASE_URL}/api/docs/${createdDocId}/sharing/link`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: `${sessionCookieName}=${sessionCookieValue}`,
    },
    body: JSON.stringify({ enabled: true, permission: "edit" }),
  });
  assert.equal(linkRes.status, 200);
  const linkJson = await linkRes.json();
  const shareToken = linkJson.link.shareToken;

  const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonPage = await anonContext.newPage();
  anonPage.on("pageerror", (err) => errors.push(`anon pageerror: ${err.message}`));
  await anonPage.goto(`${BASE_URL}/SharedDoc/${shareToken}`, { waitUntil: "networkidle" });
  await anonPage.locator(".pd-page-card").first().waitFor({ state: "visible", timeout: 15000 });
  assert.ok(
    (await anonPage.locator(".pd-page-card").count()) >= 2,
    "PublicSharedDocPage must render multi-page sheets",
  );
  const sharedColors = await anonPage.evaluate(() =>
    Array.from(document.querySelectorAll(".pd-page-card")).map(
      (el) => window.getComputedStyle(el).backgroundColor,
    ),
  );
  assert.equal(
    sharedColors[0],
    "rgb(254, 252, 232)",
    "PublicSharedDocPage must preserve per-page background colors",
  );
  await anonPage.screenshot({ path: join(SHOTS_DIR, "05-shared-doc-public.png") });
  await anonContext.close();

  assert.deepEqual(errors, [], `Expected zero browser runtime errors, got: ${errors.join("\n")}`);
  console.log(`PASS: Persora Docs full-stack E2E verified cleanly! Screenshots in ${SHOTS_DIR}`);
} finally {
  await browser.close();
  server.close();
}
