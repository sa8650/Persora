// PDF Studio — Annotate mode: underline / strike-through and the watermark
// (model helpers plus what actually ends up inside the exported PDF).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';
import { makePng } from './photo-fixtures.mjs';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.pdf-studio-annotate-'));
async function bundle(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await esbuild.build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['pdf-lib'], logLevel: 'silent' });
  return import(outfile);
}
const studio = await bundle('../src/lib/pdf-studio.ts', 'pdf-studio');
const engine = await bundle('../src/lib/pdf-engine.ts', 'pdf-engine');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const openWithPdfJs = (bytes) => pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;

/** Text runs as pdf.js shows them on the displayed page (view space, y down). */
async function viewText(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return {
    viewport: { width: viewport.width, height: viewport.height },
    items: content.items.filter((item) => item.str.trim()).map((item) => ({ str: item.str, width: item.width, tx: pdfjs.Util.transform(viewport.transform, item.transform) })),
  };
}

/** Centre (view space) of a watermark text run drawn by the engine: baseline-left + half the width along the text + half the cap height up. */
function runCentre(item, capHeight) {
  const size = Math.hypot(item.tx[0], item.tx[1]);
  const [a, b, c, d, e, f] = item.tx;
  const w = item.width;
  return { x: e + a / size * w / 2 + c / size * capHeight * size / 2, y: f + b / size * w / 2 + d / size * capHeight * size / 2, size, angle: Math.atan2(-b, a) * 180 / Math.PI };
}

async function sourcePdf(rotations = [0, 0, 0], size = [300, 400]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  rotations.forEach((rotation, index) => {
    const page = doc.addPage(size);
    page.drawText(`Original page ${index + 1}`, { x: 30, y: 300, size: 14, font, color: rgb(0, 0, 0) });
    page.setRotation(degrees(rotation));
  });
  doc.setTitle('Source title');
  return doc.save();
}

function workingPages(rotations, size = [300, 400]) {
  return rotations.map((rotation, index) => {
    return { id: `p${index + 1}`, sourceId: 's1', sourceIndex: index, width: size[0], height: size[1], baseRotation: rotation, rotation: 0, overlays: [] };
  });
}

const exportWith = (bytes, pages, extra = {}, hooks = {}) => engine.exportDocument({ sources: new Map([['s1', { id: 's1', name: 'a.pdf', bytes }]]), pages, images: extra.images || new Map(), watermark: extra.watermark ?? null, title: 'Out' }, hooks);

/** Decoded content streams of every page. */
async function pageContents(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs = contents && 'asArray' in contents ? contents.asArray() : [contents];
    return refs.map((ref) => {
      const stream = doc.context.lookup(ref);
      const raw = stream.getContents();
      try { return zlib.inflateSync(raw).toString('latin1'); } catch { return Buffer.from(raw).toString('latin1'); }
    }).join('\n');
  });
}

const textWatermark = (extra = {}) => ({ ...studio.defaultTextWatermark(), text: 'DRAFT', rotation: 0, position: 'center', ...extra });

