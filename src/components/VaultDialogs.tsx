import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AlarmClock, ArrowRight, Clock, UserCheck, ArrowUpRight, BellRing, Bold, CalendarDays, Check, Copy, Download, FileImage, FileText, Italic, List, ListOrdered, ListTodo, LockKeyhole, MessageSquare, Music2, Paperclip, Pause, Play, RemoveFormatting, Send, Share2, ShieldCheck, Strikethrough, Trash2, Underline, UploadCloud, X } from "lucide-react";
import { SECTION_BY_ID } from "../data";
import QRPreview from "./QRPreview";
import ImagePreview from "./ImagePreview";
import PdfPreview from "./PdfPreview";
import { TransferProgressIndicator } from "./ProgressIndicator";
import type { AddDocumentFlowDraft, AlarmRingtone, FieldDefinition, NotesRecordKind, SectionId, ShareComment, SharePermission, SharedItemAccess, SharedVaultEntry, SmartScanFieldDefinition, SmartScanResult, VaultFile, VaultFilePreview, VaultItem, TransferProgress } from "../types";
import { daysUntil, formatDate, formatRelativeDate, humanSize, makeVCard, sanitizeNoteHtml } from "../lib/utils";
import { alarmRingtoneAudioPath, fetchVaultFile, isPagesApiConfigured, loadAlarmRingtones, smartScanDocument } from "../lib/cloud";
import { isSmartScanFileSizeAllowed, SmartScanActionPanel, SmartScanFieldNote, supportsSmartScanFile } from "./SmartScan";
import { BUILTIN_RINGTONES, startBuiltinRingtone } from "../lib/ringtone";
import { editorFieldsFor, matchDocumentTypeSuggestion } from "../lib/editorFields";

interface ItemEditorDialogProps {
  sectionId: SectionId;
  item?: VaultItem;
  initialMetadata?: Record<string, string>;
  initialFile?: File | null;
  initialScanResult?: SmartScanResult | null;
  initialScanComplete?: boolean;
  initialProtectedKeys?: string[];
  onChangeAddDocumentDestination?: (draft: AddDocumentFlowDraft) => void;
  documentTypes?: string[];
  familyMembers?: Pick<VaultItem, "id" | "title" | "metadata">[];
  maxUploadMb?: number;
  canUpload: boolean;
  onUpgrade?: () => void;
  presentation?: "modal" | "panel";
  onClose: () => void;
  onSave: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null }, onProgress?: (progress: TransferProgress) => void) => Promise<void>;
}

const detailColors: Record<SectionId, string> = { notes: "tag-yellow", documents: "tag-blue", academics: "tag-violet", subscriptions: "tag-orange", family: "tag-rose", purchases: "tag-blue", accounts: "tag-indigo", memberships: "tag-blue", "wallet-cards": "tag-blue", study: "tag-sky", "business-card": "tag-slate", urls: "tag-cyan", "personal-finance": "tag-blue" };
const EMPTY_PROTECTED_KEYS: string[] = [];

function detectCardNetwork(digits: string) {
  if (/^4/.test(digits)) return "Visa";
  if (/^3[47]/.test(digits)) return "American Express";
  const firstTwo = Number(digits.slice(0, 2));
  const firstFour = Number(digits.slice(0, 4));
  if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) return "Mastercard";
  const firstSix = Number(digits.slice(0, 6));
  if (/^(6011|65|64[4-9])/.test(digits) || (/^622/.test(digits) && firstSix >= 622126 && firstSix <= 622925)) return "Discover";
  if (/^62/.test(digits)) return "UnionPay";
  return digits.length >= 2 ? "Other" : "";
}

function passesLuhn(digits: string) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let doubleNext = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleNext) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    doubleNext = !doubleNext;
  }
  return sum % 10 === 0;
}

function formatCardNumber(digits: string) { return (digits.match(/.{1,4}/g) || []).join(" "); }
function formatExpiryInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}
function savedExpiry(month?: string, year?: string) {
  if (!month && !year) return "";
  const shortYear = year ? year.slice(-2) : "";
  return [month, shortYear].filter(Boolean).join("/");
}


