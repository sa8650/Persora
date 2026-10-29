import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  ADVANCED_FONT_STACKS,
  isAnswerField,
  resolveVisibleFieldIds,
  type AdvancedField,
  type AdvancedForm,
  type AdvancedAnswerValue,
} from "../../../../cloudflare/advanced-forms-rules.js";

export type AdvancedRenderMode = "live" | "preview" | "mini";

export interface AdvancedRendererProps {
  form: AdvancedForm;
  answers?: Record<string, AdvancedAnswerValue>;
  errors?: Record<string, string>;
  onChange?: (fieldId: string, value: AdvancedAnswerValue) => void;
  mode?: AdvancedRenderMode;
  /** Element rendered around a field (selection chrome, drag handle, …). */
  wrapField?: (field: AdvancedField, node: ReactNode) => ReactNode;
  selectedFieldId?: string | null;
  onSubmit?: () => void;
  submitting?: boolean;
  footer?: ReactNode;
}

/** Background paint for the form page, derived from the stored design. */
export function advancedBackgroundStyle(form: AdvancedForm): CSSProperties {
  const { background } = form.design;
  if (background.type === "image" && background.imageUrl) {
    return {
      backgroundImage: `linear-gradient(rgba(15,23,42,${background.overlay}), rgba(15,23,42,${background.overlay})), url("${background.imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (background.type === "gradient") {
    return { backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` };
  }
  if (background.type === "none") return { backgroundImage: "none", backgroundColor: "transparent" };
  return { backgroundColor: background.color };
}

/** The design tokens of one form, exposed as CSS custom properties. */
export function advancedFormVars(form: AdvancedForm): CSSProperties {
  const { surface, typography, layout, controls } = form.design;
  return {
    ["--aff-font" as string]: ADVANCED_FONT_STACKS[typography.font] || ADVANCED_FONT_STACKS.sans,
    ["--aff-base" as string]: `${typography.baseSize}px`,
    ["--aff-heading-size" as string]: `${typography.headingSize}px`,
    ["--aff-heading-weight" as string]: String(typography.headingWeight),
    ["--aff-title-color" as string]: typography.titleColor,
    ["--aff-text-color" as string]: typography.textColor,
    ["--aff-label-color" as string]: typography.labelColor,
    ["--aff-align" as string]: typography.align,
    ["--aff-surface" as string]: surface.color,
    ["--aff-surface-radius" as string]: `${surface.radius}px`,
    ["--aff-surface-opacity" as string]: String(surface.opacity),
    ["--aff-surface-shadow" as string]:
      surface.shadow === "none" ? "none" : surface.shadow === "strong" ? "0 24px 60px rgba(15,23,42,0.24)" : "0 12px 34px rgba(15,23,42,0.12)",
    ["--aff-surface-border" as string]: surface.border ? `1px solid ${controls.borderColor}` : "none",
    ["--aff-max-width" as string]: `${layout.maxWidth}px`,
    ["--aff-columns" as string]: String(layout.columns),
    ["--aff-gap" as string]: `${layout.gap}px`,
    ["--aff-section-gap" as string]: `${layout.sectionGap}px`,
    ["--aff-pad-x" as string]: `${layout.paddingX}px`,
    ["--aff-pad-y" as string]: `${layout.paddingY}px`,
    ["--aff-field-gap" as string]: `${layout.fieldSpacing}px`,
    ["--aff-control-radius" as string]: `${controls.radius}px`,
    ["--aff-control-border" as string]: controls.borderColor,
    ["--aff-control-bg" as string]: controls.inputBg,
    ["--aff-focus" as string]: controls.focusColor,
    ["--aff-button-bg" as string]: controls.buttonBg,
    ["--aff-button-fg" as string]: controls.buttonText,
    ["--aff-button-radius" as string]: `${controls.buttonRadius}px`,
    ["--aff-button-width" as string]: controls.buttonFullWidth ? "100%" : "auto",
  };
}

function inputTypeFor(field: AdvancedField) {
  switch (field.type) {
    case "email": return "email";
    case "number": return "number";
    case "date": return "date";
    case "time": return "time";
    case "color": return "color";
    case "phone": return "tel";
    default: return "text";
  }
}

function fieldSpan(width: AdvancedField["width"]) {
  return width === "half" ? "span 1" : width === "third" ? "span 1" : "1 / -1";
}

