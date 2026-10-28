// Persora Forms — Standalone validation, question normalization, quiz scoring,
// image-only media inspection, and CSV export helpers.
// Strictly isolated from Persora Table and Google Sheets.

export const FORM_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "linear_scale",
  "date",
  "time",
  "image_upload",
];

export const FORM_LIMITS = {
  formsPerUser: 200,
  titleLength: 160,
  descriptionLength: 4000,
  questionsPerForm: 80,
  questionTitleLength: 300,
  questionDescriptionLength: 1000,
  optionsPerQuestion: 40,
  optionLabelLength: 200,
  shortAnswerLength: 500,
  longAnswerLength: 5000,
  maxImageBytes: 10 * 1024 * 1024, // 10 MB cap for form images
  confirmationLength: 600,
  maxRegistrationsCap: 10000,
};

export const ALLOWED_FORM_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const BLOCKED_VIDEO_EXTENSIONS = /\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv|3gp|ogv|mpeg|mpg|ts)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class FormValidationError extends Error {
  constructor(message, field = null, status = 400) {
    super(message);
    this.name = "FormValidationError";
    this.field = field;
    this.status = status;
  }
}

export const isFormUuid = (value) => typeof value === "string" && UUID_RE.test(value);

export function cleanFormText(value, maxLen, allowNewlines = false) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n");
  const stripped = allowNewlines
    ? normalized.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    : normalized.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return stripped.slice(0, maxLen);
}

/**
 * Inspects file metadata AND magic header bytes to guarantee only genuine
 * raster images (JPEG, PNG, WebP, GIF) are accepted and video files are blocked.
 */
export function validateFormImageBytes(fileName, declaredMime, bytes) {
  const name = String(fileName || "").trim();
  const mime = String(declaredMime || "").toLowerCase().trim();
  if (mime.startsWith("video/") || BLOCKED_VIDEO_EXTENSIONS.test(name)) {
    throw new FormValidationError(
      "Video uploads are not supported in Persora Forms. Upload a PNG, JPEG, WebP, or GIF image instead.",
      "file",
      415,
    );
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
    throw new FormValidationError("Choose a valid PNG, JPEG, WebP, or GIF image file.", "file", 415);
  }
  // Check ISO BMFF 'ftyp' (MP4/MOV) or EBML (WebM/MKV) disguised as image
  if (
    (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) ||
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
  ) {
    throw new FormValidationError(
      "Video files cannot be uploaded to Persora Forms. Upload a PNG, JPEG, WebP, or GIF image.",
      "file",
      415,
    );
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF87a / GIF89a
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  throw new FormValidationError(
    "Unsupported file format. Persora Forms only accepts PNG, JPEG, WebP, and GIF images (no videos or documents).",
    "file",
    415,
  );
}

export const FORM_THEME_COLORS = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "amber",
  "coral",
  "rose",
  "slate",
];

export const FORM_THEME_BACKGROUNDS = [
  "canvas",
  "light",
  "medium",
  "warm",
];

export const FORM_PRESET_HEADER_IDS = [
  "aurora-waves",
  "botanical-calm",
  "architectural-grid",
  "sunset-horizon",
  "celebration-confetti",
];

export function defaultFormSettings() {
  return {
    defaultRequired: false,
    requireSignIn: false,
    confirmationMessage: "Thank you — your response has been recorded.",
    closedMessage: "This form is no longer accepting responses.",
    theme: {
      accentColor: "indigo",
      backgroundStyle: "light",
      presetHeader: null,
    },
    quiz: {
      enabled: false,
      showScoreImmediately: true,
      showCorrectAnswers: false,
    },
    eventRegistration: {
      enabled: false,
      maxRegistrations: null,
      eventDate: "",
      eventLocation: "",
    },
  };
}

