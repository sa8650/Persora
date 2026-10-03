import type { ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

type ResizablePanelGroupProps = ComponentProps<typeof Group>;
type ResizableHandleProps = ComponentProps<typeof Separator> & { withHandle?: boolean };

export function ResizablePanelGroup({ className, ...props }: ResizablePanelGroupProps) {
  return <Group className={["resizable-panel-group", className].filter(Boolean).join(" ")} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({ withHandle = false, children, className, ...props }: ResizableHandleProps) {
  return <Separator className={["resizable-handle", className].filter(Boolean).join(" ")} {...props}>
    {children ?? (withHandle ? <span className="resizable-handle-grip" aria-hidden="true"><GripVertical size={14} /></span> : null)}
  </Separator>;
}
