import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Download, Eye, FileText, Filter, Loader2, MessageSquare, Paperclip, Pause, Play, Plus, Search, Send, Trash2, X } from "lucide-react";
import type { ProjectAccess, ProjectField, ProjectMember, ProjectTask, ProjectTaskAttachment, ProjectTaskComment, ProjectTaskStatus } from "../types";
import {
  addProjectTaskComment, createProjectTask, deleteProjectTask, deleteProjectTaskAttachment, deleteProjectTaskComment,
  loadProjectTask, loadProjectTaskAttachment, moveProjectTask, pauseProjectTask, updateProjectTask,
  updateProjectTaskComment, uploadProjectTaskAttachment, type ProjectTaskInput,
} from "../lib/cloud";
import {
  canDeleteComment, canEditComment, canManageTask, canMoveTask, filterProjectTasks,
  PROJECT_TASK_STATUSES, taskStatusMeta, type TaskFilter, type TaskViewMode,
} from "../lib/projects";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";

interface Props {
  projectId: string;
  tasks: ProjectTask[];
  fields: ProjectField[];
  access: ProjectAccess;
  owner: { id: string; name: string } | null;
  members: ProjectMember[];
  userId: string;
  uploadsEnabled: boolean;
  maxUploadMb: number;
  loading?: boolean;
  onTasksChange: (tasks: ProjectTask[]) => void;
  onRefresh: () => Promise<void>;
  onOpenField: (field: ProjectField) => void;
  notify: (message: string, kind?: "success" | "error") => void;
  initialTaskId?: string;
  onTaskOpened?: () => void;
  initialFieldId?: string;
  onFieldFilterApplied?: () => void;
}

type TaskAttachmentFile = ProjectTaskAttachment;
const TASK_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const EMPTY_FILTER: TaskFilter = { query: "", fieldId: "all", assigneeId: "all", status: "all", paused: "all" };

function validateTaskFile(file: File, maxUploadMb: number): string {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const expected = TASK_FILE_TYPES[extension];
  if (!expected) return "Choose a PDF, image, text/CSV, Word, Excel or PowerPoint file.";
  if (!file.size) return "The selected file is empty.";
  const limit = Math.max(1, Math.min(150, Number(maxUploadMb) || 25)) * 1024 * 1024;
  if (file.size > limit) return `Choose a file no larger than ${Math.floor(limit / 1024 / 1024)} MB.`;
  if (file.type && file.type !== expected && file.type !== "application/octet-stream" && !(extension === "csv" && file.type === "application/vnd.ms-excel")) return "The file extension and content type do not match.";
  return "";
}
function prettySize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function projectTeam(owner: Props["owner"], members: ProjectMember[]) {
  const result: { id: string; name: string }[] = [];
  if (owner?.id) result.push({ id: owner.id, name: `${owner.name} (owner)` });
  for (const member of members) if (!result.some((person) => person.id === member.userId)) result.push({ id: member.userId, name: member.name });
  return result;
}

