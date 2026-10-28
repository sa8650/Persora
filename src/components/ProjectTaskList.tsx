import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  Check, CircleAlert, Download, Eye, FileText, Filter, MessageSquare,
  Paperclip, Pause, Play, Plus, Search, Send, Trash2, X,
} from "lucide-react";
import type {
  ProjectAccess, ProjectField, ProjectMember, ProjectPriority, ProjectTask,
  ProjectTaskAttachment, ProjectTaskComment, ProjectTaskStatus, TransferProgress,
} from "../types";
import {
  addProjectTaskComment, createProjectTask, deleteProjectTask, deleteProjectTaskAttachment,
  deleteProjectTaskComment, loadProjectTask, loadProjectTaskAttachment, moveProjectTask,
  pauseProjectTask, updateProjectTask, updateProjectTaskComment, uploadProjectTaskAttachment,
  type ProjectTaskInput,
} from "../lib/cloud";
import {
  calculateKanbanColumnWidth, canDeleteComment, canEditComment, canManageTask, canMoveTask,
  computeDropSortOrder, CULT_KANBAN_ENTER_SPRING, CULT_KANBAN_INDICATOR_SPRING, CULT_KANBAN_LAYOUT_SPRING,
  CULT_MODAL_TRANSITION, CULT_POPOVER_TRANSITION, filterProjectTasks, formatDate, formatProjectFileSize,
  initialsFor, isFieldPaused, isTaskMoveLockedByPause, KANBAN_COLUMN_GAP_PX, moveTaskRejectionMessage, priorityMeta,
  PROJECT_ATTACHMENT_ACCEPT, PROJECT_PRIORITIES, PROJECT_TASK_STATUSES, taskStatusMeta, validateProjectAttachmentFile,
  type TaskFilter, type TaskViewMode,
} from "../lib/projects";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";
import { TransferProgressIndicator } from "./ProgressIndicator";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "./ui/attachment";
import { Spinner } from "./ui/spinner";
import { Badge } from "./reui/badge";
import { FileType, getFileType } from "./reui/file-type";
import { IconTile } from "./reui/icon-tile";

