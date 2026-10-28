import { useState } from "react";
import {
  AlarmClock,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  ExternalLink,
  FileStack,
  Folder,
  HandCoins,
  Heart,
  Lock,
  Minus,
  Plug,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { addDays, compareOccurrences, expandOccurrences, localDateOf } from "../../../cloudflare/calendar-rules.js";
import {
  completedSet,
  habitStreaks,
  isDueOn,
  isRepetitionHabit,
  isScheduledOn,
  repetitionsDone,
} from "../../../cloudflare/habit-rules.js";
import { SECTION_BY_ID } from "../../data";
import { iconToneClass } from "../../design-system";
import {
  QUICK_ACTION_DEFINITIONS,
  type DashboardWidgetInstance,
  type QuickActionId,
} from "../../lib/dashboard-api";
import { formatBytes, pageCountLabel } from "../../lib/pdf-studio";
import { categoryLabel as photoCategoryLabel, formatDimensions } from "../../lib/photo-studio";
import type {
  DigitalBusinessCard,
  MedicalRecord,
  NotesRecordKind,
  PersoraContact,
  SectionId,
  ShareNotification,
  VaultItem,
  ViewId,
} from "../../types";
import { Badge } from "../reui/badge";
import { FileType, getFileType } from "../reui/file-type";
import { IconTile } from "../reui/icon-tile";
import { Checkbox } from "../ui/checkbox";
import { Progress } from "../ui/progress";
import { DashboardWidget } from "./DashboardWidget";
import type { DashboardDataBundle } from "./useDashboardData";
import { QUICK_ACTION_VISUALS } from "./widget-icons";

export interface DashboardActionHandlers {
  onNavigate: (view: ViewId) => void;
  onNavigateCalendar: (date?: string) => void;
  onNavigateHabits: (date?: string) => void;
  onNavigateLoan: (loanId: string) => void;
  onNavigateProject: (projectId: string, fieldId?: string, taskId?: string) => void;
  onOpenItem: (item: VaultItem) => void;
  onAdd: (section: SectionId, initialMetadata?: Record<string, string>) => void;
  onAddDocument: () => void;
  onAddMedicalRecord: () => void;
  onAddTodo: (kind: NotesRecordKind) => void;
  onEditTodoItem: (item: VaultItem) => void;
  onToggleTodo: (item: VaultItem, completed: boolean) => void;
  onSaveQuickNote: (draft: { id?: string; title: string; content: string; tags?: string }) => Promise<VaultItem | void>;
}

export interface RenderWidgetCardProps {
  widget: DashboardWidgetInstance;
  index: number;
  totalCount: number;
  isEditing: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  items: VaultItem[];
  contacts: PersoraContact[];
  businessCards: DigitalBusinessCard[];
  medicalRecords: MedicalRecord[];
  projectNotifications: ShareNotification[];
  data: DashboardDataBundle;
  actions: DashboardActionHandlers;
  onConfigure: () => void;
  onResize: (patch: { width?: DashboardWidgetInstance["width"]; height?: DashboardWidgetInstance["height"] }) => void;
  onToggleCollapse: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragHandlePointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragHandleKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

// ---------------------------------------------------------------------------
// Date & formatting helpers
// ---------------------------------------------------------------------------
function daysFromToday(dateStr: string | undefined, todayStr: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const target = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`).getTime();
  const base = new Date(`${todayStr.slice(0, 10)}T12:00:00Z`).getTime();
  if (Number.isNaN(target) || Number.isNaN(base)) return null;
  return Math.round((target - base) / 86_400_000);
}

function shortDate(dateStr: string | undefined): string {
  if (!dateStr) return "No date";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function relativeDaysBadge(days: number): { label: string; variant: "destructive-light" | "warning-light" | "info-light" | "secondary" } {
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, variant: "destructive-light" };
  if (days === 0) return { label: "Today", variant: "warning-light" };
  if (days === 1) return { label: "Tomorrow", variant: "warning-light" };
  if (days <= 14) return { label: `In ${days}d`, variant: "warning-light" };
  if (days <= 45) return { label: `In ${days}d`, variant: "info-light" };
  return { label: `In ${days}d`, variant: "secondary" };
}

function expiryBadge(days: number): { label: string; variant: "destructive-light" | "warning-light" | "info-light" | "secondary" } {
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, variant: "destructive-light" };
  if (days === 0) return { label: "Expires today", variant: "destructive-light" };
  if (days <= 30) return { label: `${days}d left`, variant: "warning-light" };
  if (days <= 90) return { label: `${days}d left`, variant: "info-light" };
  return { label: `${days}d left`, variant: "secondary" };
}

function safeExternalHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function formatMoney(amount: number, currency = "BDT"): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${safe.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function nextReminderDate(item: VaultItem): Date | null {
  if (item.metadata.snoozedUntil) {
    const snoozed = new Date(item.metadata.snoozedUntil);
    if (!Number.isNaN(snoozed.getTime()) && snoozed.getTime() >= Date.now() - 86_400_000) return snoozed;
  }
  if (!item.metadata.reminderAt) return null;
  const d = new Date(item.metadata.reminderAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

function stripNoteHtml(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Quick Note subcomponent (stateful inline editor synced to real Notes)
// ---------------------------------------------------------------------------
function QuickNoteBody({
  widget,
  notes,
  onSaveQuickNote,
  onOpenNote,
}: {
  widget: DashboardWidgetInstance;
  notes: VaultItem[];
  onSaveQuickNote: DashboardActionHandlers["onSaveQuickNote"];
  onOpenNote: (note: VaultItem) => void;
}) {
  const pinnedId = String(widget.config.noteId || "");
  const pinnedNote = pinnedId ? notes.find((n) => n.id === pinnedId) || null : null;

  const [draftTitle, setDraftTitle] = useState(() => pinnedNote?.title || "");
  const [draftBody, setDraftBody] = useState(() => stripNoteHtml(pinnedNote?.metadata.content));
  const [saving, setSaving] = useState(false);
  const [lastSyncedId, setLastSyncedId] = useState(pinnedNote?.id || "");

  if ((pinnedNote?.id || "") !== lastSyncedId) {
    setLastSyncedId(pinnedNote?.id || "");
    setDraftTitle(pinnedNote?.title || "");
    setDraftBody(stripNoteHtml(pinnedNote?.metadata.content));
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = draftTitle.trim() || "Quick note";
    const cleanBody = draftBody.trim();
    if (!cleanBody && !pinnedNote) return;
    setSaving(true);
    try {
      await onSaveQuickNote({
        id: pinnedNote?.id,
        title: cleanTitle,
        content: cleanBody,
        tags: pinnedNote?.metadata.tags || "dashboard",
      });
      if (!pinnedNote) {
        setDraftTitle("");
        setDraftBody("");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-2.5">
      <input
        type="text"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        placeholder={pinnedNote ? "Note title" : "New note title…"}
        aria-label="Quick note title"
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground focus:border-primary focus:outline-none"
      />
      <textarea
        rows={3}
        value={draftBody}
        onChange={(e) => setDraftBody(e.target.value)}
        placeholder="Jot down a thought — saves directly to your Notes vault…"
        aria-label="Quick note content"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] text-foreground focus:border-primary focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        {pinnedNote ? (
          <button
            type="button"
            className="text-[11.5px] font-medium text-primary hover:underline"
            onClick={() => onOpenNote(pinnedNote)}
          >
            Open full note
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">Saves to Tasks &amp; Notes (Notes tab)</span>
        )}
        <button
          type="submit"
          disabled={saving || (!pinnedNote && !draftBody.trim())}
          className="main-add-button !h-7 !px-3 !text-xs disabled:opacity-50"
        >
          {saving ? "Saving…" : pinnedNote ? "Update note" : "Save note"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Habit Numeric Input Row
// ---------------------------------------------------------------------------
function NumericHabitControl({
  currentValue,
  target,
  unit,
  onSave,
}: {
  currentValue: number;
  target: number | null;
  unit: string;
  onSave: (val: number) => void;
}) {
  const [val, setVal] = useState(String(currentValue || ""));
  return (
    <div className="flex shrink-0 items-center gap-1">
      <input
        type="number"
        min={0}
        step="any"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={target ? `${target}` : "0"}
        aria-label={`Log ${unit || "value"}`}
        className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-xs text-foreground"
      />
      <button
        type="button"
        className="quiet-button !h-7 !px-2 !text-[11px]"
        onClick={() => {
          const parsed = Number(val);
          if (Number.isFinite(parsed) && parsed >= 0) onSave(parsed);
        }}
      >
        Log
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Widget Renderer across all 30 supported Widget Types
// ---------------------------------------------------------------------------
export function DashboardWidgetCard(props: RenderWidgetCardProps) {
  const {
    widget,
    index,
    totalCount,
    isEditing,
    isDragging,
    isDropTarget,
    items,
    contacts,
    businessCards,
    medicalRecords,
    projectNotifications,
    data,
    actions,
    onConfigure,
    onResize,
    onToggleCollapse,
    onDuplicate,
    onMoveUp,
    onMoveDown,
    onRemove,
    onDragHandlePointerDown,
    onDragHandleKeyDown,
  } = props;

  const cfg = widget.config;
  const today = data.today;
  const sharedShellProps = {
    widget,
    index,
    totalCount,
    isEditing,
    isDragging,
    isDropTarget,
    onConfigure,
    onResize,
    onToggleCollapse,
    onDuplicate,
    onMoveUp,
    onMoveDown,
    onRemove,
    onDragHandlePointerDown,
    onDragHandleKeyDown,
  };

  const runQuickAction = (actionId: QuickActionId) => {
    switch (actionId) {
      case "add-document":
        actions.onAddDocument();
        break;
      case "create-task":
        actions.onAddTodo("todo");
        break;
      case "add-calendar-event":
        actions.onNavigateCalendar(today);
        break;
      case "create-note":
        actions.onAdd("notes");
        break;
      case "add-reminder":
        actions.onAddTodo("reminder");
        break;
      case "add-habit":
        actions.onNavigateHabits(today);
        break;
      case "add-loan":
        actions.onNavigate("loans");
        break;
      case "open-photo-studio":
        actions.onNavigate("photo-studio");
        break;
      case "open-pdf-studio":
        actions.onNavigate("pdf-studio");
        break;
      case "open-projects":
        actions.onNavigate("projects");
        break;
      case "open-contacts":
        actions.onNavigate("contacts");
        break;
      case "open-tables":
        actions.onNavigate("tables");
        break;
    }
  };

  // ── 1. QUICK ACTIONS ───────────────────────────────────────────────────────
  if (widget.type === "quick-actions") {
    const actionIds = (Array.isArray(cfg.actions) ? cfg.actions : []) as QuickActionId[];
    const defs = actionIds
      .map((id) => QUICK_ACTION_DEFINITIONS.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const compact = cfg.layoutMode === "compact";
    const showDesc = cfg.showDescriptions !== false && !compact;

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle="Instant shortcuts across your workspace"
        isEmpty={defs.length === 0}
        emptyTitle="No shortcuts selected"
        emptyDescription="Configure this widget to pick your favorite workspace shortcuts."
      >
        <div
          className={
            compact
              ? "flex flex-wrap gap-2"
              : "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
          }
        >
          {defs.map((def) => {
            const vis = QUICK_ACTION_VISUALS[def.id];
            const Icon = vis.icon;
            return compact ? (
              <button
                key={def.id}
                type="button"
                onClick={() => runQuickAction(def.id)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <Icon size={13} className="text-primary" />
                <span>{def.label}</span>
              </button>
            ) : (
              <button
                key={def.id}
                type="button"
                onClick={() => runQuickAction(def.id)}
                className="ds-widget-row"
              >
                <IconTile variant="soft" size="sm" className={iconToneClass(vis.tone)} aria-hidden="true">
                  <Icon size={15} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                    {def.label}
                  </strong>
                  {showDesc && (
                    <small className="block truncate text-[11px] text-muted-foreground">{def.hint}</small>
                  )}
                </span>
                <ArrowUpRight size={14} className="shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 2. CALENDAR AGENDA (Today's Schedule) ──────────────────────────────────
  if (widget.type === "calendar-agenda") {
    const range = String(cfg.range || "today");
    const spanDays =
      range === "today" ? 1 : range === "next-3-days" ? 3 : range === "this-week" ? 7 : Number(cfg.customDays) || 7;
    const toDate = addDays(today, spanDays);
    const limit = Number(cfg.limit) || 6;

    if (data.calendar.accountRequired) {
      return (
        <DashboardWidget
          {...sharedShellProps}
          isEmpty
          emptyTitle="Sign in to sync your Calendar"
          emptyDescription="Persora Calendar events, appointments, and recurring schedules appear here when signed in."
          emptyAction={
            <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onNavigate("calendar")}>
              Open Calendar
            </button>
          }
          footerLabel="Open Calendar"
          onFooterAction={() => actions.onNavigate("calendar")}
        >
          {null}
        </DashboardWidget>
      );
    }

    const occurrences = expandOccurrences(data.calendar.data, today, toDate, data.timeZone)
      .filter((occ) => {
        if (cfg.itemType && cfg.itemType !== "all" && occ.event.itemType !== cfg.itemType) return false;
        if (cfg.category && cfg.category !== "all" && (occ.event.category || "other") !== cfg.category) return false;
        return true;
      })
      .sort(compareOccurrences);

    const visibleOccs = occurrences.slice(0, limit);
    const rangeSubtitle =
      range === "today"
        ? "Scheduled for today"
        : range === "next-3-days"
          ? "Next 3 days"
          : range === "this-week"
            ? "Next 7 days"
            : `Next ${spanDays} days`;

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle={rangeSubtitle}
        countBadge={occurrences.length}
        loading={data.calendar.loading}
        error={data.calendar.error}
        onRetry={data.calendar.retry}
        isEmpty={visibleOccs.length === 0}
        emptyTitle="Your schedule is clear"
        emptyDescription={`No events or appointments scheduled for ${rangeSubtitle.toLowerCase()}.`}
        emptyAction={
          <button
            type="button"
            className="quiet-button !h-8 !px-3 !text-xs"
            onClick={() => actions.onNavigateCalendar(today)}
          >
            <Plus size={13} /> Add calendar event
          </button>
        }
        footerLabel="View Calendar"
        onFooterAction={() => actions.onNavigateCalendar(today)}
      >
        <div className="space-y-2">
          {visibleOccs.map((occ) => {
            const occDate =
              occ.startDate ||
              (occ.startMs !== null ? localDateOf(occ.startMs, occ.event.timeZone || data.timeZone) : today);
            const timeText =
              occ.allDay || occ.startMs === null
                ? "All day"
                : new Date(occ.startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            return (
              <button
                key={`${occ.event.id}:${occ.key}`}
                type="button"
                className="ds-widget-row"
                onClick={() => actions.onNavigateCalendar(occDate)}
              >
                <IconTile
                  variant="soft"
                  size="xs"
                  className={occ.event.itemType === "appointment" ? "ds-tone-violet" : "ds-tone-blue"}
                  aria-hidden="true"
                >
                  <CalendarDays size={13} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                    {occ.event.title}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {shortDate(occDate)} · {timeText}
                    {cfg.showLocation !== false && occ.event.location ? ` · ${occ.event.location}` : ""}
                  </small>
                </span>
                <Badge variant="outline" size="xs" radius="full">
                  {occ.event.itemType === "appointment" ? "Appt" : occ.event.itemType === "task" ? "Task" : timeText}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 3. TASKS DUE (Vault Tasks + optional Calendar / Project Tasks) ─────────
  if (widget.type === "tasks-due") {
    const filter = String(cfg.filter || "all-active");
    const limit = Number(cfg.limit) || 6;
    const showPriority = cfg.showPriority !== false;

    type UnifiedTask = {
      key: string;
      title: string;
      dueDate: string;
      completed: boolean;
      priority: string;
      sourceLabel: string;
      onToggle: (next: boolean) => void;
      onOpen: () => void;
    };

    const unified: UnifiedTask[] = [];

    if (filter === "project") {
      const pid = String(cfg.projectId || "");
      const detail = pid ? data.projects.data.detailsById[pid] : undefined;
      if (detail) {
        const fieldDueById = new Map(detail.fields.map((f) => [f.id, f.due_date || ""]));
        for (const t of detail.tasks) {
          unified.push({
            key: `proj:${t.id}`,
            title: t.name,
            dueDate: fieldDueById.get(t.field_id) || detail.project.due_date || "",
            completed: t.status === "complete",
            priority: t.priority || "normal",
            sourceLabel: detail.project.name,
            onToggle: (next) => void data.toggleProjectTask(pid, t, next),
            onOpen: () => actions.onNavigateProject(pid, t.field_id, t.id),
          });
        }
      }
    } else {
      // Vault Tasks (strictly recordType === "todo")
      for (const item of items) {
        if (item.section !== "notes" || item.metadata.recordType !== "todo") continue;
        unified.push({
          key: `vault:${item.id}`,
          title: item.title,
          dueDate: item.metadata.dueDate || "",
          completed: item.metadata.completed === "true",
          priority: (item.metadata.priority || "normal").toLowerCase(),
          sourceLabel: "Tasks",
          onToggle: (next) => actions.onToggleTodo(item, next),
          onOpen: () => actions.onEditTodoItem(item),
        });
      }

      // Optional Calendar Tasks
      if (cfg.includeCalendarTasks !== false && !data.calendar.accountRequired) {
        for (const ev of data.calendar.data) {
          if (ev.itemType !== "task" || ev.status === "cancelled") continue;
          const dateStr = ev.allDay ? ev.startDate || "" : ev.startAt ? ev.startAt.slice(0, 10) : "";
          unified.push({
            key: `cal:${ev.id}`,
            title: ev.title,
            dueDate: dateStr,
            completed: Boolean(ev.completedAt),
            priority: "normal",
            sourceLabel: "Calendar",
            onToggle: (next) => void data.toggleCalendarTask(ev, next),
            onOpen: () => actions.onNavigateCalendar(dateStr || today),
          });
        }
      }
    }

    const filtered = unified.filter((t) => {
      const days = daysFromToday(t.dueDate, today);
      if (filter === "completed") return t.completed;
      if (filter === "project") return !t.completed;
      if (t.completed) return false;
      if (filter === "overdue") return days !== null && days < 0;
      if (filter === "due-today") return days === 0;
      if (filter === "upcoming") return days !== null && days > 0;
      return true;
    });

    const priorityWeight: Record<string, number> = { high: 3, urgent: 3, medium: 2, normal: 1, low: 0 };
    filtered.sort((a, b) => {
      if (cfg.sortBy === "priority-desc") {
        return (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
      }
      if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    const shown = filtered.slice(0, limit);
    const loading = filter === "project" && data.projects.loading;
    const error = filter === "project" ? data.projects.error : "";

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={filtered.length}
        loading={loading}
        error={error}
        onRetry={filter === "project" ? data.projects.retry : undefined}
        isEmpty={shown.length === 0}
        emptyTitle={
          filter === "project" && !cfg.projectId
            ? "Choose a project in Configure"
            : filter === "overdue"
              ? "No overdue tasks"
              : "All caught up on tasks"
        }
        emptyDescription="Create a task or adjust your task filter in widget settings."
        emptyAction={
          <button
            type="button"
            className="quiet-button !h-8 !px-3 !text-xs"
            onClick={() => actions.onAddTodo("todo")}
          >
            <Plus size={13} /> New task
          </button>
        }
        footerLabel={filter === "project" ? "Open Projects" : "All tasks"}
        onFooterAction={() => actions.onNavigate(filter === "project" ? "projects" : "notes")}
      >
        <div className="space-y-2">
          {shown.map((task) => {
            const days = daysFromToday(task.dueDate, today);
            const badge = days !== null ? relativeDaysBadge(days) : null;
            return (
              <div key={task.key} className="ds-widget-row">
                <Checkbox
                  checked={task.completed}
                  onCheckedChange={(val) => task.onToggle(Boolean(val))}
                  aria-label={`Mark "${task.title}" as ${task.completed ? "incomplete" : "complete"}`}
                />
                <button
                  type="button"
                  onClick={task.onOpen}
                  className="min-w-0 flex-1 text-left"
                >
                  <strong
                    className={`block truncate text-[12.5px] font-semibold ${
                      task.completed ? "line-through text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {task.title}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {task.sourceLabel}
                    {task.dueDate ? ` · Due ${shortDate(task.dueDate)}` : ""}
                  </small>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {showPriority && task.priority === "high" && (
                    <Badge variant="destructive-light" size="xs" radius="full">
                      High
                    </Badge>
                  )}
                  {badge && !task.completed && (
                    <Badge variant={badge.variant} size="xs" radius="full">
                      {badge.label}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 4. HABIT TRACKER ───────────────────────────────────────────────────────
  if (widget.type === "habit-tracker") {
    if (data.habits.accountRequired) {
      return (
        <DashboardWidget
          {...sharedShellProps}
          isEmpty
          emptyTitle="Sign in to track daily habits"
          emptyDescription="Persora Habit Tracker streaks, targets, and daily check-ins sync with your account."
          emptyAction={
            <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onNavigate("habits")}>
              Open Habit Tracker
            </button>
          }
          footerLabel="Open Habit Tracker"
          onFooterAction={() => actions.onNavigate("habits")}
        >
          {null}
        </DashboardWidget>
      );
    }

    const { habits, checkins, today: habitToday } = data.habits.data;
    const category = String(cfg.category || "all");
    const showCompleted = cfg.showCompleted !== false;
    const showStreaks = cfg.showStreaks !== false;
    const limit = Number(cfg.limit) || 8;

    const scheduledToday = habits.filter((h) => {
      if (category !== "all" && h.category !== category) return false;
      const done = completedSet(h, checkins.filter((c) => c.habitId === h.id));
      const scheduled = isScheduledOn(h, habitToday) || isDueOn(h, done, habitToday, habitToday);
      if (!scheduled) return false;
      if (!showCompleted && done.has(habitToday)) return false;
      return true;
    });

    const visibleHabits = scheduledToday.slice(0, limit);
    const doneCount = scheduledToday.filter((h) => {
      const done = completedSet(h, checkins.filter((c) => c.habitId === h.id));
      return done.has(habitToday);
    }).length;

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle={scheduledToday.length ? `${doneCount} of ${scheduledToday.length} completed today` : "Today's routine"}
        countBadge={scheduledToday.length}
        loading={data.habits.loading}
        error={data.habits.error}
        onRetry={data.habits.retry}
        isEmpty={visibleHabits.length === 0}
        emptyTitle="No habits scheduled right now"
        emptyDescription="Create a daily or weekly habit in Habit Tracker to check in right from your dashboard."
        emptyAction={
          <button
            type="button"
            className="quiet-button !h-8 !px-3 !text-xs"
            onClick={() => actions.onNavigateHabits(habitToday)}
          >
            <Plus size={13} /> Add habit
          </button>
        }
        footerLabel="Open Habit Tracker"
        onFooterAction={() => actions.onNavigateHabits(habitToday)}
      >
        <div className="space-y-2">
          {visibleHabits.map((habit) => {
            const habitCheckins = checkins.filter((c) => c.habitId === habit.id);
            const todayCheckin = habitCheckins.find((c) => c.date === habitToday);
            const done = completedSet(habit, habitCheckins);
            const isCompleted = done.has(habitToday);
            const streak = showStreaks ? habitStreaks(habit, done, habitToday).current : 0;
            const isRep = isRepetitionHabit(habit);

            return (
              <div key={habit.id} className="ds-widget-row">
                {habit.tracking === "check" ? (
                  <Checkbox
                    checked={isCompleted}
                    onCheckedChange={(val) => void data.checkinHabit(habit.id, { completed: Boolean(val) })}
                    aria-label={`Check in "${habit.name}"`}
                  />
                ) : null}

                <button
                  type="button"
                  onClick={() => actions.onNavigateHabits(habitToday)}
                  className="min-w-0 flex-1 text-left"
                >
                  <strong
                    className={`block truncate text-[12.5px] font-semibold ${
                      isCompleted ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {habit.name}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {habit.tracking === "numeric" && habit.targetValue
                      ? `Target: ${todayCheckin?.value || 0} / ${habit.targetValue} ${habit.unit || ""}`
                      : isCompleted
                        ? "Completed today"
                        : "Scheduled today"}
                    {streak > 0 ? ` · ${streak}d streak` : ""}
                  </small>
                </button>

                {habit.tracking === "numeric" && isRep ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="icon-button !h-6 !w-6"
                      aria-label={`Decrease ${habit.name}`}
                      disabled={(todayCheckin?.value || 0) <= 0}
                      onClick={() =>
                        void data.checkinHabit(habit.id, {
                          value: Math.max(0, repetitionsDone(habit, todayCheckin?.value || 0) - 1),
                        })
                      }
                    >
                      <Minus size={12} />
                    </button>
                    <Badge variant={isCompleted ? "success-light" : "outline"} size="xs" radius="full">
                      {repetitionsDone(habit, todayCheckin?.value || 0)}/{habit.targetValue || 1}
                    </Badge>
                    <button
                      type="button"
                      className="icon-button !h-6 !w-6"
                      aria-label={`Increase ${habit.name}`}
                      onClick={() =>
                        void data.checkinHabit(habit.id, {
                          value: repetitionsDone(habit, todayCheckin?.value || 0) + 1,
                        })
                      }
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                ) : habit.tracking === "numeric" ? (
                  <NumericHabitControl
                    currentValue={todayCheckin?.value || 0}
                    target={habit.targetValue}
                    unit={habit.unit}
                    onSave={(value) => void data.checkinHabit(habit.id, { value })}
                  />
                ) : isCompleted ? (
                  <Badge variant="success-light" size="xs" radius="full">
                    <Check size={11} /> Done
                  </Badge>
                ) : null}
              </div>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 5. UPCOMING REMINDERS (Strictly separate from Tasks and Notes) ─────────
  if (widget.type === "upcoming-reminders") {
    const windowDays = Number(cfg.windowDays) || 30;
    const includePaused = Boolean(cfg.includePaused);
    const limit = Number(cfg.limit) || 6;
    const nowMs = Date.now();
    const maxMs = nowMs + windowDays * 86_400_000;

    type ReminderEntry = {
      key: string;
      title: string;
      at: Date;
      paused: boolean;
      source: string;
      onOpen: () => void;
    };

    const entries: ReminderEntry[] = [];

    for (const item of items) {
      if (item.section !== "notes" || item.metadata.recordType !== "reminder") continue;
      const paused = item.metadata.enabled === "false";
      if (paused && !includePaused) continue;
      const next = nextReminderDate(item);
      if (!next) continue;
      if (next.getTime() < nowMs - 86_400_000 || next.getTime() > maxMs) continue;
      entries.push({
        key: `rem:${item.id}`,
        title: item.title,
        at: next,
        paused,
        source: "Reminder",
        onOpen: () => actions.onEditTodoItem(item),
      });
    }

    if (cfg.includeModuleReminders !== false && data.cloudActive) {
      for (const cr of data.moduleReminders.data.calendar) {
        const at = new Date(cr.remindAt);
        if (!Number.isNaN(at.getTime()) && at.getTime() <= maxMs) {
          entries.push({
            key: `calrem:${cr.id}`,
            title: cr.title,
            at,
            paused: false,
            source: "Calendar alert",
            onOpen: () => actions.onNavigateCalendar(cr.occurrenceDate || today),
          });
        }
      }
      for (const hr of data.moduleReminders.data.habits) {
        const at = new Date(hr.remindAt);
        if (!Number.isNaN(at.getTime()) && at.getTime() <= maxMs) {
          entries.push({
            key: `habrem:${hr.id}`,
            title: hr.habitName,
            at,
            paused: false,
            source: "Habit alert",
            onOpen: () => actions.onNavigateHabits(hr.localDate || today),
          });
        }
      }
    }

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    const shown = entries.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={entries.length}
        isEmpty={shown.length === 0}
        emptyTitle="No upcoming reminders"
        emptyDescription="Reminders stay separate from tasks and notes so timed alerts never get buried."
        emptyAction={
          <button
            type="button"
            className="quiet-button !h-8 !px-3 !text-xs"
            onClick={() => actions.onAddTodo("reminder")}
          >
            <BellRing size={13} /> Add reminder
          </button>
        }
        footerLabel="New reminder"
        onFooterAction={() => actions.onAddTodo("reminder")}
      >
        <div className="space-y-2">
          {shown.map((rem) => (
            <button key={rem.key} type="button" className="ds-widget-row" onClick={rem.onOpen}>
              <IconTile variant="soft" size="xs" className="ds-tone-amber" aria-hidden="true">
                <BellRing size={13} />
              </IconTile>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                  {rem.title}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {rem.source} · {rem.at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </small>
              </span>
              <Badge variant={rem.paused ? "secondary" : "warning-light"} size="xs" radius="full">
                <AlarmClock size={11} />
                {rem.paused
                  ? "Paused"
                  : rem.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </Badge>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 6. QUICK NOTE ──────────────────────────────────────────────────────────
  if (widget.type === "quick-note") {
    const plainNotes = items.filter(
      (i) => i.section === "notes" && !["todo", "reminder", "alarm"].includes(i.metadata.recordType || ""),
    );
    return (
      <DashboardWidget
        {...sharedShellProps}
        footerLabel="All notes"
        onFooterAction={() => actions.onNavigate("notes")}
      >
        <QuickNoteBody
          widget={widget}
          notes={plainNotes}
          onSaveQuickNote={actions.onSaveQuickNote}
          onOpenNote={actions.onOpenItem}
        />
      </DashboardWidget>
    );
  }

  // ── 7. RECENTLY OPENED (Real open/update timestamps only!) ─────────────────
  if (widget.type === "recently-opened") {
    const sectionFilter = String(cfg.sectionFilter || "all");
    const sourceMode = String(cfg.sourceMode || "opened-or-updated");
    const limit = Number(cfg.limit) || 6;
    const isGrid = cfg.displayMode === "grid";

    type RecentRow = {
      key: string;
      title: string;
      subtitle: string;
      timestamp: string;
      fileName?: string;
      onOpen: () => void;
    };

    const rows: RecentRow[] = [];
    const seen = new Set<string>();

    // 1. Real user-opened entries
    for (const open of data.recentOpens) {
      if (open.kind === "vault") {
        const found = items.find((i) => i.id === open.id);
        if (!found) continue;
        if (sectionFilter !== "all" && found.section !== sectionFilter) continue;
        seen.add(`vault:${found.id}`);
        rows.push({
          key: `vault:${found.id}`,
          title: found.title,
          subtitle: `${SECTION_BY_ID[found.section].label} · Opened ${shortDate(open.openedAt)}`,
          timestamp: open.openedAt,
          fileName: found.file?.name,
          onOpen: () => actions.onOpenItem(found),
        });
      } else if (open.kind === "contact" && (sectionFilter === "all" || sectionFilter === "contacts")) {
        const contact = contacts.find((c) => c.id === open.id);
        if (!contact) continue;
        seen.add(`contact:${contact.id}`);
        rows.push({
          key: `contact:${contact.id}`,
          title: contact.name,
          subtitle: `Contacts · Opened ${shortDate(open.openedAt)}`,
          timestamp: open.openedAt,
          onOpen: () => actions.onNavigate("contacts"),
        });
      } else if (open.kind === "business-card" && sectionFilter === "all") {
        const card = businessCards.find((b) => b.id === open.id);
        if (!card) continue;
        seen.add(`card:${card.id}`);
        rows.push({
          key: `card:${card.id}`,
          title: card.fullName,
          subtitle: `Business card · Opened ${shortDate(open.openedAt)}`,
          timestamp: open.openedAt,
          onOpen: () => actions.onNavigate("business-card"),
        });
      }
    }

    // 2. Supplement with real updatedAt records if sourceMode === "opened-or-updated"
    if (sourceMode === "opened-or-updated" && rows.length < limit) {
      const candidates = items
        .filter((i) => (sectionFilter === "all" || i.section === sectionFilter) && !seen.has(`vault:${i.id}`))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const item of candidates) {
        if (rows.length >= limit) break;
        rows.push({
          key: `vault:${item.id}`,
          title: item.title,
          subtitle: `${SECTION_BY_ID[item.section].label} · Updated ${shortDate(item.updatedAt)}`,
          timestamp: item.updatedAt,
          fileName: item.file?.name,
          onOpen: () => actions.onOpenItem(item),
        });
      }
    }

    const shown = rows.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={shown.length}
        isEmpty={shown.length === 0}
        emptyTitle="No recent activity yet"
        emptyDescription="Records you open or update in your vault will appear here automatically."
      >
        <div className={isGrid ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>
          {shown.map((entry) => (
            <button key={entry.key} type="button" className="ds-widget-row" onClick={entry.onOpen}>
              {entry.fileName ? (
                <FileType type={getFileType(entry.fileName)} size="mini" variant="light" aria-hidden />
              ) : (
                <IconTile variant="soft" size="xs" className="ds-tone-blue" aria-hidden="true">
                  <Sparkles size={12} />
                </IconTile>
              )}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                  {entry.title}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">{entry.subtitle}</small>
              </span>
              <ArrowUpRight size={14} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 8. PROJECT PROGRESS ────────────────────────────────────────────────────
  if (widget.type === "project-progress") {
    if (data.projects.accountRequired) {
      return (
        <DashboardWidget
          {...sharedShellProps}
          isEmpty
          emptyTitle="Sign in to view Projects"
          emptyDescription="Persora Projects boards, fields, and task progress sync with your Persora account."
          emptyAction={
            <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onNavigate("projects")}>
              Open Projects
            </button>
          }
        >
          {null}
        </DashboardWidget>
      );
    }

    const statusFilter = String(cfg.statusFilter || "all");
    const sortBy = String(cfg.sortBy || "updated");
    const limit = Number(cfg.limit) || 5;

    const projectProgressPct = (p: { stats: { fields: number; completed: number } }) =>
      p.stats.fields > 0 ? Math.round((p.stats.completed / p.stats.fields) * 100) : 0;

    const filtered = data.projects.data.projects
      .filter((p) => {
        const pct = projectProgressPct(p);
        if (statusFilter === "completed") return pct >= 100 && p.stats.fields > 0;
        if (statusFilter === "active") return pct < 100 || p.stats.fields === 0;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "progress") return projectProgressPct(b) - projectProgressPct(a);
        if (sortBy === "name") return a.name.localeCompare(b.name);
        return b.updated_at.localeCompare(a.updated_at);
      });

    const shown = filtered.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={filtered.length}
        loading={data.projects.loading}
        error={data.projects.error}
        onRetry={data.projects.retry}
        isEmpty={shown.length === 0}
        emptyTitle="No projects found"
        emptyDescription="Create a project to track milestones, fields, and collaborative tasks."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onNavigate("projects")}>
            Open Projects
          </button>
        }
        footerLabel="All projects"
        onFooterAction={() => actions.onNavigate("projects")}
      >
        <div className="space-y-2.5">
          {shown.map((proj) => {
            const pct = projectProgressPct(proj);
            return (
              <button
                key={proj.id}
                type="button"
                onClick={() => actions.onNavigateProject(proj.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-left transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-[12.5px] font-semibold text-foreground">{proj.name}</strong>
                  <Badge variant={pct >= 100 ? "success-light" : "primary-light"} size="xs" radius="full">
                    {pct}%
                  </Badge>
                </div>
                <Progress value={pct} aria-label={`${proj.name} completion`} />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {proj.stats.completed}/{proj.stats.fields} fields complete
                  </span>
                  <span>Updated {shortDate(proj.updated_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 9. RECENT PROJECT ACTIVITY ─────────────────────────────────────────────
  if (widget.type === "recent-project-activity") {
    const unreadOnly = Boolean(cfg.unreadOnly);
    const limit = Number(cfg.limit) || 6;
    const events = projectNotifications
      .filter((n) => !unreadOnly || !n.readAt)
      .slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={events.length}
        isEmpty={events.length === 0}
        emptyTitle="No recent project updates"
        emptyDescription="Real comments, task changes, and member updates from your projects appear here."
        footerLabel="Open Projects"
        onFooterAction={() => actions.onNavigate("projects")}
      >
        <div className="space-y-2">
          {events.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className="ds-widget-row"
              onClick={() =>
                ev.projectId
                  ? actions.onNavigateProject(ev.projectId, ev.fieldId, ev.taskId)
                  : actions.onNavigate("projects")
              }
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                  {ev.projectName || ev.actorName}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">{ev.message}</small>
              </span>
              <Badge variant={!ev.readAt ? "primary-light" : "secondary"} size="xs" radius="full">
                {shortDate(ev.createdAt)}
              </Badge>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 10. EXPIRING DOCUMENTS ─────────────────────────────────────────────────
  if (widget.type === "expiring-documents") {
    const warningDays = Number(cfg.warningDays) || 90;
    const includeExpired = Boolean(cfg.includeExpired);
    const docCategory = String(cfg.documentCategory || "all");
    const includeMemberships = cfg.includeMemberships !== false;
    const limit = Number(cfg.limit) || 6;

    const expiring = items
      .filter((item) => {
        if (item.section === "documents") {
          if (docCategory !== "all" && item.metadata.type !== docCategory) return false;
        } else if (item.section === "memberships") {
          if (!includeMemberships || docCategory !== "all") return false;
        } else {
          return false;
        }
        const days = daysFromToday(item.metadata.expiryDate, today);
        if (days === null) return false;
        if (days < 0 && !includeExpired) return false;
        return days <= warningDays;
      })
      .map((item) => ({
        item,
        days: daysFromToday(item.metadata.expiryDate, today)!,
      }))
      .sort((a, b) => a.days - b.days);

    const shown = expiring.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle={`Within ${warningDays} days`}
        countBadge={expiring.length}
        isEmpty={shown.length === 0}
        emptyTitle="No documents expiring soon"
        emptyDescription={`Nothing in your selected categories expires within the next ${warningDays} days.`}
        footerLabel="All documents"
        onFooterAction={() => actions.onNavigate("documents")}
      >
        <div className="space-y-2">
          {shown.map(({ item, days }) => {
            const badge = expiryBadge(days);
            return (
              <button key={item.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(item)}>
                {item.file ? (
                  <FileType type={getFileType(item.file.name)} size="mini" variant="light" aria-hidden />
                ) : (
                  <IconTile variant="soft" size="xs" className="ds-tone-rose" aria-hidden="true">
                    <CalendarClock size={13} />
                  </IconTile>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{item.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {item.metadata.type || SECTION_BY_ID[item.section].label} · Expires {shortDate(item.metadata.expiryDate)}
                  </small>
                </span>
                <Badge variant={badge.variant} size="xs" radius="full">
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 11. RECENT DOCUMENTS ───────────────────────────────────────────────────
  if (widget.type === "recent-documents") {
    const docCategory = String(cfg.documentCategory || "all");
    const sortBy = String(cfg.sortBy || "updated-desc");
    const limit = Number(cfg.limit) || 6;

    const docs = items
      .filter((i) => i.section === "documents" && (docCategory === "all" || i.metadata.type === docCategory))
      .sort((a, b) => {
        if (sortBy === "title-asc") return a.title.localeCompare(b.title);
        if (sortBy === "created-desc") return b.createdAt.localeCompare(a.createdAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    const shown = docs.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={docs.length}
        isEmpty={shown.length === 0}
        emptyTitle="No documents saved yet"
        emptyDescription="Upload or Smart Scan passports, IDs, and certificates into Documents."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={actions.onAddDocument}>
            <Plus size={13} /> Add document
          </button>
        }
        footerLabel="Open Documents"
        onFooterAction={() => actions.onNavigate("documents")}
      >
        <div className="space-y-2">
          {shown.map((doc) => {
            const days = cfg.showExpiry !== false ? daysFromToday(doc.metadata.expiryDate, today) : null;
            return (
              <button key={doc.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(doc)}>
                {doc.file ? (
                  <FileType type={getFileType(doc.file.name)} size="mini" variant="light" aria-hidden />
                ) : (
                  <IconTile variant="soft" size="xs" className="ds-tone-blue" aria-hidden="true">
                    <Sparkles size={12} />
                  </IconTile>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{doc.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {doc.metadata.type || "Document"}
                    {doc.metadata.documentNumber ? ` · ${doc.metadata.documentNumber}` : ""}
                  </small>
                </span>
                {days !== null && (
                  <Badge variant={expiryBadge(days).variant} size="xs" radius="full">
                    {expiryBadge(days).label}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 12. PINNED FOLDERS ─────────────────────────────────────────────────────
  if (widget.type === "pinned-folders") {
    const scopeFilter = String(cfg.scopeFilter || "all");
    const pinnedOnly = cfg.pinnedOnly !== false;
    const limit = Number(cfg.limit) || 8;

    const folders = data.folders.data
      .filter((f) => {
        if (pinnedOnly && !f.pinned) return false;
        if (scopeFilter !== "all" && f.scope !== scopeFilter) return false;
        return true;
      })
      .slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={folders.length}
        loading={data.folders.loading}
        error={data.folders.error}
        onRetry={data.folders.retry}
        isEmpty={folders.length === 0}
        emptyTitle={pinnedOnly ? "No pinned folders yet" : "No folders created yet"}
        emptyDescription="Pin folders inside Documents, Academics, Purchases, or Contacts for one-click access here."
        footerLabel="Browse Documents"
        onFooterAction={() => actions.onNavigate("documents")}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {folders.map((folder) => {
            const count =
              folder.scope === "contacts"
                ? contacts.filter((c) => c.folderId === folder.id).length
                : items.filter((i) => i.folderId === folder.id).length;
            const targetView = (folder.scope === "business-cards" ? "business-card" : folder.scope) as ViewId;
            return (
              <button
                key={folder.id}
                type="button"
                className="ds-widget-row"
                onClick={() => actions.onNavigate(targetView)}
              >
                <IconTile variant="soft" size="xs" className={iconToneClass(folder.color)} aria-hidden="true">
                  <Folder size={13} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{folder.name}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground capitalize">
                    {folder.scope.replace(/-/g, " ")}
                  </small>
                </span>
                <Badge variant="secondary" size="xs" radius="full">
                  {count}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 13. FAMILY DOCUMENT OVERVIEW ───────────────────────────────────────────
  if (widget.type === "family-document-overview") {
    const warningDays = Number(cfg.warningDays) || 90;
    const showSelf = cfg.showSelf !== false;
    const limit = Number(cfg.limit) || 6;
    const familyItems = items.filter((i) => i.section === "family");
    const docs = items.filter((i) => i.section === "documents");

    const groups: { id: string; name: string; relation: string; count: number; expiring: number; onOpen: () => void }[] = [];

    if (showSelf) {
      const myDocs = docs.filter((d) => !d.metadata.member || d.metadata.member === "Me" || d.metadata.member === "me");
      const myExpiring = myDocs.filter((d) => {
        const days = daysFromToday(d.metadata.expiryDate, today);
        return days !== null && days <= warningDays;
      }).length;
      groups.push({
        id: "self",
        name: "My documents",
        relation: "Personal",
        count: myDocs.length,
        expiring: myExpiring,
        onOpen: () => actions.onNavigate("documents"),
      });
    }

    for (const member of familyItems) {
      const memberDocs = docs.filter(
        (d) => d.metadata.member === member.id || d.metadata.member === member.title,
      );
      const expiringCount = memberDocs.filter((d) => {
        const days = daysFromToday(d.metadata.expiryDate, today);
        return days !== null && days <= warningDays;
      }).length;
      groups.push({
        id: member.id,
        name: member.title,
        relation: member.metadata.relationship || "Family member",
        count: memberDocs.length,
        expiring: expiringCount,
        onOpen: () => actions.onOpenItem(member),
      });
    }

    const shown = groups.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={groups.length}
        isEmpty={shown.length === 0}
        emptyTitle="No family records yet"
        emptyDescription="Add family members and link their passports, IDs, or insurance papers."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onAdd("family")}>
            <Plus size={13} /> Add family member
          </button>
        }
        footerLabel="Open Family"
        onFooterAction={() => actions.onNavigate("family")}
      >
        <div className="space-y-2">
          {shown.map((g) => (
            <button key={g.id} type="button" className="ds-widget-row" onClick={g.onOpen}>
              <IconTile variant="soft" size="xs" className="ds-tone-rose" aria-hidden="true">
                <Heart size={13} />
              </IconTile>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">{g.name}</strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {g.relation} · {g.count} document{g.count === 1 ? "" : "s"}
                </small>
              </span>
              {g.expiring > 0 ? (
                <Badge variant="warning-light" size="xs" radius="full">
                  {g.expiring} expiring
                </Badge>
              ) : (
                <Badge variant="secondary" size="xs" radius="full">
                  {g.count}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 14. ACADEMIC RECORDS SHORTCUTS ─────────────────────────────────────────
  if (widget.type === "academic-records") {
    const recType = String(cfg.recordType || "all");
    const showGrade = cfg.showGrade !== false;
    const limit = Number(cfg.limit) || 6;

    const records = items
      .filter((i) => i.section === "academics" && (recType === "all" || i.metadata.type === recType))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const shown = records.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={records.length}
        isEmpty={shown.length === 0}
        emptyTitle="No academic records"
        emptyDescription="Keep certificates, transcripts, degrees, and mark sheets organized."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onAdd("academics")}>
            <Plus size={13} /> Add academic record
          </button>
        }
        footerLabel="Open Academics"
        onFooterAction={() => actions.onNavigate("academics")}
      >
        <div className="space-y-2">
          {shown.map((rec) => (
            <button key={rec.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(rec)}>
              {rec.file ? (
                <FileType type={getFileType(rec.file.name)} size="mini" variant="light" aria-hidden />
              ) : (
                <IconTile variant="soft" size="xs" className="ds-tone-violet" aria-hidden="true">
                  <Sparkles size={12} />
                </IconTile>
              )}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">{rec.title}</strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {[rec.metadata.institution, rec.metadata.year].filter(Boolean).join(" · ") || rec.metadata.type || "Academic"}
                </small>
              </span>
              {showGrade && rec.metadata.grade && (
                <Badge variant="outline" size="xs" radius="full">
                  {rec.metadata.grade}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 15. WARRANTY EXPIRY ────────────────────────────────────────────────────
  if (widget.type === "warranty-expiry") {
    const warningDays = Number(cfg.warningDays) || 180;
    const includeExpired = Boolean(cfg.includeExpired);
    const limit = Number(cfg.limit) || 6;

    const warranties = items
      .filter((i) => i.section === "purchases")
      .map((item) => ({ item, days: daysFromToday(item.metadata.warrantyExpiry, today) }))
      .filter((entry): entry is { item: VaultItem; days: number } => {
        if (entry.days === null) return false;
        if (entry.days < 0 && !includeExpired) return false;
        return entry.days <= warningDays;
      })
      .sort((a, b) => a.days - b.days);

    const shown = warranties.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle={`Within ${warningDays} days`}
        countBadge={warranties.length}
        isEmpty={shown.length === 0}
        emptyTitle="No warranties expiring soon"
        emptyDescription="Purchases with upcoming warranty dates will appear here with invoice access."
        footerLabel="Purchases & warranty"
        onFooterAction={() => actions.onNavigate("purchases")}
      >
        <div className="space-y-2">
          {shown.map(({ item, days }) => {
            const badge = expiryBadge(days);
            return (
              <button key={item.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(item)}>
                {item.file ? (
                  <FileType type={getFileType(item.file.name)} size="mini" variant="light" aria-hidden />
                ) : (
                  <IconTile variant="soft" size="xs" className="ds-tone-amber" aria-hidden="true">
                    <CalendarClock size={13} />
                  </IconTile>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{item.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {[item.metadata.brand, item.metadata.seller].filter(Boolean).join(" · ") || "Purchase"} ·{" "}
                    {shortDate(item.metadata.warrantyExpiry)}
                  </small>
                </span>
                <Badge variant={badge.variant} size="xs" radius="full">
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 16. RECENT UPLOADS ─────────────────────────────────────────────────────
  if (widget.type === "recent-uploads") {
    const fileCat = String(cfg.fileCategory || "all");
    const limit = Number(cfg.limit) || 6;

    const uploaded = items
      .filter((i) => {
        if (!i.file) return false;
        if (fileCat === "all") return true;
        const mime = (i.file.type || "").toLowerCase();
        const name = (i.file.name || "").toLowerCase();
        const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
        const isImg = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(name);
        if (fileCat === "pdf") return isPdf;
        if (fileCat === "image") return isImg;
        return !isPdf && !isImg;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const shown = uploaded.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={uploaded.length}
        isEmpty={shown.length === 0}
        emptyTitle="No uploaded attachments yet"
        emptyDescription="Files and scans attached to your vault records appear here."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={actions.onAddDocument}>
            <Plus size={13} /> Add document
          </button>
        }
      >
        <div className="space-y-2">
          {shown.map((item) => (
            <button key={item.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(item)}>
              <FileType type={getFileType(item.file?.name || "")} size="mini" variant="light" aria-hidden />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                  {item.file?.name || item.title}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {item.title} · {SECTION_BY_ID[item.section].label}
                </small>
              </span>
              <Badge variant="secondary" size="xs" radius="full">
                {formatBytes(item.file?.size || 0)}
              </Badge>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 17. UPCOMING LOAN INSTALLMENTS ─────────────────────────────────────────
  if (widget.type === "upcoming-loan-installments") {
    if (data.loans.accountRequired) {
      return (
        <DashboardWidget
          {...sharedShellProps}
          isEmpty
          emptyTitle="Sign in to view Loan Tracker"
          emptyDescription="Persora Loan Tracker schedules, repayments, and overdue alerts sync with your account."
          emptyAction={
            <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onNavigate("loans")}>
              Open Loan Tracker
            </button>
          }
          footerLabel="Open Loan Tracker"
          onFooterAction={() => actions.onNavigate("loans")}
        >
          {null}
        </DashboardWidget>
      );
    }

    const direction = String(cfg.direction || "all");
    const windowDays = Number(cfg.windowDays) || 60;
    const limit = Number(cfg.limit) || 6;

    const dueLoans = data.loans.data.loans
      .filter((loan) => {
        if (loan.status !== "active" || !loan.summary?.next) return false;
        if (direction !== "all" && loan.direction !== direction) return false;
        const days = daysFromToday(loan.summary.next.dueDate, data.loans.data.today || today);
        return days !== null && days <= windowDays;
      })
      .sort((a, b) => (a.summary?.next?.dueDate || "").localeCompare(b.summary?.next?.dueDate || ""));

    const shown = dueLoans.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={dueLoans.length}
        loading={data.loans.loading}
        error={data.loans.error}
        onRetry={data.loans.retry}
        isEmpty={shown.length === 0}
        emptyTitle="No upcoming loan installments"
        emptyDescription={`No active loan installments due within ${windowDays} days.`}
        footerLabel="Open Loan Tracker"
        onFooterAction={() => actions.onNavigate("loans")}
      >
        <div className="space-y-2.5">
          {shown.map((loan) => {
            const next = loan.summary!.next!;
            const days = daysFromToday(next.dueDate, data.loans.data.today || today) ?? 0;
            const badge = relativeDaysBadge(days);
            const pct = Math.round((loan.summary?.progress || 0) * 100);
            return (
              <button
                key={loan.id}
                type="button"
                onClick={() => actions.onNavigateLoan(loan.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-left transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[12.5px] font-semibold text-foreground">{loan.name}</strong>
                    <small className="block truncate text-[11px] text-muted-foreground">
                      {loan.direction === "borrowed" ? "Borrowed from" : "Lent to"} {loan.partyName || "counterparty"} ·{" "}
                      {formatMoney(next.remaining, loan.currency)} due {shortDate(next.dueDate)}
                    </small>
                  </div>
                  <Badge variant={badge.variant} size="xs" radius="full">
                    {badge.label}
                  </Badge>
                </div>
                <Progress value={pct} aria-label={`${loan.name} repayment progress`} />
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 18. SUBSCRIPTION RENEWALS ──────────────────────────────────────────────
  if (widget.type === "subscription-renewals") {
    const cycleFilter = String(cfg.cycleFilter || "all");
    const windowDays = Number(cfg.windowDays) || 60;
    const includePastDue = cfg.includePastDue !== false;
    const limit = Number(cfg.limit) || 6;

    const subs = items
      .filter((i) => {
        if (i.section !== "subscriptions") return false;
        if (cycleFilter !== "all" && i.metadata.cycle !== cycleFilter) return false;
        const days = daysFromToday(i.metadata.renewalDate, today);
        if (days === null) return false;
        if (days < 0 && !includePastDue) return false;
        return days <= windowDays;
      })
      .map((item) => ({ item, days: daysFromToday(item.metadata.renewalDate, today)! }))
      .sort((a, b) => a.days - b.days);

    const shown = subs.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={subs.length}
        isEmpty={shown.length === 0}
        emptyTitle="No renewals in this window"
        emptyDescription="Track streaming, cloud, and utility plans in Subscriptions."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onAdd("subscriptions")}>
            <Plus size={13} /> Add subscription
          </button>
        }
        footerLabel="Open Subscriptions"
        onFooterAction={() => actions.onNavigate("subscriptions")}
      >
        <div className="space-y-2">
          {shown.map(({ item, days }) => {
            const badge = relativeDaysBadge(days);
            return (
              <button key={item.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(item)}>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{item.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {[item.metadata.price, item.metadata.cycle, `Renews ${shortDate(item.metadata.renewalDate)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <Badge variant={badge.variant} size="xs" radius="full">
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 19. COMBINED UPCOMING PAYMENTS (Loans + Subscriptions) ─────────────────
  if (widget.type === "combined-upcoming-payments") {
    const paymentSource = String(cfg.paymentSource || "all");
    const windowDays = Number(cfg.windowDays) || 45;
    const includeOverdue = cfg.includeOverdue !== false;
    const limit = Number(cfg.limit) || 6;

    type PaymentEntry = {
      key: string;
      kind: "loan" | "subscription";
      title: string;
      metaText: string;
      dueDate: string;
      days: number;
      onOpen: () => void;
    };

    const combined: PaymentEntry[] = [];

    if (paymentSource !== "loans-only") {
      for (const sub of items) {
        if (sub.section !== "subscriptions") continue;
        const days = daysFromToday(sub.metadata.renewalDate, today);
        if (days === null || days > windowDays || (days < 0 && !includeOverdue)) continue;
        combined.push({
          key: `sub:${sub.id}`,
          kind: "subscription",
          title: sub.title,
          metaText: [sub.metadata.price, sub.metadata.payment || sub.metadata.cycle].filter(Boolean).join(" · ") || "Subscription",
          dueDate: sub.metadata.renewalDate,
          days,
          onOpen: () => actions.onOpenItem(sub),
        });
      }
    }

    if (paymentSource !== "subscriptions-only" && !data.loans.accountRequired) {
      for (const loan of data.loans.data.loans) {
        if (loan.status !== "active" || !loan.summary?.next) continue;
        const next = loan.summary.next;
        const days = daysFromToday(next.dueDate, data.loans.data.today || today);
        if (days === null || days > windowDays || (days < 0 && !includeOverdue)) continue;
        combined.push({
          key: `loan:${loan.id}`,
          kind: "loan",
          title: loan.name,
          metaText: `${formatMoney(next.remaining, loan.currency)} · Installment #${next.number}`,
          dueDate: next.dueDate,
          days,
          onOpen: () => actions.onNavigateLoan(loan.id),
        });
      }
    }

    combined.sort((a, b) => a.days - b.days);
    const shown = combined.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        subtitle={`Next ${windowDays} days`}
        countBadge={combined.length}
        loading={paymentSource === "loans-only" && data.loans.loading}
        error={paymentSource === "loans-only" ? data.loans.error : ""}
        onRetry={paymentSource === "loans-only" ? data.loans.retry : undefined}
        isEmpty={shown.length === 0}
        emptyTitle="No upcoming payments due"
        emptyDescription="Loan installments and recurring subscription renewals appear together here."
        footerLabel={paymentSource === "loans-only" ? "Loan Tracker" : "Subscriptions"}
        onFooterAction={() => actions.onNavigate(paymentSource === "loans-only" ? "loans" : "subscriptions")}
      >
        <div className="space-y-2">
          {shown.map((entry) => {
            const badge = relativeDaysBadge(entry.days);
            return (
              <button key={entry.key} type="button" className="ds-widget-row" onClick={entry.onOpen}>
                <IconTile
                  variant="soft"
                  size="xs"
                  className={entry.kind === "loan" ? "ds-tone-amber" : "ds-tone-blue"}
                  aria-hidden="true"
                >
                  {entry.kind === "loan" ? <HandCoins size={13} /> : <CalendarClock size={13} />}
                </IconTile>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{entry.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {entry.metaText} · {shortDate(entry.dueDate)}
                  </small>
                </span>
                <Badge variant={badge.variant} size="xs" radius="full">
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 20. PAYMENT STATUS SUMMARY ─────────────────────────────────────────────
  if (widget.type === "payment-status-summary") {
    const windowDays = Number(cfg.windowDays) || 30;
    const subs = items.filter((i) => i.section === "subscriptions");
    const subsDueSoon = subs.filter((s) => {
      const d = daysFromToday(s.metadata.renewalDate, today);
      return d !== null && d <= windowDays;
    }).length;

    const activeLoans = data.loans.accountRequired
      ? []
      : data.loans.data.loans.filter((l) => l.status === "active");
    const overdueInstallments = activeLoans.reduce((sum, l) => sum + (l.summary?.overdueCount || 0), 0);

    const financeItems = cfg.showFinanceSummary !== false
      ? items.filter((i) => i.section === "personal-finance")
      : [];

    return (
      <DashboardWidget
        {...sharedShellProps}
        footerLabel="Open Personal Finance"
        onFooterAction={() => actions.onNavigate("personal-finance")}
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => actions.onNavigate("subscriptions")}
            className="rounded-xl border border-border bg-secondary/50 p-3 text-left hover:border-primary/40"
          >
            <span className="text-[11px] font-medium text-muted-foreground">Subscriptions</span>
            <strong className="mt-1 block text-lg font-bold text-foreground">{subs.length}</strong>
            <small className="text-[11px] text-muted-foreground">{subsDueSoon} due in {windowDays}d</small>
          </button>

          <button
            type="button"
            onClick={() => actions.onNavigate("loans")}
            className="rounded-xl border border-border bg-secondary/50 p-3 text-left hover:border-primary/40"
          >
            <span className="text-[11px] font-medium text-muted-foreground">Active loans</span>
            <strong className="mt-1 block text-lg font-bold text-foreground">
              {data.loans.accountRequired ? "—" : activeLoans.length}
            </strong>
            <small className="text-[11px] text-muted-foreground">
              {data.loans.accountRequired ? "Account sync" : `${overdueInstallments} overdue`}
            </small>
          </button>

          <button
            type="button"
            onClick={() => actions.onNavigate("purchases")}
            className="rounded-xl border border-border bg-secondary/50 p-3 text-left hover:border-primary/40"
          >
            <span className="text-[11px] font-medium text-muted-foreground">Purchases tracked</span>
            <strong className="mt-1 block text-lg font-bold text-foreground">
              {items.filter((i) => i.section === "purchases").length}
            </strong>
            <small className="text-[11px] text-muted-foreground">Invoices &amp; warranties</small>
          </button>

          <button
            type="button"
            onClick={() => actions.onNavigate("personal-finance")}
            className="rounded-xl border border-border bg-secondary/50 p-3 text-left hover:border-primary/40"
          >
            <span className="text-[11px] font-medium text-muted-foreground">Finance records</span>
            <strong className="mt-1 block text-lg font-bold text-foreground">{financeItems.length}</strong>
            <small className="text-[11px] text-muted-foreground">Income, expenses &amp; assets</small>
          </button>
        </div>
      </DashboardWidget>
    );
  }

  // ── 21. FAVORITE PERSONAL URLS ─────────────────────────────────────────────
  if (widget.type === "favorite-urls") {
    const urlCat = String(cfg.urlCategory || "all");
    const favOnly = Boolean(cfg.favoritesOnly);
    const limit = Number(cfg.limit) || 6;

    const links = items
      .filter((i) => {
        if (i.section !== "urls") return false;
        if (favOnly && !i.favorite) return false;
        if (urlCat !== "all" && i.metadata.urlCategory !== urlCat) return false;
        return true;
      })
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.updatedAt.localeCompare(a.updatedAt));

    const shown = links.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={links.length}
        isEmpty={shown.length === 0}
        emptyTitle="No saved links match"
        emptyDescription="Save personal portals, portfolios, and bookmarks in URL Manager."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onAdd("urls")}>
            <Plus size={13} /> Save URL
          </button>
        }
        footerLabel="URL Manager"
        onFooterAction={() => actions.onNavigate("urls")}
      >
        <div className="space-y-2">
          {shown.map((linkItem) => {
            const safeHref = safeExternalHref(linkItem.metadata.url);
            return (
              <div key={linkItem.id} className="ds-widget-row">
                <button
                  type="button"
                  onClick={() => actions.onOpenItem(linkItem)}
                  className="min-w-0 flex-1 text-left"
                >
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                    {linkItem.title}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {linkItem.metadata.urlCategory || linkItem.metadata.url || "Saved link"}
                  </small>
                </button>
                {safeHref && (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-button !h-7 !w-7"
                    aria-label={`Open ${linkItem.title} in new tab`}
                    title="Open link"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 22. DIGITAL MEMBERSHIP SHORTCUTS ───────────────────────────────────────
  if (widget.type === "digital-memberships") {
    const mType = String(cfg.membershipType || "all");
    const showMemberId = cfg.showMemberId !== false;
    const limit = Number(cfg.limit) || 6;

    const memberships = items
      .filter((i) => i.section === "memberships" && (mType === "all" || i.metadata.type === mType))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const shown = memberships.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={memberships.length}
        isEmpty={shown.length === 0}
        emptyTitle="No memberships saved"
        emptyDescription="Store library, gym, club, and loyalty cards in Membership Wallet."
        emptyAction={
          <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={() => actions.onAdd("memberships")}>
            <Plus size={13} /> Add membership
          </button>
        }
        footerLabel="Membership wallet"
        onFooterAction={() => actions.onNavigate("memberships")}
      >
        <div className="space-y-2">
          {shown.map((mem) => {
            const days = daysFromToday(mem.metadata.expiryDate, today);
            return (
              <button key={mem.id} type="button" className="ds-widget-row" onClick={() => actions.onOpenItem(mem)}>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{mem.title}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {[
                      mem.metadata.organization || mem.metadata.type,
                      showMemberId ? mem.metadata.memberId : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Membership"}
                  </small>
                </span>
                {days !== null ? (
                  <Badge variant={expiryBadge(days).variant} size="xs" radius="full">
                    {expiryBadge(days).label}
                  </Badge>
                ) : mem.metadata.level ? (
                  <Badge variant="outline" size="xs" radius="full">
                    {mem.metadata.level}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // ── 23. CONTACT SHORTCUTS ──────────────────────────────────────────────────
  if (widget.type === "contact-shortcuts") {
    const cat = String(cfg.category || "all");
    const favOnly = Boolean(cfg.favoritesOnly);
    const limit = Number(cfg.limit) || 6;

    const list = contacts
      .filter((c) => {
        if (favOnly && !c.favorite) return false;
        if (cat !== "all" && c.category !== cat) return false;
        return true;
      })
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name));

    const shown = list.slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={list.length}
        isEmpty={shown.length === 0}
        emptyTitle="No matching contacts"
        emptyDescription="Save family, emergency, work, or medical contacts in Persora Contacts."
        footerLabel="Open Contacts"
        onFooterAction={() => actions.onNavigate("contacts")}
      >
        <div className="space-y-2">
          {shown.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className="ds-widget-row"
              onClick={() => actions.onNavigate("contacts")}
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
                {contact.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">{contact.name}</strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {[contact.jobTitle, contact.company, contact.phoneNumbers[0]?.number || contact.email]
                    .filter(Boolean)
                    .join(" · ") || contact.category}
                </small>
              </span>
              <Badge variant="secondary" size="xs" radius="full">
                {contact.category}
              </Badge>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 24. PDF STUDIO SHORTCUT ────────────────────────────────────────────────
  if (widget.type === "pdf-studio-shortcut") {
    const limit = Number(cfg.limit) || 3;
    const docs = cfg.showRecentLibrary !== false ? data.pdfStudio.data.slice(0, limit) : [];

    return (
      <DashboardWidget
        {...sharedShellProps}
        loading={data.pdfStudio.loading}
        error={data.pdfStudio.error}
        onRetry={data.pdfStudio.retry}
        footerLabel="Open PDF Studio"
        onFooterAction={() => actions.onNavigate("pdf-studio")}
      >
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => actions.onNavigate("pdf-studio")}
            className="ds-widget-row"
          >
            <IconTile variant="soft" size="sm" className="ds-tone-violet" aria-hidden="true">
              <FileStack size={15} />
            </IconTile>
            <span className="min-w-0 flex-1">
              <strong className="block text-[12.5px] font-semibold text-foreground">Create, merge or edit PDF</strong>
              <small className="block truncate text-[11px] text-muted-foreground">
                Page organizer, watermarks &amp; PDF security
              </small>
            </span>
            <ArrowUpRight size={14} className="text-muted-foreground" />
          </button>

          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => actions.onNavigate("pdf-studio")}
              className="ds-widget-row"
            >
              <FileType type="pdf" size="mini" variant="light" aria-hidden />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12px] font-medium text-foreground">{doc.title}</strong>
                <small className="block truncate text-[10.5px] text-muted-foreground">
                  {pageCountLabel(doc.pageCount)} · {formatBytes(doc.fileSize)}
                </small>
              </span>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 25. PHOTO STUDIO SHORTCUT ──────────────────────────────────────────────
  if (widget.type === "photo-studio-shortcut") {
    const limit = Number(cfg.limit) || 3;
    const photos = cfg.showRecentLibrary !== false ? data.photoStudio.data.slice(0, limit) : [];

    return (
      <DashboardWidget
        {...sharedShellProps}
        loading={data.photoStudio.loading}
        error={data.photoStudio.error}
        onRetry={data.photoStudio.retry}
        footerLabel="Open Photo Studio"
        onFooterAction={() => actions.onNavigate("photo-studio")}
      >
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => actions.onNavigate("photo-studio")}
            className="ds-widget-row"
          >
            <span className="min-w-0 flex-1">
              <strong className="block text-[12.5px] font-semibold text-foreground">Prepare official photo</strong>
              <small className="block truncate text-[11px] text-muted-foreground">
                Passport, visa, ID card &amp; 300 DPI sizing
              </small>
            </span>
            <ArrowUpRight size={14} className="text-muted-foreground" />
          </button>

          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => actions.onNavigate("photo-studio")}
              className="ds-widget-row"
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12px] font-medium text-foreground">{photo.title}</strong>
                <small className="block truncate text-[10.5px] text-muted-foreground">
                  {photoCategoryLabel(photo.category)} · {formatDimensions(photo.width, photo.height)}
                </small>
              </span>
            </button>
          ))}
        </div>
      </DashboardWidget>
    );
  }

  // ── 26. MEDICAL RECORDS SHORTCUT (STRICT PRIVACY BY DEFAULT!) ──────────────
  if (widget.type === "medical-records-shortcut") {
    const showCount = Boolean(cfg.showRecordCount);
    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={showCount ? medicalRecords.length : null}
        footerLabel="Open Medical Records"
        onFooterAction={() => actions.onNavigate("medical-records")}
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/50 p-3">
            <IconTile variant="soft" size="xs" className="ds-tone-emerald" aria-hidden="true">
              <ShieldCheck size={13} />
            </IconTile>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Protected health archive. Diagnoses, prescriptions, and clinical notes are hidden on your dashboard for privacy.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={() => actions.onNavigate("medical-records")}
            >
              View archive
            </button>
            <button
              type="button"
              className="main-add-button !h-8 !px-3 !text-xs"
              onClick={actions.onAddMedicalRecord}
            >
              <Plus size={13} /> Add record
            </button>
          </div>
        </div>
      </DashboardWidget>
    );
  }

  // ── 27. PASSWORD VAULT STATUS (ZERO SECRETS EVER EXPOSED!) ─────────────────
  if (widget.type === "password-vault-status") {
    const status = data.passwordVault.data;
    const showCount = cfg.showRecordCount !== false;

    return (
      <DashboardWidget
        {...sharedShellProps}
        loading={data.passwordVault.loading}
        error={data.passwordVault.error}
        onRetry={data.passwordVault.retry}
        footerLabel="Open Password Manager"
        onFooterAction={() => actions.onNavigate("password-manager")}
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-secondary/50 p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconTile variant="soft" size="sm" className="ds-tone-emerald" aria-hidden="true">
                <Lock size={14} />
              </IconTile>
              <div className="min-w-0">
                <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                  {status?.hasVault ? "Locked · Master password required" : "Master password not set up"}
                </strong>
                <small className="block truncate text-[11px] text-muted-foreground">
                  {status?.hasVault
                    ? showCount
                      ? `${status.records} saved login${status.records === 1 ? "" : "s"} · Passwords never shown here`
                      : "Passwords & secrets are never displayed on dashboard"
                    : "Create a master password in Password Manager"}
                </small>
              </div>
            </div>
            <Badge variant={status?.hasVault ? "success-light" : "warning-light"} size="xs" radius="full">
              {status?.hasVault ? "Protected" : "Setup"}
            </Badge>
          </div>
        </div>
      </DashboardWidget>
    );
  }

  // ── 28. GOOGLE DRIVE CONNECTION STATUS ─────────────────────────────────────
  if (widget.type === "google-drive-status") {
    const drive = data.connections.data.find((p) => p.id === "google-drive");
    const status = drive?.status || "coming_soon";
    const statusBadge =
      status === "connected"
        ? { label: "Connected", variant: "success-light" as const }
        : status === "reauth_required"
          ? { label: "Reconnect needed", variant: "warning-light" as const }
          : status === "coming_soon"
            ? { label: "Coming soon", variant: "secondary" as const }
            : { label: "Not connected", variant: "outline" as const };

    return (
      <DashboardWidget
        {...sharedShellProps}
        loading={data.connections.loading}
        error={data.connections.error}
        onRetry={data.connections.retry}
        footerLabel="Manage Connections"
        onFooterAction={() => actions.onNavigate("connections")}
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-secondary/50 p-3">
            <div className="min-w-0">
              <strong className="block truncate text-[12.5px] font-semibold text-foreground">
                {drive?.name || "Google Drive"}
              </strong>
              <small className="block text-[11px] text-muted-foreground">
                {drive?.description || "Bring files from your Drive into Persora."}
              </small>
            </div>
            <Badge variant={statusBadge.variant} size="xs" radius="full">
              {statusBadge.label}
            </Badge>
          </div>
        </div>
      </DashboardWidget>
    );
  }

  // ── 29. EXTERNAL STORAGE STATUS ────────────────────────────────────────────
  if (widget.type === "external-storage-status") {
    const usage = data.storage.data;
    const rawPct = usage && usage.storageLimitBytes > 0 ? (usage.bytesUsed / usage.storageLimitBytes) * 100 : 0;
    const pct = Math.min(100, Math.max(0, Math.round(rawPct)));
    const storageProviders = data.connections.data.filter(
      (p) => p.category === "Storage" || p.id === "ems",
    );

    return (
      <DashboardWidget
        {...sharedShellProps}
        loading={data.storage.loading}
        error={data.storage.error}
        onRetry={data.storage.retry}
        footerLabel="Plans & storage"
        onFooterAction={() => actions.onNavigate("billing")}
      >
        <div className="space-y-3">
          {usage && (
            <div className="space-y-1.5 rounded-xl border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <strong className="font-semibold text-foreground">{usage.planName} storage</strong>
                <span className="text-muted-foreground">
                  {formatBytes(usage.bytesUsed)} of {usage.storageLimitGb} GB
                </span>
              </div>
              <Progress value={pct} aria-label="Vault storage usage" />
            </div>
          )}

          {cfg.showProviders !== false && storageProviders.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {storageProviders.map((prov) => (
                <button
                  key={prov.id}
                  type="button"
                  onClick={() => actions.onNavigate("connections")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary/40"
                >
                  <Plug size={11} className="text-primary" />
                  <span>{prov.name}</span>
                  <span className="text-muted-foreground">
                    · {prov.status === "connected" ? "Connected" : prov.status === "coming_soon" ? "Soon" : "Link"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DashboardWidget>
    );
  }

  // ── 30. CONNECTED SERVICE SHORTCUTS ────────────────────────────────────────
  if (widget.type === "connected-service-shortcuts") {
    const hideSoon = Boolean(cfg.hideComingSoon);
    const limit = Number(cfg.limit) || 5;
    const providers = data.connections.data
      .filter((p) => !hideSoon || p.status !== "coming_soon")
      .slice(0, limit);

    return (
      <DashboardWidget
        {...sharedShellProps}
        countBadge={providers.filter((p) => p.status === "connected").length}
        loading={data.connections.loading}
        error={data.connections.error}
        onRetry={data.connections.retry}
        isEmpty={providers.length === 0}
        emptyTitle="No active integrations"
        emptyDescription="Connect EMS Vaultium or inspect available external integrations in Connections."
        footerLabel="Open Connections"
        onFooterAction={() => actions.onNavigate("connections")}
      >
        <div className="space-y-2">
          {providers.map((prov) => {
            const badge =
              prov.status === "connected"
                ? { label: "Connected", variant: "success-light" as const }
                : prov.status === "reauth_required"
                  ? { label: "Reconnect", variant: "warning-light" as const }
                  : prov.status === "coming_soon"
                    ? { label: "Coming soon", variant: "secondary" as const }
                    : { label: "Available", variant: "outline" as const };
            return (
              <button
                key={prov.id}
                type="button"
                className="ds-widget-row"
                onClick={() => actions.onNavigate("connections")}
              >
                <IconTile variant="soft" size="xs" className="ds-tone-violet" aria-hidden="true">
                  <Plug size={13} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-semibold text-foreground">{prov.name}</strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {prov.connection?.account?.email
                      ? `${prov.connection.account.email}`
                      : prov.description}
                  </small>
                </span>
                <Badge variant={badge.variant} size="xs" radius="full">
                  {badge.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </DashboardWidget>
    );
  }

  // Fallback guard (exhaustively checked across all 30 DashboardWidgetType values)
  const fallbackTitle = widget.title || "Widget";
  return (
    <DashboardWidget {...sharedShellProps} isEmpty emptyTitle={fallbackTitle}>
      {null}
    </DashboardWidget>
  );
}
