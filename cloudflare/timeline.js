const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
class TimelineError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

function headersFor(origin, extra = {}) {
  return { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Expose-Headers": "Content-Disposition,Content-Length,X-File-Name", ...extra };
}
function json(value, status, origin) { return new Response(JSON.stringify(value), { status, headers: headersFor(origin) }); }
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
async function dbFetch(path, env, init = {}) { return fetch(dbUrl(env, path), { ...init, headers: dbHeaders(env, init.headers || {}) }); }
async function rows(path, env) {
  const response = await dbFetch(path, env);
  if (!response.ok) throw new Error(`Timeline database request failed (${response.status}).`);
  return response.json();
}
async function listRows(path, env) {
  const result = [];
  for (let start = 0; ; start += 1000) {
    const response = await dbFetch(path, env, { headers: { Range: `${start}-${start + 999}` } });
    if (!response.ok) throw new Error(`Timeline database request failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("The timeline service received an invalid record list.");
    result.push(...page);
    if (page.length < 1000) return result;
  }
}
function userFilter(userId) { return `user_id=eq.${encodeURIComponent(userId)}`; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function safeUrl(value) {
  if (!value) return "";
  if (typeof value !== "string" || value.length > 2048) throw new TimelineError("Use an http or https link under 2,048 characters.");
  try { const url = new URL(value); if (url.protocol === "http:" || url.protocol === "https:") return url.href; } catch { /* Invalid URL below. */ }
  throw new TimelineError("Use a valid http or https link.");
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function autoRecord(item, field, date, label, title) {
  return { eventKey: `auto:${item.id}:${field}:${date}`, eventDate: date, recordId: item.id, title: title || `${item.title} · ${label}`, description: `Persora automatically added this ${label.toLowerCase()} event from your linked record.` };
}
function automaticEvents(items, timeZone, now = new Date()) {
  const today = dateInTimeZone(now, timeZone);
  const fields = {
    documents: [["issueDate", "Issue date"], ["expiryDate", "Expiry date"]],
    academics: [["paymentDate", "Payment date"]],
    subscriptions: [["startDate", "Subscription start date"], ["renewalDate", "Renewal date"]],
    purchases: [["purchaseDate", "Purchase date"], ["warrantyExpiry", "Warranty expiry"]],
    memberships: [["startDate", "Membership start date"], ["expiryDate", "Membership expiry"]],
    accounts: [["registered", "Account registration"]],
  };
  const output = [];
  for (const item of items) {
    const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {};
    if (item.section === "notes") {
      if (metadata.recordType === "todo" && metadata.completed !== "true" && validDate(metadata.dueDate) && metadata.dueDate <= today) output.push(autoRecord(item, "dueDate", metadata.dueDate, "Task due date"));
      if (metadata.recordType === "reminder" && metadata.enabled !== "false" && metadata.reminderAt) {
        const reminder = new Date(metadata.reminderAt);
        if (!Number.isNaN(reminder.getTime())) { const date = dateInTimeZone(reminder, timeZone); if (date <= today) output.push(autoRecord(item, "reminderAt", date, "Reminder", `${item.title} · Reminder`)); }
      }
    }
    for (const [field, label] of fields[item.section] || []) { const date = metadata[field]; if (validDate(date) && date <= today) output.push(autoRecord(item, field, date, label)); }
    if (item.section === "family" && typeof metadata.dateOfBirth === "string") {
      const thisYear = `${today.slice(0, 4)}-${metadata.dateOfBirth.slice(5, 10)}`;
      if (validDate(thisYear) && thisYear <= today) output.push(autoRecord(item, "dateOfBirth", thisYear, "Birthday", `${item.title} · Birthday`));
    }
  }
  return output;
}
function toBytes(value) { return new TextEncoder().encode(value); }
function base64(bytes) { let binary = ""; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function cryptoKey(userId, env) {
  const secret = env.TIMELINE_ENCRYPTION_KEY;
  if (typeof secret !== "string" || secret.length < 32) throw new TimelineError("Timeline encryption is not configured. Set a stable, at least 32-character TIMELINE_ENCRYPTION_KEY secret in Cloudflare Pages settings.", 503);
  const raw = await crypto.subtle.digest("SHA-256", toBytes(`Persora Sherlock timeline v1:${userId}:${secret}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptBytes(bytes, userId, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(userId, env), bytes);
  const joined = new Uint8Array(iv.length + encrypted.byteLength); joined.set(iv); joined.set(new Uint8Array(encrypted), iv.length); return joined;
}
async function decryptBytes(bytes, userId, env) {
  if (bytes.length < 29) throw new TimelineError("The encrypted timeline content is damaged.", 500);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await cryptoKey(userId, env), bytes.slice(12)));
}
async function encryptPayload(payload, userId, env) { return base64(await encryptBytes(toBytes(JSON.stringify(payload)), userId, env)); }
async function decryptPayload(ciphertext, userId, env) {
  try { return JSON.parse(new TextDecoder().decode(await decryptBytes(fromBase64(ciphertext), userId, env))); }
  catch { throw new TimelineError("Timeline content could not be decrypted. Check that TIMELINE_ENCRYPTION_KEY has not changed.", 500); }
}
function linkedIdsFromRows(rows) { return rows.map((row) => row.record_id).filter((value) => typeof value === "string"); }
async function eventLinks(eventId, userId, env) {
  const result = await rows(`timeline_event_links?event_id=eq.${encodeURIComponent(eventId)}&owner_id=eq.${encodeURIComponent(userId)}&select=record_id&order=record_id.asc`, env);
  return linkedIdsFromRows(result);
}
async function publicEvent(row, userId, env) {
  const payload = await decryptPayload(row.encrypted_payload, userId, env);
  const linkedRecordIds = await eventLinks(row.id, userId, env);
  return { id: row.id, eventType: row.event_type, eventDate: row.event_date, eventKey: row.event_key || undefined, recordId: row.record_id || undefined,
    title: String(payload.title || ""), description: String(payload.description || ""), ...(payload.url ? { url: payload.url } : {}),
    ...(payload.attachment ? { attachment: payload.attachment } : {}), linkedRecordIds, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function ensureAutomaticEvents(identity, env) {
  const [items, existing] = await Promise.all([
    listRows(`vault_items?${userFilter(identity.id)}&select=id,section,title,metadata&order=id.asc`, env),
    listRows(`timeline_events?${userFilter(identity.id)}&event_type=eq.automatic&event_key=not.is.null&select=id,event_key`, env),
  ]);
  const obsoleteAlarms = existing.filter((row) => /:alarm(?:Date)?:/i.test(row.event_key || ""));
  if (obsoleteAlarms.length) {
    const ids = obsoleteAlarms.map((row) => row.id).filter(isUuid);
    if (ids.length) {
      const response = await dbFetch(`timeline_events?${userFilter(identity.id)}&event_type=eq.automatic&id=in.(${ids.join(",")})`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (!response.ok) throw new Error(`Obsolete alarm timeline events could not be removed (${response.status}).`);
    }
  }
  const keys = new Set(existing.filter((row) => !obsoleteAlarms.includes(row)).map((row) => row.event_key));
  const missing = automaticEvents(items, identity.timezone || "Asia/Dhaka").filter((event) => !keys.has(event.eventKey));
  for (let index = 0; index < missing.length; index += 100) {
    const part = missing.slice(index, index + 100);
    const rowsToInsert = await Promise.all(part.map(async (event) => ({ user_id: identity.id, event_type: "automatic", event_date: event.eventDate, event_key: event.eventKey, record_id: event.recordId, encrypted_payload: await encryptPayload({ title: event.title, description: event.description, url: "" }, identity.id, env) })));
    const response = await dbFetch("timeline_events?on_conflict=user_id,event_key", env, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rowsToInsert) });
    if (!response.ok) throw new Error(`Automatic timeline events could not be saved (${response.status}).`);
  }
}
async function listEvents(identity, env) {
  await ensureAutomaticEvents(identity, env);
  const eventRows = await listRows(`timeline_events?${userFilter(identity.id)}&select=id,user_id,event_type,event_date,event_key,record_id,encrypted_payload,created_at,updated_at&order=event_date.desc,created_at.desc`, env);
  return Promise.all(eventRows.map((row) => publicEvent(row, identity.id, env)));
}
async function checkLinkedRecords(ids, userId, env) {
  const unique = [...new Set(ids)];
  if (unique.length > 50 || unique.some((id) => !isUuid(id))) throw new TimelineError("Choose up to 50 valid Persora records.");
  if (!unique.length) return [];
  const found = await rows(`vault_items?id=in.(${unique.map(encodeURIComponent).join(",")})&user_id=eq.${encodeURIComponent(userId)}&select=id`, env);
  const foundIds = new Set(found.map((row) => row.id));
  if (unique.some((id) => !foundIds.has(id))) throw new TimelineError("One or more selected records are no longer available in your vault.", 404);
  return unique;
}
function validateAttachment(attachment, userId) {
  if (!attachment) return null;
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) throw new TimelineError("Choose a valid attachment.");
  const key = typeof attachment.key === "string" ? attachment.key : "";
  if (!key.startsWith(`${userId}/timeline/`) || key.includes("..") || key.includes("\\")) throw new TimelineError("The private timeline attachment is invalid.");
  const name = typeof attachment.name === "string" ? attachment.name.slice(0, 180) : "attachment";
  const size = Number(attachment.size || 0);
  if (!Number.isFinite(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) throw new TimelineError("Timeline attachments must be 25 MB or smaller.");
  return { key, name, size, type: typeof attachment.type === "string" ? attachment.type.slice(0, 120) : "application/octet-stream" };
}
async function saveEvent(body, identity, env) {
  const id = typeof body.id === "string" && body.id ? body.id : "";
  if (id && !isUuid(id)) throw new TimelineError("Choose a valid timeline event.");
  if (!validDate(body.eventDate)) throw new TimelineError("Choose a valid event date.");
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200) throw new TimelineError("Event titles must be between 1 and 200 characters.");
  if (typeof body.description !== "string" || body.description.length > 5000) throw new TimelineError("Event descriptions must be 5,000 characters or fewer.");
  const linkedIds = await checkLinkedRecords(Array.isArray(body.linkedRecordIds) ? body.linkedRecordIds.filter((value) => typeof value === "string") : [], identity.id, env);
  const attachment = validateAttachment(body.attachment, identity.id);
  const url = safeUrl(typeof body.url === "string" ? body.url.trim() : "");
  const payload = { title: body.title.trim(), description: body.description.trim(), url, attachment };
  let old = null;
  if (id) {
    const rowsFound = await rows(`timeline_events?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&event_type=eq.manual&select=id,encrypted_payload&limit=1`, env);
    old = rowsFound[0];
    if (!old) throw new TimelineError("Only your manual timeline posts can be edited.", 404);
  }
  const encrypted_payload = await encryptPayload(payload, identity.id, env);
  const write = id
    ? await dbFetch(`timeline_events?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(identity.id)}&event_type=eq.manual`, env, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ event_date: body.eventDate, encrypted_payload }) })
    : await dbFetch("timeline_events", env, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ user_id: identity.id, event_type: "manual", event_date: body.eventDate, event_key: null, record_id: null, encrypted_payload }) });
  if (!write.ok) throw new Error(`The timeline post could not be saved (${write.status}).`);
  const savedRows = await write.json(); const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
  if (!saved?.id) throw new Error("The timeline post could not be confirmed.");
  if (id) {
    const removed = await dbFetch(`timeline_event_links?event_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(identity.id)}`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (!removed.ok) throw new Error("The post was saved, but its linked records could not be updated.");
  }
  if (linkedIds.length) {
    const linked = await dbFetch("timeline_event_links", env, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(linkedIds.map((record_id) => ({ event_id: saved.id, owner_id: identity.id, record_id }))) });
    if (!linked.ok) throw new Error("The post was saved, but its linked records could not be updated.");
  }
  if (old) {
    const previous = await decryptPayload(old.encrypted_payload, identity.id, env);
    const previousKey = previous?.attachment?.key;
    if (previousKey && previousKey !== attachment?.key) await env.VAULT_FILES.delete(previousKey).catch(() => {});
  }
  return publicEvent({ ...saved, event_type: "manual", event_date: body.eventDate, event_key: null, record_id: null, encrypted_payload }, identity.id, env);
}
async function deleteEvent(eventId, identity, env) {
  if (!isUuid(eventId)) throw new TimelineError("Choose a valid timeline event.");
  const current = await rows(`timeline_events?id=eq.${encodeURIComponent(eventId)}&user_id=eq.${encodeURIComponent(identity.id)}&event_type=eq.manual&select=id,encrypted_payload&limit=1`, env);
  if (!current[0]) throw new TimelineError("Only your manual timeline posts can be deleted.", 404);
  const payload = await decryptPayload(current[0].encrypted_payload, identity.id, env);
  const deleted = await dbFetch(`timeline_events?id=eq.${encodeURIComponent(eventId)}&user_id=eq.${encodeURIComponent(identity.id)}&event_type=eq.manual`, env, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!deleted.ok) throw new Error(`The timeline post could not be deleted (${deleted.status}).`);
  if (payload?.attachment?.key) await env.VAULT_FILES.delete(payload.attachment.key).catch(() => {});
  return { ok: true };
}
async function uploadAttachment(request, identity, env, storageUsage, maxUploadMb = 25) {
  const maxFileBytes = Math.max(1, Math.min(MAX_ATTACHMENT_BYTES / 1024 / 1024, Number(maxUploadMb) || 25)) * 1024 * 1024;
  const maxMbLabel = Math.floor(maxFileBytes / 1024 / 1024);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxFileBytes + 1024 * 1024) throw new TimelineError(`Timeline attachments must be ${maxMbLabel} MB or smaller.`, 413);
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > maxFileBytes) throw new TimelineError(`Choose a file between 1 byte and ${maxMbLabel} MB.`, 413);
  if (!env.VAULT_FILES) throw new TimelineError("Private file storage is unavailable.", 503);
  const usage = await storageUsage(identity.id, env.VAULT_FILES, env);
  if (usage.bytesUsed + file.size > usage.storageLimitBytes) throw new TimelineError(`This upload exceeds your ${usage.storageLimitGb} GB ${usage.planName} storage limit. Choose a larger plan or remove files first.`, 413);
  const bytes = new Uint8Array(await file.arrayBuffer()); const encrypted = await encryptBytes(bytes, identity.id, env);
  const key = `${identity.id}/timeline/${crypto.randomUUID()}.enc`;
  await env.VAULT_FILES.put(key, encrypted, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { ownerId: identity.id, encrypted: "AES-256-GCM", createdAt: new Date().toISOString() } });
  return { key, name: String(file.name || "attachment").slice(0, 180), size: file.size, type: String(file.type || "application/octet-stream").slice(0, 120) };
}
async function downloadAttachment(eventId, identity, env, origin) {
  if (!isUuid(eventId)) throw new TimelineError("Choose a valid timeline event.");
  const found = await rows(`timeline_events?id=eq.${encodeURIComponent(eventId)}&user_id=eq.${encodeURIComponent(identity.id)}&select=id,encrypted_payload&limit=1`, env);
  if (!found[0]) throw new TimelineError("This private timeline attachment is unavailable.", 404);
  const payload = await decryptPayload(found[0].encrypted_payload, identity.id, env); const attachment = payload?.attachment;
  const key = attachment?.key;
  if (!key || !String(key).startsWith(`${identity.id}/timeline/`)) throw new TimelineError("This event has no attachment.", 404);
  const object = await env.VAULT_FILES.get(key);
  if (!object || object.customMetadata?.ownerId !== identity.id || object.customMetadata?.encrypted !== "AES-256-GCM") throw new TimelineError("This private timeline attachment is unavailable.", 404);
  const clear = await decryptBytes(new Uint8Array(await new Response(object.body).arrayBuffer()), identity.id, env);
  const name = String(attachment.name || "timeline-attachment").replace(/[\r\n"\\]/g, "_").slice(0, 180);
  return new Response(clear, { status: 200, headers: { "Content-Type": typeof attachment.type === "string" ? attachment.type : "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "X-File-Name": encodeURIComponent(name), "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } });
}

export async function loadTimelineExport(identity, env) {
  const eventRows = await listRows(`timeline_events?${userFilter(identity.id)}&select=id,user_id,event_type,event_date,event_key,record_id,encrypted_payload,created_at,updated_at&order=event_date.asc,created_at.asc`, env);
  const events = await Promise.all(eventRows.map((row) => publicEvent(row, identity.id, env)));
  const attachments = events.flatMap((event) => event.attachment?.key ? [{ key: event.attachment.key, name: event.attachment.name, size: event.attachment.size, type: event.attachment.type }] : []);
  return { events, attachments };
}
export async function readTimelineExportAttachment(identity, key, env) {
  if (typeof key !== "string" || !key.startsWith(`${identity.id}/timeline/`) || key.includes("..") || key.includes("\\")) throw new TimelineError("The timeline attachment is not available for this account.", 404);
  const object = await env.VAULT_FILES.get(key);
  if (!object || object.customMetadata?.ownerId !== identity.id || object.customMetadata?.encrypted !== "AES-256-GCM") throw new TimelineError("The timeline attachment is not available for this account.", 404);
  return decryptBytes(new Uint8Array(await new Response(object.body).arrayBuffer()), identity.id, env);
}

export async function handleTimeline(request, identity, env, origin, storageUsage, maxUploadMb = 25) {
  try {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/timeline") && request.method === "GET") return json(await listEvents(identity, env), 200, origin);
    if (url.pathname.endsWith("/timeline") && request.method === "POST") return json(await saveEvent(await request.json().catch(() => ({})), identity, env), 201, origin);
    if (url.pathname.endsWith("/timeline") && request.method === "DELETE") return json(await deleteEvent(url.searchParams.get("id") || "", identity, env), 200, origin);
    if (url.pathname.endsWith("/timeline/attachment") && request.method === "POST") return json(await uploadAttachment(request, identity, env, storageUsage, maxUploadMb), 201, origin);
    if (url.pathname.endsWith("/timeline/attachment") && request.method === "GET") return await downloadAttachment(url.searchParams.get("eventId") || "", identity, env, origin);
    return json({ error: "Not found." }, 404, origin);
  } catch (error) {
    const status = error instanceof TimelineError ? error.status : 500;
    if (status >= 500) console.error("Persora timeline request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: error instanceof Error ? error.message : "The private timeline could not complete that request." }, status, origin);
  }
}
