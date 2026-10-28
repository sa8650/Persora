import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, CircleAlert, Copy, ExternalLink, Globe2, Lock, RefreshCw, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import type { SharePermission } from "../../types";
import {
  buildSharedTableUrl,
  configureTableShareLink,
  getTableSharing,
  revokeTableMemberShare,
  shareTableWithMember,
  tableErrorMessage,
  updateTableMemberPermission,
  type TableMemberShare,
  type TablePublicLinkPermission,
  type TableShareLinkState,
} from "../../lib/table/table-api";
import ItemModalShell from "../ItemModalShell";
import { initials } from "../../lib/utils";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";

export interface ShareResourceAdapter {
  getSharing: (id: string, signal?: AbortSignal) => Promise<{ shares: TableMemberShare[]; link: TableShareLinkState }>;
  shareWithMember: (
    id: string,
    recipient: string,
    permission: SharePermission,
  ) => Promise<{ share: TableMemberShare; created: boolean }>;
  updateMemberPermission: (
    id: string,
    shareId: string,
    permission: SharePermission,
  ) => Promise<TableMemberShare>;
  revokeMemberShare: (id: string, shareId: string) => Promise<void>;
  configureShareLink: (
    id: string,
    options: { enabled: boolean; permission?: TablePublicLinkPermission; regenerate?: boolean },
  ) => Promise<TableShareLinkState>;
  buildPublicUrl: (token: string) => string;
  errorMessage: (error: unknown, fallback: string) => string;
}

const DEFAULT_TABLE_SHARE_ADAPTER: ShareResourceAdapter = {
  getSharing: getTableSharing,
  shareWithMember: shareTableWithMember,
  updateMemberPermission: updateTableMemberPermission,
  revokeMemberShare: revokeTableMemberShare,
  configureShareLink: configureTableShareLink,
  buildPublicUrl: buildSharedTableUrl,
  errorMessage: tableErrorMessage,
};

