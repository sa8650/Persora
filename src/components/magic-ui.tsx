import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

interface MagicCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glowColor?: string;
}

export function MagicCard({ children, className = "", glowColor = "rgba(77, 155, 130, 0.13)", onMouseMove, ...props }: MagicCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    if (ref.current) {
      const bounds = ref.current.getBoundingClientRect();
      ref.current.style.setProperty("--mouse-x", `${event.clientX - bounds.left}px`);
      ref.current.style.setProperty("--mouse-y", `${event.clientY - bounds.top}px`);
      ref.current.style.setProperty("--magic-glow", glowColor);
    }
    onMouseMove?.(event);
  };
  return (
    <div ref={ref} className={`magic-card ${className}`} onMouseMove={handleMove} {...props}>
      <span className="magic-card-spotlight" aria-hidden="true" />
      {children}
    </div>
  );
}

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  soft?: boolean;
}

export function ShimmerButton({ children, className = "", soft = false, ...props }: ShimmerButtonProps) {
  return (
    <button className={`shimmer-button ${soft ? "shimmer-button-soft" : ""} ${className}`} {...props}>
      <span className="shimmer-button-label">{children}</span>
      <span className="shimmer-button-shine" aria-hidden="true" />
    </button>
  );
}

export function AnimatedShinyText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`animated-shiny-text ${className}`}>{children}</span>;
}

export function BorderBeam({ className = "" }: { className?: string }) {
  return <span className={`border-beam ${className}`} aria-hidden="true" />;
}

export function BlurFade({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <div className={`blur-fade ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}
