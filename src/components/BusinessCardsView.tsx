import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowRight, BriefcaseBusiness, Check, Copy, ExternalLink, Globe2, ImagePlus, Mail, MapPin, Phone, Plus, Share2, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import type { BusinessCardDraft, BusinessCardStyle, BusinessCustomLink, BusinessSocialLink, BusinessSocialPlatform, ContactPhone, DigitalBusinessCard, TransferProgress, VaultFolder } from "../types";
import { humanSize, initials } from "../lib/utils";
import { fetchPublicBusinessCardPhoto, fetchVaultFile } from "../lib/backend";
import SocialBrandIcon from "./SocialBrandIcon";
import { TransferProgressIndicator } from "./ProgressIndicator";
import ShareRecordDialog from "./ShareRecordDialog";
import ModalPortal from "./ModalPortal";
import MoreOptionsMenu from "./MoreOptionsMenu";
import VaultFolderShelf from "./VaultFolderShelf";

const SOCIAL_PLATFORMS: BusinessSocialPlatform[] = ["Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "WhatsApp", "Telegram", "GitHub", "Pinterest"];
const PHONE_LABELS = ["Mobile", "Work", "Office", "Other"];
const CARD_STYLES: { id: BusinessCardStyle; name: string; note: string }[] = [
  { id: "garden", name: "Signature", note: "Persora blue" },
  { id: "minimal", name: "Minimal", note: "Soft neutral" },
  { id: "midnight", name: "Midnight", note: "Deep blue" },
  { id: "terracotta", name: "Warm", note: "Warm accent" },
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const emptyCard = (): BusinessCardDraft => ({
  fullName: "", jobTitle: "", company: "", phoneNumbers: [{ label: "Mobile", number: "" }], email: "", websites: [""],
  socialLinks: [], address: "", bio: "", customLinks: [], isPublic: false, style: "garden",
});
const urlFor = (cardId?: string) => cardId ? `${window.location.origin}/BusinessCard/${cardId}` : "";
const normalizePhoneInput = (value: string) => {
  const raw = value.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits ? `+880${digits}` : "";
};
const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface BusinessCardsViewProps {
  userId: string;
  cards: DigitalBusinessCard[];
  demoMode: boolean;
  connected: boolean;
  onSave: (draft: BusinessCardDraft, onProgress?: (progress: TransferProgress) => void) => Promise<DigitalBusinessCard>;
  onDelete: (card: DigitalBusinessCard) => Promise<void>;
  onShare: (card: DigitalBusinessCard, recipient: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

export default function BusinessCardsView({ userId, cards, demoMode, connected, onSave, onDelete, onShare, onRefresh, notify }: BusinessCardsViewProps) {
  const [editor, setEditor] = useState<DigitalBusinessCard | null | false>(false);
  const [deleteTarget, setDeleteTarget] = useState<DigitalBusinessCard | null>(null);
  const [shareTarget, setShareTarget] = useState<DigitalBusinessCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [savingDelete, setSavingDelete] = useState(false);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const folderCards = selectedFolderId ? cards.filter((card) => card.folderId === selectedFolderId) : cards;
  const folderCounts = Object.fromEntries(folders.map((folder) => [folder.id, cards.filter((card) => card.folderId === folder.id).length]));
  const sortedCards = useMemo(() => [...folderCards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [folderCards]);
  const openEditor = (card?: DigitalBusinessCard) => setEditor(card || null);
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't refresh business cards.", "error"); } finally { setRefreshing(false); } };
  const moveCardFolder = async (card: DigitalBusinessCard, folderId: string | null) => {
    try { const saved = await onSave({ ...card, folderId: folderId || undefined }); notify(folderId ? `Moved to ${folders.find((folder) => folder.id === folderId)?.name || "folder"}.` : "Business card moved out of its folder."); return saved; }
    catch (error) { notify(error instanceof Error ? error.message : "The business card could not be moved.", "error"); }
  };
  const copyUrl = async (card: DigitalBusinessCard) => {
    const url = urlFor(card.cardId);
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopiedId(card.id); window.setTimeout(() => setCopiedId(""), 1800); }
    catch { notify("Couldn't copy this link. You can open it and copy the address bar.", "error"); }
  };
  const deleteCard = async () => {
    if (!deleteTarget) return;
    setSavingDelete(true);
    try { await onDelete(deleteTarget); notify(`${deleteTarget.fullName}'s card was deleted.`); setDeleteTarget(null); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't delete this business card.", "error"); }
    finally { setSavingDelete(false); }
  };

  return <div className="business-cards-page">
    <section className="business-cards-hero"><div className="business-cards-hero-copy"><span className="section-eyebrow">Your identity, beautifully shared</span><h2>Introduce yourself<br/><em>with confidence.</em></h2><p>Create a polished digital card. Keep it private or publish a link anyone can open.</p><div className="business-cards-hero-stats"><span><b>{cards.length}</b> cards</span><span><b>{cards.filter((card) => card.isPublic).length}</b> public</span><span><ShieldCheck size={13}/> You control each link</span></div></div><div className="business-cards-hero-mark"><span><BriefcaseBusiness size={30}/></span><i/><i/><i/></div></section>
    {!connected && <div className="business-cards-demo-notice"><ShieldCheck size={15}/><span>Demo cards are saved in this browser. Sign in with the Persora cloud API to publish public URLs.</span></div>}
    <div className="business-cards-toolbar"><div><span className="section-eyebrow">Your cards</span><h3>Digital business cards <small>{folderCards.length}</small></h3></div><div><button type="button" className="business-card-refresh" onClick={() => void refresh()} disabled={refreshing} aria-label="Sync business cards">{refreshing ? "Syncing…" : "Sync"}</button><button type="button" className="business-card-create" onClick={() => openEditor()}><Plus size={15}/> Create a card</button></div></div>
    <VaultFolderShelf userId={userId} scope="business-cards" pageLabel="Business Cards" demoMode={demoMode} totalCount={cards.length} folderCounts={folderCounts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify}/>
    {sortedCards.length ? <div className="business-card-grid">{sortedCards.map((card) => <article className="business-card-manager-card" key={card.id}>
      <div className="business-card-manager-top"><span className={`business-card-visibility ${card.isPublic ? "is-public" : "is-private"}`}><i/>{card.isPublic ? "Public" : "Private"}</span><MoreOptionsMenu label={`${card.fullName} card options`} actions={[{ label: "Edit business card", icon: UserRound, onSelect: () => openEditor(card) }, { label: "Share card", icon: Share2, onSelect: () => setShareTarget(card) }, { label: "Delete card", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(card) }]} folders={folders} folderId={card.folderId} onMoveFolder={(folderId) => void moveCardFolder(card, folderId)}/></div>
      <button className="business-card-manager-profile" onClick={() => openEditor(card)} type="button"><BusinessCardImage dataUrl={card.profilePhotoDataUrl} storageKey={card.profilePhotoKey} className="business-card-manager-avatar" alt={card.fullName}/><span><b>{card.fullName || "Untitled card"}</b><small>{[card.jobTitle, card.company].filter(Boolean).join(" · ") || "Add a role and company"}</small></span></button>
      <div className="business-card-manager-meta"><span><Phone size={13}/>{card.phoneNumbers[0]?.number || "No phone added"}</span><span><Globe2 size={13}/>{card.websites.length ? `${card.websites.length} website${card.websites.length === 1 ? "" : "s"}` : "No website added"}</span></div>
      {card.isPublic && card.cardId ? <div className="business-card-public-link"><a href={urlFor(card.cardId)} target="_blank" rel="noreferrer"><ExternalLink size={13}/><span>{urlFor(card.cardId).replace(window.location.origin, "")}</span></a><button type="button" onClick={() => void copyUrl(card)} aria-label="Copy public card link" title="Copy public URL">{copiedId === card.id ? <Check size={14}/> : <Copy size={14}/>}</button></div> : <div className="business-card-private-note"><ShieldCheck size={13}/> Only you can see this card</div>}
      <div className="business-card-manager-actions"><button type="button" onClick={() => openEditor(card)}><UserRound size={14}/> Edit card</button><button type="button" onClick={() => setShareTarget(card)} disabled={!connected} title="Share privately with a Persora user"><Share2 size={14}/> Share</button>{card.isPublic && card.cardId && <a href={urlFor(card.cardId)} target="_blank" rel="noreferrer"><ArrowRight size={14}/> View public</a>}</div>
    </article>)}</div> : <div className="business-cards-empty"><span><BriefcaseBusiness size={22}/></span><h3>Your first introduction starts here.</h3><p>Add your name, details, and links to create a card you can keep private or share with a public URL.</p><button className="business-card-create" onClick={() => openEditor()}><Plus size={15}/> Create your first card</button></div>}
    {editor !== false && <ModalPortal><BusinessCardEditor key={editor?.id || "new-business-card"} card={editor || undefined} connected={connected} onClose={() => setEditor(false)} onSave={async (draft, onProgress) => { const saved = await onSave(draft, onProgress); setEditor(false); notify(saved.isPublic ? "Your card is public and ready to share." : "Your private business card is saved."); return saved; }} /></ModalPortal>}
    {shareTarget && <ModalPortal><ShareRecordDialog kind="business card" title={shareTarget.fullName} onClose={() => setShareTarget(null)} onShare={(recipient) => onShare(shareTarget, recipient)}/></ModalPortal>}
    {deleteTarget && <ModalPortal><div className="modal-backdrop business-card-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !savingDelete && setDeleteTarget(null)}><section className="business-card-confirm" role="alertdialog" aria-modal="true"><span><Trash2 size={19}/></span><h2>Delete this card?</h2><p>{deleteTarget.isPublic ? "Its public URL will stop working immediately. " : ""}“{deleteTarget.fullName}” will be removed from your business cards.</p><div><button className="quiet-button" onClick={() => setDeleteTarget(null)} disabled={savingDelete}>Cancel</button><button className="contacts-danger-button" onClick={() => void deleteCard()} disabled={savingDelete}>{savingDelete ? "Deleting…" : "Delete card"}</button></div></section></div></ModalPortal>}
  </div>;
}

function BusinessCardImage({ dataUrl, storageKey, cardId, kind = "profile", className = "", alt }: { dataUrl?: string; storageKey?: string; cardId?: string; kind?: "profile" | "logo"; className?: string; alt: string }) {
  const [src, setSrc] = useState(dataUrl || "");
  useEffect(() => {
    let active = true; let objectUrl = "";
    if (dataUrl) { setSrc(dataUrl); return () => {}; }
    setSrc("");
    const load = async () => {
      try {
        const blob = cardId ? await fetchPublicBusinessCardPhoto(cardId, kind) : storageKey ? (await fetchVaultFile(storageKey)).blob : null;
        if (!blob || !active) return;
        objectUrl = URL.createObjectURL(blob); setSrc(objectUrl);
      } catch { if (active) setSrc(""); }
    };
    if (cardId || storageKey) void load();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [dataUrl, storageKey, cardId, kind]);
  return <span className={`business-card-image ${className}`}>{src ? <img src={src} alt={alt}/> : <span>{initials(alt)}</span>}</span>;
}

function BusinessCardEditor({ card, connected, onClose, onSave }: { card?: DigitalBusinessCard; connected: boolean; onClose: () => void; onSave: (draft: BusinessCardDraft, onProgress: (progress: TransferProgress) => void) => Promise<DigitalBusinessCard> }) {
  const [form, setForm] = useState<BusinessCardDraft>(() => card ? { ...card, style: card.style || "garden" } : emptyCard());
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [businessLogoFile, setBusinessLogoFile] = useState<File | null>(null);
  const [clearProfilePhoto, setClearProfilePhoto] = useState(false);
  const [clearBusinessLogo, setClearBusinessLogo] = useState(false);
  const [profilePreview, setProfilePreview] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  useEffect(() => { if (!profilePhotoFile) { setProfilePreview(""); return; } const value = URL.createObjectURL(profilePhotoFile); setProfilePreview(value); return () => URL.revokeObjectURL(value); }, [profilePhotoFile]);
  useEffect(() => { if (!businessLogoFile) { setLogoPreview(""); return; } const value = URL.createObjectURL(businessLogoFile); setLogoPreview(value); return () => URL.revokeObjectURL(value); }, [businessLogoFile]);
  const setField = <K extends keyof BusinessCardDraft>(key: K, value: BusinessCardDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setPhones = (update: (rows: ContactPhone[]) => ContactPhone[]) => setForm((current) => ({ ...current, phoneNumbers: update(current.phoneNumbers) }));
  const setWebsites = (update: (rows: string[]) => string[]) => setForm((current) => ({ ...current, websites: update(current.websites) }));
  const setSocialLinks = (update: (rows: BusinessSocialLink[]) => BusinessSocialLink[]) => setForm((current) => ({ ...current, socialLinks: update(current.socialLinks) }));
  const setCustomLinks = (update: (rows: BusinessCustomLink[]) => BusinessCustomLink[]) => setForm((current) => ({ ...current, customLinks: update(current.customLinks) }));
  const selectImage = (kind: "profile" | "logo", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
    if (!allowedPhotoTypes.includes(file.type)) { setError("Choose a JPG, PNG, WEBP, or GIF image."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError("Images must be 5 MB or smaller."); return; }
    setError("");
    if (kind === "profile") { setProfilePhotoFile(file); setClearProfilePhoto(false); }
    else { setBusinessLogoFile(file); setClearBusinessLogo(false); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!form.fullName.trim()) { setError("Add your full name first."); return; }
    setSaving(true); setError(""); setUploadProgress(null);
    const progress = (next: TransferProgress) => setUploadProgress(next);
    try {
      await onSave({ ...form, fullName: form.fullName.trim(), phoneNumbers: form.phoneNumbers.filter((phone) => phone.number.trim()).map((phone) => ({ ...phone, number: normalizePhoneInput(phone.number) })),
        websites: form.websites.map((value) => value.trim()).filter(Boolean), socialLinks: form.socialLinks.filter((entry) => entry.url.trim()), customLinks: form.customLinks.filter((entry) => entry.label.trim() && entry.url.trim()),
        profilePhotoFile, businessLogoFile, clearProfilePhoto, clearBusinessLogo,
        ...(clearProfilePhoto ? { profilePhotoKey: undefined, profilePhotoDataUrl: undefined } : {}), ...(clearBusinessLogo ? { businessLogoKey: undefined, businessLogoDataUrl: undefined } : {}),
      }, progress);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save this business card."); setSaving(false); setUploadProgress(null); }
  };
  const draftPreview = { ...form, fullName: form.fullName || "Your name", profilePhotoDataUrl: profilePreview || (clearProfilePhoto ? undefined : form.profilePhotoDataUrl), businessLogoDataUrl: logoPreview || (clearBusinessLogo ? undefined : form.businessLogoDataUrl) };
  const shareUrl = urlFor(form.cardId);
  const addPhone = () => setPhones((rows) => [...rows, { label: "Mobile", number: "" }]);
  const addWebsite = () => setWebsites((rows) => [...rows, ""]);
  const addSocial = () => setSocialLinks((rows) => [...rows, { platform: "Facebook", url: "" }]);
  const addCustomLink = () => setCustomLinks((rows) => [...rows, { label: "", url: "" }]);
  const editForm = <div className="business-card-form-scroll">
    <div className="business-card-form-grid">
      <label className="business-card-field business-card-field-wide">Full name <span>*</span><input required autoFocus maxLength={160} value={form.fullName} onChange={(event) => setField("fullName", event.target.value)} placeholder="Your full name"/></label>
      <label className="business-card-field">Job title / designation<input maxLength={160} value={form.jobTitle} onChange={(event) => setField("jobTitle", event.target.value)} placeholder="e.g. Product Designer"/></label>
      <label className="business-card-field">Company / organization<input maxLength={160} value={form.company} onChange={(event) => setField("company", event.target.value)} placeholder="Company name"/></label>
      <div className="business-card-photo-row business-card-field-wide">
        <div className="business-card-photo-control"><BusinessCardImage dataUrl={profilePreview || (clearProfilePhoto ? undefined : form.profilePhotoDataUrl)} storageKey={clearProfilePhoto || profilePhotoFile ? undefined : form.profilePhotoKey} className="business-card-edit-photo" alt={form.fullName || "Your profile"}/><div><b>Profile photo</b><small>JPG, PNG, WEBP or GIF · max 5 MB</small><label className="business-card-upload-label"><ImagePlus size={13}/>{profilePhotoFile ? "Change photo" : "Choose photo"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => selectImage("profile", event)}/></label></div>{(profilePhotoFile || form.profilePhotoKey || form.profilePhotoDataUrl) && <button type="button" className="business-card-remove-image" onClick={() => { setProfilePhotoFile(null); setClearProfilePhoto(true); }}>Remove</button>}</div>
        <div className="business-card-photo-control business-card-logo-control"><BusinessCardImage dataUrl={logoPreview || (clearBusinessLogo ? undefined : form.businessLogoDataUrl)} storageKey={clearBusinessLogo || businessLogoFile ? undefined : form.businessLogoKey} className="business-card-edit-logo" alt={form.company || "Business logo"}/><div><b>Business logo</b><small>Optional · max 5 MB</small><label className="business-card-upload-label"><ImagePlus size={13}/>{businessLogoFile ? "Change logo" : "Add logo"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => selectImage("logo", event)}/></label></div>{(businessLogoFile || form.businessLogoKey || form.businessLogoDataUrl) && <button type="button" className="business-card-remove-image" onClick={() => { setBusinessLogoFile(null); setClearBusinessLogo(true); }}>Remove</button>}</div>
      </div>
      <div className="business-card-subform business-card-field-wide"><div className="business-card-subform-heading"><b>Phone numbers</b><button type="button" onClick={addPhone}><Plus size={13}/> Add number</button></div>{form.phoneNumbers.map((phone, index) => <div className="business-card-input-row business-card-phone-row" key={index}><select value={phone.label} onChange={(event) => setPhones((rows) => rows.map((row, i) => i === index ? { ...row, label: event.target.value } : row))}>{PHONE_LABELS.map((label) => <option key={label}>{label}</option>)}</select><input aria-label={`Phone number ${index + 1}`} type="tel" value={phone.number} onChange={(event) => setPhones((rows) => rows.map((row, i) => i === index ? { ...row, number: event.target.value } : row))} onBlur={() => setPhones((rows) => rows.map((row, i) => i === index ? { ...row, number: normalizePhoneInput(row.number) } : row))} placeholder="+880 1XXX XXX XXX"/><button type="button" onClick={() => setPhones((rows) => rows.filter((_, i) => i !== index))} aria-label="Remove phone"><X size={14}/></button></div>)}</div>
      <label className="business-card-field">Email<input type="email" maxLength={254} value={form.email} onChange={(event) => setField("email", event.target.value)} placeholder="name@example.com"/></label>
      <label className="business-card-field business-card-field-wide">Address<textarea rows={2} maxLength={1200} value={form.address} onChange={(event) => setField("address", event.target.value)} placeholder="Street, city, country"/></label>
      <label className="business-card-field business-card-field-wide">About / short bio<textarea rows={3} maxLength={1200} value={form.bio} onChange={(event) => setField("bio", event.target.value)} placeholder="A short introduction about you and your work…"/></label>
      <div className="business-card-subform business-card-field-wide"><div className="business-card-subform-heading"><b>Websites</b><button type="button" onClick={addWebsite}><Plus size={13}/> Add website</button></div>{form.websites.map((website, index) => <div className="business-card-input-row" key={index}><Globe2 size={14}/><input type="url" value={website} onChange={(event) => setWebsites((rows) => rows.map((row, i) => i === index ? event.target.value : row))} placeholder="https://example.com"/><button type="button" onClick={() => setWebsites((rows) => rows.filter((_, i) => i !== index))} aria-label="Remove website"><X size={14}/></button></div>)}</div>
      <div className="business-card-subform business-card-field-wide"><div className="business-card-subform-heading"><b>Social media</b><button type="button" onClick={addSocial}><Plus size={13}/> Add profile</button></div>{form.socialLinks.map((link, index) => <div className="business-card-input-row business-card-social-row" key={index}><select aria-label="Social network" value={link.platform} onChange={(event) => setSocialLinks((rows) => rows.map((row, i) => i === index ? { ...row, platform: event.target.value as BusinessSocialPlatform } : row))}>{SOCIAL_PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</select><input type="url" value={link.url} onChange={(event) => setSocialLinks((rows) => rows.map((row, i) => i === index ? { ...row, url: event.target.value } : row))} placeholder={`${link.platform} profile URL`}/><button type="button" onClick={() => setSocialLinks((rows) => rows.filter((_, i) => i !== index))} aria-label="Remove social link"><X size={14}/></button></div>)}</div>
      <div className="business-card-subform business-card-field-wide"><div className="business-card-subform-heading"><b>Custom links</b><button type="button" onClick={addCustomLink}><Plus size={13}/> Add link</button></div>{form.customLinks.map((link, index) => <div className="business-card-input-row business-card-custom-row" key={index}><input aria-label="Link label" value={link.label} onChange={(event) => setCustomLinks((rows) => rows.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} placeholder="Link label"/><input type="url" aria-label="Link URL" value={link.url} onChange={(event) => setCustomLinks((rows) => rows.map((row, i) => i === index ? { ...row, url: event.target.value } : row))} placeholder="https://…"/><button type="button" onClick={() => setCustomLinks((rows) => rows.filter((_, i) => i !== index))} aria-label="Remove custom link"><X size={14}/></button></div>)}</div>
      <div className="business-card-style-picker business-card-field-wide"><div className="business-card-subform-heading"><b>Public card style</b><small>Choose the look of your shared page</small></div><div className="business-card-style-options">{CARD_STYLES.map((style) => <button type="button" key={style.id} className={`business-card-style-option style-${style.id} ${form.style === style.id ? "selected" : ""}`} aria-pressed={form.style === style.id} onClick={() => setField("style", style.id)}><span className="business-card-style-swatch"><i/><i/><i/></span><b>{style.name}</b><small>{style.note}</small></button>)}</div></div>
      <div className="business-card-public-toggle business-card-field-wide"><div><b>Make Public</b><small>{connected ? "Anyone with the public URL can see this card. Turn it off to make the URL unavailable." : "Public sharing is available after connecting Persora cloud sync."}</small></div><label className="business-card-switch"><input type="checkbox" checked={Boolean(form.isPublic)} disabled={!connected || saving} onChange={(event) => setField("isPublic", event.target.checked)}/><span/></label></div>
      {form.isPublic && <div className="business-card-share-url business-card-field-wide"><ShieldCheck size={14}/>{form.cardId ? <><span>Public URL</span><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a></> : <span>Your unique public URL will be created when you save.</span>}</div>}
    </div>
  </div>;
  return <div className="modal-backdrop business-card-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><section className="business-card-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="business-card-editor-title">
    <div className="business-card-editor-head"><span className="business-card-editor-icon"><BriefcaseBusiness size={18}/></span><div><span className="section-eyebrow">Digital business card</span><h2 id="business-card-editor-title">{card ? "Make your introduction." : "Create your card."}</h2></div><div className="business-card-editor-tabs"><button type="button" className={previewTab === "edit" ? "active" : ""} onClick={() => setPreviewTab("edit")}>Edit</button><button type="button" className={previewTab === "preview" ? "active" : ""} onClick={() => setPreviewTab("preview")}>Preview</button></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close card editor" disabled={saving}><X size={18}/></button></div>
    <form className="business-card-editor-body" onSubmit={(event) => void submit(event)}>
      <div className={`business-card-editor-fields ${previewTab === "preview" ? "show-preview-only" : ""}`}><p className="business-card-form-intro">A clear, polished introduction you can keep private or share with a unique public link.</p>{editForm}{error && <div className="contacts-inline-error" role="alert">{error}</div>}{uploadProgress && <TransferProgressIndicator progress={uploadProgress} label="Uploading card image" detail={`${humanSize(uploadProgress.loaded)} of ${humanSize(uploadProgress.total)}`}/>}</div>
      <aside className={`business-card-editor-preview ${previewTab === "edit" ? "" : "preview-visible"}`}><div className="business-card-preview-caption"><span>LIVE PREVIEW</span><span>Updates as you type</span></div><BusinessCardMiniPreview card={draftPreview}/><div className="business-card-preview-hint"><ShieldCheck size={13}/> Only details on this card are shared</div></aside>
      <div className="business-card-editor-footer"><span><ShieldCheck size={14}/>{form.isPublic ? "Only the information on this card is public" : "Private until you choose to publish"}</span><div><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="business-card-create" disabled={saving || (!connected && form.isPublic)}>{saving ? "Saving card…" : card ? "Save card" : "Create card"}<Check size={15}/></button></div></div>
    </form>
  </section></div>;
}

function BusinessCardMiniPreview({ card }: { card: BusinessCardDraft }) {
  return <div className={`business-card-mini-preview style-${card.style || "garden"}`}><div className="business-card-mini-cover"><span className="business-card-mini-mark"><BriefcaseBusiness size={15}/></span><BusinessCardImage dataUrl={card.businessLogoDataUrl} storageKey={card.businessLogoKey} className="business-card-mini-logo" alt={card.company || "Logo"}/></div><div className="business-card-mini-main"><BusinessCardImage dataUrl={card.profilePhotoDataUrl} storageKey={card.profilePhotoKey} className="business-card-mini-avatar" alt={card.fullName}/><span className={`business-card-visibility ${card.isPublic ? "is-public" : "is-private"}`}><i/>{card.isPublic ? "Public" : "Private"}</span><h3>{card.fullName || "Your name"}</h3><p>{[card.jobTitle, card.company].filter(Boolean).join(" · ") || "Title · Company"}</p>{card.bio && <blockquote>{card.bio}</blockquote>}<div className="business-card-mini-contact">{card.phoneNumbers.some((phone) => phone.number) && <span><Phone size={12}/>{card.phoneNumbers.find((phone) => phone.number)?.number}</span>}{card.email && <span><Mail size={12}/>{card.email}</span>}{card.websites.filter(Boolean).map((website, index) => <span key={index}><Globe2 size={12}/>{website.replace(/^https?:\/\//, "")}</span>)}{card.address && <span><MapPin size={12}/>{card.address}</span>}</div><div className="business-card-mini-socials">{card.socialLinks.filter((link) => link.url).map((link, index) => <span key={`${link.platform}-${index}`} title={link.platform}><SocialBrandIcon platform={link.platform} size={16}/></span>)}</div></div></div>;
}

export function BusinessCardImagePublic({ cardId, kind, className, alt }: { cardId: string; kind: "profile" | "logo"; className: string; alt: string }) {
  return <BusinessCardImage cardId={cardId} kind={kind} className={className} alt={alt}/>;
}
