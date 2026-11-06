# Persora UI/UX Design System

The **Persora UI/UX Design System** is the canonical visual, theming, primitive, and layout foundation for the entire Persora workspace. Every module, card, drawer, modal, form control, empty state, and icon builds on `src/design-system/` and the in-repo ReUI + shadcn component library so future features and migrations stay cohesive across **Light**, **Dark**, and **System** appearance modes.

---

## 1. Architecture & File Map

| Path | Responsibility |
| --- | --- |
| `src/design-system/fonts.css` | Self-hosted Geist Sans + Geist Mono webfont loading (`@fontsource-variable/geist` / `@fontsource-variable/geist-mono`). Declares font sources only; family assignment stays token-driven. Imported first in `src/index.css`. |
| `src/design-system/tokens.css` | Single source of truth for `--ds-*` design tokens across `:root` (Light) and `.dark, [data-theme="dark"]` (Dark), plus shadcn (`--background`, `--card`, `--popover`, `--sidebar`, `--border`, `--ring`) and workspace (`--p-*`) semantic bridges. Imported first in `src/index.css`. |
| `src/design-system/system.css` | Canonical layout shell, surface hierarchy, structural dividers, card themes, drawer/modal surfaces, icon-safe inputs, segmented tabs, and dark-mode contrast rules. |
| `src/design-system/typography.css` | Semantic element defaults and all 52 `text-{family}-{weight}` composite classes. Imported after `system.css` in `src/main.tsx`; never assigns text color. |
| `src/lib/cn.ts` | Shared `cn` configuration registering every typography composite in the font-size group. Import `cn` from `@/lib/cn` or `@/lib/utils`, never directly from the `cn` package. |
| `src/design-system/theme.tsx` | `PersoraThemeProvider`, `usePersoraTheme()`, topbar `ThemeToggleButton`, and Settings `AppearanceSettingsCard` (`Light` / `Dark` / `System`, persisted in `localStorage["persora.theme"]` and synchronized to `<html class="dark" data-theme="...">`). |
| `src/components/notes/NoteEditorPage.tsx` + `note-editor-page.css` | Full-page Tasks & Notes editor (Evernote-style): breadcrumb bar with autosave state, quiet meta line, borderless title, shared `RichNoteEditor` body (toolbar carries the attachment trigger and the page-background picker) and tags. Autosaves like Persora Table/Docs and has **no** page footer. Replaces the old right-hand note drawer. |
| `src/components/shared/start-shelf.tsx` | Shared Start Shelf primitive (`StartShelf`, `WorkspaceSidebarProvider`, `useWorkspaceSidebarCollapsed`, `getStartShelfVisibleLimit`) powering Persora Table, Persora Forms, and Persora Docs. Enforces sidebar-responsive single-row card limits (max 5 with expanded sidebar, max 6 with collapsed sidebar) and manual Template Gallery expansion/collapse. |
| `src/components/shared/template-card.tsx` + `template-card.css` | Shared starter/template card primitive (`TemplateCardThumb`, `templateGradient`, `TEMPLATE_GRADIENTS`, `TEMPLATE_GRADIENT_PALETTE`) used by the Persora Table, Persora Docs and Persora Forms shelves. Owns the single card geometry and paints the canonical 10-gradient band behind the white document preview. |
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

## 3. Typography — Persora Typography System v1

**Geist Sans is the only general-purpose UI typeface; Geist Mono is reserved for code and technical data.** Both are self-hosted through Fontsource (`font-display: swap`, no CDN or external font request), loaded once from `src/design-system/fonts.css`, and assigned through `--ds-font-*`. UI modules must not introduce another general-purpose family.

| Token | Responsibility |
| --- | --- |
| `--ds-font-sans` | Workspace, public, admin, card, dialog, form, navigation, table, and calendar UI |
| `--ds-font-mono` | Code, keycaps, formula bars, identifiers, wallet/card numbers, and other technical data |
| `--ds-font-ui` / `--ds-font-body` / `--ds-font-heading` | Geist Sans semantic aliases |
| `--font-sans` / `--font-mono` (Tailwind `@theme`) | Tailwind bridges to the same stacks |

