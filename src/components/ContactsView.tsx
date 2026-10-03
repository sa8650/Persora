import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowDownToLine, ArrowRight, Cake, Check, ChevronDown, CircleAlert, ContactRound, Download, Edit3, FileUp, Heart, Mail, MapPin, MessageCircle, Phone, Plus, Search, Share2, ShieldCheck, Smartphone, Trash2, Upload, UserPlus, List, UsersRound, X } from "lucide-react";
import type { ContactCategory, ContactDraft, ContactImportProgress, ContactPhone, PersoraContact, TransferProgress, VaultFolder } from "../types";
import { CONTACT_CATEGORIES } from "../types";
import { fetchContactPhoto } from "../lib/backend";
import { formatDate, humanSize, initials } from "../lib/utils";
import { ImportProgressIndicator, TransferProgressIndicator } from "./ProgressIndicator";
import ShareRecordDialog from "./ShareRecordDialog";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";
import VaultFolderShelf from "./VaultFolderShelf";
import { MagicCard } from "./magic-ui";

interface ContactsViewProps {
  userId: string;
  contacts: PersoraContact[];
  demoMode: boolean;
  connected: boolean;
  onRefresh: () => Promise<void>;
  onSave: (contact: ContactDraft, onProgress?: (progress: TransferProgress) => void) => Promise<PersoraContact>;
  onDelete: (contact: PersoraContact) => Promise<void>;
  onShare: (contact: PersoraContact, recipient: string) => Promise<void>;
  onMerge: (primaryId: string, duplicateIds: string[]) => Promise<void>;
  onImport: (contacts: ContactDraft[], onProgress?: (progress: ContactImportProgress) => void) => Promise<PersoraContact[]>;
  notify: (message: string, kind?: "success" | "error") => void;
}

const PHONE_LABELS = ["Mobile", "Home", "Work", "Main", "WhatsApp", "Other"] as const;
const COUNTRY_CODES = ["+880", "+1", "+44", "+91", "+61", "+971", "+81", "+49", "+33", "+92", "+94", "+86"];
const cleanDigits = (value: string) => value.replace(/\D/g, "");
const phoneUri = (value: string) => `tel:${value.trim().replace(/[^\d+*#]/g, "")}`;
const smsUri = (value: string) => `sms:${value.trim().replace(/[^\d+*#]/g, "")}`;
const normalizePhone = (value: string, countryCode: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return `+${cleanDigits(trimmed)}`;
  let digits = cleanDigits(trimmed);
  const prefix = cleanDigits(countryCode);
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (prefix && digits.startsWith(prefix)) return `+${digits}`;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits ? `+${prefix}${digits}` : "";
};
function normalizeImportedPhone(value: string): ContactPhone | null {
  const raw = value.trim().replace(/^tel:/i, "");
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digitCount = cleanDigits(raw).length;
  if (digitCount < 7 || digitCount > 15) return null;
  const number = normalizePhone(raw, "+880");
  const normalizedDigits = cleanDigits(number);
  if (normalizedDigits.length < 7 || normalizedDigits.length > 15) return null;
  return { label: "Mobile", number };
}
const makeEmptyDraft = (): ContactDraft => ({
  name: "", phoneNumbers: [{ label: "Mobile", number: "" }], email: "", company: "", jobTitle: "",
  address: "", birthday: "", notes: "", category: "Other", favorite: false,
});
const normalizedName = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const normalizedEmail = (value: string) => value.trim().toLowerCase();
type DuplicateContact = Pick<PersoraContact, "name" | "email" | "company" | "phoneNumbers">;
const duplicateKeys = (contact: DuplicateContact) => {
  const keys = new Set<string>();
  if (normalizedEmail(contact.email)) keys.add(`email:${normalizedEmail(contact.email)}`);
  contact.phoneNumbers.forEach(({ number }) => { const digits = cleanDigits(number); if (digits.length >= 6) keys.add(`phone:${digits}`); });
  const name = normalizedName(contact.name);
  if (name && !normalizedEmail(contact.email) && !contact.phoneNumbers.some((phone) => cleanDigits(phone.number).length >= 6)) {
    keys.add(`name:${name}|${normalizedName(contact.company)}`);
  }
  return [...keys];
};

function findDuplicate(contact: DuplicateContact, others: DuplicateContact[]) {
  const keys = new Set(duplicateKeys(contact));
  return others.find((other) => duplicateKeys(other).some((key) => keys.has(key)));
}

function findDuplicateGroups(contacts: PersoraContact[]) {
  const parents = contacts.map((_, index) => index);
  const find = (value: number): number => parents[value] === value ? value : (parents[value] = find(parents[value]));
  const union = (a: number, b: number) => { const rootA = find(a); const rootB = find(b); if (rootA !== rootB) parents[rootB] = rootA; };
  const seen = new Map<string, number>();
  contacts.forEach((contact, index) => duplicateKeys(contact).forEach((key) => { const old = seen.get(key); if (old !== undefined) union(index, old); else seen.set(key, index); }));
  const groups = new Map<number, PersoraContact[]>();
  contacts.forEach((contact, index) => { const root = find(index); groups.set(root, [...(groups.get(root) || []), contact]); });
  return [...groups.values()].filter((group) => group.length > 1);
}

function ContactAvatar({ contact, demoMode, large = false }: { contact: PersoraContact; demoMode: boolean; large?: boolean }) {
  const [source, setSource] = useState(contact.photoDataUrl || "");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (contact.photoDataUrl) { setSource(contact.photoDataUrl); return () => {}; }
    if (!demoMode && contact.photoKey) {
      void fetchContactPhoto(contact.id).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
      }).catch(() => { if (active) setSource(""); });
    } else setSource("");
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [contact.id, contact.photoDataUrl, contact.photoKey, demoMode]);
  return <span className={`contact-avatar ${large ? "contact-avatar-large" : ""}`}>
    {source ? <img src={source} alt={`${contact.name} profile`} loading="lazy"/> : <span>{initials(contact.name)}</span>}
  </span>;
}

