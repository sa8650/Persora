// Persora AudioSpace — the private audio library dashboard.
//
// A dedicated Persora space to store, record, organize, play and manage
// important audio files. Sections: Overview, All Audio, Recent, Favorites,
// My Recordings, Audio Links, Folders and Trash — with search, sorting,
// filtering, grid/list views, multi-selection and a persistent mini-player.
// (AudioSpace is an audio archive and management tool, not a music service.)
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle, ArrowDownUp, AudioLines, Check, ChevronRight, ClipboardCopy, Clock3, Download, ExternalLink,
  FileAudio, FolderOpen, Grid2X2, Heart, Link2, List, Mic, Pencil, Play, RefreshCw, Search, ShieldCheck,
  Star, Trash2, Upload, X,
} from "lucide-react";
import type { AppUser, AudioSpaceItem, TrashEntry, VaultFolder } from "../../types";
import { deleteAudioSpaceItem, isPagesApiConfigured, listAudioSpaceItems, loadAudioSpaceFile, saveAudioSpaceLink, updateAudioSpaceItem } from "../../lib/cloud";
import {
  AUDIO_SECTIONS, type AudioSection, type AudioSort, AUDIO_UPLOAD_ACCEPT, filterAudioItems, folderCounts as audioFolderCounts,
  formatAudioBytes, formatDuration, folderName, formatDateLabel, privateStorageBytes, sectionCounts, sourceLabel,
} from "../../lib/audio-space";
import { Badge } from "../reui/badge";
import { Checkbox } from "../ui/checkbox";
import { IconTile } from "../reui/icon-tile";
import { PersoraAsideStat, PersoraEmptyState } from "../../design-system";
import VaultFolderShelf from "../VaultFolderShelf";
import MoreOptionsMenu, { type MoreMenuAction } from "../MoreOptionsMenu";
import ModalPortal from "../ModalPortal";
import { ConfirmDialog } from "../VaultDialogs";
import { AddAudioMenu, AudioDetailsDialog, AudioLinkDialog, AudioUploadDialog } from "./AudioDialogs";
import { AudioRecordDialog } from "./AudioRecorder";
import { trackForItem, WaveformBars, type AudioPlayerApi, type PlayerTrack } from "./AudioPlayerBar";
import "./audio-space.css";

