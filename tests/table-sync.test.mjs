// Persora Table save engine (src/lib/table/table-sync.ts) and undo history,
// bundled with esbuild. Drives slow, failed, lost, refused and conflicting
// saves with a manual clock: Saved only after confirmation, one batch in
// flight, identical retries (same batch id), no false conflicts, conflict and
// deleted-elsewhere stops, and a bulk change that is too large to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { blankSmartTable, blankSpreadsheet } from '../cloudflare/table-templates.js';
import { setCells } from '../cloudflare/table-sheet-ops.js';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.table-sync-'));
const outfile = path.join(outDir, 'sync.mjs');
await esbuild.build({
  stdin: { contents: "export * from './src/lib/table/table-sync.ts'; export * from './src/lib/table/table-history.ts';", resolveDir: process.cwd(), loader: 'ts' },
  outfile, bundle: true, format: 'esm', platform: 'neutral', logLevel: 'silent',
});
const { TableSaver, diffDocs, DocHistory } = await import(outfile);
rmSync(outDir, { recursive: true, force: true });

function clock() {
  let now = 0; let seq = 0; const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); due[1].fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    pending: () => timers.size,
  };
}
const ok = (revision) => ({ ok: true, replayed: false, table: { revision } });
const httpError = (status, message = 'x') => Object.assign(new Error(message), { status });
const sheetDoc = () => ({ kind: 'spreadsheet', sheets: blankSpreadsheet().sheets });
const edit = (doc, text) => ({ ...doc, sheets: doc.sheets.map((sheet, index) => (index ? sheet : { ...sheet, data: setCells(sheet.data, [[0, 0, { v: text }]]) })) });

test('diffDocs finds only changed sheets/records and deletions', () => {
  const base = sheetDoc();
  assert.equal(diffDocs(base, base), null);
  const changed = edit(base, 'a');
  assert.deepEqual(diffDocs(base, changed).sheets.upsert.map((s) => s.id), [base.sheets[0].id]);
  const smart = { kind: 'smart', ...(() => { const s = blankSmartTable(); return { meta: s.meta, records: s.records }; })() };
  const rec = { id: crypto.randomUUID(), position: 1024, values: {} };
  const withRecord = { ...smart, records: [...smart.records, rec] };
  const d1 = diffDocs(smart, withRecord);
  assert.equal(d1.meta, undefined);
  assert.deepEqual(d1.records.upsert.map((r) => r.id), [rec.id]);
  const removed = { ...withRecord, records: withRecord.records.filter((r) => r.id !== rec.id), meta: { ...withRecord.meta } };
  const d2 = diffDocs(withRecord, removed);
  assert.deepEqual(d2.records.delete, [rec.id]);
  assert.ok(d2.meta);
});

test('debounced: several edits become one batch; Saved only after the server confirms', async () => {
  const c = clock(); const sent = []; const states = [];
  let release;
  const saver = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 700, send: (batch) => { sent.push(batch); return new Promise((resolve) => { release = () => resolve(ok(2)); }); }, onState: (s) => states.push(s.status) });
  let doc = saver.savedDoc;
  for (const text of ['a', 'ab', 'abc']) { doc = edit(doc, text); saver.update(doc); await c.advance(200); }
  assert.equal(sent.length, 0);
  assert.equal(saver.snapshot.status, 'pending');
  await c.advance(700);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].baseRevision, 1);
  assert.equal(sent[0].sheets.upsert[0].data.cells['0:0'].v, 'abc');
  assert.equal(saver.snapshot.status, 'saving');
  assert.ok(saver.hasUnsaved);
  release(); await c.advance(0);
  assert.equal(saver.snapshot.status, 'saved');
  assert.equal(saver.currentRevision, 2);
  assert.equal(saver.hasUnsaved, false);
  assert.ok(!states.slice(0, states.indexOf('saving')).includes('saved'), 'never Saved before confirmation');
});

test('slow save: edits during the request go into the next batch with the new base revision', async () => {
  const c = clock(); const sent = []; const releases = [];
  const saver = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 100, send: (batch) => { sent.push(batch); return new Promise((resolve) => releases.push(() => resolve(ok(batch.baseRevision + 1)))); } });
  let doc = edit(saver.savedDoc, 'first'); saver.update(doc);
  await c.advance(100);
  doc = edit(doc, 'second'); saver.update(doc);
  await c.advance(1000);
  assert.equal(sent.length, 1, 'only one batch in flight');
  releases[0](); await c.advance(0); await c.advance(100);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].baseRevision, 2);
  assert.equal(sent[1].sheets.upsert[0].data.cells['0:0'].v, 'second');
  releases[1](); await c.advance(0);
  assert.equal(saver.snapshot.status, 'saved');
  assert.equal(saver.currentRevision, 3);
});

