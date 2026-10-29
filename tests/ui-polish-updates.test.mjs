import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("Sidebar collapse control lives in the sidebar header and survives reloads", () => {
  const workspace = read("src/components/Workspace.tsx");
  const systemCss = read("src/design-system/system.css");

  // Toggle button is rendered inside .sidebar-header, next to the brand.
  const header = workspace.match(/<div className="sidebar-header">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(header, /sidebar-toggle-button/, "collapse button must sit in the sidebar header");
  assert.match(header, /setSidebarCollapsed/);
  assert.match(workspace, /persora\.sidebar\.collapsed/, "collapse state must persist");
  assert.match(workspace, /aria-expanded=\{!sidebarCollapsed\}/);
  assert.match(workspace, /aria-label=\{sidebarCollapsed \? "Expand sidebar" : "Collapse sidebar"\}/);

  // Collapsed rail keeps accessible names for every nav item.
  assert.match(workspace, /aria-label=\{label\} title=\{label\}/);

  // CSS: collapsed rail geometry + label hiding, desktop only.
  assert.match(systemCss, /\.workspace-sidebar\.is-collapsed\s*\{[^}]*width:\s*78px/);
  assert.match(systemCss, /\.workspace-sidebar\.is-collapsed \.sidebar-link-label/);
  assert.match(systemCss, /@media \(min-width:\s*821px\)/);
});

test("Topbar global search trigger is an icon-only button", () => {
  const workspace = read("src/components/Workspace.tsx");
  const systemCss = read("src/design-system/system.css");
  const trigger = workspace.match(/<button[^>]*className="global-search-trigger"[\s\S]*?<\/button>/)?.[0] || "";

  assert.ok(trigger, "global search trigger must exist");
  assert.doesNotMatch(trigger, /<span/, "no visible label inside the trigger");
  assert.doesNotMatch(trigger, /<kbd/, "no keyboard hint chip inside the trigger");
  assert.match(trigger, /aria-label="Search your vault/);
  assert.match(systemCss, /\.global-search-trigger\s*\{[^}]*display:\s*inline-grid[^}]*width:\s*38px/);
  assert.doesNotMatch(systemCss, /\.global-search-trigger kbd/);
});

test("Sidebar profile menu is gone and a single sign-out action replaced it", () => {
  const workspace = read("src/components/Workspace.tsx");
  assert.doesNotMatch(workspace, /className="sidebar-profile"/);
  assert.doesNotMatch(workspace, /user-popover/);
  assert.doesNotMatch(workspace, /profileWrapRef/);
  assert.match(workspace, /className="sidebar-logout"[^>]*aria-label="Sign out"/);
  assert.match(workspace, /onClick=\{onSignOut\}/);

  const css = read("src/design-system/system.css");
  assert.match(css, /\.sidebar-logout\s*\{/);
  assert.doesNotMatch(css, /\.sidebar-profile\s*\{/);
  assert.doesNotMatch(css, /\.user-popover/);
});

test("Confirmation dialogs use the clean centered layout everywhere", () => {
  const primitives = read("src/design-system/primitives.tsx");
  const css = read("src/design-system/system.css");
  const vaultDialogs = read("src/components/VaultDialogs.tsx");

  // No header chrome: no icon tile, no eyebrow row and no close button markup.
  assert.doesNotMatch(primitives, /ds-delete-modal-head/);
  assert.doesNotMatch(primitives, /ds-delete-modal-close/);
  assert.doesNotMatch(primitives, /ds-delete-modal-title-wrap/);
  assert.match(primitives, /ds-delete-modal-copy/);

  // Confirm action is stacked above Cancel, both full width.
  const confirmIndex = primitives.indexOf("ds-delete-confirm-btn");
  const cancelIndex = primitives.indexOf("ds-delete-cancel-btn", primitives.indexOf("confirm-actions"));
  assert.ok(confirmIndex > 0 && cancelIndex > confirmIndex, "confirm comes before cancel in the actions");

  assert.match(css, /\.confirm-actions\.ds-delete-modal-actions\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.ds-delete-confirm-btn,\s*\.ds-delete-cancel-btn\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.confirm-dialog\.ds-delete-modal\s*\{[^}]*text-align:\s*center/);

  // Every destructive confirmation still routes through the shared component.
  for (const file of ["src/components/Workspace.tsx", "src/components/docs/DocsHome.tsx", "src/components/table/TableHome.tsx"]) {
    assert.match(read(file), /PersoraDeleteModal/, `${file} must use PersoraDeleteModal`);
  }
  assert.match(vaultDialogs, /<PersoraDeleteModal/);
});

test("Removed heading subtitles stay removed", () => {
  const dashboard = read("src/components/dashboard/DashboardView.tsx");
  assert.doesNotMatch(dashboard, /Your live schedule, tasks, documents, renewals, and tools/);

  const docsHome = read("src/components/docs/DocsHome.tsx");
  const docsCss = read("src/components/docs/docs.css");
  assert.doesNotMatch(docsHome, /pd-starter-sub/);
  assert.doesNotMatch(docsCss, /\.pd-starter-sub/);

  const photoStudio = read("src/components/PhotoStudioView.tsx");
  assert.doesNotMatch(photoStudio, /edits run on this device/);

  const workspace = read("src/components/Workspace.tsx");
  assert.doesNotMatch(workspace, /Organized for you\. Private by default\./);
});

test("Tasks & Notes open in a full-page editor instead of a drawer", () => {
  const page = read("src/components/notes/NoteEditorPage.tsx");
  const pageCss = read("src/components/notes/note-editor-page.css");
  const app = read("src/App.tsx");
  const workspace = read("src/components/Workspace.tsx");
  const systemCss = read("src/design-system/system.css");
  const vaultDialogs = read("src/components/VaultDialogs.tsx");

  // The page renders breadcrumb + borderless title + rich body + tags, not a modal shell.
  assert.doesNotMatch(page, /ItemModalShell/);
  assert.match(page, /note-page-breadcrumb/);
  assert.match(page, /className="note-page-title"/);
  assert.match(page, /RichNoteEditor/);
  assert.match(page, /note-page-tag-input/);
  assert.match(page, /note-page-footer/);

  // Rich editor is shared with the invoice/vault editors (single implementation).
  assert.match(vaultDialogs, /export function RichNoteEditor/);

  // App routes plain notes to the page; the vault item drawer never handles them.
  assert.match(app, /import \{ NoteEditorPage \} from "\.\/components\/notes\/NoteEditorPage"/);
  assert.match(app, /editor\.section !== "notes" && <ItemEditorDialog/);
  assert.match(app, /editor\.section === "notes" \? <NoteEditorPage/);

  // Workspace renders it as the page surface with the topbar/footer stepped aside.
  assert.match(workspace, /notePage \? notePage : <>/);
  assert.match(workspace, /workspace-content-note-page/);
  assert.match(systemCss, /\.workspace-main:has\(\.note-page\)/);

  // Token-driven styling only.
  assert.match(pageCss, /var\(--ds-canvas-bg\)/);
  assert.doesNotMatch(pageCss, /#[0-9a-fA-F]{3,8}\b(?!.*var\()/);
});
