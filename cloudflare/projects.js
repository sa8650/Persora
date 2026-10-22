// Persora Projects — worker module for personal + shared projects.
// Reads are shaped here (service role + explicit membership gate, so project
// existence is never leaked to non-members); every mutation goes through the
// security-definer RPCs in 202610220003_projects.sql which enforce the full
// permission matrix atomically inside Postgres:
//   owner            → everything (settings, members, folders, fields, moderation)
//   editor + grant   → create fields & folders, edit/delete own fields
//   other members    → view, react, comment, request new fields for approval
//   field creator    → edit/delete own fields (and only the OWNER can edit theirs)
export const PROJECTS_ROUTE_PREFIX = "/projects";

const FIELD_STATUSES = new Set(["planning", "in-progress", "in-review", "blocked", "completed"]);
const MEMBER_ROLES = new Set(["editor", "commenter", "viewer"]);
const FOLDER_COLORS = new Set(["cyan", "purple", "pink", "blue", "orange", "green"]);
const MAX_PROJECTS_PER_USER = 200;

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
  const [fieldRows, memberRows, requestRows] = await Promise.all([
    listRows(`project_fields?project_id=${inList(ids)}&select=project_id,status`, env),
    listRows(`project_members?project_id=${inList(ids)}&select=project_id`, env),
    listRows(`project_field_requests?project_id=${inList(ids)}&status=eq.pending&select=project_id`, env),
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
  return all.map((project) => {
    const isOwner = project.owner_id === userId;
    const stats = fieldStats.get(project.id) || { total: 0, completed: 0, inReview: 0 };
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
      },
    };
  });
}

async function projectDetail(projectId, userId, env) {
  const { project, isOwner, member } = await loadProjectAccess(projectId, userId, env);
  const [folders, fields, memberRows, requestRows, activityRows] = await Promise.all([
    listRows(`project_folders?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,name,color,created_by,created_at,updated_at&order=name.asc`, env),
    listRows(`project_fields?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,folder_id,title,description,status,progress,creator_id,creator_name,assignee_id,due_date,created_at,updated_at&order=updated_at.desc`, env),
    listRows(`project_members?project_id=eq.${encodeURIComponent(projectId)}&select=project_id,user_id,role,can_create_fields,invited_by,created_at,updated_at&order=created_at.asc`, env),
    isOwner
      ? listRows(`project_field_requests?project_id=eq.${encodeURIComponent(projectId)}&select=id,project_id,requester_id,requester_name,note,payload,status,resolution_note,field_id,created_at,resolved_at&order=created_at.desc&limit=50`, env)
      : listRows(`project_field_requests?project_id=eq.${encodeURIComponent(projectId)}&requester_id=eq.${encodeURIComponent(userId)}&select=id,project_id,requester_id,requester_name,note,payload,status,resolution_note,field_id,created_at,resolved_at&order=created_at.desc&limit=25`, env),
    listRows(`project_activity?project_id=eq.${encodeURIComponent(projectId)}&select=id,actor_id,actor_name,action,target,created_at&order=created_at.desc&limit=40`, env),
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
  const profileIds = [
    project.owner_id,
    ...memberRows.map((row) => row.user_id),
    ...fields.map((field) => field.assignee_id).filter(Boolean),
    ...fieldIds.length ? [userId] : [],
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
    owner: ownerProfile ? { id: ownerProfile.id, name: displayName(ownerProfile), email: ownerProfile.email || "", loginId: ownerProfile.login_id || "" } : null,
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
    })),
    requests: requestRows,
    activity: activityRows,
  };
}

async function fieldComments(fieldId, userId, env) {
  const field = await firstRow(`project_fields?id=eq.${encodeURIComponent(fieldId)}&select=id,project_id`, env);
  if (!field) throw new ProjectError("That field is not available.", 404);
  await loadProjectAccess(field.project_id, userId, env);
  return listRows(`project_field_comments?field_id=eq.${encodeURIComponent(fieldId)}&select=id,field_id,project_id,author_id,author_name,body,created_at,updated_at&order=created_at.asc&limit=500`, env);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handleProjects(request, identity, env, origin) {
  const userId = identity.id;
  const url = new URL(request.url);
  const segments = url.pathname.slice(PROJECTS_ROUTE_PREFIX.length).split("/").filter(Boolean);
  const readBody = async () => {
    try { return await request.json(); } catch { throw new ProjectError("The request body could not be read.", 400); }
  };
  try {
    // /projects
    if (segments.length === 0) {
      if (request.method === "GET") return json({ projects: await listProjects(userId, env) }, 200, origin);
      if (request.method === "POST") {
        const existing = await listProjects(userId, env);
        const ownedCount = existing.filter((project) => project.access.owner).length;
        if (ownedCount >= MAX_PROJECTS_PER_USER) throw new ProjectError(`You can own up to ${MAX_PROJECTS_PER_USER} projects.`, 409);
        const input = sanitizeProjectInput(await readBody());
        const created = await rpc("persora_project_create", { p_user: userId, p_name: input.name, p_description: input.description, p_kind: input.kind }, env);
        return json({ project: created }, 201, origin);
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
        return json(await rpc("persora_project_delete", { p_user: userId, p_project: projectId }, env), 200, origin);
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
      if (segments.length >= 3 && isUuid(segments[2])) {
        const fieldId = segments[2];
        if (segments.length === 3) {
          if (request.method === "PATCH") {
            const payload = sanitizeFieldPayload(await readBody());
            const field = await rpc("persora_project_field_update", { p_user: userId, p_field: fieldId, p_payload: payload }, env);
            return json({ field }, 200, origin);
          }
          if (request.method === "DELETE") {
            return json(await rpc("persora_project_field_delete", { p_user: userId, p_field: fieldId }, env), 200, origin);
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
