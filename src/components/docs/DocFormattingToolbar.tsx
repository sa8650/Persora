// Persora Docs — Google Docs-inspired rich-text formatting toolbar.
// Includes: Undo/Redo, Block style (Normal text, Title, Subtitle, Heading 1–3),
// Font size (- / dropdown / +), Bold, Italic, Underline, Strikethrough,
// Text color, Highlight color, Alignment (Left, Center, Right, Justify),
// Bulleted & Numbered lists, Insert/Edit Hyperlink, and Clear formatting.
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  ExternalLink,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import {
  DOC_FONT_SIZES,
  DOC_HIGHLIGHT_COLORS,
  DOC_TEXT_COLORS,
  normalizeFontSize,
  sanitizeDocHref,
  type DocFontSize,
} from "../../../cloudflare/docs-rules.js";

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
}: {
  editor: Editor | null;
  linkTriggerNonce?: number;
}) {
  const [openMenu, setOpenMenu] = useState<
    null | "style" | "fontSize" | "color" | "highlight" | "link"
  >(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [, setSelectionTick] = useState(0);

  const barRef = useRef<HTMLDivElement | null>(null);
  const lastLinkNonce = useRef(0);

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
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
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
  const activeColor = String(editor.getAttributes("textStyle")?.color || "#1f2937");
  const activeHighlight = String(editor.getAttributes("highlight")?.color || "");
  const isLinkActive = editor.isActive("link");

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
      .updateAttributes("paragraph", { variant: "normal" })
      .setTextAlign("left")
      .run();
  };

  return (
    <div
      ref={barRef}
      className="pd-toolbar"
      role="toolbar"
      aria-label="Document formatting"
    >
      {/* Undo / Redo */}
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
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* Paragraph / Heading Style */}
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
          <ChevronDown size={13} />
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

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* Font Size */}
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

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* Inline Marks + Colors */}
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
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive("strike") ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
          aria-pressed={editor.isActive("strike")}
          title="Strikethrough (Ctrl+Shift+X)"
        >
          <Strikethrough size={15} />
        </button>

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
              <button
                type="button"
                className="pd-tb-swatch-reset"
                onClick={() => {
                  editor.chain().focus().unsetColor().run();
                  setOpenMenu(null);
                }}
              >
                Reset to default
              </button>
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
          )}
        </div>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* Alignment */}
      <div className="pd-tb-group">
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive({ textAlign: "left" }) || (!editor.isActive({ textAlign: "center" }) && !editor.isActive({ textAlign: "right" }) && !editor.isActive({ textAlign: "justify" })) ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          aria-label="Align left"
          title="Align left"
        >
          <AlignLeft size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive({ textAlign: "center" }) ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          aria-label="Align center"
          title="Align center"
        >
          <AlignCenter size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive({ textAlign: "right" }) ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          aria-label="Align right"
          title="Align right"
        >
          <AlignRight size={15} />
        </button>
        <button
          type="button"
          className={`pd-tb-btn ${editor.isActive({ textAlign: "justify" }) ? "is-on" : ""}`}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          aria-label="Justify"
          title="Justify"
        >
          <AlignJustify size={15} />
        </button>
      </div>

      <span className="pd-tb-sep" aria-hidden="true" />

      {/* Lists + Link + Clear formatting */}
      <div className="pd-tb-group">
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

        {/* Insert / Edit Hyperlink */}
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
