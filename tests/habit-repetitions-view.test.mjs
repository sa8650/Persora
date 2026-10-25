// Habit Tracker UI in a DOM against an in-memory check-in API that follows the
// persora_habit_checkin RPC (one row per habit + local date; value ≤ 0 clears it;
// numeric habits are complete when value ≥ target). Covers repetition checkboxes
// (exactly N controls, independent toggles, capped progress, batching), undo,
// measurement habits keeping their number field, and streak inputs (completedDates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { GlobalWindow } from 'happy-dom';

const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) if (!(key in globalThis)) globalThis[key] = happyWindow[key];
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { normalizeCheckinInput, isRepetitionHabit, repetitionsDone } = await import('../cloudflare/habit-rules.js');
const { localDateOf } = await import('../cloudflare/calendar-rules.js');

const today = localDateOf(Date.now(), 'UTC');
const now = new Date().toISOString();
const habit = (id, name, extra) => ({
  id, name, description: '', icon: 'check', color: 'blue', category: null, frequency: 'daily', weekdays: [], weeklyTarget: null,
  tracking: 'check', targetValue: null, unit: '', startDate: '2026-01-01',
  scheduleHistory: [{ from: '2026-01-01', frequency: 'daily', weekdays: [], weeklyTarget: null }],
  reminderTime: null, reminderEmail: false, position: 0, archivedAt: null, revision: 1, createdAt: now, updatedAt: now, completedDates: [], ...extra,
});
const ID = { five: '00000000-0000-4000-8000-000000000005', three: '00000000-0000-4000-8000-000000000003', fifteen: '00000000-0000-4000-8000-000000000015',
  thirty: '00000000-0000-4000-8000-000000000030', run: '00000000-0000-4000-8000-0000000000aa', read: '00000000-0000-4000-8000-0000000000bb', ten: '00000000-0000-4000-8000-000000000010' };

let habits; let checkins; const calls = [];
function reset() {
  habits = [
    habit(ID.three, 'Stretch', { tracking: 'numeric', targetValue: 3, unit: '', position: 0 }),
    habit(ID.five, 'Push-ups', { tracking: 'numeric', targetValue: 5, unit: 'times', position: 1 }),
    habit(ID.ten, 'Water', { tracking: 'numeric', targetValue: 10, unit: 'times', position: 2 }),
    habit(ID.fifteen, 'Breathing', { tracking: 'numeric', targetValue: 15, unit: 'reps', position: 3 }),
    habit(ID.thirty, 'Squats', { tracking: 'numeric', targetValue: 30, unit: 'times', position: 4 }),
    habit(ID.run, 'Run', { tracking: 'numeric', targetValue: 2.5, unit: 'km', position: 5 }),
    habit(ID.read, 'Read', { tracking: 'check', position: 6 }),
  ];
  checkins = new Map();
  calls.length = 0;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const { pathname } = new URL(String(url), 'http://localhost');
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, pathname, body });
  if (method === 'GET' && pathname === '/api/habits') {
    return json({ timeZone: 'UTC', today, from: '2026-01-01', to: today, email: { available: false, reason: null }, limits: { habits: 100, name: 80, description: 500, unit: 24 },
      habits, checkins: [...checkins.values()] });
  }
  const match = pathname.match(/^\/api\/habits\/([^/]+)\/checkins\/(\d{4}-\d{2}-\d{2})$/);
  if (method === 'PUT' && match) {
    const target = habits.find((entry) => entry.id === match[1]);
    const entry = normalizeCheckinInput(target, body);
    const key = `${target.id}:${match[2]}`;
    if (entry) checkins.set(key, { habitId: target.id, date: match[2], value: entry.value, target: entry.target, completed: entry.completed, updatedAt: now });
    else checkins.delete(key);
    target.completedDates = [...checkins.values()].filter((row) => row.habitId === target.id && row.completed).map((row) => row.date).sort();
    return json({ date: match[2], habitId: target.id, checkin: checkins.get(key) || null, completedDates: target.completedDates });
  }
  return json({ error: `unexpected ${method} ${pathname}` }, 404);
};

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.habits-view-'));
const outfile = path.join(outDir, 'HabitsView.mjs');
await esbuild.build({
  entryPoints: [new URL('../src/components/habits/HabitsView.tsx', import.meta.url).pathname],
  outfile, bundle: true, format: 'esm', platform: 'browser', loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react'], jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' }, logLevel: 'silent',
});
const { default: HabitsView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const user = { id: 'u1', email: 'u@example.com', name: 'U', timezone: 'UTC', demo: false };
async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(HabitsView, { user, notify: () => {} })); await sleep(30); });
  const row = (name) => [...container.querySelectorAll('.hb-row')].find((li) => li.querySelector('.hb-row-name')?.textContent === name);
  return {
    container, row,
    boxes: (name) => [...row(name).querySelectorAll('.hb-rep')],
    progress: (name) => row(name).querySelector('.hb-reps-progress')?.textContent.trim(),
    async click(element) { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(); }); },
    async settle(ms = 450) { await act(async () => { await sleep(ms); }); },
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); },
  };
}
const puts = () => calls.filter((call) => call.method === 'PUT');

