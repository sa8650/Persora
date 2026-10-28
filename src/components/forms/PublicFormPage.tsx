// Standalone Public Form Respondent Page (/Form/:slug)
// Focused respondent view with zero top chrome, Google Forms theme & header support,
// bottom disclaimer links, and Persora Forms branding.
import { useEffect, useState } from "react";
import "./forms.css";
import { Award, CheckCircle2, Lock, Mail, ShieldCheck, Ticket, X, XCircle } from "lucide-react";
import type { AppUser } from "../../types";
import {
  formErrorMessage,
  getPublicForm,
  submitPublicFormResponse,
  uploadPublicFormResponseImage,
  type FormAnswerValue,
  type PublicFormPayload,
  type PublicFormSubmitResult,
} from "../../lib/forms-api";
import { buildFormThemeCssVars } from "../../lib/form-themes";
import FormRespondentRenderer from "./FormRespondentRenderer";
import ModalPortal from "../ModalPortal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";
import { PersoraEmptyState } from "@/design-system";

export default function PublicFormPage({
  slug,
  signedInUser,
  notify,
  onSignIn,
  onCreateAccount,
}: {
  slug: string;
  signedInUser: AppUser | null;
  notify: (message: string, kind?: "success" | "error") => void;
  onSignIn: () => void;
  onCreateAccount: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublicFormPayload["form"] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<PublicFormSubmitResult | null>(null);
  const [contactOwnerOpen, setContactOwnerOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailableError(null);
    getPublicForm(slug, controller.signal)
      .then((res) => {
        setPayload(res.form);
        document.title = `${res.form.title} · Persora Forms`;
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setUnavailableError(
            formErrorMessage(err, "This form link is unavailable, unpublished, or no longer exists."),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, signedInUser?.id]);

  useEffect(() => {
    if (!contactOwnerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContactOwnerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [contactOwnerOpen]);

  const handleUpload = async (file: File) => {
    const asset = await uploadPublicFormResponseImage(slug, file);
    return asset;
  };

  const handleSubmit = async (input: {
    respondentName: string;
    respondentEmail: string;
    answers: Record<string, FormAnswerValue>;
  }) => {
    setSubmitting(true);
    try {
      const res = await submitPublicFormResponse(slug, input);
      setSubmitted(res);
      notify("Your response has been recorded.");
    } finally {
      setSubmitting(false);
    }
  };

  const themeVars = buildFormThemeCssVars(payload?.theme ? { theme: payload.theme } : null);

  return (
    <main className="pf-public-page pf-themed-surface" style={themeVars}>
      <div className="pf-public-container">
        {loading ? (
          <div className="pf-respondent-card pf-centered-state" role="status">
            <Spinner className="size-5" />
            <span>Loading form…</span>
          </div>
        ) : unavailableError || !payload ? (
          <div className="pf-respondent-card">
            <PersoraEmptyState
              moduleId="forms"
              tone="violet"
              title="Form unavailable"
              description={
                unavailableError || "This form is not currently published or the link is invalid."
              }
            />
          </div>
        ) : submitted ? (
          <div className="pf-respondent-card pf-confirmation-card" role="status">
            <CheckCircle2 size={38} className="pf-confirm-icon" aria-hidden="true" />
            <h1>{payload.title}</h1>
            <p className="pf-confirm-message">{submitted.confirmationMessage}</p>

            {submitted.registrationCode && (
              <div className="pf-reg-code-box">
                <Ticket size={18} aria-hidden="true" />
                <div>
                  <span>Registration confirmation code</span>
                  <strong>{submitted.registrationCode}</strong>
                </div>
              </div>
            )}

            {submitted.quizResult && (
              <div className="pf-quiz-score-card">
                <div className="pf-quiz-score-head">
                  <div className="pf-inline-head-title">
                    <Award size={18} aria-hidden="true" />
                    <strong>Your quiz score</strong>
                  </div>
                  <Badge variant="info-light" size="sm">
                    {submitted.quizResult.score} / {submitted.quizResult.maxScore} pts (
                    {submitted.quizResult.percentage}%)
                  </Badge>
                </div>

                {submitted.quizResult.breakdown && (
                  <ul className="pf-quiz-breakdown-list">
                    {payload.questions.map((q, idx) => {
                      const entry = submitted.quizResult?.breakdown?.[q.id];
                      if (!entry) return null;
                      return (
                        <li
                          key={q.id}
                          className={`pf-quiz-breakdown-item ${entry.correct ? "is-correct" : "is-wrong"}`}
                        >
                          <div className="pf-quiz-breakdown-row">
                            <span>
                              {idx + 1}. {q.title}
                            </span>
                            <Badge
                              variant={entry.correct ? "success-light" : "destructive-light"}
                              size="xs"
                            >
                              {entry.earned}/{entry.points} pt
                            </Badge>
                          </div>
                          {entry.explanation ? (
                            <p className="pf-quiz-explanation">{entry.explanation}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <div className="pf-confirm-actions">
              <Button type="button" variant="outline" onClick={() => setSubmitted(null)}>
                Submit another response
              </Button>
            </div>
          </div>
        ) : !payload.acceptingResponses ? (
          <div className="pf-respondent-card pf-confirmation-card">
            <XCircle size={34} className="pf-closed-icon" aria-hidden="true" />
            <h1>{payload.title}</h1>
            <p className="pf-confirm-message">
              {payload.closedMessage || "This form is no longer accepting responses."}
            </p>
          </div>
        ) : payload.requireSignIn && !signedInUser && !payload.signedIn ? (
          <div className="pf-respondent-card pf-confirmation-card">
            <Lock size={34} className="pf-closed-icon" aria-hidden="true" />
            <h1>{payload.title}</h1>
            <p className="pf-confirm-message">
              Sign in with a Persora account to view and submit a response to this form.
            </p>
            <div className="pf-confirm-actions">
              <Button type="button" onClick={onSignIn}>
                Sign in to continue
              </Button>
              <Button type="button" variant="outline" onClick={onCreateAccount}>
                Create account
              </Button>
            </div>
          </div>
        ) : (
          <FormRespondentRenderer
            title={payload.title}
            description={payload.description}
            headerImage={payload.headerImage}
            theme={payload.theme}
            questions={payload.questions}
            quizEnabled={payload.quizEnabled}
            eventRegistration={payload.eventRegistration}
            publicSlug={slug}
            submitting={submitting}
            initialName={signedInUser?.fullName || ""}
            initialEmail={signedInUser?.email || ""}
            onUploadImage={handleUpload}
            onSubmit={handleSubmit}
          />
        )}

        <footer className="pf-public-footer" aria-label="Form legal information and Persora branding">
          <p className="pf-public-disclaimer">
            <span>This content is neither created nor endorsed by Persora.</span>
            <span className="pf-public-footer-sep" aria-hidden="true"> - </span>
            <button
              type="button"
              className="pf-public-footer-link"
              onClick={() => setContactOwnerOpen(true)}
            >
              Contact form owner
            </button>
            <span className="pf-public-footer-sep" aria-hidden="true"> - </span>
            <a href="/terms" className="pf-public-footer-link">
              Terms of Service
            </a>
            <span className="pf-public-footer-sep" aria-hidden="true"> - </span>
            <a href="/privacy" className="pf-public-footer-link">
              Privacy Policy
            </a>
          </p>

          <div className="pf-public-brand-footer">
            <a href="/" className="pf-public-brand-wordmark" aria-label="Persora Forms">
              <ShieldCheck size={17} aria-hidden="true" />
              <span className="pf-public-brand-strong">Persora</span>
              <span className="pf-public-brand-light">Forms</span>
            </a>
          </div>
        </footer>
      </div>

      {contactOwnerOpen && (
        <ModalPortal>
          <div
            className="modal-backdrop pf-contact-owner-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setContactOwnerOpen(false);
            }}
          >
            <section
              className="pf-contact-owner-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pf-contact-owner-title"
            >
              <div className="pf-contact-owner-head">
                <IconTile variant="soft" size="default" className="ds-tone-violet" aria-hidden="true">
                  <Mail size={18} />
                </IconTile>
                <div className="pf-contact-owner-title-wrap">
                  <h2 id="pf-contact-owner-title">Contact form owner</h2>
                  <span>{payload?.title || "Persora Form"}</span>
                </div>
                <button
                  type="button"
                  className="ds-delete-modal-close"
                  aria-label="Close dialog"
                  onClick={() => setContactOwnerOpen(false)}
                >
                  <X size={17} />
                </button>
              </div>

              <div className="pf-contact-owner-body">
                <p>
                  This form was created by an independent Persora user. To protect account privacy, the
                  creator&apos;s personal email address is not publicly exposed unless shared in the form
                  description above.
                </p>
                {payload?.eventRegistration?.enabled &&
                  (payload.eventRegistration.eventLocation || payload.eventRegistration.eventDate) && (
                    <div className="pf-contact-owner-meta">
                      {payload.eventRegistration.eventDate && (
                        <div>
                          <strong>Event date:</strong> {payload.eventRegistration.eventDate}
                        </div>
                      )}
                      {payload.eventRegistration.eventLocation && (
                        <div>
                          <strong>Location:</strong> {payload.eventRegistration.eventLocation}
                        </div>
                      )}
                    </div>
                  )}
                <p>
                  If you need to report abuse, phishing, or a terms violation related to this form, contact
                  Persora Support directly.
                </p>
              </div>

              <div className="pf-contact-owner-actions">
                <Button type="button" variant="outline" onClick={() => setContactOwnerOpen(false)}>
                  Close
                </Button>
                <Button asChild>
                  <a href="/contact">Contact Persora Support</a>
                </Button>
              </div>
            </section>
          </div>
        </ModalPortal>
      )}
    </main>
  );
}
