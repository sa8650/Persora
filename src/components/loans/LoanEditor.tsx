// Loan Tracker — create / edit dialog with a live repayment preview and an
// explicit confirmation step before future installments are recalculated.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BellRing, Calculator, FileText, Info, Link2, Repeat, Search, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import {
  INTEREST_METHODS, LOAN_FREQUENCIES, LOAN_LIMITS, LoanValidationError, REMINDER_DAY_OPTIONS, calculationNote, fromCents, isScheduleChange, lockedCount,
  normalizeLoanInput, planRecalculation, previewLoan, toCents,
} from "../../../cloudflare/loan-rules.js";
import type { InstallmentLike, InterestMethod, LoanDirection, LoanFrequency, LoanInput, LoanTerms, NormalizedLoan, RecalculationPlan, Schedule } from "../../../cloudflare/loan-rules.js";
import type { VaultItem } from "../../types";
import { SECTION_BY_ID } from "../../data";
import type { EmailAvailability, Loan, LoanInstallment } from "../../lib/loan-api";
import { DirectionGlyph, FREQUENCY_LABELS, formatDay, formatMoney } from "./loan-visuals";

interface Draft {
  name: string;
  direction: LoanDirection;
  partyName: string;
  borrowerName: string;
  currency: string;
  principal: string;
  interestMethod: InterestMethod;
  interestRate: string;
  installmentCount: string;
  frequency: LoanFrequency;
  startDate: string;
  firstDueDate: string;
  reference: string;
  notes: string;
  documentIds: string[];
  reminderDaysBefore: string;
  overdueAlerts: boolean;
  reminderEmail: boolean;
  nextDueDate: string;
}

function draftFrom(loan: Loan | null, today: string, userName: string, currency: string): Draft {
  if (!loan) {
    return {
      name: "", direction: "borrowed", partyName: "", borrowerName: userName, currency, principal: "", interestMethod: "none", interestRate: "",
      installmentCount: "12", frequency: "monthly", startDate: today, firstDueDate: "", reference: "", notes: "", documentIds: [],
      reminderDaysBefore: "", overdueAlerts: false, reminderEmail: false, nextDueDate: "",
    };
  }
  return {
    name: loan.name, direction: loan.direction, partyName: loan.partyName, borrowerName: loan.borrowerName, currency: loan.currency,
    principal: loan.principal.toFixed(2), interestMethod: loan.interestMethod, interestRate: loan.interestRate === null ? "" : String(loan.interestRate),
    installmentCount: String(loan.installmentCount), frequency: loan.frequency, startDate: loan.startDate, firstDueDate: loan.firstDueDate,
    reference: loan.reference, notes: loan.notes, documentIds: loan.documentIds,
    reminderDaysBefore: loan.reminderDaysBefore === null ? "" : String(loan.reminderDaysBefore), overdueAlerts: loan.overdueAlerts, reminderEmail: loan.reminderEmail,
    nextDueDate: "",
  };
}

function draftInput(draft: Draft): LoanInput {
  const reminderOn = draft.reminderDaysBefore !== "" || draft.overdueAlerts;
  return {
    name: draft.name, direction: draft.direction, partyName: draft.partyName, borrowerName: draft.borrowerName, currency: draft.currency,
    principal: draft.principal, interestMethod: draft.interestMethod, interestRate: draft.interestMethod === "none" ? "" : draft.interestRate,
    installmentCount: draft.installmentCount === "" ? "" : Number(draft.installmentCount), frequency: draft.frequency, startDate: draft.startDate,
    firstDueDate: draft.firstDueDate, reference: draft.reference, notes: draft.notes, documentIds: draft.documentIds,
    reminderDaysBefore: draft.reminderDaysBefore === "" ? null : Number(draft.reminderDaysBefore), overdueAlerts: draft.overdueAlerts,
    reminderEmail: reminderOn && draft.reminderEmail,
  };
}

const centsRows = (installments: LoanInstallment[]): InstallmentLike[] => installments.map((row) => ({
  number: row.number, dueDate: row.dueDate, principalCents: toCents(row.principal), interestCents: toCents(row.interest),
  amountCents: toCents(row.amount), paidCents: toCents(row.paid), paymentCount: row.paymentCount,
}));
const termsOf = (loan: Loan): LoanTerms => ({
  principalCents: toCents(loan.principal), interestMethod: loan.interestMethod, interestRate: loan.interestRate, installmentCount: loan.installmentCount,
  frequency: loan.frequency, firstDueDate: loan.firstDueDate, anchorDate: loan.anchorDate, anchorNumber: loan.anchorNumber,
});

