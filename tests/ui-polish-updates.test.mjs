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
  // The page autosaves, so it has no footer action bar of its own.
  assert.doesNotMatch(page, /note-page-footer/);
  assert.doesNotMatch(pageCss, /\.note-page-footer/);

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

test("Tasks & Notes notes autosave like Persora Table and Docs", () => {
  const page = read("src/components/notes/NoteEditorPage.tsx");
  const app = read("src/App.tsx");

  // Debounced autosave: the note persists itself without a Save/Create footer.
  assert.match(page, /AUTOSAVE_DELAY/);
  assert.match(page, /persistRef\.current/);
  assert.match(page, /window\.setTimeout\(\(\) => \{ void persistRef\.current\(\); \}, AUTOSAVE_DELAY\)/);
  assert.match(page, /lastSavedKeyRef/);
  // Opening a note is not an edit.
  assert.match(page, /initializedRef/);

  // App exposes an in-place save that keeps the page open and returns the id.
  assert.match(app, /const persistVaultItem = async/);
  assert.match(app, /const handleSaveNoteDraft = async/);
  assert.match(app, /return \{ id: saved\.id, file: saved\.file \}/);
  assert.match(app, /onSave=\{handleSaveNoteDraft\}/);
});

test("Note attachments moved into the rich-note toolbar and stay plan-gated", () => {
  const page = read("src/components/notes/NoteEditorPage.tsx");
  const pageCss = read("src/components/notes/note-editor-page.css");
  const vaultDialogs = read("src/components/VaultDialogs.tsx");

  // The old attachment section is removed outright, not hidden.
  assert.doesNotMatch(page, /ReuiFileAttachmentField/);
  assert.doesNotMatch(page, /note-page-attachment"/);
  assert.doesNotMatch(pageCss, /\.note-page-attachment \{/);
  assert.doesNotMatch(page, /<footer/);

  // A frozen toolbar icon replaces it.
  assert.match(page, /attachment=\{\{/);
  assert.match(page, /disabled: !canUpload/);
  assert.match(vaultDialogs, /is-frozen/);
  assert.match(vaultDialogs, /className=\{\`rich-note-tool/);
  assert.match(vaultDialogs, /aria-label=\{attachment\.disabled \? "Attach a file — requires an active paid plan/);
  assert.match(pageCss, /\.note-page \.rich-note-tool\.is-frozen/);
});

test("Note tools fix the list commands and offer a light page background", () => {
  const vaultDialogs = read("src/components/VaultDialogs.tsx");
  const page = read("src/components/notes/NoteEditorPage.tsx");
  const pageCss = read("src/components/notes/note-editor-page.css");
  const tokens = read("src/design-system/tokens.css");

  // Lists are built from real blocks instead of relying on execCommand.
  assert.match(vaultDialogs, /const applyList = \(mode: NoteListMode\)/);
  assert.match(vaultDialogs, /const selectedBlocks = /);
  assert.match(vaultDialogs, /const normalizeBlocks = /);
  assert.doesNotMatch(vaultDialogs, /insertUnorderedList/);
  assert.doesNotMatch(vaultDialogs, /insertHTML/);
  assert.match(vaultDialogs, /applyList\("ul"\)/);
  assert.match(vaultDialogs, /applyList\("ol"\)/);
  assert.match(vaultDialogs, /applyList\("check"\)/);

  // Background picker lives in the same toolbar as the formatting tools.
  assert.match(vaultDialogs, /NOTE_SURFACES/);
  assert.match(vaultDialogs, /rich-note-surface-menu/);
  assert.match(page, /data-note-surface=\{surface\}/);
  assert.match(pageCss, /\.note-page-sheet\[data-note-surface="sand"\]/);
  for (const surface of ["sand", "mint", "sky", "blush", "lilac"]) {
    assert.match(tokens, new RegExp(`--ds-note-surface-${surface}:`), `missing ${surface} surface token`);
  }
});

test("Template and starter cards share one geometry and the canonical gradients", () => {
  const card = read("src/components/shared/template-card.tsx");
  const cardCss = read("src/components/shared/template-card.css");
  const tokens = read("src/design-system/tokens.css");
  const tableCss = read("src/components/table/table.css");
  const docsCss = read("src/components/docs/docs.css");
  const formsCss = read("src/components/forms/forms.css");

  // One shared component, one shared surface rule.
  assert.match(card, /export function TemplateCardThumb/);
  assert.match(card, /export function templateGradient/);
  assert.match(cardCss, /\.ds-template-thumb \{[^}]*height:/);

  // Canonical card height + gradient stops live in the token layer.
  assert.match(tokens, /--ds-template-card-height:\s*140px/);
  const stops = [
    "linear-gradient(90deg, rgb(87, 154, 252) 0%, rgb(87, 99, 252) 100%)",
    "linear-gradient(90deg, rgb(255, 90, 194) 0%, rgb(253, 91, 115) 100%)",
    "linear-gradient(90deg, rgb(253, 172, 62) 0%, rgb(250, 212, 63) 100%)",
    "linear-gradient(90deg, rgb(1, 187, 177) 0%, rgb(1, 198, 129) 100%)",
    "linear-gradient(90deg, rgb(255, 119, 90) 0%, rgb(255, 163, 90) 100%)",
  ];
  stops.forEach((stop, index) => {
    assert.ok(tokens.includes(stop), `--ds-template-gradient-${index + 1} must use the exact stops`);
  });

  // Only the band is painted: the white preview stays white.
  assert.match(cardCss, /\.ds-template-thumb\.is-gradient \.tb-mini-sheet-paper,/);
  assert.match(cardCss, /background-color: #ffffff/);

  // Every product card opts into the shared height; page files keep no sizes.
  for (const css of [tableCss, docsCss, formsCss]) {
    assert.match(css, /height: var\(--ds-template-card-height\)/);
    assert.doesNotMatch(css, /height:\s*124px/);
  }
  assert.doesNotMatch(tableCss, /\.tb-starter-thumb \{[^}]*border:/);
  assert.doesNotMatch(docsCss, /\.pd-starter-thumb \{[^}]*height:/);
  assert.doesNotMatch(formsCss, /\.pf-starter-thumb \{[^}]*height:/);

  // Table and Docs template cards carry the gradient; blank cards stay neutral.
  assert.match(read("src/components/table/TableHome.tsx"), /gradient=\{templateGradient\(index\)\}/);
  assert.match(read("src/components/docs/DocsHome.tsx"), /gradient=\{templateGradient\(index\)\}/);
});

test("Sidebar and topbar headers are 60px with no seam between brand and nav", () => {
  const systemCss = read("src/design-system/system.css");
  const refinements = read("src/console-refinements.css");
  const theme = read("src/persora-theme.css");

  // Only the app shell headers are 60px (the admin console keeps its own scale).
  assert.doesNotMatch(theme, /\.sidebar-header \{[^}]*height: 74px/);
  assert.doesNotMatch(theme, /\.workspace-topbar \{[^}]*height: 74px/);
  assert.doesNotMatch(refinements, /height: 70px/);
  assert.match(systemCss, /\.sidebar-header \{[^}]*height: 60px/);
  assert.match(systemCss, /\.sidebar-header \{[^}]*border-bottom: 0/);
  assert.match(systemCss, /\.workspace-topbar \{[^}]*height: 60px/);
  assert.doesNotMatch(systemCss, /border-bottom: 1px solid var\(--ds-divider\);\s*backdrop-filter: none/);
});
