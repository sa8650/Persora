import type { CSSProperties } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Fingerprint,
  HardDrive,
  HeartPulse,
  Home,
  LayoutGrid,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Button } from "./ui/button";
import IphoneMockup from "./IphoneMockup";
import { BlurFade, BorderBeam, MagicCard, ShimmerButton } from "./magic-ui";
import type { SubscriptionPlan } from "../types";

interface LandingPageProps {
  onSignIn: () => void;
  onGetStarted: () => void;
  onDemo: () => void;
  onChoosePlan: (planId: string) => void;
  plans: SubscriptionPlan[];
  billingEnabled: boolean;
  maxUploadMb: number;
}

const features = [
  { icon: Sparkles, title: "Smart Scan + editable catch-all", body: "Scan supported IDs and paperwork. Matching facts fill the right fields; other readable facts land in editable Additional Data for review.", tone: "blue" },
  { icon: UsersRound, title: "Family-linked records", body: "Choose Me or a person from your Family space when saving identity and student records. Rename a family member without losing the link.", tone: "yellow" },
  { icon: HeartPulse, title: "Health records & life timeline", body: "Keep visits, prescriptions, tests and files together, then see important dates and milestones in context.", tone: "red" },
  { icon: FileText, title: "Documents that stay useful", body: "Organize NID, student ID, passport, certificates, warranties and expiry dates with fields that adapt to the record type.", tone: "blue" },
  { icon: WalletCards, title: "Everyday life, in its own spaces", body: "Track subscriptions, memberships, personal finance, study materials, tasks, reminders and useful links.", tone: "yellow" },
  { icon: LockKeyhole, title: "People, sharing & control", body: "Import contacts on Android or from a file, make digital business cards, organize folders, share selected records and export a backup.", tone: "blue" },
];

const faqs = [
  { question: "Can I try Persora before creating an account?", answer: "Yes. Choose Explore the demo to look around with sample information stored in this browser. Demo data is separate from a registered account." },
  { question: "Is Persora only for documents?", answer: "No. Your workspace includes dedicated spaces for records, subscriptions, contacts, business cards, reminders, notes, study, and more." },
  { question: "Can I share something from my vault?", answer: "You decide what to share. Persora supports sharing specific records with another Persora account, and you can manage or revoke access." },
  { question: "How large can an uploaded file be?", answer: "You can add and manage records on any plan. New file and image uploads require an active paid plan, with a limit of {maxUploadMb} MB per file." },
  { question: "How do paid plans work?", answer: "Storage plans and prices are shown above when configured. Where manual payments are enabled, an administrator verifies the transaction reference before a paid plan starts." },
];

function formatMoney(value: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0); }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}

