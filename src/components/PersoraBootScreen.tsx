import { ShieldCheck } from "lucide-react";
import { LAUNCHER_MODULE_BY_ID, type LauncherModuleId } from "../lib/app-launcher";
import { LauncherModuleIcon } from "./launcher/LauncherIcons";
import { OrbitingCircles } from "./ui/orbiting-circles";

export const BOOT_INNER_MODULES: readonly LauncherModuleId[] = [
  "documents",
  "calendar",
  "notes",
  "contacts",
  "password-manager",
];

export const BOOT_MIDDLE_MODULES: readonly LauncherModuleId[] = [
  "pdf-studio",
  "photo-studio",
  "habits",
  "loans",
  "tables",
];

export const BOOT_OUTER_MODULES: readonly LauncherModuleId[] = [
  "projects",
  "medical-records",
  "subscriptions",
  "timeline",
  "connections",
];

function renderOrbitModules(moduleIds: readonly LauncherModuleId[], iconSize: number) {
  const glyphSize = Math.round(iconSize * 0.72);
  return moduleIds.map((moduleId) => {
    const label = LAUNCHER_MODULE_BY_ID[moduleId]?.label || moduleId;
    return (
      <span
        key={moduleId}
        className="persora-orbit-icon"
        data-module-id={moduleId}
        aria-label={label}
        title={label}
      >
        <LauncherModuleIcon id={moduleId} size={glyphSize} />
      </span>
    );
  });
}

export default function PersoraBootScreen() {
  return (
    <main className="persora-boot-screen" role="status" aria-live="polite">
      <div className="persora-boot-orbit-stage" aria-hidden="true">
        <OrbitingCircles className="persora-orbiting-item" radius={62} duration={20} speed={1.08} iconSize={32}>
          {renderOrbitModules(BOOT_INNER_MODULES, 32)}
        </OrbitingCircles>
        <OrbitingCircles className="persora-orbiting-item" radius={104} duration={31} speed={1.05} iconSize={36} reverse>
          {renderOrbitModules(BOOT_MIDDLE_MODULES, 36)}
        </OrbitingCircles>
        <OrbitingCircles className="persora-orbiting-item" radius={146} duration={42} speed={1.02} iconSize={40}>
          {renderOrbitModules(BOOT_OUTER_MODULES, 40)}
        </OrbitingCircles>
        <span className="persora-boot-core">
          <ShieldCheck size={34} strokeWidth={2.15} />
        </span>
      </div>
      <div className="persora-boot-copy">
        <span className="persora-boot-eyebrow">YOUR PRIVATE SPACE</span>
        <strong>Persora</strong>
        <span>Preparing your personal workspace…</span>
      </div>
    </main>
  );
}
