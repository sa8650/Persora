import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/password-manager-trash.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const trash = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const entry = (id, updated = 1000) => ({ id, title: `Login ${id}`, login: '', password: 'x', url: '', notes: '', questions: [], folder: '', favorite: false, pinned: false, updated });

test('markEntryTrashed stamps a 7-day expiry window', () => {
  const now = 1_760_000_000_000;
  const marked = trash.markEntryTrashed(entry('a'), now);
  assert.equal(marked.trash.deletedAt, now);
  assert.equal(marked.trash.expiresAt, now + 7 * 24 * 60 * 60 * 1000);
  assert.equal(trash.PASSWORD_TRASH_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
});

test('restoreTrashedEntry clears the trash window and refreshes updated', () => {
  const now = 1_760_000_000_000;
  const marked = trash.markEntryTrashed(entry('a'), now - 100);
  const restored = trash.restoreTrashedEntry(marked, now);
  assert.equal(restored.trash, undefined);
  assert.equal(restored.updated, now);
  assert.equal(restored.title, 'Login a');
});

test('splitVaultEntries separates live, trashed, and expired entries', () => {
  const now = 1_760_000_000_000;
  const entries = [
    entry('live'),
    trash.markEntryTrashed(entry('fresh-trash'), now - 1000),
    trash.markEntryTrashed(entry('expired-trash'), now - 8 * 24 * 60 * 60 * 1000),
  ];
  const split = trash.splitVaultEntries(entries, now);
  assert.deepEqual(split.live.map((e) => e.id), ['live']);
  assert.deepEqual(split.trashed.map((e) => e.id), ['fresh-trash']);
  assert.deepEqual(split.expired.map((e) => e.id), ['expired-trash']);
});

test('purgeVaultTrash only removes expired entries', () => {
  const now = 1_760_000_000_000;
  const entries = [
    entry('live'),
    trash.markEntryTrashed(entry('keep'), now - 1000),
    trash.markEntryTrashed(entry('gone'), now - 9 * 24 * 60 * 60 * 1000),
  ];
  const { cleaned, purgedCount } = trash.purgeVaultTrash(entries, now);
  assert.equal(purgedCount, 1);
  assert.deepEqual(cleaned.map((e) => e.id).sort(), ['keep', 'live']);
  // Re-deleting a restored entry always starts a fresh window.
  const again = trash.purgeVaultTrash(cleaned, now);
  assert.equal(again.purgedCount, 0);
});
