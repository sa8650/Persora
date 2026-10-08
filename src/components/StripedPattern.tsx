import { useId, type SVGProps } from "react";

interface StripedPatternProps extends SVGProps<SVGSVGElement> {
  direction?: "left" | "right";
}

export default function StripedPattern({
  direction = "left",
  className,
  width = 10,
  height = 10,
  ...props
}: StripedPatternProps) {
  const patternId = `persora-stripes-${useId().replace(/:/g, "")}`;
  const tileWidth = Number(width) || 10;
  const tileHeight = Number(height) || 10;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`striped-pattern${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <pattern id={patternId} width={tileWidth} height={tileHeight} patternUnits="userSpaceOnUse">
          {direction === "left" ? (
            <>
              <line x1="0" y1={tileHeight} x2={tileWidth} y2="0" stroke="currentColor" />
              <line x1={-tileWidth} y1={tileHeight} x2="0" y2="0" stroke="currentColor" />
              <line x1={tileWidth} y1={tileHeight} x2={tileWidth * 2} y2="0" stroke="currentColor" />
            </>
          ) : (
            <>
              <line x1="0" y1="0" x2={tileWidth} y2={tileHeight} stroke="currentColor" />
              <line x1={-tileWidth} y1="0" x2="0" y2={tileHeight} stroke="currentColor" />
              <line x1={tileWidth} y1="0" x2={tileWidth * 2} y2={tileHeight} stroke="currentColor" />
            </>
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
