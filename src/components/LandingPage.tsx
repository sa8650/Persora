import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FileText,
  Fingerprint,
  HardDrive,
  HeartPulse,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Button } from "./ui/button";
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
  { icon: FileText, title: "Documents, in order", body: "Keep IDs, certificates, warranties, and their important dates close at hand.", tone: "blue" },
  { icon: HeartPulse, title: "Your health history", body: "Bring health records and key life moments into one private timeline.", tone: "red" },
  { icon: UsersRound, title: "People & connections", body: "Save the contacts and digital business cards you want to find again.", tone: "blue" },
  { icon: WalletCards, title: "The details between", body: "Track subscriptions, memberships, study records, notes, and useful links.", tone: "yellow" },
];

const faqs = [
  { question: "Can I try Persora before creating an account?", answer: "Yes. Choose Explore the demo to look around with sample information stored in this browser. Demo data is separate from a registered account." },
  { question: "Is Persora only for documents?", answer: "No. Your workspace includes dedicated spaces for records, subscriptions, contacts, business cards, reminders, notes, study, and more." },
  { question: "Can I share something from my vault?", answer: "You decide what to share. Persora supports sharing specific records with another Persora account, and you can manage or revoke access." },
  { question: "How large can an uploaded file be?", answer: "The current maximum is {maxUploadMb} MB per file. The exact limit is shown again when you add an attachment." },
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
                <p className="hero-description">Documents, records, contacts, subscriptions and the small details you don’t want to lose—organized in one calm, private space.</p>
                <div className="hero-actions">
                  <ShimmerButton onClick={onGetStarted} className="hero-primary">Create your free vault <ArrowRight size={17} /></ShimmerButton>
                  <button className="hero-secondary" onClick={onDemo}>Explore the demo <ArrowUpRight size={16} /></button>
                </div>
                <div className="hero-note"><ShieldCheck size={15} /> Private by default <span /> Set up at your own pace</div>
              </BlurFade>
            </div>

            <BlurFade delay={110} className="hero-preview-wrap">
              <div className="hero-preview-shadow" />
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
              <div className="hero-float-card hero-float-left"><span className="float-bubble float-bubble-blue"><HardDrive size={15} /></span><span><b>Everything connected</b><small>One organized workspace</small></span></div>
              <div className="hero-float-card hero-float-right"><span className="float-bubble float-bubble-blue"><ShieldCheck size={16} /></span><span><b>You’re in control</b><small>Share only what you choose</small></span></div>
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
            <span className="section-eyebrow">A home for all the important bits</span>
            <h2>Everything has a place.<br /><span>Everything stays within reach.</span></h2>
            <p>Persora brings the practical and personal parts of life together—without adding more noise.</p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, body, tone }, index) => (
              <MagicCard key={title} className={`feature-card feature-${tone}`} glowColor="rgba(26, 115, 232, .1)">
                <div className="feature-card-top"><span className={`feature-icon tone-${tone}`}><Icon size={19} /></span><span className="feature-number">0{index + 1}</span></div>
                <h3>{title}</h3><p>{body}</p><span className="feature-arrow"><ArrowUpRight size={16} /></span>
              </MagicCard>
            ))}
          </div>
          <div className="feature-chip-row"><span>Family documents</span><span>Health records</span><span>Reminders</span><span>Useful links</span><span>Contacts</span><span>Memberships</span></div>
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

        <section className="how-section" id="how-it-works">
          <div className="section-heading section-heading-compact">
            <span className="section-eyebrow">Easy to start, easy to keep up</span>
            <h2>Start small. <span>Stay organized.</span></h2>
            <p>Bring things together one step at a time. Your space grows with you.</p>
          </div>
          <div className="how-steps">
            <article className="how-step"><span className="step-number">01</span><span className="step-icon step-blue"><Fingerprint size={20} /></span><h3>Create your space</h3><p>Set up a personal account or take a quick look around the demo.</p></article>
            <article className="how-step"><span className="step-number">02</span><span className="step-icon step-blue"><FileText size={20} /></span><h3>Add what matters</h3><p>Save records, people, subscriptions, notes, and helpful reminders.</p></article>
            <article className="how-step"><span className="step-number">03</span><span className="step-icon step-yellow"><Sparkles size={20} /></span><h3>Find it when you need it</h3><p>Search your workspace and see important dates at a glance.</p></article>
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
