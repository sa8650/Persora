// Persora Forms — Standalone browser client for /api/forms/* and /api/public/forms/*.
// Deliberately isolated from Persora Table and Google Sheets.
import {
  ALLOWED_FORM_IMAGE_TYPES,
  BLOCKED_VIDEO_EXTENSIONS,
  FORM_LIMITS,
  FORM_QUESTION_TYPES,
  defaultFormSettings,
  formatAnswerForDisplay,
  type FormAnswerValue,
  type FormHeaderImage,
  type FormQuestion,
  type FormQuestionOption,
  type FormQuestionQuizConfig,
  type FormQuestionType,
  type FormQuizResult,
  type FormSettings,
  type FormThemeSettings,
  type FormUploadedImageValue,
} from "../../cloudflare/forms-rules.js";
import { PagesApiError, pagesApiJson, pagesApiRequest, uploadMultipart } from "./cloud";
import type { TransferProgress } from "../types";

export {
  ALLOWED_FORM_IMAGE_TYPES,
  BLOCKED_VIDEO_EXTENSIONS,
  FORM_LIMITS,
  FORM_QUESTION_TYPES,
  defaultFormSettings,
  formatAnswerForDisplay,
};
export type {
  FormAnswerValue,
  FormHeaderImage,
  FormQuestion,
  FormQuestionOption,
  FormQuestionQuizConfig,
  FormQuestionType,
  FormQuizResult,
  FormSettings,
  FormThemeSettings,
  FormUploadedImageValue,
};

export type FormStatus = "draft" | "published";

export interface FormSummary {
  id: string;
  title: string;
  description: string;
  status: FormStatus;
  acceptingResponses: boolean;
  publicSlug: string;
  questionCount: number;
  responseCount: number;
  quizEnabled: boolean;
  eventEnabled: boolean;
  maxRegistrations: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface FormDetail extends FormSummary {
  headerImage: FormHeaderImage | null;
  questions: FormQuestion[];
  settings: FormSettings;
}

export interface FormAssetMeta {
  id: string;
  role: "builder_image" | "response_image";
  name: string;
  type: string;
  size: number;
  createdAt?: string;
}

export interface FormDetailEnvelope {
  form: FormDetail;
  assets: FormAssetMeta[];
}

export interface FormResponseEntry {
  id: string;
  respondentName: string;
  respondentEmail: string;
  answers: Record<string, FormAnswerValue>;
  quizResult: FormQuizResult | null;
  registrationCode: string | null;
  submittedAt: string;
  assets: Array<{ id: string; name: string; type: string; size: number }>;
}

export interface FormResponsesPayload {
  responseCount: number;
  acceptingResponses: boolean;
  responses: FormResponseEntry[];
}

export interface PublicFormPayload {
  form: {
    title: string;
    description: string;
    acceptingResponses: boolean;
    closedReason: "closed" | "capacity_full" | null;
    closedMessage: string | null;
    requireSignIn: boolean;
    signedIn: boolean;
    headerImage: FormHeaderImage | null;
    theme?: FormThemeSettings;
    questions: FormQuestion[];
    quizEnabled: boolean;
    eventRegistration: {
      enabled: boolean;
      maxRegistrations: number | null;
      spotsRemaining: number | null;
      eventDate: string;
      eventLocation: string;
    };
  };
}

export interface PublicFormSubmitResult {
  ok: true;
  submittedAt: string;
  confirmationMessage: string;
  registrationCode: string | null;
  quizResult: {
    score: number;
    maxScore: number;
    percentage: number;
    breakdown?: FormQuizResult["breakdown"];
  } | null;
}

const formPath = (formId: string) => `/forms/${encodeURIComponent(formId)}`;
const publicFormPath = (slug: string) => `/public/forms/${encodeURIComponent(slug)}`;

const jsonInit = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

export function buildPublicFormUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://persora.app";
  return `${origin}/Form/${encodeURIComponent(slug)}`;
}

/** Client-side pre-flight check matching server-side R2 image-only enforcement. */
export function validateClientFormImageFile(file: File, maxUploadMb = 10): string | null {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  if (mime.startsWith("video/") || BLOCKED_VIDEO_EXTENSIONS.test(name)) {
    return "Video uploads are not supported in Persora Forms. Upload a PNG, JPEG, WebP, or GIF image instead.";
  }
  if (!file.size) {
    return "The selected image file is empty.";
  }
  if (mime && !ALLOWED_FORM_IMAGE_TYPES.has(mime)) {
    return "Unsupported file format. Upload a PNG, JPEG, WebP, or GIF image.";
  }
  if (!mime && !/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return "Unsupported file format. Upload a PNG, JPEG, WebP, or GIF image.";
  }
  const capMb = Math.max(1, Math.min(10, maxUploadMb || 10));
  if (file.size > Math.min(FORM_LIMITS.maxImageBytes, capMb * 1024 * 1024)) {
    return `Images must be ${capMb} MB or smaller.`;
  }
  return null;
}

