// Persora PDF Studio — PDF Security (Lock / Unlock).
//
// Real PDF encryption, not a viewer-side lock: files are encrypted with the
// PDF standard security handler by qpdf (Apache-2.0) compiled to WebAssembly,
// running in a Web Worker on this device. Locking writes AES-256 (PDF 2.0 /
// ISO 32000-2 "R6"), which Adobe Acrobat/Reader 9+, Chrome, Edge, Firefox,
// Safari/Preview, pdf.js, Poppler, MuPDF and qpdf all open after asking for
// the password. Nothing leaves the browser.
//
// This module holds the engine-independent logic (validation, inspection,
// verification and error wording) so it can be tested in Node with the very
// same qpdf build. `pdf-qpdf.ts` supplies the browser engine.

import { PDF_OPEN_MAX_BYTES, PdfProcessingError, formatBytes, pdfDownloadName, titleFromFileName } from "./pdf-studio";

/** Same ceiling as the editor: qpdf keeps input + output in worker memory (~6× the file at peak). */
export const SECURITY_MAX_BYTES = PDF_OPEN_MAX_BYTES;
export const MIN_PASSWORD_LENGTH = 6;
/** AES-256 (R6) only uses the first 127 UTF-8 bytes of a password; longer ones would be silently cut. */
export const MAX_PASSWORD_BYTES = 127;

/** The part of @mssio/qpdf-wasm's API this module relies on (`run` = raw qpdf with a virtual file system). */
export interface QpdfEngine {
  run(args: string[], options: { files: Record<string, Uint8Array>; onProgress?: (percent: number) => void }): Promise<{ exitCode: number; stdout: string; stderr: string; files: Record<string, Uint8Array | undefined> }>;
}

export type SecurityErrorKind = "wrong-password" | "owner-password-required" | "already-protected" | "not-protected" | "damaged" | "unsupported" | "too-large" | "not-pdf" | "engine" | "verify" | "failed";

export class PdfSecurityError extends PdfProcessingError {
  readonly kind: SecurityErrorKind;
  constructor(kind: SecurityErrorKind, message: string) { super(message); this.name = "PdfSecurityError"; this.kind = kind; }
}

export interface EncryptionReport {
  encrypted: boolean;
  /** Whether the password used for this inspection is the user (open) / owner (permissions) password. */
  userPasswordMatched: boolean;
  ownerPasswordMatched: boolean;
  /** qpdf's names: "AESv3" (AES-256), "AESv2" (AES-128), "RC4", "none". */
  method: string | null;
  bits: number | null;
  revision: number | null;
  /** True when the author switched off printing, copying, editing or similar. */
  restricted: boolean;
  pdfVersion: string;
  pageCount: number;
}

export type Inspection = { status: "ok"; report: EncryptionReport } | { status: "needs-password" };

export interface SecurityResult {
  bytes: Uint8Array;
  fileName: string;
  /** Encryption of the input (unlock) or of the output (lock). */
  report: EncryptionReport;
  pageCount: number;
  /** qpdf repaired minor structural problems while rewriting the file. */
  repaired: boolean;
}

export type SecurityStage = "check" | "encrypt" | "decrypt" | "verify";
export interface SecurityHooks { onStage?: (stage: SecurityStage) => void; onProgress?: (percent: number) => void }

