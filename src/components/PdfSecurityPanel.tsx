import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, EyeOff, FileLock2, FileText, Info, KeyRound, Loader2, LockKeyhole, LockKeyholeOpen, RotateCcw, Upload, X } from "lucide-react";
import { PDF_ACCEPT, errorMessage, formatBytes, pageCountLabel } from "../lib/pdf-studio";
import {
  MIN_PASSWORD_LENGTH, PdfSecurityError, SECURITY_MAX_BYTES, checkSecurityInput, classifyQpdfFailure, describeEncryption, inspectPdf, lockPdf, passwordStrength, unlockPdf, unlockRequirement, validateNewPassword,
  type EncryptionReport, type QpdfEngine, type SecurityResult, type SecurityStage,
} from "../lib/pdf-security";

export type SecurityMode = "lock" | "unlock";

interface Props {
  mode: SecurityMode;
  onModeChange: (mode: SecurityMode) => void;
  /** Files dropped on the surrounding tool panel. */
  droppedFiles: File[] | null;
  onDroppedHandled: () => void;
  download: (blob: Blob, fileName: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

/** What we learned about the chosen file before the user presses Lock/Unlock. */
type FileCheck =
  | { status: "checking" }
  | { status: "plain"; pageCount: number }
  | { status: "needs-password" }
  | { status: "restricted"; report: EncryptionReport }
  | { status: "error"; message: string };

interface Chosen { file: File; bytes: Uint8Array; check: FileCheck }

const STAGE_LABELS: Record<SecurityMode, Record<SecurityStage, string>> = {
  lock: { check: "Checking the PDF…", encrypt: "Encrypting with AES-256…", decrypt: "", verify: "Verifying the locked file…" },
  unlock: { check: "Checking the password…", encrypt: "", decrypt: "Removing the protection…", verify: "Verifying the unlocked file…" },
};

async function engine(): Promise<QpdfEngine> {
  try {
    const { loadQpdfEngine } = await import("../lib/pdf-qpdf");
    return await loadQpdfEngine();
  } catch (error) {
    throw classifyQpdfFailure(errorMessage(error, "The PDF security engine couldn't load."), "This PDF");
  }
}

function PasswordInput({ id, label, value, onChange, show, onToggle, autoComplete, invalid, disabled, describedBy }: { id: string; label: string; value: string; onChange: (value: string) => void; show: boolean; onToggle: () => void; autoComplete: string; invalid?: boolean; disabled?: boolean; describedBy?: string }) {
  return <label className="field-label pdfs-sec-field" htmlFor={id}>{label}
    <div className="password-wrap">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled} data-lpignore="true" data-1p-ignore="true"/>
      <button type="button" className="password-toggle" onClick={onToggle} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} disabled={disabled}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
    </div>
  </label>;
}