export function normalizeFormSettings(raw) {
  const base = defaultFormSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const confirmationMessage = cleanFormText(raw.confirmationMessage ?? base.confirmationMessage, FORM_LIMITS.confirmationLength, true).trim() || base.confirmationMessage;
  const closedMessage = cleanFormText(raw.closedMessage ?? base.closedMessage, FORM_LIMITS.confirmationLength, true).trim() || base.closedMessage;

  const themeRaw = raw.theme && typeof raw.theme === "object" ? raw.theme : {};
  const accentColor = FORM_THEME_COLORS.includes(String(themeRaw.accentColor || ""))
    ? String(themeRaw.accentColor)
    : base.theme.accentColor;
  const backgroundStyle = FORM_THEME_BACKGROUNDS.includes(String(themeRaw.backgroundStyle || ""))
    ? String(themeRaw.backgroundStyle)
    : base.theme.backgroundStyle;
  const presetHeader = FORM_PRESET_HEADER_IDS.includes(String(themeRaw.presetHeader || ""))
    ? String(themeRaw.presetHeader)
    : null;

  const quizRaw = raw.quiz && typeof raw.quiz === "object" ? raw.quiz : {};
  const eventRaw = raw.eventRegistration && typeof raw.eventRegistration === "object" ? raw.eventRegistration : {};

  let maxRegistrations = null;
  if (eventRaw.maxRegistrations !== null && eventRaw.maxRegistrations !== undefined && eventRaw.maxRegistrations !== "") {
    const parsed = Number(eventRaw.maxRegistrations);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > FORM_LIMITS.maxRegistrationsCap) {
      throw new FormValidationError(`Registration capacity must be a whole number between 1 and ${FORM_LIMITS.maxRegistrationsCap}.`, "maxRegistrations");
    }
    maxRegistrations = parsed;
  }

  return {
    defaultRequired: Boolean(raw.defaultRequired),
    requireSignIn: Boolean(raw.requireSignIn),
    confirmationMessage,
    closedMessage,
    theme: {
      accentColor,
      backgroundStyle,
      presetHeader,
    },
    quiz: {
      enabled: Boolean(quizRaw.enabled),
      showScoreImmediately: quizRaw.showScoreImmediately !== false,
      showCorrectAnswers: Boolean(quizRaw.showCorrectAnswers),
    },
    eventRegistration: {
      enabled: Boolean(eventRaw.enabled),
      maxRegistrations,
      eventDate: DATE_RE.test(String(eventRaw.eventDate || "")) ? String(eventRaw.eventDate) : "",
      eventLocation: cleanFormText(eventRaw.eventLocation ?? "", 160).trim(),
    },
  };
}

export function normalizeHeaderImage(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isFormUuid(raw.assetId)) return null;
  return {
    assetId: raw.assetId,
    alt: cleanFormText(raw.alt ?? "", 160).trim(),
  };
}

