// Persora Forms — Responses Tab
// Total count, Accepting/Stopped switch, CSV export, aggregated bar charts &
// linear scale averages, and individual submission inspector.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Award, BarChart3, Download, List, RefreshCw, Ticket, Trash2, Users } from "lucide-react";
import {
  deleteFormResponse,
  downloadFormResponsesCsv,
  formErrorMessage,
  formatAnswerForDisplay,
  listFormResponses,
  type FormDetail,
  type FormQuestion,
  type FormResponseEntry,
  type FormUploadedImageValue,
} from "../../lib/forms-api";
import FormImageAsset from "./FormImageAsset";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { PersoraDeleteModal, PersoraEmptyState } from "@/design-system";

function ChoiceDistributionChart({
  question,
  responses,
}: {
  question: FormQuestion;
  responses: FormResponseEntry[];
}) {
  const options = question.options || [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const opt of options) map.set(opt.id, 0);
    let answeredCount = 0;
    for (const r of responses) {
      const val = r.answers[question.id];
      if (typeof val === "string" && val) {
        answeredCount += 1;
        map.set(val, (map.get(val) || 0) + 1);
      } else if (Array.isArray(val) && val.length > 0) {
        answeredCount += 1;
        for (const id of val) {
          if (typeof id === "string") map.set(id, (map.get(id) || 0) + 1);
        }
      }
    }
    return { map, answeredCount };
  }, [options, question.id, responses]);

  return (
    <div className="pf-chart-card">
      <div className="pf-chart-head">
        <h4>{question.title}</h4>
        <span>
          {counts.answeredCount} {counts.answeredCount === 1 ? "response" : "responses"}
        </span>
      </div>
      <div className="pf-bar-list">
        {options.map((opt) => {
          const count = counts.map.get(opt.id) || 0;
          const pct = counts.answeredCount > 0 ? Math.round((count / counts.answeredCount) * 100) : 0;
          return (
            <div key={opt.id} className="pf-bar-row">
              <div className="pf-bar-label-row">
                <span className="pf-bar-label">{opt.label}</span>
                <span className="pf-bar-stat">
                  <strong>{count}</strong> ({pct}%)
                </span>
              </div>
              <div className="pf-bar-track" aria-hidden="true">
                <div className="pf-bar-fill" style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScaleDistributionChart({
  question,
  responses,
}: {
  question: FormQuestion;
  responses: FormResponseEntry[];
}) {
  const min = question.scaleMin ?? 1;
  const max = question.scaleMax ?? 5;
  const stats = useMemo(() => {
    const buckets = new Map<number, number>();
    for (let n = min; n <= max; n += 1) buckets.set(n, 0);
    let total = 0;
    let sum = 0;
    for (const r of responses) {
      const val = r.answers[question.id];
      if (typeof val === "number" && Number.isFinite(val)) {
        total += 1;
        sum += val;
        buckets.set(val, (buckets.get(val) || 0) + 1);
      }
    }
    return {
      buckets,
      total,
      average: total > 0 ? (sum / total).toFixed(2) : "—",
    };
  }, [min, max, question.id, responses]);

  const steps: number[] = [];
  for (let n = min; n <= max; n += 1) steps.push(n);

  return (
    <div className="pf-chart-card">
      <div className="pf-chart-head">
        <div>
          <h4>{question.title}</h4>
          <small className="pf-chart-sub">
            Average rating: <strong>{stats.average}</strong> / {max}
          </small>
        </div>
        <span>
          {stats.total} {stats.total === 1 ? "response" : "responses"}
        </span>
      </div>
      <div className="pf-bar-list">
        {steps.map((step) => {
          const count = stats.buckets.get(step) || 0;
          const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
          return (
            <div key={step} className="pf-bar-row">
              <div className="pf-bar-label-row">
                <span className="pf-bar-label">
                  {step}
                  {step === min && question.minLabel ? ` — ${question.minLabel}` : ""}
                  {step === max && question.maxLabel ? ` — ${question.maxLabel}` : ""}
                </span>
                <span className="pf-bar-stat">
                  <strong>{count}</strong> ({pct}%)
                </span>
              </div>
              <div className="pf-bar-track" aria-hidden="true">
                <div
                  className="pf-bar-fill is-violet"
                  style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FormResponsesTab({
  form,
  notify,
  onToggleAccepting,
  onResponseCountChanged,
}: {
  form: FormDetail;
  notify: (message: string, kind?: "success" | "error") => void;
  onToggleAccepting: (next: boolean) => Promise<void>;
  onResponseCountChanged: (count: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responses, setResponses] = useState<FormResponseEntry[]>([]);
  const [subView, setSubView] = useState<"summary" | "individual">("summary");
  const [exporting, setExporting] = useState(false);
  const [togglingAccepting, setTogglingAccepting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Stabilize callback references so parent state updates or toast renders never
  // re-trigger the automatic load effect in a loop.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onCountChangedRef = useRef(onResponseCountChanged);
  onCountChangedRef.current = onResponseCountChanged;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await listFormResponses(form.id, signal);
        if (signal?.aborted) return;
        const list = Array.isArray(res.responses) ? res.responses : [];
        setResponses(list);
        onCountChangedRef.current(
          typeof res.responseCount === "number" ? res.responseCount : list.length,
        );
      } catch (err) {
        if (!signal?.aborted) {
          const msg = formErrorMessage(err, "Responses could not be loaded.");
          setLoadError(msg);
          notifyRef.current(msg, "error");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [form.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await downloadFormResponsesCsv(form.id, form.title);
      notify("Exported responses as CSV.");
    } catch (err) {
      notify(formErrorMessage(err, "CSV export failed."), "error");
    } finally {
      setExporting(false);
    }
  };

  const handleToggleAccepting = async () => {
    setTogglingAccepting(true);
    try {
      await onToggleAccepting(!form.acceptingResponses);
    } finally {
      setTogglingAccepting(false);
    }
  };

  const handleDeleteResponse = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteFormResponse(form.id, confirmDeleteId);
      const next = responses.filter((r) => r.id !== confirmDeleteId);
      setResponses(next);
      onCountChangedRef.current(next.length);
      setConfirmDeleteId(null);
      notify("Submission deleted.");
    } catch (err) {
      notify(formErrorMessage(err, "Submission could not be deleted."), "error");
    } finally {
      setDeleting(false);
    }
  };

  const quizAverage = useMemo(() => {
    if (!form.settings.quiz.enabled || responses.length === 0) return null;
    const scored = responses.filter((r) => r.quizResult && r.quizResult.maxScore > 0);
    if (scored.length === 0) return null;
    const avgPct = Math.round(
      scored.reduce((sum, r) => sum + (r.quizResult?.percentage || 0), 0) / scored.length,
    );
    return `${avgPct}%`;
  }, [form.settings.quiz.enabled, responses]);

  const maxReg = form.settings.eventRegistration.enabled
    ? form.settings.eventRegistration.maxRegistrations
    : null;
  const capacityPct =
    maxReg && maxReg > 0 ? Math.min(100, Math.round((responses.length / maxReg) * 100)) : 0;

  return (
    <div className="pf-responses-stack">
      <div className="pf-card pf-responses-header-card">
        <div className="pf-responses-kpi-row">
          <div className="pf-kpi-block">
            <span className="pf-kpi-label">Total responses</span>
            <strong className="pf-kpi-value">{responses.length}</strong>
          </div>

          {quizAverage && (
            <div className="pf-kpi-block">
              <span className="pf-kpi-label">Average quiz score</span>
              <strong className="pf-kpi-value">{quizAverage}</strong>
            </div>
          )}

          {maxReg !== null && maxReg > 0 && (
            <div className="pf-kpi-block pf-kpi-capacity">
              <div className="pf-bar-label-row">
                <span className="pf-kpi-label">
                  <Users size={12} aria-hidden="true" /> Event capacity
                </span>
                <span className="pf-bar-stat">
                  <strong>{responses.length}</strong> / {maxReg} registered
                </span>
              </div>
              <Progress value={capacityPct} aria-label="Event registration capacity" />
            </div>
          )}

          <div className="pf-responses-actions">
            <button
              type="button"
              role="switch"
              aria-checked={form.acceptingResponses}
              disabled={togglingAccepting}
              className={`pf-switch-pill ${form.acceptingResponses ? "is-on" : "is-off"}`}
              onClick={() => void handleToggleAccepting()}
            >
              <span className="pf-switch-dot" />
              <span>{form.acceptingResponses ? "Accepting responses" : "Closed to new responses"}</span>
            </button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh responses"
            >
              <RefreshCw size={14} /> Refresh
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExportCsv()}
              disabled={exporting || responses.length === 0}
            >
              {exporting ? <Spinner className="size-3.5" /> : <Download size={14} />}
              Export CSV
            </Button>
          </div>
        </div>

        <div className="pf-subtabs">
          <button
            type="button"
            className={`pf-subtab ${subView === "summary" ? "is-active" : ""}`}
            onClick={() => setSubView("summary")}
          >
            <BarChart3 size={14} /> Summary &amp; charts
          </button>
          <button
            type="button"
            className={`pf-subtab ${subView === "individual" ? "is-active" : ""}`}
            onClick={() => setSubView("individual")}
          >
            <List size={14} /> Individual submissions ({responses.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="pf-card pf-centered-state" role="status">
          <Spinner className="size-4" />
          <span>Loading submissions…</span>
        </div>
      ) : loadError ? (
        <div className="pf-card pf-error-retry-card" role="alert">
          <div className="pf-error-retry-copy">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Responses could not be loaded</strong>
              <p>{loadError}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      ) : responses.length === 0 ? (
        <div className="pf-card">
          <PersoraEmptyState
            moduleId="forms"
            tone="violet"
            title="No responses yet"
            description={
              form.status === "published"
                ? "Share your public form link to begin collecting responses. Aggregated charts and CSV exports appear here automatically."
                : "Publish this form when you are ready to start collecting responses."
            }
          />
        </div>
      ) : subView === "summary" ? (
        <div className="pf-summary-grid">
          {form.questions.map((question) => {
            if (
              question.type === "multiple_choice" ||
              question.type === "checkboxes" ||
              question.type === "dropdown"
            ) {
              return (
                <ChoiceDistributionChart
                  key={question.id}
                  question={question}
                  responses={responses}
                />
              );
            }
            if (question.type === "linear_scale") {
              return (
                <ScaleDistributionChart
                  key={question.id}
                  question={question}
                  responses={responses}
                />
              );
            }

            const nonEmpty = responses
              .map((r) => ({ id: r.id, val: r.answers[question.id], submittedAt: r.submittedAt }))
              .filter((entry) => entry.val !== undefined && entry.val !== null && entry.val !== "");

            return (
              <div key={question.id} className="pf-chart-card">
                <div className="pf-chart-head">
                  <h4>{question.title}</h4>
                  <span>
                    {nonEmpty.length} {nonEmpty.length === 1 ? "response" : "responses"}
                  </span>
                </div>
                {nonEmpty.length === 0 ? (
                  <p className="pf-muted-note">No answers submitted for this question yet.</p>
                ) : question.type === "image_upload" ? (
                  <div className="pf-response-thumbs">
                    {nonEmpty.map((entry) => {
                      const img = entry.val as FormUploadedImageValue;
                      return (
                        <div key={entry.id} className="pf-response-thumb-card">
                          <FormImageAsset
                            assetId={img.assetId}
                            formId={form.id}
                            alt={img.name}
                            className="pf-uploaded-thumb"
                          />
                          <span>{img.name}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="pf-text-answers-list">
                    {nonEmpty.slice(0, 15).map((entry) => (
                      <li key={entry.id}>{formatAnswerForDisplay(question, entry.val)}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pf-individual-list">
          {responses.map((resp, idx) => (
            <article key={resp.id} className="pf-card pf-submission-card">
              <header className="pf-submission-head">
                <div className="pf-submission-meta">
                  <strong>Submission #{responses.length - idx}</strong>
                  <span>{new Date(resp.submittedAt).toLocaleString()}</span>
                  {(resp.respondentName || resp.respondentEmail) && (
                    <Badge variant="secondary" size="xs">
                      {[resp.respondentName, resp.respondentEmail].filter(Boolean).join(" · ")}
                    </Badge>
                  )}
                  {resp.registrationCode && (
                    <Badge variant="success-light" size="xs">
                      <Ticket size={11} aria-hidden="true" /> {resp.registrationCode}
                    </Badge>
                  )}
                  {resp.quizResult && (
                    <Badge variant="info-light" size="xs">
                      <Award size={11} aria-hidden="true" /> {resp.quizResult.score}/
                      {resp.quizResult.maxScore} pts ({resp.quizResult.percentage}%)
                    </Badge>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setConfirmDeleteId(resp.id)}
                  aria-label="Delete submission"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </header>

              <dl className="pf-submission-dl">
                {form.questions.map((q) => {
                  const raw = resp.answers[q.id];
                  const uploaded =
                    q.type === "image_upload" && raw && typeof raw === "object" && !Array.isArray(raw)
                      ? (raw as FormUploadedImageValue)
                      : null;
                  const formatted = formatAnswerForDisplay(q, raw);

                  return (
                    <div key={q.id} className="pf-submission-qa">
                      <dt>{q.title}</dt>
                      <dd>
                        {uploaded ? (
                          <div className="pf-inline-uploaded">
                            <FormImageAsset
                              assetId={uploaded.assetId}
                              formId={form.id}
                              alt={uploaded.name}
                              className="pf-uploaded-thumb"
                            />
                            <span>{uploaded.name}</span>
                          </div>
                        ) : formatted ? (
                          formatted
                        ) : (
                          <span className="pf-unanswered">No answer</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))}
        </div>
      )}

      <PersoraDeleteModal
        open={Boolean(confirmDeleteId)}
        title="Delete this submission?"
        description="This permanently deletes the selected response and any image uploaded with it."
        confirmLabel="Delete submission"
        busy={deleting}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDeleteResponse()}
      />
    </div>
  );
}
