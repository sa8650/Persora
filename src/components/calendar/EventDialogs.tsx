import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AlignLeft, Bell, CalendarClock, CalendarDays, Circle, CircleCheck, Clock, Mail, MapPin, Pencil, Repeat, Trash2, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import { CalPopover, CategoryDot } from "./CalendarParts";
import type { AnchorRect } from "./CalendarParts";
import { ConflictNotice, ItemTypeIcon, TypeTabs, itemClasses, useConflictCheck } from "./SmartParts";
import { addDays, daysBetween, describeRecurrence, localDateOf, localTimeOf, zonedTimeToInstant } from "../../../cloudflare/calendar-rules.js";
import type { CalendarCategory, CalendarItemType } from "../../../cloudflare/calendar-rules.js";
import type { CalendarEvent, CalendarInterval, CalendarMeta, ConflictIgnore } from "../../lib/calendar-api";
import { parseQuickAdd, quickAddToInput, resolveQuickAdd } from "../../lib/calendar-nlp.js";
import type { QuickAddPatch, QuickAddQuestion } from "../../lib/calendar-nlp.js";
import {
  CATEGORY_OPTIONS, DEFAULT_DURATION, DURATION_OPTIONS, REMINDER_OPTIONS, WEEK_STARTS_ON, addMinutesToTime, draftDuration, draftError, draftFromInput, draftToInput,
  durationLabel, formatDay, itemNoun, moveDraftStart, newDraft, occurrenceDateLabel, occurrenceTimeLabel, reminderLabel, setDraftDuration, todayIn,
} from "../../lib/calendar-view";
import type { EventDraft, Occurrence } from "../../lib/calendar-view";

// ---------------------------------------------------------------------------
// Event details
// ---------------------------------------------------------------------------

export function EventDetails({ occurrence, series, zone, anchor, busy, onEdit, onDelete, onClose, onToggleComplete, onReschedule }: {
  occurrence: Occurrence; series: CalendarEvent | null; zone: string; anchor: AnchorRect | null; busy: boolean;
  onEdit: () => void; onDelete: () => void; onClose: () => void;
  onToggleComplete?: () => void; onReschedule?: () => void;
}) {
  const event = occurrence.event;
  const noun = itemNoun(event.itemType);
  const done = event.itemType === "task" && Boolean(event.completedAt);
  const [confirming, setConfirming] = useState(false);
  const repeatText = occurrence.recurring && series ? describeRecurrence(series) : occurrence.recurring ? "Repeats" : null;
  const reminder = reminderLabel(event.reminderMinutes);
  return <CalPopover anchor={anchor} onClose={onClose} labelledBy="cal-details-title" className="cal-details">
    <div className="cal-popover-toolbar">
      {onReschedule && <button type="button" className="cal-icon-button" onClick={onReschedule} aria-label={`Reschedule ${noun}`} title="Reschedule" disabled={busy}><CalendarClock size={16}/></button>}
      <button type="button" className="cal-icon-button" onClick={onEdit} aria-label={`Edit ${noun}`} title="Edit" data-autofocus><Pencil size={16}/></button>
      <button type="button" className="cal-icon-button" onClick={() => (occurrence.recurring ? onDelete() : setConfirming(true))} aria-label={`Delete ${noun}`} title="Delete" disabled={busy}><Trash2 size={16}/></button>
      <button type="button" className="cal-icon-button" onClick={onClose} aria-label="Close"><X size={16}/></button>
    </div>
    <div className={`cal-details-title ${itemClasses(event)}`}>
      <CategoryDot category={event.category} className="cal-dot-lg"/>
      <div>
        {event.itemType !== "event" && <span className={`cal-type-badge cal-cat-${event.category || "default"}`}><ItemTypeIcon event={event}/>{event.itemType === "task" ? (done ? "Task · done" : "Task") : "Appointment"}</span>}
        <h2 id="cal-details-title">{event.title}</h2>
        <p>{occurrenceDateLabel(occurrence, zone)}<br/>{event.itemType === "task" && occurrence.allDay ? "Due this day" : occurrenceTimeLabel(occurrence, zone)}</p>
      </div>
    </div>
    {event.itemType === "task" && onToggleComplete && <button type="button" className={`cal-complete-button ${done ? "is-done" : ""}`} onClick={onToggleComplete} disabled={busy} aria-pressed={done}>
      {busy ? <span className="spinner"/> : done ? <CircleCheck size={16} aria-hidden="true"/> : <Circle size={16} aria-hidden="true"/>}
      <span>{done ? "Completed" : "Mark complete"}</span>
      {done && <small>Reopen</small>}
    </button>}
    <ul className="cal-details-list">
      {repeatText && <li><Repeat size={15} aria-hidden="true"/><span>{repeatText}{occurrence.exception && <small> · this occurrence was changed</small>}</span></li>}
      {event.location && <li><MapPin size={15} aria-hidden="true"/><span>{event.location}</span></li>}
      {event.description && <li><AlignLeft size={15} aria-hidden="true"/><span className="cal-details-description">{event.description}</span></li>}
      {reminder && <li><Bell size={15} aria-hidden="true"/><span>{reminder}{event.reminderEmail ? " · in Persora and by email" : " · in Persora"}{done ? " · paused while complete" : ""}</span></li>}
      {done && event.completedAt && <li><CircleCheck size={15} aria-hidden="true"/><span>Completed {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(event.completedAt))}</span></li>}
      {event.allDay === false && event.timeZone !== zone && <li><Clock size={15} aria-hidden="true"/><span>Scheduled in {event.timeZone.replace(/_/g, " ")}</span></li>}
    </ul>
    {confirming && <div className="cal-confirm" role="alert">
      <span>Delete this {noun}?</span>
      <div>
        <button type="button" className="quiet-button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
        <button type="button" className="cal-danger-button" onClick={onDelete} disabled={busy}>{busy ? <><span className="spinner"/> Deleting…</> : "Delete"}</button>
      </div>
    </div>}
  </CalPopover>;
}

