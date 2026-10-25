// Habit Tracker — create / edit dialog (Persora's shared item-modal shell).
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Archive, ArchiveRestore, BellRing, Check, Repeat, Trash2 } from "lucide-react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import {
  HABIT_CATEGORIES, HABIT_COLORS, HABIT_ICONS, HABIT_LIMITS, HabitValidationError, REPETITION_MAX, WEEK_STARTS_ON, isRepetitionHabit, isRepetitionUnit,
  normalizeHabitInput, sameSchedule,
} from "../../../cloudflare/habit-rules.js";
import type { HabitColor, HabitFrequency, HabitIcon, HabitInput, HabitTracking } from "../../../cloudflare/habit-rules.js";
import { maxDate, startOfWeek } from "../../../cloudflare/calendar-rules.js";
import type { Habit } from "../../lib/habit-api";
import {
  CATEGORY_LABELS, HABIT_COLOR_LABELS, HABIT_ICON_COMPONENTS, HABIT_ICON_LABELS, WEEKDAY_LETTER, WEEKDAY_LONG, formatDay,
} from "./habit-visuals";

type TrackingMode = "check" | "repetitions" | "measurement";
const TRACKING_MODES: readonly (readonly [TrackingMode, string])[] = [["check", "Checkbox"], ["repetitions", "Repetitions"], ["measurement", "Measurement"]];

interface Draft {
  name: string;
  description: string;
  icon: HabitIcon;
  color: HabitColor;
  category: string;
  frequency: HabitFrequency;
  weekdays: number[];
  weeklyTarget: string;
  tracking: HabitTracking;
  /** UI choice; repetitions and measurements are both stored as tracking "numeric". */
  mode: TrackingMode;
  targetValue: string;
  unit: string;
  startDate: string;
  reminderOn: boolean;
  reminderTime: string;
  reminderEmail: boolean;
}

function draftFrom(habit: Habit | null, today: string): Draft {
  if (!habit) {
    return {
      name: "", description: "", icon: "check", color: "blue", category: "", frequency: "daily", weekdays: [1, 2, 3, 4, 5], weeklyTarget: "3",
      tracking: "check", mode: "check", targetValue: "", unit: "", startDate: today, reminderOn: false, reminderTime: "08:00", reminderEmail: false,
    };
  }
  return {
    name: habit.name, description: habit.description, icon: habit.icon, color: habit.color, category: habit.category || "",
    frequency: habit.frequency, weekdays: habit.frequency === "weekdays" ? habit.weekdays : [1, 2, 3, 4, 5],
    weeklyTarget: String(habit.weeklyTarget ?? 3), tracking: habit.tracking,
    mode: habit.tracking === "check" ? "check" : isRepetitionHabit(habit) ? "repetitions" : "measurement",
    targetValue: habit.targetValue === null ? "" : String(habit.targetValue), unit: habit.unit, startDate: habit.startDate,
    reminderOn: Boolean(habit.reminderTime), reminderTime: habit.reminderTime || "08:00", reminderEmail: habit.reminderEmail,
  };
}

function draftInput(draft: Draft): Record<string, unknown> {
  // Repetitions keep a counting unit ("times" unless the habit already used e.g. "reps").
  const unit = draft.mode === "repetitions" ? (draft.unit.trim() && isRepetitionUnit(draft.unit) ? draft.unit.trim() : "times") : draft.unit;
  return {
    name: draft.name, description: draft.description, icon: draft.icon, color: draft.color, category: draft.category || null,
    frequency: draft.frequency, weekdays: draft.weekdays, weeklyTarget: draft.weeklyTarget === "" ? null : Number(draft.weeklyTarget),
    tracking: draft.tracking, targetValue: draft.targetValue === "" ? null : Number(draft.targetValue), unit,
    startDate: draft.startDate, reminderTime: draft.reminderOn ? draft.reminderTime : null, reminderEmail: draft.reminderOn && draft.reminderEmail,
  };
}

function validate(draft: Draft, today: string): { input: HabitInput | null; error: HabitValidationError | null } {
  try {
    const input = normalizeHabitInput(draftInput(draft), { today });
    // The mode is derived from the saved values, so keep each choice unambiguous on reload.
    if (draft.mode === "repetitions" && !isRepetitionHabit(input)) {
      throw new HabitValidationError(`Enter a whole number of repetitions from 1 to ${REPETITION_MAX}.`, "targetValue");
    }
    if (draft.mode === "measurement" && isRepetitionHabit(input)) {
      throw new HabitValidationError(draft.unit.trim() ? `“${draft.unit.trim()}” counts repetitions — choose Repetitions instead, or use a unit like km or minutes.` : "Add a unit for this measurement, like km, minutes or glasses.", "unit");
    }
    return { input, error: null };
  }
  catch (error) { return { input: null, error: error instanceof HabitValidationError ? error : new HabitValidationError("Check the habit details.") }; }
}

