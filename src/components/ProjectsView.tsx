import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Activity, Bell, Check, CheckCircle2, ChevronLeft, CircleAlert, Clock3, Download, Eye, FileText, Folder, FolderKanban, FolderPlus, FolderOpen, Info, LayoutGrid, List, Loader2,
  MessageSquare, Paperclip, Pencil, Pin, Plus, RefreshCw, Search, Send, ShieldCheck, Star, Trash2, UserPlus, UsersRound, X,
} from "lucide-react";
import type {
  AppUser, ProjectDetail, ProjectField, ProjectFieldAttachment, ProjectFieldComment, ProjectFieldRequest, ProjectFieldStatus,
  ProjectFolder, ProjectFolderColor, ProjectKind, ProjectMemberRole, ProjectNotificationPreferences, ProjectPerson, ProjectSummary,
} from "../types";
import {
  addProjectComment, addProjectMember, cancelProjectFieldRequest, createProject, createProjectField, createProjectFolder,
  deleteProject, deleteProjectComment, deleteProjectField, deleteProjectFolder, deleteProjectFieldAttachment, listProjects, loadProjectDetail,
  loadProjectFieldAttachment, loadProjectNotificationPreferences, reactToProjectField, removeProjectMember, requestProjectField, resolveProjectFieldRequest, updateProject,
  updateProjectComment, updateProjectField, updateProjectFolder, updateProjectMember, uploadProjectFieldAttachment, saveProjectNotificationPreferences, type ProjectFieldInput,
} from "../lib/cloud";
import {
  activityLabel, avatarTone, canCreateField, fieldProgress, fieldsWithTaskProgress, canCreateFolder, canDeleteComment, canEditComment,
  canEditField, canManageFolder, canManageMembers, canRequestField, filterSortFields, formatDate, initialsFor, profileAvatar,
  projectKindLabel, projectStats, relativeTime, statusMeta, FOLDER_COLORS, PROJECT_MEMBER_ROLES,
  PROJECT_SORT_OPTIONS, PROJECT_STATUSES, type FieldFilter, type ProjectSortKey,
} from "../lib/projects";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";
import { MagicCard } from "./magic-ui";
import "./projects.css";
import { ProjectActivityChart } from "./project-charts/ProjectActivityChart";
import ProjectTaskList from "./ProjectTaskList";

interface Props { user: AppUser; maxUploadMb?: number; notify: (message: string, kind?: "success" | "error") => void }
type DetailTab = "overview" | "fields" | "task-list" | "activity";
type ModalState =
  | { kind: "project"; editing: ProjectDetail | null }
  | { kind: "delete-project"; detail: ProjectDetail }
  | { kind: "field"; mode: "create" | "request" | "edit"; field?: ProjectField }
  | { kind: "field-detail"; field: ProjectField }
  | { kind: "delete-field"; field: ProjectField }
  | { kind: "folder"; folder?: ProjectFolder }
  | { kind: "delete-folder"; folder: ProjectFolder }
  | { kind: "members" }
  | { kind: "requests" }
  | { kind: "notification-preferences" };

/** Project folder colours rendered with the Documents folder-shelf palette. */
const PROJECT_FOLDER_TONES: Record<ProjectFolderColor, string> = { cyan: "sky", purple: "violet", pink: "rose", blue: "blue", orange: "amber", green: "mint" };
function projectFolderTone(color: ProjectFolderColor): string {
  return PROJECT_FOLDER_TONES[color] || "blue";
}

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fields", label: "Fields" },
  { id: "task-list", label: "Task List" },
  { id: "activity", label: "Activity" },
];

function loadLayout(): "grid" | "list" {
  try { return localStorage.getItem("persora.projects.layout") === "list" ? "list" : "grid"; } catch { return "grid"; }
}

function isProjectUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function projectIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  const id = new URLSearchParams(window.location.search).get("project") || "";
  return isProjectUuid(id) ? id : "";
}

function syncProjectUrl(projectId: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (projectId) url.searchParams.set("project", projectId);
  else url.searchParams.delete("project");
  url.searchParams.delete("field");
  url.searchParams.delete("task");
  url.searchParams.delete("subtask");
  window.history.pushState({ ...(window.history.state || {}), persoraProjectId: projectId || null }, "", url);
}

/** Everyone the open project references, keyed by user id, so avatars show each person's own profile picture. */
const ProjectPeopleContext = createContext<Record<string, ProjectPerson>>({});

/** A person's chosen profile picture (uploaded photo, emoji, or avatar), falling back to coloured initials. */
function PersonAvatar({ userId, name, small = false, title, style }: { userId?: string | null; name?: string | null; small?: boolean; title?: string; style?: CSSProperties }) {
  const people = useContext(ProjectPeopleContext);
  const person = userId ? people[userId] : undefined;
  const label = String(name || person?.name || "");
  const avatar = profileAvatar(person?.avatarUrl);
  const [failedSrc, setFailedSrc] = useState("");
  const image = (avatar.kind === "photo" || avatar.kind === "image") && avatar.src !== failedSrc ? avatar.src : "";
  const kind = image ? avatar.kind : avatar.kind === "emoji" ? "emoji" : "initials";
  return (
    <span className={`pj-avatar ${small ? "pj-avatar-sm " : ""}pj-avatar-${avatarTone(label)}${kind === "initials" ? "" : ` pj-avatar-has-${kind}`}`} title={title} style={style} data-avatar={kind}>
      {image ? <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedSrc(image)} />
        : avatar.kind === "emoji" ? <span className="pj-avatar-emoji" aria-hidden="true">{avatar.emoji}</span>
          : initialsFor(label)}
    </span>
  );
}

