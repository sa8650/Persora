import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, PanelLeft, Plus, Repeat, Search, X } from "lucide-react";
import "./calendar.css";
import type { AppUser } from "../../types";
import { PagesApiError, isPagesApiConfigured } from "../../lib/cloud";
import {
  CALENDAR_CHANGED_EVENT, createCalendarEvent, deleteCalendarEvent, loadCalendarEvent, loadCalendarEvents, loadCalendarMeta, searchCalendarEvents, updateCalendarEvent,
} from "../../lib/calendar-api";
import type { CalendarEvent, CalendarMeta } from "../../lib/calendar-api";
import { eventAnchor, expandOccurrences, nextOccurrence, occurrenceOn, safeTimeZone } from "../../../cloudflare/calendar-rules.js";
import {
  VIEW_MODES, datesBetween, draftFromEvent, formatDay, draftFromOccurrence, draftToInput, newDraft, nextHalfHour, occurrenceDateLabel, occurrenceDays,
  occurrenceTimeLabel, rangeHeading, shiftAnchor, todayIn, visibleRange,
} from "../../lib/calendar-view";
import type { CalendarViewMode, EventDraft, Occurrence } from "../../lib/calendar-view";
import { CalPopover, CategoryDot, MiniCalendar, ScopeDialog, rectOf, useMediaQuery } from "./CalendarParts";
import type { AnchorRect } from "./CalendarParts";
import TimeGrid from "./TimeGrid";
import MonthGrid from "./MonthGrid";
import AgendaList from "./AgendaList";
import { EventDetails, EventEditor, QuickCreate } from "./EventDialogs";

interface EditorState {
  mode: "create" | "edit";
  scope: "occurrence" | "series" | null;
  draft: EventDraft;
  target: CalendarEvent | null;
  occurrence: Occurrence | null;
  occurrenceKey: string | null;
  expectedRevision: number | null;
  seriesHasChanges: boolean;
}

interface Props {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  /** Jump to a date (e.g. from a reminder notification). */
  focusRequest?: { date: string; nonce: number } | null;
}

const VIEW_KEY = (userId: string) => `persora-calendar-view:${userId}`;
const SIDEBAR_KEY = (userId: string) => `persora-calendar-sidebar:${userId}`;
const readStored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* preference only */ } };
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function initialMode(userId: string): CalendarViewMode {
  const stored = readStored(VIEW_KEY(userId));
  if (stored === "week" || stored === "day" || stored === "month" || stored === "agenda") return stored;
  return typeof window !== "undefined" && window.innerWidth < 640 ? "agenda" : "week";
}

/** A displayable occurrence for a search result: the next one for series, else the event itself. */
function searchOccurrence(event: CalendarEvent, nowMs: number): Occurrence {
  if (event.recurrence && !event.seriesId) {
    const timing = nextOccurrence(event, nowMs) || occurrenceOn(event, eventAnchor(event).date);
    return { ...timing, id: `${event.id}:${timing.key}`, event, seriesId: event.id, occurrenceKey: timing.key, recurring: true, exception: false };
  }
  const timing = event.allDay
    ? { key: event.startDate as string, allDay: true, startDate: event.startDate, endDate: event.endDate, startMs: null, endMs: null }
    : { key: event.startAt as string, allDay: false, startDate: null, endDate: null, startMs: Date.parse(event.startAt as string), endMs: Date.parse(event.endAt as string) };
  return { ...timing, id: `${event.id}:${timing.key}`, event, seriesId: event.seriesId, occurrenceKey: event.seriesId ? timing.key : null, recurring: Boolean(event.seriesId), exception: Boolean(event.seriesId) };
}

