# Persora Calendar

A private, personal calendar in the Persora workspace (**Workspace → Calendar**). It uses Persora's sign-in, Pages API, Supabase database and design system. It adds no new external service and no new npm dependency.

## What members can do

- **Views:** Week (the default on desktop and tablet), Month, Day and Agenda (the default on phones). The choice is remembered per member and device.
- **Navigation:** **Today**, previous/next (per view) and a range heading that opens a date picker. On wide screens there is also a collapsible mini-calendar. Navigation never reloads the page.
- **Keyboard shortcuts:**

  | Key | Action |
  | --- | --- |
  | `t` | Today |
  | `←` / `→` | Previous / next |
  | `d`, `w`, `m`, `a` | Day, Week, Month, Agenda |
  | `c` | New event |
  | `/` | Search |

- **Create:**
  - Click a Week/Day time slot (top half → `:00`, bottom half → `:30`) or a Month date (an all-day event) for **quick create**. Choose **More options** for the full form.
  - Or use **New event**.
- **Event fields:**
  - Title (required).
  - Start/end, or all-day.
  - Optional location, description and category colour (Default, Personal, Work, Family, Health, Travel, Social, Other).
  - Optional reminder.
  - Optional repeat: daily, weekly or monthly; every *n*; ending never, on a date, or after *n* times.
- **Edit and delete:**
  - Clicking an event opens its details, with **Edit** and **Delete**.
  - For a repeating event, Persora asks **This event** or **All events**.
- **Search:** searches your event titles only (case-insensitive, up to 100 matches). Choosing a result opens its date and briefly highlights the event.
- **States:** a loading indicator, empty states (no events in range, no search results), inline validation and clear error messages. Times are always shown with a note naming the time zone ("Times shown in Asia/Dhaka…").

Validation (in the browser, the API and the database):
- The title is 1–200 characters.
- The end can't be before the start, and a timed event must end after it starts.
- A timed event can last up to 31 days; an all-day event up to 366 days.
- The location is up to 300 characters and the description up to 2,000.
- The repeat interval is 1–99 and the count 1–999.

## Time zones

- Events are **shown in the member's profile time zone** (Settings, IANA name, default `Asia/Dhaka`). If the time zone changes, the same events are shown at the new local times.
- **Timed events** are stored as UTC instants (`start_at`, `end_at`) together with the IANA zone they were saved in (`time_zone`).
  - Repeats keep the **local wall-clock time** in that zone. For example, a 09:00 weekly event stays at 09:00 across daylight-saving changes.
  - A monthly event on the 31st skips months without a 31st.
- **All-day events are dates**, not midnight timestamps: `start_date`, plus an `end_date` stored exclusive (the form shows it inclusive). They never shift when the time zone changes.
- Week and month ranges are computed in the member's zone. The API pads each fetch by a day on both sides, so events near midnight are never missed.
- Editing sends local date/time fields, not converted timestamps, so saving without changes never shifts an event.

## Repeating events: "this event" vs "all events"

Persora uses the same model as Google Calendar and iCalendar (a series plus exceptions):

- A **series** row stores the rule: `recurrence_freq`, `recurrence_interval`, and the end as `recurrence_until` or `recurrence_count`.
- **Editing one occurrence** creates an **exception** row. Its `series_id` points to the series and `original_start_at` / `original_start_date` identifies the occurrence. The series row is not modified.
- **Deleting one occurrence** stores a cancelled exception (`status = 'cancelled'`).
- **Editing all events:**
  - Title, location, description, category or reminder changes apply to the series. Occurrences you customised keep their own values for the fields you changed there.
  - Date, time or repeat-rule changes rebuild the series and discard its exceptions (the API reports how many). This prevents occurrences that no longer exist from lingering.
- **Deleting all events** removes the series with its exceptions and pending reminders.
- Every event has a `revision`. If an event changed in another tab, a stale edit is refused (HTTP 409) and the calendar reloads.

## Reminders

Presets: none, 5, 15 or 30 minutes, 1 hour, or 1 day before. All-day events are reminded relative to 09:00 local time on their first day.

**Server-side scheduling** (works with the browser closed):

1. When an event is saved, the API computes its **next** reminder (skipping past and cancelled or overridden occurrences). It stores the reminder in `calendar_reminders`, under a unique `dedupe_key` of event + occurrence + reminder time.
2. A dispatcher claims due reminders with `FOR UPDATE SKIP LOCKED` and delivers them. After delivery it schedules the series' next occurrence. Sent reminders are never re-sent: re-saving an event can't revive them, and a second claim of the same row finds nothing.
3. **Delivery:**
   - **In-app notification:** always; it appears in Persora's bell on any device.
   - **Email:** if the member enabled "Also email me" for that event, Brevo (`BREVO_API_KEY`) is configured, and their email is verified. The email links back to the calendar.
   - Emails that would arrive more than 15 minutes late and after the event started are skipped. The reason is recorded on the reminder (`email_status` / `email_note`).
4. **Editing or deleting an event:** changing the time, the rule or the reminder cancels the pending reminder and schedules a new one. Deleting removes pending reminders. The reminder for a cancelled occurrence is skipped.

