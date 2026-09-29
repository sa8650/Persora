import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Fingerprint,
  FileCheck2,
  FolderHeart,
  HardDrive,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { AnimatedShinyText, BlurFade, BorderBeam, MagicCard, ShimmerButton } from "./magic-ui";
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
  { icon: FileCheck2, title: "Your personal vault", body: "IDs, certificates, health documents and the dates you shouldn't miss.", color: "mint" },
  { icon: WalletCards, title: "Life, neatly handled", body: "Subscriptions, warranties, memberships and online accounts in one view.", color: "peach" },
  { icon: BookOpen, title: "A space to keep learning", body: "Study materials, academic records and useful links, always close by.", color: "lavender" },
];

const trust = ["PRIVATE BY DESIGN", "YOUR FILES, YOUR CONTROL", "MADE FOR REAL LIFE"];

export default function LandingPage({ onSignIn, onGetStarted, onDemo, onChoosePlan, plans, billingEnabled, maxUploadMb }: LandingPageProps) {
  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Persora home"><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.2} /></span><span>persora</span></a>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#why-persora">Why Persora</a>
          <a href="#features">What it holds</a>
          <a href="#pricing">Pricing</a>
          <a href="#how-it-works">How it works</a>
          <a href="#faqs">FAQ</a>
        </nav>
        <div className="landing-nav-actions">
          <button className="nav-login" onClick={onSignIn}>Log in</button>
          <button className="nav-get-started" onClick={onGetStarted}>Get started <ArrowUpRight size={15} /></button>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="hero-grain" />
          <div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" />
          <div className="hero-layout">
            <div className="hero-copy">
              <BlurFade delay={40}>
                <div className="hero-pill"><span className="hero-pill-spark"><Sparkles size={13} /></span><AnimatedShinyText>Your life, in one place</AnimatedShinyText><ChevronRight size={13} /></div>
              </BlurFade>
              <BlurFade delay={110}>
                <h1>A home for<br /><span>everything</span><br />that matters.</h1>
              </BlurFade>
              <BlurFade delay={180}>
                <p className="hero-description">Documents, subscriptions, records and little life details—gathered in one thoughtful, private space.</p>
                <div className="hero-actions">
                  <ShimmerButton onClick={onGetStarted} className="hero-primary">Create your free vault <ArrowRight size={17} /></ShimmerButton>
                  <button className="hero-secondary" onClick={onDemo}>Explore the demo <span><ArrowUpRight size={15} /></span></button>
                </div>
                <div className="hero-note"><span className="hero-note-icon"><Check size={12} /></span>Start with what matters. Add the rest as you go.</div>
              </BlurFade>
            </div>

            <BlurFade delay={150} className="hero-visual-wrap">
              <div className="hero-visual-glow" />
              <div className="hero-orbit-label orbit-label-top"><span className="orbit-dot mint-dot" /><span>PERSONAL, NOT PUBLIC</span></div>
              <div className="hero-visual">
                <div className="visual-topbar">
                  <div className="visual-brand"><span className="brand-mark tiny"><ShieldCheck size={13} /></span><span>persora</span></div>
                  <div className="visual-user"><span className="visual-user-initials">AR</span><span className="visual-user-name">Amina's vault</span><ChevronRight size={12} /></div>
                </div>
                <div className="visual-content">
                  <div className="visual-greeting"><div><span className="visual-overline">TUESDAY, OCTOBER 6</span><h3>Your life,<br />looking in order.</h3></div><div className="visual-greeting-mark"><Fingerprint size={26} /></div></div>
                  <div className="visual-metrics">
                    <div className="visual-metric"><span className="metric-icon metric-doc"><FileCheck2 size={15} /></span><b>12</b><small>documents</small></div>
                    <div className="visual-metric"><span className="metric-icon metric-sub"><WalletCards size={15} /></span><b>6</b><small>subscriptions</small></div>
                    <div className="visual-metric"><span className="metric-icon metric-link"><KeyRound size={15} /></span><b>18</b><small>quick links</small></div>
                  </div>
                  <div className="visual-expiry-head"><span>Coming up soon</span><button aria-label="View all"><ArrowUpRight size={13} /></button></div>
                  <div className="visual-expiry-row">
                    <div className="passport-icon"><div className="passport-mark">✦</div></div>
                    <div className="visual-expiry-info"><strong>Bangladesh passport</strong><span>Personal document · Expires Oct 14</span></div>
                    <div className="expiry-badge">8 days</div>
                  </div>
                  <div className="visual-expiry-row second-row">
                    <div className="calendar-icon"><span>OCT</span><b>18</b></div>
                    <div className="visual-expiry-info"><strong>Google One</strong><span>Subscription · ৳ 650 / month</span></div>
                    <div className="expiry-dot"><span /></div>
                  </div>
                  <div className="visual-secure"><span className="secure-lock"><LockKeyhole size={12} /></span><span>Encrypted and private</span><span className="secure-check">✓</span></div>
                </div>
              </div>
              <div className="hero-float-card float-card-left"><div className="float-icon"><FolderHeart size={16} /></div><div><b>All of you, together</b><span>10 connected spaces</span></div></div>
              <div className="hero-float-card float-card-right"><div className="float-shield"><ShieldCheck size={17} /></div><div><b>Your vault is private</b><span>Only you decide what's shared</span></div></div>
              <div className="hero-orbit-label orbit-label-bottom"><span>ONE QUIETLY ORGANIZED LIFE</span><ArrowDown size={12} /></div>
            </BlurFade>
          </div>
          <div className="hero-bottom-note"><div className="note-line" /><span>LESS SEARCHING. MORE LIVING.</span><div className="note-line" /></div>
        </section>

        <section className="trust-strip" aria-label="Product principles">
          <span className="trust-intro">A personal space should feel personal.</span>
          {trust.map((item) => <span key={item} className="trust-point"><span className="trust-star">✳</span>{item}</span>)}
        </section>

        <section className="why-section" id="why-persora">
          <div className="why-copy">
            <span className="section-eyebrow">A little more headspace</span>
            <h2>Your life doesn't fit<br />in just one folder.</h2>
            <p>There's the passport you renew, the plan that bills next week, the certificate you only need once a year. Persora brings those pieces together—so your important things are easier to find and your mind has a little more room.</p>
            <button className="text-link" onClick={onDemo}>Take a look around <ArrowRight size={16} /></button>
          </div>
          <div className="why-visual">
            <div className="why-card-stack stack-one"><div className="stack-head"><span className="stack-dot" /><span>Personal details</span><span className="stack-menu">···</span></div><div className="stack-lines"><i /><i /><i /></div><div className="stack-foot"><span className="stack-icon-wrap"><Fingerprint size={17} /></span><span>Quietly protected</span><Check size={15} /></div></div>
            <div className="why-card-stack stack-two"><span className="stack-label">ONE SMALL REMINDER</span><h3>Passport<br />renewal.</h3><div className="stack-reminder"><span className="reminder-dot" />Due in 8 days <ArrowUpRight size={14} /></div></div>
            <div className="why-stamp"><ShieldCheck size={24} /><span>YOUR<br />OWN SPACE</span></div>
            <div className="why-caption">Designed to feel calm.<br /><span>Built to help you feel in control.</span></div>
          </div>
        </section>

        <section className="features-section" id="features">
          <div className="section-heading centered-heading">
            <span className="section-eyebrow">Everything has its place</span>
            <h2>More than storage.<br /><span>A better way to keep track.</span></h2>
            <p>One connected home for the practical, the personal and all the details in between.</p>
          </div>
          <div className="feature-grid">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return <MagicCard key={feature.title} className={`feature-card feature-${feature.color}`} glowColor="rgba(76, 148, 121, 0.11)">
                <div className="feature-card-top"><div className="feature-icon"><Icon size={20} /></div><span className="feature-index">0{index + 1}</span></div>
                <h3>{feature.title}</h3><p>{feature.body}</p><span className="feature-arrow"><ArrowUpRight size={17} /></span>
              </MagicCard>;
            })}
          </div>
          <div className="feature-pill-row">
            <span><Check size={13} /> Family documents</span><span><Check size={13} /> Warranty reminders</span><span><Check size={13} /> Digital memberships</span><span><Check size={13} /> Saved URLs</span>
          </div>
        </section>

        <section className="landing-details-section" id="security">
          <div className="section-heading centered-heading"><span className="section-eyebrow">A few helpful details</span><h2>Simple to use.<br /><span>Clear about what it does.</span></h2><p>Understand your sign-in, privacy, and storage before you create an account.</p></div>
          <div className="landing-details-grid">
            <article><span className="landing-detail-icon"><Fingerprint size={19}/></span><h3>Two ways to sign in</h3><p>Use your email address or the seven-digit Persora ID assigned when you create your account. Your ID is always available in account settings.</p></article>
            <article><span className="landing-detail-icon"><LockKeyhole size={19}/></span><h3>Private by default</h3><p>Your records and attachments are available only in your signed-in vault. The admin console manages accounts and payments, not your document contents.</p></article>
            <article><span className="landing-detail-icon"><HardDrive size={19}/></span><h3>Storage you can understand</h3><p>Plans show the allocated storage and monthly price. If manual payments are enabled, an administrator verifies the transaction before a paid plan starts.</p></article>
          </div>
          <div className="landing-faq" id="faqs"><details><summary>Can I use Persora without paying?</summary><p>Yes. The Free plan is available when it is published for this deployment. Paid plans are optional and appear with their current pricing above.</p></details><details><summary>Does Persora send password reset emails?</summary><p>Email-based password recovery is not currently available. Keep your password safe and contact the site administrator if you need help accessing an account.</p></details><details><summary>Can the admin browse my vault?</summary><p>The administrator console does not provide access to your saved records or file contents. Authorized infrastructure operators may have technical access needed to operate and secure the service; see the Privacy Policy for details.</p></details><details><summary>How do payments and plan upgrades work?</summary><p>If manual billing is enabled, choose a published plan, pay using one of the active methods, then submit the transaction reference. The plan activates after an administrator verifies it.</p></details><details><summary>How large can an uploaded file be?</summary><p>The current maximum is {maxUploadMb} MB per file. You can see the file limit again when you add an attachment in your vault.</p></details></div>
        </section>

        <section className="landing-pricing-section" id="pricing">
          <div className="section-heading centered-heading">
            <span className="section-eyebrow">Space that grows with you</span>
            <h2>Clear storage.<br /><span>Simple monthly pricing.</span></h2>
            <p>Choose a storage amount. The monthly total is calculated from the per-GB rate set by Persora.</p>
          </div>
          {plans.length ? <div className="landing-plan-grid">{plans.map((plan) => {
            const price = new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency || "BDT", maximumFractionDigits: 2 }).format(plan.monthly_price || 0);
            const unavailable = !billingEnabled && plan.monthly_price > 0;
            return <article className={`landing-plan-card ${plan.slug === "free" ? "landing-plan-free" : ""}`} key={plan.id}>
              <div className="landing-plan-top"><span>{plan.name}</span><span className="plan-capacity">{plan.storage_gb} GB</span></div>
              <h3>{price}<small> / month</small></h3>
              <p>{plan.description || `${plan.storage_gb} GB of private storage.`}</p>
              <ul className="landing-plan-benefits"><li><Check size={13}/><span>{plan.storage_gb} GB for the records and files you choose to keep</span></li><li><Check size={13}/><span>Upload files up to {maxUploadMb} MB each</span></li><li><Check size={13}/><span>Use across every Persora vault section</span></li><li><Check size={13}/><span>{plan.monthly_price > 0 ? "Admin-verified activation after payment" : "Free plan with no payment required"}</span></li></ul>
              <div className="landing-plan-rate">{new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency || "BDT", maximumFractionDigits: 4 }).format(plan.price_per_gb_monthly)} per GB / month</div>
              <button className="landing-plan-action" disabled={unavailable} onClick={() => onChoosePlan(plan.id)}>{unavailable ? "Payments opening soon" : plan.monthly_price > 0 ? "Choose this plan" : "Create your free vault"}<ArrowRight size={15} /></button>
            </article>;
          })}</div> : <div className="landing-plans-empty"><LockKeyhole size={17} /><span>Storage plans will appear here once Persora is connected.</span></div>}
          <p className="landing-pricing-note">Manual payments are reviewed by the Persora team. Your files remain private and are never used to verify a payment.</p>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="how-intro"><span className="section-eyebrow">An easier kind of organized</span><h2>Start small.<br />Feel the difference.</h2><p>Persora grows with you. Bring in one important thing today; find a home for more whenever you're ready.</p></div>
          <div className="how-steps">
            <div className="how-step"><span className="step-count">01</span><div><h3>Make it yours</h3><p>Create a private space with your name and the details you want at your fingertips.</p></div><span className="step-icon"><Fingerprint size={20} /></span></div>
            <div className="how-step"><span className="step-count">02</span><div><h3>Bring life together</h3><p>Add documents, people, plans and records in spaces built to make sense of them.</p></div><span className="step-icon"><FolderHeart size={20} /></span></div>
            <div className="how-step"><span className="step-count">03</span><div><h3>Keep your headspace</h3><p>See what matters next, find what you need and get back to the things you love.</p></div><span className="step-icon"><Sparkles size={20} /></span></div>
          </div>
        </section>

        <section className="landing-cta">
          <div className="cta-pattern" />
          <div className="cta-shield"><ShieldCheck size={24} /></div>
          <span className="section-eyebrow">Your space is waiting</span>
          <h2>Make room for<br /><em>what matters.</em></h2>
          <p>Your important things, in a place that feels like yours.</p>
          <div className="cta-actions"><ShimmerButton onClick={onGetStarted}>Create your free vault <ArrowRight size={17} /></ShimmerButton><button onClick={onDemo}>Or explore the demo</button></div>
          <BorderBeam />
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand footer-brand" href="#top"><span className="brand-mark"><ShieldCheck size={19} /></span><span>Persora</span></a>
        <p>A quieter way to keep your life in order.</p>
        <nav className="landing-footer-links" aria-label="Legal and contact"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/contact">Contact</a></nav>
        <div className="landing-footer-meta"><span>© 2026 Persora</span><span>Powered by Dexter Studio</span><span className="footer-security-brand"><ShieldCheck size={13}/> Sherlock Security System</span><button onClick={onSignIn}>Sign in</button><a href="/admin">Admin sign in</a></div>
      </footer>
    </div>
  );
}
