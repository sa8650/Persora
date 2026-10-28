// Persora Forms — Functional Form Settings Tab
// Clean Persora Design System alignment with Appearance & Header Theme,
// Public Link Availability, Question Defaults, Quiz Mode, and Event Registration.
import { useState } from "react";
import {
  Award,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Palette,
  RefreshCw,
  Shield,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  FORM_LIMITS,
  buildPublicFormUrl,
  formErrorMessage,
  uploadFormBuilderImage,
  validateClientFormImageFile,
  type FormDetail,
  type FormHeaderImage,
  type FormSettings,
} from "../../lib/forms-api";
import {
  FORM_ACCENT_LIST,
  FORM_ACCENT_SPECS,
  FORM_BACKGROUND_OPTIONS,
  FORM_PRESET_HEADERS,
  resolveFormTheme,
} from "../../lib/form-themes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";

export default function FormSettingsTab({
  form,
  canUpload,
  maxUploadMb,
  onUpgrade,
  notify,
  onChange,
  onRegenerateLink,
}: {
  form: FormDetail;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
  onChange: (patch: {
    headerImage?: FormHeaderImage | null;
    acceptingResponses?: boolean;
    settings?: FormSettings;
  }) => void;
  onRegenerateLink: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  const settings = form.settings;
  const publicUrl = buildPublicFormUrl(form.publicSlug);
  const resolvedTheme = resolveFormTheme(settings);
  const activeAccentSpec = FORM_ACCENT_SPECS[resolvedTheme.accentColor] || FORM_ACCENT_SPECS.indigo;

  const updateSettings = (next: Partial<FormSettings>) => {
    onChange({ settings: { ...settings, ...next } });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify("Public form link copied.");
    } catch {
      notify("Couldn't copy automatically — copy the URL from the field.", "error");
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      await onRegenerateLink();
    } finally {
      setRotating(false);
    }
  };

  const handleCustomHeaderUpload = async (file: File | undefined) => {
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
    setUploadingHeader(true);
    try {
      const asset = await uploadFormBuilderImage(form.id, file);
      onChange({
        headerImage: { assetId: asset.id, alt: form.title },
        settings: {
          ...settings,
          theme: { ...resolvedTheme, presetHeader: null },
        },
      });
      notify("Custom header image uploaded.");
    } catch (err) {
      notify(formErrorMessage(err, "Header upload failed."), "error");
    } finally {
      setUploadingHeader(false);
    }
  };

  return (
    <div className="pf-settings-stack">
      {/* 1. Appearance, Theme Colors & Header Banner */}
      <section className="pf-card pf-settings-section">
        <div className="pf-settings-head">
          <div className="pf-settings-head-left">
            <IconTile variant="soft" size="xs" className="ds-tone-violet">
              <Palette size={14} />
            </IconTile>
            <div>
              <h3>Appearance &amp; header theme</h3>
              <p className="pf-settings-sub">
                Customize the respondent page background, accent color, and header banner.
              </p>
            </div>
          </div>
          <Badge variant="outline" size="xs">
            {activeAccentSpec.label}
          </Badge>
        </div>

        <div className="pf-theme-panel-grid">
          <div className="pf-theme-group">
            <span className="pf-theme-group-label">Theme accent color</span>
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
                    onClick={() =>
                      updateSettings({
                        theme: { ...resolvedTheme, accentColor: item.id },
                      })
                    }
                  >
                    {selected ? <Check size={13} color="#ffffff" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pf-theme-group">
            <span className="pf-theme-group-label">Page background color</span>
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
                    onClick={() =>
                      updateSettings({
                        theme: { ...resolvedTheme, backgroundStyle: bg.id },
                      })
                    }
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

        <div className="pf-theme-group">
          <div className="pf-theme-header-top">
            <span className="pf-theme-group-label">
              Header banner (5 built-in presets + custom image)
            </span>
            {(form.headerImage?.assetId || resolvedTheme.presetHeader) && (
              <button
                type="button"
                className="pf-link-btn"
                onClick={() =>
                  onChange({
                    headerImage: null,
                    settings: {
                      ...settings,
                      theme: { ...resolvedTheme, presetHeader: null },
                    },
                  })
                }
              >
                Remove header image
              </button>
            )}
          </div>

          <div className="pf-preset-headers-grid">
            {FORM_PRESET_HEADERS.map((preset) => {
              const selected =
                !form.headerImage?.assetId && resolvedTheme.presetHeader === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`pf-preset-header-card ${selected ? "is-selected" : ""}`}
                  onClick={() =>
                    onChange({
                      headerImage: null,
                      settings: {
                        ...settings,
                        theme: { ...resolvedTheme, presetHeader: preset.id },
                      },
                    })
                  }
                >
                  <img src={preset.dataUri} alt={preset.label} className="pf-preset-thumb" />
                  <span className="pf-preset-meta">
                    <strong>{preset.label}</strong>
                    <small>{preset.subtitle}</small>
                  </span>
                </button>
              );
            })}

            <label
              className={`pf-preset-header-card pf-custom-upload-tile ${
                form.headerImage?.assetId ? "is-selected" : ""
              }`}
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={uploadingHeader}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  void handleCustomHeaderUpload(f);
                }}
              />
              <span className="pf-custom-upload-art">
                {uploadingHeader ? <Spinner className="size-4" /> : <UploadCloud size={18} />}
              </span>
              <span className="pf-preset-meta">
                <strong>{form.headerImage?.assetId ? "Custom image active" : "Custom upload"}</strong>
                <small>PNG, JPEG, WebP or GIF</small>
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* 2. Responses & Public Link Availability */}
      <section className="pf-card pf-settings-section">
        <div className="pf-settings-head">
          <div className="pf-settings-head-left">
            <IconTile variant="soft" size="xs" className="ds-tone-blue">
              <Globe size={14} />
            </IconTile>
            <div>
              <h3>Responses &amp; public availability</h3>
              <p className="pf-settings-sub">
                Control who can open and submit responses to your public form link.
              </p>
            </div>
          </div>
          <Badge variant={form.status === "published" ? "success-light" : "outline"} size="xs">
            {form.status === "published" ? "Published" : "Draft (Private)"}
          </Badge>
        </div>

        <div className="pf-settings-rows">
          <label className="pf-setting-row">
            <div className="pf-setting-copy">
              <strong>Accepting responses</strong>
              <p>
                When turned off, visitors see your closed message and cannot submit new responses.
              </p>
            </div>
            <Checkbox
              checked={form.acceptingResponses}
              onCheckedChange={(checked) => onChange({ acceptingResponses: Boolean(checked) })}
              aria-label="Accepting responses"
            />
          </label>

          <label className="pf-setting-row">
            <div className="pf-setting-copy">
              <strong>Require Persora sign-in to respond</strong>
              <p>Restrict form submissions and image uploads to signed-in Persora members.</p>
            </div>
            <Checkbox
              checked={settings.requireSignIn}
              onCheckedChange={(checked) => updateSettings({ requireSignIn: Boolean(checked) })}
              aria-label="Require Persora sign-in to respond"
            />
          </label>
        </div>

        <div className="pf-link-box">
          <label className="pf-field-label">
            <span>
              Public respondent link{" "}
              {form.status !== "published" ? "(Publish form to activate)" : ""}
            </span>
          </label>
          <div className="pf-link-controls">
            <input
              type="text"
              readOnly
              value={publicUrl}
              className="pf-input pf-mono-input"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {form.status === "published" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={14} /> Open
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rotating}
              onClick={() => void handleRotate()}
              title="Revoke current public link and generate a new URL"
            >
              {rotating ? <Spinner className="size-3.5" /> : <RefreshCw size={14} />}
              Regenerate link
            </Button>
          </div>
        </div>

        <div className="pf-grid-two">
          <label className="pf-field-label">
            <span>Confirmation message (shown after submission)</span>
            <textarea
              className="pf-textarea"
              rows={2}
              maxLength={FORM_LIMITS.confirmationLength}
              value={settings.confirmationMessage}
              onChange={(e) => updateSettings({ confirmationMessage: e.target.value })}
            />
          </label>

          <label className="pf-field-label">
            <span>Closed form message (shown when not accepting responses)</span>
            <textarea
              className="pf-textarea"
              rows={2}
              maxLength={FORM_LIMITS.confirmationLength}
              value={settings.closedMessage}
              onChange={(e) => updateSettings({ closedMessage: e.target.value })}
            />
          </label>
        </div>
      </section>

      {/* 3. Question Defaults */}
      <section className="pf-card pf-settings-section">
        <div className="pf-settings-head">
          <div className="pf-settings-head-left">
            <IconTile variant="soft" size="xs" className="ds-tone-cyan">
              <Shield size={14} />
            </IconTile>
            <div>
              <h3>Question defaults</h3>
              <p className="pf-settings-sub">Default rules applied when adding new questions.</p>
            </div>
          </div>
        </div>

        <div className="pf-settings-rows">
          <label className="pf-setting-row">
            <div className="pf-setting-copy">
              <strong>Make new questions required by default</strong>
              <p>
                Automatically turns on the Required flag whenever you add a new question in the
                builder.
              </p>
            </div>
            <Checkbox
              checked={settings.defaultRequired}
              onCheckedChange={(checked) => updateSettings({ defaultRequired: Boolean(checked) })}
              aria-label="Make new questions required by default"
            />
          </label>
        </div>
      </section>

      {/* 4. Quiz Mode */}
      <section className="pf-card pf-settings-section">
        <div className="pf-settings-head">
          <div className="pf-settings-head-left">
            <IconTile variant="soft" size="xs" className="ds-tone-amber">
              <Award size={14} />
            </IconTile>
            <div>
              <h3>Quiz mode</h3>
              <p className="pf-settings-sub">
                Auto-grade submissions with point values and optional answer explanations.
              </p>
            </div>
          </div>
          {settings.quiz.enabled && (
            <Badge variant="info-light" size="xs">
              Enabled
            </Badge>
          )}
        </div>

        <div className="pf-settings-rows">
          <label className="pf-setting-row">
            <div className="pf-setting-copy">
              <strong>Make this a scored quiz</strong>
              <p>
                Assign point values, correct options or accepted answers, and explanations to
                questions.
              </p>
            </div>
            <Checkbox
              checked={settings.quiz.enabled}
              onCheckedChange={(checked) =>
                updateSettings({
                  quiz: { ...settings.quiz, enabled: Boolean(checked) },
                })
              }
              aria-label="Make this a scored quiz"
            />
          </label>

          {settings.quiz.enabled && (
            <>
              <label className="pf-setting-row">
                <div className="pf-setting-copy">
                  <strong>Show score immediately after submission</strong>
                  <p>
                    Respondents see their earned points and percentage on the confirmation screen.
                  </p>
                </div>
                <Checkbox
                  checked={settings.quiz.showScoreImmediately}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      quiz: { ...settings.quiz, showScoreImmediately: Boolean(checked) },
                    })
                  }
                  aria-label="Show score immediately after submission"
                />
              </label>

              {settings.quiz.showScoreImmediately && (
                <label className="pf-setting-row">
                  <div className="pf-setting-copy">
                    <strong>Show per-question results &amp; explanations</strong>
                    <p>
                      Display which questions were answered right or wrong along with explanations.
                    </p>
                  </div>
                  <Checkbox
                    checked={settings.quiz.showCorrectAnswers}
                    onCheckedChange={(checked) =>
                      updateSettings({
                        quiz: { ...settings.quiz, showCorrectAnswers: Boolean(checked) },
                      })
                    }
                    aria-label="Show per-question results and explanations"
                  />
                </label>
              )}
            </>
          )}
        </div>
      </section>

      {/* 5. Event Registration Mode */}
      <section className="pf-card pf-settings-section">
        <div className="pf-settings-head">
          <div className="pf-settings-head-left">
            <IconTile variant="soft" size="xs" className="ds-tone-emerald">
              <Users size={14} />
            </IconTile>
            <div>
              <h3>Event registration</h3>
              <p className="pf-settings-sub">
                Issue attendee confirmation codes and enforce registration capacity caps.
              </p>
            </div>
          </div>
          {settings.eventRegistration.enabled && (
            <Badge variant="success-light" size="xs">
              Enabled
            </Badge>
          )}
        </div>

        <div className="pf-settings-rows">
          <label className="pf-setting-row">
            <div className="pf-setting-copy">
              <strong>Enable event registration &amp; attendee pass codes</strong>
              <p>
                Requires attendee name &amp; email, issues a unique confirmation code, and enforces
                capacity limits.
              </p>
            </div>
            <Checkbox
              checked={settings.eventRegistration.enabled}
              onCheckedChange={(checked) =>
                updateSettings({
                  eventRegistration: {
                    ...settings.eventRegistration,
                    enabled: Boolean(checked),
                  },
                })
              }
              aria-label="Enable event registration"
            />
          </label>
        </div>

        {settings.eventRegistration.enabled && (
          <div className="pf-grid-three">
            <label className="pf-field-label">
              <span>Capacity limit (blank = unlimited)</span>
              <input
                type="number"
                min={1}
                max={FORM_LIMITS.maxRegistrationsCap}
                placeholder="Unlimited"
                className="pf-input"
                value={settings.eventRegistration.maxRegistrations ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed =
                    raw === ""
                      ? null
                      : Math.max(
                          1,
                          Math.min(FORM_LIMITS.maxRegistrationsCap, Math.trunc(Number(raw) || 1)),
                        );
                  updateSettings({
                    eventRegistration: {
                      ...settings.eventRegistration,
                      maxRegistrations: parsed,
                    },
                  });
                }}
              />
            </label>

            <label className="pf-field-label">
              <span>Event date (optional)</span>
              <input
                type="date"
                className="pf-input"
                value={settings.eventRegistration.eventDate}
                onChange={(e) =>
                  updateSettings({
                    eventRegistration: {
                      ...settings.eventRegistration,
                      eventDate: e.target.value,
                    },
                  })
                }
              />
            </label>

            <label className="pf-field-label">
              <span>Event location / venue (optional)</span>
              <input
                type="text"
                maxLength={160}
                placeholder="e.g. Dhaka Innovation Hub / Online"
                className="pf-input"
                value={settings.eventRegistration.eventLocation}
                onChange={(e) =>
                  updateSettings({
                    eventRegistration: {
                      ...settings.eventRegistration,
                      eventLocation: e.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
