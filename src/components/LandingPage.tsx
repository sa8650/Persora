import { useState } from "react";
import {
  ArrowRight, Check, CheckCircle2, ChevronDown, Lock, Play, Search, ShieldCheck,
} from "lucide-react";
import type { SubscriptionPlan } from "../types";
import { MagicCard } from "./magic-ui";
import { LauncherModuleIcon } from "./launcher/LauncherIcons";
import type { LauncherModuleId } from "../lib/app-launcher";
import {
  FEATURE_CATEGORIES, FEATURED_TOOLS, ModuleBadgeIcon, PUBLIC_FAQS, PublicFooter, PublicHeader,
  SECURITY_PILLARS, type PublicPath,
} from "./PublicSiteShared";

export interface LandingPageProps {
  onSignIn: () => void;
  onGetStarted: () => void;
  onDemo: () => void;
  onNavigatePublic: (path: PublicPath) => void;
  onChoosePlan: (planId: string) => void;
  plans: SubscriptionPlan[];
  billingEnabled: boolean;
  maxUploadMb: number;
}

type PreviewTabId = "overview" | "documents" | "tables" | "studios";

const PREVIEW_SIDEBAR_ITEMS: Array<{ id: PreviewTabId; iconId: LauncherModuleId; label: string; badge?: string }> = [
  { id: "overview", iconId: "dashboard", label: "Overview" },
  { id: "documents", iconId: "documents", label: "Document Vault", badge: "14" },
  { id: "tables", iconId: "tables", label: "Persora Table", badge: "New" },
  { id: "studios", iconId: "pdf-studio", label: "PDF & Photo Studio" },
];

