// Persora Habit Tracker — the workspace page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ListChecks, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import "./habits.css";
import type { AppUser } from "../../types";
import { PagesApiError, isPagesApiConfigured } from "../../lib/cloud";
import {
  HABITS_CHANGED_EVENT, HABITS_RESTORED_EVENT, createHabit, deleteHabit, loadHabits, reorderHabits, saveHabitCheckin, setHabitArchived, updateHabit,
} from "../../lib/habit-api";
import type { Habit, HabitCheckin, HabitsPayload } from "../../lib/habit-api";
import {
  WEEK_STARTS_ON, aggregateDay, dayCompletion, dayStatus, habitStreaks, isDueOn, isScheduledOn, isWeeklyWeek, monthCompletion,
  trackedUntil, weekCompletion, weekDoneCount, weeklyTargetFor,
} from "../../../cloudflare/habit-rules.js";
import type { HabitCategory, HabitDayStatus, HabitInput, Streaks } from "../../../cloudflare/habit-rules.js";
import { addDays, addMonths, localDateOf, safeTimeZone, startOfMonth, startOfWeek, weekdayOf } from "../../../cloudflare/calendar-rules.js";
import HabitEditor from "./HabitEditor";
import { CATEGORY_LABELS, HabitGlyph, WEEKDAY_SHORT, formatDay, formatNumber, scheduleLabel, streakLabel, targetLabel } from "./habit-visuals";

type Mode = "today" | "week" | "month";
type Filter = "all" | "due" | "completed" | "archived";
const MODES: { id: Mode; label: string }[] = [{ id: "today", label: "Today" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }];

const keyOf = (habitId: string, date: string) => `${habitId}:${date}`;
// Server messages are shown as-is; network failures (fetch's TypeError) get the
// friendly fallback instead of the browser's "Failed to fetch".
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.message ? error.message : fallback);
const byPosition = (a: Habit, b: Habit) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);
const weight = (streak: Pick<Streaks, "unit">, count: number) => count * (streak.unit === "week" ? 7 : 1);
const newId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined);

function rangeFor(date: string) {
  const from = startOfWeek(startOfMonth(date), WEEK_STARTS_ON);
  return { from, to: addDays(from, 41) };
}

