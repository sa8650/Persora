import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import { Repeat } from "lucide-react";
import { localTimeOf } from "../../../cloudflare/calendar-rules.js";
import type { AnchorRect } from "./CalendarParts";
import { rectOf } from "./CalendarParts";
import {
  formatDay, formatHour, formatTime, isBanner, layoutDay, occurrenceDateLabel, occurrenceTimeLabel, packSpans, weekdayName,
} from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const pad = (value: number) => String(value).padStart(2, "0");

export function eventAriaLabel(occurrence: Occurrence, zone: string): string {
  const event = occurrence.event;
  return [event.title, occurrenceTimeLabel(occurrence, zone), occurrenceDateLabel(occurrence, zone),
    event.location || "", occurrence.recurring ? "Repeats" : ""].filter(Boolean).join(", ");
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

export default function TimeGrid({ days, occurrences, zone, today, nowMs, highlightId, onCreate, onSelect, onOpenDay }: {
  days: string[];
  occurrences: Occurrence[];
  zone: string;
  today: string;
  nowMs: number;
  highlightId: string | null;
  onCreate: (input: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => void;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onOpenDay: (date: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
          type="button" key={date} className="cal-tg-allday-slot" style={{ gridColumn: index + 1 }}
          aria-label={`Create all-day event on ${formatDay(date, { weekday: "long", month: "long", day: "numeric" })}`}
          onClick={(event) => onCreate({ date, time: null, allDay: true, anchor: rectOf(event.currentTarget) })}
        />)}
        {banners.map((segment) => <button
          type="button"
          key={`${segment.occurrence.id}`}
          className={`cal-chip cal-chip-banner cal-cat-${segment.occurrence.event.category || "default"} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""} ${highlightId === segment.occurrence.event.id ? "is-highlight" : ""}`}
          style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 1 }}
          onClick={(event) => onSelect(segment.occurrence, rectOf(event.currentTarget))}
          aria-label={eventAriaLabel(segment.occurrence, zone)}
        ><span className="cal-chip-title">{segment.occurrence.allDay ? "" : `${formatTime(segment.occurrence.startMs as number, zone)} `}{segment.occurrence.event.title}</span>{segment.occurrence.recurring && <Repeat size={11} aria-hidden="true"/>}</button>)}
      </div>
    </div>
    </div>
      <div className="cal-tg-body">
        <div className="cal-tg-gutter cal-tg-hours" aria-hidden="true">
          {HOURS.map((hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>{hour === 0 ? "" : formatHour(hour)}</span>)}
        </div>
        {columns.map(({ date, blocks }) => <div key={date} className={`cal-tg-col ${date === today ? "is-today" : ""}`}>
          {HOURS.map((hour) => <button
            type="button" key={hour} className="cal-tg-slot"
            aria-label={`Create event ${formatDay(date, { weekday: "long", month: "long", day: "numeric" })} at ${formatHour(hour)}`}
            onClick={slotClick(date, hour)}
          />)}
          {blocks.map((block) => {
            const height = Math.max(18, ((block.bottom - block.top) / 60) * HOUR_HEIGHT - 2);
            const compact = height < 34;
            const occurrence = block.occurrence;
            return <button
              type="button"
              key={occurrence.id}
              className={`cal-block cal-cat-${occurrence.event.category || "default"} ${compact ? "is-compact" : ""} ${(occurrence.endMs as number) <= nowMs ? "is-past" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""}`}
              style={{
                top: (block.top / 60) * HOUR_HEIGHT + 1, height,
                ...overlapPosition(block.column, block.columns),
                zIndex: 2 + block.column,
              }}
              onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
              aria-label={eventAriaLabel(occurrence, zone)}
            >
              <span className="cal-block-title">{occurrence.event.title}{occurrence.recurring && <Repeat size={10} aria-hidden="true"/>}</span>
              <span className="cal-block-time">{compact ? `, ${formatTime(occurrence.startMs as number, zone)}` : occurrenceTimeLabel(occurrence, zone)}</span>
              {!compact && height > 52 && occurrence.event.location && <span className="cal-block-meta">{occurrence.event.location}</span>}
            </button>;
          })}
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