test('rules: repetition habits are whole 1–100 counts with a counting unit; values are capped', () => {
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 5, unit: 'times' }), true);
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 15, unit: 'Reps' }), true);
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 3, unit: '' }), true);
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 2.5, unit: 'km' }), false, 'measurement');
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 8, unit: 'glasses' }), false, 'measured unit');
  assert.equal(isRepetitionHabit({ tracking: 'numeric', targetValue: 101, unit: 'times' }), false, 'over the cap');
  assert.equal(isRepetitionHabit({ tracking: 'check', targetValue: null, unit: '' }), false);
  assert.equal(repetitionsDone({ targetValue: 5 }, 7), 5);
  assert.equal(repetitionsDone({ targetValue: 5 }, 2.6), 2);
  assert.equal(repetitionsDone({ targetValue: 5 }, -1), 0);
});

test('targets 3, 5, 10, 15 and 30 render exactly N checkboxes in the right layout; measurement and checkbox habits keep their controls', async () => {
  reset();
  const view = await mount();
  for (const [name, n, size] of [['Stretch', 3, 'is-small'], ['Push-ups', 5, 'is-small'], ['Water', 10, 'is-small'], ['Breathing', 15, 'is-medium'], ['Squats', 30, 'is-large']]) {
    assert.equal(view.boxes(name).length, n, `${name} has ${n} boxes`);
    assert.ok(view.row(name).querySelector(`.hb-reps.${size}`), `${name} uses ${size}`);
    assert.equal(view.progress(name), `0 / ${n} completed`);
    assert.equal(view.row(name).querySelector('.hb-check'), null, 'no separate check button');
    assert.equal(view.row(name).querySelector('.hb-numeric'), null, 'no number field');
  }
  assert.ok(view.row('Run').querySelector('.hb-numeric input[type=number]'), 'measurement keeps its numeric input');
  assert.equal(view.row('Run').querySelectorAll('.hb-rep').length, 0);
  assert.ok(view.row('Read').querySelector('.hb-check'), 'checkbox habit keeps its check button');
  assert.equal(view.container.querySelector('.hb-heatmap'), null, 'no heatmap on habit rows in the Today view');
  await view.unmount();
});