export default function ProjectsView({ user, maxUploadMb = 25, notify }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState(projectIdFromUrl);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [layout, setLayoutState] = useState<"grid" | "list">(loadLayout);
  const [filter, setFilter] = useState<FieldFilter>({ query: "", status: "all", folderId: "all", sort: "updated" });
  const [pendingProjectDestination, setPendingProjectDestination] = useState<{ projectId: string; fieldId: string; taskId: string } | null>(null);
  const [pendingTaskOpenId, setPendingTaskOpenId] = useState("");
  const [taskFieldFilterId, setTaskFieldFilterId] = useState("");
  const lastProjectDestination = useRef("");
  const detailRequest = useRef(0);

  const demo = Boolean(user.demo);

  const setLayout = (value: "grid" | "list") => {
    setLayoutState(value);
    try { localStorage.setItem("persora.projects.layout", value); } catch { /* non-fatal */ }
  };

  const refreshList = useCallback(async () => {
    if (demo) return;
    setListError("");
    try { setProjects(await listProjects()); } catch (error) { setListError(error instanceof Error ? error.message : "Projects could not be loaded."); }
  }, [demo]);
  const reloadDetail = useCallback(async (projectId: string) => {
    const ticket = ++detailRequest.current;
    setDetailError("");
    try {
      const loaded = await loadProjectDetail(projectId);
      if (ticket === detailRequest.current) setDetail(loaded);
    } catch (error) {
      if (ticket === detailRequest.current) {
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : "The project could not be loaded.");
      }
    } finally {
      // Whichever request finishes last clears the spinner, even when a later reload replaced the first one.
      if (ticket === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  // Project detail is addressable by its actual database UUID, so links and a
  // browser refresh reopen the same authorized project instead of losing the
  // in-memory selection. All reads still pass through the server access gate.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError("");
      void refreshList();
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    void reloadDetail(selectedId);
  }, [selectedId, refreshList, reloadDetail]);

  useEffect(() => {
    const onPopState = () => {
      setModal(null);
      setTab("overview");
      setSelectedId(projectIdFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onProjectNotification = (event: Event) => {
      const destination = (event as CustomEvent<{ projectId?: string; fieldId?: string; taskId?: string; subtaskId?: string }>).detail;
      if (!destination || !isProjectUuid(destination.projectId || "")) return;
      lastProjectDestination.current = "";
      setPendingProjectDestination({ projectId: destination.projectId!, fieldId: destination.fieldId || "", taskId: destination.taskId || destination.subtaskId || "" });
      setModal(null); setTab(destination.taskId || destination.subtaskId ? "task-list" : "fields");
      if (selectedId === destination.projectId) { setDetailLoading(true); void reloadDetail(destination.projectId); }
      else setSelectedId(destination.projectId!);
    };
    window.addEventListener("persora-project-notification-navigation", onProjectNotification);
    return () => window.removeEventListener("persora-project-notification-navigation", onProjectNotification);
  }, [selectedId, reloadDetail]);

  useEffect(() => {
    const url = typeof window === "undefined" ? null : new URL(window.location.href);
    const projectId = pendingProjectDestination?.projectId || selectedId;
    const fieldId = pendingProjectDestination?.fieldId || url?.searchParams.get("field") || "";
    // Old notification links may still carry subtask IDs; the migration preserves their source UUIDs.
    const taskId = pendingProjectDestination?.taskId || url?.searchParams.get("task") || url?.searchParams.get("subtask") || "";
    if (!detail || detail.project.id !== projectId) return;
    if (taskId && detail.tasks.some((task) => task.id === taskId)) {
      const destinationKey = `${projectId}:task:${taskId}`;
      if (lastProjectDestination.current === destinationKey) return;
      lastProjectDestination.current = destinationKey;
      setTab("task-list"); setPendingTaskOpenId(taskId); setPendingProjectDestination(null);
      return;
    }
    if (!fieldId) return;
    const destinationKey = `${projectId}:${fieldId}`;
    if (lastProjectDestination.current === destinationKey) return;
    const field = detail.fields.find((entry) => entry.id === fieldId);
    if (!field) return;
    lastProjectDestination.current = destinationKey;
    setTab("fields"); setModal({ kind: "field-detail", field }); setPendingProjectDestination(null);
  }, [detail, selectedId, pendingProjectDestination]);

  const openProject = useCallback((projectId: string) => {
    syncProjectUrl(projectId);
    setSelectedId(projectId);
    setTab("overview");
    setDetail(null);
    setDetailError("");
    setModal(null);
  }, []);
  const backToList = useCallback(() => {
    syncProjectUrl("");
    setSelectedId("");
    setDetail(null);
    setModal(null);
  }, []);

  /** Runs a mutation, reloads the affected surface, and surfaces a toast once. */
  const act = useCallback(async (work: () => Promise<string | void>): Promise<boolean> => {
    setBusy(true);
    try {
      const message = await work();
      if (selectedId) await Promise.all([reloadDetail(selectedId), refreshList()]); else await refreshList();
      if (message) notify(message, "success");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "That change could not be saved.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [selectedId, reloadDetail, refreshList, notify]);

  const toggleReaction = useCallback(async (field: ProjectField, key: "pinned" | "favourite") => {
    if (!selectedId) return;
    const mine = field.mine || { pinned: false, favourite: false };
    const next = { ...mine, [key]: !mine[key] };
    setDetail((current) => current ? { ...current, fields: current.fields.map((entry) => entry.id === field.id ? { ...entry, mine: next } : entry) } : current);
    try {
      await reactToProjectField(selectedId, field.id, next);
    } catch (error) {
      setDetail((current) => current ? { ...current, fields: current.fields.map((entry) => entry.id === field.id ? { ...entry, mine } : entry) } : current);
      notify(error instanceof Error ? error.message : "The reaction could not be saved.", "error");
    }
  }, [selectedId, notify]);

  const people = useMemo(() => {
    const map: Record<string, ProjectPerson> = { ...(detail?.people || {}) };
    if (detail?.owner) map[detail.owner.id] = { name: detail.owner.name, avatarUrl: detail.owner.avatarUrl ?? map[detail.owner.id]?.avatarUrl ?? "" };
    for (const member of detail?.members || []) map[member.userId] = { name: member.name, avatarUrl: member.avatarUrl ?? map[member.userId]?.avatarUrl ?? "" };
    // The signed-in user's own picture is always the freshest copy (Settings updates it immediately).
    if (user.id && typeof user.avatarUrl === "string") map[user.id] = { name: map[user.id]?.name || user.fullName, avatarUrl: user.avatarUrl };
    return map;
  }, [detail, user.id, user.fullName, user.avatarUrl]);

  // A folder filter only makes sense inside the project (and folder list) it was chosen in.
  useEffect(() => {
    if (!detail || filter.folderId === "all") return;
    if (!detail.folders.some((folder) => folder.id === filter.folderId)) setFilter((current) => ({ ...current, folderId: "all" }));
  }, [detail, filter.folderId]);

  if (demo) {
    return (
      <div className="pj-view">
        <div className="pj-gate">
          <span className="pj-gate-icon"><FolderKanban size={26} /></span>
          <h2>Projects need a Persora account</h2>
          <p>Demo mode keeps everything on this device. Sign in to create personal projects, share them with teammates, and keep field work, comments, and requests in sync.</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ list
  if (!selectedId) {
    return (
      <div className="pj-view">
        <div className="pj-list-head">
          <p className="pj-hint"><ShieldCheck size={14} /> Personal projects are private to you; shared projects add a team with field-level ownership and owner-approved requests.</p>
          <div className="pj-list-head-actions">
            <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "notification-preferences" })}><Bell size={15} /> Notification preferences</button>
            <button type="button" className="pj-ghost-button" onClick={() => { setProjects(null); void refreshList(); }} aria-label="Refresh projects"><RefreshCw size={15} /> Refresh</button>
            <button type="button" className="pj-primary-button" onClick={() => setModal({ kind: "project", editing: null })}><Plus size={15} /> New project</button>
          </div>
        </div>
        {listError && <div className="pj-alert" role="alert"><CircleAlert size={15} /> {listError}<button type="button" onClick={() => void refreshList()}>Retry</button></div>}
        {!projects && !listError && <div className="pj-loading"><Loader2 className="pj-spin" size={22} /> Loading projects…</div>}
        {projects && !projects.length && (
          <div className="pj-empty">
            <span className="pj-empty-icon"><FolderKanban size={26} /></span>
            <h2>No projects yet</h2>
            <p>Create a personal project to organise field work, or a shared one to bring the team in.</p>
            <button type="button" className="pj-primary-button" onClick={() => setModal({ kind: "project", editing: null })}><Plus size={15} /> Create your first project</button>
          </div>
        )}
        {projects && projects.length > 0 && (
          <div className="pj-project-grid">
            {projects.map((project) => (
              <MagicCard key={project.id} className="pj-project-card" onClick={() => void openProject(project.id)} role="button" tabIndex={0}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openProject(project.id); } }}>
                <div className="pj-project-card-content">
                  <header>
                    <span className={`pj-chip pj-chip-${project.kind === "shared" ? "accent" : "muted"}`}>{projectKindLabel(project.kind)}</span>
                    {project.access.owner ? <span className="pj-chip pj-chip-soft">Owner</span> : <span className="pj-chip pj-chip-soft">{project.access.role}</span>}
                    {project.stats.pendingRequests > 0 && <span className="pj-chip pj-chip-warning">{project.stats.pendingRequests} request{project.stats.pendingRequests === 1 ? "" : "s"}</span>}
                  </header>
                  <h3>{project.name}</h3>
                  {project.description && <p>{project.description}</p>}
                  <div className="pj-project-card-stats">
                    <span><FileText size={13} /> {project.stats.fields} field{project.stats.fields === 1 ? "" : "s"}</span>
                    <span><CheckCircle2 size={13} /> {project.stats.completed} done</span>
                    {(project.stats.tasksTotal || 0) > 0 && <span><CheckCircle2 size={13} /> {project.stats.tasksCompleted || 0}/{project.stats.tasksTotal} tasks complete</span>}
                    {project.kind === "shared" && <span><UsersRound size={13} /> {project.stats.members}</span>}
                  </div>
                  {project.stats.fields > 0 && (
                    <div className="pj-progress-track" aria-label={`${Math.round((project.stats.completed / project.stats.fields) * 100)}% of fields complete`}>
                      <span style={{ width: `${Math.round((project.stats.completed / project.stats.fields) * 100)}%` }} />
                    </div>
                  )}
                  {(project.stats.tasksTotal || 0) > 0 && <div className="pj-project-task-progress" aria-label={`${project.stats.tasksCompleted || 0} of ${project.stats.tasksTotal} tasks complete`}><span>Task progress</span><b>{project.stats.tasksCompleted || 0}/{project.stats.tasksTotal}</b><div className="pj-progress-track"><span style={{ width: `${Math.round(((project.stats.tasksCompleted || 0) / (project.stats.tasksTotal || 1)) * 100)}%` }} /></div></div>}
                </div>
              </MagicCard>
            ))}
          </div>
        )}
        {modal?.kind === "project" && <ProjectFormModal busy={busy} editing={null} onClose={() => setModal(null)} onSubmit={async (input) => {
          setBusy(true);
          try {
            const created = await createProject(input);
            if (!isProjectUuid(created?.id || "")) throw new Error("The project service did not return its saved database ID. Refresh Projects and try again.");
            setModal(null);
            setProjects(null);
            openProject(created.id);
            notify(`“${input.name}” is ready.`, "success");
          } catch (error) {
            notify(error instanceof Error ? error.message : "The project could not be created.", "error");
          } finally { setBusy(false); }
        }} />}
        {modal?.kind === "notification-preferences" && <ProjectNotificationPreferencesModal onClose={() => setModal(null)} notify={notify} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- detail
  const access = detail?.access || null;
  const stats = detail ? projectStats(detail.fields, detail.members.length + 1) : null;
  const visibleFields = detail ? filterSortFields(detail.fields, filter) : [];
  const pendingRequests = detail?.requests.filter((request) => request.status === "pending") || [];
  const myPendingRequestCount = (access && !access.owner ? pendingRequests.length : 0);
  const ownerPendingCount = (access?.owner ? pendingRequests.length : 0);

  return (
    <ProjectPeopleContext.Provider value={people}>
    <div className="pj-view">
      <div className="pj-topbar">
        <div className="pj-breadcrumbs">
          <button type="button" className="pj-crumb-back" onClick={backToList} aria-label="Back to projects"><ChevronLeft size={16} /> Projects</button>
          <span className="pj-crumb-sep">/</span>
          <strong>{detail?.project.name || "…"}</strong>
          {detail && <span className={`pj-chip pj-chip-${detail.project.kind === "shared" ? "accent" : "muted"}`}>{projectKindLabel(detail.project.kind)}</span>}
        </div>
        {detail && access && (
          <div className="pj-topbar-actions">
            {canCreateField(access)
              ? <button type="button" className="pj-primary-button" onClick={() => setModal({ kind: "field", mode: "create" })}><Plus size={15} /> New field</button>
              : <button type="button" className="pj-primary-button" onClick={() => setModal({ kind: "field", mode: "request" })}><Plus size={15} /> Request field</button>}
            <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "members" })}><UsersRound size={15} /> Team</button>
            {access.owner && (
              <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "requests" })}>
                <Clock3 size={15} /> Requests{ownerPendingCount > 0 && <span className="pj-badge">{ownerPendingCount}</span>}
              </button>
            )}
            {!access.owner && (
              <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "requests" })}><Clock3 size={15} /> My requests{myPendingRequestCount > 0 && <span className="pj-badge">{myPendingRequestCount}</span>}</button>
            )}
            {access.owner && <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "project", editing: detail })}><Pencil size={15} /> Project settings</button>}
            {!access.owner && <button type="button" className="pj-ghost-button" onClick={() => setModal({ kind: "project", editing: detail })}><ShieldCheck size={15} /> About</button>}
          </div>
        )}
      </div>

      {detailLoading && <div className="pj-loading"><Loader2 className="pj-spin" size={22} /> Opening project…</div>}
      {detailError && <div className="pj-alert" role="alert"><CircleAlert size={15} /> {detailError}<button type="button" onClick={() => void reloadDetail(selectedId)}>Retry</button></div>}
      {listError && <div className="pj-alert" role="alert"><CircleAlert size={15} /> Project summary could not refresh. {listError}<button type="button" onClick={() => void refreshList()}>Retry</button></div>}

      {detail && stats && access && (
        <>
          {access.owner === false && detail.access.role && (
            <div className="pj-access-note">
              <ShieldCheck size={14} />
              <span>
                You are a <b>{detail.access.role}</b> in this project.
                {canCreateField(access)
                  ? " You can create fields and folders; work you create stays editable only by you and the owner."
                  : canRequestField(access)
                    ? " New fields go to the owner for approval. You can comment on everything already shared."
                    : ""}
              </span>
            </div>
          )}
          <nav className="pj-section-nav" aria-label="Project sections">
            {DETAIL_TABS.map((entry) => (
              <button key={entry.id} type="button" className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>{entry.label}</button>
            ))}
          </nav>

          {tab === "overview" && (
            <section className="pj-panel">
              <div className="pj-stats-grid">
                {[
                  { label: "Active fields", value: stats.active, note: "Planning, in progress, or blocked", icon: Activity, tone: "blue" },
                  { label: "In review", value: stats.inReview, note: "Waiting for sign-off", icon: Clock3, tone: "amber" },
                  { label: "Completed", value: stats.completed, note: `${stats.completion}% of all fields`, icon: CheckCircle2, tone: "green" },
                  { label: "Team members", value: stats.members, note: "Including the owner", icon: UsersRound, tone: "purple" },
                ].map(({ label, value, note, icon: Icon, tone }) => (
                  <MagicCard key={label} className={`pj-stat pj-stat-${tone}`}>
                    <div className="pj-stat-content"><span className="pj-stat-icon"><Icon size={17} /></span><div><span>{label}</span><b>{value}</b><small>{note}</small></div></div>
                  </MagicCard>
                ))}
              </div>
              <div className="pj-overview-completion">
                <div className="pj-overview-completion-head"><span>Overall completion</span><b>{stats.completion}%</b></div>
                <div className="pj-progress-track pj-progress-track-lg"><span style={{ width: `${stats.completion}%` }} /></div>
              </div>
              <div className="pj-overview-grid">
                <MagicCard className="pj-overview-section-card"><div className="pj-card">
                  <div className="pj-card-head"><h3><span className="pj-overview-section-icon pj-overview-section-purple"><UsersRound size={15} /></span>Team</h3>{detail.project.kind === "shared" && <button type="button" className="pj-link-button" onClick={() => setModal({ kind: "members" })}>{canManageMembers(access) ? "Manage" : "View"}</button>}</div>
                  <ul className="pj-people-list">
                    {detail.owner && (
                      <li><PersonAvatar userId={detail.owner.id} name={detail.owner.name} /><span className="pj-person"><b>{detail.owner.name}</b><small>Owner{detail.owner.id === user.id ? " — you" : ""}</small></span><span className="pj-chip pj-chip-soft">Owner</span></li>
                    )}
                    {detail.members.map((member) => (
                      <li key={member.userId}><PersonAvatar userId={member.userId} name={member.name} /><span className="pj-person"><b>{member.name}</b><small>{member.userId === user.id ? "You" : member.email || member.loginId}{member.canCreateFields ? " · creates fields" : ""}</small></span><span className="pj-chip pj-chip-soft">{member.role}</span></li>
                    ))}
                  </ul>
                </div></MagicCard>
                <MagicCard className="pj-overview-section-card"><div className="pj-card">
                  <div className="pj-card-head"><h3><span className="pj-overview-section-icon pj-overview-section-blue"><Activity size={15} /></span>Latest activity</h3></div>
                  <ul className="pj-activity-list">
                    {detail.activity.slice(0, 6).map((event) => (
                      <li key={event.id}><Activity size={14} className="pj-activity-ico" /><span className="pj-activity-copy"><b>{event.actor_name || "Someone"}</b> {activityLabel(event.action)}{event.target ? <> <b>{event.target}</b></> : null}</span><time>{relativeTime(event.created_at)}</time></li>
                    ))}
                    {!detail.activity.length && <li className="pj-muted">Nothing has happened yet.</li>}
                  </ul>
                </div></MagicCard>
              </div>
            </section>
          )}

          {tab === "fields" && (
            <section className="pj-panel">
              <div className="pj-panel-head pj-fields-head">
                <div><h2>Fields <small>{detail.fields.length}</small></h2><p>Folders keep related work together. Choose a folder to focus on its fields.</p></div>
              </div>
              {/* Folder shelf row — mirrors the Documents page folder shelf (same vault-folder-* design tokens). */}
              <section className="vault-folder-shelf pj-folder-shelf-row" aria-label="Field folders">
                <div className="vault-folder-grid">
                  <button type="button" className={`vault-folder-tile vault-folder-all ${filter.folderId === "all" ? "is-selected" : ""}`} onClick={() => setFilter((current) => ({ ...current, folderId: "all" }))} aria-pressed={filter.folderId === "all"}>
                    <span className="vault-folder-icon folder-color-slate"><FolderOpen size={18} /></span>
                    <span className="vault-folder-card-copy"><b>All fields</b><small>{detail.fields.length} field{detail.fields.length === 1 ? "" : "s"}</small></span>
                  </button>
                  {detail.folders.map((folder) => {
                    const count = detail.fields.filter((field) => field.folder_id === folder.id).length;
                    const selected = filter.folderId === folder.id;
                    return (
                      <div className={`vault-folder-tile vault-folder-folder ${selected ? "is-selected" : ""}`} key={folder.id}>
                        <button type="button" className="vault-folder-open" onClick={() => setFilter((current) => ({ ...current, folderId: folder.id }))} aria-pressed={selected} aria-label={`Open folder ${folder.name}`}>
                          <span className={`vault-folder-icon folder-color-${projectFolderTone(folder.color)}`}><Folder size={16} /></span>
                          <span className="vault-folder-card-copy"><b>{folder.name}</b><small>{count} field{count === 1 ? "" : "s"}</small></span>
                        </button>
                        {canManageFolder(access) && (
                          <MoreOptionsMenu label={`${folder.name} folder options`} actions={[
                            { label: "Edit folder", icon: Pencil, onSelect: () => setModal({ kind: "folder", folder }) },
                            { label: "Delete folder", icon: Trash2, danger: true, onSelect: () => setModal({ kind: "delete-folder", folder }) },
                          ]} />
                        )}
                      </div>
                    );
                  })}
                  {canCreateFolder(access) && (
                    <button type="button" className="vault-folder-tile vault-folder-create-tile" onClick={() => setModal({ kind: "folder" })} aria-label="Create a field folder">
                      <span className="vault-folder-icon folder-color-blue"><FolderPlus size={16} /></span>
                      <span className="vault-folder-card-copy"><b>New folder</b><small>Create folder</small></span>
                    </button>
                  )}
                </div>
              </section>
              <div className="pj-toolbar-row">
                <label className="pj-search"><Search size={15} /><input value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} placeholder="Search fields, people…" aria-label="Search fields" /></label>
                <select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as FieldFilter["status"] }))} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  {PROJECT_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
                <select value={filter.folderId} onChange={(event) => setFilter((current) => ({ ...current, folderId: event.target.value }))} aria-label="Filter by folder">
                  <option value="all">All folders</option>
                  <option value="none">No folder</option>
                  {detail.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <select value={filter.sort} onChange={(event) => setFilter((current) => ({ ...current, sort: event.target.value as ProjectSortKey }))} aria-label="Sort fields">
                  {PROJECT_SORT_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
                <div className="pj-segmented" role="group" aria-label="Layout">
                  <button type="button" className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")} aria-label="Grid layout"><LayoutGrid size={15} /></button>
                  <button type="button" className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} aria-label="List layout"><List size={15} /></button>
                </div>
              </div>
              {!visibleFields.length && (
                <div className="pj-empty pj-empty-small">
                  <span className="pj-empty-icon"><FolderKanban size={24} /></span>
                  <h2>{!detail.fields.length ? "No fields yet" : filter.folderId !== "all" && !filter.query.trim() && filter.status === "all" ? "This folder is empty" : "Nothing matches these filters"}</h2>
                  <p>{!detail.fields.length ? (canCreateField(access) ? "Create the first field to start tracking work." : "When the owner approves field requests they show up here.") : filter.folderId !== "all" && !filter.query.trim() && filter.status === "all" ? "Add or edit a field to place it in this folder." : "Adjust the search or filters to see more."}</p>
                </div>
              )}
              {visibleFields.length > 0 && (
                <div className={layout === "grid" ? "pj-card-grid pj-field-cards" : "pj-row-list pj-field-cards"}>
                  {visibleFields.map((field) => <FieldCard key={field.id} field={field} layout={layout} folders={detail.folders} onOpen={() => setModal({ kind: "field-detail", field })} onToggleReaction={(key) => void toggleReaction(field, key)} />)}
                </div>
              )}
            </section>
          )}

          {tab === "task-list" && (
            <ProjectTaskList
              projectId={detail.project.id}
              tasks={detail.tasks || []}
              fields={detail.fields}
              access={access}
              owner={detail.owner}
              members={detail.members}
              userId={user.id}
              uploadsEnabled={Boolean(user.uploadsEnabled)}
              maxUploadMb={maxUploadMb}
              loading={detailLoading}
              onTasksChange={(tasks) => setDetail((current) => current ? { ...current, tasks, fields: fieldsWithTaskProgress(current.fields, tasks) } : current)}
              onRefresh={async () => { await Promise.all([reloadDetail(detail.project.id), refreshList()]); }}
              onOpenField={(field) => setModal({ kind: "field-detail", field })}
              notify={notify}
              initialTaskId={pendingTaskOpenId}
              onTaskOpened={() => setPendingTaskOpenId("")}
              initialFieldId={taskFieldFilterId}
              onFieldFilterApplied={() => setTaskFieldFilterId("")}
            />
          )}

          {tab === "activity" && (
            <section className="pj-panel">
              <ProjectActivityChart projectId={detail.project.id} refreshKey={`${detail.activity.length}:${detail.activity[0]?.id ?? ""}`} />
              <div className="pj-card">
                <div className="pj-card-head"><h3>Recently updated fields</h3></div>
                <div className="pj-table-scroll">
                  <table className="pj-table">
                    <thead><tr><th>FIELD</th><th>OWNER</th><th>STATUS</th><th>PROGRESS</th><th>UPDATED</th></tr></thead>
                    <tbody>
                      {[...detail.fields].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 12).map((field) => {
                        const meta = statusMeta(field.status);
                        return (
                          <tr key={field.id} className="pj-table-row-button" onClick={() => setModal({ kind: "field-detail", field })}>
                            <td><b>{field.title}</b></td>
                            <td>{field.creator_name || "—"}</td>
                            <td><span className={`pj-chip pj-chip-${meta.tone}`}>{meta.label}</span></td>
                            <td><span className="pj-inline-progress"><span className="pj-progress-track"><span style={{ width: `${fieldProgress(field)}%` }} /></span>{fieldProgress(field)}%</span></td>
                            <td>{relativeTime(field.updated_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!detail.fields.length && <div className="pj-empty pj-empty-small"><h2>No fields yet</h2><p>Field activity shows up here once work begins.</p></div>}
                </div>
              </div>
              <div className="pj-card">
                <div className="pj-card-head"><h3>Events</h3></div>
                <ul className="pj-activity-list">
                  {detail.activity.map((event) => (
                    <li key={event.id}><Activity size={14} className="pj-activity-ico" /><span className="pj-activity-copy"><b>{event.actor_name || "Someone"}</b> {activityLabel(event.action)}{event.target ? <> <b>{event.target}</b></> : null}</span><time>{relativeTime(event.created_at)}</time></li>
                  ))}
                  {!detail.activity.length && <li className="pj-muted">Nothing has happened yet.</li>}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      {/* -------------------------------------------------------- modals */}
      {modal?.kind === "project" && (
        <ProjectFormModal busy={busy} editing={modal.editing}
          onClose={() => setModal(null)}
          onSubmit={async (input) => {
            if (modal.editing) {
              const ok = await act(async () => { await updateProject(selectedId, input); return "Project settings saved."; });
              if (ok) setModal(null);
              return;
            }
            setBusy(true);
            try {
              const created = await createProject(input);
              if (!isProjectUuid(created?.id || "")) throw new Error("The project service did not return its saved database ID. Refresh Projects and try again.");
              setModal(null);
              setProjects(null);
              openProject(created.id);
              notify(`“${input.name}” is ready.`, "success");
            } catch (error) {
              notify(error instanceof Error ? error.message : "The project could not be created.", "error");
            } finally { setBusy(false); }
          }}
          onDelete={modal.editing && access?.owner ? () => setModal({ kind: "delete-project", detail: modal.editing as ProjectDetail }) : undefined}
        />
      )}
      {modal?.kind === "delete-project" && (
        <ConfirmModal busy={busy} danger
          title={`Delete “${modal.detail.project.name}”?`}
          body="The project, its folders, fields, comments, and requests are removed for the whole team. This cannot be undone."
          confirmLabel="Delete project"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteProject(selectedId);
              notify("Project deleted.", "success");
              setModal(null);
              backToList();
            } catch (error) { notify(error instanceof Error ? error.message : "The project could not be deleted.", "error"); }
            finally { setBusy(false); }
          }}
        />
      )}
      {modal?.kind === "field" && detail && access && (
        <FieldFormModal busy={busy} mode={modal.mode} field={modal.field} detail={detail}
          onClose={() => setModal(null)}
          onSubmit={async (input, note) => {
            const ok = await act(async () => {
              if (modal.mode === "request") { await requestProjectField(selectedId, { ...input, note }); return "Request sent — the project owner will review it."; }
              if (modal.mode === "edit" && modal.field) {
                await updateProjectField(selectedId, modal.field.id, input);
                return "Field saved.";
              }
              const created = await createProjectField(selectedId, input);
              return `“${created.title || input.title}” added to the project.`;
            });
            if (ok) setModal(null);
          }}
        />
      )}
      {modal?.kind === "field-detail" && detail && access && (
        <FieldDetailModal busy={busy} field={detail.fields.find((entry) => entry.id === modal.field.id) || modal.field} detail={detail} user={user} maxUploadMb={maxUploadMb}
          onClose={() => setModal(null)}
          onToggleReaction={(key) => void toggleReaction(detail.fields.find((entry) => entry.id === modal.field.id) || modal.field, key)}
          onEdit={() => setModal({ kind: "field", mode: "edit", field: detail.fields.find((entry) => entry.id === modal.field.id) || modal.field })}
          onDelete={() => setModal({ kind: "delete-field", field: modal.field })}
          onViewTasks={() => { setTaskFieldFilterId(modal.field.id); setTab("task-list"); setModal(null); }}
          onChanged={async () => { await Promise.all([reloadDetail(selectedId), refreshList()]); }}
          notify={notify}
        />
      )}
      {modal?.kind === "delete-field" && (
        <ConfirmModal busy={busy} danger
          title={`Delete “${modal.field.title}”?`}
          body="The field and its comments are removed for the whole team. This cannot be undone."
          confirmLabel="Delete field"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            const ok = await act(async () => { await deleteProjectField(selectedId, modal.field.id); return "Field deleted."; });
            if (ok) setModal(null);
          }}
        />
      )}
      {modal?.kind === "folder" && (
        <FolderFormModal busy={busy} folder={modal.folder}
          onClose={() => setModal(null)}
          onSubmit={async (input) => {
            const ok = await act(async () => {
              if (modal.folder) { await updateProjectFolder(selectedId, modal.folder.id, input); return "Folder updated."; }
              await createProjectFolder(selectedId, input);
              return `Folder “${input.name}” created.`;
            });
            if (ok) setModal(null);
          }}
        />
      )}
      {modal?.kind === "delete-folder" && (
        <ConfirmModal busy={busy} danger
          title={`Delete folder “${modal.folder.name}”?`}
          body="Fields inside stay in the project and move out of this folder."
          confirmLabel="Delete folder"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            const ok = await act(async () => { await deleteProjectFolder(selectedId, modal.folder.id); return "Folder deleted."; });
            if (ok) {
              setFilter((current) => current.folderId === modal.folder.id ? { ...current, folderId: "all" } : current);
              setModal(null);
            }
          }}
        />
      )}
      {modal?.kind === "members" && detail && access && (
        <MembersModal busy={busy} detail={detail} user={user} onClose={() => setModal(null)} act={act} onLeft={() => { setModal(null); backToList(); }} />
      )}
      {modal?.kind === "requests" && detail && access && (
        <RequestsModal busy={busy} detail={detail} user={user} onClose={() => setModal(null)} act={act} />
      )}
      {modal?.kind === "notification-preferences" && <ProjectNotificationPreferencesModal onClose={() => setModal(null)} notify={notify} />}
    </div>
    </ProjectPeopleContext.Provider>
  );
}

