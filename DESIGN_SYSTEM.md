# Persora UI/UX Design System

The **Persora UI/UX Design System** is the canonical visual, theming, primitive, and layout foundation for the entire Persora workspace. Every module, card, drawer, modal, form control, empty state, and icon builds on `src/design-system/` and the in-repo ReUI + shadcn component library so future features and migrations stay cohesive across **Light**, **Dark**, and **System** appearance modes.

---

## 1. Architecture & File Map

| Path | Responsibility |
| --- | --- |
| `src/design-system/fonts.css` | Self-hosted Geist Sans webfont loading (`@fontsource-variable/geist`). Declares `@font-face` sources only — never `font-family` — so family assignment stays token-driven. Imported first in `src/index.css`. |
| `src/design-system/tokens.css` | Single source of truth for `--ds-*` design tokens across `:root` (Light) and `.dark, [data-theme="dark"]` (Dark), plus shadcn (`--background`, `--card`, `--popover`, `--sidebar`, `--border`, `--ring`) and workspace (`--p-*`) semantic bridges. Imported first in `src/index.css`. |
| `src/design-system/system.css` | Canonical layout shell, surface hierarchy, structural dividers, card themes, drawer/modal surfaces, icon-safe inputs, segmented tabs, and dark-mode contrast rules. Imported last in `src/main.tsx` so design-system surfaces govern legacy module stylesheets cleanly. |
| `src/design-system/theme.tsx` | `PersoraThemeProvider`, `usePersoraTheme()`, topbar `ThemeToggleButton`, and Settings `AppearanceSettingsCard` (`Light` / `Dark` / `System`, persisted in `localStorage["persora.theme"]` and synchronized to `<html class="dark" data-theme="...">`). |
| `src/components/notes/NoteEditorPage.tsx` + `note-editor-page.css` | Full-page Tasks & Notes editor (Evernote-style): breadcrumb bar with autosave state, quiet meta line, borderless title, shared `RichNoteEditor` body (toolbar carries the attachment trigger and the page-background picker) and tags. Autosaves like Persora Table/Docs and has **no** page footer. Replaces the old right-hand note drawer. |
| `src/components/shared/template-card.tsx` + `template-card.css` | Shared starter/template card primitive (`TemplateCardThumb`, `templateGradient`, `TEMPLATE_GRADIENTS`) used by the Persora Table, Persora Docs and Persora Forms shelves. Owns the single card geometry and paints the canonical gradient band behind the white document preview. |
| `src/design-system/primitives.tsx` | Shared layout & composition primitives: `PersoraEmptyState` (ReUI `IconStack` 3D layered card stack or `IconTile` badge), `PersoraAsideStat` (hero stat pill with `IconTile`), `PersoraSearchField` (flex-isolated icon search input), and `PersoraDeleteModal` (portaled `document.body` destructive confirmation `alertdialog`). |
| `src/design-system/index.ts` | Unified barrel exporting theme hooks/controls, Persora layout primitives (`PersoraEmptyState`, `PersoraAsideStat`, `PersoraSearchField`, `PersoraDeleteModal`), and all in-repo ReUI & shadcn UI primitives (`Badge`, `IconTile`, `IconStack`, `Frame`, `FileType`, `Attachment`, `ReuiFileAttachmentField`, `Checkbox`, `Progress`, `Spinner`, `Button`, `ContextMenu*`, `Menubar*`, `StageProgressIndicator`, `ImportProgressIndicator`, `TransferProgressIndicator`). |
| `src/components/reui/{badge,file-type,frame,icon-stack,icon-tile,c-attachment-6}.tsx` | In-repo ReUI (`radix-vega`) primitives saved directly inside the repository (no runtime CDN dependencies). |
| `src/components/ui/{attachment,button,checkbox,context-menu,magic-card,menubar,progress,spinner}.tsx` | In-repo shadcn/Radix, ReUI (`ContextMenu`, `Menubar`), & Magic UI primitives wired to `--ds-*` / `--color-card` semantic tokens and `usePersoraTheme()`. |
| `src/hooks/use-file-upload.ts` | Drag-and-drop, multi-file, size-validated upload hook backing `ReuiFileAttachmentField` (`@reui/c-attachment-6`). |

---

## 2. Surface Hierarchy & Structural Separation

Persora enforces a four-tier surface hierarchy so navigation, canvas, cards, and overlays never blend together in Light or Dark mode:

