import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Repeat } from "lucide-react";
import { addDays, localDateOf, localTimeOf, zonedTimeToInstant } from "../../../cloudflare/calendar-rules.js";
import type { AnchorRect } from "./CalendarParts";
import { rectOf } from "./CalendarParts";
import { beginPointerDrag, useDayDrag } from "./CalendarDrag";
import type { MoveHandler } from "./CalendarDrag";
import { ItemTypeIcon, itemClasses } from "./SmartParts";
import {
  addMinutesToTime, formatDay, formatHour, formatTime, isBanner, layoutDay, occurrenceDateLabel, occurrenceTimeLabel, packSpans, weekdayName,
} from "../../lib/calendar-view";
import type { Occurrence, TimedBlock } from "../../lib/calendar-view";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SNAP = 15;
const pad = (value: number) => String(value).padStart(2, "0");
const toTime = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
function minuteLabel(minutes: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, 0, minutes)));
}

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
 * Percentages resolve against the day column, so this adapts without measuring.
 */
function overlapPosition(column: number, columns: number): { left: string; width: string } {
  if (columns <= 1) return { left: "1px", width: "calc(100% - 6px)" };
  const step = `min(${100 / columns}%, max(16px, (100% - 72px) / ${columns - 1}))`;
  const left = `calc(${step} * ${column})`;
  const remaining = `calc(100% - ${left} - 3px)`;
  const width = column === columns - 1 ? remaining : `min(${remaining}, max(calc(${step} * 1.7), 64px))`;
  return { left: `calc(${left} + 1px)`, width };
}