export function normalizeFormQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) throw new FormValidationError("Questions must be a list.");
  if (rawQuestions.length > FORM_LIMITS.questionsPerForm) {
    throw new FormValidationError(`A form can have at most ${FORM_LIMITS.questionsPerForm} questions.`);
  }
  const seenIds = new Set();
  return rawQuestions.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new FormValidationError(`Question ${index + 1} is invalid.`);
    const id = String(raw.id || "").trim();
    if (!LOCAL_ID_RE.test(id) || seenIds.has(id)) {
      throw new FormValidationError(`Question ${index + 1} has an invalid or duplicate id.`);
    }
    seenIds.add(id);
    const type = String(raw.type || "");
    if (!FORM_QUESTION_TYPES.includes(type)) {
      if (type.includes("video")) {
        throw new FormValidationError("Video questions are not supported in Persora Forms.");
      }
      throw new FormValidationError(`Question ${index + 1} uses an unsupported question type.`);
    }
    const title = cleanFormText(raw.title ?? "", FORM_LIMITS.questionTitleLength).trim() || `Untitled question ${index + 1}`;
    const description = cleanFormText(raw.description ?? "", FORM_LIMITS.questionDescriptionLength, true).trim();
    const required = Boolean(raw.required);
    const imageAssetId = isFormUuid(raw.imageAssetId) ? raw.imageAssetId : null;
    const imageAlt = cleanFormText(raw.imageAlt ?? "", 160).trim();

    let options = [];
    if (type === "multiple_choice" || type === "checkboxes" || type === "dropdown") {
      const rawOpts = Array.isArray(raw.options) ? raw.options : [];
      if (rawOpts.length < 1 || rawOpts.length > FORM_LIMITS.optionsPerQuestion) {
        throw new FormValidationError(`"${title}" needs between 1 and ${FORM_LIMITS.optionsPerQuestion} answer options.`);
      }
      const seenOptIds = new Set();
      options = rawOpts.map((opt, optIdx) => {
        const optId = String(opt?.id || `opt_${optIdx + 1}`).trim();
        if (!LOCAL_ID_RE.test(optId) || seenOptIds.has(optId)) {
          throw new FormValidationError(`"${title}" has duplicate option ids.`);
        }
        seenOptIds.add(optId);
        const label = cleanFormText(opt?.label ?? "", FORM_LIMITS.optionLabelLength).trim() || `Option ${optIdx + 1}`;
        const optAssetId = isFormUuid(opt?.imageAssetId) ? opt.imageAssetId : null;
        return {
          id: optId,
          label,
          ...(optAssetId ? { imageAssetId: optAssetId } : {}),
        };
      });
    }

    let scaleMin = 1;
    let scaleMax = 5;
    let minLabel = "";
    let maxLabel = "";
    if (type === "linear_scale") {
      scaleMin = Number(raw.scaleMin) === 0 ? 0 : 1;
      const parsedMax = Number(raw.scaleMax ?? 5);
      if (!Number.isInteger(parsedMax) || parsedMax < 2 || parsedMax > 10) {
        throw new FormValidationError(`"${title}" scale maximum must be between 2 and 10.`);
      }
      scaleMax = parsedMax;
      minLabel = cleanFormText(raw.minLabel ?? "", 60).trim();
      maxLabel = cleanFormText(raw.maxLabel ?? "", 60).trim();
    }

    // Quiz configuration per question
    let quiz = null;
    if (raw.quiz && typeof raw.quiz === "object") {
      const points = Math.max(0, Math.min(100, Math.trunc(Number(raw.quiz.points) || 0)));
      const validOptIds = new Set(options.map((o) => o.id));
      const correctOptionIds = Array.isArray(raw.quiz.correctOptionIds)
        ? raw.quiz.correctOptionIds
            .map((v) => String(v))
            .filter((v) => (type === "linear_scale" ? Number.isInteger(Number(v)) && Number(v) >= scaleMin && Number(v) <= scaleMax : validOptIds.has(v)))
        : [];
      const acceptedAnswers = Array.isArray(raw.quiz.acceptedAnswers)
        ? raw.quiz.acceptedAnswers.map((v) => cleanFormText(String(v || ""), 200).trim()).filter(Boolean).slice(0, 10)
        : [];
      const explanation = cleanFormText(raw.quiz.explanation ?? "", 400, true).trim();
      quiz = { points, correctOptionIds, acceptedAnswers, explanation };
    }

    return {
      id,
      type,
      title,
      description,
      required,
      ...(imageAssetId ? { imageAssetId, imageAlt } : {}),
      ...(options.length ? { options } : {}),
      ...(type === "linear_scale" ? { scaleMin, scaleMax, minLabel, maxLabel } : {}),
      ...(quiz ? { quiz } : {}),
    };
  });
}

/** Strips quiz answer keys so public respondents cannot inspect answers before submitting. */
export function sanitizeQuestionsForRespondent(questions, quizEnabled) {
  return (Array.isArray(questions) ? questions : []).map((q) => {
    const { quiz, ...rest } = q;
    if (quizEnabled && quiz && Number(quiz.points) > 0) {
      return { ...rest, points: Number(quiz.points) };
    }
    return rest;
  });
}

/**
 * Validates respondent answers against form schema + event registration rules,
 * collects R2 response image asset IDs, and calculates quiz scores if enabled.
 */
