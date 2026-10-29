import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ChevronRight, LockKeyhole, Tag, Check, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Badge } from "../reui/badge";
import { ReuiFileAttachmentField } from "../reui/c-attachment-6";
import { TransferProgressIndicator } from "../ProgressIndicator";
import { PersoraDeleteModal } from "@/design-system";
import { RichNoteEditor } from "../VaultDialogs";
import type { TransferProgress, VaultFile, VaultItem } from "../../types";
import { humanSize } from "../../lib/utils";
import "./note-editor-page.css";

export interface NoteEditorPageDraft extends Omit<VaultItem, "id" | "createdAt" | "updatedAt"> {
  id?: string;
  fileUpload?: File | null;
}

export interface NoteEditorPageProps {
  item?: VaultItem;
  initialMetadata?: Record<string, string>;
  canUpload: boolean;
  maxUploadMb?: number;
  onUpgrade?: () => void;
  onClose: () => void;
  onSave: (draft: NoteEditorPageDraft, onProgress?: (progress: TransferProgress) => void) => Promise<void>;
}

const UNTITLED = "Untitled";

/**
 * Full-page note editor (Evernote-style).
 *
 * Replaces the old right-hand note drawer: the editor now renders as a real
 * page inside the workspace content area — breadcrumb bar, quiet meta line,
 * borderless title, the rich note body, tags and attachments — with a single
 * sticky action bar at the bottom.
 */