export interface ProjectModalProps {
  title: string;
  wide?: boolean;
  className?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

const NOOP_MOTION_UPDATE = () => undefined;

/**
 * Shared floating dialog shell for all Projects, Fields, and Task List modals.
 * Uses a static GPU-cached blurred backdrop matching Persora dialogs while animating only dialog transform + opacity.
 */
export function ProjectModal({
  title,
  wide = false,
  className = "",
  closeLabel = "Close dialog",
  onClose,
  children,
}: ProjectModalProps) {
  const shouldReduceMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <ModalPortal>
      <div
        className="pj-modal-backdrop"
        role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <motion.div
          className={`pj-modal${wide ? " pj-modal-wide" : ""}${className ? ` ${className}` : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.965, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : CULT_MODAL_TRANSITION}
          onUpdate={NOOP_MOTION_UPDATE}
        >
          <header className="pj-modal-head">
            <h2>{title}</h2>
            <button type="button" className="pj-icon-button" onClick={onClose} aria-label={closeLabel}>
              <X size={16} />
            </button>
          </header>
          <div className="pj-modal-body">{children}</div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}

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

interface DropTargetState {
  status: ProjectTaskStatus;
  index: number;
  permitted: boolean;
}

interface TouchDragState {
  task: ProjectTask;
  x: number;
  y: number;
  width: number;
}

const EMPTY_FILTER: TaskFilter = { query: "", fieldId: "all", assigneeId: "all", status: "all", priority: "all", paused: "all" };
const SNAPBACK_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

function projectTeam(owner: Props["owner"], members: ProjectMember[]) {
  const result: { id: string; name: string }[] = [];
  if (owner?.id) result.push({ id: owner.id, name: `${owner.name} (owner)` });
  for (const member of members) {
    if (!result.some((person) => person.id === member.userId)) result.push({ id: member.userId, name: member.name });
  }
  return result;
}

function measureInsertionIndex(listEl: HTMLElement | null, clientY: number, draggedTaskId: string): number {
  if (!listEl) return 0;
  const cards = Array.from(listEl.querySelectorAll<HTMLElement>("[data-task-card-id]"))
    .filter((node) => node.dataset.taskCardId !== draggedTaskId);
  for (let idx = 0; idx < cards.length; idx += 1) {
    const rect = cards[idx].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return idx;
  }
  return cards.length;
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
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [rejectedTaskId, setRejectedTaskId] = useState("");
  const [boardNotice, setBoardNotice] = useState("");
  const [boardWidth, setBoardWidth] = useState(0);
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);

  const boardScrollRef = useRef<HTMLDivElement>(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Record<string, HTMLElement | null>>({});
  const columnListRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draggedTaskRef = useRef("");
  const rejectTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const dragLeaveTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const touchHoldTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const shouldReduceMotion = Boolean(useReducedMotion());
  const team = useMemo(() => projectTeam(owner, members), [owner, members]);
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const canCreateAny = access.owner || fields.some((field) => field.assignee_id === userId);
  const filteredTasks = useMemo(() => filterProjectTasks(tasks, fields, filter, mode, userId), [tasks, fields, filter, mode, userId]);
  const activeDropdownCount = [
    filter.fieldId !== "all",
    filter.assigneeId !== "all",
    filter.status !== "all",
    Boolean(filter.priority && filter.priority !== "all"),
    filter.paused !== "all",
  ].filter(Boolean).length;
  const hasQuery = Boolean(filter.query.trim());
  const hasActiveFilters = hasQuery || activeDropdownCount > 0;

  useLayoutEffect(() => {
    const scroller = boardScrollRef.current;
    if (!scroller) return;
    const updateWidth = () => {
      const next = scroller.clientWidth;
      if (next > 0) setBoardWidth(next);
    };
    updateWidth();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateWidth) : null;
    observer?.observe(scroller);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [loading]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!filterWrapRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  useEffect(() => () => {
    if (rejectTimerRef.current) window.clearTimeout(rejectTimerRef.current);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    if (dragLeaveTimerRef.current) window.clearTimeout(dragLeaveTimerRef.current);
    if (touchHoldTimerRef.current) window.clearTimeout(touchHoldTimerRef.current);
  }, []);

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

  const triggerSnapBack = useCallback((taskId: string, message: string) => {
    setRejectedTaskId(taskId);
    setBoardNotice(message);
    notify(message, "error");
    if (rejectTimerRef.current) window.clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = window.setTimeout(() => setRejectedTaskId(""), 520);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setBoardNotice(""), 4200);
  }, [notify]);

  const resetFilters = () => setFilter(EMPTY_FILTER);

  const moveTask = useCallback(async (taskId: string, nextStatus: ProjectTaskStatus, explicitSortOrder?: number) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || moving.has(taskId)) return;
    const sameColumn = task.status === nextStatus;
    if (sameColumn && explicitSortOrder === undefined) return;
    const field = fieldById.get(task.field_id);
    const denial = moveTaskRejectionMessage(access, field, task, userId, nextStatus);
    if (denial) {
      triggerSnapBack(taskId, denial);
      return;
    }
    const previous = tasks;
    const fallbackOrder = Math.max(0, ...tasks.filter((entry) => entry.status === nextStatus && entry.id !== taskId).map((entry) => entry.sort_order)) + 100;
    const destinationOrder = typeof explicitSortOrder === "number" ? explicitSortOrder : fallbackOrder;
    if (sameColumn && destinationOrder === task.sort_order) return;

    setBoardNotice("");
    onTasksChange(tasks.map((entry) => entry.id === taskId ? { ...entry, status: nextStatus, sort_order: destinationOrder } : entry));
    setMoving((current) => new Set(current).add(taskId));
    try {
      await moveProjectTask(projectId, taskId, nextStatus, explicitSortOrder);
      await onRefresh();
      if (!sameColumn) notify(`Moved “${task.name}” to ${taskStatusMeta(nextStatus).label}.`, "success");
    } catch (error) {
      onTasksChange(previous);
      const message = error instanceof Error ? error.message : "The task move failed and was rolled back.";
      triggerSnapBack(taskId, message);
    } finally {
      setMoving((current) => { const next = new Set(current); next.delete(taskId); return next; });
    }
  }, [tasks, fieldById, access, userId, moving, onTasksChange, projectId, onRefresh, notify, triggerSnapBack]);

  const computePositionedSortOrder = useCallback((status: ProjectTaskStatus, visibleInsertIndex: number, draggedId: string): number | undefined => {
    const visibleColumnPeers = filteredTasks.filter((entry) => entry.status === status && entry.id !== draggedId);
    const allColumnTasks = tasks
      .filter((entry) => entry.status === status)
      .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)));
    const allColumnPeers = allColumnTasks.filter((entry) => entry.id !== draggedId);
    if (!allColumnPeers.length) return undefined;
    if (visibleInsertIndex <= 0) {
      if (!visibleColumnPeers.length) return computeDropSortOrder(allColumnTasks, allColumnPeers.length, draggedId);
      const firstVisible = visibleColumnPeers[0];
      const mappedIdx = allColumnPeers.findIndex((entry) => entry.id === firstVisible.id);
      return computeDropSortOrder(allColumnTasks, mappedIdx >= 0 ? mappedIdx : 0, draggedId);
    }
    if (visibleInsertIndex >= visibleColumnPeers.length) {
      const lastVisible = visibleColumnPeers[visibleColumnPeers.length - 1];
      const mappedIdx = allColumnPeers.findIndex((entry) => entry.id === lastVisible.id);
      return computeDropSortOrder(allColumnTasks, mappedIdx >= 0 ? mappedIdx + 1 : allColumnPeers.length, draggedId);
    }
    const anchor = visibleColumnPeers[visibleInsertIndex];
    const mappedIdx = allColumnPeers.findIndex((entry) => entry.id === anchor.id);
    return computeDropSortOrder(allColumnTasks, mappedIdx >= 0 ? mappedIdx : allColumnPeers.length, draggedId);
  }, [filteredTasks, tasks]);

  const autoScrollBoard = useCallback((clientX: number) => {
    const scroller = boardScrollRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(72, rect.width * 0.14);
    if (clientX < rect.left + edge) {
      const intensity = Math.max(0.25, (rect.left + edge - clientX) / edge);
      scroller.scrollLeft -= Math.round(16 * intensity);
    } else if (clientX > rect.right - edge) {
      const intensity = Math.max(0.25, (clientX - (rect.right - edge)) / edge);
      scroller.scrollLeft += Math.round(16 * intensity);
    }
  }, []);

  const onDragStart = (event: DragEvent<HTMLElement>, task: ProjectTask) => {
    if ((event.target as HTMLElement).closest(".more-options-wrap")) { event.preventDefault(); return; }
    if (moving.has(task.id)) { event.preventDefault(); return; }
    draggedTaskRef.current = task.id;
    setDragTaskId(task.id);
    setBoardNotice("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    try { event.dataTransfer.setDragImage(event.currentTarget, 24, 24); } catch { /* native fallback */ }
  };

  const onDragEnd = () => {
    draggedTaskRef.current = "";
    setDragTaskId("");
    setDropTarget(null);
  };

  const onColumnDragOver = (event: DragEvent<HTMLElement>, status: ProjectTaskStatus) => {
    const taskId = draggedTaskRef.current || event.dataTransfer.getData("text/plain");
    if (!taskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragLeaveTimerRef.current) {
      window.clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    const permitted = canMoveTask(access, fieldById.get(task.field_id), task, userId, status);
    const index = measureInsertionIndex(columnListRefs.current[status] || null, event.clientY, taskId);
    setDropTarget((current) => (
      current && current.status === status && current.index === index && current.permitted === permitted
        ? current
        : { status, index, permitted }
    ));
  };

  const onColumnDragLeave = (event: DragEvent<HTMLElement>, status: ProjectTaskStatus) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    if (dragLeaveTimerRef.current) window.clearTimeout(dragLeaveTimerRef.current);
    dragLeaveTimerRef.current = window.setTimeout(() => {
      setDropTarget((current) => (current?.status === status ? null : current));
    }, 60);
  };

  const onBoardDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedTaskRef.current) return;
    autoScrollBoard(event.clientX);
  };

  const commitDrop = useCallback((taskId: string, status: ProjectTaskStatus, insertIndex?: number) => {
    setDropTarget(null);
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    const denial = moveTaskRejectionMessage(access, fieldById.get(task.field_id), task, userId, status);
    if (denial) {
      triggerSnapBack(task.id, denial);
      return;
    }
    if (status === task.status) {
      if (insertIndex === undefined) return;
      const visibleInColumn = filteredTasks.filter((entry) => entry.status === status);
      const currentIdx = visibleInColumn.findIndex((entry) => entry.id === task.id);
      if (currentIdx === insertIndex) return;
      const nextSortOrder = computePositionedSortOrder(status, insertIndex, task.id);
      if (nextSortOrder !== undefined) void moveTask(task.id, status, nextSortOrder);
      return;
    }
    const visiblePeers = filteredTasks.filter((entry) => entry.status === status && entry.id !== task.id);
    const insertedBeforePeer = insertIndex !== undefined && insertIndex < visiblePeers.length;
    const nextSortOrder = insertedBeforePeer ? computePositionedSortOrder(status, insertIndex, task.id) : undefined;
    void moveTask(task.id, status, nextSortOrder);
  }, [tasks, access, fieldById, userId, triggerSnapBack, filteredTasks, computePositionedSortOrder, moveTask]);

  const onDrop = (event: DragEvent<HTMLElement>, status: ProjectTaskStatus) => {
    event.preventDefault();
    const taskId = draggedTaskRef.current || event.dataTransfer.getData("text/plain");
    const index = measureInsertionIndex(columnListRefs.current[status] || null, event.clientY, taskId);
    draggedTaskRef.current = "";
    setDragTaskId("");
    commitDrop(taskId, status, index);
  };

  useEffect(() => {
    if (!touchDrag) return;
    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setTouchDrag((current) => current ? { ...current, x: event.clientX, y: event.clientY } : null);
      autoScrollBoard(event.clientX);
      let matched: DropTargetState | null = null;
      for (const col of PROJECT_TASK_STATUSES) {
        const el = columnRefs.current[col.value];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          const permitted = canMoveTask(access, fieldById.get(touchDrag.task.field_id), touchDrag.task, userId, col.value);
          const index = measureInsertionIndex(columnListRefs.current[col.value] || null, event.clientY, touchDrag.task.id);
          matched = { status: col.value, index, permitted };
          break;
        }
      }
      setDropTarget(matched);
    };
    const finishTouchDrag = (cancelled: boolean) => {
      const activeTarget = dropTarget;
      const dragged = touchDrag.task;
      setTouchDrag(null);
      setDragTaskId("");
      draggedTaskRef.current = "";
      setDropTarget(null);
      window.setTimeout(() => { suppressClickRef.current = false; }, 80);
      if (!cancelled && activeTarget) commitDrop(dragged.id, activeTarget.status, activeTarget.index);
    };
    const onPointerUp = () => finishTouchDrag(false);
    const onPointerCancel = () => finishTouchDrag(true);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [touchDrag, dropTarget, access, fieldById, userId, autoScrollBoard, commitDrop]);

  const onCardPointerDown = (event: ReactPointerEvent<HTMLElement>, task: ProjectTask) => {
    if (event.pointerType !== "touch" || moving.has(task.id)) return;
    if ((event.target as HTMLElement).closest(".more-options-wrap")) return;
    const cardEl = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    touchStartRef.current = { x: startX, y: startY, pointerId: event.pointerId };
    if (touchHoldTimerRef.current) window.clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = window.setTimeout(() => {
      if (!touchStartRef.current) return;
      const rect = cardEl.getBoundingClientRect();
      suppressClickRef.current = true;
      draggedTaskRef.current = task.id;
      setDragTaskId(task.id);
      setTouchDrag({ task, x: startX, y: startY, width: rect.width || 256 });
    }, 260);
  };

  const cancelPendingTouchHold = (event: ReactPointerEvent<HTMLElement>) => {
    if (!touchStartRef.current) return;
    if (event.type === "pointermove") {
      const dx = event.clientX - touchStartRef.current.x;
      const dy = event.clientY - touchStartRef.current.y;
      if (Math.hypot(dx, dy) < 8) return;
    }
    if (touchHoldTimerRef.current) {
      window.clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    touchStartRef.current = null;
  };

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, task: ProjectTask) => {
    if ((event.target as HTMLElement).closest(".more-options-wrap")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setViewTask(task);
      return;
    }
    if (event.altKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const idx = PROJECT_TASK_STATUSES.findIndex((entry) => entry.value === task.status);
      const nextIdx = event.key === "ArrowRight" ? idx + 1 : idx - 1;
      if (nextIdx >= 0 && nextIdx < PROJECT_TASK_STATUSES.length) {
        void moveTask(task.id, PROJECT_TASK_STATUSES[nextIdx].value);
      }
    }
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

  const toggleTaskPauseFromBoard = async (task: ProjectTask) => {
    const taskField = fieldById.get(task.field_id);
    if (!canManageTask(access, taskField, userId)) return;
    try {
      const saved = await pauseProjectTask(projectId, task.id, !task.paused);
      onTasksChange(tasks.map((entry) => entry.id === task.id ? { ...entry, ...saved } : entry));
      await onRefresh();
      notify(saved.paused ? `Paused “${task.name}” — cross-column moves are locked until resumed.` : `Resumed “${task.name}”.`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task pause state could not be saved.", "error");
    }
  };

  const computedColWidth = boardWidth > 0 ? calculateKanbanColumnWidth(boardWidth, KANBAN_COLUMN_GAP_PX) : 0;
  const boardStyle: CSSProperties | undefined = computedColWidth > 0
    ? ({
        "--pj-board-w": `${boardWidth}px`,
        "--pj-board-gap": `${KANBAN_COLUMN_GAP_PX}px`,
        "--pj-col-w": `${computedColWidth}px`,
        width: `${Math.round((4 * computedColWidth + 3 * KANBAN_COLUMN_GAP_PX) * 100) / 100}px`,
      } as CSSProperties)
    : undefined;

  return (
    <section className="pj-panel pj-task-list">
      <div className="pj-task-toolbar">
        <div className="pj-task-mode" role="group" aria-label="Task scope">
          <button type="button" className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>All Tasks</button>
          <button type="button" className={mode === "mine" ? "active" : ""} aria-pressed={mode === "mine"} onClick={() => setMode("mine")}>My Tasks</button>
        </div>
        <div className="pj-task-toolbar-right">
          <label className="pj-task-search">
            <Search size={15} />
            <input value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} placeholder="Search tasks…" aria-label="Search tasks" />
            {filter.query && <button type="button" aria-label="Clear task search" onClick={() => setFilter((current) => ({ ...current, query: "" }))}><X size={13} /></button>}
          </label>
          <div className="pj-task-filter-wrap" ref={filterWrapRef}>
            <button type="button" className={`pj-task-filter-button ${activeDropdownCount > 0 ? "has-filters" : ""}`} aria-expanded={filtersOpen} aria-controls="pj-task-filters" onClick={() => setFiltersOpen((open) => !open)}>
              <Filter size={14} /> Filters{activeDropdownCount > 0 && <span>{activeDropdownCount}</span>}
            </button>
            {filtersOpen && (
              <motion.div
                className="pj-task-filter-popover"
                id="pj-task-filters"
                role="region"
                aria-label="Task filters"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={shouldReduceMotion ? { duration: 0 } : CULT_POPOVER_TRANSITION}
                onUpdate={NOOP_MOTION_UPDATE}
              >
                <div className="pj-task-filter-head"><b>Filter tasks</b><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={14} /></button></div>
                <label>Field<select value={filter.fieldId} onChange={(event) => setFilter((current) => ({ ...current, fieldId: event.target.value }))}><option value="all">All fields</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.title}</option>)}</select></label>
                <label>Assignee<select value={filter.assigneeId} onChange={(event) => setFilter((current) => ({ ...current, assigneeId: event.target.value }))}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <label>Status<select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as TaskFilter["status"] }))}><option value="all">All statuses</option>{PROJECT_TASK_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
                <label>Priority<select value={filter.priority || "all"} onChange={(event) => setFilter((current) => ({ ...current, priority: event.target.value as NonNullable<TaskFilter["priority"]> }))}><option value="all">All priorities</option>{PROJECT_PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
                <label>Paused state<select value={filter.paused} onChange={(event) => setFilter((current) => ({ ...current, paused: event.target.value as TaskFilter["paused"] }))}><option value="all">Active and paused</option><option value="active">Active only</option><option value="paused">Paused only</option></select></label>
                {hasActiveFilters && <button type="button" className="pj-task-clear-filters" onClick={resetFilters}>Clear filters</button>}
              </motion.div>
            )}
          </div>
          <button type="button" className="pj-primary-button pj-task-add" disabled={!canCreateAny || !fields.length} title={!canCreateAny ? "Only the project owner or a field assignee can create tasks." : undefined} onClick={() => setEditTask(null)}>
            <Plus size={15} /> Add Task
          </button>
        </div>
      </div>

      {boardNotice && (
        <div className="pj-task-move-notice" role="status" aria-live="polite">
          <CircleAlert size={14} />
          <span>{boardNotice}</span>
          <button type="button" aria-label="Dismiss notice" onClick={() => setBoardNotice("")}><X size={13} /></button>
        </div>
      )}

      {!loading && filteredTasks.length === 0 && (
        <div className="pj-task-empty pj-task-empty-state">
          <span className="pj-task-empty-icon"><FileText size={20} /></span>
          <h2>{activeDropdownCount > 0 ? "No tasks match these filters" : hasQuery ? "No tasks match this search" : mode === "mine" ? "No tasks assigned to you" : "No tasks yet"}</h2>
          <p>{hasActiveFilters ? "Try changing or clearing your search and filters." : mode === "mine" ? "Tasks appear here only when your user account is assigned to the task." : canCreateAny ? "Create the first task to start work in this project." : "A project owner or field assignee can add tasks to a field."}</p>
          {hasActiveFilters && <button type="button" className="pj-ghost-button" onClick={resetFilters}>Clear search and filters</button>}
          {!hasActiveFilters && !tasks.length && canCreateAny && <button type="button" className="pj-primary-button" onClick={() => setEditTask(null)}><Plus size={14} /> Add Task</button>}
        </div>
      )}

      {loading ? <div className="pj-task-empty"><Spinner className="size-4 text-primary" /> Loading {mode === "mine" ? "your tasks" : "tasks"}…</div> : (
        <div className="pj-task-board-scroll" ref={boardScrollRef} onDragOver={onBoardDragOver}>
          <div className="pj-task-board" style={boardStyle} aria-label="Project task board">
            <LayoutGroup id={`project-${projectId}-tasks`}>
              {PROJECT_TASK_STATUSES.map((column) => {
                const slug = column.value.replace(/[^a-z]+/g, "-");
                const columnTasks = filteredTasks.filter((task) => task.status === column.value);
                const isPermittedOver = Boolean(dropTarget && dropTarget.status === column.value && dropTarget.permitted);
                const isRejectedOver = Boolean(dropTarget && dropTarget.status === column.value && !dropTarget.permitted);
                const nonDraggedTasks = columnTasks.filter((entry) => entry.id !== dragTaskId);
                const showIndicatorAt = isPermittedOver && dragTaskId ? dropTarget!.index : -1;

                return (
                  <section
                    key={column.value}
                    ref={(node) => { columnRefs.current[column.value] = node; }}
                    className={`pj-task-column pj-task-column-${slug}${isPermittedOver ? " is-drop-target" : ""}${isRejectedOver ? " is-drop-blocked" : ""}`}
                    onDragOver={(event) => onColumnDragOver(event, column.value)}
                    onDragLeave={(event) => onColumnDragLeave(event, column.value)}
                    onDrop={(event) => onDrop(event, column.value)}
                    aria-label={`${column.label} tasks`}
                  >
                    <header className="pj-task-column-head">
                      <span className={`pj-task-status-dot pj-task-dot-${slug}`} aria-hidden="true" />
                      <h3>{column.label}</h3>
                      <span className="pj-task-count">{columnTasks.length}</span>
                    </header>
                    <div
                      className="pj-task-column-list"
                      ref={(node) => { columnListRefs.current[column.value] = node; }}
                    >
                      <AnimatePresence initial={false} mode="popLayout">
                        {columnTasks.map((task) => {
                          const taskField = fieldById.get(task.field_id);
                          const authorized = canManageTask(access, taskField, userId);
                          const pauseLock = isTaskMoveLockedByPause(taskField, task);
                          const canAuthorizedMove = !pauseLock && (authorized || (task.assignee_id === userId && task.status !== "complete"));
                          const priority = priorityMeta(task.priority);
                          const peerIndex = nonDraggedTasks.findIndex((entry) => entry.id === task.id);
                          const indicatorBefore = peerIndex >= 0 && showIndicatorAt === peerIndex;
                          const isRejected = rejectedTaskId === task.id;
                          return (
                            <motion.article
                              key={task.id}
                              data-task-card-id={task.id}
                              layout={shouldReduceMotion ? false : "position"}
                              layoutId={shouldReduceMotion ? undefined : `project-task-${task.id}`}
                              initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
                              animate={shouldReduceMotion ? undefined : {
                                opacity: 1,
                                y: 0,
                                scale: 1,
                                x: isRejected ? [0, -7, 6, -3, 0] : 0,
                              }}
                              transition={shouldReduceMotion ? { duration: 0 } : {
                                layout: CULT_KANBAN_LAYOUT_SPRING,
                                opacity: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
                                y: CULT_KANBAN_ENTER_SPRING,
                                scale: CULT_KANBAN_ENTER_SPRING,
                                x: SNAPBACK_TRANSITION,
                              }}
                              onUpdate={NOOP_MOTION_UPDATE}
                              className={`pj-task-card${dragTaskId === task.id ? " is-dragging" : ""}${moving.has(task.id) ? " is-moving" : ""}${canAuthorizedMove ? " is-movable" : ""}${pauseLock ? " is-pause-locked" : ""}${indicatorBefore ? " has-drop-indicator-before" : ""}${isRejected ? " is-snap-back" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={`Open task ${task.name}`}
                              aria-grabbed={dragTaskId === task.id}
                              draggable={!moving.has(task.id)}
                              onDragStart={(event) => onDragStart(event as unknown as DragEvent<HTMLElement>, task)}
                              onDragEnd={onDragEnd}
                              onPointerDown={(event) => onCardPointerDown(event, task)}
                              onPointerMove={cancelPendingTouchHold}
                              onPointerUp={cancelPendingTouchHold}
                              onPointerCancel={cancelPendingTouchHold}
                              onClick={() => { if (!suppressClickRef.current) setViewTask(task); }}
                              onKeyDown={(event) => onCardKeyDown(event, task)}
                            >
                              <div className="pj-task-card-meta">
                                <Badge variant={priority.tone === "high" ? "destructive-light" : priority.tone === "medium" ? "warning-light" : "info-light"} size="xs" radius="full" className={`pj-task-priority-tag pj-priority-${priority.tone}`}>
                                  {priority.label}
                                </Badge>
                                {pauseLock && (
                                  <Badge
                                    variant="warning-light"
                                    size="xs"
                                    radius="full"
                                    className="pj-task-lock-pill"
                                    title={pauseLock === "task"
                                      ? "Paused task — resume before moving to another column"
                                      : "Linked field is paused — resume the field before moving its tasks across columns"}
                                  >
                                    <Pause size={9} aria-hidden="true" />
                                    {pauseLock === "task" ? "Paused" : "Field paused"}
                                  </Badge>
                                )}
                                <span className="pj-task-actions" onClick={(event) => event.stopPropagation()}>
                                  <MoreOptionsMenu
                                    label={`Task actions for ${task.name}`}
                                    iconOrientation="vertical"
                                    actions={authorized ? [
                                      { label: "Edit", icon: FileText, onSelect: () => setEditTask(task) },
                                      { label: task.paused ? "Resume" : "Pause", icon: task.paused ? Play : Pause, onSelect: () => void toggleTaskPauseFromBoard(task) },
                                      { label: "Delete", icon: Trash2, danger: true, onSelect: () => setDeleteTask(task) },
                                    ] : [
                                      { label: "View details", icon: Eye, onSelect: () => setViewTask(task) },
                                    ]}
                                  />
                                </span>
                              </div>
                              <span className="pj-task-title">{task.name}</span>
                            </motion.article>
                          );
                        })}
                      </AnimatePresence>
                      {showIndicatorAt >= nonDraggedTasks.length && columnTasks.length > 0 && (
                        <motion.div
                          className="pj-task-drop-indicator"
                          aria-hidden="true"
                          initial={shouldReduceMotion ? false : { opacity: 0, scaleX: 0.72 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          exit={{ opacity: 0, scaleX: 0.72 }}
                          transition={shouldReduceMotion ? { duration: 0 } : CULT_KANBAN_INDICATOR_SPRING}
                          onUpdate={NOOP_MOTION_UPDATE}
                        />
                      )}
                      {!columnTasks.length && (
                        <div className={`pj-task-column-empty${isPermittedOver ? " is-active" : ""}`}>
                          Drop tasks here
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </LayoutGroup>
          </div>
        </div>
      )}

      {touchDrag && typeof document !== "undefined" && createPortal(
        <div
          className="pj-task-touch-ghost"
          aria-hidden="true"
          style={{ width: touchDrag.width, transform: `translate3d(${Math.round(touchDrag.x - touchDrag.width / 2)}px, ${Math.round(touchDrag.y - 24)}px, 0) scale(1.01)` }}
        >
          <Badge variant={priorityMeta(touchDrag.task.priority).tone === "high" ? "destructive-light" : priorityMeta(touchDrag.task.priority).tone === "medium" ? "warning-light" : "info-light"} size="xs" radius="full" className={`pj-task-priority-tag pj-priority-${priorityMeta(touchDrag.task.priority).tone}`}>
            {priorityMeta(touchDrag.task.priority).label}
          </Badge>
          <span className="pj-task-title">{touchDrag.task.name}</span>
        </div>,
        document.body,
      )}

      {viewTask && (
        <TaskViewModal
          key={`view-${viewTask.id}`}
          projectId={projectId}
          task={tasks.find((entry) => entry.id === viewTask.id) || viewTask}
          fields={fields}
          access={access}
          userId={userId}
          uploadsEnabled={uploadsEnabled}
          maxUploadMb={maxUploadMb}
          onClose={() => setViewTask(null)}
          onEdit={(task) => { setViewTask(null); setEditTask(task); }}
          onDelete={(task) => { setViewTask(null); setDeleteTask(task); }}
          onMove={(taskId, nextStatus) => moveTask(taskId, nextStatus)}
          onRefresh={onRefresh}
          onOpenField={(fieldId) => {
            const field = fieldById.get(fieldId);
            if (field) { setViewTask(null); onOpenField(field); }
          }}
          notify={notify}
        />
      )}
      {editTask !== undefined && (
        <TaskFormModal
          key={`edit-${editTask?.id || "new"}`}
          projectId={projectId}
          task={editTask || undefined}
          fields={fields}
          team={team}
          access={access}
          userId={userId}
          uploadsEnabled={uploadsEnabled}
          maxUploadMb={maxUploadMb}
          onClose={() => setEditTask(undefined)}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
      {deleteTask && (
        <TaskDeleteModal
          task={deleteTask}
          busy={deleteBusy}
          onClose={() => { if (!deleteBusy) setDeleteTask(null); }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

function TaskDeleteModal({ task, busy, onClose, onConfirm }: { task: ProjectTask; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ProjectModal title={`Delete “${task.name}”?`} className="pj-task-modal" closeLabel="Close task dialog" onClose={onClose}>
      <p className="pj-modal-copy">This task will be removed from “{task.fieldTitle || "its field"}” and will no longer count toward that field’s task total or progress calculation. This cannot be undone.</p>
      <div className="pj-modal-actions">
        <button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pj-danger-button" onClick={onConfirm} disabled={busy}>{busy ? <Spinner className="size-3.5" /> : <Trash2 size={14} />} Delete task</button>
      </div>
    </ProjectModal>
  );
}

function TaskViewModal({ projectId, task: initialTask, fields, access, userId, uploadsEnabled, maxUploadMb, onClose, onEdit, onDelete, onMove, onRefresh, onOpenField, notify }: {
  projectId: string; task: ProjectTask; fields: ProjectField[]; access: ProjectAccess; userId: string; uploadsEnabled: boolean; maxUploadMb: number;
  onClose: () => void; onEdit: (task: ProjectTask) => void; onDelete: (task: ProjectTask) => void;
  onMove: (taskId: string, status: ProjectTaskStatus) => Promise<void>; onRefresh: () => Promise<void>;
  onOpenField: (fieldId: string) => void; notify: Props["notify"];
}) {
  const [task, setTask] = useState<ProjectTask>(initialTask);
  const [syncing, setSyncing] = useState(true);
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
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Task details could not be loaded.");
    } finally {
      setSyncing(false);
    }
  }, [projectId, initialTask.id]);

  useEffect(() => { void load(); }, [load]);

  const syncTaskAndProject = useCallback(async () => {
    await Promise.all([load(), onRefresh()]);
  }, [load, onRefresh]);

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
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task pause state could not be saved.", "error");
    } finally {
      setPauseBusy(false);
    }
  };

  const statusMeta = taskStatusMeta(task.status);
  const taskPriority = priorityMeta(task.priority);
  const pauseLock = isTaskMoveLockedByPause(taskField, task);
  return (
    <ProjectModal title="Task details" wide className="pj-task-modal" closeLabel="Close task dialog" onClose={onClose}>
      {loadError && <div className="pj-alert" role="alert"><CircleAlert size={14} /> {loadError}<button type="button" onClick={() => void load()}>Retry</button></div>}
      <div className="pj-task-view-actions">
        <Badge variant="primary-light" size="xs" radius="full" className={`pj-task-status-pill pj-task-pill-${task.status.replace(/[^a-z]+/g, "-")}`}>{statusMeta.label}</Badge>
        <Badge variant={taskPriority.tone === "high" ? "destructive-light" : taskPriority.tone === "medium" ? "warning-light" : "info-light"} size="xs" radius="full" className={`pj-task-priority-tag pj-priority-${taskPriority.tone}`}>{taskPriority.label}</Badge>
        <Badge variant={task.paused ? "warning-light" : "success-light"} size="xs" radius="full">{task.paused ? "Paused" : "Active"}</Badge>
        {pauseLock === "field" && <Badge variant="warning-light" size="xs" radius="full" className="pj-task-lock-pill"><Pause size={9} aria-hidden="true" /> Field paused</Badge>}
        {syncing && <Spinner className="size-3.5 text-muted-foreground" aria-label="Syncing task details" />}
        <span className="pj-flex-spacer" />
        {manager && <button type="button" className="pj-ghost-button" onClick={togglePause} disabled={pauseBusy}>{pauseBusy ? <Spinner className="size-3.5" /> : task.paused ? <Play size={14} /> : <Pause size={14} />}{task.paused ? "Resume" : "Pause"}</button>}
        {manager && <button type="button" className="pj-danger-button" onClick={() => onDelete(task)}><Trash2 size={14} /> Delete</button>}
        {manager && <button type="button" className="pj-primary-button" onClick={() => onEdit(task)}><FileText size={14} /> Edit</button>}
      </div>

      <section className="pj-task-view-section">
        <header><IconTile variant="soft" size="xs" className="text-violet-600"><FileText size={13} /></IconTile><h3>Task</h3></header>
        <h2 className="pj-task-view-title">{task.name}</h2>
        <p className="pj-task-view-description">{task.description || "No description has been added."}</p>
      </section>

      <section className="pj-task-view-section">
        <header><IconTile variant="soft" size="xs" className="text-blue-600"><Check size={13} /></IconTile><h3>Status and assignment</h3></header>
        <div className="pj-task-view-info">
          <div><span>Status</span><b>{statusMeta.label}{task.paused ? " · paused" : ""}</b></div>
          <div><span>Priority</span><b>{taskPriority.label}</b></div>
          <div><span>Assigned to</span><b>{task.assigneeName || "Unassigned"}</b></div>
          <div><span>Field</span><b>{task.fieldTitle || taskField?.title || "—"}{pauseLock === "field" ? " · paused" : ""}{taskField && <button type="button" className="pj-link-button" onClick={() => onOpenField(taskField.id)}>Open field</button>}</b></div>
          <div><span>Created</span><b>{formatDate(task.created_at)}</b></div>
          <div><span>Last updated</span><b>{formatDate(task.updated_at)}</b></div>
        </div>
        {allowedMoves.length > 1 ? (
          <div className="pj-task-view-move">
            <label>Move task<select value={statusChoice} onChange={(event) => setStatusChoice(event.target.value as ProjectTaskStatus)}>{allowedMoves.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
            <button type="button" className="pj-ghost-button" onClick={() => void handleMove()} disabled={statusBusy || statusChoice === task.status}>{statusBusy ? <Spinner className="size-3.5" /> : null}Move</button>
          </div>
        ) : pauseLock ? (
          <p className="pj-task-inline-hint">
            <Pause size={13} />
            {pauseLock === "task"
              ? "Resume this paused task before moving it to another column."
              : "This task’s field is paused. Resume the field before moving its tasks to another column."}
          </p>
        ) : null}
      </section>

      <TaskAttachments projectId={projectId} taskId={task.id} attachments={task.attachments || []} canManage={manager} uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb} pendingFiles={[]} setPendingFiles={() => undefined} onChanged={syncTaskAndProject} notify={notify} />
      <TaskConversation projectId={projectId} taskId={task.id} comments={task.comments || []} access={access} userId={userId} onChanged={syncTaskAndProject} notify={notify} />
    </ProjectModal>
  );
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
  const [priority, setPriority] = useState<ProjectPriority>(initialTask?.priority || "normal");
  const [pausedDraft, setPausedDraft] = useState<boolean>(Boolean(initialTask?.paused));
  const [initialComment, setInitialComment] = useState("");
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
      if (detail.priority) setPriority(detail.priority);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Task details could not be refreshed.", "error");
    }
  }, [projectId, persistedTask?.id, initialTask?.id, notify]);

  useEffect(() => { if (initialTask) void reloadTask(); }, [initialTask, reloadTask]);

  const field = fields.find((entry) => entry.id === fieldId);
  const currentField = fields.find((entry) => entry.id === (persistedTask?.field_id || initialTask?.field_id));
  const managerForCurrent = canManageTask(access, currentField, userId);
  const allowedStatuses = persistedTask
    ? PROJECT_TASK_STATUSES.filter((entry) => canMoveTask(access, currentField, persistedTask, userId, entry.value))
    : PROJECT_TASK_STATUSES.filter((entry) => entry.value !== "complete");
  const isPaused = persistedTask ? persistedTask.paused : pausedDraft;
  const fieldPaused = isFieldPaused(persistedTask ? currentField : field);
  const dirty = name !== (initialTask?.name || "")
    || description !== (initialTask?.description || "")
    || fieldId !== (initialTask?.field_id || eligibleFields[0]?.id || "")
    || assigneeId !== (initialTask?.assignee_id || "")
    || status !== (initialTask?.status || "todo")
    || priority !== (initialTask?.priority || "normal")
    || (!persistedTask && pausedDraft)
    || Boolean(initialComment.trim())
    || pendingFiles.length > 0;

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
    if (persistedTask && !canMoveTask(access, currentField, persistedTask, userId, status)) {
      setError(moveTaskRejectionMessage(access, currentField, persistedTask, userId, status) || "That status change is not allowed.");
      return;
    }
    if (cleanName.length > 240) { setError("Task names can be up to 240 characters."); return; }
    setError("");
    setBusy(true);
    let saved = persistedTask;
    const creatingNew = !saved;
    try {
      const input: ProjectTaskInput = { name: cleanName, description: description.trim(), fieldId, assigneeId: assigneeId || null, status, priority };
      saved = saved ? await updateProjectTask(projectId, saved.id, input) : await createProjectTask(projectId, input);
      if (creatingNew && pausedDraft && saved?.id) saved = await pauseProjectTask(projectId, saved.id, true);
      setPersistedTask(saved);
      for (const file of [...pendingFiles]) {
        await uploadProjectTaskAttachment(projectId, saved.id, file);
        setPendingFiles((current) => current.filter((entry) => entry !== file));
      }
      if (initialComment.trim() && saved?.id) {
        await addProjectTaskComment(projectId, saved.id, initialComment.trim());
        setInitialComment("");
      }
      await onRefresh();
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
    } finally {
      setBusy(false);
    }
  };

  const pauseResume = async () => {
    if (!persistedTask) { setPausedDraft((current) => !current); return; }
    if (!managerForCurrent || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await pauseProjectTask(projectId, persistedTask.id, !persistedTask.paused);
      setPersistedTask(saved);
      setTaskDetail((current) => current ? { ...current, ...saved } : saved);
      await onRefresh();
      notify(saved.paused ? "Task paused. Its status was preserved." : "Task resumed in the same status.", "success");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The task pause state could not be saved.";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const persistedAttachments = taskDetail?.attachments || [];
  const canManageCurrent = Boolean(persistedTask ? managerForCurrent : access.owner || field?.assignee_id === userId);
  const title = initialTask || persistedTask ? "Edit task" : "Add task";

  return (
    <ProjectModal title={title} wide className="pj-task-modal" closeLabel="Close task dialog" onClose={requestClose}>
      <form className="pj-form pj-task-form" onSubmit={(event) => void save(event)}>
        <label>Task name<input value={name} maxLength={240} onChange={(event) => setName(event.target.value)} placeholder="e.g. Draft the launch announcement" required autoFocus /></label>
        <label>Description <small>(optional)</small><textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, acceptance notes, or useful links…" /></label>
        <div className="pj-form-grid">
          <label>Assign to<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Select field<select value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">Choose a field</option>{fields.map((entry) => <option key={entry.id} value={entry.id} disabled={!access.owner && entry.assignee_id !== userId}>{entry.title}{!access.owner && entry.assignee_id !== userId ? " · not assigned to you" : ""}</option>)}</select></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ProjectTaskStatus)}>{allowedStatuses.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
          <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as ProjectPriority)}>{PROJECT_PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        </div>
        <div className="pj-task-pause-control pj-task-pause-row">
          <span>Pause state</span>
          <button type="button" className="pj-ghost-button" onClick={() => void pauseResume()} disabled={(persistedTask ? !managerForCurrent : !canManageCurrent) || busy}>
            {busy && persistedTask ? <Spinner className="size-3.5" /> : isPaused ? <Play size={14} /> : <Pause size={14} />}
            {isPaused ? "Resume task" : "Pause task"}
          </button>
          <small>
            {isPaused
              ? "Paused tasks stay in their current column and cannot move across columns until resumed."
              : fieldPaused
                ? "This field is currently paused — linked tasks are locked in their columns until the field is resumed."
                : "Pausing preserves status and locks cross-column movement until resumed."}
          </small>
        </div>

        <TaskAttachments projectId={projectId} taskId={persistedTask?.id} attachments={persistedAttachments} canManage={canManageCurrent} uploadsEnabled={uploadsEnabled} maxUploadMb={maxUploadMb} pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} onChanged={async () => { await reloadTask(); await onRefresh(); }} notify={notify} />
        {!persistedTask && (
          <section className="pj-task-view-section pj-task-comments">
            <header><IconTile variant="soft" size="xs" className="text-violet-600"><MessageSquare size={13} /></IconTile><h3>Comments</h3><Badge variant="secondary" size="xs" radius="full">{initialComment.trim() ? 1 : 0}</Badge></header>
            <p className="pj-task-inline-hint">Optional initial comment — posted automatically when you create the task.</p>
            <div className="pj-comment-input">
              <textarea rows={2} maxLength={2000} value={initialComment} onChange={(event) => setInitialComment(event.target.value)} placeholder="Add an initial comment…" aria-label="Add an initial task comment" />
            </div>
          </section>
        )}
        {error && <p className="pj-form-error" role="alert"><CircleAlert size={14} /> {error}</p>}
        <div className="pj-modal-actions">
          <button type="button" className="pj-ghost-button" onClick={requestClose} disabled={busy}>Cancel</button>
          <button type="submit" className="pj-primary-button" disabled={busy || !name.trim() || !fieldId}>{busy ? <Spinner className="size-3.5" /> : null}{persistedTask ? "Save task" : "Create task"}</button>
        </div>
      </form>
      {persistedTask && (
        <TaskConversation projectId={projectId} taskId={persistedTask.id} comments={taskDetail?.comments || []} access={access} userId={userId} onChanged={async () => { await reloadTask(); await onRefresh(); }} notify={notify} />
      )}
    </ProjectModal>
  );
}

