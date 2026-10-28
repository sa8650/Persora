import { useEffect, useId, useState } from "react";
import { Check, LayoutTemplate, RotateCcw, Sparkles, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import { Badge } from "../reui/badge";
import { IconTile } from "../reui/icon-tile";
import { iconToneClass } from "../../design-system";
import {
  DASHBOARD_PRESETS,
  DASHBOARD_WIDGET_BY_TYPE,
  type DashboardPresetId,
} from "../../lib/dashboard-api";
import { WIDGET_VISUALS } from "./widget-icons";

export interface PresetConfirmModalProps {
  mode: "presets" | "reset" | null;
  activePreset: DashboardPresetId | "custom";
  customized: boolean;
  onClose: () => void;
  onConfirmPreset: (presetId: DashboardPresetId) => void;
  onConfirmReset: () => void;
}

export function PresetConfirmModal({
  mode,
  activePreset,
  customized,
  onClose,
  onConfirmPreset,
  onConfirmReset,
}: PresetConfirmModalProps) {
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<DashboardPresetId>(() =>
    activePreset !== "custom" ? activePreset : "balanced",
  );

  useEffect(() => {
    if (mode === "presets") {
      setSelectedId(activePreset !== "custom" ? activePreset : "balanced");
    }
  }, [mode, activePreset]);

  useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose]);

  if (!mode) return null;

  if (mode === "reset") {
    const defaultPreset = DASHBOARD_PRESETS[0];
    return (
      <ModalPortal>
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{ maxWidth: 500 }}
          >
            <div className="modal-head">
              <div className="flex items-center gap-3">
                <IconTile variant="soft" size="default" className="ds-tone-amber" aria-hidden="true">
                  <RotateCcw size={16} />
                </IconTile>
                <div>
                  <h2 id={titleId}>Reset dashboard layout?</h2>
                  <p>Restores the default 8-widget Balanced layout. None of your underlying vault records are deleted.</p>
                </div>
              </div>
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close reset dialog">
                <X size={16} />
              </button>
            </div>

            <div className="modal-body space-y-3">
              <div className="rounded-xl border border-border bg-secondary/50 p-3">
                <span className="text-xs font-semibold text-foreground">
                  Default widgets that will be restored ({defaultPreset.widgets.length}):
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {defaultPreset.widgets.map((w) => (
                    <Badge key={w.id} variant="outline" size="xs" radius="full">
                      {w.title}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="quiet-button" onClick={onClose}>
                Keep my layout
              </button>
              <button
                type="button"
                className="main-add-button"
                onClick={() => {
                  onConfirmReset();
                  onClose();
                }}
              >
                <RotateCcw size={15} /> Reset dashboard
              </button>
            </div>
          </section>
        </div>
      </ModalPortal>
    );
  }

  const selectedPreset = DASHBOARD_PRESETS.find((p) => p.id === selectedId) || DASHBOARD_PRESETS[0];

  return (
    <ModalPortal>
      <div
        className="modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          className="modal-card modal-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{ maxWidth: 760 }}
        >
          <div className="modal-head">
            <div className="flex items-center gap-3">
              <IconTile variant="soft" size="default" className="ds-tone-blue" aria-hidden="true">
                <LayoutTemplate size={17} />
              </IconTile>
              <div>
                <h2 id={titleId}>Dashboard Presets</h2>
                <p>Preview a curated layout before replacing your current dashboard arrangement.</p>
              </div>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close presets dialog">
              <X size={16} />
            </button>
          </div>

          <div className="modal-body space-y-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Choose a dashboard preset">
              {DASHBOARD_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedId(preset.id)}
                    className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-accent/50"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{preset.name}</span>
                      <Badge variant={isSelected ? "primary-light" : "secondary"} size="xs" radius="full">
                        {preset.badge}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{preset.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-border bg-secondary/40 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={14} className="text-primary" />
                  <h3 className="text-[12.5px] font-semibold text-foreground">
                    {selectedPreset.name} layout preview ({selectedPreset.widgets.length} widgets)
                  </h3>
                </div>
                {customized && (
                  <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Replaces your current customized layout
                  </span>
                )}
              </div>

              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedPreset.widgets.map((entry) => {
                  const meta = DASHBOARD_WIDGET_BY_TYPE[entry.type];
                  const visual = WIDGET_VISUALS[entry.type];
                  const Icon = visual.icon;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <IconTile variant="soft" size="xs" className={iconToneClass(visual.tone)} aria-hidden="true">
                          <Icon size={13} />
                        </IconTile>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">{entry.title}</p>
                          <p className="truncate text-[10.5px] text-muted-foreground">{meta.name}</p>
                        </div>
                      </div>
                      <Badge variant="outline" size="xs" radius="full">
                        {entry.width}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="main-add-button"
              onClick={() => {
                onConfirmPreset(selectedPreset.id);
                onClose();
              }}
            >
              <Check size={15} /> Apply {selectedPreset.name} preset
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