test('failed and lost saves are retried with the identical batch (same id), then later edits follow', async () => {
  const c = clock(); const sent = [];
  let mode = 'network';
  const saver = new TableSaver({ revision: 5, saved: sheetDoc(), ...c, debounceMs: 10, retryDelays: [1000, 2000], send: async (batch) => {
    sent.push(structuredClone(batch));
    if (mode === 'network') throw new TypeError('Failed to fetch');
    if (mode === '502') throw httpError(502);
    return ok(batch.baseRevision + 1);
  } });
  let doc = edit(saver.savedDoc, 'x'); saver.update(doc);
  await c.advance(10);
  assert.equal(saver.snapshot.status, 'retrying');
  assert.match(saver.snapshot.message, /kept on this device/);
  doc = edit(doc, 'y'); saver.update(doc); // edit while retrying
  mode = '502';
  await c.advance(1000);
  mode = 'ok';
  await c.advance(2000);
  assert.equal(sent.length, 3);
  assert.equal(saver.snapshot.status, 'pending', 'the follow-up edit is not Saved yet');
  await c.advance(50);
  assert.equal(sent.length, 4);
  assert.equal(sent[0].batchId, sent[1].batchId);
  assert.equal(sent[1].batchId, sent[2].batchId);
  assert.deepEqual(sent[0], sent[2], 'the retried batch is byte-for-byte the same');
  assert.equal(sent[3].baseRevision, 6);
  assert.notEqual(sent[3].batchId, sent[0].batchId);
  assert.equal(sent[3].sheets.upsert[0].data.cells['0:0'].v, 'y');
  assert.equal(saver.snapshot.status, 'saved');
});

test('conflict and deleted-elsewhere stop saving; nothing is merged or retried', async () => {
  const c = clock(); let calls = 0;
  const saver = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 10, send: async () => { calls++; throw httpError(409); } });
  let doc = edit(saver.savedDoc, 'mine'); saver.update(doc);
  await c.advance(10);
  assert.equal(saver.snapshot.status, 'conflict');
  doc = edit(doc, 'more'); saver.update(doc);
  await c.advance(60000);
  assert.equal(calls, 1);
  assert.ok(saver.hasUnsaved);
  // Reload latest: start over from the server copy.
  const server = sheetDoc();
  saver.reset(server, 7);
  assert.equal(saver.snapshot.status, 'saved');
  assert.equal(saver.hasUnsaved, false);

  const gone = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 10, send: async () => { throw httpError(404); } });
  gone.update(edit(gone.savedDoc, 'z'));
  await c.advance(10);
  assert.equal(gone.snapshot.status, 'gone');
});

test('refused (400) batches are not retried; the next edit sends a fresh batch', async () => {
  const c = clock(); const sent = []; let refuse = true;
  const saver = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 10, send: async (batch) => { sent.push(batch); if (refuse) throw httpError(400, 'Two sheets have the same name.'); return ok(2); } });
  let doc = edit(saver.savedDoc, 'bad'); saver.update(doc);
  await c.advance(10); await c.advance(60000);
  assert.equal(sent.length, 1);
  assert.equal(saver.snapshot.status, 'error');
  assert.equal(saver.snapshot.message, 'Two sheets have the same name.');
  refuse = false;
  doc = edit(doc, 'fixed'); saver.update(doc);
  await c.advance(10);
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].batchId, sent[0].batchId);
  assert.equal(saver.snapshot.status, 'saved');
});

test('undoing back to the saved document needs no save; oversized changes are refused locally', async () => {
  const c = clock(); let calls = 0;
  const saver = new TableSaver({ revision: 1, saved: sheetDoc(), ...c, debounceMs: 10, send: async () => { calls++; return ok(2); } });
  const original = saver.savedDoc;
  saver.update(edit(original, 'oops'));
  saver.update(original);
  await c.advance(100);
  assert.equal(calls, 0);
  assert.equal(saver.snapshot.status, 'saved');
  const huge = { ...original, sheets: original.sheets.map((sheet) => ({ ...sheet, data: { ...sheet.data, cells: { '0:0': { v: 'x'.repeat(7 * 1024 * 1024) } } } })) };
  saver.update(huge);
  await c.advance(10);
  assert.equal(calls, 0);
  assert.equal(saver.snapshot.status, 'error');
  assert.match(saver.snapshot.message, /too large/);
});

test('DocHistory: undo/redo with labels and a size limit', () => {
  const history = new DocHistory(3);
  history.push('a', 'Edit A1');
  history.push('b', 'Bold');
  assert.equal(history.undoLabel, 'Bold');
  const undone = history.undo('c');
  assert.equal(undone.doc, 'b');
  assert.equal(history.redoLabel, 'Bold');
  assert.equal(history.redo('b').doc, 'c');
  for (const value of ['d', 'e', 'f', 'g']) history.push(value, 'x');
  let count = 0; let current = 'h';
  while (history.canUndo) { current = history.undo(current).doc; count++; }
  assert.equal(count, 3);
  history.push('z', 'y');
  assert.equal(history.canRedo, false);
});
