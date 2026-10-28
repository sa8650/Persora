// Persora Forms — Form Builder
// Supports Google Forms–style Theme & Header customization (8 accent colors,
// 4 background tones, 5 built-in preset header images + custom R2 header image),
// question/option R2 images (image-only, no video), all 9 question types,
// reordering, required toggle, Quiz answer keys, and live respondent preview.
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Award,
  Calendar,
  Check,
  CheckSquare,
  ChevronDownSquare,
  Clock,
  Copy,
  Eye,
  FileText,
  ImagePlus,
  ListTodo,
  Palette,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
  UploadCloud,
  X,
} from "lucide-react";
import {
  FORM_LIMITS,
  createBlankQuestion,
  formErrorMessage,
  uploadFormBuilderImage,
  validateClientFormImageFile,
  type FormDetail,
  type FormHeaderImage,
  type FormQuestion,
  type FormQuestionOption,
  type FormQuestionType,
  type FormSettings,
} from "../../lib/forms-api";
import {
  FORM_ACCENT_LIST,
  FORM_ACCENT_SPECS,
  FORM_BACKGROUND_OPTIONS,
  FORM_PRESET_HEADERS,
  buildFormThemeCssVars,
  getPresetHeaderById,
  resolveFormTheme,
  type FormPresetHeaderSpec,
} from "../../lib/form-themes";
import FormImageAsset from "./FormImageAsset";
import FormRespondentRenderer from "./FormRespondentRenderer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

const QUESTION_TYPE_OPTIONS: Array<{ value: FormQuestionType; label: string; icon: React.ReactNode }> = [
  { value: "short_text", label: "Short answer", icon: <Type size={14} /> },
  { value: "long_text", label: "Long answer", icon: <FileText size={14} /> },
  { value: "multiple_choice", label: "Multiple choice", icon: <ListTodo size={14} /> },
  { value: "checkboxes", label: "Checkboxes", icon: <CheckSquare size={14} /> },
  { value: "dropdown", label: "Dropdown", icon: <ChevronDownSquare size={14} /> },
  { value: "linear_scale", label: "Linear rating / scale", icon: <SlidersHorizontal size={14} /> },
  { value: "date", label: "Date", icon: <Calendar size={14} /> },
  { value: "time", label: "Time", icon: <Clock size={14} /> },
  { value: "image_upload", label: "Image upload (Respondent)", icon: <UploadCloud size={14} /> },
];