export function validateAndScoreSubmission({ questions, settings, body }) {
  const normalizedSettings = normalizeFormSettings(settings);
  const rawAnswers = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
  let respondentName = cleanFormText(body?.respondentName ?? "", 160).trim();
  let respondentEmail = cleanFormText(body?.respondentEmail ?? "", 254).trim().toLowerCase();

  if (normalizedSettings.eventRegistration.enabled) {
    if (!respondentName) {
      throw new FormValidationError("Enter your full name to register.", "respondentName");
    }
    if (!respondentEmail || !EMAIL_RE.test(respondentEmail)) {
      throw new FormValidationError("Enter a valid email address for registration.", "respondentEmail");
    }
  } else if (respondentEmail && !EMAIL_RE.test(respondentEmail)) {
    throw new FormValidationError("Enter a valid email address.", "respondentEmail");
  }

  const cleanedAnswers = {};
  const assetIds = [];

  for (const question of questions) {
    const rawVal = rawAnswers[question.id];
    const type = question.type;

    if (type === "short_text" || type === "long_text") {
      const maxLen = type === "short_text" ? FORM_LIMITS.shortAnswerLength : FORM_LIMITS.longAnswerLength;
      const text = cleanFormText(typeof rawVal === "string" ? rawVal : "", maxLen, type === "long_text").trim();
      if (question.required && !text) {
        throw new FormValidationError(`Please answer "${question.title}".`, question.id);
      }
      if (text) cleanedAnswers[question.id] = text;
      continue;
    }

    if (type === "multiple_choice" || type === "dropdown") {
      const choice = typeof rawVal === "string" ? rawVal.trim() : "";
      const validIds = new Set((question.options || []).map((o) => o.id));
      if (!choice) {
        if (question.required) throw new FormValidationError(`Please choose an option for "${question.title}".`, question.id);
        continue;
      }
      if (!validIds.has(choice)) {
        throw new FormValidationError(`Choose a valid option for "${question.title}".`, question.id);
      }
      cleanedAnswers[question.id] = choice;
      continue;
    }

    if (type === "checkboxes") {
      const arr = Array.isArray(rawVal) ? [...new Set(rawVal.map((v) => String(v).trim()).filter(Boolean))] : [];
      const validIds = new Set((question.options || []).map((o) => o.id));
      if (!arr.length) {
        if (question.required) throw new FormValidationError(`Select at least one option for "${question.title}".`, question.id);
        continue;
      }
      if (arr.some((id) => !validIds.has(id))) {
        throw new FormValidationError(`Choose valid options for "${question.title}".`, question.id);
      }
      cleanedAnswers[question.id] = arr;
      continue;
    }

    if (type === "linear_scale") {
      if (rawVal === null || rawVal === undefined || rawVal === "") {
        if (question.required) throw new FormValidationError(`Select a rating for "${question.title}".`, question.id);
        continue;
      }
      const num = Number(rawVal);
      const min = question.scaleMin === 0 ? 0 : 1;
      const max = Number(question.scaleMax) || 5;
      if (!Number.isInteger(num) || num < min || num > max) {
        throw new FormValidationError(`Choose a rating between ${min} and ${max} for "${question.title}".`, question.id);
      }
      cleanedAnswers[question.id] = num;
      continue;
    }

    if (type === "date") {
      const val = typeof rawVal === "string" ? rawVal.trim() : "";
      if (!val) {
        if (question.required) throw new FormValidationError(`Select a date for "${question.title}".`, question.id);
        continue;
      }
      if (!DATE_RE.test(val)) throw new FormValidationError(`Enter a valid date (YYYY-MM-DD) for "${question.title}".`, question.id);
      cleanedAnswers[question.id] = val;
      continue;
    }

    if (type === "time") {
      const val = typeof rawVal === "string" ? rawVal.trim() : "";
      if (!val) {
        if (question.required) throw new FormValidationError(`Select a time for "${question.title}".`, question.id);
        continue;
      }
      if (!TIME_RE.test(val)) throw new FormValidationError(`Enter a valid time (HH:MM) for "${question.title}".`, question.id);
      cleanedAnswers[question.id] = val;
      continue;
    }

    if (type === "image_upload") {
      if (!rawVal || typeof rawVal !== "object" || !rawVal.assetId) {
        if (question.required) throw new FormValidationError(`Upload an image for "${question.title}".`, question.id);
        continue;
      }
      if (!isFormUuid(rawVal.assetId)) {
        throw new FormValidationError(`The uploaded image for "${question.title}" is invalid.`, question.id);
      }
      const mime = String(rawVal.type || "").toLowerCase();
      if (!ALLOWED_FORM_IMAGE_TYPES.has(mime)) {
        throw new FormValidationError("Only PNG, JPEG, WebP, and GIF images are allowed (no video files).", question.id, 415);
      }
      assetIds.push(rawVal.assetId);
      cleanedAnswers[question.id] = {
        assetId: rawVal.assetId,
        name: cleanFormText(rawVal.name ?? "image", 200).trim() || "image",
        type: mime,
        size: Math.max(1, Number(rawVal.size) || 1),
      };
    }
  }

  let quizResult = null;
  if (normalizedSettings.quiz.enabled) {
    let score = 0;
    let maxScore = 0;
    const breakdown = {};
    for (const q of questions) {
      const pts = Math.max(0, Number(q.quiz?.points) || 0);
      if (!pts) continue;
      maxScore += pts;
      const ans = cleanedAnswers[q.id];
      let correct = false;
      const correctIds = Array.isArray(q.quiz?.correctOptionIds) ? q.quiz.correctOptionIds : [];
      const accepted = Array.isArray(q.quiz?.acceptedAnswers) ? q.quiz.acceptedAnswers : [];

      if ((q.type === "multiple_choice" || q.type === "dropdown") && correctIds.length > 0) {
        correct = typeof ans === "string" && correctIds.includes(ans);
      } else if (q.type === "checkboxes" && correctIds.length > 0) {
        const expected = [...new Set(correctIds)].sort();
        const actual = Array.isArray(ans) ? [...new Set(ans)].sort() : [];
        correct = expected.length === actual.length && expected.every((v, i) => v === actual[i]);
      } else if (q.type === "linear_scale" && correctIds.length > 0) {
        correct = ans !== undefined && correctIds.includes(String(ans));
      } else if (q.type === "short_text" && accepted.length > 0) {
        const normalizedAns = typeof ans === "string" ? ans.trim().toLowerCase() : "";
        correct = Boolean(normalizedAns) && accepted.some((candidate) => candidate.trim().toLowerCase() === normalizedAns);
      }

      const earned = correct ? pts : 0;
      score += earned;
      breakdown[q.id] = {
        correct,
        earned,
        points: pts,
        ...(q.quiz?.explanation ? { explanation: q.quiz.explanation } : {}),
        ...(correctIds.length ? { correctOptionIds: correctIds } : {}),
        ...(accepted.length ? { acceptedAnswers: accepted } : {}),
      };
    }
    quizResult = {
      score,
      maxScore,
      percentage: maxScore > 0 ? Math.round((score / maxScore) * 100) : 100,
      breakdown,
    };
  }

  return {
    respondentName,
    respondentEmail,
    answers: cleanedAnswers,
    assetIds: [...new Set(assetIds)],
    quizResult,
  };
}