const PREVIEW_SECONDARY_MODULES: Array<{ iconId: LauncherModuleId; label: string }> = [
  { iconId: "calendar", label: "Calendar" },
  { iconId: "projects", label: "Projects" },
  { iconId: "habits", label: "Habits" },
  { iconId: "loans", label: "Loans" },
  { iconId: "password-manager", label: "Passwords" },
];

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${value}`;
  }
}

export default function LandingPage({
  onSignIn,
  onGetStarted,
  onDemo,
  onNavigatePublic,
  onChoosePlan,
  plans,
  billingEnabled,
  maxUploadMb,
}: LandingPageProps) {
  const [previewTab, setPreviewTab] = useState<PreviewTabId>("overview");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [openFaq, setOpenFaq] = useState<number>(0);

  const visibleCategories =
    activeCategory === "all"
      ? FEATURE_CATEGORIES
      : FEATURE_CATEGORIES.filter((cat) => cat.id === activeCategory);

  const scrollToFeatures = () => {
    const el = document.getElementById("persora-features");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else onNavigatePublic("/features");
  };

  return (
    <div className="ps-site-shell">
      <PublicHeader
        currentPath="/"
        onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        onNavigate={onNavigatePublic}
        onSignIn={onSignIn}
        onGetStarted={onGetStarted}
      />

      <main className="ps-site-main">
        {/* 1. HERO SECTION */}
        <section className="ps-hero" aria-labelledby="ps-hero-heading">
          <div className="ps-container ps-hero-grid">
            <div className="ps-hero-copy">
              <div className="ps-pill-eyebrow">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>Private personal workspace</span>
              </div>

              <h1 id="ps-hero-heading" className="ps-hero-title">
                Everything that matters. One place to manage it.
              </h1>

              <p className="ps-hero-subtitle">
                Keep your essential documents, schedules, spreadsheets, PDF &amp; photo tools, projects, habits, finances, and passwords organized inside one calm, account-isolated workspace.
              </p>

              <div className="ps-hero-actions">
                <button type="button" className="ps-btn ps-btn-primary ps-btn-lg" onClick={onGetStarted}>
                  <span>Get Started</span>
                  <ArrowRight size={16} />
                </button>
                <button type="button" className="ps-btn ps-btn-secondary ps-btn-lg" onClick={scrollToFeatures}>
                  <span>Explore Features</span>
                </button>
                <button type="button" className="ps-btn ps-btn-ghost ps-demo-trigger" onClick={onDemo}>
                  <Play size={14} aria-hidden="true" />
                  <span>Interactive Demo</span>
                </button>
              </div>

              <ul className="ps-hero-trust-list" aria-label="Core workspace guarantees">
                <li>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>Private by default</span>
                </li>
                <li>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>20+ integrated modules</span>
                </li>
                <li>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>Desktop &amp; mobile ready</span>
                </li>
              </ul>
            </div>

            {/* Realistic Interactive Preview of Persora Workspace */}
            <div className="ps-hero-preview" aria-label="Interactive preview of the Persora workspace">
              <div className="ps-workspace-frame">
                <div className="ps-wf-topbar">
                  <div className="ps-wf-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="ps-wf-search" aria-hidden="true">
                    <Search size={13} />
                    <span>Search documents, tables, events, passwords…</span>
                  </div>
                  <span className="ps-wf-lock">
                    <Lock size={12} aria-hidden="true" /> Vault Locked to Owner
                  </span>
                </div>

                <div className="ps-wf-body">
                  <aside className="ps-wf-sidebar" aria-label="Preview workspace modules">
                    <div className="ps-wf-nav-label">Workspace</div>
                    {PREVIEW_SIDEBAR_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`ps-wf-nav-btn ${previewTab === item.id ? "is-active" : ""}`}
                        onClick={() => setPreviewTab(item.id)}
                      >
                        <span className="ps-wf-nav-icon" aria-hidden="true">
                          <LauncherModuleIcon id={item.iconId} />
                        </span>
                        <span className="ps-wf-nav-text">{item.label}</span>
                        {item.badge && <span className="ps-wf-nav-badge">{item.badge}</span>}
                      </button>
                    ))}

                    <div className="ps-wf-nav-label">Daily Tools</div>
                    {PREVIEW_SECONDARY_MODULES.map((mod) => (
                      <div key={mod.iconId} className="ps-wf-nav-static" aria-hidden="true">
                        <span className="ps-wf-nav-icon">
                          <LauncherModuleIcon id={mod.iconId} />
                        </span>
                        <span className="ps-wf-nav-text">{mod.label}</span>
                      </div>
                    ))}
                  </aside>

                  <div className="ps-wf-canvas">
                    {previewTab === "overview" && (
                      <div className="ps-wf-panel">
                        <div className="ps-wf-panel-head">
                          <div>
                            <span className="ps-wf-kicker">Customizable Overview</span>
                            <h2>Good morning — your week at a glance</h2>
                          </div>
                          <span className="ps-wf-chip">Sample preview</span>
                        </div>
                        <div className="ps-wf-widget-grid">
                          <div className="ps-wf-widget">
                            <div className="ps-wf-widget-title">
                              <ModuleBadgeIcon iconId="documents" size="sm" />
                              <span>Upcoming Renewals</span>
                            </div>
                            <ul className="ps-wf-mini-list">
                              <li>
                                <strong>Passport Renewal</strong>
                                <span className="is-warn">Due in 42 days</span>
                              </li>
                              <li>
                                <strong>Vehicle Insurance</strong>
                                <span className="is-ok">Valid · Nov 2027</span>
                              </li>
                            </ul>
                          </div>

                          <div className="ps-wf-widget">
                            <div className="ps-wf-widget-title">
                              <ModuleBadgeIcon iconId="calendar" size="sm" />
                              <span>Today&apos;s Schedule</span>
                            </div>
                            <ul className="ps-wf-mini-list">
                              <li>
                                <strong>10:30 · Bank verification</strong>
                                <span>Checklist ready</span>
                              </li>
                              <li>
                                <strong>17:00 · Project review</strong>
                                <span>3 tasks complete</span>
                              </li>
                            </ul>
                          </div>

                          <div className="ps-wf-widget">
                            <div className="ps-wf-widget-title">
                              <ModuleBadgeIcon iconId="habits" size="sm" />
                              <span>Habits &amp; Loans</span>
                            </div>
                            <div className="ps-wf-metrics">
                              <div>
                                <b>12d</b>
                                <small>Reading streak</small>
                              </div>
                              <div>
                                <b>On track</b>
                                <small>Next EMI · 5th</small>
                              </div>
                            </div>
                          </div>

                          <div className="ps-wf-widget">
                            <div className="ps-wf-widget-title">
                              <ModuleBadgeIcon iconId="password-manager" size="sm" />
                              <span>Quick Studios &amp; Vault</span>
                            </div>
                            <div className="ps-wf-pill-row">
                              <span>Merge PDF</span>
                              <span>ID Photo 2×2</span>
                              <span>24 Logins Encrypted</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {previewTab === "documents" && (
                      <div className="ps-wf-panel">
                        <div className="ps-wf-panel-head">
                          <div>
                            <span className="ps-wf-kicker">Personal Document Vault</span>
                            <h2>Identity, Academic &amp; Policy Records</h2>
                          </div>
                          <span className="ps-wf-chip">Private R2 Storage</span>
                        </div>
                        <div className="ps-wf-doc-rows">
                          {[
                            { name: "International Passport", type: "Identity", meta: "Expires Dec 2029 · PDF attached", status: "Verified" },
                            { name: "National ID Smart Card", type: "Identity", meta: "Front & back scan · Protected", status: "Active" },
                            { name: "University Transcript & Degree", type: "Academic", meta: "Signed PDF packet · 2.4 MB", status: "Archived" },
                            { name: "Home & Health Policy", type: "Insurance", meta: "Annual renewal reminder active", status: "Tracked" },
                          ].map((docRow) => (
                            <div key={docRow.name} className="ps-wf-doc-row">
                              <ModuleBadgeIcon iconId="documents" size="sm" />
                              <div className="ps-wf-doc-info">
                                <strong>{docRow.name}</strong>
                                <small>{docRow.meta}</small>
                              </div>
                              <span className="ps-wf-tag">{docRow.type}</span>
                              <span className="ps-wf-status">{docRow.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewTab === "tables" && (
                      <div className="ps-wf-panel">
                        <div className="ps-wf-panel-head">
                          <div>
                            <span className="ps-wf-kicker">Persora Table · 200 × 52 Grid</span>
                            <h2>Household Budget &amp; Savings Sheet</h2>
                          </div>
                          <span className="ps-wf-chip">fx =SUM(C2:C4)</span>
                        </div>
                        <div className="ps-wf-mini-sheet" role="presentation">
                          <div className="ps-wf-sheet-row is-head">
                            <span>#</span>
                            <span>A</span>
                            <span>B</span>
                            <span>C</span>
                            <span>D</span>
                          </div>
                          <div className="ps-wf-sheet-row is-bold">
                            <span>1</span>
                            <span>Category</span>
                            <span>Planned</span>
                            <span>Actual</span>
                            <span>Status</span>
                          </div>
                          <div className="ps-wf-sheet-row">
                            <span>2</span>
                            <span>Housing &amp; Utilities</span>
                            <span className="is-num">$1,450</span>
                            <span className="is-num">$1,420</span>
                            <span className="is-good">Under</span>
                          </div>
                          <div className="ps-wf-sheet-row">
                            <span>3</span>
                            <span>Emergency Reserve</span>
                            <span className="is-num">$600</span>
                            <span className="is-num">$600</span>
                            <span className="is-good">Funded</span>
                          </div>
                          <div className="ps-wf-sheet-row is-selected">
                            <span>4</span>
                            <span>Total Monthly</span>
                            <span className="is-num">$2,050</span>
                            <span className="is-num is-active-cell">$2,020</span>
                            <span>=C2+C3</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {previewTab === "studios" && (
                      <div className="ps-wf-panel">
                        <div className="ps-wf-panel-head">
                          <div>
                            <span className="ps-wf-kicker">Built-in Document Utilities</span>
                            <h2>PDF Studio &amp; Photo Studio</h2>
                          </div>
                          <span className="ps-wf-chip">Zero third-party uploads</span>
                        </div>
                        <div className="ps-wf-studio-cards">
                          <div className="ps-wf-studio-card">
                            <ModuleBadgeIcon iconId="pdf-studio" size="md" />
                            <h3>PDF Studio</h3>
                            <p>Merge multi-page scans, split specific pages, place your signature, and save directly into Document Vault.</p>
                          </div>
                          <div className="ps-wf-studio-card">
                            <ModuleBadgeIcon iconId="photo-studio" size="md" />
                            <h3>Photo Studio</h3>
                            <p>Crop passport and visa photos to exact dimensions, fine-tune exposure, and export clean JPEG/PNG files.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. FEATURE CATEGORIES (Organize, Plan, Create & Edit, Protect, Connect) */}
        <section id="persora-features" className="ps-section" aria-labelledby="ps-categories-heading">
          <div className="ps-container">
            <div className="ps-section-header">
              <span className="ps-section-eyebrow">Feature Categories</span>
              <h2 id="ps-categories-heading">Five clear pillars for everyday digital life</h2>
              <p>
                Every module in Persora belongs to a deliberate workflow—so you always know where a document, task, spreadsheet, or credential lives.
              </p>
            </div>

            <div className="ps-category-filter" role="tablist" aria-label="Filter feature categories">
              <button
                type="button"
                role="tab"
                aria-selected={activeCategory === "all"}
                className={`ps-filter-chip ${activeCategory === "all" ? "is-active" : ""}`}
                onClick={() => setActiveCategory("all")}
              >
                All Categories
              </button>
              {FEATURE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === cat.id}
                  className={`ps-filter-chip ${activeCategory === cat.id ? "is-active" : ""}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="ps-categories-stack">
              {visibleCategories.map((category) => (
                <div key={category.id} className="ps-category-band">
                  <div className="ps-category-meta">
                    <span className="ps-category-badge">{category.name}</span>
                    <h3>{category.tagline}</h3>
                    <p>{category.summary}</p>
                  </div>
                  <div className="ps-category-modules">
                    {category.modules.map((mod) => (
                      <div key={mod.title} className="ps-mini-module-card">
                        <ModuleBadgeIcon iconId={mod.iconId} size="md" />
                        <div>
                          <h4>{mod.title}</h4>
                          <p>{mod.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. FEATURED TOOLS SPOTLIGHT (8 core tools) */}
        <section className="ps-section ps-section-tinted" aria-labelledby="ps-featured-tools-heading">
          <div className="ps-container">
            <div className="ps-section-header">
              <span className="ps-section-eyebrow">Featured Tools</span>
              <h2 id="ps-featured-tools-heading">Purpose-built tools ready the moment you sign in</h2>
              <p>
                Instead of stitching together eight separate subscriptions and converter websites, work with consistent tools built on one design system.
              </p>
            </div>

            <div className="ps-tools-grid">
              {FEATURED_TOOLS.map((tool) => (
                <MagicCard key={tool.id} className="ps-tool-card">
                  <div className="ps-tool-card-inner">
                    <div className="ps-tool-card-top">
                      <ModuleBadgeIcon iconId={tool.iconId} size="lg" />
                      <span className="ps-tool-cat-tag">{tool.category}</span>
                    </div>
                    <h3>{tool.title}</h3>
                    <p>{tool.description}</p>
                    <ul className="ps-tool-highlights">
                      {tool.highlights.map((pt) => (
                        <li key={pt}>
                          <Check size={13} aria-hidden="true" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </MagicCard>
              ))}
            </div>

            <div className="ps-section-foot-cta">
              <button type="button" className="ps-btn ps-btn-secondary" onClick={() => onNavigatePublic("/features")}>
                <span>See all workspace capabilities</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>

        {/* 4. PRODUCT PREVIEW — HOW PERSORA CONNECTS DOCUMENTS, TASKS & TOOLS */}
        <section className="ps-section" aria-labelledby="ps-workflow-heading">
          <div className="ps-container">
            <div className="ps-section-header">
              <span className="ps-section-eyebrow">Connected Workflow</span>
              <h2 id="ps-workflow-heading">Personal documents, everyday tasks, and digital tools—working together</h2>
              <p>
                Life tasks rarely stay inside a single app. Persora connects the files you store with the tools you need to act on them.
              </p>
            </div>

            <div className="ps-workflow-showcase">
              <div className="ps-workflow-step">
                <div className="ps-workflow-step-head">
                  <span className="ps-step-num">01</span>
                  <ModuleBadgeIcon iconId="documents" size="md" />
                </div>
                <h3>Store &amp; track critical records</h3>
                <p>
                  Save passports, academic certificates, contracts, medical files, and receipts in your Personal Document Vault with structured fields and expiry dates.
                </p>
                <div className="ps-workflow-artifact">
                  <span>Passport · Expires in 60 days</span>
                  <span className="is-badge">Auto-reminded</span>
                </div>
              </div>

              <div className="ps-workflow-step">
                <div className="ps-workflow-step-head">
                  <span className="ps-step-num">02</span>
                  <ModuleBadgeIcon iconId="pdf-studio" size="md" />
                </div>
                <h3>Prepare files &amp; numbers in-place</h3>
                <p>
                  Resize ID photos in Photo Studio, merge and sign supporting packets in PDF Studio, and calculate budgets or checklists in Persora Table—without external uploads.
                </p>
                <div className="ps-workflow-artifact">
                  <span>Application_Packet_Signed.pdf</span>
                  <span className="is-badge">Saved to Vault</span>
                </div>
              </div>

              <div className="ps-workflow-step">
                <div className="ps-workflow-step-head">
                  <span className="ps-step-num">03</span>
                  <ModuleBadgeIcon iconId="projects" size="md" />
                </div>
                <h3>Plan deadlines &amp; daily follow-through</h3>
                <p>
                  Schedule appointments on Calendar, track multi-step tasks in Projects, keep loan installments and habits on schedule, and store portal logins in Password Manager.
                </p>
                <div className="ps-workflow-artifact">
                  <span>Renewal Project · 4 of 4 done</span>
                  <span className="is-badge is-done">Complete</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. SECURITY & PRIVACY SECTION */}
        <section className="ps-section ps-section-tinted" aria-labelledby="ps-security-heading">
          <div className="ps-container">
            <div className="ps-security-layout">
              <div className="ps-security-intro">
                <span className="ps-section-eyebrow">Security &amp; Privacy</span>
                <h2 id="ps-security-heading">Clear, verifiable protection for personal records</h2>
                <p>
                  Persora is engineered around strict account isolation, private cloud object storage, and encrypted credential management—explained in plain language without exaggerated claims.
                </p>
                <div className="ps-security-actions">
                  <button type="button" className="ps-btn ps-btn-secondary" onClick={() => onNavigatePublic("/security")}>
                    <span>Read Security &amp; Privacy Overview</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>

              <div className="ps-security-cards">
                {SECURITY_PILLARS.map((pillar) => (
                  <div key={pillar.title} className="ps-security-card">
                    <div className="ps-security-card-icon" aria-hidden="true">
                      <ShieldCheck size={18} />
                    </div>
                    <div>
                      <h3>{pillar.title}</h3>
                      <p>{pillar.description}</p>
                      <small>{pillar.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* OPTIONAL CONFIGURED PLANS SECTION */}
        {billingEnabled && plans.length > 0 && (
          <section className="ps-section" aria-labelledby="ps-plans-heading">
            <div className="ps-container">
              <div className="ps-section-header">
                <span className="ps-section-eyebrow">Storage Plans</span>
                <h2 id="ps-plans-heading">Simple plans that grow with your vault</h2>
                <p>Start organizing records right away and upgrade storage capacity when you need larger file uploads (up to {maxUploadMb} MB per file).</p>
              </div>
              <div className="ps-plans-grid">
                {plans.map((plan) => (
                  <div key={plan.id} className="ps-plan-card">
                    <div className="ps-plan-head">
                      <h3>{plan.name}</h3>
                      {plan.description && <p>{plan.description}</p>}
                    </div>
                    <div className="ps-plan-price">
                      <strong>{formatMoney(plan.monthly_price, plan.currency)}</strong>
                      <span>/ month</span>
                    </div>
                    <ul className="ps-plan-features">
                      <li>
                        <Check size={14} aria-hidden="true" />
                        <span>{plan.storage_gb} GB private vault storage</span>
                      </li>
                      <li>
                        <Check size={14} aria-hidden="true" />
                        <span>All Persora workspace modules included</span>
                      </li>
                    </ul>
                    <button type="button" className="ps-btn ps-btn-primary" onClick={() => onChoosePlan(plan.id)}>
                      Choose {plan.name}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 6. FAQ SECTION */}
        <section className="ps-section" aria-labelledby="ps-faq-heading">
          <div className="ps-container ps-faq-container">
            <div className="ps-section-header">
              <span className="ps-section-eyebrow">Frequently Asked Questions</span>
              <h2 id="ps-faq-heading">Answers to common questions</h2>
            </div>

            <div className="ps-faq-list">
              {PUBLIC_FAQS.map((item, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={item.question} className={`ps-faq-item ${isOpen ? "is-open" : ""}`}>
                    <h3>
                      <button
                        type="button"
                        className="ps-faq-trigger"
                        aria-expanded={isOpen}
                        onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                      >
                        <span>{item.question}</span>
                        <ChevronDown size={17} aria-hidden="true" />
                      </button>
                    </h3>
                    {isOpen && (
                      <div className="ps-faq-answer">
                        <p>{item.answer.replace("{maxUploadMb}", String(maxUploadMb))}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 7. FINAL CTA */}
        <section className="ps-section ps-cta-section" aria-labelledby="ps-final-cta-heading">
          <div className="ps-container">
            <div className="ps-final-cta-card">
              <div className="ps-final-cta-copy">
                <span className="ps-section-eyebrow">Ready when you are</span>
                <h2 id="ps-final-cta-heading">Bring calm order to your documents, plans, and daily tools.</h2>
                <p>
                  Create your private Persora account in under a minute and keep everything that matters in one place.
                </p>
              </div>
              <div className="ps-final-cta-actions">
                <button type="button" className="ps-btn ps-btn-primary ps-btn-lg" onClick={onGetStarted}>
                  <span>Get Started Free</span>
                  <ArrowRight size={16} />
                </button>
                <button type="button" className="ps-btn ps-btn-secondary ps-btn-lg" onClick={onSignIn}>
                  <span>Sign In</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter
        onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        onNavigate={onNavigatePublic}
        onSignIn={onSignIn}
        onGetStarted={onGetStarted}
      />
    </div>
  );
}