| Tier | Token | Light Value | Dark Value | Usage & Structural Divider |
| --- | --- | --- | --- | --- |
| **Navigation Rail** | `--ds-sidebar-bg` | `#F6F7FB` (`rgb(246, 247, 251)`) | `#0B0F17` | `.workspace-sidebar`, separated from the page canvas by `1px solid var(--ds-divider)` |
| **Page Canvas** | `--ds-canvas-bg` | `#FFFFFF` (`rgb(255, 255, 255)`) | `#101622` | `.workspace-main` / `.workspace-content` background |
| **Topbar & Footer** | `--ds-topbar-bg` / `--ds-footer-bg` | `rgba(255,255,255,0.94)` / `#F6F7FB` | `rgba(16,22,34,0.94)` / `#0D131D` | Bounded by `1px solid var(--ds-divider)` |
| **Elevated Card** | `--ds-card-bg` | `#FFFFFF` | `#161F2E` | `MagicCard`, `.metric-card`, `.vault-item-card`, hero banners, filter toolbars, module panels |
| **Subtle / Recessed** | `--ds-subtle-bg` / `--ds-input-bg` | `#F6F8FC` / `#FFFFFF` | `#111826` / `#111826` | Inputs, selects, textareas, readonly fields, locked-upload notices, segmented tracks |
| **Overlay / Drawer** | `--ds-overlay-bg` | `#FFFFFF` | `#172032` | Modals, right-hand drawers (`AddDocumentDrawer`, `TodoItemDialog`, `VaultNoteDialog`), popovers, command search |

> **White-canvas rule (Workspace Colors & Typography update):** the page canvas and elevated cards are both `#FFFFFF`. Card, panel, toolbar and dialog edges are therefore never optional — always carry `border: 1px solid var(--ds-border)` (or `var(--ds-card-border)`) plus `box-shadow: var(--ds-shadow-card)` so surfaces stay legible without a grey canvas behind them. The white canvas never replaces the sidebar rail: navigation keeps the `#F6F7FB` tint plus the `1px solid var(--ds-divider)` seam.

### Modal & Drawer Performance Rule
All modal backdrops and slide-over drawers use crisp outside-fade scrims (`background: var(--ds-scrim); backdrop-filter: none; -webkit-backdrop-filter: none;`) rather than Gaussian `backdrop-filter: blur(...)`. While any modal/drawer is open, background hover listeners on `.workspace-shell` are paused (`pointer-events: none`) while overlay portals keep `pointer-events: auto`, ensuring smooth 60fps scrolling and typing.

---

## 3. Typography — Geist Sans Everywhere

**Geist Sans is the single UI typeface of Persora.** It is self-hosted through `@fontsource-variable/geist` (variable weight `100–900`, `font-display: swap`, no CDN and no external font request), loaded once from `src/design-system/fonts.css`, and assigned once from the `--ds-font-*` token family. There are no per-module font overrides: a typography change is a token edit.

| Token | Value | Responsibility |
| --- | --- | --- |
| `--ds-font-sans` | `"Geist Variable", "Geist Sans", Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Every UI string: workspaces, cards, dialogs, forms, navigation, tables, calendars |
| `--ds-font-mono` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | Code, keycaps, formula bars, wallet/card numbers |
| `--ds-font-ui` / `--ds-font-body` / `--ds-font-heading` | `var(--ds-font-sans)` | Semantic aliases for new components |
| `--font-sans` / `--font-mono` (Tailwind `@theme`) | `var(--ds-font-sans)` / `var(--ds-font-mono)` | Tailwind `font-sans` / `font-mono` utilities resolve to the same stack |

**Loading:** `src/design-system/fonts.css` is imported first in `src/index.css`, before Tailwind, so `@font-face` rules win the cascade and text never renders in a fallback face after hydration. `@fontsource-variable/inter` was removed; it was never imported.

**Assignment rules (Light + Dark, all appearance modes):**
1. `src/design-system/system.css` § 0 Typography sets `font-family` on `html`, `body`, and the form controls (`button`, `input`, `optgroup`, `select`, `textarea`) that browsers do not let inherit.
2. `code`, `kbd`, `samp`, `pre`, `.ds-font-mono` resolve to `--ds-font-mono`; intentional monospace stacks (wallet numbers, formula bar, table ids) stay monospace.
3. Headings inherit `--ds-font-heading`; weight and scale remain component-owned, so spacing and layout are unchanged.
4. `font-synthesis-weight: none` keeps variable weights crisp instead of synthetic-bold.
5. Retired: no `Noto Sans` declaration remains in app UI CSS. Localised scripts and emoji fall through the generic `sans-serif` keyword (per-glyph system fallback) rather than a bespoke webfont family. PDF rasterisation keeps its own `Helvetica/Arial/"Noto Sans"/"Noto Sans Bengali"` system stack inside `src/lib/pdf-canvas.ts` because that string is embedded into exported PDFs, not the app UI.

### Sidebar typography

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--ds-sidebar-font` | `var(--ds-font-sans)` | `var(--ds-font-sans)` | `.workspace-sidebar`, `.sidebar-link`, `.nav-group-label`, sidebar profile/footer cards |
| `--ds-sidebar-font-size` | `13px` | `13px` | Sidebar navigation labels and the account row |
| `--ds-sidebar-font-weight` | `500` | `500` | Resting nav item weight (`active` stays `640`) |
| `--ds-sidebar-text` | `#676879` | `#CBD5E1` | Resting sidebar ink; hover uses `--ds-text`, active uses `--ds-sidebar-active-text` |
| `--ds-sidebar-label-size` / `--ds-sidebar-label-color` | `10.5px` / `#8B8D9C` | `10.5px` / `#94A3B8` | Uppercase group eyebrows above each nav group |

