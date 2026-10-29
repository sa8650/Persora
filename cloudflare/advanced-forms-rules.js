// Persora Advanced Forms — pure rules layer.
//
// Everything here is framework-free so the same code powers the builder, the
// preview, the published respondent view and the Node test suite:
//   • element/field catalogue and factory helpers
//   • answer validation (required, type, length, pattern, min/max)
//   • conditional-logic evaluation (show/hide based on earlier answers)
//   • response-limit / availability checks
//   • CSV export
// Design decisions deliberately live in the form document itself, so a published
// form reproduces exactly what the builder showed.

export const ADVANCED_FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
  "radio",
  "checkbox",
  "select",
  "date",
  "time",
  "color",
  "rating",
  "image",
  "video",
  "audio",
  "file",
  "heading",
  "paragraph",
  "divider",
  "spacer",
];

/** Element types that collect an answer (everything else is presentational). */
export const ADVANCED_ANSWER_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
  "radio",
  "checkbox",
  "select",
  "date",
  "time",
  "color",
  "rating",
  "file",
];

export const ADVANCED_CHOICE_TYPES = ["radio", "checkbox", "select"];

export const ADVANCED_FIELD_LIBRARY = [
  { type: "short_text", group: "Text", label: "Short text", hint: "Names, titles and brief answers" },
  { type: "long_text", group: "Text", label: "Long text", hint: "Comments, explanations, detailed feedback" },
  { type: "number", group: "Text", label: "Number", hint: "Numeric values and quantities" },
  { type: "email", group: "Contact", label: "Email", hint: "Contact address with validation" },
  { type: "phone", group: "Contact", label: "Phone", hint: "Phone number with validation" },
  { type: "radio", group: "Choice", label: "Radio buttons", hint: "Select one option" },
  { type: "checkbox", group: "Choice", label: "Checkboxes", hint: "Select multiple options" },
  { type: "select", group: "Choice", label: "Dropdown", hint: "Choose from a compact list" },
  { type: "date", group: "Choice", label: "Date picker", hint: "Collect a date" },
  { type: "time", group: "Choice", label: "Time picker", hint: "Collect a time" },
  { type: "color", group: "Choice", label: "Colour picker", hint: "Let respondents pick a colour" },
  { type: "rating", group: "Choice", label: "Rating", hint: "Stars or a numeric score" },
  { type: "image", group: "Media", label: "Image", hint: "Display an image or visual instructions" },
  { type: "video", group: "Media", label: "Video", hint: "Embed supporting video" },
  { type: "audio", group: "Media", label: "Audio", hint: "Embed supporting audio" },
  { type: "file", group: "Media", label: "File upload", hint: "Accept a document or image" },
  { type: "heading", group: "Content", label: "Heading", hint: "Section title" },
  { type: "paragraph", group: "Content", label: "Paragraph", hint: "Description or instructions" },
  { type: "divider", group: "Content", label: "Divider", hint: "Visual separation" },
  { type: "spacer", group: "Content", label: "Spacer", hint: "Control vertical rhythm" },
];

export const ADVANCED_FONT_STACKS = {
  sans: "\"Geist Variable\", \"Geist Sans\", Geist, ui-sans-serif, system-ui, -apple-system, sans-serif",
  serif: "ui-serif, Georgia, Cambria, \"Times New Roman\", serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  rounded: "\"Segoe UI Variable Display\", \"Segoe UI\", system-ui, -apple-system, sans-serif",
};

export const ADVANCED_CATEGORIES = [
  "General",
  "Feedback",
  "Registration",
  "Booking",
  "Survey",
  "Application",
  "Order",
  "Contact",
];

export const ADVANCED_LIMITS = {
  formsPerUser: 200,
  titleLength: 160,
  descriptionLength: 1200,
  fieldsPerForm: 120,
  labelLength: 240,
  optionsPerField: 40,
  optionLength: 200,
  answerLength: 5000,
  confirmationLength: 600,
  maxFileMb: 10,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s().-]{6,24}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

let sequence = 0;

