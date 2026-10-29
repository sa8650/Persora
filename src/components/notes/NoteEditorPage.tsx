import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, Check, ChevronRight, CloudOff, LockKeyhole, Paperclip, Tag, X } from "lucide-react";
import { Spinner } from "../ui/spinner";
import { Badge } from "../reui/badge";
import { TransferProgressIndicator } from "../ProgressIndicator";
import { RichNoteEditor, type NoteSurfaceId } from "../VaultDialogs";
import type { TransferProgress, VaultFile, VaultItem } from "../../types";
import { humanSize } from "../../lib/utils";
import "./note-editor-page.css";

export interface NoteEditorPageDraft extends Omit<VaultItem, "id" | "createdAt" | "updatedAt"> {
  id?: string;
  fileUpload?: File | null;
}

export interface NoteEditorPageSaved {
  id?: string;
  file?: VaultFile;
}

export interface NoteEditorPageProps {
  item?: VaultItem;
  initialMetadata?: Record<string, string>;
  canUpload: boolean;
  maxUploadMb?: number;
  onUpgrade?: () => void;
  onClose: () => void;
  onSave: (draft: NoteEditorPageDraft, onProgress?: (progress: TransferProgress) => void) => Promise<NoteEditorPageSaved | void>;
}

const UNTITLED = "Untitled";
const AUTOSAVE_DELAY = 900;

type SaveStatus = "idle" | "saving" | "saved" | "failed";

/**
 * Full-page note editor (Evernote-style).
 *
 * The page saves itself the way Persora Table and Persora Docs do — a short
 * debounce after the last edit, then again on close, with a quiet status chip in
 * the breadcrumb bar instead of a footer action bar. Attachments and the page
 * background live in the rich-text toolbar.
 */