export default function TimeGrid({ days, occurrences, zone, today, nowMs, highlightId, onCreate, onSelect, onOpenDay, onMove, savingIds }: {
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
  savingIds?: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ id: string; title: string; category: string; dayIndex: number; top: number; bottom: number; kind: "move" | "resize" } | null>(null);
  const { dayDrag, startDayDrag } = useDayDrag(zone, onMove, savingIds);
  const banners = useMemo(() => packSpans(occurrences, days, zone, isBanner), [occurrences, days, zone]);
  const lanes = banners.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);
  const columns = useMemo(() => days.map((date) => ({ date, blocks: layoutDay(occurrences, date, zone) })), [days, occurrences, zone]);
  const showsToday = days.includes(today);
  const [nowHour, nowMinute] = localTimeOf(nowMs, zone).split(":").map(Number);
  const nowTop = ((nowHour * 60 + nowMinute) / 60) * HOUR_HEIGHT;

  // Scroll to the working day (or just before "now") when the visible days change.
  const firstDay = days[0];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const earliest = columns.flatMap((column) => column.blocks).reduce((min, block) => Math.min(min, block.top), 24 * 60);
    const target = showsToday ? Math.max(0, nowTop - HOUR_HEIGHT * 2) : Math.min(7 * HOUR_HEIGHT, (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT / 2);
    // Hour labels straddle their line; keep a little room so the first one isn't clipped by the sticky header.
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

  /** Move (whole block) or resize (bottom edge) a timed block, snapping to 15 minutes. */
  const startBlockDrag = (event: PointerEvent<HTMLElement>, block: TimedBlock, dayIndex: number, kind: "move" | "resize") => {
    const occurrence = block.occurrence;
    if (!onMove || savingIds?.has(occurrence.id)) return;
    if (kind === "resize") event.stopPropagation();
    const grabMinute = minuteAt(event.clientY);
    const length = block.bottom - block.top;
    let current = { dayIndex, top: block.top, bottom: block.bottom };
    const show = () => setGhost({ id: occurrence.id, title: occurrence.event.title, category: occurrence.event.category || "default", kind, ...current });
    beginPointerDrag(event, {
      onStart: show,
      onMove: (x, y) => {
        autoScroll(y);
        const delta = snap(minuteAt(y) - grabMinute);
        current = kind === "move"
          ? (() => { const top = clamp(block.top + delta, 0, 1440 - SNAP); return { dayIndex: columnAt(x), top, bottom: Math.min(1440, top + length) }; })()
          : { dayIndex, top: block.top, bottom: clamp(block.bottom + delta, block.top + SNAP, 1440) };
        show();
      },
      onEnd: () => {
        setGhost(null);
        const startMs = occurrence.startMs as number; const endMs = occurrence.endMs as number;
        if (kind === "move") {
          const minutes = current.top - block.top; const dayShift = current.dayIndex - dayIndex;
          if (!minutes && !dayShift) return;
          const local = addMinutesToTime(addDays(localDateOf(startMs, zone), dayShift), localTimeOf(startMs, zone), minutes);
          const nextStart = zonedTimeToInstant(local.date, local.time, zone);
          onMove(occurrence, { allDay: false, startMs: nextStart, endMs: nextStart + (endMs - startMs) });
        } else {
          if (current.bottom === block.bottom) return;
          const date = days[dayIndex];
          const nextEnd = current.bottom >= 1440 ? zonedTimeToInstant(addDays(date, 1), "00:00", zone) : zonedTimeToInstant(date, toTime(current.bottom), zone);
          if (nextEnd > startMs) onMove(occurrence, { allDay: false, startMs, endMs: nextEnd });
        }
      },
      onCancel: () => setGhost(null),
    });
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
        {days.map((date, index) => <button
          type="button" key={date} className={`cal-tg-allday-slot ${dayDrag?.dates.has(date) ? "is-drop" : ""}`} style={{ gridColumn: index + 1 }} data-drop-date={date}
          aria-label={`Create all-day event on ${formatDay(date, { weekday: "long", month: "long", day: "numeric" })}`}
          onClick={(event) => onCreate({ date, time: null, allDay: true, anchor: rectOf(event.currentTarget) })}
        />)}
        {banners.map((segment) => <button
          type="button"
          key={`${segment.occurrence.id}`}
          className={`cal-chip cal-chip-banner cal-cat-${segment.occurrence.event.category || "default"} ${itemClasses(segment.occurrence.event)} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""} ${highlightId === segment.occurrence.event.id ? "is-highlight" : ""} ${savingIds?.has(segment.occurrence.id) ? "is-saving" : ""} ${dayDrag?.id === segment.occurrence.id ? "is-drag-source" : ""} ${onMove ? "is-draggable" : ""}`}
          style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 1 }}
          onClick={(event) => onSelect(segment.occurrence, rectOf(event.currentTarget))}
          onPointerDown={(event) => startDayDrag(event, segment.occurrence)}
          aria-label={eventAriaLabel(segment.occurrence, zone, savingIds?.has(segment.occurrence.id))}
        ><ItemTypeIcon event={segment.occurrence.event} size={11}/><span className="cal-chip-title">{segment.occurrence.allDay ? "" : `${formatTime(segment.occurrence.startMs as number, zone)} `}{segment.occurrence.event.title}</span>{segment.occurrence.recurring && <Repeat size={11} aria-hidden="true"/>}</button>)}
      </div>
    </div>
    </div>
      <div className="cal-tg-body" ref={bodyRef}>
        <div className="cal-tg-gutter cal-tg-hours" aria-hidden="true">
          {HOURS.map((hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{hour === 0 ? "" : formatHour(hour)}</span>)}
        </div>
        {columns.map(({ date, blocks }, dayIndex) => <div key={date} className={`cal-tg-col ${date === today ? "is-today" : ""}`}>
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
            return <button
              type="button"
              key={occurrence.id}
              className={`cal-block cal-cat-${occurrence.event.category || "default"} ${itemClasses(occurrence.event)} ${compact ? "is-compact" : ""} ${(occurrence.endMs as number) <= nowMs ? "is-past" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""} ${saving ? "is-saving" : ""} ${ghost?.id === occurrence.id ? "is-drag-source" : ""} ${onMove ? "is-draggable" : ""}`}
              style={{
                top: (block.top / 60) * HOUR_HEIGHT + 1, height,
                ...overlapPosition(block.column, block.columns),
                zIndex: 2 + block.column,
              }}
              onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
              onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "move")}
              aria-label={eventAriaLabel(occurrence, zone, saving)}
              aria-busy={saving || undefined}
            >
              <span className="cal-block-title"><span className="cal-block-name"><ItemTypeIcon event={occurrence.event} size={11}/>{occurrence.event.title}{occurrence.recurring && <Repeat size={10} aria-hidden="true"/>}</span></span>
              <span className="cal-block-time">{compact ? `, ${formatTime(occurrence.startMs as number, zone)}` : occurrenceTimeLabel(occurrence, zone)}</span>
              {!compact && height > 52 && occurrence.event.location && <span className="cal-block-meta">{occurrence.event.location}</span>}
              {onMove && !saving && !block.continuesAfter && <span className="cal-resize" onPointerDown={(event) => startBlockDrag(event, block, dayIndex, "resize")} aria-hidden="true"/>}
            </button>;
          })}
          {ghost && ghost.dayIndex === dayIndex && <div
            className={`cal-block cal-ghost cal-cat-${ghost.category}`} aria-hidden="true"
            style={{ top: (ghost.top / 60) * HOUR_HEIGHT + 1, height: Math.max(18, ((ghost.bottom - ghost.top) / 60) * HOUR_HEIGHT - 2), left: "1px", width: "calc(100% - 6px)", zIndex: 30 }}
          ><span className="cal-block-title">{ghost.title}</span><span className="cal-block-time">{minuteLabel(ghost.top)} – {minuteLabel(ghost.bottom)}</span></div>}
          {date === today && showsToday && <div className="cal-now" style={{ top: nowTop }} aria-hidden="true"><span/></div>}
        </div>)}
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