type Evaluation =
  | { ok: true; normalized: NormalizedLoan; schedule: Schedule; scheduleChange: boolean; plan: RecalculationPlan | null }
  | { ok: false; error: LoanValidationError };

function evaluate(draft: Draft, loan: Loan | null, installments: LoanInstallment[], today: string): Evaluation {
  try {
    const normalized = normalizeLoanInput(draftInput(draft));
    const schedule = previewLoan(normalized);
    if (!loan) return { ok: true, normalized, schedule, scheduleChange: false, plan: null };
    const rows = centsRows(installments);
    const locked = lockedCount(rows, today);
    const nextDueDate = locked > 0 && draft.nextDueDate ? draft.nextDueDate : null;
    const currentNextDueDate = rows.find((row) => row.number === locked + 1)?.dueDate || null;
    const scheduleChange = isScheduleChange(termsOf(loan), normalized, { nextDueDate, currentNextDueDate });
    const plan = scheduleChange ? planRecalculation(termsOf(loan), rows, normalized, { today, nextDueDate }) : null;
    return { ok: true, normalized, schedule, scheduleChange, plan };
  } catch (error) {
    return { ok: false, error: error instanceof LoanValidationError ? error : new LoanValidationError("Check the loan details.") };
  }
}

type Permission = NotificationPermission | "unsupported";
const readPermission = (): Permission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export interface LoanEditorProps {
  loan: Loan | null;
  installments: LoanInstallment[];
  today: string;
  userName: string;
  defaultCurrency: string;
  currencies: string[];
  email: EmailAvailability;
  documents: VaultItem[];
  busy: boolean;
  error: { message: string; field?: string } | null;
  onSave: (input: LoanInput, options: { recalculate: boolean; nextDueDate: string | null }) => void;
  onClose: () => void;
}

