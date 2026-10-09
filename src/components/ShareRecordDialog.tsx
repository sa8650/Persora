import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Check, CircleAlert, Clock, ShieldCheck, Trash2, UserCheck, UsersRound } from "lucide-react";
import ItemModalShell from "./ItemModalShell";
import type { RecordShareEntry, SharedVaultEntry, SharePermission } from "../types";

const RECENT_RECIPIENTS_STORAGE_KEY = "persora_recent_share_recipients";

export interface RecentRecipient {
  userId?: string;
  name?: string;
  email?: string;
}

export interface UnifiedShareModalProps {
  title: string;
  kind?: string; // "document" | "contact" | "digital business card" | etc.
  existingShares?: SharedVaultEntry[];
  recentEntries?: (RecordShareEntry | SharedVaultEntry)[];
  allowPermissionChoice?: boolean;
  onShare: (recipient: string, permission?: SharePermission) => Promise<void>;
  onPermissionChange?: (shareId: string, permission: SharePermission) => Promise<void>;
  onRevokeShare?: (shareId: string) => Promise<void>;
  onClose: () => void;
}

export default function ShareRecordDialog({
  title,
  kind = "record",
  existingShares = [],
  recentEntries = [],
  allowPermissionChoice = false,
  onShare,
  onPermissionChange,
  onRevokeShare,
  onClose,
}: UnifiedShareModalProps) {
  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [busy, setBusy] = useState(false);
  const [busyShareId, setBusyShareId] = useState("");
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [localRecents, setLocalRecents] = useState<RecentRecipient[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_RECIPIENTS_STORAGE_KEY);
      if (stored) {
        setLocalRecents(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  const suggestions = useMemo(() => {
    const list: RecentRecipient[] = [];
    const seen = new Set<string>();

    for (const r of localRecents) {
      const key = (r.userId || r.email || "").toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push(r);
      }
    }

    for (const entry of recentEntries) {
      const person = "recipient" in entry ? entry.recipient : null;
      if (person) {
        const key = (person.userId || person.email || "").toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          list.push({
            userId: person.userId,
            name: person.fullName,
            email: person.email,
          });
        }
      }
    }
    return list.slice(0, 6);
  }, [localRecents, recentEntries]);

  const recordSuccess = (val: string) => {
    try {
      const trimmed = val.trim();
      const updated = [
        { userId: /^\d{7}$/.test(trimmed) ? trimmed : undefined, email: trimmed.includes("@") ? trimmed : undefined },
        ...localRecents.filter((r) => r.userId !== trimmed && r.email !== trimmed),
      ].slice(0, 8);
      localStorage.setItem(RECENT_RECIPIENTS_STORAGE_KEY, JSON.stringify(updated));
      setLocalRecents(updated);
    } catch {
      // ignore
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = recipient.trim();
    if (!target) return;
    setBusy(true);
    setError("");
    setSuccessNotice("");
    try {
      await onShare(target, permission);
      recordSuccess(target);
      setSuccessNotice(`Shared successfully with ${target}`);
      setRecipient("");
      if (!existingShares.length && !allowPermissionChoice) {
        onClose();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `This ${kind} could not be shared.`);
    } finally {
      setBusy(false);
    }
  };

  const updateShare = async (shareId: string, action: () => Promise<void>) => {
    setBusyShareId(shareId);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sharing access could not be updated.");
    } finally {
      setBusyShareId("");
    }
  };

  return (
    <ItemModalShell
      labelledBy="record-share-title"
      className="record-share-dialog"
      backdropClassName="record-share-backdrop"
      icon={<UsersRound size={19} />}
      eyebrow="Share with Persora member"
      title={`Share ${kind}`}
      onClose={onClose}
      closeDisabled={busy}
      dismissable={!busy}
    >
      <div className="vault-modal-scroll record-share-body">
        <div className="record-share-target-banner">
          <span className="record-share-target-label">SELECTED RECORD</span>
          <p className="record-share-target-title">{title}</p>
        </div>

        <form className="record-share-form" onSubmit={(event) => void submit(event)}>
          <div className="record-share-input-row">
            <label className="field-label" style={{ flex: 1 }}>
              <span>Persora ID or member email address</span>
              <input
                autoFocus
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="e.g. 1234567 or member@example.com"
                maxLength={254}
                disabled={busy}
                required
              />
            </label>
            {allowPermissionChoice && (
              <label className="field-label" style={{ width: "135px" }}>
                <span>Permission</span>
                <select
                  value={permission}
                  onChange={(event) => setPermission(event.target.value as SharePermission)}
                  disabled={busy}
                  className="record-share-select"
                >
                  <option value="view">Can view</option>
                  <option value="comment">Can comment</option>
                  <option value="edit">Can edit</option>
                </select>
              </label>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="record-share-recents">
              <div className="record-share-recents-header">
                <Clock size={12} />
                <span>Recent Persora members</span>
              </div>
              <div className="record-share-chips">
                {suggestions.map((s, idx) => {
                  const label = s.name ? `${s.name}${s.userId ? ` (${s.userId})` : ""}` : (s.userId || s.email || "");
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="record-share-chip"
                      onClick={() => setRecipient(s.userId || s.email || "")}
                      disabled={busy}
                      title={s.email || s.userId || ""}
                    >
                      <UserCheck size={12} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="record-share-privacy">
            <ShieldCheck size={15} />
            <span>Only this selected {kind} is shared directly. Vault passwords and other private records remain hidden.</span>
          </div>

          {error && (
            <div className="record-share-error" role="alert">
              <CircleAlert size={14} />
              <span>{error}</span>
            </div>
          )}

          {successNotice && (
            <div className="record-share-success" role="status">
              <Check size={14} />
              <span>{successNotice}</span>
            </div>
          )}

          <div className="record-share-form-actions">
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button type="submit" className="editor-submit record-share-submit" disabled={busy || !recipient.trim()}>
              {busy ? "Sharing…" : <>Share record <ArrowRight size={14} /></>}
            </button>
          </div>
        </form>

        {existingShares.length > 0 && (
          <div className="record-share-access-area">
            <div className="record-share-access-head">
              <b>People with access</b>
              <span>{existingShares.length}</span>
            </div>
            <div className="record-share-access-list">
              {existingShares.map((share) => (
                <div className="record-share-access-item" key={share.shareId}>
                  <span className="record-share-access-avatar">
                    {share.recipient.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div className="record-share-access-info">
                    <b>{share.recipient.fullName}</b>
                    <small>{share.recipient.email} · ID {share.recipient.userId}</small>
                  </div>
                  {onPermissionChange && (
                    <select
                      className="record-share-access-select"
                      aria-label={`Permission for ${share.recipient.fullName}`}
                      value={share.permission}
                      disabled={busyShareId === share.shareId}
                      onChange={(event) =>
                        void updateShare(share.shareId, () =>
                          onPermissionChange(share.shareId, event.target.value as SharePermission)
                        )
                      }
                    >
                      <option value="view">Can view</option>
                      <option value="comment">Can comment</option>
                      <option value="edit">Can edit</option>
                    </select>
                  )}
                  {onRevokeShare && (
                    <button
                      type="button"
                      className="record-share-revoke-btn"
                      disabled={busyShareId === share.shareId}
                      onClick={() => void updateShare(share.shareId, () => onRevokeShare(share.shareId))}
                      aria-label={`Revoke access for ${share.recipient.fullName}`}
                      title="Stop sharing"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ItemModalShell>
  );
}
