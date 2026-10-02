import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Folder, FolderOpen, FolderPlus, Pencil, Pin, X } from "lucide-react";
import type { VaultFolder, VaultFolderColor, VaultFolderScope } from "../types";
import { loadPageFolders, savePageFolder, VAULT_FOLDER_COLORS } from "../lib/folders";
import MoreOptionsMenu from "./MoreOptionsMenu";
import ModalPortal from "./ModalPortal";

interface Props {
  userId: string;
  scope: VaultFolderScope;
  pageLabel: string;
  demoMode: boolean;
  totalCount: number;
  folderCounts: Record<string, number>;
  selectedFolderId: string;
  onSelectFolder: (id: string) => void;
  onFoldersChange: (folders: VaultFolder[]) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

export default function VaultFolderShelf({ userId, scope, pageLabel, demoMode, totalCount, folderCounts, selectedFolderId, onSelectFolder, onFoldersChange, notify }: Props) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folderDialog, setFolderDialog] = useState<VaultFolder | null | false>(false);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState<VaultFolderColor>("blue");

  const orderedFolders = useMemo(() => [...folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)), [folders]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadPageFolders(userId, scope, demoMode).then((result) => {
      if (active) { setFolders(result); onFoldersChange(result); }
    }).catch((error) => {
      if (active) notify(error instanceof Error ? error.message : `Couldn't load ${pageLabel.toLowerCase()} folders.`, "error");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, scope, demoMode]);

  const openNewFolder = () => { setFolderDialog(null); setFolderName(""); setFolderColor("blue"); };
  const openEditFolder = (folder: VaultFolder) => { setFolderDialog(folder); setFolderName(folder.name); setFolderColor(folder.color); };
  const persistFolder = async (folder: VaultFolder, patch: Partial<VaultFolder>) => {
    try {
      const saved = await savePageFolder(userId, scope, demoMode, { id: folder.id, scope, name: patch.name || folder.name, color: patch.color || folder.color, pinned: patch.pinned ?? folder.pinned });
      const next = folders.map((entry) => entry.id === saved.id ? saved : entry);
      setFolders(next); onFoldersChange(next);
      notify(saved.pinned !== folder.pinned ? saved.pinned ? "Folder pinned." : "Folder unpinned." : "Folder updated.");
    } catch (error) { notify(error instanceof Error ? error.message : "The folder could not be updated.", "error"); }
  };
  const submitFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const current = folderDialog || null;
      const saved = await savePageFolder(userId, scope, demoMode, { ...(current ? { id: current.id } : {}), scope, name, color: folderColor, pinned: current?.pinned || false });
      const next = current ? folders.map((folder) => folder.id === saved.id ? saved : folder) : [...folders, saved];
      setFolders(next); onFoldersChange(next); onSelectFolder(saved.id); setFolderDialog(false);
      notify(current ? "Folder updated." : "Folder created.");
    } catch (error) { notify(error instanceof Error ? error.message : "The folder could not be saved.", "error"); }
    finally { setSaving(false); }
  };

  return <>
    <section className="vault-folder-shelf" aria-label={`${pageLabel} folders`}>
      <div className="vault-folder-shelf-heading"><div><span className="vault-folder-eyebrow">PAGE-ONLY ORGANIZATION</span><h3>Folders <small>{folders.length}</small></h3><p>Records stay in {pageLabel}; they can’t be moved into folders on another page.</p></div><button type="button" className="vault-folder-create" onClick={openNewFolder}><FolderPlus size={15}/> New folder</button></div>
      <div className="vault-folder-grid">
        <button type="button" className={`vault-folder-tile vault-folder-all ${selectedFolderId === "" ? "is-selected" : ""}`} onClick={() => onSelectFolder("")} aria-pressed={selectedFolderId === ""}><span className="vault-folder-icon folder-color-slate"><FolderOpen size={18}/></span><span className="vault-folder-card-copy"><b>All {pageLabel.toLowerCase()}</b><small>{totalCount} record{totalCount === 1 ? "" : "s"}</small></span></button>
        {orderedFolders.map((folder) => <div className={`vault-folder-tile-wrap ${selectedFolderId === folder.id ? "is-selected" : ""}`} key={folder.id}>
          <button type="button" className="vault-folder-tile" onClick={() => onSelectFolder(folder.id)} aria-pressed={selectedFolderId === folder.id}><span className={`vault-folder-icon folder-color-${folder.color}`}><Folder size={18}/></span><span className="vault-folder-card-copy"><b>{folder.pinned && <Pin size={11} fill="currentColor"/>}{folder.name}</b><small>{folderCounts[folder.id] || 0} record{folderCounts[folder.id] === 1 ? "" : "s"}</small></span></button>
          <MoreOptionsMenu label={`${folder.name} folder options`} actions={[{ label: "Edit folder", icon: Pencil, onSelect: () => openEditFolder(folder) }, { label: folder.pinned ? "Unpin folder" : "Pin folder", icon: Pin, onSelect: () => void persistFolder(folder, { pinned: !folder.pinned }) }]}/>
        </div>)}
        {loading && !folders.length && <span className="vault-folder-loading">Loading folders…</span>}
      </div>
    </section>
    {folderDialog !== false && <ModalPortal><div className="vault-folder-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && setFolderDialog(false)}><section className="vault-folder-modal" role="dialog" aria-modal="true" aria-labelledby="vault-folder-title"><header><span className="vault-folder-modal-icon"><FolderPlus size={18}/></span><div><span className="vault-folder-eyebrow">{folderDialog ? "EDIT PAGE FOLDER" : "NEW PAGE FOLDER"}</span><h2 id="vault-folder-title">{folderDialog ? "Update this folder" : "Create a folder"}</h2></div><button type="button" onClick={() => setFolderDialog(false)} aria-label="Close folder editor" disabled={saving}><X size={18}/></button></header><form onSubmit={(event) => void submitFolder(event)}><label className="vault-folder-name-field">Folder name<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={64} placeholder="e.g. Travel documents" required/></label><div className="vault-folder-color-field"><span>Folder color</span><div role="group" aria-label="Choose folder color">{VAULT_FOLDER_COLORS.map(({ value, label }) => <button type="button" key={value} className={`vault-folder-color-choice folder-color-${value} ${folderColor === value ? "is-active" : ""}`} onClick={() => setFolderColor(value)} aria-label={label} aria-pressed={folderColor === value}>{folderColor === value && <Check size={13}/>}</button>)}</div><small>{VAULT_FOLDER_COLORS.find((entry) => entry.value === folderColor)?.label}</small></div><p className="vault-folder-scope-note"><Folder size={13}/> This folder only contains records from {pageLabel}.</p><footer><button type="button" className="quiet-button" onClick={() => setFolderDialog(false)} disabled={saving}>Cancel</button><button type="submit" className="editor-submit" disabled={saving}>{saving ? "Saving…" : <>{folderDialog ? "Save changes" : "Create folder"}<Check size={14}/></>}</button></footer></form></section></div></ModalPortal>}
  </>;
}