export default function LoanEditor({ loan, installments, today, userName, defaultCurrency, currencies, email, documents, busy, error, onSave, onClose }: LoanEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(loan, today, userName, defaultCurrency));
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [permission, setPermission] = useState<Permission>(readPermission);
  const nameRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Draft>) => { setDraft((current) => ({ ...current, ...patch })); setConfirming(false); };

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      if (confirming) setConfirming(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, confirming, onClose]);

  const result = useMemo(() => evaluate(draft, loan, installments, today), [draft, loan, installments, today]);
  const locked = useMemo(() => (loan ? lockedCount(centsRows(installments), today) : 0), [loan, installments, today]);
  const fieldError = (field: string) => {
    if (error?.field === field) return error.message;
    if (submitted && !result.ok && result.error.field === field) return result.error.message;
    return null;
  };
  const generalError = (error && !error.field ? error.message : null) || (submitted && !result.ok && !result.error.field ? result.error.message : null);

  const setDirection = (direction: LoanDirection) => {
    if (direction === draft.direction) return;
    // Keep "me" on the right side when switching between borrowed and lent.
    const swap = (draft.direction === "borrowed" && draft.borrowerName === userName) || (draft.direction === "lent" && draft.partyName === userName);
    update(swap ? { direction, partyName: draft.borrowerName, borrowerName: draft.partyName } : { direction });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!result.ok) {
      const field = result.error.field;
      if (field) document.getElementById(`ln-field-${field}`)?.focus();
      return;
    }
    if (loan && result.scheduleChange && !confirming) { setConfirming(true); return; }
    onSave(draftInput(draft), { recalculate: Boolean(loan && result.scheduleChange), nextDueDate: loan && locked > 0 && draft.nextDueDate ? draft.nextDueDate : null });
  };

  const requestPermission = async () => {
    try { setPermission(await Notification.requestPermission()); } catch { setPermission("unsupported"); }
  };

  const docsById = useMemo(() => new Map(documents.map((item) => [item.id, item])), [documents]);
  const docMatches = useMemo(() => {
    const query = docQuery.trim().toLowerCase();
    if (!query) return [];
    return documents.filter((item) => !draft.documentIds.includes(item.id) && `${item.title} ${item.subtitle || ""} ${item.file?.name || ""}`.toLowerCase().includes(query)).slice(0, 6);
  }, [docQuery, documents, draft.documentIds]);

  const counterpart = draft.direction === "borrowed" ? "partyName" : "borrowerName";
  const reminderOn = draft.reminderDaysBefore !== "" || draft.overdueAlerts;
  const preview = result.ok ? result.schedule : null;
  const currency = result.ok ? result.normalized.currency : draft.currency;
  const plan = result.ok ? result.plan : null;
  const lockedPaid = installments.slice(0, plan?.lockedCount || 0);

  return <ModalPortal>
    <ItemModalShell
      labelledBy="ln-editor-title" className="ln-editor" backdropClassName="ln-editor-backdrop"
      icon={<DirectionGlyph direction={draft.direction} size={22}/>} iconClassName="ln-modal-icon" eyebrow="Loan Tracker"
      title={confirming ? "Confirm the new schedule" : loan ? "Edit loan" : "New loan"} onClose={onClose} closeDisabled={busy} dismissable={!busy}
    >
      <form className="editor-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="vault-modal-scroll">
          {confirming && plan && loan ? <div className="ln-form">
            <p className="ln-hint"><Repeat size={13} aria-hidden="true"/><span>
              {plan.lockedCount > 0
                ? `Installments 1–${plan.lockedCount} stay exactly as they are (paid, partly paid or already due), with their payment history. Only installments ${plan.lockedCount + 1}–${plan.lockedCount + plan.future.length} are recalculated.`
                : `No installment has a payment or has fallen due yet, so all ${plan.future.length} installments are recalculated.`}
            </span></p>
            <dl className="ln-compare">
              <div><dt>Total scheduled</dt><dd><s>{formatMoney(fromCents(plan.lockedTotalCents + plan.previousFutureTotalCents), loan.currency)}</s> → <b>{formatMoney(fromCents(plan.newScheduledTotalCents), currency)}</b></dd></div>
              <div><dt>Remaining installments</dt><dd><s>{plan.previousFutureCount}</s> → <b>{plan.future.length}</b></dd></div>
              <div><dt>Next installment</dt><dd><b>{formatDay(plan.nextDueDate)}</b> · {formatMoney(fromCents(plan.future[0].amountCents), currency)}</dd></div>
              <div><dt>Final installment</dt><dd><b>{formatDay(plan.finalDueDate)}</b> · {formatMoney(fromCents(plan.finalCents), currency)}</dd></div>
            </dl>
            <div className="ln-table-wrap">
              <table className="ln-mini-table">
                <caption className="ln-visually-hidden">Recalculated installments</caption>
                <thead><tr><th scope="col">#</th><th scope="col">Due</th><th scope="col" className="is-num">Amount</th></tr></thead>
                <tbody>
                  {lockedPaid.length > 0 && <tr className="is-locked"><td>1–{plan.lockedCount}</td><td colSpan={2}>Kept unchanged</td></tr>}
                  {(plan.future.length > 7 ? [...plan.future.slice(0, 5), null, plan.future[plan.future.length - 1]] : plan.future).map((row, index) => row
                    ? <tr key={row.number}><td>{row.number}</td><td>{formatDay(row.dueDate)}</td><td className="is-num">{formatMoney(fromCents(row.amountCents), currency)}</td></tr>
                    : <tr key={`gap-${index}`} className="is-gap"><td colSpan={3}>…</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>The original terms stay on record, and this change is added to the loan's history. Figures are estimates for tracking, not amounts confirmed by a lender.</span></p>
            {generalError && <p className="ln-form-error" role="alert">{generalError}</p>}
          </div> : <div className="ln-form">
            <div className="ln-segment" role="radiogroup" aria-label="Loan type">
              {(["borrowed", "lent"] as const).map((key) => <button key={key} type="button" role="radio" aria-checked={draft.direction === key} className={draft.direction === key ? "is-active" : ""} onClick={() => setDirection(key)}>
                {key === "borrowed" ? "I borrowed" : "I lent"}</button>)}
            </div>
            <label className="field-label"><span>Name or purpose<span className="required-star">*</span></span>
              <input id="ln-field-name" ref={nameRef} value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={LOAN_LIMITS.name}
                placeholder={draft.direction === "borrowed" ? "e.g. Motorbike loan" : "e.g. Loan to Rafi for tuition"} aria-invalid={Boolean(fieldError("name"))} autoComplete="off"/>
              {fieldError("name") && <span className="ln-field-error" role="alert">{fieldError("name")}</span>}
            </label>
            <div className="ln-grid-2">
              <label className="field-label"><span>Lender<span className="required-star">*</span></span>
                <input id="ln-field-partyName" value={draft.partyName} onChange={(event) => update({ partyName: event.target.value })} maxLength={LOAN_LIMITS.party}
                  placeholder={draft.direction === "borrowed" ? "Bank, person or company" : "You"} aria-invalid={Boolean(fieldError("partyName"))} autoComplete="off"/>
                {fieldError("partyName") && <span className="ln-field-error" role="alert">{fieldError("partyName")}</span>}
              </label>
              <label className="field-label"><span>Borrower<span className="required-star">*</span></span>
                <input id="ln-field-borrowerName" value={draft.borrowerName} onChange={(event) => update({ borrowerName: event.target.value })} maxLength={LOAN_LIMITS.borrower}
                  placeholder={draft.direction === "lent" ? "Who you lent to" : "You"} aria-invalid={Boolean(fieldError("borrowerName"))} autoComplete="off"/>
                {fieldError("borrowerName") && <span className="ln-field-error" role="alert">{fieldError("borrowerName")}</span>}
              </label>
            </div>

            <div className="ln-grid-amount">
              <label className="field-label"><span>Principal amount<span className="required-star">*</span></span>
                <input id="ln-field-principal" inputMode="decimal" value={draft.principal} onChange={(event) => update({ principal: event.target.value })} placeholder="100000"
                  aria-invalid={Boolean(fieldError("principal"))} autoComplete="off"/>
                {fieldError("principal") && <span className="ln-field-error" role="alert">{fieldError("principal")}</span>}
              </label>
              <label className="field-label"><span>Currency</span>
                <select id="ln-field-currency" value={draft.currency} onChange={(event) => update({ currency: event.target.value })}>
                  {(currencies.includes(draft.currency) ? currencies : [draft.currency, ...currencies]).map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="ln-fieldset">
              <legend>Interest</legend>
              <div className="ln-segment" role="radiogroup" aria-label="Interest method">
                {INTEREST_METHODS.map((key) => <button key={key} type="button" role="radio" aria-checked={draft.interestMethod === key} className={draft.interestMethod === key ? "is-active" : ""}
                  onClick={() => update({ interestMethod: key })}>{key === "none" ? "None" : key === "flat" ? "Flat" : "Reducing"}</button>)}
              </div>
              {draft.interestMethod !== "none" && <label className="ln-inline-field">
                <input id="ln-field-interestRate" inputMode="decimal" value={draft.interestRate} onChange={(event) => update({ interestRate: event.target.value })} placeholder="12"
                  aria-label="Annual interest rate (%)" aria-invalid={Boolean(fieldError("interestRate"))}/>
                <span>% per year</span>
              </label>}
              {(fieldError("interestRate") || fieldError("interestMethod")) && <span className="ln-field-error" role="alert">{fieldError("interestRate") || fieldError("interestMethod")}</span>}
            </fieldset>

            <div className="ln-grid-2">
              <label className="field-label"><span>Number of installments<span className="required-star">*</span></span>
                <input id="ln-field-installmentCount" type="number" inputMode="numeric" min={1} max={LOAN_LIMITS.installmentsMax} step={1} value={draft.installmentCount}
                  onChange={(event) => update({ installmentCount: event.target.value })} aria-invalid={Boolean(fieldError("installmentCount"))}/>
                {fieldError("installmentCount") && <span className="ln-field-error" role="alert">{fieldError("installmentCount")}</span>}
              </label>
              <label className="field-label"><span>Frequency</span>
                <select id="ln-field-frequency" value={draft.frequency} onChange={(event) => update({ frequency: event.target.value as LoanFrequency })}>
                  {LOAN_FREQUENCIES.map((key) => <option key={key} value={key}>{FREQUENCY_LABELS[key]}</option>)}
                </select>
              </label>
              <label className="field-label"><span>Start date<span className="required-star">*</span></span>
                <input id="ln-field-startDate" type="date" value={draft.startDate} onChange={(event) => update({ startDate: event.target.value })} aria-invalid={Boolean(fieldError("startDate"))}/>
                {fieldError("startDate") && <span className="ln-field-error" role="alert">{fieldError("startDate")}</span>}
              </label>
              <label className="field-label"><span>First installment date<span className="required-star">*</span></span>
                <input id="ln-field-firstDueDate" type="date" value={draft.firstDueDate} min={draft.startDate || undefined} onChange={(event) => update({ firstDueDate: event.target.value })}
                  aria-invalid={Boolean(fieldError("firstDueDate"))} disabled={Boolean(loan && locked > 0)}/>
                {fieldError("firstDueDate") && <span className="ln-field-error" role="alert">{fieldError("firstDueDate")}</span>}
              </label>
            </div>
            {loan && locked > 0 && <label className="field-label"><span>Next installment date <small className="ln-optional">optional — only for schedule changes</small></span>
              <input id="ln-field-nextDueDate" type="date" value={draft.nextDueDate} min={installments[locked - 1]?.dueDate} onChange={(event) => update({ nextDueDate: event.target.value })}
                aria-invalid={Boolean(fieldError("nextDueDate"))}/>
              <span className="ln-hint">Installments 1–{locked} are paid, partly paid or already due, so they keep their dates and amounts. Leave this empty to keep the current rhythm.</span>
              {fieldError("nextDueDate") && <span className="ln-field-error" role="alert">{fieldError("nextDueDate")}</span>}
            </label>}

            <section className="ln-preview" aria-live="polite" aria-label="Repayment preview">
              <div className="ln-preview-head"><Calculator size={14} aria-hidden="true"/><b>Estimated repayment</b></div>
              {preview && result.ok ? <>
                <dl className="ln-preview-grid">
                  <div><dt>Installment</dt><dd>{formatMoney(fromCents(preview.regularCents), currency)}{preview.finalCents !== preview.regularCents && <small>final {formatMoney(fromCents(preview.finalCents), currency)}</small>}</dd></div>
                  <div><dt>Installments</dt><dd>{preview.installments.length} {FREQUENCY_LABELS[result.normalized.frequency].toLowerCase()}</dd></div>
                  <div><dt>Interest</dt><dd>{formatMoney(fromCents(preview.interestCents), currency)}</dd></div>
                  <div><dt>Total repayment</dt><dd>{formatMoney(fromCents(preview.totalCents), currency)}</dd></div>
                  <div><dt>First due</dt><dd>{formatDay(preview.firstDueDate)}</dd></div>
                  <div><dt>Final due</dt><dd>{formatDay(preview.finalDueDate)}</dd></div>
                </dl>
                <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>{calculationNote(result.normalized.interestMethod, result.normalized.frequency)} Amounts are rounded to the cent and the final installment absorbs the rounding. Due dates keep the same calendar day where possible (the 31st falls back to the month's last day).
                  {" "}This is an estimate for tracking — your lender's figures can differ because of fees, day-count rules or their own rounding.</span></p>
                {loan && result.scheduleChange && <p className="ln-hint is-warn"><Repeat size={13} aria-hidden="true"/><span>These changes affect the schedule. You'll review the recalculated installments before anything is saved.</span></p>}
              </> : <p className="ln-preview-empty">{!result.ok && !submitted && (result.error.field === "principal" || result.error.field === "firstDueDate" || result.error.field === "installmentCount" || result.error.field === "interestRate")
                ? result.error.message : `Enter the amount, installments and first date to see the estimate.`}</p>}
            </section>

            <details className="ln-more" open={Boolean(loan && (loan.reference || loan.notes || loan.documentIds.length))}>
              <summary>Reference, notes and documents</summary>
              <div className="ln-form ln-more-body">
                <label className="field-label"><span>Reference <small className="ln-optional">optional</small></span>
                  <input id="ln-field-reference" value={draft.reference} onChange={(event) => update({ reference: event.target.value })} maxLength={LOAN_LIMITS.reference} placeholder="Agreement or account number" autoComplete="off"/>
                </label>
                <label className="field-label"><span>Notes <small className="ln-optional">optional</small></span>
                  <textarea id="ln-field-notes" rows={2} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} maxLength={LOAN_LIMITS.notes}/>
                  {fieldError("notes") && <span className="ln-field-error" role="alert">{fieldError("notes")}</span>}
                </label>
                <div className="field-label"><span>Linked documents <small className="ln-optional">from your Persora vault</small></span>
                  {draft.documentIds.length > 0 && <ul className="ln-doc-chips">
                    {draft.documentIds.map((id) => {
                      const item = docsById.get(id);
                      return <li key={id}><FileText size={13} aria-hidden="true"/><span>{item ? item.title : "Record no longer in your vault"}</span>
                        <button type="button" onClick={() => update({ documentIds: draft.documentIds.filter((entry) => entry !== id) })} aria-label={`Unlink ${item ? item.title : "record"}`}><X size={12}/></button></li>;
                    })}
                  </ul>}
                  {draft.documentIds.length < LOAN_LIMITS.documents && <div className="ln-doc-search">
                    <Search size={14} aria-hidden="true"/>
                    <input id="ln-field-documentIds" type="search" value={docQuery} onChange={(event) => setDocQuery(event.target.value)} placeholder={documents.length ? "Search documents to link" : "No vault records yet"} disabled={!documents.length} aria-label="Search documents to link"/>
                  </div>}
                  {docMatches.length > 0 && <ul className="ln-doc-results" role="listbox" aria-label="Matching documents">
                    {docMatches.map((item) => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={() => { update({ documentIds: [...draft.documentIds, item.id] }); setDocQuery(""); }}>
                      <Link2 size={13} aria-hidden="true"/><span>{item.title}</span><small>{SECTION_BY_ID[item.section]?.label || ""}</small></button></li>)}
                  </ul>}
                  {docQuery.trim() && !docMatches.length && <span className="ln-hint">No matching records.</span>}
                  {fieldError("documentIds") && <span className="ln-field-error" role="alert">{fieldError("documentIds")}</span>}
                </div>
              </div>
            </details>

            <fieldset className="ln-fieldset">
              <legend>Reminders</legend>
              <label className="ln-inline-field"><span>Remind me</span>
                <select id="ln-field-reminderDaysBefore" value={draft.reminderDaysBefore} onChange={(event) => update({ reminderDaysBefore: event.target.value })}>
                  <option value="">Off</option>
                  {REMINDER_DAY_OPTIONS.map((days) => <option key={days} value={String(days)}>{days === 0 ? "On the due date" : `${days} day${days === 1 ? "" : "s"} before`}</option>)}
                </select>
              </label>
              <label className="ln-switch"><input type="checkbox" checked={draft.overdueAlerts} onChange={(event) => update({ overdueAlerts: event.target.checked })}/><span>Tell me when an installment is overdue</span></label>
              {reminderOn && <>
                <label className={`ln-switch ${email.available ? "" : "is-disabled"}`}>
                  <input type="checkbox" checked={draft.reminderEmail && email.available} disabled={!email.available} onChange={(event) => update({ reminderEmail: event.target.checked })}/>
                  <span>Also send an email</span>
                </label>
                <div className="ln-hint ln-reminder-help">
                  <BellRing size={13} aria-hidden="true"/>
                  <span>
                    Reminders arrive at 9:00 in your time zone, in the notification bell, and are skipped once the installment is paid. They never record a payment.
                    {" "}{permission === "granted" ? "Desktop alerts are on for this browser." : permission === "denied" ? "Desktop alerts are blocked in your browser settings." : permission === "unsupported" ? "This browser can't show desktop alerts." : ""}
                    {!email.available && email.reason ? ` ${email.reason}` : ""}
                  </span>
                  {permission === "default" && <button type="button" className="ln-link-button" onClick={() => void requestPermission()}>Allow desktop alerts</button>}
                </div>
              </>}
              {fieldError("reminderDaysBefore") && <span className="ln-field-error" role="alert">{fieldError("reminderDaysBefore")}</span>}
            </fieldset>
            {loan && <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>Editing never changes recorded payments. The {counterpart === "partyName" ? "lender" : "borrower"}, notes and reminders save directly.</span></p>}
            {generalError && <p className="ln-form-error" role="alert">{generalError}</p>}
          </div>}
        </div>
        <div className="editor-form-footer">
          <div/>
          <div className="editor-actions">
            {confirming
              ? <button type="button" className="quiet-button" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
              : <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>}
            <button type="submit" className="editor-submit" disabled={busy}>
              {busy ? <><span className="spinner"/> Saving…</> : confirming ? "Confirm & recalculate" : loan ? (result.ok && result.scheduleChange ? "Review changes" : "Save Changes") : "Create Loan"}
            </button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
