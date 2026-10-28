# Persora Calendar

A private, personal calendar in the Persora workspace (**Workspace → Calendar**). It uses Persora's custom authentication, Cloudflare Pages API, Supabase PostgreSQL database, and shared ReUI/shadcn UI primitives (`Spinner`, `Checkbox`, `ItemModalShell`, `CalPopover`).

## What members can do

- **Views:** Week (default on desktop and tablet), Month, Day, and Agenda (default on phones), with compact ~48px sticky day headers for maximum vertical schedule space. View selection is remembered per member and device.
- **Navigation:** **Today**, previous/next (per view), and a range heading button that opens a quick date picker. Wide screens also offer a collapsible mini-calendar sidebar.
- **Keyboard shortcuts:**

  | Key | Action |
  | --- | --- |
  | `t` | Today |
  | `←` / `→` | Previous / next |
  | `d`, `w`, `m`, `a` | Day, Week, Month, Agenda |
  | `c` | New event |
  | `/` | Search |

- **Create:**
  - Click a Week/Day time slot (top half → `:00`, bottom half → `:30`) or a Month date (all-day event) for **quick create**, or choose **More options** for the full editor.
  - Use **New event** or its split-menu chevron (**Quick add**, **Create event**, **Create task**, **Schedule appointment**).
- **Item fields & validation (enforced in browser, API, and Postgres):**
  - Title: required, 1–200 characters.
  - Timing: end cannot precede start; timed items must end strictly after they start; timed events and scheduled tasks can span up to 31 days; all-day items up to 366 days.
  - Optional location (up to 300 chars), description/notes (up to 2,000 chars), category color (Default, Personal, Work, Family, Health, Travel, Social, Other), reminder preset, and daily/weekly/monthly recurrence (interval 1–99, count 1–999, or end date) for events.
- **Edit, delete & search:**
  - Click any occurrence to view details, mark tasks complete/reopen, reschedule, edit, or delete. Repeating events prompt **This event** vs. **All events**.
  - Title search matches case-insensitively (up to 100 results) and jumps to and highlights the selected event.

## Smart scheduling

### Natural-language quick add (deterministic, local)

`src/lib/calendar-nlp.js` parses plain-English schedules locally in the browser with zero external AI calls (for example `"Dentist Friday at 4pm, remind me 30 minutes before"` or `"Submit report next Monday due at 11am"`). Extracted fields populate an editable preview, and any ambiguity (such as missing AM/PM, `5/11` date order, or unsupported weekday sets) surfaces one-tap clarifying questions before saving.

### Events, tasks, and appointments

| | Event | Task | Appointment |
| --- | --- | --- | --- |
| **Timing** | Timed (single- or multi-day, up to 31 days) or all-day | Timed (single- or multi-day, default 30 min, up to 31 days) or **No set time (due date only)** | Timed (date + time + duration) |
| **Fields** | Location, description | Optional description | Location, notes |
| **Repeats** | Yes | No | No |
| **Completion** | — | **Mark complete / Reopen** (pauses pending reminders while complete) | — |

### Move, two-way resize, and multi-day timed segmentation

- **Week and Day views:**
  - **Move:** Drag any timed block across times or days (15-minute snapping with edge auto-scroll; 350 ms long-press on touch).
  - **Two-way resize:** Drag either the **top handle (`resize-start`)** to adjust the start time/day or the **bottom handle (`resize-end`)** to adjust the end time/day, with a 15-minute minimum duration guard.
  - **Multi-day timed segmentation:** Timed events, tasks, and appointments that cross midnight render as continuous day-by-day segments across every covered column in Week and Day views (`00:00–24:00` per day slice) rather than collapsing into the all-day banner. Only the first segment exposes the top start-resize handle and only the final segment exposes the bottom end-resize handle, keeping multi-day drag and resize intuitive.
- **Month and all-day row:** Drag items across dates by whole days while preserving wall-clock times in the item's IANA time zone.
- **Keyboard & screen-reader alternative:** Every item detail popover includes a **Reschedule** dialog.
- **Optimistic save & concurrency:** Moves and resizes send `expectedRevision` (plus `seriesRevision` on occurrences); conflicting edits from another tab/device return `409 Conflict` and reload cleanly without silent overwrites.

### Conflict warnings & synced filters

- `POST /api/calendar/conflicts` checks overlaps against your timed events, appointments, and open scheduled tasks (up to 62 days / 60 occurrences for series) and suggests up to three nearby free slots (`07:00–22:00`). Warnings never block saving.
- The **Filters** popover (`SmartParts.tsx`, using ReUI `Checkbox`) toggles Events, Tasks, Appointments, completed tasks, and category colors. Filters are display-only and sync across devices via `calendar_preferences`.

## Time zones, recurrence, and reminders

- Timed items store UTC instants (`start_at`, `end_at`) plus `time_zone` (defaulting to the profile IANA zone, e.g. `Asia/Dhaka`), preserving wall-clock times across DST boundaries. All-day items store pure `YYYY-MM-DD` dates (`end_date` exclusive in storage, inclusive in forms).
- Repeating events store series rules on the parent row and single-occurrence edits or cancellations (`status = 'cancelled'`) as child exception rows (`series_id`).
- Reminders (`5m`, `15m`, `30m`, `1h`, `1d` before) are queued server-side in `calendar_reminders` and dispatched via `FOR UPDATE SKIP LOCKED` to the in-app notification bell, desktop notifications (while open with permission), and verified Brevo email when **Also email me** is checked. Dispatch runs via `pg_cron` + `pg_net`, an external scheduler calling `POST /api/internal/calendar-reminders` with `x-persora-cron-token: <CALENDAR_REMINDER_TOKEN>`, or opportunistic worker/tab polling.

## Database, API, and tests

- **Schema & migrations:** Fresh installs get the complete Calendar schema in `supabase/schema.sql`. Existing databases upgrading from before `2026-10-26` apply `supabase/migrations/20261026000000_calendar_multiday_resize.sql` so `calendar_events_item_type_check` and `persora_calendar_save_event` permit multi-day timed tasks up to 31 days. All tables (`calendar_events`, `calendar_reminders`, `calendar_preferences`) enforce RLS with zero browser-role privileges.
- **Routes:** `GET /api/calendar/meta`, `GET /api/calendar/events`, `GET /api/calendar/events/search`, `POST /api/calendar/events`, `GET|PATCH|DELETE /api/calendar/events/:id`, `POST /api/calendar/events/:id/completion`, `POST /api/calendar/conflicts`, `GET|PUT /api/calendar/preferences`, `GET|PATCH /api/calendar/reminders[/:id]`, and `POST /api/internal/calendar-reminders`.
- **Tests:** `tests/calendar-rules.test.mjs`, `tests/calendar-db.test.mjs`, `tests/calendar-items-db.test.mjs`, `tests/calendar-routes.test.mjs`, `tests/calendar-nlp.test.mjs`, plus Chromium E2E suites `npm run test:e2e:calendar` and `npm run test:e2e:calendar-smart`.

## Limitations

- The natural-language quick-add parser understands English phrasing only; unrecognized phrases become part of the title.
- Repeats support daily, weekly, or monthly intervals (`1–99`), without custom weekday sets or ordinal month rules.
- Desktop notifications require browser permission and an open Persora tab (email and bell notifications still run server-side when closed).
- Calendars are private per Persora account (no multi-user calendar sharing or external CalDAV sync yet).