function TaskAttachments({ projectId, taskId, attachments, canManage, uploadsEnabled, maxUploadMb, pendingFiles, setPendingFiles, onChanged, notify }: {
  projectId: string; taskId?: string; attachments: ProjectTaskAttachment[]; canManage: boolean; uploadsEnabled: boolean; maxUploadMb: number;
  pendingFiles: File[]; setPendingFiles: (files: File[] | ((current: File[]) => File[])) => void; onChanged: () => Promise<void>; notify: Props["notify"];
}) {
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  const upload = async (file?: File) => {
    if (!file || !canManage || !uploadsEnabled || busy) return;
    const validation = validateProjectAttachmentFile(file, maxUploadMb);
    if (validation) { notify(validation, "error"); return; }
    if (!taskId) {
      setPendingFiles((current) => current.some((entry) => entry.name === file.name && entry.size === file.size) ? current : [...current, file]);
      return;
    }
    setBusy(true);
    setUploadProgress({ loaded: 0, total: file.size, percent: 0, remainingSeconds: null });
    try {
      await uploadProjectTaskAttachment(projectId, taskId, file, setUploadProgress);
      setPendingFiles((current) => current.filter((entry) => !(entry.name === file.name && entry.size === file.size)));
      await onChanged();
      notify("Private task attachment uploaded.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task attachment could not be uploaded.", "error");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const previewFile = async (file: ProjectTaskAttachment) => {
    if (!(file.file_type.startsWith("image/") || file.file_type === "application/pdf") || !taskId) return;
    setBusy(true);
    try {
      const blob = await loadProjectTaskAttachment(projectId, taskId, file.id, true);
      setPreview({ url: URL.createObjectURL(blob), type: file.file_type, name: file.file_name });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task attachment preview could not be opened.", "error");
    } finally {
      setBusy(false);
    }
  };

  const download = async (file: ProjectTaskAttachment) => {
    if (!taskId) return;
    setBusy(true);
    try {
      const blob = await loadProjectTaskAttachment(projectId, taskId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.file_name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task attachment could not be downloaded.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: ProjectTaskAttachment) => {
    if (!taskId || !canManage || busy || !window.confirm(`Remove “${file.file_name}” from this task?`)) return;
    setBusy(true);
    try {
      await deleteProjectTaskAttachment(projectId, taskId, file.id);
      await onChanged();
      notify("Task attachment removed.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The task attachment could not be removed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="pj-task-view-section pj-task-attachments">
        <header>
          <IconTile variant="soft" size="xs" className="text-blue-600"><Paperclip size={13} /></IconTile>
          <h3>Attachments</h3>
          <Badge variant="secondary" size="xs" radius="full">{attachments.length + pendingFiles.length}</Badge>
          <span className="pj-flex-spacer" />
          {canManage && uploadsEnabled && (
            <label className={`pj-attachment-upload ${busy ? "is-busy" : ""}`}>
              <input type="file" multiple accept={PROJECT_ATTACHMENT_ACCEPT} disabled={busy} onChange={(event) => { const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : []; try { event.currentTarget.value = ""; } catch { /* synthetic FileList */ } files.forEach((file) => void upload(file)); }} />
              {busy ? <Spinner className="size-3.5" /> : <Plus size={14} />} Add files
            </label>
          )}
        </header>
        <p className="pj-detail-permission-note">Files stay in Persora’s private storage. PDFs and images can be previewed; supported documents can be downloaded.</p>
        {canManage && !uploadsEnabled && <small className="pj-muted">Uploads are disabled for this account. Existing files remain available.</small>}
        {busy && uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Uploading task attachment…" detail={`${formatProjectFileSize(uploadProgress.loaded)} of ${formatProjectFileSize(uploadProgress.total)}`} className="mt-2" />}
        {!taskId && pendingFiles.length > 0 && (
          <div className="pj-attachment-list flex flex-col gap-1.5 mt-2">
            {pendingFiles.map((file, index) => (
              <Attachment key={`${file.name}:${file.size}:${index}`} size="sm" state="done">
                <AttachmentMedia>
                  <FileType type={getFileType(file.name || file.type)} size="sm" variant="light" aria-hidden />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{file.name}</AttachmentTitle>
                  <AttachmentDescription>{formatProjectFileSize(file.size)} · waiting for task save</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction type="button" aria-label={`Remove ${file.name} from upload queue`} onClick={() => setPendingFiles((current) => current.filter((entry) => entry !== file))} className="text-destructive"><Trash2 className="size-3.5" /></AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </div>
        )}
        <div className="pj-attachment-list flex flex-col gap-1.5 mt-2">
          {attachments.map((file) => (
            <Attachment key={file.id} size="sm" state="done">
              <AttachmentMedia>
                <FileType type={getFileType(file.file_name || file.file_type)} size="sm" variant="light" aria-hidden />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle title={file.file_name}>{file.file_name}</AttachmentTitle>
                <AttachmentDescription>{formatProjectFileSize(file.file_size)} · {file.uploaderName} · {formatDate(file.created_at)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                {(file.file_type.startsWith("image/") || file.file_type === "application/pdf") && <AttachmentAction type="button" onClick={() => void previewFile(file)} disabled={busy} aria-label={`Preview ${file.file_name}`}><Eye className="size-3.5" /></AttachmentAction>}
                <AttachmentAction type="button" onClick={() => void download(file)} disabled={busy} aria-label={`Download ${file.file_name}`}><Download className="size-3.5" /></AttachmentAction>
                {canManage && <AttachmentAction type="button" onClick={() => void remove(file)} disabled={busy} aria-label={`Remove ${file.file_name}`} className="text-destructive"><Trash2 className="size-3.5" /></AttachmentAction>}
              </AttachmentActions>
            </Attachment>
          ))}
          {!attachments.length && !pendingFiles.length && <p className="pj-attachment-empty">No attachments on this task yet.</p>}
        </div>
      </section>
      {preview && (
        <ProjectModal title={`Preview · ${preview.name}`} wide className="pj-task-modal" closeLabel="Close task dialog" onClose={() => setPreview(null)}>
          <div className="pj-attachment-preview">
            {preview.type.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <iframe src={preview.url} title={`Preview ${preview.name}`} sandbox="allow-same-origin" />}
          </div>
        </ProjectModal>
      )}
    </>
  );
}

function TaskConversation({ projectId, taskId, comments, access, userId, onChanged, notify }: {
  projectId: string; taskId: string; comments: ProjectTaskComment[]; access: ProjectAccess; userId: string; onChanged: () => Promise<void>; notify: Props["notify"];
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingBody, setEditingBody] = useState("");

  const post = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await addProjectTaskComment(projectId, taskId, body); setDraft(""); await onChanged(); }
    catch (error) { notify(error instanceof Error ? error.message : "The task comment could not be posted.", "error"); }
    finally { setBusy(false); }
  };

  const save = async (comment: ProjectTaskComment) => {
    const body = editingBody.trim();
    if (!body || busy) return;
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

  return (
    <section className="pj-task-view-section pj-task-comments">
      <header><span className="pj-detail-section-icon pj-detail-purple"><MessageSquare size={15} /></span><h3>Comments</h3><span className="pj-chip pj-chip-muted">{comments.length}</span></header>
      <ul>
        {comments.map((comment) => (
          <li key={comment.id}>
            <span className="pj-task-comment-avatar" aria-hidden="true">{initialsFor(comment.author_name)}</span>
            <div className="pj-task-comment-body">
              <header><b>{comment.author_name || "A member"}</b><time>{formatDate(comment.created_at)}{comment.updated_at !== comment.created_at ? " · edited" : ""}</time></header>
              {editingId === comment.id ? (
                <div className="pj-task-comment-edit">
                  <textarea rows={2} maxLength={2000} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} />
                  <div>
                    <button type="button" className="pj-ghost-button" onClick={() => setEditingId("")} disabled={busy}>Cancel</button>
                    <button type="button" className="pj-primary-button" onClick={() => void save(comment)} disabled={busy || !editingBody.trim()}>Save</button>
                  </div>
                </div>
              ) : <p>{comment.body}</p>}
              {editingId !== comment.id && (canEditComment(comment, userId) || canDeleteComment(access, comment, userId)) && (
                <div className="pj-comment-actions">
                  {canEditComment(comment, userId) && <button type="button" onClick={() => { setEditingId(comment.id); setEditingBody(comment.body); }}>Edit</button>}
                  {canDeleteComment(access, comment, userId) && <button type="button" className="pj-danger-text" onClick={() => void remove(comment)}>Delete</button>}
                </div>
              )}
            </div>
          </li>
        ))}
        {!comments.length && <li className="pj-muted">No comments yet.</li>}
      </ul>
      <form className="pj-comment-input" onSubmit={(event) => void post(event)}>
        <textarea rows={2} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a comment…" aria-label="Add a task comment" />
        <button type="submit" className="pj-primary-button" disabled={busy || !draft.trim()}>{busy ? <Spinner className="size-3.5" /> : <Send size={14} />} Post</button>
      </form>
    </section>
  );
}