Sidebar ink, background and type scale are all token-driven, so Dark mode and the persisted `Light` / `Dark` / `System` preference (`localStorage["persora.theme"]`) keep working without any hardcoded sidebar colors.

### Sidebar collapse / expand (App Shell)

| Behaviour | Contract |
| --- | --- |
| Control | `<button className="sidebar-toggle-button">` in `.sidebar-header`, beside the brand — `PanelLeftClose` / `PanelLeftOpen` glyphs |
| State | `persora.sidebar.collapsed` in `localStorage`; restored on load, applied as `.workspace-sidebar.is-collapsed` |
| Geometry | 256px → **78px** rail (`@media (min-width: 821px)`), 180ms width transition honoring `--p-ease` |
| Content | Labels (`.sidebar-link-label`), count pills, group labels (rendered as hairlines), the secure card and the sign-out label are hidden; every nav item keeps `aria-label` + `title` so the icon-only rail stays screen-reader and tooltip accessible |
| Mobile | Unchanged — below 821px the sidebar is an off-canvas drawer driven by `sidebarOpen`; the collapse toggle lives only in the header and is not required for navigation |

The navigation rail ends with **one** action: `<button className="sidebar-logout">Sign out</button>`. The old `.sidebar-profile` trigger and its `.user-popover` menu (account navigation, admin console, sign out) were removed; account/plan/admin entry points live in the topbar avatar, the Account nav group and the app launcher instead.

### App shell headers (60px, one frame)

| Element | Contract |
| --- | --- |
| `.sidebar-header` | **60px** tall (`flex: 0 0 60px`), `padding: 0 12px 0 18px`, **no** `border-bottom` — the brand header and `#workspace-sidebar-nav` read as one continuous frame. The collapse toggle is 28px so it stays proportional. |
| `.workspace-topbar` | **60px** tall, `.breadcrumb-title h1` 17px, `.workspace-add-document` 34px, icon buttons (`global-search-trigger`, `theme`, `notifications`) 34px. Below 820px it becomes `height: auto; min-height: 60px` so the wrapped mobile bar never clips. |
| Admin console | Unchanged — `.admin-brand` / `.admin-topbar` keep their own 74px scale. |

Header height is declared once in `src/design-system/system.css` (imported last) and mirrored in `src/console-refinements.css` / `src/persora-theme.css`; no `70px`/`74px` app-shell header heights remain.

### Topbar global search

`.global-search-trigger` is a **38px icon-only** button (magnifier, `aria-label="Search your vault (Ctrl/⌘ K)"`, `title` carries the shortcut). No visible label, no `kbd` chip; the command palette itself still shows the shortcut. Legacy text-trigger rules were deleted from `persora-theme.css` / `workspace.css` rather than overridden.

---

## 4. Unified ReUI Component & Icon System

Import design system primitives from `@/design-system` (or their component modules):

