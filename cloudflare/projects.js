// Persora Projects — worker module for personal + shared projects.
// Reads are shaped here (service role + explicit membership gate, so project
// existence is never leaked to non-members); every mutation goes through the
// security-definer RPCs in 202610220003_projects.sql which enforce the full
// permission matrix atomically inside Postgres:
//   owner            → everything (settings, members, folders, fields, moderation)
//   editor + grant   → create fields & folders, edit/delete own fields
//   other members    → view, react, comment, request new fields for approval
//   field creator    → edit/delete own fields (and only the OWNER can edit theirs)
import { projectActivityWindow, summarizeProjectActivity } from "./project-activity-rules.js";

export const PROJECTS_ROUTE_PREFIX = "/projects";

const FIELD_STATUSES = new Set(["planning", "in-progress", "in-review", "blocked", "completed"]);
const MEMBER_ROLES = new Set(["editor", "commenter", "viewer"]);
const FOLDER_COLORS = new Set(["cyan", "purple", "pink", "blue", "orange", "green"]);
const MAX_PROJECTS_PER_USER = 200;
const PROJECT_ATTACHMENT_MAX_BYTES = 150 * 1024 * 1024;
const PROJECT_NOTIFICATION_DEFAULTS = Object.freeze({ membership: true, assignments: true, requests: true, subtasks: true, comments: true, attachments: true, deadlines: true, updates: true });
const PROJECT_ATTACHMENT_TYPES = Object.freeze({
  pdf: { type: "application/pdf", preview: true, signature: "%PDF-" },
  jpg: { type: "image/jpeg", preview: true, signature: "jpeg" },
  jpeg: { type: "image/jpeg", preview: true, signature: "jpeg" },
  png: { type: "image/png", preview: true, signature: "png" },
  gif: { type: "image/gif", preview: true, signature: "gif" },
  webp: { type: "image/webp", preview: true, signature: "webp" },
  txt: { type: "text/plain", preview: false, signature: "text" },
  csv: { type: "text/csv", preview: false, signature: "text" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview: false, signature: "zip" },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", preview: false, signature: "zip" },
  pptx: { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", preview: false, signature: "zip" },
});

export class ProjectError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function headersFor(origin, extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    ...extra,
  };
}
function json(value, status, origin) {
  return new Response(JSON.stringify(value), { status, headers: headersFor(origin) });
}
function dbHeaders(env, extra = {}) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages settings.");
  return { apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }), ...extra };
}
function dbUrl(env, path) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Set SUPABASE_URL in Cloudflare Pages settings.");
  return `${base}/rest/v1/${path}`;
}
async function dbFetch(path, env, init = {}) {
  return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) });
}
async function listRows(path, env) {
  const result = [];
  for (let start = 0; ; start += 1000) {
    const response = await dbFetch(path, env, { headers: { Range: `${start}-${start + 999}` } });
    if (!response.ok) throw new Error(`Projects database request failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("The projects service received an invalid record list.");
    result.push(...page);
    if (page.length < 1000) return result;
  }
}
async function firstRow(path, env) {
  const rows = await listRows(`${path}${path.includes("?") ? "&" : "?"}limit=1`, env);
  return rows[0] || null;
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function inList(ids) {
  return `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;
}

export function sanitizeProjectSubtaskInput(body, { allowPartial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProjectError("Enter valid subtask details.", 400);
  const result = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 240) throw new ProjectError("Enter a subtask between 1 and 240 characters.", 400);
    result.title = title;
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId !== null && body.assigneeId !== "" && !isUuid(body.assigneeId)) throw new ProjectError("Choose a valid project member for this subtask.", 400);
    result.assignee_id = body.assigneeId || null;
  }
  if (body.completed !== undefined) {
    if (typeof body.completed !== "boolean") throw new ProjectError("Choose a valid subtask status.", 400);
    result.completed = body.completed;
  }
  if (!allowPartial && result.title === undefined) throw new ProjectError("Enter a subtask title.", 400);
  if (allowPartial && !Object.keys(result).length) throw new ProjectError("There is nothing to update on this subtask.", 400);
  return result;
}

export function projectAttachmentType(fileName, declaredType = "") {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  const definition = PROJECT_ATTACHMENT_TYPES[extension];
  if (!definition) throw new ProjectError("Use a PDF, image, text/CSV, Word, Excel or PowerPoint document.", 400);
  const provided = String(declaredType || "").toLowerCase().trim();
  const csvAlias = extension === "csv" && provided === "application/vnd.ms-excel";
  if (provided && provided !== "application/octet-stream" && provided !== definition.type && !csvAlias) {
    throw new ProjectError("The file extension and content type do not match.", 400);
  }
  return { ...definition, extension };
}

function sanitizeProjectFilename(value) {
  const name = String(value || "attachment").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").replace(/\.\./g, ".").trim().slice(0, 200);
  return name || "attachment";
}

async function validateProjectFile(file, type) {
  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const starts = (bytes) => bytes.every((value, index) => header[index] === value);
  let valid = false;
  switch (type.signature) {
    case "%PDF-": valid = new TextDecoder().decode(header.slice(0, 5)) === "%PDF-"; break;
    case "jpeg": valid = starts([0xff, 0xd8, 0xff]); break;
    case "png": valid = starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); break;
    case "gif": valid = ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(header.slice(0, 6))); break;
    case "webp": valid = new TextDecoder().decode(header.slice(0, 4)) === "RIFF" && new TextDecoder().decode(header.slice(8, 12)) === "WEBP"; break;
    case "zip": valid = starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08]); break;
    case "text":
      try { new TextDecoder("utf-8", { fatal: true }).decode(header); valid = !header.includes(0); } catch { valid = false; }
      break;
  }
  if (!valid) throw new ProjectError("This file does not match its supported file type.", 400);
}

function attachmentView(row, uploaderName) {
  return { id: row.id, project_id: row.project_id, field_id: row.field_id, uploader_id: row.uploader_id, uploaderName: uploaderName || "A member", file_name: row.file_name, file_size: Number(row.file_size), file_type: row.file_type, created_at: row.created_at };
}

async function rpc(name, args, env) {
  const response = await dbFetch(`rpc/${name}`, env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { /* fall through to generic error */ }
    const code = typeof payload?.code === "string" ? payload.code : "";
    const message = typeof payload?.message === "string" ? payload.message : "";
    if (message && code.startsWith("P04")) {
      const status = Number(code.slice(1)) || 400;
      throw new ProjectError(message, status >= 400 && status < 600 ? status : 400);
    }
    console.error("Persora projects RPC failed", name, response.status, code, message);
    throw new ProjectError("The projects database could not complete the request. Please try again shortly.", 502);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Input sanitising (pure — mirrored in tests)
// ---------------------------------------------------------------------------
export function sanitizeProjectInput(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 120) throw new ProjectError("Give the project a name between 1 and 120 characters.", 400);
  let description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length > 2000) throw new ProjectError("Keep the project description under 2,000 characters.", 400);
  const kind = body?.kind === "shared" ? "shared" : "personal";
  return { name, description, kind };
}

