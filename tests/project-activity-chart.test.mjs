// Projects → Activity analytics: server aggregation is exact (every row, local
// days, previous period), the route is membership-gated and pages past 1,000
// rows, and the cult-ui Analytics Chart renders the real buckets in a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { GlobalWindow } from 'happy-dom';
import {
  activityMetricOf, normalizeActivityRange, projectActivityWindow, summarizeProjectActivity,
} from '../cloudflare/project-activity-rules.js';
import { handleProjects } from '../cloudflare/projects.js';

const NOW = Date.parse('2026-10-25T10:00:00Z'); // 16:00 in Dhaka
const OWNER = '4a1b2c3d-4e5f-4678-8a9b-0c1d2e3f4a5b';
const STRANGER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const PROJECT = '6b2c3d4e-5f60-4789-8a1b-2c3d4e5f6071';
const row = (action, created_at, actor_id = OWNER) => ({ action, created_at, actor_id });

// ---------------------------------------------------------------- rules
test('events are bucketed by the viewer\'s local day, including across midnight UTC', () => {
  const stats = summarizeProjectActivity([
    row('field_created', '2026-10-24T19:30:00Z'), // 01:30 on Oct 25 in Dhaka
    row('comment_added', '2026-10-24T17:59:59Z', STRANGER), // 23:59:59 on Oct 24 in Dhaka
    row('field_updated', '2026-10-25T09:00:00Z'),
  ], { range: 7, timeZone: 'Asia/Dhaka', now: NOW });
  assert.equal(stats.from, '2026-10-19');
  assert.equal(stats.to, '2026-10-25');
  assert.equal(stats.bucket, 'day');
  assert.equal(stats.buckets.length, 7);
  assert.deepEqual(stats.buckets.map((b) => b.counts.all), [0, 0, 0, 0, 0, 1, 2]);
  assert.deepEqual(stats.totals, { all: 3, fields: 2, comments: 1, requests: 0, team: 0 });
  assert.equal(stats.activeMembers, 2);

  const utc = summarizeProjectActivity([row('field_created', '2026-10-24T19:30:00Z')], { range: 7, timeZone: 'UTC', now: NOW });
  assert.deepEqual(utc.buckets.map((b) => b.counts.all), [0, 0, 0, 0, 0, 1, 0], 'the same instant lands on Oct 24 in UTC');
});

test('previous period, quiet days, unknown actions and bad rows are handled honestly', () => {
  const stats = summarizeProjectActivity([
    row('field_status_changed', '2026-10-15T06:00:00Z'), // previous 7-day window (Oct 12–18)
    row('member_added', '2026-10-12T00:00:00Z'), // 06:00 Oct 12 Dhaka → previous window
    row('member_added', '2026-10-11T17:00:00Z'), // 23:00 Oct 11 Dhaka → before both windows
    row('folder_created', '2026-10-20T06:00:00Z'), // counted in All only
    row('something_new', '2026-10-21T06:00:00Z'), // future action → All only
    row('comment_added', 'not a date'),
    null,
  ], { range: 7, timeZone: 'Asia/Dhaka', now: NOW });
  assert.deepEqual(stats.previousTotals, { all: 2, fields: 1, comments: 0, requests: 0, team: 1 });
  assert.deepEqual(stats.totals, { all: 2, fields: 0, comments: 0, requests: 0, team: 0 });
  assert.equal(stats.buckets.filter((b) => b.counts.all === 0).length, 5, 'quiet days stay as zero buckets');
  assert.equal(activityMetricOf('field_request_approved'), 'requests');
  assert.equal(activityMetricOf('project_updated'), null);
});

test('90-day view uses 13 seven-day buckets ending today; unsupported ranges fall back to 30', () => {
  const stats = summarizeProjectActivity([
    row('comment_added', '2026-07-27T06:00:00Z'), // first day of the window
    row('comment_added', '2026-10-25T06:00:00Z'),
    row('comment_added', '2026-10-19T06:00:00Z'),
  ], { range: 90, timeZone: 'Asia/Dhaka', now: NOW });
  assert.equal(stats.bucket, 'week');
  assert.equal(stats.buckets.length, 13);
  assert.equal(stats.buckets[0].start, '2026-07-27');
  assert.equal(stats.buckets[0].end, '2026-08-02');
  assert.equal(stats.buckets[12].start, '2026-10-19');
  assert.equal(stats.buckets[12].end, '2026-10-25');
  assert.equal(stats.buckets[0].counts.comments, 1);
  assert.equal(stats.buckets[12].counts.comments, 2);
  assert.equal(normalizeActivityRange('365'), 30);
  assert.equal(normalizeActivityRange('7'), 7);
});