- **Icons (`lucide-react` + `IconTile` + `FileType` + `IconStack`)**:
  - Use `lucide-react` for all UI icons across pages, toolbars, modals, and drawers.
  - Wrap feature/card/header icons in `<IconTile variant="soft" size="sm" | "default" | "lg">` instead of ad-hoc colored `<span>` boxes.
  - Render file attachments with `<FileType type={getFileType(fileNameOrMime)} />` inside `<Attachment>`.
  - Render empty states with `<PersoraEmptyState>` (`stacked` uses ReUI `<IconStack>` 3D layered cards; `stacked={false}` uses `<IconTile>` for compact panes).
  - *Exception*: `src/components/launcher/LauncherIcons.tsx` intentionally preserves bespoke multi-tone 48×48 module launcher SVGs required by `tests/app-launcher.test.mjs`, and `src/components/SocialBrandIcon.tsx` holds third-party social brand marks.
- **Attachments (`@reui/c-attachment-6`)**:
  - Use `<ReuiFileAttachmentField>` for every file picker/dropzone and `<Attachment>` / `<AttachmentGroup>` for saved attachment chips.
- **Progress & Loading (`Progress` + `Spinner`)**:
  - Use `<TransferProgressIndicator>`, `<ImportProgressIndicator>`, `<StageProgressIndicator>`, or `<Progress value={percent} />` (`0–100`) for uploads/imports, and `<Spinner />` for indeterminate loading states.
- **Selection & Status (`Checkbox` + `Badge`)**:
  - Use `<Checkbox checked={boolean | "indeterminate"} />` for row selection and bulk select-all headers (such as Contacts multi-select).
  - Use `<Badge variant="primary-light" | "success-light" | "warning-light" | "destructive-light" | "secondary" | "outline">` for counts, metadata pills, and statuses.
- **Menus (`Menubar` + `ContextMenu`)**:
  - Use ReUI `<Menubar>` (`MenubarMenu`, `MenubarTrigger`, `MenubarContent`, `MenubarGroup`, `MenubarLabel`, `MenubarItem`, `MenubarCheckboxItem`, `MenubarRadioGroup`, `MenubarRadioItem`, `MenubarSub`, `MenubarSubTrigger`, `MenubarSubContent`, `MenubarShortcut`, `MenubarSeparator`) for persistent module command bars—such as Persora Table Spreadsheet and Smart Table editors.
  - Use ReUI `<ContextMenu>` (`ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuGroup`, `ContextMenuLabel`, `ContextMenuItem`, `ContextMenuCheckboxItem`, `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent`, `ContextMenuShortcut`, `ContextMenuSeparator`) for right-click / `Shift+F10` surfaces such as Persora Table spreadsheet cells and Smart Table records. Both primitives portal to `document.body` (`z-[280]`) and bind strictly to `--ds-overlay-bg`, `--ds-border`, `--ds-subtle-bg`, and `--ds-shadow-popover`.
- **Global Destructive Confirmation (`PersoraDeleteModal`)**:
  - Use `<PersoraDeleteModal>` from `@/design-system` for every delete, disconnect, or irreversible confirmation flow across the app (`ConfirmDialog`, Contacts, Timeline, Medical Records, Business Cards, Habits, Loans, Connections, Password Manager, Persora Table, Persora Forms, and Account Settings).
  - **Clean layout (canonical):** a centered card — optional eyebrow, title, one-line impact copy, then a **full-width destructive confirm button stacked above a full-width Cancel button**. There is no header icon, no header divider and no close button; the destructive action always comes first visually and last in DOM focus order, and `Escape`/backdrop/scrim click cancel.
  - `<PersoraDeleteModal>` portals directly to `document.body` (`z-index: 220`, above `.workspace-sidebar`, `.workspace-topbar`, and parent `ItemModalShell` dialogs) with `role="alertdialog"`, `aria-modal="true"`, `backdrop-filter: none`, capture-phase `Escape` dismissal and `<Spinner />` busy state—preventing confirmation dialogs from ever rendering trapped inside a page container beside or behind the sidebar. Focus starts on Cancel so an accidental `Enter` never destroys anything.
  - Every destructive surface must route through this component (`ConfirmDialog` in `src/components/VaultDialogs.tsx` is a thin wrapper). Do not hand-roll one-off confirm styling.

---

## 5. Layout & CSS Authoring Rules (Mandatory for Future Updates)

1. **Never hardcode a font family**:
   Use `var(--ds-font-sans)` / `var(--ds-font-mono)` (or `var(--ds-sidebar-font)` inside the navigation rail). A raw `font-family: "Some Font", ...` stack in a module stylesheet is a regression — `tests/design-system.test.mjs` fails the build on it. (Exception: PDF rasterisation font strings in `src/lib/pdf-*.ts`, which are written into exported files.)
