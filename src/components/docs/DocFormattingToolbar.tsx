// Persora Docs — Clean, logically grouped Google Docs-style formatting toolbar.
// Groups controls with compact dropdowns: Undo/Redo, Zoom (50%–200% + Fit),
// Paragraph Style, Font Family, Font Size, Bold/Italic/Underline, Text Case (Aa)
// & Strikethrough, Text Color, Highlight, Alignment, Line Spacing, Lists,
// Insert (Table, Image from device, Shapes, Header/Footer, Page Numbers, Page Break,
// Link, Comment), Page Setup (Orientation, Margins, Independent Per-Page Color,
// Ruler toggle), Contextual Table Formatting, and Clear Formatting.
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowUpDown,
  Bold,
  Check,
  ChevronDown,
  ExternalLink,
  FilePlus2,
  Grid3X3,
  Hash,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Palette,
  PanelBottom,
  PanelTop,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Ruler,
  Shapes,
  SlidersHorizontal,
  SplitSquareVertical,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import {
  DOC_FONT_FAMILIES,
  DOC_FONT_SIZES,
  DOC_HIGHLIGHT_COLORS,
  DOC_LINE_HEIGHTS,
  DOC_PAGE_COLORS,
  DOC_PAPER_SIZES,
  DOC_TEXT_COLORS,
  normalizeFontFamily,
  normalizeFontSize,
  sanitizeDocHref,
  type DocFontFamilyId,
  type DocFontSize,
  type DocMargins,
  type DocPageOrientation,
  type DocPageSetup,
  type DocPaperSizeId,
  type DocShapeType,
} from "../../../cloudflare/docs-rules.js";
import {
  insertDocTable,
  runDocTableCommand,
  setDocTableCellAttr,
  transformEditorTextCase,
} from "./docs-extensions";
import { DOC_SHAPE_CATALOG } from "./DocShapesLayer";
import { readDeviceImageAsDataUrl } from "./DocImageNodeView";
import { Checkbox } from "@/components/ui/checkbox";

export type DocZoomSetting = number | "fit";

const ZOOM_PRESETS: Array<{ value: DocZoomSetting; label: string }> = [
  { value: "fit", label: "Fit to page" },
  { value: 50, label: "50%" },
  { value: 75, label: "75%" },
  { value: 90, label: "90%" },
  { value: 100, label: "100%" },
  { value: 125, label: "125%" },
  { value: 150, label: "150%" },
  { value: 200, label: "200%" },
];

type BlockStyleId = "normal" | "title" | "subtitle" | "h1" | "h2" | "h3";

const BLOCK_STYLE_OPTIONS: Array<{
  id: BlockStyleId;
  label: string;
  sampleClass: string;
}> = [
  { id: "normal", label: "Normal text", sampleClass: "is-normal" },
  { id: "title", label: "Title", sampleClass: "is-title" },
  { id: "subtitle", label: "Subtitle", sampleClass: "is-subtitle" },
  { id: "h1", label: "Heading 1", sampleClass: "is-h1" },
  { id: "h2", label: "Heading 2", sampleClass: "is-h2" },
  { id: "h3", label: "Heading 3", sampleClass: "is-h3" },
];

type OpenMenuId =
  | null
  | "zoom"
  | "style"
  | "fontFamily"
  | "fontSize"
  | "caseMarks"
  | "color"
  | "highlight"
  | "align"
  | "spacing"
  | "insert"
  | "pageSetup"
  | "tableFormat"
  | "link";

function currentBlockStyle(editor: Editor): BlockStyleId {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  const paraAttrs = editor.getAttributes("paragraph");
  if (paraAttrs?.variant === "title") return "title";
  if (paraAttrs?.variant === "subtitle") return "subtitle";
  return "normal";
}

function defaultPtForBlock(style: BlockStyleId): number {
  switch (style) {
    case "title":
      return 24;
    case "subtitle":
      return 14;
    case "h1":
      return 18;
    case "h2":
      return 14;
    case "h3":
      return 12;
    default:
      return 11;
  }
}

