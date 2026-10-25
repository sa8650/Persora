import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { cn } from "@/lib/utils"

/* ═══════════════════════════════════════════════════════════════════════
 *  AnalyticsLineChart
 *  Vercel-style gradient line chart with floating tooltip cards.
 *
 *  Source: cult-ui — https://www.cult-ui.com/docs/components/analytics-chart
 *  (registry item `analytics-chart`). Vendored into Persora's project charts
 *  and adapted; the original props behave exactly as before:
 *   data            — { date: string, label: string, value: number }[]
 *   gradientStops   — { offset: string, color: string }[]
 *   dotColors       — string[] (per-index overrides)
 *   gridLines       — number  (default 5)
 *   height          — number  (viewBox height, default 280)
 *   pinnedIndices   — number[] (always-visible tooltip indices)
 *   valueLabel      — string  (unit shown in tooltip, default "clicks")
 *
 *  Persora additions (all optional, defaults keep the original look):
 *   fluid           — fill the container width at a fixed pixel height
 *   minValue/maxValue — fixed y domain (e.g. 0 for honest count baselines)
 *   showAxes        — y tick values + first/middle/last x labels
 *   formatDate / formatAxisDate / formatValue — custom text
 *   ariaLabel       — accessible chart description
 *  Plus: arrow-key + touch navigation, a screen-reader live region,
 *  edge-aware tooltips, reduced-motion support, and safe empty/single-point
 *  rendering. No "use client" (Vite SPA) and ES2020-safe.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface AnalyticsDataPoint {
  date: string
  label: string
  value: number
}

export interface AnalyticsGradientStop {
  offset: string
  color: string
}

export const DEFAULT_DATA: AnalyticsDataPoint[] = [
  { date: "2023-09-10", label: "buy-it-now", value: 8420 },
  { date: "2023-10-15", label: "buy-it-now", value: 12_891 },
  { date: "2023-12-10", label: "buy-it-now", value: 21_291 },
  { date: "2024-01-20", label: "buy-it-now", value: 28_530 },
  { date: "2024-02-15", label: "buy-it-now", value: 30_102 },
  { date: "2024-03-10", label: "buy-it-now", value: 33_847 },
  { date: "2024-04-10", label: "buy-it-now", value: 40_171 },
]

export const DEFAULT_GRADIENT: AnalyticsGradientStop[] = [
  { offset: "0%", color: "#FF975C" },
  { offset: "33%", color: "#E9EB4E" },
  { offset: "66%", color: "#9AE13E" },
  { offset: "100%", color: "#35C442" },
]

export const PALETTE = [
  "#FF975C",
  "#EDBE4D",
  "#CBE749",
  "#A8E040",
  "#7DD83C",
  "#5CCC41",
  "#35C442",
]

export function dotColor(i: number, n: number, overrides?: string[]) {
  if (overrides?.[i]) {
    return overrides[i]
  }
  const t = n <= 1 ? 1 : i / (n - 1)
  return PALETTE[
    Math.min(Math.round(t * (PALETTE.length - 1)), PALETTE.length - 1)
  ]
}

export function fmtDate(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function fmtNum(n: number) {
  return n.toLocaleString("en-US")
}

/* ── Easing ── */
export const EASE_OUT = "cubic-bezier(0.23,1,0.32,1)"

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  )
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    query.addEventListener?.("change", update)
    return () => query.removeEventListener?.("change", update)
  }, [])
  return reduced
}

/* ── Tooltip ────────────────────────────────────────────────────────── */
export interface AnalyticsTooltipPoint extends AnalyticsDataPoint {
  x: number
  y: number
  formattedDate: string
  color: string
}

export interface AnalyticsTooltipProps {
  point: AnalyticsTooltipPoint
  color: string
  px: number
  py: number
  side: "top" | "bottom"
  valueLabel: string
  show: boolean
  /** When true, stacks above pinned/static tooltip cards */
  isHovered?: boolean
  /** Which way the card extends from the point. Defaults to the original cult-ui placement. */
  align?: "start" | "end"
  /** Full value text (overrides `${value} ${valueLabel}`). */
  valueText?: string
  reducedMotion?: boolean
}