export function NoteEditorPage({ item, initialMetadata, canUpload, maxUploadMb = 25, onUpgrade, onClose, onSave }: NoteEditorPageProps) {
  const [title, setTitle] = useState(item?.title || initialMetadata?.title || "");
  const [content, setContent] = useState(item?.metadata.content ?? initialMetadata?.content ?? "");
  const [tags, setTags] = useState(item?.metadata.tags ?? initialMetadata?.tags ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const initial = useMemo(
    () => ({
      title: item?.title || initialMetadata?.title || "",
      content: item?.metadata.content ?? initialMetadata?.content ?? "",
      tags: item?.metadata.tags ?? initialMetadata?.tags ?? "",
    }),
    [item, initialMetadata],
  );

  useEffect(() => {
    setDirty(title !== initial.title || content !== initial.content || tags !== initial.tags || Boolean(selectedFile) || removeFile);
  }, [title, content, tags, selectedFile, removeFile, initial]);

  useEffect(() => {
    if (!item && !initialMetadata?.title) titleRef.current?.focus({ preventScroll: true });
  }, [item, initialMetadata]);

  const attachmentPreviewUrl = useMemo(
    () => (selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : ""),
    [selectedFile],
  );
  useEffect(() => () => { if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl); }, [attachmentPreviewUrl]);

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!canUpload) { setError("New attachments require an active paid plan."); return; }
    if (file.size > Math.max(1, maxUploadMb) * 1024 * 1024) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError("");
    setSelectedFile(file);
    setRemoveFile(false);
  };

  const submit = async () => {
    if (saving) return;
    if (!title.trim()) {
      setError("Give this note a title before saving.");
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setUploadProgress(selectedFile ? { loaded: 0, total: selectedFile.size, percent: 0, remainingSeconds: null } : null);
    const metadata: Record<string, string> = { ...(item?.metadata || {}) };
    if (content.trim()) metadata.content = content.trim(); else delete metadata.content;
    if (tags.trim()) metadata.tags = tags.trim(); else delete metadata.tags;
    const file: VaultFile | undefined = selectedFile
      ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, localOnly: true }
      : removeFile
        ? undefined
        : item?.file;
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        section: "notes",
        title: title.trim(),
        subtitle: item?.subtitle || "",
        metadata,
        file,
        folderId: item?.folderId,
        favorite: item?.favorite,
        pinned: item?.pinned,
        sharedAccess: item?.sharedAccess,
        fileUpload: selectedFile,
      }, setUploadProgress);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn't save this note. Please try again.");
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape" && !confirmDiscard) {
      event.preventDefault();
      requestClose();
    }
  };

  const editedLabel = item?.updatedAt
    ? `Edited ${new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "New note";
  const tagList = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  const savedFile = !removeFile ? item?.file : undefined;
  const hasAttachment = Boolean(selectedFile || savedFile);

  return (
    <div className="note-page" onKeyDown={onKeyDown}>
      <header className="note-page-bar">
        <div className="note-page-bar-left">
          <button type="button" className="note-page-back" onClick={requestClose} aria-label="Close note editor" title="Close note editor">
            <ArrowLeft size={17} />
          </button>
          <nav className="note-page-breadcrumb" aria-label="Breadcrumb">
            <span>Tasks &amp; Notes</span>
            <ChevronRight size={12} aria-hidden="true" />
            <span className="is-current">{title.trim() || UNTITLED}</span>
          </nav>
        </div>
        <div className="note-page-bar-right">
          <span className={`note-page-state ${dirty ? "is-dirty" : "is-saved"}`}>
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button type="button" className="note-page-save" onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner className="size-3.5" /> : null}
            <span>{item ? "Save note" : "Create note"}</span>
          </button>
        </div>
      </header>

      <div className="note-page-scroll">
        <article className="note-page-sheet">
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
          />

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

          <div className="note-page-attachment">
            <div className="note-page-field-label">
              <span>Attachment <small>Optional</small></span>
              <Badge variant="secondary" size="xs" radius="full"><LockKeyhole size={11} /> Private</Badge>
            </div>
            {canUpload || selectedFile || savedFile ? (
              <ReuiFileAttachmentField
                inputId="note-page-attachment-input"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp"
                maxSize={Math.max(1, maxUploadMb) * 1024 * 1024}
                disabled={!canUpload}
                uploading={Boolean(uploadProgress)}
                hidePickerWhenFilled
                title="Drop a file here or click to browse"
                description={`PDF, PNG, JPG, WebP · up to ${maxUploadMb} MB`}
                triggerAriaLabel="Choose note attachment"
                onFilesSelected={(files) => acceptFile(files[0])}
                onValidationError={(message) => setError(message)}
                items={
                  selectedFile
                    ? [{
                        id: "selected-note-file",
                        name: selectedFile.name,
                        size: selectedFile.size,
                        type: selectedFile.type,
                        previewUrl: attachmentPreviewUrl || null,
                        state: uploadProgress ? "uploading" : "done",
                        description: `${humanSize(selectedFile.size)} · ${uploadProgress ? `Uploading ${Math.round(uploadProgress.percent)}%` : "Ready to upload"}`,
                        removeLabel: "Remove selected file",
                        onRemove: () => setSelectedFile(null),
                      }]
                    : savedFile && hasAttachment
                      ? [{
                          id: "existing-note-file",
                          name: savedFile.name,
                          size: savedFile.size,
                          type: savedFile.type,
                          description: `${humanSize(savedFile.size)} · Saved in your vault`,
                          removeLabel: "Remove attachment",
                          actions: (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={!canUpload || saving}
                              onClick={() => document.getElementById("note-page-attachment-input")?.click()}
                            >
                              <RefreshCw className="size-3" /> Replace
                            </Button>
                          ),
                          onRemove: () => setRemoveFile(true),
                        }]
                      : []
                }
              />
            ) : (
              <div className="file-upload-locked">
                <LockKeyhole size={16} />
                <span>New attachments require an active paid plan. Your note saves without one.</span>
                {onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}
              </div>
            )}
          </div>

          {uploadProgress && (
            <TransferProgressIndicator
              progress={uploadProgress}
              label="Uploading attachment"
              detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}
            />
          )}
          {error && <div className="form-alert error-alert" role="alert">{error}</div>}
        </article>
      </div>

      <footer className="note-page-footer">
        <div className="note-page-footnote">
          <LockKeyhole size={13} aria-hidden="true" />
          <span>Private to your Persora account · saved to Tasks &amp; Notes</span>
        </div>
        <div className="note-page-actions">
          <button type="button" className="quiet-button" onClick={requestClose} disabled={saving}>Cancel</button>
          <button type="button" className="editor-submit" onClick={() => void submit()} disabled={saving}>
            {saving ? <><Spinner className="size-3.5" /> Saving…</> : <>{item ? "Save note" : "Create note"}<Check size={15} /></>}
          </button>
        </div>
      </footer>

      {confirmDiscard && (
        <PersoraDeleteModal
          danger={false}
          eyebrow="Tasks & Notes"
          title="Discard these changes?"
          description="This note has edits that haven't been saved yet."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
    </div>
  );
}

export default NoteEditorPage;