export function NoteEditorPage({ item, initialMetadata, canUpload, maxUploadMb = 25, onUpgrade, onClose, onSave }: NoteEditorPageProps) {
  const [title, setTitle] = useState(item?.title || initialMetadata?.title || "");
  const [content, setContent] = useState(item?.metadata.content ?? initialMetadata?.content ?? "");
  const [tags, setTags] = useState(item?.metadata.tags ?? initialMetadata?.tags ?? "");
  const [surface, setSurface] = useState<NoteSurfaceId>((item?.metadata.surface ?? initialMetadata?.surface ?? "default") as NoteSurfaceId);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SaveStatus>(item ? "saved" : "idle");
  const [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState<string | undefined>(item?.id);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const savedIdRef = useRef<string | undefined>(item?.id);
  const savedFileRef = useRef<VaultFile | undefined>(item?.file);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const lastSavedKeyRef = useRef("");
  const persistRef = useRef<(options?: { silent?: boolean }) => Promise<"saved" | "skipped" | "failed" | "queued">>(async () => "skipped");

  const draftRef = useRef({ title, content, tags, surface, selectedFile, removeFile });
  draftRef.current = { title, content, tags, surface, selectedFile, removeFile };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!item && !initialMetadata?.title) titleRef.current?.focus({ preventScroll: true });
  }, [item, initialMetadata]);

  const attachmentPreviewUrl = useMemo(
    () => (selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : ""),
    [selectedFile],
  );
  useEffect(() => () => { if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl); }, [attachmentPreviewUrl]);

  const editedLabel = useMemo(() => {
    if (item?.updatedAt) return `Edited ${new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return "New note";
  }, [item?.updatedAt]);

  /* ---- Autosave ------------------------------------------------------- */

  const persist = useCallback(async (options?: { silent?: boolean }): Promise<"saved" | "skipped" | "failed" | "queued"> => {
    const draft = draftRef.current;
    const hasContent = Boolean(draft.title.trim() || draft.content.trim() || draft.selectedFile || savedFileRef.current || savedIdRef.current);
    // Never create an empty note just because the page was opened.
    if (!hasContent) return "skipped";
    if (inFlightRef.current) { pendingRef.current = true; return "queued"; }

    inFlightRef.current = true;
    if (!options?.silent) setStatus("saving");
    setError("");

    const upload = draft.selectedFile;
    if (upload) setUploadProgress({ loaded: 0, total: upload.size, percent: 0, remainingSeconds: null });

    const metadata: Record<string, string> = { ...(item?.metadata || {}) };
    const html = draft.content.trim();
    if (html) metadata.content = html; else delete metadata.content;
    if (draft.tags.trim()) metadata.tags = draft.tags.trim(); else delete metadata.tags;
    if (draft.surface && draft.surface !== "default") metadata.surface = draft.surface; else delete metadata.surface;

    const file: VaultFile | undefined = upload
      ? { name: upload.name, size: upload.size, type: upload.type, localOnly: true }
      : draft.removeFile
        ? undefined
        : savedFileRef.current;

    try {
      const result = await onSave({
        ...(savedIdRef.current ? { id: savedIdRef.current } : {}),
        section: "notes",
        title: draft.title.trim() || UNTITLED,
        subtitle: item?.subtitle || "",
        metadata,
        file,
        folderId: item?.folderId,
        favorite: item?.favorite ?? false,
        pinned: item?.pinned ?? false,
        sharedAccess: item?.sharedAccess,
        fileUpload: upload ?? null,
      }, setUploadProgress);
      if (result && typeof result === "object") {
        if (result.id) { savedIdRef.current = result.id; setSavedId(result.id); }
        savedFileRef.current = result.file !== undefined ? result.file : file;
      } else {
        savedFileRef.current = file;
      }
      if (!mountedRef.current) return "saved";
      if (upload) setSelectedFile(null);
      setRemoveFile(false);
      setStatus("saved");
      setDirty(false);
      // After a successful save the staged file is committed, so the settled
      // snapshot is the one without any pending attachment selection.
      lastSavedKeyRef.current = JSON.stringify([
        draftRef.current.title, draftRef.current.content, draftRef.current.tags, draftRef.current.surface, null, null, false,
      ]);
      return "saved";
    } catch (reason) {
      if (!mountedRef.current) return "failed";
      setStatus("failed");
      setError(reason instanceof Error ? reason.message : "We couldn't save this note. Your text is still here.");
      return "failed";
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setUploadProgress(null);
      if (pendingRef.current) { pendingRef.current = false; void persistRef.current(); }
    }
  }, [item, onSave]);
  persistRef.current = persist;

  const snapshotKey = JSON.stringify([title, content, tags, surface, selectedFile?.name, selectedFile?.size, removeFile]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      // Opening the page is not an edit.
      initializedRef.current = true;
      lastSavedKeyRef.current = snapshotKey;
      setDirty(false);
      return;
    }
    const changed = snapshotKey !== lastSavedKeyRef.current;
    setDirty(changed);
    if (!changed) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void persistRef.current(); }, AUTOSAVE_DELAY);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);

  const flush = async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    return persistRef.current();
  };

  const requestClose = async () => {
    const outcome = await flush();
    if (outcome === "failed") return;
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void persistRef.current();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void requestClose();
    }
  };

  /* ---- Attachment ------------------------------------------------------ */

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!canUpload) { setError("New attachments require an active paid plan."); return; }
    if (file.size > Math.max(1, maxUploadMb) * 1024 * 1024) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError("");
    setSelectedFile(file);
    setRemoveFile(false);
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const pickAttachment = () => {
    if (!canUpload) { setError("New attachments require an active paid plan."); onUpgrade?.(); return; }
    fileInputRef.current?.click();
  };

  const tagList = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  const savedFile = removeFile ? undefined : savedFileRef.current;
  const attachmentName = selectedFile?.name || savedFile?.name || "";
  const attachmentSize = selectedFile?.size ?? savedFile?.size;

  return (
    <div className="note-page" onKeyDown={onKeyDown}>
      <header className="note-page-bar">
        <div className="note-page-bar-left">
          <button type="button" className="note-page-back" onClick={() => void requestClose()} aria-label="Close note editor" title="Close note editor">
            <ArrowLeft size={17} />
          </button>
          <nav className="note-page-breadcrumb" aria-label="Breadcrumb">
            <span>Tasks &amp; Notes</span>
            <ChevronRight size={12} aria-hidden="true" />
            <span className="is-current">{title.trim() || UNTITLED}</span>
          </nav>
        </div>
        <div className="note-page-bar-right">
          {status === "failed" ? (
            <button type="button" className="note-page-state is-dirty note-page-retry" onClick={() => void persistRef.current()}>
              <CloudOff size={13} aria-hidden="true" />
              <span>Save failed · Retry</span>
            </button>
          ) : (
            <span className={`note-page-state ${status === "saving" ? "is-saving" : dirty ? "is-dirty" : "is-saved"}`} role="status" aria-live="polite">
              {status === "saving" ? "Saving…" : dirty ? "Unsaved changes" : status === "idle" ? "Autosave on" : "Saved"}
            </span>
          )}
          <button type="button" className="note-page-save" onClick={() => void requestClose()} disabled={status === "saving"}>
            {status === "saving" ? <Spinner className="size-3.5" /> : <Check size={14} aria-hidden="true" />}
            <span>{savedId ? "Done" : "Create note"}</span>
          </button>
        </div>
      </header>

      <div className="note-page-scroll">
        <article className="note-page-sheet" data-note-surface={surface}>
          <p className="note-page-meta">{editedLabel}</p>

          <input
            ref={titleRef}
            className="note-page-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            aria-label="Note title"
            maxLength={240}
            spellCheck
          />

          <RichNoteEditor
            id="note-page-content"
            value={content}
            onChange={setContent}
            placeholder="Start writing, or paste anything you want to keep…"
            showHint={false}
            surface={{ value: surface, onChange: setSurface }}
            attachment={{
              onClick: pickAttachment,
              disabled: !canUpload,
              disabledHint: "Attachments require an active paid plan. Your note still saves without one.",
              busy: Boolean(uploadProgress),
            }}
          />

          {attachmentName && (
            <div className="note-page-attachment-chip">
              <span className="note-page-attachment-icon"><Paperclip size={13} aria-hidden="true" /></span>
              <span className="note-page-attachment-name">{attachmentName}</span>
              {attachmentSize ? <span className="note-page-attachment-size">{humanSize(attachmentSize)}</span> : null}
              <button
                type="button"
                className="note-page-attachment-remove"
                aria-label={selectedFile ? "Remove selected file" : "Remove attachment"}
                title={selectedFile ? "Remove selected file" : "Remove attachment"}
                onClick={() => {
                  if (selectedFile) setSelectedFile(null);
                  else setRemoveFile(true);
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}

          {uploadProgress && (
            <TransferProgressIndicator
              progress={uploadProgress}
              label="Uploading attachment"
              detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}
            />
          )}

          {!canUpload && (
            <p className="note-page-locked-hint">
              <LockKeyhole size={12} aria-hidden="true" />
              <span>Attachments need an active paid plan — your note is saved either way.</span>
            </p>
          )}

          {error && <div className="form-alert error-alert" role="alert">{error}</div>}

          <div className="note-page-tags">
            <span className="note-page-field-label"><Tag size={13} aria-hidden="true" /> Tags</span>
            <input
              className="note-page-tag-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Add tags, separated by commas"
              aria-label="Note tags"
              maxLength={240}
            />
            {tagList.length > 0 && (
              <div className="note-page-tag-chips">
                {tagList.map((tag) => (
                  <Badge key={tag} variant="secondary" size="xs" radius="full">{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>

      <input
        ref={fileInputRef}
        id="note-page-attachment-input"
        className="note-page-file-input"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp"
        onChange={onFilePicked}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

export default NoteEditorPage;
