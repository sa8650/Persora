import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, CalendarDays, Check, ChevronDown, ClipboardPlus, Download, FileText, Filter, FlaskConical, HeartPulse, Hospital, LayoutGrid, Link2, List, LockKeyhole, Pencil, Plus, Search, Stethoscope, Trash2, Upload, X } from "lucide-react";
import type { MedicalRecord, MedicalRecordDraft, MedicalRecordLink, MedicalRecordType, PersoraContact, SmartScanFieldDefinition, SmartScanResult, VaultFilePreview, VaultFolder, VaultItem } from "../types";
import { MEDICAL_RECORD_TYPES } from "../types";
import ModalPortal from "./ModalPortal";
import { SECTION_BY_ID } from "../data";
import { MagicCard } from "./magic-ui";
import MoreOptionsMenu from "./MoreOptionsMenu";
import VaultFolderShelf from "./VaultFolderShelf";
import { isPagesApiConfigured, smartScanDocument } from "../lib/cloud";
import { isSmartScanFileSizeAllowed, SmartScanActionPanel, SmartScanFieldNote, supportsSmartScanFile } from "./SmartScan";
import ImagePreview from "./ImagePreview";
import PdfPreview from "./PdfPreview";

interface Props {
  userId: string;
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
  onPreviewFile: (record: MedicalRecord) => Promise<{ blob: Blob; name: string }>;
  notify: (message: string, kind?: "success" | "error") => void;
}

