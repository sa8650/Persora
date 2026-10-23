// PDF Security (Lock / Unlock) — runs the real qpdf WebAssembly engine
// (@mssio/qpdf-wasm, inline in Node) and checks every result with independent
// readers: pdf.js always, plus the native qpdf / poppler CLIs when installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { createQpdf } from '@mssio/qpdf-wasm';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.pdf-security-'));
const bundled = path.join(outDir, 'pdf-security.mjs');
await esbuild.build({ entryPoints: [new URL('../src/lib/pdf-security.ts', import.meta.url).pathname], outfile: bundled, bundle: true, format: 'esm', platform: 'neutral', external: ['pdf-lib', '@mssio/qpdf-wasm'], logLevel: 'silent' });
const security = await import(bundled);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const wasmUrl = pathToFileURL(path.join(process.cwd(), 'node_modules/@mssio/qpdf-wasm/dist/wasm/qpdf.wasm')).href;
const qpdf = await createQpdf({ wasmUrl, inline: true });
const engine = { run: (args, options) => qpdf.run(args, options) };
test.after(() => qpdf.terminate?.());

const hasTool = (name) => { try { execFileSync('which', [name], { stdio: 'ignore' }); return true; } catch { return false; } };
const HAS_QPDF_CLI = hasTool('qpdf');
const HAS_PDFINFO = hasTool('pdfinfo');
const tmp = mkdtempSync(path.join(outDir, 'files-'));
const writeTemp = (name, bytes) => { const file = path.join(tmp, name); writeFileSync(file, bytes); return file; };

async function samplePdf(pages = 3, extraBytes = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 400]).drawText(`Secret page ${i + 1}`, { x: 30, y: 300, size: 16, font });
  if (extraBytes) doc.attach(new Uint8Array(randomBytes(extraBytes)), 'payload.bin', { mimeType: 'application/octet-stream' });
  doc.setTitle('Quarterly report'); doc.setAuthor('Persora tests'); doc.setSubject('Security fixture');
  return doc.save();
}

/** Opens with pdf.js; returns { error } (PasswordException code: 1 = needs password, 2 = wrong) or the text of page 1 and info. */
async function readWithPdfJs(bytes, password) {
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => item.str).join(' ');
    const { info } = await doc.getMetadata();
    const result = { pages: doc.numPages, text, title: info.Title, author: info.Author };
    await doc.destroy();
    return result;
  } catch (error) {
    return { error: error.name, code: error.code };
  }
}

/** Encrypts a fixture with legacy / restricted settings using the same qpdf build (raw argv, test-only). */
async function encryptFixture(bytes, args) {
  const result = await qpdf.run([...args, 'in.pdf', 'out.pdf'], { files: { 'in.pdf': bytes.slice() } });
  assert.ok(result.exitCode === 0 || result.exitCode === 3, result.stderr);
  return result.files['out.pdf'];
}

async function rejectsWith(promise, kind) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, 'PdfSecurityError', error.message);
    assert.equal(error.kind, kind, error.message);
    return true;
  });
}