export default function ProjectTaskList({
  projectId, tasks, fields, access, owner, members, userId, uploadsEnabled, maxUploadMb, loading = false,
  onTasksChange, onRefresh, onOpenField, notify, initialTaskId = "", onTaskOpened, initialFieldId = "", onFieldFilterApplied,
}: Props) {
  const [mode, setMode] = useState<TaskViewMode>("all");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewTask, setViewTask] = useState<ProjectTask | null>(null);
  const [editTask, setEditTask] = useState<ProjectTask | null | undefined>(undefined);
  const [deleteTask, setDeleteTask] = useState<ProjectTask | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [moving, setMoving] = useState<Set<string>>(() => new Set());
  const [dragTaskId, setDragTaskId] = useState("");
  const [dragOverStatus, setDragOverStatus] = useState<ProjectTaskStatus | "">("");
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const draggedTaskRef = useRef("");
  const shouldReduceMotion = Boolean(useReducedMotion());
  const team = useMemo(() => projectTeam(owner, members), [owner, members]);
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const canCreateAny = access.owner || fields.some((field) => field.assignee_id === userId);
  const filteredTasks = useMemo(() => filterProjectTasks(tasks, fields, filter, mode, userId), [tasks, fields, filter, mode, userId]);
  const hasActiveFilters = Boolean(filter.query.trim() || filter.fieldId !== "all" || filter.assigneeId !== "all" || filter.status !== "all" || filter.paused !== "all");
  useEffect(() => {
    if (!initialFieldId) return;
    setFilter((current) => ({ ...current, fieldId: initialFieldId }));
    onFieldFilterApplied?.();
  }, [initialFieldId, onFieldFilterApplied]);
  useEffect(() => {
    if (!initialTaskId) return;
    const requested = tasks.find((task) => task.id === initialTaskId);
    if (requested) { setViewTask(requested); onTaskOpened?.(); }
  }, [initialTaskId, tasks, onTaskOpened]);

  const resetFilters = () => setFilter(EMPTY_FILTER);
  const moveTask = useCallback(async (taskId: string, nextStatus: ProjectTaskStatus) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || task.status === nextStatus || moving.has(taskId)) return;
    const field = fieldById.get(task.field_id);
    if (!canMoveTask(access, field, task, userId, nextStatus)) {
      const message = nextStatus === "complete"
        ? "Only the project owner or the field assignee can complete a task, and it must be In Review first."
        : "Only the project owner, field assignee, or the task assignee can move this task.";
      notify(message, "error");
      return;
    }
    const previous = tasks;
    const destinationOrder = Math.max(0, ...tasks.filter((entry) => entry.status === nextStatus && entry.id !== taskId).map((entry) => entry.sort_order)) + 10;
    onTasksChange(tasks.map((entry) => entry.id === taskId ? { ...entry, status: nextStatus, sort_order: destinationOrder } : entry));
    setMoving((current) => new Set(current).add(taskId));
    try {
      await moveProjectTask(projectId, taskId, nextStatus);
      await onRefresh();
      notify(`Moved “${task.name}” to ${taskStatusMeta(nextStatus).label}.`, "success");
    } catch (error) {
      onTasksChange(previous);
      notify(error instanceof Error ? error.message : "The task move failed and was rolled back.", "error");
    } finally {
      setMoving((current) => { const next = new Set(current); next.delete(taskId); return next; });
    }
  }, [tasks, fieldById, access, userId, moving, onTasksChange, projectId, onRefresh, notify]);

  const onDragStart = (event: DragEvent<HTMLElement>, task: ProjectTask) => {
    if ((event.target as HTMLElement).closest(".more-options-wrap")) { event.preventDefault(); return; }
    const field = fieldById.get(task.field_id);
    const mayMove = canManageTask(access, field, userId) || (task.assignee_id === userId && task.status !== "complete");
    if (!mayMove) { event.preventDefault(); return; }
    draggedTaskRef.current = task.id;
    setDragTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    try { event.dataTransfer.setDragImage(event.currentTarget, 28, 22); } catch { /* browser preview fallback */ }
  };
  const onDragEnd = () => {
    draggedTaskRef.current = "";
    setDragTaskId("");
    setDragOverStatus("");
  };
  const onColumnDragOver = (event: DragEvent<HTMLElement>, status: ProjectTaskStatus) => {
    const taskId = draggedTaskRef.current || event.dataTransfer.getData("text/plain");
    if (!taskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
    const task = tasks.find((entry) => entry.id === taskId);
    if (task && canMoveTask(access, fieldById.get(task.field_id), task, userId, status)) {
      event.dataTransfer.dropEffect = "move";
      setDragOverStatus(status);
    } else setDragOverStatus("");
  };
  const onBoardDragOver = (event: DragEvent<HTMLDivElement>) => {
    const scroller = boardScrollRef.current;
    if (!scroller || !draggedTaskRef.current) return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(64, rect.width * 0.12);
    if (event.clientX < rect.left + edge) scroller.scrollLeft -= 14;
    else if (event.clientX > rect.right - edge) scroller.scrollLeft += 14;
  };
  const onDrop = (event: DragEvent<HTMLElement>, status: ProjectTaskStatus) => {
    event.preventDefault();
    const taskId = draggedTaskRef.current || event.dataTransfer.getData("text/plain");
    setDragOverStatus("");
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    if (!canMoveTask(access, fieldById.get(task.field_id), task, userId, status)) {
      const message = status === "complete"
        ? "A task must be In Review before the project owner or field assignee can complete it."
        : "You do not have permission to move this task to that column.";
      notify(message, "error");
      return;
    }
    void moveTask(task.id, status);
  };

  const confirmDelete = async () => {
    if (!deleteTask || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteProjectTask(projectId, deleteTask.id);
      await onRefresh();
      notify(`“${deleteTask.name}” deleted. It no longer contributes to its field's progress.`, "success");
      setDeleteTask(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task could not be deleted.", "error");
    } finally { setDeleteBusy(false); }
  };

  return (
    <section className="pj-panel pj-task-list">
      <div className="pj-task-toolbar">
        <div className="pj-task-mode" role="group" aria-label="Task scope">
          <button type="button" className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>All Tasks</button>
          <button type="button" className={mode === "mine" ? "active" : ""} aria-pressed={mode === "mine"} onClick={() => setMode("mine")}>My Tasks</button>
        </div>
        <div className="pj-task-toolbar-right">
          <label className="pj-task-search"><Search size={15} /><input value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} placeholder="Search tasks…" aria-label="Search tasks" />{filter.query && <button type="button" aria-label="Clear task search" onClick={() => setFilter((current) => ({ ...current, query: "" }))}><X size={13} /></button>}</label>
          <div className="pj-task-filter-wrap">
            <button type="button" className={`pj-task-filter-button ${hasActiveFilters ? "has-filters" : ""}`} aria-expanded={filtersOpen} aria-controls="pj-task-filters" onClick={() => setFiltersOpen((open) => !open)}><Filter size={14} /> Filters{hasActiveFilters && <span>{[filter.fieldId !== "all", filter.assigneeId !== "all", filter.status !== "all", filter.paused !== "all"].filter(Boolean).length || "•"}</span>}</button>
            {filtersOpen && <div className="pj-task-filter-popover" id="pj-task-filters" role="region" aria-label="Task filters">
              <div className="pj-task-filter-head"><b>Filter tasks</b><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={14} /></button></div>
              <label>Field<select value={filter.fieldId} onChange={(event) => setFilter((current) => ({ ...current, fieldId: event.target.value }))}><option value="all">All fields</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.title}</option>)}</select></label>
              <label>Assignee<select value={filter.assigneeId} onChange={(event) => setFilter((current) => ({ ...current, assigneeId: event.target.value }))}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label>Status<select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as TaskFilter["status"] }))}><option value="all">All statuses</option>{PROJECT_TASK_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
              <label>Paused state<select value={filter.paused} onChange={(event) => setFilter((current) => ({ ...current, paused: event.target.value as TaskFilter["paused"] }))}><option value="all">Active and paused</option><option value="active">Active only</option><option value="paused">Paused only</option></select></label>
              {hasActiveFilters && <button type="button" className="pj-task-clear-filters" onClick={resetFilters}>Clear filters</button>}
            </div>}
          </div>
          <button type="button" className="pj-primary-button pj-task-add" disabled={!canCreateAny || !fields.length} title={!canCreateAny ? "Only the project owner or a field assignee can create tasks." : undefined} onClick={() => setEditTask(null)}><Plus size={15} /> Add Task</button>
        </div>
      </div>

      {loading ? <div className="pj-task-empty"><Loader2 className="pj-spin" size={19} /> Loading tasks…</div> : (
        <div className="pj-task-board-scroll" ref={boardScrollRef} onDragOver={onBoardDragOver}>
          <div className="pj-task-board" aria-label="Project task board">
            <LayoutGroup id={`project-${projectId}-tasks`}>
              {PROJECT_TASK_STATUSES.map((column) => {
                const columnTasks = filteredTasks.filter((task) => task.status === column.value);
                return <section key={column.value} className={`pj-task-column pj-task-column-${column.value.replace(/[^a-z]+/g, "-")}${dragOverStatus === column.value ? " is-drop-target" : ""}`} onDragOver={(event) => onColumnDragOver(event, column.value)} onDragLeave={() => setDragOverStatus("")} onDrop={(event) => onDrop(event, column.value)} aria-label={`${column.label} tasks`}>
                  <header className="pj-task-column-head"><span className={`pj-task-status-dot pj-task-dot-${column.value.replace(/[^a-z]+/g, "-")}`} aria-hidden="true" /><h3>{column.label}</h3><span className="pj-task-count">{columnTasks.length}</span></header>
                  <div className="pj-task-column-list">
                    <AnimatePresence initial={false}>
                      {columnTasks.map((task) => {
                        const taskField = fieldById.get(task.field_id);
                        const authorized = canManageTask(access, taskField, userId);
                        const canDrag = authorized || (task.assignee_id === userId && task.status !== "complete");
                        return <motion.article
                          key={task.id}
                          layout
                          layoutId={`project-task-${task.id}`}
                          transition={shouldReduceMotion ? { duration: 0 } : { layout: { type: "spring", stiffness: 460, damping: 36, duration: 0.22 }, opacity: { duration: 0.16 } }}
                          className={`pj-task-card${dragTaskId === task.id ? " is-dragging" : ""}${moving.has(task.id) ? " is-moving" : ""}`}
                          role="button" tabIndex={0} aria-label={`Open task ${task.name}`} aria-grabbed={dragTaskId === task.id}
                          draggable={canDrag && !moving.has(task.id)}
                          onDragStart={(event) => onDragStart(event as unknown as DragEvent<HTMLElement>, task)} onDragEnd={onDragEnd}
                          onClick={() => setViewTask(task)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewTask(task); } }}
                        >
                          <span className="pj-task-title">{task.name}</span>
                          <span className="pj-task-actions" onClick={(event) => event.stopPropagation()}>
                            <MoreOptionsMenu label={`Task actions for ${task.name}`} actions={authorized ? [
                              { label: "Edit task", icon: FileText, onSelect: () => setEditTask(task) },
                              { label: "Delete task", icon: Trash2, danger: true, onSelect: () => setDeleteTask(task) },
                            ] : [{ label: "View task", icon: Eye, onSelect: () => setViewTask(task) }]} />
                          </span>
                        </motion.article>;
                      })}
                    </AnimatePresence>
                    {!columnTasks.length && <div className="pj-task-column-empty">Drop tasks here</div>}
                  </div>
                </section>;
              })}
            </LayoutGroup>
          </div>
        </div>
      )}

      {!loading && filteredTasks.length === 0 && (
        <div className="pj-task-empty pj-task-empty-state">
          <span className="pj-task-empty-icon"><FileText size={20} /></span>
          <h2>{hasActiveFilters ? "No tasks match these filters" : mode === "mine" ? "No tasks assigned to you" : tasks.length ? "No tasks match this search" : "No tasks yet"}</h2>
          <p>{hasActiveFilters ? "Try changing or clearing your search and filters." : mode === "mine" ? "Tasks appear here only when your user account is assigned to the task." : tasks.length ? "Search task names and descriptions, or switch to My Tasks." : canCreateAny ? "Create the first task to start work in this project." : "A project owner or field assignee can add tasks to a field."}</p>
          {hasActiveFilters && <button type="button" className="pj-ghost-button" onClick={resetFilters}>Clear search and filters</button>}
          {!tasks.length && canCreateAny && <button type="button" className="pj-primary-button" onClick={() => setEditTask(null)}><Plus size={14} /> Add Task</button>}
        </div>
      )}

      {viewTask && <TaskViewModal
        key={`view-${viewTask.id}`} projectId={projectId} task={viewTask} fields={fields} access={access} userId={userId} uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb}
        onClose={() => setViewTask(null)} onEdit={(task) => { setViewTask(null); setEditTask(task); }}
        onDelete={(task) => { setViewTask(null); setDeleteTask(task); }} onMove={moveTask} onRefresh={onRefresh}
        onOpenField={(fieldId) => { const field = fieldById.get(fieldId); if (field) { setViewTask(null); onOpenField(field); } }} notify={notify}
      />}
      {editTask !== undefined && <TaskFormModal
        key={`edit-${editTask?.id || "new"}`} projectId={projectId} task={editTask || undefined} fields={fields} team={team} access={access} userId={userId}
        uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb} onClose={() => setEditTask(undefined)} onRefresh={onRefresh} notify={notify}
      />}
      {deleteTask && <TaskDeleteModal task={deleteTask} busy={deleteBusy} onClose={() => !deleteBusy && setDeleteTask(null)} onConfirm={() => void confirmDelete()} />}
    </section>
  );
}

