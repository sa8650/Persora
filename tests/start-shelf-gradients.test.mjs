import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { Window } from "happy-dom";
import { build } from "esbuild";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Bundle the real TypeScript/TSX primitives for Node's interaction tests. CSS
// is checked separately below; React remains external so the test and component
// share one renderer instance.
const compiledParent = path.join(ROOT, "node_modules", ".cache");
fs.mkdirSync(compiledParent, { recursive: true });
const compiledDir = fs.mkdtempSync(path.join(compiledParent, "persora-start-shelf-"));
await build({
  entryPoints: {
    "start-shelf": path.join(ROOT, "src/components/shared/start-shelf.tsx"),
    "template-card": path.join(ROOT, "src/components/shared/template-card.tsx"),
  },
  outdir: compiledDir,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/*", "react-dom", "react-dom/*", "lucide-react"],
  logLevel: "silent",
});

const {
  StartShelf,
  WorkspaceSidebarProvider,
  getStartShelfVisibleLimit,
  START_SHELF_EXPANDED_SIDEBAR_LIMIT,
  START_SHELF_COLLAPSED_SIDEBAR_LIMIT,
} = await import(pathToFileURL(path.join(compiledDir, "start-shelf.js")).href);
const {
  TemplateCardThumb,
  TEMPLATE_GRADIENTS,
  TEMPLATE_GRADIENT_PALETTE,
  templateGradient,
} = await import(pathToFileURL(path.join(compiledDir, "template-card.js")).href);

const window = new Window({ url: "http://persora.test/" });
for (const [key, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { act } = React;

after(async () => {
  await window.happyDOM.close();
  fs.rmSync(compiledDir, { recursive: true, force: true });
});

const EXPECTED_GRADIENTS = [
  { id: 1, name: "Blue–Indigo", from: "#579AFC", to: "#5763FC", css: "linear-gradient(90deg, rgb(87, 154, 252) 0%, rgb(87, 99, 252) 100%)" },
  { id: 2, name: "Pink–Coral", from: "#FF5AC2", to: "#FD5B73", css: "linear-gradient(90deg, rgb(255, 90, 194) 0%, rgb(253, 91, 115) 100%)" },
  { id: 3, name: "Orange–Yellow", from: "#FDAC3E", to: "#FAD43F", css: "linear-gradient(90deg, rgb(253, 172, 62) 0%, rgb(250, 212, 63) 100%)" },
  { id: 4, name: "Teal–Green", from: "#01BBB1", to: "#01C681", css: "linear-gradient(90deg, rgb(1, 187, 177) 0%, rgb(1, 198, 129) 100%)" },
  { id: 5, name: "Coral–Orange", from: "#FF775A", to: "#FFA35A", css: "linear-gradient(90deg, rgb(255, 119, 90) 0%, rgb(255, 163, 90) 100%)" },
  { id: 6, name: "Purple–Lavender", from: "#7C3AED", to: "#C084FC", css: "linear-gradient(90deg, #7C3AED, #C084FC)" },
  { id: 7, name: "Deep Navy–Sky Blue", from: "#172554", to: "#38BDF8", css: "linear-gradient(90deg, #172554, #38BDF8)" },
  { id: 8, name: "Lime–Soft Green", from: "#65A30D", to: "#D9F99D", css: "linear-gradient(90deg, #65A30D, #D9F99D)" },
  { id: 9, name: "Burgundy–Magenta", from: "#881337", to: "#E879F9", css: "linear-gradient(90deg, #881337, #E879F9)" },
  { id: 10, name: "Graphite–Silver", from: "#334155", to: "#94A3B8", css: "linear-gradient(90deg, #334155, #94A3B8)" },
];

function makeItems(total = 12) {
  return Array.from({ length: total }, (_, index) => ({
    key: `card-${index + 1}`,
    render: () => React.createElement(
      "button",
      { type: "button", "data-card": String(index + 1) },
      `Card ${index + 1}`,
    ),
  }));
}

async function mountShelf(sidebarCollapsed = false, total = 12) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const items = makeItems(total);

  const render = async (nextSidebarCollapsed) => {
    await act(async () => {
      root.render(React.createElement(
        WorkspaceSidebarProvider,
        { collapsed: nextSidebarCollapsed },
        React.createElement(StartShelf, {
          headingId: "test-start-heading",
          heading: "Start a new document",
          items,
        }),
      ));
    });
  };

  await render(sidebarCollapsed);
  return {
    container,
    render,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function shelfState(container) {
  const shelf = container.querySelector(".ds-start-shelf");
  const toggle = container.querySelector(".ds-start-shelf-toggle");
  return {
    sidebar: shelf.getAttribute("data-sidebar-state"),
    gallery: shelf.getAttribute("data-gallery-state"),
    cards: [...container.querySelectorAll("[data-card]")].map((node) => node.getAttribute("data-card")),
    expanded: toggle.getAttribute("aria-expanded"),
    label: toggle.textContent.trim(),
    indicator: toggle.querySelector("[data-indicator]")?.getAttribute("data-indicator"),
  };
}

async function clickGallery(container) {
  const toggle = container.querySelector(".ds-start-shelf-toggle");
  await act(async () => toggle.click());
}

test("visible-limit unit matrix: 5 / 6 / all, including short and invalid lists", () => {
  assert.equal(START_SHELF_EXPANDED_SIDEBAR_LIMIT, 5);
  assert.equal(START_SHELF_COLLAPSED_SIDEBAR_LIMIT, 6);

  for (const sidebarCollapsed of [false, true]) {
    const collapsedLimit = sidebarCollapsed ? 6 : 5;
    assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed, galleryExpanded: false, totalCards: 12 }), collapsedLimit);
    assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed, galleryExpanded: true, totalCards: 12 }), 12);
    assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed, galleryExpanded: false, totalCards: 4 }), 4);
    assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed, galleryExpanded: true, totalCards: 4 }), 4);
  }

  assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed: false, galleryExpanded: false, totalCards: 0 }), 0);
  assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed: false, galleryExpanded: false, totalCards: -4 }), 0);
  assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed: false, galleryExpanded: true, totalCards: Number.NaN }), 0);
  assert.equal(getStartShelfVisibleLimit({ sidebarCollapsed: true, galleryExpanded: true, totalCards: 8.9 }), 8);
});

test("React interaction: sidebar changes recalculate immediately without auto-expanding", async () => {
  const mounted = await mountShelf(false, 12);
  try {
    let state = shelfState(mounted.container);
    assert.deepEqual(state, {
      sidebar: "expanded",
      gallery: "collapsed",
      cards: ["1", "2", "3", "4", "5"],
      expanded: "false",
      label: "Template gallery",
      indicator: "expand",
    });

    await mounted.render(true);
    state = shelfState(mounted.container);
    assert.equal(state.sidebar, "collapsed");
    assert.equal(state.gallery, "collapsed");
    assert.equal(state.cards.length, 6);
    assert.equal(state.label, "Template gallery");
    assert.equal(state.expanded, "false");

    await mounted.render(false);
    assert.equal(shelfState(mounted.container).cards.length, 5);
    assert.equal(shelfState(mounted.container).gallery, "collapsed");
  } finally {
    await mounted.unmount();
  }
});

test("React interaction: manual gallery toggle shows all, updates label/icon, and survives sidebar toggles", async () => {
  const mounted = await mountShelf(false, 12);
  try {
    await clickGallery(mounted.container);
    let state = shelfState(mounted.container);
    assert.equal(state.cards.length, 12);
    assert.equal(state.gallery, "expanded");
    assert.equal(state.expanded, "true");
    assert.equal(state.label, "Collapse gallery");
    assert.equal(state.indicator, "collapse");
    assert.match(mounted.container.querySelector(".ds-start-shelf-grid").className, /is-expanded/);

    await mounted.render(true);
    state = shelfState(mounted.container);
    assert.equal(state.cards.length, 12, "expanded gallery must not collapse when sidebar collapses");
    assert.equal(state.gallery, "expanded");

    await mounted.render(false);
    assert.equal(shelfState(mounted.container).cards.length, 12, "expanded gallery must not collapse when sidebar expands");

    await clickGallery(mounted.container);
    state = shelfState(mounted.container);
    assert.equal(state.cards.length, 5);
    assert.equal(state.gallery, "collapsed");
    assert.equal(state.expanded, "false");
    assert.equal(state.label, "Template gallery");
    assert.equal(state.indicator, "expand");
    assert.doesNotMatch(mounted.container.querySelector(".ds-start-shelf-grid").className, /is-expanded/);
  } finally {
    await mounted.unmount();
  }
});

test("React interaction: second click restores the collapsed-sidebar limit of 6", async () => {
  const mounted = await mountShelf(true, 12);
  try {
    assert.equal(shelfState(mounted.container).cards.length, 6);
    await clickGallery(mounted.container);
    assert.equal(shelfState(mounted.container).cards.length, 12);
    await clickGallery(mounted.container);
    assert.equal(shelfState(mounted.container).cards.length, 6);
    assert.equal(shelfState(mounted.container).label, "Template gallery");
  } finally {
    await mounted.unmount();
  }
});

test("all 10 exact 90-degree gradients are shared by tokens and runtime configuration", () => {
  assert.deepEqual([...TEMPLATE_GRADIENTS], EXPECTED_GRADIENTS.map(({ id }) => id));
  assert.deepEqual(
    TEMPLATE_GRADIENT_PALETTE.map(({ id, name, from, to, css }) => ({ id, name, from, to, css })),
    EXPECTED_GRADIENTS,
  );
  assert.equal(new Set(TEMPLATE_GRADIENT_PALETTE.map(({ css }) => css)).size, 10);

  const tokens = read("src/design-system/tokens.css");
  const cardCss = read("src/components/shared/template-card.css");
  for (const gradient of EXPECTED_GRADIENTS) {
    assert.ok(gradient.css.startsWith("linear-gradient(90deg,"), `gradient ${gradient.id} must be 90deg`);
    assert.ok(
      tokens.includes(`--ds-template-gradient-${gradient.id}: ${gradient.css};`),
      `token ${gradient.id} must exactly match the requested colors`,
    );
    assert.match(
      cardCss,
      new RegExp(`\\.ds-template-thumb\\[data-template-gradient="${gradient.id}"\\]\\s*\\{\\s*--ds-template-gradient:\\s*var\\(--ds-template-gradient-${gradient.id}\\);\\s*\\}`),
    );
  }
});

test("gradient assignment is deterministic, cycles through all 10, and survives remounts", async () => {
  const expectedCycle = Array.from({ length: 30 }, (_, index) => (index % 10) + 1);
  const firstPass = Array.from({ length: 30 }, (_, index) => templateGradient(index));
  const secondPass = Array.from({ length: 30 }, (_, index) => templateGradient(index));
  assert.deepEqual(firstPass, expectedCycle);
  assert.deepEqual(secondPass, firstPass);
  assert.equal(templateGradient(Number.NaN), 1);
  assert.equal(templateGradient(Number.POSITIVE_INFINITY), 1);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const renderPalette = async () => {
    await act(async () => {
      root.render(React.createElement(
        "div",
        null,
        EXPECTED_GRADIENTS.map((gradient, index) => React.createElement(
          TemplateCardThumb,
          { key: gradient.id, gradient: templateGradient(index), className: "test-starter-thumb" },
          React.createElement("span", { className: "preview-content" }, gradient.name),
        )),
      ));
    });
    return [...container.querySelectorAll(".ds-template-thumb")].map((node) => ({
      gradient: node.getAttribute("data-template-gradient"),
      className: node.className,
      text: node.textContent,
    }));
  };

  try {
    const firstRender = await renderPalette();
    assert.deepEqual(firstRender.map(({ gradient }) => Number(gradient)), EXPECTED_GRADIENTS.map(({ id }) => id));
    assert.ok(firstRender.every(({ className }) => className.includes("is-gradient") && className.includes("test-starter-thumb")));
    assert.deepEqual(firstRender.map(({ text }) => text), EXPECTED_GRADIENTS.map(({ name }) => name));

    await act(async () => root.unmount());
    const remountedRoot = createRoot(container);
    await act(async () => {
      remountedRoot.render(React.createElement(
        "div",
        null,
        EXPECTED_GRADIENTS.map((gradient, index) => React.createElement(
          TemplateCardThumb,
          { key: gradient.id, gradient: templateGradient(index) },
          gradient.name,
        )),
      ));
    });
    const remounted = [...container.querySelectorAll(".ds-template-thumb")].map((node) => Number(node.getAttribute("data-template-gradient")));
    assert.deepEqual(remounted, firstRender.map(({ gradient }) => Number(gradient)));
    await act(async () => remountedRoot.unmount());
  } finally {
    container.remove();
  }
});

test("Table, Forms, and Docs all use StartShelf and the same deterministic gradient mapper", () => {
  const workspace = read("src/components/Workspace.tsx");
  assert.match(workspace, /<WorkspaceSidebarProvider collapsed=\{sidebarCollapsed\}>/);

  for (const [module, file, blankCount] of [
    ["Table", "src/components/table/TableHome.tsx", 2],
    ["Forms", "src/components/forms/FormsDashboard.tsx", 1],
    ["Docs", "src/components/docs/DocsHome.tsx", 1],
  ]) {
    const source = read(file);
    assert.match(source, /import \{ StartShelf, type StartShelfItem \} from "\.\.\/shared\/start-shelf"/, `${module} must use StartShelf`);
    assert.match(source, /<StartShelf[\s\S]*?gridClassName=/, `${module} must render the shared shelf`);
    assert.match(source, /gradient=\{templateGradient\(index\)\}/, `${module} must use the shared deterministic mapper`);
    assert.match(source, /collapsedLabel="Template gallery"/);
    assert.match(source, /expandedLabel="Collapse gallery"/);
    assert.doesNotMatch(source, /Math\.random|INLINE_TEMPLATE_LIMIT|galleryOpen/, `${module} must not use random colors or a second gallery implementation`);

    const thumbCount = (source.match(/<TemplateCardThumb/g) || []).length;
    assert.ok(thumbCount >= blankCount + 1, `${module} retains blank cards and template previews`);
  }

  const tableSource = read("src/components/table/TableHome.tsx");
  assert.match(tableSource, /const ORDERED_TABLE_TEMPLATES/, "Table template order must be canonical and stable");
  assert.match(tableSource, /return ORDERED_TABLE_TEMPLATES\.map/);
  assert.match(read("src/components/forms/FormsDashboard.tsx"), /return STARTER_TEMPLATES\.map/);
  assert.match(read("src/components/docs/DocsHome.tsx"), /return DOC_TEMPLATES\.map/);
});

test("collapsed shelves keep one desktop row and gradient previews retain readable paper/ink", () => {
  const cardCss = read("src/components/shared/template-card.css");
  assert.match(cardCss, /@media \(min-width: 821px\)/);
  assert.match(cardCss, /data-sidebar-state="expanded"[\s\S]*?:nth-child\(n \+ 6\)[\s\S]*?display: none/);
  assert.match(cardCss, /data-sidebar-state="collapsed"[\s\S]*?:nth-child\(n \+ 7\)[\s\S]*?display: none/);
  assert.match(cardCss, /\.ds-template-thumb\.is-gradient \.tb-mini-sheet-paper,\s*\.ds-template-thumb\.is-gradient \.pd-mini-paper\s*\{[^}]*background-color: #ffffff/);
  assert.match(cardCss, /\.ds-template-thumb\.is-gradient \.pf-mini \.pf-mini-title-card[\s\S]*?background-color: #ffffff/);
  assert.match(cardCss, /\.dark \.ds-template-thumb\.is-gradient \.pf-mini/);
  assert.match(cardCss, /color: #0f172a/);

  for (const file of [
    "src/components/table/table.css",
    "src/components/forms/forms.css",
    "src/components/docs/docs.css",
  ]) {
    const css = read(file);
    assert.match(css, /grid-template-columns: repeat\(var\(--ds-template-shelf-columns\), minmax\(0, var\(--ds-template-card-width\)\)\)/);
    assert.doesNotMatch(css, /@media \(max-width: 1120px\)\s*\{\s*\.[a-z]+-starter-grid/, `${file} must not override the 5/6-column shelf at desktop widths`);
  }
});
