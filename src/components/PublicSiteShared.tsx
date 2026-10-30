import { useState } from "react";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { LauncherModuleIcon } from "./launcher/LauncherIcons";
import { PersoraMark } from "./PersoraLogo";
import type { LauncherModuleId } from "../lib/app-launcher";
import { usePersoraTheme } from "../design-system";

export function PersoraBrandMark({ size = 26 }: { size?: number }) {
  return <PersoraMark size={size} />;
}

export type PublicPage =
  | "features"
  | "security"
  | "help"
  | "about"
  | "privacy"
  | "terms"
  | "download"
  | "contact";

export type PublicPath =
  | "/features"
  | "/security"
  | "/help"
  | "/about"
  | "/privacy"
  | "/terms"
  | "/download"
  | "/contact";

export interface FeatureCategoryGroup {
  id: "organize" | "plan" | "create" | "protect" | "connect";
  name: "Organize" | "Plan" | "Create & Edit" | "Protect" | "Connect";
  tagline: string;
  summary: string;
  modules: Array<{
    iconId: LauncherModuleId;
    title: string;
    detail: string;
  }>;
}

export const FEATURE_CATEGORIES: FeatureCategoryGroup[] = [
  {
    id: "organize",
    name: "Organize",
    tagline: "Structured records for life administration",
    summary: "Keep personal documents, spreadsheets, contacts, notes, and health files organized in one calm, searchable workspace.",
    modules: [
      {
        iconId: "documents",
        title: "Personal Document Vault",
        detail: "Store passports, IDs, certificates, policies, and warranties with expiry tracking and quick search.",
      },
      {
        iconId: "tables",
        title: "Persora Table",
        detail: "Work in full spreadsheets (formulas, merges, borders, multi-sheet) or structured Smart Tables.",
      },
      {
        iconId: "notes",
        title: "Notes & References",
        detail: "Capture structured notes, checklists, and reference material right alongside your files.",
      },
      {
        iconId: "medical-records",
        title: "Medical Records",
        detail: "Organize prescriptions, lab reports, and visit history by family member when needed.",
      },
    ],
  },
  {
    id: "plan",
    name: "Plan",
    tagline: "Daily schedules, goals, and financial clarity",
    summary: "Turn upcoming deadlines, habits, projects, and personal commitments into a clear plan you can rely on.",
    modules: [
      {
        iconId: "calendar",
        title: "Calendar & Reminders",
        detail: "Manage multi-day events, document renewal dates, and dedicated reminders in one private schedule.",
      },
      {
        iconId: "projects",
        title: "Projects",
        detail: "Track personal and collaborative initiatives across Kanban boards, milestones, and checklists.",
      },
      {
        iconId: "habits",
        title: "Habit Tracker",
        detail: "Build consistent daily routines with streak history, flexible targets, and quiet progress insights.",
      },
      {
        iconId: "loans",
        title: "Loan & Subscription Tracking",
        detail: "Stay ahead of installments, balances, and recurring subscriptions without spreadsheet guesswork.",
      },
    ],
  },
  {
    id: "create",
    name: "Create & Edit",
    tagline: "Built-in document and image utilities",
    summary: "Prepare forms, PDFs, ID photos, and spreadsheets directly inside Persora instead of uploading private files to ad-heavy converter sites.",
    modules: [
      {
        iconId: "pdf-studio",
        title: "PDF Studio",
        detail: "Merge, split, reorder, sign, watermark, and export clean PDFs without leaving your workspace.",
      },
      {
        iconId: "photo-studio",
        title: "Photo Studio",
        detail: "Crop, resize, adjust lighting, and prepare passport or visa photo dimensions in seconds.",
      },
      {
        iconId: "tables",
        title: "Spreadsheets & Templates",
        detail: "Format cells, calculate budgets with live formulas, merge headers, and import/export CSV or XLSX.",
      },
      {
        iconId: "business-card",
        title: "Digital Business Card",
        detail: "Design a polished, QR-ready contact card you can update anytime and toggle on or off.",
      },
    ],
  },
  {
    id: "protect",
    name: "Protect",
    tagline: "Owner-scoped storage and credential safety",
    summary: "Protect sensitive records with authenticated account isolation, private object storage, vault-encrypted passwords, and safe recovery.",
    modules: [
      {
        iconId: "password-manager",
        title: "Password Manager",
        detail: "Store logins, generate strong passwords, and keep credentials encrypted with vault protection.",
      },
      {
        iconId: "documents",
        title: "Private Cloud Storage",
        detail: "Files live in private Cloudflare R2 storage served only through authenticated owner-checked routes.",
      },
      {
        iconId: "wallet-cards",
        title: "Masked Cards & Recovery",
        detail: "Keep masked card references safe and recover accidentally deleted records from Trash before permanent removal.",
      },
      {
        iconId: "accounts",
        title: "Account Records & Export",
        detail: "Organize critical account details, export your workspace archive anytime, or remove stored data permanently.",
      },
    ],
  },
  {
    id: "connect",
    name: "Connect",
    tagline: "Deliberate, revocable sharing with people you trust",
    summary: "Keep everything private by default, and share specific documents, records, or contact cards only when you choose.",
    modules: [
      {
        iconId: "connections",
        title: "Connections & Shared Vault",
        detail: "Share selected items with trusted Persora members with view/comment permissions and instant revocation.",
      },
      {
        iconId: "contacts",
        title: "Contacts Directory",
        detail: "Maintain a clean personal address book with vCard/CSV import, duplicate merging, and notes.",
      },
      {
        iconId: "business-card",
        title: "Shareable Contact Card",
        detail: "Share a clean QR or link for professional introductions without exposing your private workspace.",
      },
      {
        iconId: "timeline",
        title: "Life Timeline",
        detail: "Keep a chronological record of milestones, moves, renewals, and important life events.",
      },
    ],
  },
];