function TaskModalShell({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <ModalPortal><div className="pj-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`pj-modal pj-task-modal ${wide ? "pj-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="pj-modal-head"><h2>{title}</h2><button type="button" className="pj-icon-button" onClick={onClose} aria-label="Close task dialog"><X size={16} /></button></header>
      <div className="pj-modal-body">{children}</div>
    </div>
  </div></ModalPortal>;
}

function TaskDeleteModal({ task, busy, onClose, onConfirm }: { task: ProjectTask; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <TaskModalShell title={`Delete “${task.name}”?`} onClose={onClose}>
    <p className="pj-modal-copy">This task will be removed from “{task.fieldTitle || "its field"}” and will no longer count toward that field’s task total or progress calculation. This cannot be undone.</p>
    <div className="pj-modal-actions"><button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pj-danger-button" onClick={onConfirm} disabled={busy}>{busy ? <Loader2 className="pj-spin" size={14} /> : <Trash2 size={14} />} Delete task</button></div>
  </TaskModalShell>;
}

function TaskViewModal({ projectId, task: initialTask, fields, access, userId, uploadsEnabled, maxUploadMb, onClose, onEdit, onDelete, onMove, onRefresh, onOpenField, notify }: {
  projectId: string; task: ProjectTask; fields: ProjectField[]; access: ProjectAccess; userId: string; uploadsEnabled: boolean; maxUploadMb: number;
  onClose: () => void; onEdit: (task: ProjectTask) => void; onDelete: (task: ProjectTask) => void;
  onMove: (taskId: string, status: ProjectTaskStatus) => Promise<void>; onRefresh: () => Promise<void>;
  onOpenField: (fieldId: string) => void; notify: Props["notify"];
}) {
  const [task, setTask] = useState<ProjectTask>(initialTask);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusChoice, setStatusChoice] = useState<ProjectTaskStatus>(initialTask.status);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const taskField = fields.find((field) => field.id === task.field_id);
  const manager = canManageTask(access, taskField, userId);
  const allowedMoves = PROJECT_TASK_STATUSES.filter((status) => canMoveTask(access, taskField, task, userId, status.value));
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const detail = await loadProjectTask(projectId, initialTask.id);
      setTask(detail);
      setStatusChoice(detail.status);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Task details could not be loaded."); }
    finally { setLoading(false); }
  }, [projectId, initialTask.id]);
  useEffect(() => { void load(); }, [load]);
  const handleMove = async () => {
    if (statusChoice === task.status || statusBusy) return;
    setStatusBusy(true);
    try { await onMove(task.id, statusChoice); await load(); }
    finally { setStatusBusy(false); }
  };
  const togglePause = async () => {
    if (!manager || pauseBusy) return;
    setPauseBusy(true);
    try {
      const saved = await pauseProjectTask(projectId, task.id, !task.paused);
      setTask((current) => ({ ...current, ...saved }));
      await onRefresh();
      notify(saved.paused ? "Task paused. Its status was preserved." : "Task resumed in the same status.", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "The task pause state could not be saved.", "error"); }
    finally { setPauseBusy(false); }
  };
  const currentField = fields.find((field) => field.id === task.field_id);
  const statusMeta = taskStatusMeta(task.status);
  return <TaskModalShell title="Task details" wide onClose={onClose}>
    {loading && <div className="pj-loading"><Loader2 className="pj-spin" size={18} /> Loading task…</div>}
    {loadError && <div className="pj-alert" role="alert"><CircleAlert size={14} /> {loadError}<button type="button" onClick={() => void load()}>Retry</button></div>}
    <div className="pj-task-view-actions">
      <span className={`pj-task-status-pill pj-task-pill-${task.status.replace(/[^a-z]+/g, "-")}`}><i />{statusMeta.label}</span>
      <span className={task.paused ? "pj-task-paused-label" : "pj-task-active-label"}>{task.paused ? "Paused" : "Active"}</span>
      <span className="pj-flex-spacer" />
      {manager && <button type="button" className="pj-ghost-button" onClick={togglePause} disabled={pauseBusy}>{pauseBusy ? <Loader2 size={14} className="pj-spin" /> : task.paused ? <Play size={14} /> : <Pause size={14} />}{task.paused ? "Resume" : "Pause"}</button>}
      {manager && <button type="button" className="pj-danger-button" onClick={() => onDelete(task)}><Trash2 size={14} /> Delete</button>}
      {manager && <button type="button" className="pj-primary-button" onClick={() => onEdit(task)}><FileText size={14} /> Edit</button>}
    </div>

    <section className="pj-task-view-section">
      <header><span className="pj-detail-section-icon pj-detail-purple"><FileText size={15} /></span><h3>Task</h3></header>
      <h2 className="pj-task-view-title">{task.name}</h2>
      <p className="pj-task-view-description">{task.description || "No description has been added."}</p>
    </section>

    <section className="pj-task-view-section">
      <header><span className="pj-detail-section-icon pj-detail-blue"><Check size={15} /></span><h3>Status and assignment</h3></header>
      <div className="pj-task-view-info">
        <div><span>Status</span><b>{statusMeta.label}{task.paused ? " · paused" : ""}</b></div>
        <div><span>Assigned to</span><b>{task.assigneeName || "Unassigned"}</b></div>
        <div><span>Field</span><b>{task.fieldTitle || currentField?.title || "—"}{currentField && <button type="button" className="pj-link-button" onClick={() => onOpenField(currentField.id)}>Open field</button>}</b></div>
        <div><span>Created</span><b>{shortDate(task.created_at)}</b></div>
        <div><span>Last updated</span><b>{shortDate(task.updated_at)}</b></div>
      </div>
      {allowedMoves.length > 1 && <div className="pj-task-view-move">
        <label>Move task<select value={statusChoice} onChange={(event) => setStatusChoice(event.target.value as ProjectTaskStatus)}>{allowedMoves.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        <button type="button" className="pj-ghost-button" onClick={() => void handleMove()} disabled={statusBusy || statusChoice === task.status}>{statusBusy ? <Loader2 size={14} className="pj-spin" /> : null}Move</button>
      </div>}
    </section>

    <TaskAttachments projectId={projectId} taskId={task.id} attachments={task.attachments || []} canManage={manager} uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb} pendingFiles={[]} setPendingFiles={() => undefined} onChanged={load} notify={notify} />
    <TaskConversation projectId={projectId} taskId={task.id} comments={task.comments || []} access={access} userId={userId} onChanged={load} notify={notify} />
  </TaskModalShell>;
}