test('the database read starts at local midnight of the previous period (DST-aware)', () => {
  const dhaka = projectActivityWindow(30, 'Asia/Dhaka', NOW);
  assert.equal(dhaka.previousFrom, '2026-08-27');
  assert.equal(dhaka.since, '2026-08-26T18:00:00.000Z');
  // New York switches from EDT to EST on Nov 1 2026; the window start is still EDT midnight.
  const ny = projectActivityWindow(7, 'America/New_York', Date.parse('2026-11-03T15:00:00Z'));
  assert.equal(ny.previousFrom, '2026-10-21');
  assert.equal(ny.since, '2026-10-21T04:00:00.000Z');
  assert.equal(projectActivityWindow(7, 'Not/AZone', NOW).timeZone, 'UTC');
});

// ---------------------------------------------------------------- route
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
function mockDatabase({ activity = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers || {});
    calls.push({ url, range: headers.get('Range') });
    if (url.pathname.endsWith('/projects')) return Response.json([{ id: PROJECT, owner_id: OWNER, name: 'Launch', description: '', kind: 'shared', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]);
    if (url.pathname.endsWith('/project_members')) return Response.json([]);
    if (url.pathname.endsWith('/project_activity')) {
      const [start, end] = String(headers.get('Range') || '0-999').split('-').map(Number);
      return Response.json(activity.slice(start, end + 1));
    }
    return Response.json([]);
  };
  return calls;
}
const invoke = (pathName, identity, method = 'GET') => handleProjects(new Request(`https://persora.example/api${pathName}`, { method }), identity, env, 'https://persora.example');

test('GET /projects/:id/activity-stats counts every row (pages past 1,000) in the profile time zone', async () => {
  const today = new Date(Date.now()).toISOString();
  const activity = Array.from({ length: 1500 }, (_, i) => row(i % 3 === 0 ? 'comment_added' : 'field_updated', today));
  const calls = mockDatabase({ activity });
  const response = await invoke(`/projects/${PROJECT}/activity-stats?range=7`, { id: OWNER, timezone: 'Asia/Dhaka' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.range, 7);
  assert.equal(body.timeZone, 'Asia/Dhaka');
  assert.equal(body.totals.all, 1500, 'no "latest 40" cap — every event is counted');
  assert.equal(body.totals.comments, 500);
  const reads = calls.filter((call) => call.url.pathname.endsWith('/project_activity'));
  assert.equal(reads.length, 2, 'two 1,000-row pages were read');
  assert.deepEqual(reads.map((r) => r.range), ['0-999', '1000-1999']);
  assert.equal(reads[0].url.searchParams.get('project_id'), `eq.${PROJECT}`);
  assert.match(reads[0].url.searchParams.get('created_at'), /^gte\.\d{4}-\d{2}-\d{2}T/);
  assert.equal(reads[0].url.searchParams.get('limit'), null);
});

test('activity stats are hidden from non-members and are read-only', async () => {
  mockDatabase({ activity: [row('comment_added', new Date().toISOString())] });
  const hidden = await invoke(`/projects/${PROJECT}/activity-stats`, { id: STRANGER, timezone: 'UTC' });
  assert.ok([403, 404].includes(hidden.status), `non-member gets ${hidden.status}`);
  assert.equal((await hidden.json()).totals, undefined);
  const post = await invoke(`/projects/${PROJECT}/activity-stats`, { id: OWNER }, 'POST');
  assert.equal(post.status, 405);
});

// ---------------------------------------------------------------- UI
const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) if (!(key in globalThis)) globalThis[key] = happyWindow[key];
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.project-charts-'));
await esbuild.build({
  entryPoints: {
    chart: new URL('../src/components/project-charts/ProjectActivityChart.tsx', import.meta.url).pathname,
    data: new URL('../src/components/project-charts/activity-chart-data.ts', import.meta.url).pathname,
  },
  outdir: outDir, bundle: true, format: 'esm', platform: 'browser', loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react'], jsx: 'automatic',
  alias: { '@': new URL('../src', import.meta.url).pathname },
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' }, logLevel: 'silent',
});
const { ProjectActivityChart } = await import(path.join(outDir, 'chart.js'));
const data = await import(path.join(outDir, 'data.js'));
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');
const sleep = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('chart helpers: whole-number axis, latest peak, deltas and date text', () => {
  assert.equal(data.niceCountMax(0), 4);
  assert.equal(data.niceCountMax(5), 8);
  assert.equal(data.niceCountMax(8), 8);
  assert.equal(data.peakIndex([{ value: 0 }, { value: 3 }, { value: 3 }, { value: 1 }]), 2);
  assert.equal(data.peakIndex([{ value: 0 }, { value: 0 }]), null);
  assert.equal(data.deltaText(data.activityDelta(12, 10)), '+20%');
  assert.equal(data.deltaText(data.activityDelta(5, 10)), '−50%');
  assert.equal(data.deltaText(data.activityDelta(3, 0)), 'New');
  assert.equal(data.deltaText(data.activityDelta(0, 0)), 'No change');
  assert.equal(data.countText(1, 'comments'), '1 comment');
  assert.equal(data.countText(2, 'all'), '2 events');
  assert.equal(data.bucketDateText('2026-10-25', '2026-10-25', '2026-10-25'), 'Sun, Oct 25');
  assert.equal(data.bucketDateText('2026-07-27', '2026-08-02', '2026-10-25'), 'Jul 27 – Aug 2');
  assert.equal(data.bucketDateText('2025-12-29', '2026-01-04', '2026-10-25'), 'Dec 29 – Jan 4, 2026');
});

