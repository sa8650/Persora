import type { SkulletTheme } from "skullet";

/**
 * Skullet colours follow Persora's canvas/card hierarchy:
 * light bones sit on --ds-subtle-bg against --ds-card-bg; dark bones are a
 * faint lift on --ds-card-bg. Radius matches --ds-radius-sm (8px).
 */
export const PERSORA_SKULLET_THEME: SkulletTheme = {
  light: {
    base: "rgb(15 23 42 / 0.07)",
    highlight: "rgb(255 255 255 / 0.55)",
  },
  dark: {
    base: "rgb(255 255 255 / 0.08)",
    highlight: "rgb(255 255 255 / 0.12)",
  },
  animation: "shimmer",
  speed: "slow",
  radius: "8px",
  text: { top: "cap-height", bottom: "baseline" },
};
