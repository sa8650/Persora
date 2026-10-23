// Persora Calendar — smart scheduling pieces: conflict warnings, filters,
// the create menu, item type controls and the Reschedule dialog.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight, CalendarClock, CalendarPlus, Circle, CircleCheck, ListFilter, TriangleAlert } from "lucide-react";
import { CalPopover, rectOf } from "./CalendarParts";
import type { AnchorRect } from "./CalendarParts";
import { hiddenFilterCount, localDateOf, localTimeOf, normalizeCalendarFilters, zonedTimeToInstant, addDays, daysBetween } from "../../../cloudflare/calendar-rules.js";
import type { CalendarFilters, CalendarItemType, EventInput, FilterCategory, MoveTarget } from "../../../cloudflare/calendar-rules.js";
import { PagesApiError } from "../../lib/cloud";
import { checkCalendarConflicts } from "../../lib/calendar-api";
import type { CalendarConflict, CalendarEvent, CalendarInterval, ConflictIgnore, ConflictReport } from "../../lib/calendar-api";
import {
  CATEGORY_OPTIONS, DURATION_OPTIONS, ITEM_TYPE_OPTIONS, durationLabel, formatDay, formatTime, intervalLabel, itemNoun, targetLabel,
} from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

// ---------------------------------------------------------------------------
// Item type
// ---------------------------------------------------------------------------

export function ItemTypeIcon({ event, size = 12 }: { event: Pick<CalendarEvent, "itemType" | "completedAt">; size?: number }) {
  if (event.itemType === "task") return event.completedAt
    ? <CircleCheck size={size} className="cal-type-icon" aria-hidden="true"/>
    : <Circle size={size} className="cal-type-icon" aria-hidden="true"/>;
  if (event.itemType === "appointment") return <CalendarClock size={size} className="cal-type-icon" aria-hidden="true"/>;
  return null;
}

/** CSS classes for an item's type and state. */
export const itemClasses = (event: Pick<CalendarEvent, "itemType" | "completedAt">) =>
  `is-${event.itemType || "event"}${event.itemType === "task" && event.completedAt ? " is-done" : ""}`;

export function TypeTabs({ value, onChange, disabled = false, label = "Type" }: {
  value: CalendarItemType; onChange: (type: CalendarItemType) => void; disabled?: boolean; label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: ReactKeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + ITEM_TYPE_OPTIONS.length) % ITEM_TYPE_OPTIONS.length;
    onChange(ITEM_TYPE_OPTIONS[next].id);
    refs.current[next]?.focus();
  };
  return <div className="cal-type-tabs" role="radiogroup" aria-label={label}>
    {ITEM_TYPE_OPTIONS.map((option, index) => <button
      key={option.id} ref={(node) => { refs.current[index] = node; }} type="button" role="radio"
      aria-checked={value === option.id} tabIndex={value === option.id ? 0 : -1} disabled={disabled}
      className={value === option.id ? "is-active" : ""} onClick={() => onChange(option.id)} onKeyDown={(event) => onKey(event, index)}
    >{option.label}</button>)}
  </div>;
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export interface ConflictState { status: "idle" | "checking" | "ready" | "error"; report: ConflictReport | null; message: string | null }

/**
 * Live overlap check against saved items (debounced). Only timed items are
 * checked; a failed check never blocks saving.
 */
