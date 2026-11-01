// Pure helper tests for the AudioSpace client library (src/lib/audio-space.ts).
// The TypeScript module is bundled with esbuild (repo convention) because the
// Node test runner loads plain ESM only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.audio-space-helpers-'));
const outfile = path.join(outDir, 'AudioSpaceHelpers.mjs');
await esbuild.build({
  stdin: {
    contents: `export * from "./src/lib/audio-space.ts";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
});

const {
  checkAudioLinkInput, defaultAudioTitleFromFileName, filterAudioItems, folderCounts,
  formatAudioBytes, formatDuration, privateStorageBytes, sectionCounts, sortAudioItems,
  tagsFromInput, tagsToInput,
} = await import(pathToFileURL(outfile).href);

const NOW = '2026-10-30T10:00:00.000Z';
const item = (overrides = {}) => ({
  id: 'id-1', folderId: null, title: 'Interview', description: '', source: 'upload',
  fileName: 'interview.mp3', fileSize: 1024, fileType: 'audio/mpeg', durationSeconds: 125,
  externalUrl: null, tags: [], favorite: false, metadata: {}, lastPlayedAt: null,
  createdAt: NOW, updatedAt: NOW, ...overrides,
});

test('formatDuration renders m:ss and h:mm:ss, with a placeholder for unknown', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(7), '0:07');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(null), '—:—');
  assert.equal(formatDuration(undefined), '—:—');
});

test('formatAudioBytes scales B/KB/MB/GB', () => {
  assert.equal(formatAudioBytes(512), '512 B');
  assert.equal(formatAudioBytes(2048), '2 KB');
  assert.equal(formatAudioBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatAudioBytes(null), '—');
});

test('defaultAudioTitleFromFileName cleans extensions and separators', () => {
  assert.equal(defaultAudioTitleFromFileName('team_sync_2026.mp3'), 'team sync 2026');
  assert.equal(defaultAudioTitleFromFileName('.hidden'), 'hidden');
  assert.equal(defaultAudioTitleFromFileName(''), 'Recording');
});

test('tagsFromInput normalizes and de-duplicates a comma field; tagsToInput round-trips', () => {
  assert.deepEqual(tagsFromInput(' Meeting , meeting ,, notes '), ['Meeting', 'notes']);
  assert.equal(tagsToInput(['a', 'b']), 'a, b');
  assert.deepEqual(tagsFromInput(tagsToInput(['x', 'y'])), ['x', 'y']);
});

test('checkAudioLinkInput surfaces clear local errors before any request', () => {
  assert.equal(checkAudioLinkInput('https://cdn.example.com/a.mp3'), null);
  assert.match(checkAudioLinkInput(''), /Paste an audio URL/);
  assert.match(checkAudioLinkInput('cdn.example.com/a.mp3'), /http/);
  assert.match(checkAudioLinkInput('http://127.0.0.1/x.mp3'), /private/);
});

test('folderCounts and privateStorageBytes summarise the library', () => {
  const items = [
    item({ id: 'a', folderId: 'f1', fileSize: 100 }),
    item({ id: 'b', folderId: 'f1', source: 'link', fileSize: null }),
    item({ id: 'c', source: 'recording', fileSize: 50 }),
  ];
  assert.deepEqual(folderCounts(items), { all: 3, f1: 2, none: 1 });
  assert.equal(privateStorageBytes(items), 150);
});

test('sectionCounts splits favorites, recordings and links', () => {
  const items = [
    item({ id: 'a', favorite: true }),
    item({ id: 'b', source: 'recording' }),
    item({ id: 'c', source: 'link', externalUrl: 'https://x.example/a.mp3' }),
  ];
  const counts = sectionCounts(items);
  assert.equal(counts.all, 3);
  assert.equal(counts.favorites, 1);
  assert.equal(counts.recordings, 1);
  assert.equal(counts.links, 1);
});

test('filterAudioItems applies section, folder, tag, search and sorting', () => {
  const items = [
    item({ id: 'a', title: 'Board meeting', folderId: 'f1', tags: ['work'], createdAt: '2026-10-28T10:00:00.000Z', durationSeconds: 60 }),
    item({ id: 'b', title: 'Lecture', source: 'recording', tags: ['study'], createdAt: '2026-10-29T10:00:00.000Z', durationSeconds: 300, lastPlayedAt: '2026-10-30T09:00:00.000Z' }),
    item({ id: 'c', title: 'Podcast feed', source: 'link', externalUrl: 'https://x.example/p.mp3', favorite: true, createdAt: '2026-10-30T10:00:00.000Z', durationSeconds: null }),
  ];
  assert.deepEqual(filterAudioItems(items, { section: 'all', query: '', folderId: '', sort: 'newest' }).map((entry) => entry.id), ['c', 'b', 'a']);
  assert.deepEqual(filterAudioItems(items, { section: 'favorites', query: '', folderId: '', sort: 'newest' }).map((entry) => entry.id), ['c']);
  assert.deepEqual(filterAudioItems(items, { section: 'recordings', query: '', folderId: '', sort: 'newest' }).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterAudioItems(items, { section: 'links', query: '', folderId: '', sort: 'newest' }).map((entry) => entry.id), ['c']);
  assert.deepEqual(filterAudioItems(items, { section: 'all', query: '', folderId: 'f1', sort: 'newest' }).map((entry) => entry.id), ['a']);
  assert.deepEqual(filterAudioItems(items, { section: 'all', query: '', folderId: '', tag: 'work', sort: 'newest' }).map((entry) => entry.id), ['a']);
  assert.deepEqual(filterAudioItems(items, { section: 'all', query: 'lecture', folderId: '', sort: 'newest' }).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterAudioItems(items, { section: 'all', query: '', folderId: '', sort: 'shortest' }).map((entry) => entry.id), ['a', 'b', 'c']);
  // Recent orders by the newest of added/recorded/played.
  assert.deepEqual(filterAudioItems(items, { section: 'recent', query: '', folderId: '', sort: 'newest' })[0].id, 'c');
});

test('sortAudioItems supports title and duration orderings without mutating input', () => {
  const items = [item({ id: 'a', title: 'Bee', durationSeconds: 3 }), item({ id: 'b', title: 'Ant', durationSeconds: 1 })];
  const original = [...items];
  assert.deepEqual(sortAudioItems(items, 'title').map((entry) => entry.id), ['b', 'a']);
  assert.deepEqual(sortAudioItems(items, 'longest').map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(items.map((entry) => entry.id), original.map((entry) => entry.id));
});
