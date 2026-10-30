import { useMemo, useState } from "react";
import { ArchiveRestore, AudioLines, BriefcaseBusiness, Camera, CalendarClock, Clock3, Eye, FileStack, FileText, FolderOpen, HeartPulse, KeyRound, Paperclip, RefreshCw, Sheet, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import "./trash.css";
import ModalPortal from "./ModalPortal";
import ItemModalShell from "./ItemModalShell";
import { ConfirmDialog } from "./VaultDialogs";
import { MagicCard } from "./magic-ui";
import { SECTION_BY_ID } from "../data";
import type { SectionId, TrashEntry, TrashKind } from "../types";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";
import { PersoraEmptyState } from "@/design-system";

const KIND_ICONS: Record<TrashKind, typeof FileText> = {
  vault_item: FileText,
  contact: UsersRound,
  business_card: BriefcaseBusiness,
  medical_record: HeartPulse,
  timeline_event: CalendarClock,
  password_entry: KeyRound,
  photo_studio_photo: Camera,
  pdf_studio_document: FileStack,
  persora_table: Sheet,
  persora_doc: FileText,
  audio_space_item: AudioLines,
};

const KIND_LABELS: Record<TrashKind, string> = {
  vault_item: "Vault record",
  contact: "Contact",
  business_card: "Business card",
  medical_record: "Medical record",
  timeline_event: "Timeline entry",
  password_entry: "Password",
  photo_studio_photo: "Studio photo",
  pdf_studio_document: "PDF",
  persora_table: "Table",
  persora_doc: "Document",
  audio_space_item: "Audio",
};

const SPACE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  "business-cards": "Business cards",
  "medical-records": "Medical Records",
  timeline: "Life Timeline",
  "password-manager": "Password Manager",
  "photo-studio": "Photo Studio",
  "pdf-studio": "PDF Studio",
  "audio-space": "AudioSpace",
  "persora-table": "Persora Table",
  "persora-docs": "Persora Docs",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function spaceLabel(entry: TrashEntry): string {
  if (!entry.space) return "Persora";
  if (entry.space in SPACE_LABELS) return SPACE_LABELS[entry.space];
  return SECTION_BY_ID[entry.space as SectionId]?.label || "Vault";
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function remaining(entry: TrashEntry, now: number): { label: string; urgent: boolean } {
  const ms = Date.parse(entry.expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return { label: "Expiring…", urgent: true };
  const days = ms / DAY_MS;
  if (days < 1) return { label: "Under a day left", urgent: true };
  const rounded = Math.ceil(days);
  return { label: `${rounded} day${rounded === 1 ? "" : "s"} left`, urgent: days < 2 };
}

function ViewItemModal({ entry, onClose, onRestore, onDelete }: {
  entry: TrashEntry;
  onClose: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICONS[entry.kind] || FileText;
  const metadata: [string, string][] = [
    ["Type", KIND_LABELS[entry.kind] || "Item"],
    ["Original location", spaceLabel(entry)],
    ...(entry.folder ? [["Original folder", entry.folder] as [string, string]] : []),
    ...(entry.recordType ? [["Record type", entry.recordType] as [string, string]] : []),
    ...(entry.eventDate ? [["Event date", dateLabel(entry.eventDate)] as [string, string]] : []),
    ["Deleted", dateLabel(entry.deletedAt)],
    ["Expires", dateLabel(entry.expiresAt)],
    ["Attachments", entry.hasFiles ? "Includes uploaded files" : "No uploaded files"],
  ];
  const left = remaining(entry, Date.now());
  return (
    <ModalPortal>
      <ItemModalShell
        labelledBy="trash-item-view-title"
        className="vault-modal-detail trash-view-modal"
        icon={<Icon size={19} />}
        iconClassName={`detail-icon trash-icon-${entry.kind}`}
        eyebrow="Trash item details"
        title={entry.title || KIND_LABELS[entry.kind]}
        headerMeta={<Badge variant="secondary" size="xs" radius="full"><Trash2 size={12} /> RETAINED FOR 7 DAYS</Badge>}
        onClose={onClose}
        closeLabel="Close item details"
      >
        <div className="vault-modal-scroll trash-view-body">
          <div className="trash-detail-summary">
            <IconTile variant="soft" size="sm" className={`trash-icon-${entry.kind}`}><Icon size={18} /></IconTile>
            <div><b>{entry.title || KIND_LABELS[entry.kind]}</b><span>{KIND_LABELS[entry.kind]} · {spaceLabel(entry)}</span></div>
            <Badge variant={left.urgent ? "warning-outline" : "info-outline"} size="xs" radius="full">{left.label}</Badge>
          </div>
          <div className="detail-fields-grid trash-detail-grid">
            {metadata.map(([label, value]) => <div className="detail-field" key={label}><span>{label}</span><b>{value}</b></div>)}
          </div>
          <p className="trash-modal-retention"><ShieldCheck size={14} /> Items are kept for seven days after deletion, then permanently purged by the backend. Restoring returns the item to its original location when it is still available.</p>
        </div>
        <div className="detail-footer trash-modal-footer">
          <span><Clock3 size={14} /> Expires {dateLabel(entry.expiresAt)}</span>
          <div>
            <button type="button" className="quiet-button" onClick={onClose}>Close</button>
            <button type="button" className="quiet-button trash-restore-button" onClick={onRestore}><ArchiveRestore size={14} /> Restore</button>
            <button type="button" className="trash-delete-button" onClick={onDelete}><Trash2 size={14} /> Delete permanently</button>
          </div>
        </div>
      </ItemModalShell>
    </ModalPortal>
  );
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
  const [viewEntry, setViewEntry] = useState<TrashEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrashEntry | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [emptying, setEmptying] = useState(false);
  const now = Date.now();

  const soonest = useMemo(() => entries.reduce<string | null>((best, entry) => {
    if (!best || Date.parse(entry.expiresAt) < Date.parse(best)) return entry.expiresAt;
    return best;
  }, null), [entries]);

  const run = async (action: () => Promise<void>, successMessage: string): Promise<boolean> => {
    try {
      await action();
      if (successMessage) notify(successMessage);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Trash couldn't complete that action.", "error");
      return false;
    }
  };

  const restoreEntry = async (entry: TrashEntry): Promise<boolean> => {
    setPendingId(entry.id);
    try { return await run(() => onRestore(entry), "" /* the app-level handler toasts the details */); }
    finally { setPendingId(""); }
  };

  const deleteForever = async () => {
    if (!confirmDelete) return;
    const entry = confirmDelete;
    setPendingId(entry.id);
    try {
      const deleted = await run(() => onDeleteForever(entry), "");
      if (deleted) {
        setConfirmDelete(null);
        if (viewEntry?.id === entry.id && viewEntry.kind === entry.kind) setViewEntry(null);
      }
    } finally { setPendingId(""); }
  };

  const emptyTrash = async () => {
    setEmptying(true);
    try {
      const emptied = await run(async () => { await onEmptyTrash(); }, "");
      if (emptied) { setConfirmEmpty(false); setViewEntry(null); }
    } finally { setEmptying(false); }
  };

  return <div className="section-view trash-view">
    <div className="trash-toolbar">
      <Badge variant="outline" size="sm" radius="full"><Trash2 size={13}/>{entries.length ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : "Empty"}</Badge>
      {soonest && entries.length > 0 && <span className="trash-toolbar-note">Auto-purged after 7 days · next expiry {dateLabel(soonest)}</span>}
      <span className="trash-toolbar-spacer"/>
      <button type="button" className="icon-button trash-refresh" onClick={() => void run(onRefresh, "")} disabled={busy} aria-label="Refresh Trash" title="Refresh Trash">{busy ? <Spinner className="size-4"/> : <RefreshCw size={16}/>}</button>
      <button type="button" className="trash-empty-button" onClick={() => setConfirmEmpty(true)} disabled={busy || !entries.length}><Trash2 size={14}/> Empty trash</button>
    </div>

    {entries.length ? <div className="trash-list">
      {entries.map((entry) => {
        const Icon = KIND_ICONS[entry.kind] || FileText;
        const left = remaining(entry, now);
        const working = pendingId === entry.id;
        return <MagicCard className={`trash-card-shell ${working ? "trash-row-busy" : ""}`} key={`${entry.kind}:${entry.id}`}>
          <article className="trash-row">
            <IconTile variant="soft" size="sm" className={`trash-icon-${entry.kind}`}><Icon size={16}/></IconTile>
            <div className="trash-row-copy">
              <h3><button type="button" className="trash-view-link" onClick={() => setViewEntry(entry)}>{entry.title || KIND_LABELS[entry.kind]}</button></h3>
              <p><Badge variant="secondary" size="xs" radius="full" className="mr-0.5">{KIND_LABELS[entry.kind]}</Badge> in <b>{spaceLabel(entry)}</b>{entry.folder && <> · <FolderOpen size={12}/> {entry.folder}</>}{entry.recordType && <> · {entry.recordType}</>}{entry.eventDate && <> · {dateLabel(entry.eventDate)}</>}{entry.hasFiles && <> · <Paperclip size={12}/> attachments</>}</p>
              <p className="trash-row-dates">Deleted {dateLabel(entry.deletedAt)} · Expires {dateLabel(entry.expiresAt)}</p>
            </div>
            <Badge variant={left.urgent ? "warning-outline" : "info-outline"} size="xs" radius="full" className="trash-remaining">{left.label}</Badge>
            <div className="trash-row-actions">
              <button type="button" className="trash-view-button" disabled={busy || working} onClick={() => setViewEntry(entry)}><Eye size={14}/> View</button>
              <button type="button" className="quiet-button trash-restore-button" disabled={busy || working} onClick={() => void restoreEntry(entry)}><ArchiveRestore size={14}/> Restore</button>
              <button type="button" className="trash-delete-button" disabled={busy || working} onClick={() => setConfirmDelete(entry)}><Trash2 size={14}/> Delete</button>
            </div>
          </article>
        </MagicCard>;
      })}
    </div> : <PersoraEmptyState
      icon={<Trash2 size={20}/>}
      tone="slate"
      title="Your Trash is empty"
      description="Deleted records, contacts, cards, medical entries, and timeline posts wait here for 7 days before they're permanently removed."
    />}

    <footer className="trash-footnote"><ShieldCheck size={14}/><span>Trash is private to your account. Restoration puts items back with their folders when possible, and permanently deleting also removes their uploaded files from secure storage when nothing else uses them.</span></footer>

    {viewEntry && <ViewItemModal entry={viewEntry} onClose={() => setViewEntry(null)} onRestore={() => { void restoreEntry(viewEntry).then((restored) => { if (restored) setViewEntry(null); }); }} onDelete={() => setConfirmDelete(viewEntry)} />}
    {confirmDelete && <ModalPortal><ConfirmDialog title="Delete forever?" confirmLabel="Delete forever" onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteForever()}>
      <p><b>{confirmDelete.title || KIND_LABELS[confirmDelete.kind]}</b> will be permanently deleted{confirmDelete.hasFiles ? ", including its uploaded files" : ""}. This action can't be undone.</p>
    </ConfirmDialog></ModalPortal>}
    {confirmEmpty && <ModalPortal><ConfirmDialog title="Empty the trash?" confirmLabel={`Empty trash (${entries.length})`} onCancel={() => setConfirmEmpty(false)} onConfirm={() => void emptyTrash()}>
      <p>All {entries.length} item{entries.length === 1 ? "" : "s"} will be permanently deleted, including uploaded files that nothing else uses. This action can't be undone.{emptying ? " Working…" : ""}</p>
    </ConfirmDialog></ModalPortal>}
  </div>;
}
