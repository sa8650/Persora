import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState } from "react";
import { RevoGrid } from "@revolist/react-datagrid";

const log = (...a: unknown[]) => { (window as any).__log = (window as any).__log || []; (window as any).__log.push(JSON.stringify(a)); };
function App() {
  const ref = useRef<any>(null);
  const [raw, setRaw] = useState<Record<string, string>>({ "0:0": "Item", "0:1": "Cost", "1:0": "Rent", "1:1": "1200", "2:1": "=B2*2" });
  const rows = useMemo(() => Array.from({ length: 199 }, (_, r) => { const o: any = {}; for (let c = 0; c < 10; c++) o["c" + c] = raw[`${r + 1}:${c}`] ?? ""; return o; }), [raw]);
  const pinned = useMemo(() => [{ ...Object.fromEntries(Array.from({ length: 10 }, (_, c) => ["c" + c, raw[`0:${c}`] ?? ""])) }], [raw]);
  const columns = useMemo(() => Array.from({ length: 10 }, (_, c) => ({
    prop: "c" + c, name: String.fromCharCode(65 + c), size: 100,
    cellTemplate: (h: any, p: any) => h("span", { class: "disp" }, String(p.model[p.prop] ?? "").startsWith("=") ? "FX:" + p.model[p.prop] : p.model[p.prop]),
    cellProperties: (p: any) => ({ style: p.rowIndex === 0 && c === 0 ? { fontWeight: "700", background: "#fef3c7" } : {} }),
  })), []);
  return <div style={{ height: 500, width: 900 }}>
    <RevoGrid ref={ref} source={rows} pinnedTopSource={pinned} columns={columns} rowHeaders range resize theme="compact"
      onBeforeedit={(e: any) => { e.preventDefault(); log("beforeedit", e.detail.rgRow, e.detail.prop, e.detail.val, e.detail.type); const r = e.detail.rgRow + (e.detail.type === "rowPinStart" ? 0 : 1); setRaw((x) => ({ ...x, [`${r}:${Number(String(e.detail.prop).slice(1))}`]: e.detail.val })); }}
      onBeforerangeedit={(e: any) => { e.preventDefault(); log("beforerangeedit", Object.keys(e.detail.data)); }}
      onBeforeautofill={(e: any) => { e.preventDefault(); log("beforeautofill", e.detail); }}
      onSetrange={(e: any) => log("setrange", e.detail)}
      onBeforesetrange={(e: any) => log("beforesetrange", e.detail)}
      onAfterfocus={(e: any) => log("afterfocus", e.detail.rowIndex, e.detail.colIndex, e.detail.rowType)}
      onAftercolumnresize={(e: any) => log("resize", Object.entries(e.detail).map(([k, v]: any) => [k, v.size]))}
      onBeforecopyregion={(e: any) => { log("copyregion"); }}
      onBeforepasteregion={(e: any) => { e.preventDefault(); log("pasteregion"); }}
      onClearregion={(e: any) => { e.preventDefault(); log("clearregion", e.detail); }}
      onBeforeeditstart={(e: any) => log("editstart", e.detail.val)}
    />
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