export function createBlankQuestion(type: FormQuestionType = "short_text", required = false): FormQuestion {
  const id = `q_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
  const needsOptions = type === "multiple_choice" || type === "checkboxes" || type === "dropdown";
  return {
    id,
    type,
    title:
      type === "short_text" ? "Short answer question"
      : type === "long_text" ? "Detailed response"
      : type === "multiple_choice" ? "Choose one option"
      : type === "checkboxes" ? "Select all that apply"
      : type === "dropdown" ? "Select from list"
      : type === "linear_scale" ? "How would you rate this?"
      : type === "date" ? "Preferred date"
      : type === "time" ? "Preferred time"
      : "Upload an image",
    description: "",
    required,
    ...(needsOptions
      ? {
          options: [
            { id: `${id}_opt1`, label: "Option 1" },
            { id: `${id}_opt2`, label: "Option 2" },
          ],
        }
      : {}),
    ...(type === "linear_scale"
      ? {
          scaleMin: 1,
          scaleMax: 5,
          minLabel: "Low",
          maxLabel: "High",
        }
      : {}),
    quiz: {
      points: 1,
      correctOptionIds: [],
      acceptedAnswers: [],
      explanation: "",
    },
  };
}

// ---- Authenticated Owner Endpoints ------------------------------------------

export async function listForms(signal?: AbortSignal): Promise<FormSummary[]> {
  const res = await pagesApiJson<{ forms: FormSummary[] }>("/forms", { signal });
  return res.forms;
}

export async function createForm(payload: {
  title?: string;
  description?: string;
  questions?: FormQuestion[];
  settings?: Partial<FormSettings>;
}): Promise<FormDetailEnvelope> {
  return pagesApiJson<FormDetailEnvelope>("/forms", jsonInit("POST", payload));
}

export async function getForm(formId: string, signal?: AbortSignal): Promise<FormDetailEnvelope> {
  return pagesApiJson<FormDetailEnvelope>(formPath(formId), { signal });
}

export async function saveForm(
  formId: string,
  payload: {
    title?: string;
    description?: string;
    status?: FormStatus;
    acceptingResponses?: boolean;
    headerImage?: FormHeaderImage | null;
    questions?: FormQuestion[];
    settings?: FormSettings;
    regenerateLink?: boolean;
  },
): Promise<FormDetailEnvelope> {
  return pagesApiJson<FormDetailEnvelope>(formPath(formId), jsonInit("PUT", payload));
}

export async function deleteForm(formId: string): Promise<void> {
  await pagesApiJson<{ ok: true }>(formPath(formId), { method: "DELETE" });
}

export async function duplicateForm(formId: string, title?: string): Promise<FormDetailEnvelope> {
  return pagesApiJson<FormDetailEnvelope>(`${formPath(formId)}/duplicate`, jsonInit("POST", title ? { title } : {}));
}

export async function listFormResponses(formId: string, signal?: AbortSignal): Promise<FormResponsesPayload> {
  return pagesApiJson<FormResponsesPayload>(`${formPath(formId)}/responses`, { signal });
}

export async function downloadFormResponsesCsv(formId: string, fallbackTitle = "form"): Promise<void> {
  const response = await pagesApiRequest(`${formPath(formId)}/responses?format=csv`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safe = fallbackTitle.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "form";
  anchor.download = `${safe}-responses.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function deleteFormResponse(formId: string, responseId: string): Promise<void> {
  await pagesApiJson<{ ok: true }>(`${formPath(formId)}/responses/${encodeURIComponent(responseId)}`, {
    method: "DELETE",
  });
}

export async function uploadFormBuilderImage(
  formId: string,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
): Promise<FormAssetMeta> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await uploadMultipart<{ asset: FormAssetMeta }>(
    `${formPath(formId)}/assets`,
    formData,
    onProgress,
  );
  return res.asset;
}

export async function fetchFormAssetBlobUrl(formId: string, assetId: string): Promise<string> {
  const response = await pagesApiRequest(`${formPath(formId)}/assets/${encodeURIComponent(assetId)}`);
  return URL.createObjectURL(await response.blob());
}

// ---- Public Respondent Endpoints --------------------------------------------

export async function getPublicForm(slug: string, signal?: AbortSignal): Promise<PublicFormPayload> {
  return pagesApiJson<PublicFormPayload>(publicFormPath(slug), { signal });
}

export async function fetchPublicFormAssetBlobUrl(slug: string, assetId: string): Promise<string> {
  const response = await pagesApiRequest(`${publicFormPath(slug)}/assets/${encodeURIComponent(assetId)}`);
  return URL.createObjectURL(await response.blob());
}

export async function uploadPublicFormResponseImage(
  slug: string,
  file: File,
  onProgress?: (progress: TransferProgress) => void,
): Promise<FormAssetMeta> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await uploadMultipart<{ asset: FormAssetMeta }>(
    `${publicFormPath(slug)}/upload`,
    formData,
    onProgress,
  );
  return res.asset;
}

export async function submitPublicFormResponse(
  slug: string,
  payload: {
    respondentName?: string;
    respondentEmail?: string;
    answers: Record<string, FormAnswerValue>;
  },
): Promise<PublicFormSubmitResult> {
  return pagesApiJson<PublicFormSubmitResult>(`${publicFormPath(slug)}/submit`, jsonInit("POST", payload));
}

export function formErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PagesApiError && error.message) return error.message;
  if (error instanceof Error && !(error instanceof TypeError) && error.name !== "AbortError" && error.message) {
    return error.message;
  }
  return fallback;
}
