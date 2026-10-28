import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Globe, Laptop, Mail, MapPin, Phone, ShieldCheck, Smartphone,
} from "lucide-react";
import type { SiteContent } from "../types";
import { MagicCard } from "./magic-ui";
import {
  FEATURE_CATEGORIES, FEATURED_TOOLS, ModuleBadgeIcon, PUBLIC_FAQS, PublicFooter, PublicHeader,
  SECURITY_PILLARS, type PublicPage, type PublicPath,
} from "./PublicSiteShared";

interface Props {
  page: PublicPage;
  content: SiteContent;
  signedIn: boolean;
  onHome: () => void;
  onNavigate: (path: PublicPath) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
}

const PATH_BY_PAGE: Record<PublicPage, PublicPath> = {
  features: "/features",
  security: "/security",
  help: "/help",
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  download: "/download",
  contact: "/contact",
};

const HELP_GUIDES = [
  {
    title: "Getting started with your Document Vault",
    body: "Sign in, open Document Vault from the sidebar, and choose Add Document. Select a document category (Passport, National ID, Academic, Insurance, or Custom), enter key dates, and attach a scan or PDF.",
  },
  {
    title: "Working in Persora Table (Spreadsheets & Smart Tables)",
    body: "Create a Blank Spreadsheet (200 × 52 grid with formulas, cell merging, borders, number formatting, and CSV/XLSX import-export) or a Smart Table with typed columns, Board, Calendar, and Gallery views.",
  },
  {
    title: "Editing files privately with PDF Studio & Photo Studio",
    body: "Open PDF Studio to merge, split, rotate, or sign PDF packets, or Photo Studio to crop and prepare ID/passport photos—then save results directly to your Document Vault without downloading to shared computers.",
  },
  {
    title: "Planning with Calendar, Projects, Habits & Loans",
    body: "Keep Tasks, Reminders, and Calendar events distinct and organized. Track multi-step goals on Projects Kanban boards, log daily check-ins in Habit Tracker, and monitor repayments in Loan Tracker.",
  },
  {
    title: "Sharing safely & recovering deleted items",
    body: "Items remain private unless you explicitly grant access under Connections & Shared Vault or publish a Digital Business Card. Accidentally deleted records can be restored from Trash before permanent removal.",
  },
];

