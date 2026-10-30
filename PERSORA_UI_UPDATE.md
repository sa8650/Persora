# Persora — Workspace Colors & Typography Update

Applied directly to the cloned repo at `/home/user/Persora` (branch `main`, commit on top of `ce09a51`).
A ready-to-apply patch is at `/home/user/persora-workspace-typography.patch`.

```bash
cd Persora && git am ../persora-workspace-typography.patch     # apply the whole update
# or inspect it:  git apply --stat ../persora-workspace-typography.patch
```

## 1. What changed

| Requirement | Result |
|---|---|
| Workspace background `rgb(238,242,247)` → `#FFFFFF` | `--ds-canvas-bg: #ffffff` in `tokens.css`. Every surface bound to it (`--p-bg`, `--background`, `.workspace-shell`, `.workspace-main/.content`, module shells in calendar/table/docs/habits/loans/connections, landing/public pages) flips at once — no scattered overrides. |
| Sidebar background `rgb(247,249,252)` → `rgb(246,247,251)` | `--ds-sidebar-bg: #f6f7fb`. `--ds-footer-bg` moved to the same `#f6f7fb` so the footer rail matches. Dark mode values untouched. |
| Sidebar typography: Geist Sans 13px, `#676879` | New tokens `--ds-sidebar-font`, `--ds-sidebar-font-size: 13px`, `--ds-sidebar-font-weight: 500`, `--ds-sidebar-text: #676879` (+ `--ds-sidebar-label-size/-color` for group eyebrows). Applied to `.workspace-sidebar`, `.sidebar-link`, `.nav-count`, group labels, secure card and profile row in `system.css` — the canonical stylesheet that loads last, so it wins over the legacy lines in `persora-theme.css`/`workspace.css`. |
| Replace Noto Sans with Geist Sans everywhere | Geist Sans is now the single UI typeface: `--ds-font-sans` token + one global assignment in `system.css` (`html`, `body`, `button/input/optgroup/select/textarea`) + `code/kbd/samp/pre` → `--ds-font-mono`. No app CSS or component declares a font family anymore (enforced by a test). |
| Geist loaded properly + consistent font tokens | New `src/design-system/fonts.css` imports the self-hosted `@fontsource-variable/geist` (variable 100–900, `font-display: swap`, woff2 emitted into the bundle, no CDN). Imported **first** in `src/index.css`. Token family: `--ds-font-sans`, `--ds-font-mono`, `--ds-font-ui`, `--ds-font-body`, `--ds-font-heading`, bridged to Tailwind `--font-sans` / `--font-mono` in `@theme inline`. |
| Remove obsolete font declarations | Deleted the unused `@fontsource-variable/inter` dependency, the raw `font-family: Inter, …` stack in `src/components/docs/docs.css`, and the one in the Cloudflare printable-docs HTML (`cloudflare/docs-rules.js`) → Geist stack. No `Noto Sans` declaration remains in app UI CSS. |

### Deliberate exception
`src/lib/pdf-canvas.ts` / `pdf-studio.ts` keep their system stack (`Helvetica, Arial, "Noto Sans", "Noto Sans Bengali"`). That string is **embedded into exported PDFs** and used to rasterise non-Latin text — it is document rendering, not app UI type. Changing it would alter exported documents.

## 2. Files touched

```
DESIGN_SYSTEM.md              # typography + surface docs (new §3 Typography, white-canvas rule)
README.md                     # design-system summary line
index.html                    # theme-color #f8fafd -> #ffffff
package.json / package-lock    # + @fontsource-variable/geist, - @fontsource-variable/inter (dead)
cloudflare/docs-rules.js      # printable docs font stack
src/index.css                 # fonts.css import + Tailwind --font-sans/--font-mono bridge
src/design-system/fonts.css   # NEW — self-hosted Geist Sans loading
src/design-system/tokens.css  # canvas/sidebar/footer colors, font tokens, sidebar type tokens
src/design-system/system.css  # §0 global typography, sidebar type scale
src/components/docs/docs.css  # raw Inter stack -> var(--ds-font-sans)
tests/design-system.test.mjs  # surface contract + new typography contract test
```

## 3. Verification

- `npm run build` → **passes** (`tsc -b && vite build`); Geist woff2 files emitted into `dist/assets`.
- `npm test` → **487/490 pass**; the 2 failures (`sanitizeProjectInput validates name/kind and trims`, `loans backup export → restore`) are pre-existing on the untouched baseline (`git stash` re-run reproduced both — they are Supabase/PGlite harness issues, unrelated to styling).
- New test coverage in `tests/design-system.test.mjs`:
  - canvas must be `#ffffff`, sidebar must be `#f6f7fb`, both distinct, dark tokens distinct;
  - `@fontsource-variable/geist` present, `inter` absent, `fonts.css` imported;
  - `--ds-font-sans` starts with `"Geist Variable"`; `html`/`body`/form controls/`code` resolve from tokens;
  - sidebar link font-size/color come from `--ds-sidebar-*` tokens;
  - **every** `font-family` in `src/**/*.css` must be a `--ds-font*`/`--ds-sidebar-font` reference, `inherit`, or an intentional monospace stack; no `Noto Sans` (PDF renderer excepted).
- Browser checks (Chromium, live dev server), screenshots in `/home/user/persistora-screens/`:
  - `getComputedStyle(document.body).fontFamily` → `"Geist Variable", …`; `document.fonts.check('13px "Geist Variable"')` → `true` (font actually loaded, not falling back);
  - sidebar bg `rgb(246, 247, 251)`, sidebar ink `rgb(103, 104, 121)` (#676879), nav label 13px, eyebrow 10.5px, hub canvas `rgb(255, 255, 255)`;
  - inputs, buttons, badges, headings, tables, drawers, dialogs and the module footer all resolve to Geist;
  - Dark mode re-checked: sidebar ink `#CBD5E1`, surfaces unchanged, no white flash on white-canvas pages.

## 4. Regression risks worth a look in your environment

1. **White canvas + white cards.** Canvas and cards are now both `#FFFFFF` by design, so cards must keep their `1px solid var(--ds-border)` + `var(--ds-shadow-card)` edge. `MagicCard`/`.metric-card`/hero banners all do; if any module panel looks edgeless after the change, add the border token rather than reintroducing a grey canvas. (Documented as the "white-canvas rule" in `DESIGN_SYSTEM.md` §2.)
2. **13px sidebar labels** are wider than the previous 12/12.5px. The rail is 256px and the longest labels ("Password Manager", "Medical Records") still fit; check any custom/long workspace label you add later.
3. **`persora-theme.css` and `workspace.css` still contain legacy light-only hex values** for surfaces that the design system already overrides. They lost the cascade for the elements changed here, but they remain the biggest source of dark-mode drift — worth a separate cleanup pass.
4. **Printable docs / emails** now request Geist with graceful fallbacks; email clients will fall back to the system sans stack (Geist is not embedded there).
