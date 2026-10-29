import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  GripVertical,
  Layers,
  Plus,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ADVANCED_CATEGORIES,
  ADVANCED_CHOICE_TYPES,
  ADVANCED_FIELD_LIBRARY,
  ADVANCED_FONT_STACKS,
  ADVANCED_LIMITS,
  ADVANCED_LOGIC_OPERATORS,
  advancedId,
  createAdvancedField,
  isAnswerField,
  type AdvancedField,
  type AdvancedFieldType,
  type AdvancedForm,
  type AdvancedLogicRule,
} from "../../../../cloudflare/advanced-forms-rules.js";
import AdvancedFormRenderer from "./AdvancedFormRenderer";

type BuilderTab = "design" | "configure" | "responses";

const WIDTHS: { id: AdvancedField["width"]; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "half", label: "½" },
  { id: "third", label: "⅓" },
];

export interface AdvancedFormBuilderProps {
  form: AdvancedForm;
  tab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  onChange: (updater: (form: AdvancedForm) => AdvancedForm) => void;
  onBack: () => void;
  onPreview: () => void;
  onPublishToggle: () => void;
  responsesPanel: ReactNode;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="affb-field">
      <span className="affb-field-label">{label}{hint ? <small>{hint}</small> : null}</span>
      {children}
    </label>
  );
}

