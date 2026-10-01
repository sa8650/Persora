import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AlarmClock, ArrowRight, ArrowUpRight, BellRing, Bold, CalendarDays, Check, Download, FileImage, FileText, Italic, List, ListOrdered, ListTodo, LockKeyhole, MessageSquare, Music2, Paperclip, Pause, Play, RemoveFormatting, Send, Share2, ShieldCheck, Strikethrough, Trash2, Underline, UploadCloud, X } from "lucide-react";
import { SECTION_BY_ID } from "../data";
import QRPreview from "./QRPreview";
import { TransferProgressIndicator } from "./ProgressIndicator";
import type { AlarmRingtone, FieldDefinition, NotesRecordKind, SectionId, ShareComment, SharePermission, SharedItemAccess, SharedVaultEntry, VaultFile, VaultFilePreview, VaultItem, TransferProgress } from "../types";
import { daysUntil, formatDate, formatRelativeDate, humanSize, makeVCard, sanitizeNoteHtml } from "../lib/utils";
import { alarmRingtoneAudioPath, loadAlarmRingtones } from "../lib/cloud";
import { BUILTIN_RINGTONES, startBuiltinRingtone } from "../lib/ringtone";

interface ItemEditorDialogProps {
  sectionId: SectionId;
  item?: VaultItem;
  documentTypes?: string[];
  maxUploadMb?: number;
  onClose: () => void;
  onSave: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null }, onProgress?: (progress: TransferProgress) => void) => Promise<void>;
}

const detailColors: Record<SectionId, string> = { notes: "tag-yellow", documents: "tag-blue", academics: "tag-violet", subscriptions: "tag-orange", family: "tag-rose", purchases: "tag-teal", accounts: "tag-indigo", memberships: "tag-green", study: "tag-sky", "business-card": "tag-slate", urls: "tag-cyan" };

