import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Minimal localStorage shim for the demo trash module.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => void store.set(key, String(value)),
  removeItem: (key) => void store.delete(key),
};

const source = await readFile(new URL('../src/lib/local-trash.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const trash = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const OWNER = 'demo-user';

test('buildTrashEntry records identity, origin, and a fresh 7-day window', () => {
  const now = 1_760_000_000_000;
  const entry = trash.buildTrashEntry({ id: 'rec-1', kind: 'vault_item', title: 'Passport', space: 'documents', payload: { id: 'rec-1' }, now });
  assert.equal(entry.id, 'rec-1');
  assert.equal(entry.kind, 'vault_item');
  assert.equal(entry.space, 'documents');
  assert.equal(entry.deletedAt, new Date(now).toISOString());
  assert.equal(entry.expiresAt, new Date(now + trash.TRASH_RETENTION_MS).toISOString());
  assert.equal(trash.TRASH_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
});

test('partitionTrashByExpiry separates active from expired entries', () => {
  const now = 1_760_000_000_000;
  const active = trash.buildTrashEntry({ id: 'a', kind: 'contact', title: 'A', space: 'contacts', payload: {}, now: now - 1000 });
  const expired = trash.buildTrashEntry({ id: 'b', kind: 'contact', title: 'B', space: 'contacts', payload: {}, now: now - 8 * 24 * 60 * 60 * 1000 });
  const split = trash.partitionTrashByExpiry([active, expired], now);
  assert.deepEqual(split.active.map((e) => e.id), ['a']);
  assert.deepEqual(split.expired.map((e) => e.id), ['b']);
});

test('local trash load hard-purges expired entries before returning', () => {
  const now = Date.now();
  const active = trash.buildTrashEntry({ id: 'keep', kind: 'vault_item', title: 'Keep', space: 'documents', payload: {}, now: now - 1000 });
  const expired = trash.buildTrashEntry({ id: 'purge', kind: 'vault_item', title: 'Purge', space: 'documents', payload: {}, now: now - 8 * 24 * 60 * 60 * 1000 });
  trash.pushLocalTrash(OWNER, active);
  trash.pushLocalTrash(OWNER, expired);
  const loaded = trash.loadLocalTrash(OWNER).filter((e) => ['keep', 'purge'].includes(e.id));
  assert.deepEqual(loaded.map((e) => e.id), ['keep']);
});

test('push dedupes by id and removeLocalTrash deletes permanently', () => {
  const now = Date.now();
  trash.pushLocalTrash(OWNER, trash.buildTrashEntry({ id: 'dup', kind: 'contact', title: 'First', space: 'contacts', payload: {}, now }));
  trash.pushLocalTrash(OWNER, trash.buildTrashEntry({ id: 'dup', kind: 'contact', title: 'Second', space: 'contacts', payload: {}, now: now + 1 }));
  let entries = trash.loadLocalTrash(OWNER).filter((e) => e.id === 'dup');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Second');
  trash.removeLocalTrash(OWNER, ['dup']);
  entries = trash.loadLocalTrash(OWNER).filter((e) => e.id === 'dup');
  assert.equal(entries.length, 0);
});

test('clearLocalTrash empties the owner trash and returns what was removed', () => {
  const now = Date.now();
  trash.pushLocalTrash(OWNER, trash.buildTrashEntry({ id: 'clear-me', kind: 'business_card', title: 'Card', space: 'business-cards', payload: {}, now }));
  const removed = trash.clearLocalTrash(OWNER).filter((e) => e.id === 'clear-me');
  assert.equal(removed.length, 1);
  assert.equal(trash.loadLocalTrash(OWNER).filter((e) => e.id === 'clear-me').length, 0);
});
