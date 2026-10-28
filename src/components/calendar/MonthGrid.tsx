import { useMemo } from "react";
import type { PointerEvent } from "react";
import { Repeat } from "lucide-react";
import { parseDate } from "../../../cloudflare/calendar-rules.js";
import type { AnchorRect } from "./CalendarParts";
import { rectOf, useMediaQuery } from "./CalendarParts";
import { eventAriaLabel } from "./TimeGrid";
import { useDayDrag } from "./CalendarDrag";
import type { DayDragState, InvalidMoveHandler, MoveHandler } from "./CalendarDrag";
import { ItemTypeIcon, itemClasses } from "./SmartParts";
import {
  datesBetween, formatDay, formatTime, isBanner, isMultiDayTimed, packSpans, weekdayName, withTiming,
} from "../../lib/calendar-view";
import type { HorizontalResizeEdge, Occurrence } from "../../lib/calendar-view";

export default function MonthGrid({
  from, to, month, occurrences, zone, today, highlightId, onCreate, onSelect, onOpenDay, onMove, onInvalidMove, savingIds, restoringIds,
}: {
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
  onInvalidMove?: InvalidMoveHandler;
  savingIds?: Set<string>;
  restoringIds?: Set<string>;
}) {
  const { dayDrag, settlingId, startDayDrag, startDayResize } = useDayDrag(zone, onMove, savingIds, onInvalidMove);
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

  const displayOccurrences = useMemo(() => {
    if (!dayDrag || dayDrag.invalid || !dayDrag.changed) return occurrences;
    return occurrences.map((occurrence) => (occurrence.id === dayDrag.id ? withTiming(occurrence, dayDrag.target) : occurrence));
  }, [occurrences, dayDrag]);

  const placeholderSource = useMemo(() => {
    if (!dayDrag || !dayDrag.changed || dayDrag.invalid) return null;
    return occurrences.find((occurrence) => occurrence.id === dayDrag.id) || null;
  }, [occurrences, dayDrag]);

  return <div className="cal-month" style={{ ["--cal-weeks" as string]: weeks.length, ["--cal-max-lanes" as string]: maxLanes }}>
    <div className="cal-month-head" aria-hidden="true">{weeks[0]?.map((date) => <span key={date}>{weekdayName(date)}</span>)}</div>
    <div className="cal-month-body">
      {weeks.map((week) => <MonthWeek
        key={week[0]} week={week} occurrences={displayOccurrences} placeholderSource={placeholderSource}
        zone={zone} today={today} currentMonth={currentMonth} maxLanes={maxLanes} narrow={narrow} highlightId={highlightId}
        onCreate={onCreate} onSelect={onSelect} onOpenDay={onOpenDay}
        draggable={Boolean(onMove)} savingIds={savingIds} restoringIds={restoringIds} settlingId={settlingId}
        dayDrag={dayDrag} onDragStart={startDayDrag} onResizeStart={startDayResize}
      />)}
    </div>
  </div>;
}