export interface FeaturedToolItem {
  id: string;
  iconId: LauncherModuleId;
  title: string;
  category: FeatureCategoryGroup["name"];
  description: string;
  highlights: string[];
}

export const FEATURED_TOOLS: FeaturedToolItem[] = [
  {
    id: "document-vault",
    iconId: "documents",
    title: "Personal Document Vault",
    category: "Organize",
    description: "Store identity cards, passports, academic records, contracts, and receipts with structured metadata and renewal dates.",
    highlights: ["Owner-scoped R2 file storage", "Smart metadata & expiry tracking", "Instant preview & download"],
  },
  {
    id: "pdf-studio",
    iconId: "pdf-studio",
    title: "PDF Studio",
    category: "Create & Edit",
    description: "Combine pages, split packets, add signatures, rotate scans, and save finished PDFs straight back to your vault.",
    highlights: ["Merge, split & reorder pages", "Sign & annotate documents", "Direct save to Document Vault"],
  },
  {
    id: "photo-studio",
    iconId: "photo-studio",
    title: "Photo Studio",
    category: "Create & Edit",
    description: "Prepare crisp ID photos, crop scans, fine-tune brightness and contrast, and export clean image formats.",
    highlights: ["Passport & ID size presets", "Crop, rotate & tone controls", "Private browser-first editing"],
  },
  {
    id: "calendar",
    iconId: "calendar",
    title: "Calendar",
    category: "Plan",
    description: "See events, multi-day plans, document renewals, and scheduled reminders in month, week, and agenda views.",
    highlights: ["Multi-day event planning", "Renewal & schedule alerts", "Separate Tasks & Reminders"],
  },
  {
    id: "habit-tracker",
    iconId: "habits",
    title: "Habit Tracker",
    category: "Plan",
    description: "Track daily and weekly habits with clean check-ins, streak continuity, and distraction-free consistency metrics.",
    highlights: ["Daily & weekly check-ins", "Streak & completion history", "Dashboard widget integration"],
  },
  {
    id: "loan-tracker",
    iconId: "loans",
    title: "Loan Tracker",
    category: "Plan",
    description: "Record personal loans, EMI schedules, repayments, and remaining balances with clear payment histories.",
    highlights: ["Borrowed & lent ledger", "Repayment history & balances", "Due-date notifications"],
  },
  {
    id: "projects",
    iconId: "projects",
    title: "Projects",
    category: "Plan",
    description: "Organize multi-step personal goals or shared initiatives with Kanban stages, due dates, assignees, and checklists.",
    highlights: ["Kanban board & task cards", "Progress & deadline tracking", "Optional member collaboration"],
  },
  {
    id: "password-manager",
    iconId: "password-manager",
    title: "Password Manager",
    category: "Protect",
    description: "Keep account credentials, recovery notes, and generated strong passwords protected inside your authenticated vault.",
    highlights: ["Encrypted credential storage", "Built-in password generator", "One-click copy & search"],
  },
];