export default function ContactsView({ userId, contacts, demoMode, connected, onRefresh, onSave, onDelete, onShare, onMerge, onImport, notify }: ContactsViewProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All contacts");
  const [sortBy, setSortBy] = useState("name");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [layout, setLayout] = useState<"cards" | "list">(() => { try { return localStorage.getItem(`persora-view:${userId}:contacts`) === "list" ? "list" : "cards"; } catch { return "cards"; } });
  useEffect(() => { try { setLayout(localStorage.getItem(`persora-view:${userId}:contacts`) === "list" ? "list" : "cards"); } catch { setLayout("cards"); } }, [userId]);
  const [visibleCount, setVisibleCount] = useState(48);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<PersoraContact | null | false>(false);
  const [detail, setDetail] = useState<PersoraContact | null>(null);
  const [shareTarget, setShareTarget] = useState<PersoraContact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersoraContact | null>(null);
  const [importPreview, setImportPreview] = useState<ImportEntry[] | null>(null);
  const [numberFeedback, setNumberFeedback] = useState<PhoneImportFeedback[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<ContactImportProgress | null>(null);
  const [importError, setImportError] = useState("");
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState("");
  const [mergeKeep, setMergeKeep] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const folderContacts = selectedFolderId ? contacts.filter((contact) => contact.folderId === selectedFolderId) : contacts;
  const folderCounts = Object.fromEntries(folders.map((folder) => [folder.id, contacts.filter((contact) => contact.folderId === folder.id).length]));
  const duplicateGroups = useMemo(() => findDuplicateGroups(contacts), [contacts]);
  const categories = useMemo(() => ["All contacts", ...CONTACT_CATEGORIES.filter((entry) => contacts.some((contact) => contact.category === entry))], [contacts]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = folderContacts.filter((contact) => {
      if (category !== "All contacts" && contact.category !== category) return false;
      if (favoritesOnly && !contact.favorite) return false;
      if (!needle) return true;
      return [contact.name, contact.email, contact.company, contact.jobTitle, contact.address, contact.category, ...contact.phoneNumbers.map((phone) => phone.number)].join(" ").toLowerCase().includes(needle);
    });
    return matching.sort((a, b) => {
      if (sortBy === "recent") return b.updatedAt.localeCompare(a.updatedAt);
      if (sortBy === "birthday") {
        const monthDay = (value: string) => value ? value.slice(5, 10) : "99-99";
        return monthDay(a.birthday).localeCompare(monthDay(b.birthday));
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [folderContacts, category, favoritesOnly, search, sortBy]);
  const visible = filtered.slice(0, visibleCount);

  useEffect(() => { setVisibleCount(48); }, [category, favoritesOnly, search, sortBy, selectedFolderId]);
  useEffect(() => { setSelected((current) => new Set([...current].filter((id) => contacts.some((contact) => contact.id === id)))); }, [contacts]);

  const setLayoutMode = (mode: "cards" | "list") => {
    setLayout(mode);
    try { localStorage.setItem(`persora-view:${userId}:contacts`, mode); } catch { /* The view still changes for this session. */ }
  };
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't refresh contacts.", "error"); } finally { setRefreshing(false); } };
  const toggleSelected = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const openEdit = (contact?: PersoraContact) => { setDetail(null); setEditor(contact || null); };
  const handleSave = async (draft: ContactDraft, onProgress?: (progress: TransferProgress) => void) => { const saved = await onSave(draft, onProgress); setEditor(false); return saved; };
  const moveContactFolder = async (contact: PersoraContact, folderId: string | null) => {
    try { const saved = await onSave({ ...contact, folderId: folderId || undefined }); setDetail((current) => current?.id === saved.id ? saved : current); notify(folderId ? `Moved to ${folders.find((folder) => folder.id === folderId)?.name || "folder"}.` : "Contact moved out of its folder."); }
    catch (error) { notify(error instanceof Error ? error.message : "The contact could not be moved.", "error"); }
  };
  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setImportError("");
    if (file.size > 15 * 1024 * 1024) { setImportError("VCF files must be smaller than 15 MB."); return; }
    try {
      const parsed = parseVcards(await file.text());
      if (!parsed.length) throw new Error("No readable contacts were found in that vCard file.");
      const seenContacts: DuplicateContact[] = [...contacts];
      const seenNumbers = new Set(contacts.flatMap((contact) => contact.phoneNumbers.map((phone) => normalizeImportedPhone(phone.number)?.number).filter((number): number is string => Boolean(number))).map(cleanDigits));
      setImportPreview(parsed.map((source) => {
        const invalidPhones: string[] = []; const duplicatePhones: string[] = []; const phoneNumbers: ContactPhone[] = [];
        for (const phone of source.phoneNumbers) {
          const normalized = normalizeImportedPhone(phone.number);
          if (!normalized) { invalidPhones.push(phone.number); continue; }
          const key = cleanDigits(normalized.number);
          if (seenNumbers.has(key)) { duplicatePhones.push(phone.number); continue; }
          seenNumbers.add(key); phoneNumbers.push({ ...phone, number: normalized.number });
        }
        const contact = { ...source, phoneNumbers };
        const dupe = findDuplicate(contact, seenContacts);
        seenContacts.push(contact);
        return { contact, sourcePhoneNumbers: source.phoneNumbers, duplicate: dupe?.name || "", selected: !dupe, invalidPhones, duplicatePhones };
      }));
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : "Couldn't read this vCard file."); }
  };
  const confirmImport = async () => {
    const chosen = (importPreview || []).filter((entry) => entry.selected);
    if (!chosen.length) { setImportError("Select at least one contact to import."); return; }
    setImportBusy(true); setImportError(""); setImportProgress({ completed: 0, total: chosen.length, percent: 0, remainingSeconds: null, currentName: chosen[0].contact.name });
    try {
      const seenNumbers = new Set(contacts.flatMap((contact) => contact.phoneNumbers.map((phone) => normalizeImportedPhone(phone.number)?.number).filter((number): number is string => Boolean(number))).map(cleanDigits));
      const ready = chosen.map((entry) => {
        const invalidPhones: string[] = []; const duplicatePhones: string[] = []; const phoneNumbers: ContactPhone[] = [];
        for (const phone of entry.sourcePhoneNumbers) {
          const normalized = normalizeImportedPhone(phone.number);
          if (!normalized) { invalidPhones.push(phone.number); continue; }
          const key = cleanDigits(normalized.number);
          if (seenNumbers.has(key)) { duplicatePhones.push(phone.number); continue; }
          seenNumbers.add(key); phoneNumbers.push({ ...phone, number: normalized.number });
        }
        return { ...entry, contact: { ...entry.contact, phoneNumbers }, invalidPhones, duplicatePhones };
      });
      const imported = await onImport(ready.map(({ contact }) => contact), setImportProgress);
      const reports = ready.map((entry, index) => ({ contact: imported[index], invalidPhones: entry.invalidPhones, duplicatePhones: entry.duplicatePhones }))
        .filter((entry): entry is PhoneImportFeedback => Boolean(entry.contact) && (entry.invalidPhones.length > 0 || entry.duplicatePhones.length > 0));
      setImportPreview(null); setSelected(new Set());
      if (reports.length) setNumberFeedback(reports);
      const duplicateCount = ready.reduce((total, entry) => total + entry.duplicatePhones.length, 0);
      notify(`${imported.length} contact${imported.length === 1 ? "" : "s"} imported${duplicateCount ? `; ${duplicateCount} duplicate number${duplicateCount === 1 ? "" : "s"} filtered` : ""}.`);
    } catch (reason) { setImportError(reason instanceof Error ? reason.message : "The contacts couldn't be imported."); }
    finally { setImportBusy(false); setImportProgress(null); }
  };
  const exportContacts = async (rows: PersoraContact[]) => {
    if (!rows.length) { notify("Select at least one contact to export.", "error"); return; }
    try {
      const cards: string[] = [];
      for (const contact of rows) {
        let photo = contact.photoDataUrl || "";
        if (!photo && !demoMode && contact.photoKey) {
          const blob = await fetchContactPhoto(contact.id);
          photo = await blobToDataUrl(blob);
        }
        cards.push(contactToVcard(contact, photo));
      }
      const blob = new Blob([cards.join("\r\n")], { type: "text/vcard;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `persora-contacts-${new Date().toISOString().slice(0, 10)}.vcf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      notify(`${rows.length} contact${rows.length === 1 ? "" : "s"} exported as vCard.`);
    } catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't export these contacts.", "error"); }
  };
  const mergeGroup = async (group: PersoraContact[]) => {
    const groupKey = group.map((contact) => contact.id).sort().join(":");
    const keepId = mergeKeep[groupKey] || group[0].id;
    setMergeBusy(groupKey);
    try { await onMerge(keepId, group.filter((contact) => contact.id !== keepId).map((contact) => contact.id)); notify(`${group.length} duplicate contacts merged.`); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't merge these contacts.", "error"); }
    finally { setMergeBusy(""); }
  };
  const toggleFavorite = async (contact: PersoraContact) => {
    try { const favorite = !contact.favorite; await onSave({ ...contact, favorite }); setDetail((current) => current?.id === contact.id ? { ...current, favorite } : current); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't update favorite.", "error"); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await onDelete(deleteTarget); setDeleteTarget(null); if (detail?.id === deleteTarget.id) setDetail(null); notify(`${deleteTarget.name} was deleted.`); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't delete this contact.", "error"); }
  };

  return <div className="contacts-page">
    <div className="contacts-hero"><div className="contacts-hero-copy"><span className="section-eyebrow">PEOPLE &amp; CONNECTIONS</span><h2>Your people, <em>all in one place.</em></h2><p>A well-organized address book for the people who matter.</p><div className="contacts-hero-stats"><span><b>{contacts.length}</b> contacts</span><span><b>{contacts.filter((contact) => contact.favorite).length}</b> favorites</span><span><b>{duplicateGroups.length}</b> possible duplicates</span></div></div><div className="contacts-hero-art"><div className="contacts-orbit contacts-orbit-a"/><div className="contacts-orbit contacts-orbit-b"/><UsersRound size={38}/><span>{String(contacts.length).padStart(2, "0")}</span><small>YOUR CIRCLE</small></div></div>
    {!connected && <div className="contacts-local-notice"><ShieldCheck size={16}/><span>Contacts are stored in this browser's demo space. Sign in with the cloud API to sync them between Persora web and mobile.</span></div>}
    <div className="contacts-actions-row"><div className="contacts-actions-left"><button type="button" className="contacts-primary-button" onClick={() => openEdit()}><UserPlus size={16}/> Add contact</button><label className="contacts-secondary-button"><FileUp size={16}/> Import Contacts<input type="file" accept=".vcf,.vcard,text/vcard" onChange={(event) => void handleImportFile(event)}/></label><button type="button" className="contacts-secondary-button" onClick={() => void exportContacts(contacts)} disabled={!contacts.length}><Download size={16}/> Export all</button>{selected.size > 0 && <button type="button" className="contacts-export-selected" onClick={() => void exportContacts(contacts.filter((contact) => selected.has(contact.id)))}><ArrowDownToLine size={15}/> Export selected ({selected.size})</button>}</div><div className="contacts-actions-right"><button type="button" className="contacts-icon-button" onClick={() => void refresh()} disabled={refreshing} title={demoMode ? "Reload local contacts" : connected ? "Sync now" : "Sync unavailable"} aria-label={demoMode ? "Reload local contacts" : "Sync contacts"}><ArrowDownToLine className={refreshing ? "contacts-spin" : ""} size={15}/></button><div className="view-mode-toggle" role="group" aria-label="Contacts layout"><button type="button" className={layout === "cards" ? "is-active" : ""} onClick={() => setLayoutMode("cards")} aria-label="Card view" aria-pressed={layout === "cards"}><ContactRound size={15}/></button><button type="button" className={layout === "list" ? "is-active" : ""} onClick={() => setLayoutMode("list")} aria-label="List view" aria-pressed={layout === "list"}><List size={16}/></button></div></div></div>
    <VaultFolderShelf userId={userId} scope="contacts" pageLabel="Contacts" demoMode={demoMode} totalCount={contacts.length} folderCounts={folderCounts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify}/>
    {importError && !importPreview && <div className="contacts-inline-error" role="alert"><CircleAlert size={15}/>{importError}</div>}
    {duplicateGroups.length > 0 && <button type="button" className="contacts-duplicate-banner" onClick={() => { setMergeKeep({}); setDuplicatesOpen(true); }}><span><UsersRound size={17}/></span><span><b>{duplicateGroups.length} possible duplicate group{duplicateGroups.length === 1 ? "" : "s"}</b><small>Review records with matching phone numbers or email addresses.</small></span><span className="contacts-duplicate-review">Review &amp; merge <ArrowRight size={14}/></span></button>}
    <div className="contacts-toolbar"><label className="contacts-search"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, numbers, emails…" aria-label="Search contacts"/>{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14}/></button>}</label><div className="contacts-filter-control"><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter contacts by category">{categories.map((entry) => <option key={entry}>{entry}</option>)}</select><ChevronDown size={14}/></div><button type="button" className={`contacts-favorite-filter ${favoritesOnly ? "is-active" : ""}`} onClick={() => setFavoritesOnly((value) => !value)}><Heart size={14} fill={favoritesOnly ? "currentColor" : "none"}/> Favorites</button><label className="contacts-sort-control"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort contacts"><option value="name">Name</option><option value="recent">Recently updated</option><option value="birthday">Birthday</option></select><ChevronDown size={14}/></label></div>
    <div className="contacts-list-heading"><span><b>{filtered.length}</b> {filtered.length === 1 ? "contact" : "contacts"}{category !== "All contacts" ? ` · ${category}` : ""}</span><span className="contacts-private-note"><ShieldCheck size={13}/>{demoMode ? "Stored in this browser · not synced" : connected ? "Synced privately to your account" : "Cloud sync is unavailable"}</span></div>
    {visible.length ? <div className={`contacts-grid ${layout === "list" ? "contacts-list-view" : ""}`}>{visible.map((contact) => <MagicCard className="contact-card-shell" key={contact.id}><article className="contact-card">
      <div className="contact-card-top"><label className="contact-select"><input type="checkbox" checked={selected.has(contact.id)} onChange={() => toggleSelected(contact.id)} aria-label={`Select ${contact.name} for export`}/><span/></label><span className={`contact-category category-${slug(contact.category)}`}>{contact.category}</span>{layout !== "list" && <><button type="button" className={`contact-favorite ${contact.favorite ? "is-favorite" : ""}`} onClick={() => void toggleFavorite(contact)} aria-label={contact.favorite ? "Remove from favorites" : "Add to favorites"} title={contact.favorite ? "Remove from favorites" : "Add to favorites"}><Heart size={16} fill={contact.favorite ? "currentColor" : "none"}/></button><MoreOptionsMenu label={`${contact.name} options`} actions={[{ label: "Edit contact", icon: Edit3, onSelect: () => openEdit(contact) }, { label: "Share contact", icon: Share2, onSelect: () => setShareTarget(contact) }, { label: "Delete contact", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(contact) }]} folders={folders} folderId={contact.folderId} onMoveFolder={(folderId) => void moveContactFolder(contact, folderId)}/></>}</div>
      <button type="button" className="contact-card-main" onClick={() => setDetail(contact)}><ContactAvatar contact={contact} demoMode={demoMode}/><span className="contact-card-copy"><b>{contact.name}</b><small>{[contact.jobTitle, contact.company].filter(Boolean).join(" · ") || contact.email || "Contact details"}</small></span></button>
      <div className="contact-card-phone">{contact.phoneNumbers[0] ? <><Phone size={13}/><span>{contact.phoneNumbers[0].number}</span>{contact.phoneNumbers.length > 1 && <small>+{contact.phoneNumbers.length - 1}</small>}</> : <span className="contact-no-phone">No phone number</span>}</div>
      <div className="contact-quick-actions">{contact.phoneNumbers[0] && <><a href={phoneUri(contact.phoneNumbers[0].number)} aria-label={`Call ${contact.name}`} title="Call"><Phone size={14}/></a><a href={smsUri(contact.phoneNumbers[0].number)} aria-label={`Text ${contact.name}`} title="SMS"><MessageCircle size={14}/></a><a href={`https://wa.me/${cleanDigits(contact.phoneNumbers[0].number)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${contact.name}`} title="WhatsApp"><Smartphone size={14}/></a></>}{contact.email && <a href={`mailto:${encodeURIComponent(contact.email).replace(/%40/gi, "@")}`} aria-label={`Email ${contact.name}`} title="Email"><Mail size={14}/></a>}{layout === "list" && <><button type="button" className={`contact-favorite ${contact.favorite ? "is-favorite" : ""}`} onClick={() => void toggleFavorite(contact)} aria-label={contact.favorite ? "Remove from favorites" : "Add to favorites"} title={contact.favorite ? "Remove from favorites" : "Add to favorites"}><Heart size={16} fill={contact.favorite ? "currentColor" : "none"}/></button><MoreOptionsMenu label={`${contact.name} options`} actions={[{ label: "Edit contact", icon: Edit3, onSelect: () => openEdit(contact) }, { label: "Share contact", icon: Share2, onSelect: () => setShareTarget(contact) }, { label: "Delete contact", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(contact) }]} folders={folders} folderId={contact.folderId} onMoveFolder={(folderId) => void moveContactFolder(contact, folderId)}/></>}</div>
    </article></MagicCard>)}</div> : <div className="contacts-empty"><span><UsersRound size={22}/></span><h3>{search || favoritesOnly || category !== "All contacts" ? "No contacts match those filters" : "Your contact book is ready."}</h3><p>{search || favoritesOnly || category !== "All contacts" ? "Try another search or reset a filter." : "Add someone important or import your address book from a vCard file."}</p>{!contacts.length && <button type="button" className="contacts-primary-button" onClick={() => openEdit()}><Plus size={15}/> Add your first contact</button>}</div>}
    {visible.length < filtered.length && <div className="contacts-load-more"><button type="button" onClick={() => setVisibleCount((count) => count + 48)}>Show {Math.min(48, filtered.length - visible.length)} more <span>({filtered.length - visible.length} left)</span></button></div>}
    <div className="contacts-sync-footnote"><ShieldCheck size={14}/><span>{demoMode ? "Demo contacts stay in this browser for this session and are not uploaded." : connected ? "Your contacts sync through your authenticated Persora account." : "Contact sync is unavailable. Connect the Persora cloud API to sync across devices."}</span><button type="button" onClick={() => void refresh()}>{refreshing ? "Syncing…" : demoMode ? "Reload local" : "Sync now"}</button></div>

    {editor !== false && <ModalPortal><ContactEditorDialog key={editor?.id || "new-contact"} contact={editor || undefined} demoMode={demoMode} connected={connected} onClose={() => setEditor(false)} onSave={handleSave}/></ModalPortal>}
    {detail && <ModalPortal><ContactDetailDialog contact={detail} demoMode={demoMode} canShare={connected} onClose={() => setDetail(null)} onShare={() => { setShareTarget(detail); setDetail(null); }} onEdit={() => openEdit(detail)} onFavorite={() => void toggleFavorite(detail)} onDelete={() => setDeleteTarget(detail)}/></ModalPortal>}
    {shareTarget && <ModalPortal><ShareRecordDialog kind="contact" title={shareTarget.name} onClose={() => setShareTarget(null)} onShare={(recipient) => onShare(shareTarget, recipient)}/></ModalPortal>}
    {deleteTarget && <ModalPortal><div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}><section className="contacts-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="contact-delete-title"><span className="contacts-confirm-icon"><Trash2 size={20}/></span><h2 id="contact-delete-title">Delete this contact?</h2><p><b>{deleteTarget.name}</b> will be removed from your Persora contacts. This can't be undone.</p><div><button type="button" className="quiet-button" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="contacts-danger-button" onClick={() => void confirmDelete()}>Delete contact</button></div></section></div></ModalPortal>}
    {numberFeedback && <ModalPortal><PhoneImportFeedbackDialog reports={numberFeedback} onClose={() => setNumberFeedback(null)} onEdit={(contact) => { setNumberFeedback(null); openEdit(contact); }}/></ModalPortal>}
    {importPreview && <ModalPortal><ImportPreviewDialog entries={importPreview} busy={importBusy} progress={importProgress} error={importError} onClose={() => !importBusy && setImportPreview(null)} onToggle={(index) => setImportPreview((current) => current?.map((entry, i) => i === index ? { ...entry, selected: !entry.selected } : entry) || null)} onSelectAll={(selected) => setImportPreview((current) => current?.map((entry) => ({ ...entry, selected })) || null)} onConfirm={() => void confirmImport()}/></ModalPortal>}
    {duplicatesOpen && <ModalPortal><DuplicatesDialog groups={duplicateGroups} demoMode={demoMode} keep={mergeKeep} busyKey={mergeBusy} onKeepChange={(key, id) => setMergeKeep((current) => ({ ...current, [key]: id }))} onMerge={(group) => void mergeGroup(group)} onClose={() => setDuplicatesOpen(false)}/></ModalPortal>}
  </div>;
}

type ImportEntry = { contact: ContactDraft; sourcePhoneNumbers: ContactPhone[]; duplicate: string; selected: boolean; invalidPhones: string[]; duplicatePhones: string[] };
type PhoneImportFeedback = { contact: PersoraContact; invalidPhones: string[]; duplicatePhones: string[] };
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "other"); }

function ContactEditorDialog({ contact, demoMode, connected, onClose, onSave }: { contact?: PersoraContact; demoMode: boolean; connected: boolean; onClose: () => void; onSave: (contact: ContactDraft, onProgress?: (progress: TransferProgress) => void) => Promise<PersoraContact> }) {
  const [name, setName] = useState(contact?.name || "");
  const [phones, setPhones] = useState<ContactPhone[]>(contact?.phoneNumbers.length ? contact.phoneNumbers : [{ label: "Mobile", number: "" }]);
  const [email, setEmail] = useState(contact?.email || "");
  const [company, setCompany] = useState(contact?.company || "");
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle || "");
  const [address, setAddress] = useState(contact?.address || "");
  const [birthday, setBirthday] = useState(contact?.birthday || "");
  const [notes, setNotes] = useState(contact?.notes || "");
  const [category, setCategory] = useState<ContactCategory>(contact?.category || "Other");
  const [favorite, setFavorite] = useState(contact?.favorite || false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [countryCode, setCountryCode] = useState("+880");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  useEffect(() => {
    if (!photoFile) { setPhotoPreview(""); return; }
    const url = URL.createObjectURL(photoFile); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);
  const updatePhone = (index: number, key: keyof ContactPhone, value: string) => setPhones((current) => current.map((phone, i) => i === index ? { ...phone, [key]: value } : phone));
  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setError("Choose a JPG, PNG, WEBP, or GIF image for the profile photo."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Profile photos must be 5 MB or smaller."); return; }
    setError(""); setPhotoFile(file); setClearPhoto(false);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) { setError("Contact name is required."); return; }
    const phoneNumbers = phones.map((phone) => ({ label: phone.label.trim() || "Mobile", number: normalizePhone(phone.number, countryCode) })).filter((phone) => phone.number);
    setSaving(true); setError(""); setUploadProgress(photoFile ? { loaded: 0, total: photoFile.size, percent: 0, remainingSeconds: null } : null);
    try {
      await onSave({
        ...(contact ? { id: contact.id, photoKey: contact.photoKey, photoDataUrl: contact.photoDataUrl } : {}),
        name: name.trim(), phoneNumbers, email: email.trim(), company: company.trim(), jobTitle: jobTitle.trim(), address: address.trim(), birthday, notes: notes.trim(), category,
        favorite, photoFile, clearPhoto, ...(clearPhoto ? { photoDataUrl: undefined, photoKey: undefined } : {}),
      }, setUploadProgress);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save this contact."); setSaving(false); setUploadProgress(null); }
  };
  return <div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><section className="contact-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-editor-title">
    <div className="contact-modal-head"><span className="contact-modal-icon"><UserPlus size={19}/></span><div><span className="section-eyebrow">Persora contacts</span><h2 id="contact-editor-title">{contact ? "Update a contact." : "Add someone important."}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18}/></button></div>
    <form className="contact-editor-form" onSubmit={(event) => void submit(event)}>
      <div className="contact-photo-field"><ContactAvatar contact={{ ...(contact || makeEmptyDraft()), id: contact?.id || "draft", name: name || "New contact", photoDataUrl: photoPreview || (clearPhoto ? undefined : contact?.photoDataUrl), photoKey: clearPhoto || photoFile ? undefined : contact?.photoKey } as PersoraContact} demoMode={demoMode} large/><div><b>Profile photo</b><small>Optional · JPG, PNG, WEBP, GIF · up to 5 MB</small><label className="contact-photo-pick">{photoFile || clearPhoto ? "Choose another photo" : "Add a photo"}<input type="file" accept="image/*" onChange={choosePhoto}/></label></div>{(photoFile || contact?.photoKey || contact?.photoDataUrl) && <button type="button" className="contact-photo-remove" disabled={clearPhoto} onClick={() => { setPhotoFile(null); setClearPhoto(true); }}>{clearPhoto ? "Photo will be removed" : "Remove"}</button>}</div>
      <div className="contact-form-grid"><label className="contacts-field contacts-field-wide">Name <span>*</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus required maxLength={160} placeholder="Full name"/></label>
        <div className="contacts-phone-field contacts-field-wide"><div className="contacts-phone-heading"><b>Phone numbers</b><button type="button" onClick={() => setPhones((current) => [...current, { label: "Mobile", number: "" }])}><Plus size={14}/> Add number</button></div>{phones.map((phone, index) => <div className="contacts-phone-row" key={index}><select aria-label={`Phone label ${index + 1}`} value={phone.label} onChange={(event) => updatePhone(index, "label", event.target.value)}>{PHONE_LABELS.map((label) => <option key={label}>{label}</option>)}</select><select aria-label={`Country calling code ${index + 1}`} value={COUNTRY_CODES.includes(countryCode) ? countryCode : "+880"} onChange={(event) => setCountryCode(event.target.value)}>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select><input aria-label={`Phone number ${index + 1}`} type="tel" value={phone.number} onChange={(event) => updatePhone(index, "number", event.target.value)} onBlur={(event) => updatePhone(index, "number", normalizePhone(event.target.value, countryCode))} placeholder="01XXX XXX XXX"/><button type="button" className="remove-phone-button" onClick={() => setPhones((current) => current.filter((_, i) => i !== index))} aria-label="Remove phone number"><X size={15}/></button></div>)}</div>
        <label className="contacts-field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="name@example.com"/></label><label className="contacts-field">Category<select value={category} onChange={(event) => setCategory(event.target.value as ContactCategory)}>{CONTACT_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="contacts-field">Company<input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={160} placeholder="Company or organization"/></label><label className="contacts-field">Job title<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={160} placeholder="Role or position"/></label>
        <label className="contacts-field contacts-field-wide">Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} maxLength={1200} placeholder="Street, city, postal code"/></label>
        <label className="contacts-field">Birthday<input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)}/></label><label className="contacts-field">Favorite<span className="favorite-toggle-field"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)}/><Heart size={15}/><small>Keep this person close</small></span></label>
        <label className="contacts-field contacts-field-wide">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={5000} placeholder="Anything useful to remember…"/></label>
      </div>
      {!connected && !demoMode && <div className="contacts-inline-error"><CircleAlert size={15}/>Cloud contact sync is unavailable; connect the Persora API first.</div>}
      {uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Uploading contact photo" detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}/>}
      {error && <div className="contacts-inline-error" role="alert"><CircleAlert size={15}/>{error}</div>}
      <div className="contact-editor-footer"><span><ShieldCheck size={14}/> Private to your Persora account</span><div><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="contacts-primary-button" disabled={saving || (!connected && !demoMode)}>{saving ? "Saving…" : contact ? "Save contact" : "Add contact"}<Check size={15}/></button></div></div>
    </form>
  </section></div>;
}

function ContactDetailDialog({ contact, demoMode, canShare, onClose, onShare, onEdit, onFavorite, onDelete }: { contact: PersoraContact; demoMode: boolean; canShare: boolean; onClose: () => void; onShare: () => void; onEdit: () => void; onFavorite: () => void; onDelete: () => void }) {
  const primaryPhone = contact.phoneNumbers[0]?.number || "";
  const digits = cleanDigits(primaryPhone);
  return <div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="contact-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-detail-title">
    <button type="button" className="icon-button contact-detail-close" onClick={onClose} aria-label="Close contact details"><X size={18}/></button>
    <div className="contact-detail-hero"><ContactAvatar contact={contact} demoMode={demoMode} large/><span className={`contact-category category-${slug(contact.category)}`}>{contact.category}</span><h2 id="contact-detail-title">{contact.name}</h2><p>{[contact.jobTitle, contact.company].filter(Boolean).join(" · ") || "Personal contact"}</p><div className="contact-detail-actions">{primaryPhone && <><a href={phoneUri(primaryPhone)}><Phone size={15}/> Call</a><a href={smsUri(primaryPhone)}><MessageCircle size={15}/> SMS</a><a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer"><Smartphone size={15}/> WhatsApp</a></>}{contact.email && <a href={`mailto:${encodeURIComponent(contact.email).replace(/%40/gi, "@")}`}><Mail size={15}/> Email</a>}</div></div>
    <div className="contact-detail-body"><div className="contact-detail-section"><b>Phone numbers</b>{contact.phoneNumbers.length ? contact.phoneNumbers.map((phone, index) => <div className="contact-detail-row" key={`${phone.number}-${index}`}><span className="contact-detail-row-icon"><Phone size={15}/></span><span><small>{phone.label}</small><b>{phone.number}</b></span><a href={phoneUri(phone.number)} aria-label={`Call ${phone.number}`}><Phone size={14}/></a></div>) : <p>No phone numbers saved.</p>}</div>
      {contact.email && <div className="contact-detail-row"><span className="contact-detail-row-icon"><Mail size={15}/></span><span><small>Email</small><b>{contact.email}</b></span><a href={`mailto:${encodeURIComponent(contact.email).replace(/%40/gi, "@")}`} aria-label="Send email"><ArrowRight size={14}/></a></div>}
      {(contact.company || contact.jobTitle) && <div className="contact-detail-row"><span className="contact-detail-row-icon"><UsersRound size={15}/></span><span><small>Work</small><b>{[contact.jobTitle, contact.company].filter(Boolean).join(" · ")}</b></span></div>}
      {contact.address && <div className="contact-detail-row"><span className="contact-detail-row-icon"><MapPin size={15}/></span><span><small>Address</small><b>{contact.address}</b></span></div>}
      {contact.birthday && <div className="contact-detail-row"><span className="contact-detail-row-icon"><Cake size={15}/></span><span><small>Birthday</small><b>{formatDate(contact.birthday)}</b></span></div>}
      {contact.notes && <div className="contact-detail-notes"><b>Notes</b><p>{contact.notes}</p></div>}
    </div><div className="contact-detail-footer"><button type="button" className={`contacts-favorite-filter ${contact.favorite ? "is-active" : ""}`} onClick={onFavorite}><Heart size={14} fill={contact.favorite ? "currentColor" : "none"}/> {contact.favorite ? "Favorited" : "Add favorite"}</button><div><button type="button" className="quiet-button" onClick={onShare} disabled={!canShare} title={canShare ? "Share with a Persora member" : "Sign in to share contacts"}><Share2 size={14}/> Share</button><button type="button" className="quiet-button" onClick={onDelete}><Trash2 size={14}/> Delete</button><button type="button" className="contacts-primary-button" onClick={onEdit}><Edit3 size={14}/> Edit contact</button></div></div>
  </section></div>;
}

function PhoneImportFeedbackDialog({ reports, onClose, onEdit }: { reports: PhoneImportFeedback[]; onClose: () => void; onEdit: (contact: PersoraContact) => void }) {
  const invalidCount = reports.reduce((total, entry) => total + entry.invalidPhones.length, 0);
  const duplicateCount = reports.reduce((total, entry) => total + entry.duplicatePhones.length, 0);
  return <div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="contacts-number-feedback" role="dialog" aria-modal="true" aria-labelledby="contacts-number-feedback-title">
    <div className="contact-modal-head"><span className="contact-modal-icon contacts-warning-icon"><CircleAlert size={19}/></span><div><span className="section-eyebrow">Import complete</span><h2 id="contacts-number-feedback-title">Check a few phone numbers.</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close phone number report"><X size={18}/></button></div>
    <p className="contacts-import-intro">Your contacts were imported. We skipped numbers with an invalid format and removed repeated numbers; the rest of the import was not cancelled. Edit a contact below to add a corrected number.</p>
    <div className="contacts-number-feedback-summary"><span><b>{invalidCount}</b> invalid number{invalidCount === 1 ? "" : "s"} skipped</span><span><b>{duplicateCount}</b> duplicate number{duplicateCount === 1 ? "" : "s"} removed</span></div>
    <div className="contacts-number-feedback-list">{reports.map((entry) => <article className="contacts-number-feedback-row" key={entry.contact.id}><div className="contacts-number-feedback-copy"><b>{entry.contact.name}</b>{entry.invalidPhones.map((number, index) => <span className="contacts-invalid-number" key={`${number}-${index}`}><CircleAlert size={13}/><code>{number || "(empty number)"}</code><small>Invalid format — not saved</small></span>)}{entry.duplicatePhones.map((number, index) => <span className="contacts-duplicate-number" key={`${number}-${index}`}><Check size={13}/><code>{number}</code><small>Duplicate — removed</small></span>)}</div>{entry.invalidPhones.length > 0 && <button type="button" className="contacts-fix-number-button" onClick={() => onEdit(entry.contact)}><Edit3 size={13}/> Fix number</button>}</article>)}</div>
    <div className="contact-editor-footer"><span><ShieldCheck size={14}/> All other contact details were kept.</span><div><button type="button" className="contacts-primary-button" onClick={onClose}>Done <Check size={14}/></button></div></div>
  </section></div>;
}

function ImportPreviewDialog({ entries, busy, progress, error, onClose, onToggle, onSelectAll, onConfirm }:  { entries: ImportEntry[]; busy: boolean; progress: ContactImportProgress | null; error: string; onClose: () => void; onToggle: (index: number) => void; onSelectAll: (selected: boolean) => void; onConfirm: () => void }) {
  const selectedCount = entries.filter((entry) => entry.selected).length;
  return <div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section className="contacts-import-dialog" role="dialog" aria-modal="true" aria-labelledby="contacts-import-title">
    <div className="contact-modal-head"><span className="contact-modal-icon"><Upload size={19}/></span><div><span className="section-eyebrow">vCard import preview</span><h2 id="contacts-import-title">Review before importing.</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close import preview"><X size={18}/></button></div>
    <p className="contacts-import-intro">{entries.length} contacts found. Possible duplicate contacts are unchecked by default; review the list before adding them.</p>
    <div className="contacts-import-guidance"><ShieldCheck size={14}/><span>Repeated phone numbers already in Persora or repeated in this file are removed. Invalid numbers are skipped without cancelling the import; after importing, you can review and fix them.</span></div>
    <div className="contacts-import-toolbar"><span>{selectedCount} selected</span><button type="button" onClick={() => onSelectAll(true)}>Select all</button><button type="button" onClick={() => onSelectAll(false)}>Select none</button></div>
    <div className="contacts-import-list">{entries.map((entry, index) => <label className={`contacts-import-row ${entry.duplicate ? "has-duplicate" : ""}`} key={`${entry.contact.name}-${index}`}><input type="checkbox" checked={entry.selected} onChange={() => onToggle(index)}/><span className="contacts-import-copy"><b>{entry.contact.name || "Unnamed contact"}</b><small>{[entry.contact.phoneNumbers[0]?.number, entry.contact.email, entry.contact.company].filter(Boolean).join(" · ") || "No contact details"}</small>{entry.duplicate && <em>Possible duplicate of {entry.duplicate}</em>}{entry.duplicatePhones.length > 0 && <em className="contacts-phone-import-warning">{entry.duplicatePhones.length} repeated phone number{entry.duplicatePhones.length === 1 ? "" : "s"} will be removed</em>}{entry.invalidPhones.length > 0 && <em className="contacts-phone-import-warning">{entry.invalidPhones.length} invalid phone number{entry.invalidPhones.length === 1 ? "" : "s"} will be skipped; see report after import</em>}</span><span className={`contact-category category-${slug(entry.contact.category || "Other")}`}>{entry.contact.category}</span></label>)}</div>
    {progress && busy && <ImportProgressIndicator progress={progress}/>}
    {error && <div className="contacts-inline-error" role="alert"><CircleAlert size={15}/>{error}</div>}
    <div className="contact-editor-footer"><span><ShieldCheck size={14}/> No contacts are added until you confirm.</span><div><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="contacts-primary-button" onClick={onConfirm} disabled={busy || selectedCount === 0}>{busy ? "Importing…" : `Import ${selectedCount} contact${selectedCount === 1 ? "" : "s"}`}<ArrowRight size={15}/></button></div></div>
  </section></div>;
}

function DuplicatesDialog({ groups, demoMode, keep, busyKey, onKeepChange, onMerge, onClose }: { groups: PersoraContact[][]; demoMode: boolean; keep: Record<string, string>; busyKey: string; onKeepChange: (key: string, id: string) => void; onMerge: (group: PersoraContact[]) => void; onClose: () => void }) {
  return <div className="modal-backdrop contacts-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="contacts-duplicates-dialog" role="dialog" aria-modal="true" aria-labelledby="contacts-duplicates-title">
    <div className="contact-modal-head"><span className="contact-modal-icon contacts-warning-icon"><UsersRound size={19}/></span><div><span className="section-eyebrow">Contact cleanup</span><h2 id="contacts-duplicates-title">Review duplicates.</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close duplicate review"><X size={18}/></button></div>
    <p className="contacts-import-intro">We found contacts sharing the same email or phone number. Choose the record to keep; the others will be merged into it.</p>
    <div className="contacts-duplicate-groups">{groups.map((group) => {
      const groupKey = group.map((contact) => contact.id).sort().join(":");
      const keepId = keep[groupKey] || group[0].id;
      return <div className="contacts-duplicate-group" key={groupKey}><div className="contacts-duplicate-group-head"><b>{group.length} matching contacts</b><span>Merge phone numbers, details and notes</span></div>{group.map((contact) => <label className="contacts-duplicate-choice" key={contact.id}><input type="radio" name={`keep-${groupKey}`} checked={keepId === contact.id} onChange={() => onKeepChange(groupKey, contact.id)}/><ContactAvatar contact={contact} demoMode={demoMode}/><span><b>{contact.name}</b><small>{[contact.email, contact.phoneNumbers[0]?.number, contact.company].filter(Boolean).join(" · ") || "No phone or email"}</small></span><em>{keepId === contact.id ? "Keep this record" : "Merge into kept record"}</em></label>)}<button type="button" className="contacts-merge-button" onClick={() => onMerge(group)} disabled={busyKey === groupKey}>{busyKey === groupKey ? "Merging…" : <>Merge {group.length} contacts <ArrowRight size={14}/></>}</button></div>;
    })}</div>
    <div className="contact-editor-footer"><span><ShieldCheck size={14}/> You can review each group separately.</span><div><button type="button" className="quiet-button" onClick={onClose}>Done</button></div></div>
  </section></div>;
}

function parseVcards(raw: string): ContactDraft[] {
  const text = raw.replace(/\r?\n[ \t]/g, "").replace(/\r/g, "");
  const chunks = text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
  return chunks.map((chunk) => {
    const fields = new Map<string, Array<{ params: string; value: string }>>();
    for (const line of chunk.split("\n")) {
      const split = line.indexOf(":"); if (split < 0) continue;
      const head = line.slice(0, split); const value = decodeVcardValue(line.slice(split + 1), head);
      const key = head.split(";")[0].split(".").pop()?.toUpperCase() || "";
      const params = head.slice(head.indexOf(";") + 1);
      fields.set(key, [...(fields.get(key) || []), { params, value }]);
    }
    const first = (key: string) => fields.get(key)?.[0]?.value || "";
    const fn = first("FN");
    const structuredName = first("N").split(";").filter(Boolean);
    const name = fn || [structuredName[1], structuredName[0], structuredName[2]].filter(Boolean).join(" ") || "Unnamed contact";
    const phoneNumbers: ContactPhone[] = (fields.get("TEL") || []).map(({ params, value }) => ({ label: vcardPhoneLabel(params), number: value.trim().replace(/^tel:/i, "") })).filter((phone) => phone.number).slice(0, 20);
    const emails = (fields.get("EMAIL") || []).map((entry) => entry.value.trim().replace(/^mailto:/i, "")).filter(Boolean);
    const addressParts = first("ADR").split(";").map((entry) => vcardUnescape(entry)).filter(Boolean);
    const address = addressParts.join(", ");
    const notes = [first("NOTE"), ...emails.slice(1).map((entry) => `Additional email: ${entry}`)].filter(Boolean).join("\n");
    const categories = first("CATEGORIES").split(",").map(vcardUnescape);
    const category = CONTACT_CATEGORIES.find((entry) => categories.some((value) => value.toLowerCase() === entry.toLowerCase())) || "Other";
    const photo = (fields.get("PHOTO") || []).map((entry) => photoValue(entry.value, entry.params)).find(Boolean) || "";
    let photoFile: File | null = null;
    if (photo) { try { photoFile = dataUrlToFile(photo, `${slug(name)}-photo.jpg`); } catch { /* Ignore unsupported or malformed embedded photos. */ } }
    return {
      name, phoneNumbers, email: emails[0] || "", company: first("ORG").split(";").map(vcardUnescape).filter(Boolean).join(" · "),
      jobTitle: first("TITLE"), address, birthday: parseBirthday(first("BDAY")), notes, category,
      favorite: false, photoFile,
    };
  }).filter((contact) => contact.name.trim());
}
function decodeVcardValue(value: string, head: string) {
  if (/ENCODING=QUOTED-PRINTABLE/i.test(head)) {
    try { const bytes: number[] = []; for (let i = 0; i < value.length; i++) { if (value[i] === "=" && /^[\da-f]{2}$/i.test(value.slice(i + 1, i + 3))) { bytes.push(parseInt(value.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(value.charCodeAt(i)); } return new TextDecoder().decode(new Uint8Array(bytes)); } catch { /* Fall back to the literal. */ }
  }
  return vcardUnescape(value);
}
function vcardUnescape(value: string) { return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }
function vcardPhoneLabel(params: string): string {
  const type = (params.match(/TYPE=([^;,:]+)/i)?.[1] || params).split(",")[0].replace(/[^a-z]/gi, "").toLowerCase();
  if (type.includes("home")) return "Home"; if (type.includes("work")) return "Work"; if (type.includes("main")) return "Main"; if (type.includes("whatsapp")) return "WhatsApp"; if (type.includes("cell") || type.includes("mobile")) return "Mobile"; return "Other";
}
function parseBirthday(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
function photoValue(value: string, params: string) {
  const data = value.trim();
  if (data.startsWith("data:image/")) return data;
  if (!/ENCODING=(?:b|base64)/i.test(params)) return "";
  const mime = `image/${params.match(/TYPE=([^;:]+)/i)?.[1]?.toLowerCase() || "jpeg"}`;
  return `data:${mime};base64,${data.replace(/\s/g, "")}`;
}
function dataUrlToFile(dataUrl: string, name: string): File {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid photo data.");
  const mime = match[1] || "image/jpeg";
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  if (binary.length > 5 * 1024 * 1024) throw new Error("Embedded contact photo is too large.");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], name, { type: mime });
}
async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("Could not read contact photo.")); reader.readAsDataURL(blob); });
}
function escapeVcard(value: string) { return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function foldVcardLine(line: string) {
  const chunks: string[] = []; let current = ""; let bytes = 0;
  for (const char of line) { const code = char.codePointAt(0) || 0; const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; if (bytes + size > 73) { chunks.push(current); current = ` ${char}`; bytes = size + 1; } else { current += char; bytes += size; } }
  chunks.push(current); return chunks.join("\r\n");
}
function contactToVcard(contact: PersoraContact, photoDataUrl: string) {
  const [given, ...family] = contact.name.trim().split(/\s+/);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(contact.name)}`, `N:${escapeVcard(family.join(" "))};${escapeVcard(given || "")};;;`];
  contact.phoneNumbers.forEach((phone) => lines.push(`TEL;TYPE=${vcardType(phone.label)}:${escapeVcard(phone.number)}`));
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(contact.email)}`);
  if (contact.company) lines.push(`ORG:${escapeVcard(contact.company)}`);
  if (contact.jobTitle) lines.push(`TITLE:${escapeVcard(contact.jobTitle)}`);
  if (contact.address) lines.push(`ADR;TYPE=HOME:;;${escapeVcard(contact.address)};;;;`);
  if (contact.birthday) lines.push(`BDAY:${contact.birthday.replace(/-/g, "")}`);
  if (contact.notes) lines.push(`NOTE:${escapeVcard(contact.notes)}`);
  if (contact.category) lines.push(`CATEGORIES:${escapeVcard(contact.category)}`);
  const photoMatch = photoDataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (photoMatch) lines.push(`PHOTO;ENCODING=b;TYPE=${photoMatch[1].split("/")[1].toUpperCase()}:${photoMatch[2]}`);
  lines.push("END:VCARD");
  return lines.map(foldVcardLine).join("\r\n");
}
function vcardType(label: string) { return label === "Home" ? "HOME" : label === "Work" ? "WORK" : label === "Mobile" || label === "WhatsApp" ? "CELL" : label.toUpperCase().replace(/[^A-Z]/g, "") || "VOICE"; }