function Accordion({ title, icon, defaultOpen = false, children }: { title: string; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`affb-accordion${open ? " is-open" : ""}`}>
      <button type="button" className="affb-accordion-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="affb-accordion-title">{icon}{title}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? <div className="affb-accordion-body">{children}</div> : null}
    </section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="affb-color-row">
      <span>{label}</span>
      <span className="affb-color-control">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} />
        <code>{value}</code>
      </span>
    </label>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="affb-range-row">
      <span className="affb-range-label">{label}<output>{value}{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function AdvancedFormBuilder({
  form,
  tab,
  onTabChange,
  onChange,
  onBack,
  onPreview,
  onPublishToggle,
  responsesPanel,
}: AdvancedFormBuilderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspector, setInspector] = useState<"theme" | "type" | "layout" | "elements" | null>("theme");
  const historyRef = useRef<AdvancedForm[]>([]);
  const futureRef = useRef<AdvancedForm[]>([]);
  const [, forceRender] = useState(0);

  const selectedField = useMemo(() => form.fields.find((field) => field.id === selectedId) ?? null, [form.fields, selectedId]);

  useEffect(() => {
    // Selecting a field opens its settings panel straight away.
    if (selectedField) setInspector("elements");
  }, [selectedField?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // A newly added or duplicated element may sit below the fold: bring it in.
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      canvasScrollRef.current
        ?.querySelector(`[data-block-id="${selectedId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const mutate = useCallback(
    (updater: (current: AdvancedForm) => AdvancedForm) => {
      historyRef.current = [...historyRef.current.slice(-24), form];
      futureRef.current = [];
      onChange(updater);
      forceRender((value) => value + 1);
    },
    [form, onChange],
  );

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current = [...futureRef.current, form];
    onChange(() => previous);
    forceRender((value) => value + 1);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, form];
    onChange(() => next);
    forceRender((value) => value + 1);
  };

  const updateField = (fieldId: string, patch: Partial<AdvancedField>) =>
    mutate((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    }));

  const addField = (type: AdvancedFieldType) => {
    const field = createAdvancedField(type, { required: form.settings.requiredByDefault });
    mutate((current) => ({ ...current, fields: [...current.fields, field] }));
    setSelectedId(field.id);
  };

  const duplicateField = (fieldId: string) => {
    const index = form.fields.findIndex((field) => field.id === fieldId);
    if (index < 0) return;
    const clone: AdvancedField = { ...form.fields[index], id: advancedId("fld"), options: form.fields[index].options.map((option) => ({ ...option, id: advancedId("opt") })) };
    mutate((current) => {
      const next = [...current.fields];
      next.splice(index + 1, 0, clone);
      return { ...current, fields: next };
    });
    setSelectedId(clone.id);
  };

  const removeField = (fieldId: string) => {
    mutate((current) => ({ ...current, fields: current.fields.filter((field) => field.id !== fieldId) }));
    if (selectedId === fieldId) setSelectedId(null);
  };

  const moveField = (fieldId: string, delta: number) => {
    mutate((current) => {
      const index = current.fields.findIndex((field) => field.id === fieldId);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= current.fields.length) return current;
      const fields = [...current.fields];
      const [removed] = fields.splice(index, 1);
      fields.splice(next, 0, removed);
      return { ...current, fields };
    });
  };

  const reorder = (fromId: string, toIndex: number) => {
    mutate((current) => {
      const fromIndex = current.fields.findIndex((field) => field.id === fromId);
      if (fromIndex < 0) return current;
      const fields = [...current.fields];
      const [removed] = fields.splice(fromIndex, 1);
      const target = toIndex > fromIndex ? toIndex - 1 : toIndex;
      fields.splice(Math.max(0, Math.min(fields.length, target)), 0, removed);
      return { ...current, fields };
    });
  };

  const setDesign = <K extends keyof AdvancedForm["design"]>(branch: K, patch: Partial<AdvancedForm["design"][K]>) =>
    mutate((current) => ({ ...current, design: { ...current.design, [branch]: { ...current.design[branch], ...patch } } }));

  const setSettings = (patch: Partial<AdvancedForm["settings"]>) =>
    mutate((current) => ({ ...current, settings: { ...current.settings, ...patch } }));

  const answerFields = form.fields.filter(isAnswerField);
  const logic: AdvancedLogicRule[] = form.settings.logic;

  const addLogic = () => {
    if (answerFields.length < 2) return;
    mutate((current) => ({
      ...current,
      settings: {
        ...current.settings,
        logic: [
          ...current.settings.logic,
          {
            id: advancedId("rule"),
            fieldId: answerFields[0].id,
            operator: "is",
            value: "",
            targetFieldId: answerFields[1].id,
            action: "show",
          },
        ],
      },
    }));
  };

  const updateLogic = (ruleId: string, patch: Partial<AdvancedLogicRule>) =>
    setSettings({ logic: logic.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) });

  return (
    <div className="affb-root">
      <header className="affb-topbar">
        <div className="affb-topbar-left">
          <button type="button" className="aff-back" onClick={onBack} aria-label="Back to advanced forms dashboard" title="Back to advanced forms dashboard">
            <ArrowLeft size={17} />
          </button>
          <input
            className="affb-title-input"
            value={form.title}
            maxLength={ADVANCED_LIMITS.titleLength}
            aria-label="Form title"
            onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))}
          />
          <Badge variant={form.status === "published" ? "success-light" : "outline"} size="xs">
            {form.status === "published" ? "Published" : "Draft"}
          </Badge>
        </div>

        <nav className="affb-tabs" aria-label="Advanced form sections">
          {(["design", "configure", "responses"] as BuilderTab[]).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`affb-tab${tab === entry ? " is-active" : ""}`}
              aria-current={tab === entry ? "page" : undefined}
              onClick={() => onTabChange(entry)}
            >
              {entry === "design" ? "Design" : entry === "configure" ? "Configure" : `Responses (${form.responses.length})`}
            </button>
          ))}
        </nav>

        <div className="affb-topbar-right">
          <button type="button" className="affb-icon" onClick={undo} aria-label="Undo" title="Undo"><Undo2 size={15} /></button>
          <button type="button" className="affb-icon" onClick={redo} aria-label="Redo" title="Redo"><Redo2 size={15} /></button>
          <Button type="button" variant="outline" size="sm" onClick={onPreview}><Eye size={14} /> Preview</Button>
          <Button type="button" size="sm" onClick={onPublishToggle}>
            {form.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </header>

      {tab === "design" ? (
        <div className={`affb-workspace${libraryOpen ? "" : " is-rail-collapsed"}`}>
          {/* --- Element library ---------------------------------------- */}
          <aside className={`affb-rail${libraryOpen ? "" : " is-collapsed"}`} aria-label="Element library">
            <button type="button" className="affb-rail-toggle" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}>
              <Plus size={15} /><span>Add element</span>
            </button>
            {libraryOpen ? (
              <div className="affb-rail-scroll">
                {["Text", "Contact", "Choice", "Media", "Content"].map((group) => (
                  <div key={group} className="affb-rail-group">
                    <span className="affb-rail-group-label">{group}</span>
                    {ADVANCED_FIELD_LIBRARY.filter((entry) => entry.group === group).map((entry) => (
                      <button
                        key={entry.type}
                        type="button"
                        className="affb-library-item"
                        onClick={() => addField(entry.type)}
                        title={entry.hint}
                      >
                        <span className="affb-library-label">{entry.label}</span>
                        <Plus size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </aside>

          {/* --- Canvas -------------------------------------------------- */}
          <div className="affb-canvas-shell">
            <div className="affb-canvas-toolbar">
              <span className="affb-canvas-hint"><Layers size={13} /> Drag elements to reorder · resize with ½ / ⅓</span>
              <span className="affb-canvas-count">{form.fields.length} elements</span>
            </div>

            <div className="affb-canvas-scroll" ref={canvasScrollRef}>
              <div
                className="affb-canvas"
                onDragOver={(event) => { event.preventDefault(); if (dropIndex == null) setDropIndex(form.fields.length); }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragId != null && dropIndex != null) reorder(dragId, dropIndex);
                  setDragId(null);
                  setDropIndex(null);
                }}
              >
                <AdvancedFormRenderer
                  form={form}
                  mode="preview"
                  selectedFieldId={selectedId}
                  wrapField={(field, node) => (
                    <div
                      key={field.id}
                      className={`affb-block${selectedId === field.id ? " is-selected" : ""}${dragId === field.id ? " is-dragging" : ""}`}
                      style={{ gridColumn: field.width === "full" || !isAnswerField(field) ? "1 / -1" : "span 1" }}
                      draggable
                      onDragStart={() => setDragId(field.id)}
                      onDragEnd={() => { setDragId(null); setDropIndex(null); }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const after = event.clientY > rect.top + rect.height / 2;
                        const index = form.fields.findIndex((entry) => entry.id === field.id);
                        setDropIndex(index + (after ? 1 : 0));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (dragId && dropIndex != null) reorder(dragId, dropIndex);
                        setDragId(null);
                        setDropIndex(null);
                      }}
                      onClick={() => setSelectedId(field.id)}
                      data-block-id={field.id}
                    >
                      <span className="affb-block-grip" aria-hidden="true"><GripVertical size={13} /></span>
                      {node}
                      <span className="affb-block-tools">
                        <button type="button" aria-label="Move element up" title="Move up" onClick={(event) => { event.stopPropagation(); moveField(field.id, -1); }}><ChevronUp size={13} /></button>
                        <button type="button" aria-label="Move element down" title="Move down" onClick={(event) => { event.stopPropagation(); moveField(field.id, 1); }}><ChevronDown size={13} /></button>
                        <button type="button" aria-label="Duplicate element" title="Duplicate" onClick={(event) => { event.stopPropagation(); duplicateField(field.id); }}><Copy size={13} /></button>
                        <button type="button" aria-label="Delete element" title="Delete" className="is-danger" onClick={(event) => { event.stopPropagation(); removeField(field.id); }}><Trash2 size={13} /></button>
                      </span>
                    </div>
                  )}
                />
                {form.fields.length === 0 ? (
                  <div className="affb-canvas-empty">
                    <IconTileLike />
                    <p>Add your first element from the library on the left, or start from a template.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* --- Inspector ---------------------------------------------- */}
          <aside className="affb-inspector" aria-label="Design settings">
            <div className="affb-inspector-tabs" role="tablist" aria-label="Design panels">
              {([["theme", "Theme"], ["type", "Type"], ["layout", "Layout"], ["elements", "Element"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={inspector === id}
                  className={inspector === id ? "is-active" : ""}
                  onClick={() => setInspector(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="affb-inspector-scroll">
              {inspector === "theme" ? (
                <>
                  <Accordion title="Page background" icon={<Wand2 size={14} />} defaultOpen>
                    <div className="affb-segmented" role="group" aria-label="Background type">
                      {(["gradient", "solid", "image", "none"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={form.design.background.type === type ? "is-active" : ""}
                          aria-pressed={form.design.background.type === type}
                          onClick={() => setDesign("background", { type })}
                        >
                          {type === "gradient" ? "Gradient" : type === "solid" ? "Solid" : type === "image" ? "Image" : "None"}
                        </button>
                      ))}
                    </div>
                    {form.design.background.type === "gradient" ? (
                      <>
                        <ColorRow label="From" value={form.design.background.from} onChange={(from) => setDesign("background", { from })} />
                        <ColorRow label="To" value={form.design.background.to} onChange={(to) => setDesign("background", { to })} />
                        <RangeRow label="Angle" value={form.design.background.angle} min={0} max={360} suffix="°" onChange={(angle) => setDesign("background", { angle })} />
                        <div className="affb-presets">
                          {[
                            ["#eef2ff", "#fdf2f8"],
                            ["#ecfeff", "#ccfbf1"],
                            ["#fff7ed", "#fed7aa"],
                            ["#f5f3ff", "#ede9fe"],
                            ["#f8fafc", "#e2e8f0"],
                            ["#0f172a", "#1e293b"],
                          ].map(([from, to]) => (
                            <button
                              key={`${from}-${to}`}
                              type="button"
                              aria-label={`Gradient ${from} to ${to}`}
                              className="affb-gradient-preset"
                              style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
                              onClick={() => setDesign("background", { type: "gradient", from, to })}
                            />
                          ))}
                        </div>
                      </>
                    ) : null}
                    {form.design.background.type === "solid" ? (
                      <ColorRow label="Colour" value={form.design.background.color} onChange={(color) => setDesign("background", { color })} />
                    ) : null}
                    {form.design.background.type === "image" ? (
                      <>
                        <Field label="Image URL" hint="https://…">
                          <input
                            value={form.design.background.imageUrl}
                            placeholder="Paste an image URL"
                            onChange={(event) => setDesign("background", { imageUrl: event.target.value })}
                          />
                        </Field>
                        <RangeRow label="Overlay" value={Math.round(form.design.background.overlay * 100)} min={0} max={90} suffix="%" onChange={(value) => setDesign("background", { overlay: value / 100 })} />
                      </>
                    ) : null}
                  </Accordion>

                  <Accordion title="Form surface" defaultOpen>
                    <ColorRow label="Surface" value={form.design.surface.color} onChange={(color) => setDesign("surface", { color })} />
                    <RangeRow label="Corner radius" value={form.design.surface.radius} min={0} max={40} onChange={(radius) => setDesign("surface", { radius })} />
                    <Field label="Shadow">
                      <select value={form.design.surface.shadow} onChange={(event) => setDesign("surface", { shadow: event.target.value as AdvancedForm["design"]["surface"]["shadow"] })}>
                        <option value="none">None</option>
                        <option value="soft">Soft</option>
                        <option value="strong">Strong</option>
                      </select>
                    </Field>
                    <label className="affb-checkbox">
                      <Checkbox checked={form.design.surface.border} onCheckedChange={(value) => setDesign("surface", { border: value === true })} />
                      <span>Show surface border</span>
                    </label>
                  </Accordion>
                </>
              ) : null}

              {inspector === "type" ? (
                <>
                  <Accordion title="Typography" icon={<Type size={14} />} defaultOpen>
                    <Field label="Font family">
                      <select value={form.design.typography.font} onChange={(event) => setDesign("typography", { font: event.target.value as AdvancedForm["design"]["typography"]["font"] })}>
                        {Object.keys(ADVANCED_FONT_STACKS).map((font) => <option key={font} value={font}>{font === "sans" ? "Geist Sans" : font === "serif" ? "Serif" : font === "mono" ? "Monospace" : "Rounded"}</option>)}
                      </select>
                    </Field>
                    <RangeRow label="Body size" value={form.design.typography.baseSize} min={11} max={22} onChange={(baseSize) => setDesign("typography", { baseSize })} />
                    <RangeRow label="Title size" value={form.design.typography.headingSize} min={16} max={56} onChange={(headingSize) => setDesign("typography", { headingSize })} />
                    <RangeRow label="Title weight" value={form.design.typography.headingWeight} min={400} max={900} step={50} suffix="" onChange={(headingWeight) => setDesign("typography", { headingWeight })} />
                    <div className="affb-segmented" role="group" aria-label="Text alignment">
                      {([["left", <AlignLeft size={14} key="l" />], ["center", <AlignCenter size={14} key="c" />], ["right", <AlignRight size={14} key="r" />]] as const).map(([value, icon]) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`Align ${value}`}
                          aria-pressed={form.design.typography.align === value}
                          className={form.design.typography.align === value ? "is-active" : ""}
                          onClick={() => setDesign("typography", { align: value })}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                    <ColorRow label="Title colour" value={form.design.typography.titleColor} onChange={(titleColor) => setDesign("typography", { titleColor })} />
                    <ColorRow label="Text colour" value={form.design.typography.textColor} onChange={(textColor) => setDesign("typography", { textColor })} />
                    <ColorRow label="Label colour" value={form.design.typography.labelColor} onChange={(labelColor) => setDesign("typography", { labelColor })} />
                  </Accordion>
                </>
              ) : null}

              {inspector === "layout" ? (
                <>
                  <Accordion title="Layout & spacing" icon={<Layers size={14} />} defaultOpen>
                    <RangeRow label="Content width" value={form.design.layout.maxWidth} min={320} max={1200} step={10} onChange={(maxWidth) => setDesign("layout", { maxWidth })} />
                    <div className="affb-segmented" role="group" aria-label="Columns">
                      {[1, 2, 3].map((columns) => (
                        <button
                          key={columns}
                          type="button"
                          aria-pressed={form.design.layout.columns === columns}
                          className={form.design.layout.columns === columns ? "is-active" : ""}
                          onClick={() => setDesign("layout", { columns: columns as 1 | 2 | 3 })}
                        >
                          {columns} col
                        </button>
                      ))}
                    </div>
                    <RangeRow label="Element gap" value={form.design.layout.gap} min={0} max={48} onChange={(gap) => setDesign("layout", { gap })} />
                    <RangeRow label="Section spacing" value={form.design.layout.sectionGap} min={0} max={80} onChange={(sectionGap) => setDesign("layout", { sectionGap })} />
                    <RangeRow label="Field spacing" value={form.design.layout.fieldSpacing} min={0} max={48} onChange={(fieldSpacing) => setDesign("layout", { fieldSpacing })} />
                    <RangeRow label="Horizontal padding" value={form.design.layout.paddingX} min={8} max={72} onChange={(paddingX) => setDesign("layout", { paddingX })} />
                    <RangeRow label="Vertical padding" value={form.design.layout.paddingY} min={8} max={72} onChange={(paddingY) => setDesign("layout", { paddingY })} />
                  </Accordion>

                  <Accordion title="Fields & buttons" defaultOpen>
                    <RangeRow label="Input radius" value={form.design.controls.radius} min={0} max={28} onChange={(radius) => setDesign("controls", { radius })} />
                    <ColorRow label="Input border" value={form.design.controls.borderColor} onChange={(borderColor) => setDesign("controls", { borderColor })} />
                    <ColorRow label="Input background" value={form.design.controls.inputBg} onChange={(inputBg) => setDesign("controls", { inputBg })} />
                    <ColorRow label="Focus colour" value={form.design.controls.focusColor} onChange={(focusColor) => setDesign("controls", { focusColor })} />
                    <ColorRow label="Button colour" value={form.design.controls.buttonBg} onChange={(buttonBg) => setDesign("controls", { buttonBg })} />
                    <ColorRow label="Button text" value={form.design.controls.buttonText} onChange={(buttonText) => setDesign("controls", { buttonText })} />
                    <RangeRow label="Button radius" value={form.design.controls.buttonRadius} min={0} max={28} onChange={(buttonRadius) => setDesign("controls", { buttonRadius })} />
                    <label className="affb-checkbox">
                      <Checkbox checked={form.design.controls.buttonFullWidth} onCheckedChange={(value) => setDesign("controls", { buttonFullWidth: value === true })} />
                      <span>Full-width submit button</span>
                    </label>
                  </Accordion>
                </>
              ) : null}

              {inspector === "elements" ? (
                selectedField ? (
                  <div className="affb-element-settings">
                    <div className="affb-element-head">
                      <span>{ADVANCED_FIELD_LIBRARY.find((entry) => entry.type === selectedField.type)?.label || "Element"}</span>
                      <button type="button" className="affb-icon" onClick={() => duplicateField(selectedField.id)} aria-label="Duplicate element" title="Duplicate"><Copy size={14} /></button>
                      <button type="button" className="affb-icon is-danger" onClick={() => removeField(selectedField.id)} aria-label="Delete element" title="Delete"><Trash2 size={14} /></button>
                    </div>

                    <Field label={selectedField.type === "heading" || selectedField.type === "paragraph" ? "Text" : "Label"}>
                      {selectedField.type === "paragraph" || selectedField.type === "long_text" ? (
                        <textarea rows={3} value={selectedField.label} onChange={(event) => updateField(selectedField.id, { label: event.target.value })} />
                      ) : (
                        <input value={selectedField.label} onChange={(event) => updateField(selectedField.id, { label: event.target.value })} />
                      )}
                    </Field>

                    {isAnswerField(selectedField) ? (
                      <label className="affb-checkbox">
                        <Checkbox checked={selectedField.required} onCheckedChange={(value) => updateField(selectedField.id, { required: value === true })} />
                        <span>Required</span>
                      </label>
                    ) : null}

                    <Field label="Width">
                      <div className="affb-segmented">
                        {WIDTHS.map((width) => (
                          <button
                            key={width.id}
                            type="button"
                            aria-pressed={selectedField.width === width.id}
                            className={selectedField.width === width.id ? "is-active" : ""}
                            onClick={() => updateField(selectedField.id, { width: width.id })}
                          >
                            {width.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    {["short_text", "long_text", "number", "email", "phone", "select"].includes(selectedField.type) ? (
                      <Field label="Placeholder">
                        <input value={selectedField.placeholder} onChange={(event) => updateField(selectedField.id, { placeholder: event.target.value })} />
                      </Field>
                    ) : null}

                    {["short_text", "long_text", "number", "email", "phone", "date", "time", "color", "rating", "select", "radio", "checkbox"].includes(selectedField.type) ? (
                      <Field label="Help text" hint="Shown under the field">
                        <input value={selectedField.helpText} onChange={(event) => updateField(selectedField.id, { helpText: event.target.value })} />
                      </Field>
                    ) : null}

                    {ADVANCED_CHOICE_TYPES.includes(selectedField.type) ? (
                      <div className="affb-options">
                        <span className="affb-field-label">Options</span>
                        {selectedField.options.map((option, index) => (
                          <div key={option.id} className="affb-option-row">
                            <input
                              value={option.label}
                              aria-label={`Option ${index + 1}`}
                              onChange={(event) => updateField(selectedField.id, {
                                options: selectedField.options.map((entry) => entry.id === option.id ? { ...entry, label: event.target.value } : entry),
                              })}
                            />
                            <button
                              type="button"
                              aria-label={`Remove option ${index + 1}`}
                              onClick={() => updateField(selectedField.id, { options: selectedField.options.filter((entry) => entry.id !== option.id) })}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="affb-add-option"
                          onClick={() => updateField(selectedField.id, { options: [...selectedField.options, { id: advancedId("opt"), label: `Option ${selectedField.options.length + 1}` }] })}
                        >
                          <Plus size={13} /> Add option
                        </button>
                      </div>
                    ) : null}

                    {selectedField.type === "number" ? (
                      <div className="affb-split">
                        <Field label="Min">
                          <input type="number" value={selectedField.min ?? ""} onChange={(event) => updateField(selectedField.id, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                        </Field>
                        <Field label="Max">
                          <input type="number" value={selectedField.max ?? ""} onChange={(event) => updateField(selectedField.id, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                        </Field>
                      </div>
                    ) : null}

                    {selectedField.type === "short_text" || selectedField.type === "long_text" ? (
                      <div className="affb-split">
                        <Field label="Min length">
                          <input type="number" min={0} value={selectedField.minLength ?? ""} onChange={(event) => updateField(selectedField.id, { minLength: event.target.value === "" ? null : Number(event.target.value) })} />
                        </Field>
                        <Field label="Max length">
                          <input type="number" min={0} value={selectedField.maxLength ?? ""} onChange={(event) => updateField(selectedField.id, { maxLength: event.target.value === "" ? null : Number(event.target.value) })} />
                        </Field>
                      </div>
                    ) : null}

                    {["short_text", "long_text"].includes(selectedField.type) ? (
                      <Field label="Validation">
                        <select value={selectedField.pattern} onChange={(event) => updateField(selectedField.id, { pattern: event.target.value as AdvancedField["pattern"] })}>
                          <option value="none">Any text</option>
                          <option value="email">Email address</option>
                          <option value="phone">Phone number</option>
                          <option value="url">Web address</option>
                          <option value="digits">Digits only</option>
                        </select>
                      </Field>
                    ) : null}

                    {selectedField.type === "rating" ? (
                      <RangeRow label="Stars" value={selectedField.rateMax} min={1} max={10} suffix="" onChange={(rateMax) => updateField(selectedField.id, { rateMax })} />
                    ) : null}

                    {["image", "video", "audio"].includes(selectedField.type) ? (
                      <Field label="Media URL" hint="https://…">
                        <input value={selectedField.src} onChange={(event) => updateField(selectedField.id, { src: event.target.value })} />
                      </Field>
                    ) : null}

                    {selectedField.type === "spacer" ? (
                      <RangeRow label="Height" value={selectedField.height} min={4} max={240} onChange={(height) => updateField(selectedField.id, { height })} />
                    ) : null}
                  </div>
                ) : (
                  <p className="affb-inspector-empty">Select an element on the canvas to edit its settings.</p>
                )
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "configure" ? (
        <div className="affb-configure">
          <div className="affb-config-column">
            <section className="affb-card">
              <h3><Settings2 size={15} /> Form identity</h3>
              <Field label="Title">
                <input value={form.title} maxLength={ADVANCED_LIMITS.titleLength} onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))} />
              </Field>
              <Field label="Description">
                <textarea rows={3} value={form.description} maxLength={ADVANCED_LIMITS.descriptionLength} onChange={(event) => mutate((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <Field label="Category">
                <select value={form.category} onChange={(event) => mutate((current) => ({ ...current, category: event.target.value }))}>
                  {ADVANCED_CATEGORIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </Field>
            </section>

            <section className="affb-card">
              <h3><Save size={15} /> Submission behaviour</h3>
              <Field label="Submit button label">
                <input value={form.settings.submitLabel} maxLength={60} onChange={(event) => setSettings({ submitLabel: event.target.value })} />
              </Field>
              <Field label="Confirmation title">
                <input value={form.settings.confirmationTitle} maxLength={120} onChange={(event) => setSettings({ confirmationTitle: event.target.value })} />
              </Field>
              <Field label="Confirmation message">
                <textarea rows={3} value={form.settings.confirmationMessage} maxLength={ADVANCED_LIMITS.confirmationLength} onChange={(event) => setSettings({ confirmationMessage: event.target.value })} />
              </Field>
              <label className="affb-checkbox">
                <Checkbox checked={form.settings.allowMultiple} onCheckedChange={(value) => setSettings({ allowMultiple: value === true })} />
                <span>Allow more than one response from the same device</span>
              </label>
            </section>
          </div>

          <div className="affb-config-column">
            <section className="affb-card">
              <h3>Availability & limits</h3>
              <Field label="Status">
                <select value={form.settings.availability} onChange={(event) => setSettings({ availability: event.target.value as AdvancedForm["settings"]["availability"] })}>
                  <option value="open">Always open</option>
                  <option value="scheduled">Scheduled window</option>
                  <option value="closed">Closed</option>
                </select>
              </Field>
              {form.settings.availability === "scheduled" ? (
                <div className="affb-split">
                  <Field label="Opens at">
                    <input type="datetime-local" value={form.settings.opensAt || ""} onChange={(event) => setSettings({ opensAt: event.target.value })} />
                  </Field>
                  <Field label="Closes at">
                    <input type="datetime-local" value={form.settings.closesAt || ""} onChange={(event) => setSettings({ closesAt: event.target.value })} />
                  </Field>
                </div>
              ) : null}
              <Field label="Response limit" hint="Leave empty for unlimited">
                <input
                  type="number"
                  min={1}
                  value={form.settings.responseLimit ?? ""}
                  onChange={(event) => setSettings({ responseLimit: event.target.value === "" ? null : Number(event.target.value) })}
                />
              </Field>
              <Field label="Closed message">
                <textarea rows={2} value={form.settings.closedMessage} onChange={(event) => setSettings({ closedMessage: event.target.value })} />
              </Field>
              <label className="affb-checkbox">
                <Checkbox checked={form.settings.requiredByDefault} onCheckedChange={(value) => setSettings({ requiredByDefault: value === true })} />
                <span>New elements are required by default</span>
              </label>
            </section>

            <section className="affb-card">
              <div className="affb-card-head">
                <h3>Conditional logic</h3>
                <button type="button" className="affb-add-option" onClick={addLogic} disabled={answerFields.length < 2}>
                  <Plus size={13} /> Add rule
                </button>
              </div>
              <p className="affb-card-sub">
                Show or hide an element based on an earlier answer. Rules apply in order and never target an element above their trigger.
              </p>
              {logic.length === 0 ? (
                <p className="affb-inspector-empty">No rules yet. Add at least two answer elements to build logic.</p>
              ) : (
                <ul className="affb-logic-list">
                  {logic.map((rule) => {
                    const index = form.fields.findIndex((field) => field.id === rule.targetFieldId);
                    const candidates = answerFields.filter((field) => form.fields.findIndex((entry) => entry.id === field.id) < index);
                    const trigger = answerFields.find((field) => field.id === rule.fieldId);
                    return (
                      <li key={rule.id} className="affb-logic-rule">
                        <div className="affb-logic-row">
                          <select value={rule.action} onChange={(event) => updateLogic(rule.id, { action: event.target.value as AdvancedLogicRule["action"] })} aria-label="Action">
                            <option value="show">Show</option>
                            <option value="hide">Hide</option>
                          </select>
                          <select value={rule.targetFieldId} onChange={(event) => updateLogic(rule.id, { targetFieldId: event.target.value })} aria-label="Target element">
                            {form.fields.map((field) => <option key={field.id} value={field.id}>{field.label || field.type}</option>)}
                          </select>
                        </div>
                        <div className="affb-logic-row">
                          <span className="affb-logic-when">when</span>
                          <select value={rule.fieldId} onChange={(event) => updateLogic(rule.id, { fieldId: event.target.value })} aria-label="Trigger element">
                            {candidates.length ? candidates.map((field) => <option key={field.id} value={field.id}>{field.label || field.type}</option>) : <option value={rule.fieldId}>{trigger?.label || "Earlier element"}</option>}
                          </select>
                          <select value={rule.operator} onChange={(event) => updateLogic(rule.id, { operator: event.target.value as AdvancedLogicRule["operator"] })} aria-label="Operator">
                            {ADVANCED_LOGIC_OPERATORS.map((operator) => <option key={operator.id} value={operator.id}>{operator.label}</option>)}
                          </select>
                          {["is", "is_not", "contains", "gt", "lt"].includes(rule.operator) ? (
                            trigger?.options.length ? (
                              <select value={rule.value} onChange={(event) => updateLogic(rule.id, { value: event.target.value })} aria-label="Value">
                                <option value="">Choose…</option>
                                {trigger.options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
                              </select>
                            ) : (
                              <input value={rule.value} onChange={(event) => updateLogic(rule.id, { value: event.target.value })} aria-label="Value" placeholder="Value" />
                            )
                          ) : null}
                          <button type="button" className="affb-icon is-danger" aria-label="Remove rule" onClick={() => setSettings({ logic: logic.filter((entry) => entry.id !== rule.id) })}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {tab === "responses" ? <div className="affb-responses-shell">{responsesPanel}</div> : null}
    </div>
  );
}

function IconTileLike() {
  return (
    <span className="affb-canvas-empty-icon" aria-hidden="true">
      <Layers size={18} />
    </span>
  );
}

export type { BuilderTab };
