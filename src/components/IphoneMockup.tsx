import type { HTMLAttributes, ReactNode } from "react";

interface IphoneMockupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** A self-contained, content-ready iPhone frame based on the 433:882 Magic UI mockup proportion. */
export default function IphoneMockup({ children, className, ...props }: IphoneMockupProps) {
  return (
    <div className={`iphone-mockup${className ? ` ${className}` : ""}`} {...props}>
      <span className="iphone-device-button iphone-button-mute" aria-hidden="true" />
      <span className="iphone-device-button iphone-button-volume-up" aria-hidden="true" />
      <span className="iphone-device-button iphone-button-volume-down" aria-hidden="true" />
      <span className="iphone-device-button iphone-button-power" aria-hidden="true" />
      <div className="iphone-screen-viewport">
        {children}
        <span className="iphone-dynamic-island" aria-hidden="true"><i /></span>
        <span className="iphone-home-indicator" aria-hidden="true" />
      </div>
    </div>
  );
}
