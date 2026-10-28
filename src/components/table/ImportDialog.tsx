// Persora Table — import a CSV or Excel file as a new table: preview, header
// row choice, delimiter, validation report. Nothing is created until the
// member confirms, and then the whole table is created in one request (or
// nothing is).
import { useMemo, useRef, useState } from "react";
import { FileUp, Info, TriangleAlert } from "lucide-react";
import { TABLE_LIMITS, cleanName, fieldTypeLabel } from "../../../cloudflare/table-rules.js";
import { CSV_DELIMITERS, buildSheetImport, buildSmartImport } from "../../../cloudflare/table-io.js";
import type { CreateTableBody } from "../../lib/table/table-api";
import { ImportFileError, readImportFile, reparseCsv, type ParsedImport } from "../../lib/table/table-files";
import { TableDialog, plural } from "./table-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

type Mode = "smart" | "spreadsheet";

const previewText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value);
};

export default function ImportDialog({ busy, onClose, onImport }: {
  busy: boolean;
  onClose: () => void;
  onImport: (body: Omit<CreateTableBody, "id">, message: string) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("smart");
  const [headerRow, setHeaderRow] = useState(true);
  const [formulas, setFormulas] = useState(false);
  const [name, setName] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setReadError(null); setParsed(null);
    try {
      const result = await readImportFile(file);
      setParsed(result);
      setSheetIndex(0);
      setName(file.name.replace(/\.[^.]+$/u, "").slice(0, TABLE_LIMITS.nameLength) || "Imported table");
      setMode(result.format === "xlsx" && result.sources.length > 1 ? "spreadsheet" : "smart");
    } catch (error) {
      setReadError(error instanceof ImportFileError ? error.message : "This file couldn't be read. Nothing was imported.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  // Builds the table exactly as it will be created, so the report is honest.
  const plan = useMemo(() => {
    if (!parsed) return null;
    try {
      if (mode === "smart") {
        const source = parsed.sources[sheetIndex] || parsed.sources[0];
        const built = buildSmartImport(source.rows, { headerRow });
        return { ok: true as const, smart: built, sheet: null };
      }
      const built = buildSheetImport(parsed.sources, { headerRow, formulas });
      return { ok: true as const, smart: null, sheet: built };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : "This file can't be imported." };
    }
  }, [parsed, mode, headerRow, formulas, sheetIndex]);

  const source = parsed ? parsed.sources[sheetIndex] || parsed.sources[0] : null;
  const previewRows = (source?.rows || []).slice(0, 8);
  const previewCols = Math.min(8, Math.max(0, ...previewRows.map((row) => row.length)));
  let nameProblem: string | null = null;
  try { cleanName(name, TABLE_LIMITS.nameLength, "Table name"); } catch (error) { nameProblem = error instanceof Error ? error.message : "Enter a name."; }

  const submit = async () => {
    if (!plan?.ok || nameProblem) return;
    const tableName = name.trim();
    if (plan.smart) {
      await onImport({ kind: "smart", name: tableName, meta: plan.smart.meta, records: plan.smart.records }, `Imported ${plural(plan.smart.records.length, "record")}.`);
    } else if (plan.sheet) {
      await onImport({ kind: "spreadsheet", name: tableName, sheets: plan.sheet.sheets }, `Imported ${plural(plan.sheet.sheets.length, "sheet")}.`);
    }
  };

  return <TableDialog id="tb-import-title" title="Import a file" icon={<FileUp size={18}/>} wide busy={busy} onClose={onClose}
    footer={<>
      <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="editor-submit" onClick={() => void submit()} disabled={busy || !plan?.ok || Boolean(nameProblem)}>{busy ? <><Spinner className="size-3.5"/> Importing…</> : "Import"}</button>
    </>}>
    <div className="tb-form">
      <div className="tb-file-pick">
        <input ref={input} type="file" id="tb-import-file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void choose(event.target.files?.[0])} disabled={busy || reading}/>
        <label htmlFor="tb-import-file" className="tb-secondary-button"><FileUp size={15}/> {parsed ? "Choose another file" : "Choose a file"}</label>
        <span className="tb-muted">{reading ? "Reading…" : parsed ? parsed.fileName : `CSV (.csv, .tsv, .txt) or Excel (.xlsx), up to ${Math.round(TABLE_LIMITS.importBytes / 1024 / 1024)} MB, ${TABLE_LIMITS.importRows.toLocaleString()} rows and ${TABLE_LIMITS.importCols} columns.`}</span>
      </div>
      {readError && <p className="tb-form-error" role="alert">{readError}</p>}

      {parsed && <>
        <div className="tb-form-grid">
          <label className="tb-field"><span>Table name</span><input value={name} maxLength={TABLE_LIMITS.nameLength} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(nameProblem)}/></label>
          <fieldset className="tb-field tb-radio-row"><legend>Import as</legend>
            <label><input type="radio" name="tb-import-mode" checked={mode === "smart"} onChange={() => setMode("smart")}/> Smart Table</label>
            <label><input type="radio" name="tb-import-mode" checked={mode === "spreadsheet"} onChange={() => setMode("spreadsheet")}/> Spreadsheet</label>
          </fieldset>
          {parsed.format === "csv" && <label className="tb-field"><span>Delimiter</span>
            <select value={CSV_DELIMITERS.find((entry) => entry.value === parsed.delimiter)?.value ?? ""} onChange={(event) => void reparseCsv(parsed, event.target.value).then(setParsed)}>
              {CSV_DELIMITERS.map((entry) => <option key={entry.id} value={entry.value}>{entry.label}{entry.value === "" && parsed.delimiter ? ` (found ${CSV_DELIMITERS.find((d) => d.value === parsed.delimiter)?.label.toLowerCase() || parsed.delimiter})` : ""}</option>)}
            </select>
          </label>}
          {mode === "smart" && parsed.sources.length > 1 && <label className="tb-field"><span>Sheet</span>
            <select value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>{parsed.sources.map((entry, index) => <option key={index} value={index}>{entry.name}</option>)}</select>
          </label>}
        </div>
        <div className="tb-check-row">
          <label><Checkbox checked={headerRow} onCheckedChange={(checked) => setHeaderRow(checked === true)}/> First row is a header</label>
          {mode === "spreadsheet" && parsed.format === "csv" && <label><Checkbox checked={formulas} onCheckedChange={(checked) => setFormulas(checked === true)}/> Treat cells starting with “=” as formulas</label>}
        </div>

        {previewCols > 0 ? <div className="tb-preview-wrap">
          <table className="tb-preview">
            <caption className="tb-visually-hidden">Preview of the first rows</caption>
            <tbody>{previewRows.map((row, r) => <tr key={r} className={headerRow && r === 0 ? "is-header" : ""}>
              {Array.from({ length: previewCols }, (_, c) => <td key={c}>{previewText(row[c])}</td>)}
            </tr>)}</tbody>
          </table>
        </div> : <p className="tb-muted">This {parsed.format === "csv" ? "file" : "sheet"} has no data.</p>}

        {plan && !plan.ok && <p className="tb-form-error" role="alert"><TriangleAlert size={14}/> {plan.message}</p>}
        {plan?.ok && plan.smart && <div className="tb-report" aria-live="polite">
          <p><b>{plural(plan.smart.report.rows, "record")}</b> and <b>{plural(plan.smart.report.columns, "field")}</b> will be created.
            {plan.smart.report.emptyRowsSkipped > 0 && ` ${plural(plan.smart.report.emptyRowsSkipped, "empty row")} skipped.`}</p>
          <ul className="tb-type-list">{plan.smart.report.types.map((entry, index) => <li key={index}><span>{entry.name}</span><small>{fieldTypeLabel(entry.type)}</small></li>)}</ul>
          {plan.smart.report.kept.length > 0 && <p className="tb-hint"><Info size={13}/> {plural(plan.smart.report.kept.length, "value")} didn't match a column's type and will be kept exactly as written (marked for review), for example row {plan.smart.report.kept[0].row} “{plan.smart.report.kept[0].value}” in {plan.smart.report.kept[0].field}.</p>}
          {plan.smart.report.columns > TABLE_LIMITS.fields && <p className="tb-hint"><Info size={13}/> Smart Tables allow {TABLE_LIMITS.fields} fields. Import this file as a spreadsheet instead.</p>}
        </div>}
        {plan?.ok && plan.sheet && <div className="tb-report" aria-live="polite">
          <p>{plan.sheet.report.sheets.map((entry) => `${entry.name}: ${plural(entry.rows, "row")} × ${plural(entry.columns, "column")}`).join(" · ")}</p>
          {plan.sheet.report.emptySheets > 0 && <p className="tb-hint"><Info size={13}/> {plural(plan.sheet.report.emptySheets, "empty sheet")} will be created empty.</p>}
          {plan.sheet.report.formulasAsText > 0 && <p className="tb-hint"><Info size={13}/> {plural(plan.sheet.report.formulasAsText, "cell")} starting with “=” will be kept as text. Tick the option above to import them as formulas.</p>}
          {parsed.format === "xlsx" && <p className="tb-hint"><Info size={13}/> Excel formulas, formatting and merged cells aren't read — each cell imports as its last calculated value.</p>}
        </div>}
        {parsed.errors.length > 0 && <p className="tb-hint"><TriangleAlert size={13}/> {plural(parsed.errors.length, "row")} had quoting problems and were read as best as possible (first: row {parsed.errors[0].row}, {parsed.errors[0].message}).</p>}
      </>}
    </div>
  </TableDialog>;
}
