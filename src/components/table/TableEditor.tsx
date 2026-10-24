// Persora Table — one open table: loading, saving (server-confirmed), local
// backups, conflict handling, undo/redo and the header. The spreadsheet and
// Smart Table editors below only produce new documents; this shell decides
// what is saved and when.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CloudOff, Copy, MoreHorizontal, Pencil, Redo2, RefreshCw, Star, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import type { AppUser } from "../../types";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import { TABLE_LIMITS } from "../../../cloudflare/table-rules.js";
import {
  createTable, deleteTable, duplicateTable, getTable, getTableRevision, isGoneError, saveTableContent, tableErrorMessage, updateTableInfo,
  type TableAttachmentInfo, type TableDetail, type TableSummary,
} from "../../lib/table/table-api";
import { TableSaver, type SaveState, type TableDoc } from "../../lib/table/table-sync";
import { deleteDraft, loadDraft, saveDraft, type TableDraft } from "../../lib/table/table-drafts";
import { DocHistory } from "../../lib/table/table-history";
import { Menu, PromptDialog, newId, relativeTime } from "./table-ui";
import { KindIcon } from "./TableHome";

const SpreadsheetEditor = lazy(() => import("./SpreadsheetEditor"));
const SmartTableEditor = lazy(() => import("./SmartTableEditor"));

const POLL_MS = 30_000;
const DRAFT_THROTTLE_MS = 1000;

export type Commit = (next: TableDoc, label: string) => void;

export function docFromDetail(detail: TableDetail): TableDoc {
  if (detail.table.kind === "spreadsheet") return { kind: "spreadsheet", sheets: [...detail.sheets].sort((a, b) => a.position - b.position) };
  return { kind: "smart", meta: detail.table.meta!, records: [...detail.records].sort((a, b) => a.position - b.position) };
}

/** A copy of a document with fresh ids (used for "Save my version as a copy"). */
export function docForCopy(doc: TableDoc): TableDoc {
  if (doc.kind === "spreadsheet") return { ...doc, sheets: doc.sheets.map((sheet, index) => ({ ...sheet, id: newId(), position: index })) };
  return { ...doc, records: doc.records.map((record) => ({ ...record, id: newId() })) };
}

function sameDoc(a: TableDoc, b: TableDoc) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { status } = state;
  if (status === "saved") return <span className="tb-save is-saved" role="status" title={state.lastSavedAt ? `Saved ${relativeTime(new Date(state.lastSavedAt).toISOString())}` : "All changes saved"}><Check size={14}/> Saved</span>;
  if (status === "pending" || status === "saving") return <span className="tb-save is-saving" role="status"><span className="spinner"/> Saving…</span>;
  if (status === "retrying") return <span className="tb-save is-error" role="status"><CloudOff size={14}/> Unable to save <button type="button" className="tb-link-button" onClick={onRetry}>Retry</button></span>;
  if (status === "error") return <span className="tb-save is-error" role="status"><TriangleAlert size={14}/> Unable to save</span>;
  return <span className="tb-save is-error" role="status"><TriangleAlert size={14}/> Not saved</span>;
}