export default function ShareTableDialog({
  tableId,
  tableName,
  notify,
  onClose,
  resourceLabel = "table",
  allowComment = true,
  adapter = DEFAULT_TABLE_SHARE_ADAPTER,
  onSharingChanged,
}: {
  tableId: string;
  tableName: string;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  resourceLabel?: "table" | "document";
  allowComment?: boolean;
  adapter?: ShareResourceAdapter;
  onSharingChanged?: (hasActiveShares: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [shares, setShares] = useState<TableMemberShare[]>([]);
  const [link, setLink] = useState<TableShareLinkState>({
    enabled: false,
    permission: "view",
    shareToken: null,
    updatedAt: null,
  });

  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);

  const noun = resourceLabel;
  const nounTitle = noun === "document" ? "Document" : "Table";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    adapter
      .getSharing(tableId, controller.signal)
      .then((res) => {
        const nextShares = Array.isArray(res?.shares) ? res.shares : [];
        const nextLink = res?.link ?? {
          enabled: false,
          permission: "view",
          shareToken: null,
          updatedAt: null,
        };
        setShares(nextShares);
        setLink(nextLink);
        onSharingChanged?.(nextShares.length > 0 || Boolean(nextLink.enabled));
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoadError(adapter.errorMessage(err, "Sharing settings couldn't be loaded right now."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [adapter, tableId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyAction) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busyAction, onClose]);

  const submitMemberShare = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = recipient.trim();
    if (!cleaned) {
      setFormError("Enter a Persora 7-digit ID or email address.");
      return;
    }
    setBusyAction("add-member");
    setFormError("");
    try {
      const res = await adapter.shareWithMember(tableId, cleaned, permission);
      setShares((prev) => {
        const next = prev.some((s) => s.id === res.share.id)
          ? prev.map((s) => (s.id === res.share.id ? res.share : s))
          : [...prev, res.share];
        onSharingChanged?.(next.length > 0 || Boolean(link.enabled));
        return next;
      });
      setRecipient("");
      notify(res.created ? `Shared "${tableName}" with ${res.share.recipientName}.` : `Updated access for ${res.share.recipientName}.`);
    } catch (err) {
      setFormError(adapter.errorMessage(err, `Could not share this ${noun} with that member.`));
    } finally {
      setBusyAction(null);
    }
  };

  const changeMemberPermission = async (share: TableMemberShare, nextPerm: SharePermission) => {
    setBusyAction(`perm:${share.id}`);
    setFormError("");
    try {
      const updated = await adapter.updateMemberPermission(tableId, share.id, nextPerm);
      setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      notify(`Updated ${share.recipientName}'s permission.`);
    } catch (err) {
      notify(adapter.errorMessage(err, "Permission could not be updated."), "error");
    } finally {
      setBusyAction(null);
    }
  };

  const revokeMember = async (share: TableMemberShare) => {
    setBusyAction(`revoke:${share.id}`);
    setFormError("");
    try {
      await adapter.revokeMemberShare(tableId, share.id);
      setShares((prev) => {
        const next = prev.filter((s) => s.id !== share.id);
        onSharingChanged?.(next.length > 0 || Boolean(link.enabled));
        return next;
      });
      notify(`Removed ${share.recipientName}'s access.`);
    } catch (err) {
      notify(adapter.errorMessage(err, "Access could not be revoked."), "error");
    } finally {
      setBusyAction(null);
    }
  };

  const updateLinkAccess = async (
    options: { enabled: boolean; permission?: TablePublicLinkPermission; regenerate?: boolean },
    successMessage: string,
  ) => {
    setBusyAction(options.regenerate ? "regenerate-link" : "update-link");
    setFormError("");
    try {
      const next = await adapter.configureShareLink(tableId, options);
      setLink(next);
      onSharingChanged?.(shares.length > 0 || Boolean(next.enabled));
      setCopied(false);
      notify(successMessage);
    } catch (err) {
      setFormError(adapter.errorMessage(err, "Link sharing settings could not be updated."));
    } finally {
      setBusyAction(null);
    }
  };

  const publicUrl = link.enabled && link.shareToken ? adapter.buildPublicUrl(link.shareToken) : "";

  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      notify(`Public ${noun} link copied.`);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      notify("Could not copy automatically — select and copy the link field.", "error");
    }
  };

  const linkPermissionCopy =
    link.permission === "edit"
      ? allowComment
        ? `Anyone with the link can view, comment, and edit this ${noun} live.`
        : `Anyone with the link can view and edit this ${noun}.`
      : link.permission === "comment"
        ? `Anyone with the link can view this ${noun} full-screen and add comments.`
        : `Anyone with the link can view this ${noun} full-screen without signing in.`;

  return (
    <ItemModalShell
      labelledBy="tb-share-dialog-title"
      className="record-share-dialog tb-share-unified-dialog"
      backdropClassName="record-share-backdrop"
      icon={<UsersRound size={19} />}
      eyebrow="Share with Persora member or link"
      title={`Share ${noun}`}
      onClose={onClose}
      closeDisabled={Boolean(busyAction)}
      dismissable={!busyAction}
    >
      <div className="vault-modal-scroll record-share-body">
        <div className="record-share-target-banner">
          <span className="record-share-target-label">SELECTED {noun.toUpperCase()}</span>
          <p className="record-share-target-title">{tableName}</p>
        </div>

        {loading ? (
          <p className="record-share-muted" role="status">
            <Spinner className="size-3.5" /> Loading sharing settings…
          </p>
        ) : loadError ? (
          <div className="record-share-error" role="alert">
            <CircleAlert size={14} />
            <span>{loadError}</span>
          </div>
        ) : (
          <>
            <form className="record-share-form" onSubmit={(e) => void submitMemberShare(e)}>
              <div className="record-share-input-row">
                <label className="field-label" style={{ flex: 1 }} htmlFor="tb-share-recipient">
                  <span>Persora ID or member email address</span>
                  <input
                    id="tb-share-recipient"
                    type="text"
                    aria-label="Member Persora ID or email"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="e.g. 4829104 or member@example.com"
                    autoFocus
                    disabled={Boolean(busyAction)}
                  />
                </label>

                <label className="field-label" style={{ width: "148px" }} htmlFor="tb-share-permission">
                  <span>Permission</span>
                  <select
                    id="tb-share-permission"
                    aria-label="Member permission"
                    className="record-share-select"
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as SharePermission)}
                    disabled={Boolean(busyAction)}
                  >
                    <option value="view">Can view</option>
                    {allowComment && <option value="comment">Can comment</option>}
                    <option value="edit">Can edit</option>
                  </select>
                </label>
              </div>

              <div className="record-share-privacy">
                <ShieldCheck size={15} />
                <span>
                  Only this selected {noun} is shared. Private vault documents, passwords, and other records remain isolated.
                </span>
              </div>

              {formError && (
                <div className="record-share-error" role="alert">
                  <CircleAlert size={14} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="record-share-form-actions">
                <button
                  type="submit"
                  className="editor-submit record-share-submit"
                  disabled={Boolean(busyAction) || !recipient.trim()}
                >
                  {busyAction === "add-member" ? (
                    <>
                      <Spinner className="size-3.5" /> Sharing…
                    </>
                  ) : (
                    <>
                      Share {noun} <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="record-share-access-area">
              <div className="record-share-access-head">
                <b>People with access</b>
                <Badge variant="secondary" size="xs" radius="full">
                  {shares.length + 1}
                </Badge>
              </div>
              <div className="record-share-access-list">
                <div className="record-share-access-item">
                  <span className="record-share-access-avatar">YO</span>
                  <div className="record-share-access-info">
                    <b>You ({nounTitle} owner)</b>
                    <small>Full ownership &amp; sharing controls</small>
                  </div>
                  <Badge variant="outline" size="xs" radius="full">
                    Owner
                  </Badge>
                </div>

                {shares.map((share) => (
                  <div className="record-share-access-item" key={share.id}>
                    <span className="record-share-access-avatar">{initials(share.recipientName)}</span>
                    <div className="record-share-access-info">
                      <b>{share.recipientName}</b>
                      <small>
                        {share.recipientLoginId ? `ID #${share.recipientLoginId}` : ""}
                        {share.recipientLoginId && share.recipientEmail ? " · " : ""}
                        {share.recipientEmail}
                      </small>
                    </div>
                    <select
                      aria-label={`Permission for ${share.recipientName}`}
                      className="record-share-access-select"
                      value={share.permission}
                      disabled={Boolean(busyAction)}
                      onChange={(e) => void changeMemberPermission(share, e.target.value as SharePermission)}
                    >
                      <option value="view">Can view</option>
                      {allowComment && <option value="comment">Can comment</option>}
                      <option value="edit">Can edit</option>
                    </select>
                    <button
                      type="button"
                      className="record-share-revoke-btn"
                      aria-label={`Revoke access for ${share.recipientName}`}
                      title="Stop sharing"
                      disabled={Boolean(busyAction)}
                      onClick={() => void revokeMember(share)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="tb-share-link-card">
              <div className="tb-share-link-top">
                <div className="tb-share-link-heading">
                  <IconTile variant="soft" size="sm" className={link.enabled ? "ds-tone-blue" : "ds-tone-slate"}>
                    {link.enabled ? <Globe2 size={16} /> : <Lock size={16} />}
                  </IconTile>
                  <div className="tb-share-link-copy">
                    <strong className="tb-share-link-title">General access</strong>
                    <small className="tb-share-link-desc">
                      {link.enabled
                        ? linkPermissionCopy
                        : `Restricted — only people invited above can open this ${noun}.`}
                    </small>
                  </div>
                </div>

                <div className="tb-share-link-controls">
                  <select
                    aria-label="General link access"
                    className="record-share-access-select"
                    value={link.enabled ? "anyone" : "restricted"}
                    disabled={Boolean(busyAction)}
                    onChange={(e) => {
                      const enable = e.target.value === "anyone";
                      void updateLinkAccess(
                        { enabled: enable, permission: link.permission },
                        enable ? "Public share link enabled." : "Public link disabled — previous link revoked.",
                      );
                    }}
                  >
                    <option value="restricted">Restricted</option>
                    <option value="anyone">Anyone with the link</option>
                  </select>

                  {link.enabled && (
                    <select
                      aria-label="Public link permission"
                      className="record-share-access-select"
                      value={link.permission}
                      disabled={Boolean(busyAction)}
                      onChange={(e) => {
                        const nextPerm = e.target.value as TablePublicLinkPermission;
                        const msg =
                          nextPerm === "edit"
                            ? `Anyone with the link can now edit this ${noun}.`
                            : nextPerm === "comment"
                              ? "Anyone with the link can now comment."
                              : "Link changed to view-only.";
                        void updateLinkAccess({ enabled: true, permission: nextPerm }, msg);
                      }}
                    >
                      <option value="view">Viewer</option>
                      {allowComment && <option value="comment">Commenter</option>}
                      <option value="edit">Editor</option>
                    </select>
                  )}
                </div>
              </div>

              {link.enabled && publicUrl && (
                <div className="tb-share-link-url-box">
                  <input
                    type="text"
                    readOnly
                    aria-label="Public share link URL"
                    value={publicUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="quiet-button tb-share-copy-btn" onClick={() => void copyPublicUrl()}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? "Copied" : "Copy link"}</span>
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="quiet-button tb-share-open-link"
                    title={`Open full-screen public ${noun} in a new tab`}
                  >
                    <ExternalLink size={14} />
                    <span>Open</span>
                  </a>
                </div>
              )}

              {link.enabled && (
                <div className="tb-share-link-footer">
                  <button
                    type="button"
                    className="tb-link-action-btn"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void updateLinkAccess(
                        { enabled: true, permission: link.permission, regenerate: true },
                        "Generated a new link — any old link is now permanently revoked.",
                      )
                    }
                  >
                    {busyAction === "regenerate-link" ? <Spinner className="size-3.5" /> : <RefreshCw size={13} />}
                    Regenerate link &amp; revoke old URL
                  </button>
                  <button
                    type="button"
                    className="tb-link-action-btn is-danger"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void updateLinkAccess(
                        { enabled: false, permission: link.permission },
                        "Public access disabled and link revoked.",
                      )
                    }
                  >
                    Disable public link
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="editor-form-footer">
        <div className="editor-footnote">
          <Lock size={13} />
          <span>Access changes apply immediately across workspaces &amp; links</span>
        </div>
        <div className="editor-actions">
          <button type="button" className="editor-submit" onClick={onClose} disabled={Boolean(busyAction)}>
            Done
          </button>
        </div>
      </div>
    </ItemModalShell>
  );
}