function TaskFormModal({ projectId, task: initialTask, fields, team, access, userId, uploadsEnabled, maxUploadMb, onClose, onRefresh, notify }: {
  projectId: string; task?: ProjectTask; fields: ProjectField[]; team: { id: string; name: string }[]; access: ProjectAccess; userId: string; uploadsEnabled: boolean; maxUploadMb: number;
  onClose: () => void; onRefresh: () => Promise<void>; notify: Props["notify"];
}) {
  const [name, setName] = useState(initialTask?.name || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const eligibleFields = fields.filter((field) => access.owner || field.assignee_id === userId);
  const [fieldId, setFieldId] = useState(initialTask?.field_id || eligibleFields[0]?.id || "");
  const [assigneeId, setAssigneeId] = useState(initialTask?.assignee_id || "");
  const [status, setStatus] = useState<ProjectTaskStatus>(initialTask?.status || "todo");
  const [persistedTask, setPersistedTask] = useState<ProjectTask | undefined>(initialTask);
  const [taskDetail, setTaskDetail] = useState<ProjectTask | null>(initialTask || null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reloadTask = useCallback(async () => {
    const id = persistedTask?.id || initialTask?.id;
    if (!id) return;
    try {
      const detail = await loadProjectTask(projectId, id);
      setTaskDetail(detail);
      setPersistedTask((current) => current ? { ...current, ...detail } : detail);
    } catch (reason) { notify(reason instanceof Error ? reason.message : "Task details could not be refreshed.", "error"); }
  }, [projectId, persistedTask?.id, initialTask?.id, notify]);
  useEffect(() => { if (initialTask) void reloadTask(); }, [initialTask, reloadTask]);

  const field = fields.find((entry) => entry.id === fieldId);
  const currentField = fields.find((entry) => entry.id === (persistedTask?.field_id || initialTask?.field_id));
  const managerForCurrent = canManageTask(access, currentField, userId);
  const allowedStatuses = persistedTask
    ? PROJECT_TASK_STATUSES.filter((entry) => canMoveTask(access, currentField, persistedTask, userId, entry.value))
    : PROJECT_TASK_STATUSES.filter((entry) => entry.value !== "complete");
  const dirty = name !== (initialTask?.name || "") || description !== (initialTask?.description || "") || fieldId !== (initialTask?.field_id || eligibleFields[0]?.id || "") || assigneeId !== (initialTask?.assignee_id || "") || status !== (initialTask?.status || "todo") || pendingFiles.length > 0;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm("Discard unsaved task changes?")) return;
    onClose();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) { setError("Task name is required."); return; }
    if (!fieldId || !fields.some((entry) => entry.id === fieldId)) { setError("Choose a field in this project."); return; }
    if (!access.owner && field?.assignee_id !== userId) { setError("Only the project owner or the selected field assignee can create tasks there."); return; }
    if (assigneeId && !team.some((person) => person.id === assigneeId)) { setError("Choose an assignee who belongs to this project."); return; }
    if (!persistedTask && status === "complete") { setError("New tasks cannot start as Complete. Move a task through In Review first."); return; }
    if (persistedTask && !canMoveTask(access, currentField, persistedTask, userId, status)) { setError("That status change is not allowed. Complete tasks only from In Review."); return; }
    if (cleanName.length > 240) { setError("Task names can be up to 240 characters."); return; }
    setError(""); setBusy(true);
    let saved = persistedTask;
    try {
      const input: ProjectTaskInput = { name: cleanName, description: description.trim(), fieldId, assigneeId: assigneeId || null, status };
      if (saved) saved = await updateProjectTask(projectId, saved.id, input);
      else saved = await createProjectTask(projectId, input);
      setPersistedTask(saved);
      // A create request becomes an edit/retry in place if a later upload fails;
      // the saved field/task ID prevents a duplicate task on the next submit.
      if (pendingFiles.length) {
        for (const file of [...pendingFiles]) {
          await uploadProjectTaskAttachment(projectId, saved.id, file);
          setPendingFiles((current) => current.filter((entry) => entry !== file));
        }
      }
      await onRefresh();
      if (saved?.id) {
        try { setTaskDetail(await loadProjectTask(projectId, saved.id)); } catch { /* Non-blocking; task is already saved. */ }
      }
      notify(initialTask || persistedTask ? "Task saved." : `“${cleanName}” added to the Task List.`, "success");
      onClose();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The task could not be saved.";
      setError(message);
      notify(message, "error");
      if (saved) {
        setPersistedTask(saved);
        try { setTaskDetail(await loadProjectTask(projectId, saved.id)); } catch { /* Keep local form state for retry. */ }
      }
    } finally { setBusy(false); }
  };

  const pauseResume = async () => {
    if (!persistedTask || !managerForCurrent || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await pauseProjectTask(projectId, persistedTask.id, !persistedTask.paused);
      setPersistedTask(saved);
      setTaskDetail((current) => current ? { ...current, ...saved } : saved);
      await onRefresh();
      notify(saved.paused ? "Task paused. Its status was preserved." : "Task resumed in the same status.", "success");
    } catch (reason) { const message = reason instanceof Error ? reason.message : "The task pause state could not be saved."; setError(message); notify(message, "error"); }
    finally { setBusy(false); }
  };
  const persistedAttachments = taskDetail?.attachments || [];
  const canManageCurrent = Boolean(persistedTask ? managerForCurrent : access.owner || field?.assignee_id === userId);
  const title = initialTask || persistedTask ? "Edit task" : "Add task";

  return <TaskModalShell title={title} wide onClose={requestClose}>
    <form className="pj-form pj-task-form" onSubmit={(event) => void save(event)}>
      <label>Task name<input value={name} maxLength={240} onChange={(event) => setName(event.target.value)} placeholder="e.g. Draft the launch announcement" required autoFocus /></label>
      <label>Description <small>(optional)</small><textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, acceptance notes, or useful links…" /></label>
      <div className="pj-form-grid">
        <label>Assign to<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>Select field<select value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">Choose a field</option>{fields.map((entry) => <option key={entry.id} value={entry.id} disabled={!access.owner && entry.assignee_id !== userId}>{entry.title}{!access.owner && entry.assignee_id !== userId ? " · not assigned to you" : ""}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ProjectTaskStatus)}>{allowedStatuses.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        <div className="pj-task-pause-control"><span>Pause state</span>{persistedTask ? <button type="button" className="pj-ghost-button" onClick={() => void pauseResume()} disabled={!managerForCurrent || busy}>{busy ? <Loader2 size={14} className="pj-spin" /> : persistedTask.paused ? <Play size={14} /> : <Pause size={14} />}{persistedTask.paused ? "Resume task" : "Pause task"}</button> : <small>Save the task before pausing it.</small>}</div>
      </div>
      {persistedTask && persistedTask.paused && <p className="pj-form-hint"><Pause size={14} /> Paused is separate from status; resuming keeps the same column.</p>}

      <TaskAttachments projectId={projectId} taskId={persistedTask?.id} attachments={persistedAttachments} canManage={canManageCurrent} uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb} pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} onChanged={async () => { await reloadTask(); await onRefresh(); }} notify={notify} />
      {error && <p className="pj-form-error" role="alert"><CircleAlert size={14} /> {error}</p>}
      <div className="pj-modal-actions"><button type="button" className="pj-ghost-button" onClick={requestClose} disabled={busy}>Cancel</button><button type="submit" className="pj-primary-button" disabled={busy || !name.trim() || !fieldId}>{busy ? <Loader2 size={15} className="pj-spin" /> : null}{persistedTask ? "Save task" : "Create task"}</button></div>
    </form>
    {persistedTask ? <TaskConversation projectId={projectId} taskId={persistedTask.id} comments={taskDetail?.comments || []} access={access} userId={userId} onChanged={reloadTask} notify={notify} /> : <section className="pj-task-view-section"><header><span className="pj-detail-section-icon pj-detail-blue"><MessageSquare size={15} /></span><h3>Comments</h3></header><p className="pj-task-inline-hint">Save the task first to start its conversation.</p></section>}
  </TaskModalShell>;
}

