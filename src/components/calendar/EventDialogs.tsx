import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AlignLeft, Bell, CalendarDays, Clock, Mail, MapPin, Pencil, Repeat, Trash2, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import { CalPopover, CategoryDot } from "./CalendarParts";
import type { AnchorRect } from "./CalendarParts";
import { addDays, daysBetween, describeRecurrence, zonedTimeToInstant } from "../../../cloudflare/calendar-rules.js";
import type { CalendarCategory } from "../../../cloudflare/calendar-rules.js";
import type { CalendarEvent, CalendarMeta } from "../../lib/calendar-api";
import {
  CATEGORY_OPTIONS, REMINDER_OPTIONS, addMinutesToTime, draftError, formatDay, occurrenceDateLabel, occurrenceTimeLabel, reminderLabel,
} from "../../lib/calendar-view";
import type { EventDraft, Occurrence } from "../../lib/calendar-view";

// ---------------------------------------------------------------------------
// Event details
// ---------------------------------------------------------------------------

export function EventDetails({ occurrence, series, zone, anchor, busy, onEdit, onDelete, onClose }: {
  occurrence: Occurrence; series: CalendarEvent | null; zone: string; anchor: AnchorRect | null; busy: boolean;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const event = occurrence.event;
  const [confirming, setConfirming] = useState(false);
  const repeatText = occurrence.recurring && series ? describeRecurrence(series) : occurrence.recurring ? "Repeats" : null;
  const reminder = reminderLabel(event.reminderMinutes);
  return <CalPopover anchor={anchor} onClose={onClose} labelledBy="cal-details-title" className="cal-details">
    <div className="cal-popover-toolbar">
      <button type="button" className="cal-icon-button" onClick={onEdit} aria-label="Edit event" title="Edit" data-autofocus><Pencil size={16}/></button>
      <button type="button" className="cal-icon-button" onClick={() => (occurrence.recurring ? onDelete() : setConfirming(true))} aria-label="Delete event" title="Delete" disabled={busy}><Trash2 size={16}/></button>
      <button type="button" className="cal-icon-button" onClick={onClose} aria-label="Close"><X size={16}/></button>
    </div>
    <div className="cal-details-title">
      <CategoryDot category={event.category} className="cal-dot-lg"/>
      <div>
        <h2 id="cal-details-title">{event.title}</h2>
        <p>{occurrenceDateLabel(occurrence, zone)}<br/>{occurrenceTimeLabel(occurrence, zone)}</p>
      </div>
    </div>
    <ul className="cal-details-list">
      {repeatText && <li><Repeat size={15} aria-hidden="true"/><span>{repeatText}{occurrence.exception && <small> · this occurrence was changed</small>}</span></li>}
      {event.location && <li><MapPin size={15} aria-hidden="true"/><span>{event.location}</span></li>}
      {event.description && <li><AlignLeft size={15} aria-hidden="true"/><span className="cal-details-description">{event.description}</span></li>}
      {reminder && <li><Bell size={15} aria-hidden="true"/><span>{reminder}{event.reminderEmail ? " · in Persora and by email" : " · in Persora"}</span></li>}
      {event.allDay === false && event.timeZone !== zone && <li><Clock size={15} aria-hidden="true"/><span>Scheduled in {event.timeZone.replace(/_/g, " ")}</span></li>}
    </ul>
    {confirming && <div className="cal-confirm" role="alert">
      <span>Delete this event?</span>
      <div>
        <button type="button" className="quiet-button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
        <button type="button" className="cal-danger-button" onClick={onDelete} disabled={busy}>{busy ? <><span className="spinner"/> Deleting…</> : "Delete"}</button>
      </div>
    </div>}
  </CalPopover>;
}

// ---------------------------------------------------------------------------
// Quick create
// ---------------------------------------------------------------------------

export function QuickCreate({ draft, anchor, busy, error, onSave, onMore, onClose }: {
  draft: EventDraft; anchor: AnchorRect | null; busy: boolean; error: string | null;
  onSave: (title: string) => void; onMore: (title: string) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [touched, setTouched] = useState(false);
  const when = draft.allDay
    ? `${formatDay(draft.startDate, { weekday: "long", month: "long", day: "numeric" })} · All day`
    : `${formatDay(draft.startDate, { weekday: "long", month: "long", day: "numeric" })} · ${timeLabel(draft.startTime)} – ${timeLabel(draft.endTime)}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (title.trim()) onSave(title);
  };
  return <CalPopover anchor={anchor} onClose={onClose} labelledBy="cal-quick-title" className="cal-quick">
    <form onSubmit={submit} noValidate>
      <h2 id="cal-quick-title" className="sr-only">New event</h2>
      <input
        className="cal-quick-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add title" aria-label="Event title"
        maxLength={200} data-autofocus aria-invalid={touched && !title.trim()} aria-describedby="cal-quick-when"
      />
      <p id="cal-quick-when" className="cal-quick-when"><CalendarDays size={14} aria-hidden="true"/>{when}</p>
      {touched && !title.trim() && <p className="cal-field-error" role="alert">Add a title.</p>}
      {error && <p className="cal-field-error" role="alert">{error}</p>}
      <div className="cal-popover-actions">
        <button type="button" className="quiet-button" onClick={() => onMore(title)} disabled={busy}>More options</button>
        <button type="submit" className="editor-submit" disabled={busy}>{busy ? <><span className="spinner"/> Saving…</> : "Save"}</button>
      </div>
    </form>
  </CalPopover>;
}

function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h, m)));
}

// ---------------------------------------------------------------------------
// Full editor
// ---------------------------------------------------------------------------

type PermissionState = NotificationPermission | "unsupported";
const readPermission = (): PermissionState => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export function EventEditor({ mode, scope, initialDraft, displayZone, meta, busy, error, errorField, seriesHasChanges, onSave, onDelete, onClose }: {
  mode: "create" | "edit";
  scope: "occurrence" | "series" | null;
  initialDraft: EventDraft;
  displayZone: string;
  meta: CalendarMeta | null;
  busy: boolean;
  error: string | null;
  errorField: string | null;
  seriesHasChanges: boolean;
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EventDraft>(initialDraft);
  const [submitted, setSubmitted] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(readPermission);
  const titleRef = useRef<HTMLInputElement>(null);
  const local = submitted ? draftError(draft) : null;
  const fieldError = (field: string) => (local?.field === field ? local.message : errorField === field ? error : null);
  const allowRepeat = scope !== "occurrence";
  const emailAvailable = meta?.email.available ?? false;

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const update = (patch: Partial<EventDraft>) => setDraft((current) => ({ ...current, ...patch }));

  /** Moving the start keeps the duration, like other calendars. */
  const moveStart = (patch: { startDate?: string; startTime?: string }) => setDraft((current) => {
    const next = { ...current, ...patch };
    if (!next.startDate || !current.startDate) return next;
    if (current.allDay) {
      const days = current.endDate && current.endDate >= current.startDate ? daysBetween(current.startDate, current.endDate) : 0;
      return { ...next, endDate: addDays(next.startDate, days) };
    }
    if (!current.startTime || !current.endTime || !next.startTime || !current.endDate) return next;
    const duration = Math.round((zonedTimeToInstant(current.endDate, current.endTime, current.timeZone) - zonedTimeToInstant(current.startDate, current.startTime, current.timeZone)) / 60000);
    if (!(duration > 0)) return next;
    const end = addMinutesToTime(next.startDate, next.startTime, duration);
    return { ...next, endDate: end.date, endTime: end.time };
  });

  const toggleAllDay = (allDay: boolean) => setDraft((current) => {
    if (allDay) return { ...current, allDay, endDate: current.endDate < current.startDate ? current.startDate : current.endDate };
    const end = current.endDate === current.startDate && current.endTime <= current.startTime ? addMinutesToTime(current.startDate, current.startTime, 60) : { date: current.endDate, time: current.endTime };
    return { ...current, allDay, endDate: end.date, endTime: end.time };
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (draftError(draft)) return;
    onSave(draft);
  };

  const repeatSummary = useMemo(() => {
    if (!allowRepeat || draft.repeat === "none" || !draft.startDate) return null;
    try {
      return describeRecurrence({
        id: "draft", title: draft.title, allDay: draft.allDay, timeZone: draft.timeZone,
        startAt: null, endAt: null, startDate: draft.startDate, endDate: draft.startDate,
        recurrence: { freq: draft.repeat, interval: draft.interval || 1, until: draft.ends === "until" ? draft.until || null : null, count: draft.ends === "count" ? draft.count || null : null },
      });
    } catch { return null; }
  }, [allowRepeat, draft]);

  const unit = draft.repeat === "daily" ? "day" : draft.repeat === "weekly" ? "week" : "month";
  const title = mode === "create" ? "New event" : scope === "occurrence" ? "Edit this event" : scope === "series" ? "Edit all events" : "Edit event";

  return <ModalPortal>
    <ItemModalShell labelledBy="cal-editor-title" className="cal-editor" backdropClassName="cal-editor-backdrop" icon={<CalendarDays size={18}/>} iconClassName="tag-blue" eyebrow="Calendar" title={title} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={submit} noValidate>
        <div className="vault-modal-scroll">
          <div className="cal-form">
            <label className="field-label cal-field-wide"><span>Title<span className="required-star">*</span></span>
              <input ref={titleRef} value={draft.title} onChange={(event) => update({ title: event.target.value })} maxLength={200} placeholder="Add title" aria-invalid={Boolean(fieldError("title"))} aria-describedby={fieldError("title") ? "cal-err-title" : undefined}/>
              {fieldError("title") && <span id="cal-err-title" className="cal-field-error" role="alert">{fieldError("title")}</span>}
            </label>

            <div className="cal-field-wide cal-when">
              <label className="cal-switch"><input type="checkbox" checked={draft.allDay} onChange={(event) => toggleAllDay(event.target.checked)}/><span>All day</span></label>
              <div className="cal-when-row">
                <label className="field-label"><span>{draft.allDay ? "Starts" : "Start"}</span>
                  <input type="date" value={draft.startDate} onChange={(event) => moveStart({ startDate: event.target.value })} aria-invalid={Boolean(fieldError("start"))} required/>
                </label>
                {!draft.allDay && <label className="field-label cal-time-field"><span className="sr-only">Start time</span>
                  <input type="time" value={draft.startTime} onChange={(event) => moveStart({ startTime: event.target.value })} aria-label="Start time" step={300} required/>
                </label>}
              </div>
              <div className="cal-when-row">
                <label className="field-label"><span>{draft.allDay ? "Ends (inclusive)" : "End"}</span>
                  <input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => update({ endDate: event.target.value })} aria-invalid={Boolean(fieldError("end"))} aria-describedby={fieldError("end") ? "cal-err-end" : undefined} required/>
                </label>
                {!draft.allDay && <label className="field-label cal-time-field"><span className="sr-only">End time</span>
                  <input type="time" value={draft.endTime} onChange={(event) => update({ endTime: event.target.value })} aria-label="End time" step={300} aria-invalid={Boolean(fieldError("end"))} required/>
                </label>}
              </div>
              {(fieldError("start") || fieldError("end")) && <span id="cal-err-end" className="cal-field-error" role="alert">{fieldError("start") || fieldError("end")}</span>}
              {!draft.allDay && draft.timeZone !== displayZone && <p className="cal-hint"><Clock size={13} aria-hidden="true"/> Times are in {draft.timeZone.replace(/_/g, " ")}, the event’s time zone.</p>}
            </div>

            {allowRepeat && <div className="cal-field-wide cal-repeat">
              <div className="cal-inline-fields">
                <label className="field-label"><span>Repeat</span>
                  <select value={draft.repeat} onChange={(event) => update({ repeat: event.target.value as EventDraft["repeat"] })}>
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {draft.repeat !== "none" && <label className="field-label cal-narrow-field"><span>Every</span>
                  <span className="cal-input-suffix"><input type="number" min={1} max={99} value={draft.interval} onChange={(event) => update({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}/><span>{unit}{draft.interval === 1 ? "" : "s"}</span></span>
                </label>}
                {draft.repeat !== "none" && <label className="field-label"><span>Ends</span>
                  <select value={draft.ends} onChange={(event) => update({ ends: event.target.value as EventDraft["ends"], until: event.target.value === "until" && !draft.until ? addDays(draft.startDate, 30) : draft.until })}>
                    <option value="never">Never</option>
                    <option value="until">On date</option>
                    <option value="count">After a number of times</option>
                  </select>
                </label>}
                {draft.repeat !== "none" && draft.ends === "until" && <label className="field-label"><span>End date</span>
                  <input type="date" value={draft.until} min={draft.startDate} onChange={(event) => update({ until: event.target.value })} aria-invalid={Boolean(fieldError("recurrence"))}/>
                </label>}
                {draft.repeat !== "none" && draft.ends === "count" && <label className="field-label cal-narrow-field"><span>Occurrences</span>
                  <input type="number" min={1} max={999} value={draft.count} onChange={(event) => update({ count: Math.max(1, Math.min(999, Number(event.target.value) || 1)) })}/>
                </label>}
              </div>
              {repeatSummary && <p className="cal-hint"><Repeat size={13} aria-hidden="true"/> {repeatSummary}</p>}
              {fieldError("recurrence") && <span className="cal-field-error" role="alert">{fieldError("recurrence")}</span>}
              {scope === "series" && seriesHasChanges && <p className="cal-hint cal-hint-warn">Changing the start, time zone or repeat rule replaces changes made to single occurrences.</p>}
            </div>}

            <div className="cal-field-wide cal-reminder">
              <label className="field-label"><span>Reminder</span>
                <select value={draft.reminderMinutes === "" ? "" : String(draft.reminderMinutes)} onChange={(event) => update({ reminderMinutes: event.target.value === "" ? "" : Number(event.target.value) })}>
                  <option value="">No reminder</option>
                  {REMINDER_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
                </select>
              </label>
              {draft.reminderMinutes !== "" && <>
                <label className={`cal-switch ${emailAvailable ? "" : "is-disabled"}`}>
                  <input type="checkbox" checked={emailAvailable && draft.reminderEmail} disabled={!emailAvailable} onChange={(event) => update({ reminderEmail: event.target.checked })}/>
                  <span><Mail size={13} aria-hidden="true"/> Also email me</span>
                </label>
                {!emailAvailable && meta?.email.reason && <p className="cal-hint">{meta.email.reason}</p>}
                <NotificationStatus permission={permission} onRequest={async () => {
                  try { setPermission(await Notification.requestPermission()); } catch { setPermission(readPermission()); }
                }}/>
                {draft.allDay && <p className="cal-hint">Reminders for all-day events are timed from 9:00 AM on the day.</p>}
              </>}
            </div>

            <fieldset className="cal-field-wide cal-categories">
              <legend>Color</legend>
              <div role="radiogroup" aria-label="Category">
                <CategoryOption value="" current={draft.category} label="Default" onPick={(value) => update({ category: value })}/>
                {CATEGORY_OPTIONS.map((option) => <CategoryOption key={option.id} value={option.id} current={draft.category} label={option.label} onPick={(value) => update({ category: value })}/>)}
              </div>
            </fieldset>

            <label className="field-label cal-field-wide"><span>Location <small className="cal-optional">optional</small></span>
              <input value={draft.location} onChange={(event) => update({ location: event.target.value })} maxLength={300} placeholder="Add location"/>
            </label>
            <label className="field-label cal-field-wide"><span>Description <small className="cal-optional">optional</small></span>
              <textarea value={draft.description} onChange={(event) => update({ description: event.target.value })} maxLength={2000} rows={3} placeholder="Add notes"/>
            </label>
            {error && !errorField && <div className="form-alert error-alert cal-field-wide" role="alert">{error}</div>}
          </div>
        </div>
        <div className="editor-form-footer">
          {onDelete ? <button type="button" className="cal-text-danger" onClick={onDelete} disabled={busy}><Trash2 size={14}/> Delete</button> : <span/>}
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="editor-submit" disabled={busy}>{busy ? <><span className="spinner"/> Saving…</> : "Save"}</button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}

function CategoryOption({ value, current, label, onPick }: { value: CalendarCategory | ""; current: CalendarCategory | ""; label: string; onPick: (value: CalendarCategory | "") => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} className={`cal-swatch cal-cat-${value || "default"} ${selected ? "is-selected" : ""}`} onClick={() => onPick(value)} title={label}>
    <span aria-hidden="true"/><span className="cal-swatch-label">{label}</span>
  </button>;
}

export function NotificationStatus({ permission, onRequest }: { permission: PermissionState; onRequest: () => void }) {
  if (permission === "granted") return <p className="cal-hint">Desktop notifications are on for this browser.</p>;
  if (permission === "default") return <p className="cal-hint">Reminders appear in Persora’s notifications. <button type="button" className="cal-link-button" onClick={onRequest}>Allow desktop notifications</button></p>;
  if (permission === "denied") return <p className="cal-hint">Desktop notifications are blocked in this browser’s settings. Reminders still appear in Persora’s notifications.</p>;
  return <p className="cal-hint">This browser can’t show desktop notifications. Reminders still appear in Persora’s notifications.</p>;
}
