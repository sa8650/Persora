# Persora — UI Polish Pass (9 updates)

Applied to `/home/user/Persora` on top of the colors/typography commit. Two commits, one patch:

```bash
cd Persora
git am ../persora-ui-polish.patch     # both commits (typography + this polish pass)
git apply --stat ../persora-ui-polish.patch   # or just review
```

(Only this pass: `git am ../persora-workspace-typography.patch` is still the first commit.)

---

## What changed

### 1. Sidebar close/open button (in the sidebar header)
- `<button class="sidebar-toggle-button">` sits in `.sidebar-header` next to the brand → `PanelLeftClose` when open, `PanelLeftOpen` when closed, with `aria-expanded` + `aria-controls` + tooltip.
- Collapsed state is persisted (`localStorage["persora.sidebar.collapsed"]`) and applied as `.workspace-sidebar.is-collapsed`.
- Desktop/tablet (`min-width: 821px`): rail animates 256px → **78px**; labels, count pills, group labels (become hairlines), secure card and the sign-out label hide, while every nav item keeps `aria-label` + `title` so the icon rail stays accessible.
- Mobile is untouched: below 821px the sidebar is still the off-canvas drawer with its scrim.

### 2. Global search is an icon
`.global-search-trigger` is now a 38px circular icon button (magnifier only) — no label, no `Ctrl/⌘K` chip. The shortcut still shows inside the command palette and lives in the `aria-label`/`title`. Legacy text-trigger rules were deleted from `persora-theme.css` + `workspace.css`, not overridden.

### 3. Dashboard subtitle removed
`DashboardView` no longer renders “Your live schedule, tasks, documents, renewals, and tools — arranged the way you work.”

### 4. Clean delete modal everywhere
`PersoraDeleteModal` (used by 15 components + the `ConfirmDialog` wrapper) was rebuilt to the reference layout in `image-1.png`:
- centered card, no header icon, no header divider, no close button;
- eyebrow (optional) → title → one-line impact copy (max ~34ch, muted);
- **full-width destructive action on top, full-width Cancel underneath**, 47px tall, 12px radius;
- still portaled to `document.body` (z 220), `role="alertdialog"`, `Escape`/backdrop cancel, focus starts on Cancel, spinner while busy. The `icon` prop is accepted but ignored (deprecated) so existing call sites keep compiling.

### 5. Persora Docs template sub-text removed
`span.pd-starter-sub` markup and its CSS rule are gone; starter cards show the template name only.

### 6. Sidebar profile → single logout button
`.sidebar-profile` + its `.user-popover` menu (account settings / billing / admin / sign out) and all related CSS/refs/effects were deleted. The rail now ends with the secure card and one `<button class="sidebar-logout">Sign out</button>` (rose hover). Account, plan and admin entry points remain in the topbar avatar, the Account nav group and the app launcher.

### 7. Photo Studio aside note removed
“Private to your account · edits run on this device” is no longer rendered under the PHOTOS stat.

### 8. Section-page aside notes removed
The `PersoraAsideStat` note “Organized for you. Private by default.” was dropped for **every** section page (Documents, Academics, Family, Study materials, Tasks & Notes, URL manager, …) by removing the `note`/`noteIcon` props at the single shared call site — the component itself still supports notes for future use.

### 9. Add/Edit note is a real page (Evernote-style)
New `src/components/notes/NoteEditorPage.tsx` + `note-editor-page.css`:
- **Bar**: back button, `Tasks & Notes › <title>` breadcrumb, “All changes saved / Unsaved changes” state, primary save.
- **Body**: quiet “Edited …” meta line, borderless **Title** (30–40px, reads as page text — the workspace input rules now exclude `.note-page-title` and `.note-page-tag-input`), then the shared rich-text editor (bold, italic, underline, strike, lists, checklist, clear formatting) with a borderless, sticky toolbar.
- **Meta**: tags row with live chips + optional private attachment (`ReuiFileAttachmentField`, replace/remove, upload progress).
- **Footer**: sticky action bar (privacy note, Cancel, Save/Create).
- `Cmd/Ctrl+S` saves, `Escape` closes, unsaved edits raise the clean “Discard these changes?” confirmation.
- Routing: `App.tsx` passes the page to `Workspace` through a new `notePage` prop when `editor.section === "notes"`; `ItemEditorDialog` is now mounted only for other sections, and the unreachable `notes-editor-drawer` CSS was removed. Tasks / reminders / alarms keep their existing drawer. On the page, the workspace topbar and footer step aside (`.workspace-main:has(.note-page)`) so the note owns the viewport like Persora Docs.
- Every color is a `--ds-*` token → Light, Dark and System all work (screenshots below).

---

## Verification

- `tsc -b` clean, `npm run build` green.
- `npm test`: 488/490 in the full run; the only real failure is the **pre-existing** `sanitizeProjectInput validates name/kind and trims` (fails on the untouched baseline too). DB suites that time out under parallel load pass individually (`calendar-items-db`, `connections-db`, `habits-db`, `table-db` all 0 failures).
- New `tests/ui-polish-updates.test.mjs` (6 tests) locks: header toggle + persistence, icon-only search, no profile menu + single sign-out, clean dialog structure/order, removed subtitles, and the note page wiring (`editor.section !== "notes"`, no `ItemModalShell` in the note page, token-only CSS).
- Browser checks (Chromium, live dev server): collapse→78px and persisted across reload, computed styles on the rail, note page create→save→appears in “Notes 1”, dark-mode note page, clean delete dialog, Photo Studio heading without the note. Screenshots in `/home/user/persora-screens/`.

## Notes / follow-ups

1. **Note auto-save**: saves are explicit (button, footer, `⌘S`) with an unsaved-changes guard. Evernote autosaves; if you want that next, the page can debounce `onSave` — it needs a “new note” id handshake so autosave doesn’t create duplicates.
2. **Profile navigation** was removed with item 6; everything is still reachable (avatar → settings, Account group → billing/trash/connections, launcher → everything, brand → overview). Say the word if you want a compact avatar row back in the rail footer next to Sign out.
3. **Heading subtitles** were removed only where you named them (items 3, 5, 7, 8). `PersoraAsideStat` still supports an optional note, so re-adding one anywhere is a one-prop change.
4. The legacy light-only hex values in `persora-theme.css` / `workspace.css` remain the main dark-mode drift risk — still worth a dedicated cleanup pass.
