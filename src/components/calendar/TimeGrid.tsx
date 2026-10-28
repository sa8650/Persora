import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Repeat } from "lucide-react";
import { addDays, localDateOf, localTimeOf, zonedTimeToInstant } from "../../../cloudflare/calendar-rules.js";
import type { MoveTarget } from "../../../cloudflare/calendar-rules.js";
import type { AnchorRect } from "./CalendarParts";
import { rectOf } from "./CalendarParts";
import { RESIZE_HOLD_MS, SETTLE_MS, beginPointerDrag, useDayDrag } from "./CalendarDrag";
import type { InvalidMoveHandler, MoveHandler } from "./CalendarDrag";
import { ItemTypeIcon, itemClasses } from "./SmartParts";
import {
  addMinutesToTime, formatDay, formatHour, formatTime, horizontalResizeTarget, isBanner, isMultiDayTimed,
  layoutDay, occurrenceDateLabel, occurrenceTimeLabel, packSpans, sameTarget, snapQuarterHour,
  targetDates, verticalResizeTarget, weekdayName, withTiming,
} from "../../lib/calendar-view";
import type { Occurrence, TimedBlock } from "../../lib/calendar-view";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SNAP = 15;
const pad = (value: number) => String(value).padStart(2, "0");
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function eventAriaLabel(occurrence: Occurrence, zone: string, saving = false): string {
  const event = occurrence.event;
  const type = event.itemType === "task" ? (event.completedAt ? "Task, completed" : "Task") : event.itemType === "appointment" ? "Appointment" : "";
  return [event.title, type, occurrenceTimeLabel(occurrence, zone), occurrenceDateLabel(occurrence, zone),
    event.location || "", occurrence.recurring ? "Repeats" : "", saving ? "Saving" : ""].filter(Boolean).join(", ");
}

/**
 * Horizontal placement for overlapping blocks. Wide day columns split side by side;
 * narrow ones (tablet week) cascade with a small fixed offset so every block keeps a
 * readable width. Later columns start later and sit on top, like other calendars.
 */
function overlapPosition(column: number, columns: number): { left: string; width: string } {
  if (columns <= 1) return { left: "1px", width: "calc(100% - 6px)" };
  const step = `min(${100 / columns}%, max(16px, (100% - 72px) / ${columns - 1}))`;
  const left = `calc(${step} * ${column})`;
  const remaining = `calc(100% - ${left} - 3px)`;
  const width = column === columns - 1 ? remaining : `min(${remaining}, max(calc(${step} * 1.7), 64px))`;
  return { left: `calc(${left} + 1px)`, width };
}

type BlockGestureKind = "move" | "resize-s" | "resize-w" | "resize-e";

interface TimedGhostState {
  occurrence: Occurrence;
  target: MoveTarget;
  dates: Set<string>;
  changed: boolean;
  invalid: string | null;
  kind: BlockGestureKind;
}