// ============================================================================
// Field card
// ============================================================================
const PROJECT_ATTACHMENT_MIMES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  txt: "text/plain", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
function validateProjectAttachmentClient(file: File, maxUploadMb: number): string {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const expected = PROJECT_ATTACHMENT_MIMES[extension];
  if (!expected) return "Choose a PDF, image, text/CSV, Word, Excel or PowerPoint file.";
  if (!file.size) return "The selected file is empty.";
  const limit = Math.max(1, Math.min(150, Number(maxUploadMb) || 25)) * 1024 * 1024;
  if (file.size > limit) return `Choose a file no larger than ${Math.floor(limit / 1024 / 1024)} MB.`;
  if (file.type && file.type !== expected && file.type !== "application/octet-stream" && !(extension === "csv" && file.type === "application/vnd.ms-excel")) return "The file extension and content type do not match.";
  return "";
}
function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function FieldCard({ field, layout, folders, onOpen, onToggleReaction }: {
  field: ProjectField;
  layout: "grid" | "list";
  folders: ProjectFolder[];
  onOpen: () => void;
  onToggleReaction: (key: "pinned" | "favourite") => void;
}) {
  const meta = statusMeta(field.status);
  const folder = folders.find((entry) => entry.id === field.folder_id);
  const overdue = Boolean(field.due_date && field.status !== "completed" && field.due_date < new Date().toISOString().slice(0, 10));
  const mine = field.mine || { pinned: false, favourite: false };
  const progress = fieldProgress(field);
  const taskCount = field.taskCount || 0;
  const completedTaskCount = field.completedTaskCount || 0;
  return (
    <MagicCard className="pj-field-card-magic" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
    <article className={`pj-field-card ${layout === "list" ? "pj-field-card-row" : ""}`}>
      <header>
        <div className="pj-field-card-chips">
          {folder && <span className={`pj-chip pj-chip-folder pj-folder-swatch-text pj-folder-${folder.color}`}>{folder.name}</span>}
          {field.due_date && <span className={`pj-chip ${overdue ? "pj-chip-danger" : "pj-chip-muted"}`}><Clock3 size={11} /> {formatDate(field.due_date)}</span>}
        </div>
        <div className="pj-field-card-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={`pj-icon-button ${mine.pinned ? "pj-icon-active" : ""}`} aria-label={mine.pinned ? "Unpin field" : "Pin field"} aria-pressed={mine.pinned} onClick={() => onToggleReaction("pinned")}><Pin size={14} /></button>
          <button type="button" className={`pj-icon-button ${mine.favourite ? "pj-icon-star-active" : ""}`} aria-label={mine.favourite ? "Remove favourite" : "Favourite field"} aria-pressed={mine.favourite} onClick={() => onToggleReaction("favourite")}><Star size={14} /></button>
        </div>
      </header>
      <h3>{field.title}</h3>
      {field.description && <p className="pj-field-card-desc">{field.description}</p>}
      <div className="pj-field-card-progress">
        <span className="pj-progress-track" role="progressbar" aria-label="Field task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
        <span className={`pj-chip pj-chip-${meta.tone}`}>{meta.label}</span>
        <b>{progress}%</b>
      </div>
      <div className="pj-field-card-task-count"><CheckCircle2 size={12} /> {taskCount ? `${completedTaskCount}/${taskCount} tasks complete` : "No tasks"}</div>
      <footer>
        <span className="pj-people-inline">
          {field.creator_name && <PersonAvatar small userId={field.creator_id} name={field.creator_name} title={`Created by ${field.creator_name}`} />}
          {field.assigneeName && <PersonAvatar small userId={field.assignee_id} name={field.assigneeName} title={`Assigned to ${field.assigneeName}`} style={{ marginLeft: -6 }} />}
        </span>
        <span className="pj-field-card-meta">
          {field.assigneeName && <small>→ {field.assigneeName}</small>}
          <small>by {field.creator_name || "—"}</small>
        </span>
        <span className="pj-field-card-tail">
          {(field.commentCount || 0) > 0 && <small className="pj-field-comments"><MessageSquare size={12} /> {field.commentCount}</small>}
          <small>{relativeTime(field.updated_at)}</small>
        </span>
      </footer>
    </article>
    </MagicCard>
  );
}