export function ItemEditorDialog({ sectionId, item, documentTypes = [], maxUploadMb = 25, onClose, onSave }: ItemEditorDialogProps) {
  const section = SECTION_BY_ID[sectionId];
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const previewUrl = useMemo(() => selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : "", [selectedFile]);

  useEffect(() => {
    const initial: Record<string, string> = {};
    section.fields.forEach((field) => { initial[field.key] = field.key === "title" ? item?.title || "" : item?.metadata[field.key] || ""; });
    setValues(initial);
  }, [item, section]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const acceptFile = (file?: File) => {
    if (!file) return;
    const maxFileSize = Math.max(1, Number(maxUploadMb) || 25) * 1024 * 1024;
    if (file.size > maxFileSize) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError("");
    setSelectedFile(file);
    setRemoveFile(false);
  };

  const selectedType = (values.type || "").trim().toLowerCase();
  const isCv = sectionId === "documents" && /^(cv|resume)/.test(selectedType);
  const isAdmission = sectionId === "academics" && /admission/.test(selectedType);
  const isPaymentSlip = selectedType.includes("payment slip");
  const cvKeys = new Set(["title", "type", "targetRole", "email", "phone", "location", "portfolio", "summary", "experience", "education", "skills", "notes"]);
  const cvOnlyKeys = new Set(["targetRole", "email", "phone", "location", "portfolio", "summary", "experience", "education", "skills"]);
  const admissionKeys = new Set(["title", "type", "institution", "program", "admissionSession", "applicationNumber", "paymentAmount", "paymentDate", "notes"]);
  const admissionOnlyKeys = new Set(["program", "admissionSession", "applicationNumber", "paymentAmount", "paymentDate"]);
  const fields = section.fields.filter((field) => {
    if (sectionId === "documents") return isCv ? cvKeys.has(field.key) : !cvOnlyKeys.has(field.key);
    if (sectionId === "academics") {
      if (isAdmission) return admissionKeys.has(field.key) && (isPaymentSlip || !["paymentAmount", "paymentDate"].includes(field.key));
      return !admissionOnlyKeys.has(field.key);
    }
    return true;
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = values.title?.trim();
    if (!title) { setError(`${section.titleLabel} is required.`); return; }
    setSaving(true);
    setError("");
    setUploadProgress(selectedFile ? { loaded: 0, total: selectedFile.size, percent: 0, remainingSeconds: null } : null);
    const visibleKeys = new Set(fields.map((field) => field.key));
    const metadata: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => { if (key !== "title" && visibleKeys.has(key) && value.trim()) metadata[key] = value.trim(); });
    const file: VaultFile | undefined = selectedFile ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, localOnly: true } : removeFile ? undefined : item?.file;
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        section: sectionId,
        title,
        metadata,
        file,
        favorite: item?.favorite,
        pinned: item?.pinned,
        sharedAccess: item?.sharedAccess,
        fileUpload: selectedFile,
      }, setUploadProgress);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn't save this record. Please try again.");
      setSaving(false); setUploadProgress(null);
    }
  };

  const renderInput = (field: FieldDefinition) => {
    const value = values[field.key] || "";
    const common = { id: `field-${field.key}`, value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(field.key, event.target.value), required: field.required };
    if (field.kind === "select") {
      const options = sectionId === "documents" && field.key === "type"
        ? [...new Set([...documentTypes, "CV / Resume", ...(value && !documentTypes.includes(value) ? [value] : [])])]
        : field.options || [];
      return <select {...common}><option value="">Choose one…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
    }
    if (sectionId === "notes" && field.key === "content") return <RichNoteEditor key={`${item?.id || "new"}-${sectionId}`} id={common.id} value={value} onChange={(next) => setValue(field.key, next)} />;
    if (field.kind === "textarea") return <textarea {...common} rows={3} placeholder={field.placeholder || "Add a few helpful details…"} />;
    const type = field.kind === "number" ? "number" : field.kind;
    return <input {...common} type={type} placeholder={field.placeholder || ""} />;
  };

  return <div className={`modal-backdrop ${section.id === "notes" ? "notes-editor-backdrop" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className={`editor-dialog ${section.id === "notes" ? "notes-editor-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="editor-dialog-head"><div className={`editor-icon ${section.id}`}><section.icon size={19} /></div><div><span className="section-eyebrow">{isCv ? "Career profile" : isAdmission ? "Education record" : item ? "Edit your record" : `Add to ${section.label.toLowerCase()}`}</span><h2 id="editor-title">{isCv ? item ? "Update your CV / Resume." : "Add a CV / Resume." : isAdmission ? item ? "Update admission details." : "Add an admission record." : item ? "Make a quick update." : `Add a ${section.singular}.`}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div>
      <p className="editor-intro">{isCv ? "Add your career details and attach a current CV. Identity numbers and expiry dates aren't needed here." : isAdmission ? "Keep the admission, application and payment details together. Grade and passing-year fields are hidden for this record type." : "A few details now make it easier to find later. Everything you add is just for you."}</p>
      <form className="editor-form" onSubmit={submit}>
        <div className="editor-fields-grid">{fields.map((field) => <label key={field.key} className={`field-label ${field.wide || field.kind === "textarea" ? "field-wide" : ""}`} htmlFor={`field-${field.key}`}>{isCv && field.key === "title" ? "CV / Resume title" : field.label}{field.required && <span className="required-star">*</span>}{renderInput(field)}</label>)}</div>
        <div className="upload-field-block"><div className="upload-field-title"><span>Attach a file <small>Optional · PDF, photo or document</small></span><span className="upload-lock"><LockKeyhole size={12} /> Private</span></div>
          {selectedFile ? <div className="upload-preview-row">{previewUrl ? <img src={previewUrl} alt="Selected file preview" className="upload-image-preview" /> : <span className="upload-file-icon"><FileText size={20} /></span>}<span className="upload-preview-name"><b>{selectedFile.name}</b><small>{humanSize(selectedFile.size)} · Ready to upload</small></span><button type="button" className="plain-icon upload-remove" onClick={() => setSelectedFile(null)} aria-label="Remove selected file"><X size={16} /></button></div> : item?.file && !removeFile ? <div className="upload-preview-row existing-file-row"><span className="upload-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={19} /> : <FileText size={19} />}</span><span className="upload-preview-name"><b>{item.file.name}</b><small>{humanSize(item.file.size)} · Saved in your vault</small></span><button type="button" className="upload-replace" onClick={() => document.getElementById("vault-file-input")?.click()}>Replace</button><button type="button" className="plain-icon upload-remove" onClick={() => setRemoveFile(true)} aria-label="Remove attachment"><X size={16} /></button></div> : <label htmlFor="vault-file-input" className={`file-dropzone ${dragging ? "file-dropzone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}>
            <span className="upload-circle"><UploadCloud size={19} /></span><span className="dropzone-copy"><b>Choose a file or drop it here</b><small>PDF, PNG, JPG or document · up to {maxUploadMb} MB</small></span><span className="browse-button">Browse files</span></label>}
          <input className="hidden-file-input" id="vault-file-input" type="file" onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" />
        </div>
        {uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Uploading file" detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}/>}
        {error && <div className="form-alert error-alert editor-error" role="alert">{error}</div>}
        <div className="editor-form-footer"><div className="editor-footnote"><ShieldCheck size={14} /><span>Private to your Persora account</span></div><div className="editor-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="editor-submit" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : <>{item ? "Save changes" : "Save to vault"}<Check size={15} /></>}</button></div></div>
      </form>
    </section>
  </div>;
}

function RingtonePreviewButton({ ringtoneId }: { ringtoneId: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);
  const stop = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    audioRef.current?.pause(); audioRef.current = null;
    stopRef.current?.(); stopRef.current = null;
    setPlaying(false);
  };
  useEffect(() => () => { audioRef.current?.pause(); stopRef.current?.(); if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);
  const preview = async () => {
    if (playing) { stop(); return; }
    setPlaying(true);
    try {
      if (ringtoneId.startsWith("builtin-")) stopRef.current = startBuiltinRingtone(ringtoneId);
      else {
        const audio = new Audio(alarmRingtoneAudioPath(ringtoneId));
        audioRef.current = audio; audio.volume = 0.65;
        audio.addEventListener("ended", stop, { once: true });
        await audio.play();
      }
      timerRef.current = window.setTimeout(stop, 2500);
    } catch { stop(); }
  };
  return <button type="button" className="ringtone-preview-button" onClick={() => void preview()} aria-label={playing ? "Stop ringtone preview" : "Preview ringtone"}>{playing ? <Pause size={15}/> : <Play size={15}/>}<span>{playing ? "Stop" : "Preview"}</span></button>;
}

const WEEKDAYS = [{ id: "0", label: "Sun" }, { id: "1", label: "Mon" }, { id: "2", label: "Tue" }, { id: "3", label: "Wed" }, { id: "4", label: "Thu" }, { id: "5", label: "Fri" }, { id: "6", label: "Sat" }];
function localDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TodoEditorDialog({ kind = "todo", item, onClose, onSave }: { kind?: NotesRecordKind; item?: VaultItem; onClose: () => void; onSave: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) => Promise<void> }) {
  const [title, setTitle] = useState(item?.title || "");
  const [details, setDetails] = useState(item?.metadata.todoDetails || "");
  const [dueDate, setDueDate] = useState(item?.metadata.dueDate || "");
  const [reminderAt, setReminderAt] = useState(localDateTimeInput(item?.metadata.reminderAt));
  const [alarmDate, setAlarmDate] = useState(item?.metadata.alarmDate || "");
  const [alarmTime, setAlarmTime] = useState(item?.metadata.alarmTime || "08:00");
  const [repeatDays, setRepeatDays] = useState<string[]>(() => (item?.metadata.repeatDays || "").split(",").filter(Boolean));
  const [ringtoneId, setRingtoneId] = useState(item?.metadata.ringtoneId || "builtin-soft");
  const [ringtones, setRingtones] = useState<AlarmRingtone[]>([]);
  const [ringtonesLoaded, setRingtonesLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const toggleRepeat = (day: string) => setRepeatDays((days) => days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day].sort());
  useEffect(() => { let active = true; void loadAlarmRingtones().then((entries) => { if (active) { setRingtones(entries); setRingtonesLoaded(true); } }).catch(() => { if (active) { setRingtones([]); setRingtonesLoaded(true); } }); return () => { active = false; }; }, []);
  useEffect(() => { if (ringtonesLoaded && !BUILTIN_RINGTONES.some((tone) => tone.id === ringtoneId) && !ringtones.some((tone) => tone.id === ringtoneId)) setRingtoneId(BUILTIN_RINGTONES[0].id); }, [ringtonesLoaded, ringtones, ringtoneId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) { setError(`Add a ${kind === "todo" ? "task" : kind} title first.`); return; }
    if (kind === "reminder" && (!reminderAt || Number.isNaN(new Date(reminderAt).getTime()))) { setError("Choose when you want to be reminded."); return; }
    if (kind === "alarm" && (!alarmTime || (!repeatDays.length && !alarmDate))) { setError("Choose an alarm time and either a date or repeat days."); return; }
    if (kind === "alarm" && !repeatDays.length) {
      const scheduledAt = new Date(`${alarmDate}T${alarmTime}`);
      if (Number.isNaN(scheduledAt.getTime())) { setError("Choose a valid alarm date and time."); return; }
      const oldAt = item?.metadata.alarmDate ? new Date(`${item.metadata.alarmDate}T${item.metadata.alarmTime || "00:00"}`).getTime() : 0;
      if (scheduledAt.getTime() <= Date.now() && (!item || scheduledAt.getTime() !== oldAt)) { setError("Choose a future date and time for this alarm."); return; }
    }
    if (kind === "reminder" && new Date(reminderAt).getTime() <= Date.now() && !item) { setError("Choose a future time for this reminder."); return; }
    setSaving(true); setError("");
    const selectedRingtoneId = BUILTIN_RINGTONES.some((tone) => tone.id === ringtoneId) || ringtones.some((tone) => tone.id === ringtoneId) ? ringtoneId : BUILTIN_RINGTONES[0].id;
    const selectedRingtoneName = BUILTIN_RINGTONES.find((tone) => tone.id === selectedRingtoneId)?.name || ringtones.find((tone) => tone.id === selectedRingtoneId)?.name || BUILTIN_RINGTONES[0].name;
    const metadata: Record<string, string> = { recordType: kind, enabled: item?.metadata.enabled === "false" ? "false" : "true", ringtoneId: selectedRingtoneId, ringtoneName: selectedRingtoneName, ...(details.trim() ? { todoDetails: details.trim() } : {}) };
    if (kind === "todo") { metadata.completed = item?.metadata.completed === "true" ? "true" : "false"; if (dueDate) metadata.dueDate = dueDate; }
    if (kind === "reminder") metadata.reminderAt = new Date(reminderAt).toISOString();
    if (kind === "alarm") { metadata.alarmTime = alarmTime; if (repeatDays.length) metadata.repeatDays = repeatDays.join(","); else metadata.alarmDate = alarmDate; }
    try {
      await onSave({ ...(item?.id ? { id: item.id } : {}), section: "notes", title: title.trim(), metadata, favorite: item?.favorite, pinned: false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Couldn't save this ${kind}.`); setSaving(false); }
  };
  const heading = kind === "todo" ? "task" : kind;
  return <div className="modal-backdrop todo-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className="editor-dialog todo-editor-dialog schedule-editor-dialog todo-editor-drawer" role="dialog" aria-modal="true" aria-labelledby="todo-editor-title">
      <div className="editor-dialog-head"><div className="editor-icon notes">{kind === "alarm" ? <AlarmClock size={19}/> : kind === "reminder" ? <BellRing size={19}/> : <Check size={19}/>}</div><div><span className="section-eyebrow">Tasks &amp; Notes</span><h2 id="todo-editor-title">{item ? `Update this ${heading}.` : `Add a ${heading}.`}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close editor" disabled={saving}><X size={18}/></button></div>
      <p className="editor-intro">{kind === "alarm" ? "Set a time to ring. Repeating alarms run on the selected days while Persora is open." : kind === "reminder" ? "Choose a date and time. Persora can alert you while you are using the app." : "Keep one next step clear. Tasks stay with your private notes."}</p>
      <form className="editor-form todo-editor-form" onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="todo-title">{kind === "todo" ? "Task title" : kind === "alarm" ? "Alarm name" : "Reminder title"}<span className="required-star">*</span><input id="todo-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} required placeholder={kind === "todo" ? "e.g. Send the application form" : kind === "alarm" ? "e.g. Morning alarm" : "e.g. Call the clinic"} autoFocus/></label>
        {kind === "todo" && <label className="field-label" htmlFor="todo-due-date">Due date <small>Optional</small><input id="todo-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)}/></label>}
        {kind === "reminder" && <label className="field-label" htmlFor="reminder-at">Remind me at <span className="required-star">*</span><input id="reminder-at" type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} required/></label>}
        {kind === "alarm" && <><label className="field-label" htmlFor="alarm-time">Alarm time <span className="required-star">*</span><input id="alarm-time" type="time" value={alarmTime} onChange={(event) => setAlarmTime(event.target.value)} required/></label><label className="field-label" htmlFor="alarm-date">One-time date <small>Leave blank if it repeats</small><input id="alarm-date" type="date" value={alarmDate} onChange={(event) => setAlarmDate(event.target.value)} disabled={repeatDays.length > 0}/></label><div className="field-label schedule-repeat-field">Repeat days <small>Optional</small><div className="schedule-repeat-days">{WEEKDAYS.map((day) => <button type="button" key={day.id} className={repeatDays.includes(day.id) ? "selected" : ""} aria-pressed={repeatDays.includes(day.id)} onClick={() => toggleRepeat(day.id)}>{day.label}</button>)}</div></div></>}
        {kind !== "todo" && <div className="ringtone-picker-row"><label className="field-label" htmlFor="schedule-ringtone"><span><Music2 size={14}/> Ringtone</span><select id="schedule-ringtone" value={ringtoneId} onChange={(event) => setRingtoneId(event.target.value)}><optgroup label="Persora tones">{BUILTIN_RINGTONES.map((tone) => <option key={tone.id} value={tone.id}>{tone.name}</option>)}</optgroup>{ringtones.length > 0 && <optgroup label="More ringtones">{ringtones.map((tone) => <option key={tone.id} value={tone.id}>{tone.name}</option>)}</optgroup>}</select></label><RingtonePreviewButton ringtoneId={ringtoneId}/></div>}
        {kind !== "todo" && <p className="ringtone-help-note">Rings with sound while Persora is open. Browser alarms can’t play after the page is fully closed.</p>}
        <label className="field-label todo-details-field" htmlFor="todo-details">Details <small>Optional</small><textarea id="todo-details" value={details} onChange={(event) => setDetails(event.target.value)} rows={4} maxLength={5000} placeholder="Add a little context…"/></label>
        {error && <div className="form-alert error-alert" role="alert">{error}</div>}
        <div className="editor-form-footer"><div className="editor-footnote"><ShieldCheck size={14}/><span>Private to your Persora account</span></div><div className="editor-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="editor-submit" disabled={saving}>{saving ? <><span className="spinner"/> Saving…</> : <>{item ? `Save ${heading}` : `Add ${heading}`}<Check size={15}/></>}</button></div></div>
      </form>
    </section>
  </div>;
}

function RichNoteEditor({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const touchedRef = useRef(false);
  const savedRangeRef = useRef<Range | null>(null);
  useEffect(() => { if (!touchedRef.current && editorRef.current) editorRef.current.innerHTML = sanitizeNoteHtml(value); }, [value]);
  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (editor && selection?.rangeCount && editor.contains(selection.anchorNode)) savedRangeRef.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (!selection || !savedRangeRef.current || !editorRef.current?.contains(savedRangeRef.current.commonAncestorContainer)) return;
    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current);
  };
  const sync = () => { if (editorRef.current) { touchedRef.current = true; onChange(sanitizeNoteHtml(editorRef.current.innerHTML)); saveSelection(); } };
  const command = (name: string, value?: string) => {
    restoreSelection();
    document.execCommand(name, false, value);
    sync();
  };
  const insertChecklist = () => {
    restoreSelection();
    document.execCommand("insertHTML", false, '<ul><li><input type="checkbox"> New task</li><li><input type="checkbox"> Another task</li></ul><p><br></p>');
    sync();
  };
  const insertTextAtSelection = (text: string) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const toggleTask = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    if (target.checked) target.setAttribute("checked", ""); else target.removeAttribute("checked");
    sync();
  };
  const pastePlainText = (event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!document.execCommand("insertText", false, text)) insertTextAtSelection(text);
    sync();
  };
  return <div className="rich-note-editor">
    <div className="rich-note-toolbar" role="toolbar" aria-label="Note formatting">
      <button type="button" title="Bold" aria-label="Bold" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("bold")}><Bold size={15}/></button>
      <button type="button" title="Italic" aria-label="Italic" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("italic")}><Italic size={15}/></button>
      <button type="button" title="Underline" aria-label="Underline" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("underline")}><Underline size={15}/></button>
      <button type="button" title="Strikethrough" aria-label="Strikethrough" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("strikeThrough")}><Strikethrough size={15}/></button>
      <span/>
      <button type="button" title="Bulleted list" aria-label="Bulleted list" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("insertUnorderedList")}><List size={15}/></button>
      <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("insertOrderedList")}><ListOrdered size={15}/></button>
      <button type="button" title="Checklist" aria-label="Insert checklist" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={insertChecklist}><ListTodo size={15}/></button>
      <button type="button" title="Clear formatting" aria-label="Clear formatting" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => command("removeFormat")}><RemoveFormatting size={15}/></button>
    </div>
    <div id={id} ref={editorRef} className="rich-note-content" contentEditable role="textbox" aria-multiline="true" aria-label="Note content" data-placeholder="Write a note… Format it, add lists, or make a checklist." onInput={sync} onClick={toggleTask} onPaste={pastePlainText} onKeyUp={saveSelection} onMouseUp={saveSelection} onFocus={saveSelection}/>
    <div className="rich-note-hint">Use the toolbar for formatting and checklists.</div>
  </div>;
}

