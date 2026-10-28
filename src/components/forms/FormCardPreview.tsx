// Persora Forms — lightweight, read-only miniature previews for dashboard & template cards.
//
// Never mounts FormBuilder or FormRespondentRenderer.
// Lazily fetches read-only form details via getForm(id) (pure read, zero timestamp side effects)
// as cards enter the viewport, with bounded concurrency and revision-keyed caching.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getForm,
  type FormDetail,
  type FormHeaderImage,
  type FormQuestion,
  type FormSettings,
  type FormSummary,
} from "../../lib/forms-api";
import {
  buildFormThemeCssVars,
  getPresetHeaderById,
  resolveFormTheme,
} from "../../lib/form-themes";
import FormImageAsset from "./FormImageAsset";

const MAX_CONCURRENT_REQUESTS = 4;

export interface FormMiniatureInput {
  formId?: string;
  title: string;
  description?: string;
  headerImage?: FormHeaderImage | null;
  questions: FormQuestion[];
  settings?: Partial<FormSettings> | null;
}

const previewCache = new Map<string, FormMiniatureInput>();
const inFlightByKey = new Map<string, Promise<FormMiniatureInput>>();
let activeRequests = 0;
const pendingQueue: Array<() => void> = [];

function pumpQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (next) next();
  }
}

function detailToMiniatureInput(detail: FormDetail): FormMiniatureInput {
  return {
    formId: detail.id,
    title: detail.title,
    description: detail.description,
    headerImage: detail.headerImage,
    questions: detail.questions || [],
    settings: detail.settings,
  };
}

function enqueueFormPreviewFetch(formId: string, revision: number): Promise<FormMiniatureInput> {
  const key = `${formId}:${revision}`;
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inFlightByKey.get(key);
  if (existing) return existing;

  const promise = new Promise<FormMiniatureInput>((resolve, reject) => {
    const run = () => {
      activeRequests += 1;
      getForm(formId)
        .then(({ form }) => {
          const entry = detailToMiniatureInput(form);
          for (const existingKey of previewCache.keys()) {
            if (existingKey.startsWith(`${formId}:`) && existingKey !== key) {
              previewCache.delete(existingKey);
            }
          }
          previewCache.set(key, entry);
          resolve(entry);
        })
        .catch(reject)
        .finally(() => {
          activeRequests = Math.max(0, activeRequests - 1);
          inFlightByKey.delete(key);
          pumpQueue();
        });
    };
    if (activeRequests < MAX_CONCURRENT_REQUESTS) run();
    else pendingQueue.push(run);
  });

  inFlightByKey.set(key, promise);
  return promise;
}

export function clearFormPreviewCache(formId?: string) {
  if (!formId) {
    previewCache.clear();
    return;
  }
  for (const key of previewCache.keys()) {
    if (key.startsWith(`${formId}:`)) previewCache.delete(key);
  }
}

function renderMiniQuestionBody(question: FormQuestion, compact: boolean) {
  const maxOpts = compact ? 2 : 3;
  switch (question.type) {
    case "multiple_choice": {
      const opts = (question.options || []).slice(0, maxOpts);
      const list = opts.length > 0 ? opts : [{ id: "o1", label: "Option 1" }];
      return (
        <div className="pf-mini-options">
          {list.map((opt) => (
            <div key={opt.id} className="pf-mini-opt">
              <span className="pf-mini-radio" />
              <span className="pf-mini-opt-txt">{opt.label}</span>
            </div>
          ))}
        </div>
      );
    }
    case "checkboxes": {
      const opts = (question.options || []).slice(0, maxOpts);
      const list = opts.length > 0 ? opts : [{ id: "o1", label: "Option 1" }];
      return (
        <div className="pf-mini-options">
          {list.map((opt) => (
            <div key={opt.id} className="pf-mini-opt">
              <span className="pf-mini-checkbox" />
              <span className="pf-mini-opt-txt">{opt.label}</span>
            </div>
          ))}
        </div>
      );
    }
    case "dropdown": {
      const first = question.options?.[0]?.label || "Choose";
      return (
        <div className="pf-mini-select">
          <span className="pf-mini-opt-txt">{first}</span>
          <span aria-hidden="true">▾</span>
        </div>
      );
    }
    case "linear_scale": {
      const min = question.scaleMin ?? 1;
      const max = Math.min((question.scaleMax ?? 5), min + 4);
      const steps: number[] = [];
      for (let i = min; i <= max; i += 1) steps.push(i);
      return (
        <div className="pf-mini-scale">
          {steps.map((step) => (
            <span key={step} className="pf-mini-scale-item">
              <span className="pf-mini-scale-num">{step}</span>
              <span className="pf-mini-radio" />
            </span>
          ))}
        </div>
      );
    }
    case "image_upload":
      return <div className="pf-mini-select">Upload image</div>;
    case "date":
      return <div className="pf-mini-line-input">mm / dd / yyyy</div>;
    case "time":
      return <div className="pf-mini-line-input">-- : --</div>;
    case "long_text":
      return <div className="pf-mini-line-input is-long">Long answer text</div>;
    case "short_text":
    default:
      return <div className="pf-mini-line-input">Short answer text</div>;
  }
}