2. **Never hardcode light-only colors (`#fff`, `#f8fafd`, `#202124`, `#e8eaed`) or `!important` theme overrides**:
   Always reference `var(--ds-*)` tokens (`--ds-card-bg`, `--ds-subtle-bg`, `--ds-input-bg`, `--ds-overlay-bg`, `--ds-text`, `--ds-text-secondary`, `--ds-text-muted`, `--ds-border`, `--ds-border-strong`, `--ds-divider`). Every `var(--ds-*)` reference is audited against `src/design-system/tokens.css` by `tests/design-system.test.mjs`.
3. **Prevent text-over-icon collisions by construction**:
   - Prefer **flex-shell inputs** (`<PersoraSearchField>` or `display: inline-flex; align-items: center; gap: 8px;`) where leading/trailing icons are flex siblings (`flex-shrink: 0`) beside a borderless `<input className="min-w-0 flex-1 bg-transparent">`—text can never overlap the icon regardless of font size or zoom.
   - If an input uses an absolutely positioned icon, place `padding-left: 2.5rem` (`40px`) on the input and `pointer-events: none` on the icon.
   - Keep `<label className="field-label">` as `display: block` so inline `<span className="required-star">*</span>` and `<small>Optional</small>` stay on the same line as the label text while direct form controls (`> input, > select, > textarea`) sit `6px` below.
4. **Protect ReUI `<span>` primitives from legacy child selectors**:
   ReUI `<IconTile>` (`data-slot="icon-tile"`) and `<Badge>` (`data-slot="badge"`) render `<span>` elements. Never write unscoped `.parent > span { width: ...; background: ...; }` selectors in CSS; target explicit classes or `:not([data-slot])`.
5. **Remove old layers before adding new layers**:
   When migrating or updating a view, delete superseded CSS rules and legacy wrapper markup rather than stacking overrides on top.

---

## 6. Template & Starter Cards (Persora Table / Docs / Forms)

Every template card and every empty "add" card across the three document products uses one shared geometry so the three shelves can never drift apart:

| Aspect | Contract |
| --- | --- |
| Component | `<TemplateCardThumb gradient?={templateGradient(index)}>` from `src/components/shared/template-card.tsx` — the preview area of a starter card. Page stylesheets add only grid layout and interaction states. |
| Geometry | **224 × 157px** preview (`--ds-template-card-width: 224px`, `--ds-template-card-height: 157px`), `--ds-template-card-gap: 6px` under the caption rows. `.ds-template-thumb` is the only rule that declares a size, so a Table, Docs or Forms card can never be a different width or height — nothing else may set a card height. |
| Shelf rhythm | `--ds-template-shelf-columns: 5` — five cards per row with the sidebar rail open, **six** with the collapsed icon rail (`.workspace-shell:has(.workspace-sidebar.is-collapsed)` raises the variable to 6 for `.tb-/pd-/pf-start-shelf`). Grids use `repeat(var(--ds-template-shelf-columns), minmax(0, var(--ds-template-card-width)))` with `justify-content: start`, so the column count changes while the card width stays exactly 224px. |
| Shelf surface | All three shelves use `--ds-shelf-bg` = **`#F6F7FB` (rgb(246, 247, 251))** with a `--ds-border` hairline and `--ds-radius-md`. |
| Surface | `.ds-template-thumb` owns border (`--ds-border-strong`), radius (`--ds-radius-xs`), overflow clipping, base `--ds-card-bg` and the optional gradient. Per-product classes (`.tb-starter-thumb`, `.pd-starter-thumb`, `.pf-starter-thumb`) no longer declare sizes, borders or backgrounds. |
| Gradients | `--ds-template-gradient-1…5` in `tokens.css`, applied left-to-right on the **header band only**: `rgb(87,154,252)→rgb(87,99,252)`, `rgb(255,90,194)→rgb(253,91,115)`, `rgb(253,172,62)→rgb(250,212,63)`, `rgb(1,187,177)→rgb(1,198,129)`, `rgb(255,119,90)→rgb(255,163,90)`. No overlays, no banding — one raster, `background-size: 100% 100%`. |
| Preview | The white document preview stays white: inside a gradient band the miniature surface is made transparent and `.tb-mini-sheet-paper` / `.pd-mini-paper` keep `#ffffff`, floating on the band with a soft shadow. Captions, borders, radii and spacing are unchanged. |
| Band framing | The gradient frames the preview on **three sides only** — left, right and top spacing (`padding: 10px 12px 0` on `.tb-mini`, `justify-content: flex-start`) — so the Persora Table card runs off the bottom edge exactly like the Persora Docs card. There is no bottom gap and no gradient strip under the paper. |
| Scope | Persora Table and Persora Docs template cards carry the gradient ramp (blank cards stay neutral white); Persora Forms keeps neutral cards but inherits the shared height. |

