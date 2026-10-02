import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Render fixed overlays outside animated/scrolling workspace containers. */
export default function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