test('boxes toggle independently, quick taps batch into one save, progress and completion follow, undo restores', async () => {
  reset();
  const view = await mount();
  const boxes = view.boxes('Push-ups');
  await view.click(boxes[0]);
  await view.click(boxes[2]);
  assert.deepEqual(view.boxes('Push-ups').map((box) => box.getAttribute('aria-pressed')), ['true', 'false', 'true', 'false', 'false'], 'non-adjacent boxes stay independent');
  assert.equal(view.progress('Push-ups'), '2 / 5 completed');
  await view.settle();
  assert.equal(puts().length, 1, 'two quick taps → one save');
  assert.deepEqual(puts()[0].body, { value: 2 });
  assert.equal(checkins.get(`${ID.five}:${today}`).value, 2, 'stored per habit and local day');
  assert.deepEqual(view.boxes('Push-ups').map((box) => box.getAttribute('aria-pressed')), ['true', 'false', 'true', 'false', 'false'], 'positions survive the save');

  // Undo restores the previous value (no check-in).
  const undo = view.container.querySelector('.hb-undo-button');
  assert.ok(undo, 'undo offered');
  assert.match(view.container.querySelector('.hb-undo').textContent, /2 \/ 5 completed/);
  await view.click(undo);
  await view.settle(50);
  assert.deepEqual(puts().at(-1).body, { value: 0 });
  assert.equal(checkins.has(`${ID.five}:${today}`), false, 'undo cleared the check-in (no duplicate rows)');
  assert.equal(view.progress('Push-ups'), '0 / 5 completed');
  assert.equal(view.container.querySelector('.hb-undo'), null, 'undo itself is not undoable');

  // Tick all five → complete; the day joins completedDates (streak input).
  for (const box of view.boxes('Push-ups')) await view.click(box);
  await view.settle();
  assert.deepEqual(puts().at(-1).body, { value: 5 });
  assert.equal(view.progress('Push-ups'), '5 / 5 completed');
  assert.ok(view.row('Push-ups').classList.contains('is-done'), 'row shows completion');
  assert.deepEqual(habits.find((h) => h.id === ID.five).completedDates, [today]);

  // Un-tick one → no longer complete.
  await view.click(view.boxes('Push-ups')[4]);
  await view.settle();
  assert.deepEqual(puts().at(-1).body, { value: 4 });
  assert.equal(view.row('Push-ups').classList.contains('is-done'), false);
  assert.deepEqual(habits.find((h) => h.id === ID.five).completedDates, []);
  await view.unmount();
});

test('stored values above the target show as N / N; re-loading keeps the saved count', async () => {
  reset();
  checkins.set(`${ID.three}:${today}`, { habitId: ID.three, date: today, value: 7, target: 3, completed: true, updatedAt: now });
  habits.find((h) => h.id === ID.three).completedDates = [today];
  checkins.set(`${ID.fifteen}:${today}`, { habitId: ID.fifteen, date: today, value: 6, target: 15, completed: false, updatedAt: now });
  const view = await mount();
  assert.equal(view.progress('Stretch'), '3 / 3 completed', 'capped at the target');
  assert.equal(view.boxes('Stretch').filter((box) => box.getAttribute('aria-pressed') === 'true').length, 3);
  assert.equal(view.progress('Breathing'), '6 / 15 completed', 'persisted count restored on load');
  await view.unmount();
});

test('checkbox habits and measurements also get undo with their previous value', async () => {
  reset();
  const view = await mount();
  await view.click(view.row('Read').querySelector('.hb-check'));
  await view.settle(30);
  assert.deepEqual(puts().at(-1).body, { completed: true });
  await view.click(view.container.querySelector('.hb-undo-button'));
  await view.settle(30);
  assert.deepEqual(puts().at(-1).body, { completed: false });

  const input = view.row('Run').querySelector('.hb-numeric input');
  await act(async () => {
    input.dispatchEvent(new window.FocusEvent('focus'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '1.75');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep();
  });
  await act(async () => { input.dispatchEvent(new window.FocusEvent('blur')); input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); await sleep(30); });
  assert.deepEqual(puts().at(-1).body, { value: 1.75 }, 'measurement saves the typed amount');
  await view.click(view.container.querySelector('.hb-undo-button'));
  await view.settle(30);
  assert.deepEqual(puts().at(-1).body, { value: 0 });
  await view.unmount();
});
