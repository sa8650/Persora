import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { IconTile } from "@/components/reui/icon-tile";
import { Badge } from "@/components/reui/badge";
import { cn } from "@/lib/utils";

export type PersoraThemeMode = "light" | "dark" | "system";
export type ResolvedPersoraTheme = "light" | "dark";

const THEME_STORAGE_KEY = "persora.theme";

interface PersoraThemeContextValue {
  theme: PersoraThemeMode;
  resolvedTheme: ResolvedPersoraTheme;
  setTheme: (next: PersoraThemeMode) => void;
  toggleTheme: () => void;
}

const PersoraThemeContext = createContext<PersoraThemeContextValue>({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => undefined,
  toggleTheme: () => undefined,
});

function readStoredTheme(): PersoraThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore storage errors */
  }
  return "light";
}

function getSystemTheme(): ResolvedPersoraTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyDocumentTheme(resolved: ResolvedPersoraTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
}

export function PersoraThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<PersoraThemeMode>(() => readStoredTheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedPersoraTheme>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const handleChange = () => setSystemTheme(media?.matches ? "dark" : "light");
    handleChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media?.removeEventListener("change", handleChange);
    }
    return undefined;
  }, []);

  const resolvedTheme: ResolvedPersoraTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    applyDocumentTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: PersoraThemeMode) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <PersoraThemeContext.Provider value={value}>{children}</PersoraThemeContext.Provider>;
}

export function usePersoraTheme() {
  return useContext(PersoraThemeContext);
}

export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = usePersoraTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      className={cn("icon-button ds-theme-toggle", className)}
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function AppearanceSettingsCard() {
  const { theme, resolvedTheme, setTheme } = usePersoraTheme();
  const options: { id: PersoraThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", hint: "Clean daylight workspace", icon: Sun },
    { id: "dark", label: "Dark", hint: "Low-glare night surfaces", icon: Moon },
    { id: "system", label: "System", hint: "Follow device appearance", icon: Monitor },
  ];

  return (
    <section className="settings-card ds-appearance-card">
      <div className="settings-card-header">
        <div>
          <IconTile variant="soft" size="sm" className="ds-tone-violet">
            <Palette size={16} />
          </IconTile>
          <div>
            <h3>Appearance &amp; theme</h3>
            <p>Choose how cards, drawers, and navigation surfaces look on this device.</p>
          </div>
        </div>
        <Badge variant="secondary" size="xs" radius="full" className="capitalize">
          {theme === "system" ? `System (${resolvedTheme})` : theme}
        </Badge>
      </div>
      <div className="ds-theme-options" role="radiogroup" aria-label="Workspace theme">
        {options.map(({ id, label, hint, icon: Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              className={cn("ds-theme-choice", active && "is-active")}
              onClick={() => setTheme(id)}
            >
              <IconTile variant={active ? "solid" : "soft"} size="sm" className={active ? "" : "ds-tone-slate"}>
                <Icon size={15} />
              </IconTile>
              <span className="ds-theme-choice-copy">
                <b>{label}</b>
                <small>{hint}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