interface Props {
  /** Workspace-level player: stays alive (and docked) on every page. */
  player: AudioPlayerApi;
  user: AppUser;
  canUpload: boolean;
  maxUploadMb: number;
  trashEntries: TrashEntry[];
  onTrashRestore: (entry: TrashEntry) => Promise<void>;
  onTrashChanged: () => void;
  onOpenTrash: () => void;
  onUpgrade?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

const SORT_LABELS: Record<AudioSort, string> = {
  newest: "Newest first", oldest: "Oldest first", title: "Title A–Z", longest: "Longest first", shortest: "Shortest first",
};

const SECTION_TABS: { id: AudioSection | "overview" | "trash"; label: string }[] = [
  { id: "overview", label: "Overview" },
  ...AUDIO_SECTIONS.map((entry) => ({ id: entry.id, label: entry.label })),
  { id: "trash", label: "Trash" },
];

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AudioSpaceView({ player, user, canUpload, maxUploadMb, trashEntries, onTrashRestore, onTrashChanged, onOpenTrash, onUpgrade, notify }: Props) {
  const available = !user.demo && isPagesApiConfigured;
  const [items, setItems] = useState<AudioSpaceItem[]>([]);
  const [loading, setLoading] = useState(available);
  const [loadError, setLoadError] = useState("");
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [folderReload, setFolderReload] = useState(0);
  const [section, setSection] = useState<AudioSection | "overview" | "trash">("overview");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<AudioSort>("newest");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [detailsFor, setDetailsFor] = useState<AudioSpaceItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AudioSpaceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [folderCreateToken, setFolderCreateToken] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const fileDialogToken = useRef(0);

  const saveBlockedReason = !canUpload
    ? "Saving audio uses your private storage and requires an active paid plan. You can still browse and preview."
    : undefined;

  const loadItems = useCallback(async () => {
    if (!available) return;
    setLoading(true); setLoadError("");
    try { setItems(await listAudioSpaceItems()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Your audio library couldn't be loaded."); }
    finally { setLoading(false); }
  }, [available]);
  useEffect(() => { void loadItems(); }, [loadItems]);

  useEffect(() => {
    player.registerItems(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const counts = useMemo(() => sectionCounts(items), [items]);
  const folderCountMap = useMemo(() => audioFolderCounts(items), [items]);
  const audioTrash = useMemo(() => trashEntries.filter((entry) => entry.kind === "audio_space_item"), [trashEntries]);
  const visible = useMemo(() => {
    if (section === "overview" || section === "trash") return [];
    return filterAudioItems(items, { section, query, folderId: selectedFolderId, tag: tagFilter || undefined, sort });
  }, [items, section, query, selectedFolderId, tagFilter, sort]);

  const recentItems = useMemo(() => filterAudioItems(items, { section: "recent", query: "", folderId: "", sort: "newest" }).slice(0, 6), [items]);
  const storageBytes = useMemo(() => privateStorageBytes(items), [items]);
  const recordingsCount = items.filter((item) => item.source === "recording").length;

  const queue: PlayerTrack[] = useMemo(() => visible.map(trackForItem), [visible]);
  const currentPlayingId = player.current?.id || "";
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  const onSaved = useCallback((item: AudioSpaceItem, folder: VaultFolder | null, createdFolder: boolean) => {
    setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
    if (folder && createdFolder) setFolderReload((value) => value + 1);
  }, []);

  // ----- File picker ---------------------------------------------------------
  const startUpload = () => {
    fileDialogToken.current += 1;
    uploadInputRef.current?.click();
  };
  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploadFiles(files);
  };

  // ----- Single-item actions -------------------------------------------------
  const toggleFavorite = async (item: AudioSpaceItem) => {
    try {
      const updated = await updateAudioSpaceItem(item.id, { favorite: !item.favorite });
      setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn't update favorites.", "error"); }
  };

  const moveItem = async (item: AudioSpaceItem, folderId: string | null) => {
    try {
      const updated = await updateAudioSpaceItem(item.id, { folderId });
      setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      notify(folderId ? `Moved to “${folderName(folders, folderId)}”.` : "Removed from its folder.");
    } catch (error) { notify(error instanceof Error ? error.message : "The audio couldn't be moved.", "error"); }
  };

  const downloadItem = async (item: AudioSpaceItem) => {
    try {
      const blob = await loadAudioSpaceFile(item.id);
      downloadBlob(blob, item.fileName || `${item.title}.mp3`);
    } catch (error) { notify(error instanceof Error ? error.message : "The audio couldn't be downloaded.", "error"); }
  };

  const copyLink = async (item: AudioSpaceItem) => {
    if (!item.externalUrl) return;
    try {
      await navigator.clipboard.writeText(item.externalUrl);
      notify("Audio link copied to clipboard.");
    } catch { notify("The link couldn't be copied. Open the item to copy it manually.", "error"); }
  };

  const openExternal = (item: AudioSpaceItem) => {
    if (item.externalUrl) window.open(item.externalUrl, "_blank", "noopener,noreferrer");
  };

  const duplicateItem = async (item: AudioSpaceItem) => {
    if (!item.externalUrl) return;
    try {
      const result = await saveAudioSpaceLink({
        title: `${item.title} (copy)`.slice(0, 120),
        description: item.description,
        folderId: item.folderId,
        newFolder: null,
        tags: [...item.tags],
        favorite: item.favorite,
        source: "link",
        url: item.externalUrl,
      });
      onSaved(result.item, result.folder, result.createdFolder);
      notify(`Duplicated “${item.title}”.`);
    } catch (error) { notify(error instanceof Error ? error.message : "The audio link couldn't be duplicated.", "error"); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteAudioSpaceItem(deleteTarget.id);
      setItems((current) => current.filter((entry) => entry.id !== deleteTarget.id));
      notify(`“${deleteTarget.title}” moved to the Trash. You can restore it for 7 days.`);
      setDeleteTarget(null);
      onTrashChanged();
    } catch (error) { notify(error instanceof Error ? error.message : "The audio couldn't be deleted.", "error"); }
    finally { setDeleting(false); }
  };

  // ----- Bulk actions --------------------------------------------------------
  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((current) => {
      const visibleIds = visible.map((item) => item.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      return allSelected ? new Set() : new Set(visibleIds);
    });
  };
  const runBulk = async (action: "favorite" | "unfavorite" | "move" | "delete", folderId?: string | null) => {
    const targets = items.filter((item) => selected.has(item.id));
    if (!targets.length) return;
    setBulkBusy(true);
    try {
      if (action === "delete") {
        // Delete one by one and only drop the rows that actually moved to Trash,
        // so a partial failure never hides items that are still in the library.
        const deletedIds = new Set<string>();
        for (const item of targets) {
          try {
            await deleteAudioSpaceItem(item.id);
            deletedIds.add(item.id);
          } catch {
            notify(`“${item.title}” couldn't be deleted. Try again.`, "error");
          }
        }
        if (deletedIds.size) {
          setItems((current) => current.filter((entry) => !deletedIds.has(entry.id)));
          notify(`${deletedIds.size} audio ${deletedIds.size === 1 ? "file" : "files"} moved to the Trash.`);
          onTrashChanged();
        }
      } else {
        for (const item of targets) {
          const patch = action === "move" ? { folderId: folderId ?? null } : { favorite: action === "favorite" };
          const updated = await updateAudioSpaceItem(item.id, patch);
          setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
        }
        notify(action === "move"
          ? `${targets.length} ${targets.length === 1 ? "file" : "files"} moved.`
          : `${targets.length} ${targets.length === 1 ? "file" : "files"} ${action === "favorite" ? "pinned to" : "removed from"} Favorites.`);
      }
      setSelected(new Set());
      setBulkDeleteOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The bulk action couldn't be completed.", "error");
    } finally { setBulkBusy(false); }
  };

  const restoreTrashEntry = async (entry: TrashEntry) => {
    try {
      await onTrashRestore(entry);
      await loadItems();
      notify(`“${entry.title}” restored to AudioSpace.`);
    } catch (error) { notify(error instanceof Error ? error.message : "The audio couldn't be restored.", "error"); }
  };

  const playItem = (item: AudioSpaceItem) => {
    if (item.source === "link" && !item.externalUrl) { notify("This link has no playable URL.", "error"); return; }
    const activeQueue = queue.some((track) => track.id === item.id) ? queue : [trackForItem(item)];
    player.playTrack(trackForItem(item), activeQueue);
  };

  // ----- Render ---------------------------------------------------------------
  const heading = <div className="section-page-heading">
    <div>
      <div className="section-page-eyebrow"><IconTile variant="soft" size="xs" className="ds-tone-violet"><AudioLines size={13}/></IconTile>Private audio library</div>
      <h2>AudioSpace</h2>
      <p>Store, record, organize and play your important audio — one private archive, not a music service.</p>
    </div>
    <PersoraAsideStat icon={<FileAudio size={18}/>} label="AUDIO FILES" value={items.length} tone="violet" note={`${formatAudioBytes(storageBytes)} private`} noteIcon={<ShieldCheck size={11}/>} />
  </div>;

  if (!available) {
    return <div className="section-view as-page">{heading}<PersoraEmptyState moduleId="audio-space" tone="violet" title="AudioSpace needs a Persora account" description="Your private audio library lives in your account's secure storage, so AudioSpace is available after signing in to a connected Persora account."/></div>;
  }

  const addMenu = <AddAudioMenu
    onUpload={startUpload}
    onRecord={() => setRecordOpen(true)}
    onLink={() => setLinkOpen(true)}
    onFolder={() => setFolderCreateToken((value) => value + 1)}
  />;

  const itemActions = (item: AudioSpaceItem): MoreMenuAction[] => {
    const actions: MoreMenuAction[] = [
      { label: "Play", icon: Play, onSelect: () => playItem(item) },
      { label: "Edit details", icon: Pencil, onSelect: () => setDetailsFor(item) },
    ];
    if (item.source === "link") {
      actions.push({ label: "Copy audio link", icon: ClipboardCopy, onSelect: () => void copyLink(item) });
      actions.push({ label: "Open original", icon: ExternalLink, onSelect: () => openExternal(item) });
      actions.push({ label: "Duplicate", icon: FileAudio, onSelect: () => void duplicateItem(item) });
    } else {
      actions.push({ label: "Download", icon: Download, onSelect: () => void downloadItem(item) });
    }
    actions.push({ label: item.favorite ? "Unpin favorite" : "Pin to Favorites", icon: Star, onSelect: () => void toggleFavorite(item) });
    actions.push({ label: "Delete", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(item) });
    return actions;
  };

  const renderItemCard = (item: AudioSpaceItem) => {
    const playing = currentPlayingId === item.id && player.playing;
    const peaks = player.peaksFor(item.id);
    return <article key={item.id} className={`as-card ${currentPlayingId === item.id ? "is-current" : ""}`}>
      {selectMode && <label className="as-card-select"><Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleSelected(item.id)} aria-label={`Select ${item.title}`}/></label>}
      <div
        className="as-card-media"
        role="button"
        tabIndex={0}
        onClick={() => (selectMode ? toggleSelected(item.id) : setDetailsFor(item))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selectMode) toggleSelected(item.id); else setDetailsFor(item);
          }
        }}
        aria-label={selectMode ? `Select ${item.title}` : `Open ${item.title}`}
      >
        <IconTile variant="soft" size="lg" className={item.source === "link" ? "ds-tone-amber" : item.source === "recording" ? "ds-tone-violet" : "ds-tone-blue"}>
          {item.source === "link" ? <Link2 size={20}/> : item.source === "recording" ? <Mic size={20}/> : <AudioLines size={20}/>}
        </IconTile>
        {peaks && <WaveformBars peaks={peaks} progress={currentPlayingId === item.id ? player.duration ? player.currentTime / player.duration : 0 : 0} className="as-card-wave"/>}
        <button
          type="button"
          className="as-card-play"
          onClick={(event) => { event.stopPropagation(); if (!selectMode) playItem(item); }}
          aria-label={playing ? `Pause ${item.title}` : `Play ${item.title}`}
        >
          {playing ? <PauseGlyph/> : <Play size={13} fill="currentColor"/>}
        </button>
        <span className="as-card-duration">{formatDuration(item.durationSeconds)}</span>
      </div>
      <div className="as-card-body">
        <div className="as-card-title">
          <h3><button type="button" onClick={() => setDetailsFor(item)}>{item.title}</button></h3>
          <div className="as-card-tools">
            <button type="button" className={item.favorite ? "as-star is-on" : "as-star"} onClick={() => void toggleFavorite(item)} aria-label={item.favorite ? "Unpin favorite" : "Pin to Favorites"} aria-pressed={item.favorite}>
              <Star size={13} fill={item.favorite ? "currentColor" : "none"}/>
            </button>
            <MoreOptionsMenu label={`Actions for ${item.title}`} actions={itemActions(item)} folders={folders} folderId={item.folderId || undefined} onMoveFolder={(folderId) => void moveItem(item, folderId)}/>
          </div>
        </div>
        <p className="as-card-meta">
          {item.source === "link" ? item.externalUrl ? new URL(item.externalUrl).host : "External link" : `${item.fileType ? (item.fileType.replace("audio/", "").toUpperCase()) : "AUDIO"}${item.fileSize ? ` · ${formatAudioBytes(item.fileSize)}` : ""}`}
          {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ""}
        </p>
        <div className="as-card-chips">
          <Badge variant={item.source === "link" ? "warning-light" : item.source === "recording" ? "info-light" : "primary-light"} size="xs" radius="full">{sourceLabel(item)}</Badge>
          {item.tags.slice(0, 3).map((tag) => <button key={tag} type="button" className="as-tag-chip" onClick={() => setTagFilter(tag)}>{tag}</button>)}
        </div>
      </div>
    </article>;
  };

  const renderItemRow = (item: AudioSpaceItem) => {
    const playing = currentPlayingId === item.id && player.playing;
    return <div key={item.id} className={`as-row ${currentPlayingId === item.id ? "is-current" : ""}`}>
      {selectMode && <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleSelected(item.id)} aria-label={`Select ${item.title}`}/>}
      <button type="button" className="as-row-play" onClick={() => (selectMode ? toggleSelected(item.id) : playItem(item))} aria-label={playing ? `Pause ${item.title}` : `Play ${item.title}`}>
        {playing ? <PauseGlyph/> : <Play size={13} fill="currentColor"/>}
      </button>
      <div className="as-row-main">
        <b><button type="button" onClick={() => setDetailsFor(item)}>{item.title}</button></b>
        <small>
          <Badge variant={item.source === "link" ? "warning-light" : item.source === "recording" ? "info-light" : "primary-light"} size="xs" radius="full">{sourceLabel(item)}</Badge>
          {item.source === "link" ? item.externalUrl ? new URL(item.externalUrl).host : "" : item.fileType ? item.fileType.replace("audio/", "").toUpperCase() : ""}
          {item.fileSize ? ` · ${formatAudioBytes(item.fileSize)}` : ""}
          {item.tags.length ? ` · ${item.tags.slice(0, 3).join(", ")}` : ""}
        </small>
      </div>
      <span className="as-row-duration">{formatDuration(item.durationSeconds)}</span>
      <span className="as-row-date">{formatDateLabel(item.createdAt)}</span>
      <button type="button" className={item.favorite ? "as-star is-on" : "as-star"} onClick={() => void toggleFavorite(item)} aria-label={item.favorite ? "Unpin favorite" : "Pin to Favorites"} aria-pressed={item.favorite}>
        <Star size={13} fill={item.favorite ? "currentColor" : "none"}/>
      </button>
      <MoreOptionsMenu label={`Actions for ${item.title}`} actions={itemActions(item)} folders={folders} folderId={item.folderId || undefined} onMoveFolder={(folderId) => void moveItem(item, folderId)}/>
    </div>;
  };

  const emptyStateFor = (sectionId: AudioSection) => {
    const copy: Record<AudioSection, { title: string; description: string }> = {
      all: { title: "Your audio library is empty", description: `Upload audio (${["MP3", "WAV", "M4A", "AAC", "OGG", "FLAC"].join(", ")}), record from your microphone, or save an audio link.` },
      recent: { title: "Nothing here yet", description: "Audio you upload, record or play will show up here." },
      favorites: { title: "No pinned audio yet", description: "Pin the audio you reach for most with the star icon and it stays here." },
      recordings: { title: "No recordings yet", description: "Record directly from your microphone — interviews, notes, lectures and more." },
      links: { title: "No audio links yet", description: "Save direct audio URLs from external sources to keep them with your library." },
    } as Record<AudioSection, { title: string; description: string }>;
    const entry = copy[sectionId];
    return <PersoraEmptyState moduleId="audio-space" tone="violet" title={entry.title} description={entry.description} action={<div className="as-empty-actions">
      <button type="button" className="section-add-button" onClick={startUpload}><Upload size={14}/> Upload audio</button>
      <button type="button" className="quiet-button" onClick={() => setRecordOpen(true)}><Mic size={14}/> Record audio</button>
      <button type="button" className="quiet-button" onClick={() => setLinkOpen(true)}><Link2 size={14}/> Add audio link</button>
    </div>}/>;
  };

  const overview = <div className="as-overview">
    <div className="as-stat-grid">
      <PersoraAsideStat icon={<FileAudio size={18}/>} label="TOTAL AUDIO" value={items.length} tone="blue"/>
      <PersoraAsideStat icon={<FolderOpen size={18}/>} label="FOLDERS" value={folders.length} tone="teal"/>
      <PersoraAsideStat icon={<ShieldCheck size={18}/>} label="STORAGE USED" value={formatAudioBytes(storageBytes)} tone="violet"/>
      <PersoraAsideStat icon={<Mic size={18}/>} label="RECORDINGS" value={recordingsCount} tone="amber"/>
    </div>
    <section className="as-overview-section">
      <header className="as-overview-head">
        <h3><Clock3 size={14}/> Recently added</h3>
        <button type="button" className="as-link-button" onClick={() => setSection("recent")}>View all <ChevronRight size={12}/></button>
      </header>
      {recentItems.length ? <div className="as-overview-grid">{recentItems.map(renderItemCard)}</div>
        : <p className="as-muted-note">Audio you upload or record appears here first.</p>}
    </section>
    <section className="as-overview-section">
      <header className="as-overview-head"><h3><Heart size={14}/> Quick actions</h3></header>
      <div className="as-quick-actions">
        <button type="button" className="quiet-button" onClick={startUpload}><Upload size={14}/> Upload audio</button>
        <button type="button" className="quiet-button" onClick={() => setRecordOpen(true)}><Mic size={14}/> Record audio</button>
        <button type="button" className="quiet-button" onClick={() => setLinkOpen(true)}><Link2 size={14}/> Add audio link</button>
        <button type="button" className="quiet-button" onClick={onOpenTrash}><Trash2 size={14}/> Open Trash</button>
      </div>
    </section>
  </div>;

  const trashSection = <div className="as-trash-section">
    <div className="as-trash-note"><ShieldCheck size={13}/> Deleted audio stays in the Trash for 7 days before permanent removal — the same policy as every Persora space.</div>
    {audioTrash.length ? <div className="as-trash-list">
      {audioTrash.map((entry) => <div key={entry.id} className="as-trash-row">
        <IconTile variant="soft" size="xs" className="ds-tone-rose"><Trash2 size={13}/></IconTile>
        <div className="as-trash-copy"><b>{entry.title}</b><small>Deleted {formatDateLabel(entry.deletedAt)} · expires {formatDateLabel(entry.expiresAt)}</small></div>
        <button type="button" className="quiet-button" onClick={() => void restoreTrashEntry(entry)} disabled={bulkBusy}><RefreshCw size={13}/> Restore</button>
      </div>)}
    </div> : <PersoraEmptyState moduleId="audio-space" tone="violet" title="Trash is empty" description="Audio you delete will wait here for 7 days, restorable at any time."/>}
    <button type="button" className="quiet-button as-open-trash" onClick={onOpenTrash}>Manage all Trash entries <ChevronRight size={13}/></button>
  </div>;

  return <div className="section-view as-page">
    {heading}
    <input ref={uploadInputRef} className="hidden-file-input" type="file" multiple accept={AUDIO_UPLOAD_ACCEPT} onChange={onFilesSelected} aria-label="Choose audio files to upload"/>

    <div className="as-section-tabs" role="tablist" aria-label="AudioSpace sections">
      {SECTION_TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={section === entry.id} className={section === entry.id ? "filter-active" : ""} onClick={() => { setSection(entry.id); setTagFilter(""); }}>
        {entry.label}
        {entry.id === "favorites" && counts.favorites > 0 ? <span>{counts.favorites}</span> : null}
        {entry.id === "recordings" && counts.recordings > 0 ? <span>{counts.recordings}</span> : null}
        {entry.id === "links" && counts.links > 0 ? <span>{counts.links}</span> : null}
        {entry.id === "trash" && audioTrash.length > 0 ? <span>{audioTrash.length}</span> : null}
      </button>)}
    </div>

