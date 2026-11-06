import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const exists = (file) => fs.existsSync(path.join(ROOT, file));

const GENERIC_LAYOUTS = [
  "DocumentCardsSkeleton", "DocumentCardsSample", "MediaCardsSkeleton", "MediaCardsSample",
  "ProjectCardsSkeleton", "ProjectCardsSample", "CalendarSkeleton", "CalendarSample",
  "FormCardsSkeleton", "FormCardsSample", "FormSkeleton", "FormSample",
  "DataTableSkeleton", "DataTableSample", "StatsRowSkeleton", "StatsRowSample",
  "ListSkeleton", "ListSample", "ProfileSkeleton", "ProfileSample",
  "EditorSkeleton", "EditorSample", "DashboardSkeleton", "DashboardSample",
  "WidgetSkeleton", "WidgetSample",
];

const VIEW_FILES = [
  "src/components/Workspace.tsx",
  "src/components/docs/DocsHome.tsx",
  "src/components/docs/DocsView.tsx",
  "src/components/docs/DocEditor.tsx",
  "src/components/docs/PublicSharedDocPage.tsx",
  "src/components/table/TableHome.tsx",
  "src/components/table/TableView.tsx",
  "src/components/table/TableEditor.tsx",
  "src/components/table/PublicSharedTablePage.tsx",
  "src/components/table/ShareTableDialog.tsx",
  "src/components/forms/FormsDashboard.tsx",
  "src/components/forms/FormsView.tsx",
  "src/components/forms/PublicFormPage.tsx",
  "src/components/forms/FormResponsesTab.tsx",
  "src/components/calendar/CalendarView.tsx",
  "src/components/habits/HabitsView.tsx",
  "src/components/loans/LoansView.tsx",
  "src/components/connections/ConnectionsView.tsx",
  "src/components/PhotoStudioView.tsx",
  "src/components/PdfStudioView.tsx",
  "src/components/audio-space/AudioSpaceView.tsx",
  "src/components/ProjectsView.tsx",
  "src/components/ProjectTaskList.tsx",
  "src/components/dashboard/DashboardView.tsx",
  "src/components/dashboard/DashboardWidget.tsx",
  "src/components/BillingView.tsx",
  "src/components/PublicBusinessCardPage.tsx",
  "src/components/travel-space/TravelSpaceView.tsx",
  "src/components/admin/AdminIntegrationsPanel.tsx",
];

test("Skullet is installed and the app has a single root provider with debug in development", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies.skullet, "skullet must be a runtime dependency");
  const main = read("src/main.tsx");
  assert.match(main, /PersoraSkulletProvider/);
  assert.match(main, /<PersoraThemeProvider>[\s\S]*<PersoraSkulletProvider>/);
  const provider = read("src/components/skullet/PersoraSkulletProvider.tsx");
  assert.match(provider, /from "skullet\/react"/);
  assert.match(provider, /import "skullet\/styles\.css"/);
  assert.match(provider, /reveal="smart"/);
  assert.match(provider, /PERSORA_SKULLET_THEME/);
  assert.match(provider, /debug=\{import\.meta\.env\.DEV\}/);
  const theme = read("src/lib/skullet-theme.ts");
  assert.match(theme, /light:\s*\{/);
  assert.match(theme, /dark:\s*\{/);
  assert.match(theme, /animation:\s*"shimmer"/);
  assert.match(theme, /radius:\s*"8px"/);
});

test("ReUI skeleton files are gone and Skullet primitives stay on the design-system barrel", () => {
  assert.equal(exists("src/components/reui/skeletons.tsx"), false);
  assert.equal(exists("src/components/reui/skeletons.css"), false);
  assert.equal(exists("src/components/ui/skeleton.tsx"), false);
  assert.equal(exists("src/components/examples/c-skeleton-5.tsx"), false);
  const barrel = read("src/design-system/index.ts");
  assert.match(barrel, /SkeletonBox/);
  assert.match(barrel, /SkeletonSuspense/);
  assert.match(barrel, /forgetShapes/);
});