// ---------------------------------------------------------------------------
// Underline & strike-through
// ---------------------------------------------------------------------------
test('markup snaps to text lines, clips to the dragged span and falls back without a text layer', () => {
  const runs = [
    { x: 50, baseline: 100, width: 200, size: 12 },
    { x: 50, baseline: 120, width: 150, size: 12 },
    { x: 260, baseline: 100.5, width: 40, size: 12 }, // same line, separate run
  ];
  const under = studio.markupSegments(runs, { x: 40, y: 88, w: 300, h: 36 }, 'underline');
  assert.equal(under.length, 2, 'one stroke per touched line');
  const first = under[0];
  assert.equal(first.x1, 50); assert.equal(first.x2, 300);
  assert.ok(Math.abs(first.y1 - (100.25 + 12 * 0.12)) < 0.01, 'just under the baseline');
  assert.equal(first.y1, first.y2);
  assert.equal(first.strokeWidth, studio.markupStroke(12));

  const strike = studio.markupSegments(runs, { x: 100, y: 108, w: 50, h: 14 }, 'strike');
  assert.equal(strike.length, 1, 'only the line the box covers');
  assert.deepEqual([strike[0].x1, strike[0].x2], [100, 150], 'clipped to the drag');
  assert.ok(Math.abs(strike[0].y1 - (120 - 12 * 0.3)) < 0.01, 'through the middle of the letters');

  // A thin (click-like) box picks the line under its centre.
  const click = studio.markupSegments(runs, { x: 50, y: 116, w: 150, h: 1 }, 'underline');
  assert.equal(click.length, 1);
  assert.ok(Math.abs(click[0].y1 - (120 + 1.44)) < 0.01);

  // Scans: no runs → bottom edge (underline) / middle (strike).
  assert.deepEqual(studio.markupSegments([], { x: 10, y: 10, w: 80, h: 20 }, 'underline').map((s) => [s.x1, s.y1, s.x2]), [[10, 30, 90]]);
  assert.deepEqual(studio.markupSegments([], { x: 10, y: 10, w: 80, h: 20 }, 'strike').map((s) => s.y1), [20]);
  assert.deepEqual(studio.markupSegments(runs, { x: 10, y: 10, w: 1, h: 20 }, 'strike'), [], 'too narrow');
  assert.ok(studio.markupStroke(2) >= 0.75 && studio.markupStroke(200) <= 4);
});

test('markup moves and rotates with the page like other line annotations', () => {
  const overlay = { id: 'm', type: 'strike', x1: 10, y1: 20, x2: 110, y2: 20, color: '#dc2626', strokeWidth: 1 };
  const bounds = studio.overlayBounds(overlay, () => ({ width: 0, height: 0 }));
  assert.equal(bounds.w, 100);
  const page = { id: 'p', sourceId: 's', sourceIndex: 0, width: 300, height: 400, baseRotation: 0, rotation: 0, overlays: [overlay] };
  let turned = page;
  for (let i = 0; i < 4; i += 1) turned = studio.rotatePage(turned, 90, () => ({ width: 0, height: 0 }));
  const back = turned.overlays[0];
  assert.ok(Math.abs(back.x1 - 10) < 1e-6 && Math.abs(back.y1 - 20) < 1e-6 && Math.abs(back.x2 - 110) < 1e-6, 'four quarter turns are identity');
});

test('underline and strike-through are drawn into the PDF as butt-capped strokes', async () => {
  const bytes = await sourcePdf([0]);
  const pages = workingPages([0]);
  pages[0].overlays = [
    { id: 'u', type: 'underline', x1: 30, y1: 102, x2: 140, y2: 102, color: '#2563eb', strokeWidth: 1.25 },
    { id: 's', type: 'strike', x1: 30, y1: 96, x2: 140, y2: 96, color: '#dc2626', strokeWidth: 1.25 },
  ];
  const out = await exportWith(bytes, pages);
  const [content] = await pageContents(out);
  assert.equal((content.match(/1\.25 w/g) || []).length, 2, 'both strokes');
  assert.doesNotMatch(content, /[12] J/, 'butt caps (the PDF default) — not round like pen strokes');
  assert.match(content, /0\.1450980392156863 0\.38823529411764707 0\.9215686274509803 RG/, 'underline colour');
  const shown = await viewText(await openWithPdfJs(out), 1);
  assert.ok(shown.items.some((item) => item.str === 'Original page 1'), 'original content kept');
});

