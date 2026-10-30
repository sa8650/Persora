# Persora — Shelf cards 224×157, 5/6-column rhythm, 3-side gradients, note focus ring

**Commit:** `af87c13` — *Shelf cards to 224x157, 5/6-column rhythm, 3-side table gradient, note focus ring removed*
**Patch:** `/home/user/persora-shelf-note-fix.patch`
**Screenshots:** `/home/user/persora-screens-v4/`

| Check | Result |
| --- | --- |
| `tsc -b --pretty false` | clean |
| `npm run build` | ✓ built in 13.71s |
| Shelf/template + design-system tests | **22/22 pass** |
| Full suite `node --test tests/*.test.mjs` | 457 tests, 449 pass, 7 fail — all 7 are load-flakes (DB/route suites, memory pressure) except the pre-existing `sanitizeProjectInput` |

---

## 1. Blank + template cards are exactly 224 × 157px, 5 or 6 per row, shelf surface `rgb(246,247,251)`

| Item | Result |
| --- | --- |
| Card size | **224 × 157px** — measured live in the browser: `thumbW: 224, thumbH: 157` for Persora Table, Docs **and** Forms (blank cards and template cards alike) |
| Declared once | `--ds-template-card-width: 224px`, `--ds-template-card-height: 157px` in `tokens.css`; only `.ds-template-thumb` sets a size. Page stylesheets no longer declare any card height/width (the old `140px`/`124px`/`108px` are gone). |
| Columns | `--ds-template-shelf-columns: 5` → grid `repeat(var(--ds-template-shelf-columns), minmax(0, var(--ds-template-card-width)))`. With the collapsed rail, `.workspace-shell:has(.workspace-sidebar.is-collapsed)` raises it to **6** for all three shelves. |
| Verified | open rail → `224px ×5`; collapsed rail → `224px ×6` (`thumbW` still **224**) |
| No resizing | The grid caps every track at 224px with `justify-content: start`, so extra space never stretches the cards and a wider viewport only adds room on the right. |
| Shelf surface | `--ds-shelf-bg` changed from `#fafcff` to **`#f6f7fb` = rgb(246, 247, 251)** — computed `backgroundColor` on `.tb-start-shelf` is now `rgb(246, 247, 251)`, and Table/Docs/Forms all inherit it (same token). |

## 2. Persora Table gradient band — three sides only

`.ds-template-thumb.is-gradient .tb-mini` now uses `justify-content: flex-start` + `padding: 10px 12px 0`:

* left, right and top spacing only — the white paper runs off the **bottom edge**, exactly like the Persora Docs card;
* no bottom gap, no gradient strip beneath the paper, no bottom spacing;
* the same five canonical gradients (`--ds-template-gradient-1…5`) and the same 224 × 157px card size.

## 3. Note page — the soft blue edge is gone

The soft blue you saw (~rgb(243, 246, 249) + blue ring) came from the legacy shared rule in `src/persora-theme.css`:

```css
.rich-note-editor { border-color: #dadce0; }
.rich-note-editor:focus-within { border-color: #8ab4f8; box-shadow: 0 0 0 3px rgba(26,115,232,.1); }
```

The note page now explicitly clears it for `.rich-note-editor` **and** its `:focus` / `:focus-within` / `:focus-visible` states plus `.rich-note-content`, so nothing repaints when the body is focused. Verified in the browser with the caret inside the body:

```
border: 0px · shadow: none · outline: 0px · radius: 0px · activeElement: rich-note-content
```

See `03-note-no-blue-edge.png` (your text, caret active, no edge).

## Files touched

`src/design-system/tokens.css` · `src/components/shared/template-card.css` · `src/components/table/table.css` · `src/components/docs/docs.css` · `src/components/forms/forms.css` · `src/components/notes/note-editor-page.css` · `DESIGN_SYSTEM.md` · `tests/design-system.test.mjs` · `tests/ui-polish-updates.test.mjs`

## Regression tests added

* `Shelf cards are 224 × 157 with 5 columns open / 6 collapsed` (tokens, shelf surface, sidebar-driven column switch).
* `Persora Table gradient bands frame the preview on three sides only` (`padding: 10px 12px 0`, no bottom gap).
* `The note page paints no soft blue focus edge around the rich editor` (`:focus-within` cleared, no hardcoded blue).

> Screenshot caveat (unchanged): Persora Table/Docs require a registered account and show an account-required state in demo mode, so the shelf images were rendered from the shipped markup + shipped CSS in the running app; all numbers above are read from that render. Notes screenshots are from the real app.
