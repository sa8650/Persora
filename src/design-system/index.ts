export {
  PersoraThemeProvider,
  usePersoraTheme,
  ThemeToggleButton,
  AppearanceSettingsCard,
  type PersoraThemeMode,
  type ResolvedPersoraTheme,
} from "./theme";

export {
  PersoraIconStack,
  PersoraEmptyState,
  PersoraAsideStat,
  PersoraSearchField,
  PersoraDeleteModal,
  iconToneClass,
  type PersoraTone,
  type PersoraIconStackProps,
  type PersoraEmptyStateProps,
  type PersoraAsideStatProps,
  type PersoraSearchFieldProps,
  type PersoraDeleteModalProps,
} from "./primitives";

/* Canonical ReUI & shadcn UI Primitives */
export { Badge, badgeVariants } from "@/components/reui/badge";
export { IconTile, iconTileVariants } from "@/components/reui/icon-tile";
export { IconStack, type IconStackProps } from "@/components/reui/icon-stack";
export {
  Frame,
  FramePanel,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FrameFooter,
  frameVariants,
} from "@/components/reui/frame";
export { FileType, getFileType, getFileTypeCategory } from "@/components/reui/file-type";
export {
  ReuiFileAttachmentField,
  Pattern as ReuiAttachmentPattern,
  type ReuiFileAttachmentFieldProps,
  type AttachmentPickerItem,
} from "@/components/reui/c-attachment-6";
export {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
  AttachmentGroup,
} from "@/components/ui/attachment";
export { Button, buttonVariants } from "@/components/ui/button";
export { Checkbox } from "@/components/ui/checkbox";
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
} from "@/components/ui/context-menu";
export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "@/components/ui/menubar";
export { Progress } from "@/components/ui/progress";
export { Spinner } from "@/components/ui/spinner";
export {
  TransferProgressIndicator,
  ImportProgressIndicator,
  StageProgressIndicator,
  formatRemaining,
} from "@/components/ProgressIndicator";