const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const isTestType = (type: MedicalRecordType) => ["Lab Test", "Imaging / Scan", "Medical Report"].includes(type);
const isClinicalType = (type: MedicalRecordType) => !["Vaccination", "Medical Certificate", "Other"].includes(type);
const isFollowUpType = (type: MedicalRecordType) => ["Doctor Visit", "Lab Test", "Imaging / Scan", "Hospital Record", "Discharge Summary"].includes(type);
const formatDate = (value: string) => { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
const blankDraft = (): MedicalRecordDraft => ({ title: "", recordType: "Doctor Visit", recordDate: localToday(), provider: "", hospital: "", specialty: "", notes: "", diagnosis: "", testName: "", testResult: "", medicationNotes: "", followUpDate: "", relatedReminderId: "", links: [], file: undefined, fileUpload: null, removeFile: false });
const medicalScanFields: SmartScanFieldDefinition[] = [
  { key: "title", label: "Record Title", kind: "text" },
  { key: "recordType", label: "Record Type", kind: "select", options: [...MEDICAL_RECORD_TYPES] },
  { key: "recordDate", label: "Record Date", kind: "date" },
  { key: "provider", label: "Doctor / Healthcare Provider", kind: "text" },
  { key: "hospital", label: "Hospital / Clinic", kind: "text" },
  { key: "specialty", label: "Medical Specialty", kind: "text" },
  { key: "diagnosis", label: "Diagnosis / Reason for Visit", kind: "text" },
  { key: "testName", label: "Test Name", kind: "text" },
  { key: "testResult", label: "Test Result Summary", kind: "text" },
  { key: "medicationNotes", label: "Prescription / Medication Notes", kind: "textarea" },
  { key: "followUpDate", label: "Follow-up Date", kind: "date" },
  { key: "notes", label: "Notes", kind: "textarea" },
];
const linkKey = (link: Pick<MedicalRecordLink, "recordType" | "recordId">) => `${link.recordType}:${link.recordId}`;

function recordIcon(type: MedicalRecordType) {
  if (type === "Lab Test" || type === "Imaging / Scan") return FlaskConical;
  if (type === "Hospital Record" || type === "Discharge Summary") return Hospital;
  if (type === "Prescription" || type === "Doctor Visit") return Stethoscope;
  return HeartPulse;
}

export default function MedicalRecordsView({ userId, records, contacts, items, demoMode, connected, maxUploadMb, onRefresh, onSave, onDelete, onOpenFile, onPreviewFile, notify }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [layout, setLayout] = useState<"cards" | "list">(() => { try { return localStorage.getItem("persora-view:medical-records") === "list" ? "list" : "cards"; } catch { return "cards"; } });
  const [editor, setEditor] = useState<MedicalRecordDraft | null>(null);
  const [detail, setDetail] = useState<MedicalRecord | null>(null);
  const [filePreview, setFilePreview] = useState<VaultFilePreview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedicalRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanResult, setScanResult] = useState<SmartScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const folderRecords = selectedFolderId ? records.filter((record) => record.folderId === selectedFolderId) : records;
  const folderCounts = Object.fromEntries(folders.map((folder) => [folder.id, records.filter((record) => record.folderId === folder.id).length]));

  const visible = useMemo(() => folderRecords.filter((record) => {
    if (typeFilter !== "All types" && record.recordType !== typeFilter) return false;
    const terms = [record.title, record.recordType, record.provider, record.hospital, record.specialty, record.diagnosis, record.testName, record.testResult, record.notes].join(" ").toLowerCase();
    return !query.trim() || terms.includes(query.trim().toLowerCase());
  }).sort((a, b) => b.recordDate.localeCompare(a.recordDate) || b.updatedAt.localeCompare(a.updatedAt)), [folderRecords, query, typeFilter]);

  useEffect(() => {
    const record = detail;
    if (!record?.file) { setFilePreview(null); return; }
    let active = true;
    let objectUrl = "";
    setFilePreview({ status: "loading", name: record.file.name, type: record.file.type });
    void onPreviewFile(record).then(({ blob, name }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setFilePreview({ status: "ready", src: objectUrl, name: name || record.file?.name || "Attachment", type: blob.type || record.file?.type });
    }).catch((error) => {
      if (active) setFilePreview({ status: "error", name: record.file?.name || "Attachment", type: record.file?.type, message: error instanceof Error ? error.message : "This attachment could not be previewed." });
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [detail?.id, detail?.file?.key, detail?.file?.name, detail?.file?.type, detail?.file?.size]);

  const startCreate = () => { setDetail(null); setEditor(blankDraft()); setLinkSearch(""); setScanResult(null); setScanError(""); };
  const startEdit = (record: MedicalRecord) => {
    setDetail(null); setEditor({ ...record, links: record.links.filter((link) => link.linkKind !== "reminder"), relatedReminderId: record.relatedReminderId || record.links.find((link) => link.linkKind === "reminder")?.recordId || "", fileUpload: null, removeFile: false }); setLinkSearch(""); setScanResult(null); setScanError("");
  };
  const scanAttachment = editor?.fileUpload || (!editor?.removeFile ? editor?.file || null : null);
  const canScanAttachment = supportsSmartScanFile(scanAttachment);
  const scanSizeAllowed = isSmartScanFileSizeAllowed(editor?.fileUpload?.size ?? (!editor?.removeFile ? editor?.file?.size : undefined));
  const scanSourceAvailable = isPagesApiConfigured && scanSizeAllowed && Boolean(editor?.fileUpload || (editor?.file?.key && !editor.removeFile));
  const applyScanSuggestion = (key: string, value: string) => {
    setEditor((current) => current ? { ...current, [key]: key === "recordType" && MEDICAL_RECORD_TYPES.includes(value as MedicalRecordType) ? value as MedicalRecordType : value } : current);
  };
  const runMedicalSmartScan = async (retry: boolean) => {
    if (!editor || scanBusy || !canScanAttachment || !scanSizeAllowed || !isPagesApiConfigured) return;
    setScanBusy(true); setScanError("");
    try {
      let file = editor.fileUpload || null;
      if (!file && editor.file?.key && !editor.removeFile) {
        const sourceRecord = records.find((record) => record.id === editor.id);
        if (!sourceRecord) throw new Error("This saved attachment could not be found. Select it again to scan.");
        const downloaded = await onPreviewFile(sourceRecord);
        file = new File([downloaded.blob], downloaded.name || editor.file.name, { type: downloaded.blob.type || editor.file.type || "" });
      }
      if (!file || !supportsSmartScanFile(file)) throw new Error("Select a PDF or supported image to scan.");
      const result = await smartScanDocument(file, "medical-records", medicalScanFields, retry);
      setScanResult(result);
    } catch (reason) {
      setScanError(reason instanceof Error ? reason.message : "We couldn't scan this attachment. Try again.");
    } finally { setScanBusy(false); }
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
  const moveRecordFolder = async (record: MedicalRecord, folderId: string | null) => {
    try { const saved = await onSave({ ...record, folderId: folderId || undefined, fileUpload: null, removeFile: false }); setDetail((current) => current?.id === saved.id ? saved : current); notify(folderId ? `Moved to ${folders.find((folder) => folder.id === folderId)?.name || "folder"}.` : "Medical record moved out of its folder."); }
    catch (error) { notify(error instanceof Error ? error.message : "The medical record could not be moved.", "error"); }
  };

  useEffect(() => { setSelectedFolderId(""); setFolders([]); }, [userId]);

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
    <div className="medical-page-heading"><div><span className="medical-eyebrow">PERSONAL HEALTH ARCHIVE</span><h2>Medical Records</h2><p>Keep visit notes, test results, prescriptions and related files together.</p></div><button className="medical-primary" onClick={startCreate}><Plus size={16}/> Add medical record</button></div>
    <div className="medical-controls"><label className="medical-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medical records" aria-label="Search medical records"/>{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}</label><label className="medical-filter"><Filter size={14}/><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by record type"><option>All types</option>{MEDICAL_RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={13}/></label><div className="medical-layout-toggle" role="group" aria-label="Medical record layout"><button className={layout === "cards" ? "active" : ""} aria-label="Card view" aria-pressed={layout === "cards"} onClick={() => { setLayout("cards"); try { localStorage.setItem("persora-view:medical-records", "cards"); } catch {} }}><LayoutGrid size={15}/></button><button className={layout === "list" ? "active" : ""} aria-label="List view" aria-pressed={layout === "list"} onClick={() => { setLayout("list"); try { localStorage.setItem("persora-view:medical-records", "list"); } catch {} }}><List size={15}/></button><button className="medical-refresh" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh records" title="Refresh records">{refreshing ? "…" : <Activity size={14}/>}</button></div></div>
    <VaultFolderShelf userId={userId} scope="medical-records" pageLabel="Medical Records" demoMode={demoMode} totalCount={records.length} folderCounts={folderCounts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify}/>

    {visible.length ? <div className={`medical-record-grid ${layout === "list" ? "medical-list-layout" : ""}`}>{visible.map((record) => { const Icon = recordIcon(record.recordType); const links = linkedRecordSummary(record); return <MagicCard className="medical-card-shell" key={record.id}><article className="medical-record-card">
      <button className="medical-card-main" onClick={() => setDetail(record)} aria-label={`View ${record.title}`}><span className="medical-record-icon"><Icon size={17}/></span><span className="medical-card-content"><span className="medical-card-type">{record.recordType}</span><b>{record.title}</b><span className="medical-card-meta"><CalendarDays size={12}/>{formatDate(record.recordDate)}{record.provider ? ` · ${record.provider}` : ""}</span>{record.diagnosis && <span className="medical-card-diagnosis">{record.diagnosis}</span>}{record.file && <span className="medical-file-chip"><FileText size={12}/>{record.file.name}</span>}{links.length > 0 && <span className="medical-linked-chip"><Link2 size={12}/>{links.length} linked record{links.length === 1 ? "" : "s"}</span>}</span></button>
      <div className="medical-card-actions"><MoreOptionsMenu label={`${record.title} options`} actions={[{ label: "Edit record", icon: Pencil, onSelect: () => startEdit(record) }, { label: "Delete record", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(record) }]} folders={folders} folderId={record.folderId} onMoveFolder={(folderId) => void moveRecordFolder(record, folderId)}/></div>
    </article></MagicCard>; })}</div> : <div className="medical-empty"><span><ClipboardPlus size={20}/></span><b>{records.length ? "No records match" : "Your medical archive is ready"}</b><p>{records.length ? "Try a different search or record type." : "Securely organize health records and add a reference when you need it."}</p>{!records.length && <button className="medical-primary" onClick={startCreate}><Plus size={15}/> Add your first record</button>}</div>}
    {!connected && !demoMode && <p className="medical-connect-note">Cloud sync is unavailable. Sign in with a connected Persora account to save private medical records.</p>}

    {editor && <ModalPortal><div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null); }}><section className="medical-modal" role="dialog" aria-modal="true" aria-labelledby="medical-modal-title"><header className="medical-modal-header"><div><span>PRIVATE HEALTH ARCHIVE</span><h2 id="medical-modal-title">{editor.id ? "Edit medical record" : "Add medical record"}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><X size={18}/></button></header><form onSubmit={(event) => void submit(event)}><div className="medical-modal-body">
      <div className="medical-form-section"><h3>Basic information</h3><div className="medical-form-grid"><label className="medical-field"><span>Record Title <i>*</i></span><input autoFocus maxLength={200} required value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. Annual health checkup"/><SmartScanFieldNote field={scanResult?.fields.title} currentValue={editor.title} onApply={(value) => applyScanSuggestion("title", value)}/></label><label className="medical-field"><span>Record Type <i>*</i></span><select required value={editor.recordType} onChange={(event) => { const recordType = event.target.value as MedicalRecordType; setEditor({ ...editor, recordType, diagnosis: isClinicalType(recordType) ? editor.diagnosis : "", testName: isTestType(recordType) ? editor.testName : "", testResult: isTestType(recordType) ? editor.testResult : "", medicationNotes: recordType === "Prescription" ? editor.medicationNotes : "", followUpDate: isFollowUpType(recordType) ? editor.followUpDate : "" }); }}>{MEDICAL_RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select><SmartScanFieldNote field={scanResult?.fields.recordType} currentValue={editor.recordType} onApply={(value) => applyScanSuggestion("recordType", value)}/></label><label className="medical-field"><span>Record Date <i>*</i></span><input type="date" required value={editor.recordDate} onChange={(event) => setEditor({ ...editor, recordDate: event.target.value })}/><SmartScanFieldNote field={scanResult?.fields.recordDate} currentValue={editor.recordDate} onApply={(value) => applyScanSuggestion("recordDate", value)}/></label><label className="medical-field"><span>Doctor / Healthcare Provider</span><input maxLength={160} value={editor.provider} onChange={(event) => setEditor({ ...editor, provider: event.target.value })} placeholder="Name of doctor or provider"/><SmartScanFieldNote field={scanResult?.fields.provider} currentValue={editor.provider} onApply={(value) => applyScanSuggestion("provider", value)}/></label><label className="medical-field"><span>Hospital / Clinic</span><input maxLength={180} value={editor.hospital} onChange={(event) => setEditor({ ...editor, hospital: event.target.value })} placeholder="Facility name"/><SmartScanFieldNote field={scanResult?.fields.hospital} currentValue={editor.hospital} onApply={(value) => applyScanSuggestion("hospital", value)}/></label><label className="medical-field"><span>Medical Specialty</span><input maxLength={120} value={editor.specialty} onChange={(event) => setEditor({ ...editor, specialty: event.target.value })} placeholder="e.g. Cardiology"/><SmartScanFieldNote field={scanResult?.fields.specialty} currentValue={editor.specialty} onApply={(value) => applyScanSuggestion("specialty", value)}/></label><label className="medical-field medical-field-wide"><span>Notes</span><textarea rows={3} maxLength={5000} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="Anything else you'd like to remember"/><SmartScanFieldNote field={scanResult?.fields.notes} currentValue={editor.notes} onApply={(value) => applyScanSuggestion("notes", value)}/></label></div></div>
      <div className="medical-form-section"><h3>File upload <small>Optional</small></h3><label className="medical-upload-box"><Upload size={17}/><span><b>{editor.fileUpload?.name || (editor.removeFile ? "Choose a replacement file" : editor.file?.name || "Choose a document or image")}</b><small>PDF, image, document or other file · up to {maxUploadMb} MB</small></span><input type="file" onChange={(event) => { const file = event.target.files?.[0] || null; setEditor({ ...editor, fileUpload: file, removeFile: false }); setScanResult(null); setScanError(""); }}/></label>{canScanAttachment && <SmartScanActionPanel fileName={editor.fileUpload?.name || editor.file?.name || ""} canScan={scanSourceAvailable} unavailableMessage={!isPagesApiConfigured ? "Smart Scan needs a connected Cloudflare Pages account." : !scanSizeAllowed ? "Smart Scan supports files up to 7 MB." : "Select this attachment again to scan it."} busy={scanBusy} error={scanError} result={scanResult} onScan={(retry) => void runMedicalSmartScan(retry)}/>}{editor.file && !editor.removeFile && !editor.fileUpload && <button type="button" className="medical-remove-file" onClick={() => { setEditor({ ...editor, removeFile: true }); setScanResult(null); setScanError(""); }}><X size={12}/> Remove current file</button>}{editor.removeFile && <button type="button" className="medical-undo-file" onClick={() => { setEditor({ ...editor, removeFile: false }); setScanResult(null); setScanError(""); }}>Keep current file</button>}</div>
      <div className="medical-form-section"><h3>Optional details <small>{editor.recordType}</small></h3><div className="medical-form-grid">{isClinicalType(editor.recordType) && <label className="medical-field medical-field-wide"><span>Diagnosis / Reason for Visit</span><input maxLength={400} value={editor.diagnosis} onChange={(event) => setEditor({ ...editor, diagnosis: event.target.value })} placeholder="Optional"/><SmartScanFieldNote field={scanResult?.fields.diagnosis} currentValue={editor.diagnosis} onApply={(value) => applyScanSuggestion("diagnosis", value)}/></label>}{isTestType(editor.recordType) && <><label className="medical-field"><span>Test Name</span><input maxLength={180} value={editor.testName} onChange={(event) => setEditor({ ...editor, testName: event.target.value })} placeholder="e.g. Complete blood count"/><SmartScanFieldNote field={scanResult?.fields.testName} currentValue={editor.testName} onApply={(value) => applyScanSuggestion("testName", value)}/></label><label className="medical-field"><span>Test Result Summary</span><input maxLength={600} value={editor.testResult} onChange={(event) => setEditor({ ...editor, testResult: event.target.value })} placeholder="Brief summary (optional)"/><SmartScanFieldNote field={scanResult?.fields.testResult} currentValue={editor.testResult} onApply={(value) => applyScanSuggestion("testResult", value)}/></label></>}{editor.recordType === "Prescription" && <label className="medical-field medical-field-wide"><span>Prescription / Medication Notes</span><textarea rows={3} maxLength={2000} value={editor.medicationNotes} onChange={(event) => setEditor({ ...editor, medicationNotes: event.target.value })} placeholder="Medication, dosage, or instructions (optional)"/><SmartScanFieldNote field={scanResult?.fields.medicationNotes} currentValue={editor.medicationNotes} onApply={(value) => applyScanSuggestion("medicationNotes", value)}/></label>}{isFollowUpType(editor.recordType) && <label className="medical-field"><span>Follow-up Date</span><input type="date" value={editor.followUpDate} onChange={(event) => setEditor({ ...editor, followUpDate: event.target.value })}/><SmartScanFieldNote field={scanResult?.fields.followUpDate} currentValue={editor.followUpDate} onApply={(value) => applyScanSuggestion("followUpDate", value)}/></label>}<label className="medical-field"><span>Related Reminder</span><select value={editor.relatedReminderId || ""} onChange={(event) => setEditor({ ...editor, relatedReminderId: event.target.value })}><option value="">No reminder linked</option>{reminderItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div></div>
      <div className="medical-form-section"><h3>Link existing Persora records <small>References only — original files are not copied.</small></h3><label className="medical-link-search"><Search size={13}/><input value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="Find contacts, reminders or documents"/></label><div className="medical-link-picker">{selectableLinks.map((entry) => { const chosen = editor.links.some((link) => linkKey(link) === `${entry.recordType}:${entry.recordId}`); return <label className={chosen ? "selected" : ""} key={`${entry.recordType}:${entry.recordId}`}><input type="checkbox" checked={chosen} onChange={() => { const links = editor.links.filter((link) => linkKey(link) !== `${entry.recordType}:${entry.recordId}`); if (!chosen) links.push({ recordType: entry.recordType, recordId: entry.recordId, linkKind: "related" }); setEditor({ ...editor, links }); }}/><span><b>{entry.title}</b><small>{entry.subtitle}</small></span>{chosen && <Check size={14}/>}</label>; })}{!selectableLinks.length && <span className="medical-picker-empty">No contacts or records found.</span>}</div><p className="medical-link-note"><Link2 size={12}/> A reference to the existing record is saved; attached documents are not duplicated.</p></div>
      <div className="medical-private-foot"><LockKeyhole size={13}/> {demoMode ? "Demo data remains in session memory. Linked records are references only." : "Private to your account. Linked files and records are references only; original files are not copied."}</div></div><footer className="medical-modal-footer"><button type="button" className="medical-secondary" onClick={() => setEditor(null)} disabled={saving}>Cancel</button><button className="medical-primary" type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15}/>{editor.id ? "Save changes" : "Save medical record"}</>}</button></footer></form></section></div></ModalPortal>}

    {detail && <ModalPortal><div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="medical-detail-modal" role="dialog" aria-modal="true" aria-labelledby="medical-detail-title"><header className="medical-modal-header"><div><span>{detail.recordType.toUpperCase()}</span><h2 id="medical-detail-title">{detail.title}</h2></div><button onClick={() => setDetail(null)} aria-label="Close"><X size={18}/></button></header><div className="medical-detail-body"><div className="medical-detail-date"><CalendarDays size={15}/>{formatDate(detail.recordDate)}</div><div className="medical-detail-grid">{[["Doctor / Healthcare Provider", detail.provider], ["Hospital / Clinic", detail.hospital], ["Medical Specialty", detail.specialty], ["Diagnosis / Reason", detail.diagnosis], ["Test Name", detail.testName], ["Test Result Summary", detail.testResult], ["Medication Notes", detail.medicationNotes], ["Follow-up Date", detail.followUpDate ? formatDate(detail.followUpDate) : ""]].filter(([, value]) => value).map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>{detail.notes && <div className="medical-detail-notes"><small>Notes</small><p>{detail.notes}</p></div>}{detail.file && <section className="detail-attachment-preview"><div className="detail-file"><div className="detail-file-icon"><FileText size={20}/></div><div className="detail-file-copy"><b>{filePreview?.name || detail.file.name}</b><small>{detail.file.size ? `${(detail.file.size / 1024 / 1024).toFixed(2)} MB` : "Attached file"} · Stored privately in your vault</small></div><button type="button" className="outline-action-button" onClick={() => onOpenFile(detail)}><Download size={15}/> Download</button></div><div className="detail-preview-stage">{!filePreview || filePreview.status === "loading" ? <div className="detail-preview-message"><span className="spinner dark-spinner"/><b>Opening private attachment…</b></div> : filePreview.status === "error" || filePreview.status === "unavailable" ? <div className="detail-preview-message"><FileText size={24}/><b>{filePreview.message || "This attachment could not be previewed."}</b></div> : filePreview.type?.startsWith("image/") && filePreview.src ? <ImagePreview src={filePreview.src} name={filePreview.name}/> : (filePreview.type === "application/pdf" || filePreview.name.toLowerCase().endsWith(".pdf")) && filePreview.src ? <PdfPreview src={filePreview.src} name={filePreview.name}/> : filePreview.type?.startsWith("video/") && filePreview.src ? <video className="detail-preview-media" src={filePreview.src} controls /> : filePreview.type?.startsWith("audio/") && filePreview.src ? <audio className="detail-preview-audio" src={filePreview.src} controls /> : <div className="detail-preview-message"><FileText size={24}/><b>Preview isn’t supported for this file type in your browser.</b><span>Download it to open with a compatible app.</span></div>}</div></section>}{linkedRecordSummary(detail).length > 0 && <div className="medical-detail-links"><small>Linked Persora records</small>{linkedRecordSummary(detail).map((label) => <span key={label}><Link2 size={12}/>{label}</span>)}</div>}</div><footer className="medical-modal-footer"><button className="medical-danger-quiet" onClick={() => setDeleteTarget(detail)}><Trash2 size={14}/> Delete</button><button className="medical-primary" onClick={() => startEdit(detail)}><Pencil size={14}/> Edit record</button></footer></section></div></ModalPortal>}

    {deleteTarget && <ModalPortal><div className="medical-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><section className="medical-delete-dialog" role="alertdialog" aria-modal="true"><span><Trash2 size={18}/></span><h2>Delete medical record?</h2><p>“{deleteTarget.title}” and its attached copy will be removed. Linked Persora records will remain unchanged.</p><div><button className="medical-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="medical-danger" onClick={() => void confirmDelete()}>Delete record</button></div></section></div></ModalPortal>}
  </div>;
}
