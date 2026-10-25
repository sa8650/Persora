# Connection logos

Each service on the Connections page uses its own official logo, bundled locally (no
runtime requests). They are shown only to identify the service and remain trademarks of
their owners. Files are unmodified apart from whitespace/comment minification, except where noted.

| File | Service | Version | Source |
|---|---|---|---|
| `ems.svg` | EMS (Dexter Studio) | "Shared Core" small mark (16–32 px cut) | `EMS/assets/brand/ems-mark-small.svg` |
| `google-drive.svg` | Google Drive | 2026 Workspace icon | thesvg.org `google-drive-2026` |
| `google-docs.svg` | Google Docs | 2026 Workspace icon | thesvg.org `google-docs-2026` |
| `google-calendar.svg` | Google Calendar | 2026 Workspace icon | thesvg.org `google-calendar-2026` |
| `google-photos.svg` | Google Photos | 2025 pinwheel (gradient) | Wikimedia Commons `File:Google_Photos_(2025).svg` — white tile removed and viewBox cropped to the artwork |
| `notion.svg` | Notion | Current logo | Wikimedia Commons `File:Notion-logo.svg` |
| `microsoft-onedrive.svg` | Microsoft OneDrive | 2025 icon | Wikimedia Commons `File:Microsoft_OneDrive_Icon_(2025_-_present).svg` |
| `microsoft-outlook.svg` | Microsoft Outlook | 2025 icon | Wikimedia Commons `File:Microsoft_Outlook_Icon_(2025–present).svg` |

When a provider is added to `CONNECTION_PROVIDERS` (cloudflare/connections.js), add its
official logo here and register it in `PROVIDER_LOGOS` (src/components/connections/ConnectionParts.tsx).
