import { useMemo } from "react";
import { CalendarPlus, MapPin, Repeat } from "lucide-react";
import type { AnchorRect } from "./CalendarParts";
import { CategoryDot, rectOf } from "./CalendarParts";
import { eventAriaLabel } from "./TimeGrid";
import { formatDay, formatTime, groupByDay, occurrenceDays } from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

export default function AgendaList({ from, to, occurrences, zone, today, nowMs, highlightId, onSelect, onCreate }: {
  from: string;
  to: string;
  occurrences: Occurrence[];
  zone: string;
  today: string;
  nowMs: number;
  highlightId: string | null;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onCreate: () => void;
}) {
  const days = useMemo(() => {
    const map = groupByDay(occurrences, from, to, zone);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [occurrences, from, to, zone]);

  if (!days.length) {
    return <div className="cal-empty">
      <span className="cal-empty-icon"><CalendarPlus size={22}/></span>
      <h2>Nothing scheduled</h2>
      <p>No events from {formatDay(from, { month: "short", day: "numeric" })} to {formatDay(to, { month: "short", day: "numeric" })}.</p>
      <button type="button" className="cal-primary-button" onClick={onCreate}>New event</button>
    </div>;
  }

  return <ol className="cal-agenda" aria-label="Agenda">
    {days.map(([date, list]) => <li key={date} className={`cal-agenda-day ${date === today ? "is-today" : ""}`}>
      <div className="cal-agenda-date">
        <span className="cal-agenda-daynum">{Number(date.slice(8))}</span>
        <span className="cal-agenda-dayname">{formatDay(date, { weekday: "short" })}<small>{formatDay(date, { month: "short" })}</small></span>
        {date === today && <span className="cal-today-pill">Today</span>}
      </div>
      <ul>
        {list.map((occurrence) => {
          const span = occurrenceDays(occurrence, zone);
          const multi = span.first !== span.last;
          const time = occurrence.allDay
            ? "All day"
            : multi
              ? date === span.first ? `${formatTime(occurrence.startMs as number, zone)} →` : date === span.last ? `→ ${formatTime(occurrence.endMs as number, zone)}` : "All day"
              : <><span>{formatTime(occurrence.startMs as number, zone)}</span><span> – {formatTime(occurrence.endMs as number, zone)}</span></>;
          const past = occurrence.allDay ? (occurrence.endDate as string) <= today : (occurrence.endMs as number) <= nowMs;
          return <li key={`${occurrence.id}-${date}`}>
            <button
              type="button"
              className={`cal-agenda-row ${past ? "is-past" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""}`}
              onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
              aria-label={eventAriaLabel(occurrence, zone)}
            >
              <span className="cal-agenda-time">{time}</span>
              <CategoryDot category={occurrence.event.category}/>
              <span className="cal-agenda-main">
                <b>{occurrence.event.title}{occurrence.recurring && <Repeat size={11} aria-hidden="true"/>}</b>
                {occurrence.event.location && <small><MapPin size={11} aria-hidden="true"/>{occurrence.event.location}</small>}
              </span>
            </button>
          </li>;
        })}
      </ul>
    </li>)}
  </ol>;
}
