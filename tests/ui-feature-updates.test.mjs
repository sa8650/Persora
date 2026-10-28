import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

import { WorkbookCalculator } from "../cloudflare/table-formula.js";
import {
  DEFAULT_SHEET_SIZE,
  SHEET_CHART_TYPES,
  TABLE_LIMITS,
  emptySheetData,
  normalizeSaveBatch,
} from "../cloudflare/table-rules.js";
import {
  addSheetChart,
  cellFromInput,
  deleteCellComment,
  deleteColumns,
  deleteRows,
  deleteSheetChart,
  detectRangeHeaders,
  extendSheetDimensions,
  extractSheetChartSeries,
  formatRangeName,
  formulaCellsOf,
  insertColumns,
  insertRows,
  parseRangeText,
  renameSheet,
  setCellComment,
  setCells,
  setGridlinesHidden,
  updateSheetChart,
} from "../cloudflare/table-sheet-ops.js";

const rootDir = process.cwd();
const readRepoFile = (relPath) => fs.readFileSync(path.join(rootDir, relPath), "utf8");

function loadTsModule(relPath) {
  const source = readRepoFile(relPath);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mod = { exports: {} };
  const context = vm.createContext({
    module: mod,
    exports: mod.exports,
    Uint8ClampedArray,
    Float32Array,
    Math,
    Array,
    Object,
    Set,
    Map,
    Number,
    String,
  });
  new vm.Script(transpiled, { filename: relPath }).runInContext(context);
  return mod.exports;
}

test("Persora Table: sheet dimensions extend cleanly beyond 200 × 52 up to 5,000 × 200 and gridlines toggle persists", () => {
  assert.equal(DEFAULT_SHEET_SIZE.rows, 200);
  assert.equal(DEFAULT_SHEET_SIZE.cols, 52);
  assert.equal(TABLE_LIMITS.rows, 5000);
  assert.equal(TABLE_LIMITS.cols, 200);

  const sheetId = crypto.randomUUID();
  let data = emptySheetData();
  data = setCells(data, [
    [0, 0, cellFromInput("Revenue")],
    [0, 51, cellFromInput("100")],
  ]);
  data = extendSheetDimensions(data, 200, 26);
  assert.equal(data.rowCount, 400);
  assert.equal(data.colCount, 78);
  assert.equal(data.cells["0:0"].v, "Revenue");
  assert.equal(data.cells["0:51"].v, 100);

  // Clamps safely at TABLE_LIMITS
  data = extendSheetDimensions(data, 99999, 99999);
  assert.equal(data.rowCount, 5000);
  assert.equal(data.colCount, 200);

  // Toggle gridlines hidden & round-trip through normalizeSaveBatch
  data = setGridlinesHidden(data, true);
  assert.equal(data.hideGridlines, true);
  const saved = normalizeSaveBatch("spreadsheet", {
    baseRevision: 1,
    batchId: crypto.randomUUID(),
    sheets: { upsert: [{ id: sheetId, name: "Sheet 1", position: 0, data }] },
  });
  assert.equal(saved.sheetUpserts.length, 1);
  assert.equal(saved.sheetUpserts[0].data.hideGridlines, true);
  assert.equal(saved.sheetUpserts[0].data.rowCount, 5000);
  assert.equal(saved.sheetUpserts[0].data.colCount, 200);

  data = setGridlinesHidden(data, false);
  assert.equal(Boolean(data.hideGridlines), false);
});

