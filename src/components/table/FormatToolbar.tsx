// Persora Table — compact formatting ribbon for the selected cell range(s).
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Baseline, Bold, Combine, Eraser,
  FoldVertical, Grid2x2, Italic, Minus, PaintBucket, Scissors, SplitSquareHorizontal, Square, SquareDashed, Strikethrough,
  TableCellsMerge, TableCellsSplit, Type, Underline, WrapText,
} from "lucide-react";
import {
  BORDER_COLORS, BORDER_LINE_STYLES, DEFAULT_BORDER_COLOR, DEFAULT_FONT_SIZE, FILL_COLORS, FONT_FAMILIES, FONT_SIZES,
  TABLE_CURRENCIES, TEXT_COLORS, type BorderLineStyle, type BorderMode, type CellStyle, type FontFamilyId, type NumberFormat,
} from "../../../cloudflare/table-rules.js";
import { Menu, type MenuItem } from "./table-ui";

export type StylePatch = Partial<Record<keyof CellStyle, unknown>>;
type MenuEntry = MenuItem | "divider";

const FORMAT_LABELS: Record<NumberFormat, string> = {
  general: "General",
  number: "Number",
  currency: "Currency",
  percent: "Percent",
  date: "Date",
  text: "Plain text",
};

const BORDER_LINE_LABELS: Record<BorderLineStyle, string> = {
  thin: "Thin line",
  medium: "Medium line",
  thick: "Thick line",
  dashed: "Dashed line",
  dotted: "Dotted line",
  double: "Double line",
};

const Swatch = ({ hex, empty = false }: { hex?: string; empty?: boolean }) => (
  <span className={`tb-swatch ${empty ? "is-empty" : ""}`} style={hex ? { background: hex } : undefined} />
);

const BorderLinePreview = ({ lineStyle }: { lineStyle: BorderLineStyle }) => (
  <span className={`tb-border-line-preview is-${lineStyle}`} aria-hidden="true" />
);