/** PDF Security: Lock (AES-256 password) and Unlock (remove a known password), processed on this device. */
export default function PdfSecurityPanel({ mode, onModeChange, droppedFiles, onDroppedHandled, download, notify }: Props) {
  const ids = { password: useId(), confirm: useId(), hint: useId(), error: useId() };
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [stage, setStage] = useState<SecurityStage | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SecurityResult | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const busy = stage !== null;

  const clearSecrets = () => { setPassword(""); setConfirm(""); setShow(false); setTouched(false); };
  const reset = () => { runId.current += 1; setChosen(null); setResult(null); setError(""); setStage(null); setPercent(null); clearSecrets(); };

  /** Reads the file and asks qpdf what kind of protection it has. */
  const choose = async (file: File, forMode: SecurityMode) => {
    const run = ++runId.current;
    setResult(null); setError(""); clearSecrets();
    if (file.size > SECURITY_MAX_BYTES) { setChosen(null); setError(`“${file.name}” is ${formatBytes(file.size)}. PDF Security handles files up to ${formatBytes(SECURITY_MAX_BYTES)} in the browser.`); return; }
    setChosen({ file, bytes: new Uint8Array(), check: { status: "checking" } });
    let check: FileCheck;
    let bytes = new Uint8Array();
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      checkSecurityInput(bytes, file.name);
      const qpdf = await engine();
      if (forMode === "unlock") {
        const requirement = await unlockRequirement(qpdf, bytes, file.name);
        check = requirement.kind === "open" ? { status: "needs-password" } : requirement.kind === "permissions" ? { status: "restricted", report: requirement.report } : { status: "plain", pageCount: requirement.report.pageCount };
      } else {
        const inspection = await inspectPdf(qpdf, bytes, file.name);
        check = inspection.status === "needs-password" ? { status: "needs-password" } : inspection.report.encrypted ? { status: "restricted", report: inspection.report } : { status: "plain", pageCount: inspection.report.pageCount };
      }
    } catch (failure) {
      check = { status: "error", message: errorMessage(failure, `“${file.name}” couldn't be read.`) };
    }
    if (run === runId.current) setChosen({ file, bytes, check });
  };

  // Re-check the file when switching between Lock and Unlock (the questions differ).
  useEffect(() => {
    if (chosen && !busy) void choose(chosen.file, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!droppedFiles) return;
    onDroppedHandled();
    const pdf = droppedFiles.find((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name)) || droppedFiles[0];
    if (busy || !pdf) return;
    if (droppedFiles.length > 1) notify("PDF Security works on one file at a time — the first PDF was chosen.");
    void choose(pdf, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choose(file, mode); };

  const lockProblem = mode === "lock" ? validateNewPassword(password, confirm) : "";
  const blockedByFile = !chosen || chosen.check.status === "checking" || chosen.check.status === "error"
    || (mode === "lock" && chosen.check.status !== "plain")
    || (mode === "unlock" && chosen.check.status === "plain");
  const canSubmit = !busy && !blockedByFile && (mode === "lock" ? !lockProblem : password.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!chosen || !canSubmit) return;
    const run = ++runId.current;
    setError(""); setResult(null); setPercent(null); setStage("check");
    try {
      const qpdf = await engine();
      const hooks = { onStage: (next: SecurityStage) => { if (run === runId.current) { setStage(next); setPercent(null); } }, onProgress: (value: number) => { if (run === runId.current) setPercent(value); } };
      const output = mode === "lock" ? await lockPdf(qpdf, chosen.bytes, chosen.file.name, password, hooks) : await unlockPdf(qpdf, chosen.bytes, chosen.file.name, password, hooks);
      if (run !== runId.current) return;
      setResult(output);
      clearSecrets();
      notify(mode === "lock" ? `“${output.fileName}” is ready — locked with AES-256.` : `“${output.fileName}” is ready — protection removed.`);
    } catch (failure) {
      if (run !== runId.current) return;
      setError(errorMessage(failure, mode === "lock" ? "The PDF couldn't be locked." : "The PDF couldn't be unlocked."));
      if (failure instanceof PdfSecurityError && (failure.kind === "wrong-password" || failure.kind === "owner-password-required")) setPassword("");
    } finally {
      if (run === runId.current) { setStage(null); setPercent(null); }
    }
  };

  const save = () => { if (result) download(new Blob([result.bytes as BlobPart], { type: "application/pdf" }), result.fileName); };

  const onDrop = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault(); event.stopPropagation(); depth.current = 0; setOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length && !busy) void choose(files.find((file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf") || files[0], mode);
  };
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return; event.preventDefault(); event.stopPropagation(); depth.current += 1; setOver(true); },
    onDragOver: (event: DragEvent) => { if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (event: DragEvent) => { event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop,
  };

  const check = chosen?.check;
  const fileStatus = !check ? null
    : check.status === "checking" ? <span className="pdfs-sec-status"><Loader2 size={12} className="pdfs-spin"/> Checking…</span>
    : check.status === "plain" ? <span className="pdfs-sec-status">{pageCountLabel(check.pageCount)} · not password-protected</span>
    : check.status === "needs-password" ? <span className="pdfs-sec-status is-locked"><LockKeyhole size={12}/> Needs a password to open</span>
    : check.status === "restricted" ? <span className="pdfs-sec-status is-locked"><LockKeyhole size={12}/> {describeEncryption(check.report)} · restricted by its author</span>
    : <span className="pdfs-sec-status is-error"><AlertTriangle size={12}/> Can't be processed</span>;

  // A file that doesn't fit the chosen mode gets a clear explanation (and a shortcut to the other mode).
  const fileNote = !chosen || !check ? null
    : check.status === "error" ? <p className="pdfs-sec-note is-error" role="alert"><AlertTriangle size={13}/>{check.message}</p>
    : mode === "lock" && check.status === "needs-password" ? <p className="pdfs-sec-note"><Info size={13}/><span>This PDF already has a password. <button type="button" className="pdfs-link-button" onClick={() => onModeChange("unlock")}>Unlock it</button> first if you want to set a new one.</span></p>
    : mode === "lock" && check.status === "restricted" ? <p className="pdfs-sec-note"><Info size={13}/><span>Its author restricted this PDF with a permissions password. <button type="button" className="pdfs-link-button" onClick={() => onModeChange("unlock")}>Unlock it</button> with that password first, then lock it with your own.</span></p>
    : mode === "unlock" && check.status === "plain" ? <p className="pdfs-sec-note"><Info size={13}/><span>This PDF isn't password-protected, so there's nothing to remove. <button type="button" className="pdfs-link-button" onClick={() => onModeChange("lock")}>Lock it</button> instead?</span></p>
    : null;

  const strength = password ? passwordStrength(password) : null;
  // Explain why Lock is unavailable as soon as the confirmation is typed out (the button stays disabled until it's fixed).
  const showLockError = mode === "lock" && lockProblem && (touched || (confirm.length > 0 && confirm.length >= password.length));
  const unlockLabel = check?.status === "restricted" ? "Permissions (owner) password" : "Password";

  return <div className="pdfs-sec">
    <div className="pdfs-sec-switch" role="radiogroup" aria-label="PDF Security action">
      <button type="button" role="radio" aria-checked={mode === "lock"} className={mode === "lock" ? "is-active" : ""} onClick={() => onModeChange("lock")} disabled={busy}><LockKeyhole size={14}/> Lock PDF</button>
      <button type="button" role="radio" aria-checked={mode === "unlock"} className={mode === "unlock" ? "is-active" : ""} onClick={() => onModeChange("unlock")} disabled={busy}><LockKeyholeOpen size={14}/> Unlock PDF</button>
    </div>

    {result ? <div className="pdfs-sec-result" role="status">
      <span className="pdfs-sec-result-icon"><CheckCircle2 size={20}/></span>
      <div className="pdfs-sec-result-copy">
        <b>{mode === "lock" ? "Locked and verified" : "Unlocked and verified"}</b>
        <span>{mode === "lock"
          ? `Encrypted with AES-256. We re-opened the file to confirm it won't open without your password. ${pageCountLabel(result.pageCount)} · ${formatBytes(result.bytes.byteLength)}.`
          : `${describeEncryption(result.report)} protection removed — the file now opens without a password. ${pageCountLabel(result.pageCount)} · ${formatBytes(result.bytes.byteLength)}.`}</span>
        {result.repaired && <small>Minor structural problems in the original file were repaired while saving.</small>}
        {mode === "lock" && <small>Keep the password somewhere safe — it can't be recovered by Persora or anyone else.</small>}
      </div>
      <div className="pdfs-sec-actions">
        <button type="button" className="section-add-button" onClick={save}><Download size={14}/> Download {result.fileName.length > 34 ? "PDF" : `“${result.fileName}”`}</button>
        <button type="button" className="quiet-button" onClick={reset}><RotateCcw size={14}/> {mode === "lock" ? "Lock another PDF" : "Unlock another PDF"}</button>
      </div>
    </div>
    : <form className="pdfs-sec-form" onSubmit={(event) => void submit(event)} noValidate>
      {chosen ? <div className="pdfs-sec-file">
        <span className="pdfs-sec-file-icon">{check?.status === "needs-password" || check?.status === "restricted" ? <FileLock2 size={17}/> : <FileText size={17}/>}</span>
        <div className="pdfs-sec-file-copy"><b title={chosen.file.name}>{chosen.file.name}</b><small>{formatBytes(chosen.file.size)}{fileStatus && <> · {fileStatus}</>}</small></div>
        <button type="button" className="quiet-button pdfs-sec-change" onClick={() => inputRef.current?.click()} disabled={busy}>Change</button>
        <button type="button" className="pdfs-icon-button" onClick={reset} disabled={busy} aria-label="Remove file"><X size={15}/></button>
      </div>
      : <div className={`pdfs-sec-drop ${over ? "is-dragover" : ""}`} {...dropHandlers}>
        <Upload size={16}/>
        <span>{over ? "Release to choose this PDF" : mode === "lock" ? "Drop a PDF to protect with a password" : "Drop a password-protected PDF"}</span>
        <button type="button" className="section-add-button" onClick={() => inputRef.current?.click()}><Upload size={14}/> Choose PDF</button>
      </div>}
      {fileNote}

      {mode === "lock" ? <div className="pdfs-sec-fields">
        <PasswordInput id={ids.password} label="Password" value={password} onChange={setPassword} show={show} onToggle={() => setShow((value) => !value)} autoComplete="new-password" disabled={busy} invalid={Boolean(showLockError) && !password} describedBy={ids.hint}/>
        <PasswordInput id={ids.confirm} label="Confirm password" value={confirm} onChange={setConfirm} show={show} onToggle={() => setShow((value) => !value)} autoComplete="new-password" disabled={busy} invalid={Boolean(showLockError) && Boolean(password)} describedBy={showLockError ? ids.error : undefined}/>
        <p id={ids.hint} className="pdfs-sec-hint">
          {strength ? <span className={`pdfs-sec-strength is-${strength}`}>{strength === "weak" ? "Weak" : strength === "fair" ? "Fair" : "Strong"}</span> : null}
          At least {MIN_PASSWORD_LENGTH} characters. Longer passphrases are much harder to guess. Anyone with the password can open and edit the PDF.
        </p>
      </div>
      : <div className="pdfs-sec-fields is-single">
        <PasswordInput id={ids.password} label={unlockLabel} value={password} onChange={setPassword} show={show} onToggle={() => setShow((value) => !value)} autoComplete="off" disabled={busy || check?.status === "plain"} describedBy={ids.hint}/>
        <p id={ids.hint} className="pdfs-sec-hint">{check?.status === "restricted" ? "This PDF opens freely, but its author restricted printing, copying or editing. Removing that needs the permissions password." : "Enter the password used to open the PDF. You need to know it — PDF Studio can't bypass or recover passwords."}</p>
      </div>}

      {showLockError && <p id={ids.error} className="pdfs-field-error" role="alert">{lockProblem}</p>}
      {error && <p className="pdfs-sec-note is-error" role="alert"><AlertTriangle size={13}/>{error}</p>}
      {stage && <div className="pdfs-sec-progress" role="status" aria-live="polite"><span><Loader2 size={13} className="pdfs-spin"/>{STAGE_LABELS[mode][stage]}{percent !== null ? ` ${percent}%` : ""}</span><span className="pdfs-progress"><i className={percent === null ? "is-indeterminate" : ""} style={percent === null ? undefined : { width: `${percent}%` }}/></span></div>}

      <div className="pdfs-sec-actions">
        <button type="submit" className="section-add-button" disabled={!canSubmit} aria-disabled={!canSubmit}>{busy ? <><Loader2 size={14} className="pdfs-spin"/> Working…</> : mode === "lock" ? <><LockKeyhole size={14}/> Lock PDF</> : <><KeyRound size={14}/> Unlock PDF</>}</button>
        <span className="pdfs-sec-private"><Info size={12}/> {mode === "lock" ? "Real AES-256 encryption" : "Removes the password"}, done on this device — your file isn't uploaded.</span>
      </div>
    </form>}
    <input ref={inputRef} className="hidden-file-input" type="file" accept={PDF_ACCEPT} onChange={onPick} aria-label={mode === "lock" ? "Choose a PDF to lock" : "Choose a PDF to unlock"}/>
  </div>;
}
