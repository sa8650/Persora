// Persora Table — compact formatting toolbar for the current cell range.
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Eraser, Grid2x2, Italic, PaintBucket, Square, SquareDashed } from "lucide-react";
import { DEFAULT_FONT_SIZE, FILL_COLORS, FONT_SIZES, TABLE_CURRENCIES, TEXT_COLORS, type CellStyle, type NumberFormat } from "../../../cloudflare/table-rules.js";
import { Menu } from "./table-ui";

export type StylePatch = Partial<Record<keyof CellStyle, unknown>>;

const FORMAT_LABELS: Record<NumberFormat, string> = { general: "General", number: "Number", currency: "Currency", percent: "Percent", date: "Date", text: "Plain text" };

const Swatch = ({ hex, empty = false }: { hex?: string; empty?: boolean }) => <span className={`tb-swatch ${empty ? "is-empty" : ""}`} style={hex ? { background: hex } : undefined}/>;

export default function FormatToolbar({ style, disabled, onStyle, onBorder, onClearFormat }: {
  style: CellStyle | undefined;
  disabled: boolean;
  onStyle: (patch: StylePatch, label: string) => void;
  onBorder: (mode: "all" | "outer" | "bottom" | "none") => void;
  onClearFormat: () => void;
}) {
  const s = style || {};
  const nf = s.nf || "general";
  const AlignIcon = s.a === "c" ? AlignCenter : s.a === "r" ? AlignRight : AlignLeft;
  const decimals = s.dp ?? (nf === "currency" || nf === "number" ? 2 : nf === "percent" ? 0 : null);
  return <div className="tb-toolbar-group" role="group" aria-label="Formatting">
    <button type="button" className={`tb-icon-button ${s.b ? "is-on" : ""}`} aria-pressed={Boolean(s.b)} disabled={disabled} title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => onStyle({ b: s.b ? null : 1 }, s.b ? "Remove bold" : "Bold")}><Bold size={15}/></button>
    <button type="button" className={`tb-icon-button ${s.i ? "is-on" : ""}`} aria-pressed={Boolean(s.i)} disabled={disabled} title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => onStyle({ i: s.i ? null : 1 }, s.i ? "Remove italic" : "Italic")}><Italic size={15}/></button>
    <Menu label="Alignment" icon={<AlignIcon size={15}/>} items={[
      { id: "l", label: "Align left", icon: <AlignLeft size={14}/>, checked: s.a === "l", onSelect: () => onStyle({ a: "l" }, "Align left") },
      { id: "c", label: "Align center", icon: <AlignCenter size={14}/>, checked: s.a === "c", onSelect: () => onStyle({ a: "c" }, "Align center") },
      { id: "r", label: "Align right", icon: <AlignRight size={14}/>, checked: s.a === "r", onSelect: () => onStyle({ a: "r" }, "Align right") },
      "divider",
      { id: "auto", label: "Automatic", hint: "Numbers right, text left", checked: !s.a, onSelect: () => onStyle({ a: null }, "Automatic alignment") },
    ]}/>
    <Menu label="Text color" icon={<span className="tb-color-icon"><Baseline size={15}/><i style={{ background: s.c || "currentColor" }}/></span>} items={[
      { id: "default", label: "Default", icon: <Swatch empty/>, checked: !s.c, onSelect: () => onStyle({ c: null }, "Default text color") },
      ...TEXT_COLORS.filter((color) => color.id !== "ink").map((color) => ({ id: color.id, label: color.label, icon: <Swatch hex={color.hex}/>, checked: s.c === color.hex, onSelect: () => onStyle({ c: color.hex }, "Text color") })),
    ]}/>
    <Menu label="Fill color" icon={<span className="tb-color-icon"><PaintBucket size={15}/><i style={{ background: s.bg || "transparent" }}/></span>} items={[
      { id: "none", label: "No fill", icon: <Swatch empty/>, checked: !s.bg, onSelect: () => onStyle({ bg: null }, "Remove fill") },
      ...FILL_COLORS.map((color) => ({ id: color.id, label: color.label, icon: <Swatch hex={color.hex}/>, checked: s.bg === color.hex, onSelect: () => onStyle({ bg: color.hex }, "Fill color") })),
    ]}/>
    <Menu label="Borders" icon={<Grid2x2 size={15}/>} items={[
      { id: "all", label: "All borders", icon: <Grid2x2 size={14}/>, onSelect: () => onBorder("all") },
      { id: "outer", label: "Outside border", icon: <Square size={14}/>, onSelect: () => onBorder("outer") },
      { id: "bottom", label: "Bottom border", icon: <span className="tb-border-bottom-icon"/>, onSelect: () => onBorder("bottom") },
      "divider",
      { id: "none", label: "No borders", icon: <SquareDashed size={14}/>, onSelect: () => onBorder("none") },
    ]}/>
    <label className="tb-mini-select" title="Font size"><span className="tb-visually-hidden">Font size</span>
      <select value={s.fs || DEFAULT_FONT_SIZE} disabled={disabled} onChange={(event) => { const size = Number(event.target.value); onStyle({ fs: size === DEFAULT_FONT_SIZE ? null : size }, "Font size"); }}>
        {FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    <span className="tb-toolbar-sep" aria-hidden="true"/>
    <label className="tb-mini-select tb-format-select" title="Number format"><span className="tb-visually-hidden">Number format</span>
      <select value={nf} disabled={disabled} onChange={(event) => {
        const next = event.target.value as NumberFormat;
        onStyle(next === "general" ? { nf: null, dp: null, cur: null } : next === "currency" ? { nf: next, cur: s.cur || "BDT" } : { nf: next, cur: null }, `${FORMAT_LABELS[next]} format`);
      }}>
        {(Object.keys(FORMAT_LABELS) as NumberFormat[]).map((format) => <option key={format} value={format}>{FORMAT_LABELS[format]}</option>)}
      </select>
    </label>
    {nf === "currency" && <label className="tb-mini-select" title="Currency"><span className="tb-visually-hidden">Currency</span>
      <select value={s.cur || "BDT"} disabled={disabled} onChange={(event) => onStyle({ cur: event.target.value }, "Currency")}>
        {TABLE_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>}
    <button type="button" className="tb-icon-button tb-text-button" disabled={disabled || decimals === null || decimals <= 0} title="Fewer decimal places" aria-label="Fewer decimal places" onClick={() => onStyle({ dp: Math.max(0, (decimals ?? 0) - 1), ...(nf === "general" ? { nf: "number" } : {}) }, "Fewer decimals")}>.0←</button>
    <button type="button" className="tb-icon-button tb-text-button" disabled={disabled || (decimals !== null && decimals >= 6)} title="More decimal places" aria-label="More decimal places" onClick={() => onStyle({ dp: Math.min(6, (decimals ?? 0) + 1), ...(nf === "general" ? { nf: "number" } : {}) }, "More decimals")}>.00→</button>
    <button type="button" className="tb-icon-button" disabled={disabled} title="Clear formatting" aria-label="Clear formatting" onClick={onClearFormat}><Eraser size={15}/></button>
  </div>;
}
