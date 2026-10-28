export type FormQuestionType =
  | "short_text"
  | "long_text"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "linear_scale"
  | "date"
  | "time"
  | "image_upload";

export interface FormQuestionOption {
  id: string;
  label: string;
  imageAssetId?: string;
}

export interface FormQuestionQuizConfig {
  points: number;
  correctOptionIds: string[];
  acceptedAnswers: string[];
  explanation: string;
}

export interface FormQuestion {
  id: string;
  type: FormQuestionType;
  title: string;
  description: string;
  required: boolean;
  imageAssetId?: string;
  imageAlt?: string;
  options?: FormQuestionOption[];
  scaleMin?: number;
  scaleMax?: number;
  minLabel?: string;
  maxLabel?: string;
  quiz?: FormQuestionQuizConfig;
  points?: number;
}

export type FormThemeAccentColor =
  | "indigo"
  | "blue"
  | "teal"
  | "emerald"
  | "amber"
  | "coral"
  | "rose"
  | "slate";

export type FormThemeBackgroundStyle =
  | "canvas"
  | "light"
  | "medium"
  | "warm";

export type FormPresetHeaderId =
  | "aurora-waves"
  | "botanical-calm"
  | "architectural-grid"
  | "sunset-horizon"
  | "celebration-confetti";

export interface FormThemeSettings {
  accentColor: FormThemeAccentColor;
  backgroundStyle: FormThemeBackgroundStyle;
  presetHeader: FormPresetHeaderId | null;
}

export interface FormSettings {
  defaultRequired: boolean;
  requireSignIn: boolean;
  confirmationMessage: string;
  closedMessage: string;
  theme?: FormThemeSettings;
  quiz: {
    enabled: boolean;
    showScoreImmediately: boolean;
    showCorrectAnswers: boolean;
  };
  eventRegistration: {
    enabled: boolean;
    maxRegistrations: number | null;
    eventDate: string;
    eventLocation: string;
  };
}

export interface FormHeaderImage {
  assetId: string;
  alt: string;
}

export interface FormUploadedImageValue {
  assetId: string;
  name: string;
  type: string;
  size: number;
}

export type FormAnswerValue = string | number | string[] | FormUploadedImageValue;

export interface FormQuizBreakdownEntry {
  correct: boolean;
  earned: number;
  points: number;
  explanation?: string;
  correctOptionIds?: string[];
  acceptedAnswers?: string[];
}

export interface FormQuizResult {
  score: number;
  maxScore: number;
  percentage: number;
  breakdown: Record<string, FormQuizBreakdownEntry>;
}

export const FORM_QUESTION_TYPES: FormQuestionType[];
export const FORM_THEME_COLORS: FormThemeAccentColor[];
export const FORM_THEME_BACKGROUNDS: FormThemeBackgroundStyle[];
export const FORM_PRESET_HEADER_IDS: FormPresetHeaderId[];
export const FORM_LIMITS: {
  formsPerUser: number;
  titleLength: number;
  descriptionLength: number;
  questionsPerForm: number;
  questionTitleLength: number;
  questionDescriptionLength: number;
  optionsPerQuestion: number;
  optionLabelLength: number;
  shortAnswerLength: number;
  longAnswerLength: number;
  maxImageBytes: number;
  confirmationLength: number;
  maxRegistrationsCap: number;
};
export const ALLOWED_FORM_IMAGE_TYPES: Set<string>;
export const BLOCKED_VIDEO_EXTENSIONS: RegExp;

export class FormValidationError extends Error {
  field: string | null;
  status: number;
  constructor(message: string, field?: string | null, status?: number);
}

export function isFormUuid(value: unknown): value is string;
export function cleanFormText(value: unknown, maxLen: number, allowNewlines?: boolean): string;
export function validateFormImageBytes(fileName: string, declaredMime: string, bytes: Uint8Array): string;
export function defaultFormSettings(): FormSettings;
export function normalizeFormSettings(raw: unknown): FormSettings;
export function normalizeHeaderImage(raw: unknown): FormHeaderImage | null;
export function normalizeFormQuestions(rawQuestions: unknown): FormQuestion[];
export function sanitizeQuestionsForRespondent(questions: FormQuestion[], quizEnabled: boolean): FormQuestion[];
export function validateAndScoreSubmission(args: {
  questions: FormQuestion[];
  settings: FormSettings;
  body: Record<string, unknown>;
}): {
  respondentName: string;
  respondentEmail: string;
  answers: Record<string, FormAnswerValue>;
  assetIds: string[];
  quizResult: FormQuizResult | null;
};
export function formatAnswerForDisplay(question: FormQuestion, value: unknown): string;
export function buildFormResponsesCsv(
  form: { questions: FormQuestion[]; settings: FormSettings },
  responses: Array<{
    submittedAt?: string;
    submitted_at?: string;
    respondentName?: string;
    respondent_name?: string;
    respondentEmail?: string;
    respondent_email?: string;
    registrationCode?: string;
    registration_code?: string | null;
    quizResult?: FormQuizResult | null;
    quiz_result?: FormQuizResult | null;
    answers?: Record<string, unknown>;
  }>,
): string;
