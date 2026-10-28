import { useState, type FormEvent } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import type { Sheet } from "../../../cloudflare/table-rules.js";
import { addressName } from "../../../cloudflare/table-formula.js";
import type { TableThreadComment } from "../../lib/table/table-api";
import { relativeTime } from "./table-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

export interface DerivedCellCommentItem {
  key: string;
  sheetName: string;
  cellAddress: string;
  author: string;
  text: string;
  updatedAt: string;
}

export function extractSheetCellComments(sheets: Sheet[]): DerivedCellCommentItem[] {
  const out: DerivedCellCommentItem[] = [];
  for (const sheet of sheets) {
    const map = sheet.data?.comments || {};
    for (const [cellKey, comment] of Object.entries(map)) {
      if (!comment) continue;
      const [rStr, cStr] = cellKey.split(":");
      const r = Number(rStr);
      const c = Number(cStr);
      out.push({
        key: `${sheet.id}:${cellKey}`,
        sheetName: sheet.name,
        cellAddress: Number.isInteger(r) && Number.isInteger(c) ? addressName(r, c) : cellKey,
        author: comment.author || "Persora Member",
        text: comment.text,
        updatedAt: comment.updatedAt || comment.createdAt,
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export default function TableCommentsPanel({
  comments,
  sheets,
  canComment,
  askAuthor = false,
  defaultAuthor = "",
  onAddComment,
  onClose,
}: {
  comments: TableThreadComment[];
  sheets?: Sheet[];
  canComment: boolean;
  askAuthor?: boolean;
  defaultAuthor?: string;
  onAddComment: (body: string, authorName?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [authorName, setAuthorName] = useState(defaultAuthor);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cellComments = sheets ? extractSheetCellComments(sheets) : [];
  const totalCount = comments.length + cellComments.length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onAddComment(cleaned, askAuthor ? authorName.trim() || "Guest commenter" : undefined);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Comment could not be posted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="tb-comments-drawer" aria-label="Table comments">
      <header className="tb-comments-drawer-head">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MessageSquare size={16} />
          <strong>Comments</strong>
          <Badge variant="secondary" size="xs">{totalCount}</Badge>
        </div>
        <button type="button" className="tb-icon-button" onClick={onClose} aria-label="Close comments">
          <X size={16} />
        </button>
      </header>

      <div className="tb-comments-drawer-list">
        {totalCount === 0 ? (
          <p className="tb-comments-empty">
            {canComment
              ? "No comments yet. Add a note below or right-click any spreadsheet cell to comment directly on a cell."
              : "No comments on this table yet."}
          </p>
        ) : (
          <>
            {cellComments.map((item) => (
              <article key={item.key} className="tb-comment-card">
                <div className="tb-comment-card-meta">
                  <b>{item.author}</b>
                  <Badge variant="outline" size="xs">{item.sheetName}!{item.cellAddress}</Badge>
                  <small>{relativeTime(item.updatedAt)}</small>
                </div>
                <p>{item.text}</p>
              </article>
            ))}
            {[...comments].reverse().map((item) => (
              <article key={item.id} className="tb-comment-card">
                <div className="tb-comment-card-meta">
                  <b>{item.authorName}</b>
                  {item.cellRef && <Badge variant="outline" size="xs">{item.cellRef}</Badge>}
                  <small>{relativeTime(item.createdAt)}</small>
                </div>
                <p>{item.body}</p>
              </article>
            ))}
          </>
        )}
      </div>

      {canComment ? (
        <form className="tb-comments-drawer-form" onSubmit={(e) => void handleSubmit(e)}>
          {askAuthor && (
            <input
              type="text"
              aria-label="Your name (optional)"
              maxLength={60}
              placeholder="Your name (optional)"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              disabled={submitting}
            />
          )}
          <textarea
            aria-label="Add a comment"
            rows={3}
            maxLength={2000}
            placeholder="Add a comment on this table…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={submitting}
          />
          {error && <small className="tb-comments-error" role="alert">{error}</small>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" size="sm" disabled={!draft.trim() || submitting}>
              {submitting ? <Spinner className="size-3.5" /> : <Send size={13} />}
              Post comment
            </Button>
          </div>
        </form>
      ) : (
        <div className="tb-comments-readonly-note">
          You have view-only access to this table.
        </div>
      )}
    </aside>
  );
}