Weights are limited to `--ds-font-weight-regular: 400`, `medium: 500`, `semibold: 600`, and `bold: 700`. `font-synthesis-weight: none` prevents synthetic bold.

### Scale and semantic roles

Every family has `--ds-type-{family}-size` and `--ds-type-{family}-line-height`; the two caption families also have `-letter-spacing`. Use the matching tokens together rather than a numeric size alone.

| Family | Size / line height | Tracking | Default role |
| --- | --- | --- | --- |
| Large Title | 64 / 80px | normal | Marketing/display hero |
| Display 1 | 56 / 72px | normal | Largest responsive display |
| Display 2 | 48 / 64px | normal | Landing-page display |
| Display 3 | 40 / 54px | normal | Page-level display |
| Display 4 | 32 / 44px | normal | Compact display/page hero |
| Title 1 | 24 / 34px | normal | Page title |
| Title 2 | 20 / 26px | normal | Section title |
| Title 3 | 18 / 26px | normal | Subsection/card-group title |
| Headline | 16 / 22px | normal | Card title/emphasized heading |
| Body | 14 / 20px | normal | Controls, labels, body copy |
| Body 2 | 13 / 18px | normal | Dense controls, grids, secondary copy |
| Caption 1 | 12 / 16px | 0.15px | Metadata, timestamps, help text |
| Caption 2 | 11 / 15px | 0.20px | Minor badges, tags, group eyebrows; never essential instructions or errors |

Essential interface text is at least Caption 1. Legacy 7–10px admin/module text was remediated; scaled document miniatures are not interface reading text and retain their intentional geometry.

### Composite classes and authoring

`src/design-system/typography.css` defines all **52** combinations using `text-{family}-{weight}`, for example `text-body-regular`, `text-body-medium`, `text-title-2-semibold`, and `text-display-4-bold`. A composite class owns family, size, line height, weight, and caption tracking where applicable; it never owns color. Do not combine one with competing Tailwind font-size, line-height, tracking, or weight utilities. The shared `cn` configuration treats composites as type families: the last family/size wins, while independent text-color classes are preserved. Tokenized Tailwind arbitrary values remain available where a primitive's variant definition must retain separate weight utilities.

Semantic defaults cover body text, headings, controls, tables, and technical elements. Display headings step down with existing responsive `clamp()` behavior. Browser zoom and text scaling remain intact; essential text must not be clipped by a new fixed-height container.

**Assignment rules (Light + Dark, all appearance modes):**
1. `system.css` assigns Geist Sans to the shell and browser controls; `typography.css` supplies semantic scale defaults.
2. `code`, `kbd`, `samp`, `pre`, `.ds-font-mono` resolve to Geist Mono. Mono never replaces Geist Sans for ordinary prose.
3. User-authored rich text, document font pickers, PDF/canvas output, chart geometry, file-type glyph fitting, emoji, and scaled template miniatures are deliberate exceptions to interface normalization; their functionality and content formatting are preserved.
4. Localised scripts and emoji use generic system fallbacks per glyph. PDF rasterisation keeps its export-specific `Helvetica/Arial/"Noto Sans"/"Noto Sans Bengali"` stack in `src/lib/pdf-canvas.ts`, outside app UI.

**Loading:** `fonts.css` is imported first in `src/index.css`, before Tailwind. No duplicate Inter/general-purpose font package or CDN font is used.