// ---------------------------------------------------------------------------
// Watermark model
// ---------------------------------------------------------------------------
test('watermark placements: centre, diagonal, corners, custom and a bounded tiled grid', () => {
  const page = { width: 600, height: 800 };
  const item = { width: 200, height: 40 };
  const spec = (position, extra = {}) => ({ ...textWatermark({ position, margin: 20, rotation: 0 }), ...extra });
  assert.deepEqual(studio.watermarkPlacements(spec('center'), page, item), [{ cx: 300, cy: 400, angle: 0 }]);
  const diagonal = studio.watermarkPlacements(spec('diagonal'), page, item)[0];
  assert.ok(Math.abs(diagonal.angle - Math.atan2(800, 600) * 180 / Math.PI) < 0.01, 'follows the page diagonal');
  assert.deepEqual(studio.watermarkPlacements(spec('top-left'), page, item), [{ cx: 120, cy: 40, angle: 0 }]);
  assert.deepEqual(studio.watermarkPlacements(spec('bottom-right'), page, item), [{ cx: 480, cy: 760, angle: 0 }]);
  assert.deepEqual(studio.watermarkPlacements(spec('custom', { customX: 0.25, customY: 0.75 }), page, item), [{ cx: 150, cy: 600, angle: 0 }]);
  // Rotated corner copies stay inside the page.
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const [p] = studio.watermarkPlacements(spec(corner, { rotation: 30 }), page, item);
    const r = Math.PI / 6; const halfW = (200 * Math.cos(r) + 40 * Math.sin(r)) / 2; const halfH = (200 * Math.sin(r) + 40 * Math.cos(r)) / 2;
    assert.ok(p.cx - halfW >= 19.9 && p.cx + halfW <= 580.1 && p.cy - halfH >= 19.9 && p.cy + halfH <= 780.1, corner);
  }
  const tiles = studio.watermarkPlacements(spec('tiled', { rotation: 45, tileGap: 40 }), page, item);
  assert.ok(tiles.length > 6, 'covers the page');
  assert.ok(tiles.every((t) => t.cx > -200 && t.cx < 800 && t.cy > -200 && t.cy < 1000));
  const tiny = studio.watermarkPlacements(spec('tiled', { tileGap: 0 }), page, { width: 1, height: 1 });
  assert.ok(tiny.length <= studio.WATERMARK_LIMITS.maxTiles, 'tile count is capped');
});

test('watermark sizes keep the image aspect ratio and fit text to the page', () => {
  const page = { width: 600, height: 800 };
  const image = { ...textWatermark(), kind: 'image', imageId: 'img', imageWidth: 400, imageHeight: 100, scale: 50 };
  const size = studio.watermarkItemSize(image, page, 0);
  assert.equal(size.width, 300); assert.equal(size.height, 75);
  const huge = studio.watermarkItemSize({ ...image, imageWidth: 100, imageHeight: 1000, scale: 150 }, page, 0);
  assert.ok(Math.abs(huge.width / huge.height - 0.1) < 1e-9 && huge.height <= 1200 + 1e-9, 'capped at 1.5× the page, ratio kept');
  const fit = studio.watermarkItemSize(textWatermark({ sizeMode: 'fit', scale: 50 }), page, 2);
  assert.equal(fit.width, 300);
  assert.equal(fit.fontSize, 150);
  assert.equal(studio.watermarkItemSize(textWatermark({ sizeMode: 'fit', scale: 50 }), page, 0.5).fontSize, studio.WATERMARK_LIMITS.fontMax, 'clamped to the largest font size');
  assert.equal(studio.watermarkItemSize(textWatermark({ sizeMode: 'fit', scale: 50 }), page, 5).fontSize, 60);
  const fixed = studio.watermarkItemSize(textWatermark({ sizeMode: 'fixed', fontSize: 36 }), page, 0.5);
  assert.equal(fixed.fontSize, 36); assert.equal(fixed.width, 18);
  assert.ok(Math.abs(fixed.height - 36 * 0.718) < 1e-9, 'box height is the cap height');
  const clamped = studio.normalizeWatermark(textWatermark({ opacity: 9, rotation: -999, customX: 3, fontSize: 1, text: 'a\nb' }));
  assert.equal(clamped.opacity, 1); assert.equal(clamped.rotation, -180); assert.equal(clamped.customX, 1); assert.equal(clamped.fontSize, studio.WATERMARK_LIMITS.fontMin); assert.equal(clamped.text, 'a b');
  assert.ok(studio.watermarkIsEmpty(textWatermark({ text: '   ' })));
  assert.ok(studio.watermarkIsEmpty({ ...image, imageId: '' }));
});