test("Persora Table: cell comments preserve author & timestamps, support edit/delete, remap on row/col changes, and persist", () => {
  const sheetId = crypto.randomUUID();
  let data = emptySheetData();

  data = setCellComment(data, 2, 1, {
    text: "Check Q3 vendor invoice",
    author: "Ariana Rahman",
    now: "2026-10-27T08:00:00.000Z",
  });
  const initialComment = data.comments["2:1"];
  assert.ok(initialComment);
  assert.equal(initialComment.text, "Check Q3 vendor invoice");
  assert.equal(initialComment.author, "Ariana Rahman");
  assert.equal(initialComment.createdAt, "2026-10-27T08:00:00.000Z");

  // Edit preserves original createdAt while updating updatedAt
  data = setCellComment(data, 2, 1, {
    text: "Verified against receipt #402",
    author: "Ariana Rahman",
    now: "2026-10-27T09:15:00.000Z",
  });
  assert.equal(data.comments["2:1"].text, "Verified against receipt #402");
  assert.equal(data.comments["2:1"].createdAt, "2026-10-27T08:00:00.000Z");
  assert.equal(data.comments["2:1"].updatedAt, "2026-10-27T09:15:00.000Z");

  let wb = { sheets: [{ id: sheetId, name: "Budget", position: 0, data }] };

  // Insert row above shifts comment from 2:1 -> 3:1
  wb = insertRows(wb, sheetId, 1, 1);
  assert.equal(wb.sheets[0].data.comments["2:1"], undefined);
  assert.equal(wb.sheets[0].data.comments["3:1"].text, "Verified against receipt #402");

  // Insert column to the left shifts comment from 3:1 -> 3:2
  wb = insertColumns(wb, sheetId, 0, 1);
  assert.equal(wb.sheets[0].data.comments["3:2"].text, "Verified against receipt #402");

  // Save batch normalization preserves comments
  const batch = normalizeSaveBatch("spreadsheet", {
    baseRevision: 1,
    batchId: crypto.randomUUID(),
    sheets: { upsert: [{ id: sheetId, name: "Budget", position: 0, data: wb.sheets[0].data }] },
  });
  assert.equal(batch.sheetUpserts[0].data.comments["3:2"].author, "Ariana Rahman");

  // Delete comment removes cleanly
  const cleaned = deleteCellComment(wb.sheets[0].data, 3, 2);
  assert.equal(cleaned.comments, undefined);
});