// ---------------------------------------------------------------------------
// Smart create (quick create with natural-language input)
// ---------------------------------------------------------------------------

const QUESTION_FIELDS: Record<string, string> = { startDate: "date", startTime: "time", endTime: "time", endDate: "time", allDay: "time", repeat: "repeat", reminderMinutes: "reminder" };

export interface SmartCreateContext { date: string; time: string | null; allDay: boolean }

/**
 * Quick create for events, tasks and appointments. The title box also reads
 * plain-language schedules ("Dentist Friday at 4pm, remind me 1 hour before")
 * with Persora's built-in rules — no AI service. Anything ambiguous becomes a
 * question; everything parsed is shown as editable fields before saving.
 */
export function SmartCreate({ zone, context, initialText = "", initialType = "event", typeLocked = false, anchor, busy, error, onSave, onMore, onClose }: {
  zone: string; context: SmartCreateContext | null; initialText?: string; initialType?: CalendarItemType; typeLocked?: boolean;
  anchor: AnchorRect | null; busy: boolean; error: string | null;
  onSave: (draft: EventDraft) => void; onMore: (draft: EventDraft) => void; onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [type, setType] = useState<CalendarItemType>(initialType);
  const [typeChosen, setTypeChosen] = useState(typeLocked || initialType !== "event");
  const [answers, setAnswers] = useState<Record<string, QuickAddPatch>>({});
  const [edits, setEdits] = useState<Partial<EventDraft>>({});
  const [submitted, setSubmitted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const result = useMemo(
    () => parseQuickAdd(text, { now: Date.now(), zone, context, itemType: typeChosen ? type : null, weekStartsOn: WEEK_STARTS_ON }),
    [text, zone, context, type, typeChosen],
  );
  const effectiveType: CalendarItemType = typeChosen ? type : result.itemType || type;
  const touched = useMemo(() => [...new Set(Object.keys(edits).map((key) => QUESTION_FIELDS[key]).filter(Boolean))], [edits]);
  const resolved = useMemo(() => resolveQuickAdd(result, { answers, touched, itemType: effectiveType }), [result, answers, touched, effectiveType]);
  const base = useMemo(() => {
    const input = quickAddToInput(resolved.fields, { zone });
    if (input) return draftFromInput(input, zone);
    const fallbackDate = resolved.fields.date || context?.date || todayIn(zone);
    return { ...newDraft(zone, fallbackDate, resolved.fields.startTime || context?.time || null, false, effectiveType), title: resolved.fields.title };
  }, [resolved, zone, context, effectiveType]);
  const draft: EventDraft = { ...base, ...edits, itemType: effectiveType, ...(effectiveType !== "event" ? { repeat: "none" as const } : {}) };
  if (edits.title === undefined) draft.title = result.title || (result.hasSchedule ? "" : text.trim());
  const open = resolved.open;
  const showPreview = Boolean(text.trim()) && (result.hasSchedule || open.length > 0 || !context || expanded || Object.keys(edits).length > 0);
  const local = submitted ? draftError(draft) : null;
  const canCheck = !open.length && !draftError(draft) && !draft.allDay;
  const conflictInput = useMemo(() => (canCheck ? draftToInput(draft, true) : null), [canCheck, JSON.stringify(draft)]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useConflictCheck(conflictInput, { enabled: canCheck });
  const noun = itemNoun(effectiveType);

  const changeText = (value: string) => { setText(value); setAnswers({}); setEdits({}); setSubmitted(false); };
  const edit = (patch: Partial<EventDraft>) => setEdits((current) => ({ ...current, ...patch }));
  const editStart = (patch: { startDate?: string; startTime?: string }) => {
    const moved = moveDraftStart(draft, patch);
    edit({ startDate: moved.startDate, startTime: moved.startTime, endDate: moved.endDate, endTime: moved.endTime });
  };
  const pickType = (next: CalendarItemType) => {
    setType(next); setTypeChosen(true); setAnswers({});
    setEdits((current) => { const { repeat: _repeat, ...rest } = current; void _repeat; return next === "appointment" ? { ...rest, allDay: false } : rest; });
  };
  const answer = (question: QuickAddQuestion, patch: QuickAddPatch) => {
    if (patch.itemType) { setType(patch.itemType); setTypeChosen(true); }
    setAnswers((current) => ({ ...current, [question.id]: patch }));
  };
  const pickSlot = (slot: CalendarInterval) => edit({ startDate: slot.start.date, startTime: slot.start.time, endDate: slot.end.date, endTime: slot.end.time, allDay: false });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (open.length || draftError(draft)) return;
    onSave(draft);
  };
  const when = draft.allDay
    ? `${formatDay(draft.startDate, { weekday: "long", month: "long", day: "numeric" })} · ${effectiveType === "task" ? "Due" : "All day"}`
    : `${formatDay(draft.startDate, { weekday: "long", month: "long", day: "numeric" })} · ${timeLabel(draft.startTime)} – ${timeLabel(draft.endTime)}`;
  const heading = effectiveType === "task" ? "New task" : effectiveType === "appointment" ? "New appointment" : "New event";

  return <CalPopover anchor={anchor} onClose={onClose} labelledBy="cal-quick-title" className={`cal-quick ${showPreview ? "is-expanded" : ""}`}>
    <form onSubmit={submit} noValidate>
      <h2 id="cal-quick-title" className="sr-only">{heading}</h2>
      {!typeLocked && <TypeTabs value={effectiveType} onChange={pickType} label="Item type"/>}
      <input
        className="cal-quick-input" value={text} onChange={(event) => changeText(event.target.value)}
        placeholder={context ? "Add title, or “Lunch at 1pm”" : "e.g. Dentist Friday at 4pm"} aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} title`}
        maxLength={300} data-autofocus aria-invalid={submitted && !draft.title.trim()} aria-describedby="cal-quick-when"
      />
      {!showPreview && <p id="cal-quick-when" className="cal-quick-when"><CalendarDays size={14} aria-hidden="true"/>{when}</p>}
      {showPreview && <p id="cal-quick-when" className="sr-only">Review the details below before saving.</p>}

      {open.length > 0 && <div className="cal-questions">
        {open.map((question) => <div key={question.id} className="cal-question" role="group" aria-label={question.message}>
          <p>{question.message}</p>
          {question.options.length > 0 && <div className="cal-question-options">
            {question.options.map((option) => <button type="button" key={option.label} onClick={() => answer(question, option.patch)}>{option.label}</button>)}
          </div>}
        </div>)}
      </div>}

      {showPreview && <div className="cal-smart-preview" aria-label="Preview">
        <label className="field-label cal-preview-wide"><span>Title</span>
          <input value={draft.title} onChange={(event) => edit({ title: event.target.value })} maxLength={200} aria-invalid={local?.field === "title"}/>
        </label>
        <label className="field-label"><span>{effectiveType === "task" && draft.allDay ? "Due date" : "Date"}</span>
          <input type="date" value={draft.startDate} onChange={(event) => editStart({ startDate: event.target.value })}/>
        </label>
        {effectiveType !== "appointment" && <label className="cal-switch cal-preview-allday"><input type="checkbox" checked={draft.allDay}
          onChange={(event) => {
            if (event.target.checked) { edit({ allDay: true, endDate: draft.startDate }); return; }
            const timed = setDraftDuration({ ...draft, allDay: false }, DEFAULT_DURATION[effectiveType]);
            edit({ allDay: false, endDate: timed.endDate, endTime: timed.endTime });
          }}/>
          <span>{effectiveType === "task" ? "No set time" : "All day"}</span></label>}
        {!draft.allDay && <>
          <label className="field-label"><span>Start</span>
            <input type="time" step={300} value={draft.startTime} onChange={(event) => editStart({ startTime: event.target.value })}/>
          </label>
          <label className="field-label"><span>End</span>
            <input type="time" step={300} value={draft.endTime} onChange={(event) => {
              const endTime = event.target.value;
              edit({ endTime, endDate: endTime <= draft.startTime ? addDays(draft.startDate, 1) : draft.startDate });
            }}/>
          </label>
        </>}
        {effectiveType === "event" && <label className="field-label"><span>Repeat</span>
          <select value={draft.repeat} onChange={(event) => edit({ repeat: event.target.value as EventDraft["repeat"] })}>
            <option value="none">Does not repeat</option>
            <option value="daily">{draft.interval > 1 && draft.repeat === "daily" ? `Every ${draft.interval} days` : "Daily"}</option>
            <option value="weekly">{draft.interval > 1 && draft.repeat === "weekly" ? `Every ${draft.interval} weeks` : "Weekly"}</option>
            <option value="monthly">{draft.interval > 1 && draft.repeat === "monthly" ? `Every ${draft.interval} months` : "Monthly"}</option>
          </select>
        </label>}
        <label className="field-label"><span>Reminder</span>
          <select value={draft.reminderMinutes === "" ? "" : String(draft.reminderMinutes)} onChange={(event) => edit({ reminderMinutes: event.target.value === "" ? "" : Number(event.target.value) })}>
            <option value="">None</option>
            {REMINDER_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
          </select>
        </label>
        {draft.repeat !== "none" && effectiveType === "event" && (draft.ends === "until" || draft.ends === "count") && <p className="cal-hint cal-preview-wide"><Repeat size={13} aria-hidden="true"/>{draft.ends === "until" ? `Until ${formatDay(draft.until, { month: "short", day: "numeric", year: "numeric" })}` : `${draft.count} times`}</p>}
      </div>}

      {context && !showPreview && text.trim() && <button type="button" className="cal-link-button cal-preview-toggle" onClick={() => setExpanded(true)}>Edit details</button>}
      <ConflictNotice state={conflicts} zone={zone} onPick={draft.repeat === "none" ? pickSlot : undefined}/>
      {submitted && !draft.title.trim() && <p className="cal-field-error" role="alert">Add a title.</p>}
      {local && local.field !== "title" && <p className="cal-field-error" role="alert">{local.message}</p>}
      {submitted && open.length > 0 && <p className="cal-field-error" role="alert">Answer the question{open.length > 1 ? "s" : ""} above first.</p>}
      {error && <p className="cal-field-error" role="alert">{error}</p>}
      <div className="cal-popover-actions">
        <button type="button" className="quiet-button" onClick={() => onMore(draft)} disabled={busy}>More options</button>
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

export function EventEditor({ mode, scope, initialDraft, displayZone, meta, busy, error, errorField, seriesHasChanges, onSave, onDelete, onClose, initialCompleted = false, conflictIgnore = null }: {
  mode: "create" | "edit";
  scope: "occurrence" | "series" | null;
  initialDraft: EventDraft;
  displayZone: string;
  meta: CalendarMeta | null;
  busy: boolean;
  error: string | null;
  errorField: string | null;
  seriesHasChanges: boolean;
  onSave: (draft: EventDraft, extra: { completed: boolean }) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Tasks: completion when the editor opened. */
  initialCompleted?: boolean;
  /** What the overlap check should skip (the item itself). */
  conflictIgnore?: ConflictIgnore | null;
}) {
  const [draft, setDraft] = useState<EventDraft>(initialDraft);
  const [completed, setCompleted] = useState(initialCompleted);
  const [submitted, setSubmitted] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(readPermission);
  const titleRef = useRef<HTMLInputElement>(null);
  const local = submitted ? draftError(draft) : null;
  const fieldError = (field: string) => (local?.field === field ? local.message : errorField === field ? error : null);
  const allowRepeat = scope !== "occurrence" && draft.itemType === "event";
  const noun = itemNoun(draft.itemType);
  const timedOnly = draft.itemType === "appointment";
  const durationMode = draft.itemType !== "event";
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
    if (allDay) return { ...current, allDay, endDate: current.itemType === "task" || current.endDate < current.startDate ? current.startDate : current.endDate };
    const end = (current.endDate === current.startDate && current.endTime <= current.startTime) || current.itemType !== "event"
      ? addMinutesToTime(current.startDate, current.startTime, DEFAULT_DURATION[current.itemType]) : { date: current.endDate, time: current.endTime };
    return { ...current, allDay, endDate: end.date, endTime: end.time };
  });

  const changeType = (next: CalendarItemType) => setDraft((current) => {
    let updated: EventDraft = { ...current, itemType: next, repeat: next === "event" ? current.repeat : "none" };
    if (next === "appointment" && current.allDay) updated = setDraftDuration({ ...updated, allDay: false }, DEFAULT_DURATION.appointment);
    else if (!current.allDay && draftDuration(current) === DEFAULT_DURATION[current.itemType]) updated = setDraftDuration(updated, DEFAULT_DURATION[next]);
    return updated;
  });

  // Live overlap warning (timed items only; never blocks saving).
  const valid = !draftError(draft);
  const conflictInput = useMemo(() => (valid && !draft.allDay ? draftToInput(draft, allowRepeat) : null), [valid, JSON.stringify(draft), allowRepeat]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useConflictCheck(conflictInput, { ignore: conflictIgnore, completed: draft.itemType === "task" && completed, enabled: valid && !draft.allDay });
  const pickSlot = (slot: CalendarInterval) => {
    const startMs = Date.parse(slot.startAt); const endMs = Date.parse(slot.endAt);
    update({ startDate: localDateOf(startMs, draft.timeZone), startTime: localTimeOf(startMs, draft.timeZone), endDate: localDateOf(endMs, draft.timeZone), endTime: localTimeOf(endMs, draft.timeZone) });
  };
  const duration = draftDuration(draft);
  const durations = [...new Set([...DURATION_OPTIONS, ...(duration > 0 ? [duration] : [])])].sort((a, b) => a - b);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (draftError(draft)) return;
    onSave(draft, { completed });
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
  const title = mode === "create" ? `New ${noun}` : scope === "occurrence" ? `Edit this ${noun}` : scope === "series" ? `Edit all ${noun}s` : `Edit ${noun}`;
  const Icon = draft.itemType === "task" ? CircleCheck : draft.itemType === "appointment" ? CalendarClock : CalendarDays;

  return <ModalPortal>
    <ItemModalShell labelledBy="cal-editor-title" className="cal-editor" backdropClassName="cal-editor-backdrop" icon={<Icon size={18}/>} iconClassName="tag-blue" eyebrow="Calendar" title={title} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={submit} noValidate>
        <div className="vault-modal-scroll">
          <div className="cal-form">
            {mode === "create" && <TypeTabs value={draft.itemType} onChange={changeType} label="Item type"/>}
            <label className="field-label cal-field-wide"><span>Title<span className="required-star">*</span></span>
              <input ref={titleRef} value={draft.title} onChange={(event) => update({ title: event.target.value })} maxLength={200} placeholder="Add title" aria-invalid={Boolean(fieldError("title"))} aria-describedby={fieldError("title") ? "cal-err-title" : undefined}/>
              {fieldError("title") && <span id="cal-err-title" className="cal-field-error" role="alert">{fieldError("title")}</span>}
            </label>
            {draft.itemType === "task" && mode === "edit" && <label className="cal-switch"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)}/><span>Completed</span></label>}

            {durationMode ? <div className="cal-field-wide cal-when">
              {!timedOnly && <label className="cal-switch"><input type="checkbox" checked={draft.allDay} onChange={(event) => toggleAllDay(event.target.checked)}/><span>No set time (due date only)</span></label>}
              <div className="cal-when-row">
                <label className="field-label"><span>{draft.allDay ? "Due date" : "Date"}</span>
                  <input type="date" value={draft.startDate} onChange={(event) => moveStart({ startDate: event.target.value })} aria-invalid={Boolean(fieldError("start"))} required/>
                </label>
                {!draft.allDay && <label className="field-label cal-time-field"><span>Time</span>
                  <input type="time" value={draft.startTime} onChange={(event) => moveStart({ startTime: event.target.value })} aria-label="Start time" step={300} required/>
                </label>}
              </div>
              {!draft.allDay && <label className="field-label"><span>Duration</span>
                <select value={duration > 0 ? duration : ""} onChange={(event) => setDraft((current) => setDraftDuration(current, Number(event.target.value)))} aria-invalid={Boolean(fieldError("end"))}>
                  {duration <= 0 && <option value="">Choose</option>}
                  {durations.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
                </select>
              </label>}
              {(fieldError("start") || fieldError("end")) && <span id="cal-err-end" className="cal-field-error" role="alert">{fieldError("start") || fieldError("end")}</span>}
              {!draft.allDay && draft.timeZone !== displayZone && <p className="cal-hint"><Clock size={13} aria-hidden="true"/> Times are in {draft.timeZone.replace(/_/g, " ")}, the {noun}’s time zone.</p>}
              <ConflictNotice state={conflicts} zone={displayZone} onPick={pickSlot}/>
            </div> : <div className="cal-field-wide cal-when">
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
              <ConflictNotice state={conflicts} zone={displayZone} onPick={draft.repeat === "none" || !allowRepeat ? pickSlot : undefined}/>
            </div>}

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
                {draft.allDay && <p className="cal-hint">Reminders for all-day {noun}s are timed from 9:00 AM on the day.</p>}
                {draft.itemType === "task" && completed && <p className="cal-hint">Reminders pause while the task is complete.</p>}
              </>}
            </div>

            <fieldset className="cal-field-wide cal-categories">
              <legend>Color</legend>
              <div role="radiogroup" aria-label="Category">
                <CategoryOption value="" current={draft.category} label="Default" onPick={(value) => update({ category: value })}/>
                {CATEGORY_OPTIONS.map((option) => <CategoryOption key={option.id} value={option.id} current={draft.category} label={option.label} onPick={(value) => update({ category: value })}/>)}
              </div>
            </fieldset>

            {draft.itemType !== "task" && <label className="field-label cal-field-wide"><span>Location <small className="cal-optional">optional</small></span>
              <input value={draft.location} onChange={(event) => update({ location: event.target.value })} maxLength={300} placeholder="Add location"/>
            </label>}
            <label className="field-label cal-field-wide"><span>{draft.itemType === "appointment" ? "Notes" : "Description"} <small className="cal-optional">optional</small></span>
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
