// Browser end-to-end check of PDF Studio on the production build: the tabbed
// library, PDF Security (Lock / Unlock with the real qpdf WebAssembly worker),
// and Edit PDF → Annotate (underline, strike-through, text & image watermark),
// with every downloaded file verified independently. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/e2e/pdf-studio.e2e.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { makePng } from '../photo-fixtures.mjs';
import { startDatabase, startApp, APP_PORT, stopAll } from './local-stack.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-e2e-shots');
// Let colour/position transitions settle so screenshots show the resting state.
async function snap(page, path) { await page.waitForTimeout(300); await page.screenshot({ path }); }
mkdirSync(shots, { recursive: true });
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
const base = `http://127.0.0.1:${APP_PORT}`;

// ── Fixtures ────────────────────────────────────────────────────────────────
async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 72, y: 692, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText(`Second line on page ${i + 1} for strike-through.`, { x: 72, y: 652, size: 18, font, color: rgb(0, 0, 0) });
  }
  doc.setTitle('E2E source');
  return Buffer.from(await doc.save());
}
const pdfBuffer = await textPdf();
const pngBuffer = Buffer.from(makePng(120, 60));

async function readPdf(bytes, password) {
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str));
    await doc.destroy();
    return { pages };
  } catch (error) { return { error: error.name, code: error.code }; }
}
async function contents(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const value = page.node.Contents();
    const refs = 'asArray' in value ? value.asArray() : [value];
    return refs.map((ref) => { const raw = doc.context.lookup(ref).getContents(); try { return zlib.inflateSync(raw).toString('latin1'); } catch { return Buffer.from(raw).toString('latin1'); } }).join('\n');
  });
}
async function imageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) if (object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') count += 1;
  return count;
}
async function download(page, action) {
  const [file] = await Promise.all([page.waitForEvent('download'), action()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

// ── Stack ─────────────────────────────────────────────────────────────────────
step('Starting PostgreSQL, PostgREST and the production build');
await startDatabase();
const app = await startApp();
const browser = await chromium.launch();
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`${label}: ${message.text()}`); });
};

