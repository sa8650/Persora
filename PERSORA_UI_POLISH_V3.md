# Persora — Template Cards, Autosaving Notes, 60px Shell

**Commit:** `174c1fa` — *UI polish: shared template cards, autosaving note page, 60px shell headers*
**Repo:** https://github.com/sa8650/Persora · branch `main`
**Patch:** `/home/user/persora-ui-polish-v3.patch` (`git format-patch -1`)
**Screenshots:** `/home/user/persora-screens-v3/`

| Check | Result |
| --- | --- |
| `tsc -b --pretty false` | clean |
| `npm run build` | ✓ built in 16.29s |
| `node --test tests/*.test.mjs` | 501 tests — 498 pass, 1 pre-existing fail (`sanitizeProjectInput`), 1 load-flake DB suite (`loans-db`, passes 10/10 on its own) |
| New/updated regression tests | `tests/ui-polish-updates.test.mjs` → **11/11 pass** |

---

## 1. One card height for every template and "add" card

| Product | Cases | Height |
| --- | --- | --- |
| Persora Table | 2 blank cards + 4 template cards | **140px** each |
| Persora Docs | 1 blank + 4 template cards | **140px** each |
| Persora Forms | 1 blank + 4 template cards | **140px** each |
| Shelves | `.tb-start-shelf`, `.pd-start-shelf`, `.pf-start-shelf` | identical padding, radius, background and card row → same shelf height |

New canonical tokens (`src/design-system/tokens.css`):

```css
--ds-template-card-height: 140px;      /* whole card: thumb + captions */
--ds-template-thumb-min-height: 88px;
--ds-template-card-gap: 6px;
```

`.tb-starter-card`, `.pd-starter-card` and `.pf-starter-card` now all read `height: var(--ds-template-card-height)`, the thumb flexes inside that height, and the old scattered `height: 124px` / `height: 108px` declarations were deleted. Mobile shelves override the tokens to `128px` (≤820px) / `128px` (≤680px for Table).

## 2. Accurate gradient header bands (Table + Docs only)

New shared component `src/components/shared/template-card.tsx` (`TemplateCardThumb`, `templateGradient`, `TEMPLATE_GRADIENTS`) + `template-card.css`. The gradient lives in the token layer and is painted **once** on the header band (`background-size: 100% 100%`, no overlays, no extra layers):

| Card | Gradient (exact stops) |
| --- | --- |
| 1 | `linear-gradient(90deg, rgb(87,154,252), rgb(87,99,252))` |
| 2 | `linear-gradient(90deg, rgb(255,90,194), rgb(253,91,115))` |
| 3 | `linear-gradient(90deg, rgb(253,172,62), rgb(250,212,63))` |
| 4 | `linear-gradient(90deg, rgb(1,187,177), rgb(1,198,129))` |
| 5 | `linear-gradient(90deg, rgb(255,119,90), rgb(255,163,90))` |

* The **white document preview stays white**: inside a gradient band the mini surface is made transparent and `.tb-mini-sheet-paper` / `.pd-mini-paper` keep `#ffffff` with a soft shadow, so the preview floats on the band (monday.com-style, matching your reference).
* Blank "add" cards stay neutral white; Persora Forms keeps neutral cards but inherits the shared geometry.
* `src/components/shared/template-card.css` is the only place that owns size, border, radius, surface and gradient — the three page stylesheets now declare layout only, and `tests` fail if a page re-declares a card size.

## 3. Tasks & Notes page — autosave, toolbar attachments, page colour

