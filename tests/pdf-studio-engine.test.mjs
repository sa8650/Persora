import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { makeJpeg, makePng } from './photo-fixtures.mjs';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.pdf-studio-'));
async function bundle(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await esbuild.build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile, bundle: true, format: 'esm', platform: 'neutral', external: ['pdf-lib'], logLevel: 'silent' });
  return import(outfile);
}
const studio = await bundle('../src/lib/pdf-studio.ts', 'pdf-studio');
const engine = await bundle('../src/lib/pdf-engine.ts', 'pdf-engine');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function openWithPdfJs(bytes) {
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
}

/** Where pdf.js shows each text run on the displayed (rotated) page: baseline-left, y down, in points. */
async function textPositions(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return {
    viewport: { width: viewport.width, height: viewport.height },
    items: content.items.filter((item) => item.str.trim()).map((item) => {
      const [, , , , x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
      return { str: item.str, x, y };
    }),
  };
}

async function sourcePdf({ rotations = [0, 0], box = null } = {}) {
  const doc = await PDFDocument.create();
  for (const rotation of rotations) {
    const page = doc.addPage([300, 400]);
    if (box) { page.setMediaBox(box.x, box.y, box.width, box.height); page.setCropBox(box.x, box.y, box.width, box.height); }
    page.setRotation(degrees(rotation));
  }
  return doc.save();
}

const textOverlay = (extra = {}) => ({ id: 't1', type: 'text', x: 20, y: 30, text: 'HELLO', fontSize: 20, color: '#dc2626', bold: false, ...extra });
function workingPage(sourceIndex, info, extra = {}) {
  return { id: `p${sourceIndex}-${Math.random()}`, sourceId: 's1', sourceIndex, width: info.width, height: info.height, baseRotation: info.rotation, rotation: 0, overlays: [], ...extra };
}

test('overlays land exactly where they were placed for every page rotation and crop-box origin', async () => {
  for (const box of [null, { x: 50, y: 70, width: 300, height: 400 }]) {
    for (const base of [0, 90, 180, 270]) {
      for (const extra of [0, 90, 180, 270]) {
        const bytes = await sourcePdf({ rotations: [base], box });
        const info = { width: 300, height: 400, rotation: base };
        const page = workingPage(0, info, { rotation: extra, overlays: [textOverlay()] });
        const out = await engine.exportDocument({ sources: new Map([['s1', { id: 's1', name: 'a.pdf', bytes }]]), pages: [page], images: new Map() });
        const doc = await openWithPdfJs(out);
        const { viewport, items } = await textPositions(doc, 1);
        const expected = studio.viewSize(page);
        assert.deepEqual([Math.round(viewport.width), Math.round(viewport.height)], [expected.width, expected.height], `view size base=${base} extra=${extra}`);
        assert.equal(items.length, 1);
        assert.equal(items[0].str, 'HELLO');
        assert.ok(Math.abs(items[0].x - 20) < 0.5, `x for base=${base} extra=${extra} box=${!!box}: ${items[0].x}`);
        assert.ok(Math.abs(items[0].y - (30 + 20 * studio.TEXT_ASCENT)) < 0.5, `y for base=${base} extra=${extra} box=${!!box}: ${items[0].y}`);
        await doc.destroy();
      }
    }
  }
});

test('export applies order, duplicates, deletions and rotation without touching the source', async () => {
  const bytes = await sourcePdf({ rotations: [0, 90, 0] });
  const sourceCopy = bytes.slice();
  const info = { width: 300, height: 400, rotation: 0 };
  const pages = [
    workingPage(2, info, { rotation: 90 }),
    workingPage(0, info),
    workingPage(0, info, { overlays: [textOverlay({ text: 'COPY' })] }),
  ];
  const out = await engine.exportDocument({ sources: new Map([['s1', { id: 's1', name: 'a.pdf', bytes }]]), pages, images: new Map(), title: 'Lease' });
  const result = await PDFDocument.load(out, { updateMetadata: false });
  assert.equal(result.getPageCount(), 3);
  assert.deepEqual(result.getPages().map((page) => page.getRotation().angle), [90, 0, 0]);
  assert.equal(result.getTitle(), 'Lease');
  assert.equal(result.getProducer(), 'Persora PDF Studio');
  assert.deepEqual(bytes, sourceCopy, 'the opened file is never modified');
  const doc = await openWithPdfJs(out);
  assert.equal((await textPositions(doc, 2)).items.length, 0, 'overlays stay on their own page copy');
  assert.equal((await textPositions(doc, 3)).items[0].str, 'COPY');
  await doc.destroy();
});

test('every overlay type exports, including images, ink, arrows and non-Latin text via the raster hook', async () => {
  const bytes = await sourcePdf({ rotations: [0] });
  const png = makePng(8, 4);
  let rasterized = 0;
  const page = workingPage(0, { width: 300, height: 400, rotation: 0 }, {
    overlays: [
      { id: 'h', type: 'highlight', x: 10, y: 10, w: 100, h: 14, color: '#fde047', strokeWidth: 0, fill: null },
      { id: 'r', type: 'rect', x: 10, y: 40, w: 60, h: 30, color: '#2563eb', strokeWidth: 2, fill: '#2563eb' },
      { id: 'e', type: 'ellipse', x: 100, y: 40, w: 60, h: 30, color: '#16a34a', strokeWidth: 2, fill: null },
      { id: 'l', type: 'line', x1: 10, y1: 100, x2: 200, y2: 120, color: '#111827', strokeWidth: 1.5 },
      { id: 'a', type: 'arrow', x1: 10, y1: 140, x2: 200, y2: 140, color: '#dc2626', strokeWidth: 3 },
      { id: 'i', type: 'ink', points: [10, 200, 20, 210, 40, 205, 60, 220], color: '#7c3aed', strokeWidth: 2 },
      { id: 'img', type: 'image', imageId: 'sig', x: 150, y: 300, w: 80, h: 40, signature: true },
      textOverlay({ id: 'bn', text: 'স্বাক্ষর', y: 250 }),
      textOverlay({ id: 'b', text: 'Bold\nTwo lines', bold: true, y: 330 }),
    ],
  });
  const out = await engine.exportDocument(
    { sources: new Map([['s1', { id: 's1', name: 'a.pdf', bytes }]]), pages: [page], images: new Map([['sig', { bytes: png, mime: 'image/png' }]]) },
    { rasterizeText: async (overlay) => { rasterized += 1; assert.equal(overlay.id, 'bn'); return { png, width: 60, height: 20 }; } },
  );
  assert.equal(rasterized, 1, 'only text standard fonts cannot encode is rasterised');
  const doc = await openWithPdfJs(out);
  const { items } = await textPositions(doc, 1);
  assert.deepEqual(items.map((item) => item.str), ['Bold', 'Two lines']);
  assert.ok(Math.abs(items[1].y - items[0].y - 20 * studio.TEXT_LINE_HEIGHT) < 0.5, 'line spacing matches the editor');
  const ops = await (await doc.getPage(1)).getOperatorList();
  const paintImages = ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length;
  assert.equal(paintImages, 2, 'signature image + rasterised Bengali text');
  await doc.destroy();
});

test('Create PDF builds pages from images, text and PDFs in order', async () => {
  const pdfBytes = await sourcePdf({ rotations: [0, 0] });
  const out = await engine.buildPdf([
    { kind: 'image', name: 'scan.jpg', image: { bytes: makeJpeg(800, 600), mime: 'image/jpeg', width: 800, height: 600 } },
    { kind: 'image', name: 'logo.png', image: { bytes: makePng(40, 80), mime: 'image/png', width: 40, height: 80 } },
    { kind: 'text', name: 'Note', title: 'Meeting notes', text: 'Line one\n\n' + 'word '.repeat(3000) },
    { kind: 'pdf', name: 'a.pdf', bytes: pdfBytes },
  ], { pageSize: 'fit', orientation: 'auto', margin: 'none', fontSize: 12, title: 'Bundle' });
  const result = await PDFDocument.load(out);
  const sizes = result.getPages().map((page) => page.getSize());
  assert.deepEqual(sizes[0], { width: 600, height: 450 }, 'fit = 96 px per inch');
  assert.deepEqual(sizes[1], { width: 30, height: 60 });
  assert.ok(result.getPageCount() >= 7, `long text flows onto several pages (${result.getPageCount()})`);
  assert.deepEqual(sizes.at(-1), { width: 300, height: 400 });
  assert.equal(result.getTitle(), 'Bundle');
  const doc = await openWithPdfJs(out);
  const first = await textPositions(doc, 3);
  assert.equal(first.items[0].str, 'Meeting notes');
  await doc.destroy();

  const a4 = await PDFDocument.load(await engine.buildPdf([{ kind: 'image', name: 'wide.jpg', image: { bytes: makeJpeg(1600, 900), mime: 'image/jpeg', width: 1600, height: 900 } }], { pageSize: 'a4', orientation: 'auto', margin: 'normal', fontSize: 12 }));
  const a4Size = a4.getPage(0).getSize();
  assert.ok(Math.abs(a4Size.width - 841.89) < 0.01 && Math.abs(a4Size.height - 595.28) < 0.01, 'auto orientation picks landscape for wide images');

  await assert.rejects(engine.buildPdf([], { pageSize: 'a4', orientation: 'auto', margin: 'none', fontSize: 12 }), /Add at least one/);
  await assert.rejects(engine.buildPdf([{ kind: 'text', name: 'x', title: '', text: 'বাংলা' }], { pageSize: 'a4', orientation: 'auto', margin: 'none', fontSize: 12 }), /device's fonts/);
  await assert.rejects(engine.buildPdf([{ kind: 'pdf', name: 'bad.pdf', bytes: new TextEncoder().encode('%PDF-1.7 nothing here') }], { pageSize: 'a4', orientation: 'auto', margin: 'none', fontSize: 12 }), /couldn't be read/);
});

test('encrypted PDFs are refused with a clear message', async () => {
  // Minimal PDF whose trailer declares an /Encrypt dictionary.
  const body = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O(x)/U(x)/P -4>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R/Size 4>>\n%%EOF';
  await assert.rejects(engine.loadPdfForEditing(new TextEncoder().encode(body), '“secret.pdf”'), /encrypted or has editing restrictions/);
});

test('blank pages use the requested size', async () => {
  const blank = await PDFDocument.load(await engine.createBlankPdf(612, 792));
  assert.deepEqual(blank.getPage(0).getSize(), { width: 612, height: 792 });
});

test('page ranges, chunks and descriptions', () => {
  assert.deepEqual(studio.parsePageRanges('1-3, 5, 8-', 10).groups, [[0, 1, 2], [4], [7, 8, 9]]);
  assert.deepEqual(studio.parsePageRanges('-2; 4 to 3', 5).groups, [[0, 1], [3, 2]]);
  assert.match(studio.parsePageRanges('0', 5).error, /outside this document/);
  assert.match(studio.parsePageRanges('2-9', 5).error, /5 pages/);
  assert.match(studio.parsePageRanges('a', 5).error, /isn't a page or range/);
  assert.match(studio.parsePageRanges('-', 5).error, /at least one page/);
  assert.match(studio.parsePageRanges('  ', 5).error, /Enter pages/);
  assert.deepEqual(studio.flattenGroups([[0, 1], [1, 2]]), [0, 1, 2]);
  assert.deepEqual(studio.chunkPages(5, 2), [[0, 1], [2, 3], [4]]);
  assert.equal(studio.describePages([0, 1, 2, 4, 6, 7]), '1-3, 5, 7-8');
});

test('rotation keeps overlays on the same content and four quarter turns are identity', () => {
  const page = { id: 'p', sourceId: 's', sourceIndex: 0, width: 300, height: 400, baseRotation: 0, rotation: 0, overlays: [
    { id: 'r', type: 'rect', x: 10, y: 20, w: 50, h: 30, color: '#000', strokeWidth: 1, fill: null },
    { id: 'l', type: 'line', x1: 0, y1: 0, x2: 100, y2: 50, color: '#000', strokeWidth: 1 },
    { id: 'k', type: 'ink', points: [1, 2, 3, 4], color: '#000', strokeWidth: 1 },
    { id: 'i', type: 'image', imageId: 'x', x: 100, y: 100, w: 40, h: 20, signature: false },
  ] };
  const turned = studio.rotatePage(page, 90);
  assert.equal(turned.rotation, 90);
  assert.deepEqual(studio.viewSize(turned), { width: 400, height: 300 });
  // The rect's top-left (10,20) on a 300×400 page sits at (400-20-30, 10) after a clockwise turn.
  assert.deepEqual(studio.overlayBounds(turned.overlays[0]), { x: 350, y: 10, w: 30, h: 50 });
  assert.deepEqual([turned.overlays[3].w, turned.overlays[3].h], [40, 20], 'images stay upright');
  const back = studio.rotatePage(turned, 270);
  assert.equal(back.rotation, 0);
  assert.deepEqual(back.overlays, page.overlays);
  assert.deepEqual(studio.rotatePage(page, -90).rotation, 270);
});

test('view → user matrices map the view corners onto the crop box', () => {
  const box = { x: 50, y: 70, width: 300, height: 400 };
  for (const rotation of [0, 90, 180, 270]) {
    const m = studio.viewToUserMatrix(rotation, box);
    const [W, H] = rotation % 180 ? [400, 300] : [300, 400];
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([u, v]) => studio.applyMatrix(m, u, v).map(Math.round));
    const xs = corners.map((c) => c[0]); const ys = corners.map((c) => c[1]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [50, 350, 70, 470], `rotation ${rotation}`);
  }
});

test('text helpers: WinAnsi detection, wrapping and decoding', () => {
  assert.equal(studio.isWinAnsi('Café – “quoted” €5\nOK'), true);
  assert.equal(studio.isWinAnsi('বাংলা'), false);
  assert.equal(studio.isWinAnsi('emoji 😀'), false);
  const measure = (value) => value.length;
  assert.deepEqual(studio.wrapText('one two three four', 9, measure), ['one two', 'three', 'four']);
  assert.deepEqual(studio.wrapText('abcdefghijkl', 5, measure), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(studio.wrapText('a\n\nb', 5, measure), ['a', '', 'b']);
  assert.equal(studio.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi');
  assert.equal(studio.decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), 'café', 'falls back to Windows-1252');
});

test('file sniffing trusts content over names and explains unsupported files', () => {
  const enc = (value) => new TextEncoder().encode(value);
  assert.equal(studio.sniffFileKind(enc('%PDF-1.7\n'), 'renamed.txt'), 'pdf');
  assert.equal(studio.sniffFileKind(makeJpeg(2, 2), 'x.png'), 'jpeg');
  assert.equal(studio.sniffFileKind(makePng(2, 2), 'x'), 'png');
  assert.equal(studio.sniffFileKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'a.webp'), 'webp');
  assert.equal(studio.sniffFileKind(enc('GIF89a....'), 'a.gif'), 'gif');
  assert.equal(studio.sniffFileKind(enc('hello world'), 'notes.md'), 'text');
  assert.equal(studio.sniffFileKind(enc('hello world'), 'notes.docx'), 'unsupported');
  assert.equal(studio.sniffFileKind(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'notes.txt'), 'unsupported');
  assert.match(studio.unsupportedReason('report.docx'), /Export it to PDF/);
  assert.match(studio.unsupportedReason('photo.heic'), /JPG or PNG/);
});

test('image headers: size and EXIF orientation', () => {
  assert.deepEqual(studio.readImageSize(makeJpeg(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(studio.readImageSize(makePng(12, 7)), { width: 12, height: 7 });
  assert.equal(studio.readJpegOrientation(makeJpeg(10, 10)), 1);
  // APP1 Exif, big-endian TIFF, one IFD entry: Orientation (0x0112) = 6.
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  const app1 = [0xff, 0xe1, 0, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const rotated = new Uint8Array([0xff, 0xd8, ...app1, ...makeJpeg(10, 10).slice(2)]);
  assert.equal(studio.readJpegOrientation(rotated), 6);
});

test('Create PDF page layout', () => {
  const fit = studio.layoutImagePage(800, 600, 'fit', 'auto', 'small');
  assert.deepEqual([fit.pageWidth, fit.pageHeight, fit.x, fit.width], [636, 486, 18, 600]);
  const portrait = studio.layoutImagePage(1000, 500, 'letter', 'portrait', 'normal');
  assert.equal(portrait.pageWidth, 612);
  assert.ok(Math.abs(portrait.width - 540) < 0.01);
  assert.ok(Math.abs(portrait.y - (792 - portrait.height) / 2) < 0.01, 'centred vertically');
  assert.deepEqual(studio.textPageSize('letter', 'landscape'), { width: 792, height: 612 });
});

test('undo history is bounded and redo is cleared by new edits', () => {
  let history = { past: [], present: 0, future: [] };
  for (let i = 1; i <= 5; i += 1) history = studio.pushHistory(history, i, 3);
  assert.deepEqual(history.past, [2, 3, 4]);
  history = studio.undoHistory(history);
  assert.equal(history.present, 4);
  history = studio.redoHistory(history);
  assert.equal(history.present, 5);
  history = studio.undoHistory(studio.undoHistory(history));
  history = studio.pushHistory(history, 9, 3);
  assert.deepEqual(history.future, []);
  assert.equal(studio.undoHistory({ past: [], present: 1, future: [] }).present, 1);
});

test('library filtering, sorting, names and the ZIP writer', () => {
  const docs = [
    { id: '1', folderId: 'f', title: 'Lease', notes: 'flat 4', fileName: 'lease.pdf', fileSize: 10, pageCount: 3, createdAt: '2026-10-01', updatedAt: '2026-10-05' },
    { id: '2', folderId: null, title: 'Bank statement', notes: '', fileName: 'b.pdf', fileSize: 30, pageCount: 1, createdAt: '2026-10-03', updatedAt: '2026-10-04' },
  ];
  assert.deepEqual(studio.filterDocuments(docs, { query: '', folderId: '', sort: 'updated' }).map((d) => d.id), ['1', '2']);
  assert.deepEqual(studio.filterDocuments(docs, { query: '', folderId: '', sort: 'newest' }).map((d) => d.id), ['2', '1']);
  assert.deepEqual(studio.filterDocuments(docs, { query: '', folderId: '', sort: 'size' }).map((d) => d.id), ['2', '1']);
  assert.deepEqual(studio.filterDocuments(docs, { query: 'flat', folderId: '', sort: 'title' }).map((d) => d.id), ['1']);
  assert.deepEqual(studio.filterDocuments(docs, { query: '', folderId: 'f', sort: 'title' }).map((d) => d.id), ['1']);
  assert.deepEqual(studio.folderCounts(docs), { f: 1 });
  assert.equal(studio.titleFromFileName('Lease_final-v2.pdf'), 'Lease final v2');
  assert.equal(studio.pdfDownloadName('Tax: 2026/Q1', ' (pages 1-2)'), 'Tax 2026 Q1 (pages 1-2).pdf');
  assert.equal(studio.formatBytes(1536), '1.5 KB');
  assert.equal(studio.pageCountLabel(1), '1 page');

  const zip = studio.buildZip([{ name: 'page-1.png', bytes: makePng(3, 3) }, { name: 'page-2.png', bytes: makePng(4, 4) }]);
  const file = path.join(outDir, 'pages.zip');
  writeFileSync(file, zip);
  const listing = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist()))', file]).toString().trim();
  assert.equal(listing, 'page-1.png,page-2.png');
  assert.equal(studio.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