### Sidebar typography

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--ds-sidebar-font` | `var(--ds-font-sans)` | `var(--ds-font-sans)` | `.workspace-sidebar`, `.sidebar-link`, `.nav-group-label`, sidebar profile/footer cards |
| `--ds-sidebar-font-size` | Body 2: `13px` | Body 2: `13px` | Sidebar navigation labels and the account row |
| `--ds-sidebar-font-weight` | Medium: `500` | Medium: `500` | Resting nav item weight (`active` uses Semibold `600`) |
| `--ds-sidebar-text` | `#676879` | `#CBD5E1` | Resting sidebar ink; hover uses `--ds-text`, active uses `--ds-sidebar-active-text` |
| `--ds-sidebar-label-size` / `--ds-sidebar-label-color` | Caption 2: `11px` / `#8B8D9C` | Caption 2: `11px` / `#94A3B8` | Uppercase group eyebrows above each nav group |

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
| `DynamicIsland` + `PageToolbarHost` | There is no static `.workspace-topbar`. `PageToolbarHost` sits flush at `top: 0` (`margin-top: 0`, **50px** tall when active, `0px` when empty) and `DynamicIsland` (`.dynamic-island-anchor`, `top: 6px; left: 50%`) floats directly over it with symmetric centre morphing and zero hit-blocking outside the pill. |
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
- **Progress & Loading (`Progress` + Skullet `Skeleton` + `Spinner`)**:
  - Use `<TransferProgressIndicator>`, `<ImportProgressIndicator>`, `<StageProgressIndicator>`, or `<Progress value={percent} />` (`0–100`) for uploads/imports.
  - Use Skullet (`skullet/react`) as the unified loading placeholder. Wrap the real UI with `<Skeleton data={value} sample={SAMPLE} id="stable-key" label="Loading …">` so Skullet measures the destination layout. One `<PersoraSkulletProvider>` lives at the app root (`src/main.tsx`); do not add extra providers per page.
  - Lazy modules use `<SkeletonSuspense skeleton={<Sample />}>`. Charts, canvas, and PDF page previews that cannot be measured use `<SkeletonBox>` with explicit width/height (or aspect-ratio).
  - `reveal="smart"` holds skeletons back ~150ms so fast loads never flash, then crossfades or sequences content. Fades and shimmer honor `prefers-reduced-motion`. Call `forgetShapes()` on sign-out.
  - Keep `<Spinner>` for operations and processing waits whose result has no known shape (save, delete, upload processing, authentication, and similar actions), not as the default page-loading placeholder.
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
| Component | `<StartShelf>` from `src/components/shared/start-shelf.tsx` + `<TemplateCardThumb gradient?={templateGradient(index)}>` from `src/components/shared/template-card.tsx`. Page stylesheets add only grid layout and interaction states. |
| Geometry | **224 × 157px** preview (`--ds-template-card-width: 224px`, `--ds-template-card-height: 157px`), `--ds-template-card-gap: 6px` under the caption rows. `.ds-template-thumb` is the only rule that declares a size, so a Table, Docs or Forms card can never be a different width or height — nothing else may set a card height. |
| Shelf rhythm & visibility | `--ds-template-shelf-columns: 5` — maximum **5** visible cards in a single row with the sidebar rail open, maximum **6** visible cards in a single row with the collapsed icon rail (`.workspace-shell:has(.workspace-sidebar.is-collapsed)` raises the variable to 6 for `.tb-/pd-/pf-start-shelf`). Remaining cards stay hidden and never wrap into another row until the user clicks **Template gallery** (`Collapse gallery` when open), which manually expands/collapses all available templates and preserves manual expansion across sidebar toggles. |
| Shelf surface | All three shelves use `--ds-shelf-bg` = **`#F6F7FB` (rgb(246, 247, 251))** with a `--ds-border` hairline and `--ds-radius-md`. |
| Surface | `.ds-template-thumb` owns border (`--ds-border-strong`), radius (`--ds-radius-xs`), overflow clipping, base `--ds-card-bg` and the optional gradient. Per-product classes (`.tb-starter-thumb`, `.pd-starter-thumb`, `.pf-starter-thumb`) no longer declare sizes, borders or backgrounds. |
| Gradients | `--ds-template-gradient-1…10` in `tokens.css` (`TEMPLATE_GRADIENT_PALETTE`), all at `90deg`: (1) Blue–Indigo `rgb(87,154,252)→rgb(87,99,252)`, (2) Pink–Coral `rgb(255,90,194)→rgb(253,91,115)`, (3) Orange–Yellow `rgb(253,172,62)→rgb(250,212,63)`, (4) Teal–Green `rgb(1,187,177)→rgb(1,198,129)`, (5) Coral–Orange `rgb(255,119,90)→rgb(255,163,90)`, (6) Purple–Lavender `#7C3AED→#C084FC`, (7) Deep Navy–Sky Blue `#172554→#38BDF8`, (8) Lime–Soft Green `#65A30D→#D9F99D`, (9) Burgundy–Magenta `#881337→#E879F9`, (10) Graphite–Silver `#334155→#94A3B8`. No overlays, no banding — one raster, `background-size: 100% 100%`. |
| Preview | The white document preview stays white: inside a gradient band the miniature surface is made transparent and `.tb-mini-sheet-paper`, `.pd-mini-paper`, and `.pf-mini` cards keep `#ffffff` with legible ink in Light & Dark modes, floating on the band with a soft shadow. Captions, borders, radii and spacing are unchanged. |
| Band framing | The gradient frames the preview on **three sides only** — left, right and top spacing (`padding: 10px 12px 0` on `.tb-mini`, `justify-content: flex-start`) — so the Persora Table, Forms, and Docs cards run off the bottom edge cleanly. |
| Scope | Persora Table, Persora Forms, and Persora Docs template cards all share `templateGradient(index)` from the 10-gradient palette while blank starter cards remain neutral (`is-blank`). |