export function sanitizeFieldPayload(body, { requireTitle = false } = {}) {
  if (!body || typeof body !== "object") throw new ProjectError("The field details could not be read.", 400);
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 160) throw new ProjectError("Give the field a title between 1 and 160 characters.", 400);
    payload.title = title;
  } else if (requireTitle) {
    throw new ProjectError("Give the field a title.", 400);
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 4000) throw new ProjectError("Keep the field description under 4,000 characters.", 400);
    payload.description = description;
  }
  if (Object.prototype.hasOwnProperty.call(body, "folderId")) {
    const folderId = body.folderId === null || body.folderId === "" ? "" : String(body.folderId);
    if (folderId && !isUuid(folderId)) throw new ProjectError("Choose a folder from this project.", 400);
    payload.folder_id = folderId;
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const status = typeof body.status === "string" ? body.status : "";
    if (!FIELD_STATUSES.has(status)) throw new ProjectError("Choose a valid field status.", 400);
    payload.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(body, "progress")) {
    const progress = typeof body.progress === "number" ? body.progress : Number(body.progress);
    if (!Number.isFinite(progress)) throw new ProjectError("Progress must be a percentage between 0 and 100.", 400);
    payload.progress = Math.max(0, Math.min(100, Math.round(progress)));
  }
  if (Object.prototype.hasOwnProperty.call(body, "assigneeId")) {
    const assigneeId = body.assigneeId === null || body.assigneeId === "" ? "" : String(body.assigneeId);
    if (assigneeId && !isUuid(assigneeId)) throw new ProjectError("Assign team work to a member of this project.", 400);
    payload.assignee_id = assigneeId;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dueDate")) {
    const dueDate = body.dueDate === null || body.dueDate === "" ? "" : String(body.dueDate);
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))) {
      throw new ProjectError("Choose a valid due date.", 400);
    }
    payload.due_date = dueDate;
  }
  return payload;
}

function readNote(body, key, max) {
  const value = typeof body?.[key] === "string" ? body[key].trim() : "";
  if (value.length > max) throw new ProjectError(`Keep notes under ${max.toLocaleString()} characters.`, 400);
  return value;
}

// ---------------------------------------------------------------------------
// Recipient resolution — email, 7-digit Persora ID, or an exact full name.
// ---------------------------------------------------------------------------
export async function resolveProjectRecipient(rawRecipient, ownerId, env) {
  const value = String(rawRecipient || "").trim();
  if (value.length < 2 || value.length > 254) throw new ProjectError("Enter the member's Persora ID, email, or full name.", 400);
  let rows;
  if (/^\d{7}$/.test(value)) {
    rows = await listRows(`profiles?login_id=eq.${encodeURIComponent(value)}&select=id,login_id,email,full_name,account_status&limit=5`, env);
  } else if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    rows = await listRows(`profiles?email=ilike.${encodeURIComponent(value)}&select=id,login_id,email,full_name,account_status&limit=5`, env);
  } else {
    rows = await listRows(`profiles?full_name=ilike.${encodeURIComponent(value)}&select=id,login_id,email,full_name,account_status&limit=5`, env);
    if (rows.length > 1) throw new ProjectError("More than one account uses that name — invite by email or Persora ID instead.", 409);
  }
  const row = rows[0];
  if (!row) throw new ProjectError("We couldn't find a Persora account for that username, email, or Persora ID.", 404);
  if (String(row.account_status || "") !== "active") throw new ProjectError("That Persora account is not active yet.", 409);
  if (row.id === ownerId) throw new ProjectError("You already own this project — invite someone else.", 409);
  return row;
}

// ---------------------------------------------------------------------------
// Access gate for worker reads (mirrors persora__project_access)
// ---------------------------------------------------------------------------
async function loadProjectAccess(projectId, userId, env) {
  const project = await firstRow(`projects?id=eq.${encodeURIComponent(projectId)}&select=id,owner_id,name,description,kind,created_at,updated_at`, env);
  if (!project) throw new ProjectError("That project is not available.", 404);
  const isOwner = project.owner_id === userId;
  let member = null;
  if (!isOwner) {
    member = await firstRow(`project_members?project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=role,can_create_fields`, env);
    if (!member) throw new ProjectError("That project is not available.", 404);
  }
  return { project, isOwner, member };
}

async function loadProfiles(ids, env) {
  const unique = [...new Set(ids.filter(isUuid))];
  if (!unique.length) return new Map();
  const rows = await listRows(`profiles?id=${inList(unique)}&select=id,login_id,email,full_name,avatar_url,account_status`, env);
  return new Map(rows.map((row) => [row.id, row]));
}
function displayName(profile, fallback = "A member") {
  const name = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
  return name || (typeof profile?.email === "string" ? profile.email : fallback);
}
/**
 * The profile picture a person chose in Settings (uploaded photo, emoji, or a
 * DiceBear Adventurer avatar). Mirrors the formats the profile endpoint accepts;
 * anything else is dropped so the client falls back to initials.
 */