test('watermark page choices resolve to page ids and validate ranges', () => {
  const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(studio.resolveWatermarkPages('all', '', pages, 0).pages, { mode: 'all' });
  assert.deepEqual(studio.resolveWatermarkPages('current', '', pages, 2).pages, { mode: 'pages', pageIds: ['c'], label: 'page 3' });
  assert.deepEqual(studio.resolveWatermarkPages('range', '1, 3-4', pages, 0).pages, { mode: 'pages', pageIds: ['a', 'c', 'd'], label: 'pages 1, 3-4' });
  assert.ok(studio.resolveWatermarkPages('range', '9', pages, 0).error);
  assert.ok(studio.resolveWatermarkPages('range', '', pages, 0).error);
  const spec = textWatermark({ pages: { mode: 'pages', pageIds: ['b'], label: 'page 2' } });
  assert.equal(studio.watermarkOnPage(spec, 'b'), true);
  assert.equal(studio.watermarkOnPage(spec, 'a'), false);
  assert.equal(studio.watermarkOnPage(null, 'a'), false);
});

// ---------------------------------------------------------------------------
// Watermark export
// ---------------------------------------------------------------------------
test('a text watermark is embedded as real PDF text, centred and rotated as previewed, on every page rotation', async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const bytes = await sourcePdf([rotation]);
    const pages = workingPages([rotation]);
    for (const angle of [0, 30, -60]) {
      const spec = textWatermark({ rotation: angle, sizeMode: 'fixed', fontSize: 40, font: 'helvetica-bold' });
      const out = await exportWith(bytes, pages, { watermark: spec });
      const shown = await viewText(await openWithPdfJs(out), 1);
      const mark = shown.items.find((item) => item.str === 'DRAFT');
      assert.ok(mark, `watermark text present (page /Rotate ${rotation}, ${angle}°)`);
      const centre = runCentre(mark, studio.WATERMARK_FONTS['helvetica-bold'].capHeight);
      assert.ok(Math.abs(centre.x - shown.viewport.width / 2) < 0.6 && Math.abs(centre.y - shown.viewport.height / 2) < 0.6, `centred (rot ${rotation}, ${angle}°): ${centre.x},${centre.y}`);
      assert.ok(Math.abs(centre.size - 40) < 0.01, 'font size');
      assert.ok(Math.abs(((centre.angle - angle + 540) % 360) - 180) < 0.05, `angle ${centre.angle} vs ${angle}`);
      const expectedWidth = engine.watermarkTextWidthAt1pt('DRAFT', 'helvetica-bold') * 40;
      assert.ok(Math.abs(mark.width - expectedWidth) < 0.05, 'same width the preview uses');
    }
  }
});

test('the watermark is drawn under annotations, only on the chosen pages, with opacity, and keeps page sizes and metadata-free content intact', async () => {
  const bytes = await sourcePdf([0, 90, 0], [300, 400]);
  const pages = workingPages([0, 90, 0]);
  pages[1].overlays = [{ id: 't', type: 'text', x: 20, y: 30, text: 'NOTE', fontSize: 12, color: '#111827', bold: false }];
  const spec = textWatermark({ opacity: 0.3, pages: { mode: 'pages', pageIds: ['p2', 'p3'], label: 'pages 2-3' } });
  const out = await exportWith(bytes, pages, { watermark: spec });
  const pdf = await openWithPdfJs(out);
  const texts = [];
  for (let n = 1; n <= 3; n += 1) texts.push((await viewText(pdf, n)).items.map((item) => item.str));
  assert.ok(!texts[0].includes('DRAFT'), 'page 1 untouched');
  assert.ok(texts[1].includes('DRAFT') && texts[2].includes('DRAFT'), 'pages 2 and 3 watermarked');
  assert.ok(texts.every((list, index) => list.includes(`Original page ${index + 1}`)), 'original text kept');
  assert.ok(texts[1].indexOf('DRAFT') < texts[1].indexOf('NOTE'), 'watermark first, annotations on top');

  const contents = await pageContents(out);
  assert.ok(!contents[0].includes(' gs'), 'no watermark state on page 1');
  const doc = await PDFDocument.load(out);
  const [w1, h1] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  assert.deepEqual([w1, h1], [300, 400]);
  assert.equal(doc.getPage(1).getRotation().angle, 90, 'page rotation preserved');
  const ext = doc.getPage(1).node.Resources().lookup(PDFName.of('ExtGState'));
  const states = ext.entries().map(([, ref]) => doc.context.lookup(ref));
  assert.ok(states.some((state) => Number(state.get(PDFName.of('ca'))?.asNumber?.() ?? state.get(PDFName.of('ca'))?.numberValue) === 0.3), 'opacity stored as fill alpha');
});