test("Persora Table: bar, line, pie, and doughnut charts extract series, remap ranges on structural edits, and persist", () => {
  assert.deepEqual([...SHEET_CHART_TYPES], ["bar", "line", "pie", "doughnut"]);

  const sheetId = crypto.randomUUID();
  let data = emptySheetData();
  data = setCells(data, [
    [0, 0, cellFromInput("Quarter")],
    [0, 1, cellFromInput("Online")],
    [0, 2, cellFromInput("Retail")],
    [1, 0, cellFromInput("Q1")],
    [1, 1, cellFromInput("120")],
    [1, 2, cellFromInput("80")],
    [2, 0, cellFromInput("Q2")],
    [2, 1, cellFromInput("180")],
    [2, 2, cellFromInput("=B2+20")],
  ]);

  const range = { r1: 0, c1: 0, r2: 2, c2: 2 };
  assert.equal(formatRangeName(range), "A1:C3");
  assert.deepEqual(parseRangeText("A1:C3", 200, 52), range);

  const hasHeaders = detectRangeHeaders(data, range);
  assert.equal(hasHeaders, true);

  for (const chartType of SHEET_CHART_TYPES) {
    data = addSheetChart(data, {
      title: `${chartType.toUpperCase()} Overview`,
      type: chartType,
      range,
      hasHeaders,
    });
  }
  assert.equal(data.charts.length, 4);

  let wb = { sheets: [{ id: sheetId, name: "Sales", position: 0, data }] };
  const calc = new WorkbookCalculator({
    sheets: () => wb.sheets.map((s) => ({ id: s.id, name: s.name, rows: s.data.rowCount, cols: s.data.colCount })),
    cell: (id, row, col) => wb.sheets.find((s) => s.id === id)?.data.cells[`${row}:${col}`],
    formulaCells: (id) => {
      const s = wb.sheets.find((sh) => sh.id === id);
      return s ? formulaCellsOf(s.data) : [];
    },
  });
  calc.rebuild();
  const extracted = extractSheetChartSeries(wb.sheets[0].data, wb.sheets[0].data.charts[0], (r, c) =>
    calc.value(sheetId, r, c),
  );
  assert.deepEqual(extracted.categories, ["Q1", "Q2"]);
  assert.equal(extracted.series.length, 2);
  assert.equal(extracted.series[0].name, "Online");
  assert.deepEqual(extracted.series[0].values, [120, 180]);
  assert.equal(extracted.series[1].name, "Retail");
  assert.deepEqual(extracted.series[1].values, [80, 140]);

  // Update chart type & title
  const firstId = wb.sheets[0].data.charts[0].id;
  wb.sheets[0].data = updateSheetChart(wb.sheets[0].data, firstId, {
    title: "Updated Revenue Chart",
    type: "doughnut",
  });
  assert.equal(wb.sheets[0].data.charts[0].title, "Updated Revenue Chart");
  assert.equal(wb.sheets[0].data.charts[0].type, "doughnut");

  // Insert row inside range expands chart range r2 from 2 -> 3; delete restores
  wb = insertRows(wb, sheetId, 1, 1);
  assert.deepEqual(wb.sheets[0].data.charts[0].range, { r1: 0, c1: 0, r2: 3, c2: 2 });
  wb = deleteRows(wb, sheetId, 1, 1);
  assert.deepEqual(wb.sheets[0].data.charts[0].range, range);
  wb = deleteColumns(insertColumns(wb, sheetId, 1, 1), sheetId, 1, 1);
  assert.deepEqual(wb.sheets[0].data.charts[0].range, range);
  wb = renameSheet(wb, sheetId, "FY26 Sales");
  assert.equal(wb.sheets[0].name, "FY26 Sales");

  // Persist through normalizeSaveBatch
  const saved = normalizeSaveBatch("spreadsheet", {
    baseRevision: 1,
    batchId: crypto.randomUUID(),
    sheets: { upsert: [{ id: sheetId, name: wb.sheets[0].name, position: 0, data: wb.sheets[0].data }] },
  });
  assert.equal(saved.sheetUpserts[0].data.charts.length, 4);

  // Delete chart
  const afterDelete = deleteSheetChart(wb.sheets[0].data, firstId);
  assert.equal(afterDelete.charts.length, 3);
});

test("Persora Table UI: File/Edit/Insert/Format/View menus, charts, comments, and redundant header removal are wired", () => {
  const editorSrc = readRepoFile("src/components/table/SpreadsheetEditor.tsx");
  const chartsSrc = readRepoFile("src/components/table/SheetCharts.tsx");
  const tableHomeSrc = readRepoFile("src/components/table/TableHome.tsx");

  for (const menuLabel of ["File", "Edit", "Insert", "Format", "Data", "View"]) {
    assert.match(
      editorSrc,
      new RegExp(`(<MenubarTrigger>\\s*${menuLabel}\\s*</MenubarTrigger>|label="${menuLabel}")`),
      `Expected ${menuLabel} menu in SpreadsheetEditor`,
    );
  }
  assert.match(editorSrc, /SheetChartLayer/);
  assert.match(editorSrc, /SheetChartModal/);
  assert.match(editorSrc, /setCellComment/);
  assert.match(editorSrc, /deleteCellComment/);
  assert.match(editorSrc, /extendSheetDimensions/);
  assert.match(editorSrc, /setGridlinesHidden/);
  assert.match(editorSrc, /ribbonHidden/);
  assert.match(editorSrc, /toggleRibbon/);
  assert.match(chartsSrc, /id:\s*"bar"/);
  assert.match(chartsSrc, /id:\s*"line"/);
  assert.match(chartsSrc, /id:\s*"pie"/);
  assert.match(chartsSrc, /id:\s*"doughnut"/);

  // Redundant TableHome page title/subtitle removed (global topbar displays Persora Table)
  assert.doesNotMatch(tableHomeSrc, /<h1[^>]*>\s*Persora Table\s*<\/h1>/);
  assert.doesNotMatch(tableHomeSrc, /table-home-hero/);
});