export function projectProfileAvatar(profile) {
  const value = typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
  if (!value) return "";
  if (value.length <= 80000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return value;
  if (value.length <= 80 && /^emoji:[^\u0000-\u001f<>]{1,24}$/u.test(value)) return value;
  if (/^https:\/\/api\.dicebear\.com\/7\.x\/adventurer\/svg\?seed=[A-Za-z0-9_-]{1,40}$/.test(value)) return value;
  return "";
}
function projectPeople(profiles) {
  const people = {};
  for (const [id, profile] of profiles) people[id] = { name: displayName(profile), avatarUrl: projectProfileAvatar(profile) };
  return people;
}

// ---------------------------------------------------------------------------
// Read shaping
// ---------------------------------------------------------------------------
async function listProjects(userId, env) {
  const memberships = await listRows(`project_members?user_id=eq.${encodeURIComponent(userId)}&select=project_id,role,can_create_fields&order=created_at.desc`, env);
  const membershipByProject = new Map(memberships.map((member) => [member.project_id, member]));
  const memberIds = memberships.map((member) => member.project_id);
  const owned = await listRows(`projects?owner_id=eq.${encodeURIComponent(userId)}&select=id,owner_id,name,description,kind,created_at,updated_at&order=updated_at.desc`, env);
  const memberProjects = memberIds.length
    ? await listRows(`projects?id=${inList(memberIds)}&select=id,owner_id,name,description,kind,created_at,updated_at&order=updated_at.desc`, env)
    : [];
  const all = [...owned];
  for (const project of memberProjects) {
    if (project.owner_id !== userId) all.push(project);
  }
  all.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const ids = all.map((project) => project.id);
  if (!ids.length) return [];
  const [fieldRows, memberRows, requestRows, subtaskRows] = await Promise.all([
    listRows(`project_fields?project_id=${inList(ids)}&select=project_id,status`, env),
    listRows(`project_members?project_id=${inList(ids)}&select=project_id`, env),
    listRows(`project_field_requests?project_id=${inList(ids)}&status=eq.pending&select=project_id`, env),
    listRows(`project_subtasks?project_id=${inList(ids)}&select=project_id,completed`, env),
  ]);
  const fieldStats = new Map();
  for (const row of fieldRows) {
    const stats = fieldStats.get(row.project_id) || { total: 0, completed: 0, inReview: 0 };
    stats.total += 1;
    if (row.status === "completed") stats.completed += 1;
    if (row.status === "in-review") stats.inReview += 1;
    fieldStats.set(row.project_id, stats);
  }
  const memberCounts = new Map();
  for (const row of memberRows) memberCounts.set(row.project_id, (memberCounts.get(row.project_id) || 0) + 1);
  const pendingCounts = new Map();
  for (const row of requestRows) pendingCounts.set(row.project_id, (pendingCounts.get(row.project_id) || 0) + 1);
  const taskStats = new Map();
  for (const row of subtaskRows) {
    const count = taskStats.get(row.project_id) || { total: 0, completed: 0 };
    count.total += 1;
    if (row.completed) count.completed += 1;
    taskStats.set(row.project_id, count);
  }
  return all.map((project) => {
    const isOwner = project.owner_id === userId;
    const stats = fieldStats.get(project.id) || { total: 0, completed: 0, inReview: 0 };
    const tasks = taskStats.get(project.id) || { total: 0, completed: 0 };
    return {
      ...project,
      access: {
        owner: isOwner,
        role: isOwner ? "owner" : membershipByProject.get(project.id)?.role || "viewer",
        canCreateFields: isOwner || Boolean(membershipByProject.get(project.id)?.can_create_fields),
      },
      stats: {
        fields: stats.total,
        completed: stats.completed,
        inReview: stats.inReview,
        members: (memberCounts.get(project.id) || 0) + 1,
        pendingRequests: isOwner ? pendingCounts.get(project.id) || 0 : 0,
        subtasksTotal: tasks.total,
        subtasksCompleted: tasks.completed,
      },
    };
  });
}

/**
 * Activity analytics for the Activity tab chart. Reads every activity row in
 * the selected window plus the equally long previous window (paged through
 * `listRows`, never capped) and buckets them by the viewer's local day.
 */
async function projectActivityStats(projectId, identity, range, env, now = Date.now()) {
  await loadProjectAccess(projectId, identity.id, env);
  const period = projectActivityWindow(range, identity.timezone, now);
  const rows = await listRows(`project_activity?project_id=eq.${encodeURIComponent(projectId)}&created_at=gte.${encodeURIComponent(period.since)}&select=actor_id,action,created_at&order=created_at.asc`, env);
  return summarizeProjectActivity(rows, { range: period.range, timeZone: period.timeZone, now });
}

async function projectDetail(projectId, userId, env) {
  const { project, isOwner, member } = await loadProjectAccess(projectId, userId, env);
  const [folders, fields, memberRows, requestRows, activityRows, subtaskRows, attachmentRows] = await Promise.all([
    listRows(`project_folders?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,name,color,created_by,created_at,updated_at&order=name.asc`, env),
    listRows(`project_fields?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,folder_id,title,description,status,progress,creator_id,creator_name,assignee_id,due_date,created_at,updated_at&order=updated_at.desc`, env),
    listRows(`project_members?project_id=eq.${encodeURIComponent(projectId)}&select=project_id,user_id,role,can_create_fields,invited_by,created_at,updated_at&order=created_at.asc`, env),
    isOwner
      ? listRows(`project_field_requests?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,requester_id,requester_name,note,payload,status,resolution_note,field_id,created_at,resolved_at&order=created_at.desc&limit=50`, env)
      : listRows(`project_field_requests?project_id=eq.${encodeURIComponent(projectId)}&requester_id=eq.${encodeURIComponent(userId)}&select=id,project_id,requester_id,requester_name,note,payload,status,resolution_note,field_id,created_at,resolved_at&order=created_at.desc&limit=25`, env),
    listRows(`project_activity?project_id=eq.${encodeURIComponent(projectId)}&select=id,actor_id,actor_name,action,target,created_at&order=created_at.desc&limit=40`, env),
    listRows(`project_subtasks?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,field_id,title,completed,sort_order,assignee_id,created_by,updated_by,created_at,updated_at&order=sort_order.asc,created_at.asc`, env),
    listRows(`project_field_attachments?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,field_id,uploader_id,file_name,file_size,file_type,created_at&order=created_at.desc`, env),
  ]);
  const fieldIds = fields.map((field) => field.id);
  const [commentRows, reactionRows] = fieldIds.length
    ? await Promise.all([
        listRows(`project_field_comments?project_id=eq.${encodeURIComponent(projectId)}&select=id,field_id,author_id,author_name,body,created_at,updated_at&order=created_at.asc&limit=2000`, env),
        listRows(`project_field_reactions?user_id=eq.${encodeURIComponent(userId)}&field_id=${inList(fieldIds)}&select=field_id,pinned,favourite`, env),
      ])
    : [[], []];
  const commentCounts = new Map();
  const commentsByField = new Map();
  for (const comment of commentRows) {
    commentCounts.set(comment.field_id, (commentCounts.get(comment.field_id) || 0) + 1);
    const bucket = commentsByField.get(comment.field_id) || [];
    bucket.push(comment);
    commentsByField.set(comment.field_id, bucket);
  }
  const reactions = new Map(reactionRows.map((reaction) => [reaction.field_id, reaction]));
  const subtasksByField = new Map();
  for (const task of subtaskRows) {
    const bucket = subtasksByField.get(task.field_id) || [];
    bucket.push(task);
    subtasksByField.set(task.field_id, bucket);
  }
  const attachmentsByField = new Map();
  for (const attachment of attachmentRows) {
    const bucket = attachmentsByField.get(attachment.field_id) || [];
    bucket.push(attachment);
    attachmentsByField.set(attachment.field_id, bucket);
  }
  const profileIds = [
    project.owner_id,
    ...memberRows.map((row) => row.user_id),
    ...fields.map((field) => field.assignee_id).filter(Boolean),
    ...subtaskRows.flatMap((row) => [row.assignee_id, row.created_by]).filter(Boolean),
    ...attachmentRows.map((row) => row.uploader_id).filter(Boolean),
    ...fields.map((field) => field.creator_id).filter(Boolean),
    ...commentRows.map((row) => row.author_id).filter(Boolean),
    ...activityRows.map((row) => row.actor_id).filter(Boolean),
    ...requestRows.map((row) => row.requester_id).filter(Boolean),
    userId,
  ];
  const profiles = await loadProfiles(profileIds, env);
  const ownerProfile = profiles.get(project.owner_id) || null;
  return {
    project,
    access: {
      owner: isOwner,
      role: isOwner ? "owner" : member?.role || "viewer",
      canCreateFields: isOwner || Boolean(member?.can_create_fields),
      canRequest: !isOwner && !(member?.role === "editor" && member?.can_create_fields),
    },
    owner: ownerProfile ? { id: ownerProfile.id, name: displayName(ownerProfile), email: ownerProfile.email || "", loginId: ownerProfile.login_id || "", avatarUrl: projectProfileAvatar(ownerProfile) } : null,
    members: memberRows.map((row) => {
      const profile = profiles.get(row.user_id) || null;
      return {
        userId: row.user_id,
        role: row.role,
        canCreateFields: Boolean(row.can_create_fields),
        invitedBy: row.invited_by || null,
        createdAt: row.created_at,
        name: displayName(profile),
        email: profile?.email || "",
        loginId: profile?.login_id || "",
        avatarUrl: projectProfileAvatar(profile),
      };
    }),
    folders: folders.map((folder) => ({ ...folder, fieldCount: fields.filter((field) => field.folder_id === folder.id).length })),
    fields: fields.map((field) => ({
      ...field,
      assigneeName: field.assignee_id ? displayName(profiles.get(field.assignee_id)) : null,
      mine: {
        pinned: Boolean(reactions.get(field.id)?.pinned),
        favourite: Boolean(reactions.get(field.id)?.favourite),
      },
      commentCount: commentCounts.get(field.id) || 0,
      comments: commentsByField.get(field.id) || [],
      subtasks: (subtasksByField.get(field.id) || []).map((task) => ({
        id: task.id, project_id: task.project_id, field_id: task.field_id, title: task.title, completed: Boolean(task.completed),
        sort_order: task.sort_order, assignee_id: task.assignee_id || null, created_by: task.created_by,
        created_at: task.created_at, updated_at: task.updated_at,
        assigneeName: task.assignee_id ? displayName(profiles.get(task.assignee_id)) : null,
        creatorName: displayName(profiles.get(task.created_by)),
      })),
      attachments: (attachmentsByField.get(field.id) || []).map((attachment) => attachmentView(attachment, displayName(profiles.get(attachment.uploader_id)))),
    })),
    requests: requestRows,
    activity: activityRows,
    // Display name + chosen profile picture for everyone referenced above, keyed by user id.
    people: projectPeople(profiles),
  };
}

async function fieldComments(fieldId, userId, env) {
  const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&select=id,project_id`, env);
  if (!field) throw new ProjectError("That field is not available.", 404);
  await loadProjectAccess(field.project_id, userId, env);
  return listRows(`project_field_comments?field_id=eq.${encodeURIComponent(fieldId)}&select=id,field_id,project_id,author_id,author_name,body,created_at,updated_at&order=created_at.asc&limit=500`, env);
}

async function accessibleProjects(userId, env) {
  const [owned, memberships] = await Promise.all([
    listRows(`projects?owner_id=eq.${encodeURIComponent(userId)}&select=id,name`, env),
    listRows(`project_members?user_id=eq.${encodeURIComponent(userId)}&select=project_id`, env),
  ]);
  const memberIds = [...new Set(memberships.map((row) => row.project_id).filter(isUuid))];
  const memberProjects = memberIds.length ? await listRows(`projects?id=${inList(memberIds)}&select=id,name`, env) : [];
  const all = new Map([...owned, ...memberProjects].map((project) => [project.id, project]));
  return all;
}

async function listProjectNotifications(userId, env) {
  await rpc("persora__project_overdue_notifications", { p_user: userId }, env);
  const [rows, accessible] = await Promise.all([
    listRows(`project_notifications?recipient_id=eq.${encodeURIComponent(userId)}&select=id,actor_id,actor_name,project_id,field_id,subtask_id,kind,title,message,created_at,read_at&order=created_at.desc&limit=100`, env),
    accessibleProjects(userId, env),
  ]);
  return rows.flatMap((row) => {
    const project = accessible.get(row.project_id);
    if (project) return [{ id: row.id, kind: row.kind, actorName: row.actor_name, title: row.title, message: row.message, createdAt: row.created_at, readAt: row.read_at || undefined, projectId: row.project_id, projectName: project.name, fieldId: row.field_id || undefined, subtaskId: row.subtask_id || undefined }];
    if (row.kind === "access_removed") return [{ id: row.id, kind: "access_removed", actorName: "Project owner", title: "Project access changed", message: "Your access to a shared project was removed.", createdAt: row.created_at, readAt: row.read_at || undefined, projectId: null, projectName: "", fieldId: undefined, subtaskId: undefined }];
    return [];
  });
}

function readProjectNotificationPreferences(row) {
  return Object.fromEntries(Object.entries(PROJECT_NOTIFICATION_DEFAULTS).map(([key, fallback]) => [key, typeof row?.[key] === "boolean" ? row[key] : fallback]));
}

async function getProjectNotificationPreferences(userId, env) {
  const row = await firstRow(`project_notification_preferences?user_id=eq.${encodeURIComponent(userId)}&select=membership,assignments,requests,subtasks,comments,attachments,deadlines,updates`, env);
  return readProjectNotificationPreferences(row);
}

async function getEditableProjectField(projectId, fieldId, userId, env) {
  const access = await loadProjectAccess(projectId, userId, env);
  const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,creator_id,title`, env);
  if (!field) throw new ProjectError("That field is not available.", 404);
  if (!access.isOwner && field.creator_id !== userId) throw new ProjectError("Only the project owner or the member who created this field can change it.", 403);
  return { ...access, field };
}