export default function FormBuilder({
  form,
  canUpload,
  maxUploadMb,
  onUpgrade,
  notify,
  onChange,
}: {
  form: FormDetail;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
  onChange: (patch: {
    title?: string;
    description?: string;
    headerImage?: FormHeaderImage | null;
    questions?: FormQuestion[];
    settings?: FormSettings;
  }) => void;
}) {
  const [livePreview, setLivePreview] = useState(false);
  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const quizEnabled = form.settings.quiz.enabled;
  const resolvedTheme = resolveFormTheme(form.settings);
  const themeVars = buildFormThemeCssVars(form.settings);
  const activePresetHeader = !form.headerImage?.assetId
    ? getPresetHeaderById(resolvedTheme.presetHeader)
    : null;
  const activeAccentSpec = FORM_ACCENT_SPECS[resolvedTheme.accentColor] || FORM_ACCENT_SPECS.indigo;

  const updateTheme = (patch: Partial<typeof resolvedTheme>, clearCustomHeader = false) => {
    const nextTheme = { ...resolvedTheme, ...patch };
    onChange({
      ...(clearCustomHeader ? { headerImage: null } : {}),
      settings: {
        ...form.settings,
        theme: nextTheme,
      },
    });
  };

  const selectPresetHeader = (preset: FormPresetHeaderSpec) => {
    onChange({
      headerImage: null,
      settings: {
        ...form.settings,
        theme: {
          ...resolvedTheme,
          presetHeader: preset.id,
        },
      },
    });
  };

  const clearAllHeaders = () => {
    onChange({
      headerImage: null,
      settings: {
        ...form.settings,
        theme: {
          ...resolvedTheme,
          presetHeader: null,
        },
      },
    });
  };

  const uploadBuilderImage = async (
    file: File | undefined,
    key: string,
    onDone: (assetId: string) => void,
  ) => {
    if (!file) return;
    if (!canUpload) {
      if (onUpgrade) onUpgrade();
      else notify("Upgrade your storage plan to upload custom images.", "error");
      return;
    }
    const validationErr = validateClientFormImageFile(file, maxUploadMb);
    if (validationErr) {
      notify(validationErr, "error");
      return;
    }
    setUploadingKey(key);
    try {
      const asset = await uploadFormBuilderImage(form.id, file);
      onDone(asset.id);
      notify("Image uploaded.");
    } catch (err) {
      notify(formErrorMessage(err, "Image upload failed."), "error");
    } finally {
      setUploadingKey(null);
    }
  };

  const updateQuestion = (index: number, updater: (q: FormQuestion) => FormQuestion) => {
    const next = form.questions.map((q, i) => (i === index ? updater(q) : q));
    onChange({ questions: next });
  };

  const changeQuestionType = (index: number, nextType: FormQuestionType) => {
    updateQuestion(index, (q) => {
      const needsOpts =
        nextType === "multiple_choice" || nextType === "checkboxes" || nextType === "dropdown";
      const existingOpts =
        q.options && q.options.length >= 1
          ? q.options
          : [
              { id: `${q.id}_opt1`, label: "Option 1" },
              { id: `${q.id}_opt2`, label: "Option 2" },
            ];
      return {
        ...q,
        type: nextType,
        options: needsOpts ? existingOpts : undefined,
        scaleMin: nextType === "linear_scale" ? (q.scaleMin ?? 1) : undefined,
        scaleMax: nextType === "linear_scale" ? (q.scaleMax ?? 5) : undefined,
        minLabel: nextType === "linear_scale" ? (q.minLabel ?? "Low") : undefined,
        maxLabel: nextType === "linear_scale" ? (q.maxLabel ?? "High") : undefined,
      };
    });
  };

  const moveQuestion = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= form.questions.length) return;
    const next = [...form.questions];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange({ questions: next });
  };

  const duplicateQuestion = (index: number) => {
    if (form.questions.length >= FORM_LIMITS.questionsPerForm) {
      notify(`Forms support up to ${FORM_LIMITS.questionsPerForm} questions.`, "error");
      return;
    }
    const src = form.questions[index];
    const newId = `q_${crypto.randomUUID().slice(0, 8)}`;
    const clone: FormQuestion = {
      ...src,
      id: newId,
      title: `${src.title} (copy)`.slice(0, FORM_LIMITS.questionTitleLength),
      options: src.options?.map((o, idx) => ({
        ...o,
        id: `${newId}_opt${idx + 1}`,
      })),
      quiz: src.quiz ? { ...src.quiz, correctOptionIds: [] } : undefined,
    };
    const next = [...form.questions];
    next.splice(index + 1, 0, clone);
    onChange({ questions: next });
  };

  const deleteQuestion = (index: number) => {
    if (form.questions.length <= 1) {
      notify("Keep at least one question in your form.", "error");
      return;
    }
    onChange({ questions: form.questions.filter((_, i) => i !== index) });
  };

  const addQuestion = (type: FormQuestionType = "short_text") => {
    if (form.questions.length >= FORM_LIMITS.questionsPerForm) {
      notify(`Forms support up to ${FORM_LIMITS.questionsPerForm} questions.`, "error");
      return;
    }
    onChange({
      questions: [...form.questions, createBlankQuestion(type, form.settings.defaultRequired)],
    });
  };

  const updateOption = (qIndex: number, optIndex: number, patch: Partial<FormQuestionOption>) => {
    updateQuestion(qIndex, (q) => ({
      ...q,
      options: (q.options || []).map((opt, idx) => (idx === optIndex ? { ...opt, ...patch } : opt)),
    }));
  };

  const addOption = (qIndex: number) => {
    updateQuestion(qIndex, (q) => {
      const opts = q.options || [];
      if (opts.length >= FORM_LIMITS.optionsPerQuestion) return q;
      const optId = `${q.id}_opt_${Math.random().toString(36).slice(2, 7)}`;
      return {
        ...q,
        options: [...opts, { id: optId, label: `Option ${opts.length + 1}` }],
      };
    });
  };

  const removeOption = (qIndex: number, optIndex: number) => {
    updateQuestion(qIndex, (q) => {
      const opts = q.options || [];
      if (opts.length <= 1) return q;
      const removed = opts[optIndex];
      return {
        ...q,
        options: opts.filter((_, i) => i !== optIndex),
        quiz: q.quiz
          ? {
              ...q.quiz,
              correctOptionIds: (q.quiz.correctOptionIds || []).filter((id) => id !== removed.id),
            }
          : undefined,
      };
    });
  };

  const toggleQuizCorrectOption = (qIndex: number, optId: string, singleChoice: boolean) => {
    updateQuestion(qIndex, (q) => {
      const currentQuiz = q.quiz || {
        points: 1,
        correctOptionIds: [],
        acceptedAnswers: [],
        explanation: "",
      };
      const currentIds = currentQuiz.correctOptionIds || [];
      const nextIds = singleChoice
        ? currentIds.includes(optId)
          ? []
          : [optId]
        : currentIds.includes(optId)
          ? currentIds.filter((id) => id !== optId)
          : [...currentIds, optId];
      return {
        ...q,
        quiz: { ...currentQuiz, correctOptionIds: nextIds },
      };
    });
  };

  return (
    <div className="pf-builder-layout">
      <div className="pf-builder-toolbar">
        <div className="pf-builder-toolbar-left">
          <Badge variant="outline" size="xs">
            {form.questions.length} {form.questions.length === 1 ? "question" : "questions"}
          </Badge>
          {quizEnabled && (
            <Badge variant="info-light" size="xs">
              <Award size={11} aria-hidden="true" /> Quiz scoring active
            </Badge>
          )}
          <span className="pf-theme-summary-pill">
            <span
              className="pf-theme-dot"
              style={{ background: activeAccentSpec.accent }}
              aria-hidden="true"
            />
            <span>{activeAccentSpec.label}</span>
          </span>
        </div>

        <div className="pf-builder-toolbar-right">
          <Button
            type="button"
            variant={themeDrawerOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setThemeDrawerOpen((v) => !v)}
            aria-expanded={themeDrawerOpen}
          >
            <Palette size={14} /> Customize theme
          </Button>

          <Button
            type="button"
            variant={livePreview ? "default" : "outline"}
            size="sm"
            onClick={() => setLivePreview((v) => !v)}
          >
            <Eye size={14} />
            {livePreview ? "Back to editor" : "Respondent preview"}
          </Button>
        </div>
      </div>

      {/* Google Forms–style Theme & Header Customizer Panel */}
      {themeDrawerOpen && (
        <section className="pf-card pf-theme-panel" aria-label="Customize form theme and header">
          <div className="pf-theme-panel-head">
            <div className="pf-inline-head-title">
              <Palette size={16} aria-hidden="true" />
              <h3>Theme, background &amp; header image</h3>
            </div>
            <button
              type="button"
              className="pf-icon-btn"
              onClick={() => setThemeDrawerOpen(false)}
              aria-label="Close theme customizer"
            >
              <X size={15} />
            </button>
          </div>

          <div className="pf-theme-panel-grid">
            {/* Accent Color Swatches */}
            <div className="pf-theme-group">
              <span className="pf-theme-group-label">Theme color</span>
              <div className="pf-color-swatch-row" role="radiogroup" aria-label="Theme accent color">
                {FORM_ACCENT_LIST.map((item) => {
                  const selected = resolvedTheme.accentColor === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={item.label}
                      title={item.label}
                      className={`pf-color-swatch ${selected ? "is-selected" : ""}`}
                      style={{ background: item.accent }}
                      onClick={() => updateTheme({ accentColor: item.id })}
                    >
                      {selected ? <Check size={13} color="#ffffff" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Background Surface Tints */}
            <div className="pf-theme-group">
              <span className="pf-theme-group-label">Page background</span>
              <div className="pf-bg-tone-row" role="radiogroup" aria-label="Form background tone">
                {FORM_BACKGROUND_OPTIONS.map((bg) => {
                  const selected = resolvedTheme.backgroundStyle === bg.id;
                  const swatchBg =
                    bg.id === "light"
                      ? activeAccentSpec.lightBg
                      : bg.id === "medium"
                        ? activeAccentSpec.mediumBg
                        : bg.id === "warm"
                          ? "#f6f5f1"
                          : "#ffffff";
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`pf-bg-tone-chip ${selected ? "is-selected" : ""}`}
                      onClick={() => updateTheme({ backgroundStyle: bg.id })}
                    >
                      <span
                        className="pf-bg-tone-swatch"
                        style={{ background: swatchBg }}
                        aria-hidden="true"
                      />
                      <span>{bg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5 Preset Header Images + Custom R2 Header Upload */}
          <div className="pf-theme-group">
            <div className="pf-theme-header-top">
              <span className="pf-theme-group-label">
                Header image (choose from 5 presets or upload custom)
              </span>
              {(form.headerImage?.assetId || resolvedTheme.presetHeader) && (
                <button type="button" className="pf-link-btn" onClick={clearAllHeaders}>
                  Remove header image
                </button>
              )}
            </div>

            <div className="pf-preset-headers-grid">
              {FORM_PRESET_HEADERS.map((preset) => {
                const isSelected =
                  !form.headerImage?.assetId && resolvedTheme.presetHeader === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`pf-preset-header-card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => selectPresetHeader(preset)}
                  >
                    <img src={preset.dataUri} alt={preset.label} className="pf-preset-thumb" />
                    <span className="pf-preset-meta">
                      <strong>{preset.label}</strong>
                      <small>{preset.subtitle}</small>
                    </span>
                  </button>
                );
              })}

              {/* 6th Tile: Custom Image Upload */}
              <label
                className={`pf-preset-header-card pf-custom-upload-tile ${
                  form.headerImage?.assetId ? "is-selected" : ""
                }`}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploadingKey === "header"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    void uploadBuilderImage(f, "header", (assetId) => {
                      onChange({
                        headerImage: { assetId, alt: form.title },
                        settings: {
                          ...form.settings,
                          theme: { ...resolvedTheme, presetHeader: null },
                        },
                      });
                    });
                  }}
                />
                <span className="pf-custom-upload-art">
                  {uploadingKey === "header" ? (
                    <Spinner className="size-4" />
                  ) : (
                    <UploadCloud size={18} />
                  )}
                </span>
                <span className="pf-preset-meta">
                  <strong>{form.headerImage?.assetId ? "Custom image active" : "Custom upload"}</strong>
                  <small>PNG, JPEG, WebP or GIF</small>
                </span>
              </label>
            </div>
          </div>
        </section>
      )}

      {livePreview ? (
        <div className="pf-preview-frame pf-themed-surface" style={themeVars}>
          <FormRespondentRenderer
            title={form.title}
            description={form.description}
            headerImage={form.headerImage}
            theme={resolvedTheme}
            questions={form.questions.map((q) => ({
              ...q,
              points: quizEnabled ? (q.quiz?.points ?? 0) : undefined,
            }))}
            quizEnabled={quizEnabled}
            eventRegistration={{
              enabled: form.settings.eventRegistration.enabled,
              maxRegistrations: form.settings.eventRegistration.maxRegistrations,
              spotsRemaining:
                form.settings.eventRegistration.maxRegistrations !== null
                  ? Math.max(
                      0,
                      form.settings.eventRegistration.maxRegistrations - form.responseCount,
                    )
                  : null,
              eventDate: form.settings.eventRegistration.eventDate,
              eventLocation: form.settings.eventRegistration.eventLocation,
            }}
            formId={form.id}
            previewMode={true}
            maxUploadMb={maxUploadMb}
            onSubmit={() => {
              notify("Preview tested! Publish your form to collect real responses.");
            }}
          />
        </div>
      ) : (
        <div className="pf-builder-canvas pf-themed-surface" style={themeVars}>
          <div className="pf-builder-stack">
            {/* Header Banner (Custom R2 OR Preset SVG) */}
            {form.headerImage?.assetId ? (
              <div className="pf-builder-banner-wrap">
                <FormImageAsset
                  assetId={form.headerImage.assetId}
                  formId={form.id}
                  alt={form.headerImage.alt || "Form header banner"}
                  className="pf-header-banner-img"
                />
                <div className="pf-builder-banner-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => setThemeDrawerOpen(true)}
                  >
                    <Palette size={12} /> Change banner
                  </Button>
                  <Button type="button" variant="secondary" size="xs" onClick={clearAllHeaders}>
                    <Trash2 size={12} /> Remove
                  </Button>
                </div>
              </div>
            ) : activePresetHeader ? (
              <div className="pf-builder-banner-wrap">
                <img
                  src={activePresetHeader.dataUri}
                  alt={activePresetHeader.label}
                  className="pf-header-banner-img"
                />
                <div className="pf-builder-banner-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => setThemeDrawerOpen(true)}
                  >
                    <Palette size={12} /> Change banner
                  </Button>
                  <Button type="button" variant="secondary" size="xs" onClick={clearAllHeaders}>
                    <Trash2 size={12} /> Remove
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Form Title & Description Card */}
            <div className="pf-card pf-form-meta-card">
              {!form.headerImage?.assetId && !activePresetHeader && (
                <div className="pf-header-upload-bar">
                  <button
                    type="button"
                    className="pf-inline-upload-btn"
                    onClick={() => setThemeDrawerOpen(true)}
                  >
                    <Palette size={14} />
                    <span>Choose preset or custom header image</span>
                  </button>
                  <label className="pf-inline-upload-btn">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      disabled={uploadingKey === "header"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void uploadBuilderImage(f, "header", (assetId) => {
                          onChange({
                            headerImage: { assetId, alt: form.title },
                            settings: {
                              ...form.settings,
                              theme: { ...resolvedTheme, presetHeader: null },
                            },
                          });
                        });
                      }}
                    />
                    {uploadingKey === "header" ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <ImagePlus size={14} />
                    )}
                    <span>Upload image</span>
                  </label>
                  <span className="pf-upload-note">5 presets + custom PNG, JPEG, WebP, GIF</span>
                </div>
              )}

              <div className="pf-form-meta-fields">
                <label className="pf-field-label">
                  <span>Form title</span>
                  <input
                    type="text"
                    className="pf-input pf-title-input"
                    maxLength={FORM_LIMITS.titleLength}
                    placeholder="Untitled form"
                    value={form.title}
                    onChange={(e) => onChange({ title: e.target.value })}
                  />
                </label>

                <label className="pf-field-label">
                  <span>Description (optional)</span>
                  <textarea
                    className="pf-textarea"
                    rows={2}
                    maxLength={FORM_LIMITS.descriptionLength}
                    placeholder="Explain the purpose of this form, instructions, or context…"
                    value={form.description}
                    onChange={(e) => onChange({ description: e.target.value })}
                  />
                </label>
              </div>
            </div>

            {/* Question Cards */}
            {form.questions.map((question, qIndex) => {
              const hasOptions =
                question.type === "multiple_choice" ||
                question.type === "checkboxes" ||
                question.type === "dropdown";

              return (
                <article key={question.id} className="pf-card pf-builder-q-card">
                  <div className="pf-builder-q-top">
                    <span className="pf-q-badge">Question {qIndex + 1}</span>
                    <div className="pf-builder-q-order">
                      <button
                        type="button"
                        className="pf-icon-btn"
                        onClick={() => moveQuestion(qIndex, -1)}
                        disabled={qIndex === 0}
                        aria-label={`Move question ${qIndex + 1} up`}
                        title="Move up"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="pf-icon-btn"
                        onClick={() => moveQuestion(qIndex, 1)}
                        disabled={qIndex === form.questions.length - 1}
                        aria-label={`Move question ${qIndex + 1} down`}
                        title="Move down"
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="pf-icon-btn"
                        onClick={() => duplicateQuestion(qIndex)}
                        aria-label={`Duplicate question ${qIndex + 1}`}
                        title="Duplicate question"
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        type="button"
                        className="pf-icon-btn is-danger"
                        onClick={() => deleteQuestion(qIndex)}
                        disabled={form.questions.length <= 1}
                        aria-label={`Delete question ${qIndex + 1}`}
                        title="Delete question"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="pf-builder-q-row">
                    <input
                      type="text"
                      className="pf-input pf-q-title-input"
                      maxLength={FORM_LIMITS.questionTitleLength}
                      placeholder="Question prompt"
                      value={question.title}
                      onChange={(e) =>
                        updateQuestion(qIndex, (q) => ({ ...q, title: e.target.value }))
                      }
                      aria-label={`Question ${qIndex + 1} title`}
                    />

                    <select
                      className="pf-select pf-q-type-select"
                      value={question.type}
                      onChange={(e) =>
                        changeQuestionType(qIndex, e.target.value as FormQuestionType)
                      }
                      aria-label={`Question ${qIndex + 1} type`}
                    >
                      {QUESTION_TYPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <input
                    type="text"
                    className="pf-input pf-q-desc-input"
                    maxLength={FORM_LIMITS.questionDescriptionLength}
                    placeholder="Optional helper description or instructions…"
                    value={question.description}
                    onChange={(e) =>
                      updateQuestion(qIndex, (q) => ({ ...q, description: e.target.value }))
                    }
                    aria-label={`Question ${qIndex + 1} description`}
                  />

                  {/* Question Image */}
                  {question.imageAssetId ? (
                    <div className="pf-q-image-preview">
                      <FormImageAsset
                        assetId={question.imageAssetId}
                        formId={form.id}
                        alt={question.imageAlt || question.title}
                        className="pf-question-img"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          updateQuestion(qIndex, (q) => ({
                            ...q,
                            imageAssetId: undefined,
                            imageAlt: undefined,
                          }))
                        }
                      >
                        <X size={13} /> Remove image
                      </Button>
                    </div>
                  ) : null}

                  {/* Type-specific Builder Body */}
                  {hasOptions && (
                    <div className="pf-options-editor">
                      {(question.options || []).map((opt, optIdx) => {
                        const isCorrect = Boolean(question.quiz?.correctOptionIds?.includes(opt.id));
                        return (
                          <div key={opt.id} className="pf-option-edit-block">
                            <div className="pf-option-edit-row">
                              <span className="pf-opt-bullet" aria-hidden="true">
                                {question.type === "multiple_choice"
                                  ? "○"
                                  : question.type === "checkboxes"
                                    ? "☐"
                                    : `${optIdx + 1}.`}
                              </span>
                              <input
                                type="text"
                                className="pf-input"
                                maxLength={FORM_LIMITS.optionLabelLength}
                                value={opt.label}
                                onChange={(e) =>
                                  updateOption(qIndex, optIdx, { label: e.target.value })
                                }
                                aria-label={`Option ${optIdx + 1}`}
                              />

                              {quizEnabled && (
                                <button
                                  type="button"
                                  className={`pf-correct-pill ${isCorrect ? "is-correct" : ""}`}
                                  onClick={() =>
                                    toggleQuizCorrectOption(
                                      qIndex,
                                      opt.id,
                                      question.type !== "checkboxes",
                                    )
                                  }
                                  title="Mark as correct quiz answer"
                                >
                                  {isCorrect ? "✓ Correct" : "Mark correct"}
                                </button>
                              )}

                              {(question.type === "multiple_choice" ||
                                question.type === "checkboxes") && (
                                <label className="pf-icon-btn" title="Attach image to option">
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    className="sr-only"
                                    disabled={uploadingKey === `opt:${opt.id}`}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      void uploadBuilderImage(f, `opt:${opt.id}`, (assetId) => {
                                        updateOption(qIndex, optIdx, { imageAssetId: assetId });
                                      });
                                    }}
                                  />
                                  {uploadingKey === `opt:${opt.id}` ? (
                                    <Spinner className="size-3.5" />
                                  ) : (
                                    <ImagePlus size={14} />
                                  )}
                                </label>
                              )}

                              <button
                                type="button"
                                className="pf-icon-btn"
                                disabled={(question.options || []).length <= 1}
                                onClick={() => removeOption(qIndex, optIdx)}
                                aria-label={`Remove option ${optIdx + 1}`}
                              >
                                <X size={14} />
                              </button>
                            </div>

                            {opt.imageAssetId && (
                              <div className="pf-opt-img-preview">
                                <FormImageAsset
                                  assetId={opt.imageAssetId}
                                  formId={form.id}
                                  alt={opt.label}
                                  className="pf-option-img"
                                />
                                <button
                                  type="button"
                                  className="pf-link-btn"
                                  onClick={() =>
                                    updateOption(qIndex, optIdx, { imageAssetId: undefined })
                                  }
                                >
                                  Remove option image
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => addOption(qIndex)}
                        disabled={(question.options || []).length >= FORM_LIMITS.optionsPerQuestion}
                      >
                        <Plus size={13} /> Add option
                      </Button>
                    </div>
                  )}

                  {question.type === "linear_scale" && (
                    <div className="pf-scale-builder">
                      <div className="pf-scale-range-row">
                        <label>
                          <span>Min</span>
                          <select
                            className="pf-select"
                            value={question.scaleMin ?? 1}
                            onChange={(e) =>
                              updateQuestion(qIndex, (q) => ({
                                ...q,
                                scaleMin: Number(e.target.value),
                              }))
                            }
                          >
                            <option value={0}>0</option>
                            <option value={1}>1</option>
                          </select>
                        </label>
                        <span>to</span>
                        <label>
                          <span>Max</span>
                          <select
                            className="pf-select"
                            value={question.scaleMax ?? 5}
                            onChange={(e) =>
                              updateQuestion(qIndex, (q) => ({
                                ...q,
                                scaleMax: Number(e.target.value),
                              }))
                            }
                          >
                            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="pf-grid-two">
                        <input
                          type="text"
                          className="pf-input"
                          placeholder="Min label (e.g. Not likely)"
                          maxLength={80}
                          value={question.minLabel || ""}
                          onChange={(e) =>
                            updateQuestion(qIndex, (q) => ({ ...q, minLabel: e.target.value }))
                          }
                        />
                        <input
                          type="text"
                          className="pf-input"
                          placeholder="Max label (e.g. Extremely likely)"
                          maxLength={80}
                          value={question.maxLabel || ""}
                          onChange={(e) =>
                            updateQuestion(qIndex, (q) => ({ ...q, maxLabel: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {question.type === "image_upload" && (
                    <div className="pf-readonly-hint">
                      <span>
                        Respondents can upload one verified image (PNG, JPEG, WebP, or GIF up to 10
                        MB). Video uploads are blocked.
                      </span>
                      {!canUpload && (
                        <div className="pf-upload-plan-note">
                          File uploads require an active storage plan.{" "}
                          {onUpgrade ? (
                            <button type="button" className="pf-link-btn" onClick={onUpgrade}>
                              Upgrade plan
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quiz Configuration for Question */}
                  {quizEnabled && (
                    <div className="pf-quiz-builder-box">
                      <div className="pf-quiz-builder-row">
                        <span className="pf-quiz-label">
                          <Award size={13} aria-hidden="true" /> Quiz answer key
                        </span>
                        <label className="pf-points-field">
                          <span>Points</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="pf-input pf-points-input"
                            value={question.quiz?.points ?? 1}
                            onChange={(e) =>
                              updateQuestion(qIndex, (q) => ({
                                ...q,
                                quiz: {
                                  points: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                  correctOptionIds: q.quiz?.correctOptionIds || [],
                                  acceptedAnswers: q.quiz?.acceptedAnswers || [],
                                  explanation: q.quiz?.explanation || "",
                                },
                              }))
                            }
                          />
                        </label>
                      </div>

                      {(question.type === "short_text" || question.type === "linear_scale") && (
                        <label className="pf-field-label">
                          <span>Accepted correct answer(s) (comma-separated, case-insensitive)</span>
                          <input
                            type="text"
                            className="pf-input"
                            placeholder={
                              question.type === "linear_scale"
                                ? "e.g. 5"
                                : "e.g. Dhaka, Bangladesh"
                            }
                            value={(question.quiz?.acceptedAnswers || []).join(", ")}
                            onChange={(e) => {
                              const list = e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean);
                              updateQuestion(qIndex, (q) => ({
                                ...q,
                                quiz: {
                                  points: q.quiz?.points ?? 1,
                                  correctOptionIds: q.quiz?.correctOptionIds || [],
                                  acceptedAnswers: list,
                                  explanation: q.quiz?.explanation || "",
                                },
                              }));
                            }}
                          />
                        </label>
                      )}

                      <input
                        type="text"
                        className="pf-input"
                        placeholder="Optional answer explanation shown after submission…"
                        value={question.quiz?.explanation || ""}
                        onChange={(e) =>
                          updateQuestion(qIndex, (q) => ({
                            ...q,
                            quiz: {
                              points: q.quiz?.points ?? 1,
                              correctOptionIds: q.quiz?.correctOptionIds || [],
                              acceptedAnswers: q.quiz?.acceptedAnswers || [],
                              explanation: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  )}

                  <footer className="pf-builder-q-foot">
                    {!question.imageAssetId ? (
                      <label className="pf-inline-upload-btn">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="sr-only"
                          disabled={uploadingKey === `q:${question.id}`}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            void uploadBuilderImage(f, `q:${question.id}`, (assetId) => {
                              updateQuestion(qIndex, (q) => ({ ...q, imageAssetId: assetId }));
                            });
                          }}
                        />
                        {uploadingKey === `q:${question.id}` ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <ImagePlus size={14} />
                        )}
                        <span>Add question image</span>
                      </label>
                    ) : (
                      <span />
                    )}

                    <label className="pf-required-toggle">
                      <Checkbox
                        checked={question.required}
                        onCheckedChange={(checked) =>
                          updateQuestion(qIndex, (q) => ({ ...q, required: Boolean(checked) }))
                        }
                      />
                      <span>Required</span>
                    </label>
                  </footer>
                </article>
              );
            })}

            {/* Add Question Bar */}
            <div className="pf-add-question-bar">
              <Button type="button" onClick={() => addQuestion("short_text")}>
                <Plus size={15} /> Add question
              </Button>
              <div className="pf-quick-type-chips">
                {QUESTION_TYPE_OPTIONS.slice(1).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="pf-chip-btn"
                    onClick={() => addQuestion(item.value)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
