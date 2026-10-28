import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, Clock3, ExternalLink, FileText, LockKeyhole, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { TimelineDraft, TimelineEvent, TransferProgress, VaultItem } from "../types";
import { SECTION_BY_ID } from "../data";
import { humanSize } from "../lib/utils";
import { TransferProgressIndicator } from "./ProgressIndicator";
import { ReuiFileAttachmentField } from "./reui/c-attachment-6";
import { Attachment, AttachmentContent, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "./ui/attachment";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import { Badge } from "./reui/badge";
import ModalPortal from "./ModalPortal";
import { PersoraDeleteModal, PersoraEmptyState } from "@/design-system";
import { FileType, getFileType } from "./reui/file-type";
import { IconTile } from "./reui/icon-tile";

type Props = {
  events: TimelineEvent[];
  items: VaultItem[];
  online: boolean;
  canPost: boolean;
  canUpload: boolean;
  onUpgrade?: () => void;
  saving: boolean;
  onSave: (draft: TimelineDraft, onProgress?: (progress: TransferProgress) => void) => Promise<void>;
  onDelete: (event: TimelineEvent) => Promise<void>;
  onOpenItem: (item: VaultItem) => void;
  onOpenAttachment: (event: TimelineEvent) => void;
  notify: (message: string, type?: "success" | "error") => void;
};
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const formatEventDate = (value: string) => { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }); };
const validWebUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } };

export default function TimelineView({ events, items, online, canPost, canUpload, onUpgrade, saving, onSave, onDelete, onOpenItem, onOpenAttachment, notify }: Props) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kind, setKind] = useState<"all" | "automatic" | "manual">("all");
  const [editor, setEditor] = useState<TimelineDraft | null>(null);
  const [recordSearch, setRecordSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<TimelineEvent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);

  const filtered = useMemo(() => events.filter((event) => {
    const haystack = `${event.title} ${event.description} ${event.url || ""} ${event.linkedRecordIds.map((id) => items.find((item) => item.id === id)?.title || "").join(" ")}`.toLocaleLowerCase();
    return (!query || haystack.includes(query.trim().toLocaleLowerCase())) && (!fromDate || event.eventDate >= fromDate) && (!toDate || event.eventDate <= toDate) && (kind === "all" || event.eventType === kind);
  }).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.createdAt.localeCompare(b.createdAt)), [events, fromDate, items, kind, query, toDate]);

  const startNew = () => { setUploadProgress(null); setEditor({ eventDate: localToday(), title: "", description: "", url: "", linkedRecordIds: [], attachment: undefined }); setRecordSearch(""); };
  const startEdit = (event: TimelineEvent) => { setUploadProgress(null); setEditor({ id: event.id, eventDate: event.eventDate, title: event.title, description: event.description, url: event.url || "", linkedRecordIds: event.linkedRecordIds, attachment: event.attachment }); setRecordSearch(""); };
  const submit = async () => {
    if (!editor) return;
    if (!editor.title.trim()) { notify("Add a title for this event.", "error"); return; }
    if (!editor.eventDate) { notify("Choose an event date.", "error"); return; }
    if (editor.url.trim() && !validWebUrl(editor.url.trim())) { notify("Enter a valid http or https link.", "error"); return; }
    setUploadProgress(editor.attachmentFile ? { loaded: 0, total: editor.attachmentFile.size, percent: 0, remainingSeconds: null } : null);
    try {
      await onSave({ ...editor, title: editor.title.trim(), description: editor.description.trim(), url: editor.url.trim() }, setUploadProgress);
      setEditor(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The event could not be saved.", "error");
    } finally {
      setUploadProgress(null);
    }
  };
  const remove = async () => { if (!confirmDelete) return; try { await onDelete(confirmDelete); setConfirmDelete(null); } catch (error) { notify(error instanceof Error ? error.message : "The event could not be deleted.", "error"); } };
  const selectableRecords = items.filter((item) => !recordSearch || `${item.title} ${SECTION_BY_ID[item.section]?.label || ""}`.toLowerCase().includes(recordSearch.trim().toLowerCase()));

  return <div className="timeline-page">
    {canPost && !online && <div className="timeline-offline-note"><Clock3 size={15}/> Offline: date-based automatic events are shown locally and will sync when Persora reconnects and is open.</div>}

    <div className="timeline-toolbar"><div className="timeline-intro"><span>YOUR PRIVATE HISTORY</span><h2>Life Timeline</h2><p>A chronological view of events from your Persora records and the moments you add.</p></div>{canPost && <button className="timeline-primary" onClick={startNew}><Plus size={17}/> Post Event</button>}</div>
    <div className="timeline-filters"><label className="timeline-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events and linked records" aria-label="Search timeline"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label><label className="timeline-date-filter"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}/></label><label className="timeline-date-filter"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)}/></label><select className="timeline-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Filter event type"><option value="all">All events</option><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div>

    {filtered.length ? <div className="timeline-list">{filtered.map((event) => <article className="timeline-event" key={event.id}><div className="timeline-rail"><span className={`timeline-dot ${event.eventType}`}/></div><div className="timeline-card"><div className="timeline-event-head"><div><div className="timeline-date"><CalendarDays size={14}/>{formatEventDate(event.eventDate)}</div><h3>{event.title}</h3></div><div className="inline-flex items-center gap-1.5"><Badge variant={event.eventType === "automatic" ? "info-light" : "primary-light"} size="xs" radius="full">{event.eventType === "automatic" ? <><Clock3 size={11}/> Automatic</> : <><Pencil size={11}/> Manual</>}</Badge>{event.pending && <Badge variant="warning-light" size="xs" radius="full">Waiting to sync</Badge>}</div></div>{event.description && <p className="timeline-description">{event.description}</p>}
      {event.linkedRecordIds.length > 0 && <div className="timeline-links"><span className="timeline-links-label">Linked Persora records</span>{event.linkedRecordIds.map((id) => { const item = items.find((entry) => entry.id === id); return item ? <button key={id} onClick={() => onOpenItem(item)}><FileText size={14}/><span>{item.title}</span><small>{SECTION_BY_ID[item.section]?.label || "Record"}</small><ArrowUpRight size={13}/></button> : null; })}</div>}
      {(event.url || event.attachment) && <div className="timeline-event-actions flex-wrap">{event.url && validWebUrl(event.url) && <a href={event.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open external link</a>}{event.attachment && <Attachment size="xs" variant="soft"><AttachmentTrigger aria-label={`Download ${event.attachment.name}`} onClick={() => onOpenAttachment(event)}/><AttachmentMedia><FileType type={getFileType(event.attachment.name || event.attachment.type || "")} size="mini" variant="light" aria-hidden /></AttachmentMedia><AttachmentContent><AttachmentTitle>{event.attachment.name}</AttachmentTitle></AttachmentContent></Attachment>}</div>}
      {event.eventType === "manual" && <div className="timeline-edit-actions"><button onClick={() => startEdit(event)}><Pencil size={13}/> Edit</button><button className="timeline-delete-button" onClick={() => setConfirmDelete(event)}><Trash2 size={13}/> Delete</button></div>}</div></article>)}</div> : <PersoraEmptyState className="timeline-empty" moduleId="timeline" tone="violet" title={events.length ? "No events match these filters" : "Your timeline is ready"} description={events.length ? "Try a different search or date range." : "Dates from your Persora records will appear here automatically. You can also add a moment yourself."} action={!events.length && canPost ? <button className="timeline-primary" onClick={startNew}><Plus size={16}/> Post your first event</button> : undefined}/>}

    {editor && <ModalPortal><div className="timeline-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null); }}><section className="timeline-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-modal-title"><header><div className="flex items-center gap-3"><IconTile variant="soft" size="sm" className="text-primary"><CalendarDays size={16}/></IconTile><div><span>MANUAL TIMELINE POST</span><h2 id="timeline-modal-title">{editor.id ? "Edit event" : "Post Event"}</h2></div></div><button className="timeline-close" onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><X size={19}/></button></header><div className="timeline-modal-body"><label className="timeline-form-label">Date<input type="date" value={editor.eventDate} onChange={(event) => setEditor({ ...editor, eventDate: event.target.value })}/></label><label className="timeline-form-label">Title<input maxLength={200} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="What happened?"/></label><label className="timeline-form-label">Description<textarea maxLength={5000} rows={4} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} placeholder="Add a little context (optional)"/></label><label className="timeline-form-label">External link <span>Optional</span><input type="url" value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} placeholder="https://example.com"/></label>
      <div className="timeline-form-label">Link existing Persora records <span>References only — original files are not copied.</span><label className="timeline-record-search"><Search size={14}/><input value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Find a record"/></label><div className="timeline-record-picker">{selectableRecords.slice(0, 100).map((item) => { const checked = editor.linkedRecordIds.includes(item.id); return <label key={item.id} className={checked ? "selected" : ""}><Checkbox checked={checked} onCheckedChange={(next) => setEditor({ ...editor, linkedRecordIds: next === true ? [...editor.linkedRecordIds, item.id] : editor.linkedRecordIds.filter((id) => id !== item.id) })} aria-label={`Link ${item.title}`}/><span><b>{item.title}</b><small>{SECTION_BY_ID[item.section]?.label || "Record"}</small></span></label>; })}{!selectableRecords.length && <p className="timeline-picker-empty">No records match that search.</p>}</div></div>
      <div className="timeline-form-label">Photo or file <span>Optional · encrypted before private storage</span>
        <ReuiFileAttachmentField
          file={editor.attachmentFile || null}
          existingFile={!editor.removeAttachment && editor.attachment ? editor.attachment : null}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
          disabled={!canUpload || saving}
          uploading={saving && Boolean(editor.attachmentFile)}
          title="Choose a photo or file"
          description="Encrypted before private storage in Persora"
          inputAriaLabel="Timeline attachment"
          onFileSelect={(file) => setEditor({ ...editor, attachmentFile: file, removeAttachment: false })}
          onRemoveExisting={() => setEditor({ ...editor, attachment: undefined, removeAttachment: true })}
          onError={(msg) => notify(msg, "error")}
        />
        {!canUpload && <div className="timeline-upload-notice">New attachments require an active paid plan; timeline posts and existing attachments remain available.{onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}</div>}
      </div>
      {saving && uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Encrypting & uploading attachment…" detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`} />}
      <div className="timeline-encryption-foot"><LockKeyhole size={14}/><span>Post content and any attachment are encrypted before they are stored in Persora.</span></div></div><footer><button className="timeline-cancel" onClick={() => setEditor(null)} disabled={saving}>Cancel</button><button className="timeline-primary" disabled={saving} onClick={() => void submit()}>{saving ? <><Spinner className="size-3.5"/> Saving…</> : <><Check size={16}/>{editor.id ? "Save changes" : "Post event"}</>}</button></footer></section></div></ModalPortal>}
    {confirmDelete && <PersoraDeleteModal title="Delete this manual event?" confirmLabel="Delete event" onCancel={() => setConfirmDelete(null)} onConfirm={() => void remove()}><p>“{confirmDelete.title}” will be permanently removed from your timeline.</p></PersoraDeleteModal>}
  </div>;
}