export function AnalyticsTooltip({
  point,
  color,
  px,
  py,
  side,
  valueLabel,
  show,
  isHovered = false,
  align,
  valueText,
  reducedMotion = false,
}: AnalyticsTooltipProps) {
  const isTop = side === "top" // card sits ABOVE the point
  const circR = 11 // connector circle outer radius
  const gap = 4 // space between circle edge and card
  // Original: top cards extend left, bottom cards extend right.
  const extendsLeft = align ? align === "end" : isTop
  const duration = reducedMotion ? "0ms" : "220ms"

  // Anchor wrapper is centered exactly on the data point.
  // Everything else is positioned relative to this anchor.
  return (
    <div
      aria-hidden="true"
      data-slot="analytics-tooltip"
      style={{
        position: "absolute",
        left: px,
        top: py,
        // Center the anchor on the data point
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        opacity: show ? 1 : 0,
        visibility: show ? "visible" : "hidden",
        filter: show || reducedMotion ? "blur(0px)" : "blur(4px)",
        transition: `opacity ${duration} ${EASE_OUT}, filter ${duration} ${EASE_OUT}, visibility 0ms linear ${show ? "0ms" : duration}`,
        zIndex: isHovered ? 50 : 10,
      }}
    >
      {/* Connector circle — sits right on the data point (center of wrapper) */}
      <svg
        aria-hidden="true"
        focusable="false"
        height={circR * 2}
        style={{ display: "block" }}
        width={circR * 2}
      >
        <circle
          cx={circR}
          cy={circR}
          fill="var(--card)"
          r={circR - 0.5}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <circle cx={circR} cy={circR} fill={color} r={4.5} />
      </svg>

      {/* Card — positioned absolutely above or below the circle */}
      <div
        data-slot="analytics-tooltip-card"
        style={{
          position: "absolute",
          whiteSpace: "nowrap",
          ...(isTop ? { bottom: circR * 2 + gap } : { top: circR * 2 + gap }),
          ...(extendsLeft ? { right: -(circR + 2) } : { left: -(circR + 2) }),
          background: "var(--card)",
          borderRadius: 10,
          padding: "9px 13px",
          border: "1px solid var(--border)",
          boxShadow: [
            "0 1px 2px -1px rgba(0,0,0,0.07)",
            "0 3px 8px 0 rgba(0,0,0,0.04)",
            "0 8px 20px -4px rgba(0,0,0,0.06)",
          ].join(","),
        }}
      >
        <div
          data-slot="analytics-tooltip-date"
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "var(--muted-foreground)",
            letterSpacing: "0.005em",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {point.formattedDate}
        </div>
        <div
          data-slot="analytics-tooltip-value"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 5,
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--foreground)",
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              padding: "1.5px 6px",
              borderRadius: 4,
              lineHeight: "19px",
            }}
          >
            {point.label}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--muted-foreground)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: "19px",
            }}
          >
            {valueText ?? `${fmtNum(point.value)} ${valueLabel}`}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Chart ───────────────────────────────────────────────────────────── */
export interface AnalyticsLineChartProps {
  data?: AnalyticsDataPoint[]
  gradientStops?: AnalyticsGradientStop[]
  dotColors?: string[]
  gridLines?: number
  height?: number
  pinnedIndices?: number[]
  valueLabel?: string
  className?: string
  /** Fill the container width (fixed pixel height) instead of a 600px max-width box. */
  fluid?: boolean
  /** Fixed lower bound of the y axis (defaults to the data minimum, like cult-ui). */
  minValue?: number
  /** Fixed upper bound of the y axis (defaults to the data maximum). */
  maxValue?: number
  /** Render y tick values on the grid lines and first/middle/last x labels. */
  showAxes?: boolean
  /** Tooltip date text. */
  formatDate?: (point: AnalyticsDataPoint, index: number) => string
  /** X-axis label text (with `showAxes`). */
  formatAxisDate?: (point: AnalyticsDataPoint, index: number) => string
  /** Tooltip value text (overrides `${value} ${valueLabel}`). */
  formatValue?: (value: number, point: AnalyticsDataPoint) => string
  /** Y tick text (with `showAxes`). */
  formatTick?: (value: number) => string
  /** Accessible description of the whole chart. */
  ariaLabel?: string
}