export default function HabitsView({ user, notify, focusRequest }: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  focusRequest?: { date: string; nonce: number } | null;
}) {
  const disabled = Boolean(user.demo) || !isPagesApiConfigured;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [payload, setPayload] = useState<HabitsPayload | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const zone = payload?.timeZone || safeTimeZone(user.timezone, "UTC");
  const today = localDateOf(nowMs, zone);
  const [date, setDate] = useState(() => localDateOf(Date.now(), safeTimeZone(user.timezone, "UTC")));
  const [mode, setMode] = useState<Mode>("today");
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<HabitCategory | "">("");
  const [heatmapHabit, setHeatmapHabit] = useState("all");
  const [editor, setEditor] = useState<{ habit: Habit | null; createId?: string } | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const range = rangeFor(date);
  const rangeKey = `${range.from}/${range.to}`;
  const loadedKey = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const reload = () => setReloadKey((value) => value + 1);
    window.addEventListener(HABITS_RESTORED_EVENT, reload);
    return () => window.removeEventListener(HABITS_RESTORED_EVENT, reload);
  }, []);
  useEffect(() => {
    if (!focusRequest) return;
    setDate(focusRequest.date); setMode("today"); setFilter("all");
  }, [focusRequest]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    setLoadState("loading");
    loadHabits(range.from, range.to, controller.signal).then((data) => {
      setPayload(data); setHabits(data.habits); setCheckins(data.checkins);
      loadedKey.current = rangeKey; setLoadState("ready"); setLoadError("");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadState("error");
      setLoadError(errorMessage(error, "Your habits couldn't be loaded. Check your connection and try again."));
    });
    return () => controller.abort();
  }, [disabled, rangeKey, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => window.dispatchEvent(new Event(HABITS_CHANGED_EVENT));

  // ---- derived ------------------------------------------------------------
  const active = useMemo(() => habits.filter((habit) => !habit.archivedAt).sort(byPosition), [habits]);
  const archived = useMemo(() => habits.filter((habit) => habit.archivedAt).sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt))), [habits]);
  const doneById = useMemo(() => new Map(habits.map((habit) => [habit.id, new Set(habit.completedDates)])), [habits]);
  const untilById = useMemo(() => new Map(habits.map((habit) => [habit.id, trackedUntil(habit, today, zone)])), [habits, today, zone]);
  const checkinByKey = useMemo(() => new Map(checkins.map((entry) => [keyOf(entry.habitId, entry.date), entry])), [checkins]);
  const streaks = useMemo(() => new Map(habits.map((habit) => [habit.id, habitStreaks(habit, doneById.get(habit.id) || new Set(), today, untilById.get(habit.id))])), [habits, doneById, today, untilById]);
  const categoriesInUse = useMemo(() => [...new Set(habits.map((habit) => habit.category).filter(Boolean))] as HabitCategory[], [habits]);

  const stats = useMemo(() => {
    const todayRatio = dayCompletion(active, doneById, today, today);
    const weekRatio = weekCompletion(active, doneById, startOfWeek(today, WEEK_STARTS_ON), today);
    let current: { habit: Habit; streak: Streaks } | null = null;
    let best: { habit: Habit; streak: Streaks } | null = null;
    for (const habit of active) {
      const streak = streaks.get(habit.id);
      if (!streak) continue;
      if (streak.current > 0 && (!current || weight(streak, streak.current) > weight(current.streak, current.streak.current))) current = { habit, streak };
      const bestWeight = streak.best * (streak.bestUnit === "week" ? 7 : 1);
      if (streak.best > 0 && (!best || bestWeight > best.streak.best * (best.streak.bestUnit === "week" ? 7 : 1))) best = { habit, streak };
    }
    return { todayRatio, weekRatio, current, best };
  }, [active, doneById, streaks, today]);

  // ---- actions ------------------------------------------------------------
  const setCheckin = useCallback(async (habit: Habit, day: string, body: { completed: boolean } | { value: number }) => {
    const key = keyOf(habit.id, day);
    if (pending.has(key)) return;
    setPending((current) => new Set(current).add(key));
    setLiveMessage(`Saving ${habit.name}…`);
    const wasDone = doneById.get(habit.id)?.has(day) || false;
    try {
      const result = await saveHabitCheckin(habit.id, day, body);
      setHabits((current) => current.map((entry) => entry.id === habit.id ? { ...entry, completedDates: result.completedDates } : entry));
      setCheckins((current) => [...current.filter((entry) => !(entry.habitId === habit.id && entry.date === day)), ...(result.checkin ? [result.checkin] : [])]);
      const nowDone = result.completedDates.includes(day);
      if (nowDone && !wasDone) { setCelebrate(key); window.setTimeout(() => setCelebrate((current) => (current === key ? null : current)), 700); }
      setLiveMessage(nowDone ? `${habit.name} marked done.` : result.checkin ? `${habit.name}: ${formatNumber(result.checkin.value)} saved.` : `${habit.name} marked not done.`);
      changed();
    } catch (error) {
      setLiveMessage("");
      notify(errorMessage(error, "That check-in wasn't saved. Check your connection and try again."), "error");
      if (error instanceof PagesApiError && (error.status === 404 || error.status === 409)) setReloadKey((value) => value + 1);
    } finally {
      setPending((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }, [pending, doneById, notify]);

  const replaceHabit = (habit: Habit) => setHabits((current) => {
    const existing = current.find((entry) => entry.id === habit.id);
    const merged = { ...habit, completedDates: habit.completedDates || existing?.completedDates || [] };
    return existing ? current.map((entry) => entry.id === habit.id ? merged : entry) : [...current, merged];
  });

  const saveEditor = async (input: HabitInput) => {
    if (!editor) return;
    setEditorBusy(true); setEditorError(null);
    try {
      const result = editor.habit
        ? await updateHabit(editor.habit.id, input, editor.habit.revision)
        : await createHabit({ ...input, ...(editor.createId ? { id: editor.createId } : {}) });
      replaceHabit(result.habit);
      notify(editor.habit ? "Habit updated." : `“${result.habit.name}” created.`);
      setEditor(null);
      changed();
    } catch (error) {
      const message = errorMessage(error, "The habit couldn't be saved. Check your connection and try again.");
      setEditorError({ message });
      if (error instanceof PagesApiError && error.status === 409 && editor.habit) setReloadKey((value) => value + 1);
    } finally {
      setEditorBusy(false);
    }
  };

  const archive = async (habit: Habit, value: boolean, fromEditor = false) => {
    if (fromEditor) { setEditorBusy(true); setEditorError(null); } else setRowBusy(habit.id);
    try {
      const result = await setHabitArchived(habit.id, value);
      replaceHabit(result.habit);
      notify(value ? `“${habit.name}” archived. Its history is kept.` : `“${habit.name}” restored.`);
      if (fromEditor) setEditor(null);
      changed();
    } catch (error) {
      const message = errorMessage(error, value ? "The habit couldn't be archived." : "The habit couldn't be restored.");
      if (fromEditor) setEditorError({ message }); else notify(message, "error");
    } finally {
      if (fromEditor) setEditorBusy(false); else setRowBusy(null);
    }
  };

  const remove = async (habit: Habit) => {
    setEditorBusy(true); setEditorError(null);
    try {
      await deleteHabit(habit.id);
      setHabits((current) => current.filter((entry) => entry.id !== habit.id));
      setCheckins((current) => current.filter((entry) => entry.habitId !== habit.id));
      notify(`“${habit.name}” and its history were deleted.`);
      setEditor(null);
      changed();
    } catch (error) {
      setEditorError({ message: errorMessage(error, "The habit couldn't be deleted.") });
    } finally {
      setEditorBusy(false);
    }
  };

  const move = async (habit: Habit, direction: -1 | 1) => {
    const order = active.map((entry) => entry.id);
    const index = order.indexOf(habit.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setRowBusy(habit.id);
    try {
      await reorderHabits(order);
      setHabits((current) => current.map((entry) => { const position = order.indexOf(entry.id); return position >= 0 ? { ...entry, position } : entry; }));
      setLiveMessage(`${habit.name} moved ${direction < 0 ? "up" : "down"}.`);
      window.setTimeout(() => document.getElementById(`hb-menu-${habit.id}`)?.focus(), 0);
    } catch (error) {
      notify(errorMessage(error, "The new order wasn't saved."), "error");
    } finally {
      setRowBusy(null);
    }
  };

  const openNew = () => { setEditorError(null); setEditor({ habit: null, createId: newId() }); };
  const openEdit = (habit: Habit) => { setEditorError(null); setEditor({ habit }); };

  const step = (direction: -1 | 1) => {
    setDate((current) => (mode === "month" ? addMonths(current, direction) : addDays(current, mode === "week" ? 7 * direction : direction)));
  };
  const heading = mode === "month" ? formatDay(date, { month: "long", year: "numeric" })
    : mode === "week" ? weekHeading(startOfWeek(date, WEEK_STARTS_ON))
      : formatDay(date, { weekday: "short", month: "short", day: "numeric", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  const unitLabel = mode === "month" ? "month" : mode === "week" ? "week" : "day";

  if (disabled) {
    return <div className="hb-view">
      <div className="hb-gate">
        <span className="hb-empty-icon"><ListChecks size={24}/></span>
        <h2>{user.demo ? "Habit Tracker needs a Persora account" : "Habit Tracker needs the Persora API"}</h2>
        <p>{user.demo
          ? "Demo mode keeps everything on this device. Sign in to track habits, streaks and reminders in your private, synced account."
          : "This build isn't connected to Persora's Pages Functions API, which stores habits and delivers reminders."}</p>
      </div>
    </div>;
  }

  const initialLoading = loadState === "loading" && !payload;
  const rowProps = {
    today, doneById, checkinByKey, streaks, pending, celebrate, rowBusy, untilById,
    onCheckin: setCheckin, onEdit: openEdit, onArchive: (habit: Habit) => void archive(habit, true), onRestore: (habit: Habit) => void archive(habit, false),
  };

  return <div className="hb-view">
    <header className="hb-toolbar">
      <div className="hb-date-nav">
        <div className="hb-stepper">
          <button type="button" className="hb-icon-button" onClick={() => step(-1)} aria-label={`Previous ${unitLabel}`} title={`Previous ${unitLabel}`}><ChevronLeft size={18}/></button>
          <button type="button" className="hb-icon-button" onClick={() => step(1)} aria-label={`Next ${unitLabel}`} title={`Next ${unitLabel}`}><ChevronRight size={18}/></button>
        </div>
        <h2 className="hb-date-heading" aria-live="polite">{heading}</h2>
        {date === today && mode === "today" ? <span className="hb-today-pill">Today</span>
          : <button type="button" className="hb-button hb-button-small" onClick={() => setDate(today)}>Today</button>}
        {loadState === "loading" && payload && <span className="hb-spinner" role="status" aria-label="Loading habits"/>}
      </div>
      <div className="hb-tools">
        <div className="hb-modes" role="group" aria-label="Habit view">
          {MODES.map((entry) => <button type="button" key={entry.id} className={mode === entry.id ? "is-active" : ""} aria-pressed={mode === entry.id} onClick={() => setMode(entry.id)}>{entry.label}</button>)}
        </div>
        <button type="button" className="hb-primary-button" onClick={openNew} disabled={initialLoading || loadState === "error" && !payload} title="New Habit"><Plus size={16}/><span>New Habit</span></button>
      </div>
    </header>

    {loadState === "error" && <div className="hb-banner" role="alert">
      <span>{loadError}</span>
      <button type="button" className="hb-button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
    </div>}

    <p className="hb-visually-hidden" role="status" aria-live="polite">{liveMessage}</p>

    {initialLoading ? <HabitSkeleton/> : payload && <>
      {active.length > 0 && <StatsStrip stats={stats}/>}
      {mode === "today" && <section className="hb-panel" aria-labelledby="hb-day-title">
        <DayPanel
          id="hb-day-title" title={date === today ? "Today's habits" : `Habits for ${formatDay(date, { weekday: "long", month: "short", day: "numeric" })}`}
          date={date} active={active} archived={archived} filter={filter} onFilter={setFilter} category={category} onCategory={setCategory}
          categories={categoriesInUse} showFilters onCreate={openNew} onMove={move} {...rowProps}
        />
      </section>}
      {mode === "week" && <>
        <section className="hb-panel" aria-labelledby="hb-week-title">
          <WeekGrid id="hb-week-title" date={date} habits={active} onSelect={setDate} {...rowProps}/>
        </section>
        <section className="hb-panel" aria-labelledby="hb-week-day-title">
          <DayPanel id="hb-week-day-title" title={formatDay(date, { weekday: "long", month: "short", day: "numeric" })} date={date} active={active} archived={archived}
            filter="all" onFilter={setFilter} category="" onCategory={setCategory} categories={[]} showFilters={false} onCreate={openNew} onMove={move} {...rowProps}/>
        </section>
      </>}
      {mode === "month" && <div className="hb-month-layout">
        <section className="hb-panel" aria-labelledby="hb-month-title">
          <MonthHeatmap id="hb-month-title" date={date} today={today} habits={habits} active={active} doneById={doneById} untilById={untilById}
            checkinByKey={checkinByKey} selectedHabit={heatmapHabit} onSelectHabit={setHeatmapHabit} onSelect={setDate}/>
        </section>
        <section className="hb-panel" aria-labelledby="hb-month-day-title">
          <DayPanel id="hb-month-day-title" title={formatDay(date, { weekday: "long", month: "short", day: "numeric" })} date={date}
            active={heatmapHabit === "all" ? active : active.filter((habit) => habit.id === heatmapHabit)} archived={archived}
            filter="all" onFilter={setFilter} category="" onCategory={setCategory} categories={[]} showFilters={false} onCreate={openNew} onMove={move} compact {...rowProps}/>
        </section>
      </div>}
    </>}

    {editor && payload && <HabitEditor
      key={editor.habit?.id || "new"} habit={editor.habit} today={today} email={payload.email} busy={editorBusy} error={editorError}
      onSave={(input) => void saveEditor(input)} onClose={() => { if (!editorBusy) setEditor(null); }}
      onArchive={editor.habit ? () => void archive(editor.habit as Habit, true, true) : undefined}
      onRestore={editor.habit ? () => void archive(editor.habit as Habit, false, true) : undefined}
      onDelete={editor.habit ? () => void remove(editor.habit as Habit) : undefined}
    />}
  </div>;
}

/** "Oct 18 – 24, 2026", "Oct 25 – Nov 1, 2026", "Dec 27, 2026 – Jan 2, 2027" (locale-aware). */
function weekHeading(weekStart: string) {
  const end = addDays(weekStart, 6);
  // formatRange is ES2021 (all supported browsers); typed locally because the project's TS lib predates it.
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) as Intl.DateTimeFormat & { formatRange?: (from: Date, to: Date) => string };
  const from = new Date(`${weekStart}T12:00:00Z`);
  const to = new Date(`${end}T12:00:00Z`);
  if (typeof format.formatRange === "function") return format.formatRange(from, to);
  const sameYear = weekStart.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(weekStart, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${format.format(to)}`;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function StatsStrip({ stats }: { stats: { todayRatio: { completed: number; total: number; rate: number | null }; weekRatio: { completed: number; total: number; rate: number | null }; current: { habit: Habit; streak: Streaks } | null; best: { habit: Habit; streak: Streaks } | null } }) {
  const { todayRatio, weekRatio, current, best } = stats;
  return <section className="hb-stats" aria-label="Habit statistics">
    <div className="hb-stat">
      <span className="hb-stat-label">Today</span>
      <b>{todayRatio.rate === null ? "—" : `${todayRatio.rate}%`}</b>
      <small>{todayRatio.total ? `${todayRatio.completed} of ${todayRatio.total} done` : "Nothing due"}</small>
    </div>
    <div className="hb-stat">
      <span className="hb-stat-label">Current streak</span>
      <b>{current ? streakLabel(current.streak.current, current.streak.unit) : "0 days"}</b>
      <small>{current ? current.habit.name : "Complete a habit to start one"}</small>
    </div>
    <div className="hb-stat">
      <span className="hb-stat-label">Best streak</span>
      <b>{best ? streakLabel(best.streak.best, best.streak.bestUnit) : "0 days"}</b>
      <small>{best ? best.habit.name : "No streaks yet"}</small>
    </div>
    <div className="hb-stat">
      <span className="hb-stat-label">This week</span>
      <b>{weekRatio.rate === null ? "—" : `${weekRatio.rate}%`}</b>
      <small>{weekRatio.total ? `${weekRatio.completed} of ${weekRatio.total} so far` : "Nothing scheduled yet"}</small>
    </div>
  </section>;
}

// ---------------------------------------------------------------------------
// Day list
// ---------------------------------------------------------------------------

interface RowContext {
  today: string;
  doneById: Map<string, Set<string>>;
  untilById: Map<string, string>;
  checkinByKey: Map<string, HabitCheckin>;
  streaks: Map<string, Streaks>;
  pending: Set<string>;
  celebrate: string | null;
  rowBusy: string | null;
  onCheckin: (habit: Habit, date: string, body: { completed: boolean } | { value: number }) => Promise<void>;
  onEdit: (habit: Habit) => void;
  onArchive: (habit: Habit) => void;
  onRestore: (habit: Habit) => void;
}

function DayPanel({ id, title, date, active, archived, filter, onFilter, category, onCategory, categories, showFilters, onCreate, onMove, compact = false, ...ctx }: RowContext & {
  id: string; title: string; date: string; active: Habit[]; archived: Habit[];
  filter: Filter; onFilter: (filter: Filter) => void; category: HabitCategory | ""; onCategory: (category: HabitCategory | "") => void;
  categories: HabitCategory[]; showFilters: boolean; onCreate: () => void; onMove: (habit: Habit, direction: -1 | 1) => void; compact?: boolean;
}) {
  const { today, doneById } = ctx;
  const isToday = date === today;
  const inCategory = (habit: Habit) => !category || habit.category === category;
  const scheduled = active.filter((habit) => isScheduledOn(habit, date) && inCategory(habit));
  const notScheduled = active.filter((habit) => !isScheduledOn(habit, date) && inCategory(habit));
  const progress = dayCompletion(scheduled, doneById, date, today);
  const doneOn = (habit: Habit) => doneById.get(habit.id)?.has(date) || false;
  const visible = filter === "archived" ? archived.filter(inCategory)
    : filter === "due" ? scheduled.filter((habit) => !doneOn(habit) && (date > today || isDueOn(habit, doneById.get(habit.id) || new Set(), date, today)))
      : filter === "completed" ? scheduled.filter(doneOn)
        : scheduled;
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "due", label: isToday ? "Due Today" : "Due" },
    { id: "completed", label: isToday ? "Completed Today" : "Completed" },
    { id: "archived", label: "Archived", count: archived.length || undefined },
  ];

  return <>
    <div className="hb-panel-head">
      <h2 id={id}>{title}</h2>
      {active.length > 0 && filter !== "archived" && <div className="hb-progress" aria-label={`${progress.completed} of ${progress.total} completed`}>
        <span className="hb-progress-text">{progress.total ? `${progress.completed} of ${progress.total} completed` : date > today ? "Upcoming" : "Nothing due"}</span>
        {progress.total > 0 && <span className="hb-progress-bar" aria-hidden="true"><span style={{ width: `${percent}%` }}/></span>}
      </div>}
    </div>
    {showFilters && (active.length > 0 || archived.length > 0) && <div className="hb-filters">
      <div className="hb-chips" role="group" aria-label="Filter habits">
        {filters.map((entry) => <button key={entry.id} type="button" className={filter === entry.id ? "is-active" : ""} aria-pressed={filter === entry.id} onClick={() => onFilter(entry.id)}>
          {entry.label}{entry.count ? <span className="hb-chip-count">{entry.count}</span> : null}
        </button>)}
      </div>
      {categories.length > 0 && <label className="hb-category-filter"><span className="hb-visually-hidden">Category</span>
        <select value={category} onChange={(event) => onCategory(event.target.value as HabitCategory | "")}>
          <option value="">All categories</option>
          {categories.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
        </select>
      </label>}
    </div>}

    {active.length === 0 && archived.length === 0 ? <div className="hb-empty">
      <span className="hb-empty-icon"><ListChecks size={22}/></span>
      <h3>Build a routine, one habit at a time</h3>
      <p>Track daily or weekly habits, see your streaks and get gentle reminders.</p>
      <button type="button" className="hb-primary-button" onClick={onCreate}><Plus size={16}/> Create your first habit</button>
    </div> : visible.length === 0 ? <div className="hb-empty hb-empty-small">
      <p>{filter === "archived" ? "No archived habits." : filter === "completed" ? "Nothing completed yet for this day." : filter === "due" ? (scheduled.length ? "Everything due is done. Nice work." : "Nothing due on this day.") : active.length === 0 ? "All your habits are archived." : "No habits are scheduled for this day."}</p>
      {filter === "all" && active.length === 0 && <button type="button" className="hb-button" onClick={onCreate}><Plus size={14}/> New Habit</button>}
    </div> : <ul className={`hb-list ${compact ? "is-compact" : ""}`}>
      {visible.map((habit) => {
        const index = active.indexOf(habit);
        return <HabitRow key={habit.id} habit={habit} date={date} {...ctx}
          canMoveUp={filter !== "archived" && index > 0} canMoveDown={filter !== "archived" && index >= 0 && index < active.length - 1} onMove={onMove}/>;
      })}
    </ul>}
    {filter === "all" && notScheduled.length > 0 && scheduled.length > 0 && <p className="hb-muted-line">Not scheduled on this day: {notScheduled.map((habit) => habit.name).join(", ")}</p>}
  </>;
}

function HabitRow({ habit, date, today, doneById, untilById, checkinByKey, streaks, pending, celebrate, rowBusy, onCheckin, onEdit, onArchive, onRestore, canMoveUp, canMoveDown, onMove }: RowContext & {
  habit: Habit; date: string; canMoveUp: boolean; canMoveDown: boolean; onMove: (habit: Habit, direction: -1 | 1) => void;
}) {
  const done = doneById.get(habit.id) || new Set<string>();
  const key = keyOf(habit.id, date);
  const checkin = checkinByKey.get(key);
  const saving = pending.has(key);
  const isArchived = Boolean(habit.archivedAt);
  const status: HabitDayStatus = dayStatus(habit, done, date, today, { value: checkin?.value ?? null, until: untilById.get(habit.id) });
  const completed = done.has(date);
  const future = date > today;
  const editable = !isArchived && !future && date >= habit.startDate && isScheduledOn(habit, date);
  const streak = streaks.get(habit.id);
  const weekStart = startOfWeek(date, WEEK_STARTS_ON);
  const weekly = isWeeklyWeek(habit, weekStart);
  const dayLabel = formatDay(date, { weekday: "short", month: "short", day: "numeric" });
  const meta: string[] = [];
  const target = targetLabel(habit);
  if (weekly) meta.push(`${weekDoneCount(habit, done, weekStart)} of ${weeklyTargetFor(habit, weekStart)} this week`);
  else meta.push(scheduleLabel(habit));
  if (target) meta.push(`Target ${target}`);
  if (streak && streak.current > 0 && !isArchived) meta.push(`${streakLabel(streak.current, streak.unit)} streak`);
  if (isArchived) meta.push("Archived");
  else if (date < habit.startDate) meta.push(`Starts ${formatDay(habit.startDate, { month: "short", day: "numeric" })}`);
  const statusNote = status === "goal-met" ? "Weekly goal met" : status === "partial" ? "In progress" : null;

  return <li className={`hb-row ${completed ? "is-done" : ""} ${celebrate === key ? "is-celebrating" : ""} ${isArchived ? "is-archived" : ""}`}>
    <HabitGlyph habit={habit} size={17}/>
    <div className="hb-row-main">
      <button type="button" className="hb-row-name" onClick={() => onEdit(habit)} aria-label={`Edit ${habit.name}`}>{habit.name}</button>
      <span className="hb-row-meta">{meta.join(" · ")}{statusNote && <span className={`hb-status-note is-${status}`}> · {statusNote}</span>}</span>
    </div>
    {isArchived ? <div className="hb-row-actions">
      <button type="button" className="hb-button hb-button-small" onClick={() => onRestore(habit)} disabled={rowBusy === habit.id}><ArchiveRestore size={14}/> Restore</button>
      <button type="button" className="hb-icon-button" onClick={() => onEdit(habit)} aria-label={`Open ${habit.name} to delete or edit`} title="Edit or delete"><Trash2 size={15}/></button>
    </div> : <div className="hb-row-actions">
      {habit.tracking === "numeric" && <NumericEntry habit={habit} value={checkin?.value ?? 0} disabled={!editable || saving} dayLabel={dayLabel}
        onCommit={(value) => void onCheckin(habit, date, { value })}/>}
      <button
        type="button" className={`hb-check ${completed ? "is-checked" : ""} hb-c-${habit.color}`} aria-pressed={completed} disabled={!editable || saving} aria-busy={saving}
        aria-label={completed ? `${habit.name}: done on ${dayLabel}. Mark as not done` : `Mark ${habit.name} done for ${dayLabel}`}
        title={future ? "You can check in once the day arrives" : completed ? "Mark as not done" : habit.tracking === "numeric" ? `Complete (${target})` : "Mark done"}
        onClick={() => {
          if (habit.tracking === "numeric") void onCheckin(habit, date, { value: completed ? 0 : habit.targetValue || 0 });
          else void onCheckin(habit, date, { completed: !completed });
        }}
      >{saving ? <span className="hb-spinner hb-spinner-small" aria-hidden="true"/> : <Check size={16} strokeWidth={3}/>}</button>
      <RowMenu habit={habit} busy={rowBusy === habit.id} canMoveUp={canMoveUp} canMoveDown={canMoveDown}
        onEdit={() => onEdit(habit)} onMove={(direction) => onMove(habit, direction)} onArchive={() => onArchive(habit)}/>
    </div>}
  </li>;
}

function NumericEntry({ habit, value, disabled, dayLabel, onCommit }: { habit: Habit; value: number; disabled: boolean; dayLabel: string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? String(value) : ""); }, [value]);
  const commit = () => {
    focused.current = false;
    const trimmed = text.trim();
    const next = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isFinite(next) || next < 0) { setText(value ? String(value) : ""); return; }
    if (Math.round(next * 100) / 100 === value) return;
    onCommit(next);
  };
  return <label className="hb-numeric">
    <input type="number" inputMode="decimal" min={0} step="any" value={text} disabled={disabled} placeholder="0"
      aria-label={`${habit.name} amount for ${dayLabel}${habit.unit ? ` in ${habit.unit}` : ""}`}
      onFocus={() => { focused.current = true; }} onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") { setText(value ? String(value) : ""); } }}/>
    <span aria-hidden="true">/ {formatNumber(habit.targetValue || 0)}{habit.unit ? ` ${habit.unit}` : ""}</span>
  </label>;
}

function RowMenu({ habit, busy, canMoveUp, canMoveDown, onEdit, onMove, onArchive }: {
  habit: Habit; busy: boolean; canMoveUp: boolean; canMoveDown: boolean; onEdit: () => void; onMove: (direction: -1 | 1) => void; onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => { if (open) wrap.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus(); }, [open]);
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); document.getElementById(`hb-menu-${habit.id}`)?.focus(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") || [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const run = (action: () => void) => { setOpen(false); action(); };
  return <div className="hb-menu-wrap" ref={wrap} onKeyDown={onKey}>
    <button id={`hb-menu-${habit.id}`} type="button" className="hb-icon-button" aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${habit.name}`} disabled={busy}
      onClick={() => setOpen((value) => !value)}>{busy ? <span className="hb-spinner hb-spinner-small" aria-hidden="true"/> : <MoreHorizontal size={17}/>}</button>
    {open && <div className="hb-menu" role="menu" aria-label={`${habit.name} actions`}>
      <button type="button" role="menuitem" onClick={() => run(onEdit)}><Pencil size={14}/> Edit</button>
      <button type="button" role="menuitem" onClick={() => run(() => onMove(-1))} disabled={!canMoveUp}><ArrowUp size={14}/> Move up</button>
      <button type="button" role="menuitem" onClick={() => run(() => onMove(1))} disabled={!canMoveDown}><ArrowDown size={14}/> Move down</button>
      <button type="button" role="menuitem" onClick={() => run(onArchive)}><Archive size={14}/> Archive</button>
    </div>}
  </div>;
}

// ---------------------------------------------------------------------------
// Week grid
// ---------------------------------------------------------------------------

function WeekGrid({ id, date, habits, onSelect, today, doneById, checkinByKey, pending, onCheckin }: RowContext & { id: string; date: string; habits: Habit[]; onSelect: (date: string) => void }) {
  const weekStart = startOfWeek(date, WEEK_STARTS_ON);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const ratio = weekCompletion(habits, doneById, weekStart, today);
  return <>
    <div className="hb-panel-head">
      <h2 id={id}>Week overview</h2>
      <span className="hb-progress-text">{ratio.total ? `${ratio.rate}% · ${ratio.completed} of ${ratio.total} ${weekStart <= today && addDays(weekStart, 6) >= today ? "so far" : "completed"}` : weekStart > today ? "Upcoming week" : "Nothing scheduled"}</span>
    </div>
    {habits.length === 0 ? <p className="hb-muted-line">No active habits yet.</p> : <div className="hb-week-scroll">
      <table className="hb-week">
        <thead><tr>
          <th scope="col" className="hb-week-habit">Habit</th>
          {days.map((day) => <th scope="col" key={day} className={`${day === today ? "is-today" : ""} ${day === date ? "is-selected" : ""}`}>
            <button type="button" onClick={() => onSelect(day)} aria-label={`Show ${formatDay(day, { weekday: "long", month: "short", day: "numeric" })}`} aria-pressed={day === date}>
              <span>{WEEKDAY_SHORT[weekdayOf(day)]}</span><b>{Number(day.slice(8))}</b>
            </button>
          </th>)}
          <th scope="col" className="hb-week-total">Week</th>
        </tr></thead>
        <tbody>{habits.map((habit) => {
          const done = doneById.get(habit.id) || new Set<string>();
          const weekly = isWeeklyWeek(habit, weekStart);
          const scheduledDays = days.filter((day) => day >= habit.startDate && day <= today && isScheduledOn(habit, day));
          const total = weekly ? `${weekDoneCount(habit, done, weekStart)}/${weeklyTargetFor(habit, weekStart)}` : `${scheduledDays.filter((day) => done.has(day)).length}/${scheduledDays.length}`;
          return <tr key={habit.id}>
            <th scope="row" className="hb-week-habit"><HabitGlyph habit={habit} size={14}/><span>{habit.name}</span></th>
            {days.map((day) => {
              const scheduled = day >= habit.startDate && isScheduledOn(habit, day);
              const isDone = done.has(day);
              const checkin = checkinByKey.get(keyOf(habit.id, day));
              const saving = pending.has(keyOf(habit.id, day));
              const label = formatDay(day, { weekday: "short", month: "short", day: "numeric" });
              if (!scheduled) return <td key={day} className="hb-cell-off"><span aria-label={`${habit.name}, ${label}: not scheduled`} role="img">·</span></td>;
              if (day > today) return <td key={day} className="hb-cell-future"><span aria-label={`${habit.name}, ${label}: upcoming`} role="img"/></td>;
              if (habit.tracking === "numeric") {
                return <td key={day}><button type="button" className={`hb-cell ${isDone ? "is-done" : checkin ? "is-partial" : ""} hb-c-${habit.color}`} onClick={() => onSelect(day)}
                  aria-label={`${habit.name}, ${label}: ${checkin ? `${formatNumber(checkin.value)} of ${formatNumber(habit.targetValue || 0)}` : "nothing logged"}. Edit this day`}>
                  {checkin ? formatNumber(checkin.value) : "–"}</button></td>;
              }
              return <td key={day}><button type="button" className={`hb-cell ${isDone ? "is-done" : ""} hb-c-${habit.color}`} aria-pressed={isDone} disabled={saving || Boolean(habit.archivedAt)}
                aria-label={`${habit.name}, ${label}: ${isDone ? "done" : "not done"}`} onClick={() => void onCheckin(habit, day, { completed: !isDone })}>
                {saving ? <span className="hb-spinner hb-spinner-small" aria-hidden="true"/> : isDone ? <Check size={14} strokeWidth={3}/> : null}</button></td>;
            })}
            <td className="hb-week-total">{total}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </>;
}

// ---------------------------------------------------------------------------
// Month heatmap
// ---------------------------------------------------------------------------

const AGG_LABEL: Record<string, string> = {
  complete: "all done", partial: "partly done", missed: "missed", open: "not done yet", unscheduled: "nothing scheduled", future: "upcoming",
};
const HABIT_STATUS_CLASS: Record<HabitDayStatus, string> = {
  complete: "complete", partial: "partial", missed: "missed", open: "open", "goal-met": "unscheduled", optional: "unscheduled",
  unscheduled: "unscheduled", "before-start": "unscheduled", future: "future",
};
const HABIT_STATUS_LABEL: Record<HabitDayStatus, string> = {
  complete: "done", partial: "partly done", missed: "missed", open: "not done yet", "goal-met": "weekly goal already met", optional: "optional (weekly goal)",
  unscheduled: "not scheduled", "before-start": "before the habit started", future: "upcoming",
};

function MonthHeatmap({ id, date, today, habits, active, doneById, untilById, checkinByKey, selectedHabit, onSelectHabit, onSelect }: {
  id: string; date: string; today: string; habits: Habit[]; active: Habit[]; doneById: Map<string, Set<string>>; untilById: Map<string, string>;
  checkinByKey: Map<string, HabitCheckin>; selectedHabit: string; onSelectHabit: (id: string) => void; onSelect: (date: string) => void;
}) {
  const monthStart = startOfMonth(date);
  const gridStart = startOfWeek(monthStart, WEEK_STARTS_ON);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const weeks = days.length / 7;
  const single = selectedHabit === "all" ? null : habits.find((habit) => habit.id === selectedHabit) || null;
  const scope = single ? [single] : active;
  const ratio = monthCompletion(scope, doneById, monthStart, today, untilById);
  const gridRef = useRef<HTMLDivElement>(null);
  const onKey = (event: ReactKeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = addDays(date, delta);
    onSelect(next);
    window.setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus(), 0);
  };
  return <>
    <div className="hb-panel-head">
      <h2 id={id}>Monthly overview</h2>
      <label className="hb-category-filter"><span className="hb-visually-hidden">Show habit</span>
        <select value={single ? single.id : "all"} onChange={(event) => onSelectHabit(event.target.value)}>
          <option value="all">All habits</option>
          {habits.map((habit) => <option key={habit.id} value={habit.id}>{habit.name}{habit.archivedAt ? " (archived)" : ""}</option>)}
        </select>
      </label>
    </div>
    <p className="hb-progress-text hb-month-rate">{ratio.total ? `${ratio.rate}% · ${ratio.completed} of ${ratio.total} completed this month` : monthStart > today ? "Upcoming month" : "Nothing scheduled this month"}</p>
    <div className="hb-heatmap" role="grid" aria-label={`${formatDay(monthStart, { month: "long", year: "numeric" })} completion`} ref={gridRef} onKeyDown={onKey}>
      <div className="hb-heatmap-row" role="row">{WEEKDAY_SHORT.map((label) => <span key={label} role="columnheader" className="hb-heatmap-head">{label.slice(0, 2)}</span>)}</div>
      {Array.from({ length: weeks }, (_, week) => <div className="hb-heatmap-row" role="row" key={week}>
        {days.slice(week * 7, week * 7 + 7).map((day) => {
          const inMonth = day.slice(0, 7) === monthStart.slice(0, 7);
          let cls: string; let label: string;
          if (single) {
            const status = dayStatus(single, doneById.get(single.id) || new Set(), day, today, { value: checkinByKey.get(keyOf(single.id, day))?.value ?? null, until: untilById.get(single.id) });
            cls = HABIT_STATUS_CLASS[status]; label = HABIT_STATUS_LABEL[status];
          } else {
            const agg = aggregateDay(active, doneById, day, today, untilById);
            cls = agg.status; label = agg.total ? `${agg.completed} of ${agg.total} done` : AGG_LABEL[agg.status];
          }
          return <span role="gridcell" key={day} aria-selected={day === date}>
            <button type="button" data-date={day} tabIndex={day === date ? 0 : -1}
              className={`hb-day is-${cls} ${inMonth ? "" : "is-outside"} ${day === today ? "is-today" : ""} ${day === date ? "is-selected" : ""}`}
              aria-label={`${formatDay(day, { weekday: "long", month: "long", day: "numeric" })}: ${label}`} onClick={() => onSelect(day)}>
              {Number(day.slice(8))}
            </button>
          </span>;
        })}
      </div>)}
    </div>
    <ul className="hb-legend" aria-label="Legend">
      <li><span className="hb-day-swatch is-complete"/>Completed</li>
      <li><span className="hb-day-swatch is-partial"/>Partly done</li>
      <li><span className="hb-day-swatch is-missed"/>Incomplete</li>
      <li><span className="hb-day-swatch is-unscheduled"/>Not scheduled</li>
    </ul>
  </>;
}

function HabitSkeleton() {
  return <div className="hb-panel hb-skeleton" aria-busy="true" aria-label="Loading habits">
    {[0, 1, 2].map((index) => <div key={index} className="hb-skeleton-row"><span/><span/><span/></div>)}
  </div>;
}