function currentFontSizeNumber(editor: Editor, blockStyle: BlockStyleId): number {
  const attr = normalizeFontSize(editor.getAttributes("textStyle")?.fontSize);
  if (attr) {
    const parsed = Number(attr.replace("pt", ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return defaultPtForBlock(blockStyle);
}

export default function DocFormattingToolbar({
  editor,
  linkTriggerNonce,
  zoomSetting,
  effectiveZoomPercent,
  onChangeZoom,
  pageSetup,
  activePageIndex,
  pageCount,
  onUpdatePageSetup,
  onSetPageColor,
  onInsertShape,
  onFocusHeaderFooter,
  onRequestAddComment,
  notify,
}: {
  editor: Editor | null;
  linkTriggerNonce?: number;
  zoomSetting: DocZoomSetting;
  effectiveZoomPercent: number;
  onChangeZoom: (next: DocZoomSetting) => void;
  pageSetup: DocPageSetup;
  activePageIndex: number;
  pageCount: number;
  onUpdatePageSetup: (patch: Partial<DocPageSetup>) => void;
  onSetPageColor: (pageIndex: number, hexColor: string) => void;
  onInsertShape: (shapeType: DocShapeType) => void;
  onFocusHeaderFooter: (zone: "header" | "footer") => void;
  onRequestAddComment: () => void;
  notify?: (message: string, kind?: "success" | "error") => void;
}) {
  const [openMenu, setOpenMenu] = useState<OpenMenuId>(null);
  const [insertSubTab, setInsertSubTab] = useState<null | "table" | "shapes">(null);
  const [hoverGrid, setHoverGrid] = useState<{ r: number; c: number }>({ r: 3, c: 3 });
  const [customTableRows, setCustomTableRows] = useState(3);
  const [customTableCols, setCustomTableCols] = useState(3);
  const [targetColorPageIdx, setTargetColorPageIdx] = useState<number>(activePageIndex);

  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [, setSelectionTick] = useState(0);

  const barRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastLinkNonce = useRef(0);

  useEffect(() => {
    setTargetColorPageIdx((prev) =>
      openMenu === "pageSetup" ? Math.min(pageCount - 1, Math.max(0, prev)) : activePageIndex,
    );
  }, [activePageIndex, openMenu, pageCount]);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setSelectionTick((n) => n + 1);
    editor.on("selectionUpdate", bump);
    editor.on("transaction", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("transaction", bump);
    };
  }, [editor]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setInsertSubTab(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setInsertSubTab(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const openLinkPopover = () => {
    if (!editor) return;
    const existingHref = String(editor.getAttributes("link")?.href || "");
    const { from, to } = editor.state.selection;
    const selectedText = from !== to ? editor.state.doc.textBetween(from, to, " ") : "";
    setLinkUrl(existingHref);
    setLinkText(selectedText);
    setLinkError("");
    setOpenMenu("link");
  };

  useEffect(() => {
    if (linkTriggerNonce && linkTriggerNonce !== lastLinkNonce.current) {
      lastLinkNonce.current = linkTriggerNonce;
      openLinkPopover();
    }
  }, [linkTriggerNonce]);

  if (!editor) return null;

  const blockStyle = currentBlockStyle(editor);
  const activeBlockMeta =
    BLOCK_STYLE_OPTIONS.find((opt) => opt.id === blockStyle) || BLOCK_STYLE_OPTIONS[0];
  const fontSizePt = currentFontSizeNumber(editor, blockStyle);
  const activeFontId =
    normalizeFontFamily(editor.getAttributes("textStyle")?.fontFamily) || "sans";
  const activeFontMeta =
    DOC_FONT_FAMILIES.find((f) => f.id === activeFontId) || DOC_FONT_FAMILIES[0];
  const activeColor = String(editor.getAttributes("textStyle")?.color || "#1f2937");
  const activeHighlight = String(editor.getAttributes("highlight")?.color || "");
  const isLinkActive = editor.isActive("link");
  const isTableActive = editor.isActive("table");

  const activeLineHeight = String(
    editor.getAttributes("paragraph")?.lineHeight ||
      editor.getAttributes("heading")?.lineHeight ||
      "1.62",
  );
  const activeSpaceAfter = editor.getAttributes("paragraph")?.spaceAfter;

  const activeAlign: "left" | "center" | "right" | "justify" = editor.isActive({
    textAlign: "center",
  })
    ? "center"
    : editor.isActive({ textAlign: "right" })
      ? "right"
      : editor.isActive({ textAlign: "justify" })
        ? "justify"
        : "left";

  const ActiveAlignIcon =
    activeAlign === "center"
      ? AlignCenter
      : activeAlign === "right"
        ? AlignRight
        : activeAlign === "justify"
          ? AlignJustify
          : AlignLeft;

  const selectedPageBg =
    pageSetup.pageColors[String(targetColorPageIdx)] || "#ffffff";

  const applyBlockStyle = (id: BlockStyleId) => {
    setOpenMenu(null);
    if (id === "h1" || id === "h2" || id === "h3") {
      const level = id === "h1" ? 1 : id === "h2" ? 2 : 3;
      editor.chain().focus().setHeading({ level }).run();
      return;
    }
    editor
      .chain()
      .focus()
      .setParagraph()
      .updateAttributes("paragraph", { variant: id })
      .run();
  };

  const applyFontFamily = (fontId: DocFontFamilyId) => {
    setOpenMenu(null);
    editor.chain().focus().setMark("textStyle", { fontFamily: fontId }).run();
  };

  const applyFontSize = (size: DocFontSize) => {
    setOpenMenu(null);
    editor.chain().focus().setMark("textStyle", { fontSize: size }).run();
  };

  const stepFontSize = (delta: -1 | 1) => {
    const nums = DOC_FONT_SIZES.map((s) => Number(s.replace("pt", "")));
    let idx = nums.findIndex((n) => n >= fontSizePt);
    if (idx === -1) idx = nums.length - 1;
    const nextIdx = Math.max(0, Math.min(nums.length - 1, idx + delta));
    applyFontSize(DOC_FONT_SIZES[nextIdx]);
  };

  const applyLineHeight = (lh: string) => {
    setOpenMenu(null);
    if (editor.isActive("heading")) {
      editor.chain().focus().updateAttributes("heading", { lineHeight: lh }).run();
    } else {
      editor.chain().focus().updateAttributes("paragraph", { lineHeight: lh }).run();
    }
  };

  const handleImageFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const imgData = await readDeviceImageAsDataUrl(file);
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "docImage",
            attrs: {
              src: imgData.src,
              alt: imgData.alt,
              width: imgData.width,
              height: imgData.height,
              wrap: "inline",
              align: "left",
            },
          },
          { type: "paragraph" },
        ])
        .run();
    } catch (err) {
      notify?.(
        err instanceof Error ? err.message : "Could not insert image from device.",
        "error",
      );
    }
  };

  const submitLink = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setOpenMenu(null);
      return;
    }
    const safeHref = sanitizeDocHref(trimmedUrl, { autoHttps: true });
    if (!safeHref) {
      setLinkError("Enter a valid https://, http://, or mailto: address.");
      return;
    }

    const { from, to } = editor.state.selection;
    const displayLabel = linkText.trim() || safeHref;

    if (from === to && !isLinkActive) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: displayLabel,
          marks: [
            {
              type: "link",
              attrs: {
                href: safeHref,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ],
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: safeHref, target: "_blank", rel: "noopener noreferrer nofollow" })
        .run();
    }
    setOpenMenu(null);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpenMenu(null);
  };

  const clearFormatting = () => {
    editor
      .chain()
      .focus()
      .unsetAllMarks()
      .clearNodes()
      .updateAttributes("paragraph", {
        variant: "normal",
        lineHeight: null,
        spaceAfter: null,
      })
      .setTextAlign("left")
      .run();
  };

  const updateMarginSide = (side: keyof DocMargins, valPt: number) => {
    const clamped = Math.max(18, Math.min(180, Math.round(valPt)));
    onUpdatePageSetup({
      margins: {
        ...pageSetup.margins,
        [side]: clamped,
      },
    });
  };

  return (
    <div
      ref={barRef}
      className="pd-toolbar"
      role="toolbar"
      aria-label="Document formatting"
    >
      {/* Hidden device file input for Image insertion */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="pd-sr-file-input"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void handleImageFilePicked(e)}
      />

      {/* 1. Undo / Redo + Zoom */}
      <div className="pd-tb-group">
        <button
          type="button"
          className="pd-tb-btn"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="pd-tb-btn"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </button>

        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-zoom-trigger ${openMenu === "zoom" ? "is-open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "zoom" ? null : "zoom")}
            aria-label="Zoom level"
            aria-haspopup="menu"
            aria-expanded={openMenu === "zoom"}
            title="Zoom"
          >
            <span>{zoomSetting === "fit" ? `Fit (${effectiveZoomPercent}%)` : `${zoomSetting}%`}</span>
            <ChevronDown size={12} />
          </button>
          {openMenu === "zoom" && (
            <div className="pd-tb-popover pd-tb-compact-menu" role="menu" aria-label="Zoom levels">
              {ZOOM_PRESETS.map((z) => {
                const active = zoomSetting === z.value;
                return (
                  <button
                    key={String(z.value)}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`pd-tb-menu-row ${active ? "is-active" : ""}`}
                    onClick={() => {
                      onChangeZoom(z.value);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="pd-tb-check-slot">{active && <Check size={13} />}</span>
                    <span>{z.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* 2. Paragraph Style + Font Family + Font Size */}
      <div className="pd-tb-group">
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-style-trigger ${openMenu === "style" ? "is-open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "style" ? null : "style")}
            aria-label="Paragraph style"
            aria-haspopup="menu"
            aria-expanded={openMenu === "style"}
            title="Styles"
          >
            <span>{activeBlockMeta.label}</span>
            <ChevronDown size={12} />
          </button>
          {openMenu === "style" && (
            <div className="pd-tb-popover pd-tb-style-menu" role="menu" aria-label="Text styles">
              {BLOCK_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={blockStyle === opt.id}
                  className={`pd-tb-style-item ${opt.sampleClass} ${blockStyle === opt.id ? "is-active" : ""}`}
                  onClick={() => applyBlockStyle(opt.id)}
                >
                  <span className="pd-tb-check-slot">
                    {blockStyle === opt.id && <Check size={14} />}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-font-trigger ${openMenu === "fontFamily" ? "is-open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "fontFamily" ? null : "fontFamily")}
            aria-label="Font family"
            aria-haspopup="menu"
            aria-expanded={openMenu === "fontFamily"}
            title="Font family"
          >
            <span className="pd-tb-truncate">{activeFontMeta.label}</span>
            <ChevronDown size={12} />
          </button>
          {openMenu === "fontFamily" && (
            <div className="pd-tb-popover pd-tb-font-menu" role="menu" aria-label="Font families">
              {DOC_FONT_FAMILIES.map((fam) => {
                const active = activeFontId === fam.id;
                return (
                  <button
                    key={fam.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`pd-tb-menu-row ${active ? "is-active" : ""}`}
                    style={{ fontFamily: fam.css }}
                    onClick={() => applyFontFamily(fam.id)}
                  >
                    <span className="pd-tb-check-slot">{active && <Check size={13} />}</span>
                    <span>{fam.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pd-tb-group pd-tb-fontsize-group">
          <button
            type="button"
            className="pd-tb-btn pd-tb-step-btn"
            onClick={() => stepFontSize(-1)}
            aria-label="Decrease font size"
            title="Decrease font size"
          >
            <Minus size={13} />
          </button>
          <div className="pd-tb-dropdown-wrap">
            <button
              type="button"
              className={`pd-tb-select-btn pd-tb-size-trigger ${openMenu === "fontSize" ? "is-open" : ""}`}
              onClick={() => setOpenMenu(openMenu === "fontSize" ? null : "fontSize")}
              aria-label="Font size"
              aria-haspopup="menu"
              aria-expanded={openMenu === "fontSize"}
              title="Font size"
            >
              <span>{fontSizePt}</span>
            </button>
            {openMenu === "fontSize" && (
              <div className="pd-tb-popover pd-tb-size-menu" role="menu" aria-label="Font sizes">
                {DOC_FONT_SIZES.map((sz) => {
                  const n = Number(sz.replace("pt", ""));
                  return (
                    <button
                      key={sz}
                      type="button"
                      role="menuitemradio"
                      aria-checked={fontSizePt === n}
                      className={`pd-tb-size-item ${fontSizePt === n ? "is-active" : ""}`}
                      onClick={() => applyFontSize(sz)}
                    >
                      <span>{n}</span>
                      {fontSizePt === n && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            className="pd-tb-btn pd-tb-step-btn"
            onClick={() => stepFontSize(1)}
            aria-label="Increase font size"
            title="Increase font size"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* 3. Inline Marks, Text Case (Aa), Text Color & Highlight */}
      <div className="pd-tb-group">
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("bold") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("italic") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("underline") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          aria-label="Underline"
          aria-pressed={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={15} />
        </button>

        {/* Font Case Transformation (Aa) + Strikethrough */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-btn pd-tb-case-btn ${openMenu === "caseMarks" || editor.isActive("strike") ? "is-on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "caseMarks" ? null : "caseMarks")}
            aria-label="Text case and strikethrough"
            aria-haspopup="menu"
            aria-expanded={openMenu === "caseMarks"}
            title="Capitalization & strikethrough"
          >
            <span className="pd-tb-aa-glyph">Aa</span>
          </button>
          {openMenu === "caseMarks" && (
            <div
              className="pd-tb-popover pd-tb-compact-menu"
              role="menu"
              aria-label="Text case transformation"
            >
              <div className="pd-tb-menu-section-label">Change case</div>
              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  transformEditorTextCase(editor, "uppercase");
                  setOpenMenu(null);
                }}
              >
                <span className="pd-tb-case-sample">AA</span>
                <span>UPPERCASE</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  transformEditorTextCase(editor, "lowercase");
                  setOpenMenu(null);
                }}
              >
                <span className="pd-tb-case-sample">aa</span>
                <span>lowercase</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  transformEditorTextCase(editor, "capitalize");
                  setOpenMenu(null);
                }}
              >
                <span className="pd-tb-case-sample">Aa</span>
                <span>Capitalize Each Word</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  transformEditorTextCase(editor, "sentence");
                  setOpenMenu(null);
                }}
              >
                <span className="pd-tb-case-sample">Aa.</span>
                <span>Sentence case</span>
              </button>
              <div className="pd-menu-divider" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={editor.isActive("strike")}
                className={`pd-tb-menu-row ${editor.isActive("strike") ? "is-active" : ""}`}
                onClick={() => {
                  editor.chain().focus().toggleStrike().run();
                  setOpenMenu(null);
                }}
              >
                <Strikethrough size={14} />
                <span>Strikethrough</span>
              </button>
            </div>
          )}
        </div>

        {/* Text Color */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-btn pd-tb-color-btn ${openMenu === "color" ? "is-on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "color" ? null : "color")}
            aria-label="Text color"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "color"}
            title="Text color"
          >
            <Palette size={15} />
            <span className="pd-tb-color-bar" style={{ backgroundColor: activeColor }} />
          </button>
          {openMenu === "color" && (
            <div className="pd-tb-popover pd-tb-swatch-popover" role="dialog" aria-label="Text color">
              <div className="pd-tb-swatch-title">Text color</div>
              <div className="pd-tb-swatch-grid">
                {DOC_TEXT_COLORS.map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    className={`pd-tb-swatch ${activeColor.toLowerCase() === swatch.hex ? "is-selected" : ""}`}
                    style={{ backgroundColor: swatch.hex }}
                    aria-label={swatch.label}
                    title={swatch.label}
                    onClick={() => {
                      editor.chain().focus().setColor(swatch.hex).run();
                      setOpenMenu(null);
                    }}
                  />
                ))}
              </div>
              <div className="pd-custom-color-row">
                <label className="pd-custom-color-label">
                  <span>Custom</span>
                  <input
                    type="color"
                    aria-label="Custom text color"
                    value={activeColor}
                    onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                  />
                </label>
                <button
                  type="button"
                  className="pd-tb-swatch-reset"
                  onClick={() => {
                    editor.chain().focus().unsetColor().run();
                    setOpenMenu(null);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Highlight Color */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-btn pd-tb-color-btn ${openMenu === "highlight" || Boolean(activeHighlight) ? "is-on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "highlight" ? null : "highlight")}
            aria-label="Highlight color"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "highlight"}
            title="Highlight color"
          >
            <Highlighter size={15} />
            <span
              className="pd-tb-color-bar"
              style={{ backgroundColor: activeHighlight || "transparent" }}
            />
          </button>
          {openMenu === "highlight" && (
            <div
              className="pd-tb-popover pd-tb-swatch-popover"
              role="dialog"
              aria-label="Highlight color"
            >
              <div className="pd-tb-swatch-title">Highlight</div>
              <div className="pd-tb-swatch-grid">
                {DOC_HIGHLIGHT_COLORS.map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    className={`pd-tb-swatch ${activeHighlight.toLowerCase() === swatch.hex ? "is-selected" : ""}`}
                    style={{ backgroundColor: swatch.hex }}
                    aria-label={swatch.label}
                    title={swatch.label}
                    onClick={() => {
                      editor.chain().focus().toggleHighlight({ color: swatch.hex }).run();
                      setOpenMenu(null);
                    }}
                  />
                ))}
              </div>
              <div className="pd-custom-color-row">
                <label className="pd-custom-color-label">
                  <span>Custom</span>
                  <input
                    type="color"
                    aria-label="Custom highlight color"
                    value={activeHighlight || "#fef08a"}
                    onChange={(e) =>
                      editor.chain().focus().setHighlight({ color: e.target.value }).run()
                    }
                  />
                </label>
                <button
                  type="button"
                  className="pd-tb-swatch-reset"
                  onClick={() => {
                    editor.chain().focus().unsetHighlight().run();
                    setOpenMenu(null);
                  }}
                >
                  None
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* 4. Alignment Dropdown + Line Spacing Dropdown + Lists */}
      <div className="pd-tb-group">
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-icon-drop ${openMenu === "align" ? "is-open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "align" ? null : "align")}
            aria-label="Text alignment"
            aria-haspopup="menu"
            aria-expanded={openMenu === "align"}
            title="Align & justify"
          >
            <ActiveAlignIcon size={15} />
            <ChevronDown size={11} />
          </button>
          {openMenu === "align" && (
            <div className="pd-tb-popover pd-tb-align-popover" role="menu" aria-label="Alignment">
              {(
                [
                  { id: "left", label: "Align left", Icon: AlignLeft },
                  { id: "center", label: "Align center", Icon: AlignCenter },
                  { id: "right", label: "Align right", Icon: AlignRight },
                  { id: "justify", label: "Justify", Icon: AlignJustify },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeAlign === id}
                  aria-label={label}
                  title={label}
                  className={`pd-tb-btn ${activeAlign === id ? "is-on" : ""}`}
                  onClick={() => {
                    editor.chain().focus().setTextAlign(id).run();
                    setOpenMenu(null);
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Line & Paragraph Spacing */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-btn ${openMenu === "spacing" ? "is-on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "spacing" ? null : "spacing")}
            aria-label="Line and paragraph spacing"
            aria-haspopup="menu"
            aria-expanded={openMenu === "spacing"}
            title="Line & paragraph spacing"
          >
            <ArrowUpDown size={15} />
          </button>
          {openMenu === "spacing" && (
            <div className="pd-tb-popover pd-tb-compact-menu" role="menu" aria-label="Line spacing">
              <div className="pd-tb-menu-section-label">Line spacing</div>
              {DOC_LINE_HEIGHTS.map((lh) => {
                const active = activeLineHeight === lh.value;
                return (
                  <button
                    key={lh.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`pd-tb-menu-row ${active ? "is-active" : ""}`}
                    onClick={() => applyLineHeight(lh.value)}
                  >
                    <span className="pd-tb-check-slot">{active && <Check size={13} />}</span>
                    <span>{lh.label}</span>
                  </button>
                );
              })}
              <div className="pd-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  const nextAfter = activeSpaceAfter === 0 ? null : 0;
                  editor.chain().focus().updateAttributes("paragraph", { spaceAfter: nextAfter }).run();
                  setOpenMenu(null);
                }}
              >
                <span className="pd-tb-check-slot">
                  {activeSpaceAfter === 0 && <Check size={13} />}
                </span>
                <span>{activeSpaceAfter === 0 ? "Restore space after paragraph" : "Remove space after paragraph"}</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("bulletList") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Bulleted list"
          aria-pressed={editor.isActive("bulletList")}
          title="Bulleted list"
        >
          <List size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("orderedList") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
          aria-pressed={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("blockquote") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label="Blockquote"
          aria-pressed={editor.isActive("blockquote")}
          title="Quote block"
        >
          <Quote size={14} />
        </button>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* 5. Insert Menu + Link + Page Setup + Contextual Table + Clear Formatting */}
      <div className="pd-tb-group">
        {/* Insert Building Blocks Menu */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-insert-trigger ${openMenu === "insert" ? "is-open" : ""}`}
            onClick={() => {
              setOpenMenu(openMenu === "insert" ? null : "insert");
              setInsertSubTab(null);
            }}
            aria-label="Insert menu"
            aria-haspopup="menu"
            aria-expanded={openMenu === "insert"}
            title="Insert table, image, shape, header, footer, or page break"
          >
            <Plus size={14} />
            <span>Insert</span>
            <ChevronDown size={12} />
          </button>

          {openMenu === "insert" && (
            <div className="pd-tb-popover pd-tb-insert-menu" role="menu" aria-label="Insert elements">
              <button
                type="button"
                role="menuitem"
                className={`pd-tb-menu-row ${insertSubTab === "table" ? "is-active" : ""}`}
                onClick={() => setInsertSubTab(insertSubTab === "table" ? null : "table")}
              >
                <TableIcon size={14} />
                <span>Table</span>
                <ChevronDown size={12} style={{ marginLeft: "auto" }} />
              </button>

              {insertSubTab === "table" && (
                <div className="pd-insert-subpanel" aria-label="Choose table size">
                  <div className="pd-table-grid-label">
                    {hoverGrid.r} × {hoverGrid.c} table
                  </div>
                  <div className="pd-table-picker-grid">
                    {Array.from({ length: 6 }, (_, rIdx) =>
                      Array.from({ length: 6 }, (_, cIdx) => {
                        const r = rIdx + 1;
                        const c = cIdx + 1;
                        const lit = r <= hoverGrid.r && c <= hoverGrid.c;
                        return (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            className={`pd-table-picker-cell ${lit ? "is-lit" : ""}`}
                            aria-label={`Insert ${r} by ${c} table`}
                            onMouseEnter={() => setHoverGrid({ r, c })}
                            onClick={() => {
                              insertDocTable(editor, r, c);
                              setOpenMenu(null);
                              setInsertSubTab(null);
                            }}
                          />
                        );
                      }),
                    )}
                  </div>
                  <div className="pd-table-custom-row">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      aria-label="Table rows"
                      value={customTableRows}
                      onChange={(e) => setCustomTableRows(Number(e.target.value) || 3)}
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      aria-label="Table columns"
                      value={customTableCols}
                      onChange={(e) => setCustomTableCols(Number(e.target.value) || 3)}
                    />
                    <button
                      type="button"
                      className="pd-tb-mini-apply"
                      onClick={() => {
                        insertDocTable(editor, customTableRows, customTableCols);
                        setOpenMenu(null);
                        setInsertSubTab(null);
                      }}
                    >
                      Insert
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  setOpenMenu(null);
                  fileInputRef.current?.click();
                }}
              >
                <ImagePlus size={14} />
                <span>Image from device</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className={`pd-tb-menu-row ${insertSubTab === "shapes" ? "is-active" : ""}`}
                onClick={() => setInsertSubTab(insertSubTab === "shapes" ? null : "shapes")}
              >
                <Shapes size={14} />
                <span>Shapes</span>
                <ChevronDown size={12} style={{ marginLeft: "auto" }} />
              </button>

              {insertSubTab === "shapes" && (
                <div className="pd-insert-subpanel pd-shapes-picker-grid" aria-label="Choose shape">
                  {DOC_SHAPE_CATALOG.map((sh) => (
                    <button
                      key={sh.type}
                      type="button"
                      className="pd-shape-pick-btn"
                      onClick={() => {
                        onInsertShape(sh.type);
                        setOpenMenu(null);
                        setInsertSubTab(null);
                      }}
                    >
                      {sh.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="pd-menu-divider" />

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  setOpenMenu(null);
                  onFocusHeaderFooter("header");
                }}
              >
                <PanelTop size={14} />
                <span>Header</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  setOpenMenu(null);
                  onFocusHeaderFooter("footer");
                }}
              >
                <PanelBottom size={14} />
                <span>Footer</span>
              </button>

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={pageSetup.showPageNumbers}
                className="pd-tb-menu-row"
                onClick={() => {
                  onUpdatePageSetup({ showPageNumbers: !pageSetup.showPageNumbers });
                  setOpenMenu(null);
                }}
              >
                <Hash size={14} />
                <span>{pageSetup.showPageNumbers ? "Hide page numbers" : "Page numbers"}</span>
              </button>

              <div className="pd-menu-divider" />

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertContent([{ type: "pageBreak" }, { type: "paragraph" }])
                    .run();
                  setOpenMenu(null);
                }}
              >
                <FilePlus2 size={14} />
                <span>Page break (Ctrl+Enter)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  editor.chain().focus().setHorizontalRule().run();
                  setOpenMenu(null);
                }}
              >
                <SplitSquareVertical size={14} />
                <span>Horizontal line</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  setOpenMenu(null);
                  openLinkPopover();
                }}
              >
                <Link2 size={14} />
                <span>Link (Ctrl+K)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pd-tb-menu-row"
                onClick={() => {
                  setOpenMenu(null);
                  onRequestAddComment();
                }}
              >
                <MessageSquarePlus size={14} />
                <span>Comment</span>
              </button>
            </div>
          )}
        </div>

        {/* Quick Link Button & Popover */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-btn ${isLinkActive || openMenu === "link" ? "is-on" : ""}`}
            onClick={() => {
              if (openMenu === "link") setOpenMenu(null);
              else openLinkPopover();
            }}
            aria-label="Insert or edit link"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "link"}
            title="Insert link (Ctrl+K)"
          >
            <Link2 size={15} />
          </button>
          {openMenu === "link" && (
            <form
              className="pd-tb-popover pd-tb-link-popover"
              onSubmit={submitLink}
              role="dialog"
              aria-label="Insert or edit hyperlink"
            >
              <label className="pd-tb-link-field">
                <span>Link URL</span>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => {
                    setLinkUrl(e.target.value);
                    setLinkError("");
                  }}
                  placeholder="https://example.com"
                  autoFocus
                />
              </label>
              {!isLinkActive && (
                <label className="pd-tb-link-field">
                  <span>Text (optional)</span>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Display text"
                  />
                </label>
              )}
              {linkError && (
                <p className="pd-tb-link-error" role="alert">
                  {linkError}
                </p>
              )}
              <div className="pd-tb-link-actions">
                {isLinkActive && (
                  <div className="pd-tb-link-left-actions">
                    {sanitizeDocHref(linkUrl, { autoHttps: true }) && (
                      <a
                        href={sanitizeDocHref(linkUrl, { autoHttps: true }) || "#"}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="pd-tb-link-open"
                        title="Open link in new tab"
                      >
                        <ExternalLink size={13} /> Open
                      </a>
                    )}
                    <button
                      type="button"
                      className="pd-tb-link-remove"
                      onClick={removeLink}
                      title="Remove link"
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                )}
                <button type="submit" className="pd-tb-link-apply">
                  Apply
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Page Setup, Margins, Orientation, Ruler & Per-Page Color */}
        <div className="pd-tb-dropdown-wrap">
          <button
            type="button"
            className={`pd-tb-select-btn pd-tb-page-trigger ${openMenu === "pageSetup" ? "is-open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "pageSetup" ? null : "pageSetup")}
            aria-label="Page setup"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "pageSetup"}
            title="Page setup: orientation, margins, page color & ruler"
          >
            <SlidersHorizontal size={14} />
            <span>Page</span>
            <ChevronDown size={12} />
          </button>

          {openMenu === "pageSetup" && (
            <div
              className="pd-tb-popover pd-page-setup-popover"
              role="dialog"
              aria-label="Page setup and background color"
            >
              {/* Orientation + Paper Size */}
              <div className="pd-ps-section">
                <div className="pd-ps-label">Orientation &amp; paper</div>
                <div className="pd-ps-segmented">
                  {(["portrait", "landscape"] as DocPageOrientation[]).map((orient) => (
                    <button
                      key={orient}
                      type="button"
                      className={`pd-ps-seg-btn ${pageSetup.orientation === orient ? "is-on" : ""}`}
                      onClick={() => onUpdatePageSetup({ orientation: orient })}
                    >
                      {orient === "portrait" ? "Portrait" : "Landscape"}
                    </button>
                  ))}
                </div>
                <select
                  className="pd-ps-select"
                  aria-label="Paper size"
                  value={pageSetup.paperSize}
                  onChange={(e) =>
                    onUpdatePageSetup({ paperSize: e.target.value as DocPaperSizeId })
                  }
                >
                  <option value="letter">{DOC_PAPER_SIZES.letter.label}</option>
                  <option value="a4">{DOC_PAPER_SIZES.a4.label}</option>
                  <option value="legal">{DOC_PAPER_SIZES.legal.label}</option>
                </select>
              </div>

              {/* Configurable Margins (Top, Bottom, Left, Right) */}
              <div className="pd-ps-section">
                <div className="pd-ps-head-inline">
                  <span className="pd-ps-label">Margins (points)</span>
                  <div className="pd-ps-preset-pills">
                    <button
                      type="button"
                      className="pd-ps-pill"
                      onClick={() =>
                        onUpdatePageSetup({
                          margins: { top: 36, bottom: 36, left: 36, right: 36 },
                        })
                      }
                    >
                      Narrow
                    </button>
                    <button
                      type="button"
                      className="pd-ps-pill"
                      onClick={() =>
                        onUpdatePageSetup({
                          margins: { top: 54, bottom: 54, left: 63, right: 63 },
                        })
                      }
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className="pd-ps-pill"
                      onClick={() =>
                        onUpdatePageSetup({
                          margins: { top: 72, bottom: 72, left: 96, right: 96 },
                        })
                      }
                    >
                      Wide
                    </button>
                  </div>
                </div>
                <div className="pd-ps-margins-grid">
                  {(["top", "bottom", "left", "right"] as const).map((side) => (
                    <label key={side} className="pd-ps-margin-input">
                      <span>{side[0].toUpperCase() + side.slice(1)}</span>
                      <input
                        type="number"
                        min={18}
                        max={180}
                        aria-label={`${side[0].toUpperCase() + side.slice(1)} margin`}
                        value={pageSetup.margins[side]}
                        onChange={(e) => updateMarginSide(side, Number(e.target.value) || 54)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Independent Per-Page Background Color */}
              <div className="pd-ps-section">
                <div className="pd-ps-head-inline">
                  <span className="pd-ps-label">Page color</span>
                  <select
                    className="pd-ps-page-select"
                    aria-label="Select page to color"
                    value={targetColorPageIdx}
                    onChange={(e) => setTargetColorPageIdx(Number(e.target.value) || 0)}
                  >
                    {Array.from({ length: pageCount }, (_, idx) => (
                      <option key={idx} value={idx}>
                        Page {idx + 1}
                        {idx === activePageIndex ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pd-tb-swatch-grid">
                  {DOC_PAGE_COLORS.map((sw) => (
                    <button
                      key={sw.id}
                      type="button"
                      className={`pd-tb-swatch ${selectedPageBg.toLowerCase() === sw.hex ? "is-selected" : ""}`}
                      style={{ backgroundColor: sw.hex }}
                      aria-label={`Page ${targetColorPageIdx + 1} ${sw.label}`}
                      title={`${sw.label} (Page ${targetColorPageIdx + 1} only)`}
                      onClick={() => onSetPageColor(targetColorPageIdx, sw.hex)}
                    />
                  ))}
                </div>

                <div className="pd-custom-color-row">
                  <label className="pd-custom-color-label">
                    <span>Custom</span>
                    <input
                      type="color"
                      aria-label={`Custom color for Page ${targetColorPageIdx + 1}`}
                      value={selectedPageBg}
                      onChange={(e) => onSetPageColor(targetColorPageIdx, e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="pd-tb-swatch-reset"
                    onClick={() => onSetPageColor(targetColorPageIdx, "#ffffff")}
                  >
                    Reset page {targetColorPageIdx + 1}
                  </button>
                </div>
              </div>

              {/* Show / Hide Ruler Toggle */}
              <div className="pd-ps-ruler-row">
                <label className="pd-print-check-row">
                  <Checkbox
                    checked={pageSetup.showRuler}
                    onCheckedChange={(v) => onUpdatePageSetup({ showRuler: Boolean(v) })}
                    aria-label="Show ruler"
                  />
                  <span>Show horizontal &amp; vertical rulers</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Direct Ruler Quick Toggle Button */}
        <button
          type="button"
          className={`pd-tb-btn ${pageSetup.showRuler ? "is-on" : ""}`}
          onClick={() => onUpdatePageSetup({ showRuler: !pageSetup.showRuler })}
          aria-label={pageSetup.showRuler ? "Hide ruler" : "Show ruler"}
          aria-pressed={pageSetup.showRuler}
          title={pageSetup.showRuler ? "Hide ruler" : "Show ruler"}
        >
          <Ruler size={15} />
        </button>

        {/* Contextual Table Formatting Menu */}
        {isTableActive && (
          <div className="pd-tb-dropdown-wrap">
            <button
              type="button"
              className={`pd-tb-select-btn pd-tb-table-ctx-btn ${openMenu === "tableFormat" ? "is-open" : ""}`}
              onClick={() => setOpenMenu(openMenu === "tableFormat" ? null : "tableFormat")}
              aria-label="Table formatting"
              aria-haspopup="menu"
              aria-expanded={openMenu === "tableFormat"}
              title="Table rows, columns & cell shading"
            >
              <Grid3X3 size={14} />
              <span>Table</span>
              <ChevronDown size={12} />
            </button>

            {openMenu === "tableFormat" && (
              <div
                className="pd-tb-popover pd-tb-table-popover"
                role="menu"
                aria-label="Table options"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "addRowBefore");
                    setOpenMenu(null);
                  }}
                >
                  <span>Insert row above</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "addRowAfter");
                    setOpenMenu(null);
                  }}
                >
                  <span>Insert row below</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "addColBefore");
                    setOpenMenu(null);
                  }}
                >
                  <span>Insert column left</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "addColAfter");
                    setOpenMenu(null);
                  }}
                >
                  <span>Insert column right</span>
                </button>
                <div className="pd-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "toggleHeaderRow");
                    setOpenMenu(null);
                  }}
                >
                  <span>Toggle header row</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "mergeCells");
                    setOpenMenu(null);
                  }}
                >
                  <span>Merge selected cells</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "splitCell");
                    setOpenMenu(null);
                  }}
                >
                  <span>Split merged cell</span>
                </button>

                <div className="pd-menu-divider" />
                <div className="pd-tb-menu-section-label">Cell shading</div>
                <div className="pd-tb-swatch-grid" style={{ padding: "4px 6px" }}>
                  {DOC_PAGE_COLORS.slice(0, 10).map((sw) => (
                    <button
                      key={sw.id}
                      type="button"
                      className="pd-tb-swatch"
                      style={{ backgroundColor: sw.hex }}
                      title={`Cell background: ${sw.label}`}
                      aria-label={`Cell background ${sw.label}`}
                      onClick={() => {
                        setDocTableCellAttr(
                          editor,
                          "backgroundColor",
                          sw.hex === "#ffffff" ? null : sw.hex,
                        );
                        setOpenMenu(null);
                      }}
                    />
                  ))}
                </div>

                <div className="pd-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "deleteRow");
                    setOpenMenu(null);
                  }}
                >
                  <span>Delete row</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => {
                    runDocTableCommand(editor, "deleteCol");
                    setOpenMenu(null);
                  }}
                >
                  <span>Delete column</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row is-danger"
                  onClick={() => {
                    runDocTableCommand(editor, "deleteTable");
                    setOpenMenu(null);
                  }}
                >
                  <Trash2 size={13} />
                  <span>Delete table</span>
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="pd-tb-btn"
          onClick={clearFormatting}
          aria-label="Clear formatting"
          title="Clear formatting"
        >
          <RemoveFormatting size={15} />
        </button>
      </div>
    </div>
  );
}
