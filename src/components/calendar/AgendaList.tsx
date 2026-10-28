import { useMemo } from "react";
import { MapPin, Repeat } from "lucide-react";
import { PersoraEmptyState } from "@/design-system";
import type { AnchorRect } from "./CalendarParts";
import { CategoryDot, rectOf } from "./CalendarParts";
import { eventAriaLabel } from "./TimeGrid";
import { ItemTypeIcon, itemClasses } from "./SmartParts";
import { formatDay, formatTime, groupByDay, occurrenceDays } from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

export default function AgendaList({ from, to, occurrences, zone, today, nowMs, highlightId, onSelect, onCreate, filtered = false, onResetFilters, savingIds }: {
  from: string;
  to: string;
  occurrences: Occurrence[];
  zone: string;
  today: string;
  nowMs: number;
  highlightId: string | null;
  onSelect: (occurrence: Occurrence, anchor: AnchorRect | null) => void;
  onCreate: () => void;
  /** Some items are hidden by filters. */
  filtered?: boolean;
  onResetFilters?: () => void;
  savingIds?: Set<string>;
}) {
  const days = useMemo(() => {
    const map = groupByDay(occurrences, from, to, zone);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [occurrences, from, to, zone]);

  if (!days.length) {
    return <PersoraEmptyState
      className="cal-empty"
      moduleId="calendar"
      tone="indigo"
      title={filtered ? "Nothing matches your filters" : "Nothing scheduled"}
      description={`${filtered ? "Some items" : "No events"} from ${formatDay(from, { month: "short", day: "numeric" })} to ${formatDay(to, { month: "short", day: "numeric" })}${filtered ? " are hidden by filters." : "."}`}
      action={filtered && onResetFilters
        ? <button type="button" className="cal-button" onClick={onResetFilters}>Reset filters</button>
        : <button type="button" className="cal-primary-button" onClick={onCreate}>New event</button>}
    />;
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
            ? occurrence.event.itemType === "task" ? "Due" : "All day"
            : multi
              ? date === span.first ? `${formatTime(occurrence.startMs as number, zone)} →` : date === span.last ? `→ ${formatTime(occurrence.endMs as number, zone)}` : "Continues"
              : <><span>{formatTime(occurrence.startMs as number, zone)}</span><span> – {formatTime(occurrence.endMs as number, zone)}</span></>;
          const past = occurrence.allDay ? (occurrence.endDate as string) <= today : (occurrence.endMs as number) <= nowMs;
          return <li key={`${occurrence.id}-${date}`}>
            <button
              type="button"
              className={`cal-agenda-row cal-cat-${occurrence.event.category || "default"} ${itemClasses(occurrence.event)} ${past ? "is-past" : ""} ${highlightId === occurrence.event.id ? "is-highlight" : ""} ${savingIds?.has(occurrence.id) ? "is-saving" : ""}`}
              onClick={(event) => onSelect(occurrence, rectOf(event.currentTarget))}
              aria-label={eventAriaLabel(occurrence, zone, savingIds?.has(occurrence.id))}
            >
              <span className="cal-agenda-time">{time}</span>
              <CategoryDot category={occurrence.event.category}/>
              <span className="cal-agenda-main">
                <b><ItemTypeIcon event={occurrence.event} size={13}/><span className="cal-agenda-title">{occurrence.event.title}</span>{occurrence.recurring && <Repeat size={11} className="cal-repeat-icon" aria-hidden="true"/>}</b>
                {occurrence.event.location && <small><MapPin size={11} aria-hidden="true"/>{occurrence.event.location}</small>}
              </span>
            </button>
          </li>;
        })}
      </ul>
    </li>)}
  </ol>;
}