const ORIGINAL_PAD = { t: 48, r: 48, b: 36, l: 48 }
const FLUID_PAD = { t: 40, r: 28, b: 34, l: 44 }

export function AnalyticsLineChart({
  data = DEFAULT_DATA,
  gradientStops = DEFAULT_GRADIENT,
  dotColors,
  gridLines = 5,
  height = 280,
  pinnedIndices,
  valueLabel = "clicks",
  className,
  fluid = false,
  minValue,
  maxValue,
  showAxes = false,
  formatDate,
  formatAxisDate,
  formatValue,
  formatTick = fmtNum,
  ariaLabel = "Analytics line chart",
}: AnalyticsLineChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [wrapRect, setWrapRect] = useState({ w: 600, h: 280 })
  const reducedMotion = usePrefersReducedMotion()

  const VB_W = fluid ? Math.max(240, Math.round(wrapRect.w)) : 600
  const VB_H = height
  const pad = fluid ? FLUID_PAD : ORIGINAL_PAD
  const iW = VB_W - pad.l - pad.r
  const iH = VB_H - pad.t - pad.b
  const lines = Math.max(2, gridLines)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => {
      cancelAnimationFrame(id)
      setMounted(false)
    }
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) {
      return
    }
    const measure = (width: number, h: number) => {
      if (width > 0) {
        setWrapRect((prev) => (prev.w === width && prev.h === h ? prev : { w: width, h }))
      }
    }
    const box = el.getBoundingClientRect()
    measure(box.width, box.height)
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      measure(r.width, r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const domain = useMemo(() => {
    const vs = data.map((d) => d.value).filter((v) => Number.isFinite(v))
    const mn = minValue ?? (vs.length ? Math.min(...vs) : 0)
    const mx = Math.max(maxValue ?? (vs.length ? Math.max(...vs) : 0), mn)
    return { mn, mx, rng: mx - mn || 1 }
  }, [data, minValue, maxValue])

  const points = useMemo(() => {
    const { mn, rng } = domain
    return data.map((d, i) => ({
      ...d,
      x:
        data.length === 1
          ? pad.l + iW / 2
          : pad.l + (i / Math.max(data.length - 1, 1)) * iW,
      y: pad.t + iH - (((Number.isFinite(d.value) ? d.value : 0) - mn) / rng) * iH,
      formattedDate: formatDate ? formatDate(d, i) : fmtDate(d.date),
      color: dotColor(i, data.length, dotColors),
    }))
  }, [data, domain, iW, iH, pad, dotColors, formatDate])

  const pathD = useMemo(
    () =>
      points
        .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" "),
    [points]
  )

  const pathLen = useMemo(() => {
    let l = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x,
        dy = points[i].y - points[i - 1].y
      l += Math.sqrt(dx * dx + dy * dy)
    }
    return Math.max(1, Math.ceil(l))
  }, [points])

  const pinned = useMemo(() => {
    if (pinnedIndices) {
      return pinnedIndices.filter((i) => i >= 0 && i < points.length)
    }
    if (points.length >= 3) {
      return [2, points.length - 1]
    }
    return points.length === 2 ? [0, 1] : points.length ? [0] : []
  }, [pinnedIndices, points.length])

  // Nearest point always wins inside the plot (the original 48-unit radius
  // left dead zones once points are spread across a wide fluid chart).
  const step = points.length > 1 ? iW / (points.length - 1) : iW
  const hitRadius = Math.max(48, step / 2 + 1)

  const pickAt = useCallback(
    (clientX: number) => {
      const svg = svgRef.current
      if (!svg || !points.length) {
        return
      }
      const r = svg.getBoundingClientRect()
      const mx = ((clientX - r.left) / (r.width || 1)) * VB_W
      let ci = 0,
        md = Number.POSITIVE_INFINITY
      points.forEach((p, i) => {
        const d = Math.abs(p.x - mx)
        if (d < md) {
          md = d
          ci = i
        }
      })
      setHovered(md < hitRadius ? ci : null)
    },
    [points, VB_W, hitRadius]
  )

  const onPointer = useCallback(
    (e: PointerEvent<SVGSVGElement>) => pickAt(e.clientX),
    [pickAt]
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      if (!points.length) {
        return
      }
      const last = points.length - 1
      const current = hovered ?? (pinned.length ? pinned[pinned.length - 1] : last)
      let next: number | null = current
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(last, (hovered === null ? current - 1 : current) + 1)
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, (hovered === null ? current + 1 : current) - 1)
      else if (e.key === "Home") next = 0
      else if (e.key === "End") next = last
      else if (e.key === "Escape") next = null
      else return
      e.preventDefault()
      setHovered(next)
    },
    [points.length, hovered, pinned]
  )

  const active = useMemo(() => {
    const s = new Set(pinned)
    if (hovered !== null) {
      s.add(hovered)
    }
    return s
  }, [pinned, hovered])

  const sx = wrapRect.w / VB_W

  const gradId = `g-${useId().replace(/:/g, "")}`
  const valueTextOf = (p: AnalyticsDataPoint) =>
    formatValue ? formatValue(p.value, p) : `${fmtNum(p.value)} ${valueLabel}`

  const xLabelIndices = useMemo(() => {
    if (!showAxes || !points.length) return []
    const s = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])
    return Array.from(s)
  }, [showAxes, points.length])

  const announced = hovered !== null && points[hovered]
    ? `${points[hovered].formattedDate}: ${points[hovered].label}, ${valueTextOf(points[hovered])}`
    : ""

  return (
    <div
      className={cn(className)}
      data-slot="analytics-line-chart"
      ref={wrapRef}
      style={{
        position: "relative",
        maxWidth: fluid ? "none" : VB_W,
        width: fluid ? "100%" : undefined,
        userSelect: "none",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <svg
        aria-label={ariaLabel}
        aria-roledescription="line chart"
        data-slot="analytics-line-chart-svg"
        onBlur={() => {
          setFocused(false)
          setHovered(null)
        }}
        onFocus={(e) => {
          // Ring only for keyboard focus, not for taps/clicks.
          let visible = true
          try { visible = e.currentTarget.matches(":focus-visible") } catch { /* older engines */ }
          setFocused(visible)
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHovered(null)
        }}
        onPointerMove={onPointer}
        ref={svgRef}
        role="img"
        tabIndex={points.length ? 0 : -1}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          overflow: "visible",
          outline: "none",
          touchAction: "pan-y",
        }}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" x2="100%" y1="0%" y2="0%">
            {gradientStops.map((s) => (
              <stop
                key={`${s.offset}-${s.color}`}
                offset={s.offset}
                stopColor={s.color}
              />
            ))}
          </linearGradient>
        </defs>

        {/* Keyboard focus ring */}
        {focused && (
          <rect
            data-slot="analytics-line-chart-focus"
            fill="none"
            height={VB_H - 4}
            rx="10"
            stroke="var(--p-blue, #465cff)"
            strokeOpacity="0.55"
            strokeWidth="2"
            width={VB_W - 4}
            x="2"
            y="2"
          />
        )}

        {/* Grid */}
        {Array.from({ length: lines }).map((_, i) => {
          const y = pad.t + (i / (lines - 1)) * iH
          const tick = domain.mx - (i / (lines - 1)) * (domain.mx - domain.mn)
          return (
            <g key={`grid-${i}`}>
              <line
                stroke="var(--border)"
                strokeWidth="1"
                style={{
                  opacity: mounted ? 1 : 0,
                  transition: reducedMotion ? "none" : `opacity 600ms ease ${80 + i * 50}ms`,
                }}
                x1={pad.l}
                x2={pad.l + iW}
                y1={y}
                y2={y}
              />
              {showAxes && (
                <text
                  data-slot="analytics-line-chart-tick"
                  dominantBaseline="middle"
                  fill="var(--muted-foreground)"
                  fontSize="11"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  textAnchor="end"
                  x={pad.l - 10}
                  y={y}
                >
                  {formatTick(Math.round(tick * 100) / 100)}
                </text>
              )}
            </g>
          )
        })}

        {/* X labels */}
        {xLabelIndices.map((i) => {
          const p = points[i]
          const anchor = points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
          return (
            <text
              data-slot="analytics-line-chart-x-label"
              fill="var(--muted-foreground)"
              fontSize="11"
              key={`x-${i}`}
              textAnchor={anchor}
              x={anchor === "start" ? p.x - 4 : anchor === "end" ? p.x + 4 : p.x}
              y={VB_H - 8}
            >
              {formatAxisDate ? formatAxisDate(p, i) : p.date}
            </text>
          )
        })}

        {/* Hover guide */}
        {hovered !== null && points[hovered] && (
          <line
            data-slot="analytics-line-chart-guide"
            stroke="var(--border)"
            strokeDasharray="3 4"
            strokeWidth="1"
            x1={points[hovered].x}
            x2={points[hovered].x}
            y1={pad.t}
            y2={pad.t + iH}
          />
        )}

        {/* Line — stroke-dashoffset draw */}
        {points.length > 1 && (
          <path
            d={pathD}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            style={{
              strokeDasharray: pathLen,
              strokeDashoffset: mounted || reducedMotion ? 0 : pathLen,
              transition: reducedMotion ? "none" : `stroke-dashoffset 1000ms ${EASE_OUT}`,
            }}
          />
        )}

        {/* Dots — hidden when tooltip is active (connector circle takes over) */}
        {points.map((p, i) => {
          const isActive = active.has(i)
          const enterDelay = 700 + Math.min(i, 20) * 40
          return (
            <g key={`dot-${i}-${p.date}`}>
              {/* Main dot — fade out when tooltip connector is showing */}
              <circle
                cx={p.x}
                cy={p.y}
                fill={p.color}
                r={points.length > 40 ? 3 : 4}
                stroke="var(--card)"
                strokeWidth="2.5"
                style={{
                  opacity: mounted ? (isActive ? 0 : 1) : 0,
                  transition: reducedMotion
                    ? "none"
                    : `opacity ${isActive ? "120ms" : "350ms"} ease ${mounted ? "0ms" : `${enterDelay}ms`}`,
                }}
              />
              {/* Hit target */}
              <circle
                cx={p.x}
                cy={p.y}
                fill="transparent"
                r={Math.min(22, Math.max(8, step / 2))}
                style={{ cursor: "pointer" }}
              />
            </g>
          )
        })}
      </svg>

      {/* Tooltip layer */}
      {points.map((p, i) => (
        <AnalyticsTooltip
          align={fluid ? (p.x > pad.l + iW / 2 ? "end" : "start") : undefined}
          color={p.color}
          isHovered={hovered === i}
          key={`tooltip-${i}-${p.date}`}
          point={p}
          px={p.x * sx}
          py={p.y * sx}
          reducedMotion={reducedMotion}
          show={active.has(i) && mounted}
          side={p.y < pad.t + iH * 0.45 ? "bottom" : "top"}
          valueLabel={valueLabel}
          valueText={valueTextOf(p)}
        />
      ))}

      <span
        aria-live="polite"
        data-slot="analytics-line-chart-live"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announced}
      </span>
    </div>
  )
}