test('tiled watermarks reuse one font and one transparency state for the whole document', async () => {
  const bytes = await sourcePdf([0, 0, 0, 0]);
  const pages = workingPages([0, 0, 0, 0]);
  const spec = textWatermark({ position: 'tiled', sizeMode: 'fixed', fontSize: 14, tileGap: 10, rotation: 30 });
  const out = await exportWith(bytes, pages, { watermark: spec });
  const doc = await PDFDocument.load(out);
  let boldFonts = 0; let states = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!object.get) continue;
    if (object.get(PDFName.of('BaseFont'))?.toString() === '/Helvetica-Bold') boldFonts += 1;
    if (object.get(PDFName.of('Type'))?.toString() === '/ExtGState' && object.get(PDFName.of('ca'))) states += 1;
  }
  assert.equal(boldFonts, 1);
  assert.equal(states, 1);
  const contents = await pageContents(out);
  const copies = (contents[0].match(/\) Tj|> Tj/g) || []).length;
  assert.ok(copies > 20, `many copies per page (${copies})`);
  const watermarkPart = contents[0].slice(contents[0].indexOf(' gs'));
  assert.equal((watermarkPart.match(/BT/g) || []).length, 1, 'all copies in one text object');
  assert.ok(out.byteLength < 60_000, `compact output (${out.byteLength} bytes)`);
});

test('an image watermark is embedded once with its aspect ratio; corner positions honour the margin', async () => {
  const bytes = await sourcePdf([0, 0]);
  const pages = workingPages([0, 0]);
  const png = makePng(40, 20);
  const spec = { ...textWatermark(), kind: 'image', imageId: 'logo', imageWidth: 40, imageHeight: 20, scale: 20, position: 'bottom-right', margin: 24, rotation: 0, opacity: 0.5 };
  const out = await exportWith(bytes, pages, { watermark: spec, images: new Map([['logo', { bytes: png, mime: 'image/png' }]]) });
  const contents = await pageContents(out);
  // 20% of 300 pt = 60 × 30 pt, bottom-right with a 24 pt margin → origin (216, 24) in PDF space.
  for (const content of contents) assert.match(content, /1 0 0 1 216 24 cm\n1 0 0 1 0 0 cm\n60 0 0 30 0 0 cm/);
  const doc = await PDFDocument.load(out);
  let images = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) if (object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') images += 1;
  assert.equal(images, 1, 'image stored once, drawn on both pages');
  await assert.rejects(exportWith(bytes, pages, { watermark: { ...spec, imageId: 'missing' } }), /watermark image is missing/i);
});

test('non-Latin watermark text goes through the device-font raster hook, and fails clearly without it', async () => {
  const bytes = await sourcePdf([0]);
  const pages = workingPages([0]);
  const spec = textWatermark({ text: 'গোপনীয়', sizeMode: 'fit', scale: 50 });
  assert.equal(engine.watermarkTextWidthAt1pt('গোপনীয়', 'helvetica'), null);
  let calls = 0;
  const raster = async () => { calls += 1; return { png: makePng(60, 26), width: 120, height: 130, advance: 100 }; };
  const out = await exportWith(bytes, pages, { watermark: spec }, { rasterizeWatermarkText: raster });
  assert.equal(calls, 1);
  const [content] = await pageContents(out);
  // advance 100 at 100 pt → 1 pt/pt; 50% of 300 pt → 150 pt font; box 180 × 195 centred on the page.
  assert.match(content, /1 0 0 1 60 102\.5 cm\n1 0 0 1 0 0 cm\n180 0 0 195 0 0 cm/);
  await assert.rejects(exportWith(bytes, pages, { watermark: spec }), /device's fonts/);
});

test('no watermark (or an empty one) leaves the export unchanged', async () => {
  const bytes = await sourcePdf([0]);
  const pages = workingPages([0]);
  const plain = await pageContents(await exportWith(bytes, pages));
  const empty = await pageContents(await exportWith(bytes, pages, { watermark: textWatermark({ text: '  ' }) }));
  assert.deepEqual(empty, plain);
});