// ---------------------------------------------------------------------------
test('Lock encrypts with AES-256 and the file really needs the password in other readers', async () => {
  const original = await samplePdf(3);
  const stages = [];
  const locked = await security.lockPdf(engine, original, 'Report.pdf', 'correct horse 42', { onStage: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ['check', 'encrypt', 'verify']);
  assert.equal(locked.fileName, 'Report (locked).pdf');
  assert.equal(locked.report.method, 'AESv3');
  assert.equal(locked.report.bits, 256);
  assert.equal(locked.report.revision, 6);
  assert.equal(locked.pageCount, 3);

  // pdf.js (independent implementation).
  assert.deepEqual(await readWithPdfJs(locked.bytes), { error: 'PasswordException', code: 1 }, 'needs a password');
  assert.deepEqual(await readWithPdfJs(locked.bytes, 'wrong password'), { error: 'PasswordException', code: 2 }, 'rejects a wrong one');
  const opened = await readWithPdfJs(locked.bytes, 'correct horse 42');
  assert.equal(opened.pages, 3);
  assert.match(opened.text, /Secret page 1/);
  assert.equal(opened.title, 'Quarterly report', 'metadata kept');
  assert.equal(opened.author, 'Persora tests');
  // Without the password the text isn't readable in the raw file.
  assert.ok(!Buffer.from(locked.bytes).toString('latin1').includes('Secret page'), 'content is encrypted');
});

test('the locked file is also refused by the native qpdf CLI and poppler without the password', { skip: !(HAS_QPDF_CLI || HAS_PDFINFO) && 'qpdf/pdfinfo not installed' }, async () => {
  const locked = await security.lockPdf(engine, await samplePdf(2), 'a.pdf', 'pässwörd-✓');
  const file = writeTemp('locked.pdf', locked.bytes);
  if (HAS_QPDF_CLI) {
    // --requires-password: exit 0 = a password is required.
    assert.doesNotThrow(() => execFileSync('qpdf', ['--requires-password', file], { stdio: 'ignore' }));
    assert.throws(() => execFileSync('qpdf', ['--check', file], { stdio: 'ignore' }), 'qpdf refuses to open it');
    const info = execFileSync('qpdf', ['--show-encryption', `--password=pässwörd-✓`, file]).toString();
    assert.match(info, /R = 6/); assert.match(info, /AESv3/);
  }
  if (HAS_PDFINFO) {
    assert.throws(() => execFileSync('pdfinfo', [file], { stdio: 'pipe' }), 'poppler refuses to open it');
    const info = execFileSync('pdfinfo', ['-upw', 'pässwörd-✓', file]).toString();
    assert.match(info, /Encrypted:\s+yes \(.*algorithm:AES-256\)/);
    assert.match(info, /Pages:\s+2/);
  }
});

test('Unlock with the correct password removes protection and keeps content and metadata', async () => {
  const original = await samplePdf(4);
  const locked = await security.lockPdf(engine, original, 'Report.pdf', 'open sesame');
  const unlocked = await security.unlockPdf(engine, locked.bytes, 'Report (locked).pdf', 'open sesame');
  assert.equal(unlocked.fileName, 'Report (unlocked).pdf');
  assert.equal(unlocked.pageCount, 4);
  assert.equal(unlocked.report.method, 'AESv3', 'reports what was removed');
  const opened = await readWithPdfJs(unlocked.bytes);
  assert.equal(opened.pages, 4);
  assert.match(opened.text, /Secret page 1/);
  assert.equal(opened.title, 'Quarterly report');
  if (HAS_QPDF_CLI) {
    const file = writeTemp('unlocked.pdf', unlocked.bytes);
    assert.throws(() => execFileSync('qpdf', ['--requires-password', file], { stdio: 'ignore' }), 'exit 2 = not encrypted');
  }
});

test('a wrong or empty password fails with a clear error and produces no output', async () => {
  const locked = await security.lockPdf(engine, await samplePdf(1), 'x.pdf', 'right-password');
  await rejectsWith(security.unlockPdf(engine, locked.bytes, 'x.pdf', 'Right-Password'), 'wrong-password');
  await rejectsWith(security.unlockPdf(engine, locked.bytes, 'x.pdf', ''), 'wrong-password');
  const requirement = await security.unlockRequirement(engine, locked.bytes, 'x.pdf');
  assert.equal(requirement.kind, 'open');
});

test('Unicode passwords round-trip; Lock refuses files that are already protected', async () => {
  const password = 'রহস্য-パス-🔒';
  const locked = await security.lockPdf(engine, await samplePdf(1), 'u.pdf', password);
  assert.match((await readWithPdfJs(locked.bytes, password)).text, /Secret page 1/);
  await rejectsWith(security.lockPdf(engine, locked.bytes, 'u.pdf', 'another-one'), 'already-protected');
  const unlocked = await security.unlockPdf(engine, locked.bytes, 'u.pdf', password);
  assert.equal((await readWithPdfJs(unlocked.bytes)).pages, 1);
});

test('legacy RC4-40, RC4-128 and AES-128 PDFs unlock with their password', async () => {
  const original = await samplePdf(2);
  const fixtures = {
    'RC4 40-bit': ['--allow-weak-crypto', '--encrypt', 'user1', 'owner1', '40', '--'],
    'RC4 128-bit': ['--allow-weak-crypto', '--encrypt', 'user1', 'owner1', '128', '--use-aes=n', '--'],
    'AES-128': ['--encrypt', 'user1', 'owner1', '128', '--use-aes=y', '--'],
  };
  for (const [label, args] of Object.entries(fixtures)) {
    const locked = await encryptFixture(original, args);
    const inspection = await security.inspectPdf(engine, locked, 'f.pdf', 'user1');
    assert.equal(security.describeEncryption(inspection.report), label);
    await rejectsWith(security.unlockPdf(engine, locked, 'f.pdf', 'nope'), 'wrong-password');
    // Both the open password and the owner password work for an unrestricted file.
    for (const password of ['user1', 'owner1']) {
      const unlocked = await security.unlockPdf(engine, locked, 'f.pdf', password);
      const opened = await readWithPdfJs(unlocked.bytes);
      assert.equal(opened.pages, 2, `${label} / ${password}`);
      assert.match(opened.text, /Secret page 1/);
    }
  }
});

test('restricted files need the permissions (owner) password', async () => {
  const original = await samplePdf(1);
  // Opens freely, but printing and copying are restricted by an owner password.
  const restricted = await encryptFixture(original, ['--encrypt', '', 'owner-secret', '256', '--print=none', '--extract=n', '--']);
  const requirement = await security.unlockRequirement(engine, restricted, 'r.pdf');
  assert.equal(requirement.kind, 'permissions');
  assert.equal(requirement.report.restricted, true);
  await rejectsWith(security.unlockPdf(engine, restricted, 'r.pdf', 'guess'), 'owner-password-required');
  const unlocked = await security.unlockPdf(engine, restricted, 'r.pdf', 'owner-secret');
  assert.equal((await security.inspectPdf(engine, unlocked.bytes, 'r.pdf')).report.encrypted, false);

  // A file with separate open and permissions passwords: the open password alone can't strip the restrictions.
  const both = await encryptFixture(original, ['--encrypt', 'open-pw', 'owner-pw', '256', '--modify=none', '--']);
  await rejectsWith(security.unlockPdf(engine, both, 'b.pdf', 'open-pw'), 'owner-password-required');
  assert.equal((await readWithPdfJs((await security.unlockPdf(engine, both, 'b.pdf', 'owner-pw')).bytes)).pages, 1);
});

test('unprotected, damaged, non-PDF, empty and oversized inputs fail with specific errors', async () => {
  const plain = await samplePdf(1);
  await rejectsWith(security.unlockPdf(engine, plain, 'p.pdf', 'whatever'), 'not-protected');
  assert.equal((await security.unlockRequirement(engine, plain, 'p.pdf')).kind, 'not-protected');

  const damaged = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ngarbage without xref or trailer\n');
  await rejectsWith(security.lockPdf(engine, damaged, 'd.pdf', 'password1'), 'damaged');
  await rejectsWith(security.unlockPdf(engine, damaged, 'd.pdf', 'password1'), 'damaged');

  await rejectsWith(security.lockPdf(engine, new TextEncoder().encode('just some text'), 'notes.txt', 'password1'), 'not-pdf');
  await rejectsWith(security.lockPdf(engine, new Uint8Array(0), 'empty.pdf', 'password1'), 'not-pdf');
  const huge = { byteLength: security.SECURITY_MAX_BYTES + 1, subarray: () => new Uint8Array(0) };
  assert.throws(() => security.checkSecurityInput(huge, 'huge.pdf'), (error) => error.kind === 'too-large');

  // A truncated (half-downloaded) locked file.
  const locked = await security.lockPdf(engine, plain, 'p.pdf', 'password1');
  const truncated = locked.bytes.slice(0, Math.floor(locked.bytes.length / 3));
  await assert.rejects(security.unlockPdf(engine, truncated, 't.pdf', 'password1'), (error) => ['damaged', 'wrong-password', 'failed'].includes(error.kind));
});

test('a multi-megabyte PDF locks and unlocks intact', async () => {
  const original = await samplePdf(2, 6 * 1024 * 1024);
  const started = Date.now();
  const locked = await security.lockPdf(engine, original, 'big.pdf', 'big-file-pw');
  const unlocked = await security.unlockPdf(engine, locked.bytes, 'big.pdf', 'big-file-pw');
  const reloaded = await PDFDocument.load(unlocked.bytes);
  assert.ok(reloaded.catalog.lookup(PDFName.of('Names')), 'embedded file kept');
  assert.ok(unlocked.bytes.byteLength > 6 * 1024 * 1024, `payload kept (${unlocked.bytes.byteLength} bytes)`);
  assert.ok(Date.now() - started < 30_000, 'reasonable time');
});

test('password rules, strength, names and qpdf error classification', () => {
  assert.match(security.validateNewPassword('', ''), /Enter a password/);
  assert.match(security.validateNewPassword('short', 'short'), /at least 6/);
  assert.match(security.validateNewPassword('long enough', 'long enougH'), /match/i);
  assert.match(security.validateNewPassword('x'.repeat(128), 'x'.repeat(128)), /too long|127/i);
  assert.equal(security.validateNewPassword('long enough', 'long enough'), '');
  assert.equal(security.passwordStrength('abcdef'), 'weak');
  assert.equal(security.passwordStrength('Tr0ub4dor&3-horse-staple'), 'strong');
  assert.equal(security.unlockedFileName('Report (locked).pdf'), 'Report (unlocked).pdf');

  const kind = (stderr) => security.classifyQpdfFailure(stderr, 'f.pdf').kind;
  assert.equal(kind('qpdf: in.pdf: invalid password\n'), 'wrong-password');
  assert.equal(kind('qpdf: in.pdf: unsupported encryption filter /Adobe.PubSec'), 'unsupported');
  assert.equal(kind("qpdf: in.pdf: can't find PDF header"), 'damaged');
  assert.equal(kind('Failed to load qpdf.wasm'), 'engine');
  assert.equal(kind('Aborted(Cannot enlarge memory arrays)'), 'too-large');
  assert.equal(kind('something unexpected'), 'failed');
});