function MonthWeek({
  week, occurrences, placeholderSource, zone, today, currentMonth, maxLanes, narrow, highlightId,
  onCreate, onSelect, onOpenDay, draggable, savingIds, restoringIds, settlingId, dayDrag, onDragStart, onResizeStart,
}: {
  week: string[]; occurrences: Occurrence[]; placeholderSource: Occurrence | null; zone: string; today: string; currentMonth: number; maxLanes: number; narrow: boolean; highlightId: string | null;
  draggable: boolean; savingIds?: Set<string>; restoringIds?: Set<string>; settlingId: string | null; dayDrag: DayDragState | null;
  onDragStart: (event: PointerEvent<HTMLElement>, occurrence: Occurrence) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, occurrence: Occurrence, edge: HorizontalResizeEdge) => void;
  onCreate: (input: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => void;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onOpenDay: (date: string) => void;
}) {
  const segments = useMemo(() => packSpans(occurrences, week, zone, () => true), [occurrences, week, zone]);
  const placeholderSegments = useMemo(
    () => (placeholderSource ? packSpans([placeholderSource], week, zone, () => true) : []),
    [placeholderSource, week, zone],
  );
  const hiddenPerDay = week.map((_, index) => segments.filter((segment) => segment.lane >= maxLanes && segment.start <= index && segment.end >= index).length);

  return <div className="cal-month-week">
    {week.map((date, index) => {
      const outside = parseDate(date).month !== currentMonth;
      const label = formatDay(date, { weekday: "long", month: "long", day: "numeric" });
      const dropHit = dayDrag?.dates.has(date);
      return <div key={date} className={`cal-month-cell ${outside ? "is-outside" : ""} ${date === today ? "is-today" : ""} ${dropHit ? (dayDrag?.invalid ? "is-drop-invalid" : "is-drop") : ""}`} style={{ gridColumn: index + 1 }} data-drop-date={date}>
        <button type="button" className="cal-month-hit" aria-label={`Create all-day event on ${label}`} onClick={(event) => onCreate({ date, time: null, allDay: true, anchor: rectOf(event.currentTarget) })}/>
        <button type="button" className="cal-month-daynum" onClick={() => onOpenDay(date)} aria-label={`${label}${date === today ? ", today" : ""}. Open day view`} aria-current={date === today ? "date" : undefined}>
          {parseDate(date).day === 1 && !narrow ? formatDay(date, { month: "short", day: "numeric" }) : parseDate(date).day}
        </button>
      </div>;
    })}
    {placeholderSegments.map((segment) => <div
      key={`placeholder-${segment.occurrence.id}`}
      className={`cal-chip cal-chip-banner cal-placeholder cal-cat-${segment.occurrence.event.category || "default"} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""}`}
      style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: Math.min(segment.lane, maxLanes - 1) + 2 }}
      aria-hidden="true"
    />)}
    {segments.filter((segment) => segment.lane < maxLanes).map((segment) => {
      const occurrence = segment.occurrence;
      const banner = isBanner(occurrence) || isMultiDayTimed(occurrence, zone) || segment.end > segment.start;
      const saving = Boolean(savingIds?.has(occurrence.id));
      const activeDrag = dayDrag?.id === occurrence.id;
      const settling = settlingId === occurrence.id;
      const restoring = Boolean(restoringIds?.has(occurrence.id));
      const canResizeX = draggable && !saving && banner;
      return <button
        type="button"
        key={occurrence.id}
        className={`cal-chip ${banner ? "cal-chip-banner" : "cal-chip-timed"} cal-cat-${occurrence.event.category || "default"} ${itemClasses(occurrence.event)} ${segment.continuesBefore ? "cont-before" : ""} ${segment.continuesAfter ? "cont-after" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""} ${saving ? "is-saving" : ""} ${activeDrag ? (dayDrag?.changed ? "is-dragging-live" : "is-drag-source") : ""} ${settling ? "is-settling" : ""} ${restoring ? "is-restoring" : ""} ${draggable ? "is-draggable" : ""}`}
        style={{ gridColumn: `${segment.start + 1} / ${segment.end + 2}`, gridRow: segment.lane + 2 }}
        onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
        onPointerDown={(event) => onDragStart(event, occurrence)}
        aria-label={eventAriaLabel(occurrence, zone, saving)}
      >
        {canResizeX && !segment.continuesBefore && <span className="cal-resize-x cal-resize-w" onPointerDown={(event) => onResizeStart(event, occurrence, "start")} aria-hidden="true"/>}
        <ItemTypeIcon event={occurrence.event} size={12}/>
        {!banner && !narrow && <span className="cal-chip-time">{formatTime(occurrence.startMs as number, zone)}</span>}
        <span className="cal-chip-title">{banner && !occurrence.allDay && !segment.continuesBefore && !narrow ? `${formatTime(occurrence.startMs as number, zone)} ` : ""}{occurrence.event.title}</span>
        {occurrence.recurring && banner && <Repeat size={10} className="cal-repeat-icon" aria-hidden="true"/>}
        {canResizeX && !segment.continuesAfter && <span className="cal-resize-x cal-resize-e" onPointerDown={(event) => onResizeStart(event, occurrence, "end")} aria-hidden="true"/>}
      </button>;
    })}
    {hiddenPerDay.map((count, index) => count > 0 ? <button
      type="button" key={`more-${week[index]}`} className="cal-month-more" style={{ gridColumn: index + 1, gridRow: maxLanes + 2 }}
      onClick={() => onOpenDay(week[index])}
      aria-label={`${count} more event${count === 1 ? "" : "s"} on ${formatDay(week[index], { weekday: "long", month: "long", day: "numeric" })}. Open day view`}
    >+{count} more</button> : null)}
  </div>;
}