    {section !== "trash" && <VaultFolderShelf
      userId={user.id} scope="audio-space" pageLabel="Audio" demoMode={false}
      totalCount={items.length} folderCounts={folderCountMap} selectedFolderId={selectedFolderId}
      onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify} reloadToken={folderReload}
      openCreateToken={folderCreateToken}
    />}

    {section !== "overview" && section !== "trash" && <>
      <div className="section-toolbar as-toolbar">
        <div className="as-toolbar-left">
          <label className="as-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audio…" aria-label="Search audio"/></label>
          <label className="as-sort" title="Sort audio"><ArrowDownUp size={14}/><select value={sort} onChange={(event) => setSort(event.target.value as AudioSort)} aria-label="Sort audio">
            {(Object.keys(SORT_LABELS) as AudioSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
          </select></label>
          <div className="as-view-toggle" role="group" aria-label="View layout">
            <button type="button" className={layout === "grid" ? "is-active" : ""} onClick={() => setLayout("grid")} aria-label="Grid view" aria-pressed={layout === "grid"}><Grid2X2 size={14}/></button>
            <button type="button" className={layout === "list" ? "is-active" : ""} onClick={() => setLayout("list")} aria-label="List view" aria-pressed={layout === "list"}><List size={14}/></button>
          </div>
          {tagFilter && <button type="button" className="as-tag-filter" onClick={() => setTagFilter("")}>#{tagFilter} <X size={11}/></button>}
        </div>
        <div className="section-toolbar-actions as-toolbar-actions">
          <button type="button" className={selectMode ? "quiet-button is-on" : "quiet-button"} onClick={() => { setSelectMode((value) => !value); setSelected(new Set()); }}>
            <Check size={14}/> {selectMode ? "Done selecting" : "Select"}
          </button>
          {addMenu}
        </div>
      </div>

      {selectMode && selected.size > 0 && <div className="as-bulk-bar" role="region" aria-label="Bulk actions">
        <b>{selected.size} selected</b>
        <label className="as-bulk-move"><span className="sr-only">Move to folder</span>
          <select value="" onChange={(event) => { const value = event.target.value; event.target.value = ""; if (!value) return; if (value === "__delete__") { setBulkDeleteOpen(true); return; } void runBulk("move", value === "__none__" ? null : value); }}>
            <option value="">Move to…</option>
            <option value="__none__">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <button type="button" className="quiet-button" onClick={() => void runBulk("favorite")} disabled={bulkBusy}><Star size={13}/> Pin</button>
        <button type="button" className="quiet-button" onClick={() => void runBulk("unfavorite")} disabled={bulkBusy}><Star size={13}/> Unpin</button>
        <button type="button" className="quiet-button as-danger" onClick={() => setBulkDeleteOpen(true)} disabled={bulkBusy}><Trash2 size={13}/> Delete</button>
        <button type="button" className="quiet-button" onClick={() => setSelected(new Set())}>Clear</button>
      </div>}

      {selectMode && visible.length > 0 && <label className="as-select-all"><Checkbox checked={allVisibleSelected ? true : selected.size > 0 ? "indeterminate" : false} onCheckedChange={() => toggleSelectAll()} aria-label="Select all"/> Select all ({visible.length})</label>}

      <div className="section-list-meta">
        <span><b>{String(visible.length).padStart(2, "0")}</b> {visible.length === 1 ? "audio" : "audio files"}{selectedFolderId ? ` in ${folderName(folders, selectedFolderId) || "this folder"}` : ""}</span>
        <span className="list-meta-private"><ShieldCheck size={12}/> Private by default · streamed securely from your account</span>
      </div>
    </>}

    {loading ? <div className={layout === "grid" ? "as-grid" : "as-list"} aria-busy="true" aria-label="Loading audio">{[0, 1, 2, 3].map((key) => <div key={key} className="as-card as-card-skeleton"><div className="as-card-media"/><div className="as-card-body"><span/><span/></div></div>)}</div>
      : loadError ? <PersoraEmptyState role="alert" stacked={false} icon={<AlertTriangle size={20}/>} tone="rose" title="Your audio library couldn't be loaded" description={loadError} action={<button type="button" className="quiet-button" onClick={() => void loadItems()}><RefreshCw size={15}/> Try again</button>}/>
        : section === "overview" ? overview
          : section === "trash" ? trashSection
            : visible.length ? <div className={layout === "grid" ? "as-grid" : "as-list"}>{visible.map((item) => (layout === "grid" ? renderItemCard(item) : renderItemRow(item)))}</div>
              : emptyStateFor(section as AudioSection)}


    {uploadFiles && <AudioUploadDialog
      key={`upload-${fileDialogToken.current}`}
      initialFiles={uploadFiles}
      folders={folders}
      defaultFolderId={selectedFolderId || null}
      maxUploadMb={maxUploadMb}
      canUpload={canUpload}
      saveBlockedReason={saveBlockedReason}
      onUpgrade={onUpgrade}
      onClose={() => setUploadFiles(null)}
      onSaved={(item, folder, created) => { onSaved(item, folder, created); notify(`Saved “${item.title}”.`); }}
    />}
    {recordOpen && <AudioRecordDialog
      folders={folders}
      defaultFolderId={selectedFolderId || null}
      maxUploadMb={maxUploadMb}
      canUpload={canUpload}
      saveBlockedReason={saveBlockedReason}
      onUpgrade={onUpgrade}
      onClose={() => setRecordOpen(false)}
      onSaved={onSaved}
      notify={notify}
    />}
    {linkOpen && <AudioLinkDialog
      folders={folders}
      defaultFolderId={selectedFolderId || null}
      canUpload={canUpload}
      saveBlockedReason={saveBlockedReason}
      onUpgrade={onUpgrade}
      onClose={() => setLinkOpen(false)}
      onSaved={(item, folder, created) => { onSaved(item, folder, created); notify(`Saved “${item.title}”.`); }}
    />}
    {detailsFor && <AudioDetailsDialog item={detailsFor} folders={folders} onClose={() => setDetailsFor(null)} notify={notify} onFolderCreated={() => setFolderReload((value) => value + 1)} onSaved={(updated) => {
      setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    }}/>}
    {deleteTarget && <ModalPortal><ConfirmDialog title={`Delete “${deleteTarget.title}”?`} confirmLabel={deleting ? "Deleting…" : "Move to Trash"} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={() => void confirmDelete()}>
      <p>The audio moves to the Trash and can be restored for 7 days.</p>
    </ConfirmDialog></ModalPortal>}
    {bulkDeleteOpen && <ModalPortal><ConfirmDialog title={`Delete ${selected.size} selected ${selected.size === 1 ? "audio file" : "audio files"}?`} confirmLabel={bulkBusy ? "Deleting…" : "Move to Trash"} onCancel={() => !bulkBusy && setBulkDeleteOpen(false)} onConfirm={() => void runBulk("delete")}>
      <p>The selected audio moves to the Trash and can be restored for 7 days.</p>
    </ConfirmDialog></ModalPortal>}
  </div>;
}

function PauseGlyph() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>;
}
