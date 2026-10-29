export type AdvancedFieldType =
  | "short_text" | "long_text" | "number" | "email" | "phone"
  | "radio" | "checkbox" | "select" | "date" | "time" | "color" | "rating"
  | "image" | "video" | "audio" | "file"
  | "heading" | "paragraph" | "divider" | "spacer";

export interface AdvancedFieldOption { id: string; label: string }

export interface AdvancedField {
  id: string;
  type: AdvancedFieldType;
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  options: AdvancedFieldOption[];
  width: "full" | "half" | "third";
  align: "left" | "center" | "right";
  min: number | null;
  max: number | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: "none" | "email" | "phone" | "url" | "digits";
  rateMax: number;
  src: string;
  height: number;
}

export interface AdvancedDesign {
  background: { type: "solid" | "gradient" | "image" | "none"; color: string; from: string; to: string; angle: number; imageUrl: string; overlay: number };
  surface: { color: string; radius: number; shadow: "none" | "soft" | "strong"; border: boolean; opacity: number };
  typography: { font: "sans" | "serif" | "mono" | "rounded"; baseSize: number; headingSize: number; headingWeight: number; titleColor: string; textColor: string; labelColor: string; align: "left" | "center" | "right" };
  layout: { maxWidth: number; columns: 1 | 2 | 3; gap: number; sectionGap: number; paddingX: number; paddingY: number; fieldSpacing: number };
  controls: { radius: number; borderColor: string; inputBg: string; focusColor: string; buttonBg: string; buttonText: string; buttonRadius: number; buttonFullWidth: boolean };
}

export interface AdvancedLogicRule {
  id: string;
  fieldId: string;
  operator: "is" | "is_not" | "contains" | "is_empty" | "is_not_empty" | "gt" | "lt";
  value: string;
  targetFieldId: string;
  action: "show" | "hide";
}

export interface AdvancedSettings {
  requiredByDefault: boolean;
  submitLabel: string;
  confirmationTitle: string;
  confirmationMessage: string;
  allowMultiple: boolean;
  responseLimit: number | null;
  availability: "open" | "closed" | "scheduled";
  opensAt?: string;
  closesAt?: string;
  closedMessage: string;
  successEmailField: string;
  logic: AdvancedLogicRule[];
}

export type AdvancedAnswerValue = string | number | string[] | { name: string; size: number; type: string } | null;

export interface AdvancedResponse {
  id: string;
  submittedAt: string;
  answers: Record<string, AdvancedAnswerValue>;
  device: string;
}

export interface AdvancedForm {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "draft" | "published";
  slug: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  design: AdvancedDesign;
  settings: AdvancedSettings;
  fields: AdvancedField[];
  responses: AdvancedResponse[];
  sharedWith?: string[];
}

export const ADVANCED_FIELD_TYPES: readonly AdvancedFieldType[];
export const ADVANCED_ANSWER_TYPES: readonly AdvancedFieldType[];
export const ADVANCED_CHOICE_TYPES: readonly string[];
export const ADVANCED_FIELD_LIBRARY: readonly { type: AdvancedFieldType; group: string; label: string; hint: string }[];
export const ADVANCED_FONT_STACKS: Record<"sans" | "serif" | "mono" | "rounded", string>;
export const ADVANCED_CATEGORIES: readonly string[];
export const ADVANCED_LIMITS: Record<string, number>;
export const ADVANCED_DEFAULT_DESIGN: AdvancedDesign;
export const ADVANCED_DEFAULT_SETTINGS: AdvancedSettings;
export const ADVANCED_LOGIC_OPERATORS: readonly { id: AdvancedLogicRule["operator"]; label: string }[];

export function advancedId(prefix?: string): string;
export function cleanAdvancedText(value: string, maxLength: number, allowNewlines?: boolean): string;
export function cleanAdvancedColor(value: string, fallback?: string): string;
export function createAdvancedField(type: AdvancedFieldType, overrides?: Partial<AdvancedField>): AdvancedField;
export function isAnswerField(field: AdvancedField | null | undefined): boolean;
export function resolveVisibleFieldIds(form: AdvancedForm, answers?: Record<string, AdvancedAnswerValue>): string[];
export function validateAdvancedAnswers(form: AdvancedForm, answers?: Record<string, AdvancedAnswerValue>): { ok: boolean; errors: Record<string, string> };
export function advancedFormGate(form: AdvancedForm): { open: boolean; reason: string | null; message: string | null };
export function advancedResponsesToCsv(form: AdvancedForm): string;
export function createAdvancedForm(overrides?: Partial<AdvancedForm>): AdvancedForm;
export function normalizeAdvancedField(raw: unknown): AdvancedField;
export function normalizeAdvancedDesign(raw: unknown): AdvancedDesign;
export function normalizeAdvancedSettings(raw: unknown): AdvancedSettings;
export function normalizeAdvancedForm(raw: unknown): AdvancedForm;
export function summarizeAdvancedForm(form: AdvancedForm): {
  id: string; title: string; description: string; category: string; status: string;
  updatedAt: string; responseCount: number; fieldCount: number; shared: boolean;
};
export function advancedFormError(error: unknown, fallback: string): string;
