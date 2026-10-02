import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { MagicCard as RegistryMagicCard } from "./ui/magic-card";
import { ShimmerButton as RegistryShimmerButton } from "./ui/shimmer-button";

interface MagicCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glowColor?: string;
}

/**
 * Persora's small adapter around the Magic UI registry card. Keeping the
 * interaction target inside the card preserves the existing click/keyboard
 * behavior while the registry component owns its pointer-reactive edge glow.
 */
export function MagicCard({ children, className = "", glowColor = "rgba(26, 115, 232, .12)", ...props }: MagicCardProps) {
  return (
    <RegistryMagicCard
      className={`magic-card ${className}`}
      gradientSize={260}
      gradientFrom="rgba(26, 115, 232, .48)"
      gradientTo="rgba(138, 180, 248, .22)"
      gradientColor={glowColor}
      gradientOpacity={0.42}
    >
      <div className="magic-card-content" {...props}>{children}</div>
    </RegistryMagicCard>
  );
}

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  soft?: boolean;
}

export function ShimmerButton({ children, className = "", soft = false, ...props }: ShimmerButtonProps) {
  return (
    <RegistryShimmerButton
      {...props}
      className={`shimmer-button ${soft ? "shimmer-button-soft" : ""} ${className}`}
      background={soft ? "#e8f0fe" : "#1a73e8"}
      shimmerColor={soft ? "#8ab4f8" : "#ffffff"}
      shimmerDuration="3.4s"
      borderRadius="12px"
    >
      <span className="shimmer-content">{children}</span>
    </RegistryShimmerButton>
  );
}

export function AnimatedShinyText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`animated-shiny-text ${className}`}>{children}</span>;
}

export function BorderBeam({ className = "" }: { className?: string }) {
  return <span className={`border-beam ${className}`} aria-hidden="true" />;
}

export function BlurFade({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const style = useRef({ animationDelay: `${delay}ms` }).current;
  return <div className={`blur-fade ${className}`} style={style}>{children}</div>;
}