| Item | What changed |
| --- | --- |
| Edge highlight on `div.rich-note-editor` | Gone. The note body is borderless; nothing lights up on click. |
| Attachment section | **Deleted** (`ReuiFileAttachmentField` block + `.note-page-attachment` CSS). A `Paperclip` icon now sits in `div.rich-note-toolbar`. Without an active plan it is *frozen*: `disabled`, `aria-disabled`, lock badge and an explanatory tooltip. A picked file shows as a compact `.note-page-attachment-chip` under the body and uploads on the next autosave. |
| Saving | **Automatic**, exactly like Persora Table/Docs: 900ms debounce, in-flight queue, `Cmd/Ctrl+S` for now, flush before closing. Status chip: `Autosave on → Unsaved changes → Saving… → Saved`, plus `Save failed · Retry`. Nothing is discarded: a failed save keeps the page open with the text intact. |
| Duplicate-proof | `App.tsx` now exposes `handleSaveNoteDraft` (built on the extracted `persistVaultItem`) which saves **in place** and returns `{ id, file }`, so every autosave updates the same note instead of creating a new one. An empty new note is never persisted by merely opening it. |
| List tools **fixed** | Checklist / numbered / bulleted were broken (a toolbar click lost the caret, so the next keystrokes landed at the start of the note, and toggling left invalid `<span style>` + bare text nodes). All three now go through `applyList("ul" \| "ol" \| "check")`, which rebuilds the selected top-level blocks into one real list (checklists get real `<input type="checkbox">` items), unwraps them back to paragraphs on a second click, and always places the caret at the end of the result. The DOM is never restructured while typing. |
| Page background | `Palette` in the same toolbar opens a "Page background" swatch menu — Default, Paper, Warm sand, Mint, Sky, Blush, Lilac (`--ds-note-surface-*`, light tints; deep tints in Dark mode). Stored as `metadata.surface` and applied via `data-note-surface` on `.note-page-sheet`. |
| Footer | `footer.note-page-footer` and all its buttons **deleted** — no sticky bar. The workspace footer takes its place underneath the page (`position: static`), as requested. The topbar `Create note` / `Done` button is the only explicit action. |

## 4. Sidebar header / navigation read as one frame

`border-bottom: 1px solid var(--ds-divider)` removed from `.sidebar-header` (and from the mirrored `persora-theme.css` rule). Verified in the browser: `sidebar-header` bottom border `0px`, nav top border `0px`.

## 5. 60px shell headers

| Element | Before | After |
| --- | --- | --- |
| `.sidebar-header` | 70px (74px in the theme layer) | **60px**, padding `0 12px 0 18px`, toggle 28px |
| `.workspace-topbar` | 70px (74px) | **60px**, `h1` 17px, “Add document” 34px, icon buttons 34px |
| Mobile | — | `height: auto; min-height: 60px` below 820px so the wrapped bar can never clip |

`70px`/`74px` app-shell header heights are gone from `system.css`, `console-refinements.css`, `persora-theme.css` and `workspace.css`; the admin console keeps its own scale.

## 6. Bugs found & fixed

1. **List tools** (caret loss + broken markup) — see above.
2. **Caret jump while typing** — normalising the editor DOM on every keystroke moved the caret (typed text ended up reversed/at the start). Normalisation now only runs inside the list commands.
3. **Escape closed the whole note** when only the colour popover was open — the popover now handles Escape and stops propagation.
4. **Duplicate notes** risk on autosave — solved by returning the saved id/file from `App` and by keeping the saved attachment reference across debounces.
5. **Theme-layer drift** — `persora-theme.css` still declared 74px headers behind the 70px system rule; both layers now agree.

## Verification highlights

* Card heights measured in the browser: Table / Docs / Forms cards = **140px** each (blank and template), gradient `background-image` resolves to the exact `rgb()` stops above.
* Note page: typing → `Saved`; closing → note present in the Tasks & Notes list (screenshot 06); sand/mint surfaces persist through a reload.
* Shell: `topbar` 60px, `sidebar-header` 60px, no divider.
* Screenshots: `01-shell-headers-60px`, `02-note-page-empty`, `03-note-page-autosaved`, `04-note-background-picker`, `05-note-page-mint-surface`, `06-note-autosaved-in-list`, `07-template-shelves-gradients`, `08-note-page-dark`, `09-collapsed-rail-60px`.

> Note on screenshot 07: Persora Table/Docs require a registered account (demo mode shows an account-required state), so the three shelves were rendered from the shipped markup + the shipped CSS (`?direct`) in the running app and captured side by side. Card heights and computed `background-image` values were read from that render (numbers above).

## Files touched

`src/design-system/tokens.css` · `system.css` · `src/console-refinements.css` · `src/persora-theme.css` · `src/workspace.css` · `src/components/shared/template-card.{tsx,css}` (new) · `src/components/table/table.css` · `TableHome.tsx` · `src/components/docs/docs.css` · `DocsHome.tsx` · `src/components/forms/forms.css` · `FormsDashboard.tsx` · `src/components/notes/NoteEditorPage.tsx` · `note-editor-page.css` · `src/components/VaultDialogs.tsx` · `src/App.tsx` · `DESIGN_SYSTEM.md` · `tests/ui-polish-updates.test.mjs`