// ============================================================================
// Modals
// ============================================================================
function ModalShell({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  // Portal keeps the fixed backdrop out of the workspace's transformed/scrolled
  // containers so modals always sit above the sidebar and content.
  return (
    <ModalPortal>
      <div className="pj-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className={`pj-modal ${wide ? "pj-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
          <header className="pj-modal-head"><h2>{title}</h2><button type="button" className="pj-icon-button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></header>
          <div className="pj-modal-body">{children}</div>
        </div>
      </div>
    </ModalPortal>
  );
}

function ConfirmModal({ title, body, confirmLabel, busy, danger, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; busy: boolean; danger?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="pj-modal-copy">{body}</p>
      <div className="pj-modal-actions">
        <button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? "pj-danger-button" : "pj-primary-button"} onClick={onConfirm} disabled={busy}>{busy ? <Loader2 size={15} className="pj-spin" /> : null}{confirmLabel}</button>
      </div>
    </ModalShell>
  );
}

function ProjectFormModal({ busy, editing, onClose, onSubmit, onDelete }: {
  busy: boolean;
  editing: ProjectDetail | null;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string; kind: ProjectKind }) => Promise<void>;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(editing?.project.name || "");
  const [description, setDescription] = useState(editing?.project.description || "");
  const [kind, setKind] = useState<ProjectKind>(editing?.project.kind || "personal");
  const readOnly = Boolean(editing && onDelete === undefined);
  const memberCount = editing ? editing.members.length : 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) { onClose(); return; }
    void onSubmit({ name: name.trim(), description: description.trim(), kind });
  };
  return (
    <ModalShell title={editing ? (readOnly ? "About this project" : "Project settings") : "New project"} onClose={onClose}>
      <form className="pj-form" onSubmit={submit}>
        <label>Project name<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Website relaunch" required disabled={readOnly} /></label>
        <label>Description <small>(optional)</small><textarea rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this project about?" disabled={readOnly} /></label>
        {!readOnly && (
          <div className="pj-kind-picker" role="group" aria-label="Project type">
            <button type="button" className={kind === "personal" ? "active" : ""} onClick={() => setKind("personal")}>
              <strong>Personal</strong><small>Only you can see and manage it. Members can be added later after converting to Shared.</small>
            </button>
            <button type="button" className={kind === "shared" ? "active" : ""} onClick={() => setKind("shared")}>
              <strong>Shared</strong><small>Invite teammates by username or email, grant field creation, and review their requests.</small>
            </button>
          </div>
        )}
        {editing && kind === "personal" && memberCount > 0 && <p className="pj-form-hint"><CircleAlert size={14} /> Remove all {memberCount} member{memberCount === 1 ? "" : "s"} before converting this project back to Personal.</p>}
        <div className="pj-modal-actions pj-modal-actions-split">
          {onDelete ? <button type="button" className="pj-danger-button" onClick={onDelete} disabled={busy}><Trash2 size={14} /> Delete project</button> : <span />}
          <div>
            <button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="pj-primary-button" disabled={busy || readOnly}>{busy ? <Loader2 size={15} className="pj-spin" /> : null}{readOnly ? "Close" : editing ? "Save project" : "Create project"}</button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function FieldFormModal({ busy, mode, field, detail, onClose, onSubmit }: {
  busy: boolean;
  mode: "create" | "request" | "edit";
  field?: ProjectField;
  detail: ProjectDetail;
  onClose: () => void;
  onSubmit: (input: ProjectFieldInput, note: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(field?.title || "");
  const [description, setDescription] = useState(field?.description || "");
  const [folderId, setFolderId] = useState(field?.folder_id || "");
  const [status, setStatus] = useState<ProjectFieldStatus>(field?.status || "planning");
  const [assigneeId, setAssigneeId] = useState(field?.assignee_id || "");
  const [dueDate, setDueDate] = useState(field?.due_date || "");
  const [note, setNote] = useState("");
  const requestMode = mode === "request";
  const team = useMemo(() => {
    const people: { id: string; name: string }[] = [];
    if (detail.owner) people.push({ id: detail.owner.id, name: `${detail.owner.name} (owner)` });
    for (const member of detail.members) if (!people.some((person) => person.id === member.userId)) people.push({ id: member.userId, name: member.name });
    return people;
  }, [detail]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input: ProjectFieldInput = {
      title: title.trim(), description: description.trim(), folderId: folderId || null,
      status, assigneeId: assigneeId || null, dueDate: dueDate || null,
    };
    void onSubmit(input, note.trim());
  };
  return (
    <ModalShell title={mode === "edit" ? "Edit field" : requestMode ? "Request a new field" : "New field"} onClose={onClose}>
      <form className="pj-form" onSubmit={submit}>
        {requestMode && <p className="pj-form-hint"><ShieldCheck size={14} /> The project owner reviews this request; once approved, the field is created in your name.</p>}
        <label>Title<input value={title} maxLength={160} minLength={1} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Draft homepage copy" required autoFocus /></label>
        <label>Description <small>(optional)</small><textarea rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Details, links, acceptance notes…" /></label>
        <div className="pj-form-grid">
          <label>Folder<select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">No folder</option>
            {detail.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ProjectFieldStatus)}>
            {PROJECT_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select></label>
          <label>Due date <small>(optional)</small><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label>Assign to<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Unassigned</option>
            {team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
        </div>
        {requestMode && <label>Note for the owner <small>(optional)</small><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why does the team need this field?" /></label>}
        <div className="pj-modal-actions">
          <button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="pj-primary-button" disabled={busy || !title.trim()}>{busy ? <Loader2 size={15} className="pj-spin" /> : null}{mode === "edit" ? "Save field" : requestMode ? "Send request" : "Create field"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function FolderFormModal({ busy, folder, onClose, onSubmit }: {
  busy: boolean;
  folder?: ProjectFolder;
  onClose: () => void;
  onSubmit: (input: { name: string; color: ProjectFolderColor }) => Promise<void>;
}) {
  const [name, setName] = useState(folder?.name || "");
  const [color, setColor] = useState<ProjectFolderColor>(folder?.color || "cyan");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ name: name.trim(), color });
  };
  return (
    <ModalShell title={folder ? "Edit folder" : "New folder"} onClose={onClose}>
      <form className="pj-form" onSubmit={submit}>
        <label>Folder name<input value={name} maxLength={80} minLength={1} onChange={(event) => setName(event.target.value)} placeholder="e.g. Design" required autoFocus /></label>
        <div className="pj-color-picker" role="group" aria-label="Folder colour">
          {FOLDER_COLORS.map((entry) => (
            <button key={entry.value} type="button" className={`pj-color-swatch pj-folder-${entry.value} ${color === entry.value ? "active" : ""}`} aria-label={entry.label} aria-pressed={color === entry.value} onClick={() => setColor(entry.value)} />
          ))}
        </div>
        <div className="pj-modal-actions">
          <button type="button" className="pj-ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="pj-primary-button" disabled={busy}>{busy ? <Loader2 size={15} className="pj-spin" /> : null}{folder ? "Save folder" : "Create folder"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function FieldDetailModal({ busy, field, detail, user, maxUploadMb, onClose, onToggleReaction, onEdit, onDelete, onViewTasks, onChanged, notify }: {
  busy: boolean;
  field: ProjectField;
  detail: ProjectDetail;
  user: AppUser;
  maxUploadMb: number;
  onClose: () => void;
  onToggleReaction: (key: "pinned" | "favourite") => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewTasks: () => void;
  onChanged: (() => Promise<void>) | (() => void);
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const comments = field.comments || [];
  const attachments = field.attachments || [];
  const linkedTasks = (detail.tasks || []).filter((task) => task.field_id === field.id);
  const progress = fieldProgress(field);
  const completedTaskCount = linkedTasks.filter((task) => task.status === "complete").length;
  const mine = field.mine || { pinned: false, favourite: false };
  const meta = statusMeta(field.status);
  const editable = canEditField(detail.access, field, user.id);

  const postComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setCommentBusy(true);
    try {
      await addProjectComment(detail.project.id, field.id, body);
      setComment("");
      await onChanged();
    } catch (error) { notify(error instanceof Error ? error.message : "The comment could not be posted.", "error"); return; }
    finally { setCommentBusy(false); }
    // onChanged reloads the bundle; keep focus stable after posting.
    setTimeout(() => { (document.querySelector(".pj-comment-input textarea") as HTMLTextAreaElement | null)?.focus(); }, 260);
  };
  const saveEditedComment = async (entry: ProjectFieldComment) => {
    const body = editingCommentBody.trim();
    if (!body) return;
    setCommentBusy(true);
    try {
      await updateProjectComment(detail.project.id, field.id, entry.id, body);
      setEditingCommentId("");
      await onChanged();
    } catch (error) { notify(error instanceof Error ? error.message : "The comment could not be saved.", "error"); }
    finally { setCommentBusy(false); }
  };
  const removeComment = async (entry: ProjectFieldComment) => {
    if (!window.confirm("Delete this comment?")) return;
    setCommentBusy(true);
    try { await deleteProjectComment(detail.project.id, field.id, entry.id); await onChanged(); }
    catch (error) { notify(error instanceof Error ? error.message : "The comment could not be deleted.", "error"); }
    finally { setCommentBusy(false); }
  };
  useEffect(() => () => { if (attachmentPreview?.url) URL.revokeObjectURL(attachmentPreview.url); }, [attachmentPreview?.url]);

  const uploadAttachment = async (file?: File) => {
    if (!file || !editable || attachmentBusy) return;
    const validation = validateProjectAttachmentClient(file, maxUploadMb);
    if (validation) { notify(validation, "error"); return; }
    setAttachmentBusy(true);
    try { await uploadProjectFieldAttachment(detail.project.id, field.id, file); await onChanged(); notify("Private attachment uploaded.", "success"); }
    catch (error) { notify(error instanceof Error ? error.message : "The attachment could not be uploaded.", "error"); }
    finally { setAttachmentBusy(false); }
  };
  const openAttachmentPreview = async (attachment: ProjectFieldAttachment) => {
    if (!(attachment.file_type.startsWith("image/") || attachment.file_type === "application/pdf")) return;
    setAttachmentBusy(true);
    try {
      const blob = await loadProjectFieldAttachment(detail.project.id, field.id, attachment.id, true);
      setAttachmentPreview({ url: URL.createObjectURL(blob), type: attachment.file_type, name: attachment.file_name });
    } catch (error) { notify(error instanceof Error ? error.message : "The attachment preview could not be opened.", "error"); }
    finally { setAttachmentBusy(false); }
  };
  const downloadAttachment = async (attachment: ProjectFieldAttachment) => {
    setAttachmentBusy(true);
    try {
      const blob = await loadProjectFieldAttachment(detail.project.id, field.id, attachment.id);
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = attachment.file_name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) { notify(error instanceof Error ? error.message : "The attachment could not be downloaded.", "error"); }
    finally { setAttachmentBusy(false); }
  };
  const removeAttachment = async (attachment: ProjectFieldAttachment) => {
    if (!editable || attachmentBusy || !(detail.access.owner || attachment.uploader_id === user.id) || !window.confirm(`Remove “${attachment.file_name}” from this field?`)) return;
    setAttachmentBusy(true);
    try { await deleteProjectFieldAttachment(detail.project.id, field.id, attachment.id); await onChanged(); notify("Attachment removed.", "success"); }
    catch (error) { notify(error instanceof Error ? error.message : "The attachment could not be removed.", "error"); }
    finally { setAttachmentBusy(false); }
  };

  return (<>
    <ModalShell title={field.title} wide onClose={onClose}>
      <div className="pj-detail-actions">
        <span className={`pj-chip pj-chip-${meta.tone}`}>{meta.label}</span>
        <span className="pj-flex-spacer" />
        <button type="button" className={`pj-icon-button ${mine.pinned ? "pj-icon-active" : ""}`} onClick={() => onToggleReaction("pinned")} aria-label={mine.pinned ? "Unpin field" : "Pin field"} aria-pressed={mine.pinned}><Pin size={15} /></button>
        <button type="button" className={`pj-icon-button ${mine.favourite ? "pj-icon-star-active" : ""}`} onClick={() => onToggleReaction("favourite")} aria-label={mine.favourite ? "Remove favourite" : "Favourite field"} aria-pressed={mine.favourite}><Star size={15} /></button>
        {editable && <button type="button" className="pj-ghost-button" onClick={onDelete} disabled={busy}><Trash2 size={14} /> Delete</button>}
        {editable && <button type="button" className="pj-primary-button" onClick={onEdit} disabled={busy}><Pencil size={14} /> Edit</button>}
      </div>

      <div className="pj-detail-sections">
        <section className="pj-detail-section">
          <header><span className="pj-detail-section-icon pj-detail-blue"><Info size={15} /></span><h3>Information</h3></header>
          <div className="pj-detail-info-grid">
            <div><span>Project</span><b>{detail.project.name}</b></div>
            <div><span>Project access</span><b>{detail.access.owner ? "Owner" : detail.access.role}</b></div>
            <div><span>Comments</span><b>{comments.length} comment{comments.length === 1 ? "" : "s"}</b></div>
            <div className="pj-detail-person"><span>Created by</span><b><PersonAvatar small userId={field.creator_id} name={field.creator_name} />{field.creator_name || "—"}</b></div>
            <div className="pj-detail-person"><span>Assigned to</span><b>{field.assigneeName ? <><PersonAvatar small userId={field.assignee_id} name={field.assigneeName} />{field.assigneeName}</> : "Unassigned"}</b></div>
            <div><span>Due</span><b>{formatDate(field.due_date)}</b></div>
            <div><span>Created</span><b>{formatDate(field.created_at)}</b></div>
            <div><span>Last updated</span><b>{relativeTime(field.updated_at)}</b></div>
          </div>
        </section>

        <section className="pj-detail-section">
          <header><span className="pj-detail-section-icon pj-detail-purple"><FileText size={15} /></span><h3>Description</h3></header>
          <p className="pj-modal-copy pj-detail-description">{field.description || "No description has been added."}</p>
        </section>

        <section className="pj-detail-section pj-progress-section">
          <header><span className="pj-detail-section-icon pj-detail-green"><CheckCircle2 size={15} /></span><h3>Status &amp; task progress</h3><span className={`pj-chip pj-chip-${meta.tone}`}>{meta.label}</span><span className="pj-flex-spacer" /><button type="button" className="pj-link-button" onClick={onViewTasks}>View Task List</button></header>
          <div className="pj-detail-progress-row"><div className="pj-progress-track pj-progress-track-lg" role="progressbar" aria-label="Completed linked tasks" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
          <small className="pj-detail-progress-note">{linkedTasks.length ? `${completedTaskCount} of ${linkedTasks.length} linked task${linkedTasks.length === 1 ? "" : "s"} complete.` : "No linked tasks — progress is 0%."} Field workflow status remains separate from task completion.</small>
        </section>

        <section className="pj-detail-section pj-attachments-section">
          <header><span className="pj-detail-section-icon pj-detail-blue"><Paperclip size={15} /></span><h3>Private attachments</h3><span className="pj-chip pj-chip-muted">{attachments.length}</span><span className="pj-flex-spacer" />{editable && user.uploadsEnabled && <label className={`pj-attachment-upload ${attachmentBusy ? "is-busy" : ""}`}><input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx" disabled={attachmentBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void uploadAttachment(file); }}/>{attachmentBusy ? <Loader2 size={14} className="pj-spin"/> : <Plus size={14}/>} Attach file</label>}</header>
          <p className="pj-detail-permission-note">Files stay in private storage. PDFs and images can be previewed; supported documents are available to download.</p>
          {editable && !user.uploadsEnabled && <small className="pj-muted">Uploads are disabled for this account. Existing attachments remain available.</small>}
          <ul className="pj-attachment-list">
            {attachments.map((attachment) => <li key={attachment.id}>
              <span className="pj-attachment-file-icon"><FileText size={15}/></span><span className="pj-attachment-copy"><b title={attachment.file_name}>{attachment.file_name}</b><small>{formatFileSize(attachment.file_size)} · {attachment.uploaderName} · {formatDate(attachment.created_at)}</small></span>
              {(attachment.file_type.startsWith("image/") || attachment.file_type === "application/pdf") && <button type="button" className="pj-icon-button" onClick={() => void openAttachmentPreview(attachment)} disabled={attachmentBusy} aria-label={`Preview ${attachment.file_name}`}><Eye size={14}/></button>}
              <button type="button" className="pj-icon-button" onClick={() => void downloadAttachment(attachment)} disabled={attachmentBusy} aria-label={`Download ${attachment.file_name}`}><Download size={14}/></button>
              {editable && (detail.access.owner || attachment.uploader_id === user.id) && <button type="button" className="pj-icon-button pj-danger-text" onClick={() => void removeAttachment(attachment)} disabled={attachmentBusy} aria-label={`Remove ${attachment.file_name}`}><Trash2 size={14}/></button>}
            </li>)}
            {!attachments.length && <li className="pj-attachment-empty">No attachments on this field yet.</li>}
          </ul>
        </section>
      </div>

      <section className="pj-comments">
        <h3><MessageSquare size={15} /> Comments <small>{comments.length}</small></h3>
        <ul>
          {comments.map((entry) => {
            const editing = editingCommentId === entry.id;
            return (
              <li key={entry.id}>
                <PersonAvatar userId={entry.author_id} name={entry.author_name} />
                <div className="pj-comment-body">
                  <header><b>{entry.author_name || "A member"}</b><time>{relativeTime(entry.created_at)}{entry.updated_at !== entry.created_at ? " (edited)" : ""}</time></header>
                  {editing ? (
                    <div className="pj-comment-edit">
                      <textarea rows={2} maxLength={2000} value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} />
                      <div><button type="button" className="pj-ghost-button" onClick={() => setEditingCommentId("")} disabled={commentBusy}>Cancel</button><button type="button" className="pj-primary-button" onClick={() => void saveEditedComment(entry)} disabled={commentBusy || !editingCommentBody.trim()}>Save</button></div>
                    </div>
                  ) : <p>{entry.body}</p>}
                  {!editing && (canEditComment(entry, user.id) || canDeleteComment(detail.access, entry, user.id)) && (
                    <div className="pj-comment-actions">
                      {canEditComment(entry, user.id) && <button type="button" onClick={() => { setEditingCommentId(entry.id); setEditingCommentBody(entry.body); }}>Edit</button>}
                      {canDeleteComment(detail.access, entry, user.id) && <button type="button" className="pj-danger-text" onClick={() => void removeComment(entry)}>Delete</button>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {!comments.length && <li className="pj-muted">No comments yet.</li>}
        </ul>
        <form className="pj-comment-input" onSubmit={(event) => { event.preventDefault(); void postComment(); }}>
          <textarea rows={2} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment…" aria-label="Add a comment" />
          <button type="submit" className="pj-primary-button" disabled={commentBusy || !comment.trim()}>{commentBusy ? <Loader2 size={15} className="pj-spin" /> : <Send size={14} />} Post</button>
        </form>
      </section>
    </ModalShell>
    {attachmentPreview && <ModalShell title={`Preview · ${attachmentPreview.name}`} wide onClose={() => setAttachmentPreview(null)}><div className="pj-attachment-preview">{attachmentPreview.type.startsWith("image/") ? <img src={attachmentPreview.url} alt={attachmentPreview.name}/> : <iframe src={attachmentPreview.url} title={`Preview ${attachmentPreview.name}`} sandbox="allow-same-origin"/>}</div></ModalShell>}
  </>);
}

function ProjectNotificationPreferencesModal({ onClose, notify }: { onClose: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [preferences, setPreferences] = useState<ProjectNotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadProjectNotificationPreferences().then((value) => { if (active) setPreferences(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Notification preferences could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const rows: { key: keyof ProjectNotificationPreferences; label: string; note: string }[] = [
    { key: "membership", label: "Invitations and membership", note: "New invites, role changes, and access removal" },
    { key: "assignments", label: "Assignments", note: "Field assignments and reassignment changes" },
    { key: "requests", label: "Permission requests", note: "New requests and owner decisions" },
    { key: "subtasks", label: "Tasks", note: "Task assignments and status changes" },
    { key: "comments", label: "Comments", note: "New comments on fields you can access" },
    { key: "attachments", label: "Attachments", note: "New private field attachments" },
    { key: "deadlines", label: "Overdue deadlines", note: "Overdue fields assigned to you or owned by you" },
    { key: "updates", label: "Project updates", note: "Important project, field, and status changes" },
  ];
  const save = async () => {
    if (!preferences || saving) return;
    setSaving(true); setError("");
    try { const saved = await saveProjectNotificationPreferences(preferences); setPreferences(saved); notify("Project notification preferences saved.", "success"); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Notification preferences could not be saved."); }
    finally { setSaving(false); }
  };
  return <ModalShell title="Project notification preferences" onClose={onClose}>
    <p className="pj-modal-copy">Choose which project events create persistent in-app notifications. Access checks still apply when notifications are opened.</p>
    {loading ? <div className="pj-loading"><Loader2 className="pj-spin" size={18}/> Loading preferences…</div> : preferences && <div className="pj-notification-preferences">{rows.map((row) => <label key={row.key}><span><b>{row.label}</b><small>{row.note}</small></span><input type="checkbox" checked={preferences[row.key]} onChange={(event) => setPreferences((current) => current ? { ...current, [row.key]: event.target.checked } : current)}/></label>)}</div>}
    {error && <p className="pj-form-error" role="alert">{error}</p>}
    <div className="pj-modal-actions"><button type="button" className="pj-ghost-button" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="pj-primary-button" onClick={() => void save()} disabled={loading || saving || !preferences}>{saving ? <Loader2 size={15} className="pj-spin"/> : <Check size={14}/>} Save preferences</button></div>
  </ModalShell>;
}

function MembersModal({ busy, detail, user, onClose, act, onLeft }: {
  busy: boolean;
  detail: ProjectDetail;
  user: AppUser;
  onClose: () => void;
  act: (work: () => Promise<string | void>) => Promise<boolean>;
  onLeft: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [role, setRole] = useState<ProjectMemberRole>("editor");
  const [grant, setGrant] = useState(false);
  const owner = Boolean(detail.access.owner);
  const isSelf = (userId: string) => userId === user.id;
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const value = recipient.trim();
    if (!value) return;
    const ok = await act(async () => { await addProjectMember(detail.project.id, { recipient: value, role, canCreateFields: grant }); return `${value} was added to the team.`; });
    if (ok) { setRecipient(""); setGrant(false); }
  };
  const leave = async () => {
    if (!window.confirm("Leave this project? You will lose access until the owner invites you again.")) return;
    const ok = await act(async () => { await removeProjectMember(detail.project.id, user.id); return "You left the project."; });
    if (ok) onLeft();
  };
  return (
    <ModalShell title="Project team" wide onClose={onClose}>
      <ul className="pj-people-list pj-people-list-modal">
        {detail.owner && (
          <li>
            <PersonAvatar userId={detail.owner.id} name={detail.owner.name} />
            <span className="pj-person"><b>{detail.owner.name}</b><small>{detail.owner.email || detail.owner.loginId}</small></span>
            <span className="pj-chip pj-chip-soft">Owner</span>
          </li>
        )}
        {detail.members.map((member) => (
          <li key={member.userId}>
            <PersonAvatar userId={member.userId} name={member.name} />
            <span className="pj-person"><b>{member.name}{isSelf(member.userId) ? " (you)" : ""}</b><small>{member.email || member.loginId}</small></span>
            {owner ? (
              <span className="pj-member-controls">
                <select value={member.role} disabled={busy} onChange={(event) => void act(async () => { await updateProjectMember(detail.project.id, member.userId, { role: event.target.value as ProjectMemberRole }); return "Member role updated."; })} aria-label={`Role for ${member.name}`}>
                  {PROJECT_MEMBER_ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
                {member.role === "editor" && (
                  <label className="pj-mini-check"><input type="checkbox" checked={member.canCreateFields} disabled={busy} onChange={(event) => void act(async () => { await updateProjectMember(detail.project.id, member.userId, { canCreateFields: event.target.checked }); return event.target.checked ? `${member.name} can now create fields.` : `${member.name} now needs approval for new fields.`; })} /> Creates fields</label>
                )}
                <button type="button" className="pj-icon-button pj-icon-danger" aria-label={`Remove ${member.name}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${member.name} from the project? Fields they created stay with the project.`)) void act(async () => { await removeProjectMember(detail.project.id, member.userId); return `${member.name} was removed.`; }); }}><Trash2 size={14} /></button>
              </span>
            ) : <span className="pj-chip pj-chip-soft">{member.role}{member.canCreateFields ? " · creates fields" : ""}</span>}
          </li>
        ))}
      </ul>
      {!owner && <p className="pj-form-hint"><ShieldCheck size={14} /> Only the project owner manages members. Roles: editors change fields they created (and create new ones with the grant); commenters discuss fields; viewers follow along.</p>}
      {owner && detail.project.kind !== "shared" && <p className="pj-form-hint"><CircleAlert size={14} /> This project is Personal — switch it to Shared in project settings before inviting members.</p>}
      {owner && detail.project.kind === "shared" && (
        <form className="pj-member-invite" onSubmit={(event) => void invite(event)}>
          <div className="pj-member-invite-grid">
            <label className="pj-form-span">Invite by username, email, or Persora ID<input value={recipient} maxLength={254} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.com, 1234567, or Full Name" required /></label>
            <label>Role<select value={role} onChange={(event) => setRole(event.target.value as ProjectMemberRole)}>
              {PROJECT_MEMBER_ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label} — {entry.hint}</option>)}
            </select></label>
            {role === "editor" && <label className="pj-mini-check pj-member-grant"><input type="checkbox" checked={grant} onChange={(event) => setGrant(event.target.checked)} /> Let them create fields without approval</label>}
          </div>
          <div className="pj-modal-actions">
            <button type="submit" className="pj-primary-button" disabled={busy || !recipient.trim()}>{busy ? <Loader2 size={15} className="pj-spin" /> : <UserPlus size={15} />} Add member</button>
          </div>
        </form>
      )}
      {!owner && (
        <div className="pj-modal-actions">
          <button type="button" className="pj-danger-button" onClick={() => void leave()} disabled={busy}><Trash2 size={14} /> Leave project</button>
        </div>
      )}
    </ModalShell>
  );
}

function RequestsModal({ busy, detail, user, onClose, act }: {
  busy: boolean;
  detail: ProjectDetail;
  user: AppUser;
  onClose: () => void;
  act: (work: () => Promise<string | void>) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const owner = Boolean(detail.access.owner);
  const mine = detail.requests.filter((request) => request.requester_id === user.id);
  const queue = owner ? detail.requests : mine;
  const pending = queue.filter((request) => request.status === "pending");
  const resolved = queue.filter((request) => request.status !== "pending");
  return (
    <ModalShell title={owner ? "Field requests" : "My field requests"} wide onClose={onClose}>
      {!queue.length && <div className="pj-empty pj-empty-small"><h2>{owner ? "No requests yet" : "You have not requested fields yet"}</h2><p>{owner ? "When members propose fields they appear here for approval." : "Use “Request field” from the project toolbar whenever you're missing a workspace."}</p></div>}
      {pending.length > 0 && (
        <div className="pj-request-group">
          <h3>Pending <small>{pending.length}</small></h3>
          {pending.map((request) => (
            <RequestRow key={request.id} request={request} owner={owner} self={request.requester_id === user.id} busy={busy}
              noteValue={notes[request.id] || ""}
              onNoteChange={(value) => setNotes((current) => ({ ...current, [request.id]: value }))}
              onApprove={() => void act(async () => { await resolveProjectFieldRequest(detail.project.id, request.id, "approved", (notes[request.id] || "").trim()); return `Approved “${request.payload.title || "field"}”.`; })}
              onReject={() => void act(async () => { await resolveProjectFieldRequest(detail.project.id, request.id, "rejected", (notes[request.id] || "").trim()); return "Request declined."; })}
              onWithdraw={() => void act(async () => { await cancelProjectFieldRequest(detail.project.id, request.id); return "Request withdrawn."; })}
            />
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="pj-request-group">
          <h3>Resolved</h3>
          {resolved.map((request) => (
            <RequestRow key={request.id} request={request} owner={owner} self={request.requester_id === user.id} busy={busy}
              noteValue="" onNoteChange={() => undefined} onApprove={() => undefined} onReject={() => undefined} onWithdraw={() => undefined}
            />
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function RequestRow({ request, owner, self, busy, noteValue, onNoteChange, onApprove, onReject, onWithdraw }: {
  request: ProjectFieldRequest;
  owner: boolean;
  self: boolean;
  busy: boolean;
  noteValue: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
}) {
  const pending = request.status === "pending";
  return (
    <article className={`pj-request ${pending ? "" : "pj-request-resolved"}`}>
      <header>
        <b>{request.payload.title || "Untitled field"}</b>
        <span className={`pj-chip ${request.status === "approved" ? "pj-chip-success" : request.status === "rejected" ? "pj-chip-danger" : "pj-chip-warning"}`}>{request.status}</span>
      </header>
      <p className="pj-request-meta">From <b>{request.requester_name || "a member"}</b> · {relativeTime(request.created_at)}{request.payload.status ? ` · starts as ${statusMeta(request.payload.status).label}` : ""}</p>
      {request.payload.description && <p>{request.payload.description}</p>}
      {request.note && <p className="pj-request-note">“{request.note}”</p>}
      {request.resolution_note && !pending && <p className="pj-request-note pj-request-resolution">Owner: “{request.resolution_note}”</p>}
      {pending && owner && (
        <>
          <textarea rows={2} maxLength={1000} value={noteValue} onChange={(event) => onNoteChange(event.target.value)} placeholder="Optional note for the requester…" />
          <div className="pj-request-actions">
            <button type="button" className="pj-primary-button" onClick={onApprove} disabled={busy}>Approve &amp; create field</button>
            <button type="button" className="pj-danger-button" onClick={onReject} disabled={busy}>Reject</button>
          </div>
        </>
      )}
      {pending && self && !owner && (
        <div className="pj-request-actions">
          <button type="button" className="pj-ghost-button" onClick={onWithdraw} disabled={busy}>Withdraw request</button>
        </div>
      )}
    </article>
  );
}
