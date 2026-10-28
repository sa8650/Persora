# Connection logos

Each service on the Connections page (`src/components/connections/`) uses its own official logo bundled locally with zero runtime external requests. Logos are displayed solely to identify each provider and remain trademarks of their respective owners.

| File | Service | Version | Source |
|---|---|---|---|
| `ems.svg` | EMS (Dexter Studio) | "Shared Core" small mark (16–32 px cut) | `EMS/assets/brand/ems-mark-small.svg` |
| `google-drive.svg` | Google Drive | 2026 Workspace icon | thesvg.org `google-drive-2026` |
| `google-docs.svg` | Google Docs | 2026 Workspace icon | thesvg.org `google-docs-2026` |
| `google-calendar.svg` | Google Calendar | 2026 Workspace icon | thesvg.org `google-calendar-2026` |
| `google-photos.svg` | Google Photos | 2025 pinwheel (gradient) | Wikimedia Commons `File:Google_Photos_(2025).svg` (cropped to artwork) |
| `notion.svg` | Notion | Current logo | Wikimedia Commons `File:Notion-logo.svg` |
| `microsoft-onedrive.svg` | Microsoft OneDrive | 2025 icon | Wikimedia Commons `File:Microsoft_OneDrive_Icon_(2025_-_present).svg` |
| `microsoft-outlook.svg` | Microsoft Outlook | 2025 icon | Wikimedia Commons `File:Microsoft_Outlook_Icon_(2025–present).svg` |

When adding a provider to `CONNECTION_PROVIDERS` in `cloudflare/connections.js`, place its local SVG here and register it in `PROVIDER_LOGOS` in `src/components/connections/ConnectionParts.tsx`.
