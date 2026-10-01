import { useMemo, useState, type FormEvent } from "react";
import { Activity, CalendarDays, Check, ChevronDown, ClipboardPlus, Download, FileText, Filter, FlaskConical, HeartPulse, Hospital, LayoutGrid, Link2, List, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Stethoscope, Trash2, Upload, X } from "lucide-react";
import type { MedicalRecord, MedicalRecordDraft, MedicalRecordLink, MedicalRecordType, PersoraContact, VaultItem } from "../types";
import { MEDICAL_RECORD_TYPES } from "../types";
import { SECTION_BY_ID } from "../data";

interface Props {
  records: MedicalRecord[];
  contacts: PersoraContact[];
  items: VaultItem[];
  demoMode: boolean;
  connected: boolean;
  maxUploadMb: number;
  onRefresh: () => Promise<void>;
  onSave: (draft: MedicalRecordDraft) => Promise<MedicalRecord>;
  onDelete: (record: MedicalRecord) => Promise<void>;
  onOpenFile: (record: MedicalRecord) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const isTestType = (type: MedicalRecordType) => ["Lab Test", "Imaging / Scan", "Medical Report"].includes(type);
const isClinicalType = (type: MedicalRecordType) => !["Vaccination", "Medical Certificate", "Other"].includes(type);
const isFollowUpType = (type: MedicalRecordType) => ["Doctor Visit", "Lab Test", "Imaging / Scan", "Hospital Record", "Discharge Summary"].includes(type);
const formatDate = (value: string) => { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
const blankDraft = (): MedicalRecordDraft => ({ title: "", recordType: "Doctor Visit", recordDate: localToday(), provider: "", hospital: "", specialty: "", notes: "", diagnosis: "", testName: "", testResult: "", medicationNotes: "", followUpDate: "", relatedReminderId: "", links: [], file: undefined, fileUpload: null, removeFile: false });
const linkKey = (link: Pick<MedicalRecordLink, "recordType" | "recordId">) => `${link.recordType}:${link.recordId}`;

function recordIcon(type: MedicalRecordType) {
  if (type === "Lab Test" || type === "Imaging / Scan") return FlaskConical;
  if (type === "Hospital Record" || type === "Discharge Summary") return Hospital;
  if (type === "Prescription" || type === "Doctor Visit") return Stethoscope;
  return HeartPulse;
}

export default function MedicalRecordsView({ records, contacts, items, demoMode, connected, maxUploadMb, onRefresh, onSave, onDelete, onOpenFile, notify }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [layout, setLayout] = useState<"cards" | "list">(() => { try { return localStorage.getItem("persora-view:medical-records") === "list" ? "list" : "cards"; } catch { return "cards"; } });
  const [editor, setEditor] = useState<MedicalRecordDraft | null>(null);
  const [detail, setDetail] = useState<MedicalRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedicalRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");

  const visible = useMemo(() => records.filter((record) => {
    if (typeFilter !== "All types" && record.recordType !== typeFilter) return false;
    const terms = [record.title, record.recordType, record.provider, record.hospital, record.specialty, record.diagnosis, record.testName, record.testResult, record.notes].join(" ").toLowerCase();
    return !query.trim() || terms.includes(query.trim().toLowerCase());
  }).sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.updatedAt.localeCompare(a.updatedAt)), [records, query, typeFilter]);

  const startCreate = () => { setDetail(null); setEditor(blankDraft()); setLinkSearch(""); };
  const startEdit = (record: MedicalRecord) => {
    setDetail(null); setEditor({ ...record, links: record.links.filter((link) => link.linkKind !== "reminder"), relatedReminderId: record.relatedReminderId || record.links.find((link) => link.linkKind === "reminder")?.recordId || "", fileUpload: null, removeFile: false }); setLinkSearch("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!editor) return;
    if (!editor.title.trim()) { notify("Add a title for this medical record.", "error"); return; }
    if (!editor.recordDate) { notify("Choose the record date.", "error"); return; }
    if (editor.fileUpload && editor.fileUpload.size > maxUploadMb * 1024 * 1024) { notify(`Choose a file smaller than ${maxUploadMb} MB.`, "error"); return; }
    setSaving(true);
    try { const saved = await onSave({ ...editor, title: editor.title.trim(), provider: editor.provider.trim(), hospital: editor.hospital.trim(), specialty: editor.specialty.trim(), notes: editor.notes.trim(), diagnosis: editor.diagnosis.trim(), testName: editor.testName.trim(), testResult: editor.testResult.trim(), medicationNotes: editor.medicationNotes.trim(), relatedReminderId: editor.relatedReminderId || "" }); setEditor(null); setDetail(saved); }
    catch (error) { notify(error instanceof Error ? error.message : "The medical record couldn't be saved.", "error"); }
    finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await onDelete(deleteTarget); setDeleteTarget(null); setDetail(null); notify("Medical record deleted."); }
    catch (error) { notify(error instanceof Error ? error.message : "The medical record couldn't be deleted.", "error"); }
  };
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't refresh medical records.", "error"); } finally { setRefreshing(false); } };

  const reminderItems = items.filter((item) => item.metadata.recordType === "reminder").sort((a, b) => a.title.localeCompare(b.title));
  const selectableLinks = [
    ...contacts.map((contact) => ({ recordType: "contact" as const, recordId: contact.id, title: contact.name, subtitle: `Contact${contact.company ? ` · ${contact.company}` : ""}` })),
    ...items.map((item) => ({ recordType: "vault_item" as const, recordId: item.id, title: item.title, subtitle: `${SECTION_BY_ID[item.section]?.label || "Persora record"}${item.metadata.recordType === "reminder" ? " · Reminder" : ""}` })),
  ].filter((entry) => {
    const needle = linkSearch.trim().toLowerCase();
    return !needle || `${entry.title} ${entry.subtitle}`.toLowerCase().includes(needle);
  }).slice(0, 100);

  const linkedRecordSummary = (record: MedicalRecord) => {
    const entries = record.links.map((link) => link.recordType === "contact"
      ? contacts.find((entry) => entry.id === link.recordId)?.name
      : items.find((entry) => entry.id === link.recordId)?.title).filter((value): value is string => Boolean(value));
    const reminder = record.relatedReminderId ? items.find((item) => item.id === record.relatedReminderId)?.title : "";
    return [...new Set([...entries, ...(reminder ? [`Reminder: ${reminder}`] : [])])];
  };

  return <div className="medical-page">
    <section className="medical-privacy-banner"><span><LockKeyhole size={17}/></span><div><b><ShieldCheck size={14}/> {demoMode ? "Private demo preview" : "Private medical records"}</b><p>{demoMode ? "Demo entries stay in memory for this session only and are not uploaded or persisted." : "Only your authenticated Persora account can access these records and their files. They are not shared or published."}</p></div></section>
    <div className="medical-page-heading"><div><span className="medical-eyebrow">PERSONAL HEALTH ARCHIVE</span><h2>Medical Records</h2><p>Keep visit notes, test results, prescriptions and related files together.</p></div><button className="medical-primary" onClick={startCreate}><Plus size={16}/> Add medical record</button></div>
    <div className="medical-controls"><label className="medical-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medical records" aria-label="Search medical records"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label><label className="medical-filter"><Filter size={14}/><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by record type"><option>All types</option>{MEDICAL_RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={13}/></label><div className="medical-layout-toggle" role="group" aria-label="Medical record layout"><button className={layout === "cards" ? "active" : ""} aria-label="Card view" aria-pressed={layout === "cards"} onClick={() => { setLayout("cards"); try { localStorage.setItem("persora-view:medical-records", "cards"); } catch {} }}><LayoutGrid size={15}/></button><button className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => { setLayout("list"); try { localStorage.setItem("persora-view:medical-records", "list"); } catch {} }}><List size={15}/></button><button className="medical-refresh" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh records" title="Refresh records">{refreshing ? "…" : <Activity size={14}/>}</button></div></div>

    {visible.length ? <div className={`medical-record-grid ${layout === "list" ? "medical-list-layout" : ""}`}>{visible.map((record) => { const Icon = recordIcon(record.recordType); const links = linkedRecordSummary(record); return <article className="medical-record-card" key={record.id}>
      <button className="medical-card-main" onClick={() => setDetail(record)} aria-label={`View ${record.title}`}><span className="medical-record-icon"><Icon size={17}/></span><span className="medical-card-content"><span className="medical-card-type">{record.recordType}</span><b>{record.title}</b><span className="medical-card-meta"><CalendarDays size={12}/>{formatDate(record.recordDate)}{record.provider ? ` · ${record.provider}` : ""}</span>{record.diagnosis && <span className="medical-card-diagnosis">{record.diagnosis}</span>}{record.file && <span className="medical-file-chip"><FileText size={12}/>{record.file.name}</span>}{links.length > 0 && <span className="medical-linked-chip"><Link2 size={12}/>{links.length} linked record{links.length === 1 ? "" : "s"}</span>}</span></button>
      <div className="medical-card-actions"><button onClick={() => startEdit(record)} aria-label={`Edit ${record.title}`} title="Edit"><Pencil size={14}/></button><button onClick={() => setDeleteTarget(record)} aria-label={`Delete ${record.title}`} title="Delete"><Trash2 size={14}/></button></div>
    </article>; })}</div> : <div className="medical-empty"><span><ClipboardPlus size={20}/></span><b>{records.length ? "No records match" : "Your medical archive is ready"}</b><p>{records.length ? "Try a different search or record type." : "Securely organize health records and add a reference when you need it."}</p>{!records.length && <button className="medical-primary" onClick={startCreate}><Plus size={15}/> Add your first record</button>}</div>}
    {!connected && !demoMode && <p className="medical-connect-note">Cloud sync is unavailable. Sign in with a connected Persora account to save private medical records.</p>}

    {editor && <div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null); }}><section className="medical-modal" role="dialog" aria-modal="true" aria-labelledby="medical-modal-title"><header className="medical-modal-header"><div><span>PRIVATE HEALTH ARCHIVE</span><h2 id="medical-modal-title">{editor.id ? "Edit medical record" : "Add medical record"}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><X size={18}/></button></header><form onSubmit={(event) => void submit(event)}><div className="medical-modal-body">
      <div className="medical-form-section"><h3>Basic information</h3><div className="medical-form-grid"><label className="medical-field"><span>Record Title <i>*</i></span><input autoFocus maxLength={200} required value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. Annual health checkup"/></label><label className="medical-field"><span>Record Type <i>*</i></span><select required value={editor.recordType} onChange={(event) => { const recordType = event.target.value as MedicalRecordType; setEditor({ ...editor, recordType, diagnosis: isClinicalType(recordType) ? editor.diagnosis : "", testName: isTestType(recordType) ? editor.testName : "", testResult: isTestType(recordType) ? editor.testResult : "", medicationNotes: recordType === "Prescription" ? editor.medicationNotes : "", followUpDate: isFollowUpType(recordType) ? editor.followUpDate : "" }); }}>{MEDICAL_RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label className="medical-field"><span>Record Date <i>*</i></span><input type="date" required value={editor.recordDate} onChange={(event) => setEditor({ ...editor, recordDate: event.target.value })}/></label><label className="medical-field"><span>Doctor / Healthcare Provider</span><input maxLength={160} value={editor.provider} onChange={(event) => setEditor({ ...editor, provider: event.target.value })} placeholder="Name of doctor or provider"/></label><label className="medical-field"><span>Hospital / Clinic</span><input maxLength={180} value={editor.hospital} onChange={(event) => setEditor({ ...editor, hospital: event.target.value })} placeholder="Facility name"/></label><label className="medical-field"><span>Medical Specialty</span><input maxLength={120} value={editor.specialty} onChange={(event) => setEditor({ ...editor, specialty: event.target.value })} placeholder="e.g. Cardiology"/></label><label className="medical-field medical-field-wide"><span>Notes</span><textarea rows={3} maxLength={5000} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="Anything else you'd like to remember"/></label></div></div>
      <div className="medical-form-section"><h3>File upload <small>Optional</small></h3><label className="medical-upload-box"><Upload size={17}/><span><b>{editor.fileUpload?.name || (editor.removeFile ? "Choose a replacement file" : editor.file?.name || "Choose a document or image")}</b><small>PDF, image, document or other file · up to {maxUploadMb} MB</small></span><input type="file" onChange={(event) => { const file = event.target.files?.[0] || null; setEditor({ ...editor, fileUpload: file, removeFile: false }); }}/></label>{editor.file && !editor.removeFile && !editor.fileUpload && <button type="button" className="medical-remove-file" onClick={() => setEditor({ ...editor, removeFile: true })}><X size={12}/> Remove current file</button>}{editor.removeFile && <button type="button" className="medical-undo-file" onClick={() => setEditor({ ...editor, removeFile: false })}>Keep current file</button>}</div>
      <div className="medical-form-section"><h3>Optional details <small>{editor.recordType}</small></h3><div className="medical-form-grid">{isClinicalType(editor.recordType) && <label className="medical-field medical-field-wide"><span>Diagnosis / Reason for Visit</span><input maxLength={400} value={editor.diagnosis} onChange={(event) => setEditor({ ...editor, diagnosis: event.target.value })} placeholder="Optional"/></label>}{isTestType(editor.recordType) && <><label className="medical-field"><span>Test Name</span><input maxLength={180} value={editor.testName} onChange={(event) => setEditor({ ...editor, testName: event.target.value })} placeholder="e.g. Complete blood count"/></label><label className="medical-field"><span>Test Result Summary</span><input maxLength={600} value={editor.testResult} onChange={(event) => setEditor({ ...editor, testResult: event.target.value })} placeholder="Brief summary (optional)"/></label></>}{editor.recordType === "Prescription" && <label className="medical-field medical-field-wide"><span>Prescription / Medication Notes</span><textarea rows={3} maxLength={2000} value={editor.medicationNotes} onChange={(event) => setEditor({ ...editor, medicationNotes: event.target.value })} placeholder="Medication, dosage, or instructions (optional)"/></label>}{isFollowUpType(editor.recordType) && <label className="medical-field"><span>Follow-up Date</span><input type="date" value={editor.followUpDate} onChange={(event) => setEditor({ ...editor, followUpDate: event.target.value })}/></label>}<label className="medical-field"><span>Related Reminder</span><select value={editor.relatedReminderId || ""} onChange={(event) => setEditor({ ...editor, relatedReminderId: event.target.value })}><option value="">No reminder linked</option>{reminderItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div></div>
      <div className="medical-form-section"><h3>Link existing Persora records <small>References only — original files are not copied.</small></h3><label className="medical-link-search"><Search size={13}/><input value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="Find contacts, reminders or documents"/></label><div className="medical-link-picker">{selectableLinks.map((entry) => { const chosen = editor.links.some((link) => linkKey(link) === `${entry.recordType}:${entry.recordId}`); return <label className={chosen ? "selected" : ""} key={`${entry.recordType}:${entry.recordId}`}><input type="checkbox" checked={chosen} onChange={() => { const links = editor.links.filter((link) => linkKey(link) !== `${entry.recordType}:${entry.recordId}`); if (!chosen) links.push({ recordType: entry.recordType, recordId: entry.recordId, linkKind: "related" }); setEditor({ ...editor, links }); }}/><span><b>{entry.title}</b><small>{entry.subtitle}</small></span>{chosen && <Check size={14}/>}</label>; })}{!selectableLinks.length && <span className="medical-picker-empty">No contacts or records found.</span>}</div><p className="medical-link-note"><Link2 size={12}/> A reference to the existing record is saved; attached documents are not duplicated.</p></div>
      <div className="medical-private-foot"><LockKeyhole size={13}/> {demoMode ? "Demo data remains in session memory. Linked records are references only." : "Private to your account. Linked files and records are references only; original files are not copied."}</div></div><footer className="medical-modal-footer"><button type="button" className="medical-secondary" onClick={() => setEditor(null)} disabled={saving}>Cancel</button><button className="medical-primary" type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15}/>{editor.id ? "Save changes" : "Save medical record"}</>}</button></footer></form></section></div>}

    {detail && <div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="medical-detail-modal" role="dialog" aria-modal="true" aria-labelledby="medical-detail-title"><header className="medical-modal-header"><div><span>{detail.recordType.toUpperCase()}</span><h2 id="medical-detail-title">{detail.title}</h2></div><button onClick={() => setDetail(null)} aria-label="Close"><X size={18}/></button></header><div className="medical-detail-body"><div className="medical-detail-date"><CalendarDays size={15}/>{formatDate(detail.recordDate)}</div><div className="medical-detail-grid">{[["Doctor / Healthcare Provider", detail.provider], ["Hospital / Clinic", detail.hospital], ["Medical Specialty", detail.specialty], ["Diagnosis / Reason", detail.diagnosis], ["Test Name", detail.testName], ["Test Result Summary", detail.testResult], ["Medication Notes", detail.medicationNotes], ["Follow-up Date", detail.followUpDate ? formatDate(detail.followUpDate) : ""]].filter(([, value]) => value).map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>{detail.notes && <div className="medical-detail-notes"><small>Notes</small><p>{detail.notes}</p></div>}{detail.file && <button className="medical-detail-file" onClick={() => onOpenFile(detail)}><FileText size={16}/><span><b>{detail.file.name}</b><small>{detail.file.size ? `${(detail.file.size / 1024 / 1024).toFixed(2)} MB` : "Attached file"}</small></span><Download size={15}/></button>}{linkedRecordSummary(detail).length > 0 && <div className="medical-detail-links"><small>Linked Persora records</small>{linkedRecordSummary(detail).map((label) => <span key={label}><Link2 size={12}/>{label}</span>)}</div>}</div><footer className="medical-modal-footer"><button className="medical-danger-quiet" onClick={() => setDeleteTarget(detail)}><Trash2 size={14}/> Delete</button><button className="medical-primary" onClick={() => startEdit(detail)}><Pencil size={14}/> Edit record</button></footer></section></div>}

    {deleteTarget && <div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><section className="medical-delete-dialog" role="alertdialog" aria-modal="true"><span><Trash2 size={18}/></span><h2>Delete medical record?</h2><p>“{deleteTarget.title}” and its attached copy will be removed. Linked Persora records will remain unchanged.</p><div><button className="medical-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="medical-danger" onClick={() => void confirmDelete()}>Delete record</button></div></section></div>}
  </div>;
}
