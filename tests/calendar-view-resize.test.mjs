// Comprehensive Calendar UI, multi-day timed segmentation, two-way resizing,
// mini icons, compact day-header styles, and modal fade tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:4173/' });
win.innerWidth = 1366;
win.innerHeight = 900;
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement',
  'HTMLInputElement', 'SVGElement', 'Node', 'Event', 'MouseEvent',
  'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage',
]) {
  Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
win.matchMedia = (query) => ({
  matches: query.includes('min-width: 900px') || query.includes('min-height: 860px'),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false; },
});

class SimPointerEvent extends win.MouseEvent {
  constructor(type, init = {}) {
    super(type, { bubbles: true, cancelable: true, button: 0, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
globalThis.PointerEvent = SimPointerEvent;
win.PointerEvent = SimPointerEvent;

const entryCode = `
  import TimeGrid from './src/components/calendar/TimeGrid.tsx';
  import MonthGrid from './src/components/calendar/MonthGrid.tsx';
  import AgendaList from './src/components/calendar/AgendaList.tsx';
  import { expandOccurrences } from './cloudflare/calendar-rules.js';
  import * as calView from './src/lib/calendar-view.ts';
  export { TimeGrid, MonthGrid, AgendaList, expandOccurrences, calView };
`;

const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.cal-view-'));
const outfile = path.join(outDir, 'CalendarBundle.mjs');
process.on('exit', () => { try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ } });

await build({
  stdin: {
    contents: entryCode,
    resolveDir: new URL('..', import.meta.url).pathname,
    sourcefile: 'calendar-test-entry.tsx',
    loader: 'tsx',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react'],
  jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' },
  logLevel: 'silent',
});

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { TimeGrid, MonthGrid, AgendaList, expandOccurrences, calView } = await import(outfile);

function makeTimedEvent(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    seriesId: null,
    originalStartAt: null,
    originalStartDate: null,
    status: 'confirmed',
    itemType: overrides.itemType || 'event',
    completedAt: overrides.completedAt || null,
    title: overrides.title || 'Sample Event',
    description: '',
    location: overrides.location || '',
    category: overrides.category || 'work',
    allDay: false,
    timeZone: overrides.timeZone || 'Asia/Dhaka',
    startAt: overrides.startAt,
    endAt: overrides.endAt,
    startDate: null,
    endDate: null,
    recurrence: overrides.recurrence || null,
    reminderMinutes: null,
    reminderEmail: false,
    revision: 1,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T00:00:00Z',
  };
}

function makeAllDayEvent(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    seriesId: null,
    originalStartAt: null,
    originalStartDate: null,
    status: 'confirmed',
    itemType: overrides.itemType || 'event',
    completedAt: overrides.completedAt || null,
    title: overrides.title || 'All Day Retreat',
    description: '',
    location: '',
    category: overrides.category || 'personal',
    allDay: true,
    timeZone: overrides.timeZone || 'Asia/Dhaka',
    startAt: null,
    endAt: null,
    startDate: overrides.startDate,
    endDate: overrides.endDate,
    recurrence: overrides.recurrence || null,
    reminderMinutes: null,
    reminderEmail: false,
    revision: 1,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T00:00:00Z',
  };
}

test('multi-day timed events stay out of the all-day row and split cleanly across Asia/Dhaka dates', () => {
  const zone = 'Asia/Dhaka';
  // Oct 26, 2026 11:00 PM -> Oct 27, 2026 1:00 AM Asia/Dhaka (+06:00)
  const crossMidnight = makeTimedEvent({
    id: 'evt-cross',
    title: 'Overnight Release',
    startAt: '2026-10-26T17:00:00.000Z', // 23:00 Asia/Dhaka
    endAt: '2026-10-26T19:00:00.000Z',   // 01:00 Oct 27 Asia/Dhaka
  });
  // >= 24h timed event: Oct 26 09:00 -> Oct 28 15:00 Asia/Dhaka
  const multiDayLong = makeTimedEvent({
    id: 'evt-long',
    title: 'Hackathon Sprint',
    startAt: '2026-10-26T03:00:00.000Z', // 09:00 Oct 26 Asia/Dhaka
    endAt: '2026-10-28T09:00:00.000Z',   // 15:00 Oct 28 Asia/Dhaka
  });
  // Exact midnight ending: Oct 26 22:00 -> Oct 27 00:00 Asia/Dhaka
  const exactMidnight = makeTimedEvent({
    id: 'evt-midnight',
    title: 'Late Film',
    startAt: '2026-10-26T16:00:00.000Z', // 22:00 Oct 26 Asia/Dhaka
    endAt: '2026-10-26T18:00:00.000Z',   // 00:00 Oct 27 Asia/Dhaka
  });
  const trueAllDay = makeAllDayEvent({
    id: 'evt-allday',
    title: 'National Holiday',
    startDate: '2026-10-26',
    endDate: '2026-10-28',
  });

  const occurrences = expandOccurrences(
    [crossMidnight, multiDayLong, exactMidnight, trueAllDay],
    '2026-10-25',
    '2026-11-01',
    zone,
  );
  const byId = new Map(occurrences.map((o) => [o.event.id, o]));

  assert.equal(calView.isBanner(byId.get('evt-cross')), false, '2h cross-midnight timed event is NOT a banner');
  assert.equal(calView.isBanner(byId.get('evt-long')), false, '54h multi-day timed event is NOT a banner');
  assert.equal(calView.isBanner(byId.get('evt-midnight')), false, 'exact-midnight timed event is NOT a banner');
  assert.equal(calView.isBanner(byId.get('evt-allday')), true, 'true all-day event IS a banner');

  assert.equal(calView.isMultiDayTimed(byId.get('evt-cross'), zone), true);
  assert.equal(calView.isMultiDayTimed(byId.get('evt-long'), zone), true);
  assert.equal(calView.isMultiDayTimed(byId.get('evt-midnight'), zone), false, 'exact midnight end stays single-day');

  // Day 1 (Oct 26) timed layout
  const oct26 = calView.layoutDay(occurrences, '2026-10-26', zone);
  const crossD1 = oct26.find((b) => b.occurrence.event.id === 'evt-cross');
  assert.deepEqual(
    { top: crossD1.top, bottom: crossD1.bottom, continuesBefore: crossD1.continuesBefore, continuesAfter: crossD1.continuesAfter },
    { top: 23 * 60, bottom: 1440, continuesBefore: false, continuesAfter: true },
  );
  const midnightD1 = oct26.find((b) => b.occurrence.event.id === 'evt-midnight');
  assert.deepEqual(
    { top: midnightD1.top, bottom: midnightD1.bottom, continuesBefore: midnightD1.continuesBefore, continuesAfter: midnightD1.continuesAfter },
    { top: 22 * 60, bottom: 1440, continuesBefore: false, continuesAfter: false },
  );

  // Day 2 (Oct 27) timed layout
  const oct27 = calView.layoutDay(occurrences, '2026-10-27', zone);
  const crossD2 = oct27.find((b) => b.occurrence.event.id === 'evt-cross');
  assert.deepEqual(
    { top: crossD2.top, bottom: crossD2.bottom, continuesBefore: crossD2.continuesBefore, continuesAfter: crossD2.continuesAfter },
    { top: 0, bottom: 60, continuesBefore: true, continuesAfter: false },
  );
  assert.equal(oct27.find((b) => b.occurrence.event.id === 'evt-midnight'), undefined, 'no extra continuation segment on Oct 27 for exact midnight end');

  // Intermediate day of 3-day timed event fills full day (0..1440)
  const longD2 = oct27.find((b) => b.occurrence.event.id === 'evt-long');
  assert.deepEqual(
    { top: longD2.top, bottom: longD2.bottom, continuesBefore: longD2.continuesBefore, continuesAfter: longD2.continuesAfter },
    { top: 0, bottom: 1440, continuesBefore: true, continuesAfter: true },
  );

  // Final day (Oct 28) of 3-day timed event runs 00:00 -> 15:00
  const oct28 = calView.layoutDay(occurrences, '2026-10-28', zone);
  const longD3 = oct28.find((b) => b.occurrence.event.id === 'evt-long');
  assert.deepEqual(
    { top: longD3.top, bottom: longD3.bottom, continuesBefore: longD3.continuesBefore, continuesAfter: longD3.continuesAfter },
    { top: 0, bottom: 15 * 60, continuesBefore: true, continuesAfter: false },
  );
});

test('vertical and horizontal resize math preserves opposite anchors, wall-clock times, and rejects invalid inversions', () => {
  const zone = 'Asia/Dhaka';
  const [occ] = expandOccurrences([
    makeTimedEvent({
      id: 'evt-resize',
      title: 'Design Critique',
      startAt: '2026-10-26T04:00:00.000Z', // 10:00 Oct 26 Dhaka
      endAt: '2026-10-26T05:00:00.000Z',   // 11:00 Oct 26 Dhaka
    }),
  ], '2026-10-25', '2026-11-01', zone);

  // Vertical resize: 10:00 -> 12:30 (bottom = 750), snaps to 15 min
  const vert = calView.verticalResizeTarget(occ, '2026-10-26', 748, zone);
  assert.equal(vert.invalid, null);
  assert.equal(vert.target.startMs, occ.startMs, 'startMs unchanged on vertical resize');
  assert.equal(new Date(vert.target.endMs).toISOString(), '2026-10-26T06:30:00.000Z', 'snapped to 12:30 Dhaka');

  // Horizontal resize right edge to Oct 28 -> keeps 11:00 end time on Oct 28, anchors Oct 26 10:00 start
  const right = calView.horizontalResizeTarget(occ, 'end', '2026-10-28', zone);
  assert.equal(right.invalid, null);
  assert.equal(right.target.startMs, occ.startMs);
  assert.equal(new Date(right.target.endMs).toISOString(), '2026-10-28T05:00:00.000Z');

  // Horizontal resize left edge to Oct 25 -> moves start to Oct 25 10:00, anchors Oct 26 11:00 end
  const left = calView.horizontalResizeTarget(occ, 'start', '2026-10-25', zone);
  assert.equal(left.invalid, null);
  assert.equal(new Date(left.target.startMs).toISOString(), '2026-10-25T04:00:00.000Z');
  assert.equal(left.target.endMs, occ.endMs);

  // Invalid horizontal resize: dragging left edge of cross-midnight event (Oct 26 23:00 -> Oct 27 01:00) to Oct 27 (23:00 > 01:00)
  const [crossOcc] = expandOccurrences([
    makeTimedEvent({
      id: 'evt-cross-inv',
      title: 'Night Shift',
      startAt: '2026-10-26T17:00:00.000Z',
      endAt: '2026-10-26T19:00:00.000Z',
    }),
  ], '2026-10-25', '2026-11-01', zone);
  const invalidLeft = calView.horizontalResizeTarget(crossOcc, 'start', '2026-10-27', zone);
  assert.equal(invalidLeft.target, null);
  assert.match(invalidLeft.invalid, /must start before its end time/);

  // All-day horizontal resize
  const [allDayOcc] = expandOccurrences([
    makeAllDayEvent({
      id: 'evt-ad-resize',
      title: 'Offsite',
      startDate: '2026-10-26',
      endDate: '2026-10-28', // Oct 26..27 inclusive
    }),
  ], '2026-10-25', '2026-11-01', zone);
  const adRight = calView.horizontalResizeTarget(allDayOcc, 'end', '2026-10-30', zone);
  assert.deepEqual(adRight.target, { allDay: true, startDate: '2026-10-26', endDate: '2026-10-31' });
  const adInvalid = calView.horizontalResizeTarget(allDayOcc, 'end', '2026-10-25', zone);
  assert.equal(adInvalid.target, null);
  assert.match(adInvalid.invalid, /must end on or after/);
});

test('TimeGrid, MonthGrid, and AgendaList render mini icons on every item, segment multi-day timed events, and execute two-way resize gestures', async () => {
  const zone = 'Asia/Dhaka';
  const days = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
  const items = [
    makeTimedEvent({ id: 'e-1', itemType: 'event', title: 'Overnight Deploy', startAt: '2026-10-26T17:00:00.000Z', endAt: '2026-10-26T19:00:00.000Z' }),
    makeTimedEvent({ id: 't-1', itemType: 'task', title: 'Pay Utility Bill', startAt: '2026-10-26T04:00:00.000Z', endAt: '2026-10-26T04:30:00.000Z' }),
    makeTimedEvent({ id: 'a-1', itemType: 'appointment', title: 'Dental Checkup', startAt: '2026-10-27T08:00:00.000Z', endAt: '2026-10-27T09:00:00.000Z' }),
    makeAllDayEvent({ id: 'ad-1', itemType: 'event', title: 'Product Offsite', startDate: '2026-10-28', endDate: '2026-10-30' }),
  ];
  const occurrences = expandOccurrences(items, '2026-10-25', '2026-11-01', zone);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  const moves = [];
  const invalids = [];
  const selected = [];

  await act(async () => {
    root.render(React.createElement(TimeGrid, {
      days,
      occurrences,
      zone,
      today: '2026-10-26',
      nowMs: Date.parse('2026-10-26T06:00:00.000Z'),
      highlightId: null,
      onCreate: () => {},
      onSelect: (occ) => selected.push(occ.event.id),
      onOpenDay: () => {},
      onMove: (occ, target) => moves.push({ id: occ.event.id, target }),
      onInvalidMove: (msg, occId) => invalids.push({ msg, occId }),
    }));
  });

  // 1. All-day row contains ONLY true all-day item ('Product Offsite'), NOT 'Overnight Deploy'
  const allDayBanners = [...host.querySelectorAll('.cal-tg-allday-grid .cal-chip-banner')];
  assert.equal(allDayBanners.length, 1);
  assert.match(allDayBanners[0].textContent, /Product Offsite/);
  assert.ok(allDayBanners[0].querySelector('svg.cal-type-icon'), 'all-day banner has contextual mini icon');

  // 2. Cross-midnight 'Overnight Deploy' renders as TWO timed column segments sharing event id 'e-1'
  const deployBlocks = [...host.querySelectorAll('.cal-tg-body .cal-block[data-event-id="e-1"]')];
  assert.equal(deployBlocks.length, 2, 'Overnight Deploy renders on Oct 26 and Oct 27 timed columns');
  assert.ok(deployBlocks[0].classList.contains('cont-after') && !deployBlocks[0].classList.contains('cont-before'));
  assert.ok(deployBlocks[1].classList.contains('cont-before') && !deployBlocks[1].classList.contains('cont-after'));
  // Only the final segment has bottom vertical .cal-resize handle; Day 1 has left .cal-resize-w, Day 2 has right .cal-resize-e
  assert.equal(deployBlocks[0].querySelectorAll('.cal-resize').length, 0);
  assert.equal(deployBlocks[1].querySelectorAll('.cal-resize').length, 1, 'exactly one .cal-resize on final segment');
  assert.ok(deployBlocks[0].querySelector('.cal-resize-w'), 'Day 1 segment has left horizontal resize handle');
  assert.ok(deployBlocks[1].querySelector('.cal-resize-e'), 'Day 2 segment has right horizontal resize handle');

  // 3. Every timed block (event, task, appointment) has a contextual mini icon
  const allBlocks = [...host.querySelectorAll('.cal-tg-body .cal-block')];
  assert.equal(allBlocks.length, 4);
  for (const block of allBlocks) {
    assert.ok(block.querySelector('svg.cal-type-icon'), `block ${block.textContent} has .cal-type-icon`);
  }

  // 4. Plain click on segment opens details without starting resize
  await act(async () => {
    deployBlocks[0].click();
  });
  assert.deepEqual(selected, ['e-1']);
  assert.equal(moves.length, 0);

  // Mock column bounding rects for pointer vertical & horizontal resize simulation
  const colNodes = [...host.querySelectorAll('.cal-tg-col')];
  colNodes.forEach((col, idx) => {
    col.getBoundingClientRect = () => ({
      left: 60 + idx * 160,
      right: 60 + (idx + 1) * 160,
      top: 100,
      bottom: 100 + 24 * 48,
      width: 160,
      height: 24 * 48,
      x: 60 + idx * 160,
      y: 100,
    });
  });

  // 5. Simulate vertical resize on Dental Checkup (Oct 27 14:00->15:00 Dhaka; drag bottom +24px = +30m -> 15:30)
  const apptBlock = host.querySelector('.cal-block[data-event-id="a-1"]');
  const vHandle = apptBlock.querySelector('.cal-resize');
  await act(async () => {
    vHandle.dispatchEvent(new SimPointerEvent('pointerdown', { clientX: 60 + 2 * 160 + 40, clientY: 100 + 15 * 48 }));
    window.dispatchEvent(new SimPointerEvent('pointermove', { clientX: 60 + 2 * 160 + 40, clientY: 100 + 15 * 48 + 24 }));
    window.dispatchEvent(new SimPointerEvent('pointerup', { clientX: 60 + 2 * 160 + 40, clientY: 100 + 15 * 48 + 24 }));
  });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'a-1');
  assert.equal(new Date(moves[0].target.startMs).toISOString(), '2026-10-27T08:00:00.000Z', 'startMs unchanged');
  assert.equal(new Date(moves[0].target.endMs).toISOString(), '2026-10-27T09:30:00.000Z', 'extended by 30 minutes');

  // 6. Simulate horizontal right-edge resize on Overnight Deploy Day 2 segment -> drag to Oct 28 (col index 3)
  const eHandle = deployBlocks[1].querySelector('.cal-resize-e');
  await act(async () => {
    eHandle.dispatchEvent(new SimPointerEvent('pointerdown', { clientX: 60 + 2 * 160 + 155, clientY: 120 }));
    window.dispatchEvent(new SimPointerEvent('pointermove', { clientX: 60 + 3 * 160 + 80, clientY: 120 }));
    window.dispatchEvent(new SimPointerEvent('pointerup', { clientX: 60 + 3 * 160 + 80, clientY: 120 }));
  });
  assert.equal(moves.length, 2);
  assert.equal(moves[1].id, 'e-1');
  assert.equal(new Date(moves[1].target.startMs).toISOString(), '2026-10-26T17:00:00.000Z', 'Oct 26 23:00 start anchored');
  assert.equal(new Date(moves[1].target.endMs).toISOString(), '2026-10-27T19:00:00.000Z', 'end moved to Oct 28 01:00 Dhaka');

  // 7. MonthGrid renders mini icons on both banner & timed chips and horizontal resize handles on banners
  await act(async () => {
    root.render(React.createElement(MonthGrid, {
      from: '2026-10-25',
      to: '2026-11-08',
      month: '2026-10-26',
      occurrences,
      zone,
      today: '2026-10-26',
      highlightId: null,
      onCreate: () => {},
      onSelect: () => {},
      onOpenDay: () => {},
      onMove: (occ, target) => moves.push({ id: occ.event.id, target }),
      onInvalidMove: (msg, occId) => invalids.push({ msg, occId }),
    }));
  });
  const monthChips = [...host.querySelectorAll('.cal-month .cal-chip')];
  assert.ok(monthChips.length >= 4);
  for (const chip of monthChips) {
    assert.ok(chip.querySelector('svg.cal-type-icon'), `month chip ${chip.textContent} has mini icon`);
  }
  const monthBanners = [...host.querySelectorAll('.cal-month .cal-chip-banner')];
  assert.ok(monthBanners.some((b) => b.querySelector('.cal-resize-w') && b.querySelector('.cal-resize-e')), 'month banners render left & right horizontal resize handles');

  // 8. AgendaList renders mini icons on every row and labels middle days of multi-day timed items "Continues"
  const threeDay = makeTimedEvent({
    id: 'e-3d',
    title: 'Regional Summit',
    startAt: '2026-10-26T03:00:00.000Z',
    endAt: '2026-10-28T09:00:00.000Z',
  });
  const agendaOccs = expandOccurrences([...items, threeDay], '2026-10-25', '2026-11-01', zone);
  await act(async () => {
    root.render(React.createElement(AgendaList, {
      from: '2026-10-25',
      to: '2026-11-01',
      occurrences: agendaOccs,
      zone,
      today: '2026-10-26',
      nowMs: Date.parse('2026-10-26T06:00:00.000Z'),
      highlightId: null,
      onSelect: () => {},
      onCreate: () => {},
    }));
  });
  const agendaRows = [...host.querySelectorAll('.cal-agenda-row')];
  assert.ok(agendaRows.length >= 7);
  for (const row of agendaRows) {
    assert.ok(row.querySelector('svg.cal-type-icon'), `agenda row ${row.textContent} has mini icon`);
  }
  const summitTimes = agendaRows
    .filter((r) => r.textContent.includes('Regional Summit'))
    .map((r) => r.querySelector('.cal-agenda-time').textContent.trim());
  assert.equal(summitTimes[1], 'Continues', 'middle day of multi-day timed event says Continues, not All day');

  root.unmount();
  host.remove();
});

test('compact day-header CSS (44-52px) and outside-fade modal backdrops (no backdrop blur)', () => {
  const calCss = readFileSync(new URL('../src/components/calendar/calendar.css', import.meta.url), 'utf8');
  const dayHeadMatch = calCss.match(/\.cal-tg-dayhead\s*\{([^}]+)\}/);
  assert.ok(dayHeadMatch, '.cal-tg-dayhead rule exists');
  assert.match(dayHeadMatch[1], /min-height:\s*46px/);
  assert.match(dayHeadMatch[1], /max-height:\s*50px/);

  const dateMatch = calCss.match(/^\.cal-tg-date\s*\{([^}]+)\}/m);
  assert.ok(dateMatch);
  assert.match(dateMatch[1], /font-size:\s*15px/);
  assert.match(dateMatch[1], /width:\s*26px/);

  const overlaysCss = readFileSync(new URL('../src/overlays.css', import.meta.url), 'utf8');
  const themeCss = readFileSync(new URL('../src/persora-theme.css', import.meta.url), 'utf8');
  assert.match(overlaysCss, /\.modal-backdrop\s*\{[^}]*backdrop-filter:\s*none/);
  assert.ok(!/\.modal-backdrop[^{]*\{[^}]*backdrop-filter:\s*blur/.test(themeCss), 'no modal-backdrop blur in persora-theme.css');
});