export function ItemDetailDialog({ item, filePreview, shareAccess, comments = [], onClose, onEdit, onDownloadFile, onManageSharing, onAddComment }: { item: VaultItem; filePreview?: VaultFilePreview | null; shareAccess?: SharedItemAccess; comments?: ShareComment[]; onClose: () => void; onEdit: () => void; onDownloadFile: () => void; onManageSharing?: () => void; onAddComment?: (body: string) => Promise<void> }) {
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState("");
  const section = SECTION_BY_ID[item.section];
  const dateKey = section.dateKey;
  const dateValue = dateKey ? item.metadata[dateKey] : undefined;
  const days = daysUntil(dateValue);
  const isTodoItem = item.section === "notes" && item.metadata.recordType === "todo";
  const displayEntries = Object.entries(item.metadata).filter(([key, value]) => Boolean(value) && key !== "notes" && !(item.section === "notes" && key === "content") && !(isTodoItem && ["recordType", "completed", "todoDetails", "dueDate"].includes(key)));
  const formattedKey = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^\w/, (letter) => letter.toUpperCase());
  const note = isTodoItem ? item.metadata.todoDetails : item.section === "notes" ? item.metadata.content : item.metadata.notes;
  const qrValue = item.section === "memberships"
    ? [`PERSORA MEMBERSHIP`, item.title, item.metadata.organization, `Member ID: ${item.metadata.memberId || "not provided"}`, `Level: ${item.metadata.level || "not provided"}`, `Expires: ${item.metadata.expiryDate || "not provided"}`].filter(Boolean).join("\n")
    : item.section === "business-card"
      ? makeVCard(item)
      : item.section === "urls" && item.metadata.url
        ? (item.metadata.url.startsWith("http") ? item.metadata.url : `https://${item.metadata.url}`)
        : "";
  const qrHeading = item.section === "memberships" ? "Digital membership card" : item.section === "business-card" ? "Contact card QR" : "Quick-access QR";
  const qrNote = item.section === "memberships" ? "Scan to read the card details shown here." : item.section === "business-card" ? "Scan to save these details as a contact." : "Scan to open this saved link.";
  const canEdit = !shareAccess || shareAccess.direction === "outgoing" || shareAccess.permission === "edit";
  const canComment = Boolean(shareAccess && (shareAccess.direction === "outgoing" || shareAccess.permission === "comment" || shareAccess.permission === "edit"));
  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commentDraft.trim() || !onAddComment) return;
    setCommentSending(true); setCommentError("");
    try { await onAddComment(commentDraft.trim()); setCommentDraft(""); }
    catch (error) { setCommentError(error instanceof Error ? error.message : "Couldn't post this comment."); }
    finally { setCommentSending(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="detail-banner"><div className="detail-banner-pattern"/><div className={`detail-icon ${detailColors[item.section]}`}><section.icon size={22} /></div><button className="icon-button detail-close" onClick={onClose} aria-label="Close details"><X size={18} /></button><div className="detail-banner-title"><span>{section.eyebrow}</span><h2 id="detail-title">{item.title}</h2>{item.subtitle && <p>{item.subtitle}</p>}</div><div className="detail-private-pill">{shareAccess ? <><Share2 size={12} /> {shareAccess.direction === "incoming" ? `SHARED BY ${shareAccess.owner.fullName}` : `SHARED WITH ${shareAccess.recipient.fullName}`}</> : <><LockKeyhole size={12} /> YOUR PRIVATE VAULT</>}</div></div>
      <div className="detail-body"><div className="detail-meta-strip"><span><CalendarDays size={13} /> Added {formatDate(item.createdAt)}</span><span className="detail-updated">Updated {formatRelativeDate(item.updatedAt.slice(0, 10))}</span>{dateValue && <span className={`detail-date-status ${days !== null && days >= 0 && days <= 30 ? "detail-date-soon" : ""}`}><span />{days !== null && days >= 0 && days <= 30 ? `${days === 0 ? "Due today" : `Due in ${days} days`} · ` : ""}{formatDate(dateValue)}</span>}</div>
        {isTodoItem && <div className="detail-fields-grid"><div className="detail-field"><span>Status</span><b>{item.metadata.completed === "true" ? "Completed" : "Active"}</b></div>{item.metadata.dueDate && <div className="detail-field"><span>Due date</span><b>{formatDate(item.metadata.dueDate)}</b></div>}</div>}
        {displayEntries.length ? <div className="detail-fields-grid">{displayEntries.map(([key, value]) => <div className="detail-field" key={key}><span>{formattedKey(key)}</span><b>{key.toLowerCase().includes("date") || key.toLowerCase().includes("expiry") || key.toLowerCase().includes("renewal") ? formatDate(value) : value}</b></div>)}</div> : <div className="detail-no-meta">No extra details have been added.</div>}
        {note && <div className="detail-notes"><span>{item.section === "notes" ? "Note" : "Notes"}</span>{item.section === "notes" ? <div className="rich-note-rendered" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note, true) }} /> : <p>{note}</p>}</div>}
        {qrValue && <div className="detail-qr-card"><div className="detail-qr-copy"><span className="qr-card-label"><span /> ON-DEVICE QR</span><h3>{qrHeading}</h3><p>{qrNote}</p><small><LockKeyhole size={12} /> Generated on this device</small></div><div className="detail-qr-image"><QRPreview value={qrValue} size={76} /></div></div>}
        {item.file && <section className="detail-attachment-preview"><div className="detail-file"><div className="detail-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}</div><div className="detail-file-copy"><b>{filePreview?.name || item.file.name}</b><small>{humanSize(item.file.size)} · {item.file.localOnly ? "This device" : "Stored privately in Cloudflare R2"}</small></div><button className="outline-action-button" onClick={onDownloadFile}><Download size={15} /> Download</button></div><div className="detail-preview-stage">
          {!filePreview || filePreview.status === "loading" ? <div className="detail-preview-message"><span className="spinner dark-spinner"/><b>Opening private attachment…</b></div> : filePreview.status === "unavailable" || filePreview.status === "error" ? <div className="detail-preview-message"><FileText size={25}/><b>{filePreview.message || "This attachment could not be previewed."}</b></div> : filePreview.type?.startsWith("image/") && filePreview.src ? <img className="detail-preview-image" src={filePreview.src} alt={filePreview.name} /> : (filePreview.type === "application/pdf" || filePreview.name.toLowerCase().endsWith(".pdf")) && filePreview.src ? <iframe className="detail-preview-pdf" src={filePreview.src} title={`Preview of ${filePreview.name}`} /> : filePreview.type?.startsWith("video/") && filePreview.src ? <video className="detail-preview-media" src={filePreview.src} controls /> : filePreview.type?.startsWith("audio/") && filePreview.src ? <audio className="detail-preview-audio" src={filePreview.src} controls /> : <div className="detail-preview-message"><FileText size={25}/><b>Preview isn’t supported for this file type in your browser.</b><span>Use Download to open it with a compatible app. Your file remains private.</span></div>}
        </div></section>}
        {shareAccess && <section className="shared-comments"><div className="shared-comments-heading"><span><MessageSquare size={15}/></span><div><b>Comments</b><small>{shareAccess.direction === "incoming" ? `Shared by ${shareAccess.owner.fullName}` : `Shared with ${shareAccess.recipient.fullName}`} · {shareAccess.permission} access</small></div></div><div className="shared-comment-list">{comments.length ? comments.map((comment) => <article className="shared-comment" key={comment.id}><div><b>{comment.authorName}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.body}</p></article>) : <p className="comments-empty">No comments yet.</p>}</div>{canComment && <form className="shared-comment-form" onSubmit={(event) => void submitComment(event)}><textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={5000} rows={2} placeholder="Add a comment…" required/><button className="editor-submit" disabled={commentSending || !commentDraft.trim()}>{commentSending ? "Posting…" : <>Comment <Send size={14}/></>}</button>{commentError && <span className="form-alert error-alert">{commentError}</span>}</form>}{!canComment && <p className="comments-view-only">Your View access allows you to read comments.</p>}</section>}
      </div><div className="detail-footer"><span><ShieldCheck size={14} /> {shareAccess ? "Original owner's copy stays in their vault." : "Your data belongs to you."}</span><div><button className="quiet-button" onClick={onClose}>Close</button>{(!shareAccess || shareAccess.direction === "outgoing") && onManageSharing && <button className="quiet-button share-detail-button" onClick={onManageSharing}><Share2 size={14}/> Manage sharing</button>}{canEdit && <button className="editor-submit" onClick={onEdit}>Edit details <ArrowUpRight size={14} /></button>}</div></div>
    </section>
  </div>;
}