export function useConflictCheck(input: EventInput | null, options: { ignore?: ConflictIgnore | null; completed?: boolean; enabled: boolean }): ConflictState {
  const key = input && options.enabled && !input.allDay
    ? JSON.stringify([input.itemType, input.timeZone, input.start, input.end, input.recurrence, options.ignore || null, Boolean(options.completed)])
    : "";
  const [state, setState] = useState<ConflictState & { key: string }>({ key: "", status: "idle", report: null, message: null });
  const latest = useRef({ input, options });
  latest.current = { input, options };
  useEffect(() => {
    if (!key) { setState({ key: "", status: "idle", report: null, message: null }); return; }
    const controller = new AbortController();
    setState((current) => ({ ...current, key, status: "checking" }));
    const timer = window.setTimeout(() => {
      const { input: current, options: opts } = latest.current;
      if (!current) return;
      checkCalendarConflicts(current, { ignore: opts.ignore, completed: opts.completed, signal: controller.signal })
        .then((report) => setState({ key, status: "ready", report, message: null }))
        .catch((error) => {
          if (controller.signal.aborted) return;
          // 400 = the form isn't valid yet; the form shows that itself.
          const invalid = error instanceof PagesApiError && error.status === 400;
          setState({ key, status: invalid ? "idle" : "error", report: null, message: invalid ? null : "Couldn’t check for overlaps right now. You can still save." });
        });
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key]);
  return state;
}

function conflictTime(conflict: CalendarConflict, zone: string) {
  return intervalLabel(Date.parse(conflict.startAt), Date.parse(conflict.endAt), zone);
}
function slotLabel(slot: CalendarInterval, zone: string, referenceDate: string | null) {
  const startMs = Date.parse(slot.startAt); const endMs = Date.parse(slot.endAt);
  const sameDay = referenceDate && localDateOf(startMs, zone) === referenceDate;
  return sameDay ? `${formatTime(startMs, zone)} – ${formatTime(endMs, zone)}` : intervalLabel(startMs, endMs, zone);
}

function ConflictList({ conflicts, zone }: { conflicts: CalendarConflict[]; zone: string }) {
  return <ul className="cal-conflict-list">
    {conflicts.map((conflict) => <li key={`${conflict.eventId}:${conflict.startAt}:${conflict.candidate.startAt}`}>
      <span className={`cal-dot cal-cat-${conflict.category || "default"}`} aria-hidden="true"/>
      <b>{conflict.title}</b>
      <span>{conflict.itemType !== "event" ? `${conflict.itemType === "task" ? "Task" : "Appointment"} · ` : ""}{conflictTime(conflict, zone)}</span>
    </li>)}
  </ul>;
}

/** Inline warning in the create/edit forms. Warns only; never blocks. */
export function ConflictNotice({ state, zone, onPick }: { state: ConflictState; zone: string; onPick?: (slot: CalendarInterval) => void }) {
  const report = state.report;
  if (state.status === "error" && state.message) return <p className="cal-hint" role="status">{state.message}</p>;
  if (!report || !report.conflicts.length) {
    return state.status === "checking" ? <p className="cal-hint cal-conflict-checking" role="status">Checking your schedule…</p> : null;
  }
  const count = report.conflicts.length;
  const referenceDate = report.conflicts[0] ? localDateOf(Date.parse(report.conflicts[0].candidate.startAt), zone) : null;
  return <div className="cal-conflict" role="status" aria-live="polite">
    <p className="cal-conflict-head"><TriangleAlert size={14} aria-hidden="true"/>{count === 1 ? "Overlaps with 1 item" : `Overlaps with ${count} items`}{state.status === "checking" ? " · checking…" : ""}</p>
    <ConflictList conflicts={report.conflicts} zone={zone}/>
    {onPick && report.suggestions.length > 0 && <div className="cal-conflict-slots" role="group" aria-label="Free times nearby">
      <span>Free nearby:</span>
      {report.suggestions.map((slot) => <button type="button" key={slot.startAt} onClick={() => onPick(slot)}>{slotLabel(slot, zone, referenceDate)}</button>)}
    </div>}
    <small>You can still save. Overlaps are allowed.</small>
  </div>;
}

/** Shown after a drag/Reschedule lands on a busy time. */
export function ConflictDialog({ title, target, report, zone, busy, onKeep, onPick, onCancel }: {
  title: string; target: MoveTarget; report: ConflictReport; zone: string; busy: boolean;
  onKeep: () => void; onPick: (slot: CalendarInterval) => void; onCancel: () => void;
}) {
  const referenceDate = !target.allDay ? localDateOf(target.startMs, zone) : null;
  return <CalPopover anchor={null} onClose={busy ? () => undefined : onCancel} labelledBy="cal-conflict-title" className="cal-scope cal-conflict-dialog">
    <h2 id="cal-conflict-title">Time overlaps</h2>
    <p className="cal-hint">Moving “{title}” to {targetLabel(target, zone)} overlaps {report.conflicts.length === 1 ? "this item" : `these ${report.conflicts.length} items`}:</p>
    <ConflictList conflicts={report.conflicts} zone={zone}/>
    {report.suggestions.length > 0 && <div className="cal-conflict-slots" role="group" aria-label="Free times nearby">
      <span>Free nearby:</span>
      {report.suggestions.map((slot) => <button type="button" key={slot.startAt} onClick={() => onPick(slot)} disabled={busy}>{slotLabel(slot, zone, referenceDate)}</button>)}
    </div>}
    <div className="cal-popover-actions">
      <button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Keep original time</button>
      <button type="button" className="editor-submit" onClick={onKeep} disabled={busy} data-autofocus>{busy ? <><span className="spinner"/> Moving…</> : "Move anyway"}</button>
    </div>
  </CalPopover>;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const TYPE_FILTER_LABELS: Record<CalendarItemType, string> = { event: "Events", task: "Tasks", appointment: "Appointments" };
const CATEGORY_FILTERS: { id: FilterCategory; label: string }[] = [{ id: "default", label: "Default" }, ...CATEGORY_OPTIONS];

export function filterSummary(filters: CalendarFilters): string {
  const parts: string[] = [];
  const hiddenTypes = (Object.keys(filters.types) as CalendarItemType[]).filter((type) => !filters.types[type]).map((type) => TYPE_FILTER_LABELS[type]);
  if (hiddenTypes.length) parts.push(`${hiddenTypes.join(", ")} hidden`);
  const hiddenColors = CATEGORY_FILTERS.filter((entry) => !filters.categories[entry.id]).map((entry) => entry.label);
  if (hiddenColors.length) parts.push(hiddenColors.length <= 2 ? `${hiddenColors.join(", ")} color${hiddenColors.length === 1 ? "" : "s"} hidden` : `${hiddenColors.length} colors hidden`);
  if (!filters.completed && filters.types.task) parts.push("completed tasks hidden");
  return parts.join(" · ");
}

export type FilterSync = "local" | "saving" | "saved" | "offline";

export function FilterMenu({ filters, onChange, sync }: { filters: CalendarFilters; onChange: (filters: CalendarFilters) => void; sync: FilterSync }) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = hiddenFilterCount(filters);
  const set = (patch: Partial<CalendarFilters>) => onChange(normalizeCalendarFilters({ ...filters, ...patch }));
  const syncText = sync === "saving" ? "Saving…" : sync === "saved" ? "Saved to your account." : sync === "offline" ? "Saved on this device; couldn’t sync to your account." : "";
  return <>
    <button
      ref={buttonRef} type="button" className={`cal-icon-button cal-filter-button ${count ? "is-active" : ""}`}
      aria-haspopup="dialog" aria-expanded={open} aria-label={count ? `Filters, ${count} hidden` : "Filters"} title="Filter what’s shown"
      onClick={() => { setAnchor(rectOf(buttonRef.current)); setOpen((value) => !value); }}
    ><ListFilter size={17}/>{count > 0 && <span className="cal-badge" aria-hidden="true">{count}</span>}</button>
    {open && <CalPopover anchor={anchor} onClose={() => setOpen(false)} labelledBy="cal-filter-title" className="cal-filter-pop">
      <div className="cal-filter-head">
        <h2 id="cal-filter-title">Show</h2>
        <button type="button" className="cal-link-button" onClick={() => onChange(normalizeCalendarFilters({}))} disabled={!count}>Reset</button>
      </div>
      <fieldset className="cal-filter-group">
        <legend className="sr-only">Item types</legend>
        {(Object.keys(TYPE_FILTER_LABELS) as CalendarItemType[]).map((type, index) => <label key={type} className="cal-filter-option">
          <input type="checkbox" checked={filters.types[type]} onChange={(event) => set({ types: { ...filters.types, [type]: event.target.checked } })} data-autofocus={index === 0 ? true : undefined}/>
          <span>{TYPE_FILTER_LABELS[type]}</span>
        </label>)}
        <label className={`cal-filter-option cal-filter-sub ${filters.types.task ? "" : "is-disabled"}`}>
          <input type="checkbox" checked={filters.completed} disabled={!filters.types.task} onChange={(event) => set({ completed: event.target.checked })}/>
          <span>Completed tasks</span>
        </label>
      </fieldset>
      <fieldset className="cal-filter-group cal-filter-colors">
        <legend>Colors</legend>
        {CATEGORY_FILTERS.map((entry) => <label key={entry.id} className={`cal-filter-option cal-cat-${entry.id}`}>
          <input type="checkbox" checked={filters.categories[entry.id]} onChange={(event) => set({ categories: { ...filters.categories, [entry.id]: event.target.checked } })}/>
          <span className="cal-filter-swatch" aria-hidden="true"/><span>{entry.label}</span>
        </label>)}
      </fieldset>
      <p className="cal-hint">Filters only change what’s shown{syncText ? `. ${syncText}` : "."}</p>
    </CalPopover>}
  </>;
}

// ---------------------------------------------------------------------------
// Create menu (next to "New event")
// ---------------------------------------------------------------------------

export function CreateMenu({ onQuickAdd, onCreate, disabled }: {
  onQuickAdd: (text: string, anchor: AnchorRect | null) => void; onCreate: (type: CalendarItemType) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const value = text;
    setOpen(false); setText("");
    onQuickAdd(value, anchor);
  };
  return <>
    <button ref={buttonRef} type="button" className="cal-primary-button cal-split-toggle" aria-label="More create options" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
      onClick={() => { setAnchor(rectOf(buttonRef.current)); setOpen((value) => !value); }} title="Quick add, task or appointment">
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open && <CalPopover anchor={anchor} onClose={() => setOpen(false)} labelledBy="cal-create-title" className="cal-create-menu">
      <h2 id="cal-create-title" className="sr-only">Create</h2>
      <form onSubmit={submit} className="cal-quickadd">
        <input value={text} onChange={(event) => setText(event.target.value)} aria-label="Quick add" placeholder="Try “Dentist Friday at 4pm”" maxLength={300} data-autofocus aria-describedby="cal-quickadd-hint"/>
        <button type="submit" className="cal-icon-button" aria-label="Review quick add" disabled={!text.trim()}><ArrowRight size={16}/></button>
      </form>
      <p id="cal-quickadd-hint" className="cal-hint">Type a title with a day, time, repeat or reminder. You’ll review it before it’s saved.</p>
      <div className="cal-menu-items">
        <button type="button" onClick={() => { setOpen(false); onCreate("event"); }}><CalendarPlus size={16} aria-hidden="true"/>Create event</button>
        <button type="button" onClick={() => { setOpen(false); onCreate("task"); }}><CircleCheck size={16} aria-hidden="true"/>Create task</button>
        <button type="button" onClick={() => { setOpen(false); onCreate("appointment"); }}><CalendarClock size={16} aria-hidden="true"/>Schedule appointment</button>
      </div>
    </CalPopover>}
  </>;
}

// ---------------------------------------------------------------------------
// Reschedule (the keyboard/screen-reader alternative to dragging)
// ---------------------------------------------------------------------------

export function RescheduleDialog({ occurrence, zone, busy, onSave, onClose }: {
  occurrence: Occurrence; zone: string; busy: boolean; onSave: (target: MoveTarget) => void; onClose: () => void;
}) {
  const event = occurrence.event;
  const timed = !occurrence.allDay;
  const initialDuration = timed ? Math.max(5, Math.round(((occurrence.endMs as number) - (occurrence.startMs as number)) / 60000)) : 0;
  const spanDays = !timed ? Math.max(1, daysBetween(occurrence.startDate as string, occurrence.endDate as string)) : 1;
  const [date, setDate] = useState(timed ? localDateOf(occurrence.startMs as number, zone) : occurrence.startDate as string);
  const [time, setTime] = useState(timed ? localTimeOf(occurrence.startMs as number, zone) : "09:00");
  const [duration, setDuration] = useState(initialDuration);
  const [error, setError] = useState<string | null>(null);
  const durations = timed ? [...new Set([...DURATION_OPTIONS, initialDuration])].sort((a, b) => a - b) : [];
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!date) { setError("Choose a date."); return; }
    if (timed) {
      if (!time) { setError("Choose a start time."); return; }
      const startMs = zonedTimeToInstant(date, time, zone);
      onSave({ allDay: false, startMs, endMs: startMs + duration * 60000 });
    } else onSave({ allDay: true, startDate: date, endDate: addDays(date, spanDays) });
  };
  return <CalPopover anchor={null} onClose={busy ? () => undefined : onClose} labelledBy="cal-reschedule-title" className="cal-scope cal-reschedule">
    <form onSubmit={submit} noValidate>
      <h2 id="cal-reschedule-title">Reschedule {itemNoun(event.itemType)}</h2>
      <p className="cal-hint cal-reschedule-name">{event.title} · now {formatDay(timed ? localDateOf(occurrence.startMs as number, zone) : occurrence.startDate as string, { weekday: "short", month: "short", day: "numeric" })}{timed ? `, ${formatTime(occurrence.startMs as number, zone)}` : ""}</p>
      <div className="cal-reschedule-fields">
        <label className="field-label"><span>{timed ? "Date" : spanDays > 1 ? "Starts" : "Date"}</span>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(null); }} required data-autofocus/>
        </label>
        {timed && <label className="field-label"><span>Start time</span>
          <input type="time" value={time} step={300} onChange={(e) => { setTime(e.target.value); setError(null); }} required/>
        </label>}
        {timed && <label className="field-label"><span>Duration</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
          </select>
        </label>}
      </div>
      {timed && <p className="cal-hint">Times are in {zone.replace(/_/g, " ")}.</p>}
      {occurrence.recurring && <p className="cal-hint">Next, choose this occurrence or the whole series.</p>}
      {error && <p className="cal-field-error" role="alert">{error}</p>}
      <div className="cal-popover-actions">
        <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="editor-submit" disabled={busy}>{busy ? <><span className="spinner"/> Moving…</> : "Move"}</button>
      </div>
    </form>
  </CalPopover>;
}