export default function TimeGrid({
  days, occurrences, zone, today, nowMs, highlightId, onCreate, onSelect, onOpenDay, onMove, onInvalidMove, savingIds, restoringIds,
}: {
  days: string[];
  occurrences: Occurrence[];
  zone: string;
  today: string;
  nowMs: number;
  highlightId: string | null;
  onCreate: (input: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => void;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onOpenDay: (date: string) => void;
  /** Drag/resize result (absent = read-only). */
  onMove?: MoveHandler;
  onInvalidMove?: InvalidMoveHandler;
  savingIds?: Set<string>;
  restoringIds?: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number>(0);
  const [ghost, setGhost] = useState<TimedGhostState | null>(null);
  const [timedSettlingId, setTimedSettlingId] = useState<string | null>(null);
  const { dayDrag, settlingId: bannerSettlingId, startDayDrag, startDayResize } = useDayDrag(zone, onMove, savingIds, onInvalidMove);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const markTimedSettled = (id: string) => {
    window.clearTimeout(settleTimer.current);
    setTimedSettlingId(id);
    settleTimer.current = window.setTimeout(() => setTimedSettlingId((current) => (current === id ? null : current)), SETTLE_MS);
  };

  const bannerOccurrences = useMemo(() => {
    if (!dayDrag || dayDrag.invalid || !dayDrag.changed) return occurrences;
    return occurrences.map((occurrence) => (occurrence.id === dayDrag.id ? withTiming(occurrence, dayDrag.target) : occurrence));
  }, [occurrences, dayDrag]);

  const banners = useMemo(() => packSpans(bannerOccurrences, days, zone, isBanner), [bannerOccurrences, days, zone]);
  const placeholderBanners = useMemo(() => {
    if (!dayDrag || !dayDrag.changed || dayDrag.invalid) return [];
    const source = occurrences.find((occurrence) => occurrence.id === dayDrag.id);
    return source ? packSpans([source], days, zone, isBanner) : [];
  }, [occurrences, days, zone, dayDrag]);

  const lanes = Math.max(
    banners.reduce((max, segment) => Math.max(max, segment.lane + 1), 0),
    placeholderBanners.reduce((max, segment) => Math.max(max, segment.lane + 1), 0),
  );
  const columns = useMemo(() => days.map((date) => ({ date, blocks: layoutDay(occurrences, date, zone) })), [days, occurrences, zone]);
  const ghostPreviewOccurrence = useMemo(
    () => (ghost && !ghost.invalid ? withTiming(ghost.occurrence, ghost.target) : null),
    [ghost],
  );
  const ghostColumns = useMemo(
    () => (ghostPreviewOccurrence ? days.map((date) => layoutDay([ghostPreviewOccurrence], date, zone)) : null),
    [ghostPreviewOccurrence, days, zone],
  );

  const showsToday = days.includes(today);
  const [nowHour, nowMinute] = localTimeOf(nowMs, zone).split(":").map(Number);
  const nowTop = ((nowHour * 60 + nowMinute) / 60) * HOUR_HEIGHT;
  const isWeek = days.length > 1;

  // Scroll to the working day (or just before "now") when the visible days change.
  const firstDay = days[0];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const earliest = columns.flatMap((column) => column.blocks).reduce((min, block) => Math.min(min, block.top), 24 * 60);
    const target = showsToday ? Math.max(0, nowTop - HOUR_HEIGHT * 2) : Math.min(7 * HOUR_HEIGHT, (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT / 2);
    node.scrollTop = Math.max(0, target - 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length]);

  const columnRects = () => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".cal-tg-col") || []).map((node) => node.getBoundingClientRect());
  const columnAt = (x: number) => {
    const rects = columnRects();
    if (!rects.length) return 0;
    const index = rects.findIndex((rect) => x >= rect.left && x < rect.right);
    if (index >= 0) return index;
    return x < rects[0].left ? 0 : rects.length - 1;
  };
  const minuteAt = (y: number) => { const rect = columnRects()[0]; return rect ? ((y - rect.top) / HOUR_HEIGHT) * 60 : 0; };
  const autoScroll = (y: number) => {
    const node = scrollRef.current; if (!node) return;
    const rect = node.getBoundingClientRect();
    if (y < rect.top + 90) node.scrollTop -= 14; else if (y > rect.bottom - 30) node.scrollTop += 14;
  };

  /** Move (body), vertical resize (bottom edge), or horizontal date-span resize (left/right edges). */
  const startBlockDrag = (event: PointerEvent<HTMLElement>, block: TimedBlock, dayIndex: number, kind: BlockGestureKind) => {
    const occurrence = block.occurrence;
    if (!onMove || savingIds?.has(occurrence.id)) return;
    if (kind !== "move") event.stopPropagation();

    const startMs = occurrence.startMs as number;
    const endMs = occurrence.endMs as number;
    const initialTarget: MoveTarget = { allDay: false, startMs, endMs };
    const grabMinute = minuteAt(event.clientY);
    let state: TimedGhostState = {
      occurrence,
      target: initialTarget,
      dates: targetDates(initialTarget, zone),
      changed: false,
      invalid: null,
      kind,
    };

    const cursorClass = kind === "resize-s" ? "cal-resizing-ns" : kind === "move" ? "cal-dragging" : "cal-resizing-ew";
    const longPressMs = kind === "move" ? undefined : RESIZE_HOLD_MS;

    beginPointerDrag(event, {
      onStart: () => setGhost(state),
      onMove: (x, y) => {
        if (kind === "move" || kind === "resize-s") autoScroll(y);
        const colIndex = columnAt(x);
        const hoverDate = days[colIndex] || days[dayIndex];

        if (kind === "move") {
          const minuteDelta = snapQuarterHour(minuteAt(y) - grabMinute, -1440, 1440);
          const dayShift = colIndex - dayIndex;
          const clampedTop = clamp(block.top + minuteDelta, 0, 1440 - SNAP);
          const effectiveMinuteDelta = block.continuesBefore ? minuteDelta : clampedTop - block.top;
          const local = addMinutesToTime(addDays(localDateOf(startMs, zone), dayShift), localTimeOf(startMs, zone), effectiveMinuteDelta);
          const nextStart = zonedTimeToInstant(local.date, local.time, zone);
          const nextTarget: MoveTarget = { allDay: false, startMs: nextStart, endMs: nextStart + (endMs - startMs) };
          state = {
            occurrence,
            target: nextTarget,
            dates: targetDates(nextTarget, zone),
            changed: !sameTarget(occurrence, nextTarget),
            invalid: null,
            kind,
          };
          setGhost(state);
          return;
        }

        if (kind === "resize-s") {
          const minuteDelta = snapQuarterHour(minuteAt(y) - grabMinute, -1440, 1440);
          const proposedBottom = block.bottom + minuteDelta;
          const outcome = verticalResizeTarget(occurrence, days[dayIndex], proposedBottom, zone);
          if (outcome.target) {
            state = {
              occurrence,
              target: outcome.target,
              dates: targetDates(outcome.target, zone),
              changed: !sameTarget(occurrence, outcome.target),
              invalid: null,
              kind,
            };
          } else {
            state = {
              occurrence,
              target: initialTarget,
              dates: new Set([days[dayIndex]]),
              changed: false,
              invalid: outcome.invalid,
              kind,
            };
          }
          setGhost(state);
          return;
        }

        const edge = kind === "resize-w" ? "start" : "end";
        const outcome = horizontalResizeTarget(occurrence, edge, hoverDate, zone);
        if (outcome.target) {
          state = {
            occurrence,
            target: outcome.target,
            dates: targetDates(outcome.target, zone),
            changed: !sameTarget(occurrence, outcome.target),
            invalid: null,
            kind,
          };
        } else {
          state = {
            occurrence,
            target: initialTarget,
            dates: new Set([hoverDate]),
            changed: false,
            invalid: outcome.invalid,
            kind,
          };
        }
        setGhost(state);
      },
      onEnd: () => {
        setGhost(null);
        if (state.invalid) {
          onInvalidMove?.(state.invalid, occurrence.id);
          return;
        }
        if (state.changed) {
          markTimedSettled(occurrence.id);
          onMove(occurrence, state.target);
        }
      },
      onCancel: () => setGhost(null),
    }, { cursorClass, longPressMs });
  };

  const slotClick = (date: string, hour: number) => (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const half = event.clientY - box.top >= box.height / 2 && event.detail > 0;
    onCreate({ date, time: `${pad(hour)}:${half ? "30" : "00"}`, allDay: false, anchor: rectOf(event.currentTarget) });
  };

  return <div className={`cal-timegrid ${days.length === 1 ? "is-day" : "is-week"}`} style={{ ["--cal-days" as string]: days.length, ["--cal-hour" as string]: `${HOUR_HEIGHT}px` }}>
    <div className="cal-tg-scroll" ref={scrollRef}>
      <div className="cal-tg-sticky">
        <div className="cal-tg-head">
          <div className="cal-tg-gutter cal-tz-label" title={zone}>{shortZone(zone, nowMs)}</div>
          {days.map((date) => <button
            type="button" key={date}
            className={`cal-tg-dayhead ${date === today ? "is-today" : ""} ${date < today ? "is-past" : ""}`}
            onClick={() => onOpenDay(date)}
            aria-label={`${formatDay(date, { weekday: "long", month: "long", day: "numeric" })}${date === today ? ", today" : ""}. Open day view`}
          ><span className="cal-tg-weekday">{weekdayName(date)}</span><span className="cal-tg-date">{Number(date.slice(8))}</span></button>)}
        </div>
        <div className="cal-tg-allday" style={{ ["--cal-lanes" as string]: Math.max(1, lanes) }}>
          <div className="cal-tg-gutter cal-tg-allday-label">All day</div>
          <div className="cal-tg-allday-grid">
            {days.map((date, index) => {
              const dropHit = dayDrag?.dates.has(date);
              return <button
                type="button" key={date}
                className={`cal-tg-allday-slot ${dropHit ? (dayDrag?.invalid ? "is-drop-invalid" : "is-drop") : ""}`}
                style={{ gridColumn: index + 1 }} data-drop-date={date}
                aria-label={`Create all-day event on ${formatDay(date, { weekday: "long", month: "long", day: "numeric" })}`}
                onClick={(event) => onCreate({ date, time: null, allDay: true, anchor: rectOf(event.currentTarget) })}
              />;
            })}
            {placeholderBanners.map((segment) => <div
              key={`placeholder-${segment.occurrence.id}`}
              className={`cal-chip cal-chip-banner cal-placeholder cal-cat-${segment.occurrence.event.category || "default"} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""}`}
              style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 1 }}
              aria-hidden="true"
            />)}
            {banners.map((segment) => {
              const saving = Boolean(savingIds?.has(segment.occurrence.id));
              const activeDrag = dayDrag?.id === segment.occurrence.id;
              const settling = bannerSettlingId === segment.occurrence.id;
              const restoring = Boolean(restoringIds?.has(segment.occurrence.id));
              const canResizeX = Boolean(onMove) && !saving && isWeek;
              return <button
                type="button"
                key={segment.occurrence.id}
                className={`cal-chip cal-chip-banner cal-cat-${segment.occurrence.event.category || "default"} ${itemClasses(segment.occurrence.event)} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""} ${highlightId === segment.occurrence.event.id ? "is-highlight" : ""} ${saving ? "is-saving" : ""} ${activeDrag ? (dayDrag?.changed ? "is-dragging-live" : "is-drag-source") : ""} ${settling ? "is-settling" : ""} ${restoring ? "is-restoring" : ""} ${onMove ? "is-draggable" : ""}`}
                style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 1 }}
                onClick={(event) => onSelect(segment.occurrence, rectOf(event.currentTarget))}
                onPointerDown={(event) => startDayDrag(event, segment.occurrence)}
                aria-label={eventAriaLabel(segment.occurrence, zone, saving)}
              >
                {canResizeX && !segment.continuesBefore && <span className="cal-resize-x cal-resize-w" onPointerDown={(event) => startDayResize(event, segment.occurrence, "start")} aria-hidden="true"/>}
                <ItemTypeIcon event={segment.occurrence.event} size={12}/>
                <span className="cal-chip-title">{segment.occurrence.event.title}</span>
                {segment.occurrence.recurring && <Repeat size={11} className="cal-repeat-icon" aria-hidden="true"/>}
                {canResizeX && !segment.continuesAfter && <span className="cal-resize-x cal-resize-e" onPointerDown={(event) => startDayResize(event, segment.occurrence, "end")} aria-hidden="true"/>}
              </button>;
            })}
          </div>
        </div>
      </div>
      <div className="cal-tg-body" ref={bodyRef}>
        <div className="cal-tg-gutter cal-tg-hours" aria-hidden="true">
          {HOURS.map((hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{hour === 0 ? "" : formatHour(hour)}</span>)}
        </div>
        {columns.map(({ date, blocks }, dayIndex) => {
          const dropCol = Boolean(ghost && (ghost.kind !== "resize-s" || ghost.invalid) && ghost.dates.has(date));
          const ghostBlocks = ghostColumns ? ghostColumns[dayIndex] : [];
          return <div
            key={date}
            className={`cal-tg-col ${date === today ? "is-today" : ""} ${dropCol ? (ghost?.invalid ? "is-drop-invalid" : "is-drop") : ""}`}
          >
            {HOURS.map((hour) => <button
              type="button" key={hour} className="cal-tg-slot"
              aria-label={`Create event ${formatDay(date, { weekday: "long", month: "long", day: "numeric" })} at ${formatHour(hour)}`}
              onClick={slotClick(date, hour)}
            />)}
            {blocks.map((block) => {
              const height = Math.max(18, ((block.bottom - block.top) / 60) * HOUR_HEIGHT - 2);
              const compact = height < 34;
              const occurrence = block.occurrence;
              const saving = Boolean(savingIds?.has(occurrence.id));
              const multiDay = isMultiDayTimed(occurrence, zone);
              const settling = timedSettlingId === occurrence.id;
              const restoring = Boolean(restoringIds?.has(occurrence.id));
              const canResizeX = Boolean(onMove) && !saving && isWeek && (multiDay || block.columns <= 1);
              return <button
                type="button"
                key={`${occurrence.id}-${date}`}
                data-event-id={occurrence.event.id}
                data-occurrence-id={occurrence.id}
                className={`cal-block cal-cat-${occurrence.event.category || "default"} ${itemClasses(occurrence.event)} ${compact ? "is-compact" : ""} ${block.continuesBefore ? "cont-before" : ""} ${block.continuesAfter ? "cont-after" : ""} ${(occurrence.endMs as number) <= nowMs ? "is-past" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""} ${saving ? "is-saving" : ""} ${ghost?.occurrence.id === occurrence.id ? "is-drag-source" : ""} ${settling ? "is-settling" : ""} ${restoring ? "is-restoring" : ""} ${onMove ? "is-draggable" : ""}`}
                style={{
                  top: (block.top / 60) * HOUR_HEIGHT + 1,
                  height,
                  ...overlapPosition(block.column, block.columns),
                  zIndex: 2 + block.column,
                }}
                onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
                onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "move")}
                aria-label={eventAriaLabel(occurrence, zone, saving)}
                aria-busy={saving || undefined}
              >
                {canResizeX && !block.continuesBefore && <span className="cal-resize-x cal-resize-w" onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "resize-w")} aria-hidden="true"/>}
                <span className="cal-block-title">
                  <span className="cal-block-name">
                    <ItemTypeIcon event={occurrence.event} size={12}/>
                    <span className="cal-block-label">{occurrence.event.title}</span>
                    {occurrence.recurring && <Repeat size={10} className="cal-repeat-icon" aria-hidden="true"/>}
                  </span>
                </span>
                <span className="cal-block-time">
                  {compact
                    ? `, ${block.continuesBefore && !block.continuesAfter ? `→ ${formatTime(occurrence.endMs as number, zone)}` : formatTime(occurrence.startMs as number, zone)}`
                    : occurrenceTimeLabel(occurrence, zone)}
                </span>
                {!compact && height > 52 && occurrence.event.location && <span className="cal-block-meta">{occurrence.event.location}</span>}
                {canResizeX && !block.continuesAfter && <span className="cal-resize-x cal-resize-e" onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "resize-e")} aria-hidden="true"/>}
                {onMove && !saving && !block.continuesAfter && <span className="cal-resize" onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "resize-s")} aria-hidden="true"/>}
              </button>;
            })}
            {ghostPreviewOccurrence && ghostBlocks.map((ghostBlock) => {
              const ghostHeight = Math.max(18, ((ghostBlock.bottom - ghostBlock.top) / 60) * HOUR_HEIGHT - 2);
              const ghostCompact = ghostHeight < 34;
              return <div
                key={`ghost-${ghostPreviewOccurrence.id}-${date}`}
                className={`cal-block cal-ghost cal-cat-${ghostPreviewOccurrence.event.category || "default"} ${itemClasses(ghostPreviewOccurrence.event)} ${ghostCompact ? "is-compact" : ""} ${ghostBlock.continuesBefore ? "cont-before" : ""} ${ghostBlock.continuesAfter ? "cont-after" : ""}`}
                aria-hidden="true"
                style={{
                  top: (ghostBlock.top / 60) * HOUR_HEIGHT + 1,
                  height: ghostHeight,
                  left: "1px",
                  width: "calc(100% - 6px)",
                  zIndex: 30,
                }}
              >
                <span className="cal-block-title">
                  <span className="cal-block-name">
                    <ItemTypeIcon event={ghostPreviewOccurrence.event} size={12}/>
                    <span className="cal-block-label">{ghostPreviewOccurrence.event.title}</span>
                  </span>
                </span>
                <span className="cal-block-time">
                  {ghostCompact ? `, ${formatTime(ghostPreviewOccurrence.startMs as number, zone)}` : occurrenceTimeLabel(ghostPreviewOccurrence, zone)}
                </span>
              </div>;
            })}
            {date === today && showsToday && <div className="cal-now" style={{ top: nowTop }} aria-hidden="true"><span/></div>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}

function shortZone(zone: string, nowMs: number): string {
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(nowMs)).find((entry) => entry.type === "timeZoneName");
    return part?.value || zone;
  } catch { return zone; }
}
