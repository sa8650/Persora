// Shared Respondent Form Renderer — powers both the Form Builder Live Preview
// and the standalone Public Form Respondent Page (/Form/:slug).
import { useState } from "react";
import { Award, Calendar, CheckCircle2, MapPin, Trash2, UploadCloud, Users } from "lucide-react";
import {
  validateClientFormImageFile,
  type FormAnswerValue,
  type FormHeaderImage,
  type FormQuestion,
  type FormThemeSettings,
  type FormUploadedImageValue,
} from "../../lib/forms-api";
import { getPresetHeaderById } from "../../lib/form-themes";
import FormImageAsset from "./FormImageAsset";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

export interface RespondentEventBanner {
  enabled: boolean;
  maxRegistrations: number | null;
  spotsRemaining?: number | null;
  eventDate: string;
  eventLocation: string;
}

export default function FormRespondentRenderer({
  title,
  description,
  headerImage,
  theme,
  questions,
  quizEnabled = false,
  eventRegistration,
  formId,
  publicSlug,
  previewMode = false,
  submitting = false,
  maxUploadMb = 10,
  initialName = "",
  initialEmail = "",
  onUploadImage,
  onSubmit,
}: {
  title: string;
  description: string;
  headerImage: FormHeaderImage | null;
  theme?: FormThemeSettings | null;
  questions: FormQuestion[];
  quizEnabled?: boolean;
  eventRegistration?: RespondentEventBanner;
  formId?: string;
  publicSlug?: string;
  previewMode?: boolean;
  submitting?: boolean;
  maxUploadMb?: number;
  initialName?: string;
  initialEmail?: string;
  onUploadImage?: (file: File) => Promise<{ id: string; name: string; type: string; size: number }>;
  onSubmit: (payload: {
    respondentName: string;
    respondentEmail: string;
    answers: Record<string, FormAnswerValue>;
  }) => Promise<void> | void;
}) {
  const [respondentName, setRespondentName] = useState(initialName);
  const [respondentEmail, setRespondentEmail] = useState(initialEmail);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [previewSubmitted, setPreviewSubmitted] = useState(false);

  const eventOn = Boolean(eventRegistration?.enabled);
  const presetHeader = !headerImage?.assetId ? getPresetHeaderById(theme?.presetHeader) : null;

  const setAnswer = (qId: string, val: FormAnswerValue | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (val === undefined) delete next[qId];
      else next[qId] = val;
      return next;
    });
    setFieldErrors((prev) => {
      if (!prev[qId]) return prev;
      const next = { ...prev };
      delete next[qId];
      return next;
    });
  };

  const toggleCheckboxOption = (qId: string, optId: string) => {
    const current = Array.isArray(answers[qId]) ? (answers[qId] as string[]) : [];
    const next = current.includes(optId) ? current.filter((x) => x !== optId) : [...current, optId];
    setAnswer(qId, next.length ? next : undefined);
  };

  const handleImagePick = async (question: FormQuestion, file: File | undefined) => {
    if (!file) return;
    const validationError = validateClientFormImageFile(file, maxUploadMb);
    if (validationError) {
      setFieldErrors((prev) => ({ ...prev, [question.id]: validationError }));
      return;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });

    if (previewMode || !onUploadImage) {
      const previewUrl = URL.createObjectURL(file);
      setLocalPreviews((prev) => ({ ...prev, [question.id]: previewUrl }));
      setAnswer(question.id, {
        assetId: "00000000-0000-4000-8000-000000000000",
        name: file.name,
        type: file.type || "image/png",
        size: file.size,
      });
      return;
    }

    setUploadingQuestionId(question.id);
    try {
      const previewUrl = URL.createObjectURL(file);
      const uploaded = await onUploadImage(file);
      setLocalPreviews((prev) => ({ ...prev, [question.id]: previewUrl }));
      setAnswer(question.id, {
        assetId: uploaded.id,
        name: uploaded.name,
        type: uploaded.type,
        size: uploaded.size,
      });
    } catch (err) {
      setFieldErrors((prev) => ({
        ...prev,
        [question.id]: err instanceof Error ? err.message : "Image upload failed.",
      }));
    } finally {
      setUploadingQuestionId(null);
    }
  };

  const clearUploadedImage = (qId: string) => {
    const existingUrl = localPreviews[qId];
    if (existingUrl) URL.revokeObjectURL(existingUrl);
    setLocalPreviews((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
    setAnswer(qId, undefined);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};

    if (eventOn) {
      if (!respondentName.trim()) {
        errors.__respondentName = "Enter your full name to register.";
      }
      if (!respondentEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail.trim())) {
        errors.__respondentEmail = "Enter a valid email address for registration.";
      }
    } else if (respondentEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail.trim())) {
      errors.__respondentEmail = "Enter a valid email address.";
    }

    for (const q of questions) {
      const val = answers[q.id];
      const empty =
        val === undefined ||
        val === null ||
        (typeof val === "string" && val.trim() === "") ||
        (Array.isArray(val) && val.length === 0);
      if (q.required && empty) {
        errors[q.id] = `Please complete “${q.title}”.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please review the highlighted required fields before submitting.");
      return;
    }

    if (previewMode) {
      setPreviewSubmitted(true);
      await onSubmit({ respondentName, respondentEmail, answers });
      return;
    }

    try {
      await onSubmit({
        respondentName: respondentName.trim(),
        respondentEmail: respondentEmail.trim(),
        answers,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Your response could not be submitted.");
    }
  };

  const clearForm = () => {
    Object.values(localPreviews).forEach((u) => URL.revokeObjectURL(u));
    setLocalPreviews({});
    setAnswers({});
    setFieldErrors({});
    setFormError(null);
    setPreviewSubmitted(false);
  };

  if (previewMode && previewSubmitted) {
    return (
      <div className="pf-respondent-card pf-confirmation-card" role="status">
        <CheckCircle2 size={32} className="pf-confirm-icon" aria-hidden="true" />
        <h2>Preview response validated</h2>
        <p>
          All required fields passed validation. Because this is a builder preview, no response was saved to your database.
        </p>
        <div className="pf-confirm-actions">
          <Button type="button" variant="outline" onClick={clearForm}>
            Reset preview form
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="pf-respondent-stack" onSubmit={(e) => void handleFormSubmit(e)} noValidate>
      {headerImage?.assetId ? (
        <div className="pf-header-banner">
          <FormImageAsset
            assetId={headerImage.assetId}
            formId={formId}
            publicSlug={publicSlug}
            alt={headerImage.alt || `${title} banner`}
            className="pf-header-banner-img"
          />
        </div>
      ) : presetHeader ? (
        <div className="pf-header-banner">
          <img
            src={presetHeader.dataUri}
            alt={presetHeader.label}
            className="pf-header-banner-img"
          />
        </div>
      ) : null}

      <div className="pf-respondent-card pf-respondent-hero">
        <div className="pf-respondent-badges">
          {quizEnabled && (
            <Badge variant="info-light" size="xs">
              <Award size={11} aria-hidden="true" /> Scored quiz
            </Badge>
          )}
          {eventOn && (
            <Badge variant="success-light" size="xs">
              <Users size={11} aria-hidden="true" /> Event registration
            </Badge>
          )}
          {eventOn && typeof eventRegistration?.spotsRemaining === "number" && (
            <Badge variant="outline" size="xs">
              {eventRegistration.spotsRemaining}{" "}
              {eventRegistration.spotsRemaining === 1 ? "spot" : "spots"} remaining
            </Badge>
          )}
          {previewMode && (
            <Badge variant="warning-light" size="xs">
              Live preview (not saved)
            </Badge>
          )}
        </div>

        <h1 className="pf-respondent-title">{title || "Untitled form"}</h1>
        {description ? <p className="pf-respondent-desc">{description}</p> : null}

        {eventOn && (eventRegistration?.eventDate || eventRegistration?.eventLocation) && (
          <div className="pf-event-meta-bar">
            {eventRegistration.eventDate && (
              <span>
                <Calendar size={13} aria-hidden="true" /> {eventRegistration.eventDate}
              </span>
            )}
            {eventRegistration.eventLocation && (
              <span>
                <MapPin size={13} aria-hidden="true" /> {eventRegistration.eventLocation}
              </span>
            )}
          </div>
        )}

        {questions.some((q) => q.required) || eventOn ? (
          <div className="pf-required-legend">* Indicates required question</div>
        ) : null}
      </div>

      {eventOn && (
        <div className="pf-respondent-card pf-question-card">
          <div className="pf-question-head">
            <h3 className="pf-question-title">Attendee registration details</h3>
            <p className="pf-question-desc">
              Required to reserve your spot and issue your confirmation code.
            </p>
          </div>
          <div className="pf-grid-two">
            <label className="pf-field-label">
              <span>
                Full name <span className="pf-req">*</span>
              </span>
              <input
                type="text"
                className="pf-input"
                placeholder="Your full name"
                value={respondentName}
                onChange={(e) => {
                  setRespondentName(e.target.value);
                  setFieldErrors((p) => {
                    const n = { ...p };
                    delete n.__respondentName;
                    return n;
                  });
                }}
                aria-invalid={Boolean(fieldErrors.__respondentName)}
              />
              {fieldErrors.__respondentName && (
                <span className="pf-field-error">{fieldErrors.__respondentName}</span>
              )}
            </label>
            <label className="pf-field-label">
              <span>
                Email address <span className="pf-req">*</span>
              </span>
              <input
                type="email"
                className="pf-input"
                placeholder="you@example.com"
                value={respondentEmail}
                onChange={(e) => {
                  setRespondentEmail(e.target.value);
                  setFieldErrors((p) => {
                    const n = { ...p };
                    delete n.__respondentEmail;
                    return n;
                  });
                }}
                aria-invalid={Boolean(fieldErrors.__respondentEmail)}
              />
              {fieldErrors.__respondentEmail && (
                <span className="pf-field-error">{fieldErrors.__respondentEmail}</span>
              )}
            </label>
          </div>
        </div>
      )}

      {questions.map((question, idx) => {
        const val = answers[question.id];
        const err = fieldErrors[question.id];
        const scaleMin = question.scaleMin ?? 1;
        const scaleMax = question.scaleMax ?? 5;
        const scaleSteps: number[] = [];
        if (question.type === "linear_scale") {
          for (let n = scaleMin; n <= scaleMax; n += 1) scaleSteps.push(n);
        }
        const uploadedImage =
          question.type === "image_upload" && val && typeof val === "object" && !Array.isArray(val)
            ? (val as FormUploadedImageValue)
            : null;

        return (
          <div
            key={question.id}
            className={`pf-respondent-card pf-question-card ${err ? "has-error" : ""}`}
          >
            <div className="pf-question-head">
              <div className="pf-question-title-row">
                <h3 className="pf-question-title">
                  <span className="pf-question-num">{idx + 1}.</span> {question.title}
                  {question.required && (
                    <span className="pf-req" title="Required">
                      {" "}
                      *
                    </span>
                  )}
                </h3>
                {quizEnabled && typeof question.points === "number" && question.points > 0 && (
                  <Badge variant="outline" size="xs">
                    {question.points} {question.points === 1 ? "pt" : "pts"}
                  </Badge>
                )}
              </div>
              {question.description ? <p className="pf-question-desc">{question.description}</p> : null}
            </div>

            {question.imageAssetId && (
              <div className="pf-question-media">
                <FormImageAsset
                  assetId={question.imageAssetId}
                  formId={formId}
                  publicSlug={publicSlug}
                  alt={question.imageAlt || question.title}
                  className="pf-question-img"
                />
              </div>
            )}

            <div className="pf-question-control">
              {question.type === "short_text" && (
                <input
                  type="text"
                  className="pf-input"
                  placeholder="Your answer"
                  maxLength={500}
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => setAnswer(question.id, e.target.value)}
                  aria-label={question.title}
                />
              )}

              {question.type === "long_text" && (
                <textarea
                  className="pf-textarea"
                  rows={4}
                  placeholder="Write your response…"
                  maxLength={5000}
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => setAnswer(question.id, e.target.value)}
                  aria-label={question.title}
                />
              )}

              {question.type === "multiple_choice" && (
                <div className="pf-choice-list" role="radiogroup" aria-label={question.title}>
                  {(question.options || []).map((opt) => {
                    const selected = val === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`pf-choice-option ${selected ? "is-selected" : ""}`}
                      >
                        <div className="pf-choice-row">
                          <input
                            type="radio"
                            name={`pf_mc_${question.id}`}
                            checked={selected}
                            onChange={() => setAnswer(question.id, opt.id)}
                          />
                          <span>{opt.label}</span>
                        </div>
                        {opt.imageAssetId && (
                          <FormImageAsset
                            assetId={opt.imageAssetId}
                            formId={formId}
                            publicSlug={publicSlug}
                            alt={opt.label}
                            className="pf-option-img"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              {question.type === "checkboxes" && (
                <div className="pf-choice-list" role="group" aria-label={question.title}>
                  {(question.options || []).map((opt) => {
                    const checked = Array.isArray(val) && val.includes(opt.id);
                    return (
                      <label
                        key={opt.id}
                        className={`pf-choice-option ${checked ? "is-selected" : ""}`}
                      >
                        <div className="pf-choice-row">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleCheckboxOption(question.id, opt.id)}
                          />
                          <span>{opt.label}</span>
                        </div>
                        {opt.imageAssetId && (
                          <FormImageAsset
                            assetId={opt.imageAssetId}
                            formId={formId}
                            publicSlug={publicSlug}
                            alt={opt.label}
                            className="pf-option-img"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              {question.type === "dropdown" && (
                <select
                  className="pf-select"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => setAnswer(question.id, e.target.value || undefined)}
                  aria-label={question.title}
                >
                  <option value="">Choose an option…</option>
                  {(question.options || []).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {question.type === "linear_scale" && (
                <div className="pf-scale-wrap" role="radiogroup" aria-label={question.title}>
                  {question.minLabel ? <span className="pf-scale-end">{question.minLabel}</span> : null}
                  <div className="pf-scale-buttons">
                    {scaleSteps.map((step) => {
                      const active = val === step;
                      return (
                        <button
                          key={step}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`pf-scale-btn ${active ? "is-selected" : ""}`}
                          onClick={() => setAnswer(question.id, step)}
                        >
                          {step}
                        </button>
                      );
                    })}
                  </div>
                  {question.maxLabel ? <span className="pf-scale-end">{question.maxLabel}</span> : null}
                </div>
              )}

              {question.type === "date" && (
                <input
                  type="date"
                  className="pf-input pf-input-narrow"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => setAnswer(question.id, e.target.value || undefined)}
                  aria-label={question.title}
                />
              )}

              {question.type === "time" && (
                <input
                  type="time"
                  className="pf-input pf-input-narrow"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => setAnswer(question.id, e.target.value || undefined)}
                  aria-label={question.title}
                />
              )}

              {question.type === "image_upload" && (
                <div className="pf-upload-zone">
                  {uploadedImage ? (
                    <div className="pf-uploaded-preview">
                      <FormImageAsset
                        assetId={uploadedImage.assetId}
                        formId={formId}
                        publicSlug={publicSlug}
                        localPreviewUrl={localPreviews[question.id]}
                        alt={uploadedImage.name}
                        className="pf-uploaded-thumb"
                      />
                      <div className="pf-uploaded-meta">
                        <strong>{uploadedImage.name}</strong>
                        <span>
                          {Math.max(1, Math.round(uploadedImage.size / 1024))} KB · Image verified
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => clearUploadedImage(question.id)}
                      >
                        <Trash2 size={14} /> Remove
                      </Button>
                    </div>
                  ) : (
                    <label className="pf-upload-drop">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        disabled={uploadingQuestionId === question.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          void handleImagePick(question, f);
                        }}
                      />
                      {uploadingQuestionId === question.id ? (
                        <>
                          <Spinner className="size-4" />
                          <span>Uploading image…</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={18} aria-hidden="true" />
                          <span>
                            <strong>Upload an image</strong> (PNG, JPEG, WebP, or GIF · up to{" "}
                            {Math.min(10, maxUploadMb)} MB · no video)
                          </span>
                        </>
                      )}
                    </label>
                  )}
                </div>
              )}
            </div>

            {err && (
              <div className="pf-field-error" role="alert">
                {err}
              </div>
            )}
          </div>
        );
      })}

      {formError && (
        <div className="pf-banner-error" role="alert">
          {formError}
        </div>
      )}

      <div className="pf-respondent-footer">
        <button
          type="submit"
          className="pf-submit-btn"
          disabled={submitting || Boolean(uploadingQuestionId)}
        >
          {submitting ? (
            <>
              <Spinner className="size-3.5" /> Submitting…
            </>
          ) : previewMode ? (
            "Test submit preview"
          ) : eventOn ? (
            "Complete registration"
          ) : (
            "Submit response"
          )}
        </button>

        <Button type="button" variant="ghost" onClick={clearForm} disabled={submitting}>
          Clear form
        </Button>
      </div>
    </form>
  );
}
