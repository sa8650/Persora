import { useMemo, useState } from "react";
import { ArchiveRestore, BriefcaseBusiness, CalendarClock, FileText, HeartPulse, KeyRound, RefreshCw, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import "./trash.css";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";
import { SECTION_BY_ID } from "../data";
import type { SectionId, TrashEntry, TrashKind } from "../types";

const KIND_ICONS: Record<TrashKind, typeof FileText> = {
  vault_item: FileText,
  contact: UsersRound,
  business_card: BriefcaseBusiness,
  medical_record: HeartPulse,
  timeline_event: CalendarClock,
  password_entry: KeyRound,
};

const KIND_LABELS: Record<TrashKind, string> = {
  vault_item: "Vault record",
  contact: "Contact",
  business_card: "Business card",
  medical_record: "Medical record",
  timeline_event: "Timeline entry",
  password_entry: "Password",
};

const SPACE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  "business-cards": "Business cards",
  "medical-records": "Medical Records",
  timeline: "Life Timeline",
  "password-manager": "Password Manager",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function spaceLabel(entry: TrashEntry): string {
  if (!entry.space) return "Persora";
  if (entry.space in SPACE_LABELS) return SPACE_LABELS[entry.space];
  return SECTION_BY_ID[entry.space as SectionId]?.label || "Vault";
}

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function remaining(entry: TrashEntry, now: number): { label: string; urgent: boolean } {
  const ms = Date.parse(entry.expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return { label: "Expiring…", urgent: true };
  const days = ms / DAY_MS;
  if (days < 1) return { label: "Permanently deleted in under a day", urgent: true };
  const rounded = Math.ceil(days);
  return { label: `${rounded} day${rounded === 1 ? "" : "s"} left`, urgent: days < 2 };
}

export default function TrashView({ entries, busy, onRefresh, onRestore, onDeleteForever, onEmptyTrash, notify }: {
  entries: TrashEntry[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onRestore: (entry: TrashEntry) => Promise<void>;
  onDeleteForever: (entry: TrashEntry) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<TrashEntry | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [emptying, setEmptying] = useState(false);
  const now = Date.now();

  const soonest = useMemo(() => entries.reduce<string | null>((best, entry) => {
    if (!best || Date.parse(entry.expiresAt) < Date.parse(best)) return entry.expiresAt;
    return best;
  }, null), [entries]);

  const run = async (action: () => Promise<void>, successMessage: string) => {
    try {
      await action();
      if (successMessage) notify(successMessage);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Trash couldn't complete that action.", "error");
    }
  };

  const restoreEntry = async (entry: TrashEntry) => {
    setPendingId(entry.id);
    try { await run(() => onRestore(entry), "" /* the app-level handler toasts the details */); }
    finally { setPendingId(""); }
  };

  const deleteForever = async () => {
    if (!confirmDelete) return;
    const entry = confirmDelete;
    setPendingId(entry.id);
    try {
      await run(() => onDeleteForever(entry), "");
      setConfirmDelete(null);
    } finally { setPendingId(""); }
  };

  const emptyTrash = async () => {
    setEmptying(true);
    try {
      await run(async () => { await onEmptyTrash(); }, "");
      setConfirmEmpty(false);
    } finally { setEmptying(false); }
  };

  return <div className="section-view trash-view">
    <div className="trash-toolbar">
      <span className="trash-count-pill"><Trash2 size={13}/>{entries.length ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : "Empty"}</span>
      {soonest && entries.length > 0 && <span className="trash-toolbar-note">Auto-purged after 7 days · next expiry {dateLabel(soonest)}</span>}
      <span className="trash-toolbar-spacer"/>
      <button type="button" className="icon-button trash-refresh" onClick={() => void run(onRefresh, "")} disabled={busy} aria-label="Refresh Trash" title="Refresh Trash"><RefreshCw size={16} className={busy ? "trash-spinning" : ""}/></button>
      <button type="button" className="trash-empty-button" onClick={() => setConfirmEmpty(true)} disabled={busy || !entries.length}><Trash2 size={14}/> Empty trash</button>
    </div>

    {entries.length ? <div className="trash-list">
      {entries.map((entry) => {
        const Icon = KIND_ICONS[entry.kind] || FileText;
        const left = remaining(entry, now);
        const working = pendingId === entry.id;
        return <article className={`trash-row ${working ? "trash-row-busy" : ""}`} key={`${entry.kind}:${entry.id}`}>
          <span className={`trash-row-icon trash-icon-${entry.kind}`}><Icon size={17}/></span>
          <div className="trash-row-copy">
            <h3>{entry.title || KIND_LABELS[entry.kind]}</h3>
            <p>
              <span className="trash-kind-chip">{KIND_LABELS[entry.kind]}</span>
              {entry.kind === "vault_item" ? " from " : " in "}
              <b>{spaceLabel(entry)}</b>
              {entry.folder && <> · {entry.folder}</>}
              {entry.eventDate && <> · {dateLabel(entry.eventDate)}</>}
              {entry.hasFiles ? " · has attachments" : ""}
            </p>
            <p className="trash-row-dates">Deleted {dateLabel(entry.deletedAt)} · Permanent deletion {dateLabel(entry.expiresAt)}</p>
          </div>
          <span className={`trash-remaining ${left.urgent ? "trash-remaining-urgent" : ""}`}>{left.label}</span>
          <div className="trash-row-actions">
            <button type="button" className="quiet-button trash-restore-button" disabled={busy || working} onClick={() => void restoreEntry(entry)}><ArchiveRestore size={14}/> Restore</button>
            <button type="button" className="trash-delete-button" disabled={busy || working} onClick={() => setConfirmDelete(entry)}><Trash2 size={14}/> Delete forever</button>
          </div>
        </article>;
      })}
    </div> : <div className="section-empty">
      <div className="empty-icon-stack"><div className="empty-icon-circle tag-slate"><Trash2 size={21}/></div><span>✦</span></div>
      <h3>Your Trash is empty</h3>
      <p>Deleted records, contacts, cards, medical entries, and timeline posts wait here for 7 days before they're permanently removed.</p>
    </div>}

    <footer className="trash-footnote"><ShieldCheck size={14}/><span>Trash is private to your account. Restoration puts items back with their folders when possible, and permanently deleting also removes their uploaded files from secure storage when nothing else uses them.</span></footer>

    {confirmDelete && <ModalPortal><ConfirmDialog title="Delete forever?" confirmLabel="Delete forever" onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteForever()}>
      <p><b>{confirmDelete.title || KIND_LABELS[confirmDelete.kind]}</b> will be permanently deleted{confirmDelete.hasFiles ? ", including its uploaded files" : ""}. This action can't be undone.</p>
    </ConfirmDialog></ModalPortal>}
    {confirmEmpty && <ModalPortal><ConfirmDialog title="Empty the trash?" confirmLabel={`Empty trash (${entries.length})`} onCancel={() => setConfirmEmpty(false)} onConfirm={() => void emptyTrash()}>
      <p>All {entries.length} item{entries.length === 1 ? "" : "s"} will be permanently deleted, including uploaded files that nothing else uses. This action can't be undone.{emptying ? " Working…" : ""}</p>
    </ConfirmDialog></ModalPortal>}
  </div>;
}
