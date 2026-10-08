import { AlertTriangle, CheckCircle2, LoaderCircle, RotateCcw, ScanLine, Sparkles } from "lucide-react";
import type { SmartScanFieldResult, SmartScanResult } from "../types";

export const SMART_SCAN_MAX_FILE_BYTES = 7 * 1024 * 1024;
export function isSmartScanFileSizeAllowed(size?: number) { return size === undefined || (size > 0 && size <= SMART_SCAN_MAX_FILE_BYTES); }

export function supportsSmartScanFile(file?: { type?: string; name?: string } | null) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase().split(";")[0];
  const extension = (file.name || "").toLowerCase().split(".").pop();
  const supportedTypes = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/tiff", "image/tif", "image/bmp"];
  if (type && type !== "application/octet-stream") return supportedTypes.includes(type);
  return ["pdf", "jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp"].includes(extension || "");
}

interface SmartScanActionPanelProps {
  fileName: string;
  canScan: boolean;
  busy: boolean;
  error: string;
  result: SmartScanResult | null;
  onScan: (retry: boolean) => void;
  unavailableMessage?: string;
}

export function SmartScanActionPanel({ fileName, canScan, busy, error, result, onScan, unavailableMessage }: SmartScanActionPanelProps) {
  const fieldEntries = Object.values(result?.fields || {});
  const filledCount = fieldEntries.filter((field) => Boolean(field.value)).length;
  const reviewCount = fieldEntries.filter((field) => field.confidence === "low").length;
  const retry = Boolean(error || result);

  return <section className={`smart-scan-panel ${busy ? "is-scanning" : ""}`} aria-label="Smart Scan document extraction">
    <div className="smart-scan-topline">
      <span className="smart-scan-icon"><ScanLine size={16}/><i/></span>
      <span className="smart-scan-copy"><b>Smart Scan <small>AI</small></b><span>{fileName}</span></span>
      <button type="button" className="smart-scan-button" onClick={() => onScan(retry)} disabled={!canScan || busy}>
        {busy ? <LoaderCircle className="smart-scan-button-spinner" size={14}/> : error ? <RotateCcw size={14}/> : <Sparkles size={14}/>}
        {busy ? "Scanning…" : error ? "Retry scan" : result ? "Scan again" : "Scan"}
      </button>
    </div>
    {busy && <div className="smart-scan-running" role="status" aria-live="polite">
      <span className="smart-scan-document"><ScanLine size={19}/><i/></span>
      <span><b>Reading your document</b><small>Secure OCR and field suggestions are running…</small></span>
      <span className="smart-scan-running-dots" aria-hidden="true"><i/><i/><i/></span>
    </div>}
    {!canScan && <p className="smart-scan-unavailable">{unavailableMessage || "Smart Scan needs an online, connected Persora account."}</p>}
    {error && <div className="smart-scan-error" role="alert"><AlertTriangle size={14}/><span>{error}</span></div>}
    {result && <div className="smart-scan-result" role="status">
      <span className="smart-scan-result-icon"><CheckCircle2 size={14}/></span>
      <span><b>{result.documentType ? `${result.documentTypeConfidence === "low" ? "Possible: " : ""}${result.documentType}` : "Document scan complete"}</b><small>{filledCount} suggested field{filledCount === 1 ? "" : "s"} · {reviewCount ? `${reviewCount} need review` : "review before saving"}{result.cached ? " · cached result" : result.ocrCached ? " · OCR reused" : ""}</small></span>
      {result.warnings.length > 0 && <span className="smart-scan-warnings">{result.warnings.map((warning, index) => <small key={`${warning}-${index}`}>{warning}</small>)}</span>}
      {result.cacheWarning && <small className="smart-scan-cache-warning">{result.cacheWarning}</small>}
    </div>}
  </section>;
}

export function SmartScanFieldNote({ field, currentValue, onApply, allowApply = true }: { field?: SmartScanFieldResult; currentValue: string; onApply: (value: string) => void; allowApply?: boolean }) {
  if (!field) return null;
  if (!field.value) return <span className="smart-scan-field-note is-uncertain"><AlertTriangle size={11}/><span>Needs review{field.reason ? ` · ${field.reason}` : " · No verified value was filled."}</span></span>;
  const alreadyApplied = currentValue.trim() === field.value;
  const lowConfidence = field.confidence === "low";
  const evidence = field.evidence ? ` · “${field.evidence.slice(0, 110)}${field.evidence.length > 110 ? "…" : ""}”` : "";
  return <span className={`smart-scan-field-note ${lowConfidence ? "is-uncertain" : field.confidence === "high" ? "is-confident" : "is-medium"}`}>
    {lowConfidence ? <AlertTriangle size={11}/> : <CheckCircle2 size={11}/>}<span>{lowConfidence ? `Low-confidence suggestion · “${field.value}” · verify` : `Scan suggestion · ${field.confidence}`}{evidence}</span>
    {allowApply && !alreadyApplied && <button type="button" onClick={() => onApply(field.value)}>Use suggestion</button>}
  </span>;
}