---

## 7. Tasks & Notes — Full-Page Editor

Tasks & Notes no longer opens a drawer. Plain notes (`section.id === "notes"`, i.e. records **without** `recordType` of `todo` / `reminder` / `alarm`) render `NoteEditorPage` as the workspace page surface:

| Aspect | Contract |
| --- | --- |
| Route | `App.tsx` keeps `editor.section === "notes"` and passes `<NoteEditorPage>` to `Workspace` via the `notePage` prop; `ItemEditorDialog` is only mounted for `editor.section !== "notes"`. Tasks, reminders and alarms still use the `TodoEditorDialog` drawer. |
| Chrome | `.workspace-content.workspace-content-note-page` drops padding/max-width and the workspace **topbar** steps aside (`.workspace-main:has(.note-page) > .workspace-topbar`), so the page owns the content area like Persora Docs. The workspace footer keeps its place underneath the page, in normal flow (`position: static`) — it is **not** sticky and there is no page-level footer. |
| Layout | `.note-page-bar` (back button + `Tasks & Notes › title` breadcrumb + autosave state + `Create note` / `Done`) → `.note-page-scroll` → `.note-page-sheet` (760px measure) → tags. No `footer.note-page-footer`, no cancel/save action bar. |
| Typography | Borderless `.note-page-title` (responsive Display 4–3, `--ds-font-heading`) that reads as page text, not a field — the workspace blanket input rules explicitly exclude `.note-page-title` / `.note-page-tag-input`. |
| Body | The shared `RichNoteEditor` (toolbar: bold, italic, underline, strike, bulleted list, numbered list, checklist, clear formatting, then the attachment and page-background tools) with `showHint={false}`; content is sanitized with `sanitizeNoteHtml` before saving. |
| No focus edge | `div.rich-note-editor` is fully borderless and ringless on the note page: the legacy `:focus-within` light-blue border and 3px blue wash from `persora-theme.css` are explicitly cleared for `.rich-note-editor`, its `:focus`/`:focus-visible` states and `.rich-note-content`, so focusing the body paints **no** soft blue edge. |
| Lists | The three list tools never rely on `execCommand`: `applyList("ul" \| "ol" \| "check")` rebuilds the selected top-level blocks into one `<ul>` / `<ol>` (checklists prefix each `<li>` with a real `<input type="checkbox">`) and unwraps them back into paragraphs when the same tool is used again. The caret is placed at the end of the result, and the DOM is never restructured while typing. |
| Attachments | The old attachment section is **removed** (not hidden). `Paperclip` inside `div.rich-note-toolbar` opens the picker; without an active paid plan the icon renders frozen (`disabled`, `aria-disabled`, lock badge, explanatory `title`). A chosen file shows as a compact `.note-page-attachment-chip` under the body; it is uploaded on the next autosave. |
| Page background | `Palette` in the same toolbar opens a swatch menu (`--ds-note-surface-paper/sand/mint/sky/blush/lilac`) that writes `data-note-surface` on `.note-page-sheet`. Light tints only, with deep tints in Dark mode; the value is stored in `metadata.surface`. |
| Autosave | 900ms debounce after the last edit (like Persora Docs' `DocSaver`), an in-flight queue, `Cmd/Ctrl + S` to save now, and a flush before `Escape` or `Done` closes the page. `App.tsx` exposes `handleSaveNoteDraft` (built on `persistVaultItem`) which saves **in place** and returns `{ id, file }` so the page updates the same note instead of creating duplicates. An empty new note is never persisted just by opening it. Status chip: `Autosave on` → `Unsaved changes` → `Saving…` → `Saved`, or `Save failed · Retry`. |
| Safety | Nothing is discarded silently: closing flushes pending edits first, and a failed save keeps the page open with the text intact and a Retry action. |
| Tokens | Every color in `note-editor-page.css` is a `--ds-*` token, so Light, Dark and System themes are automatic. |

---

## 8. Persora Advanced Forms (Persora Forms → Advanced)

Advanced Forms is a second surface of Persora Forms: the standard dashboard is untouched, and a right-edge pull tab slides into an advanced workspace with its own dashboard, builder, preview and respondent view.

| Aspect | Contract |
| --- | --- |
| Entry point | `AdvancedFormPullButton` in `FormsView.tsx` is the **only** entry: a fixed, right-edge vertical pull tab (`aria-label="Open Persora Advanced Forms"`) on the standard dashboard and on the "needs your Persora account" state, so Advanced Forms stays reachable even in the local sample session. The chosen surface persists in `localStorage["persora.forms.surface"]`. |
| Transition | `.pf-surface-slide` slides the advanced surface in from the right (`pf-surface-in`, 260ms, `cubic-bezier(.22,.61,.36,1)` + 0→1 opacity) and back out with `is-back`; the in-workspace surfaces use `.aff-view` / `.aff-view--back`. No flashes, no scale, no bounce — and every animation is disabled under `prefers-reduced-motion`. |
| Back | The `ArrowLeft` button in the advanced dashboard header (`Back to Persora Forms`) and in the builder/preview bars returns along the same path; standard Forms keeps every existing behaviour. |
| Tokens | `advanced-forms.css` reads `--ds-*` tokens only and defines no new design tokens. All per-form styling travels in `--aff-*` custom properties written by `AdvancedFormRenderer` from the form document, so one renderer paints the card miniature, the canvas, the preview and the published form identically. |
| Workspace chrome opt-out | `.workspace-content` input/select/textarea rules exclude `.aff-input`, so a respondent's own control colours (dark themes, custom borders, focus colour) are never repainted by workspace chrome. Any future global input blanket must keep that `:not(.aff-input)` exclusion. |
| Dashboard | Template rail (horizontal, arrows + "Template gallery" expander, miniatures of the real designs), then "Recent advanced forms" cards with live miniatures, modified date, response count, publish/share/logic badges and a three-dot menu. Search, category, sort and a **grid/list** toggle (persisted in `localStorage["persora.advanced-forms.layout"]`). |
| Cards menu | Advanced forms ship `AdvancedMenu` / `AdvancedPromptDialog` (`src/components/forms/advanced/AdvancedMenu.tsx`) instead of the Persora Table menu, so the Forms workspace never loads `table.css`. Delete still routes through the shared `PersoraDeleteModal`. |
| Builder | Three columns (element library rail · canvas · inspector) with the rail collapsible; below **1320px** the rail and inspector move under the canvas so the canvas keeps full width, and below 620px the topbar stacks. Height is viewport-bound (`min(calc(100vh - 250px), 720px)`), so there is no oversized panel or dead space. |
| Canvas | The canvas is the real renderer, so dragging reorders blocks with per-block tools (up / down / duplicate / delete) and `½` / `⅓` width presets resize them inside the design's column grid. Drag reorder never mutates a field's identity. |
| Responsive forms | `.aff-surface` is a size container (`container-type: inline-size`); below 480px every element collapses to a single column and the submit button goes full width, which is what the mobile preview and a phone-sized respondent see. |
| Validation | Answers are validated by the pure rules layer (`cloudflare/advanced-forms-rules.js`) — required, email/phone, min/max, length, rating range, choice membership — and hidden elements (conditional logic) are never validated. The respondent view shows inline `role="alert"` errors and focuses the first invalid control. |
| Publishing | Publishing keeps the whole document (`design` + `fields` + `settings`) locally, so the respondent view and preview reproduce the design exactly. `advancedFormGate` blocks closed/scheduled/at-limit forms with the form's own message before any answer is collected. |
