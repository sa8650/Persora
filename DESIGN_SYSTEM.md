# Persora UI/UX Design System

The **Persora UI/UX Design System** is the canonical visual, theming, primitive, and layout foundation for the entire Persora workspace. Every module, card, drawer, modal, form control, empty state, and icon builds on `src/design-system/` and the in-repo ReUI + shadcn component library so future features and migrations stay cohesive across **Light**, **Dark**, and **System** appearance modes.

---

## 1. Architecture & File Map

| Path | Responsibility |
| --- | --- |
| `src/design-system/tokens.css` | Single source of truth for `--ds-*` design tokens across `:root` (Light) and `.dark, [data-theme="dark"]` (Dark), plus shadcn (`--background`, `--card`, `--popover`, `--sidebar`, `--border`, `--ring`) and workspace (`--p-*`) semantic bridges. Imported first in `src/index.css`. |
| `src/design-system/system.css` | Canonical layout shell, surface hierarchy, structural dividers, card themes, drawer/modal surfaces, icon-safe inputs, segmented tabs, and dark-mode contrast rules. Imported last in `src/main.tsx` so design-system surfaces govern legacy module stylesheets cleanly. |
| `src/design-system/theme.tsx` | `PersoraThemeProvider`, `usePersoraTheme()`, topbar `ThemeToggleButton`, and Settings `AppearanceSettingsCard` (`Light` / `Dark` / `System`, persisted in `localStorage["persora.theme"]` and synchronized to `<html class="dark" data-theme="...">`). |
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
| **Navigation Rail** | `--ds-sidebar-bg` | `#F8FAFC` | `#0B0F17` | `.workspace-sidebar`, separated from the page canvas by `1px solid var(--ds-divider)` |
| **Page Canvas** | `--ds-canvas-bg` | `#F1F5F9` | `#101622` | `.workspace-main` / `.workspace-content` background |
| **Topbar & Footer** | `--ds-topbar-bg` / `--ds-footer-bg` | `rgba(255,255,255,0.92)` / `#F8FAFC` | `rgba(16,22,34,0.94)` / `#0D131D` | Bounded by `1px solid var(--ds-divider)` |
| **Elevated Card** | `--ds-card-bg` | `#FFFFFF` | `#161F2E` | `MagicCard`, `.metric-card`, `.vault-item-card`, hero banners, filter toolbars, module panels |
| **Subtle / Recessed** | `--ds-subtle-bg` / `--ds-input-bg` | `#F8FAFC` / `#FFFFFF` | `#111826` / `#111826` | Inputs, selects, textareas, readonly fields, locked-upload notices, segmented tracks |
| **Overlay / Drawer** | `--ds-overlay-bg` | `#FFFFFF` | `#172032` | Modals, right-hand drawers (`AddDocumentDrawer`, `TodoItemDialog`, `VaultNoteDialog`), popovers, command search |

### Modal & Drawer Performance Rule
All modal backdrops and slide-over drawers use crisp outside-fade scrims (`background: var(--ds-scrim); backdrop-filter: none; -webkit-backdrop-filter: none;`) rather than Gaussian `backdrop-filter: blur(...)`. While any modal/drawer is open, background hover listeners on `.workspace-shell` are paused (`pointer-events: none`) while overlay portals keep `pointer-events: auto`, ensuring smooth 60fps scrolling and typing.

---

## 3. Unified ReUI Component & Icon System

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
  - `<PersoraDeleteModal>` portals directly to `document.body` (`z-index: 220`, above `.workspace-sidebar`, `.workspace-topbar`, and parent `ItemModalShell` dialogs) with `role="alertdialog"`, `aria-modal="true"`, `backdrop-filter: none`, capture-phase `Escape` dismissal, `<IconTile>` header badge, and `<Spinner />` busy state—preventing confirmation dialogs from ever rendering trapped inside a page container beside or behind the sidebar.

---

## 4. Layout & CSS Authoring Rules (Mandatory for Future Updates)

1. **Never hardcode light-only colors (`#fff`, `#f8fafd`, `#202124`, `#e8eaed`) or `!important` theme overrides**:
   Always reference `var(--ds-*)` tokens (`--ds-card-bg`, `--ds-subtle-bg`, `--ds-input-bg`, `--ds-overlay-bg`, `--ds-text`, `--ds-text-secondary`, `--ds-text-muted`, `--ds-border`, `--ds-border-strong`, `--ds-divider`). Every `var(--ds-*)` reference is audited against `src/design-system/tokens.css` by `tests/design-system.test.mjs`.
2. **Prevent text-over-icon collisions by construction**:
   - Prefer **flex-shell inputs** (`<PersoraSearchField>` or `display: inline-flex; align-items: center; gap: 8px;`) where leading/trailing icons are flex siblings (`flex-shrink: 0`) beside a borderless `<input className="min-w-0 flex-1 bg-transparent">`—text can never overlap the icon regardless of font size or zoom.
   - If an input uses an absolutely positioned icon, place `padding-left: 2.5rem` (`40px`) on the input and `pointer-events: none` on the icon.
   - Keep `<label className="field-label">` as `display: block` so inline `<span className="required-star">*</span>` and `<small>Optional</small>` stay on the same line as the label text while direct form controls (`> input, > select, > textarea`) sit `6px` below.
3. **Protect ReUI `<span>` primitives from legacy child selectors**:
   ReUI `<IconTile>` (`data-slot="icon-tile"`) and `<Badge>` (`data-slot="badge"`) render `<span>` elements. Never write unscoped `.parent > span { width: ...; background: ...; }` selectors in CSS; target explicit classes or `:not([data-slot])`.
4. **Remove old layers before adding new layers**:
   When migrating or updating a view, delete superseded CSS rules and legacy wrapper markup rather than stacking overrides on top.