try {
  const email = `pdf-${Date.now()}@persora.test`;
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'PDF Tester', email, password: 'Correct-Horse-9' }) });
  assert.equal(response.status, 201, await response.clone().text());

  async function openStudio(context) {
    const page = await context.newPage();
    watch(page, 'page');
    await page.goto(base);
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.getByRole('textbox', { name: 'Email or 7-digit Persora ID' }).fill(email);
    await page.getByPlaceholder('Your password').fill('Correct-Horse-9');
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
    const menu = page.getByRole('button', { name: 'Open workspace sections' });
    await page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
    if (await menu.isVisible()) await menu.click(); // phones: sections live in a drawer
    await page.getByRole('button', { name: 'PDF Studio' }).first().click();
    await page.getByRole('heading', { name: 'PDF Studio', exact: true, level: 2 }).waitFor();
    return page;
  }

  // ── Library ────────────────────────────────────────────────────────────────
  step('Library: compact heading, one tool at a time');
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await openStudio(desktop);
  const tabs = page.getByRole('tablist', { name: 'PDF Studio tools' }).getByRole('tab');
  assert.deepEqual(await tabs.allInnerTexts(), ['Create PDF', 'Edit PDF', 'PDF Security']);
  assert.equal(await page.getByRole('tabpanel').count(), 1, 'one workspace at a time');
  assert.equal(await page.locator('section.pdfs-workarea').count(), 0, 'old half-and-half cards are gone');
  for (const name of ['Create PDF', 'Edit PDF', 'PDF Security']) {
    await page.getByRole('tab', { name }).click();
    assert.equal(await page.getByRole('tab', { name }).getAttribute('aria-selected'), 'true');
    await snap(page, join(shots, `pdf-library-${name.split(' ')[0].toLowerCase()}-${name.split(' ')[1].toLowerCase()}.png`));
  }
  ok('Create | Edit | Security tabs switch a single panel');

  step('Create PDF still builds a file from images');
  await page.getByRole('tab', { name: 'Create PDF' }).click();
  await page.getByLabel('Choose files to turn into a PDF').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: pngBuffer });
  const createDialog = page.getByRole('dialog', { name: 'Build a PDF from images, text and files' });
  await createDialog.waitFor();
  const created = await download(page, () => createDialog.getByRole('button', { name: 'Download PDF' }).click());
  assert.match(created.name, /\.pdf$/);
  assert.equal((await PDFDocument.load(created.bytes)).getPageCount(), 1);
  assert.equal(await imageCount(created.bytes), 1, 'image embedded');
  await createDialog.getByRole('button', { name: 'Close Create PDF' }).click();
  const discard = page.getByRole('button', { name: /^Discard/ });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await createDialog.waitFor({ state: 'detached' });
  ok('image → one-page PDF downloaded');

  // ── PDF Security ───────────────────────────────────────────────────────────
  step('Lock PDF: real AES-256, verified by independent readers');
  await page.getByRole('tab', { name: 'PDF Security' }).click();
  await page.getByLabel('Choose a PDF to lock').setInputFiles({ name: 'Contract.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await page.getByLabel('Password', { exact: true }).fill('sesame-1234');
  await page.getByLabel('Confirm password').fill('sesame-12345');
  await page.getByText(/don't match/i).waitFor();
  await page.getByLabel('Confirm password').fill('sesame-1234');
  await page.getByRole('button', { name: 'Lock PDF', exact: true }).last().click();
  await page.getByText('Locked and verified').waitFor({ timeout: 30000 });
  await snap(page, join(shots, 'pdf-security-locked.png'));
  const locked = await download(page, () => page.getByRole('button', { name: /Download/ }).click());
  assert.equal(locked.name, 'Contract (locked).pdf');
  assert.deepEqual(await readPdf(locked.bytes), { error: 'PasswordException', code: 1 }, 'pdf.js asks for a password');
  assert.deepEqual(await readPdf(locked.bytes, 'wrong'), { error: 'PasswordException', code: 2 });
  assert.ok((await readPdf(locked.bytes, 'sesame-1234')).pages[0].join(' ').includes('quick brown fox'));
  ok('downloaded file needs the password; content intact with it');

  step('Unlock PDF: wrong password fails, correct password removes protection');
  await page.getByRole('button', { name: 'Lock another PDF' }).click();
  await page.getByRole('radio', { name: 'Unlock PDF', exact: true }).click();
  await page.getByLabel('Choose a PDF to unlock').setInputFiles({ name: locked.name, mimeType: 'application/pdf', buffer: locked.bytes });
  const unlockField = page.locator('.pdfs-sec-fields input').first();
  await unlockField.fill('not-it');
  await page.getByRole('button', { name: 'Unlock PDF', exact: true }).last().click();
  await page.getByText(/password isn't correct/i).waitFor({ timeout: 30000 });
  assert.equal(await page.getByText('Unlocked and verified').count(), 0, 'no output for a wrong password');
  await snap(page, join(shots, 'pdf-security-wrong-password.png'));
  await unlockField.fill('sesame-1234');
  await page.getByRole('button', { name: 'Unlock PDF', exact: true }).last().click();
  await page.getByText('Unlocked and verified').waitFor({ timeout: 30000 });
  const unlocked = await download(page, () => page.getByRole('button', { name: /Download/ }).click());
  assert.equal(unlocked.name, 'Contract (unlocked).pdf');
  assert.equal((await readPdf(unlocked.bytes)).pages.length, 3, 'opens without a password');
  ok('wrong password rejected; unlocked file opens freely');

  step('Corrupted file gives a clear error');
  await page.getByRole('button', { name: 'Unlock another PDF' }).click();
  await page.getByRole('radio', { name: 'Lock PDF', exact: true }).click();
  await page.getByLabel('Choose a PDF to lock').setInputFiles({ name: 'Broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ngarbage\n') });
  await page.getByText(/damaged or isn't a valid PDF/i).waitFor({ timeout: 30000 });
  ok('damaged PDF reported');

  // ── Edit PDF → Annotate ────────────────────────────────────────────────────
  step('Edit PDF opens in Annotate mode');
  await page.getByRole('tab', { name: 'Edit PDF' }).click();
  await page.getByLabel('Choose PDF files to open').setInputFiles({ name: 'Letter.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  const editor = page.getByRole('dialog');
  await editor.locator('.pdfs-page-canvas').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.pdfs-page-loading') === null || document.querySelectorAll('.pdfs-page-canvas').length > 0);
  assert.equal(await editor.getByRole('tab', { name: 'Annotate' }).getAttribute('aria-selected'), 'true');
  for (const label of ['Add text', 'Highlight', 'Underline', 'Strike-through', 'Freehand pen', 'Signature', 'Watermark']) assert.ok(await editor.getByRole('button', { name: label, exact: true }).isVisible(), `${label} tool`);
  ok('Annotate tools: text, highlight, underline, strike-through, pen, signature, watermark');

  const firstPage = editor.locator('.pdfs-page').first();
  const toScreen = async (x, y) => { const box = await firstPage.boundingBox(); return [box.x + x / 612 * box.width, box.y + y / 792 * box.height]; };
  async function drag(from, to) {
    const [ax, ay] = await toScreen(...from); const [bx, by] = await toScreen(...to);
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 }); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up();
  }
  const markupLines = () => firstPage.locator('svg.pdfs-overlay-layer line[stroke-linecap="butt"]:not([stroke="transparent"])');

  step('Underline and strike-through snap to the PDF text');
  await editor.getByRole('button', { name: 'Underline', exact: true }).click();
  await drag([60, 85], [560, 108]); // across line 1 (baseline at y = 100)
  await page.waitForFunction(() => document.querySelectorAll('.pdfs-page svg.pdfs-overlay-layer line[stroke-linecap="butt"]').length >= 1);
  const underline = markupLines().first();
  const uy = Number(await underline.getAttribute('y1'));
  assert.ok(uy > 100 && uy < 104, `underline just below the baseline (y=${uy})`);
  assert.ok(Math.abs(Number(await underline.getAttribute('x1')) - 72) < 1.5, 'starts at the text, not the drag');
  await editor.getByRole('button', { name: 'Strike-through', exact: true }).click();
  await drag([60, 128], [300, 145]); // part of line 2 (baseline at y = 140)
  await page.waitForFunction(() => document.querySelectorAll('.pdfs-page svg.pdfs-overlay-layer line[stroke-linecap="butt"]').length >= 2);
  const strike = markupLines().nth(1);
  const sy = Number(await strike.getAttribute('y1'));
  assert.ok(sy > 132 && sy < 137, `strike through the letters (y=${sy})`);
  assert.ok(Math.abs(Number(await strike.getAttribute('x2')) - 300) < 1, 'clipped to the dragged span');
  ok(`underline at y=${uy.toFixed(1)}, strike at y=${sy.toFixed(1)}`);

  step('Text watermark: live preview, apply, embedded in the download');
  await editor.getByRole('button', { name: 'Watermark', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Watermark' });
  await panel.waitFor();
  assert.ok(await firstPage.locator('.pdfs-watermark text').count() >= 1, 'default draft previewed on the page');
  await panel.getByRole('textbox', { name: 'Text' }).fill('E2E MARK');
  await panel.getByRole('radio', { name: 'Tiled' }).click();
  await panel.getByLabel('Opacity').fill('35');
  await page.waitForFunction(() => document.querySelectorAll('.pdfs-page:first-of-type .pdfs-watermark text, .pdfs-page .pdfs-watermark text').length > 3);
  assert.equal(await firstPage.locator('.pdfs-watermark text').first().textContent(), 'E2E MARK');
  await panel.getByRole('radio', { name: 'Page range' }).check();
  await panel.getByRole('textbox', { name: 'Page range' }).fill('1-2');
  await panel.getByRole('button', { name: 'Apply watermark' }).click();
  await editor.getByText('Watermark on 2 pages').waitFor();
  await snap(page, join(shots, 'pdf-editor-watermark-text.png'));
  assert.equal(await editor.locator('.pdfs-page').nth(2).locator('.pdfs-watermark').count(), 0, 'page 3 not watermarked');
  const previewCopies = await firstPage.locator('.pdfs-watermark text').count();
  const withText = await download(page, () => editor.getByRole('button', { name: 'Download PDF' }).click());
  const read = await readPdf(withText.bytes);
  // Count the drawn copies in the content streams (pdf.js text extraction skips copies running off the page edge).
  const streams = await contents(withText.bytes);
  const hexMark = `<${Buffer.from('E2E MARK', 'latin1').toString('hex').toUpperCase()}> Tj`;
  const marks = streams.map((text) => text.split(hexMark).length - 1);
  assert.ok(marks[0] === previewCopies && marks[1] === previewCopies && marks[2] === 0, `same tiles as the preview (${previewCopies}) on pages 1-2 only (${marks})`);
  assert.ok(read.pages[0].join(' ').includes('E2E MARK') && !read.pages[2].join(' ').includes('E2E MARK'), 'readers see the watermark text');
  assert.ok(read.pages.every((texts) => texts.some((text) => text.includes('quick brown fox'))), 'original text kept');
  const [content] = streams;
  assert.match(content, /\/PersoraWm-\d+ gs\nBT\n/, 'drawn as real text with its own transparency state');
  assert.ok(content.lastIndexOf(' gs') < content.lastIndexOf(' l\nS'), 'markup drawn after (above) the watermark');
  ok(`downloaded PDF has ${marks[0]} tiled copies on pages 1-2 and both markup strokes`);

  step('Image watermark replaces it; then remove and undo');
  assert.ok(await panel.isVisible(), 'panel stays open after applying, for further changes');
  assert.equal(await panel.getByRole('button', { name: 'Done' }).count(), 1, 'nothing left to apply');
  await panel.getByRole('radio', { name: 'Image' }).click();
  await panel.getByLabel('Choose a watermark image').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: pngBuffer });
  await panel.getByRole('radio', { name: 'Bottom right' }).click();
  await panel.getByRole('radio', { name: 'All pages' }).check();
  await page.waitForFunction(() => document.querySelectorAll('.pdfs-page .pdfs-watermark image').length >= 3);
  await panel.getByRole('button', { name: 'Update watermark' }).click();
  await editor.getByText('Watermark on all pages').waitFor();
  await snap(page, join(shots, 'pdf-editor-watermark-image.png'));
  const withImage = await download(page, () => editor.getByRole('button', { name: 'Download PDF' }).click());
  assert.equal(await imageCount(withImage.bytes), 1, 'image embedded once');
  assert.ok((await contents(withImage.bytes)).every((text) => /PersoraWmImage-\d+ Do/.test(text)), 'drawn on every page');
  assert.ok((await readPdf(withImage.bytes)).pages.every((texts) => !texts.join(' ').includes('E2E MARK')), 'text watermark replaced');
  await panel.getByRole('button', { name: 'Remove' }).click();
  await panel.waitFor({ state: 'detached' });
  assert.equal(await editor.getByText(/Watermark on/).count(), 0);
  await page.keyboard.press('Control+z');
  await editor.getByText('Watermark on all pages').waitFor();
  ok('image watermark exported; remove + undo restores it');

  step('Pages mode keeps page tools one click away');
  await editor.getByRole('tab', { name: 'Pages' }).click();
  await editor.getByRole('button', { name: 'Rotate right' }).click();
  assert.equal(await editor.getByRole('button', { name: 'Underline', exact: true }).count(), 0, 'annotate tools hidden in Pages mode');
  await editor.getByRole('tab', { name: 'Annotate' }).click();
  await snap(page, join(shots, 'pdf-editor-annotate.png'));
  ok('Annotate | Pages segmented control');

  // ── Phone layout ───────────────────────────────────────────────────────────
  step('Phone layout');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await openStudio(phone);
  await snap(mobile, join(shots, 'pdf-mobile-library.png'));
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no sideways scrolling (${overflow}px)`);
  await mobile.getByRole('tab', { name: 'PDF Security' }).click();
  await snap(mobile, join(shots, 'pdf-mobile-security.png'));
  await mobile.getByRole('tab', { name: 'Edit PDF' }).click();
  await mobile.getByLabel('Choose PDF files to open').setInputFiles({ name: 'Letter.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await mobile.locator('.pdfs-page-canvas').first().waitFor();
  await mobile.getByRole('button', { name: 'Watermark', exact: true }).click();
  await mobile.getByRole('region', { name: 'Watermark' }).waitFor();
  await mobile.waitForTimeout(400);
  await snap(mobile, join(shots, 'pdf-mobile-watermark.png'));
  const sheet = await mobile.getByRole('region', { name: 'Watermark' }).boundingBox();
  assert.ok(sheet.y > 844 * 0.3 && Math.abs(sheet.width - 390) < 2, 'bottom sheet');
  ok('library, security and watermark sheet fit a 390 px screen');

  assert.deepEqual(errors, [], 'no console errors');
  ok('no console errors');
  console.log(`\nAll PDF Studio browser checks passed. Screenshots: ${shots}`);
} finally {
  await browser.close();
  app.server.close();
  stopAll();
}