/** Renders one element inside the canvas / preview / published form. */
function AdvancedFieldControl({
  field,
  value,
  error,
  mode,
  onChange,
}: {
  field: AdvancedField;
  value: AdvancedAnswerValue;
  error?: string;
  mode: AdvancedRenderMode;
  onChange?: (fieldId: string, value: AdvancedAnswerValue) => void;
}) {
  const disabled = mode !== "live";
  const set = (next: AdvancedAnswerValue) => onChange?.(field.id, next);
  const controlId = `aff-${field.id}`;
  const describedBy = error ? `${controlId}-error` : field.helpText ? `${controlId}-help` : undefined;

  if (field.type === "heading") {
    return <h3 className="aff-heading" style={{ textAlign: field.align }}>{field.label || "Section heading"}</h3>;
  }
  if (field.type === "paragraph") {
    return <p className="aff-paragraph" style={{ textAlign: field.align }}>{field.label}</p>;
  }
  if (field.type === "divider") return <hr className="aff-divider" />;
  if (field.type === "spacer") return <div className="aff-spacer" style={{ height: field.height }} aria-hidden="true" />;
  if (field.type === "image") {
    return field.src
      ? <img className="aff-media" src={field.src} alt={field.label || "Form image"} loading="lazy" />
      : <div className="aff-media aff-media-empty">{field.label || "Image"}</div>;
  }
  if (field.type === "video") {
    return field.src
      ? <video className="aff-media" src={field.src} controls={mode === "live"} aria-label={field.label || "Form video"} />
      : <div className="aff-media aff-media-empty">{field.label || "Video"}</div>;
  }
  if (field.type === "audio") {
    return field.src
      ? <audio className="aff-audio" src={field.src} controls={mode === "live"} aria-label={field.label || "Form audio"} />
      : <div className="aff-media aff-media-empty">{field.label || "Audio"}</div>;
  }
  if (field.type === "file") {
    const uploaded = typeof value === "object" && value && !Array.isArray(value) ? value : null;
    return (
      <div className="aff-file">
        <label className="aff-file-trigger">
          <input
            id={controlId}
            type="file"
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return set(null);
              set({ name: file.name, size: file.size, type: file.type });
            }}
          />
          <span>{uploaded ? uploaded.name : "Choose a file"}</span>
        </label>
        {uploaded ? (
          <button type="button" className="aff-file-clear" onClick={() => set(null)} disabled={disabled} aria-label="Remove file">
            Remove
          </button>
        ) : null}
      </div>
    );
  }

  const labelText = field.label || "Untitled question";

  if (field.type === "long_text") {
    return (
      <div className="aff-control">
        <label className="aff-label" htmlFor={controlId}>{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</label>
        <textarea
          id={controlId}
          className={`aff-input aff-textarea${error ? " has-error" : ""}`}
          rows={4}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => set(event.target.value)}
        />
        {field.helpText ? <p className="aff-help" id={`${controlId}-help`}>{field.helpText}</p> : null}
        {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
      </div>
    );
  }

  if (field.type === "radio" || field.type === "checkbox") {
    const chosen = Array.isArray(value) ? value : value == null || value === "" ? [] : [String(value)];
    return (
      <fieldset className={`aff-control aff-choice${error ? " has-error" : ""}`} aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <legend className="aff-label">{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</legend>
        <div className="aff-choice-list">
          {field.options.map((option) => {
            const checked = chosen.includes(option.label);
            return (
              <label key={option.id} className={`aff-choice-item${checked ? " is-checked" : ""}`}>
                <input
                  type={field.type === "radio" ? "radio" : "checkbox"}
                  name={`aff-${field.id}`}
                  value={option.label}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    if (field.type === "radio") set(option.label);
                    else set(checked ? chosen.filter((entry) => entry !== option.label) : [...chosen, option.label]);
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
        {field.helpText ? <p className="aff-help" id={`${controlId}-help`}>{field.helpText}</p> : null}
        {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
      </fieldset>
    );
  }

  if (field.type === "select") {
    return (
      <div className="aff-control">
        <label className="aff-label" htmlFor={controlId}>{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</label>
        <select
          id={controlId}
          className={`aff-input aff-select${error ? " has-error" : ""}`}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => set(event.target.value)}
        >
          <option value="">{field.placeholder || "Choose an option"}</option>
          {field.options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
        </select>
        {field.helpText ? <p className="aff-help" id={`${controlId}-help`}>{field.helpText}</p> : null}
        {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
      </div>
    );
  }

  if (field.type === "rating") {
    const max = Math.max(1, Number(field.rateMax) || 5);
    const current = Number(value) || 0;
    return (
      <div className="aff-control">
        <span className="aff-label" id={`${controlId}-label`}>{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</span>
        <div className="aff-rating" role="radiogroup" aria-labelledby={`${controlId}-label`} aria-describedby={describedBy}>
          {Array.from({ length: max }, (_, index) => index + 1).map((score) => (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={current === score}
              aria-label={`${score} of ${max}`}
              className={`aff-star${score <= current ? " is-on" : ""}`}
              disabled={disabled}
              onClick={() => set(String(score))}
            >
              <span aria-hidden="true">★</span>
            </button>
          ))}
          <span className="aff-rating-value">{current ? `${current}/${max}` : ""}</span>
        </div>
        {field.helpText ? <p className="aff-help" id={`${controlId}-help`}>{field.helpText}</p> : null}
        {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
      </div>
    );
  }

  if (field.type === "color") {
    const colour = typeof value === "string" && value ? value : "#4f46e5";
    return (
      <div className="aff-control">
        <label className="aff-label" htmlFor={controlId}>{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</label>
        <div className="aff-color">
          <input
            id={controlId}
            type="color"
            value={colour}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(event) => set(event.target.value)}
          />
          <span className="aff-color-value">{typeof value === "string" && value ? value : "No colour chosen"}</span>
        </div>
        {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="aff-control">
      <label className="aff-label" htmlFor={controlId}>{labelText}{field.required ? <span className="aff-required" aria-hidden="true">*</span> : null}</label>
      <input
        id={controlId}
        className={`aff-input${error ? " has-error" : ""}`}
        type={inputTypeFor(field)}
        placeholder={field.placeholder}
        value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        disabled={disabled}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={(event) => set(event.target.value)}
      />
      {field.helpText ? <p className="aff-help" id={`${controlId}-help`}>{field.helpText}</p> : null}
      {error ? <p className="aff-error" id={`${controlId}-error`} role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * Renders a whole advanced form. The same component powers the dashboard card
 * miniature, the builder canvas, the preview and the published respondent view,
 * so a design change is always visible everywhere at once.
 */
export default function AdvancedFormRenderer({
  form,
  answers = {},
  errors = {},
  onChange,
  mode = "preview",
  wrapField,
  selectedFieldId,
  onSubmit,
  submitting = false,
  footer,
}: AdvancedRendererProps) {
  const visible = useMemo(() => new Set(resolveVisibleFieldIds(form, answers)), [form, answers]);
  const style = useMemo(() => ({ ...advancedFormVars(form), ...advancedBackgroundStyle(form) }), [form]);

  return (
    <div className={`aff-page aff-page--${mode}`} style={style} data-advanced-form={form.id}>
      <div className="aff-surface">
        {form.title || form.description ? (
          <header className="aff-header">
            <h2 className="aff-title">{form.title || "Untitled form"}</h2>
            {form.description ? <p className="aff-description">{form.description}</p> : null}
          </header>
        ) : null}

        <div className="aff-fields">
          {form.fields.length === 0 ? (
            <p className="aff-empty">This form has no elements yet. Add questions and content from the Design tab.</p>
          ) : null}
          {form.fields.map((field) => {
            if (!visible.has(field.id)) return null;
            const node = (
              <div
                key={field.id}
                className={`aff-field${field.width === "full" || !isAnswerField(field) ? " is-full" : ""}${selectedFieldId === field.id ? " is-selected" : ""}`}
                style={{ gridColumn: fieldSpan(field.width) }}
                data-field-id={field.id}
                data-field-type={field.type}
              >
                <AdvancedFieldControl
                  field={field}
                  value={answers[field.id] ?? null}
                  error={errors[field.id]}
                  mode={mode}
                  onChange={onChange}
                />
              </div>
            );
            return wrapField ? wrapField(field, node) : node;
          })}
        </div>

        {footer ?? (
          onSubmit ? (
            <div className="aff-actions">
              <button type="button" className="aff-submit" onClick={onSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : form.settings.submitLabel}
              </button>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
