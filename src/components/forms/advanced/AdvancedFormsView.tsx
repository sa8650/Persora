import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  Globe,
  Link2,
  Monitor,
  Smartphone,
  Tablet,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import type { AppUser } from "../../../types";
import {
  advancedFormGate,
  advancedFormError,
  normalizeAdvancedForm,
  validateAdvancedAnswers,
  type AdvancedAnswerValue,
  type AdvancedForm,
} from "../../../../cloudflare/advanced-forms-rules.js";
import {
  createAdvancedFormDocument,
  deleteAdvancedForm,
  deleteAdvancedResponse,
  duplicateAdvancedForm,
  getAdvancedForm,
  listAdvancedForms,
  recordAdvancedResponse,
  saveAdvancedForm,
} from "../../../lib/advanced-forms-store";
import AdvancedFormsDashboard from "./AdvancedFormsDashboard";
import AdvancedFormBuilder, { type BuilderTab } from "./AdvancedFormBuilder";
import AdvancedFormRenderer from "./AdvancedFormRenderer";
import AdvancedResponsesTab from "./AdvancedResponsesTab";
import "./advanced-forms.css";

type Surface = "dashboard" | "builder" | "preview" | "respondent";

export default function AdvancedFormsView({
  user,
  notify,
  onBackToForms,
}: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  onBackToForms: () => void;
}) {
  const [forms, setForms] = useState<AdvancedForm[]>([]);
  const [surface, setSurface] = useState<Surface>("dashboard");
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<BuilderTab>("design");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [answers, setAnswers] = useState<Record<string, AdvancedAnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const openedFromHash = useRef(false);

  const refresh = useCallback(() => {
    setForms(listAdvancedForms(user.id));
  }, [user.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // A shared respondent link (#advanced-form=<slug>) opens straight into the form.
  useEffect(() => {
    if (openedFromHash.current) return;
    openedFromHash.current = true;
    const match = /advanced-form=([\w-]+)/.exec(window.location.hash || "");
    if (!match) return;
    const found = listAdvancedForms(user.id).find((form) => form.slug === match[1] || form.id === match[1]);
    if (found) {
      setActiveId(found.id);
      setAnswers({});
      setSubmitted(false);
      setDirection("forward");
      setSurface("respondent");
    }
  }, [user.id]);

  const active = useMemo(() => (activeId ? forms.find((form) => form.id === activeId) ?? null : null), [forms, activeId]);
  const activeRef = useRef<AdvancedForm | null>(null);
  activeRef.current = active;

  const go = (next: Surface, nextDirection: "forward" | "backward") => {
    setDirection(nextDirection);
    setSurface(next);
  };

  const persist = useCallback(
    (form: AdvancedForm) => {
      setSaveState("saving");
      try {
        const saved = saveAdvancedForm(user.id, form);
        setForms(listAdvancedForms(user.id));
        setSaveState("saved");
        return saved;
      } catch (error) {
        setSaveState("saved");
        notify(advancedFormError(error, "This change could not be saved."), "error");
        return form;
      }
    },
    [notify, user.id],
  );

  /* ---- Dashboard actions ------------------------------------------- */

  const handleCreate = (templateId?: string) => {
    try {
      const created = createAdvancedFormDocument(user.id, { templateId });
      refresh();
      setActiveId(created.id);
      setTab("design");
      go("builder", "forward");
      notify(templateId ? "Template opened — shape it however you like." : "Blank advanced form created.");
    } catch (error) {
      notify(advancedFormError(error, "That form could not be created."), "error");
    }
  };

  const openBuilder = (id: string, nextTab: BuilderTab = "design") => {
    setActiveId(id);
    setTab(nextTab);
    go("builder", "forward");
  };

  const openPreview = (id: string) => {
    setActiveId(id);
    go("preview", "forward");
  };

  const handleRename = (id: string, title: string) => {
    const form = getAdvancedForm(user.id, id);
    if (!form) return;
    persist({ ...form, title });
  };

  const handleDuplicate = (id: string) => {
    try {
      duplicateAdvancedForm(user.id, id);
      refresh();
      notify("Advanced form duplicated.");
    } catch (error) {
      notify(advancedFormError(error, "That form could not be duplicated."), "error");
    }
  };

  const handleDelete = (id: string) => {
    deleteAdvancedForm(user.id, id);
    refresh();
    notify("Advanced form deleted.");
  };

  const handleTogglePublish = (id: string) => {
    const form = getAdvancedForm(user.id, id);
    if (!form) return;
    const nextStatus = form.status === "published" ? "draft" : "published";
    persist({ ...form, status: nextStatus, publishedAt: nextStatus === "published" ? new Date().toISOString() : null });
    notify(nextStatus === "published" ? "Advanced form published. Copy the respondent link to share it." : "Advanced form unpublished.");
  };

  const respondentLink = (form: AdvancedForm) => {
    try {
      return `${window.location.origin}${window.location.pathname}#advanced-form=${form.slug}`;
    } catch {
      return `#advanced-form=${form.slug}`;
    }
  };

  const handleShare = async (id: string) => {
    const form = getAdvancedForm(user.id, id);
    if (!form) return;
    const link = respondentLink(form);
    try {
      await navigator.clipboard.writeText(link);
      notify(form.status === "published" ? "Respondent link copied." : "Link copied — publish the form so it accepts responses.");
    } catch {
      notify(`Respondent link: ${link}`, "error");
    }
  };

  /* ---- Builder ------------------------------------------------------ */

  const handleFormChange = (updater: (form: AdvancedForm) => AdvancedForm) => {
    const current = activeRef.current;
    if (!current) return;
    const next = normalizeAdvancedForm(updater(current));
    persist(next);
  };

  const handleDeleteResponse = (responseId: string) => {
    if (!activeId) return;
    deleteAdvancedResponse(user.id, activeId, responseId);
    refresh();
  };

  /* ---- Respondent --------------------------------------------------- */

  const respondForm = useMemo(() => {
    if (!active) return null;
    return active;
  }, [active]);

  const gate = respondForm ? advancedFormGate(respondForm) : null;

  const handleSubmitResponse = async () => {
    if (!respondForm) return;
    const result = validateAdvancedAnswers(respondForm, answers);
    setErrors(result.errors);
    if (!result.ok) {
      notify("Please check the highlighted answers.", "error");
      const firstError = respondForm.fields.find((field) => result.errors[field.id]);
      if (firstError) document.getElementById(`aff-${firstError.id}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      recordAdvancedResponse(user.id, respondForm.id, answers);
      refresh();
      setSubmitted(true);
    } catch (error) {
      notify(advancedFormError(error, "That response could not be saved."), "error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Render ------------------------------------------------------- */

  const animationClass = direction === "forward" ? "aff-view--forward" : "aff-view--back";

  if (surface === "preview" && active) {
    return (
      <section key={`preview-${active.id}`} className={`aff-shell aff-view ${animationClass}`} aria-label="Form preview">
        <header className="aff-preview-bar">
          <button type="button" className="aff-back" onClick={() => go("builder", "backward")} aria-label="Back to builder" title="Back to builder">
            <ArrowLeft size={17} />
          </button>
          <div className="aff-preview-titles">
            <strong>{active.title}</strong>
            <span>Preview · {active.fields.length} elements</span>
          </div>
          <div className="aff-device-toggle" role="group" aria-label="Preview width">
            {([["desktop", <Monitor size={15} key="d" />], ["tablet", <Tablet size={15} key="t" />], ["mobile", <Smartphone size={15} key="m" />]] as const).map(([value, icon]) => (
              <button
                key={value}
                type="button"
                className={device === value ? "is-active" : ""}
                aria-pressed={device === value}
                aria-label={`${value} preview`}
                onClick={() => setDevice(value)}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="aff-preview-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => { setAnswers({}); setErrors({}); setSubmitted(false); go("respondent", "forward"); }}>
              <Eye size={14} /> Respondent view
            </Button>
            <Button type="button" size="sm" onClick={() => handleTogglePublish(active.id)}>
              <Globe size={14} /> {active.status === "published" ? "Unpublish" : "Publish"}
            </Button>
          </div>
        </header>
        <div className={`aff-preview-stage is-${device}`}>
          <div className="aff-preview-frame">
            <AdvancedFormRenderer form={active} mode="preview" footer={<div className="aff-actions"><button type="button" className="aff-submit" tabIndex={-1}>{active.settings.submitLabel}</button></div>} />
          </div>
        </div>
      </section>
    );
  }

  if (surface === "respondent" && respondForm) {
    return (
      <section key={`respondent-${respondForm.id}`} className={`aff-shell aff-view ${animationClass}`} aria-label="Respondent view">
        <header className="aff-preview-bar">
          <button type="button" className="aff-back" onClick={() => go("dashboard", "backward")} aria-label="Back to advanced forms" title="Back to advanced forms">
            <ArrowLeft size={17} />
          </button>
          <div className="aff-preview-titles">
            <strong>{respondForm.title}</strong>
            <span>{respondForm.status === "published" ? "Published form" : "Draft preview"}</span>
          </div>
          <div className="aff-preview-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleShare(respondForm.id)}>
              <Link2 size={14} /> Copy link
            </Button>
          </div>
        </header>
        <div className="aff-respondent-stage">
          {submitted ? (
            <div className="aff-confirmation" role="status">
              <IconTile variant="soft" size="lg" className="ds-tone-emerald"><CheckCircle2 size={22} /></IconTile>
              <h2>{respondForm.settings.confirmationTitle}</h2>
              <p>{respondForm.settings.confirmationMessage}</p>
              <div className="aff-confirmation-actions">
                <Button type="button" variant="outline" onClick={() => { setAnswers({}); setSubmitted(false); }}>
                  Submit another response
                </Button>
                <Button type="button" onClick={() => go("dashboard", "backward")}>Back to advanced forms</Button>
              </div>
            </div>
          ) : gate && !gate.open ? (
            <div className="aff-confirmation" role="status">
              <IconTile variant="soft" size="lg" className="ds-tone-amber"><Globe size={22} /></IconTile>
              <h2>Form unavailable</h2>
              <p>{gate.message}</p>
              <Button type="button" variant="outline" onClick={() => go("dashboard", "backward")}>Back to advanced forms</Button>
            </div>
          ) : (
            <div className="aff-respondent-frame">
              <AdvancedFormRenderer
                form={respondForm}
                mode="live"
                answers={answers}
                errors={errors}
                onChange={(fieldId, value) => {
                  setAnswers((current) => ({ ...current, [fieldId]: value }));
                  setErrors((current) => {
                    if (!current[fieldId]) return current;
                    const next = { ...current };
                    delete next[fieldId];
                    return next;
                  });
                }}
                onSubmit={() => void handleSubmitResponse()}
                submitting={submitting}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  if (surface === "builder" && active) {
    return (
      <section key={`builder-${active.id}`} className={`aff-shell aff-view ${animationClass}`} aria-label="Advanced form builder">
        <div className="aff-builder-status">
          <IconTile variant="soft" size="xs" className="ds-tone-violet"><Wand2 size={13} /></IconTile>
          <span className="aff-builder-status-title">Advanced builder</span>
          <span className="aff-builder-saved" role="status">
            {saveState === "saving" ? "Saving…" : <><Check size={13} /> Saved to this workspace</>}
          </span>
          <Badge variant="secondary" size="xs">{active.category}</Badge>
        </div>
        <AdvancedFormBuilder
          form={active}
          tab={tab}
          onTabChange={setTab}
          onChange={handleFormChange}
          onBack={() => go("dashboard", "backward")}
          onPreview={() => go("preview", "forward")}
          onPublishToggle={() => handleTogglePublish(active.id)}
          responsesPanel={
            <AdvancedResponsesTab form={active} onDeleteResponse={handleDeleteResponse} notify={notify} />
          }
        />
      </section>
    );
  }

  return (
    <section key="dashboard" className={`aff-shell aff-view ${animationClass}`} aria-label="Advanced Forms dashboard">
      <AdvancedFormsDashboard
        forms={forms}
        onBack={onBackToForms}
        onCreateBlank={() => handleCreate()}
        onCreateFromTemplate={(templateId) => handleCreate(templateId)}
        onOpen={openBuilder}
        onPreview={openPreview}
        onRename={handleRename}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onTogglePublish={handleTogglePublish}
        onShare={(id) => void handleShare(id)}
        notify={notify}
      />
    </section>
  );
}
