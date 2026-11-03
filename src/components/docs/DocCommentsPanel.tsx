// Persora Docs — Organized Anchored Comments Side Panel.
// Attaches comments to selected text via inline comment marks, supports replies,
// resolving/reopening threads, and hides cleanly when Comments mode is toggled off
// without deleting persisted threads.
import { useState } from "react";
import {
  Check,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { DocCommentThread } from "../../../cloudflare/docs-rules.js";

function formatCommentTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function DocCommentsPanel({
  comments,
  canEdit,
  authorName,
  selectedQuote,
  activeCommentId,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onSelectComment,
  onCreateComment,
  onReplyComment,
  onToggleResolved,
  onDeleteComment,
  onTurnOffComments,
}: {
  comments: DocCommentThread[];
  canEdit: boolean;
  authorName: string;
  selectedQuote: string;
  activeCommentId: string | null;
  composerOpen: boolean;
  onOpenComposer: () => void;
  onCloseComposer: () => void;
  onSelectComment: (commentId: string) => void;
  onCreateComment: (text: string) => void;
  onReplyComment: (commentId: string, replyText: string) => void;
  onToggleResolved: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onTurnOffComments: () => void;
}) {
  const [draftText, setDraftText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

  const openThreads = comments.filter((c) => !c.resolved);
  const resolvedThreads = comments.filter((c) => c.resolved);
  const visibleThreads = showResolved ? comments : openThreads;

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftText.trim();
    if (!trimmed) return;
    onCreateComment(trimmed);
    setDraftText("");
  };

  const submitReply = (commentId: string, e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = (replyDrafts[commentId] || "").trim();
    if (!trimmed) return;
    onReplyComment(commentId, trimmed);
    setReplyDrafts((prev) => ({ ...prev, [commentId]: "" }));
  };

  return (
    <aside className="pd-comments-panel" aria-label="Document comments">
      <div className="pd-comments-head">
        <div className="pd-comments-head-title">
          <span>Comments</span>
          {openThreads.length > 0 && (
            <span className="pd-comments-count">{openThreads.length}</span>
          )}
        </div>
        <div className="pd-comments-head-actions">
          {canEdit && (
            <button
              type="button"
              className="pd-comments-add-btn"
              onClick={onOpenComposer}
              disabled={!selectedQuote && composerOpen}
              title={
                selectedQuote
                  ? "Comment on selected text"
                  : "Select text in the document or add a note"
              }
              aria-label="Add comment"
            >
              <MessageSquarePlus size={14} />
              <span>Add</span>
            </button>
          )}
          <button
            type="button"
            className="pd-icon-btn"
            onClick={onTurnOffComments}
            aria-label="Hide comments"
            title="Turn off comments view (keeps existing comments)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {resolvedThreads.length > 0 && (
        <div className="pd-comments-filter-bar">
          <button
            type="button"
            className={`pd-comments-filter-chip ${!showResolved ? "is-on" : ""}`}
            onClick={() => setShowResolved(false)}
          >
            Open ({openThreads.length})
          </button>
          <button
            type="button"
            className={`pd-comments-filter-chip ${showResolved ? "is-on" : ""}`}
            onClick={() => setShowResolved(true)}
          >
            All ({comments.length})
          </button>
        </div>
      )}

      <div className="pd-comments-list">
        {composerOpen && canEdit && (
          <form className="pd-comment-composer" onSubmit={submitNew}>
            <div className="pd-comment-composer-who">{authorName}</div>
            {selectedQuote ? (
              <blockquote className="pd-comment-quote">“{selectedQuote.slice(0, 140)}”</blockquote>
            ) : (
              <p className="pd-comment-hint">
                Tip: Highlight text in the page first to anchor your comment to a specific phrase.
              </p>
            )}
            <textarea
              className="pd-comment-input"
              aria-label="Comment text"
              placeholder="Write a comment…"
              rows={3}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              autoFocus
            />
            <div className="pd-comment-composer-actions">
              <button
                type="button"
                className="pd-btn-secondary"
                onClick={() => {
                  setDraftText("");
                  onCloseComposer();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pd-btn-primary"
                disabled={!draftText.trim()}
              >
                Comment
              </button>
            </div>
          </form>
        )}

        {visibleThreads.length === 0 && !composerOpen ? (
          <div className="pd-comments-empty">
            <p className="pd-comments-empty-title">No open comments</p>
            <p className="pd-comments-empty-sub">
              Select text anywhere in your document and click <strong>Add</strong> to attach a comment.
            </p>
          </div>
        ) : (
          visibleThreads.map((thread) => {
            const isActive = activeCommentId === thread.id;
            const replyVal = replyDrafts[thread.id] || "";
            return (
              <article
                key={thread.id}
                className={`pd-comment-card ${isActive ? "is-active" : ""} ${thread.resolved ? "is-resolved" : ""}`}
                onClick={() => onSelectComment(thread.id)}
              >
                <div className="pd-comment-card-top">
                  <div className="pd-comment-author-meta">
                    <span className="pd-comment-author">{thread.authorName}</span>
                    <span className="pd-comment-date">{formatCommentTime(thread.createdAt)}</span>
                  </div>
                  {canEdit && (
                    <div className="pd-comment-card-btns" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="pd-comment-mini-btn"
                        onClick={() => onToggleResolved(thread.id)}
                        title={thread.resolved ? "Reopen comment" : "Mark resolved"}
                        aria-label={thread.resolved ? "Reopen comment" : "Resolve comment"}
                      >
                        {thread.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                      </button>
                      <button
                        type="button"
                        className="pd-comment-mini-btn is-danger"
                        onClick={() => onDeleteComment(thread.id)}
                        title="Delete comment"
                        aria-label="Delete comment"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {thread.quote && (
                  <blockquote className="pd-comment-quote">“{thread.quote}”</blockquote>
                )}

                <p className="pd-comment-body">{thread.text}</p>

                {Array.isArray(thread.replies) && thread.replies.length > 0 && (
                  <div className="pd-comment-replies">
                    {thread.replies.map((r) => (
                      <div key={r.id} className="pd-comment-reply">
                        <div className="pd-comment-reply-head">
                          <strong>{r.authorName}</strong>
                          <span>{formatCommentTime(r.createdAt)}</span>
                        </div>
                        <p>{r.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && isActive && !thread.resolved && (
                  <form
                    className="pd-comment-reply-form"
                    onSubmit={(e) => submitReply(thread.id, e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      aria-label="Reply to comment"
                      placeholder="Reply…"
                      value={replyVal}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))
                      }
                    />
                    <button
                      type="submit"
                      className="pd-comment-send-btn"
                      disabled={!replyVal.trim()}
                      aria-label="Send reply"
                    >
                      <Send size={12} />
                    </button>
                  </form>
                )}
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}