const INPUT = "in.pdf";
const OUTPUT = "out.pdf";
const JOB = "job.json";

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** Error for a new Lock password, or "" when it can be used. */
export function validateNewPassword(password: string, confirm: string): string {
  if (!password) return "Enter a password.";
  if ([...password].length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (utf8Length(password) > MAX_PASSWORD_BYTES) return "That password is too long for PDF encryption. Use a shorter one (up to about 120 letters).";
  if (/[\u0000-\u001f\u007f]/.test(password)) return "The password can't contain line breaks or control characters.";
  if (password !== confirm) return confirm ? "The passwords don't match." : "Type the password again to confirm it.";
  return "";
}

export type PasswordStrength = "weak" | "fair" | "strong";
/** A rough guide only (length and variety) — shown next to the field, never enforced beyond the minimum. */
export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (length >= 14 || (length >= 10 && classes >= 3)) return "strong";
  if (length >= 8 && classes >= 2) return "fair";
  return "weak";
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export function lockedFileName(name: string): string { return pdfDownloadName(titleFromFileName(name), " (locked)"); }
export function unlockedFileName(name: string): string { return pdfDownloadName(titleFromFileName(name).replace(/\s*\(locked\)$/i, ""), " (unlocked)"); }

/** Rejects files that can't be processed before any work starts. */
export function checkSecurityInput(bytes: Uint8Array, name: string): void {
  if (!bytes.byteLength) throw new PdfSecurityError("not-pdf", `“${name}” is empty.`);
  if (bytes.byteLength > SECURITY_MAX_BYTES) throw new PdfSecurityError("too-large", `“${name}” is ${formatBytes(bytes.byteLength)}. PDF Security handles files up to ${formatBytes(SECURITY_MAX_BYTES)} in the browser.`);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new PdfSecurityError("not-pdf", `“${name}” isn't a PDF. Choose a .pdf file.`);
}

// ---------------------------------------------------------------------------
// qpdf plumbing
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();

/** Turns qpdf's stderr (or a thrown QpdfError) into a clear, specific message. */
export function classifyQpdfFailure(stderr: string, name: string): PdfSecurityError {
  const text = stderr || "";
  if (/: invalid password\s*$/m.test(text)) return new PdfSecurityError("wrong-password", "That password isn't correct. Check it and try again — passwords are case-sensitive.");
  if (/unsupported encryption filter|unknown security handler|Unsupported \/R or \/V|unsupported encryption|PubSec|certificate/i.test(text)) {
    return new PdfSecurityError("unsupported", `“${name}” uses an encryption method PDF Studio can't open (for example certificate-based or a custom security handler). Open it in the app that created it to remove the protection.`);
  }
  if (/failed to load qpdf\.wasm|worker failed to start|Web Workers are not available|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(text)) {
    return new PdfSecurityError("engine", "The PDF security engine couldn't load. Check your connection and reload the page, then try again.");
  }
  if (/out of memory|Cannot enlarge memory|memory access out of bounds|Aborted\(/i.test(text)) {
    return new PdfSecurityError("too-large", `“${name}” is too large or complex to process in this browser tab. Try a smaller file or a desktop browser.`);
  }
  if (/can't find PDF header|unable to find trailer|can't find startxref|file is damaged|not a PDF|xref|offset \d+|EOF/i.test(text)) {
    return new PdfSecurityError("damaged", `“${name}” is damaged or isn't a valid PDF, so it couldn't be processed.`);
  }
  const detail = text.split("\n").map((line) => line.replace(/^qpdf:\s*/, "").replace(/^in\.pdf:?\s*/, "").trim()).filter(Boolean).pop();
  return new PdfSecurityError("failed", `“${name}” couldn't be processed${detail ? ` (${detail})` : ""}.`);
}

async function runJob(engine: QpdfEngine, job: Record<string, unknown>, input: Uint8Array, name: string, onProgress?: (percent: number) => void) {
  let result: Awaited<ReturnType<QpdfEngine["run"]>>;
  try {
    // The engine transfers its inputs to the worker, so always hand it a private copy.
    result = await engine.run([`--job-json-file=${JOB}`], { files: { [INPUT]: input.slice(), [JOB]: encoder.encode(JSON.stringify(job)) }, onProgress });
  } catch (error) {
    throw classifyQpdfFailure(error instanceof Error ? error.message : String(error), name);
  }
  // qpdf: 0 = success, 3 = success with warnings (e.g. a repaired xref table), 2 = error.
  if (result.exitCode !== 0 && result.exitCode !== 3) throw classifyQpdfFailure(result.stderr, name);
  return result;
}

interface QpdfJson {
  qpdf?: [{ pdfversion?: string }];
  pages?: unknown[];
  encrypt?: {
    encrypted?: boolean;
    userpasswordmatched?: boolean;
    ownerpasswordmatched?: boolean;
    capabilities?: Record<string, boolean>;
    parameters?: { method?: string; bits?: number; R?: number };
  };
}

export function parseEncryptionJson(stdout: string): EncryptionReport {
  let json: QpdfJson;
  try { json = JSON.parse(stdout) as QpdfJson; } catch { throw new PdfSecurityError("failed", "The PDF couldn't be inspected."); }
  const encrypt = json.encrypt || {};
  const capabilities = encrypt.capabilities || {};
  const encrypted = Boolean(encrypt.encrypted);
  return {
    encrypted,
    userPasswordMatched: Boolean(encrypt.userpasswordmatched),
    ownerPasswordMatched: Boolean(encrypt.ownerpasswordmatched),
    method: encrypted ? encrypt.parameters?.method || null : null,
    bits: encrypted ? encrypt.parameters?.bits ?? null : null,
    revision: encrypted ? encrypt.parameters?.R ?? null : null,
    restricted: encrypted && Object.values(capabilities).some((allowed) => allowed === false),
    pdfVersion: json.qpdf?.[0]?.pdfversion || "",
    pageCount: Array.isArray(json.pages) ? json.pages.length : 0,
  };
}

/** Reads a PDF's encryption (and page count) with qpdf. Without the needed password it reports `needs-password`. */
export async function inspectPdf(engine: QpdfEngine, bytes: Uint8Array, name: string, password?: string): Promise<Inspection> {
  const job = { inputFile: INPUT, json: "2", jsonKey: ["qpdf", "pages", "encrypt"], jsonObject: ["trailer"], ...(password === undefined ? {} : { password }) };
  try {
    const result = await runJob(engine, job, bytes, name);
    return { status: "ok", report: parseEncryptionJson(result.stdout) };
  } catch (error) {
    if (error instanceof PdfSecurityError && error.kind === "wrong-password" && password === undefined) return { status: "needs-password" };
    throw error;
  }
}

/** Human description of an encryption method, e.g. "AES-256". */
export function describeEncryption(report: Pick<EncryptionReport, "encrypted" | "method" | "bits">): string {
  if (!report.encrypted) return "Not encrypted";
  switch (report.method) {
    case "AESv3": return "AES-256";
    case "AESv2": return "AES-128";
    case "RC4": return `RC4 ${report.bits || 40}-bit`;
    default: return report.method || "Encrypted";
  }
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------
/**
 * Encrypts a PDF with AES-256 so it can't be opened without `password`, then
 * re-reads the result to prove it: the output must refuse to open without the
 * password, open with it as AES-256 R6, and have the same number of pages.
 * The password is both the open (user) and permissions (owner) password, so
 * whoever knows it has full access — including removing it again.
 */
export async function lockPdf(engine: QpdfEngine, bytes: Uint8Array, name: string, password: string, hooks: SecurityHooks = {}): Promise<SecurityResult> {
  checkSecurityInput(bytes, name);
  const problem = validateNewPassword(password, password);
  if (problem) throw new PdfSecurityError("failed", problem);

  hooks.onStage?.("check");
  const before = await inspectPdf(engine, bytes, name);
  if (before.status === "needs-password") throw new PdfSecurityError("already-protected", `“${name}” already needs a password to open. Unlock it first if you want to set a new one.`);
  if (before.report.encrypted) {
    throw new PdfSecurityError("already-protected", `“${name}” is already encrypted with permission restrictions set by its author. Use Unlock with its permissions password first, then lock it with your own password.`);
  }
  if (before.report.pageCount < 1) throw new PdfSecurityError("damaged", `“${name}” has no pages.`);

  hooks.onStage?.("encrypt");
  const job = { inputFile: INPUT, outputFile: OUTPUT, encrypt: { userPassword: password, ownerPassword: password, "256bit": {} }, ...(hooks.onProgress ? { progress: "" } : {}) };
  const result = await runJob(engine, job, bytes, name, hooks.onProgress);
  const output = result.files[OUTPUT];
  if (!output?.byteLength) throw new PdfSecurityError("failed", `“${name}” couldn't be encrypted — qpdf produced no file.`);

  hooks.onStage?.("verify");
  const withoutPassword = await inspectPdf(engine, output, name);
  if (withoutPassword.status !== "needs-password") throw new PdfSecurityError("verify", "The locked file didn't pass verification (it opened without a password), so it wasn't offered for download. Please try again.");
  const withPassword = await inspectPdf(engine, output, name, password);
  if (withPassword.status !== "ok") throw new PdfSecurityError("verify", "The locked file didn't pass verification, so it wasn't offered for download. Please try again.");
  const report = withPassword.report;
  if (!report.encrypted || report.method !== "AESv3" || report.bits !== 256 || !report.userPasswordMatched || report.pageCount !== before.report.pageCount) {
    throw new PdfSecurityError("verify", "The locked file didn't pass verification (unexpected encryption or page count), so it wasn't offered for download.");
  }
  return { bytes: output, fileName: lockedFileName(name), report, pageCount: report.pageCount, repaired: result.exitCode === 3 };
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------
/**
 * What Unlock needs before it can run: `"open"` for an ordinary password,
 * `"permissions"` for files that open freely but carry author restrictions.
 */
export type UnlockRequirement = { kind: "not-protected"; report: EncryptionReport } | { kind: "open" } | { kind: "permissions"; report: EncryptionReport };

export async function unlockRequirement(engine: QpdfEngine, bytes: Uint8Array, name: string): Promise<UnlockRequirement> {
  checkSecurityInput(bytes, name);
  const inspection = await inspectPdf(engine, bytes, name);
  if (inspection.status === "needs-password") return { kind: "open" };
  return inspection.report.encrypted ? { kind: "permissions", report: inspection.report } : { kind: "not-protected", report: inspection.report };
}

/**
 * Removes encryption with the correct password and checks the result opens
 * without one. Restrictions set by an author (a separate permissions/owner
 * password) are only removed with that permissions password — the open
 * password alone isn't enough.
 */
export async function unlockPdf(engine: QpdfEngine, bytes: Uint8Array, name: string, password: string, hooks: SecurityHooks = {}): Promise<SecurityResult> {
  checkSecurityInput(bytes, name);
  hooks.onStage?.("check");
  const requirement = await unlockRequirement(engine, bytes, name);
  if (requirement.kind === "not-protected") throw new PdfSecurityError("not-protected", `“${name}” isn't password-protected, so there's nothing to remove.`);
  if (!password) throw new PdfSecurityError("wrong-password", requirement.kind === "permissions" ? "Enter the permissions password." : "Enter the password.");

  let checked: Inspection;
  try {
    checked = await inspectPdf(engine, bytes, name, password);
  } catch (error) {
    // The file opens without a password, so what was entered must be its permissions password.
    if (error instanceof PdfSecurityError && error.kind === "wrong-password" && requirement.kind === "permissions") {
      throw new PdfSecurityError("owner-password-required", "That isn't this PDF's permissions (owner) password. Its author restricted it, and only that password can remove the protection — passwords are case-sensitive.");
    }
    throw error;
  }
  if (checked.status !== "ok") throw new PdfSecurityError("wrong-password", "That password isn't correct.");
  const report = checked.report;
  if (requirement.kind === "permissions" && !report.ownerPasswordMatched) {
    throw new PdfSecurityError("owner-password-required", "This PDF opens without a password but its author restricted it. Enter its permissions (owner) password to remove the protection.");
  }
  if (!report.ownerPasswordMatched && report.restricted) {
    throw new PdfSecurityError("owner-password-required", "That password opens the PDF, but its author also set a separate permissions password to restrict it. Enter the permissions (owner) password to remove the protection.");
  }

  hooks.onStage?.("decrypt");
  const job = { inputFile: INPUT, outputFile: OUTPUT, decrypt: "", password, ...(hooks.onProgress ? { progress: "" } : {}) };
  const result = await runJob(engine, job, bytes, name, hooks.onProgress);
  const output = result.files[OUTPUT];
  if (!output?.byteLength) throw new PdfSecurityError("failed", `“${name}” couldn't be unlocked — qpdf produced no file.`);

  hooks.onStage?.("verify");
  const after = await inspectPdf(engine, output, name);
  if (after.status !== "ok" || after.report.encrypted || after.report.pageCount !== report.pageCount) {
    throw new PdfSecurityError("verify", "The unlocked file didn't pass verification, so it wasn't offered for download. Please try again.");
  }
  return { bytes: output, fileName: unlockedFileName(name), report, pageCount: after.report.pageCount, repaired: result.exitCode === 3 };
}
