// Persora Advanced Forms — per-account document store.
//
// Advanced forms keep their whole document (design + elements + settings +
// responses) in one local key per account, mirroring how Persora Table and Docs
// keep local drafts: the workspace stays usable offline and in the sample
// session, and nothing leaves the device.
import {
  ADVANCED_LIMITS,
  advancedFormError,
  advancedId,
  createAdvancedForm,
  normalizeAdvancedForm,
  type AdvancedForm,
  type AdvancedResponse,
  type AdvancedAnswerValue,
} from "../../cloudflare/advanced-forms-rules.js";
import { buildAdvancedTemplate } from "../../cloudflare/advanced-forms-templates.js";

const STORAGE_PREFIX = "persora.advanced-forms.v1";

export type AdvancedFormDocument = AdvancedForm;

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}.${userId || "local"}`;
}

function readAll(userId: string): AdvancedFormDocument[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAdvancedForm);
  } catch {
    return [];
  }
}

function writeAll(userId: string, forms: AdvancedFormDocument[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(forms));
  } catch (error) {
    throw new Error(advancedFormError(error, "Advanced forms could not be saved on this device."));
  }
}

export function listAdvancedForms(userId: string): AdvancedFormDocument[] {
  return readAll(userId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getAdvancedForm(userId: string, id: string): AdvancedFormDocument | null {
  return readAll(userId).find((form) => form.id === id) ?? null;
}

export function getAdvancedFormBySlug(userId: string, slug: string): AdvancedFormDocument | null {
  return readAll(userId).find((form) => form.slug === slug || form.id === slug) ?? null;
}

export function saveAdvancedForm(userId: string, form: AdvancedFormDocument): AdvancedFormDocument {
  const forms = readAll(userId);
  const normalized = normalizeAdvancedForm({ ...form, updatedAt: new Date().toISOString() });
  const index = forms.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) forms[index] = normalized;
  else {
    if (forms.length >= ADVANCED_LIMITS.formsPerUser) {
      throw new Error(`You can keep up to ${ADVANCED_LIMITS.formsPerUser} advanced forms.`);
    }
    forms.unshift(normalized);
  }
  writeAll(userId, forms);
  return normalized;
}

export function createAdvancedFormDocument(userId: string, options: { templateId?: string; title?: string } = {}): AdvancedFormDocument {
  const draft = options.templateId ? buildAdvancedTemplate(options.templateId) : createAdvancedForm();
  const form = normalizeAdvancedForm({
    ...(draft ?? createAdvancedForm()),
    ...(options.title ? { title: options.title } : {}),
  });
  return saveAdvancedForm(userId, form);
}

export function duplicateAdvancedForm(userId: string, id: string): AdvancedFormDocument {
  const source = getAdvancedForm(userId, id);
  if (!source) throw new Error("That advanced form no longer exists.");
  const copy = normalizeAdvancedForm({
    ...source,
    id: advancedId("afm"),
    slug: advancedId("slug"),
    title: `${source.title} copy`.slice(0, ADVANCED_LIMITS.titleLength),
    status: "draft",
    publishedAt: null,
    responses: [],
  });
  return saveAdvancedForm(userId, copy);
}

export function deleteAdvancedForm(userId: string, id: string) {
  const forms = readAll(userId).filter((form) => form.id !== id);
  writeAll(userId, forms);
}

export function recordAdvancedResponse(
  userId: string,
  id: string,
  answers: Record<string, AdvancedAnswerValue>,
): { response: AdvancedResponse; form: AdvancedFormDocument } {
  const form = getAdvancedForm(userId, id);
  if (!form) throw new Error("That form no longer exists.");
  const response: AdvancedResponse = {
    id: advancedId("res"),
    submittedAt: new Date().toISOString(),
    answers,
    device: typeof navigator !== "undefined" ? navigator.platform || "Web" : "Web",
  };
  const saved = saveAdvancedForm(userId, { ...form, responses: [response, ...form.responses] });
  return { response, form: saved };
}

export function deleteAdvancedResponse(userId: string, id: string, responseId: string): AdvancedFormDocument | null {
  const form = getAdvancedForm(userId, id);
  if (!form) return null;
  return saveAdvancedForm(userId, { ...form, responses: form.responses.filter((entry) => entry.id !== responseId) });
}

/** All advanced forms that are published, used for the respondent view. */
export function listPublishedAdvancedForms(userId: string): AdvancedFormDocument[] {
  return listAdvancedForms(userId).filter((form) => form.status === "published");
}
