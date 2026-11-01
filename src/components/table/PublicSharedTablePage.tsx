// Full-Screen Public Shared Table Page (/SharedTable/:token)
// Renders a dedicated Google Sheets–style spreadsheet / Smart Table view with
// zero private workspace navigation, supporting Viewer, Commenter, and Editor links.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./table.css";
import {
  ArrowUpRight,
  Check,
  CloudOff,
  Database,
  Eye,
  MessageSquare,
  Pencil,
  Redo2,
  RefreshCw,
  Sheet as SheetIcon,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { AppUser } from "../../types";
import { PersoraMark } from "../PersoraLogo";
import {
  getPublicSharedTable,
  postPublicTableCellComment,
  postPublicTableThreadComment,
  savePublicTableContent,
  tableErrorMessage,
  type PublicSharedTableDetail,
  type SaveResult,
  type TableThreadComment,
} from "../../lib/table/table-api";
import { TableSaver, type SaveState, type TableDoc } from "../../lib/table/table-sync";
import { DocHistory } from "../../lib/table/table-history";
import { docFromDetail, type Commit } from "./TableEditor";
import TableCommentsPanel, { extractSheetCellComments } from "./TableCommentsPanel";
import { ThemeToggleButton } from "@/design-system/theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";
import { PersoraEmptyState } from "@/design-system";

const SpreadsheetEditor = lazy(() => import("./SpreadsheetEditor"));
const SmartTableEditor = lazy(() => import("./SmartTableEditor"));

const noopCommit: Commit = () => {
  /* Read-only / comment-only links never commit direct cell or structural mutations */
};

export default function PublicSharedTablePage({
  token,
  signedInUser,
  notify,
  onSignIn,
  onCreateAccount,
  onOpenWorkspace,
}: {
  token: string;
  signedInUser: AppUser | null;
  notify: (message: string, kind?: "success" | "error") => void;
  onSignIn: () => void;
  onCreateAccount: () => void;
  onOpenWorkspace: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicSharedTableDetail | null>(null);
  const [doc, setDoc] = useState<TableDoc | null>(null);
  const [comments, setComments] = useState<TableThreadComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({
    status: "saved",
    revision: 0,
    message: null,
    lastSavedAt: null,
  });
  const [historyTick, setHistoryTick] = useState(0);

  const docRef = useRef<TableDoc | null>(null);
  const saverRef = useRef<TableSaver | null>(null);
  const historyRef = useRef(new DocHistory<TableDoc>(100));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailableMessage(null);
    getPublicSharedTable(token, controller.signal)
      .then((res) => {
        const serverDoc = docFromDetail(res);
        saverRef.current?.dispose();
        if (res.permission === "edit") {
          const saver = new TableSaver({
            revision: res.table.revision,
            saved: serverDoc,
            send: async (batch) => {
              const saved = await savePublicTableContent(token, batch);
              return saved as unknown as SaveResult;
            },
            onState: (state) => setSaveState(state),
            onSaved: (_doc, result) => {
              setDetail((prev) =>
                prev
                  ? {
                      ...prev,
                      table: {
                        ...prev.table,
                        revision: result.table.revision,
                        sheetCount: result.table.sheetCount,
                        recordCount: result.table.recordCount,
                        updatedAt: result.table.updatedAt,
                      },
                    }
                  : prev,
              );
            },
          });
          saverRef.current = saver;
          setSaveState(saver.snapshot);
        } else {
          saverRef.current = null;
          setSaveState({ status: "saved", revision: res.table.revision, message: null, lastSavedAt: null });
        }
        historyRef.current.clear();
        docRef.current = serverDoc;
        setDetail(res);
        setDoc(serverDoc);
        setComments(res.comments || []);
        setHistoryTick((t) => t + 1);
        document.title = `${res.table.name} · Shared Table | Persora`;
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setUnavailableMessage(
            tableErrorMessage(
              err,
              "This shared table link is unavailable, disabled, or has been revoked.",
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      saverRef.current?.dispose();
    };
  }, [token, reloadNonce]);

  const canEdit = detail?.permission === "edit";
  const canComment = canEdit || detail?.permission === "comment";
  const authorDefault = signedInUser?.fullName || signedInUser?.email || (canEdit ? "Guest editor" : "Guest commenter");

  const commit = useCallback<Commit>(
    (next, label) => {
      if (!canEdit) return;
      const current = docRef.current;
      if (!current || next === current) return;
      historyRef.current.push(current, label);
      docRef.current = next;
      setDoc(next);
      setHistoryTick((t) => t + 1);
      saverRef.current?.update(next);
    },
    [canEdit],
  );

  const undo = useCallback(() => {
    const current = docRef.current;
    if (!canEdit || !current) return;
    const prev = historyRef.current.undo(current);
    if (!prev) return;
    docRef.current = prev.doc;
    setDoc(prev.doc);
    setHistoryTick((t) => t + 1);
    saverRef.current?.update(prev.doc);
  }, [canEdit]);

  const redo = useCallback(() => {
    const current = docRef.current;
    if (!canEdit || !current) return;
    const next = historyRef.current.redo(current);
    if (!next) return;
    docRef.current = next.doc;
    setDoc(next.doc);
    setHistoryTick((t) => t + 1);
    saverRef.current?.update(next.doc);
  }, [canEdit]);

  useEffect(() => {
    if (!canEdit) return;
    const flush = () => {
      if (document.visibilityState === "hidden") void saverRef.current?.flush();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [canEdit]);

  const handleSavePublicCellComment = useCallback(
    async ({ sheetId, row, col, text, authorName }: { sheetId: string; row: number; col: number; text: string; authorName?: string }) => {
      const res = await postPublicTableCellComment(token, {
        sheetId,
        row,
        col,
        text,
        authorName: authorName || authorDefault,
      });
      if (res.comment) {
        setDoc((prev) => {
          if (!prev || prev.kind !== "spreadsheet") return prev;
          const updated: TableDoc = {
            kind: "spreadsheet",
            sheets: prev.sheets.map((sheet) =>
              sheet.id === sheetId
                ? {
                    ...sheet,
                    data: {
                      ...sheet.data,
                      comments: { ...(sheet.data.comments || {}), [res.cellKey]: res.comment! },
                    },
                  }
                : sheet,
            ),
          };
          docRef.current = updated;
          if (saverRef.current && !saverRef.current.hasUnsaved) {
            saverRef.current.reset(updated, res.revision);
          }
          return updated;
        });
        notify("Comment added.");
      }
    },
    [token, authorDefault, notify],
  );

  const handleAddThreadComment = useCallback(
    async (body: string, authorName?: string) => {
      const created = await postPublicTableThreadComment(token, {
        body,
        authorName: authorName || authorDefault,
      });
      setComments((prev) => [...prev, created]);
      notify("Comment posted.");
    },
    [token, authorDefault, notify],
  );

  const commentTotal = useMemo(
    () => comments.length + (doc?.kind === "spreadsheet" ? extractSheetCellComments(doc.sheets).length : 0),
    [comments, doc],
  );

  // Re-evaluate undo/redo availability whenever historyTick increments.
  void historyTick;
  const canUndo = canEdit && historyRef.current.canUndo;
  const canRedo = canEdit && historyRef.current.canRedo;

  if (loading) {
    return (
      <main className="tb-public-screen tb-public-centered" aria-busy="true">
        <div className="tb-loading" role="status">
          <Spinner className="size-4" /> Opening shared table…
        </div>
      </main>
    );
  }

  if (unavailableMessage || !detail || !doc) {
    return (
      <main className="tb-public-screen tb-public-centered">
        <div className="tb-public-unavailable-card">
          <header className="tb-public-brand-row">
            <a href="/" className="tb-public-brand">
              <span className="brand-mark"><PersoraMark/></span>
              <span>persora</span><span className="brand-period">.</span>
            </a>
            <ThemeToggleButton />
          </header>
          <PersoraEmptyState
            moduleId="tables"
            tone="slate"
            title="This table isn’t available"
            description={unavailableMessage || "The link may have been disabled, revoked, or entered incorrectly."}
            action={
              <div className="tb-public-unavailable-actions">
                {signedInUser ? (
                  <Button type="button" onClick={onOpenWorkspace}>
                    Open Workspace <ArrowUpRight size={14} />
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={onSignIn}>
                      Sign In
                    </Button>
                    <Button type="button" onClick={onCreateAccount}>
                      Create Account
                    </Button>
                  </>
                )}
              </div>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="tb-public-screen" aria-label={`${detail.table.name} — Shared Persora Table`}>
      <header className="tb-public-topbar">
        <div className="tb-public-topbar-left">
          <a href="/" className="tb-public-brand" title="Persora home">
            <span className="brand-mark"><PersoraMark/></span>
            <span>persora</span><span className="brand-period">.</span>
          </a>
          <span className="tb-public-divider" aria-hidden="true" />
          <IconTile
            variant="soft"
            size="xs"
            className={detail.table.kind === "smart" ? "ds-tone-blue" : "ds-tone-emerald"}
          >
            {detail.table.kind === "smart" ? <Database size={14} /> : <SheetIcon size={14} />}
          </IconTile>
          <h1 className="tb-public-title">{detail.table.name}</h1>
          <Badge variant={canEdit ? "success-light" : canComment ? "info-light" : "secondary"} size="xs">
            {canEdit ? (
              <>
                <Pencil size={11} aria-hidden="true" /> Editor (Can edit)
              </>
            ) : canComment ? (
              <>
                <MessageSquare size={11} aria-hidden="true" /> Commenter (View &amp; comment)
              </>
            ) : (
              <>
                <Eye size={11} aria-hidden="true" /> Viewer (View only)
              </>
            )}
          </Badge>

          {canEdit && (
            <div className="tb-public-edit-controls">
              <button
                type="button"
                className="tb-icon-button"
                aria-label="Undo"
                title="Undo"
                disabled={!canUndo}
                onClick={undo}
              >
                <Undo2 size={15} />
              </button>
              <button
                type="button"
                className="tb-icon-button"
                aria-label="Redo"
                title="Redo"
                disabled={!canRedo}
                onClick={redo}
              >
                <Redo2 size={15} />
              </button>
              {saveState.status === "saved" ? (
                <span className="tb-save is-saved" role="status">
                  <Check size={13} /> Saved
                </span>
              ) : saveState.status === "pending" || saveState.status === "saving" ? (
                <span className="tb-save is-saving" role="status">
                  <Spinner className="size-3" /> Saving…
                </span>
              ) : saveState.status === "conflict" ? (
                <span className="tb-save is-error" role="status">
                  <TriangleAlert size={13} /> Updated elsewhere{" "}
                  <button type="button" className="tb-link-button" onClick={() => setReloadNonce((n) => n + 1)}>
                    <RefreshCw size={12} /> Reload
                  </button>
                </span>
              ) : (
                <span className="tb-save is-error" role="status">
                  <CloudOff size={13} /> Unable to save{" "}
                  <button type="button" className="tb-link-button" onClick={() => void saverRef.current?.flush()}>
                    Retry
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="tb-public-topbar-right">
          <button
            type="button"
            className={`tb-secondary-button ${commentsOpen ? "is-active" : ""}`}
            aria-expanded={commentsOpen}
            onClick={() => setCommentsOpen((open) => !open)}
          >
            <MessageSquare size={14} />
            <span>Comments{commentTotal > 0 ? ` (${commentTotal})` : ""}</span>
          </button>

          <ThemeToggleButton />

          {signedInUser ? (
            <Button type="button" size="sm" onClick={onOpenWorkspace}>
              Open Workspace
            </Button>
          ) : (
            <div className="tb-public-auth-actions">
              <Button type="button" variant="outline" size="sm" onClick={onSignIn}>
                Sign In
              </Button>
              <Button type="button" size="sm" onClick={onCreateAccount}>
                Create Account
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="tb-public-body">
        <div className="tb-public-editor-wrap tb-view">
          <Suspense fallback={<div className="tb-loading" role="status"><Spinner className="size-4" /> Loading spreadsheet…</div>}>
            {doc.kind === "spreadsheet" ? (
              <SpreadsheetEditor
                doc={doc}
                tableName={detail.table.name}
                commit={canEdit ? commit : noopCommit}
                readOnly={!canEdit}
                allowComment={canComment}
                askCommentAuthor={!signedInUser}
                onSaveCellComment={canEdit ? undefined : handleSavePublicCellComment}
                notify={notify}
                authorName={authorDefault}
              />
            ) : (
              <SmartTableEditor
                doc={doc}
                tableId={`public:${token}`}
                tableName={detail.table.name}
                commit={canEdit ? commit : noopCommit}
                readOnly={!canEdit}
                notify={notify}
                attachments={detail.attachments}
                onAttachmentAdded={() => undefined}
                canUpload={false}
                maxUploadMb={0}
              />
            )}
          </Suspense>
        </div>

        {commentsOpen && (
          <TableCommentsPanel
            comments={comments}
            sheets={doc.kind === "spreadsheet" ? doc.sheets : undefined}
            canComment={canComment}
            askAuthor={!signedInUser}
            defaultAuthor={signedInUser ? authorDefault : ""}
            onAddComment={handleAddThreadComment}
            onClose={() => setCommentsOpen(false)}
          />
        )}
      </div>
    </main>
  );
}
