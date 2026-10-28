import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { columnName, WorkbookCalculator } from "../cloudflare/table-formula.js";
import {
  BORDER_COLORS,
  BORDER_LINE_STYLES,
  DEFAULT_SHEET_SIZE,
  FONT_FAMILIES,
  emptySheetData,
  normalizeSaveBatch,
  normalizeSheetData,
  sanitizeStyle,
} from "../cloudflare/table-rules.js";
import {
  applyStyleToRanges,
  clearRanges,
  deleteColumns,
  deleteRows,
  duplicateSheet,
  expandRectToMerges,
  formulaCellsOf,
  insertColumns,
  insertRows,
  mergeAt,
  mergeCells,
  setCells,
  unmergeCells,
} from "../cloudflare/table-sheet-ops.js";
import { buildSheetImport, workbookXlsxSheets } from "../cloudflare/table-io.js";
import { blankSpreadsheet } from "../cloudflare/table-templates.js";
import { LAUNCHER_MODULE_IDS } from "../cloudflare/workspace-modules.js";

const rootDir = process.cwd();
const readRepoFile = (relPath) => fs.readFileSync(path.join(rootDir, relPath), "utf8");

test("Boot screen renders 15 real Persora module icons with valid orbit keyframes", () => {
  const bootSrc = readRepoFile("src/components/PersoraBootScreen.tsx");
  const indexCss = readRepoFile("src/index.css");

  assert.match(bootSrc, /LauncherModuleIcon/);
  assert.doesNotMatch(bootSrc, /FileText|KeyRound|Sparkles/);

  const moduleMatches = [...bootSrc.matchAll(/"([a-z-]+)"/g)]
    .map((m) => m[1])
    .filter((id) => LAUNCHER_MODULE_IDS.includes(id));
  const uniqueIds = new Set(moduleMatches);
  assert.equal(uniqueIds.size, 15, "Expected 15 distinct Persora launcher modules across boot rings");
  for (const id of uniqueIds) {
    assert.ok(LAUNCHER_MODULE_IDS.includes(id), `Boot icon ${id} must be a real Persora module`);
  }

  assert.match(indexCss, /--animate-orbit:\s*orbit/);
  assert.match(indexCss, /@keyframes orbit/);
});

test("MagicCard and public stylesheets never place decorative overlays above content", () => {
  const magicCardSrc = readRepoFile("src/components/ui/magic-card.tsx");
  const landingCss = readRepoFile("src/landing.css");
  const connectionsTest = readRepoFile("tests/connections-view.test.mjs");

  assert.ok(connectionsTest.length > 0);
  assert.match(magicCardSrc, /relative z-10/);
  assert.doesNotMatch(magicCardSrc, /z-20|z-30/);
  assert.doesNotMatch(landingCss, /repeating-linear-gradient/);
});

test("Spreadsheet grid defaults to 200 rows × 52 columns (A through AZ)", () => {
  assert.equal(DEFAULT_SHEET_SIZE.rows, 200);
  assert.equal(DEFAULT_SHEET_SIZE.cols, 52);
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(51), "AZ");

  const blank = blankSpreadsheet();
  assert.equal(blank.sheets[0].data.rowCount, 200);
  assert.equal(blank.sheets[0].data.colCount, 52);

  const imported = buildSheetImport(
    [{ name: "Imported", rows: [["Item", "Amount"], ["Desk", "250"]] }],
    { hasHeader: true },
  );
  assert.ok(imported.sheets[0].data.rowCount >= 200);
  assert.ok(imported.sheets[0].data.colCount >= 52);
});

test("Extended spreadsheet styles: font family, underline, strikethrough, vertical align, wrap, border styles & colors", () => {
  const blueBorder = BORDER_COLORS.find((c) => c.id === "blue").hex;
  const style = sanitizeStyle({
    ff: "mono",
    fs: 16,
    b: 1,
    i: 1,
    u: 1,
    st: 1,
    a: "c",
    va: "t",
    w: "wrap",
    bd: "trbl",
    bs: "dashed",
    bc: blueBorder,
  });
  assert.deepEqual(style, {
    ff: "mono",
    fs: 16,
    b: 1,
    i: 1,
    u: 1,
    st: 1,
    a: "c",
    va: "t",
    w: "wrap",
    bd: "trbl",
    bs: "dashed",
    bc: blueBorder,
  });

  // Defaults are omitted cleanly so storage stays compact
  assert.equal(
    sanitizeStyle({ ff: "sans", fs: 13, va: "m", w: "overflow", bs: "thin", bc: "#5F6368" }),
    undefined,
  );
  assert.ok(FONT_FAMILIES.length >= 4);
  assert.ok(BORDER_LINE_STYLES.includes("thick") && BORDER_LINE_STYLES.includes("double"));
});