export function formatAnswerForDisplay(question, value) {
  if (value === null || value === undefined || value === "") return "";
  if (question.type === "multiple_choice" || question.type === "dropdown") {
    const match = (question.options || []).find((o) => o.id === value);
    return match ? match.label : String(value);
  }
  if (question.type === "checkboxes" && Array.isArray(value)) {
    const byId = new Map((question.options || []).map((o) => [o.id, o.label]));
    return value.map((id) => byId.get(id) || String(id)).join("; ");
  }
  if (question.type === "image_upload" && typeof value === "object") {
    return value.name ? `[Image: ${value.name}]` : "[Image uploaded]";
  }
  return String(value);
}

function csvCell(value) {
  const str = String(value ?? "");
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function buildFormResponsesCsv(form, responses) {
  const questions = Array.isArray(form?.questions) ? form.questions : [];
  const eventEnabled = Boolean(form?.settings?.eventRegistration?.enabled);
  const quizEnabled = Boolean(form?.settings?.quiz?.enabled);

  const headers = ["Submitted At"];
  if (eventEnabled) headers.push("Registrant Name", "Registrant Email", "Registration Code");
  if (quizEnabled) headers.push("Quiz Score", "Max Score", "Score %");
  for (const q of questions) headers.push(q.title || q.id);

  const lines = [headers.map(csvCell).join(",")];
  for (const resp of Array.isArray(responses) ? responses : []) {
    const row = [resp.submittedAt || resp.submitted_at || ""];
    if (eventEnabled) {
      row.push(
        resp.respondentName ?? resp.respondent_name ?? "",
        resp.respondentEmail ?? resp.respondent_email ?? "",
        resp.registrationCode ?? resp.registration_code ?? "",
      );
    }
    if (quizEnabled) {
      const qr = resp.quizResult || resp.quiz_result;
      row.push(qr ? qr.score : "", qr ? qr.maxScore : "", qr ? `${qr.percentage}%` : "");
    }
    const answers = resp.answers || {};
    for (const q of questions) {
      row.push(formatAnswerForDisplay(q, answers[q.id]));
    }
    lines.push(row.map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
