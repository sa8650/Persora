// Persora Forms — Standalone Workspace View
// Coordinates the Forms Dashboard and the active Form Editor (Questions, Responses, Settings).
import { useCallback, useEffect, useRef, useState } from "react";
import "./forms.css";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ClipboardList,
  Globe,
  Link2,
  ListChecks,
  Settings as SettingsIcon,
} from "lucide-react";
import type { AppUser } from "../../types";
import { isPagesApiConfigured } from "../../lib/cloud";
import { PersoraEmptyState } from "@/design-system";
import {
  buildPublicFormUrl,
  createForm,
  deleteForm,
  duplicateForm,
  formErrorMessage,
  getForm,
  listForms,
  saveForm,
  type FormDetail,
  type FormHeaderImage,
  type FormQuestion,
  type FormSettings,
  type FormSummary,
} from "../../lib/forms-api";
import FormsDashboard from "./FormsDashboard";
import FormBuilder from "./FormBuilder";
import FormResponsesTab from "./FormResponsesTab";
import FormSettingsTab from "./FormSettingsTab";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";

type EditorTab = "builder" | "responses" | "settings";

export default function FormsView({
  user,
  notify,
  canUpload,
  maxUploadMb,
  onUpgrade,
}: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
}) {
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);

  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("builder");
  const [activeForm, setActiveForm] = useState<FormDetail | null>(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [publishing, setPublishing] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFormRef = useRef<FormDetail | null>(null);
  latestFormRef.current = activeForm;

  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    setLoadingList(true);
    try {
      const list = await listForms(signal);
      setForms(list);
    } catch (err) {
      if (!signal?.aborted) {
        notifyRef.current(formErrorMessage(err, "Forms could not be loaded."), "error");
      }
    } finally {
      if (!signal?.aborted) setLoadingList(false);
    }
  }, []);

  const disabled = Boolean(user.demo) || !isPagesApiConfigured;

  useEffect(() => {
    if (disabled) {
      setLoadingList(false);
      return;
    }
    const controller = new AbortController();
    void refreshList(controller.signal);
    return () => controller.abort();
  }, [refreshList, disabled]);

  const flushPendingSave = useCallback(
    async (override?: Partial<FormDetail> & { regenerateLink?: boolean }) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const target = latestFormRef.current;
      if (!target) return null;
      const merged = override ? { ...target, ...override } : target;
      setSaveStatus("saving");
      try {
        const saved = await saveForm(merged.id, {
          title: merged.title.trim() || "Untitled form",
          description: merged.description,
          status: merged.status,
          acceptingResponses: merged.acceptingResponses,
          headerImage: merged.headerImage,
          questions: merged.questions,
          settings: merged.settings,
          regenerateLink: override?.regenerateLink,
        });
        setActiveForm(saved.form);
        latestFormRef.current = saved.form;
        setForms((prev) => {
          const exists = prev.some((f) => f.id === saved.form.id);
          return exists ? prev.map((f) => (f.id === saved.form.id ? saved.form : f)) : [saved.form, ...prev];
        });
        setSaveStatus("saved");
        return saved.form;
      } catch (err) {
        setSaveStatus("error");
        notifyRef.current(formErrorMessage(err, "Changes could not be saved."), "error");
        return null;
      }
    },
    [],
  );

  const scheduleAutoSave = useCallback(() => {
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushPendingSave();
    }, 900);
  }, [flushPendingSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const openFormEditor = async (formId: string, tab: EditorTab = "builder") => {
    setActiveFormId(formId);
    setActiveTab(tab);
    setLoadingForm(true);
    try {
      const env = await getForm(formId);
      setActiveForm(env.form);
      latestFormRef.current = env.form;
      setSaveStatus("saved");
    } catch (err) {
      notify(formErrorMessage(err, "Form could not be opened."), "error");
      setActiveFormId(null);
    } finally {
      setLoadingForm(false);
    }
  };

  const handleCloseEditor = async () => {
    if (saveStatus === "dirty") {
      await flushPendingSave();
    }
    setActiveFormId(null);
    setActiveForm(null);
    void refreshList();
  };

  const handleCreate = async (seed: {
    title: string;
    description: string;
    questions: FormQuestion[];
    settings: FormSettings;
  }) => {
    if (user.demo) {
      notify("Sign in with a Persora account to create and publish forms.", "error");
      return;
    }
    setCreating(true);
    try {
      const created = await createForm(seed);
      setForms((prev) => [created.form, ...prev]);
      setActiveFormId(created.form.id);
      setActiveForm(created.form);
      latestFormRef.current = created.form;
      setActiveTab("builder");
      setSaveStatus("saved");
    } catch (err) {
      notify(formErrorMessage(err, "Form could not be created."), "error");
    } finally {
      setCreating(false);
    }
  };

  const handleDashboardTogglePublish = async (summary: FormSummary) => {
    const nextStatus = summary.status === "published" ? "draft" : "published";
    try {
      const saved = await saveForm(summary.id, {
        status: nextStatus,
        ...(nextStatus === "published" ? { acceptingResponses: true } : {}),
      });
      setForms((prev) => prev.map((f) => (f.id === summary.id ? saved.form : f)));
      notify(
        nextStatus === "published"
          ? "Form published! Copy your link to collect responses."
          : "Form unpublished and hidden from public access.",
      );
    } catch (err) {
      notify(formErrorMessage(err, "Publish status could not be updated."), "error");
    }
  };

  const handleRename = async (summary: FormSummary, title: string) => {
    try {
      const saved = await saveForm(summary.id, { title });
      setForms((prev) => prev.map((f) => (f.id === summary.id ? saved.form : f)));
      notify("Form renamed.");
    } catch (err) {
      notify(formErrorMessage(err, "Form could not be renamed."), "error");
      throw err;
    }
  };

  const handleDuplicate = async (summary: FormSummary) => {
    try {
      const dup = await duplicateForm(summary.id);
      setForms((prev) => [dup.form, ...prev]);
      notify("Form duplicated.");
    } catch (err) {
      notify(formErrorMessage(err, "Form could not be duplicated."), "error");
    }
  };

  const handleDelete = async (formId: string) => {
    try {
      await deleteForm(formId);
      setForms((prev) => prev.filter((f) => f.id !== formId));
      if (activeFormId === formId) {
        setActiveFormId(null);
        setActiveForm(null);
      }
      notify("Form deleted.");
    } catch (err) {
      notify(formErrorMessage(err, "Form could not be deleted."), "error");
    }
  };

  const handlePatchActiveForm = useCallback(
    (patch: {
      title?: string;
      description?: string;
      headerImage?: FormHeaderImage | null;
      questions?: FormQuestion[];
      acceptingResponses?: boolean;
      settings?: FormSettings;
    }) => {
      setActiveForm((prev) => {
        if (!prev) return prev;
        const next: FormDetail = {
          ...prev,
          ...patch,
          questionCount: patch.questions ? patch.questions.length : prev.questionCount,
          quizEnabled: patch.settings ? patch.settings.quiz.enabled : prev.quizEnabled,
          eventEnabled: patch.settings ? patch.settings.eventRegistration.enabled : prev.eventEnabled,
          maxRegistrations: patch.settings
            ? patch.settings.eventRegistration.maxRegistrations
            : prev.maxRegistrations,
        };
        latestFormRef.current = next;
        return next;
      });
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const handleResponseCountChanged = useCallback((count: number) => {
    setActiveForm((prev) => {
      if (!prev || prev.responseCount === count) return prev;
      const next = { ...prev, responseCount: count };
      latestFormRef.current = next;
      return next;
    });
    setForms((prev) => {
      const targetId = latestFormRef.current?.id;
      if (!targetId) return prev;
      const current = prev.find((f) => f.id === targetId);
      if (!current || current.responseCount === count) return prev;
      return prev.map((f) => (f.id === targetId ? { ...f, responseCount: count } : f));
    });
  }, []);

  const handleEditorTogglePublish = async () => {
    if (!activeForm) return;
    setPublishing(true);
    try {
      const nextStatus = activeForm.status === "published" ? "draft" : "published";
      const updated = await flushPendingSave({
        status: nextStatus,
        ...(nextStatus === "published" ? { acceptingResponses: true } : {}),
      });
      if (updated) {
        notify(
          nextStatus === "published"
            ? "Form published! Copy your link to share with respondents."
            : "Form unpublished.",
        );
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyEditorLink = async () => {
    if (!activeForm) return;
    const url = buildPublicFormUrl(activeForm.publicSlug);
    try {
      await navigator.clipboard.writeText(url);
      notify(
        activeForm.status === "published"
          ? "Public response link copied."
          : "Link copied (publish the form so respondents can open it).",
      );
    } catch {
      notify("Couldn't copy link automatically.", "error");
    }
  };

  if (disabled) {
    return (
      <section className="pf-root">
        <div className="pf-card">
          <PersoraEmptyState
            role="status"
            moduleId="forms"
            tone="violet"
            title="Persora Forms needs your Persora account"
            description="Forms and submissions are saved privately to your account on the server, so they aren't available in the local sample session. Sign in to create surveys, quizzes, and event registrations."
          />
        </div>
      </section>
    );
  }

  if (!activeFormId) {
    return (
      <section className="pf-root">
        <FormsDashboard
          forms={forms}
          loading={loadingList}
          creating={creating}
          notify={notify}
          onCreate={handleCreate}
          onOpenForm={(id, tab) => void openFormEditor(id, tab)}
        onTogglePublish={handleDashboardTogglePublish}
        onRename={handleRename}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        />
      </section>
    );
  }

  if (loadingForm || !activeForm) {
    return (
      <section className="pf-root">
        <div className="pf-card pf-centered-state" role="status">
          <Spinner className="size-4" />
          <span>Opening form editor…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="pf-root pf-editor-shell" aria-label={activeForm.title}>
      <header className="pf-editor-topbar">
        <div className="pf-editor-topbar-left">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleCloseEditor()}
            aria-label="Back to forms dashboard"
          >
            <ArrowLeft size={16} />
          </Button>

          <IconTile variant="soft" size="xs" className="ds-tone-violet">
            <ClipboardList size={14} />
          </IconTile>

          <h2 className="pf-editor-heading">{activeForm.title || "Untitled form"}</h2>

          <Badge
            variant={
              activeForm.status === "published"
                ? activeForm.acceptingResponses
                  ? "success-light"
                  : "warning-light"
                : "outline"
            }
            size="xs"
          >
            {activeForm.status === "published"
              ? activeForm.acceptingResponses
                ? "Published"
                : "Closed"
              : "Draft"}
          </Badge>

          <span className="pf-save-indicator" role="status">
            {saveStatus === "saving" ? (
              <>
                <Spinner className="size-3" /> Saving…
              </>
            ) : saveStatus === "dirty" ? (
              "Unsaved edits…"
            ) : saveStatus === "error" ? (
              <button type="button" className="pf-link-btn" onClick={() => void flushPendingSave()}>
                Save failed · Retry
              </button>
            ) : (
              <>
                <Check size={13} /> Saved
              </>
            )}
          </span>
        </div>

        <nav className="pf-editor-tabs" aria-label="Form sections">
          <button
            type="button"
            className={`pf-editor-tab ${activeTab === "builder" ? "is-active" : ""}`}
            onClick={() => setActiveTab("builder")}
          >
            <ListChecks size={14} /> Questions ({activeForm.questions.length})
          </button>
          <button
            type="button"
            className={`pf-editor-tab ${activeTab === "responses" ? "is-active" : ""}`}
            onClick={() => setActiveTab("responses")}
          >
            <BarChart3 size={14} /> Responses ({activeForm.responseCount})
          </button>
          <button
            type="button"
            className={`pf-editor-tab ${activeTab === "settings" ? "is-active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <SettingsIcon size={14} /> Settings
          </button>
        </nav>

        <div className="pf-editor-topbar-right">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopyEditorLink()}
          >
            <Link2 size={14} /> Copy link
          </Button>

          <Button
            type="button"
            variant={activeForm.status === "published" ? "outline" : "default"}
            size="sm"
            disabled={publishing}
            onClick={() => void handleEditorTogglePublish()}
          >
            {publishing ? <Spinner className="size-3.5" /> : <Globe size={14} />}
            {activeForm.status === "published" ? "Unpublish" : "Publish form"}
          </Button>
        </div>
      </header>

      <div className="pf-editor-body">
        {activeTab === "builder" && (
          <FormBuilder
            form={activeForm}
            canUpload={canUpload}
            maxUploadMb={maxUploadMb}
            onUpgrade={onUpgrade}
            notify={notify}
            onChange={handlePatchActiveForm}
          />
        )}

        {activeTab === "responses" && (
          <FormResponsesTab
            form={activeForm}
            notify={notify}
            onToggleAccepting={async (next) => {
              const updated = await flushPendingSave({ acceptingResponses: next });
              if (updated) {
                notify(next ? "Now accepting responses." : "Stopped accepting new responses.");
              }
            }}
            onResponseCountChanged={handleResponseCountChanged}
          />
        )}

        {activeTab === "settings" && (
          <FormSettingsTab
            form={activeForm}
            canUpload={canUpload}
            maxUploadMb={maxUploadMb}
            onUpgrade={onUpgrade}
            notify={notify}
            onChange={handlePatchActiveForm}
            onRegenerateLink={async () => {
              const updated = await flushPendingSave({ regenerateLink: true });
              if (updated) {
                notify("Generated a new public form link. Previous links will no longer open this form.");
              }
            }}
          />
        )}
      </div>
    </section>
  );
}
