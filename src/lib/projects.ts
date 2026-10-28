// Pure Projects helpers — status/role/folder metadata, permission predicates,
// task-derived progress, filtering, sorting, and formatting. This module stays
// free of DOM/network access so the same rules can be exercised in unit tests.
import type {
  ProjectField, ProjectFieldStatus, ProjectFolderColor, ProjectMemberRole, ProjectPriority, ProjectRecord,
  ProjectTask, ProjectTaskStatus,
} from "../types";

export const PROJECT_STATUSES: { value: ProjectFieldStatus; label: string; tone: "muted" | "accent" | "warning" | "danger" | "success" }[] = [
  { value: "planning", label: "Planning", tone: "muted" },
  { value: "in-progress", label: "In Progress", tone: "accent" },
  // Internal values remain stable so existing field records and APIs keep working.
  { value: "blocked", label: "Paused", tone: "danger" },
  { value: "in-review", label: "In Review", tone: "warning" },
  { value: "completed", label: "Complete", tone: "success" },
];
export const PROJECT_SORT_OPTIONS = [
  { value: "updated", label: "Last updated" },
  { value: "name", label: "Name (A–Z)" },
  { value: "progress", label: "Progress" },
  { value: "due", label: "Due date" },
] as const;
export type ProjectSortKey = (typeof PROJECT_SORT_OPTIONS)[number]["value"];
export const FOLDER_COLORS: { value: ProjectFolderColor; label: string }[] = [
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "blue", label: "Blue" },
  { value: "orange", label: "Orange" },
  { value: "green", label: "Green" },
];
export const PROJECT_MEMBER_ROLES: { value: ProjectMemberRole; label: string; hint: string }[] = [
  { value: "editor", label: "Editor", hint: "Edits fields they created; can also create with your grant." },
  { value: "commenter", label: "Commenter", hint: "Comments on fields and requests new ones." },
  { value: "viewer", label: "Viewer", hint: "Follows progress, pins and favourites." },
];

export const PROJECT_PRIORITIES: { value: ProjectPriority; label: string; tone: "high" | "medium" | "normal" | "low" }[] = [
  { value: "high", label: "High", tone: "high" },
  { value: "medium", label: "Medium", tone: "medium" },
  { value: "normal", label: "Normal", tone: "normal" },
  { value: "low", label: "Low", tone: "low" },
];
export function priorityMeta(priority: ProjectPriority | string | null | undefined) {
  return PROJECT_PRIORITIES.find((entry) => entry.value === priority) || PROJECT_PRIORITIES[2];
}
export function parseProjectTags(raw: string | ReadonlyArray<string> | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of parts) {
    const cleaned = String(entry || "").trim().replace(/^#+/, "").trim().slice(0, 40);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 12) break;
  }
  return out;
}
export function isFieldPaused(field: Partial<Pick<ProjectField, "status">> | null | undefined): boolean {
  return field?.status === "blocked";
}
export function isTaskMoveLockedByPause(
  field: Partial<Pick<ProjectField, "status">> | null | undefined,
  task: Partial<Pick<ProjectTask, "paused">> | null | undefined,
): "task" | "field" | null {
  if (task?.paused) return "task";
  if (isFieldPaused(field)) return "field";
  return null;
}

export const PROJECT_TASK_STATUSES: { value: ProjectTaskStatus; label: string; tone: "purple" | "amber" | "blue" | "green" }[] = [
  { value: "todo", label: "To Do", tone: "purple" },
  { value: "in-progress", label: "In Progress", tone: "amber" },
  { value: "in-review", label: "In Review", tone: "blue" },
  { value: "complete", label: "Complete", tone: "green" },
];
export function taskStatusMeta(status: ProjectTaskStatus) {
  return PROJECT_TASK_STATUSES.find((entry) => entry.value === status) || PROJECT_TASK_STATUSES[0];
}

export function statusMeta(status: ProjectFieldStatus) {
  return PROJECT_STATUSES.find((entry) => entry.value === status) || PROJECT_STATUSES[0];
}

/** Field progress is a projection of persisted task statuses, never field workflow status. */
export function progressForStatus(_status: ProjectFieldStatus, progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress) || 0));
}