test("Multi-range formatting, rich border modes, and safe content-only clearing", () => {
  let sheet = emptySheetData(200, 52);
  sheet = setCells(sheet, [
    [1, 1, { v: "Alpha" }],
    [3, 4, { v: 42 }],
    [5, 2, { f: "=E4*2" }],
  ]);

  const ranges = [
    { r1: 1, c1: 1, r2: 1, c2: 2 },
    { r1: 3, c1: 4, r2: 4, c2: 5 },
  ];
  sheet = applyStyleToRanges(sheet, ranges, { b: 1, u: 1, ff: "serif", bg: "#D1E9FF" }, "outer", {
    style: "medium",
    color: "#1A73E8",
  });

  assert.equal(sheet.cells["1:1"].s.b, 1);
  assert.equal(sheet.cells["1:1"].s.u, 1);
  assert.equal(sheet.cells["1:1"].s.ff, "serif");
  assert.equal(sheet.cells["1:1"].s.bd, "tbl");
  assert.equal(sheet.cells["1:1"].s.bs, "medium");
  assert.equal(sheet.cells["1:1"].s.bc, "#1A73E8");
  assert.equal(sheet.cells["3:4"].s.bd, "tl");
  assert.equal(sheet.cells["4:5"].s.bd, "rb");

  // Backspace/Delete equivalent: clearRanges(..., "contents") clears values/formulas ONLY, keeping rows, cols & styles!
  const afterClear = clearRanges(sheet, ranges, "contents");
  assert.equal(afterClear.rowCount, 200);
  assert.equal(afterClear.colCount, 52);
  assert.equal(afterClear.cells["1:1"].v, undefined);
  assert.equal(afterClear.cells["1:1"].s.bg, "#D1E9FF");
  assert.equal(afterClear.cells["3:4"].v, undefined);
  assert.equal(afterClear.cells["3:4"].s.bd, "tl");
  assert.equal(afterClear.cells["5:2"].f, "=E4*2");
});

