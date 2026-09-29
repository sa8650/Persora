import { ArrowLeft, ArrowRight, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import type { SiteContent } from "../types";

type PublicPage = "privacy" | "terms" | "contact";
interface Props {
  page: PublicPage;
  content: SiteContent;
  signedIn: boolean;
  onHome: () => void;
  onSignIn: () => void;
}

export default function PublicInfoPage({ page, content, signedIn, onHome, onSignIn }: Props) {
  const title = page === "privacy" ? content.privacyTitle : page === "terms" ? content.termsTitle : content.contactTitle;
  const copy = page === "privacy" ? content.privacyBody : page === "terms" ? content.termsBody : content.contactBody;
  const safeWhatsApp = /^https?:\/\//i.test(content.contactWhatsApp)
    ? content.contactWhatsApp
    : content.contactWhatsApp.replace(/\D/g, "") ? `https://wa.me/${content.contactWhatsApp.replace(/\D/g, "")}` : "";

  return <div className="public-info-shell">
    <header className="public-info-header">
      <a className="public-info-brand" href="/" onClick={(event) => { event.preventDefault(); onHome(); }}><span className="brand-mark"><ShieldCheck size={19}/></span><b>Persora</b></a>
      <nav aria-label="Public pages"><a className={page === "privacy" ? "active" : ""} href="/privacy">Privacy</a><a className={page === "terms" ? "active" : ""} href="/terms">Terms</a><a className={page === "contact" ? "active" : ""} href="/contact">Contact</a></nav>
      {signedIn ? <button className="public-info-back" onClick={onHome}><ArrowLeft size={15}/> Back to your vault</button> : <button className="public-info-back" onClick={onSignIn}>Sign in <ArrowRight size={15}/></button>}
    </header>
    <main className="public-info-main">
      <a className="public-info-backlink" href="/" onClick={(event) => { event.preventDefault(); onHome(); }}><ArrowLeft size={14}/> Persora home</a>
      <div className="public-info-card">
        <span className="section-eyebrow">PERSORA · {page === "privacy" ? "YOUR INFORMATION" : page === "terms" ? "SERVICE DETAILS" : "WE’RE HERE TO HELP"}</span>
        <h1>{title}</h1>
        {page === "contact" ? <>
          <p className="public-info-copy">{copy || "Contact information will be published here by the Persora administrator."}</p>
          {(content.contactEmail || content.contactPhone || content.contactWhatsApp || content.contactAddress) ? <div className="public-contact-list">
            {content.contactEmail && <a href={`mailto:${content.contactEmail}`}><Mail size={17}/><span><small>Email</small><b>{content.contactEmail}</b></span></a>}
            {content.contactPhone && <a href={`tel:${content.contactPhone.replace(/[^+\d]/g, "")}`}><Phone size={17}/><span><small>Phone</small><b>{content.contactPhone}</b></span></a>}
            {safeWhatsApp && <a href={safeWhatsApp} target="_blank" rel="noreferrer"><Phone size={17}/><span><small>WhatsApp</small><b>{content.contactWhatsApp}</b></span></a>}
            {content.contactAddress && <div><MapPin size={17}/><span><small>Address</small><b>{content.contactAddress}</b></span></div>}
          </div> : <div className="public-contact-empty"><Mail size={19}/><span>Contact details have not been configured yet. Please check back later.</span></div>}
        </> : <div className="public-info-copy legal-copy">{copy}</div>}
        <div className="public-info-footnote"><ShieldCheck size={15}/><span>For questions about your account or information, use the Contact page.</span></div>
      </div>
    </main>
    <footer className="public-info-footer"><div><b>Persora</b><span>Powered by Dexter Studio</span></div><span className="public-security-label"><ShieldCheck size={14}/> Sherlock Security System</span><small>© 2026 Persora</small></footer>
  </div>;
}
