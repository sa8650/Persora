import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  LayoutGrid,
  LayoutTemplate,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { PersoraEmptyState } from "../../design-system";
import { DASHBOARD_PRESET_BY_ID, type DashboardWidgetInstance } from "../../lib/dashboard-api";
import type {
  AppUser,
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
import { Spinner } from "../ui/spinner";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardWidgetCard, type DashboardActionHandlers } from "./DashboardWidgetContent";
import { PresetConfirmModal } from "./PresetConfirmModal";
import { useDashboardData } from "./useDashboardData";
import { useDashboardLayout, type DashboardSaveState } from "./useDashboardLayout";
import { WidgetConfigModal } from "./WidgetConfigModal";
import { WidgetLibraryModal } from "./WidgetLibraryModal";

function buildGreeting(fullName: string): string {
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = fullName.trim().split(/\s+/)[0] || "there";
  return `${salutation}, ${first}`;
}

export interface CustomizableDashboardProps {
  user: AppUser;
  items: VaultItem[];
  contacts: PersoraContact[];
  businessCards: DigitalBusinessCard[];
  medicalRecords: MedicalRecord[];
  projectNotifications: ShareNotification[];
  notify: (message: string, kind?: "success" | "error") => void;
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

function SaveStatusPill({
  saveState,
  saveError,
  onRetry,
}: {
  saveState: DashboardSaveState;
  saveError: string;
  onRetry: () => void;
}) {
  if (saveState === "saving") {
    return (
      <Badge variant="info-light" size="sm" radius="full" role="status" aria-live="polite">
        <Spinner className="size-3 text-primary" />
        <span>Saving…</span>
      </Badge>
    );
  }
  if (saveState === "saved") {
    return (
      <Badge variant="success-light" size="sm" radius="full" role="status" aria-live="polite">
        <Check size={12} />
        <span>Saved</span>
      </Badge>
    );
  }
  if (saveState === "error") {
    return (
      <span className="inline-flex items-center gap-1.5" role="alert">
        <Badge variant="destructive-light" size="sm" radius="full" title={saveError}>
          <AlertTriangle size={12} />
          <span>Save Failed</span>
        </Badge>
        <button type="button" className="quiet-button !h-7 !px-2.5 !text-xs" onClick={onRetry}>
          <RefreshCw size={12} /> Retry
        </button>
      </span>
    );
  }
  if (saveState === "local") {
    return (
      <Badge variant="secondary" size="sm" radius="full">
        <span>Saved on device</span>
      </Badge>
    );
  }
  return null;
}

export default function CustomizableDashboardView(props: CustomizableDashboardProps) {
  const {
    user,
    items,
    contacts,
    businessCards,
    medicalRecords,
    projectNotifications,
    notify,
    onNavigate,
    onNavigateCalendar,
    onNavigateHabits,
    onNavigateLoan,
    onNavigateProject,
    onOpenItem,
    onAdd,
    onAddDocument,
    onAddMedicalRecord,
    onAddTodo,
    onEditTodoItem,
    onToggleTodo,
    onSaveQuickNote,
  } = props;

  const layout = useDashboardLayout(user, notify);
  const data = useDashboardData(user, layout.widgets, items, notify);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [presetModalMode, setPresetModalMode] = useState<"presets" | "reset" | null>(null);

  const configuringWidget: DashboardWidgetInstance | null = useMemo(
    () => layout.allWidgets.find((w) => w.id === configuringId) || null,
    [configuringId, layout.allWidgets],
  );

  const plainNotes = useMemo(
    () =>
      items.filter(
        (i) => i.section === "notes" && !["todo", "reminder", "alarm"].includes(i.metadata.recordType || ""),
      ),
    [items],
  );

  const actions: DashboardActionHandlers = useMemo(
    () => ({
      onNavigate,
      onNavigateCalendar,
      onNavigateHabits,
      onNavigateLoan,
      onNavigateProject,
      onOpenItem,
      onAdd,
      onAddDocument,
      onAddMedicalRecord,
      onAddTodo,
      onEditTodoItem,
      onToggleTodo,
      onSaveQuickNote,
    }),
    [
      onNavigate,
      onNavigateCalendar,
      onNavigateHabits,
      onNavigateLoan,
      onNavigateProject,
      onOpenItem,
      onAdd,
      onAddDocument,
      onAddMedicalRecord,
      onAddTodo,
      onEditTodoItem,
      onToggleTodo,
      onSaveQuickNote,
    ],
  );

  const formattedDate = useMemo(
    () =>
      new Date().toLocaleDateString("en", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [],
  );

  const activePresetLabel =
    layout.activePreset !== "custom" && DASHBOARD_PRESET_BY_ID[layout.activePreset]
      ? DASHBOARD_PRESET_BY_ID[layout.activePreset].name
      : "Custom";

  return (
    <div className="dashboard-view space-y-4">
      {/* Header: Personalized Greeting + Date + Dashboard Actions */}
      <div className="dashboard-welcome-row">
        <div>
          <div className="welcome-overline">
            <span className="welcome-spark">
              <Sparkles size={13} />
            </span>
            <span>Personal command center · {formattedDate}</span>
          </div>
          <h2>
            {buildGreeting(user.fullName)}
            <span className="greeting-period">.</span>
          </h2>
        </div>

        <div className="welcome-actions flex flex-wrap items-center gap-2">
          <SaveStatusPill
            saveState={layout.saveState}
            saveError={layout.saveError}
            onRetry={layout.retrySave}
          />

          {!layout.isEditing && (
            <>
              <button
                type="button"
                className="quiet-button"
                onClick={() => setPresetModalMode("presets")}
                aria-label="Choose dashboard preset"
              >
                <LayoutTemplate size={15} />
                <span>Presets · {activePresetLabel}</span>
              </button>

              {layout.customized && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setPresetModalMode("reset")}
                >
                  <RotateCcw size={15} />
                  <span>Reset Dashboard</span>
                </button>
              )}

              <button
                type="button"
                className="quiet-button"
                onClick={layout.enterEditMode}
              >
                <Pencil size={15} />
                <span>Edit Dashboard</span>
              </button>

              <button
                type="button"
                className="main-add-button"
                onClick={() => setLibraryOpen(true)}
              >
                <Plus size={16} />
                <span>Add Widget</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dedicated Edit Dashboard Toolbar */}
      {layout.isEditing && (
        <div className="ds-dashboard-edit-bar" role="region" aria-label="Edit dashboard toolbar">
          <div className="flex min-w-0 items-center gap-2.5">
            <Badge variant="primary-light" size="sm" radius="full">
              Editing layout
            </Badge>
            <span className="text-xs text-muted-foreground">
              Drag handles or press arrow keys to reorder · Choose width (1/3, 1/2, 2/3, Full) · Configure or remove any widget.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={() => setLibraryOpen(true)}
            >
              <Plus size={14} /> Add Widget
            </button>
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={() => setPresetModalMode("presets")}
            >
              <LayoutTemplate size={14} /> Presets
            </button>
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={() => setPresetModalMode("reset")}
            >
              <RotateCcw size={14} /> Reset Dashboard
            </button>
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={layout.cancelEditMode}
            >
              <X size={14} /> Cancel
            </button>
            <button
              type="button"
              className="main-add-button !h-8 !px-3.5 !text-xs"
              onClick={() => void layout.saveAndExitEditMode()}
            >
              <Check size={14} /> Done
            </button>
          </div>
        </div>
      )}

      {/* Cross-device Conflict Resolution Banner */}
      {layout.saveState === "conflict" && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-card p-3.5"
          role="alert"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
            <div className="text-xs">
              <strong className="font-semibold text-foreground">
                Your dashboard was updated on another device or browser tab.
              </strong>{" "}
              <span className="text-muted-foreground">
                Choose whether to keep your current edits or load the latest saved version.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="quiet-button !h-8 !px-3 !text-xs"
              onClick={layout.resolveConflictReloadServer}
            >
              Load latest from account
            </button>
            <button
              type="button"
              className="main-add-button !h-8 !px-3 !text-xs"
              onClick={layout.resolveConflictKeepMine}
            >
              Keep my layout
            </button>
          </div>
        </div>
      )}

      {/* Dashboard Body */}
      {layout.saveState === "loading" && !layout.customized && layout.widgets.length === 0 ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-border bg-card py-16 text-sm text-muted-foreground">
          <Spinner className="size-4 text-primary" />
          <span>Loading your personalized dashboard…</span>
        </div>
      ) : layout.widgets.length === 0 ? (
        <PersoraEmptyState
          icon={<LayoutGrid size={20} />}
          title="Your dashboard is empty"
          description="Add widgets from the Widget Library or start with one of Persora's curated dashboard presets."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="main-add-button" onClick={() => setLibraryOpen(true)}>
                <Plus size={15} /> Add Widget
              </button>
              <button type="button" className="quiet-button" onClick={() => setPresetModalMode("presets")}>
                <LayoutTemplate size={15} /> Choose Preset
              </button>
            </div>
          }
        />
      ) : (
        <DashboardGrid
          widgets={layout.widgets}
          isEditing={layout.isEditing}
          onMoveById={layout.moveById}
          onStepOrder={layout.stepOrder}
          renderCell={(widget, index, dragProps) => (
            <DashboardWidgetCard
              widget={widget}
              index={index}
              totalCount={layout.widgets.length}
              isEditing={layout.isEditing}
              isDragging={dragProps.isDragging}
              isDropTarget={dragProps.isDropTarget}
              items={items}
              contacts={contacts}
              businessCards={businessCards}
              medicalRecords={medicalRecords}
              projectNotifications={projectNotifications}
              data={data}
              actions={actions}
              onConfigure={() => setConfiguringId(widget.id)}
              onResize={(patch) => layout.updateWidget(widget.id, patch)}
              onToggleCollapse={() => layout.updateWidget(widget.id, { collapsed: !widget.collapsed })}
              onDuplicate={() => layout.duplicateWidget(widget.id)}
              onMoveUp={() => layout.stepOrder(widget.id, -1)}
              onMoveDown={() => layout.stepOrder(widget.id, 1)}
              onRemove={() => layout.removeWidget(widget.id)}
              onDragHandlePointerDown={dragProps.onDragHandlePointerDown}
              onDragHandleKeyDown={dragProps.onDragHandleKeyDown}
            />
          )}
        />
      )}

      {/* Modals */}
      <WidgetLibraryModal
        open={libraryOpen}
        existingWidgets={layout.widgets}
        onClose={() => setLibraryOpen(false)}
        onAddWidget={(type) => {
          layout.addWidget(type);
        }}
      />

      <WidgetConfigModal
        widget={configuringWidget}
        projects={data.projects.data.projects}
        notes={plainNotes}
        onClose={() => setConfiguringId(null)}
        onSave={(id, patch) => layout.updateWidget(id, patch)}
      />

      <PresetConfirmModal
        mode={presetModalMode}
        activePreset={layout.activePreset}
        customized={layout.customized}
        onClose={() => setPresetModalMode(null)}
        onConfirmPreset={(presetId) => layout.applyPreset(presetId)}
        onConfirmReset={() => void layout.resetToDefault()}
      />
    </div>
  );
}
