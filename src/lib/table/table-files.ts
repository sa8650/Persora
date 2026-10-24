// Persora Table — CSV/XLSX import and export in the browser.
//
// papaparse, read-excel-file and write-excel-file are loaded only when a member
// imports or exports (dynamic import → separate chunks). Files never leave the
// device during import: the parsed table is validated and sent to the server
// as one create request, so an import either creates the whole table or
// nothing.
import { TABLE_LIMITS } from "../../../cloudflare/table-rules.js";
import { parseCsvText, type ImportedValue, type XlsxSheet } from "../../../cloudflare/table-io.js";

export type ImportFormat = "csv" | "xlsx";

export interface ParsedImport {
  format: ImportFormat;
  fileName: string;
  sources: Array<{ name: string; rows: ImportedValue[][] }>;
  delimiter: string | null;
  errors: Array<{ row: number; message: string }>;
  /** Raw CSV text, kept so a different delimiter can be applied without re-reading the file. */
  text: string | null;
}

export class ImportFileError extends Error {}

const CSV_TYPES = new Set(["text/csv", "text/plain", "text/tab-separated-values", "application/vnd.ms-excel", "application/csv", ""]);
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function detectImportFormat(file: Pick<File, "name" | "type">): ImportFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    if (!CSV_TYPES.has(file.type)) throw new ImportFileError("This file doesn't look like CSV text.");
    return "csv";
  }
  if (name.endsWith(".xls")) throw new ImportFileError("Old .xls files aren't supported. Save the file as .xlsx or CSV and import it again.");
  if (name.endsWith(".numbers") || name.endsWith(".ods")) throw new ImportFileError("Export this file as .xlsx or CSV first, then import it.");
  throw new ImportFileError("Choose a CSV (.csv, .tsv, .txt) or Excel (.xlsx) file.");
}

async function loadPapa() {
  const module = await import("papaparse");
  return module.default;
}

export async function readImportFile(file: File): Promise<ParsedImport> {
  if (!file.size) throw new ImportFileError("This file is empty.");
  if (file.size > TABLE_LIMITS.importBytes) throw new ImportFileError(`Files can be up to ${Math.round(TABLE_LIMITS.importBytes / 1024 / 1024)} MB. Nothing was imported.`);
  const format = detectImportFormat(file);
  if (format === "csv") {
    const text = await file.text();
    if (text.includes("\u0000")) throw new ImportFileError("This file contains binary data, not CSV text.");
    const Papa = await loadPapa();
    const parsed = parseCsvText(Papa, text, "");
    return { format, fileName: file.name, sources: [{ name: baseName(file.name), rows: parsed.rows }], delimiter: parsed.delimiter, errors: parsed.errors, text };
  }
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) throw new ImportFileError("This file isn't a valid .xlsx workbook.");
  if (file.type && file.type !== XLSX_TYPE && file.type !== "application/octet-stream" && file.type !== "application/zip") throw new ImportFileError("This file isn't a valid .xlsx workbook.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  let sheets: Array<{ sheet: string; data: unknown[][] }>;
  try {
    sheets = await readXlsxFile(file) as Array<{ sheet: string; data: unknown[][] }>;
  } catch {
    throw new ImportFileError("This workbook could not be read. It may be damaged or password-protected.");
  }
  return {
    format, fileName: file.name, delimiter: null, errors: [], text: null,
    sources: sheets.map((entry) => ({ name: entry.sheet, rows: entry.data as ImportedValue[][] })),
  };
}

/** Re-parses CSV text with a delimiter the member chose. */
export async function reparseCsv(current: ParsedImport, delimiter: string): Promise<ParsedImport> {
  if (current.format !== "csv" || current.text === null) return current;
  const Papa = await loadPapa();
  const parsed = parseCsvText(Papa, current.text, delimiter);
  return { ...current, sources: [{ name: current.sources[0]?.name || "Sheet1", rows: parsed.rows }], delimiter: parsed.delimiter, errors: parsed.errors };
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, "").slice(0, 31) || "Sheet1";
}

export function safeDownloadName(name: string, extension: "csv" | "xlsx") {
  const cleaned = name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 100) || "table";
  return `${cleaned}.${extension}`;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** CSV export: values only. Cells starting with = + - @ are prefixed so spreadsheet apps don't run them. */
export async function exportCsv(rows: unknown[][], fileName: string) {
  const Papa = await loadPapa();
  const text = Papa.unparse(rows as unknown[][], { escapeFormulae: true, newline: "\r\n" });
  download(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }), fileName);
}

export async function exportXlsx(sheets: XlsxSheet[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await (writeXlsxFile as unknown as (sheets: XlsxSheet[]) => { toBlob(): Promise<Blob> })(sheets).toBlob();
  download(blob, fileName);
}
