# Persora Advanced Forms

A second surface inside **Persora Forms**: the standard Forms dashboard is unchanged, and a right-edge **Advanced Form** pull tab slides into a flexible, Paperform-style builder with its own dashboard, preview, publishing and responses.

Commit `7b74c63` · patch `/home/user/persora-advanced-forms.patch` · screenshots `/home/user/persora-screens-v5/`

---

## 1. Entry point and transition

| Piece | Behaviour |
| --- | --- |
| **Pull tab** | Fixed vertical tab hugging the right edge of the Persora Forms page (`AdvancedFormPullButton`, `aria-label="Open Persora Advanced Forms"`). Present on the standard dashboard *and* on the "needs your Persora account" state, so Advanced Forms works in the local sample session too. |
| **Transition** | `.pf-surface-slide` slides the advanced surface in from the right — 260 ms, `cubic-bezier(.22,.61,.36,1)`, 0 → 1 opacity — and back out (`is-back`) when you leave. No flashing, no scale or bounce; all motion is disabled under `prefers-reduced-motion`. |
| **Back** | `ArrowLeft` in the advanced dashboard header ("Back to Persora Forms") and in the builder/preview bars. |
| **Standard Forms** | Untouched: same dashboard, builder, responses, settings and API behaviour; the advanced surface short-circuits *before* the account gate and is session-scoped, so re-entering Persora Forms from the sidebar always lands on the standard dashboard. |

## 2. Dashboard

* **Template gallery** — horizontally scrollable rail with true miniatures of each template's real design, left/right arrows, and a "Template gallery" control that expands from 6 to all 8 templates. A blank-canvas card starts an empty form.
* **Recent advanced forms** — cards with live miniatures (so each form is recognisable by its own colours/background/layout), title, last-modified date, response count, `Published`/`Draft`, category, `Shared` and `Logic` badges.
* **Controls** — search (title, description, element labels), category dropdown (only categories actually used), sorting (last modified, created, name, most responses), grid ⇄ list toggle persisted in `localStorage["persora.advanced-forms.layout"]`.
* **Card menu** — Open in builder · Preview · Rename · Duplicate · Share / copy respondent link · View responses · Publish/Unpublish · Delete. Delete uses the shared `PersoraDeleteModal`; rename uses an Advanced Forms prompt dialog (`AdvancedMenu.tsx`) so the Forms workspace never has to load `table.css`. The menu flips upward when the card sits near the viewport bottom.

## 3. Builder

Three panes: **element library rail** · **canvas** · **inspector**, with the rail collapsible.

* **Design tab** — Theme (page background: gradient with presets/angle, solid, image + overlay, or none; form surface colour, radius, shadow, border), Type (family, body/title size, title weight, alignment, title/text/label colours), Layout (content width, 1–3 columns, element gap, section spacing, field spacing, padding, and the form's responsive behaviour), Fields & buttons (input radius, border, background, focus colour, button colour/text/radius, full-width submit).
* **Canvas** — the real renderer, so what you drag is what publishes. Per block: drag handle, move up/down, duplicate, delete, and `Full / ½ / ⅓` width presets inside the design's column grid. Selecting a block opens its **Element** settings (label, required, width, placeholder, help text, options editor, min/max, min/max length, validation pattern, star count, media URL, spacer height). New elements scroll into view instead of appearing below the fold.
* **Configure tab** — identity (title, description, category), submission behaviour (submit label, confirmation title/message, multiple responses), availability & limits (open/scheduled/closed, opens/closes, response limit, closed message, required-by-default), and a **conditional logic** builder (show/hide a later element based on an earlier answer, with all seven operators).
* **Responses tab** — counts, latest submission, questions answered, searchable table with per-question filter, per-response detail dialog, answer summary bars per question, CSV export and per-response delete.
* **Undo / redo** to 24 steps, live autosave ("Saved to this workspace"), and Preview / Publish in the topbar.

## 4. Element library (20)

Short text · Long text · Number · Email · Phone · Radio · Checkboxes · Dropdown · Date · Time · Colour picker · Rating · Image · Video · Audio · File upload · Heading · Paragraph · Divider · Spacer — each with the settings that matter for that type (choice options editable, text placeholder/length/validation, media source, spacer height).

## 5. Preview, publishing, respondent view

* **Preview** — builder-free frame with desktop / tablet / mobile widths, real design, and a "Respondent view" jump.
* **Respondent view** — the live form, inline `role="alert"` validation, focus on the first invalid control, the form's own confirmation screen after submit, and the availability/capacity gate (closed, scheduled, or at response limit) shown *before* any answers are collected.
* **Publishing** — stores the whole document (design + elements + settings) locally per account, so a published form reproduces the design exactly. `Share`/`Copy link` copies `…#advanced-form=<slug>`, which opens the respondent view directly.
* **Responsive forms** — the form surface is a CSS size container: below 480 px every element drops to one column and the submit button goes full width, which is exactly what the mobile preview shows.

## 6. Design-system compliance

* Zero new design tokens: `advanced-forms.css` only reads `--ds-*` and defines form-scoped `--aff-*` custom properties written by the renderer.
* `.workspace-content` input/select/textarea blanket rules now exclude `.aff-input`, so workspace chrome can never repaint a respondent's own control colours (this was a real bug caught in browser testing — dark templates rendered white inputs).
* Every `var(--ds-*)` audited against `tokens.css`; no raw font stacks; no bare element selectors; no `!important` theme overrides.
* Checkboxes use the shared ReUI `Checkbox` primitive; delete/confirm uses `PersoraDeleteModal`; Light/Dark themes both verified.

## 7. Verification

| Check | Result |
| --- | --- |
| `tsc -b` | clean |
| `npm run build` | ✓ |
| `node --test tests/advanced-forms.test.mjs` | 21/21 pass (new) |
| `design-system` + `ui-polish-updates` + new suite | 43/43 pass |
| Full suite (`--test-concurrency=2`) | 447/460; the 12 failures are pre-existing DB/route suites that fail under parallel load (`calendar-db`, `connections-db`, `dashboard-db`, `forms-module`, `habits-*`, `loans-routes`, `password-vault`, `table-db`, `table-sharing`) plus `ai-controls`' `sanitizeProjectInput` — all verified as failures on the untouched baseline, and all of the fixture-based suites re-run green individually. |
| Browser flows | pull tab → dashboard → template → builder (Design/Configure/Responses) → preview (desktop/tablet/mobile) → respondent → validation errors → submit → confirmation → responses table → CSV → rename → delete modal → back to standard Forms; 1728×900, 1280×800 and 430×900; Light and Dark. |

Screenshots: `/home/user/persora-screens-v5/` (dashboard, builder desktop/1280/mobile, configure, responses empty + with data, preview desktop/mobile, respondent errors + confirmation, menus, rename and delete dialogs, dark mode, pull tab).
