import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walkFiles(dir, extPattern = /\.(css|ts|tsx)$/) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, extPattern));
    } else if (extPattern.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test("Persora Design System core files and documentation exist", () => {
  const requiredFiles = [
    "DESIGN_SYSTEM.md",
    "src/design-system/tokens.css",
    "src/design-system/system.css",
    "src/design-system/theme.tsx",
    "src/design-system/primitives.tsx",
    "src/design-system/index.ts",
    "src/components/reui/badge.tsx",
    "src/components/reui/file-type.tsx",
    "src/components/reui/frame.tsx",
    "src/components/reui/icon-stack.tsx",
    "src/components/reui/icon-tile.tsx",
    "src/components/reui/c-attachment-6.tsx",
  ];

  for (const rel of requiredFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `Expected ${rel} to exist`);
  }

  const doc = read("DESIGN_SYSTEM.md");
  assert.match(doc, /--ds-sidebar-bg/);
  assert.match(doc, /--ds-canvas-bg/);
  assert.match(doc, /PersoraThemeProvider/);
  assert.match(doc, /ReuiFileAttachmentField/);
});

test("Every var(--ds-*) reference across src/ is defined in src/design-system/tokens.css", () => {
  const tokensCss = read("src/design-system/tokens.css");
  const defined = new Set(
    [...tokensCss.matchAll(/(--ds-[a-z0-9-]+)/g)].map((m) => m[1]),
  );

  const missing = [];
  for (const file of walkFiles(path.join(ROOT, "src"))) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/var\((--ds-[a-z0-9-]+)/g)) {
      if (!defined.has(match[1])) {
        missing.push(`${path.relative(ROOT, file)} -> ${match[1]}`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Undefined --ds-* CSS custom properties found:\n${missing.join("\n")}`,
  );
});

test("Sidebar and page canvas surfaces are separated in both Light and Dark themes with structural dividers", () => {
  const tokensCss = read("src/design-system/tokens.css");
  const systemCss = read("src/design-system/system.css");

  const rootBlock = tokensCss.split(".dark")[0];
  const darkBlock = tokensCss.slice(tokensCss.indexOf(".dark"));

  const lightSidebar = rootBlock.match(/--ds-sidebar-bg:\s*([^;]+);/)?.[1]?.trim();
  const lightCanvas = rootBlock.match(/--ds-canvas-bg:\s*([^;]+);/)?.[1]?.trim();
  const lightCard = rootBlock.match(/--ds-card-bg:\s*([^;]+);/)?.[1]?.trim();

  const darkSidebar = darkBlock.match(/--ds-sidebar-bg:\s*([^;]+);/)?.[1]?.trim();
  const darkCanvas = darkBlock.match(/--ds-canvas-bg:\s*([^;]+);/)?.[1]?.trim();
  const darkCard = darkBlock.match(/--ds-card-bg:\s*([^;]+);/)?.[1]?.trim();

  assert.ok(lightSidebar && lightCanvas && lightCard);

  // Workspace Colors & Typography update: white page canvas, #F6F7FB navigation rail.
  assert.equal(lightSidebar.toLowerCase(), "#f6f7fb", "Light sidebar background must be #F6F7FB");
  assert.equal(lightCanvas.toLowerCase(), "#ffffff", "Light workspace canvas must be #FFFFFF");
  assert.notEqual(lightSidebar, lightCanvas, "Light sidebar and canvas must have distinct surface tokens");

  // Canvas and cards are both white by design; separation is carried by borders,
  // dividers and elevation rather than a grey canvas tone.
  assert.equal(lightCard.toLowerCase(), "#ffffff");
  assert.match(tokensCss, /--ds-card-border:\s*var\(--ds-border\)/);
  assert.match(tokensCss, /--ds-divider:\s*#cfd9e6/);
  assert.match(systemCss, /\.workspace-sidebar\s*\{[\s\S]*?border-right:\s*1px solid var\(--ds-divider\)/);

  assert.ok(darkSidebar && darkCanvas && darkCard);
  assert.notEqual(darkSidebar, darkCanvas, "Dark sidebar and canvas must have distinct surface tokens");
  assert.notEqual(darkCanvas, darkCard, "Dark canvas and card must have distinct surface tokens");

  assert.match(systemCss, /\.workspace-sidebar\s*\{[\s\S]*?border-right:\s*1px solid var\(--ds-divider\)/);
  assert.match(systemCss, /\.workspace-topbar\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--ds-divider\)/);
});

test("MagicCard uses Persora theme context and card surface tokens instead of canvas background", () => {
  const magicCard = read("src/components/ui/magic-card.tsx");
  assert.match(magicCard, /usePersoraTheme/);
  assert.doesNotMatch(magicCard, /next-themes/);
  assert.match(magicCard, /var\(--color-card\)/);
  assert.doesNotMatch(magicCard, /var\(--color-background\)/);
});

test("Application entry wires tokens.css, system.css, and PersoraThemeProvider", () => {
  const indexCss = read("src/index.css");
  const mainTsx = read("src/main.tsx");
  const designBarrel = read("src/design-system/index.ts");

  assert.match(indexCss, /design-system\/tokens\.css/);
  assert.match(mainTsx, /PersoraThemeProvider/);
  assert.match(mainTsx, /design-system\/system\.css/);

  for (const symbol of [
    "PersoraThemeProvider",
    "ThemeToggleButton",
    "AppearanceSettingsCard",
    "PersoraEmptyState",
    "PersoraAsideStat",
    "PersoraSearchField",
    "ReuiFileAttachmentField",
    "Badge",
    "IconTile",
    "IconStack",
    "Frame",
    "FileType",
    "Checkbox",
    "Progress",
    "Spinner",
  ]) {
    assert.match(designBarrel, new RegExp(`\\b${symbol}\\b`), `Expected ${symbol} in src/design-system/index.ts`);
  }
});

test("Modal and drawer scrims keep blur disabled for scroll and typing performance", () => {
  const systemCss = read("src/design-system/system.css");
  assert.match(systemCss, /backdrop-filter:\s*none/);
  for (const rel of ["src/overlays.css", "src/workspace.css", "src/personal-finance.css", "src/components/forms/forms.css"]) {
    const css = read(rel);
    assert.doesNotMatch(css, /backdrop-filter:\s*blur\(/, `${rel} must not apply expensive backdrop blur`);
  }
});

test("ReUI ContextMenu, ReUI Menubar, PersoraDeleteModal, ShareTableDialog, and FormResponsesTab invariants hold", () => {
  const doc = read("DESIGN_SYSTEM.md");
  const barrel = read("src/design-system/index.ts");
  const primitives = read("src/design-system/primitives.tsx");
  const workspace = read("src/components/Workspace.tsx");
  const systemCss = read("src/design-system/system.css");
  const shareDialog = read("src/components/table/ShareTableDialog.tsx");
  const sheetEditor = read("src/components/table/SpreadsheetEditor.tsx");
  const smartEditor = read("src/components/table/SmartTableEditor.tsx");
  const smartGrid = read("src/components/table/SmartGrid.tsx");
  const sheetGrid = read("src/components/table/SheetGrid.tsx");
  const tableUi = read("src/components/table/table-ui.tsx");
  const responsesTab = read("src/components/forms/FormResponsesTab.tsx");
  const publicForm = read("src/components/forms/PublicFormPage.tsx");

  for (const name of ["PersoraDeleteModal", "ContextMenu", "Menubar"]) {
    assert.match(doc, new RegExp(name), `DESIGN_SYSTEM.md must document ${name}`);
    assert.match(barrel, new RegExp(`\\b${name}\\b`), `src/design-system/index.ts must export ${name}`);
  }

  // Workspace topbar must not include global menubar; dead PersoraGlobalMenubar must be removed
  assert.doesNotMatch(workspace, /PersoraGlobalMenubar/);
  assert.doesNotMatch(barrel, /PersoraGlobalMenubar/);
  assert.doesNotMatch(primitives, /PersoraGlobalMenubar/);

  // Notification popover closes on outside pointerdown/Escape and wraps action buttons cleanly
  assert.match(workspace, /notificationWrapRef/);
  assert.match(workspace, /document\.addEventListener\("pointerdown"/);
  assert.match(workspace, /notification-toolbar/);

  // Persora Table workspace full-fit zero-padding layout + spreadsheet search box + Smart Table tools
  assert.match(systemCss, /\.workspace-content:has\(\.tb-editor\)/);
  assert.match(sheetEditor, /tb-sheet-search/);
  assert.match(smartEditor, /tb-smart-menubar/);
  assert.match(smartEditor, /tb-smart-toolbar/);
  assert.match(smartGrid, /ContextMenu/);
  assert.doesNotMatch(smartGrid, /<input[^>]+type=["']checkbox["']/);

  // Published form (/Form/:slug) shows no topbar and renders bottom disclaimer + branding
  assert.doesNotMatch(publicForm, /pf-public-topbar/);
  assert.match(publicForm, /This content is neither created nor endorsed by Persora\./);
  assert.match(publicForm, /Contact form owner/);
  assert.match(publicForm, /Terms of Service/);
  assert.match(publicForm, /Privacy Policy/);

  // PersoraDeleteModal portals to document.body and exposes accessible alertdialog semantics
  assert.match(primitives, /createPortal\(content,\s*document\.body\)/);
  assert.match(primitives, /role="alertdialog"/);

  // ShareTableDialog uses unified ItemModalShell + record-share-dialog classes and exposes Viewer/Commenter/Editor link options
  assert.match(shareDialog, /ItemModalShell/);
  assert.match(shareDialog, /record-share-dialog/);
  assert.match(shareDialog, /value="edit"/);

  // SheetGrid supports touchpad ctrlKey wheel + 2-finger touch pinch zoom without zooming the browser page
  assert.match(sheetGrid, /clampGridZoom/);
  assert.match(sheetGrid, /touchstart/);
  assert.match(sheetGrid, /passive:\s*false/);

  // Table Menu portals via ModalPortal with upward auto-flip for bottom sheet tabs
  assert.match(tableUi, /ModalPortal/);
  assert.match(tableUi, /tb-menu-portaled/);

  // FormResponsesTab load callback depends only on [form.id] to prevent infinite reload loops
  assert.match(responsesTab, /\[form\.id\]/);
  assert.match(responsesTab, /PersoraDeleteModal/);

  // Persora Table Home: Google Sheets-style dashboard with single combined filter box,
  // real read-only card previews, simplified 2-row card footer, and no legacy chip strip
  const tableHome = fs.readFileSync(path.join(ROOT, "src/components/table/TableHome.tsx"), "utf8");
  const tableCardPreview = fs.readFileSync(path.join(ROOT, "src/components/table/TableCardPreview.tsx"), "utf8");
  const tableCss = fs.readFileSync(path.join(ROOT, "src/components/table/table.css"), "utf8");
  assert.match(tableHome, /Start a new table/);
  assert.match(tableHome, /Template gallery/);
  assert.match(tableHome, /label="Filter tables"/);
  assert.match(tableHome, /TableCardPreview/);
  assert.match(tableHome, /TableContentMiniature/);
  assert.match(tableHome, /tb-card-main-row/);
  assert.match(tableHome, /tb-card-meta-row/);
  assert.match(tableHome, /LauncherModuleIcon id="tables"/);
  assert.match(tableHome, /PersoraDeleteModal/);
  assert.doesNotMatch(tableHome, /More creation options/);
  assert.doesNotMatch(tableHome, /(?<![-\w])tb-chips?(?![-\w])/);
  assert.doesNotMatch(tableCss, /\.tb-chips?(?![-\w])/);
  assert.match(tableCss, /\.tb-start-shelf\s*\{[^}]*background:\s*var\(--ds-shelf-bg\)/);
  assert.match(tableCss, /\.tb-mini\s*\{[^}]*padding:\s*15px\s+18px\s+13px/);
  assert.match(tableCardPreview, /tb-mini-sheet-paper/);
  assert.match(tableCardPreview, /getTablePreview/);
  assert.doesNotMatch(tableCardPreview, /from\s+["']\.\/(?:SpreadsheetEditor|SmartTableEditor|SheetGrid|SmartGrid)/);

  // Start shelf token (#FAFCFF / rgb(250, 252, 255))
  const tokensCss = read("src/design-system/tokens.css");
  assert.match(tokensCss, /--ds-shelf-bg:\s*#fafcff/i);

  // Persora Docs Home: Google Docs / Persora Table & Forms dashboard parity
  const docsHome = read("src/components/docs/DocsHome.tsx");
  const docCardPreview = read("src/components/docs/DocCardPreview.tsx");
  const docsCss = read("src/components/docs/docs.css");
  assert.match(docsHome, /Start a new document/);
  assert.match(docsHome, /Template gallery/);
  assert.doesNotMatch(docsHome, /More creation options/);
  assert.match(docsHome, /label="Filter documents"/);
  assert.match(docsHome, /DocCardPreview/);
  assert.match(docsHome, /pd-card-main-row/);
  assert.match(docsHome, /pd-card-meta-row/);
  assert.match(docsHome, /LauncherModuleIcon id="docs"/);
  assert.match(docsHome, /PersoraDeleteModal/);
  assert.match(docsCss, /\.pd-start-shelf\s*\{[^}]*background:\s*var\(--ds-shelf-bg\)/);
  assert.match(docsCss, /\.pd-mini\s*\{[^}]*padding:\s*15px\s+18px\s+13px/);
  assert.doesNotMatch(docCardPreview, /from\s+["']\.\/DocEditor/);

  // Persora Forms Home: Google Forms / Persora Table-style dashboard parity
  const formsDash = read("src/components/forms/FormsDashboard.tsx");
  const formCardPreview = read("src/components/forms/FormCardPreview.tsx");
  const formsCss = read("src/components/forms/forms.css");
  assert.match(formsDash, /Start a new form/);
  assert.match(formsDash, /Template gallery/);
  assert.doesNotMatch(formsDash, /More creation options/);
  assert.match(formsDash, /label="Filter forms"/);
  assert.match(formsDash, /FormCardPreview/);
  assert.match(formsDash, /FormContentMiniature/);
  assert.match(formsDash, /pf-card-main-row/);
  assert.match(formsDash, /pf-card-meta-row/);
  assert.match(formsDash, /LauncherModuleIcon id="forms"/);
  assert.match(formsDash, /PersoraDeleteModal/);
  assert.doesNotMatch(formsDash, /pf-filter-pills/);
  assert.doesNotMatch(formsCss, /\.pf-filter-pills?\b/);
  assert.match(formsCss, /\.pf-start-shelf\s*\{[^}]*background:\s*var\(--ds-shelf-bg\)/);
  assert.doesNotMatch(formCardPreview, /from\s+["']\.\/FormBuilder/);
});



test("Geist Sans is the single UI typeface and sidebar typography uses 13px / #676879", () => {
  const tokensCss = read("src/design-system/tokens.css");
  const systemCss = read("src/design-system/system.css");
  const indexCss = read("src/index.css");
  const fontsCss = read("src/design-system/fonts.css");
  const pkg = JSON.parse(read("package.json"));

  // Font loading: self-hosted Geist Sans, no CDN / no obsolete webfont packages.
  assert.match(fontsCss, /@fontsource-variable\/geist/);
  assert.match(indexCss, /design-system\/fonts\.css/);
  assert.ok(pkg.dependencies["@fontsource-variable/geist"], "geist must be a dependency");
  assert.equal(pkg.dependencies["@fontsource-variable/inter"], undefined, "unused Inter webfont must be removed");

  // Font family tokens.
  assert.match(tokensCss, /--ds-font-sans:\s*"Geist Variable"/);
  assert.match(tokensCss, /--ds-font-mono:/);
  assert.match(tokensCss, /--ds-font-ui:\s*var\(--ds-font-sans\)/);
  assert.match(indexCss, /--font-sans:\s*var\(--ds-font-sans\)/);

  // Global family assignment lives in the shared design-system stylesheet only.
  assert.match(systemCss, /html\s*\{[^}]*font-family:\s*var\(--ds-font-sans\)/);
  assert.match(systemCss, /body\s*\{[^}]*font-family:\s*var\(--ds-font-sans\)/);
  assert.match(systemCss, /:where\(code, kbd, samp, pre,[^)]*\)\s*\{[^}]*var\(--ds-font-mono\)/);

  // Sidebar typography tokens (Light #676879, Dark keeps a token-based ink).
  assert.match(tokensCss, /--ds-sidebar-font-size:\s*13px/);
  assert.match(tokensCss, /--ds-sidebar-text:\s*#676879/);
  assert.match(tokensCss, /--ds-sidebar-font:\s*var\(--ds-font-sans\)/);
  assert.match(systemCss, /\.sidebar-link\s*\{[^}]*font-size:\s*var\(--ds-sidebar-font-size\)/);
  assert.match(systemCss, /\.sidebar-link\s*\{[^}]*color:\s*var\(--ds-sidebar-text\)/);

  // No scattered font overrides: every font-family declaration in src/ CSS must be
  // a design-system token reference or an intentional monospace stack.
  const offenders = [];
  for (const file of walkFiles(path.join(ROOT, "src"), /\.css$/)) {
    const css = fs.readFileSync(file, "utf8");
    for (const match of css.matchAll(/font-family:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      if (/var\(--ds-(?:font|sidebar-font)[a-z-]*\)/.test(value)) continue;
      if (value === "inherit") continue;
      if (/^(?:ui-monospace|monospace)\b/.test(value) && /SFMono-Regular|Menlo|monospace/.test(value)) continue;
      offenders.push(`${path.relative(ROOT, file)} -> ${value}`);
    }
  }
  assert.deepEqual(offenders, [], `Fonts must come from design-system tokens:\n${offenders.join("\n")}`);

  // "Noto Sans" is fully retired from app UI styles and components.
  for (const file of walkFiles(path.join(ROOT, "src"), /\.(css|ts|tsx)$/)) {
    const content = fs.readFileSync(file, "utf8");
    // PDF canvas/text rendering references a system PDF font stack, not app UI type.
    if (file.includes("pdf-canvas") || file.includes("pdf-studio")) continue;
    assert.doesNotMatch(content, /Noto Sans/, `${path.relative(ROOT, file)} must not reference Noto Sans`);
  }
});