export function taskProgress(tasks: ReadonlyArray<Pick<ProjectTask, "status">> | null | undefined): { total: number; completed: number; percent: number } {
  const list = tasks || [];
  const total = list.length;
  const completed = list.filter((task) => task.status === "complete").length;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export function taskProgressForField(tasks: ProjectTask[] | null | undefined, fieldId: string): { total: number; completed: number; percent: number } {
  return taskProgress((tasks || []).filter((task) => task.field_id === fieldId));
}

/** Rebuilds field progress from the current task set, useful after optimistic moves and reloads. */
export function fieldsWithTaskProgress(fields: ProjectField[], tasks: ProjectTask[]): ProjectField[] {
  const counts = new Map<string, { total: number; completed: number }>();
  for (const task of tasks) {
    const count = counts.get(task.field_id) || { total: 0, completed: 0 };
    count.total += 1;
    if (task.status === "complete") count.completed += 1;
    counts.set(task.field_id, count);
  }
  return fields.map((field) => {
    const count = counts.get(field.id) || { total: 0, completed: 0 };
    return {
      ...field,
      taskCount: count.total,
      completedTaskCount: count.completed,
      progress: count.total ? Math.round((count.completed / count.total) * 100) : 0,
    };
  });
}

/** Field progress values received from the Worker are already task-derived. */
export function fieldProgress(field: Pick<ProjectField, "progress">): number {
  return Math.max(0, Math.min(100, Math.round(Number(field.progress) || 0)));
}

export interface ProjectAccessLike { owner: boolean; role: string; canCreateFields: boolean }

export function canCreateField(access: ProjectAccessLike | null | undefined): boolean {
  if (!access) return false;
  return Boolean(access.owner || (access.role === "editor" && access.canCreateFields));
}
/** Members without the creation grant propose fields through requests instead. */
export function canRequestField(access: ProjectAccessLike | null | undefined): boolean {
  if (!access) return false;
  return !canCreateField(access);
}
export function canCreateFolder(access: ProjectAccessLike | null | undefined): boolean {
  return canCreateField(access);
}
export function canManageFolder(access: ProjectAccessLike | null | undefined): boolean {
  return Boolean(access?.owner);
}
export function canManageMembers(access: ProjectAccessLike | null | undefined): boolean {
  return Boolean(access?.owner);
}
export function canEditField(access: ProjectAccessLike | null | undefined, field: Pick<ProjectField, "creator_id">, userId: string): boolean {
  if (!access) return false;
  return Boolean(access.owner || field.creator_id === userId);
}
export const canDeleteField = canEditField;
export function canEditComment(comment: { author_id: string }, userId: string): boolean {
  return comment.author_id === userId;
}
/** Authors delete their own comments; the project owner moderates everything. */
export function canDeleteComment(access: ProjectAccessLike | null | undefined, comment: { author_id: string }, userId: string): boolean {
  return Boolean(access?.owner) || comment.author_id === userId;
}

/** Task CRUD belongs only to the project owner or the assignee of that task's field. */
export function canManageTask(access: ProjectAccessLike | null | undefined, field: Pick<ProjectField, "assignee_id"> | null | undefined, userId: string): boolean {
  if (!access || !userId || !field) return false;
  return Boolean(access.owner || field.assignee_id === userId);
}
export const canCreateTaskInField = canManageTask;

/**
 * Status move rules: field assignee/project owner may manage/reopen tasks, but
 * completion can only follow In Review. A task assignee may move active tasks
 * among the first three statuses and cannot edit or reopen a completed task.
 * Cross-column movement is locked while the task itself or its linked field is paused.
 */
export function canMoveTask(
  access: ProjectAccessLike | null | undefined,
  field: (Pick<ProjectField, "assignee_id"> & Partial<Pick<ProjectField, "status">>) | null | undefined,
  task: (Pick<ProjectTask, "status" | "assignee_id"> & Partial<Pick<ProjectTask, "paused">>) | null | undefined,
  userId: string,
  nextStatus: ProjectTaskStatus,
): boolean {
  if (!access || !userId || !field || !task) return false;
  if (nextStatus !== task.status && isTaskMoveLockedByPause(field, task)) return false;
  const manager = canManageTask(access, field, userId);
  if (manager) {
    if (nextStatus === "complete" && task.status !== "in-review" && task.status !== "complete") return false;
    return true;
  }
  return task.assignee_id === userId && task.status !== "complete" && nextStatus !== "complete";
}

export function moveTaskRejectionMessage(
  access: ProjectAccessLike | null | undefined,
  field: (Pick<ProjectField, "assignee_id"> & Partial<Pick<ProjectField, "status">>) | null | undefined,
  task: (Pick<ProjectTask, "status" | "assignee_id"> & Partial<Pick<ProjectTask, "paused">>) | null | undefined,
  userId: string,
  nextStatus: ProjectTaskStatus,
): string | null {
  if (!access || !userId || !field || !task) return "You do not have permission to move this task.";
  if (canMoveTask(access, field, task, userId, nextStatus)) return null;
  if (nextStatus !== task.status) {
    const lock = isTaskMoveLockedByPause(field, task);
    if (lock === "task") return "Resume this paused task before moving it to another column.";
    if (lock === "field") return "This task’s field is paused. Resume the field before moving its tasks to another column.";
  }
  const manager = canManageTask(access, field, userId);
  if (nextStatus === "complete" && manager && task.status !== "in-review") {
    return "Move this task to In Review before marking it Complete.";
  }
  if (nextStatus === "complete" && !manager) {
    return "Only the project owner or field assignee can mark a task Complete.";
  }
  if (task.status === "complete" && !manager) {
    return "Only the project owner or field assignee can reopen a completed task.";
  }
  return "Only the project owner, field assignee, or assigned member can move this task.";
}

export const KANBAN_COLUMN_GAP_PX = 17;
export const KANBAN_MIN_COLUMN_WIDTH_PX = 232;

/** Exact 4-column board width formula: (W - 3G) / 4, preserving readable columns on narrow viewports. */
export function calculateKanbanColumnWidth(
  boardInnerWidth: number,
  gapPx: number = KANBAN_COLUMN_GAP_PX,
  minColumnWidth: number = KANBAN_MIN_COLUMN_WIDTH_PX,
): number {
  const usable = Math.max(0, Number(boardInnerWidth) || 0);
  const gap = Math.max(0, Number(gapPx) || 0);
  const raw = (usable - 3 * gap) / 4;
  return Math.max(minColumnWidth, Math.round(raw * 100) / 100);
}

/** Computes a sort_order integer when inserting a dragged task at `insertIndex` in a column. */
export function computeDropSortOrder(
  columnTasks: ReadonlyArray<Pick<ProjectTask, "id" | "sort_order">>,
  insertIndex: number,
  draggedTaskId: string,
): number {
  const peers = columnTasks.filter((entry) => entry.id !== draggedTaskId);
  if (!peers.length) return 100;
  const clamped = Math.max(0, Math.min(peers.length, insertIndex));
  if (clamped === 0) return peers[0].sort_order - 100;
  if (clamped >= peers.length) return peers[peers.length - 1].sort_order + 100;
  const prev = peers[clamped - 1].sort_order;
  const next = peers[clamped].sort_order;
  if (next - prev >= 2) return Math.floor((prev + next) / 2);
  return prev + 1;
}

export function projectKindLabel(kind: ProjectRecord["kind"]): string {
  return kind === "shared" ? "Shared project" : "Personal project";
}

// ---------------------------------------------------------------------------
// Filtering + sorting
// ---------------------------------------------------------------------------
export interface FieldFilter { query: string; status: ProjectFieldStatus | "all"; folderId: string | "all" | "none"; sort: ProjectSortKey }

export function filterSortFields(fields: ProjectField[], filter: FieldFilter): ProjectField[] {
  const query = filter.query.trim().toLowerCase();
  const visible = fields.filter((field) => {
    if (filter.status !== "all" && field.status !== filter.status) return false;
    if (filter.folderId === "none" && field.folder_id) return false;
    if (filter.folderId !== "all" && filter.folderId !== "none" && field.folder_id !== filter.folderId) return false;
    if (query) {
      const haystack = [field.title, field.description, field.creator_name, field.assigneeName || ""].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  const pinned = (field: ProjectField) => (field.mine?.pinned ? 1 : 0);
  visible.sort((a, b) => {
    const pinDelta = pinned(b) - pinned(a);
    if (pinDelta !== 0) return pinDelta;
    switch (filter.sort) {
      case "name": return a.title.localeCompare(b.title);
      case "progress": return fieldProgress(b) - fieldProgress(a);
      case "due": return (a.due_date || "9999-99-99").localeCompare(b.due_date || "9999-99-99");
      case "updated":
      default: return String(b.updated_at).localeCompare(String(a.updated_at));
    }
  });
  return visible;
}

export type TaskViewMode = "all" | "mine";
export interface TaskFilter {
  query: string;
  fieldId: string | "all";
  assigneeId: string | "all" | "unassigned";
  status: ProjectTaskStatus | "all";
  priority?: ProjectPriority | "all";
  paused: "all" | "paused" | "active";
}

/** Applies the exact authenticated user ID check before search/filter predicates. */
export function filterProjectTasks(
  tasks: ProjectTask[],
  fields: ProjectField[],
  filter: TaskFilter,
  mode: TaskViewMode,
  userId: string,
): ProjectTask[] {
  const query = filter.query.trim().toLocaleLowerCase();
  const fieldNames = new Map(fields.map((field) => [field.id, field.title]));
  const wantedPriority = filter.priority && filter.priority !== "all" ? filter.priority : null;
  return tasks.filter((task) => {
    if (mode === "mine" && (!userId || task.assignee_id !== userId)) return false;
    if (filter.fieldId !== "all" && task.field_id !== filter.fieldId) return false;
    if (filter.assigneeId === "unassigned" && task.assignee_id) return false;
    if (filter.assigneeId !== "all" && filter.assigneeId !== "unassigned" && task.assignee_id !== filter.assigneeId) return false;
    if (filter.status !== "all" && task.status !== filter.status) return false;
    if (wantedPriority && (task.priority || "normal") !== wantedPriority) return false;
    if (filter.paused === "paused" && !task.paused) return false;
    if (filter.paused === "active" && task.paused) return false;
    if (query) {
      const haystack = `${task.name} ${task.description || ""} ${task.fieldTitle || fieldNames.get(task.field_id) || ""}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)));
}

export function projectStats(fields: ProjectField[], members: number) {
  return {
    active: fields.filter((field) => field.status === "in-progress" || field.status === "planning" || field.status === "blocked").length,
    inReview: fields.filter((field) => field.status === "in-review").length,
    completed: fields.filter((field) => field.status === "completed").length,
    members,
    completion: fields.length ? Math.round((fields.filter((field) => field.status === "completed").length / fields.length) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function initialsFor(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
/** How a person's chosen profile picture renders. Unknown or unsafe values fall back to initials. */
export type ProfileAvatar = { kind: "photo" | "image"; src: string } | { kind: "emoji"; emoji: string } | { kind: "initials" };
export function profileAvatar(avatarUrl: string | null | undefined): ProfileAvatar {
  const value = typeof avatarUrl === "string" ? avatarUrl.trim() : "";
  if (!value) return { kind: "initials" };
  if (value.startsWith("emoji:")) {
    const emoji = value.slice(6).trim();
    return emoji && Array.from(emoji).length <= 24 && !/[\u0000-\u001f<>]/.test(emoji) ? { kind: "emoji", emoji } : { kind: "initials" };
  }
  if (value.length <= 80000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return { kind: "photo", src: value };
  if (/^https:\/\/api\.dicebear\.com\/7\.x\/adventurer\/svg\?seed=[A-Za-z0-9_-]{1,40}$/.test(value)) return { kind: "image", src: value };
  return { kind: "initials" };
}
const AVATAR_TONES = ["cyan", "purple", "pink", "blue", "orange", "green"] as const;
export function avatarTone(name: string): (typeof AVATAR_TONES)[number] {
  let hash = 0;
  const value = String(name || "?");
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 0) return formatDate(iso);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(`${iso}`.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    project_created: "created this project",
    project_updated: "updated project settings",
    member_added: "added a member",
    member_updated: "updated a member",
    member_removed: "removed a member",
    member_left: "left the project",
    folder_created: "created folder",
    folder_updated: "updated folder",
    field_requested: "requested a field",
    field_request_withdrawn: "withdrew a field request",
    field_request_approved: "approved a field request",
    field_request_rejected: "rejected a field request",
    field_created: "created field",
    field_updated: "updated field",
    field_status_changed: "moved field",
    field_deleted: "deleted field",
    task_created: "created task",
    task_updated: "updated task",
    task_status_changed: "moved task",
    task_field_changed: "moved task to another field",
    task_paused: "paused task",
    task_resumed: "resumed task",
    task_deleted: "deleted task",
    task_comment_added: "commented on task",
    task_attachment_added: "attached a file to task",
    task_attachment_removed: "removed a task attachment",
    comment_added: "commented on",
  };
  return labels[action] || action.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Shared attachment validation & Cult UI motion presets
// ---------------------------------------------------------------------------
export const PROJECT_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx";

const PROJECT_ATTACHMENT_MIMES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function validateProjectAttachmentFile(file: File, maxUploadMb: number): string {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const expected = PROJECT_ATTACHMENT_MIMES[extension];
  if (!expected) return "Choose a PDF, image, text/CSV, Word, Excel or PowerPoint file.";
  if (!file.size) return "The selected file is empty.";
  const limit = Math.max(1, Math.min(150, Number(maxUploadMb) || 25)) * 1024 * 1024;
  if (file.size > limit) return `Choose a file no larger than ${Math.floor(limit / 1024 / 1024)} MB.`;
  if (
    file.type
    && file.type !== expected
    && file.type !== "application/octet-stream"
    && !(extension === "csv" && file.type === "application/vnd.ms-excel")
  ) {
    return "The file extension and content type do not match.";
  }
  return "";
}

export function formatProjectFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Composed Cult UI floating dialog & Kanban transitions — smooth, unhurried, GPU-only. */
export const CULT_MODAL_TRANSITION = { type: "spring" as const, stiffness: 250, damping: 26, mass: 0.9 };
export const CULT_POPOVER_TRANSITION = { type: "spring" as const, bounce: 0.05, duration: 0.28 };
export const CULT_KANBAN_LAYOUT_SPRING = { type: "spring" as const, stiffness: 205, damping: 26, mass: 0.95 };
export const CULT_KANBAN_ENTER_SPRING = { type: "spring" as const, stiffness: 225, damping: 26, mass: 0.9 };
export const CULT_KANBAN_INDICATOR_SPRING = { type: "spring" as const, stiffness: 240, damping: 26 };

