import type { ReactNode } from "react";
import { SkulletProvider } from "skullet/react";
import "skullet/styles.css";
import { usePersoraTheme } from "@/design-system/theme";
import { PERSORA_SKULLET_THEME } from "@/lib/skullet-theme";

/**
 * One app-level Skullet provider. Theme mode tracks Persora's resolved
 * appearance so skeletons follow light/dark without extra wrappers per page.
 */
export function PersoraSkulletProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = usePersoraTheme();
  return (
    <SkulletProvider
      theme={PERSORA_SKULLET_THEME}
      mode={resolvedTheme}
      reveal="smart"
      debug={import.meta.env.DEV}
    >
      {children}
    </SkulletProvider>
  );
}
