import type { ReactNode } from "react";
import "./template-card.css";

/**
 * Shared starter/template card primitives for Persora Table, Persora Docs and
 * Persora Forms.
 *
 * Every template card and every empty "add" card in the product uses the same
 * geometry (`--ds-template-card-height` / `--ds-template-thumb-height`) and the
 * five canonical left-to-right gradients live in the token layer
 * (`src/design-system/tokens.css`) — no per-page gradient values.
 */
export const TEMPLATE_GRADIENTS = [1, 2, 3, 4, 5] as const;

export type TemplateGradient = (typeof TEMPLATE_GRADIENTS)[number];

/** Stable gradient for a template at `index` (wraps around the ramp). */
export function templateGradient(index: number): TemplateGradient {
  const size = TEMPLATE_GRADIENTS.length;
  const safeIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return TEMPLATE_GRADIENTS[safeIndex % size];
}

/**
 * The card's preview area. It owns the shared card geometry and, for template
 * cards, paints the gradient behind the white document preview — the preview
 * itself is never tinted.
 */
export function TemplateCardThumb({
  gradient,
  className = "",
  children,
}: {
  gradient?: TemplateGradient;
  className?: string;
  children: ReactNode;
}) {
  const classes = ["ds-template-thumb", gradient ? "is-gradient" : "is-blank", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...(gradient ? { "data-template-gradient": String(gradient) } : {})}>
      {children}
    </span>
  );
}