test("Pages do not reuse generic Skullet layout templates", () => {
  const workspace = read("src/components/Workspace.tsx");
  assert.doesNotMatch(workspace, /skeleton=\{/);
  assert.match(workspace, /id="workspace-calendar"/);
  assert.match(workspace, /id="workspace-habits"/);
  assert.match(workspace, /id="workspace-docs"/);
  for (const file of VIEW_FILES) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/components\/ui\/skeleton/, `${file} must not import the ReUI skeleton primitive`);
    assert.doesNotMatch(source, /reui\/skeletons/, `${file} must not import ReUI skeleton layouts`);
    for (const name of GENERIC_LAYOUTS) {
      assert.doesNotMatch(source, new RegExp(`\\b${name}\\b`), `${file} must not use generic ${name}`);
    }
  }
});

test("Each module wraps its own UI for measurement", () => {
  const checks = {
    "src/components/docs/DocsHome.tsx": ["id={`docs-home-${viewMode}`}", "pd-card", "SAMPLE_DOCS"],
    "src/components/table/TableHome.tsx": ["id={`tables-home-${viewMode}`}", "tb-card-grid", "SAMPLE_TABLES"],
    "src/components/forms/FormsDashboard.tsx": ["id={`forms-home-${viewMode}`}", "pf-card-grid", "SAMPLE_FORMS"],
    "src/components/calendar/CalendarView.tsx": ["TimeGrid", "MonthGrid", "AgendaList", "id={`calendar-timegrid-${mode}`}"],
    "src/components/habits/HabitsView.tsx": ["DayPanel", "SAMPLE_HABITS", "id={`habits-${mode}`}"],
    "src/components/loans/LoansView.tsx": ["LoanRow", "SAMPLE_LOANS", "id=\"loans-list\""],
    "src/components/connections/ConnectionsView.tsx": ["ProviderRow", "OFFLINE_PROVIDERS"],
    "src/components/ProjectsView.tsx": ["pj-project-grid", "SAMPLE_PROJECTS", "id=\"projects-home\""],
    "src/components/dashboard/DashboardView.tsx": ["DashboardGrid", "createDefaultDashboardLayout", "id=\"dashboard-grid\""],
    "src/components/dashboard/DashboardWidget.tsx": ["id={`dash-widget-${widget.id}`}", "ds-widget-body"],
    "src/components/docs/DocEditor.tsx": ["pd-editor", "pd-topbar", "id={`doc-editor-${docId}`}"],
    "src/components/table/TableEditor.tsx": ["tb-editor", "id={`table-editor-${tableId}`}"],
    "src/components/BillingView.tsx": ["billing-overview-grid", "id=\"billing-page\""],
    "src/components/PublicBusinessCardPage.tsx": ["public-card-surface", "id={`public-card-${cardId}`}"],
    "src/components/travel-space/TravelSpaceView.tsx": ["ts-dashboard", "id=\"travel-space-home\""],
    "src/components/PhotoStudioView.tsx": ["ps-grid", "ps-card", "SkeletonBox"],
    "src/components/PdfStudioView.tsx": ["pdfs-grid", "pdfs-card"],
    "src/components/audio-space/AudioSpaceView.tsx": ["as-grid", "as-card"],
  };
  for (const [file, needles] of Object.entries(checks)) {
    const source = read(file);
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${file} must include ${needle}`);
    }
  }
});

test("Initial data loads no longer use generic spinners, while operation spinners remain", () => {
  const table = read("src/components/table/TableEditor.tsx");
  assert.match(table, /if \(!summary \|\| !doc\) \{/);
  assert.doesNotMatch(table, /if \(!summary \|\| !doc\).*<(Spinner|EditorSkeleton)/);
  assert.match(table, /<Spinner[^>]*\/>\s*Saving…/, "saving remains an operation spinner");
  const dashboard = read("src/components/dashboard/DashboardView.tsx");
  assert.doesNotMatch(dashboard, /Loading your personalized dashboard…/);
  const projects = read("src/components/ProjectsView.tsx");
  assert.doesNotMatch(projects, /pj-loading.*Loading projects/);
  const calendar = read("src/components/calendar/CalendarView.tsx");
  assert.match(calendar, /loadState === "loading" && rangeReady && <Spinner/, "only background refresh keeps the small spinner");
  const app = read("src/App.tsx");
  assert.match(app, /forgetShapes/);
});
