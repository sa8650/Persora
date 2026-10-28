import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import { IconTile } from "../reui/icon-tile";
import { Checkbox } from "../ui/checkbox";
import { iconToneClass } from "../../design-system";
import type { ProjectSummary, VaultItem } from "../../types";
import {
  DASHBOARD_WIDGET_BY_TYPE,
  DASHBOARD_WIDGET_HEIGHTS,
  DASHBOARD_WIDGET_WIDTHS,
  QUICK_ACTION_DEFINITIONS,
  WIDTH_RANK,
  type DashboardWidgetHeight,
  type DashboardWidgetInstance,
  type DashboardWidgetWidth,
  type QuickActionId,
} from "../../lib/dashboard-api";
import { WIDGET_VISUALS } from "./widget-icons";

const FIELD_LABELS: Record<string, string> = {
  layoutMode: "Shortcut style",
  showDescriptions: "Show action descriptions",
  range: "Date window",
  customDays: "Custom range (days)",
  itemType: "Calendar item type",
  category: "Category filter",
  limit: "Maximum items shown",
  showLocation: "Show event locations",
  filter: "Task filter",
  projectId: "Selected project",
  includeCalendarTasks: "Include Calendar tasks",
  sortBy: "Sort order",
  showPriority: "Show priority badges",
  windowDays: "Lookahead window (days)",
  includePaused: "Include paused reminders",
  includeModuleReminders: "Include Calendar, Habit & Loan alerts",
  showCompleted: "Show completed habits today",
  showStreaks: "Show streak badges",
  noteId: "Pinned vault note",
  showTags: "Show note tags",
  sectionFilter: "Vault space filter",
  sourceMode: "Activity source",
  displayMode: "Layout mode",
  statusFilter: "Project status",
  unreadOnly: "Unread updates only",
  warningDays: "Expiry warning window (days)",
  includeExpired: "Include already expired items",
  documentCategory: "Document category",
  includeMemberships: "Include expiring memberships",
  showExpiry: "Show expiry badges",
  scopeFilter: "Folder space",
  pinnedOnly: "Show pinned folders only",
  showSelf: "Include my own documents",
  recordType: "Academic record type",
  showGrade: "Show grade / result",
  fileCategory: "Attachment file type",
  direction: "Loan direction",
  cycleFilter: "Billing cycle",
  includePastDue: "Include past-due renewals",
  paymentSource: "Payment types included",
  includeOverdue: "Include overdue obligations",
  showFinanceSummary: "Include Personal Finance overview",
  urlCategory: "Link category",
  favoritesOnly: "Favorites only",
  membershipType: "Membership category",
  showMemberId: "Show member ID",
  showRecentLibrary: "Show recent Studio items",
  showRecordCount: "Display total record count badge",
  showCapabilities: "Show integration capabilities",
  showProviders: "Show linked external storage providers",
  hideComingSoon: "Hide upcoming integrations",
};

const OPTION_LABELS: Record<string, string> = {
  all: "All",
  tiles: "Standard tiles",
  compact: "Compact pills",
  today: "Today",
  "next-3-days": "Next 3 days",
  "this-week": "This week",
  custom: "Custom days",
  event: "Events only",
  appointment: "Appointments only",
  task: "Tasks only",
  "all-active": "All active tasks",
  overdue: "Overdue only",
  "due-today": "Due today",
  upcoming: "Upcoming",
  completed: "Completed",
  project: "Specific project",
  "due-asc": "Due date (soonest first)",
  "priority-desc": "Priority (highest first)",
  "updated-desc": "Recently updated",
  "created-desc": "Recently created",
  "title-asc": "Title (A–Z)",
  "opened-or-updated": "Recently opened or updated",
  "opened-only": "Opened in this browser only",
  list: "List rows",
  grid: "Compact cards",
  active: "In progress",
  updated: "Last updated",
  progress: "Completion %",
  name: "Name (A–Z)",
  borrowed: "Borrowed (I owe)",
  lent: "Lent (Owed to me)",
  "loans-only": "Loan installments only",
  "subscriptions-only": "Subscriptions only",
  "personal-finance": "Personal Finance",
};

