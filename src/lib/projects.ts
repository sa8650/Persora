// Pure Projects helpers — status/role/folder metadata, permission predicates,
// filtering, sorting, and formatting. Imported by ProjectsView and unit tests;
// keep this module free of DOM/network access.
import type { ProjectField, ProjectFieldStatus, ProjectFolderColor, ProjectMemberRole, ProjectRecord, ProjectSubtask } from "../types";

export const PROJECT_STATUSES: { value: ProjectFieldStatus; label: string; tone: "muted" | "accent" | "warning" | "danger" | "success" }[] = [
  { value: "planning", label: "Planning", tone: "muted" },
  { value: "in-progress", label: "In Progress", tone: "accent" },
  { value: "in-review", label: "In Review", tone: "warning" },
  { value: "blocked", label: "Blocked", tone: "danger" },
  { value: "completed", label: "Completed", tone: "success" },
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

export function statusMeta(status: ProjectFieldStatus) {
  return PROJECT_STATUSES.find((entry) => entry.value === status) || PROJECT_STATUSES[0];
}

/** Completed always means 100% — mirrors the server-side normalisation. */
export function progressForStatus(status: ProjectFieldStatus, progress: number): number {
  if (status === "completed") return 100;
  return Math.max(0, Math.min(100, Math.round(progress) || 0));
}

// ---------------------------------------------------------------------------
// Checklist-derived progress
// ---------------------------------------------------------------------------
/**
 * Field progress is derived from its checklist only:
 * (completed items ÷ total items) × 100, rounded; 0% when the checklist is empty.
 */
export function checklistProgress(items: ReadonlyArray<{ completed: boolean }> | null | undefined): { total: number; completed: number; percent: number } {
  const list = items || [];
  const total = list.length;
  const completed = list.filter((item) => item.completed).length;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}
/** The single progress value shown on field cards, the view modal, tables, and sorting. */
export function fieldProgress(field: Pick<ProjectField, "subtasks">): number {
  return checklistProgress(field.subtasks).percent;
}

/** A checklist row as edited inside the Create/Edit field modal. `id` is set once persisted. */
export interface ChecklistDraftItem { key: string; id?: string; title: string; completed: boolean; assigneeId: string | null }

export function checklistDraftFrom(subtasks: ProjectSubtask[] | null | undefined): ChecklistDraftItem[] {
  return (subtasks || []).map((task) => ({ key: task.id, id: task.id, title: task.title, completed: task.completed, assigneeId: task.assignee_id || null }));
}

export interface ChecklistSyncPlan {
  create: ChecklistDraftItem[];
  update: { id: string; patch: { title?: string; completed?: boolean; assigneeId?: string | null } }[];
  remove: string[];
}
/** Diffs the edited checklist against the saved one (pure; no network). */
export function planChecklistSync(baseline: ProjectSubtask[] | null | undefined, draft: ChecklistDraftItem[]): ChecklistSyncPlan {
  const saved = new Map((baseline || []).map((task) => [task.id, task]));
  const keep = new Set(draft.filter((item) => item.id).map((item) => item.id as string));
  const plan: ChecklistSyncPlan = { create: [], update: [], remove: [] };
  for (const task of baseline || []) if (!keep.has(task.id)) plan.remove.push(task.id);
  for (const item of draft) {
    const title = item.title.trim();
    if (!item.id) { plan.create.push({ ...item, title }); continue; }
    const task = saved.get(item.id);
    const patch: ChecklistSyncPlan["update"][number]["patch"] = {};
    if (!task || task.title !== title) patch.title = title;
    if (!task || task.completed !== item.completed) patch.completed = item.completed;
    if (!task || (task.assignee_id || null) !== (item.assigneeId || null)) patch.assigneeId = item.assigneeId || null;
    if (Object.keys(patch).length) plan.update.push({ id: item.id, patch });
  }
  return plan;
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
    comment_added: "commented on",
  };
  return labels[action] || action.replace(/_/g, " ");
}