type Permission = NotificationPermission | "unsupported";
const readPermission = (): Permission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export interface HabitEditorProps {
  habit: Habit | null;
  today: string;
  email: { available: boolean; reason: string | null };
  busy: boolean;
  error: { message: string; field?: string } | null;
  onSave: (input: HabitInput) => void;
  onClose: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}

export default function HabitEditor({ habit, today, email, busy, error, onSave, onClose, onArchive, onRestore, onDelete }: HabitEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(habit, today));
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [permission, setPermission] = useState<Permission>(readPermission);
  const nameRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      if (confirmDelete) setConfirmDelete(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, confirmDelete, onClose]);

  const { input, error: localError } = useMemo(() => validate(draft, today), [draft, today]);
  const fieldError = (field: string) => {
    if (error?.field === field) return error.message;
    if (submitted && localError?.field === field) return localError.message;
    return null;
  };
  const generalError = (error && !error.field ? error.message : null)
    || (submitted && localError && !localError.field ? localError.message : null);

  const scheduleChanged = Boolean(habit && input && !sameSchedule(habit, input));
  const effectiveFrom = input ? maxDate(input.startDate, startOfWeek(today, WEEK_STARTS_ON)) : today;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!input) {
      const field = localError?.field;
      if (field) document.getElementById(`hb-field-${field}`)?.focus();
      return;
    }
    onSave(input);
  };

  const requestPermission = async () => {
    try { setPermission(await Notification.requestPermission()); } catch { setPermission("unsupported"); }
  };

  const toggleWeekday = (day: number) => update({
    weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((entry) => entry !== day) : [...draft.weekdays, day].sort((a, b) => a - b),
  });
  const SelectedIcon = HABIT_ICON_COMPONENTS[draft.icon];
  const archived = Boolean(habit?.archivedAt);
  const checkinCount = habit ? habit.completedDates.length : 0;

  return <ModalPortal>
    <ItemModalShell
      labelledBy="hb-editor-title" className="hb-editor" backdropClassName="hb-editor-backdrop"
      icon={<SelectedIcon size={18}/>} iconClassName={`hb-modal-icon hb-c-${draft.color}`} eyebrow="Habit Tracker"
      title={habit ? "Edit habit" : "New habit"} onClose={onClose} closeDisabled={busy} dismissable={!busy && !confirmDelete}
    >
      <form className="editor-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="vault-modal-scroll">
          <div className="hb-form">
            {archived && <p className="hb-note" role="status"><Archive size={14} aria-hidden="true"/> This habit is archived. Its history is kept; restore it to track it again.</p>}
            <label className="field-label"><span>Name<span className="required-star">*</span></span>
              <input id="hb-field-name" ref={nameRef} value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={HABIT_LIMITS.name}
                placeholder="e.g. Drink water" aria-invalid={Boolean(fieldError("name"))} aria-describedby={fieldError("name") ? "hb-err-name" : undefined} autoComplete="off"/>
              {fieldError("name") && <span id="hb-err-name" className="hb-field-error" role="alert">{fieldError("name")}</span>}
            </label>
            <label className="field-label"><span>Description <small className="hb-optional">optional</small></span>
              <textarea id="hb-field-description" rows={2} value={draft.description} onChange={(event) => update({ description: event.target.value })} maxLength={HABIT_LIMITS.description} placeholder="Why it matters, or how you'll do it"/>
              {fieldError("description") && <span className="hb-field-error" role="alert">{fieldError("description")}</span>}
            </label>

            <fieldset className="hb-fieldset">
              <legend>Icon</legend>
              <div className={`hb-icon-grid hb-c-${draft.color}`} role="radiogroup" aria-label="Icon">
                {HABIT_ICONS.map((key) => {
                  const Icon = HABIT_ICON_COMPONENTS[key];
                  const selected = draft.icon === key;
                  return <button key={key} type="button" role="radio" aria-checked={selected} aria-label={HABIT_ICON_LABELS[key]} title={HABIT_ICON_LABELS[key]}
                    className={`hb-icon-option ${selected ? "is-selected" : ""}`} onClick={() => update({ icon: key })}><Icon size={17}/></button>;
                })}
              </div>
            </fieldset>
            <fieldset className="hb-fieldset">
              <legend>Colour</legend>
              <div className="hb-swatches" role="radiogroup" aria-label="Colour">
                {HABIT_COLORS.map((key) => <button key={key} type="button" role="radio" aria-checked={draft.color === key} aria-label={HABIT_COLOR_LABELS[key]} title={HABIT_COLOR_LABELS[key]}
                  className={`hb-swatch hb-c-${key} ${draft.color === key ? "is-selected" : ""}`} onClick={() => update({ color: key })}>{draft.color === key && <Check size={13} strokeWidth={3}/>}</button>)}
              </div>
            </fieldset>
            <label className="field-label"><span>Category <small className="hb-optional">optional</small></span>
              <select id="hb-field-category" value={draft.category} onChange={(event) => update({ category: event.target.value })}>
                <option value="">No category</option>
                {HABIT_CATEGORIES.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
              </select>
            </label>

            <fieldset className="hb-fieldset">
              <legend>How often</legend>
              <div className="hb-segment" role="radiogroup" aria-label="How often">
                {([["daily", "Every day"], ["weekdays", "Specific days"], ["weekly", "Times per week"]] as const).map(([key, label]) =>
                  <button key={key} type="button" role="radio" aria-checked={draft.frequency === key} className={draft.frequency === key ? "is-active" : ""} onClick={() => update({ frequency: key })}>{label}</button>)}
              </div>
              {draft.frequency === "weekdays" && <div className="hb-weekdays" role="group" aria-label="Days of the week">
                {WEEKDAY_LETTER.map((letter, day) => <button key={day} id={day === 0 ? "hb-field-weekdays" : undefined} type="button" aria-pressed={draft.weekdays.includes(day)} aria-label={WEEKDAY_LONG[day]} title={WEEKDAY_LONG[day]}
                  className={draft.weekdays.includes(day) ? "is-active" : ""} onClick={() => toggleWeekday(day)}>{letter}</button>)}
              </div>}
              {draft.frequency === "weekly" && <label className="hb-inline-field">
                <input id="hb-field-weeklyTarget" type="number" inputMode="numeric" min={1} max={7} step={1} value={draft.weeklyTarget} onChange={(event) => update({ weeklyTarget: event.target.value })} aria-label="Times per week" aria-invalid={Boolean(fieldError("weeklyTarget"))}/>
                <span>times per week</span>
              </label>}
              {(fieldError("frequency") || fieldError("weekdays") || fieldError("weeklyTarget")) && <span className="hb-field-error" role="alert">{fieldError("frequency") || fieldError("weekdays") || fieldError("weeklyTarget")}</span>}
              {scheduleChanged && <p className="hb-hint"><Repeat size={13} aria-hidden="true"/> The new schedule applies from {formatDay(effectiveFrom, { weekday: "short", month: "short", day: "numeric" })}. Earlier weeks keep their schedule, so past stats don't change.</p>}
            </fieldset>

            <fieldset className="hb-fieldset">
              <legend>Tracking</legend>
              <div className="hb-segment" role="radiogroup" aria-label="Tracking">
                {TRACKING_MODES.map(([key, label]) =>
                  <button key={key} type="button" role="radio" aria-checked={draft.mode === key} className={draft.mode === key ? "is-active" : ""} onClick={() => update({
                    mode: key, tracking: key === "check" ? "check" : "numeric",
                    // Don't carry a counting unit into a measurement (or a measurement unit into repetitions).
                    unit: key === "measurement" && isRepetitionUnit(draft.unit) ? "" : key === "repetitions" && !isRepetitionUnit(draft.unit) ? "" : draft.unit,
                  })}>{label}</button>)}
              </div>
              {draft.mode === "repetitions" && <div className="hb-target-row">
                <label className="field-label"><span>Repetitions per day</span>
                  <input id="hb-field-targetValue" type="number" inputMode="numeric" min={1} max={REPETITION_MAX} step={1} value={draft.targetValue} onChange={(event) => update({ targetValue: event.target.value })} placeholder="5" aria-invalid={Boolean(fieldError("targetValue"))}/>
                </label>
                <p className="hb-hint hb-target-hint">Each day shows this many checkboxes to tick off one by one.</p>
              </div>}
              {draft.mode === "measurement" && <div className="hb-target-row">
                <label className="field-label"><span>Daily target</span>
                  <input id="hb-field-targetValue" type="number" inputMode="decimal" min={0.01} step="any" value={draft.targetValue} onChange={(event) => update({ targetValue: event.target.value })} placeholder="8" aria-invalid={Boolean(fieldError("targetValue"))}/>
                </label>
                <label className="field-label"><span>Unit</span>
                  <input id="hb-field-unit" value={draft.unit} onChange={(event) => update({ unit: event.target.value })} maxLength={HABIT_LIMITS.unit} placeholder="km, minutes, glasses" aria-invalid={Boolean(fieldError("unit"))}/>
                </label>
              </div>}
              {(fieldError("targetValue") || fieldError("unit") || fieldError("tracking")) && <span className="hb-field-error" role="alert">{fieldError("targetValue") || fieldError("unit") || fieldError("tracking")}</span>}
              {habit && habit.tracking === "numeric" && draft.tracking === "numeric" && input && input.targetValue !== habit.targetValue && <p className="hb-hint">Past days keep the target they were recorded with.</p>}
            </fieldset>

            <label className="field-label"><span>Start date</span>
              <input id="hb-field-startDate" type="date" value={draft.startDate} onChange={(event) => update({ startDate: event.target.value })} aria-invalid={Boolean(fieldError("startDate"))}/>
              {fieldError("startDate") && <span className="hb-field-error" role="alert">{fieldError("startDate")}</span>}
            </label>

            <fieldset className="hb-fieldset hb-reminder">
              <legend>Reminder</legend>
              <label className="hb-switch"><input type="checkbox" checked={draft.reminderOn} onChange={(event) => update({ reminderOn: event.target.checked })}/><span>Remind me on scheduled days</span></label>
              {draft.reminderOn && <>
                <label className="hb-inline-field"><span>at</span>
                  <input id="hb-field-reminderTime" type="time" value={draft.reminderTime} onChange={(event) => update({ reminderTime: event.target.value })} aria-label="Reminder time" aria-invalid={Boolean(fieldError("reminderTime"))}/>
                </label>
                {fieldError("reminderTime") && <span className="hb-field-error" role="alert">{fieldError("reminderTime")}</span>}
                <label className={`hb-switch ${email.available ? "" : "is-disabled"}`}>
                  <input type="checkbox" checked={draft.reminderEmail && email.available} disabled={!email.available} onChange={(event) => update({ reminderEmail: event.target.checked })}/>
                  <span>Also send an email</span>
                </label>
                <div className="hb-hint hb-reminder-help">
                  <BellRing size={13} aria-hidden="true"/>
                  <span>
                    Reminders appear in the notification bell and are skipped once the habit is done that day (or the weekly goal is met). They never mark a habit complete.
                    {" "}{permission === "granted" ? "Desktop alerts are on for this browser." : permission === "denied" ? "Desktop alerts are blocked in your browser settings; the bell still works while Persora is open." : permission === "unsupported" ? "This browser can't show desktop alerts; the bell still works while Persora is open." : "Desktop alerts need your browser's permission."}
                    {!email.available && email.reason ? ` ${email.reason}` : ""}
                  </span>
                  {permission === "default" && <button type="button" className="hb-link-button" onClick={() => void requestPermission()}>Allow desktop alerts</button>}
                </div>
              </>}
            </fieldset>
            {generalError && <p className="hb-form-error" role="alert">{generalError}</p>}
          </div>
        </div>
        {confirmDelete && habit ? <div className="hb-confirm" role="alertdialog" aria-labelledby="hb-confirm-title" aria-describedby="hb-confirm-text">
          <div>
            <b id="hb-confirm-title">Delete “{habit.name}”?</b>
            <p id="hb-confirm-text">This permanently deletes the habit and its entire check-in history{checkinCount ? ` (${checkinCount} completed day${checkinCount === 1 ? "" : "s"})` : ""}. It can't be undone.{!archived ? " Archive it instead to hide it and keep the history." : ""}</p>
          </div>
          <div className="hb-confirm-actions">
            <button type="button" className="quiet-button" onClick={() => setConfirmDelete(false)} disabled={busy} autoFocus>Cancel</button>
            {!archived && onArchive && <button type="button" className="quiet-button" onClick={onArchive} disabled={busy}>Archive instead</button>}
            <button type="button" className="hb-danger-button" onClick={onDelete} disabled={busy}>{busy ? <><span className="spinner"/> Deleting…</> : "Delete permanently"}</button>
          </div>
        </div> : <div className="editor-form-footer">
          <div className="hb-footer-secondary">
            {habit && !archived && onArchive && <button type="button" className="quiet-button" onClick={onArchive} disabled={busy}><Archive size={14}/> Archive</button>}
            {habit && archived && onRestore && <button type="button" className="quiet-button" onClick={onRestore} disabled={busy}><ArchiveRestore size={14}/> Restore</button>}
            {habit && onDelete && <button type="button" className="hb-text-danger" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={14}/> Delete</button>}
          </div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="editor-submit" disabled={busy}>{busy ? <><span className="spinner"/> Saving…</> : habit ? "Save Changes" : "Create Habit"}</button>
          </div>
        </div>}
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