test("Cell merge & unmerge (all, horizontal, vertical), selection expansion, and structural row/col remapping", () => {
  let data = emptySheetData(200, 52);
  data = setCells(data, [
    [0, 1, { v: "Q4 Summary", s: { b: 1 } }],
    [0, 2, { v: "Ignored subordinate" }],
    [2, 0, { v: 100 }],
    [3, 0, { v: 250 }],
    [4, 0, { f: "=SUM(A3:A4)" }],
  ]);

  data = mergeCells(data, { r1: 0, c1: 0, r2: 1, c2: 3 }, "all");
  assert.deepEqual(mergeAt(data, 1, 2), { r1: 0, c1: 0, r2: 1, c2: 3 });
  assert.equal(data.cells["0:0"].v, "Q4 Summary");
  assert.equal(data.cells["0:1"].v, undefined);
  assert.equal(data.cells["0:2"], undefined);

  // Partial selection across a merge expands to encompass the full merged region
  assert.deepEqual(expandRectToMerges(data, { r1: 1, c1: 2, r2: 2, c2: 2 }), { r1: 0, c1: 0, r2: 2, c2: 3 });

  // Horizontal merge across multiple rows
  data = mergeCells(data, { r1: 6, c1: 1, r2: 7, c2: 3 }, "horizontal");
  assert.deepEqual(mergeAt(data, 6, 2), { r1: 6, c1: 1, r2: 6, c2: 3 });
  assert.deepEqual(mergeAt(data, 7, 2), { r1: 7, c1: 1, r2: 7, c2: 3 });

  // Insert row & column inside/before merged cells remaps merges and formulas cleanly
  const s1Id = crypto.randomUUID();
  const s2Id = crypto.randomUUID();
  let wb = { sheets: [{ id: s1Id, name: "Sheet1", position: 0, data: { ...data, frozenRows: 2, frozenCols: 1 } }] };
  wb = insertRows(wb, s1Id, 1, 1);
  assert.deepEqual(mergeAt(wb.sheets[0].data, 2, 2), { r1: 0, c1: 0, r2: 2, c2: 3 });
  wb = insertColumns(wb, s1Id, 0, 1);
  assert.deepEqual(mergeAt(wb.sheets[0].data, 0, 1), { r1: 0, c1: 1, r2: 2, c2: 4 });

  // Formula evaluation stays intact
  const calc = new WorkbookCalculator({
    sheets: () => wb.sheets.map((s) => ({ id: s.id, name: s.name, rows: s.data.rowCount, cols: s.data.colCount })),
    cell: (_id, r, c) => wb.sheets[0].data.cells[`${r}:${c}`],
    formulaCells: () => formulaCellsOf(wb.sheets[0].data),
  });
  calc.rebuild();
  assert.equal(calc.value(s1Id, 5, 1), 350);

  // Duplicate & delete rows/cols keep normalized merges & frozenCols
  wb = duplicateSheet(wb, s1Id, s2Id);
  assert.equal(wb.sheets[1].data.merges.length, 3);
  wb = deleteRows(wb, s1Id, 1, 1);
  wb = deleteColumns(wb, s1Id, 0, 1);
  assert.deepEqual(mergeAt(wb.sheets[0].data, 0, 0), { r1: 0, c1: 0, r2: 1, c2: 3 });

  // Save batch & normalizeSheetData preserve merges and frozenCols
  const batch = normalizeSaveBatch("spreadsheet", {
    baseRevision: 1,
    batchId: crypto.randomUUID(),
    sheets: { upsert: [wb.sheets[0]] },
  });
  assert.equal(batch.sheetUpserts[0].data.frozenCols, 1);
  assert.equal(batch.sheetUpserts[0].data.merges.length, 3);

  // XLSX export includes span, rowSpan, stickyRowsCount, and stickyColumnsCount
  const xlsx = workbookXlsxSheets([wb.sheets[0]]);
  assert.equal(xlsx[0].stickyRowsCount, 2);
  assert.equal(xlsx[0].stickyColumnsCount, 1);
  assert.equal(xlsx[0].data[0][0].span, 4);
  assert.equal(xlsx[0].data[0][0].rowSpan, 2);

  // Unmerge removes the merged region while preserving anchor text
  const unmerged = unmergeCells(wb.sheets[0].data, { r1: 0, c1: 0, r2: 0, c2: 0 });
  assert.equal(mergeAt(unmerged, 0, 0), null);
  assert.equal(unmerged.cells["0:0"].v, "Q4 Summary");
  assert.equal(normalizeSheetData(unmerged).merges.length, 2);
});

test("Public website routes, hero headline, 5 categories, 8 featured tools, and footer links are wired cleanly", () => {
  const appSrc = readRepoFile("src/App.tsx");
  const sharedSrc = readRepoFile("src/components/PublicSiteShared.tsx");
  const landingSrc = readRepoFile("src/components/LandingPage.tsx");
  const infoSrc = readRepoFile("src/components/PublicInfoPage.tsx");

  for (const route of ["/features", "/security", "/help", "/about", "/privacy", "/terms", "/download", "/contact"]) {
    assert.ok(appSrc.includes(`"${route}"`), `Expected route ${route} in App.tsx`);
  }

  assert.ok(landingSrc.includes("Everything that matters. One place to manage it."));
  assert.ok(landingSrc.includes("Explore Features"));
  assert.ok(landingSrc.includes("Get Started"));

  for (const cat of ["Organize", "Plan", "Create & Edit", "Protect", "Connect"]) {
    assert.ok(sharedSrc.includes(`"${cat}"`), `Expected feature category ${cat}`);
  }

  for (const tool of [
    "Personal Document Vault",
    "PDF Studio",
    "Photo Studio",
    "Calendar",
    "Habit Tracker",
    "Loan Tracker",
    "Projects",
    "Password Manager",
  ]) {
    assert.ok(sharedSrc.includes(`"${tool}"`), `Expected featured tool ${tool}`);
  }

  for (const navLabel of ["Features", "Security &amp; Privacy", "Help", "Sign In", "Get Started", "Privacy Policy", "Terms of Service", "About"]) {
    assert.ok(sharedSrc.includes(navLabel), `Expected public nav/footer label ${navLabel}`);
  }

  // Public pages must never import local user store or private vault state
  assert.doesNotMatch(landingSrc, /getLocalItems|loadVaultItems/);
  assert.doesNotMatch(infoSrc, /getLocalItems|loadVaultItems/);
});