export default function TableEditor({ tableId, user, notify, canUpload, maxUploadMb, onUpgrade, onClose, onOpen, onTrashChanged }: {
  tableId: string;
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onTrashChanged?: () => void;
}) {
  const [summary, setSummary] = useState<TableSummary | null>(null);
  const [attachments, setAttachments] = useState<TableAttachmentInfo[]>([]);
  const [doc, setDoc] = useState<TableDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved", revision: 0, message: null, lastSavedAt: null });
  const [draftOffer, setDraftOffer] = useState<{ draft: TableDraft; compatible: boolean } | null>(null);
  const [confirm, setConfirm] = useState<null | "discard-draft" | "load-latest" | "delete">(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);

  const docRef = useRef<TableDoc | null>(null);
  const saverRef = useRef<TableSaver | null>(null);
  const historyRef = useRef(new DocHistory<TableDoc>(100));
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryRef = useRef<TableSummary | null>(null);
  summaryRef.current = summary;

  // ---- load ------------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    getTable(tableId, controller.signal).then(async (detail) => {
      const serverDoc = docFromDetail(detail);
      saverRef.current?.dispose();
      const saver = new TableSaver({
        revision: detail.table.revision, saved: serverDoc,
        send: (batch) => saveTableContent(tableId, batch),
        onState: (state) => setSaveState(state),
        onSaved: (_doc, result) => setSummary((current) => current ? { ...current, ...result.table, meta: undefined } : result.table),
      });
      saverRef.current = saver;
      historyRef.current.clear();
      docRef.current = serverDoc;
      setSummary(detail.table);
      setAttachments(detail.attachments);
      setDoc(serverDoc);
      setSaveState(saver.snapshot);
      setHistoryTick((tick) => tick + 1);
      const draft = await loadDraft(user.id, tableId).catch(() => null);
      if (controller.signal.aborted) return;
      if (draft && draft.doc.kind === serverDoc.kind && !sameDoc(draft.doc, serverDoc)) setDraftOffer({ draft, compatible: draft.baseRevision === detail.table.revision });
      else if (draft) void deleteDraft(user.id, tableId);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadError(isGoneError(error) ? "This table isn't in your account. It may have been deleted (check Trash) or the link is wrong." : tableErrorMessage(error, "This table couldn't be loaded. Check your connection and try again."));
    });
    return () => controller.abort();
  }, [tableId, reloadKey, user.id]);

  useEffect(() => () => { saverRef.current?.dispose(); if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  // ---- local backup of unsaved edits ------------------------------------------
  const writeDraft = useCallback(() => {
    const saver = saverRef.current; const current = docRef.current; const info = summaryRef.current;
    if (!saver || !current || !info) return;
    if (saver.hasUnsaved) void saveDraft({ tableId, userId: user.id, name: info.name, baseRevision: saver.currentRevision, savedAt: Date.now(), doc: current });
    else void deleteDraft(user.id, tableId);
  }, [tableId, user.id]);
  useEffect(() => {
    if (saveState.status === "saved" && saverRef.current && !saverRef.current.hasUnsaved) void deleteDraft(user.id, tableId);
    if (saveState.status === "conflict" || saveState.status === "gone" || saveState.status === "retrying" || saveState.status === "error") writeDraft();
  }, [saveState.status, tableId, user.id, writeDraft]);

  // ---- committing edits ----------------------------------------------------------
  const commit = useCallback<Commit>((next, label) => {
    const previous = docRef.current;
    if (!previous || next === previous) return;
    historyRef.current.push(previous, label);
    docRef.current = next;
    setDoc(next);
    setHistoryTick((tick) => tick + 1);
    saverRef.current?.update(next);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(writeDraft, DRAFT_THROTTLE_MS);
  }, [writeDraft]);

  const travel = useCallback((direction: "undo" | "redo") => {
    const current = docRef.current;
    if (!current) return;
    const entry = direction === "undo" ? historyRef.current.undo(current) : historyRef.current.redo(current);
    if (!entry) return;
    docRef.current = entry.doc;
    setDoc(entry.doc);
    setHistoryTick((tick) => tick + 1);
    saverRef.current?.update(entry.doc);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(writeDraft, DRAFT_THROTTLE_MS);
  }, [writeDraft]);

  // Undo/redo shortcuts when focus isn't in a text field (fields keep their own undo).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']"))) return;
      if (document.querySelector(".modal-backdrop")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) { event.preventDefault(); travel("undo"); }
      else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); travel("redo"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [travel]);

  // ---- leaving, focus and polling ---------------------------------------------------
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!saverRef.current?.hasUnsaved) return;
      writeDraft();
      event.preventDefault();
      event.returnValue = "";
    };
    const onHidden = () => { if (document.visibilityState === "hidden") { writeDraft(); void saverRef.current?.flush(); } else void poll(); };
    const poll = async () => {
      const saver = saverRef.current;
      if (!saver || document.visibilityState === "hidden") return;
      try {
        const head = await getTableRevision(tableId);
        if (!saver.isBehind(head.revision)) return;
        if (saver.hasUnsaved) { setRemoteNotice("This table was changed in another tab or on another device."); void saver.flush(); return; }
        const detail = await getTable(tableId);
        const fresh = docFromDetail(detail);
        if (saverRef.current !== saver || saver.hasUnsaved) return;
        saver.reset(fresh, detail.table.revision);
        historyRef.current.clear();
        docRef.current = fresh;
        setDoc(fresh);
        setSummary(detail.table);
        setAttachments(detail.attachments);
        setHistoryTick((tick) => tick + 1);
        setRemoteNotice("Updated with changes made in another tab or on another device.");
      } catch (error) {
        if (isGoneError(error)) setRemoteNotice("This table is no longer in your account. It may have been deleted elsewhere.");
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("focus", poll);
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("focus", poll);
      clearInterval(interval);
    };
  }, [tableId, writeDraft]);

  // ---- actions ------------------------------------------------------------------------
  const close = async () => {
    const saver = saverRef.current;
    if (saver?.hasUnsaved) {
      writeDraft();
      await saver.flush();
      if (saverRef.current?.hasUnsaved) { notify("Some changes aren't saved yet. They're kept on this device and will be offered when you reopen this table.", "error"); }
    }
    onClose();
  };
  const saveAsCopy = async (source: TableDoc) => {
    if (!summary) return;
    setBusy("copy");
    try {
      const copy = docForCopy(source);
      const name = `${summary.name} (my version)`.slice(0, TABLE_LIMITS.nameLength);
      const table = await createTable(copy.kind === "spreadsheet" ? { id: newId(), kind: "spreadsheet", name, label: summary.label, sheets: copy.sheets } : { id: newId(), kind: "smart", name, label: summary.label, meta: copy.meta, records: copy.records });
      await deleteDraft(user.id, tableId);
      saverRef.current?.dispose();
      notify(copy.kind === "smart" && attachments.length ? "Saved your version as a new table. Attached files stay with the original table." : "Saved your version as a new table.");
      onOpen(table.id);
    } catch (error) {
      notify(tableErrorMessage(error, "Your version couldn't be saved as a copy. It's still kept on this device."), "error");
    } finally { setBusy(null); }
  };
  const loadLatest = async () => {
    await deleteDraft(user.id, tableId);
    setConfirm(null); setRemoteNotice(null); setDraftOffer(null);
    setReloadKey((key) => key + 1);
  };
  const restoreDraft = () => {
    if (!draftOffer) return;
    commit(draftOffer.draft.doc, "Restore unsaved changes");
    setDraftOffer(null);
    notify("Unsaved changes restored. Saving…");
  };
  const discardDraft = async () => {
    await deleteDraft(user.id, tableId);
    setDraftOffer(null); setConfirm(null);
    notify("Unsaved changes from this device were discarded.");
  };
  const rename = async (name: string) => {
    if (!summary) return;
    setBusy("rename");
    try { const next = await updateTableInfo(tableId, { name }); setSummary((current) => current ? { ...current, name: next.name } : current); setRenameOpen(false); notify("Table renamed."); } catch (error) {
      notify(tableErrorMessage(error, "The new name couldn't be saved."), "error");
    } finally { setBusy(null); }
  };
  const toggleStar = async () => {
    if (!summary) return;
    const starred = !summary.starred;
    setSummary({ ...summary, starred });
    try { await updateTableInfo(tableId, { starred }); } catch (error) {
      setSummary((current) => current ? { ...current, starred: !starred } : current);
      notify(tableErrorMessage(error, "The star couldn't be saved."), "error");
    }
  };
  const duplicate = async () => {
    if (!summary) return;
    if (saverRef.current?.hasUnsaved) await saverRef.current.flush();
    if (saverRef.current?.hasUnsaved) { notify("Wait until your changes are saved before duplicating.", "error"); return; }
    setBusy("duplicate");
    try { const copy = await duplicateTable(tableId, newId(), `${summary.name} copy`.slice(0, TABLE_LIMITS.nameLength)); notify("Table duplicated."); onOpen(copy.id); } catch (error) {
      notify(tableErrorMessage(error, "The table couldn't be duplicated."), "error");
    } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await deleteTable(tableId);
      saverRef.current?.dispose();
      await deleteDraft(user.id, tableId);
      notify("Moved to Trash. You can restore it for 7 days.");
      onTrashChanged?.();
      onClose();
    } catch (error) {
      notify(tableErrorMessage(error, "The table couldn't be deleted."), "error");
    } finally { setBusy(null); setConfirm(null); }
  };

  const history = historyRef.current;
  const undoRedo = useMemo(() => ({ canUndo: history.canUndo, canRedo: history.canRedo, undoLabel: history.undoLabel, redoLabel: history.redoLabel }), [history, historyTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = saveState.status === "conflict" || saveState.status === "gone";

  if (loadError) return <div className="tb-editor"><div className="tb-banner is-error" role="alert"><span>{loadError}</span>
    <button type="button" className="tb-link-button" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13}/> Try again</button>
    <button type="button" className="tb-link-button" onClick={onClose}>Back to tables</button></div></div>;
  if (!summary || !doc) return <div className="tb-loading" role="status"><span className="spinner"/> Opening table…</div>;

  return <section className={`tb-editor is-${summary.kind}`} aria-label={summary.name}>
    <header className="tb-editor-head">
      <button type="button" className="tb-icon-button" onClick={() => void close()} aria-label="Back to all tables" title="All tables"><ArrowLeft size={17}/></button>
      <span className={`tb-kind-badge is-${summary.kind}`} title={summary.kind === "smart" ? "Smart Table" : "Spreadsheet"}><KindIcon kind={summary.kind}/></span>
      <button type="button" className="tb-title-button" onClick={() => setRenameOpen(true)} title="Rename"><h2>{summary.name}</h2><Pencil size={13} aria-hidden="true"/></button>
      <button type="button" className={`tb-icon-button tb-star ${summary.starred ? "is-on" : ""}`} aria-pressed={summary.starred} aria-label={summary.starred ? "Unstar table" : "Star table"} onClick={() => void toggleStar()}><Star size={16} fill={summary.starred ? "currentColor" : "none"}/></button>
      <SaveIndicator state={saveState} onRetry={() => void saverRef.current?.flush()}/>
      <span className="tb-head-spacer"/>
      <button type="button" className="tb-icon-button" onClick={() => travel("undo")} disabled={!undoRedo.canUndo || locked} aria-label={undoRedo.undoLabel ? `Undo ${undoRedo.undoLabel}` : "Undo"} title={`Undo${undoRedo.undoLabel ? ` ${undoRedo.undoLabel}` : ""} (Ctrl+Z)`}><Undo2 size={16}/></button>
      <button type="button" className="tb-icon-button" onClick={() => travel("redo")} disabled={!undoRedo.canRedo || locked} aria-label={undoRedo.redoLabel ? `Redo ${undoRedo.redoLabel}` : "Redo"} title={`Redo${undoRedo.redoLabel ? ` ${undoRedo.redoLabel}` : ""} (Ctrl+Y)`}><Redo2 size={16}/></button>
      <Menu label="More table actions" icon={<MoreHorizontal size={16}/>} align="end" items={[
        { id: "rename", label: "Rename", icon: <Pencil size={14}/>, onSelect: () => setRenameOpen(true) },
        { id: "duplicate", label: busy === "duplicate" ? "Duplicating…" : "Duplicate", icon: <Copy size={14}/>, disabled: Boolean(busy), onSelect: () => void duplicate() },
        "divider",
        { id: "delete", label: "Delete", icon: <Trash2 size={14}/>, danger: true, onSelect: () => setConfirm("delete") },
      ]}/>
    </header>

    {saveState.status === "conflict" && <div className="tb-banner is-warn" role="alert">
      <span><b>This table was changed in another tab or on another device.</b> Your latest edits were not saved over it, and they're kept on this device.</span>
      <button type="button" className="tb-secondary-button" onClick={() => setConfirm("load-latest")}>Load latest version</button>
      <button type="button" className="tb-secondary-button" disabled={busy === "copy"} onClick={() => void saveAsCopy(docRef.current!)}>{busy === "copy" ? "Saving…" : "Save my version as a copy"}</button>
    </div>}
    {saveState.status === "gone" && <div className="tb-banner is-warn" role="alert">
      <span><b>This table is no longer in your account</b> (it may have been deleted elsewhere — check Trash). Your edits are kept on this device.</span>
      <button type="button" className="tb-secondary-button" disabled={busy === "copy"} onClick={() => void saveAsCopy(docRef.current!)}>{busy === "copy" ? "Saving…" : "Save my version as a new table"}</button>
    </div>}
    {(saveState.status === "error" || saveState.status === "retrying") && saveState.message && <div className="tb-banner is-error" role="alert"><span>{saveState.message}</span>
      {saveState.status === "retrying" && <button type="button" className="tb-link-button" onClick={() => void saverRef.current?.flush()}><RefreshCw size={13}/> Retry now</button>}</div>}
    {draftOffer && <div className="tb-banner is-info" role="alert">
      <span><b>Unsaved changes from {relativeTime(new Date(draftOffer.draft.savedAt).toISOString())} were found on this device.</b> {draftOffer.compatible ? "Restore them to keep working where you left off." : "The table has changed since then, so they can only be restored as a separate copy."}</span>
      {draftOffer.compatible
        ? <button type="button" className="tb-secondary-button" onClick={restoreDraft}>Restore</button>
        : <button type="button" className="tb-secondary-button" disabled={busy === "copy"} onClick={() => void saveAsCopy(draftOffer.draft.doc)}>Restore as a copy</button>}
      <button type="button" className="tb-link-button" onClick={() => setConfirm("discard-draft")}>Discard</button>
    </div>}
    {remoteNotice && saveState.status !== "conflict" && <div className="tb-banner is-info" role="status"><span>{remoteNotice}</span><button type="button" className="tb-link-button" onClick={() => setRemoteNotice(null)}>Dismiss</button></div>}

    <Suspense fallback={<div className="tb-loading" role="status"><span className="spinner"/> Loading editor…</div>}>
      {doc.kind === "spreadsheet"
        ? <SpreadsheetEditor doc={doc} tableName={summary.name} commit={commit} readOnly={locked} notify={notify}/>
        : <SmartTableEditor doc={doc} tableId={tableId} tableName={summary.name} commit={commit} readOnly={locked} notify={notify}
          attachments={attachments} onAttachmentAdded={(info) => setAttachments((list) => [...list, info])}
          canUpload={canUpload} maxUploadMb={maxUploadMb} onUpgrade={onUpgrade}/>}
    </Suspense>

    {renameOpen && <PromptDialog id="tb-editor-rename" title="Rename table" label="Name" initial={summary.name} maxLength={TABLE_LIMITS.nameLength} busy={busy === "rename"}
      validate={(value) => (value.trim() ? null : "Enter a name.")} onCancel={() => setRenameOpen(false)} onConfirm={(value) => void rename(value.trim())}/>}
    {confirm === "discard-draft" && <ModalPortal><ConfirmDialog title="Discard unsaved changes?" confirmLabel="Discard changes" onCancel={() => setConfirm(null)} onConfirm={() => void discardDraft()}>
      <p>The edits kept on this device for “{summary.name}” will be deleted. The saved table isn't affected.</p>
    </ConfirmDialog></ModalPortal>}
    {confirm === "load-latest" && <ModalPortal><ConfirmDialog title="Load the latest version?" confirmLabel="Load latest" onCancel={() => setConfirm(null)} onConfirm={() => void loadLatest()}>
      <p>Your unsaved edits in this tab will be discarded. To keep them, choose “Save my version as a copy” instead.</p>
    </ConfirmDialog></ModalPortal>}
    {confirm === "delete" && <ModalPortal><ConfirmDialog title={`Delete “${summary.name}”?`} confirmLabel={busy === "delete" ? "Deleting…" : "Move to Trash"} onCancel={() => setConfirm(null)} onConfirm={() => void remove()}>
      <p>The table moves to Trash with all its {summary.kind === "smart" ? "records and attached files" : "sheets"}. You can restore it for 7 days.</p>
    </ConfirmDialog></ModalPortal>}
  </section>;
}