/** Field creator, project owner, field assignee, or the checklist item's own assignee may toggle completion. */
async function assertCanToggleProjectSubtask(projectId, task, userId, env) {
  const access = await loadProjectAccess(projectId, userId, env);
  const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(task.field_id)}&project_id=eq.${encodeURIComponent(projectId)}&select=id,creator_id,assignee_id`, env);
  if (!field) throw new ProjectError("That field is not available.", 404);
  if (access.isOwner || field.creator_id === userId || field.assignee_id === userId || task.assignee_id === userId) return { ...access, field };
  throw new ProjectError("Only the people assigned to this field or checklist item can check it off.", 403);
}

async function processProjectAttachmentCleanup(fileKey, ownerId, env) {
  if (!env.VAULT_FILES || !isUuid(ownerId) || typeof fileKey !== "string" || !fileKey.startsWith(`${ownerId}/projects/`) || fileKey.includes("..") || fileKey.includes("\\\\")) return false;
  const encoded = encodeURIComponent(fileKey);
  const owner = encodeURIComponent(ownerId);
  const trashMatch = encodeURIComponent(`["${fileKey}"]`);
  const [projectRefs, vaultRefs, medicalRefs, contactRefs, photoRefs, logoRefs, trashRefs] = await Promise.all([
    listRows(`project_field_attachments?file_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`vault_items?user_id=eq.${owner}&file_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`medical_records?user_id=eq.${owner}&file_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`contacts?user_id=eq.${owner}&photo_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`business_cards?user_id=eq.${owner}&profile_photo_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`business_cards?user_id=eq.${owner}&business_logo_key=eq.${encoded}&select=id&limit=1`, env),
    listRows(`trash_items?owner_id=eq.${owner}&file_keys=cs.${trashMatch}&status=in.(active,restoring)&select=id&limit=1`, env),
  ]);
  if (projectRefs.length || vaultRefs.length || medicalRefs.length || contactRefs.length || photoRefs.length || logoRefs.length || trashRefs.length) return false;
  const object = await env.VAULT_FILES.head(fileKey);
  if (object) {
    const metadata = object.customMetadata || {};
    if (metadata.ownerId !== ownerId || metadata.projectAttachment !== "true") {
      console.error("Refusing to remove a project attachment with mismatched storage ownership metadata.");
      return false;
    }
    await env.VAULT_FILES.delete(fileKey);
  }
  const cleared = await dbFetch(`project_attachment_cleanup?file_key=eq.${encoded}&owner_id=eq.${owner}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!cleared.ok) throw new Error(`Project attachment cleanup could not be recorded (${cleared.status}).`);
  return true;
}

async function drainProjectAttachmentCleanup(ownerId, env, fileKey = "") {
  const rows = fileKey
    ? await listRows(`project_attachment_cleanup?file_key=eq.${encodeURIComponent(fileKey)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=file_key,owner_id&limit=1`, env)
    : await listRows(`project_attachment_cleanup?owner_id=eq.${encodeURIComponent(ownerId)}&select=file_key,owner_id&order=queued_at.asc&limit=20`, env);
  let pending = false;
  for (const row of rows) {
    try { if (!(await processProjectAttachmentCleanup(row.file_key, row.owner_id, env))) pending = true; }
    catch (error) { pending = true; console.error("Persora project attachment cleanup pending", error instanceof Error ? error.message : "unknown error"); }
  }
  return pending;
}

async function uploadProjectAttachment(request, identity, projectId, fieldId, env, services) {
  const { project } = await getEditableProjectField(projectId, fieldId, identity.id, env);
  if (!env.VAULT_FILES) throw new ProjectError("Private project file storage is unavailable.", 503);
  const maxMb = Math.max(1, Math.min(150, Number(services?.maxUploadMb) || 25));
  const maxBytes = Math.min(PROJECT_ATTACHMENT_MAX_BYTES, maxMb * 1024 * 1024);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes + 1024 * 1024) throw new ProjectError(`Attachments must be ${maxMb} MB or smaller.`, 413);
  let form;
  try { form = await request.formData(); } catch { throw new ProjectError("Choose a valid file upload.", 400); }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ProjectError("Choose a file to attach.", 400);
  if (file.size > maxBytes) throw new ProjectError(`Attachments must be ${maxMb} MB or smaller.`, 413);
  const type = projectAttachmentType(file.name, file.type);
  await validateProjectFile(file, type);
  if (typeof services?.storageUsage !== "function") throw new ProjectError("Private project file storage is unavailable.", 503);
  const storageOwnerId = project.owner_id;
  const usage = await services.storageUsage(storageOwnerId, env.VAULT_FILES, env);
  if (usage.bytesUsed + file.size > usage.storageLimitBytes) throw new ProjectError(`This attachment exceeds the project owner's ${usage.storageLimitGb} GB storage limit.`, 413);
  const safeName = sanitizeProjectFilename(file.name);
  const key = `${storageOwnerId}/projects/${projectId}/${crypto.randomUUID()}-${safeName}`;
  await env.VAULT_FILES.put(key, file.stream(), { httpMetadata: { contentType: type.type }, customMetadata: { ownerId: storageOwnerId, projectAttachment: "true", projectId, fieldId, uploaderId: identity.id, originalName: safeName, createdAt: new Date().toISOString() } });
  try {
    const savedResult = await rpc("persora_project_attachment_add", { p_user: identity.id, p_field: fieldId, p_file_key: key, p_file_name: safeName, p_file_size: file.size, p_file_type: type.type }, env);
    const saved = Array.isArray(savedResult) ? savedResult[0] : savedResult;
    if (!saved?.id) throw new ProjectError("The attachment could not be confirmed after upload.", 502);
    return attachmentView(saved, displayName(identity));
  } catch (error) {
    // A transport error can occur after Postgres commits. Never remove an object
    // while a row references it; leave uncertain state private for later cleanup.
    try {
      const refs = await listRows(`project_field_attachments?file_key=eq.${encodeURIComponent(key)}&select=id&limit=1`, env);
      if (!refs.length) await env.VAULT_FILES.delete(key);
    } catch (cleanupError) { console.error("Project upload cleanup deferred", cleanupError instanceof Error ? cleanupError.message : "unknown error"); }
    throw error;
  }
}

async function downloadProjectAttachment(projectId, fieldId, attachmentId, identity, env, origin, preview) {
  const { project } = await loadProjectAccess(projectId, identity.id, env);
  const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id`, env);
  if (!field) throw new ProjectError("That field is not available.", 404);
  if (!isUuid(attachmentId) || !env.VAULT_FILES) throw new ProjectError("That attachment is not available.", 404);
  const row = await firstRow(`project_field_attachments?id=eq.${encodeURIComponent(attachmentId)}&project_id=eq.${encodeURIComponent(projectId)}&field_id=eq.${encodeURIComponent(fieldId)}&select=id,owner_id,uploader_id,file_key,file_name,file_size,file_type`, env);
  if (!row || row.owner_id !== project.owner_id || !row.file_key.startsWith(`${project.owner_id}/projects/${projectId}/`)) throw new ProjectError("That attachment is not available.", 404);
  const object = await env.VAULT_FILES.get(row.file_key);
  const metadata = object?.customMetadata || {};
  if (!object || metadata.ownerId !== project.owner_id || metadata.projectAttachment !== "true" || metadata.projectId !== projectId || metadata.fieldId !== fieldId || metadata.uploaderId !== row.uploader_id) throw new ProjectError("That private attachment is unavailable.", 404);
  const type = projectAttachmentType(row.file_name, row.file_type);
  const inline = preview && type.preview;
  const fileName = sanitizeProjectFilename(row.file_name);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(object.body, { status: 200, headers: headersFor(origin, {
    "Content-Type": type.type,
    "Content-Length": String(object.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "X-File-Name": encodeURIComponent(fileName),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store, max-age=0",
  }) });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handleProjects(request, identity, env, origin, services = {}) {
  const userId = identity.id;
  const url = new URL(request.url);
  // The top-level Pages router normalizes its own URL for dispatch, but the
  // Request URL remains /api/projects... . Normalize here too; otherwise the
  // sliced segment becomes "ects" (or the wrong project id), making every
  // list/detail request look like a missing project.
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4) || "/";
  const segments = url.pathname.slice(PROJECTS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const readBody = async () => {
    try { return await request.json(); } catch { throw new ProjectError("The request body could not be read.", 400); }
  };
  try {
    if (segments[0] === "notifications") {
      if (segments.length === 1 && request.method === "GET") return json(await listProjectNotifications(userId, env), 200, origin);
      if (segments.length === 1 && request.method === "PATCH") {
        await rpc("persora__project_notifications_mark_read", { p_user: userId, p_notification: null }, env);
        return json({ ok: true }, 200, origin);
      }
      if (segments.length === 2 && isUuid(segments[1]) && request.method === "PATCH") {
        await rpc("persora__project_notifications_mark_read", { p_user: userId, p_notification: segments[1] }, env);
        return json({ ok: true }, 200, origin);
      }
      return json({ error: "That project notification route is not available." }, 404, origin);
    }
    if (segments[0] === "notification-preferences") {
      if (segments.length === 1 && request.method === "GET") return json(await getProjectNotificationPreferences(userId, env), 200, origin);
      if (segments.length === 1 && request.method === "PATCH") {
        const body = await readBody();
        const keys = Object.keys(PROJECT_NOTIFICATION_DEFAULTS);
        if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some((key) => !keys.includes(key)) || Object.values(body).some((value) => typeof value !== "boolean")) {
          throw new ProjectError("Choose valid project notification preferences.", 400);
        }
        const current = await getProjectNotificationPreferences(userId, env);
        const preferences = { ...current, ...body };
        const saved = await rpc("persora__project_notification_preferences_save", { p_user: userId, p_preferences: preferences }, env);
        return json(readProjectNotificationPreferences(saved), 200, origin);
      }
      return json({ error: "That notification preferences route is not available." }, 404, origin);
    }
    // /projects
    if (segments.length === 0) {
      if (request.method === "GET") return json({ projects: await listProjects(userId, env) }, 200, origin);
      if (request.method === "POST") {
        const existing = await listProjects(userId, env);
        const ownedCount = existing.filter((project) => project.access.owner).length;
        if (ownedCount >= MAX_PROJECTS_PER_USER) throw new ProjectError(`You can own up to ${MAX_PROJECTS_PER_USER} projects.`, 409);
        const input = sanitizeProjectInput(await readBody());
        const createdResult = await rpc("persora_project_create", { p_user: userId, p_name: input.name, p_description: input.description, p_kind: input.kind }, env);
        // PostgREST normally returns the scalar jsonb object directly; tolerate
        // a one-row wrapper as well, but always verify the canonical persisted
        // row and return its database UUID rather than trusting a UI/local ID.
        const created = Array.isArray(createdResult) ? createdResult[0] : createdResult;
        if (!isUuid(created?.id)) {
          console.error("Persora project creation returned no valid database ID", { responseType: Array.isArray(createdResult) ? "array" : typeof createdResult });
          throw new ProjectError("The project save did not return a valid database ID. Refresh Projects and try again.", 502);
        }
        const persisted = await firstRow(`projects?id=eq.${encodeURIComponent(created.id)}&owner_id=eq.${encodeURIComponent(userId)}&select=id,owner_id,name,description,kind,created_at,updated_at`, env);
        if (!persisted) {
          throw new ProjectError("The project was created, but its saved record could not be verified. Refresh Projects before retrying.", 502);
        }
        return json({ project: persisted }, 201, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const projectId = segments[0];
    if (!isUuid(projectId)) return json({ error: "That project is not available." }, 404, origin);

    // /projects/:id
    if (segments.length === 1) {
      if (request.method === "GET") return json(await projectDetail(projectId, userId, env), 200, origin);
      if (request.method === "PATCH") {
        const body = await readBody();
        let name = null;
        if (body.name !== undefined) {
          name = String(body.name).trim();
          if (name.length < 1 || name.length > 120) throw new ProjectError("Give the project a name between 1 and 120 characters.", 400);
        }
        let description = null;
        if (body.description !== undefined) {
          description = String(body.description).trim();
          if (description.length > 2000) throw new ProjectError("Keep the project description under 2,000 characters.", 400);
        }
        let kind = null;
        if (body.kind !== undefined) {
          if (body.kind !== "personal" && body.kind !== "shared") throw new ProjectError("Choose Personal or Shared for this project.", 400);
          kind = body.kind;
        }
        if (name === null && description === null && kind === null) throw new ProjectError("There is nothing to update on this project.", 400);
        const project = await rpc("persora_project_update", { p_user: userId, p_project: projectId, p_name: name, p_description: description, p_kind: kind }, env);
        return json({ project }, 200, origin);
      }
      if (request.method === "DELETE") {
        const { project } = await loadProjectAccess(projectId, userId, env);
        const result = await rpc("persora_project_delete", { p_user: userId, p_project: projectId }, env);
        let attachmentCleanupPending = false;
        try { attachmentCleanupPending = await drainProjectAttachmentCleanup(project.owner_id, env); } catch (error) { attachmentCleanupPending = true; console.error("Project removed; attachment cleanup remains queued", error instanceof Error ? error.message : "unknown error"); }
        return json({ ...result, attachmentCleanupPending }, 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const section = segments[1];

    // /projects/:id/members[/:userId]
    if (section === "members") {
      if (segments.length === 2 && request.method === "POST") {
        const body = await readBody();
        const role = MEMBER_ROLES.has(body.role) ? body.role : "viewer";
        const canCreate = Boolean(body.canCreateFields);
        const projectRow = await firstRow(`projects?id=eq.${encodeURIComponent(projectId)}&select=owner_id`, env);
        if (!projectRow) throw new ProjectError("That project is not available.", 404);
        const recipient = await resolveProjectRecipient(body.recipient, userId, env);
        const member = await rpc("persora_project_member_add", { p_user: userId, p_project: projectId, p_recipient: recipient.id, p_role: role, p_can_create: canCreate }, env);
        return json({ member, recipient: { id: recipient.id, name: displayName(recipient), email: recipient.email, loginId: recipient.login_id } }, 200, origin);
      }
      if (segments.length === 3 && isUuid(segments[2])) {
        const memberId = segments[2];
        if (request.method === "PATCH") {
          const body = await readBody();
          if (body.role !== undefined && !MEMBER_ROLES.has(body.role)) throw new ProjectError("Choose a valid member role.", 400);
          const member = await rpc("persora_project_member_update", {
            p_user: userId,
            p_project: projectId,
            p_member: memberId,
            p_role: body.role !== undefined ? body.role : null,
            p_can_create: body.canCreateFields !== undefined ? Boolean(body.canCreateFields) : null,
          }, env);
          return json({ member }, 200, origin);
        }
        if (request.method === "DELETE") {
          return json(await rpc("persora_project_member_remove", { p_user: userId, p_project: projectId, p_member: memberId }, env), 200, origin);
        }
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    // /projects/:id/folders[/:folderId]
    if (section === "folders") {
      if (segments.length === 2 && request.method === "POST") {
        const body = await readBody();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 1 || name.length > 80) throw new ProjectError("Give the folder a name between 1 and 80 characters.", 400);
        const color = FOLDER_COLORS.has(body.color) ? body.color : "cyan";
        const folder = await rpc("persora_project_folder_create", { p_user: userId, p_project: projectId, p_name: name, p_color: color }, env);
        return json({ folder }, 201, origin);
      }
      if (segments.length === 3 && isUuid(segments[2])) {
        if (request.method === "PATCH") {
          const body = await readBody();
          const name = body.name !== undefined ? String(body.name).trim() : null;
          if (name !== null && (name.length < 1 || name.length > 80)) throw new ProjectError("Give the folder a name between 1 and 80 characters.", 400);
          const color = body.color !== undefined ? (FOLDER_COLORS.has(body.color) ? body.color : null) : null;
          const folder = await rpc("persora_project_folder_update", { p_user: userId, p_folder: segments[2], p_name: name, p_color: color }, env);
          return json({ folder }, 200, origin);
        }
        if (request.method === "DELETE") {
          return json(await rpc("persora_project_folder_delete", { p_user: userId, p_folder: segments[2] }, env), 200, origin);
        }
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    // /projects/:id/fields[/:fieldId[...]]
    if (section === "fields") {
      if (segments.length === 2 && request.method === "POST") {
        const payload = sanitizeFieldPayload(await readBody(), { requireTitle: true });
        const field = await rpc("persora_project_field_create", { p_user: userId, p_project: projectId, p_payload: payload }, env);
        return json({ field }, 201, origin);
      }
      if (segments.length === 4 && isUuid(segments[2]) && segments[3] === "subtasks") {
        const fieldId = segments[2];
        if (request.method === "GET") {
          await loadProjectAccess(projectId, userId, env);
          const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id`, env);
          if (!field) throw new ProjectError("That field is not available.", 404);
          const rows = await listRows(`project_subtasks?project_id=eq.${encodeURIComponent(projectId)}&field_id=eq.${encodeURIComponent(fieldId)}&select=id,project_id,field_id,title,completed,sort_order,assignee_id,created_by,created_at,updated_at&order=sort_order.asc,created_at.asc`, env);
          const profiles = await loadProfiles(rows.flatMap((row) => [row.assignee_id, row.created_by]).filter(Boolean), env);
          return json({ subtasks: rows.map((task) => ({ ...task, assigneeName: task.assignee_id ? displayName(profiles.get(task.assignee_id)) : null, creatorName: displayName(profiles.get(task.created_by)) })) }, 200, origin);
        }
        if (request.method === "POST") {
          const { field } = await getEditableProjectField(projectId, fieldId, userId, env);
          const payload = sanitizeProjectSubtaskInput(await readBody());
          const subtask = await rpc("persora_project_subtask_create", { p_user: userId, p_field: field.id, p_title: payload.title, p_assignee: payload.assignee_id || null }, env);
          const profiles = await loadProfiles([subtask.assignee_id, subtask.created_by].filter(Boolean), env);
          return json({ subtask: { ...subtask, assigneeName: subtask.assignee_id ? displayName(profiles.get(subtask.assignee_id)) : null, creatorName: displayName(profiles.get(subtask.created_by)) } }, 201, origin);
        }
        return json({ error: "Method not allowed." }, 405, origin);
      }
      if (segments.length === 5 && isUuid(segments[2]) && segments[3] === "subtasks" && segments[4] === "reorder" && request.method === "PATCH") {
        const { field } = await getEditableProjectField(projectId, segments[2], userId, env);
        const body = await readBody();
        const order = body?.order;
        if (!Array.isArray(order) || order.length > 500 || order.some((id) => !isUuid(id)) || new Set(order).size !== order.length) throw new ProjectError("Refresh this field and choose a valid subtask order.", 400);
        await rpc("persora_project_subtask_reorder", { p_user: userId, p_field: field.id, p_order: order }, env);
        return json({ ok: true }, 200, origin);
      }
      if (segments.length === 5 && isUuid(segments[2]) && segments[3] === "subtasks" && isUuid(segments[4])) {
        const subtaskId = segments[4];
        const task = await firstRow(`project_subtasks?id=eq.${encodeURIComponent(subtaskId)}&project_id=eq.${encodeURIComponent(projectId)}&field_id=eq.${encodeURIComponent(segments[2])}&select=id,field_id,assignee_id`, env);
        if (!task) throw new ProjectError("That subtask is not available.", 404);
        if (request.method === "PATCH") {
          const payload = sanitizeProjectSubtaskInput(await readBody(), { allowPartial: true });
          // Checking an item off is open to the field's assignee and the item's assignee;
          // every other subtask change stays limited to the field creator and project owner.
          if (Object.keys(payload).length === 1 && payload.completed !== undefined) await assertCanToggleProjectSubtask(projectId, task, userId, env);
          else await getEditableProjectField(projectId, task.field_id, userId, env);
          const subtask = await rpc("persora_project_subtask_update", { p_user: userId, p_subtask: subtaskId, p_payload: payload }, env);
          const profiles = await loadProfiles([subtask.assignee_id, subtask.created_by].filter(Boolean), env);
          return json({ subtask: { ...subtask, assigneeName: subtask.assignee_id ? displayName(profiles.get(subtask.assignee_id)) : null, creatorName: displayName(profiles.get(subtask.created_by)) } }, 200, origin);
        }
        if (request.method === "DELETE") return json(await rpc("persora_project_subtask_delete", { p_user: userId, p_subtask: subtaskId }, env), 200, origin);
        return json({ error: "Method not allowed." }, 405, origin);
      }
      if (segments.length === 4 && isUuid(segments[2]) && segments[3] === "attachments") {
        const fieldId = segments[2];
        if (request.method === "POST") return json({ attachment: await uploadProjectAttachment(request, identity, projectId, fieldId, env, services) }, 201, origin);
        if (request.method === "GET") {
          const { project } = await loadProjectAccess(projectId, userId, env);
          const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id`, env);
          if (!field) throw new ProjectError("That field is not available.", 404);
          const rows = await listRows(`project_field_attachments?project_id=eq.${encodeURIComponent(projectId)}&field_id=eq.${encodeURIComponent(fieldId)}&select=id,project_id,field_id,uploader_id,file_name,file_size,file_type,created_at&order=created_at.desc`, env);
          const profiles = await loadProfiles(rows.map((row) => row.uploader_id), env);
          return json({ attachments: rows.map((row) => attachmentView(row, displayName(profiles.get(row.uploader_id)))) }, 200, origin);
        }
        return json({ error: "Method not allowed." }, 405, origin);
      }
      if (segments.length === 6 && isUuid(segments[2]) && segments[3] === "attachments" && isUuid(segments[4]) && segments[5] === "file" && request.method === "GET") {
        return await downloadProjectAttachment(projectId, segments[2], segments[4], identity, env, origin, url.searchParams.get("preview") === "1");
      }
      if (segments.length === 5 && isUuid(segments[2]) && segments[3] === "attachments" && isUuid(segments[4]) && request.method === "DELETE") {
        const attachmentId = segments[4];
        const row = await firstRow(`project_field_attachments?id=eq.${encodeURIComponent(attachmentId)}&project_id=eq.${encodeURIComponent(projectId)}&field_id=eq.${encodeURIComponent(segments[2])}&select=id,owner_id`, env);
        if (!row) throw new ProjectError("That attachment is not available.", 404);
        const result = await rpc("persora_project_attachment_delete", { p_user: userId, p_attachment: attachmentId }, env);
        let attachmentCleanupPending = false;
        try { attachmentCleanupPending = await drainProjectAttachmentCleanup(row.owner_id, env, result?.file_key); } catch (error) { attachmentCleanupPending = true; console.error("Attachment removed; storage cleanup remains queued", error instanceof Error ? error.message : "unknown error"); }
        return json({ ok: true, attachmentCleanupPending }, 200, origin);
      }
      if (segments.length >= 3 && isUuid(segments[2])) {
        const fieldId = segments[2];
        if (segments.length === 3) {
          if (request.method === "PATCH") {
            const payload = sanitizeFieldPayload(await readBody());
            const field = await rpc("persora_project_field_update", { p_user: userId, p_field: fieldId, p_payload: payload }, env);
            return json({ field }, 200, origin);
          }
          if (request.method === "DELETE") {
            const { project } = await loadProjectAccess(projectId, userId, env);
            const result = await rpc("persora_project_field_delete", { p_user: userId, p_field: fieldId }, env);
            let attachmentCleanupPending = false;
            try { attachmentCleanupPending = await drainProjectAttachmentCleanup(project.owner_id, env); } catch (error) { attachmentCleanupPending = true; console.error("Field removed; attachment cleanup remains queued", error instanceof Error ? error.message : "unknown error"); }
            return json({ ...result, attachmentCleanupPending }, 200, origin);
          }
          return json({ error: "Method not allowed." }, 405, origin);
        }
        const action = segments[3];
        // /projects/:id/fields/:fieldId/react
        if (action === "react" && segments.length === 4 && request.method === "POST") {
          const body = await readBody();
          const reaction = await rpc("persora_project_field_react", {
            p_user: userId,
            p_field: fieldId,
            p_pinned: Boolean(body.pinned),
            p_favourite: Boolean(body.favourite),
          }, env);
          return json({ reaction }, 200, origin);
        }
        // /projects/:id/fields/:fieldId/comments[/:commentId]
        if (action === "comments") {
          if (segments.length === 4) {
            if (request.method === "GET") return json({ comments: await fieldComments(fieldId, userId, env) }, 200, origin);
            if (request.method === "POST") {
              const body = await readBody();
              const text = typeof body.body === "string" ? body.body.trim() : "";
              if (text.length < 1 || text.length > 2000) throw new ProjectError("Write a comment between 1 and 2,000 characters.", 400);
              const comment = await rpc("persora_project_comment_add", { p_user: userId, p_field: fieldId, p_body: text }, env);
              return json({ comment }, 201, origin);
            }
            return json({ error: "Method not allowed." }, 405, origin);
          }
          if (segments.length === 5 && isUuid(segments[4])) {
            const commentId = segments[4];
            if (request.method === "PATCH") {
              const body = await readBody();
              const text = typeof body.body === "string" ? body.body.trim() : "";
              if (text.length < 1 || text.length > 2000) throw new ProjectError("Write a comment between 1 and 2,000 characters.", 400);
              const comment = await rpc("persora_project_comment_update", { p_user: userId, p_comment: commentId, p_body: text }, env);
              return json({ comment }, 200, origin);
            }
            if (request.method === "DELETE") {
              return json(await rpc("persora_project_comment_delete", { p_user: userId, p_comment: commentId }, env), 200, origin);
            }
          }
          return json({ error: "Method not allowed." }, 405, origin);
        }
      }
      return json({ error: "That project page is not available." }, 404, origin);
    }

    // /projects/:id/activity-stats?range=7|30|90
    if (section === "activity-stats") {
      if (segments.length === 2 && request.method === "GET") {
        return json(await projectActivityStats(projectId, identity, url.searchParams.get("range"), env), 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    // /projects/:id/requests[/:requestId[/resolve]]
    if (section === "requests") {
      if (segments.length === 2 && request.method === "POST") {
        const body = await readBody();
        const payload = sanitizeFieldPayload(body.payload || body, { requireTitle: true });
        const note = readNote(body, "note", 1000);
        const created = await rpc("persora_project_field_request", { p_user: userId, p_project: projectId, p_payload: payload, p_note: note }, env);
        return json({ request: created }, 201, origin);
      }
      if (segments.length === 3 && isUuid(segments[2]) && request.method === "DELETE") {
        return json(await rpc("persora_project_field_request_cancel", { p_user: userId, p_request: segments[2] }, env), 200, origin);
      }
      if (segments.length === 4 && isUuid(segments[2]) && segments[3] === "resolve" && request.method === "POST") {
        const body = await readBody();
        const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : "";
        if (!decision) throw new ProjectError("Choose approve or reject for this request.", 400);
        const note = readNote(body, "note", 1000);
        return json(await rpc("persora_project_field_request_resolve", { p_user: userId, p_request: segments[2], p_decision: decision, p_resolution_note: note }, env), 200, origin);
      }
      return json({ error: "Method not allowed." }, 405, origin);
    }

    return json({ error: "That project page is not available." }, 404, origin);
  } catch (error) {
    if (error instanceof ProjectError) return json({ error: error.message }, error.status, origin);
    console.error("Persora projects request failed", error);
    return json({ error: "Projects are temporarily unavailable. Please try again shortly." }, 500, origin);
  }
}