test('ProjectActivityChart renders the real buckets, switches metric and range, and supports the keyboard', async () => {
  const requested = [];
  const loadStats = async (projectId, range) => {
    requested.push([projectId, range]);
    return summarizeProjectActivity([
      row('comment_added', '2026-10-20T06:00:00Z'),
      row('comment_added', '2026-10-20T07:00:00Z'),
      row('field_created', '2026-10-20T08:00:00Z'),
      row('field_updated', '2026-10-23T06:00:00Z', STRANGER),
      row('field_updated', '2026-10-14T06:00:00Z'),
    ], { range, timeZone: 'Asia/Dhaka', now: NOW });
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ProjectActivityChart, { projectId: PROJECT, loadStats })); await sleep(60); });
  assert.deepEqual(requested[0], [PROJECT, 30]);

  const metric = (title) => [...container.querySelectorAll('.pc-metric')].find((b) => b.querySelector('.pc-metric-title').textContent === title);
  // 30-day window (Sep 26 – Oct 25) includes the Oct 14 field update too.
  assert.equal(metric('All activity').querySelector('.pc-metric-value').textContent, '5');
  assert.equal(metric('Comments').querySelector('.pc-metric-value').textContent, '2');
  assert.equal(metric('Fields').querySelector('.pc-metric-value').textContent, '3');
  assert.equal(metric('All activity').querySelector('.pc-metric-delta').textContent, 'New', 'nothing happened in the previous 30 days');
  assert.equal(metric('Fields').getAttribute('aria-pressed'), 'false');

  const dots = () => container.querySelectorAll('[data-slot="analytics-line-chart-svg"] > g > circle[stroke]');
  assert.equal(dots().length, 30, 'one point per local day in the 30-day window');
  const ticks = [...container.querySelectorAll('[data-slot="analytics-line-chart-tick"]')].map((t) => t.textContent);
  assert.deepEqual(ticks, ['4', '3', '2', '1', '0'], 'y axis starts at zero with whole-number ticks');
  const pinned = [...container.querySelectorAll('[data-slot="analytics-tooltip"]')].filter((t) => t.style.opacity === '1');
  assert.equal(pinned.length, 1);
  assert.match(pinned[0].textContent, /Tue, Oct 20/);
  assert.match(pinned[0].textContent, /3 events/);
  assert.match(container.textContent, /2 people active/);
  assert.match(container.textContent, /Asia\/Dhaka/);

  await act(async () => { metric('Comments').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); });
  const shown = [...container.querySelectorAll('[data-slot="analytics-tooltip"]')].filter((t) => t.style.opacity === '1');
  assert.match(shown[0].textContent, /Comments\s*2 comments/);
  assert.equal(container.querySelector('svg[role=img]').getAttribute('aria-label').includes('Comments per day'), true);

  const svg = container.querySelector('svg[role=img]');
  await act(async () => { svg.dispatchEvent(new window.FocusEvent('focus')); svg.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true })); await sleep(); });
  assert.match(container.querySelector('[data-slot="analytics-line-chart-live"]').textContent, /Sun, Oct 25: Comments, 0 comments/);

  const sevenDays = [...container.querySelectorAll('.pc-range button')].find((b) => b.textContent === '7D');
  await act(async () => { sevenDays.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(60); });
  assert.deepEqual(requested.at(-1), [PROJECT, 7]);
  assert.equal(dots().length, 7);
  assert.equal(metric('Fields').querySelector('.pc-metric-delta').textContent, '+100%', '2 field changes vs 1 in the previous 7 days');

  await act(async () => { root.unmount(); });
  container.remove();
});

test('ProjectActivityChart shows a retryable error instead of made-up numbers', async () => {
  let fail = true;
  const loadStats = async (_id, range) => {
    if (fail) throw new Error('Projects are temporarily unavailable.');
    return summarizeProjectActivity([], { range, timeZone: 'UTC', now: NOW });
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ProjectActivityChart, { projectId: PROJECT, loadStats })); await sleep(40); });
  assert.match(container.querySelector('[role=alert]').textContent, /temporarily unavailable/);
  assert.equal(container.querySelector('[data-slot="analytics-line-chart"]'), null);
  fail = false;
  const retry = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Try again'));
  await act(async () => { retry.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(40); });
  assert.ok(container.querySelector('[data-slot="analytics-line-chart"]'));
  assert.match(container.querySelector('.pc-empty-note').textContent, /No events in the last 30 days/);
  await act(async () => { root.unmount(); });
  container.remove();
});
