import type { ReactNode } from "react";
import "./template-card.css";

/**
 * Shared starter/template card primitives for Persora Table, Persora Docs and
 * Persora Forms.
 *
 * Every template card and every empty "add" card in the product uses the same
 * geometry (`--ds-template-card-width` / `--ds-template-card-height`) and the
 * ten canonical left-to-right (90deg) gradients live in the token layer
 * (`src/design-system/tokens.css`) — no per-page gradient values.
 */
export const TEMPLATE_GRADIENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type TemplateGradient = (typeof TEMPLATE_GRADIENTS)[number];

export interface TemplateGradientToken {
  readonly id: TemplateGradient;
  readonly name: string;
  readonly token: `--ds-template-gradient-${TemplateGradient}`;
  readonly from: string;
  readonly to: string;
  readonly css: string;
}

export const TEMPLATE_GRADIENT_PALETTE: readonly TemplateGradientToken[] = [
  {
    id: 1,
    name: "Blue–Indigo",
    token: "--ds-template-gradient-1",
    from: "#579AFC",
    to: "#5763FC",
    css: "linear-gradient(90deg, rgb(87, 154, 252) 0%, rgb(87, 99, 252) 100%)",
  },
  {
    id: 2,
    name: "Pink–Coral",
    token: "--ds-template-gradient-2",
    from: "#FF5AC2",
    to: "#FD5B73",
    css: "linear-gradient(90deg, rgb(255, 90, 194) 0%, rgb(253, 91, 115) 100%)",
  },
  {
    id: 3,
    name: "Orange–Yellow",
    token: "--ds-template-gradient-3",
    from: "#FDAC3E",
    to: "#FAD43F",
    css: "linear-gradient(90deg, rgb(253, 172, 62) 0%, rgb(250, 212, 63) 100%)",
  },
  {
    id: 4,
    name: "Teal–Green",
    token: "--ds-template-gradient-4",
    from: "#01BBB1",
    to: "#01C681",
    css: "linear-gradient(90deg, rgb(1, 187, 177) 0%, rgb(1, 198, 129) 100%)",
  },
  {
    id: 5,
    name: "Coral–Orange",
    token: "--ds-template-gradient-5",
    from: "#FF775A",
    to: "#FFA35A",
    css: "linear-gradient(90deg, rgb(255, 119, 90) 0%, rgb(255, 163, 90) 100%)",
  },
  {
    id: 6,
    name: "Purple–Lavender",
    token: "--ds-template-gradient-6",
    from: "#7C3AED",
    to: "#C084FC",
    css: "linear-gradient(90deg, #7C3AED, #C084FC)",
  },
  {
    id: 7,
    name: "Deep Navy–Sky Blue",
    token: "--ds-template-gradient-7",
    from: "#172554",
    to: "#38BDF8",
    css: "linear-gradient(90deg, #172554, #38BDF8)",
  },
  {
    id: 8,
    name: "Lime–Soft Green",
    token: "--ds-template-gradient-8",
    from: "#65A30D",
    to: "#D9F99D",
    css: "linear-gradient(90deg, #65A30D, #D9F99D)",
  },
  {
    id: 9,
    name: "Burgundy–Magenta",
    token: "--ds-template-gradient-9",
    from: "#881337",
    to: "#E879F9",
    css: "linear-gradient(90deg, #881337, #E879F9)",
  },
  {
    id: 10,
    name: "Graphite–Silver",
    token: "--ds-template-gradient-10",
    from: "#334155",
    to: "#94A3B8",
    css: "linear-gradient(90deg, #334155, #94A3B8)",
  },
] as const;

/** Stable deterministic gradient for a template at `index` (wraps around the 10-gradient ramp). */
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
