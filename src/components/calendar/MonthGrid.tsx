import { useMemo } from "react";
import type { PointerEvent } from "react";
import { Repeat } from "lucide-react";
import { parseDate } from "../../../cloudflare/calendar-rules.js";
import type { AnchorRect } from "./CalendarParts";
import { rectOf, useMediaQuery } from "./CalendarParts";
import { eventAriaLabel } from "./TimeGrid";
import { useDayDrag } from "./CalendarDrag";
import type { MoveHandler } from "./CalendarDrag";
import { ItemTypeIcon, itemClasses } from "./SmartParts";
import { datesBetween, formatDay, formatTime, isBanner, packSpans, weekdayName } from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

export default function MonthGrid({ from, to, month, occurrences, zone, today, highlightId, onCreate, onSelect, onOpenDay, onMove, savingIds }: {
  from: string;
  to: string;
  /** Any date in the displayed month (to dim leading/trailing days). */
  month: string;
  occurrences: Occurrence[];
  zone: string;
  today: string;
  highlightId: string | null;
  onCreate: (input: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => void;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onOpenDay: (date: string) => void;
  onMove?: MoveHandler;
  savingIds?: Set<string>;
}) {
  const { dayDrag, startDayDrag } = useDayDrag(zone, onMove, savingIds);
  const narrow = useMediaQuery("(max-width: 640px)");
  const tall = useMediaQuery("(min-height: 860px)");
  const maxLanes = narrow ? 2 : tall ? 4 : 3;
  const days = useMemo(() => datesBetween(from, to), [from, to]);
  const weeks = useMemo(() => {
    const rows: string[][] = [];
    for (let index = 0; index < days.length; index += 7) rows.push(days.slice(index, index + 7));
    return rows;
  }, [days]);
  const currentMonth = parseDate(month).month;

  return <div className="cal-month" style={{ ["--cal-weeks" as string]: weeks.length, ["--cal-max-lanes" as string]: maxLanes }}>
    <div className="cal-month-head" aria-hidden="true">{weeks[0]?.map((date) => <span key={date}>{weekdayName(date)}</span>)}</div>
    <div className="cal-month-body">
      {weeks.map((week) => <MonthWeek key={week[0]} week={week} occurrences={occurrences} zone={zone} today={today} currentMonth={currentMonth} maxLanes={maxLanes} narrow={narrow} highlightId={highlightId} onCreate={onCreate} onSelect={onSelect} onOpenDay={onOpenDay}
        draggable={Boolean(onMove)} savingIds={savingIds} dropDates={dayDrag?.dates || null} dragId={dayDrag?.id || null} onDragStart={startDayDrag}/>)}
    </div>
  </div>;
}

function MonthWeek({ week, occurrences, zone, today, currentMonth, maxLanes, narrow, highlightId, onCreate, onSelect, onOpenDay, draggable, savingIds, dropDates, dragId, onDragStart }: {
  week: string[]; occurrences: Occurrence[]; zone: string; today: string; currentMonth: number; maxLanes: number; narrow: boolean; highlightId: string | null;
  draggable: boolean; savingIds?: Set<string>; dropDates: Set<string> | null; dragId: string | null;
  onDragStart: (event: PointerEvent<HTMLElement>, occurrence: Occurrence) => void;
  onCreate: (input: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => void;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onOpenDay: (date: string) => void;
}) {
  const segments = useMemo(() => packSpans(occurrences, week, zone, () => true), [occurrences, week, zone]);
  const hiddenPerDay = week.map((_, index) => segments.filter((segment) => segment.lane >= maxLanes && segment.start <= index && segment.end >= index).length);
  return <div className="cal-month-week">
    {week.map((date, index) => {
      const outside = parseDate(date).month !== currentMonth;
      const label = formatDay(date, { weekday: "long", month: "long", day: "numeric" });
      return <div key={date} className={`cal-month-cell ${outside ? "is-outside" : ""} ${date === today ? "is-today" : ""} ${dropDates?.has(date) ? "is-drop" : ""}`} style={{ gridColumn: index + 1 }} data-drop-date={date}>
        <button type="button" className="cal-month-hit" aria-label={`Create all-day event on ${label}`} onClick={(event) => onCreate({ date, time: null, allDay: true, anchor: rectOf(event.currentTarget) })}/>
        <button type="button" className="cal-month-daynum" onClick={() => onOpenDay(date)} aria-label={`${label}${date === today ? ", today" : ""}. Open day view`} aria-current={date === today ? "date" : undefined}>
          {parseDate(date).day === 1 && !narrow ? formatDay(date, { month: "short", day: "numeric" }) : parseDate(date).day}
        </button>
      </div>;
    })}
    {segments.filter((segment) => segment.lane < maxLanes).map((segment) => {
      const occurrence = segment.occurrence;
      const banner = isBanner(occurrence) || segment.end > segment.start;
      return <button
        type="button"
        key={occurrence.id}
        className={`cal-chip ${banner ? "cal-chip-banner" : "cal-chip-timed"} cal-cat-${occurrence.event.category || "default"} ${itemClasses(occurrence.event)} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""} ${savingIds?.has(occurrence.id) ? "is-saving" : ""} ${dragId === occurrence.id ? "is-drag-source" : ""} ${draggable ? "is-draggable" : ""}`}
        style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 2 }}
        onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
        onPointerDown={(event) => onDragStart(event, occurrence)}
        aria-label={eventAriaLabel(occurrence, zone, savingIds?.has(occurrence.id))}
      >
        {!banner && occurrence.event.itemType === "event" && <span className="cal-dot" aria-hidden="true"/>}
        {occurrence.event.itemType !== "event" && <ItemTypeIcon event={occurrence.event} size={11}/>}
        {!banner && !narrow && <span className="cal-chip-time">{formatTime(occurrence.startMs as number, zone)}</span>}
        <span className="cal-chip-title">{occurrence.event.title}</span>
        {occurrence.recurring && banner && <Repeat size={10} aria-hidden="true"/>}
      </button>;
    })}
    {hiddenPerDay.map((count, index) => count > 0 ? <button
      type="button" key={`more-${week[index]}`} className="cal-month-more" style={{ gridColumn: index + 1, gridRow: maxLanes + 2 }}
      onClick={() => onOpenDay(week[index])}
      aria-label={`${count} more event${count === 1 ? "" : "s"} on ${formatDay(week[index], { weekday: "long", month: "long", day: "numeric" })}. Open day view`}
    >+{count} more</button> : null)}
  </div>;
}