export function ShareManagementDialog({ item, shares, available, onShare, onPermissionChange, onRevoke, onClose }: { item: VaultItem; shares: SharedVaultEntry[]; available: boolean; onShare: (recipient: string, permission: SharePermission) => Promise<void>; onPermissionChange: (shareId: string, permission: SharePermission) => Promise<void>; onRevoke: (shareId: string) => Promise<void>; onClose: () => void }) {
  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [busy, setBusy] = useState(false);
  const [busyShare, setBusyShare] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipient.trim()) return;
    setBusy(true); setError("");
    try { await onShare(recipient.trim(), permission); setRecipient(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't share this document."); }
    finally { setBusy(false); }
  };
  const update = async (shareId: string, action: () => Promise<void>) => {
    setBusyShare(shareId); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't update sharing access."); }
    finally { setBusyShare(""); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
    <div className="share-dialog-head"><span className="share-dialog-icon"><Share2 size={19}/></span><div><span className="section-eyebrow">Document access</span><h2 id="share-dialog-title">Share “{item.title}”</h2></div><button className="icon-button" onClick={onClose} aria-label="Close share dialog"><X size={18}/></button></div>
    <p className="share-dialog-intro">Invite a registered Persora member. The original file stays in your vault, even when someone edits it.</p>
    {!available && <div className="share-backend-notice"><ShieldCheck size={16}/><span>Sharing needs a signed-in account with Persora's cloud API enabled.</span></div>}
    <form className="share-invite-form" onSubmit={(event) => void submit(event)}><label className="field-label">Email address or seven-digit Persora ID<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.com or 1234567" autoComplete="off" disabled={!available || busy}/></label><label className="field-label">Permission<select value={permission} onChange={(event) => setPermission(event.target.value as SharePermission)} disabled={!available || busy}><option value="view">View · read and download</option><option value="comment">Comment · view and leave comments</option><option value="edit">Edit · update the original document</option></select></label><button className="editor-submit" disabled={!available || busy || !recipient.trim()}>{busy ? "Sharing…" : <>Share document <ArrowRight size={14}/></>}</button></form>
    {error && <div className="form-alert error-alert share-modal-error" role="alert">{error}</div>}
    <div className="share-access-list"><div className="share-access-list-heading"><b>People with access</b><span>{shares.length}</span></div>{shares.length ? shares.map((share) => <div className="share-access-row" key={share.shareId}><span className="share-person-avatar">{share.recipient.fullName.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase()}</span><span className="share-access-person"><b>{share.recipient.fullName}</b><small>{share.recipient.email} · ID {share.recipient.userId}</small></span><select aria-label={`Permission for ${share.recipient.fullName}`} value={share.permission} disabled={busyShare === share.shareId} onChange={(event) => void update(share.shareId, () => onPermissionChange(share.shareId, event.target.value as SharePermission))}><option value="view">View</option><option value="comment">Comment</option><option value="edit">Edit</option></select><button className="plain-icon share-revoke-icon" disabled={busyShare === share.shareId} onClick={() => void update(share.shareId, () => onRevoke(share.shareId))} aria-label={`Stop sharing with ${share.recipient.fullName}`} title="Stop sharing"><Trash2 size={15}/></button></div>) : <div className="share-no-access">Only you can see this document right now.</div>}</div>
    <div className="share-dialog-footer"><ShieldCheck size={14}/> Access can be changed or removed at any time.</div>
  </section></div>;
}

export function ConfirmDialog({ title, children, confirmLabel = "Delete record", danger = true, onCancel, onConfirm }:  { title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><section className="confirm-dialog" role="alertdialog" aria-modal="true"><div className={`confirm-icon ${danger ? "confirm-danger" : "confirm-neutral"}`}>{danger ? <X size={19} /> : <Paperclip size={19} />}</div><button className="icon-button confirm-close" onClick={onCancel} aria-label="Close"><X size={17} /></button><h2>{title}</h2><div className="confirm-copy">{children}</div><div className="confirm-actions"><button className="quiet-button" onClick={onCancel}>Keep it</button><button className={danger ? "confirm-danger-button" : "editor-submit"} onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

export function ToastNotice({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error"; onClose: () => void }) {
  return <div className={`toast-notice ${kind === "error" ? "toast-error" : ""}`} role="status"><span className="toast-icon">{kind === "error" ? <X size={14} /> : <Check size={14} />}</span><span>{message}</span><button className="plain-icon" onClick={onClose} aria-label="Dismiss"><X size={15} /></button></div>;
}
