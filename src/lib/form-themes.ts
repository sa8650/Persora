import type { CSSProperties } from "react";
import type {
  FormPresetHeaderId,
  FormSettings,
  FormThemeAccentColor,
  FormThemeBackgroundStyle,
  FormThemeSettings,
} from "../../cloudflare/forms-rules.js";

export interface FormAccentSpec {
  id: FormThemeAccentColor;
  label: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  lightBg: string;
  mediumBg: string;
  darkLightBg: string;
  darkMediumBg: string;
}

export const FORM_ACCENT_SPECS: Record<FormThemeAccentColor, FormAccentSpec> = {
  indigo: {
    id: "indigo",
    label: "Persora Indigo",
    accent: "#6366f1",
    accentHover: "#4f46e5",
    accentSoft: "rgba(99, 102, 241, 0.14)",
    lightBg: "#eef2ff",
    mediumBg: "#e0e7ff",
    darkLightBg: "#13172b",
    darkMediumBg: "#181e38",
  },
  blue: {
    id: "blue",
    label: "Classic Blue",
    accent: "#2563eb",
    accentHover: "#1d4ed8",
    accentSoft: "rgba(37, 99, 235, 0.14)",
    lightBg: "#eff6ff",
    mediumBg: "#dbeafe",
    darkLightBg: "#111b2e",
    darkMediumBg: "#15233d",
  },
  teal: {
    id: "teal",
    label: "Lagoon Teal",
    accent: "#0d9488",
    accentHover: "#0f766e",
    accentSoft: "rgba(13, 148, 136, 0.14)",
    lightBg: "#f0fdfa",
    mediumBg: "#ccfbf1",
    darkLightBg: "#0f2022",
    darkMediumBg: "#132a2c",
  },
  emerald: {
    id: "emerald",
    label: "Forest Green",
    accent: "#16a34a",
    accentHover: "#15803d",
    accentSoft: "rgba(22, 163, 74, 0.14)",
    lightBg: "#f0fdf4",
    mediumBg: "#dcfce7",
    darkLightBg: "#102119",
    darkMediumBg: "#142b20",
  },
  amber: {
    id: "amber",
    label: "Golden Amber",
    accent: "#d97706",
    accentHover: "#b45309",
    accentSoft: "rgba(217, 119, 6, 0.15)",
    lightBg: "#fffbeb",
    mediumBg: "#fef3c7",
    darkLightBg: "#221b11",
    darkMediumBg: "#2c2214",
  },
  coral: {
    id: "coral",
    label: "Sunset Coral",
    accent: "#ea580c",
    accentHover: "#c2410c",
    accentSoft: "rgba(234, 88, 12, 0.14)",
    lightBg: "#fff7ed",
    mediumBg: "#ffedd5",
    darkLightBg: "#231712",
    darkMediumBg: "#2e1d16",
  },
  rose: {
    id: "rose",
    label: "Crimson Rose",
    accent: "#e11d48",
    accentHover: "#be123c",
    accentSoft: "rgba(225, 29, 72, 0.14)",
    lightBg: "#fff1f2",
    mediumBg: "#ffe4e6",
    darkLightBg: "#24131b",
    darkMediumBg: "#2f1823",
  },
  slate: {
    id: "slate",
    label: "Graphite Slate",
    accent: "#475569",
    accentHover: "#334155",
    accentSoft: "rgba(71, 85, 105, 0.15)",
    lightBg: "#f8fafc",
    mediumBg: "#e2e8f0",
    darkLightBg: "#131923",
    darkMediumBg: "#192230",
  },
};

export const FORM_ACCENT_LIST: FormAccentSpec[] = Object.values(FORM_ACCENT_SPECS);

export const FORM_BACKGROUND_OPTIONS: Array<{
  id: FormThemeBackgroundStyle;
  label: string;
}> = [
  { id: "light", label: "Soft tint" },
  { id: "medium", label: "Rich tint" },
  { id: "warm", label: "Warm paper" },
  { id: "canvas", label: "Clean neutral" },
];

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