const WIDTH_LABELS: Record<DashboardWidgetWidth, string> = {
  compact: "Compact (1/3 desktop)",
  half: "Half width (1/2 desktop)",
  "two-thirds": "Wide (2/3 desktop)",
  full: "Full width",
};

const HEIGHT_LABELS: Record<DashboardWidgetHeight, string> = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
};

export interface WidgetConfigModalProps {
  widget: DashboardWidgetInstance | null;
  projects: ProjectSummary[];
  notes: VaultItem[];
  onClose: () => void;
  onSave: (
    id: string,
    patch: {
      title: string;
      width: DashboardWidgetWidth;
      height: DashboardWidgetHeight;
      collapsed: boolean;
      config: Record<string, unknown>;
    },
  ) => void;
}

export function WidgetConfigModal({
  widget,
  projects,
  notes,
  onClose,
  onSave,
}: WidgetConfigModalProps) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [width, setWidth] = useState<DashboardWidgetWidth>("half");
  const [height, setHeight] = useState<DashboardWidgetHeight>("standard");
  const [collapsed, setCollapsed] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title);
    setWidth(widget.width);
    setHeight(widget.height);
    setCollapsed(widget.collapsed);
    setConfig({
      ...widget.config,
      ...(Array.isArray(widget.config.actions)
        ? { actions: [...(widget.config.actions as string[])] }
        : {}),
    });
  }, [widget]);

  useEffect(() => {
    if (!widget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [widget, onClose]);

  if (!widget) return null;

  const meta = DASHBOARD_WIDGET_BY_TYPE[widget.type];
  const visual = WIDGET_VISUALS[widget.type];
  const Icon = visual.icon;

  const setField = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave(widget.id, {
      title: title.trim() || meta.defaultTitle,
      width,
      height,
      collapsed,
      config,
    });
    onClose();
  };

  const activeQuickActions = Array.isArray(config.actions)
    ? (config.actions as QuickActionId[])
    : [];

  const toggleQuickAction = (actionId: QuickActionId, checked: boolean) => {
    if (checked) {
      if (!activeQuickActions.includes(actionId)) {
        setField("actions", [...activeQuickActions, actionId]);
      }
    } else if (activeQuickActions.length > 1) {
      setField(
        "actions",
        activeQuickActions.filter((entry) => entry !== actionId),
      );
    }
  };

  const moveQuickAction = (actionId: QuickActionId, delta: -1 | 1) => {
    const idx = activeQuickActions.indexOf(actionId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= activeQuickActions.length) return;
    const next = [...activeQuickActions];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setField("actions", next);
  };

  return (
    <ModalPortal>
      <div
        className="modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <form
          className="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onSubmit={handleSubmit}
          style={{ maxWidth: 560 }}
        >
          <div className="modal-head">
            <div className="flex items-center gap-3">
              <IconTile variant="soft" size="default" className={iconToneClass(visual.tone)} aria-hidden="true">
                <Icon size={16} />
              </IconTile>
              <div>
                <h2 id={titleId}>Configure {meta.name}</h2>
                <p>Customize display size, filters, and visible fields for this widget.</p>
              </div>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close configuration">
              <X size={16} />
            </button>
          </div>

          <div className="modal-body max-h-[62vh] space-y-4 overflow-y-auto pr-1">
            <label className="field-label">
              Widget title <span className="required-star">*</span>
              <input
                type="text"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={meta.defaultTitle}
                required
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="field-label">
                Desktop width
                <select value={width} onChange={(e) => setWidth(e.target.value as DashboardWidgetWidth)}>
                  {DASHBOARD_WIDGET_WIDTHS.map((wOpt) => {
                    const disabled = WIDTH_RANK[wOpt] < WIDTH_RANK[meta.minWidth];
                    return (
                      <option key={wOpt} value={wOpt} disabled={disabled}>
                        {WIDTH_LABELS[wOpt]}{disabled ? " (too narrow)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="field-label">
                Widget height
                <select value={height} onChange={(e) => setHeight(e.target.value as DashboardWidgetHeight)}>
                  {DASHBOARD_WIDGET_HEIGHTS.map((hOpt) => (
                    <option key={hOpt} value={hOpt}>
                      {HEIGHT_LABELS[hOpt]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {Object.entries(meta.schema).map(([key, rule]) => {
              // Special rich selector for Quick Actions shortcuts
              if (widget.type === "quick-actions" && key === "actions") {
                return (
                  <div key={key} className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Active shortcuts ({activeQuickActions.length})
                      </span>
                      <span className="text-[11px] text-muted-foreground">Check to include · Arrows to reorder</span>
                    </div>
                    <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                      {[
                        ...activeQuickActions
                          .map((id) => QUICK_ACTION_DEFINITIONS.find((d) => d.id === id))
                          .filter(Boolean),
                        ...QUICK_ACTION_DEFINITIONS.filter((d) => !activeQuickActions.includes(d.id)),
                      ].map((def) => {
                        if (!def) return null;
                        const checked = activeQuickActions.includes(def.id);
                        const idx = activeQuickActions.indexOf(def.id);
                        return (
                          <div
                            key={def.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(val) => toggleQuickAction(def.id, Boolean(val))}
                              />
                              <span className="truncate font-medium text-foreground">{def.label}</span>
                            </label>
                            {checked && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="icon-button !h-6 !w-6"
                                  disabled={idx <= 0}
                                  onClick={() => moveQuickAction(def.id, -1)}
                                  aria-label={`Move ${def.label} earlier`}
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button !h-6 !w-6"
                                  disabled={idx >= activeQuickActions.length - 1}
                                  onClick={() => moveQuickAction(def.id, 1)}
                                  aria-label={`Move ${def.label} later`}
                                >
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Hide customDays unless range === "custom"
              if (widget.type === "calendar-agenda" && key === "customDays" && config.range !== "custom") {
                return null;
              }

              // Project dropdown for tasks-due
              if (widget.type === "tasks-due" && key === "projectId") {
                if (config.filter !== "project") return null;
                return (
                  <label key={key} className="field-label">
                    {FIELD_LABELS[key] || key}
                    <select
                      value={String(config.projectId || "")}
                      onChange={(e) => setField("projectId", e.target.value)}
                    >
                      <option value="">Select a project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              // Note dropdown for quick-note
              if (widget.type === "quick-note" && key === "noteId") {
                return (
                  <label key={key} className="field-label">
                    {FIELD_LABELS[key] || key}
                    <select
                      value={String(config.noteId || "")}
                      onChange={(e) => setField("noteId", e.target.value)}
                    >
                      <option value="">Quick capture (create new note)</option>
                      {notes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              const label = FIELD_LABELS[key] || key;

              if (rule.kind === "enum") {
                return (
                  <label key={key} className="field-label">
                    {label}
                    <select
                      value={String(config[key] ?? meta.defaultConfig[key])}
                      onChange={(e) => setField(key, e.target.value)}
                    >
                      {rule.values.map((val) => (
                        <option key={val} value={val}>
                          {OPTION_LABELS[val] || val.charAt(0).toUpperCase() + val.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (rule.kind === "int") {
                return (
                  <label key={key} className="field-label">
                    {label}{" "}
                    <small>
                      ({rule.min}–{rule.max})
                    </small>
                    <input
                      type="number"
                      min={rule.min}
                      max={rule.max}
                      value={Number(config[key] ?? meta.defaultConfig[key])}
                      onChange={(e) => setField(key, Number(e.target.value))}
                    />
                  </label>
                );
              }

              if (rule.kind === "boolean") {
                const checked = Boolean(config[key] ?? meta.defaultConfig[key]);
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-[12.5px] font-medium text-foreground"
                  >
                    <span>{label}</span>
                    <Checkbox checked={checked} onCheckedChange={(val) => setField(key, Boolean(val))} />
                  </label>
                );
              }

              return null;
            })}

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-[12.5px] font-medium text-foreground">
              <span>Collapse widget body by default</span>
              <Checkbox checked={collapsed} onCheckedChange={(val) => setCollapsed(Boolean(val))} />
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="main-add-button">
              <SlidersHorizontal size={15} /> Save widget settings
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
