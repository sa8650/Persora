import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, CalendarDays, Check, Clock3, ExternalLink, FileText, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import type { TimelineDraft, TimelineEvent, VaultItem } from "../types";
import { SECTION_BY_ID } from "../data";

type Props = {
  events: TimelineEvent[];
  items: VaultItem[];
  online: boolean;
  canPost: boolean;
  saving: boolean;
  onSave: (draft: TimelineDraft) => Promise<void>;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onOpenItem: (item: VaultItem) => void;
  onOpenAttachment: (event: TimelineEvent) => void;
  notify: (message: string, type?: "success" | "error") => void;
};
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const formatEventDate = (value: string) => { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }); };
const validWebUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } };

export default function TimelineView({ events, items, online, canPost, saving, onSave, onDelete, onOpenItem, onOpenAttachment, notify }: Props) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kind, setKind] = useState<"all" | "automatic" | "manual">("all");
  const [editor, setEditor] = useState<TimelineDraft | null>(null);
  const [recordSearch, setRecordSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<TimelineEvent | null>(null);

  const filtered = useMemo(() => events.filter((event) => {
    const haystack = `${event.title} ${event.description} ${event.url || ""} ${event.linkedRecordIds.map((id) => items.find((item) => item.id === id)?.title || "").join(" ")}`.toLocaleLowerCase();
    return (!query || haystack.includes(query.trim().toLocaleLowerCase())) && (!fromDate || event.eventDate >= fromDate) && (!toDate || event.eventDate <= toDate) && (kind === "all" || event.eventType === kind);
  }).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.createdAt.localeCompare(b.createdAt)), [events, fromDate, items, kind, query, toDate]);

  const startNew = () => { setEditor({ eventDate: localToday(), title: "", description: "", url: "", linkedRecordIds: [], attachment: undefined }); setRecordSearch(""); };
  const startEdit = (event: TimelineEvent) => { setEditor({ id: event.id, eventDate: event.eventDate, title: event.title, description: event.description, url: event.url || "", linkedRecordIds: event.linkedRecordIds, attachment: event.attachment }); setRecordSearch(""); };
  const submit = async () => {
    if (!editor) return;
    if (!editor.title.trim()) { notify("Add a title for this event.", "error"); return; }
    if (!editor.eventDate) { notify("Choose an event date.", "error"); return; }
    if (editor.url.trim() && !validWebUrl(editor.url.trim())) { notify("Enter a valid http or https link.", "error"); return; }
    try { await onSave({ ...editor, title: editor.title.trim(), description: editor.description.trim(), url: editor.url.trim() }); setEditor(null); }
    catch (error) { notify(error instanceof Error ? error.message : "The event could not be saved.", "error"); }
  };
  const remove = async () => { if (!confirmDelete) return; try { await onDelete(confirmDelete); setConfirmDelete(null); } catch (error) { notify(error instanceof Error ? error.message : "The event could not be deleted.", "error"); } };
  const selectableRecords = items.filter((item) => !recordSearch || `${item.title} ${SECTION_BY_ID[item.section]?.label || ""}`.toLowerCase().includes(recordSearch.trim().toLowerCase()));

  return <div className="timeline-page">
    <section className={`timeline-security-banner ${canPost ? "" : "timeline-demo-banner"}`}><span className="timeline-security-icon"><ShieldCheck size={19}/></span><div>{canPost ? <><b><LockKeyhole size={14}/> Sherlock Security System · AES-256-GCM</b><p>Event text, links, and attachment files are encrypted by Persora on the server before storage. Dates and record references remain separately available for timeline sorting and navigation. This is encrypted at rest, not end-to-end encryption.</p></> : <><b>Private timeline preview</b><p>Automatic date events are shown locally in this preview. Encrypted posting and cloud synchronization require a connected Persora account.</p></>}</div></section>
    {canPost && !online && <div className="timeline-offline-note"><Clock3 size={15}/> Offline: date-based automatic events are shown locally and will sync when Persora reconnects and is open.</div>}

    <div className="timeline-toolbar"><div className="timeline-intro"><span>YOUR PRIVATE HISTORY</span><h2>Life Timeline</h2><p>A chronological view of events from your Persora records and the moments you add.</p></div>{canPost && <button className="timeline-primary" onClick={startNew}><Plus size={17}/> Post Event</button>}</div>
    <div className="timeline-filters"><label className="timeline-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events and linked records" aria-label="Search timeline"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label><label className="timeline-date-filter"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}/></label><label className="timeline-date-filter"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)}/></label><select className="timeline-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Filter event type"><option value="all">All events</option><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div>

    {filtered.length ? <div className="timeline-list">{filtered.map((event) => <article className="timeline-event" key={event.id}><div className="timeline-rail"><span className={`timeline-dot ${event.eventType}`}/></div><div className="timeline-card"><div className="timeline-event-head"><div><div className="timeline-date"><CalendarDays size={14}/>{formatEventDate(event.eventDate)}</div><h3>{event.title}</h3></div><span className={`timeline-type ${event.eventType}`}>{event.eventType === "automatic" ? <><Clock3 size={12}/> Automatic</> : <><Pencil size={12}/> Manual</>}{event.pending && <em>Waiting to sync</em>}</span></div>{event.description && <p className="timeline-description">{event.description}</p>}
      {event.linkedRecordIds.length > 0 && <div className="timeline-links"><span className="timeline-links-label">Linked Persora records</span>{event.linkedRecordIds.map((id) => { const item = items.find((entry) => entry.id === id); return item ? <button key={id} onClick={() => onOpenItem(item)}><FileText size={14}/><span>{item.title}</span><small>{SECTION_BY_ID[item.section]?.label || "Record"}</small><ArrowUpRight size={13}/></button> : null; })}</div>}
      {(event.url || event.attachment) && <div className="timeline-event-actions">{event.url && validWebUrl(event.url) && <a href={event.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open external link</a>}{event.attachment && <button onClick={() => onOpenAttachment(event)}><ArrowDownToLine size={14}/>{event.attachment.name}</button>}</div>}
      {event.eventType === "manual" && <div className="timeline-edit-actions"><button onClick={() => startEdit(event)}><Pencil size={13}/> Edit</button><button className="timeline-delete-button" onClick={() => setConfirmDelete(event)}><Trash2 size={13}/> Delete</button></div>}</div></article>)}</div> : <div className="timeline-empty"><span><CalendarDays size={20}/></span><b>{events.length ? "No events match these filters" : "Your timeline is ready"}</b><p>{events.length ? "Try a different search or date range." : "Dates from your Persora records will appear here automatically. You can also add a moment yourself."}</p>{!events.length && canPost && <button className="timeline-primary" onClick={startNew}><Plus size={16}/> Post your first event</button>}</div>}

    {editor && <div className="timeline-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><section className="timeline-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-modal-title"><header><div><span>MANUAL TIMELINE POST</span><h2 id="timeline-modal-title">{editor.id ? "Edit event" : "Post Event"}</h2></div><button className="timeline-close" onClick={() => setEditor(null)} aria-label="Close"><X size={19}/></button></header><div className="timeline-modal-body"><label className="timeline-form-label">Date<input type="date" value={editor.eventDate} onChange={(event) => setEditor({ ...editor, eventDate: event.target.value })}/></label><label className="timeline-form-label">Title<input maxLength={200} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="What happened?"/></label><label className="timeline-form-label">Description<textarea maxLength={5000} rows={4} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} placeholder="Add a little context (optional)"/></label><label className="timeline-form-label">External link <span>Optional</span><input type="url" value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} placeholder="https://example.com"/></label>
      <div className="timeline-form-label">Link existing Persora records <span>References only — original files are not copied.</span><label className="timeline-record-search"><Search size={14}/><input value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Find a record"/></label><div className="timeline-record-picker">{selectableRecords.slice(0, 100).map((item) => { const checked = editor.linkedRecordIds.includes(item.id); return <label key={item.id} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={() => setEditor({ ...editor, linkedRecordIds: checked ? editor.linkedRecordIds.filter((id) => id !== item.id) : [...editor.linkedRecordIds, item.id] })}/><span><b>{item.title}</b><small>{SECTION_BY_ID[item.section]?.label || "Record"}</small></span>{checked && <Check size={15}/>}</label>; })}{!selectableRecords.length && <p className="timeline-picker-empty">No records match that search.</p>}</div></div>
      <div className="timeline-form-label">Photo or file <span>Optional · encrypted before private storage</span><label className="timeline-file-picker"><FileText size={16}/><span>{editor.attachmentFile?.name || editor.attachment?.name || "Choose a photo or file"}</span><input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" onChange={(event) => { const file = event.target.files?.[0] || null; setEditor({ ...editor, attachmentFile: file, removeAttachment: false }); }}/></label>{editor.attachment && !editor.attachmentFile && <button className="timeline-remove-attachment" onClick={() => setEditor({ ...editor, attachment: undefined, removeAttachment: true })}><X size={13}/> Remove current attachment</button>}</div>
      <div className="timeline-encryption-foot"><LockKeyhole size={14}/><span>Post content and any attachment are encrypted before they are stored in Persora.</span></div></div><footer><button className="timeline-cancel" onClick={() => setEditor(null)}>Cancel</button><button className="timeline-primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : <><Check size={16}/>{editor.id ? "Save changes" : "Post event"}</>}</button></footer></section></div>}
    {confirmDelete && <div className="timeline-modal-backdrop"><section className="timeline-confirm" role="dialog" aria-modal="true"><div className="timeline-confirm-icon"><Trash2 size={19}/></div><h2>Delete this manual event?</h2><p>“{confirmDelete.title}” will be permanently removed from your timeline.</p><div><button className="timeline-cancel" onClick={() => setConfirmDelete(null)}>Keep event</button><button className="timeline-danger" onClick={() => void remove()}>Delete event</button></div></section></div>}
  </div>;
}
