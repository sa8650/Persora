import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, CircleAlert, Download, Flag, Globe2, Mail, MapPin, Phone, ShieldCheck, X } from "lucide-react";
import type { PublicDigitalBusinessCard } from "../types";
import { fetchPublicBusinessCard, reportPublicBusinessCard } from "../lib/backend";
import QRPreview from "./QRPreview";
import SocialBrandIcon from "./SocialBrandIcon";
import { BusinessCardImagePublic } from "./BusinessCardsView";
import { initials } from "../lib/utils";

const escapeVcard = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const cleanPhone = (value: string) => value.trim().replace(/[^\d+*#]/g, "");
function cardVcard(card: PublicDigitalBusinessCard) {
  const [given, ...family] = card.fullName.trim().split(/\s+/);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(card.fullName)}`, `N:${escapeVcard(family.join(" "))};${escapeVcard(given || "")};;;`];
  card.phoneNumbers.forEach((phone) => lines.push(`TEL;TYPE=${phone.label === "Work" || phone.label === "Office" ? "WORK" : "CELL"}:${escapeVcard(phone.number)}`));
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(card.email)}`);
  if (card.company) lines.push(`ORG:${escapeVcard(card.company)}`);
  if (card.jobTitle) lines.push(`TITLE:${escapeVcard(card.jobTitle)}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${escapeVcard(card.address)};;;;`);
  card.websites.forEach((website) => lines.push(`URL:${escapeVcard(website)}`));
  card.socialLinks.forEach((link) => lines.push(`URL;TYPE=${link.platform.toUpperCase()}:${escapeVcard(link.url)}`));
  card.customLinks.forEach((link) => lines.push(`URL;TYPE=${escapeVcard(link.label)}:${escapeVcard(link.url)}`));
  if (card.bio) lines.push(`NOTE:${escapeVcard(card.bio)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export default function PublicBusinessCardPage({ cardId }: { cardId: string }) {
  const [card, setCard] = useState<PublicDigitalBusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Spam or misleading");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setUnavailable(false); setCard(null);
    void fetchPublicBusinessCard(cardId).then((result) => {
      if (!active) return;
      setCard(result);
      document.title = `${result.fullName} · Digital card | Persora`;
    }).catch(() => { if (active) setUnavailable(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cardId]);
  const website = card?.websites[0] || "";
  const publicUrl = `${window.location.origin}/BusinessCard/${cardId}`;
  const downloadContact = () => {
    if (!card) return;
    const blob = new Blob([cardVcard(card)], { type: "text/vcard;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `${card.fullName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "persora-contact"}.vcf`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
  };
  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setReportBusy(true); setReportError("");
    try { await reportPublicBusinessCard(cardId, reportReason, reportDetails.trim()); setReportSent(true); }
    catch (error) { setReportError(error instanceof Error ? error.message : "The report couldn't be sent. Please try again."); }
    finally { setReportBusy(false); }
  };
  if (loading) return <main className="public-card-page public-card-state"><span className="public-card-loader"/><p>Preparing your introduction…</p></main>;
  if (unavailable || !card) return <main className="public-card-page public-card-state"><span className="public-card-unavailable-icon"><ShieldCheck size={24}/></span><span className="public-card-eyebrow">Persora digital card</span><h1>This card is unavailable.</h1><p>The card may be private, disabled, or the link may be incorrect.</p><a href="/" className="public-card-back-link">Go to Persora <ArrowUpRight size={14}/></a></main>;
  return <main className="public-card-page">
    <div className="public-card-frame"><header className="public-card-brand"><a href="/" className="public-card-wordmark"><span className="public-card-brand-mark"><ShieldCheck size={15}/></span>persora<span>.</span></a><span className="public-card-label">DIGITAL BUSINESS CARD</span></header>
      <article className={`public-card-surface style-${card.style || "garden"}`}>
        <div className="public-card-cover"><span className="public-card-cover-glow public-card-cover-glow-a"/><span className="public-card-cover-glow public-card-cover-glow-b"/><span className="public-card-cover-grid"/><div className="public-card-logo-zone">{card.businessLogoUrl ? <BusinessCardImagePublic cardId={cardId} kind="logo" className="public-card-business-logo" alt={`${card.company || card.fullName} logo`}/> : <span className="public-card-logo-mark"><ShieldCheck size={22}/></span>}</div></div>
        <section className="public-card-profile"><div className="public-card-avatar-wrap">{card.profilePhotoUrl ? <BusinessCardImagePublic cardId={cardId} kind="profile" className="public-card-avatar" alt={card.fullName}/> : <span className="public-card-avatar public-card-avatar-fallback">{initials(card.fullName)}</span>}</div>
          <div className="public-card-profile-copy"><span className="public-card-eyebrow">{card.company || "A personal introduction"}</span><h1>{card.fullName}</h1>{card.jobTitle && <p className="public-card-title">{card.jobTitle}</p>}{card.company && <p className="public-card-company">{card.company}</p>}</div>
          {card.bio && <p className="public-card-bio">{card.bio}</p>}
          <div className="public-card-actions"><div className="public-card-action-main">{card.phoneNumbers[0] && <a href={`tel:${cleanPhone(card.phoneNumbers[0].number)}`} className="public-card-primary-action"><Phone size={16}/> Call</a>}{card.email && <a href={`mailto:${card.email}`} className="public-card-primary-action"><Mail size={16}/> Email</a>}{website && <a href={website} target="_blank" rel="noreferrer" className="public-card-primary-action"><Globe2 size={16}/> Website</a>}</div><button type="button" className="public-card-save-button" onClick={downloadContact}><Download size={16}/> Save Contact</button></div>
          {(card.phoneNumbers.length > 0 || card.email || card.websites.length > 0 || card.address) && <div className="public-card-contact-details">{card.phoneNumbers.map((phone, index) => <a className="public-card-detail-row" key={`${phone.number}-${index}`} href={`tel:${cleanPhone(phone.number)}`}><span><Phone size={15}/></span><span><small>{phone.label || "Phone"}</small><b>{phone.number}</b></span><ArrowUpRight size={14}/></a>)}{card.email && <a className="public-card-detail-row" href={`mailto:${card.email}`}><span><Mail size={15}/></span><span><small>Email</small><b>{card.email}</b></span><ArrowUpRight size={14}/></a>}{card.websites.map((url, index) => <a className="public-card-detail-row" key={url} href={url} target="_blank" rel="noreferrer"><span><Globe2 size={15}/></span><span><small>{index === 0 ? "Website" : `Website ${index + 1}`}</small><b>{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</b></span><ArrowUpRight size={14}/></a>)}{card.address && <div className="public-card-detail-row"><span><MapPin size={15}/></span><span><small>Address</small><b>{card.address}</b></span></div>}</div>}
          {(card.socialLinks.length > 0 || card.customLinks.length > 0) && <div className="public-card-link-block">{card.socialLinks.length > 0 && <div className="public-card-socials" aria-label="Social profiles">{card.socialLinks.map((link, index) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.platform}-${index}`} aria-label={link.platform} title={link.platform}><SocialBrandIcon platform={link.platform} size={19}/></a>)}</div>}{card.customLinks.length > 0 && <div className="public-card-custom-links">{card.customLinks.map((link, index) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.label}-${index}`}><span>{link.label}</span><ArrowUpRight size={13}/></a>)}</div>}</div>}
        </section>
        <section className="public-card-qr-section"><div><span className="public-card-eyebrow">ONE SCAN AWAY</span><h2>Let’s stay connected.</h2><p>Scan this code to open my digital card anytime.</p></div><div className="public-card-qr"><QRPreview value={publicUrl} size={112}/></div></section>
      </article>
      <footer className="public-card-footer"><span>Shared with care via <b>Persora</b></span><button type="button" onClick={() => { setReportOpen(true); setReportSent(false); setReportError(""); }}><Flag size={12}/> Report this card</button></footer>
    </div>
    {reportOpen && <div className="modal-backdrop public-card-report-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !reportBusy && setReportOpen(false)}><section className="public-card-report-dialog" role="dialog" aria-modal="true" aria-labelledby="public-card-report-title"><div className="public-card-report-head"><span><Flag size={17}/></span><div><small>Persora safety</small><h2 id="public-card-report-title">Report this card</h2></div><button type="button" onClick={() => setReportOpen(false)} aria-label="Close" disabled={reportBusy}><X size={18}/></button></div>{reportSent ? <div className="public-card-report-success"><span><Check size={20}/></span><b>Thanks for letting us know.</b><p>Your report was submitted for review.</p><button type="button" onClick={() => setReportOpen(false)}>Done</button></div> : <form onSubmit={(event) => void submitReport(event)}><p>Choose a reason. Reports are private and help keep public cards safe.</p><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option>Spam or misleading</option><option>Inappropriate content</option><option>Impersonation</option><option>Other</option></select></label><label>Details <small>Optional</small><textarea rows={3} maxLength={500} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Tell us a little more…"/></label>{reportError && <div className="public-card-report-error"><CircleAlert size={14}/>{reportError}</div>}<div className="public-card-report-actions"><button type="button" onClick={() => setReportOpen(false)} disabled={reportBusy}>Cancel</button><button type="submit" disabled={reportBusy}>{reportBusy ? "Sending…" : "Send report"}</button></div></form>}</section></div>}
  </main>;
}