/** Collision-safe id without depending on crypto (works in every runtime). */
export function advancedId(prefix = "af") {
  sequence = (sequence + 1) % 1_000_000;
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${sequence.toString(36)}${random}`;
}

export const ADVANCED_DEFAULT_DESIGN = {
  background: { type: "gradient", color: "#eef2ff", from: "#eef2ff", to: "#fdf2f8", angle: 135, imageUrl: "", overlay: 0.2 },
  surface: { color: "#ffffff", radius: 20, shadow: "soft", border: true, opacity: 1 },
  typography: {
    font: "sans",
    baseSize: 15,
    headingSize: 30,
    headingWeight: 700,
    titleColor: "#111827",
    textColor: "#475569",
    labelColor: "#1f2937",
    align: "left",
  },
  layout: {
    maxWidth: 760,
    columns: 1,
    gap: 14,
    sectionGap: 26,
    paddingX: 28,
    paddingY: 30,
    fieldSpacing: 14,
  },
  controls: {
    radius: 10,
    borderColor: "#dbe3ef",
    inputBg: "#ffffff",
    focusColor: "#2563eb",
    buttonBg: "#2563eb",
    buttonText: "#ffffff",
    buttonRadius: 10,
    buttonFullWidth: false,
  },
};

export const ADVANCED_DEFAULT_SETTINGS = {
  requiredByDefault: false,
  submitLabel: "Submit response",
  confirmationTitle: "Thank you!",
  confirmationMessage: "Your response has been recorded.",
  allowMultiple: true,
  responseLimit: null,
  availability: "open",
  closedMessage: "This form is no longer accepting responses.",
  successEmailField: "",
  logic: [],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function pickString(value, allowed, fallback) {
  return allowed.includes(String(value)) ? String(value) : fallback;
}

export function cleanAdvancedText(value, maxLength, allowNewlines = false) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n");
  const stripped = allowNewlines
    ? normalized.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    : normalized.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return stripped.slice(0, maxLength);
}

export function cleanAdvancedColor(value, fallback = "#ffffff") {
  const input = String(value || "").trim();
  if (HEX_RE.test(input)) return input.toLowerCase();
  return fallback;
}

/** Factory for a fresh element of any supported type. */
export function createAdvancedField(type, overrides = {}) {
  const kind = ADVANCED_FIELD_TYPES.includes(type) ? type : "short_text";
  const base = {
    id: advancedId("fld"),
    type: kind,
    label: "",
    placeholder: "",
    helpText: "",
    required: false,
    options: [],
    width: "full",
    align: "left",
    min: null,
    max: null,
    minLength: null,
    maxLength: null,
    pattern: "none",
    rateMax: 5,
    src: "",
    height: 120,
  };
  if (ADVANCED_CHOICE_TYPES.includes(kind)) {
    base.options = [
      { id: advancedId("opt"), label: "Option one" },
      { id: advancedId("opt"), label: "Option two" },
      { id: advancedId("opt"), label: "Option three" },
    ];
  }
  if (kind === "rating") base.rateMax = 5;
  if (kind === "spacer") base.height = 28;
  if (kind === "paragraph") base.label = "Add supporting text or instructions for this section.";
  if (kind === "heading") base.label = "Section heading";
  if (kind === "checkbox") base.required = false;
  if (kind === "email" || kind === "phone") base.placeholder = kind === "email" ? "name@example.com" : "+1 555 0100";
  if (kind === "short_text") base.placeholder = "Type your answer";
  if (kind === "number") base.placeholder = "0";
  return { ...base, ...overrides, id: overrides.id || base.id, type: kind };
}

export function isAnswerField(field) {
  return ADVANCED_ANSWER_TYPES.includes(field?.type);
}

/* ------------------------------------------------------------------ */
/* Conditional logic                                                   */
/* ------------------------------------------------------------------ */

export const ADVANCED_LOGIC_OPERATORS = [
  { id: "is", label: "is" },
  { id: "is_not", label: "is not" },
  { id: "contains", label: "contains" },
  { id: "is_empty", label: "is empty" },
  { id: "is_not_empty", label: "is not empty" },
  { id: "gt", label: "is greater than" },
  { id: "lt", label: "is less than" },
];

function answerIsEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function matchesRule(rule, answers) {
  const value = answers[rule.fieldId];
  switch (rule.operator) {
    case "is":
      return Array.isArray(value) ? value.includes(rule.value) : String(value ?? "") === String(rule.value);
    case "is_not":
      return Array.isArray(value) ? !value.includes(rule.value) : String(value ?? "") !== String(rule.value);
    case "contains":
      return Array.isArray(value)
        ? value.some((entry) => String(entry).toLowerCase().includes(String(rule.value).toLowerCase()))
        : String(value ?? "").toLowerCase().includes(String(rule.value).toLowerCase());
    case "is_empty":
      return answerIsEmpty(value);
    case "is_not_empty":
      return !answerIsEmpty(value);
    case "gt":
      return Number(value) > Number(rule.value);
    case "lt":
      return Number(value) < Number(rule.value);
    default:
      return false;
  }
}

/**
 * Resolves which element ids are visible for the current answers.
 * Rules only reference earlier elements, so evaluation is a single forward pass
 * and can never loop.
 */
export function resolveVisibleFieldIds(form, answers = {}) {
  const fields = form?.fields || [];
  const rules = form?.settings?.logic || [];
  const hidden = new Set();
  const order = new Map(fields.map((field, index) => [field.id, index]));
  for (const rule of rules) {
    if (!rule?.fieldId || !rule?.targetFieldId) continue;
    const from = order.get(rule.fieldId);
    const to = order.get(rule.targetFieldId);
    if (from == null || to == null || to <= from) continue;
    if (!matchesRule(rule, answers)) continue;
    if (rule.action === "hide") hidden.add(rule.targetFieldId);
    if (rule.action === "show") hidden.delete(rule.targetFieldId);
  }
  return fields.filter((field) => !hidden.has(field.id)).map((field) => field.id);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validates answers against the visible elements of a form.
 * Returns `{ ok, errors: { [fieldId]: message } }`.
 */
export function validateAdvancedAnswers(form, answers = {}) {
  const errors = {};
  const visible = new Set(resolveVisibleFieldIds(form, answers));
  for (const field of form?.fields || []) {
    if (!isAnswerField(field)) continue;
    if (!visible.has(field.id)) continue;
    const value = answers[field.id];
    const empty = answerIsEmpty(value);
    const label = cleanAdvancedText(field.label, ADVANCED_LIMITS.labelLength) || "This question";
    if (empty) {
      if (field.required) errors[field.id] = `${label} is required.`;
      continue;
    }
    if (field.type === "email" || field.pattern === "email") {
      if (!EMAIL_RE.test(String(value).trim())) errors[field.id] = "Enter a valid email address.";
      continue;
    }
    if (field.type === "phone" || field.pattern === "phone") {
      if (!PHONE_RE.test(String(value).trim())) errors[field.id] = "Enter a valid phone number.";
      continue;
    }
    if (field.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) errors[field.id] = "Enter a number.";
      else if (field.min != null && numeric < Number(field.min)) errors[field.id] = `Enter ${field.min} or more.`;
      else if (field.max != null && numeric > Number(field.max)) errors[field.id] = `Enter ${field.max} or less.`;
      continue;
    }
    if (field.type === "short_text" || field.type === "long_text") {
      const text = String(value);
      if (field.minLength != null && text.trim().length < Number(field.minLength)) {
        errors[field.id] = `Use at least ${field.minLength} characters.`;
      } else if (field.maxLength != null && text.length > Number(field.maxLength)) {
        errors[field.id] = `Use ${field.maxLength} characters or fewer.`;
      } else if (text.length > ADVANCED_LIMITS.answerLength) {
        errors[field.id] = `Use ${ADVANCED_LIMITS.answerLength} characters or fewer.`;
      }
      continue;
    }
    if (field.type === "rating") {
      const numeric = Number(value);
      const max = Number(field.rateMax) || 5;
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > max) errors[field.id] = `Choose a rating from 1 to ${max}.`;
      continue;
    }
    if (ADVANCED_CHOICE_TYPES.includes(field.type)) {
      const allowed = new Set((field.options || []).map((option) => option.label));
      const chosen = Array.isArray(value) ? value : [value];
      if (field.type !== "checkbox" && chosen.length > 1) errors[field.id] = "Choose a single option.";
      else if (chosen.some((entry) => !allowed.has(String(entry)))) errors[field.id] = "Choose one of the listed options.";
      continue;
    }
    if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      errors[field.id] = "Choose a valid date.";
      continue;
    }
    if (field.type === "time" && !/^\d{2}:\d{2}$/.test(String(value))) errors[field.id] = "Choose a valid time.";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Availability / capacity gate used by the published respondent view. */
export function advancedFormGate(form) {
  const settings = form?.settings || ADVANCED_DEFAULT_SETTINGS;
  const responses = form?.responses?.length || 0;
  if (settings.availability === "closed") return { open: false, reason: "closed", message: settings.closedMessage };
  if (settings.availability === "scheduled") {
    const now = Date.now();
    if (settings.opensAt && Date.parse(settings.opensAt) > now) {
      return { open: false, reason: "scheduled", message: "This form has not opened yet." };
    }
    if (settings.closesAt && Date.parse(settings.closesAt) < now) {
      return { open: false, reason: "closed", message: settings.closedMessage };
    }
  }
  if (settings.responseLimit != null && responses >= Number(settings.responseLimit)) {
    return { open: false, reason: "limit", message: "This form has reached its response limit." };
  }
  return { open: true, reason: null, message: null };
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function advancedResponsesToCsv(form) {
  const answerFields = (form?.fields || []).filter(isAnswerField);
  const header = ["Submitted at", ...answerFields.map((field) => field.label || field.type)];
  const rows = (form?.responses || []).map((response) => [
    response.submittedAt,
    ...answerFields.map((field) => {
      const value = response.answers?.[field.id];
      if (field.type === "file") return value?.name || value || "";
      return value;
    }),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/* ------------------------------------------------------------------ */
/* Form document helpers                                               */
/* ------------------------------------------------------------------ */

export function createAdvancedForm(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: advancedId("afm"),
    title: "Untitled form",
    description: "",
    category: "General",
    status: "draft",
    slug: advancedId("slug"),
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    design: normalizeAdvancedDesign(overrides.design),
    settings: normalizeAdvancedSettings(overrides.settings),
    fields: Array.isArray(overrides.fields) ? overrides.fields.map(normalizeAdvancedField) : [],
    responses: [],
    ...overrides,
    // never let a caller clobber the normalised branches
    design: normalizeAdvancedDesign(overrides.design),
    settings: normalizeAdvancedSettings(overrides.settings),
    fields: Array.isArray(overrides.fields) ? overrides.fields.map(normalizeAdvancedField) : [],
  };
}

export function normalizeAdvancedField(raw) {
  if (!isPlainObject(raw)) return createAdvancedField("short_text");
  const type = ADVANCED_FIELD_TYPES.includes(raw.type) ? raw.type : "short_text";
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : advancedId("fld"),
    type,
    label: cleanAdvancedText(raw.label ?? "", ADVANCED_LIMITS.labelLength, true),
    placeholder: cleanAdvancedText(raw.placeholder ?? "", 200),
    helpText: cleanAdvancedText(raw.helpText ?? "", 400, true),
    required: Boolean(raw.required),
    options: ADVANCED_CHOICE_TYPES.includes(type) && Array.isArray(raw.options)
      ? raw.options
          .slice(0, ADVANCED_LIMITS.optionsPerField)
          .map((option) => ({
            id: typeof option?.id === "string" && option.id ? option.id : advancedId("opt"),
            label: cleanAdvancedText(option?.label ?? "", ADVANCED_LIMITS.optionLength) || "Option",
          }))
      : [],
    width: pickString(raw.width, ["full", "half", "third"], "full"),
    align: pickString(raw.align, ["left", "center", "right"], "left"),
    min: raw.min == null || raw.min === "" ? null : Number(raw.min),
    max: raw.max == null || raw.max === "" ? null : Number(raw.max),
    minLength: raw.minLength == null || raw.minLength === "" ? null : Number(raw.minLength),
    maxLength: raw.maxLength == null || raw.maxLength === "" ? null : Number(raw.maxLength),
    pattern: pickString(raw.pattern, ["none", "email", "phone", "url", "digits"], "none"),
    rateMax: clampNumber(raw.rateMax, 1, 10, type === "rating" ? 5 : 5),
    src: cleanAdvancedText(raw.src ?? "", 2000),
    height: clampNumber(raw.height, 4, 480, type === "spacer" ? 28 : 120),
  };
}

export function normalizeAdvancedDesign(raw) {
  const base = ADVANCED_DEFAULT_DESIGN;
  const input = isPlainObject(raw) ? raw : {};
  const background = isPlainObject(input.background) ? input.background : {};
  const surface = isPlainObject(input.surface) ? input.surface : {};
  const typography = isPlainObject(input.typography) ? input.typography : {};
  const layout = isPlainObject(input.layout) ? input.layout : {};
  const controls = isPlainObject(input.controls) ? input.controls : {};
  return {
    background: {
      type: pickString(background.type, ["solid", "gradient", "image", "none"], base.background.type),
      color: cleanAdvancedColor(background.color, base.background.color),
      from: cleanAdvancedColor(background.from, base.background.from),
      to: cleanAdvancedColor(background.to, base.background.to),
      angle: clampNumber(background.angle, 0, 360, base.background.angle),
      imageUrl: cleanAdvancedText(background.imageUrl ?? "", 2000),
      overlay: clampNumber(background.overlay, 0, 0.9, base.background.overlay),
    },
    surface: {
      color: cleanAdvancedColor(surface.color, base.surface.color),
      radius: clampNumber(surface.radius, 0, 40, base.surface.radius),
      shadow: pickString(surface.shadow, ["none", "soft", "strong"], base.surface.shadow),
      border: surface.border !== false,
      opacity: clampNumber(surface.opacity, 0.4, 1, base.surface.opacity),
    },
    typography: {
      font: pickString(typography.font, Object.keys(ADVANCED_FONT_STACKS), base.typography.font),
      baseSize: clampNumber(typography.baseSize, 11, 22, base.typography.baseSize),
      headingSize: clampNumber(typography.headingSize, 16, 56, base.typography.headingSize),
      headingWeight: clampNumber(typography.headingWeight, 400, 900, base.typography.headingWeight),
      titleColor: cleanAdvancedColor(typography.titleColor, base.typography.titleColor),
      textColor: cleanAdvancedColor(typography.textColor, base.typography.textColor),
      labelColor: cleanAdvancedColor(typography.labelColor, base.typography.labelColor),
      align: pickString(typography.align, ["left", "center", "right"], base.typography.align),
    },
    layout: {
      maxWidth: clampNumber(layout.maxWidth, 320, 1200, base.layout.maxWidth),
      columns: clampNumber(layout.columns, 1, 3, base.layout.columns),
      gap: clampNumber(layout.gap, 0, 48, base.layout.gap),
      sectionGap: clampNumber(layout.sectionGap, 0, 80, base.layout.sectionGap),
      paddingX: clampNumber(layout.paddingX, 8, 72, base.layout.paddingX),
      paddingY: clampNumber(layout.paddingY, 8, 72, base.layout.paddingY),
      fieldSpacing: clampNumber(layout.fieldSpacing, 0, 48, base.layout.fieldSpacing),
    },
    controls: {
      radius: clampNumber(controls.radius, 0, 28, base.controls.radius),
      borderColor: cleanAdvancedColor(controls.borderColor, base.controls.borderColor),
      inputBg: cleanAdvancedColor(controls.inputBg, base.controls.inputBg),
      focusColor: cleanAdvancedColor(controls.focusColor, base.controls.focusColor),
      buttonBg: cleanAdvancedColor(controls.buttonBg, base.controls.buttonBg),
      buttonText: cleanAdvancedColor(controls.buttonText, base.controls.buttonText),
      buttonRadius: clampNumber(controls.buttonRadius, 0, 28, base.controls.buttonRadius),
      buttonFullWidth: Boolean(controls.buttonFullWidth),
    },
  };
}

export function normalizeAdvancedSettings(raw) {
  const base = ADVANCED_DEFAULT_SETTINGS;
  const input = isPlainObject(raw) ? raw : {};
  const logic = Array.isArray(input.logic)
    ? input.logic
        .filter((rule) => isPlainObject(rule) && rule.fieldId && rule.targetFieldId)
        .slice(0, 60)
        .map((rule) => ({
          id: typeof rule.id === "string" && rule.id ? rule.id : advancedId("rule"),
          fieldId: String(rule.fieldId),
          operator: pickString(rule.operator, ADVANCED_LOGIC_OPERATORS.map((entry) => entry.id), "is"),
          value: cleanAdvancedText(rule.value ?? "", 200),
          targetFieldId: String(rule.targetFieldId),
          action: pickString(rule.action, ["show", "hide"], "show"),
        }))
    : [];
  return {
    requiredByDefault: Boolean(input.requiredByDefault),
    submitLabel: cleanAdvancedText(input.submitLabel ?? base.submitLabel, 60) || base.submitLabel,
    confirmationTitle: cleanAdvancedText(input.confirmationTitle ?? base.confirmationTitle, 120) || base.confirmationTitle,
    confirmationMessage:
      cleanAdvancedText(input.confirmationMessage ?? base.confirmationMessage, ADVANCED_LIMITS.confirmationLength, true) ||
      base.confirmationMessage,
    allowMultiple: input.allowMultiple !== false,
    responseLimit: input.responseLimit == null || input.responseLimit === "" ? null : clampNumber(input.responseLimit, 1, 100000, 100),
    availability: pickString(input.availability, ["open", "closed", "scheduled"], "open"),
    opensAt: cleanAdvancedText(input.opensAt ?? "", 40),
    closesAt: cleanAdvancedText(input.closesAt ?? "", 40),
    closedMessage: cleanAdvancedText(input.closedMessage ?? base.closedMessage, 400, true) || base.closedMessage,
    successEmailField: cleanAdvancedText(input.successEmailField ?? "", 80),
    logic,
  };
}

/** Normalises a stored document; safe against older or hand-edited payloads. */
export function normalizeAdvancedForm(raw) {
  if (!isPlainObject(raw)) return createAdvancedForm();
  const form = createAdvancedForm();
  return {
    ...form,
    id: typeof raw.id === "string" && raw.id ? raw.id : form.id,
    title: cleanAdvancedText(raw.title ?? form.title, ADVANCED_LIMITS.titleLength).trim() || form.title,
    description: cleanAdvancedText(raw.description ?? "", ADVANCED_LIMITS.descriptionLength, true),
    category: cleanAdvancedText(raw.category ?? "General", 40).trim() || "General",
    status: raw.status === "published" ? "published" : "draft",
    slug: typeof raw.slug === "string" && raw.slug ? raw.slug : form.slug,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : form.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : form.updatedAt,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
    design: normalizeAdvancedDesign(raw.design),
    settings: normalizeAdvancedSettings(raw.settings),
    fields: Array.isArray(raw.fields) ? raw.fields.slice(0, ADVANCED_LIMITS.fieldsPerForm).map(normalizeAdvancedField) : [],
    responses: Array.isArray(raw.responses)
      ? raw.responses
          .filter((entry) => isPlainObject(entry))
          .map((entry) => ({
            id: typeof entry.id === "string" && entry.id ? entry.id : advancedId("res"),
            submittedAt: typeof entry.submittedAt === "string" ? entry.submittedAt : new Date().toISOString(),
            answers: isPlainObject(entry.answers) ? entry.answers : {},
            device: cleanAdvancedText(entry.device ?? "", 80),
          }))
      : [],
  };
}

/** Summary row for the dashboard cards. */
export function summarizeAdvancedForm(form) {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    category: form.category,
    status: form.status,
    updatedAt: form.updatedAt,
    responseCount: form.responses?.length || 0,
    fieldCount: (form.fields || []).length,
    shared: Boolean(form.sharedWith && form.sharedWith.length),
  };
}

export function advancedFormError(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
