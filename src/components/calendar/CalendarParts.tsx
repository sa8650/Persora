import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ModalPortal from "../ModalPortal";
import { addDays, addMonths, parseDate, startOfMonth, startOfWeek } from "../../../cloudflare/calendar-rules.js";
import { WEEK_STARTS_ON, datesBetween, formatDay } from "../../lib/calendar-view";
import type { CalendarCategory } from "../../../cloudflare/calendar-rules.js";

export interface AnchorRect { top: number; left: number; width: number; height: number }
export const rectOf = (element: Element | null | undefined): AnchorRect | null => {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
};

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Small anchored dialog (event details, quick create, mini calendar). Becomes
 * a bottom sheet on narrow screens. Escape / outside click closes it and focus
 * returns to the element that opened it.
 */
export function CalPopover({ anchor, onClose, labelledBy, className = "", children, initialFocus = true }: {
  anchor: AnchorRect | null; onClose: () => void; labelledBy: string; className?: string; children: ReactNode; initialFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const sheet = useMediaQuery("(max-width: 640px)");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || sheet) return;
    const width = node.offsetWidth; const height = node.offsetHeight;
    const vw = window.innerWidth; const vh = window.innerHeight; const gap = 8;
    if (!anchor) { setPosition({ top: Math.max(gap, (vh - height) / 2), left: Math.max(gap, (vw - width) / 2) }); return; }
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
    let left: number; let top: number;
    if (anchor.left + anchor.width + gap + width <= vw - gap) { left = anchor.left + anchor.width + gap; top = anchor.top; }
    else if (anchor.left - gap - width >= gap) { left = anchor.left - gap - width; top = anchor.top; }
    else {
      left = anchor.left + anchor.width / 2 - width / 2;
      top = anchor.top + anchor.height + gap;
      if (top + height > vh - gap) top = anchor.top - height - gap;
    }
    setPosition({ top: clamp(top, gap, vh - height - gap), left: clamp(left, gap, vw - width - gap) });
  }, [anchor, sheet]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (initialFocus) {
      const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") || ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus({ preventScroll: true });
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onCloseRef.current(); }
      if (event.key === "Tab" && ref.current) {
        const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!nodes.length) return;
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(timer);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  return <ModalPortal>
    {sheet && <div className="cal-sheet-scrim" aria-hidden="true"/>}
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      className={`cal-popover ${sheet ? "is-sheet" : ""} ${className}`.trim()}
      style={sheet ? undefined : { top: position?.top ?? -9999, left: position?.left ?? -9999 }}
    >{children}</div>
  </ModalPortal>;
}

export function CategoryDot({ category, className = "" }: { category: CalendarCategory | null; className?: string }) {
  return <span className={`cal-dot cal-cat-${category || "default"} ${className}`.trim()} aria-hidden="true"/>;
}

/** Month picker used in the sidebar and in the date popover on smaller screens. */
export function MiniCalendar({ selected, today, rangeFrom, rangeTo, onSelect }: {
  selected: string; today: string; rangeFrom: string; rangeTo: string; onSelect: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  useEffect(() => { setMonth(startOfMonth(selected)); }, [selected]);
  const start = startOfWeek(month, WEEK_STARTS_ON);
  const days = datesBetween(start, addDays(start, 42));
  const { month: monthNumber } = parseDate(month);
  const weekdays = datesBetween(start, addDays(start, 7));
  return <div className="cal-mini" aria-label="Choose a date">
    <div className="cal-mini-head">
      <b aria-live="polite">{formatDay(month, { month: "long", year: "numeric" })}</b>
      <div>
        <button type="button" className="cal-icon-button" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={16}/></button>
        <button type="button" className="cal-icon-button" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={16}/></button>
      </div>
    </div>
    <div className="cal-mini-grid" role="group">
      {weekdays.map((date) => <span key={`h-${date}`} className="cal-mini-weekday" aria-hidden="true">{formatDay(date, { weekday: "narrow" })}</span>)}
      {days.map((date) => {
        const inMonth = parseDate(date).month === monthNumber;
        const inRange = date >= rangeFrom && date < rangeTo;
        return <button
          type="button"
          key={date}
          className={`cal-mini-day ${inMonth ? "" : "is-outside"} ${inRange ? "is-in-range" : ""} ${date === today ? "is-today" : ""} ${date === selected ? "is-selected" : ""}`}
          aria-label={formatDay(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          aria-current={date === today ? "date" : undefined}
          aria-pressed={date === selected}
          onClick={() => onSelect(date)}
        >{parseDate(date).day}</button>;
      })}
    </div>
  </div>;
}

/** "This event / All events" choice for recurring events. */
export function ScopeDialog({ action, onChoose, onClose, busy }: {
  action: "edit" | "delete"; onChoose: (scope: "occurrence" | "series") => void; onClose: () => void; busy: boolean;
}) {
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  return <CalPopover anchor={null} onClose={onClose} labelledBy="cal-scope-title" className="cal-scope">
    <form onSubmit={(event) => { event.preventDefault(); onChoose(scope); }}>
      <h2 id="cal-scope-title">{action === "edit" ? "Edit recurring event" : "Delete recurring event"}</h2>
      <fieldset>
        <legend className="sr-only">Apply to</legend>
        <label><input type="radio" name="cal-scope" checked={scope === "occurrence"} onChange={() => setScope("occurrence")} data-autofocus/> This event</label>
        <label><input type="radio" name="cal-scope" checked={scope === "series"} onChange={() => setScope("series")}/> All events</label>
      </fieldset>
      <div className="cal-popover-actions">
        <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={action === "delete" ? "cal-danger-button" : "editor-submit"} disabled={busy}>{busy ? <><span className="spinner"/> Working…</> : action === "edit" ? "Continue" : "Delete"}</button>
      </div>
    </form>
  </CalPopover>;
}