export default function LandingPage({ onSignIn, onGetStarted, onDemo, onChoosePlan, plans, billingEnabled, maxUploadMb }: LandingPageProps) {
  return (
    <div className="landing-shell" id="top">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Persora home">
          <span className="brand-mark"><ShieldCheck size={19} strokeWidth={2.1} /></span>
          <span>persora</span>
        </a>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">Phone flow</a>
          <a href="#security">Privacy</a>
          <a href="#pricing">Pricing</a>
          <a href="#faqs">FAQ</a>
        </nav>
        <div className="landing-nav-actions">
          <Button variant="ghost" className="nav-login" onClick={onSignIn}>Sign in</Button>
          <Button className="nav-get-started" onClick={onGetStarted}>Get started <ArrowUpRight size={16} /></Button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-ambient hero-ambient-one" />
          <div className="hero-ambient hero-ambient-two" />
          <div className="hero-layout">
            <div className="hero-copy">
              <BlurFade delay={20}>
                <div className="hero-pill"><span className="hero-pill-dot" /><span>Your personal digital home</span></div>
              </BlurFade>
              <BlurFade delay={70}>
                <h1>Your life,<br /><span>all in one place.</span></h1>
              </BlurFade>
              <BlurFade delay={120}>
                <p className="hero-description">A phone-friendly personal portal for IDs, family details, health records, contacts and everyday admin—with type-aware forms, Smart Scan suggestions and one calm place to find it again.</p>
                <div className="hero-actions">
                  <ShimmerButton onClick={onGetStarted} className="hero-primary">Create your free vault <ArrowRight size={17} /></ShimmerButton>
                  <button className="hero-secondary" onClick={onDemo}>Explore the demo <ArrowUpRight size={16} /></button>
                </div>
                <div className="hero-note"><ShieldCheck size={15} /> Private by default <span /> Built for phone and desktop</div>
              </BlurFade>
            </div>

            <BlurFade delay={110} className="hero-preview-wrap">
              <div className="hero-device-stage" role="img" aria-label="Persora personal portal shown on a laptop and iPhone">
                <div className="hero-laptop">
                  <div className="hero-laptop-bezel">
                    <div className="hero-preview-card">
                <div className="preview-topbar">
                  <div className="preview-brand"><span className="brand-mark tiny"><ShieldCheck size={12} /></span><b>persora</b><span className="preview-workspace-label">Personal space</span></div>
                  <div className="preview-avatar">AR</div>
                </div>
                <div className="preview-body">
                  <aside className="preview-sidebar">
                    <div className="preview-side-active"><span className="preview-side-icon"><Sparkles size={14} /></span>Overview</div>
                    <div><span className="preview-side-icon preview-blue"><FileText size={14} /></span>Documents</div>
                    <div><span className="preview-side-icon preview-blue"><HeartPulse size={14} /></span>Health records</div>
                    <div><span className="preview-side-icon preview-yellow"><WalletCards size={14} /></span>Subscriptions</div>
                    <div><span className="preview-side-icon preview-purple"><BookOpen size={14} /></span>Study</div>
                    <div className="preview-side-private"><LockKeyhole size={12} /> Private vault</div>
                  </aside>
                  <div className="preview-main">
                    <div className="preview-greeting-row">
                      <div><span className="preview-overline">SAMPLE WORKSPACE</span><h3>Good morning, Amina</h3><p>A clear view of what matters today.</p></div>
                      <span className="preview-weather-icon"><Fingerprint size={20} /></span>
                    </div>
                    <div className="preview-metrics">
                      <div className="preview-metric"><span className="preview-metric-icon metric-blue"><FileText size={14} /></span><b>12</b><small>Documents</small></div>
                      <div className="preview-metric"><span className="preview-metric-icon metric-yellow"><WalletCards size={14} /></span><b>06</b><small>Subscriptions</small></div>
                      <div className="preview-metric"><span className="preview-metric-icon metric-blue"><UsersRound size={14} /></span><b>18</b><small>Contacts</small></div>
                    </div>
                    <div className="preview-list-heading"><b>Coming up</b><span>Next 30 days <ArrowRight size={12} /></span></div>
                    <div className="preview-reminder">
                      <span className="preview-file-icon"><FileText size={15} /></span>
                      <span><b>Bangladesh passport</b><small>Personal document · Renewal reminder</small></span>
                      <i className="preview-date-chip">8 days</i>
                    </div>
                    <div className="preview-reminder">
                      <span className="preview-calendar-icon"><b>18</b><small>OCT</small></span>
                      <span><b>Google One</b><small>Subscription · ৳ 650 / month</small></span>
                      <i className="preview-status-dot" />
                    </div>
                    <div className="preview-bottom-note"><LockKeyhole size={12} /> Your vault is private <span><Check size={12} /></span></div>
                  </div>
                </div>
                  </div>
                  <span className="hero-laptop-camera" aria-hidden="true" />
                </div>
                <div className="hero-laptop-base" aria-hidden="true"><span /></div>
                </div>
                <IphoneMockup className="hero-iphone-device" aria-hidden="true">
                  <div className="hero-iphone-screen">
                    <div className="hero-iphone-status"><span>9:41</span><span>● ● ● ▰</span></div>
                    <div className="hero-iphone-header"><span className="hero-iphone-brand"><span className="hero-iphone-brand-mark"><ShieldCheck size={13}/></span>persora<span>.</span></span><span className="hero-iphone-avatar">AR</span></div>
                    <div className="hero-iphone-welcome"><small>YOUR PERSONAL SPACE</small><b>Good morning,<br/>Amina</b><span>Your life, in one place.</span></div>
                    <div className="hero-iphone-search"><Search size={13}/><span>Search your vault</span></div>
                    <div className="hero-iphone-add"><span><Plus size={15}/></span><span><b>Add document</b><small>Scan or add a record</small></span><ArrowRight size={13}/></div>
                    <div className="hero-iphone-section"><b>Your spaces</b><span>View all</span></div>
                    <div className="hero-iphone-spaces"><span><FileText size={13}/><b>Documents</b></span><span><HeartPulse size={13}/><b>Medical</b></span><span><UsersRound size={13}/><b>Family</b></span><span><BookOpen size={13}/><b>Study</b></span></div>
                    <div className="hero-iphone-section hero-iphone-upcoming"><b>Coming up</b><span>See all</span></div>
                    <div className="hero-iphone-record"><span><Fingerprint size={13}/></span><b>Bangladesh passport</b><small>Expires in 8 days</small></div>
                    <div className="hero-iphone-bottom-nav"><span><Home size={12}/>Home</span><span><LayoutGrid size={12}/>Spaces</span><span className="hero-iphone-nav-add"><i><Plus size={13}/></i>Add</span><span><CheckCircle2 size={12}/>Tasks</span><span><MoreHorizontal size={12}/>More</span></div>
                  </div>
                </IphoneMockup>
              </div>
            </BlurFade>
          </div>
          <div className="hero-bottom-rule"><span />A LITTLE MORE ROOM TO THINK<span /></div>
        </section>

        <section className="landing-trust-strip" aria-label="Persora principles">
          <span>Made for real life</span>
          <div><span className="trust-check trust-blue"><LockKeyhole size={14} /></span><b>Private by default</b></div>
          <div><span className="trust-check trust-blue"><Check size={14} /></span><b>Organized around you</b></div>
          <div><span className="trust-check trust-yellow"><Fingerprint size={14} /></span><b>Your choice, your control</b></div>
        </section>

        <section className="features-section" id="features">
          <div className="section-heading">
            <span className="section-eyebrow">Useful features available today</span>
            <h2>One thoughtful portal.<br /><span>Spaces that fit real life.</span></h2>
            <p>From NID and student records to medical history, contacts, money and reminders—Persora adapts the form to what you’re saving.</p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, body, tone }, index) => (
              <MagicCard key={title} className={`feature-card feature-${tone}`} glowColor="rgba(26, 115, 232, .1)">
                <div className="feature-card-top"><span className={`feature-icon tone-${tone}`}><Icon size={19} /></span><span className="feature-number">0{index + 1}</span></div>
                <h3>{title}</h3><p>{body}</p><span className="feature-arrow"><ArrowUpRight size={16} /></span>
              </MagicCard>
            ))}
          </div>
          <div className="feature-chip-row"><span>NID + Student ID</span><span>Smart Scan + Additional Data</span><span>Family members</span><span>Medical records</span><span>Contacts + business cards</span><span>Folders + backup</span><span>Finance + subscriptions</span><span>Tasks + reminders</span></div>
        </section>

        <section className="portal-flow-section" id="how-it-works">
          <div className="portal-flow-heading">
            <span className="section-eyebrow">A phone-first portal flow</span>
            <h2>From home to saved.<br/><span>Five clear steps.</span></h2>
            <p>Persora’s web workspace follows the same simple flow on a phone: choose a space, choose a type, scan if useful, review every suggestion, then save.</p>
          </div>
          <div className="portal-flow-layout">
            <ol className="portal-flow-steps">
              {[
                ["01", "Open your home", "See your spaces, recent records and dates coming up."],
                ["02", "Choose a space", "Documents, Family, Medical Records, Contacts and more."],
                ["03", "Choose the record type", "NID, Student ID, passport, visit, task—fields adapt to your choice."],
                ["04", "Scan and review", "Smart Scan suggests matching fields; other readable facts stay editable in Additional Data."],
                ["05", "Save to your vault", "Find it later, move it to a folder, or share only that record."],
              ].map(([number, title, body], index) => <li className="portal-flow-step" key={number} style={{ "--flow-index": index } as CSSProperties}>
                <span className="portal-flow-step-number">{number}</span><span className="portal-flow-step-copy"><b>{title}</b><small>{body}</small></span><span className="portal-flow-step-state"><Check size={13}/></span>
              </li>)}
              <li className="portal-flow-progress" aria-hidden="true"><span/></li>
            </ol>
            <div className="portal-phone-stage" aria-label="Illustrative Persora mobile web workspace">
              <div className="portal-phone-glow"/>
              <div className="portal-phone-shell">
                <div className="portal-phone-speaker" aria-hidden="true"><i/></div>
                <div className="portal-phone-screen">
                  <div className="portal-phone-status"><span>9:41</span><span aria-hidden="true">● ● ●</span></div>
                  <div className="portal-phone-header"><span className="portal-phone-brand"><span className="portal-phone-brand-mark"><ShieldCheck size={13}/></span>persora<span className="portal-phone-dot">.</span></span><span className="portal-phone-avatar">AR</span></div>
                  <div className="portal-phone-greeting"><span>YOUR PERSONAL SPACE</span><b>Good morning, Amina</b><small>Your important details, together.</small></div>
                  <div className="portal-phone-search"><Search size={13}/> Search your vault</div>
                  <div className="portal-phone-add"><span><Plus size={16}/></span><span><b>Add document</b><small>Choose a space and record type</small></span><ArrowRight size={14}/></div>
                  <div className="portal-phone-section-head"><b>Your spaces</b><span>View all</span></div>
                  <div className="portal-phone-spaces">
                    <div><span className="phone-space-icon phone-space-blue"><FileText size={13}/></span><b>Documents</b><small>Identity &amp; records</small></div>
                    <div><span className="phone-space-icon phone-space-rose"><HeartPulse size={13}/></span><b>Medical</b><small>Health archive</small></div>
                    <div><span className="phone-space-icon phone-space-yellow"><UsersRound size={13}/></span><b>Family</b><small>People &amp; details</small></div>
                    <div><span className="phone-space-icon phone-space-violet"><BookOpen size={13}/></span><b>Study</b><small>Notes &amp; files</small></div>
                  </div>
                  <div className="portal-phone-scan">
                    <div className="portal-phone-scan-head"><span><Sparkles size={13}/> Smart Scan</span><small>READY TO REVIEW</small></div>
                    <div className="portal-phone-scan-row"><span>NID number</span><b>•••• •••• 3412</b></div>
                    <div className="portal-phone-scan-row"><span>Belongs to</span><b>Me</b></div>
                    <div className="portal-phone-scan-row"><span>Additional Data</span><b>Address · issue date</b></div>
                    <div className="portal-phone-scan-foot"><Check size={11}/> Editable before saving</div>
                  </div>
                  <div className="portal-phone-reminder"><CalendarDays size={14}/><span><small>UP NEXT</small><b>Passport expires in 8 days</b></span><ArrowRight size={12}/></div>
                  <div className="portal-phone-nav"><span><span>⌂</span>Home</span><span><span>▦</span>Spaces</span><span className="portal-phone-nav-add"><span>＋</span>Add</span><span><span>✓</span>Tasks</span><span><span>···</span>More</span></div>
                </div>
                <div className="portal-phone-home-indicator" aria-hidden="true"/>
              </div>
              <div className="portal-phone-caption"><span><LockKeyhole size={13}/></span><b>Private by default</b><small>Review first. Save when ready.</small></div>
            </div>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="security-copy">
            <span className="section-eyebrow">Clear about your privacy</span>
            <h2>Your information<br /><span>belongs to you.</span></h2>
            <p>Persora is designed around your personal space. Keep records private, share individual items when it helps, and manage your account from one place.</p>
            <div className="security-points">
              <div><span className="security-point-icon security-blue"><LockKeyhole size={16} /></span><span><b>Private by default</b><small>Your records stay in your signed-in workspace.</small></span></div>
              <div><span className="security-point-icon security-blue"><UsersRound size={16} /></span><span><b>Share on your terms</b><small>Manage access to the specific items you choose.</small></span></div>
              <div><span className="security-point-icon security-yellow"><HardDrive size={16} /></span><span><b>Take your data with you</b><small>Export a backup of your personal records.</small></span></div>
            </div>
          </div>
          <div className="security-visual">
            <div className="security-orbit orbit-a" /><div className="security-orbit orbit-b" />
            <div className="security-card-main">
              <div className="security-card-icon"><ShieldCheck size={23} /></div>
              <span className="security-card-label">YOUR PERSORA SPACE</span>
              <h3>Private, by design.</h3>
              <p>Personal details, organized at your pace.</p>
              <div className="security-card-separator" />
              <div className="security-card-state"><span><LockKeyhole size={14} /> Only you decide what to share</span><i><Check size={13} /></i></div>
            </div>
            <div className="security-mini-card"><span className="security-mini-avatar">AR</span><span><b>Amina Rahman</b><small>Personal account</small></span><span className="security-mini-dot" /></div>
          </div>
        </section>

        <section className="landing-pricing-section" id="pricing">
          <div className="section-heading section-heading-compact">
            <span className="section-eyebrow">Room for what matters</span>
            <h2>Storage that fits <span>your life.</span></h2>
            <p>Choose the amount of storage you need. Plans and billing are managed transparently.</p>
          </div>
          {plans.length ? <div className="landing-plan-grid">{plans.map((plan) => {
            const price = formatMoney(plan.monthly_price || 0, plan.currency || "BDT");
            const unavailable = !billingEnabled && plan.monthly_price > 0;
            return <article className={`landing-plan-card ${plan.slug === "free" ? "landing-plan-free" : ""}`} key={plan.id}>
              <div className="landing-plan-top"><span>{plan.name}</span><span className="plan-capacity">{plan.storage_gb} GB</span></div>
              <h3>{price}<small> / month</small></h3>
              <p>{plan.description || `${plan.storage_gb} GB of private storage.`}</p>
              <ul className="landing-plan-benefits">
                <li><Check size={14} /><span>{plan.storage_gb} GB for the records and files you choose to keep</span></li>
                <li><Check size={14} /><span>Uploads up to {maxUploadMb} MB per file</span></li>
                <li><Check size={14} /><span>Use across every Persora vault section</span></li>
                <li><Check size={14} /><span>{plan.monthly_price > 0 ? "Plan activates after payment review" : "No payment required"}</span></li>
              </ul>
              <div className="landing-plan-rate">{formatMoney(plan.price_per_gb_monthly, plan.currency || "BDT")} per GB / month</div>
              <Button className="landing-plan-action" disabled={unavailable} onClick={() => onChoosePlan(plan.id)}>{unavailable ? "Payments opening soon" : plan.monthly_price > 0 ? "Choose this plan" : "Create your free vault"}<ArrowRight size={15} /></Button>
            </article>;
          })}</div> : <div className="landing-plans-empty"><LockKeyhole size={17} /><span>Storage plans will appear here once Persora is connected.</span></div>}
          <p className="landing-pricing-note">Manual payments are reviewed by the Persora team. Your files are never used to verify a payment.</p>
        </section>

        <section className="landing-faq-section" id="faqs">
          <div className="faq-intro"><span className="section-eyebrow">Good to know</span><h2>Questions, answered.</h2><p>Learn how Persora works before you create your space.</p></div>
          <div className="landing-faq">{faqs.map((item) => <details key={item.question}><summary>{item.question}<span><ArrowRight size={15} /></span></summary><p>{item.answer.replace("{maxUploadMb}", String(maxUploadMb))}</p></details>)}</div>
        </section>

        <section className="landing-cta">
          <div className="cta-glow" />
          <span className="cta-icon"><ShieldCheck size={22} /></span>
          <div><span className="section-eyebrow">Make room for what matters</span><h2>A little more organized<br /><span>starts here.</span></h2><p>Give all your important details a place to call home.</p></div>
          <div className="cta-actions"><ShimmerButton onClick={onGetStarted}>Create your free vault <ArrowRight size={16} /></ShimmerButton><button onClick={onDemo}>Or explore the demo</button></div>
          <BorderBeam />
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand footer-brand" href="#top"><span className="brand-mark"><ShieldCheck size={17} /></span><span>persora</span></a>
        <p>A little more room for what matters.</p>
        <nav className="landing-footer-links" aria-label="Legal and contact"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav>
        <div className="landing-footer-meta"><span>© 2026 Persora</span><span>Powered by Dexter Studio</span><button onClick={onSignIn}>Sign in</button><a href="/admin">Admin sign in</a></div>
      </footer>
    </div>
  );
}