export interface SecurityPillar {
  title: string;
  description: string;
  detail: string;
}

export const SECURITY_PILLARS: SecurityPillar[] = [
  {
    title: "Strict account & row-level isolation",
    description: "Every workspace item, table, calendar event, and record is scoped to your authenticated user ID.",
    detail: "Database row-level security policies and server-side JWT verification ensure another account cannot query or mutate your private records.",
  },
  {
    title: "Private object storage for files",
    description: "Uploaded documents, medical attachments, and table files are stored in private Cloudflare R2 buckets.",
    detail: "Files are never placed in public directory listings; downloads and previews verify ownership or an active share grant on the server.",
  },
  {
    title: "Vault-encrypted Password Manager",
    description: "Saved passwords and secret notes are encrypted before storage and unlocked only for your authenticated session.",
    detail: "Sensitive fields stay masked by default in the UI so screen sharing or shoulder surfing does not expose credentials.",
  },
  {
    title: "Explicit, revocable sharing",
    description: "Everything in Persora starts private to you. Nothing is searchable or visible publicly unless you explicitly share it.",
    detail: "Shared vault items and digital business cards can be updated, restricted, or revoked immediately whenever your needs change.",
  },
  {
    title: "Portable data & safe deletion",
    description: "Your data stays yours—export your records cleanly or remove them permanently whenever you choose.",
    detail: "Deleted items move to Trash first to prevent accidental loss, and full account deletion cascades across your workspace data.",
  },
];

export interface FaqEntry {
  question: string;
  answer: string;
}

export const PUBLIC_FAQS: FaqEntry[] = [
  {
    question: "What makes Persora different from using separate notes, drive, and utility apps?",
    answer:
      "Most people scatter sensitive documents across cloud drives, random PDF/photo converter websites, spreadsheets, and reminder apps. Persora brings your Personal Document Vault, PDF & Photo Studios, Persora Table, Calendar, Projects, Habit & Loan Trackers, and Password Manager into one cohesive, private workspace.",
  },
  {
    question: "Can anyone else see my documents, tables, or personal records?",
    answer:
      "No. Everything you create or upload in Persora is private to your account by default and enforced by server-verified sessions and database row-level isolation. Other people can only view specific items if you explicitly share a record or publish a Digital Business Card.",
  },
  {
    question: "How does Persora protect uploaded files and saved passwords?",
    answer:
      "Uploaded files are stored in private Cloudflare R2 object storage behind authenticated API checks rather than open public URLs, and connections run over HTTPS/TLS. Password Manager entries use dedicated vault encryption so credentials are never stored in plain text.",
  },
  {
    question: "Why are PDF Studio and Photo Studio built into a personal workspace?",
    answer:
      "Personal documents frequently need resizing, merging, signing, or cropping before an application or renewal. Having PDF Studio and Photo Studio built directly into Persora means you never have to upload passports, IDs, or financial statements to third-party ad-supported tools.",
  },
  {
    question: "Can I import or export my spreadsheets and workspace data?",
    answer:
      "Yes. Persora Table supports CSV and Excel (.xlsx) import and export—preserving formulas, sheets, formatting, and typed Smart Table columns—and Settings lets you export your workspace data whenever you want.",
  },
  {
    question: "Does Persora work across desktop and mobile devices?",
    answer:
      "Yes. Persora runs in any modern desktop or mobile browser and can be installed to your home screen or desktop as a Progressive Web App (PWA) for fast, app-like access.",
  },
];