---

## 7. Tasks & Notes — Full-Page Editor

Tasks & Notes no longer opens a drawer. Plain notes (`section.id === "notes"`, i.e. records **without** `recordType` of `todo` / `reminder` / `alarm`) render `NoteEditorPage` as the workspace page surface:

| Aspect | Contract |
| --- | --- |
| Route | `App.tsx` keeps `editor.section === "notes"` and passes `<NoteEditorPage>` to `Workspace` via the `notePage` prop; `ItemEditorDialog` is only mounted for `editor.section !== "notes"`. Tasks, reminders and alarms still use the `TodoEditorDialog` drawer. |
| Chrome | `.workspace-content.workspace-content-note-page` drops padding/max-width and the workspace **topbar** steps aside (`.workspace-main:has(.note-page) > .workspace-topbar`), so the page owns the content area like Persora Docs. The workspace footer keeps its place underneath the page, in normal flow (`position: static`) — it is **not** sticky and there is no page-level footer. |
| Layout | `.note-page-bar` (back button + `Tasks & Notes › title` breadcrumb + autosave state + `Create note` / `Done`) → `.note-page-scroll` → `.note-page-sheet` (760px measure) → tags. No `footer.note-page-footer`, no cancel/save action bar. |
| Typography | Borderless `.note-page-title` (30–40px, `--ds-font-heading`) that reads as page text, not a field — the workspace blanket input rules explicitly exclude `.note-page-title` / `.note-page-tag-input`. |
| Body | The shared `RichNoteEditor` (toolbar: bold, italic, underline, strike, bulleted list, numbered list, checklist, clear formatting, then the attachment and page-background tools) with `showHint={false}`; content is sanitized with `sanitizeNoteHtml` before saving. |
| No focus edge | `div.rich-note-editor` is fully borderless and ringless on the note page: the legacy `:focus-within` light-blue border and 3px blue wash from `persora-theme.css` are explicitly cleared for `.rich-note-editor`, its `:focus`/`:focus-visible` states and `.rich-note-content`, so focusing the body paints **no** soft blue edge. |
| Lists | The three list tools never rely on `execCommand`: `applyList("ul" \| "ol" \| "check")` rebuilds the selected top-level blocks into one `<ul>` / `<ol>` (checklists prefix each `<li>` with a real `<input type="checkbox">`) and unwraps them back into paragraphs when the same tool is used again. The caret is placed at the end of the result, and the DOM is never restructured while typing. |
| Attachments | The old attachment section is **removed** (not hidden). `Paperclip` inside `div.rich-note-toolbar` opens the picker; without an active paid plan the icon renders frozen (`disabled`, `aria-disabled`, lock badge, explanatory `title`). A chosen file shows as a compact `.note-page-attachment-chip` under the body; it is uploaded on the next autosave. |
| Page background | `Palette` in the same toolbar opens a swatch menu (`--ds-note-surface-paper/sand/mint/sky/blush/lilac`) that writes `data-note-surface` on `.note-page-sheet`. Light tints only, with deep tints in Dark mode; the value is stored in `metadata.surface`. |
| Autosave | 900ms debounce after the last edit (like Persora Docs' `DocSaver`), an in-flight queue, `Cmd/Ctrl + S` to save now, and a flush before `Escape` or `Done` closes the page. `App.tsx` exposes `handleSaveNoteDraft` (built on `persistVaultItem`) which saves **in place** and returns `{ id, file }` so the page updates the same note instead of creating duplicates. An empty new note is never persisted just by opening it. Status chip: `Autosave on` → `Unsaved changes` → `Saving…` → `Saved`, or `Save failed · Retry`. |
| Safety | Nothing is discarded silently: closing flushes pending edits first, and a failed save keeps the page open with the text intact and a Retry action. |
| Tokens | Every color in `note-editor-page.css` is a `--ds-*` token, so Light, Dark and System themes are automatic. |