**What triggers the dispatcher**, any of which is enough:

- **pg_cron** (when available) runs `persora_calendar_dispatch_ping()` every minute. When something is due, it calls the API's dispatcher through `pg_net`. This needs two Supabase Vault secrets; see [DEPLOYMENT.md](./DEPLOYMENT.md#calendar-reminders).
- An **external scheduler** calling `POST /api/internal/calendar-reminders` with header `x-persora-cron-token: <CALENDAR_REMINDER_TOKEN>`. Without that Pages secret, the endpoint is a 404.
- The API itself: after signed-in session checks (at most once a minute per worker), and whenever an open Persora tab polls reminders (every 30 seconds and on focus).

**Browser notifications:**
- While Persora is open in a tab, a due reminder also shows a desktop notification, if the member granted permission. When a reminder is chosen, the event form shows the browser's permission state:
  - not yet asked: an **Allow desktop notifications** link;
  - on;
  - blocked in the browser's settings;
  - not supported by this browser.
- Each reminder is notified at most once per browser.
- Without permission, reminders still appear in the bell and by email.

## Data and security

- **Migration:** `supabase/migrations/202610250001_calendar.sql`.
  - Tables: `calendar_events`, `calendar_reminders`.
  - Indexes: owner + dates, owner + series, and title search. It uses `pg_trgm` when available; otherwise there is a btree title index.
  - Functions: SECURITY DEFINER.
  - Optionally creates the pg_cron job. Its guards make it apply cleanly where pg_cron, pg_net or Vault are missing.
- **Ownership:** every row has `user_id` (cascade-deleted with the account). Every function takes the signed-in owner from the server session, never from the request body, and scopes every statement to that owner. Another member's event is reported as "not found" (404).
- **RLS and privileges:** RLS is on, and every table and function privilege is revoked from `anon` / `authenticated`, so browsers can't reach the tables even with the public API URL. Internal helpers are revoked from `service_role` as well.
- **Secrets:** only the Pages Function holds the Supabase secret key, the Brevo key and the cron token. None are in browser code.
- **Account backup:** **Settings → Download a backup** includes `calendarEvents` (series, exceptions and cancelled occurrences) and `calendarReminders` in `persora-export.json`.
- **Future sync:** `source` / `external_id` columns are reserved for importing from Google or Microsoft calendars later. Nothing uses them yet.

## API (same-origin, signed-in)

| Method and path | Purpose |
| --- | --- |
| `GET /api/calendar/meta` | Profile zone, email-reminder availability (with reason), presets, limits |
| `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | Events overlapping the range (`to` exclusive, at most 100 days): single events, series and exceptions. The client expands repeats with `cloudflare/calendar-rules.js`, the same code the server uses |
| `GET /api/calendar/events/search?q=` | Title search |
| `POST /api/calendar/events` | Create (`201`) |
| `GET/PATCH/DELETE /api/calendar/events/:id` | Read, edit (`scope`: `series` or one occurrence via `occurrenceKey`, plus `expectedRevision`), delete |
| `GET /api/calendar/reminders`, `PATCH /api/calendar/reminders[/:id]` | Delivered reminders (last 7 days); mark read |
| `POST /api/internal/calendar-reminders` | Dispatcher for schedulers (token-gated) |

## Tests

- `npm test` runs these:
  - `tests/calendar-rules.test.mjs`: recurrence, DST, all-day, reminders and validation.
  - `tests/calendar-db.test.mjs`: the real migration under PGlite. Covers privileges/RLS, isolation, search escaping, revisions, exceptions, and the reminder queue (claim, dedupe, roll-forward, stale claims, cascade).
  - `tests/calendar-routes.test.mjs`: API validation, ownership, scopes, dispatcher outcomes, token gate and account export.
- `npm run test:e2e:calendar` runs a full browser flow against local Postgres 17 + PostgREST. It covers:
  - navigation and all views, validation, quick and detailed create;
  - this/all edits and deletes, all-day events, search;
  - a time-zone change;
  - reminder email + bell + desktop notification exactly once, and re-scheduling on edit and cancellation on delete;
  - isolation between members, account backups;
  - phone and tablet layouts, overlapping events, light and dark themes, and no console or HTTP errors.

  Set `PG_BIN`, `POSTGREST_BIN` and `PLAYWRIGHT_MODULE` as for the other e2e suites.

## Limitations

- No drag-to-move or drag-to-resize. Use the edit form, which is keyboard and screen-reader friendly.
- Desktop notifications appear only while a Persora tab is open; there is no web push or service worker. With the browser closed, reminders still arrive by email (when enabled) and wait in the bell.
- Reminder timing depends on the trigger. With pg_cron or an external scheduler it is within about a minute. Without either, it happens on the next signed-in request or open tab.
- Repeats are daily, weekly or monthly with an interval. There are no weekday sets, "last Friday" rules or per-event time zone picker; events use your profile zone when saved.
- Personal calendars only: no sharing, invitations, team calendars or external calendar sync.