export function PublicHeader({
  currentPath,
  signedIn = false,
  onHome,
  onNavigate,
  onSignIn,
  onGetStarted,
}: {
  currentPath: "/" | PublicPath;
  signedIn?: boolean;
  onHome: () => void;
  onNavigate: (path: PublicPath) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
}) {
  const { resolvedTheme, toggleTheme } = usePersoraTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navClick = (path: PublicPath, event: React.MouseEvent) => {
    event.preventDefault();
    setMobileOpen(false);
    onNavigate(path);
  };

  const homeClick = (event: React.MouseEvent) => {
    event.preventDefault();
    setMobileOpen(false);
    onHome();
  };

  return (
    <header className="ps-site-header">
      <div className="ps-site-header-inner">
        <a href="/" className="ps-brand" onClick={homeClick} aria-label="Persora home">
          <span className="ps-brand-mark" aria-hidden="true">
            <PersoraBrandMark size={26} />
          </span>
          <span className="ps-brand-name">Persora</span>
        </a>

        <nav className="ps-nav-desktop" aria-label="Primary">
          <a
            href="/features"
            className={`ps-nav-link ${currentPath === "/features" ? "is-active" : ""}`}
            aria-current={currentPath === "/features" ? "page" : undefined}
            onClick={(ev) => navClick("/features", ev)}
          >
            Features
          </a>
          <a
            href="/security"
            className={`ps-nav-link ${currentPath === "/security" ? "is-active" : ""}`}
            aria-current={currentPath === "/security" ? "page" : undefined}
            onClick={(ev) => navClick("/security", ev)}
          >
            Security &amp; Privacy
          </a>
          <a
            href="/help"
            className={`ps-nav-link ${currentPath === "/help" ? "is-active" : ""}`}
            aria-current={currentPath === "/help" ? "page" : undefined}
            onClick={(ev) => navClick("/help", ev)}
          >
            Help
          </a>
        </nav>

        <div className="ps-header-actions">
          <button
            type="button"
            className="ps-theme-btn"
            onClick={toggleTheme}
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          >
            {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {signedIn ? (
            <button type="button" className="ps-btn ps-btn-primary ps-header-cta" onClick={onHome}>
              <span>Open Workspace</span>
              <ArrowRight size={15} />
            </button>
          ) : (
            <>
              <button type="button" className="ps-btn ps-btn-ghost ps-signin-btn" onClick={onSignIn}>
                Sign In
              </button>
              <button type="button" className="ps-btn ps-btn-primary ps-header-cta" onClick={onGetStarted}>
                <span>Get Started</span>
                <ArrowRight size={15} />
              </button>
            </>
          )}

          <button
            type="button"
            className="ps-mobile-toggle"
            aria-expanded={mobileOpen}
            aria-controls="ps-mobile-drawer"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="ps-mobile-drawer" className="ps-mobile-drawer">
          <nav aria-label="Mobile navigation" className="ps-mobile-nav">
            <a href="/features" className={currentPath === "/features" ? "is-active" : ""} onClick={(ev) => navClick("/features", ev)}>
              Features
            </a>
            <a href="/security" className={currentPath === "/security" ? "is-active" : ""} onClick={(ev) => navClick("/security", ev)}>
              Security &amp; Privacy
            </a>
            <a href="/help" className={currentPath === "/help" ? "is-active" : ""} onClick={(ev) => navClick("/help", ev)}>
              Help
            </a>
            <a href="/download" className={currentPath === "/download" ? "is-active" : ""} onClick={(ev) => navClick("/download", ev)}>
              Download App
            </a>
            <a href="/about" className={currentPath === "/about" ? "is-active" : ""} onClick={(ev) => navClick("/about", ev)}>
              About Persora
            </a>
          </nav>
          <div className="ps-mobile-drawer-actions">
            {signedIn ? (
              <button
                type="button"
                className="ps-btn ps-btn-primary"
                onClick={() => {
                  setMobileOpen(false);
                  onHome();
                }}
              >
                Open Workspace
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ps-btn ps-btn-secondary"
                  onClick={() => {
                    setMobileOpen(false);
                    onSignIn();
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className="ps-btn ps-btn-primary"
                  onClick={() => {
                    setMobileOpen(false);
                    onGetStarted();
                  }}
                >
                  Get Started
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function PublicFooter({
  onHome,
  onNavigate,
  onSignIn,
  onGetStarted,
  signedIn = false,
}: {
  onHome: () => void;
  onNavigate: (path: PublicPath) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
  signedIn?: boolean;
}) {
  const link = (path: PublicPath) => (event: React.MouseEvent) => {
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <footer className="ps-site-footer">
      <div className="ps-site-footer-inner">
        <div className="ps-footer-brand-col">
          <a
            href="/"
            className="ps-brand"
            onClick={(ev) => {
              ev.preventDefault();
              onHome();
            }}
          >
            <span className="ps-brand-mark" aria-hidden="true">
              <PersoraBrandMark size={24} />
            </span>
            <span className="ps-brand-name">Persora</span>
          </a>
          <p className="ps-footer-tagline">
            A calm, private personal workspace for your documents, plans, spreadsheets, studios, and credentials.
          </p>
        </div>

        <div className="ps-footer-links-grid">
          <div className="ps-footer-col">
            <h3>Product</h3>
            <a href="/features" onClick={link("/features")}>Features</a>
            <a href="/security" onClick={link("/security")}>Security &amp; Privacy</a>
            <a href="/download" onClick={link("/download")}>Download</a>
            {!signedIn ? (
              <button type="button" className="ps-footer-btn-link" onClick={onGetStarted}>
                Get Started
              </button>
            ) : (
              <button type="button" className="ps-footer-btn-link" onClick={onHome}>
                Open Workspace
              </button>
            )}
          </div>

          <div className="ps-footer-col">
            <h3>Company &amp; Support</h3>
            <a href="/about" onClick={link("/about")}>About</a>
            <a href="/help" onClick={link("/help")}>Help</a>
            <a href="/contact" onClick={link("/contact")}>Contact</a>
            {!signedIn && (
              <button type="button" className="ps-footer-btn-link" onClick={onSignIn}>
                Sign In
              </button>
            )}
          </div>

          <div className="ps-footer-col">
            <h3>Legal</h3>
            <a href="/privacy" onClick={link("/privacy")}>Privacy Policy</a>
            <a href="/terms" onClick={link("/terms")}>Terms of Service</a>
            <a href="/security" onClick={link("/security")}>Data Protection</a>
          </div>
        </div>
      </div>

      <div className="ps-footer-bottom">
        <span>&copy; {new Date().getFullYear()} Persora. Private by default.</span>
        <div className="ps-footer-bottom-links">
          <a href="/about" onClick={link("/about")}>About</a>
          <a href="/help" onClick={link("/help")}>Help</a>
          <a href="/privacy" onClick={link("/privacy")}>Privacy Policy</a>
          <a href="/terms" onClick={link("/terms")}>Terms of Service</a>
        </div>
      </div>
    </footer>
  );
}

export function ModuleBadgeIcon({ iconId, size = "md" }: { iconId: LauncherModuleId; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`ps-module-icon is-${size}`} aria-hidden="true">
      <LauncherModuleIcon id={iconId} />
    </span>
  );
}
