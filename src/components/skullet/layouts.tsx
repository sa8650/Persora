import type { CSSProperties, ReactNode } from "react";
import { Skeleton } from "skullet/react";
import { cn } from "@/lib/cn";
import "./layouts.css";

const times = (count: number) => Array.from({ length: Math.max(1, count) }, (_, index) => index);

const DOCUMENT_TITLES = [
  "Quarterly planning notes",
  "Home renovation brief",
  "Travel packing list",
  "Team kickoff agenda",
  "Lease renewal checklist",
  "Personal reading log",
];
const DOCUMENT_COPY = [
  "Agenda items and follow-ups for the next review.",
  "Owners, dates, and open questions live in this brief.",
  "Keep the outline close so nothing slips between visits.",
];
const MEDIA_TITLES = ["Evening walk", "Studio still", "Family dinner", "Garden light"];
const PROJECT_TITLES = ["Kitchen remodel", "Website relaunch", "Summer trip", "Health archive"];
const FORM_TITLES = ["Event RSVP", "Feedback form", "Quiz: basics", "Volunteer signup", "Intake form", "Workshop survey"];
const LIST_TITLES = ["Morning stretch", "Read twenty pages", "Drink a litre of water", "Call the landlord", "Review the budget"];
const STAT_CARDS = [
  { label: "Storage used", value: "12.4 GB", note: "of 50 GB on your plan" },
  { label: "Active vault items", value: "128", note: "across private spaces" },
  { label: "Shared with you", value: "6", note: "waiting for a reply" },
];
const TABLE_HEADERS = ["Title", "Owner", "Updated", "Status", "Size", "Tags"];
const TABLE_CELLS = [
  ["Lease agreement", "You", "Yesterday", "Active", "240 KB", "Home"],
  ["Flight itinerary", "You", "2 days ago", "Shared", "18 KB", "Travel"],
  ["Lab results", "You", "Last week", "Private", "1.2 MB", "Health"],
  ["Invoice April", "You", "Apr 12", "Paid", "86 KB", "Finance"],
  ["Meeting notes", "You", "Mon", "Draft", "12 KB", "Work"],
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PROFILE = {
  name: "Alex Rahman",
  bio: "Product designer in Dhaka. Happy to swap ideas over coffee or a quick call.",
  stats: ["12 links", "4 numbers", "2 sites"],
};
const EDITOR_PARAS = [
  "Kickoff notes for the next planning cycle, including owners and open questions.",
  "Keep decisions close to the work so the next visit picks up without a layout jump.",
  "Follow-ups live under the agenda so nothing is lost between drafts.",
  "Attachments and comments will land in the same column once the document opens.",
  "A short recap of last week sits here so the page already has its final height.",
  "Action items stay grouped by theme rather than scattered across sidebars.",
  "The canvas keeps this width so the skeleton and the editor occupy the same space.",
  "Secondary notes trail a beat behind the heading, matching how real copy lands.",
  "When the document arrives, nothing on this page should move.",
];
const DASHBOARD_WIDGETS = [
  { title: "Today's calendar", lines: ["Team standup at 10:00", "Dentist at 16:30", "Evening walk"] },
  { title: "Habits", lines: ["Morning stretch is due", "Reading streak: 12 days", "Hydration on track"] },
  { title: "Recent files", lines: ["Lease agreement.pdf", "Flight itinerary", "Lab results"] },
  { title: "Quick notes", lines: ["Call the landlord", "Pack the blue folder", "Renew the domain"] },
];
const SHEET_HEADERS = ["A", "B", "C", "D", "E", "F"];
const SHEET_ROWS = [
  ["Item", "Owner", "Due", "Status", "Notes", "Tag"],
  ["Kitchen tiles", "Alex", "May 12", "Open", "Need samples", "Home"],
  ["Domain renew", "Alex", "May 18", "Due", "Registrar email", "Work"],
  ["Visa photos", "Sam", "May 20", "Done", "Printed", "Travel"],
  ["Budget draft", "Alex", "May 22", "Open", "Add buffer", "Finance"],
  ["Garden soil", "Sam", "May 24", "Open", "Local nursery", "Home"],
  ["Lab follow-up", "Alex", "May 26", "Due", "Ask clinic", "Health"],
  ["Packing list", "Sam", "Jun 01", "Open", "Carry-on only", "Travel"],
  ["Invoice May", "Alex", "Jun 02", "Draft", "Send Friday", "Finance"],
  ["Team notes", "Alex", "Jun 03", "Open", "Share doc", "Work"],
];

function Measured({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Skeleton loading id={id} label={label} className={cn("ds-sk-region", className)}>
      {children}
    </Skeleton>
  );
}

export function DocumentCardsSample({ count = 6, list = false }: { count?: number; list?: boolean }) {
  return (
    <div className={cn("ds-sk-document-grid", list && "is-list")}>
      {times(count).map((key) => (
        <article className="ds-sk-document-card" key={key}>
          {list ? (
            <>
              <span className="ds-sk-document-list-thumb" skullet-block="" />
              <span className="ds-sk-document-list-copy">
                <b className="ds-sk-card-title">{DOCUMENT_TITLES[key % DOCUMENT_TITLES.length]}</b>
                <small className="ds-sk-card-meta">Opened yesterday</small>
              </span>
              <span className="ds-sk-row-action" skullet-block="" />
            </>
          ) : (
            <>
              <div className="ds-sk-document-preview">
                <h3>{DOCUMENT_TITLES[key % DOCUMENT_TITLES.length]}</h3>
                <p>{DOCUMENT_COPY[0]}</p>
                <p>{DOCUMENT_COPY[1]}</p>
                <p>{DOCUMENT_COPY[2]}</p>
              </div>
              <h4 className="ds-sk-card-title">{DOCUMENT_TITLES[key % DOCUMENT_TITLES.length]}</h4>
              <p className="ds-sk-card-meta">Opened yesterday</p>
            </>
          )}
        </article>
      ))}
    </div>
  );
}

export function DocumentCardsSkeleton({
  label = "Loading documents",
  count = 6,
  className,
  list = false,
}: {
  label?: string;
  count?: number;
  className?: string;
  list?: boolean;
}) {
  return (
    <Measured id={`document-cards${list ? "-list" : ""}`} label={label} className={className}>
      <DocumentCardsSample count={count} list={list} />
    </Measured>
  );
}

export function MediaCardsSample({ count = 4 }: { count?: number }) {
  return (
    <div className="ds-sk-document-grid">
      {times(count).map((key) => (
        <article className="ds-sk-document-card" key={key}>
          <div className="ds-sk-media-preview" skullet-block="" />
          <h4 className="ds-sk-card-title">{MEDIA_TITLES[key % MEDIA_TITLES.length]}</h4>
          <p className="ds-sk-card-meta">Added this week</p>
        </article>
      ))}
    </div>
  );
}

export function MediaCardsSkeleton({ label = "Loading media", count = 4, className }: { label?: string; count?: number; className?: string }) {
  return (
    <Measured id="media-cards" label={label} className={className}>
      <MediaCardsSample count={count} />
    </Measured>
  );
}

export function ProjectCardsSample({ count = 4 }: { count?: number }) {
  return (
    <div className="ds-sk-document-grid">
      {times(count).map((key) => (
        <article className="ds-sk-project-card" key={key}>
          <div className="ds-sk-project-badges">
            <span>Active</span>
            <span>Shared</span>
            <span>4 fields</span>
          </div>
          <h4 className="ds-sk-card-title">{PROJECT_TITLES[key % PROJECT_TITLES.length]}</h4>
          <p className="ds-sk-card-meta">Track the next milestone and keep owners in view.</p>
          <p className="ds-sk-card-meta">Updated yesterday</p>
          <div className="ds-sk-project-stats">
            <span>12 tasks</span>
            <span>3 people</span>
            <span>68% done</span>
          </div>
          <div className="ds-sk-project-progress" skullet-block="" />
        </article>
      ))}
    </div>
  );
}

export function ProjectCardsSkeleton({ label = "Loading projects", count = 4, className }: { label?: string; count?: number; className?: string }) {
  return (
    <Measured id="project-cards" label={label} className={className}>
      <ProjectCardsSample count={count} />
    </Measured>
  );
}

export function FormCardsSample({ count = 6 }: { count?: number }) {
  return (
    <div className="ds-sk-document-grid">
      {times(count).map((key) => (
        <article className="ds-sk-document-card" key={key}>
          <div className="ds-sk-document-preview ds-sk-form-preview">
            <div className="ds-sk-form-banner" skullet-block="" />
            <h3>{FORM_TITLES[key % FORM_TITLES.length]}</h3>
            <div className="ds-sk-form-field" skullet-block="" />
            <div className="ds-sk-form-field is-short" skullet-block="" />
          </div>
          <h4 className="ds-sk-card-title">{FORM_TITLES[key % FORM_TITLES.length]}</h4>
          <p className="ds-sk-card-meta">12 responses</p>
        </article>
      ))}
    </div>
  );
}

export function FormCardsSkeleton({ label = "Loading forms", count = 6, className }: { label?: string; count?: number; className?: string }) {
  return (
    <Measured id="form-cards" label={label} className={className}>
      <FormCardsSample count={count} />
    </Measured>
  );
}

export function FormSample({ fields = 3 }: { fields?: number }) {
  const labels = ["Full name", "Email address", "Phone number", "Company", "Notes"];
  return (
    <form className="ds-sk-form" onSubmit={(event) => event.preventDefault()}>
      <div className="ds-sk-form-heading">
        <h2>Account details</h2>
        <p>These fields match the form you are about to fill in.</p>
        <p>Nothing on this page should shift when the real copy arrives.</p>
      </div>
      {times(fields).map((key) => (
        <div className="ds-sk-field" key={key}>
          <label htmlFor={`sk-field-${key}`}>{labels[key % labels.length]}</label>
          <input id={`sk-field-${key}`} className="ds-sk-input" readOnly tabIndex={-1} value="" />
          <small>We’ll never share this outside your vault.</small>
        </div>
      ))}
      <span className="ds-sk-submit">Continue</span>
    </form>
  );
}

export function FormSkeleton({ label = "Loading form", fields = 3, className }: { label?: string; fields?: number; className?: string }) {
  return (
    <Measured id="form-layout" label={label} className={className}>
      <FormSample fields={fields} />
    </Measured>
  );
}

export function DataTableSample({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const safeColumns = Math.max(1, Math.min(columns, TABLE_HEADERS.length));
  const style = { gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` } as CSSProperties;
  return (
    <div className="ds-sk-table">
      <div className="ds-sk-table-row is-header" style={style}>
        {TABLE_HEADERS.slice(0, safeColumns).map((header) => <span key={header}>{header}</span>)}
      </div>
      {times(rows).map((row) => (
        <div className="ds-sk-table-row" style={style} key={row}>
          {TABLE_CELLS[row % TABLE_CELLS.length].slice(0, safeColumns).map((cell, column) => (
            <span key={column}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DataTableSkeleton({
  label = "Loading table",
  rows = 5,
  columns = 4,
  className,
}: {
  label?: string;
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <Measured id={`data-table-${rows}x${columns}`} label={label} className={className}>
      <DataTableSample rows={rows} columns={columns} />
    </Measured>
  );
}

export function CalendarSample({ days = 7, time = false }: { days?: number; time?: boolean }) {
  const safeDays = Math.max(1, Math.min(7, days));
  const style = { gridTemplateColumns: `repeat(${safeDays}, minmax(0, 1fr))` } as CSSProperties;
  const events = ["Standup", "Deep work", "Lunch"];
  return (
    <div className={cn("ds-sk-calendar", time && "is-time")}>
      <div className="ds-sk-calendar-head" style={style}>
        {WEEKDAYS.slice(0, safeDays).map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="ds-sk-calendar-grid" style={style}>
        {times(safeDays * (time ? 4 : 5)).map((key) => (
          <div className="ds-sk-calendar-cell" key={key}>
            <span className="ds-sk-calendar-date">{(key % 28) + 1}</span>
            <p>{events[key % events.length]}</p>
            <p>{key % 3 === 0 ? "With Sam" : "Hold the slot"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarSkeleton({
  label = "Loading calendar",
  days = 7,
  time = false,
  className,
}: {
  label?: string;
  days?: number;
  time?: boolean;
  className?: string;
}) {
  return (
    <Measured id={`calendar-${time ? "time" : "month"}-${days}`} label={label} className={className}>
      <CalendarSample days={days} time={time} />
    </Measured>
  );
}

export function StatsRowSample({ count = 3 }: { count?: number }) {
  return (
    <div className="ds-sk-stats">
      {STAT_CARDS.slice(0, Math.max(1, count)).map((card) => (
        <article className="ds-sk-stat" key={card.label}>
          <span className="ds-sk-stat-label">{card.label}</span>
          <b className="ds-sk-stat-value">{card.value}</b>
          <span className="ds-sk-stat-note">{card.note}</span>
        </article>
      ))}
    </div>
  );
}

export function StatsRowSkeleton({ label = "Loading statistics", count = 3, className }: { label?: string; count?: number; className?: string }) {
  return (
    <Measured id="stats-row" label={label} className={className}>
      <StatsRowSample count={count} />
    </Measured>
  );
}

export function ListSample({ rows = 4, avatars = true }: { rows?: number; avatars?: boolean }) {
  return (
    <div className="ds-sk-list">
      {times(rows).map((key) => (
        <div className="ds-sk-list-row" key={key}>
          {avatars && <span className="ds-sk-list-avatar" skullet-block="" />}
          <span className="ds-sk-list-copy">
            <b>{LIST_TITLES[key % LIST_TITLES.length]}</b>
            <small>Due today · Personal</small>
          </span>
          <span className="ds-sk-row-action" skullet-block="" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({
  label = "Loading list",
  rows = 4,
  className,
  avatars = true,
}: {
  label?: string;
  rows?: number;
  className?: string;
  avatars?: boolean;
}) {
  return (
    <Measured id={`list-${avatars ? "avatars" : "plain"}-${rows}`} label={label} className={className}>
      <ListSample rows={rows} avatars={avatars} />
    </Measured>
  );
}

export function ProfileSample() {
  return (
    <article className="ds-sk-profile">
      <span className="ds-sk-profile-avatar" skullet-block="" />
      <h1>{PROFILE.name}</h1>
      <p>{PROFILE.bio}</p>
      <p>Save the card to keep these details in your vault.</p>
      <div className="ds-sk-profile-stats">
        {PROFILE.stats.map((stat) => <span key={stat}>{stat}</span>)}
      </div>
      <span className="ds-sk-profile-action">Save contact</span>
    </article>
  );
}

export function ProfileSkeleton({ label = "Loading profile", className }: { label?: string; className?: string }) {
  return (
    <Measured id="profile" label={label} className={className}>
      <ProfileSample />
    </Measured>
  );
}

export function EditorSample({ kind = "document" }: { kind?: "document" | "spreadsheet" }) {
  return (
    <div className={cn("ds-sk-editor", `is-${kind}`)}>
      <div className="ds-sk-editor-toolbar">
        <span className="ds-sk-editor-title">{kind === "spreadsheet" ? "Budget tracker" : "Quarterly planning notes"}</span>
        <span className="ds-sk-editor-tool" skullet-block="" />
        <span className="ds-sk-editor-tool" skullet-block="" />
        <span className="ds-sk-row-action" skullet-block="" />
      </div>
      {kind === "spreadsheet" ? (
        <div className="ds-sk-sheet">
          {SHEET_ROWS.map((row, index) => (
            <div className="ds-sk-sheet-row" key={index}>
              {(index === 0 ? SHEET_HEADERS : row).map((cell, column) => <span key={column}>{cell}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <div className="ds-sk-editor-page">
          <h2>Quarterly planning notes</h2>
          {EDITOR_PARAS.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
    </div>
  );
}

export function EditorSkeleton({
  label = "Opening editor",
  kind = "document",
  className,
}: {
  label?: string;
  kind?: "document" | "spreadsheet";
  className?: string;
}) {
  return (
    <Measured id={`editor-${kind}`} label={label} className={className}>
      <EditorSample kind={kind} />
    </Measured>
  );
}

export function DashboardSample({ count = 4 }: { count?: number }) {
  return (
    <div className="ds-sk-dashboard">
      {DASHBOARD_WIDGETS.slice(0, Math.max(1, count)).map((widget) => (
        <article className="ds-sk-dashboard-card" key={widget.title}>
          <h3>{widget.title}</h3>
          {widget.lines.map((line) => <p key={line}>{line}</p>)}
        </article>
      ))}
    </div>
  );
}

export function DashboardSkeleton({ label = "Loading dashboard", count = 4, className }: { label?: string; count?: number; className?: string }) {
  return (
    <Measured id="dashboard" label={label} className={className}>
      <DashboardSample count={count} />
    </Measured>
  );
}

export function WidgetSample() {
  return (
    <div className="ds-sk-widget">
      <h3>Today at a glance</h3>
      <p>Three habits are due before noon.</p>
      <p>The next calendar event starts at 10:00.</p>
      <p>Two files were added yesterday.</p>
    </div>
  );
}

export function WidgetSkeleton({ label = "Loading widget", className }: { label?: string; className?: string }) {
  return (
    <Measured id="dashboard-widget" label={label} className={className}>
      <WidgetSample />
    </Measured>
  );
}

export function ChartFallback({ label = "Loading chart", className }: { label?: string; className?: string }) {
  return (
    <Measured id="chart-fallback" label={label} className={className}>
      <div className="ds-sk-chart" skullet-block="" />
    </Measured>
  );
}
