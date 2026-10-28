// Persora Docs — Full-screen public shared document view (/SharedDoc/:token).
// Supports read-only Viewer links and live-editable Editor links with Print & PDF export.
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import "./docs.css";
import {
  Eye,
  FileDown,
  Pencil,
  Printer,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  cleanDocTitle,
  sanitizeDocContent,
  type DocContent,
} from "../../../cloudflare/docs-rules.js";
import type { AppUser } from "../../types";
import {
  docErrorMessage,
  getPublicSharedDoc,
  savePublicDocContent,
  type DocPublicLinkPermission,
} from "../../lib/docs-api";
import { DocSaver, type DocSaveState } from "../../lib/docs-sync";
import { downloadDocAsPdf } from "../../lib/docs-pdf";
import { DocSaveBadge, triggerCleanDocPrint } from "./DocEditor";
import DocFormattingToolbar from "./DocFormattingToolbar";
import { createPersoraDocExtensions } from "./docs-extensions";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import { PersoraEmptyState, ThemeToggleButton } from "@/design-system";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

export default function PublicSharedDocPage({
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [permission, setPermission] = useState<DocPublicLinkPermission>("view");
  const [ownerName, setOwnerName] = useState("Persora Member");
  const [title, setTitle] = useState("Untitled document");
  const [saveState, setSaveState] = useState<DocSaveState>({
    status: "saved",
    revision: 1,
    message: null,
    lastSavedAt: null,
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [linkTriggerNonce, setLinkTriggerNonce] = useState(0);

  const saverRef = useRef<DocSaver | null>(null);
  const contentRef = useRef<DocContent | null>(null);
  const titleRef = useRef("Untitled document");
  const suppressUpdateRef = useRef(false);

  const canEdit = permission === "edit";
  const extensions = useMemo(() => createPersoraDocExtensions(), []);

  const editor = useEditor({
    extensions,
    editable: canEdit,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class: "pd-prosemirror",
        "aria-label": "Shared document body",
      },
      handleKeyDown: (_view, event) => {
        if (!canEdit) return false;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setLinkTriggerNonce((n) => n + 1);
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saverRef.current?.flush();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdateRef.current || !canEdit) return;
      const nextJson = sanitizeDocContent(ed.getJSON());
      contentRef.current = nextJson;
      saverRef.current?.update({
        title: titleRef.current,
        content: nextJson,
      });
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    getPublicSharedDoc(token, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        const safeContent = sanitizeDocContent(res.doc.content);
        const editable = res.permission === "edit";

        saverRef.current?.dispose();
        if (editable) {
          const saver = new DocSaver({
            revision: res.doc.revision,
            initial: { title: res.doc.title, content: safeContent },
            debounceMs: 650,
            send: (batch) => savePublicDocContent(token, batch),
            onState: (next) => setSaveState(next),
          });
          saverRef.current = saver;
          setSaveState(saver.snapshot);
        }

        contentRef.current = safeContent;
        titleRef.current = res.doc.title;
        suppressUpdateRef.current = true;
        editor.commands.setContent(safeContent, false);
        suppressUpdateRef.current = false;

        setPermission(res.permission);
        setOwnerName(res.ownerName || "Persora Member");
        setTitle(res.doc.title);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setLoadError(
          docErrorMessage(
            err,
            "This shared document link is unavailable, disabled, or has been revoked.",
          ),
        );
      });

    return () => controller.abort();
  }, [editor, reloadKey, token]);

  useEffect(() => () => saverRef.current?.dispose(), []);

  const handlePrint = async () => {
    await saverRef.current?.flush().catch(() => {});
    const current = contentRef.current || sanitizeDocContent(editor?.getJSON());
    triggerCleanDocPrint(titleRef.current, current);
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      await saverRef.current?.flush().catch(() => {});
      const current = contentRef.current || sanitizeDocContent(editor?.getJSON());
      await downloadDocAsPdf(titleRef.current, current);
      notify("Exported PDF.");
    } catch (error) {
      notify(docErrorMessage(error, "Could not generate PDF."), "error");
    } finally {
      setExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <main className="pd-public-screen pd-public-centered" role="status">
        <div className="pd-loading">
          <Spinner className="size-4 text-primary" />
          <span>Opening shared document…</span>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="pd-public-screen pd-public-centered">
        <div className="pd-public-unavailable-card">
          <div className="pd-public-brand-row">
            <a href="/" className="pd-public-brand">
              <ShieldCheck size={18} className="text-primary" />
              <span>Persora Docs</span>
            </a>
            <ThemeToggleButton />
          </div>
          <PersoraEmptyState
            moduleId="docs"
            tone="blue"
            title="Shared document unavailable"
            description={loadError}
            action={
              <div className="pd-error-actions">
                <button
                  type="button"
                  className="pd-btn-secondary"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RefreshCw size={14} /> Try again
                </button>
                {signedInUser ? (
                  <button
                    type="button"
                    className="pd-btn-primary"
                    onClick={onOpenWorkspace}
                  >
                    Open workspace
                  </button>
                ) : (
                  <button type="button" className="pd-btn-primary" onClick={onSignIn}>
                    Sign in
                  </button>
                )}
              </div>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="pd-public-screen">
      <header className="pd-topbar">
        <div className="pd-topbar-left">
          <LauncherModuleIcon id="docs" size={24} />
          <div className="pd-title-cluster">
            {canEdit ? (
              <input
                type="text"
                className="pd-title-input"
                aria-label="Document title"
                value={title}
                maxLength={160}
                onChange={(e) => {
                  const raw = e.target.value;
                  setTitle(raw);
                  const cleaned = raw.trim() ? raw.trim().slice(0, 160) : "Untitled document";
                  titleRef.current = cleaned;
                  if (contentRef.current) {
                    saverRef.current?.update({
                      title: cleaned,
                      content: contentRef.current,
                    });
                  }
                }}
                onBlur={() => {
                  const cleaned = cleanDocTitle(title, { allowEmptyDefault: true });
                  setTitle(cleaned);
                  titleRef.current = cleaned;
                }}
              />
            ) : (
              <h1 className="pd-title-readonly">{title}</h1>
            )}

            <Badge variant={canEdit ? "primary-light" : "secondary"} size="xs" radius="full">
              {canEdit ? <Pencil size={11} /> : <Eye size={11} />}
              <span>{canEdit ? "Can edit" : `Shared by ${ownerName} · View only`}</span>
            </Badge>

            {canEdit && (
              <DocSaveBadge
                state={saveState}
                onRetry={() => saverRef.current?.retry()}
              />
            )}
          </div>
        </div>

        <div className="pd-topbar-right">
          <button
            type="button"
            className="pd-btn-secondary"
            onClick={() => void handlePrint()}
            title="Print document"
          >
            <Printer size={14} />
            <span className="pd-action-label">Print</span>
          </button>
          <button
            type="button"
            className="pd-btn-secondary"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
            title="Export PDF"
          >
            {exportingPdf ? <Spinner className="size-3.5" /> : <FileDown size={14} />}
            <span className="pd-action-label">Export PDF</span>
          </button>
          <ThemeToggleButton />
          {signedInUser ? (
            <button type="button" className="pd-btn-primary" onClick={onOpenWorkspace}>
              Workspace
            </button>
          ) : (
            <div className="pd-public-auth">
              <button type="button" className="pd-btn-secondary" onClick={onSignIn}>
                Sign in
              </button>
              <button type="button" className="pd-btn-primary" onClick={onCreateAccount}>
                Get started
              </button>
            </div>
          )}
        </div>
      </header>

      {canEdit && (
        <div className="pd-toolbar-bar">
          <DocFormattingToolbar editor={editor} linkTriggerNonce={linkTriggerNonce} />
        </div>
      )}

      <div className="pd-canvas">
        <article className={`pd-page-sheet ${!canEdit ? "is-readonly" : ""}`}>
          <EditorContent editor={editor} />
        </article>
      </div>
    </main>
  );
}