export function ItemEditorDialog({ sectionId, item, initialMetadata, initialFile, initialScanResult, initialScanComplete = false, initialProtectedKeys = EMPTY_PROTECTED_KEYS, onChangeAddDocumentDestination, documentTypes = [], familyMembers = [], maxUploadMb = 25, canUpload, onUpgrade, presentation = "modal", onClose, onSave }: ItemEditorDialogProps) {
  const section = SECTION_BY_ID[sectionId];
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [removeFile, setRemoveFile] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [scanResult, setScanResult] = useState<SmartScanResult | null>(initialScanResult || null);
  const [scanError, setScanError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const autoScanFileRef = useRef<File | null>(null);
  const autoScanSchemaRef = useRef<string | null>(null);
  const autoScanAppliedRef = useRef(false);
  const autoAppliedValuesRef = useRef<Record<string, string>>({});
  const userEditedFieldsRef = useRef(new Set<string>(initialProtectedKeys));
  const [dragging, setDragging] = useState(false);
  const previewUrl = useMemo(() => selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : "", [selectedFile]);

  useEffect(() => {
    userEditedFieldsRef.current = new Set(initialProtectedKeys);
    const initial: Record<string, string> = { ...(initialMetadata || {}) };
    const savedMember = item?.metadata.member ?? initialMetadata?.member ?? "";
    const matchedFamilyMember = familyMembers.find((member) => member.id === savedMember || member.title.trim().toLocaleLowerCase() === savedMember.trim().toLocaleLowerCase());
    const selectedMember = !savedMember ? "" : ["me", "Me"].includes(savedMember) ? "me" : matchedFamilyMember?.id || savedMember;
    section.fields.forEach((field) => { initial[field.key] = field.key === "title" ? item?.title || initialMetadata?.title || "" : field.key === "member" ? selectedMember : item?.metadata[field.key] ?? initialMetadata?.[field.key] ?? ""; });
    initial.additionalData = item?.metadata.additionalData ?? initialMetadata?.additionalData ?? "";
    if (item?.metadata.addFlowType) initial.addFlowType = item.metadata.addFlowType;
    if (section.id === "accounts") {
      initial.accountKind = item?.metadata.accountKind || initialMetadata?.accountKind || "Internet Account";
      initial.bankAccountType = item?.metadata.bankAccountType || "Savings";
      initial.currency = item?.metadata.currency || "BDT";
    }
    if (section.id === "wallet-cards") {
      initial.title = item?.metadata.cardholder || item?.title || "";
      initial.cardNumber = "";
      initial.network = item?.metadata.network || "";
      initial.expiry = item?.metadata.expiry || savedExpiry(item?.metadata.expiryMonth, item?.metadata.expiryYear);
      initial.cardType = item?.metadata.cardType || "Debit";
      initial.currency = item?.metadata.currency || "BDT";
    }
    setValues(initial);
  }, [item, section, initialMetadata, familyMembers, initialProtectedKeys]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!canUpload) { setError("New file uploads require an active paid plan. You can still save this record without an attachment."); return; }
    const maxFileSize = Math.max(1, Number(maxUploadMb) || 25) * 1024 * 1024;
    if (file.size > maxFileSize) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError("");
    setScanResult(null);
    setScanError("");
    autoScanFileRef.current = null;
    autoScanSchemaRef.current = null;
    autoScanAppliedRef.current = false;
    autoAppliedValuesRef.current = {};
    userEditedFieldsRef.current.clear();
    setSelectedFile(file);
    setRemoveFile(false);
  };

  useEffect(() => {
    if (initialFile && selectedFile !== initialFile) acceptFile(initialFile);
  }, [initialFile, selectedFile]);

  const selectedType = (values.type || "").trim();
  const isWalletCard = sectionId === "wallet-cards";
  const isBankAccount = sectionId === "accounts" && (values.accountKind || item?.metadata.accountKind || initialMetadata?.accountKind) === "Bank Account";
  const isCv = sectionId === "documents" && /^(cv|resume)/i.test(selectedType);
  const isAdmission = sectionId === "academics" && /admission/i.test(selectedType);
  const fields = editorFieldsFor(sectionId, selectedType, values.accountKind || item?.metadata.accountKind || initialMetadata?.accountKind || "", values.financeType || "", values.materialType || "");
  const scanSchemaSignature = [selectedType, values.accountKind || "", values.financeType || "", values.materialType || "", fields.map((field) => field.key).join(",")].join("::");
  const setUserValue = (key: string, value: string) => { userEditedFieldsRef.current.add(key); setValue(key, value); };
  const scanAttachment = selectedFile || (!removeFile ? item?.file || null : null);
  const canScanAttachment = supportsSmartScanFile(scanAttachment);
  const scanSizeAllowed = isSmartScanFileSizeAllowed(selectedFile?.size ?? (!removeFile ? item?.file?.size : undefined));
  const runSmartScan = async (retry: boolean, sourceFile?: File | null) => {
    if (!canUpload) { setScanError("Smart Scan uploads are available on an active paid plan."); return; }
    if (scanBusy || !canScanAttachment || !scanSizeAllowed || !isPagesApiConfigured) return;
    const requestedSchema = scanSchemaSignature;
    setScanBusy(true); setScanError("");
    try {
      let file = sourceFile || selectedFile;
      if (!file && item?.file?.key && !removeFile) {
        const downloaded = await fetchVaultFile(item.file.key);
        file = new File([downloaded.blob], downloaded.name || item.file.name, { type: downloaded.blob.type || item.file.type || "" });
      }
      if (!file || !supportsSmartScanFile(file)) throw new Error("Select a PDF or supported image to scan.");
      if (initialFile === file) { autoScanFileRef.current = file; autoScanSchemaRef.current = requestedSchema; }
      const definitions: SmartScanFieldDefinition[] = fields.map((field) => ({
        key: field.key, label: field.label, kind: field.kind,
        options: sectionId === "documents" && field.key === "member" ? ["Me", ...familyMembers.map((member) => member.title)] : field.options,
      }));
      const result = await smartScanDocument(file, sectionId, definitions, retry);
      setScanResult(result);
      const available = new Set(definitions.map((field) => field.key));
      setValues((current) => {
        const next = { ...current };
        const appliedNow: Record<string, string> = {};
        const previousAutoValues = autoAppliedValuesRef.current;
        const firstAppliedScan = !autoScanAppliedRef.current;
        const destinationKeys = new Set(["type", "accountKind", "financeType", "materialType", "relationship", "cardType", "urlCategory", "recordType"]);
        Object.entries(result.fields).forEach(([key, field]) => {
          if (!available.has(key) || !field.value.trim() || userEditedFieldsRef.current.has(key)) return;
          const currentValue = next[key] || "";
          if (destinationKeys.has(key) && initialMetadata?.[key] && currentValue === initialMetadata[key]) return;
          const untouchedInitial = ["title", "additionalData"].includes(key) && initialMetadata?.[key] !== undefined && currentValue === initialMetadata[key];
          const mayApply = firstAppliedScan || !currentValue.trim() || currentValue === previousAutoValues[key] || untouchedInitial;
          if (!mayApply) return;
          if (sectionId === "documents" && key === "member") {
            if (/^me$/i.test(field.value.trim())) { next.member = "me"; appliedNow.member = "me"; }
            else {
              const matched = familyMembers.find((member) => member.title.trim().toLocaleLowerCase() === field.value.trim().toLocaleLowerCase());
              if (matched) { next.member = matched.id; appliedNow.member = matched.id; }
            }
          } else {
            next[key] = field.value;
            appliedNow[key] = field.value;
          }
        });
        if (sectionId === "documents" && result.documentType && !userEditedFieldsRef.current.has("type")) {
          const typeDefinition = section.fields.find((field) => field.key === "type");
          const options = [...new Set([...(documentTypes.length ? documentTypes : typeDefinition?.options || []), "CV / Resume", ...(current.type ? [current.type] : [])])];
          const matched = matchDocumentTypeSuggestion(result.documentType, options);
          const currentType = next.type || "";
          const mayUpdateType = matched && (firstAppliedScan || !currentType || currentType === previousAutoValues.type || currentType === initialMetadata?.type);
          if (matched && mayUpdateType) { next.type = matched; appliedNow.type = matched; }
        }
        autoAppliedValuesRef.current = { ...previousAutoValues, ...appliedNow };
        return next;
      });
      if (initialFile === file) { autoScanAppliedRef.current = true; autoScanSchemaRef.current = requestedSchema; }
    } catch (reason) {
      setScanError(reason instanceof Error ? reason.message : "We couldn't scan this attachment. Try again.");
    } finally { setScanBusy(false); }
  };

  useEffect(() => {
    if (!initialFile || selectedFile !== initialFile || autoScanFileRef.current === initialFile) return;
    const initialFieldsReady = ["type", "accountKind", "financeType", "materialType"].every((key) => !initialMetadata?.[key] || values[key] === initialMetadata[key]);
    if (!initialFieldsReady) return;
    autoScanFileRef.current = initialFile;
    autoScanSchemaRef.current = scanSchemaSignature;
    if (!initialScanComplete && canUpload && isPagesApiConfigured && supportsSmartScanFile(initialFile) && isSmartScanFileSizeAllowed(initialFile.size)) {
      void runSmartScan(false, initialFile);
    }
  }, [initialFile, selectedFile, values, initialMetadata, initialScanComplete, canUpload, sectionId]);

  useEffect(() => {
    if (!initialFile || selectedFile !== initialFile || scanBusy || !canUpload || !isPagesApiConfigured || !supportsSmartScanFile(initialFile) || !isSmartScanFileSizeAllowed(initialFile.size)) return;
    if (initialScanComplete && !autoScanAppliedRef.current) return;
    if (!autoScanAppliedRef.current || autoScanSchemaRef.current === scanSchemaSignature) return;
    autoScanSchemaRef.current = scanSchemaSignature;
    void runSmartScan(false, initialFile);
  }, [initialFile, selectedFile, scanBusy, scanSchemaSignature, initialScanComplete, canUpload, scanResult]);

  const changeAddDocumentDestination = () => {
    const file = selectedFile || initialFile;
    if (!file || !onChangeAddDocumentDestination) return;
    const typeValue = values.type || values.accountKind || values.financeType || values.materialType || values.relationship || values.cardType || values.urlCategory || values.recordType || values.addFlowType || "";
    onChangeAddDocumentDestination({
      file, spaceId: sectionId, typeValue, scanResult, scanError, scanAttempted: Boolean(scanResult || scanError || initialScanComplete),
      values: { ...values, title: values.title || item?.title || "" },
      userEditedKeys: Array.from(userEditedFieldsRef.current),
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = values.title?.trim();
    if (!title) { setError(`${section.titleLabel} is required.`); return; }
    const enteredCardNumber = (values.cardNumber || "").replace(/\D/g, "");
    const expiryInput = (values.expiry || "").trim();
    if (isWalletCard && !enteredCardNumber && !item?.metadata.lastFour) { setError("Enter the card number to identify the network and save its ending digits."); return; }
    if (isWalletCard && enteredCardNumber && !passesLuhn(enteredCardNumber)) { setError("Check the card number and try again."); return; }
    if (isWalletCard && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryInput)) { setError("Enter expiry as MM/YY, for example 08/29."); return; }
    setSaving(true);
    setError("");
    setUploadProgress(selectedFile ? { loaded: 0, total: selectedFile.size, percent: 0, remainingSeconds: null } : null);
    const visibleKeys = new Set(fields.map((field) => field.key));
    const transientCardKeys = new Set(["cardNumber", "expiry", "network"]);
    const metadata: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => { if (key !== "title" && (visibleKeys.has(key) || key === "addFlowType" || (initialFile && key === "additionalData")) && (!isWalletCard || !transientCardKeys.has(key)) && value.trim()) metadata[key] = value.trim(); });
    if (initialFile) {
      const destinationKeys = new Set(["type", "accountKind", "financeType", "materialType", "relationship", "cardType", "urlCategory", "recordType", "addFlowType"]);
      const nonDataKeys = new Set(["title", "additionalData", "enabled", "ringtoneId", "ringtoneName", "completed", "favorite", "pinned", "snoozedUntil"]);
      const unmatched = Object.entries(values).filter(([key, value]) => !visibleKeys.has(key) && !destinationKeys.has(key) && !nonDataKeys.has(key) && value.trim()).map(([key, value]) => `${key}: ${value.trim()}`);
      if (unmatched.length) metadata.additionalData = [...new Set([metadata.additionalData || "", ...unmatched].filter(Boolean))].join("\n\n");
    }
    if (isWalletCard) {
      const [expiryMonth, shortYear] = expiryInput.split("/");
      const year = Number(shortYear);
      const fullYear = year >= 80 ? 1900 + year : 2000 + year;
      metadata.cardholder = title;
      metadata.network = enteredCardNumber ? detectCardNetwork(enteredCardNumber) || "Other" : values.network || item?.metadata.network || "Other";
      metadata.lastFour = enteredCardNumber ? enteredCardNumber.slice(-4) : item?.metadata.lastFour || "";
      metadata.expiryMonth = expiryMonth;
      metadata.expiryYear = String(fullYear);
    }
    const file: VaultFile | undefined = selectedFile ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, localOnly: true } : removeFile ? undefined : item?.file;
    if (isWalletCard) setValues((current) => ({ ...current, cardNumber: "" }));
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        section: sectionId,
        title,
        subtitle: item?.subtitle,
        metadata,
        file,
        folderId: item?.folderId,
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
    const common = { id: `field-${field.key}`, value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setUserValue(field.key, event.target.value), required: field.required };
    if (isWalletCard && field.key === "cardNumber") return <input {...common} type="text" value={formatCardNumber(value.replace(/\D/g, ""))} inputMode="numeric" maxLength={23} autoComplete="off" spellCheck={false} placeholder={item?.metadata.lastFour ? `Leave blank to keep card ending ${item.metadata.lastFour}` : "Enter full card number"} onChange={(event) => {
      const digits = event.target.value.replace(/\D/g, "").slice(0, 19);
      setValues((current) => ({ ...current, cardNumber: digits, network: digits ? detectCardNetwork(digits) : item?.metadata.network || "" }));
    }} />;
    if (isWalletCard && field.key === "network") return <input {...common} type="text" value={values.cardNumber ? detectCardNetwork(values.cardNumber) : value} readOnly placeholder="Type a card number to detect" aria-readonly="true" />;
    if (isWalletCard && field.key === "expiry") return <input {...common} type="text" inputMode="numeric" maxLength={5} placeholder="MM/YY" autoComplete="cc-exp" onChange={(event) => setUserValue(field.key, formatExpiryInput(event.target.value))} />;
    if (field.kind === "select") {
      if (sectionId === "documents" && field.key === "member") {
        const options = ["me", ...familyMembers.map((member) => member.id)];
        if (value && !options.includes(value)) options.push(value); // Keep older saved relationship/name values selectable until edited.
        const labels = new Map<string, string>([["me", "Me"]]);
        familyMembers.forEach((member) => labels.set(member.id, `${member.title}${member.metadata.relationship ? ` · ${member.metadata.relationship}` : ""}`));
        if (value && !labels.has(value)) labels.set(value, value);
        return <select {...common}><option value="">Choose a family member…</option>{options.map((option) => <option key={option} value={option}>{labels.get(option) || option}</option>)}</select>;
      }
      const options = sectionId === "documents" && field.key === "type"
        ? [...new Set([...documentTypes, "CV / Resume", ...(value && !documentTypes.includes(value) ? [value] : [])])]
        : field.options || [];
      return <select {...common}><option value="">Choose one…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
    }
    if (sectionId === "notes" && field.key === "content") return <RichNoteEditor key={`${item?.id || "new"}-${sectionId}`} id={common.id} value={value} onChange={(next) => setUserValue(field.key, next)} />;
    if (field.kind === "textarea") return <textarea {...common} rows={3} placeholder={field.placeholder || "Add a few helpful details…"} />;
    const type = field.kind === "number" ? "number" : field.kind;
    return <input {...common} type={type} placeholder={field.placeholder || ""} />;
  };

  const content = <section className={`editor-dialog ${section.id === "notes" ? "notes-editor-drawer" : ""} ${presentation === "panel" ? "documents-editor-panel" : ""}`} role={presentation === "panel" ? "region" : "dialog"} aria-modal={presentation === "modal" ? true : undefined} aria-labelledby="editor-title">
      <div className="editor-dialog-head"><div className={`editor-icon ${section.id}`}><section.icon size={19} /></div><div><span className="section-eyebrow">{isCv ? "Career profile" : isAdmission ? "Education record" : item ? "Edit your record" : `Add to ${section.label.toLowerCase()}`}</span><h2 id="editor-title">{isCv ? item ? "Update your CV / Resume." : "Add a CV / Resume." : isAdmission ? item ? "Update admission details." : "Add an admission record." : item ? "Make a quick update." : `Add a ${section.singular}.`}</h2></div>{initialFile && onChangeAddDocumentDestination && <button type="button" className="quiet-button" onClick={changeAddDocumentDestination} disabled={saving}>Change space / type</button>}<button className="icon-button" onClick={onClose} aria-label={presentation === "panel" ? "Close document panel" : "Close"} disabled={saving}><X size={18} /></button></div>
      <p className="editor-intro">{isWalletCard ? "Add a card reference. The full card number is used only in this browser to detect the network and ending digits, then discarded." : sectionId === "accounts" && isBankAccount ? "Keep bank and branch details together. Do not store online banking passwords, PINs, CVVs, or one-time codes." : sectionId === "accounts" ? "Keep a useful index of online services and sign-in links. Never save passwords or one-time codes." : isCv ? "Add your career details and attach a current CV. Identity numbers and expiry dates aren't needed here." : isAdmission ? "Keep the admission, application and payment details together. Grade and passing-year fields are hidden for this record type." : "A few details now make it easier to find later. Everything you add is just for you."}</p>
      <form className="editor-form" onSubmit={submit}>
        <div className="editor-fields-grid">{fields.map((field) => <label key={field.key} className={`field-label ${field.wide || field.kind === "textarea" ? "field-wide" : ""}`} htmlFor={`field-${field.key}`}>{isCv && field.key === "title" ? "CV / Resume title" : sectionId === "accounts" && field.key === "title" ? isBankAccount ? "Account label" : "Service name" : field.label}{field.required && <span className="required-star">*</span>}{renderInput(field)}<SmartScanFieldNote field={scanResult?.fields[field.key]} currentValue={values[field.key] || ""} onApply={(value) => setUserValue(field.key, value)} allowApply={!initialFile}/></label>)}</div>
        {initialFile && !isWalletCard && fields.every((field) => field.key !== "additionalData") && <label className="field-label field-wide" htmlFor="field-additional-data">Additional Data <small>Other extracted information that does not fit the fields above</small><textarea id="field-additional-data" value={values.additionalData || ""} onChange={(event) => setUserValue("additionalData", event.target.value)} rows={4} maxLength={5000} placeholder="Review or add other information from the file"/></label>}
        {!isWalletCard && <div className="upload-field-block"><div className="upload-field-title"><span>Attach a file <small>Optional · PDF, photo or document</small></span><span className="upload-lock"><LockKeyhole size={12} /> Private</span></div>
          {selectedFile ? <div className="upload-preview-row">{previewUrl ? <img src={previewUrl} alt="Selected file preview" className="upload-image-preview" /> : <span className="upload-file-icon"><FileText size={20} /></span>}<span className="upload-preview-name"><b>{selectedFile.name}</b><small>{humanSize(selectedFile.size)} · Ready to upload</small></span><button type="button" className="plain-icon upload-remove" onClick={() => { setSelectedFile(null); setScanResult(null); setScanError(""); }} aria-label="Remove selected file"><X size={16} /></button></div> : item?.file && !removeFile ? <div className="upload-preview-row existing-file-row"><span className="upload-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={19} /> : <FileText size={19} />}</span><span className="upload-preview-name"><b>{item.file.name}</b><small>{humanSize(item.file.size)} · Saved in your vault</small></span><button type="button" className="upload-replace" disabled={!canUpload} onClick={() => document.getElementById("vault-file-input")?.click()}>Replace</button><button type="button" className="plain-icon upload-remove" onClick={() => { setRemoveFile(true); setScanResult(null); setScanError(""); }} aria-label="Remove attachment"><X size={16} /></button></div> : canUpload ? <label htmlFor="vault-file-input" className={`file-dropzone ${dragging ? "file-dropzone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}>
            <span className="upload-circle"><UploadCloud size={19} /></span><span className="dropzone-copy"><b>Choose a file or drop it here</b><small>PDF, PNG, JPG or document · up to {maxUploadMb} MB</small></span><span className="browse-button">Browse files</span></label> : <div className="file-upload-locked"><LockKeyhole size={16}/><span>New attachments require an active paid plan. Records remain available on every plan.</span>{onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}</div>}
          <input className="hidden-file-input" id="vault-file-input" type="file" disabled={!canUpload} onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" />
          {canScanAttachment && <SmartScanActionPanel fileName={selectedFile?.name || item?.file?.name || ""} canScan={canUpload && isPagesApiConfigured && scanSizeAllowed && Boolean(selectedFile || (item?.file?.key && !removeFile))} unavailableMessage={!canUpload ? "Smart Scan uploads require an active paid plan." : !isPagesApiConfigured ? "Smart Scan needs a connected Cloudflare Pages account." : !scanSizeAllowed ? "Smart Scan supports files up to 7 MB." : "Select this attachment again to scan it."} busy={scanBusy} error={scanError} result={scanResult} onScan={(retry) => void runSmartScan(retry)}/>}
        </div>}
        {isWalletCard && <div className="wallet-card-privacy-note"><ShieldCheck size={14}/><span><b>Sherlock Security System.</b> Card number is used in this browser only to detect the network and ending digits, then discarded on save. Only the last four digits are stored. CVV is never saved.</span></div>}
        {uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Uploading file" detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}/>}
        {error && <div className="form-alert error-alert editor-error" role="alert">{error}</div>}
        <div className="editor-form-footer"><div className="editor-footnote"><ShieldCheck size={14} /><span>Private to your Persora account</span></div><div className="editor-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>{presentation === "panel" ? "Back to documents" : "Cancel"}</button><button type="submit" className="editor-submit" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : <>{item ? "Save changes" : "Save to vault"}<Check size={15} /></>}</button></div></div>
      </form>
    </section>;
  return presentation === "panel" ? content : <div className={`modal-backdrop ${section.id === "notes" ? "notes-editor-backdrop" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>{content}</div>;
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

export function TodoEditorDialog({ kind = "todo", item, canUpload, maxUploadMb = 25, onUpgrade, onClose, onSave }: { kind?: NotesRecordKind; item?: VaultItem; canUpload: boolean; maxUploadMb?: number; onUpgrade?: () => void; onClose: () => void; onSave: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null }) => Promise<void> }) {
  const [title, setTitle] = useState(item?.title || "");
  const [details, setDetails] = useState(item?.metadata.todoDetails || "");
  const [additionalData, setAdditionalData] = useState(item?.metadata.additionalData || "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [scanResult, setScanResult] = useState<SmartScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
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
  const scanAttachment = selectedFile || (!removeFile ? item?.file || null : null);
  const canScanAttachment = supportsSmartScanFile(scanAttachment);
  const scanSizeAllowed = isSmartScanFileSizeAllowed(selectedFile?.size ?? (!removeFile ? item?.file?.size : undefined));
  const scanDefinitions: SmartScanFieldDefinition[] = [
    { key: "title", label: kind === "todo" ? "Task title" : `${kind} title`, kind: "text" },
    { key: "todoDetails", label: "Details", kind: "textarea" },
    ...(kind === "todo" ? [{ key: "dueDate", label: "Due date", kind: "date" }] : []),
    { key: "additionalData", label: "Additional Data", kind: "textarea" },
  ];
  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!canUpload) { setError("New attachments require an active paid plan."); return; }
    if (file.size > Math.max(1, maxUploadMb) * 1024 * 1024) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError(""); setSelectedFile(file); setRemoveFile(false); setScanResult(null); setScanError("");
  };
  const runSmartScan = async (retry: boolean) => {
    if (!canUpload) { setScanError("Smart Scan uploads require an active paid plan."); return; }
    if (scanBusy || !canScanAttachment || !scanSizeAllowed || !isPagesApiConfigured) return;
    setScanBusy(true); setScanError("");
    try {
      let file = selectedFile;
      if (!file && item?.file?.key && !removeFile) {
        const downloaded = await fetchVaultFile(item.file.key);
        file = new File([downloaded.blob], downloaded.name || item.file.name, { type: downloaded.blob.type || item.file.type || "" });
      }
      if (!file || !supportsSmartScanFile(file)) throw new Error("Select a PDF or supported image to scan.");
      const result = await smartScanDocument(file, "notes", scanDefinitions, retry);
      setScanResult(result);
      Object.entries(result.fields).forEach(([key, field]) => {
        if (!field.value.trim() || !scanDefinitions.some((definition) => definition.key === key)) return;
        if (key === "title") setTitle(field.value);
        else if (key === "todoDetails") setDetails(field.value);
        else if (key === "dueDate" && kind === "todo") setDueDate(field.value);
        else if (key === "additionalData") setAdditionalData(field.value);
      });
    } catch (reason) { setScanError(reason instanceof Error ? reason.message : "We couldn't scan this attachment. Try again."); }
    finally { setScanBusy(false); }
  };
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
    const metadata: Record<string, string> = { recordType: kind, enabled: item?.metadata.enabled === "false" ? "false" : "true", ringtoneId: selectedRingtoneId, ringtoneName: selectedRingtoneName, ...(details.trim() ? { todoDetails: details.trim() } : {}), ...(additionalData.trim() ? { additionalData: additionalData.trim() } : {}) };
    if (kind === "todo") { metadata.completed = item?.metadata.completed === "true" ? "true" : "false"; if (dueDate) metadata.dueDate = dueDate; }
    if (kind === "reminder") metadata.reminderAt = new Date(reminderAt).toISOString();
    if (kind === "alarm") { metadata.alarmTime = alarmTime; if (repeatDays.length) metadata.repeatDays = repeatDays.join(","); else metadata.alarmDate = alarmDate; }
    try {
      await onSave({ ...(item?.id ? { id: item.id } : {}), section: "notes", title: title.trim(), subtitle: item?.subtitle, metadata, favorite: item?.favorite, pinned: false, folderId: item?.folderId, file: selectedFile ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, localOnly: true } : removeFile ? undefined : item?.file, fileUpload: selectedFile });
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
        <label className="field-label todo-details-field" htmlFor="todo-additional-data">Additional Data <small>Optional</small><textarea id="todo-additional-data" value={additionalData} onChange={(event) => setAdditionalData(event.target.value)} rows={3} maxLength={5000} placeholder="Other information to keep with this task"/></label>
        <div className="upload-field-block"><div className="upload-field-title"><span>Attach a file <small>Optional · PDF or image for Smart Scan</small></span><span className="upload-lock"><LockKeyhole size={12}/> Private</span></div>
          {selectedFile ? <div className="upload-preview-row"><span className="upload-file-icon"><FileText size={20}/></span><span className="upload-preview-name"><b>{selectedFile.name}</b><small>{humanSize(selectedFile.size)} · Ready to upload</small></span><button type="button" className="plain-icon upload-remove" onClick={() => { setSelectedFile(null); setScanResult(null); setScanError(""); if (item?.file) setRemoveFile(false); }} aria-label="Remove selected file"><X size={16}/></button></div> : item?.file && !removeFile ? <div className="upload-preview-row existing-file-row"><span className="upload-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={19}/> : <FileText size={19}/>}</span><span className="upload-preview-name"><b>{item.file.name}</b><small>{humanSize(item.file.size)} · Saved in your vault</small></span><button type="button" className="upload-replace" disabled={!canUpload} onClick={() => document.getElementById("todo-attachment-input")?.click()}>Replace</button><button type="button" className="plain-icon upload-remove" onClick={() => { setRemoveFile(true); setScanResult(null); setScanError(""); }} aria-label="Remove attachment"><X size={16}/></button></div> : canUpload ? <label htmlFor="todo-attachment-input" className="file-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptFile(event.dataTransfer.files[0]); }}><span className="upload-circle"><UploadCloud size={19}/></span><span className="dropzone-copy"><b>Choose a file or drop it here</b><small>PDF, PNG, JPG, WebP · up to {maxUploadMb} MB</small></span><span className="browse-button">Browse files</span></label> : <div className="file-upload-locked"><LockKeyhole size={16}/><span>New attachments and Smart Scan require an active paid plan. Existing records remain available.</span>{onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}</div>}
          <input className="hidden-file-input" id="todo-attachment-input" type="file" disabled={!canUpload} onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp" />
          {canScanAttachment && <SmartScanActionPanel fileName={selectedFile?.name || item?.file?.name || ""} canScan={canUpload && isPagesApiConfigured && scanSizeAllowed && Boolean(selectedFile || (item?.file?.key && !removeFile))} unavailableMessage={!canUpload ? "Smart Scan uploads require an active paid plan." : !isPagesApiConfigured ? "Smart Scan needs a connected Cloudflare Pages account." : !scanSizeAllowed ? "Smart Scan supports files up to 7 MB." : "Select the attachment again to scan it."} busy={scanBusy} error={scanError} result={scanResult} onScan={(retry) => void runSmartScan(retry)}/ >}
        </div>
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

export function ItemDetailDialog({ item, familyMembers = [], filePreview, shareAccess, comments = [], presentation = "modal", onClose, onEdit, onDownloadFile, onManageSharing, onAddComment }: { item: VaultItem; familyMembers?: Pick<VaultItem, "id" | "title" | "metadata">[]; filePreview?: VaultFilePreview | null; shareAccess?: SharedItemAccess; comments?: ShareComment[]; presentation?: "modal" | "panel"; onClose: () => void; onEdit: () => void; onDownloadFile: () => void; onManageSharing?: () => void; onAddComment?: (body: string) => Promise<void> }) {
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [copiedWalletField, setCopiedWalletField] = useState("");
  const copyWalletValue = async (field: string, value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(value);
      setCopiedWalletField(field);
      window.setTimeout(() => setCopiedWalletField((current) => current === field ? "" : current), 1500);
    } catch {
      setCopiedWalletField(`${field}-error`);
      window.setTimeout(() => setCopiedWalletField((current) => current === `${field}-error` ? "" : current), 1500);
    }
  };
  const section = SECTION_BY_ID[item.section];
  const dateKey = section.dateKey;
  const dateValue = dateKey ? item.metadata[dateKey] : undefined;
  const days = daysUntil(dateValue);
  const isTodoItem = item.section === "notes" && item.metadata.recordType === "todo";
  const isWalletCard = item.section === "wallet-cards";
  const lastFour = /^\d{4}$/.test(item.metadata.lastFour || "") ? item.metadata.lastFour : "";
  const walletExpiry = item.metadata.expiry || savedExpiry(item.metadata.expiryMonth, item.metadata.expiryYear);
  const walletCardEntries: [string, string][] = [
    ["cardholder", item.metadata.cardholder || item.title],
    ["cardNumber", lastFour ? `•••• •••• •••• ${lastFour}` : "Not provided"],
    ["network", item.metadata.network || ""],
    ["expiryValue", walletExpiry],
    ["cardType", item.metadata.cardType || ""],
    ["issuer", item.metadata.issuer || ""],
    ["currency", item.metadata.currency || ""],
  ];
  const displayEntries: [string, string][] = isWalletCard
    ? walletCardEntries.filter(([, value]) => Boolean(value))
    : Object.entries(item.metadata).filter(([key, value]) => Boolean(value) && key !== "notes" && !(item.section === "notes" && key === "content") && !(isTodoItem && ["recordType", "completed", "todoDetails", "dueDate"].includes(key)));
  const walletFieldLabels: Record<string, string> = { cardholder: "Cardholder name", cardNumber: "Card number", network: "Card network", expiryValue: "Expires", cardType: "Card type", issuer: "Bank / issuer", currency: "Currency" };
  const formattedKey = (value: string) => value === "member" ? "Belongs to" : isWalletCard && walletFieldLabels[value] ? walletFieldLabels[value] : value.replace(/([A-Z])/g, " $1").replace(/^\w/, (letter) => letter.toUpperCase());
  const familyMemberLabel = (value: string) => {
    if (["me", "Me"].includes(value)) return "Me";
    const match = familyMembers.find((member) => member.id === value);
    if (match) return match.title;
    return /^[0-9a-f-]{30,}$/i.test(value) ? "Family member" : value;
  };
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
  const content = <section className={`detail-dialog ${presentation === "panel" ? "documents-detail-panel" : ""}`} role={presentation === "panel" ? "region" : "dialog"} aria-modal={presentation === "modal" ? true : undefined} aria-labelledby="detail-title">
      <div className="detail-banner"><div className="detail-banner-pattern"/><div className={`detail-icon ${detailColors[item.section]}`}><section.icon size={22} /></div><button className="icon-button detail-close" onClick={onClose} aria-label={presentation === "panel" ? "Close document panel" : "Close details"}><X size={18} /></button><div className="detail-banner-title"><span>{section.eyebrow}</span><h2 id="detail-title">{item.title}</h2></div><div className="detail-private-pill">{shareAccess ? <><Share2 size={12} /> {shareAccess.direction === "incoming" ? `SHARED BY ${shareAccess.owner.fullName}` : `SHARED WITH ${shareAccess.recipient.fullName}`}</> : <><LockKeyhole size={12} /> YOUR PRIVATE VAULT</>}</div></div>
      <div className="detail-body"><div className="detail-meta-strip"><span><CalendarDays size={13} /> Added {formatDate(item.createdAt)}</span><span className="detail-updated">Updated {formatRelativeDate(item.updatedAt.slice(0, 10))}</span>{dateValue && <span className={`detail-date-status ${days !== null && days >= 0 && days <= 30 ? "detail-date-soon" : ""}`}><span />{days !== null && days >= 0 && days <= 30 ? `${days === 0 ? "Due today" : `Due in ${days} days`} · ` : ""}{formatDate(dateValue)}</span>}</div>
        {isTodoItem && <div className="detail-fields-grid"><div className="detail-field"><span>Status</span><b>{item.metadata.completed === "true" ? "Completed" : "Active"}</b></div>{item.metadata.dueDate && <div className="detail-field"><span>Due date</span><b>{formatDate(item.metadata.dueDate)}</b></div>}</div>}
        {displayEntries.length ? <div className="detail-fields-grid">{displayEntries.map(([key, value]) => {
          const copyableWalletValue = isWalletCard && (key === "cardholder" || key === "cardNumber");
          const displayValue = key === "member" ? familyMemberLabel(value) : !isWalletCard && (key.toLowerCase().includes("date") || key.toLowerCase().includes("expiry") || key.toLowerCase().includes("renewal")) ? formatDate(value) : value;
          return <div className="detail-field" key={key}><span>{formattedKey(key)}</span>{copyableWalletValue ? <div className="wallet-card-copy-value"><b>{displayValue}</b><button type="button" className="wallet-card-copy-button" onClick={() => void copyWalletValue(key, displayValue)} aria-label={copiedWalletField === key ? `${formattedKey(key)} copied` : `Copy ${formattedKey(key)}`} title={copiedWalletField === `${key}-error` ? "Clipboard access is unavailable" : copiedWalletField === key ? "Copied" : `Copy ${formattedKey(key)}`}>{copiedWalletField === key ? <Check size={14}/> : <Copy size={14}/>}</button></div> : <b>{displayValue}</b>}</div>;
        })}</div> : <div className="detail-no-meta">No extra details have been added.</div>}
        {isWalletCard && <div className="wallet-card-detail-note"><ShieldCheck size={14}/><span>Sherlock Security System · full card numbers and CVV are never stored. The number stays masked; copy controls are limited to the cardholder name and masked number.</span></div>}
        {note && <div className="detail-notes"><span>{item.section === "notes" ? "Note" : "Notes"}</span>{item.section === "notes" ? <div className="rich-note-rendered" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note, true) }} /> : <p>{note}</p>}</div>}
        {qrValue && <div className="detail-qr-card"><div className="detail-qr-copy"><span className="qr-card-label"><span /> ON-DEVICE QR</span><h3>{qrHeading}</h3><p>{qrNote}</p><small><LockKeyhole size={12} /> Generated on this device</small></div><div className="detail-qr-image"><QRPreview value={qrValue} size={76} /></div></div>}
        {item.file && <section className="detail-attachment-preview"><div className="detail-file"><div className="detail-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}</div><div className="detail-file-copy"><b>{filePreview?.name || item.file.name}</b><small>{humanSize(item.file.size)} · {item.file.localOnly ? "This device" : "Stored privately in Cloudflare R2"}</small></div><button className="outline-action-button" onClick={onDownloadFile}><Download size={15} /> Download</button></div><div className="detail-preview-stage">
          {!filePreview || filePreview.status === "loading" ? <div className="detail-preview-message"><span className="spinner dark-spinner"/><b>Opening private attachment…</b></div> : filePreview.status === "unavailable" || filePreview.status === "error" ? <div className="detail-preview-message"><FileText size={25}/><b>{filePreview.message || "This attachment could not be previewed."}</b></div> : filePreview.type?.startsWith("image/") && filePreview.src ? <ImagePreview src={filePreview.src} name={filePreview.name}/> : (filePreview.type === "application/pdf" || filePreview.name.toLowerCase().endsWith(".pdf")) && filePreview.src ? <PdfPreview src={filePreview.src} name={filePreview.name}/> : filePreview.type?.startsWith("video/") && filePreview.src ? <video className="detail-preview-media" src={filePreview.src} controls /> : filePreview.type?.startsWith("audio/") && filePreview.src ? <audio className="detail-preview-audio" src={filePreview.src} controls /> : <div className="detail-preview-message"><FileText size={25}/><b>Preview isn’t supported for this file type in your browser.</b><span>Use Download to open it with a compatible app. Your file remains private.</span></div>}
        </div></section>}
        {shareAccess && <section className="shared-comments"><div className="shared-comments-heading"><span><MessageSquare size={15}/></span><div><b>Comments</b><small>{shareAccess.direction === "incoming" ? `Shared by ${shareAccess.owner.fullName}` : `Shared with ${shareAccess.recipient.fullName}`} · {shareAccess.permission} access</small></div></div><div className="shared-comment-list">{comments.length ? comments.map((comment) => <article className="shared-comment" key={comment.id}><div><b>{comment.authorName}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.body}</p></article>) : <p className="comments-empty">No comments yet.</p>}</div>{canComment && <form className="shared-comment-form" onSubmit={(event) => void submitComment(event)}><textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={5000} rows={2} placeholder="Add a comment…" required/><button className="editor-submit" disabled={commentSending || !commentDraft.trim()}>{commentSending ? "Posting…" : <>Comment <Send size={14}/></>}</button>{commentError && <span className="form-alert error-alert">{commentError}</span>}</form>}{!canComment && <p className="comments-view-only">Your View access allows you to read comments.</p>}</section>}
      </div><div className="detail-footer"><span><ShieldCheck size={14} /> {shareAccess ? "Original owner's copy stays in their vault." : "Your data belongs to you."}</span><div><button className="quiet-button" onClick={onClose}>{presentation === "panel" ? "Back to documents" : "Close"}</button>{(!shareAccess || shareAccess.direction === "outgoing") && onManageSharing && <button className="quiet-button share-detail-button" onClick={onManageSharing}><Share2 size={14}/> Manage sharing</button>}{canEdit && <button className="editor-submit" onClick={onEdit}>Edit details <ArrowUpRight size={14} /></button>}</div></div>
    </section>;
  return presentation === "panel" ? content : <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{content}</div>;
}

export function ShareManagementDialog({ item, shares, allRecentShares = [], available, onShare, onPermissionChange, onRevoke, onClose }: { item: VaultItem; shares: SharedVaultEntry[]; allRecentShares?: SharedVaultEntry[]; available: boolean; onShare: (recipient: string, permission: SharePermission) => Promise<void>; onPermissionChange: (shareId: string, permission: SharePermission) => Promise<void>; onRevoke: (shareId: string) => Promise<void>; onClose: () => void }) {
  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [busy, setBusy] = useState(false);
  const [busyShare, setBusyShare] = useState("");
  const [error, setError] = useState("");

  const recentRecipients = useMemo(() => {
    const list: { userId?: string; name: string; email: string }[] = [];
    const seen = new Set<string>();
    const pool = [...shares, ...(allRecentShares || [])];
    for (const entry of pool) {
      if (entry?.recipient?.userId && !seen.has(entry.recipient.userId)) {
        seen.add(entry.recipient.userId);
        list.push({
          userId: entry.recipient.userId,
          name: entry.recipient.fullName,
          email: entry.recipient.email,
        });
      }
    }
    return list.slice(0, 5);
  }, [shares, allRecentShares]);

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
    <form className="share-invite-form" onSubmit={(event) => void submit(event)}>
      <label className="field-label">Email address or seven-digit Persora ID<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.com or 1234567" autoComplete="off" disabled={!available || busy}/></label>
      {recentRecipients.length > 0 && (
        <div className="record-share-recents" style={{margin: "4px 0 8px 0"}}>
          <div className="record-share-recents-header"><Clock size={11}/><span>Recent members</span></div>
          <div className="record-share-chips">
            {recentRecipients.map((m, idx) => (
              <button key={idx} type="button" className="record-share-chip" onClick={() => setRecipient(m.userId || m.email)} disabled={!available || busy} title={m.email}>
                <UserCheck size={11}/>
                <span>{m.name} ({m.userId})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field-label">Permission<select value={permission} onChange={(event) => setPermission(event.target.value as SharePermission)} disabled={!available || busy}><option value="view">View · read and download</option><option value="comment">Comment · view and leave comments</option><option value="edit">Edit · update the original document</option></select></label>
      <button className="editor-submit" disabled={!available || busy || !recipient.trim()}>{busy ? "Sharing…" : <>Share document <ArrowRight size={14}/></>}</button>
    </form>
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