export default function PublicInfoPage({
  page,
  content,
  signedIn,
  onHome,
  onNavigate,
  onSignIn,
  onGetStarted,
}: Props) {
  const [openFaq, setOpenFaq] = useState<number>(0);

  const safeWhatsApp = /^https?:\/\//i.test(content.contactWhatsApp)
    ? content.contactWhatsApp
    : content.contactWhatsApp.replace(/\D/g, "")
      ? `https://wa.me/${content.contactWhatsApp.replace(/\D/g, "")}`
      : "";

  const currentPath = PATH_BY_PAGE[page];

  return (
    <div className="ps-site-shell">
      <PublicHeader
        currentPath={currentPath}
        signedIn={signedIn}
        onHome={onHome}
        onNavigate={onNavigate}
        onSignIn={onSignIn}
        onGetStarted={onGetStarted}
      />

      <main className="ps-site-main">
        <div className="ps-container ps-subpage-top">
          <a
            href="/"
            className="ps-back-link"
            onClick={(ev) => {
              ev.preventDefault();
              onHome();
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to Persora Home</span>
          </a>
        </div>

        {/* /features */}
        {page === "features" && (
          <>
            <section className="ps-subhero">
              <div className="ps-container">
                <span className="ps-section-eyebrow">Workspace Capabilities</span>
                <h1>Every module in Persora, organized around real life</h1>
                <p>
                  Explore how Persora brings document organization, planning, spreadsheet analysis, creative utilities, credential safety, and trusted sharing into one consistent interface.
                </p>
              </div>
            </section>

            <section className="ps-section">
              <div className="ps-container">
                <div className="ps-categories-stack">
                  {FEATURE_CATEGORIES.map((category) => (
                    <div key={category.id} className="ps-category-band">
                      <div className="ps-category-meta">
                        <span className="ps-category-badge">{category.name}</span>
                        <h2>{category.tagline}</h2>
                        <p>{category.summary}</p>
                      </div>
                      <div className="ps-category-modules">
                        {category.modules.map((mod) => (
                          <div key={mod.title} className="ps-mini-module-card">
                            <ModuleBadgeIcon iconId={mod.iconId} size="md" />
                            <div>
                              <h3>{mod.title}</h3>
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

            <section className="ps-section ps-section-tinted">
              <div className="ps-container">
                <div className="ps-section-header">
                  <span className="ps-section-eyebrow">Core Modules</span>
                  <h2>Featured tools included in your workspace</h2>
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
              </div>
            </section>
          </>
        )}

        {/* /security */}
        {page === "security" && (
          <>
            <section className="ps-subhero">
              <div className="ps-container">
                <span className="ps-section-eyebrow">Security &amp; Privacy</span>
                <h1>How Persora protects your documents, records, and account</h1>
                <p>
                  Practical, transparent safeguards built into Persora&apos;s authentication, database policies, private file storage, and sharing model.
                </p>
              </div>
            </section>

            <section className="ps-section">
              <div className="ps-container">
                <div className="ps-security-grid-page">
                  {SECURITY_PILLARS.map((pillar) => (
                    <div key={pillar.title} className="ps-security-card">
                      <div className="ps-security-card-icon" aria-hidden="true">
                        <ShieldCheck size={18} />
                      </div>
                      <div>
                        <h2>{pillar.title}</h2>
                        <p>{pillar.description}</p>
                        <small>{pillar.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="ps-info-panel" style={{ marginTop: 32 }}>
                  <h2>What Persora does—and does not—do with your data</h2>
                  <ul className="ps-check-list">
                    <li>
                      <Check size={15} aria-hidden="true" />
                      <span>Your private workspace is never indexed by search engines or visible on public pages.</span>
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" />
                      <span>All network traffic between your browser, Cloudflare Pages Functions, Supabase, and R2 runs over HTTPS/TLS.</span>
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" />
                      <span>Persora does not sell personal records or display third-party advertising inside your workspace.</span>
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" />
                      <span>You can review our full legal commitments anytime in our Privacy Policy and Terms of Service.</span>
                    </li>
                  </ul>
                  <div className="ps-inline-links">
                    <button type="button" className="ps-btn ps-btn-secondary" onClick={() => onNavigate("/privacy")}>
                      Read Privacy Policy
                    </button>
                    <button type="button" className="ps-btn ps-btn-secondary" onClick={() => onNavigate("/terms")}>
                      Read Terms of Service
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* /help */}
        {page === "help" && (
          <>
            <section className="ps-subhero">
              <div className="ps-container">
                <span className="ps-section-eyebrow">Help Center</span>
                <h1>Guides, answers, and support for Persora</h1>
                <p>Learn how to organize documents, format spreadsheets, edit files in-app, and manage account settings.</p>
              </div>
            </section>

            <section className="ps-section">
              <div className="ps-container">
                <div className="ps-guides-grid">
                  {HELP_GUIDES.map((guide) => (
                    <div key={guide.title} className="ps-info-panel">
                      <h2>{guide.title}</h2>
                      <p>{guide.body}</p>
                    </div>
                  ))}
                </div>

                <div className="ps-faq-container" style={{ marginTop: 48 }}>
                  <div className="ps-section-header">
                    <span className="ps-section-eyebrow">Common Questions</span>
                    <h2>Frequently asked questions</h2>
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
                              <p>{item.answer}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="ps-info-panel" style={{ marginTop: 36, textAlign: "center" }}>
                  <h2>Still need assistance?</h2>
                  <p>Reach out to the Persora support team for account, billing, or technical questions.</p>
                  <div style={{ marginTop: 16 }}>
                    <button type="button" className="ps-btn ps-btn-primary" onClick={() => onNavigate("/contact")}>
                      <span>Contact Support</span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* /about */}
        {page === "about" && (
          <>
            <section className="ps-subhero">
              <div className="ps-container">
                <span className="ps-section-eyebrow">About Persora</span>
                <h1>Built for calm, private personal organization</h1>
                <p>
                  Persora was created to replace the patchwork of cloud folders, spreadsheets, reminder apps, and ad-cluttered document utilities with one trustworthy digital home.
                </p>
              </div>
            </section>

            <section className="ps-section">
              <div className="ps-container">
                <div className="ps-guides-grid">
                  <div className="ps-info-panel">
                    <h2>Why Persora exists</h2>
                    <p>
                      Important personal information—identity cards, family medical history, loan schedules, academic records, project plans, and passwords—deserves the same craft and clarity that teams expect from modern software, without sacrificing individual privacy.
                    </p>
                  </div>
                  <div className="ps-info-panel">
                    <h2>One coherent design system</h2>
                    <p>
                      Every tool inside Persora—from Personal Document Vault and Persora Table to PDF Studio, Photo Studio, Calendar, and Habit Tracker—shares the same calm interface, keyboard ergonomics, and light/dark visual clarity.
                    </p>
                  </div>
                  <div className="ps-info-panel">
                    <h2>Ownership &amp; longevity</h2>
                    <p>
                      Your records stay structured, exportable, and strictly isolated to your account. Nothing is shared unless you choose to share it, and you remain in full control of your data lifecycle.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* /download */}
        {page === "download" && (
          <>
            <section className="ps-subhero">
              <div className="ps-container">
                <span className="ps-section-eyebrow">Access Persora Everywhere</span>
                <h1>Use Persora on desktop, tablet, and mobile</h1>
                <p>
                  Persora runs instantaneously in any modern web browser and installs cleanly to your desktop dock or phone home screen with zero app-store friction.
                </p>
              </div>
            </section>

            <section className="ps-section">
              <div className="ps-container">
                <div className="ps-guides-grid">
                  <div className="ps-info-panel">
                    <div className="ps-security-card-icon" style={{ marginBottom: 12 }}>
                      <Laptop size={18} />
                    </div>
                    <h2>Desktop (Windows, macOS &amp; Linux)</h2>
                    <p>
                      Open Persora in Chrome, Edge, Safari, or Firefox. In Chrome, Edge, or Safari (macOS Sonoma+), choose <strong>Install Persora</strong> or <strong>Add to Dock</strong> from your browser&apos;s address bar or File menu for a dedicated window experience.
                    </p>
                  </div>

                  <div className="ps-info-panel">
                    <div className="ps-security-card-icon" style={{ marginBottom: 12 }}>
                      <Smartphone size={18} />
                    </div>
                    <h2>iOS &amp; Android</h2>
                    <p>
                      On iPhone or iPad (Safari), tap <strong>Share → Add to Home Screen</strong>. On Android (Chrome), tap the browser menu and select <strong>Install app</strong> or <strong>Add to Home screen</strong> for full-screen mobile access.
                    </p>
                  </div>

                  <div className="ps-info-panel">
                    <div className="ps-security-card-icon" style={{ marginBottom: 12 }}>
                      <Globe size={18} />
                    </div>
                    <h2>Instant Web Access</h2>
                    <p>
                      On a shared or work computer? Sign in directly in your browser over HTTPS—no local installation required—and sign out cleanly when finished.
                    </p>
                  </div>
                </div>

                <div className="ps-section-foot-cta">
                  <button type="button" className="ps-btn ps-btn-primary ps-btn-lg" onClick={signedIn ? onHome : onGetStarted}>
                    <span>{signedIn ? "Open Your Workspace" : "Launch Persora & Sign Up"}</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* /privacy, /terms, /contact (backed by SiteContent CMS + clean defaults) */}
        {(page === "privacy" || page === "terms" || page === "contact") && (
          <section className="ps-section" style={{ paddingTop: 16 }}>
            <div className="ps-container">
              <div className="public-info-card ps-legal-card">
                <span className="ps-section-eyebrow">
                  {page === "privacy" ? "Privacy Policy" : page === "terms" ? "Terms of Service" : "Support & Contact"}
                </span>
                <h1>
                  {page === "privacy" ? content.privacyTitle : page === "terms" ? content.termsTitle : content.contactTitle}
                </h1>

                {page === "contact" ? (
                  <>
                    <p className="public-info-copy">
                      {content.contactBody || "Reach out to the Persora administrator for account, privacy, or support inquiries."}
                    </p>
                    {content.contactEmail || content.contactPhone || content.contactWhatsApp || content.contactAddress ? (
                      <div className="public-contact-list">
                        {content.contactEmail && (
                          <a href={`mailto:${content.contactEmail}`}>
                            <Mail size={17} />
                            <span>
                              <small>Email</small>
                              <b>{content.contactEmail}</b>
                            </span>
                          </a>
                        )}
                        {content.contactPhone && (
                          <a href={`tel:${content.contactPhone.replace(/[^+\d]/g, "")}`}>
                            <Phone size={17} />
                            <span>
                              <small>Phone</small>
                              <b>{content.contactPhone}</b>
                            </span>
                          </a>
                        )}
                        {safeWhatsApp && (
                          <a href={safeWhatsApp} target="_blank" rel="noreferrer">
                            <Phone size={17} />
                            <span>
                              <small>WhatsApp</small>
                              <b>{content.contactWhatsApp}</b>
                            </span>
                          </a>
                        )}
                        {content.contactAddress && (
                          <div>
                            <MapPin size={17} />
                            <span>
                              <small>Address</small>
                              <b>{content.contactAddress}</b>
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="public-contact-empty">
                        <Mail size={19} />
                        <span>Direct contact channels have not been published yet. Please check back soon.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="public-info-copy legal-copy">
                    {page === "privacy" ? content.privacyBody : content.termsBody}
                  </div>
                )}

                <div className="public-info-footnote">
                  <ShieldCheck size={15} />
                  <span>
                    Questions about your account or personal data? Visit the{" "}
                    <a
                      href="/contact"
                      onClick={(ev) => {
                        ev.preventDefault();
                        onNavigate("/contact");
                      }}
                    >
                      Contact page
                    </a>{" "}
                    or{" "}
                    <a
                      href="/help"
                      onClick={(ev) => {
                        ev.preventDefault();
                        onNavigate("/help");
                      }}
                    >
                      Help Center
                    </a>
                    .
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Shared bottom CTA on informational pages */}
        {!signedIn && (
          <section className="ps-section ps-cta-section">
            <div className="ps-container">
              <div className="ps-final-cta-card">
                <div className="ps-final-cta-copy">
                  <span className="ps-section-eyebrow">Get Started</span>
                  <h2>Ready to organize everything that matters?</h2>
                  <p>Create your Persora account and start in a private, distraction-free workspace.</p>
                </div>
                <div className="ps-final-cta-actions">
                  <button type="button" className="ps-btn ps-btn-primary ps-btn-lg" onClick={onGetStarted}>
                    <span>Create Account</span>
                    <ArrowRight size={16} />
                  </button>
                  <button type="button" className="ps-btn ps-btn-secondary ps-btn-lg" onClick={onSignIn}>
                    <span>Sign In</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <PublicFooter
        signedIn={signedIn}
        onHome={onHome}
        onNavigate={onNavigate}
        onSignIn={onSignIn}
        onGetStarted={onGetStarted}
      />
    </div>
  );
}
