import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  type MotionStyle,
} from "motion/react"
import { cn } from "@/lib/utils"
import { usePersoraTheme } from "@/design-system/theme"

interface MagicCardBaseProps {
  children?: React.ReactNode
  className?: string
  gradientSize?: number
  gradientFrom?: string
  gradientTo?: string
}

interface MagicCardGradientProps extends MagicCardBaseProps {
  mode?: "gradient"

  gradientColor?: string
  gradientOpacity?: number

  glowFrom?: never
  glowTo?: never
  glowAngle?: never
  glowSize?: never
  glowBlur?: never
  glowOpacity?: never
}

interface MagicCardOrbProps extends MagicCardBaseProps {
  mode: "orb"

  glowFrom?: string
  glowTo?: string
  glowAngle?: number
  glowSize?: number
  glowBlur?: number
  glowOpacity?: number

  gradientColor?: never
  gradientOpacity?: never
}

type MagicCardProps = MagicCardGradientProps | MagicCardOrbProps
type ResetReason = "enter" | "leave" | "global" | "init"

function isOrbMode(props: MagicCardProps): props is MagicCardOrbProps {
  return props.mode === "orb"
}

export function MagicCard(props: MagicCardProps) {
  const {
    children,
    className,
    gradientSize = 200,
    gradientColor = "rgba(26, 115, 232, .12)",
    gradientOpacity = 0.8,
    gradientFrom = "#1a73e8",
    gradientTo = "#8ab4f8",
    mode = "gradient",
  } = props

  const glowFrom = isOrbMode(props) ? (props.glowFrom ?? "#1a73e8") : "#1a73e8"
  const glowTo = isOrbMode(props) ? (props.glowTo ?? "#8ab4f8") : "#8ab4f8"
  const glowAngle = isOrbMode(props) ? (props.glowAngle ?? 90) : 90
  const glowSize = isOrbMode(props) ? (props.glowSize ?? 420) : 420
  const glowBlur = isOrbMode(props) ? (props.glowBlur ?? 60) : 60
  const glowOpacity = isOrbMode(props) ? (props.glowOpacity ?? 0.9) : 0.9
  const { resolvedTheme } = usePersoraTheme()
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener?.("change", sync)
    return () => media.removeEventListener?.("change", sync)
  }, [])

  const isDarkTheme = useMemo(() => resolvedTheme === "dark", [resolvedTheme])

  const mouseX = useMotionValue(-gradientSize)
  const mouseY = useMotionValue(-gradientSize)
  const gradientX = useSpring(mouseX, { stiffness: 420, damping: 42, mass: 0.35 })
  const gradientY = useSpring(mouseY, { stiffness: 420, damping: 42, mass: 0.35 })

  const orbX = useSpring(mouseX, { stiffness: 250, damping: 30, mass: 0.6 })
  const orbY = useSpring(mouseY, { stiffness: 250, damping: 30, mass: 0.6 })
  const orbVisible = useSpring(0, { stiffness: 300, damping: 35 })

  const modeRef = useRef(mode)
  const glowOpacityRef = useRef(glowOpacity)
  const gradientSizeRef = useRef(gradientSize)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    glowOpacityRef.current = glowOpacity
  }, [glowOpacity])

  useEffect(() => {
    gradientSizeRef.current = gradientSize
  }, [gradientSize])

  const reset = useCallback(
    (reason: ResetReason = "leave") => {
      const currentMode = modeRef.current

      if (currentMode === "orb") {
        if (reason === "enter") orbVisible.set(glowOpacityRef.current)
        else orbVisible.set(0)
        return
      }

      const off = -gradientSizeRef.current
      mouseX.set(off)
      mouseY.set(off)
    },
    [mouseX, mouseY, orbVisible]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || e.pointerType === "touch") return
      const rect = e.currentTarget.getBoundingClientRect()
      mouseX.set(e.clientX - rect.left)
      mouseY.set(e.clientY - rect.top)
    },
    [mouseX, mouseY, reducedMotion]
  )

  useEffect(() => {
    reset("init")
  }, [reset])

  useEffect(() => {
    const handleGlobalPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) reset("global")
    }
    const handleBlur = () => reset("global")
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") reset("global")
    }

    window.addEventListener("pointerout", handleGlobalPointerOut)
    window.addEventListener("blur", handleBlur)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      window.removeEventListener("pointerout", handleGlobalPointerOut)
      window.removeEventListener("blur", handleBlur)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [reset])

  return (
    <motion.div
      className={cn(
        "group relative isolate overflow-hidden rounded-[inherit] border border-transparent",
        className
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => reset("leave")}
      onPointerEnter={() => reset("enter")}
      style={{
        background: useMotionTemplate`
          linear-gradient(var(--color-card) 0 0) padding-box,
          radial-gradient(${gradientSize}px circle at ${gradientX}px ${gradientY}px,
            ${gradientFrom},
            ${gradientTo},
            var(--color-border) 100%
          ) border-box
        `,
      }}
    >
      <div className="bg-card pointer-events-none absolute inset-px z-0 rounded-[inherit]" />

      {mode === "gradient" && !reducedMotion && (
        <motion.div
          suppressHydrationWarning
          className="pointer-events-none absolute inset-px z-[1] rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-(--mc-opacity)"
          style={
            {
              "--mc-opacity": gradientOpacity,
              background: useMotionTemplate`
                radial-gradient(${gradientSize}px circle at ${gradientX}px ${gradientY}px,
                  ${gradientColor},
                  transparent 100%
                )
              `,
            } as unknown as MotionStyle
          }
        />
      )}

      {mode === "orb" && (
        <motion.div
          suppressHydrationWarning
          aria-hidden="true"
          className="pointer-events-none absolute z-[1]"
          style={{
            width: glowSize,
            height: glowSize,
            x: orbX,
            y: orbY,
            translateX: "-50%",
            translateY: "-50%",
            borderRadius: 9999,
            filter: `blur(${glowBlur}px)`,
            opacity: orbVisible,
            background: `linear-gradient(${glowAngle}deg, ${glowFrom}, ${glowTo})`,

            mixBlendMode: isDarkTheme ? "screen" : "multiply",
            willChange: "transform, opacity",
          }}
        />
      )}
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  )
}