export default function FormatToolbar({
  style,
  disabled,
  canMerge,
  hasMerged,
  canMergeHoriz,
  canMergeVert,
  borderStyle,
  borderColor,
  onBorderPenChange,
  onStyle,
  onBorder,
  onMerge,
  onUnmerge,
  onClearFormat,
}: {
  style: CellStyle | undefined;
  disabled: boolean;
  canMerge: boolean;
  hasMerged: boolean;
  canMergeHoriz: boolean;
  canMergeVert: boolean;
  borderStyle: BorderLineStyle;
  borderColor: string;
  onBorderPenChange: (next: { style?: BorderLineStyle; color?: string }) => void;
  onStyle: (patch: StylePatch, label: string) => void;
  onBorder: (mode: BorderMode, opts?: { style?: BorderLineStyle; color?: string }) => void;
  onMerge: (mode: "all" | "horizontal" | "vertical") => void;
  onUnmerge: () => void;
  onClearFormat: () => void;
}) {
  const s = style || {};
  const nf = s.nf || "general";
  const ff: FontFamilyId = s.ff || "sans";
  const AlignIcon = s.a === "c" ? AlignCenter : s.a === "r" ? AlignRight : AlignLeft;
  const VertIcon = s.va === "t" ? ArrowUpToLine : s.va === "b" ? ArrowDownToLine : FoldVertical;
  const WrapIcon = s.w === "wrap" ? WrapText : s.w === "clip" ? Scissors : AlignJustify;
  const decimals = s.dp ?? (nf === "currency" || nf === "number" ? 2 : nf === "percent" ? 0 : null);

  const borderItems: MenuEntry[] = [
    { id: "all", label: "All borders", icon: <Grid2x2 size={14} />, onSelect: () => onBorder("all") },
    { id: "inner", label: "Inner borders", icon: <SplitSquareHorizontal size={14} />, onSelect: () => onBorder("inner") },
    { id: "horiz", label: "Horizontal borders", icon: <Minus size={14} />, onSelect: () => onBorder("horiz") },
    { id: "vert", label: "Vertical borders", icon: <Type size={14} />, onSelect: () => onBorder("vert") },
    { id: "outer", label: "Outside borders", icon: <Square size={14} />, onSelect: () => onBorder("outer") },
    { id: "top", label: "Top border", icon: <span className="tb-border-edge-icon is-top" />, onSelect: () => onBorder("top") },
    { id: "bottom", label: "Bottom border", icon: <span className="tb-border-edge-icon is-bottom" />, onSelect: () => onBorder("bottom") },
    { id: "left", label: "Left border", icon: <span className="tb-border-edge-icon is-left" />, onSelect: () => onBorder("left") },
    { id: "right", label: "Right border", icon: <span className="tb-border-edge-icon is-right" />, onSelect: () => onBorder("right") },
    "divider",
    { id: "none", label: "Clear borders", icon: <SquareDashed size={14} />, onSelect: () => onBorder("none") },
  ];

  const borderStyleItems: MenuEntry[] = [
    ...BORDER_LINE_STYLES.map((ls) => ({
      id: `ls-${ls}`,
      label: BORDER_LINE_LABELS[ls],
      icon: <BorderLinePreview lineStyle={ls} />,
      checked: borderStyle === ls,
      onSelect: () => onBorderPenChange({ style: ls }),
    })),
    "divider",
    ...BORDER_COLORS.map((color) => ({
      id: `bc-${color.id}`,
      label: `Border: ${color.label}`,
      icon: <Swatch hex={color.hex} />,
      checked: borderColor.toUpperCase() === color.hex.toUpperCase(),
      onSelect: () => onBorderPenChange({ color: color.hex }),
    })),
  ];

  return (
    <div className="tb-toolbar-group" role="group" aria-label="Formatting">
      <label className="tb-mini-select tb-font-family-select" title="Font family">
        <span className="tb-visually-hidden">Font family</span>
        <select
          aria-label="Font family"
          value={ff}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as FontFamilyId;
            onStyle({ ff: next === "sans" ? null : next }, "Font family");
          }}
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      <label className="tb-mini-select" title="Font size">
        <span className="tb-visually-hidden">Font size</span>
        <select
          aria-label="Font size"
          value={s.fs || DEFAULT_FONT_SIZE}
          disabled={disabled}
          onChange={(event) => {
            const size = Number(event.target.value);
            onStyle({ fs: size === DEFAULT_FONT_SIZE ? null : size }, "Font size");
          }}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <span className="tb-toolbar-sep" aria-hidden="true" />

      <button
        type="button"
        className={`tb-icon-button ${s.b ? "is-on" : ""}`}
        aria-pressed={Boolean(s.b)}
        disabled={disabled}
        title="Bold (Ctrl+B)"
        aria-label="Bold"
        onClick={() => onStyle({ b: s.b ? null : 1 }, s.b ? "Remove bold" : "Bold")}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        className={`tb-icon-button ${s.i ? "is-on" : ""}`}
        aria-pressed={Boolean(s.i)}
        disabled={disabled}
        title="Italic (Ctrl+I)"
        aria-label="Italic"
        onClick={() => onStyle({ i: s.i ? null : 1 }, s.i ? "Remove italic" : "Italic")}
      >
        <Italic size={15} />
      </button>
      <button
        type="button"
        className={`tb-icon-button ${s.u ? "is-on" : ""}`}
        aria-pressed={Boolean(s.u)}
        disabled={disabled}
        title="Underline (Ctrl+U)"
        aria-label="Underline"
        onClick={() => onStyle({ u: s.u ? null : 1 }, s.u ? "Remove underline" : "Underline")}
      >
        <Underline size={15} />
      </button>
      <button
        type="button"
        className={`tb-icon-button ${s.st ? "is-on" : ""}`}
        aria-pressed={Boolean(s.st)}
        disabled={disabled}
        title="Strikethrough (Alt+Shift+5)"
        aria-label="Strikethrough"
        onClick={() => onStyle({ st: s.st ? null : 1 }, s.st ? "Remove strikethrough" : "Strikethrough")}
      >
        <Strikethrough size={15} />
      </button>

      <Menu
        label="Text color"
        icon={
          <span className="tb-color-icon">
            <Baseline size={15} />
            <i style={{ background: s.c || "currentColor" }} />
          </span>
        }
        items={[
          { id: "default", label: "Default", icon: <Swatch empty />, checked: !s.c, onSelect: () => onStyle({ c: null }, "Default text color") },
          ...TEXT_COLORS.filter((color) => color.id !== "ink").map((color) => ({
            id: color.id,
            label: color.label,
            icon: <Swatch hex={color.hex} />,
            checked: s.c === color.hex,
            onSelect: () => onStyle({ c: color.hex }, "Text color"),
          })),
        ]}
      />

      <Menu
        label="Fill color"
        icon={
          <span className="tb-color-icon">
            <PaintBucket size={15} />
            <i style={{ background: s.bg || "transparent" }} />
          </span>
        }
        items={[
          { id: "none", label: "No fill", icon: <Swatch empty />, checked: !s.bg, onSelect: () => onStyle({ bg: null }, "Remove fill") },
          ...FILL_COLORS.map((color) => ({
            id: color.id,
            label: color.label,
            icon: <Swatch hex={color.hex} />,
            checked: s.bg === color.hex,
            onSelect: () => onStyle({ bg: color.hex }, "Fill color"),
          })),
        ]}
      />

      <span className="tb-toolbar-sep" aria-hidden="true" />

      <Menu
        label="Borders"
        icon={
          <span className="tb-color-icon">
            <Grid2x2 size={15} />
            <i style={{ background: borderColor || DEFAULT_BORDER_COLOR }} />
          </span>
        }
        items={borderItems}
      />
      <Menu
        label="Border style and color"
        icon={<BorderLinePreview lineStyle={borderStyle} />}
        items={borderStyleItems}
      />

      <div className="tb-merge-control" role="group" aria-label="Merge cells">
        <button
          type="button"
          className={`tb-icon-button ${hasMerged ? "is-on" : ""}`}
          aria-pressed={hasMerged}
          disabled={disabled || (!canMerge && !hasMerged)}
          title={hasMerged ? "Unmerge cells" : "Merge cells"}
          aria-label={hasMerged ? "Unmerge cells" : "Merge cells"}
          onClick={() => (hasMerged ? onUnmerge() : onMerge("all"))}
        >
          {hasMerged ? <TableCellsSplit size={15} /> : <TableCellsMerge size={15} />}
        </button>
        <Menu
          label="Merge options"
          icon={<Combine size={13} />}
          buttonClassName="tb-icon-button tb-merge-caret"
          items={[
            { id: "merge-all", label: "Merge all", icon: <TableCellsMerge size={14} />, disabled: disabled || !canMerge, onSelect: () => onMerge("all") },
            { id: "merge-horiz", label: "Merge horizontally", disabled: disabled || !canMergeHoriz, onSelect: () => onMerge("horizontal") },
            { id: "merge-vert", label: "Merge vertically", disabled: disabled || !canMergeVert, onSelect: () => onMerge("vertical") },
            "divider",
            { id: "unmerge", label: "Unmerge", icon: <TableCellsSplit size={14} />, disabled: disabled || !hasMerged, onSelect: () => onUnmerge() },
          ]}
        />
      </div>

      <span className="tb-toolbar-sep" aria-hidden="true" />

      <Menu
        label="Horizontal alignment"
        icon={<AlignIcon size={15} />}
        items={[
          { id: "l", label: "Align left", icon: <AlignLeft size={14} />, checked: s.a === "l", onSelect: () => onStyle({ a: "l" }, "Align left") },
          { id: "c", label: "Align center", icon: <AlignCenter size={14} />, checked: s.a === "c", onSelect: () => onStyle({ a: "c" }, "Align center") },
          { id: "r", label: "Align right", icon: <AlignRight size={14} />, checked: s.a === "r", onSelect: () => onStyle({ a: "r" }, "Align right") },
          "divider",
          { id: "auto", label: "Automatic", hint: "Numbers right, text left", checked: !s.a, onSelect: () => onStyle({ a: null }, "Automatic alignment") },
        ]}
      />

      <Menu
        label="Vertical alignment"
        icon={<VertIcon size={15} />}
        items={[
          { id: "t", label: "Top", icon: <ArrowUpToLine size={14} />, checked: s.va === "t", onSelect: () => onStyle({ va: "t" }, "Align top") },
          { id: "m", label: "Middle", icon: <FoldVertical size={14} />, checked: !s.va, onSelect: () => onStyle({ va: null }, "Align middle") },
          { id: "b", label: "Bottom", icon: <ArrowDownToLine size={14} />, checked: s.va === "b", onSelect: () => onStyle({ va: "b" }, "Align bottom") },
        ]}
      />

      <Menu
        label="Text wrapping"
        icon={<WrapIcon size={15} />}
        items={[
          { id: "overflow", label: "Overflow / Fit", checked: !s.w, onSelect: () => onStyle({ w: null }, "Default text flow") },
          { id: "wrap", label: "Wrap text", icon: <WrapText size={14} />, checked: s.w === "wrap", onSelect: () => onStyle({ w: "wrap" }, "Wrap text") },
          { id: "clip", label: "Clip text", icon: <Scissors size={14} />, checked: s.w === "clip", onSelect: () => onStyle({ w: "clip" }, "Clip text") },
        ]}
      />

      <span className="tb-toolbar-sep" aria-hidden="true" />

      <label className="tb-mini-select tb-format-select" title="Number format">
        <span className="tb-visually-hidden">Number format</span>
        <select
          aria-label="Number format"
          value={nf}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as NumberFormat;
            onStyle(
              next === "general"
                ? { nf: null, dp: null, cur: null }
                : next === "currency"
                  ? { nf: next, cur: s.cur || "BDT" }
                  : { nf: next, cur: null },
              `${FORMAT_LABELS[next]} format`,
            );
          }}
        >
          {(Object.keys(FORMAT_LABELS) as NumberFormat[]).map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
      </label>

      {nf === "currency" && (
        <label className="tb-mini-select" title="Currency">
          <span className="tb-visually-hidden">Currency</span>
          <select
            aria-label="Currency"
            value={s.cur || "BDT"}
            disabled={disabled}
            onChange={(event) => onStyle({ cur: event.target.value }, "Currency")}
          >
            {TABLE_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className="tb-icon-button tb-text-button"
        disabled={disabled || decimals === null || decimals <= 0}
        title="Fewer decimal places"
        aria-label="Fewer decimal places"
        onClick={() =>
          onStyle(
            { dp: Math.max(0, (decimals ?? 0) - 1), ...(nf === "general" ? { nf: "number" } : {}) },
            "Fewer decimals",
          )
        }
      >
        .0←
      </button>
      <button
        type="button"
        className="tb-icon-button tb-text-button"
        disabled={disabled || (decimals !== null && decimals >= 6)}
        title="More decimal places"
        aria-label="More decimal places"
        onClick={() =>
          onStyle(
            { dp: Math.min(6, (decimals ?? 0) + 1), ...(nf === "general" ? { nf: "number" } : {}) },
            "More decimals",
          )
        }
      >
        .00→
      </button>
      <button
        type="button"
        className="tb-icon-button"
        disabled={disabled}
        title="Clear formatting"
        aria-label="Clear formatting"
        onClick={onClearFormat}
      >
        <Eraser size={15} />
      </button>
    </div>
  );
}