function TaskAttachments({ projectId, taskId, attachments, canManage, uploadsEnabled, maxUploadMb, pendingFiles, setPendingFiles, onChanged, notify }: {
  projectId: string; taskId?: string; attachments: TaskAttachmentFile[]; canManage: boolean; uploadsEnabled: boolean; maxUploadMb: number;
  pendingFiles: File[]; setPendingFiles: (files: File[] | ((current: File[]) => File[])) => void; onChanged: () => Promise<void>; notify: Props["notify"];
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);
  const upload = async (file?: File) => {
    if (!file || !canManage || !uploadsEnabled || busy) return;
    const validation = validateTaskFile(file, maxUploadMb);
    if (validation) { notify(validation, "error"); return; }
    if (!taskId) {
      setPendingFiles((current) => current.some((entry) => entry.name === file.name && entry.size === file.size) ? current : [...current, file]);
      return;
    }
    setBusy(true);
    try {
      await uploadProjectTaskAttachment(projectId, taskId, file);
      setPendingFiles((current) => current.filter((entry) => !(entry.name === file.name && entry.size === file.size)));
      await onChanged(); notify("Private task attachment uploaded.", "success");
    }
    catch (error) { notify(error instanceof Error ? error.message : "The task attachment could not be uploaded.", "error"); }
    finally { setBusy(false); }
  };
  const previewFile = async (file: TaskAttachmentFile) => {
    if (!(file.file_type.startsWith("image/") || file.file_type === "application/pdf") || !taskId) return;
    setBusy(true);
    try { const blob = await loadProjectTaskAttachment(projectId, taskId, file.id, true); setPreview({ url: URL.createObjectURL(blob), type: file.file_type, name: file.file_name }); }
    catch (error) { notify(error instanceof Error ? error.message : "The task attachment preview could not be opened.", "error"); }
    finally { setBusy(false); }
  };
  const download = async (file: TaskAttachmentFile) => {
    if (!taskId) return;
    setBusy(true);
    try {
      const blob = await loadProjectTaskAttachment(projectId, taskId, file.id);
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = file.file_name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) { notify(error instanceof Error ? error.message : "The task attachment could not be downloaded.", "error"); }
    finally { setBusy(false); }
  };
  const remove = async (file: TaskAttachmentFile) => {
    if (!taskId || !canManage || busy || !window.confirm(`Remove “${file.file_name}” from this task?`)) return;
    setBusy(true);
    try { await deleteProjectTaskAttachment(projectId, taskId, file.id); await onChanged(); notify("Task attachment removed.", "success"); }
    catch (error) { notify(error instanceof Error ? error.message : "The task attachment could not be removed.", "error"); }
    finally { setBusy(false); }
  };
  return <>
    <section className="pj-task-view-section pj-task-attachments">
      <header><span className="pj-detail-section-icon pj-detail-blue"><Paperclip size={15} /></span><h3>Attachments</h3><span className="pj-chip pj-chip-muted">{attachments.length + pendingFiles.length}</span><span className="pj-flex-spacer" />
        {canManage && uploadsEnabled && <label className={`pj-attachment-upload ${busy ? "is-busy" : ""}`}><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx" disabled={busy} onChange={(event) => { const files = event.currentTarget.files; event.currentTarget.value = ""; if (files) Array.from(files).forEach((file) => void upload(file)); }} />{busy ? <Loader2 size={14} className="pj-spin" /> : <Plus size={14} />} Add files</label>}
      </header>
      <p className="pj-detail-permission-note">Files stay in Persora’s private storage. PDFs and images can be previewed; supported documents can be downloaded.</p>
      {canManage && !uploadsEnabled && <small className="pj-muted">Uploads are disabled for this account. Existing files remain available.</small>}
      {!taskId && pendingFiles.length > 0 && <ul className="pj-attachment-list">{pendingFiles.map((file, index) => <li key={`${file.name}:${file.size}:${index}`}><span className="pj-attachment-file-icon"><FileText size={15} /></span><span className="pj-attachment-copy"><b>{file.name}</b><small>{prettySize(file.size)} · waiting for task save</small></span><button type="button" className="pj-icon-button pj-danger-text" aria-label={`Remove ${file.name} from upload queue`} onClick={() => setPendingFiles((current) => current.filter((entry) => entry !== file))}><Trash2 size={14} /></button></li>)}</ul>}
      <ul className="pj-attachment-list">
        {attachments.map((file) => <li key={file.id}><span className="pj-attachment-file-icon"><FileText size={15} /></span><span className="pj-attachment-copy"><b title={file.file_name}>{file.file_name}</b><small>{prettySize(file.file_size)} · {file.uploaderName} · {shortDate(file.created_at)}</small></span>
          {(file.file_type.startsWith("image/") || file.file_type === "application/pdf") && <button type="button" className="pj-icon-button" onClick={() => void previewFile(file)} disabled={busy} aria-label={`Preview ${file.file_name}`}><Eye size={14} /></button>}
          <button type="button" className="pj-icon-button" onClick={() => void download(file)} disabled={busy} aria-label={`Download ${file.file_name}`}><Download size={14} /></button>
          {canManage && <button type="button" className="pj-icon-button pj-danger-text" onClick={() => void remove(file)} disabled={busy} aria-label={`Remove ${file.file_name}`}><Trash2 size={14} /></button>}
        </li>)}
        {!attachments.length && !pendingFiles.length && <li className="pj-attachment-empty">No attachments on this task yet.</li>}
      </ul>
    </section>
    {preview && <TaskModalShell title={`Preview · ${preview.name}`} wide onClose={() => setPreview(null)}><div className="pj-attachment-preview">{preview.type.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <iframe src={preview.url} title={`Preview ${preview.name}`} sandbox="allow-same-origin" />}</div></TaskModalShell>}
  </>;
}

function TaskConversation({ projectId, taskId, comments, access, userId, onChanged, notify }: {
  projectId: string; taskId: string; comments: ProjectTaskComment[]; access: ProjectAccess; userId: string; onChanged: () => Promise<void>; notify: Props["notify"];
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const post = async (event: FormEvent) => {
    event.preventDefault(); const body = draft.trim(); if (!body || busy) return;
    setBusy(true);
    try { await addProjectTaskComment(projectId, taskId, body); setDraft(""); await onChanged(); }
    catch (error) { notify(error instanceof Error ? error.message : "The task comment could not be posted.", "error"); }
    finally { setBusy(false); }
  };
  const save = async (comment: ProjectTaskComment) => {
    const body = editingBody.trim(); if (!body || busy) return;
    setBusy(true);
    try { await updateProjectTaskComment(projectId, taskId, comment.id, body); setEditingId(""); await onChanged(); }
    catch (error) { notify(error instanceof Error ? error.message : "The task comment could not be saved.", "error"); }
    finally { setBusy(false); }
  };
  const remove = async (comment: ProjectTaskComment) => {
    if (busy || !window.confirm("Delete this task comment?")) return;
    setBusy(true);
    try { await deleteProjectTaskComment(projectId, taskId, comment.id); await onChanged(); }
    catch (error) { notify(error instanceof Error ? error.message : "The task comment could not be deleted.", "error"); }
    finally { setBusy(false); }
  };
  return <section className="pj-task-view-section pj-task-comments">
    <header><span className="pj-detail-section-icon pj-detail-purple"><MessageSquare size={15} /></span><h3>Comments</h3><span className="pj-chip pj-chip-muted">{comments.length}</span></header>
    <ul>
      {comments.map((comment) => <li key={comment.id}>
        <span className="pj-task-comment-avatar" aria-hidden="true">{comment.author_name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?"}</span>
        <div className="pj-task-comment-body"><header><b>{comment.author_name || "A member"}</b><time>{shortDate(comment.created_at)}{comment.updated_at !== comment.created_at ? " · edited" : ""}</time></header>
          {editingId === comment.id ? <div className="pj-task-comment-edit"><textarea rows={2} maxLength={2000} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /><div><button type="button" className="pj-ghost-button" onClick={() => setEditingId("")} disabled={busy}>Cancel</button><button type="button" className="pj-primary-button" onClick={() => void save(comment)} disabled={busy || !editingBody.trim()}>Save</button></div></div> : <p>{comment.body}</p>}
          {editingId !== comment.id && (canEditComment(comment, userId) || canDeleteComment(access, comment, userId)) && <div className="pj-comment-actions">{canEditComment(comment, userId) && <button type="button" onClick={() => { setEditingId(comment.id); setEditingBody(comment.body); }}>Edit</button>}{canDeleteComment(access, comment, userId) && <button type="button" className="pj-danger-text" onClick={() => void remove(comment)}>Delete</button>}</div>}
        </div>
      </li>)}
      {!comments.length && <li className="pj-muted">No comments yet.</li>}
    </ul>
    <form className="pj-comment-input" onSubmit={(event) => void post(event)}><textarea rows={2} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a comment…" aria-label="Add a task comment" /><button type="submit" className="pj-primary-button" disabled={busy || !draft.trim()}>{busy ? <Loader2 size={14} className="pj-spin" /> : <Send size={14} />} Post</button></form>
  </section>;
}