export default function CalendarView({ user, notify, focusRequest }: Props) {
  const zone = safeTimeZone(user.timezone, "UTC");
  const wide = useMediaQuery("(min-width: 1100px)");
  const disabled = Boolean(user.demo) || !isPagesApiConfigured;

  const [mode, setMode] = useState<CalendarViewMode>(() => initialMode(user.id));
  const [sidebarOpen, setSidebarOpen] = useState(() => readStored(SIDEBAR_KEY(user.id)) !== "closed");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const today = todayIn(zone, nowMs);
  const [anchor, setAnchor] = useState(() => todayIn(zone));
  const range = useMemo(() => visibleRange(mode, anchor), [mode, anchor]);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [loadedRange, setLoadedRange] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [meta, setMeta] = useState<CalendarMeta | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalendarEvent[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [selected, setSelected] = useState<{ occurrence: Occurrence; anchor: AnchorRect | null } | null>(null);
  const [quick, setQuick] = useState<{ draft: EventDraft; anchor: AnchorRect | null } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [scopePrompt, setScopePrompt] = useState<{ action: "edit" | "delete"; occurrence: Occurrence } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Occurrence | null>(null);
  const [datePicker, setDatePicker] = useState<AnchorRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const headingRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Minute clock for the now-line and "today".
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    loadCalendarMeta().then((value) => { if (active) setMeta(value); }).catch(() => { /* email option stays off */ });
    return () => { active = false; };
  }, [disabled, user.emailVerified]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    setLoadState("loading");
    loadCalendarEvents(range.from, range.to, controller.signal).then((rows) => {
      setEvents(rows); setLoadedRange(`${range.from}/${range.to}`); setLoadState("ready"); setLoadError("");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadState("error"); setLoadError(errorMessage(error, "Your calendar couldn't be loaded."));
    });
    return () => controller.abort();
  }, [range.from, range.to, reloadKey, disabled]);

  useEffect(() => {
    if (!focusRequest) return;
    setAnchor(focusRequest.date);
    setQuery("");
  }, [focusRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Title search (debounced).
  useEffect(() => {
    const term = query.trim();
    if (!term || disabled) { setResults(null); setSearchState("idle"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchState("loading");
      searchCalendarEvents(term, controller.signal).then((rows) => { setResults(rows); setSearchState("idle"); }).catch((error) => {
        if (controller.signal.aborted) return;
        setSearchState("error"); setSearchError(errorMessage(error, "Search isn't available right now."));
      });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, reloadKey, disabled]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const occurrences = useMemo(() => expandOccurrences(events, range.from, range.to, zone), [events, range.from, range.to, zone]);
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const days = useMemo(() => datesBetween(range.from, range.to), [range.from, range.to]);
  const anyDialog = Boolean(selected || quick || editor || scopePrompt || confirmDelete || datePicker);

  const changeMode = useCallback((next: CalendarViewMode) => { setMode(next); writeStored(VIEW_KEY(user.id), next); }, [user.id]);
  const step = useCallback((direction: 1 | -1) => setAnchor((current) => shiftAnchor(mode, current, direction)), [mode]);
  const goToday = useCallback(() => setAnchor(todayIn(zone)), [zone]);
  const openDay = (date: string) => { setAnchor(date); changeMode("day"); };
  const toggleSidebar = () => setSidebarOpen((open) => { writeStored(SIDEBAR_KEY(user.id), open ? "closed" : "open"); return !open; });

  const closeAll = () => { setSelected(null); setQuick(null); setEditor(null); setScopePrompt(null); setConfirmDelete(null); setFormError(null); };
  const afterChange = () => { setReloadKey((key) => key + 1); window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT)); };

  const openNewEvent = useCallback(() => {
    const start = anchor === today ? nextHalfHour(zone) : { date: anchor, time: "09:00" };
    setSelected(null); setQuick(null); setFormError(null);
    setEditor({ mode: "create", scope: null, draft: newDraft(zone, start.date, start.time), target: null, occurrence: null, occurrenceKey: null, expectedRevision: null, seriesHasChanges: false });
  }, [anchor, today, zone]);

  // Keyboard shortcuts (outside inputs and dialogs): T today, ←/→ previous/next, D/W/M/A views, C new event, / search.
  useEffect(() => {
    if (disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || anyDialog) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector(".modal-backdrop, .cal-popover")) return;
      const key = event.key.toLowerCase();
      const view = VIEW_MODES.find((entry) => entry.key === key);
      if (key === "t") goToday();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else if (view) changeMode(view.id);
      else if (key === "c") openNewEvent();
      else if (event.key === "/") searchRef.current?.focus();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anyDialog, changeMode, disabled, goToday, openNewEvent, step]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true); setFormError(null);
    try {
      const message = await action();
      closeAll(); afterChange(); notify(message);
    } catch (error) {
      const message = errorMessage(error, "That change couldn't be saved.");
      setFormError(message);
      if (!editor && !quick) notify(message, "error");
      if (error instanceof PagesApiError && (error.status === 409 || error.status === 404)) afterChange();
    } finally {
      setBusy(false);
    }
  };

  const openCreate = ({ date, time, allDay, anchor: rect }: { date: string; time: string | null; allDay: boolean; anchor: AnchorRect | null }) => {
    setSelected(null); setFormError(null);
    setQuick({ draft: newDraft(zone, date, time, allDay), anchor: rect });
  };

  const openEditor = async (occurrence: Occurrence, scope: "occurrence" | "series" | null) => {
    setSelected(null); setScopePrompt(null); setFormError(null);
    if (scope === "occurrence") {
      setEditor({
        mode: "edit", scope, occurrence, draft: draftFromOccurrence(occurrence), target: occurrence.event,
        occurrenceKey: occurrence.exception ? null : occurrence.occurrenceKey,
        expectedRevision: occurrence.exception ? occurrence.event.revision : null, seriesHasChanges: false,
      });
      return;
    }
    let target = occurrence.event;
    if (scope === "series" && occurrence.exception && occurrence.seriesId) {
      const cached = eventsById.get(occurrence.seriesId);
      if (cached) target = cached;
      else {
        try { target = (await loadCalendarEvent(occurrence.seriesId)).event; }
        catch (error) { notify(errorMessage(error, "That recurring event couldn't be opened."), "error"); return; }
      }
    }
    setEditor({
      mode: "edit", scope, occurrence, draft: draftFromEvent(target), target, occurrenceKey: null, expectedRevision: target.revision,
      seriesHasChanges: scope === "series" && events.some((event) => event.seriesId === target.id),
    });
  };

  const startEdit = (occurrence: Occurrence) => {
    if (occurrence.recurring) { setSelected(null); setScopePrompt({ action: "edit", occurrence }); }
    else void openEditor(occurrence, null);
  };

  const performDelete = (occurrence: Occurrence, scope: "occurrence" | "series" | null) => void run(async () => {
    if (!occurrence.recurring || scope === null) {
      await deleteCalendarEvent(occurrence.event.id, { scope: "series", revision: occurrence.event.revision });
      return "Event deleted.";
    }
    if (scope === "occurrence") {
      await deleteCalendarEvent(occurrence.event.id, {
        scope: "occurrence", occurrenceKey: occurrence.exception ? null : occurrence.occurrenceKey,
        revision: occurrence.exception ? occurrence.event.revision : null,
      });
      return "This occurrence was deleted.";
    }
    const seriesId = occurrence.seriesId || occurrence.event.id;
    await deleteCalendarEvent(seriesId, { scope: "series", revision: eventsById.get(seriesId)?.revision ?? null });
    return "All events in the series were deleted.";
  });

  const saveEditor = (draft: EventDraft) => {
    if (!editor) return;
    void run(async () => {
      if (editor.mode === "create") {
        await createCalendarEvent(draftToInput(draft, true));
        return "Event created.";
      }
      const target = editor.target as CalendarEvent;
      const result = await updateCalendarEvent(target.id, {
        event: draftToInput(draft, editor.scope !== "occurrence"),
        scope: editor.scope === "occurrence" ? "occurrence" : "series",
        occurrenceKey: editor.occurrenceKey, expectedRevision: editor.expectedRevision,
      });
      if (result.exceptionsReset) return "All events updated. Changes made to single occurrences were replaced.";
      return editor.scope === "occurrence" ? "This occurrence was updated." : editor.scope === "series" ? "All events updated." : "Event updated.";
    });
  };

  const seriesFor = (occurrence: Occurrence) => (occurrence.recurring ? eventsById.get(occurrence.seriesId || occurrence.event.id) || null : null);
  const viewLabel = VIEW_MODES.find((entry) => entry.id === mode)?.label.toLowerCase() || "range";
  const rangeReady = loadedRange === `${range.from}/${range.to}`;
  const emptyRange = loadState === "ready" && rangeReady && occurrences.length === 0 && mode !== "agenda";

  if (disabled) {
    return <div className="cal-view">
      <div className="cal-gate">
        <span className="cal-empty-icon"><CalendarDays size={24}/></span>
        <h2>{user.demo ? "Calendar needs a Persora account" : "Calendar needs the Persora API"}</h2>
        <p>{user.demo
          ? "Demo mode keeps everything on this device. Sign in to keep events, recurring schedules and reminders in your private, synced calendar."
          : "This build isn't connected to Persora's Pages Functions API, which stores calendar events and delivers reminders."}</p>
      </div>
    </div>;
  }

  const searchResults = results ? results
    .filter((event) => event.status !== "cancelled")
    .map((event) => searchOccurrence(event, nowMs))
    .sort((a, b) => occurrenceDays(a, zone).first.localeCompare(occurrenceDays(b, zone).first)) : null;

  return <div className="cal-view">
    <header className="cal-toolbar">
      <div className="cal-toolbar-nav">
        {wide && <button type="button" className={`cal-icon-button ${sidebarOpen ? "is-active" : ""}`} onClick={toggleSidebar} aria-label={sidebarOpen ? "Hide mini calendar" : "Show mini calendar"} aria-pressed={sidebarOpen} title="Mini calendar"><PanelLeft size={17}/></button>}
        <button type="button" className="cal-button" onClick={goToday} title="Today (T)" aria-label={`Today, ${formatDay(today, { weekday: "long", month: "long", day: "numeric" })}`}>Today</button>
        <div className="cal-stepper">
          <button type="button" className="cal-icon-button" onClick={() => step(-1)} aria-label={`Previous ${viewLabel}`} title={`Previous ${viewLabel} (←)`}><ChevronLeft size={18}/></button>
          <button type="button" className="cal-icon-button" onClick={() => step(1)} aria-label={`Next ${viewLabel}`} title={`Next ${viewLabel} (→)`}><ChevronRight size={18}/></button>
        </div>
        <button
          ref={headingRef} type="button" className="cal-range-heading"
          onClick={() => { if (!(wide && sidebarOpen)) setDatePicker(rectOf(headingRef.current)); }}
          aria-haspopup={wide && sidebarOpen ? undefined : "dialog"}
          aria-label={`${rangeHeading(mode, anchor)}${wide && sidebarOpen ? "" : ". Choose a date"}`}
        >
          <h2 aria-live="polite">{rangeHeading(mode, anchor)}</h2>
          {!(wide && sidebarOpen) && <ChevronDown size={16} aria-hidden="true"/>}
        </button>
        {loadState === "loading" && <span className="cal-spinner" role="status" aria-label="Loading events"/>}
      </div>
      <div className="cal-toolbar-tools">
        <label className="cal-search">
          <Search size={15} aria-hidden="true"/>
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" aria-label="Search events by title" maxLength={100}
            onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); (event.target as HTMLInputElement).blur(); } }}/>
          {query && <button type="button" className="cal-search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}
        </label>
        <div className="cal-views" role="group" aria-label="Calendar view">
          {VIEW_MODES.map((entry) => <button type="button" key={entry.id} className={mode === entry.id ? "is-active" : ""} aria-pressed={mode === entry.id} onClick={() => changeMode(entry.id)} title={`${entry.label} (${entry.key.toUpperCase()})`}>{entry.label}</button>)}
        </div>
        <button type="button" className="cal-primary-button" onClick={openNewEvent} title="New event (C)"><Plus size={16}/><span>New event</span></button>
      </div>
    </header>

    {loadState === "error" && <div className="cal-banner" role="alert">
      <span>{loadError}</span>
      <button type="button" className="cal-button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
    </div>}

    <div className={`cal-layout ${wide && sidebarOpen ? "with-sidebar" : ""}`}>
      {wide && sidebarOpen && <aside className="cal-sidebar" aria-label="Mini calendar">
        <MiniCalendar selected={anchor} today={today} rangeFrom={range.from} rangeTo={range.to} onSelect={setAnchor}/>
        <p className="cal-sidebar-zone">Times shown in {zone.replace(/_/g, " ")}. You can change your time zone in Settings.</p>
      </aside>}
      <section className="cal-main" aria-label={searchResults ? "Search results" : `${VIEW_MODES.find((entry) => entry.id === mode)?.label} view`}>
        {searchResults ? <div className="cal-results">
          <div className="cal-results-head">
            <b>{searchState === "loading" ? "Searching…" : searchState === "error" ? "Search unavailable" : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"} for “${query.trim()}”`}</b>
            <button type="button" className="cal-link-button" onClick={() => setQuery("")}>Back to calendar</button>
          </div>
          {searchState === "error" ? <p className="cal-results-empty" role="alert">{searchError}</p>
            : searchResults.length === 0 && searchState !== "loading" ? <p className="cal-results-empty">No events have a title matching “{query.trim()}”.</p>
              : <ul>{searchResults.map((occurrence) => {
                const first = occurrenceDays(occurrence, zone).first;
                return <li key={occurrence.event.id}><button type="button" className="cal-result" onClick={() => { setQuery(""); setAnchor(first); setHighlightId(occurrence.event.id); }}>
                  <CategoryDot category={occurrence.event.category}/>
                  <span className="cal-result-main"><b>{occurrence.event.title}</b><small>{occurrenceDateLabel(occurrence, zone)} · {occurrenceTimeLabel(occurrence, zone)}{occurrence.event.location ? ` · ${occurrence.event.location}` : ""}</small></span>
                  {occurrence.recurring && <span className="cal-result-tag"><Repeat size={11} aria-hidden="true"/> {occurrence.exception ? "Changed occurrence" : "Next occurrence"}</span>}
                </button></li>;
              })}</ul>}
        </div> : <>
          {emptyRange && <p className="cal-empty-note" role="status">No events this {viewLabel === "day" ? "day" : viewLabel}. {mode === "month" ? "Click a day to add one." : "Click a time to add one."}</p>}
          {(mode === "week" || mode === "day") && <TimeGrid days={days} occurrences={occurrences} zone={zone} today={today} nowMs={nowMs} highlightId={highlightId} onCreate={openCreate} onSelect={(occurrence, rect) => { setQuick(null); setSelected({ occurrence, anchor: rect }); }} onOpenDay={openDay}/>}
          {mode === "month" && <MonthGrid from={range.from} to={range.to} month={anchor} occurrences={occurrences} zone={zone} today={today} highlightId={highlightId} onCreate={openCreate} onSelect={(occurrence, rect) => { setQuick(null); setSelected({ occurrence, anchor: rect }); }} onOpenDay={openDay}/>}
          {mode === "agenda" && (rangeReady || loadState !== "loading"
            ? <AgendaList from={range.from} to={range.to} occurrences={occurrences} zone={zone} today={today} nowMs={nowMs} highlightId={highlightId} onSelect={(occurrence, rect) => setSelected({ occurrence, anchor: rect })} onCreate={openNewEvent}/>
            : <div className="cal-agenda-loading" role="status">Loading events…</div>)}
        </>}
      </section>
    </div>

    {datePicker && <CalPopover anchor={datePicker} onClose={() => setDatePicker(null)} labelledBy="cal-datepicker-title" className="cal-datepicker">
      <h2 id="cal-datepicker-title" className="sr-only">Choose a date</h2>
      <MiniCalendar selected={anchor} today={today} rangeFrom={range.from} rangeTo={range.to} onSelect={(date) => { setAnchor(date); setDatePicker(null); }}/>
    </CalPopover>}

    {selected && <EventDetails
      occurrence={selected.occurrence} series={seriesFor(selected.occurrence)} zone={zone} anchor={selected.anchor} busy={busy}
      onEdit={() => startEdit(selected.occurrence)}
      onDelete={() => { if (selected.occurrence.recurring) { setScopePrompt({ action: "delete", occurrence: selected.occurrence }); setSelected(null); } else performDelete(selected.occurrence, null); }}
      onClose={() => setSelected(null)}
    />}

    {quick && <QuickCreate
      draft={quick.draft} anchor={quick.anchor} busy={busy} error={formError}
      onSave={(title) => void run(async () => { await createCalendarEvent(draftToInput({ ...quick.draft, title }, true)); return "Event created."; })}
      onMore={(title) => { setEditor({ mode: "create", scope: null, draft: { ...quick.draft, title }, target: null, occurrence: null, occurrenceKey: null, expectedRevision: null, seriesHasChanges: false }); setQuick(null); setFormError(null); }}
      onClose={() => { setQuick(null); setFormError(null); }}
    />}

    {editor && <EventEditor
      key={`${editor.mode}-${editor.target?.id || "new"}-${editor.scope}`}
      mode={editor.mode} scope={editor.scope} initialDraft={editor.draft} displayZone={zone} meta={meta} busy={busy}
      error={formError} errorField={null} seriesHasChanges={editor.seriesHasChanges}
      onSave={saveEditor}
      onDelete={editor.occurrence ? () => {
        const occurrence = editor.occurrence as Occurrence;
        const scope = editor.scope;
        setEditor(null); setFormError(null);
        if (occurrence.recurring && scope) setScopePrompt({ action: "delete", occurrence });
        else setConfirmDelete(occurrence);
      } : undefined}
      onClose={() => { setEditor(null); setFormError(null); }}
    />}

    {scopePrompt && <ScopeDialog action={scopePrompt.action} busy={busy}
      onClose={() => setScopePrompt(null)}
      onChoose={(scope) => {
        const { action, occurrence } = scopePrompt;
        if (action === "edit") void openEditor(occurrence, scope);
        else performDelete(occurrence, scope);
      }}
    />}

    {confirmDelete && <CalPopover anchor={null} onClose={() => setConfirmDelete(null)} labelledBy="cal-confirm-title" className="cal-scope">
      <h2 id="cal-confirm-title">Delete “{confirmDelete.event.title}”?</h2>
      <p className="cal-hint">This can’t be undone.</p>
      <div className="cal-popover-actions">
        <button type="button" className="quiet-button" onClick={() => setConfirmDelete(null)} disabled={busy} data-autofocus>Cancel</button>
        <button type="button" className="cal-danger-button" onClick={() => performDelete(confirmDelete, null)} disabled={busy}>{busy ? <><span className="spinner"/> Deleting…</> : "Delete"}</button>
      </div>
    </CalPopover>}
  </div>;
}