test("Photo Studio Filters: 10 local non-destructive presets preserve alpha, support 0-100% intensity, and never touch R2", () => {
  const filtersMod = loadTsModule("src/lib/photo-filters.ts");
  const { PHOTO_FILTER_PRESETS, applyPhotoFilter, isFilterNeutral } = filtersMod;

  const expectedPresets = [
    ["natural", "Natural"],
    ["warm-portrait", "Warm Portrait"],
    ["cool-tone", "Cool Tone"],
    ["cinematic", "Cinematic"],
    ["film-matte", "Film Matte"],
    ["vivid", "Vivid"],
    ["golden-hour", "Golden Hour"],
    ["soft-pastel", "Soft Pastel"],
    ["classic-monochrome", "Classic Monochrome"],
    ["high-contrast-bw", "High-Contrast B&W"],
  ];

  assert.equal(PHOTO_FILTER_PRESETS.length, 10);
  assert.deepEqual(
    JSON.parse(JSON.stringify(PHOTO_FILTER_PRESETS.map((p) => [p.id, p.label]))),
    expectedPresets,
  );

  // Sample 4 pixels including semi-transparent cutout edge & full transparent background
  const rawPixels = new Uint8ClampedArray([
    210, 145, 115, 255, // warm skin midtone
    55, 95, 165, 255,   // cool shadow/sky
    240, 220, 180, 128, // semi-transparent edge
    25, 30, 35, 0,      // transparent background
  ]);
  const snapshotBefore = Array.from(rawPixels);

  // Intensity 0 and "none" leave pixels completely untouched
  const zeroBuf = new Uint8ClampedArray(rawPixels);
  applyPhotoFilter(zeroBuf, { id: "cinematic", intensity: 0 });
  assert.deepEqual(Array.from(zeroBuf), snapshotBefore);
  assert.equal(isFilterNeutral({ id: "cinematic", intensity: 0 }), true);
  assert.equal(isFilterNeutral({ id: "none", intensity: 85 }), true);
  assert.equal(isFilterNeutral({ id: "cinematic", intensity: 85 }), false);

  const signatures = new Set();
  for (const [id] of expectedPresets) {
    // Working buffer copy (mirrors renderComposite's non-destructive working buffer)
    const buf = new Uint8ClampedArray(rawPixels);
    applyPhotoFilter(buf, { id, intensity: 100 });
    // Source buffer must never be mutated
    assert.deepEqual(Array.from(rawPixels), snapshotBefore, `Preset ${id} must not mutate source pixels`);
    // Alpha channel must be preserved byte-for-byte
    assert.equal(buf[3], 255);
    assert.equal(buf[7], 255);
    assert.equal(buf[11], 128);
    assert.equal(buf[15], 0);

    // 50% intensity blends halfway between original and 100% preset
    const halfBuf = new Uint8ClampedArray(rawPixels);
    applyPhotoFilter(halfBuf, { id, intensity: 50 });
    assert.equal(halfBuf[11], 128);

    if (id === "classic-monochrome" || id === "high-contrast-bw") {
      assert.equal(buf[0], buf[1]);
      assert.equal(buf[1], buf[2]);
    }
    signatures.add(Array.from(buf).join(","));
  }
  assert.equal(signatures.size, 10, "Each of the 10 Photo Studio filter presets must have a distinct grading curve");

  // Ensure zero R2/network calls exist in photo-filters.ts or photo-studio-render.ts
  const filterSrc = readRepoFile("src/lib/photo-filters.ts");
  const renderSrc = readRepoFile("src/lib/photo-studio-render.ts");
  const modalSrc = readRepoFile("src/components/PhotoEditorModal.tsx");
  assert.doesNotMatch(filterSrc, /\bfetch\s*\(|createPhotoItem|savePhotoVersion|\/api\//);
  assert.doesNotMatch(renderSrc, /\bfetch\s*\(|createPhotoItem|savePhotoVersion|\/api\//);
  assert.match(modalSrc, /\["filters",\s*"Filters",\s*Sparkles\]/);
  assert.match(modalSrc, /filterComparing/);
  assert.match(modalSrc, /ps-filters-panel/);
  assert.match(modalSrc, /ps-filter-apply/);
  assert.match(modalSrc, /Reset/);
  assert.match(modalSrc, /Cancel/);
  assert.match(modalSrc, /Apply/);
});

test("Standardized Empty States, Wallet Card footer-only removal, and Plans & Billing --ds-* redesign", () => {
  const primitivesSrc = readRepoFile("src/design-system/primitives.tsx");
  assert.match(primitivesSrc, /export function PersoraIconStack/);
  assert.match(primitivesSrc, /export function PersoraEmptyState/);
  assert.match(primitivesSrc, /LauncherModuleIcon/);

  const standardizedViews = [
    "src/components/Workspace.tsx",
    "src/components/BillingView.tsx",
    "src/components/table/TableHome.tsx",
    "src/components/PdfStudioView.tsx",
    "src/components/PhotoStudioView.tsx",
    "src/components/PasswordManagerView.tsx",
    "src/components/PersonalFinanceView.tsx",
    "src/components/ContactsView.tsx",
    "src/components/BusinessCardsView.tsx",
    "src/components/TimelineView.tsx",
    "src/components/MedicalRecordsView.tsx",
    "src/components/ProjectsView.tsx",
    "src/components/habits/HabitsView.tsx",
    "src/components/loans/LoansView.tsx",
    "src/components/connections/ConnectionsView.tsx",
    "src/components/calendar/AgendaList.tsx",
  ];
  for (const viewPath of standardizedViews) {
    const src = readRepoFile(viewPath);
    assert.match(src, /PersoraEmptyState/, `Expected ${viewPath} to use standardized PersoraEmptyState`);
  }

  // Wallet Card: "SHERLOCK SECURITY SYSTEM" removed from WalletCardItemCard footer only, while workspace & dialog security remain
  const workspaceSrc = readRepoFile("src/components/Workspace.tsx");
  const walletStart = workspaceSrc.indexOf("function WalletCardItemCard");
  const walletEnd = workspaceSrc.indexOf("function SharedDocumentsView");
  assert.ok(walletStart > 0 && walletEnd > walletStart);
  const walletCardSlice = workspaceSrc.slice(walletStart, walletEnd);
  assert.doesNotMatch(walletCardSlice, /SHERLOCK SECURITY SYSTEM/i);
  assert.match(walletCardSlice, /wallet-card-tile-footer/);
  assert.match(walletCardSlice, /MoreOptionsMenu/);
  // Global security footer & dialog privacy notes remain intact
  assert.match(workspaceSrc, /Sherlock Security System/);
  const vaultDialogsSrc = readRepoFile("src/components/VaultDialogs.tsx");
  assert.match(vaultDialogsSrc, /Sherlock Security System/);

  // Plans & Billing: organized sections, Monthly/Yearly cycle without invented discounts, preserved billing API & shared attachment CSS
  const billingSrc = readRepoFile("src/components/BillingView.tsx");
  const billingCss = readRepoFile("src/billing.css");
  assert.match(billingSrc, /loadBilling/);
  assert.match(billingSrc, /submitPaymentRequest/);
  assert.match(billingSrc, /Current Plan/);
  assert.match(billingSrc, /Usage Limits/);
  assert.match(billingSrc, /Available Plans/);
  assert.match(billingSrc, /Payment Settings/);
  assert.match(billingSrc, /Billing History/);
  assert.match(billingSrc, /aria-label="Billing cycle display"/);
  assert.match(billingSrc, /plan\.monthly_price \* 12/);
  assert.match(billingCss, /\.detail-attachment-preview/);
  assert.match(billingCss, /\.document-image-viewer/);
  assert.match(billingCss, /backdrop-filter:\s*none/);
});