export interface FormPresetHeaderSpec {
  id: FormPresetHeaderId;
  label: string;
  subtitle: string;
  recommendedAccent: FormThemeAccentColor;
  dataUri: string;
}

export const FORM_PRESET_HEADERS: FormPresetHeaderSpec[] = [
  {
    id: "aurora-waves",
    label: "Aurora Waves",
    subtitle: "Layered indigo & sky ribbons",
    recommendedAccent: "indigo",
    dataUri: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#312e81"/>
            <stop offset="52%" stop-color="#4f46e5"/>
            <stop offset="100%" stop-color="#0ea5e9"/>
          </linearGradient>
          <linearGradient id="g2" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#a5b4fc" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.12"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="280" fill="url(#g1)"/>
        <circle cx="1020" cy="48" r="190" fill="#818cf8" fill-opacity="0.24"/>
        <circle cx="180" cy="240" r="220" fill="#38bdf8" fill-opacity="0.2"/>
        <path d="M0 196 C260 120, 480 250, 760 168 C960 110, 1090 150, 1200 116 L1200 280 L0 280 Z" fill="url(#g2)"/>
        <path d="M0 228 C310 178, 620 268, 920 198 C1050 168, 1140 184, 1200 172 L1200 280 L0 280 Z" fill="#ffffff" fill-opacity="0.12"/>
      </svg>
    `),
  },
  {
    id: "botanical-calm",
    label: "Botanical Calm",
    subtitle: "Organic sage & emerald foliage",
    recommendedAccent: "emerald",
    dataUri: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#064e3b"/>
            <stop offset="55%" stop-color="#0f766e"/>
            <stop offset="100%" stop-color="#16a34a"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="280" fill="url(#bg)"/>
        <circle cx="980" cy="230" r="210" fill="#34d399" fill-opacity="0.2"/>
        <path d="M80 280 C95 168, 190 92, 310 64 C282 168, 206 238, 80 280 Z" fill="#a7f3d0" fill-opacity="0.22"/>
        <path d="M210 280 C248 188, 340 132, 456 118 C414 204, 332 254, 210 280 Z" fill="#6ee7b7" fill-opacity="0.18"/>
        <path d="M880 280 C902 162, 1004 82, 1138 54 C1102 172, 1018 242, 880 280 Z" fill="#bbf7d0" fill-opacity="0.24"/>
        <circle cx="620" cy="84" r="96" fill="#fef3c7" fill-opacity="0.14"/>
      </svg>
    `),
  },
  {
    id: "architectural-grid",
    label: "Studio Blueprint",
    subtitle: "Crisp cobalt geometry & arcs",
    recommendedAccent: "blue",
    dataUri: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bl" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="55%" stop-color="#1e3a8a"/>
            <stop offset="100%" stop-color="#2563eb"/>
          </linearGradient>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#93c5fd" stroke-opacity="0.16" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="1200" height="280" fill="url(#bl)"/>
        <rect width="1200" height="280" fill="url(#grid)"/>
        <circle cx="960" cy="140" r="168" fill="none" stroke="#60a5fa" stroke-opacity="0.34" stroke-width="2"/>
        <circle cx="960" cy="140" r="108" fill="none" stroke="#93c5fd" stroke-opacity="0.28" stroke-width="1.5"/>
        <polygon points="140,248 280,62 420,248" fill="#3b82f6" fill-opacity="0.2"/>
        <rect x="330" y="96" width="148" height="148" rx="18" fill="#38bdf8" fill-opacity="0.14"/>
      </svg>
    `),
  },
  {
    id: "sunset-horizon",
    label: "Warm Horizon",
    subtitle: "Terracotta, amber & dusk hills",
    recommendedAccent: "coral",
    dataUri: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sh" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#7c2d12"/>
            <stop offset="52%" stop-color="#ea580c"/>
            <stop offset="100%" stop-color="#f59e0b"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="280" fill="url(#sh)"/>
        <circle cx="880" cy="96" r="74" fill="#fef3c7" fill-opacity="0.34"/>
        <path d="M0 206 C220 142, 450 226, 700 174 C900 132, 1060 170, 1200 144 L1200 280 L0 280 Z" fill="#9a3412" fill-opacity="0.45"/>
        <path d="M0 236 C280 198, 560 256, 860 212 C1020 188, 1120 204, 1200 196 L1200 280 L0 280 Z" fill="#431407" fill-opacity="0.38"/>
      </svg>
    `),
  },
  {
    id: "celebration-confetti",
    label: "Event Ribbon",
    subtitle: "Festive shapes for RSVPs & events",
    recommendedAccent: "rose",
    dataUri: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="ev" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#881337"/>
            <stop offset="50%" stop-color="#e11d48"/>
            <stop offset="100%" stop-color="#db2777"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="280" fill="url(#ev)"/>
        <circle cx="170" cy="78" r="46" fill="#fda4af" fill-opacity="0.26"/>
        <rect x="310" y="42" width="64" height="64" rx="14" transform="rotate(18 342 74)" fill="#fde68a" fill-opacity="0.28"/>
        <circle cx="620" cy="212" r="72" fill="#fbcfe8" fill-opacity="0.2"/>
        <rect x="820" y="54" width="86" height="86" rx="20" transform="rotate(-14 863 97)" fill="#fecdd3" fill-opacity="0.24"/>
        <circle cx="1060" cy="186" r="58" fill="#fde68a" fill-opacity="0.24"/>
        <path d="M0 232 Q300 182 600 226 T1200 204 L1200 280 L0 280 Z" fill="#ffffff" fill-opacity="0.12"/>
      </svg>
    `),
  },
];

export function resolveFormTheme(settings?: Partial<FormSettings> | null): FormThemeSettings {
  const raw = settings?.theme;
  const accentColor: FormThemeAccentColor =
    raw?.accentColor && raw.accentColor in FORM_ACCENT_SPECS ? raw.accentColor : "indigo";
  const backgroundStyle: FormThemeBackgroundStyle =
    raw?.backgroundStyle === "canvas" ||
    raw?.backgroundStyle === "light" ||
    raw?.backgroundStyle === "medium" ||
    raw?.backgroundStyle === "warm"
      ? raw.backgroundStyle
      : "light";
  const presetHeader: FormPresetHeaderId | null =
    raw?.presetHeader && FORM_PRESET_HEADERS.some((p) => p.id === raw.presetHeader)
      ? raw.presetHeader
      : null;
  return { accentColor, backgroundStyle, presetHeader };
}

export function getPresetHeaderById(id?: string | null): FormPresetHeaderSpec | null {
  if (!id) return null;
  return FORM_PRESET_HEADERS.find((item) => item.id === id) || null;
}

export function buildFormThemeCssVars(settings?: Partial<FormSettings> | null): CSSProperties {
  const theme = resolveFormTheme(settings);
  const spec = FORM_ACCENT_SPECS[theme.accentColor] || FORM_ACCENT_SPECS.indigo;

  let lightSurface = spec.lightBg;
  let darkSurface = spec.darkLightBg;
  if (theme.backgroundStyle === "medium") {
    lightSurface = spec.mediumBg;
    darkSurface = spec.darkMediumBg;
  } else if (theme.backgroundStyle === "warm") {
    lightSurface = "#f6f5f1";
    darkSurface = "#171923";
  } else if (theme.backgroundStyle === "canvas") {
    lightSurface = "var(--ds-canvas-bg)";
    darkSurface = "var(--ds-canvas-bg)";
  }

  return {
    "--pf-accent": spec.accent,
    "--pf-accent-hover": spec.accentHover,
    "--pf-accent-soft": spec.accentSoft,
    "--pf-theme-bg-light": lightSurface,
    "--pf-theme-bg-dark": darkSurface,
  } as CSSProperties;
}