/** Pure synchronous miniature renderer for starter templates and loaded form cards. */
export function FormContentMiniature({
  input,
  compact = false,
}: {
  input: FormMiniatureInput;
  compact?: boolean;
}) {
  const themeVars = useMemo(() => buildFormThemeCssVars(input.settings), [input.settings]);
  const resolvedTheme = useMemo(() => resolveFormTheme(input.settings), [input.settings]);
  const presetHeader = useMemo(
    () => getPresetHeaderById(resolvedTheme.presetHeader),
    [resolvedTheme.presetHeader],
  );

  const hasCustomBanner = Boolean(input.headerImage?.assetId && input.formId);
  const hasBanner = hasCustomBanner || Boolean(presetHeader);
  const maxQuestions = compact ? 2 : hasBanner ? 2 : 3;
  const visibleQuestions = input.questions.slice(0, maxQuestions);

  return (
    <div
      className={`pf-mini pf-themed-surface ${compact ? "is-compact" : ""}`}
      style={themeVars}
      aria-hidden="true"
    >
      <div className="pf-mini-stack">
        {hasBanner && (
          <div className="pf-mini-banner">
            {hasCustomBanner ? (
              <FormImageAsset
                assetId={input.headerImage!.assetId}
                formId={input.formId}
                alt=""
                className="pf-mini-banner-img"
              />
            ) : presetHeader ? (
              <img src={presetHeader.dataUri} alt="" className="pf-mini-banner-img" />
            ) : null}
          </div>
        )}

        <div className="pf-mini-title-card">
          <div className="pf-mini-accent-bar" />
          <div className="pf-mini-title-body">
            <div className="pf-mini-title">{input.title || "Untitled form"}</div>
            {input.description && (
              <div className="pf-mini-desc">{input.description}</div>
            )}
          </div>
        </div>

        {visibleQuestions.length === 0 ? (
          <div className="pf-mini-q-card">
            <div className="pf-mini-q-title"><span>Untitled Question</span></div>
            <div className="pf-mini-options">
              <div className="pf-mini-opt">
                <span className="pf-mini-radio" />
                <span className="pf-mini-opt-txt">Option 1</span>
              </div>
            </div>
          </div>
        ) : (
          visibleQuestions.map((q) => (
            <div key={q.id} className="pf-mini-q-card">
              <div className="pf-mini-q-title">
                <span>{q.title || "Untitled question"}</span>
                {q.required && <span className="pf-mini-req">*</span>}
              </div>
              {renderMiniQuestionBody(q, compact)}
            </div>
          ))
        )}

        {!compact && !hasBanner && visibleQuestions.length <= 1 && (
          <div className="pf-mini-brand-foot">Persora Forms</div>
        )}
      </div>
    </div>
  );
}

function FormMiniatureSkeleton({
  title,
  description,
  failed = false,
}: {
  title: string;
  description?: string;
  failed?: boolean;
}) {
  const themeVars = useMemo(() => buildFormThemeCssVars(null), []);
  return (
    <div className="pf-mini pf-mini--skeleton pf-themed-surface" style={themeVars} aria-hidden="true">
      <div className="pf-mini-stack">
        <div className="pf-mini-title-card">
          <div className="pf-mini-accent-bar" />
          <div className="pf-mini-title-body">
            <div className="pf-mini-title">{title || "Untitled form"}</div>
            {description && <div className="pf-mini-desc">{description}</div>}
          </div>
        </div>
        <div className="pf-mini-q-card">
          <span className="pf-mini-skel-line is-wide" />
          <span className="pf-mini-skel-line" />
        </div>
      </div>
      {failed && <div className="pf-mini-status">Preview unavailable</div>}
    </div>
  );
}

/** Blank Form starter card artwork matching Google Forms / Persora Table. */
export function BlankFormArtwork() {
  return (
    <div className="pf-blank-art" aria-hidden="true">
      <svg className="pf-blank-plus" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <rect x="19" y="6" width="6" height="14" rx="2" fill="var(--ds-primary)" />
        <rect x="24" y="19" width="14" height="6" rx="2" fill="var(--ds-emerald)" />
        <rect x="19" y="24" width="6" height="14" rx="2" fill="var(--ds-amber)" />
        <rect x="6" y="19" width="14" height="6" rx="2" fill="var(--ds-rose)" />
        <rect x="19" y="19" width="6" height="6" fill="var(--ds-primary)" />
      </svg>
    </div>
  );
}

/** Lazy-loaded, revision-cached miniature preview for an existing user form card. */
export function FormCardPreview({ form }: { form: FormSummary }) {
  const cacheKey = `${form.id}:${form.revision}`;
  const [entry, setEntry] = useState<FormMiniatureInput | null>(() => previewCache.get(cacheKey) || null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState<boolean>(() => Boolean(previewCache.get(cacheKey)));
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = previewCache.get(cacheKey);
    if (cached) {
      setEntry(cached);
      setFailed(false);
      setVisible(true);
      return;
    }
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "260px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cacheKey]);

  useEffect(() => {
    const cached = previewCache.get(cacheKey);
    if (cached) {
      setEntry(cached);
      setFailed(false);
      return;
    }
    if (!visible) return;
    let cancelled = false;
    setFailed(false);
    enqueueFormPreviewFetch(form.id, form.revision)
      .then((loaded) => {
        if (!cancelled) setEntry(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, form.id, form.revision, visible]);

  return (
    <div ref={hostRef} className="pf-card-preview-host">
      {entry ? (
        <FormContentMiniature input={entry} />
      ) : (
        <FormMiniatureSkeleton title={form.title} description={form.description} failed={failed} />
      )}
    </div>
  );
}
