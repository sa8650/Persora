// Loan Tracker — record / correct / reverse a payment, and close a loan with a settlement note.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { HandCoins, Info, RotateCcw, Undo2 } from "lucide-react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import { LOAN_LIMITS, LoanValidationError, fromCents, normalizePaymentInput, toCents } from "../../../cloudflare/loan-rules.js";
import type { Loan, LoanInstallment, LoanPayment, PaymentInput } from "../../lib/loan-api";
import { PAYMENT_METHODS, formatDay, formatMoney } from "./loan-visuals";
import { Spinner } from "@/components/ui/spinner";

const newId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export type PaymentDialogMode =
  | { mode: "pay"; installment: LoanInstallment }
  | { mode: "correct"; installment: LoanInstallment; payment: LoanPayment }
  | { mode: "reverse"; installment: LoanInstallment; payment: LoanPayment };

function useEscape(busy: boolean, onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
}

export default function PaymentDialog({ loan, today, target, busy, error, onRecord, onCorrect, onReverse, onClose }: {
  loan: Loan;
  today: string;
  target: PaymentDialogMode;
  busy: boolean;
  error: { message: string; field?: string } | null;
  onRecord: (installment: LoanInstallment, payment: PaymentInput) => void;
  onCorrect: (payment: LoanPayment, reason: string, replacement: PaymentInput) => void;
  onReverse: (payment: LoanPayment, reason: string) => void;
  onClose: () => void;
}) {
  const { installment } = target;
  const existing = target.mode === "pay" ? null : target.payment;
  // One id per dialog: a retried submission (e.g. after a dropped connection) replays instead of duplicating.
  const [paymentId] = useState(newId);
  const remainingCents = toCents(installment.remaining) + (target.mode === "correct" && existing ? toCents(existing.amount) : 0);
  const [amount, setAmount] = useState(() => target.mode === "pay" ? installment.remaining.toFixed(2) : existing ? existing.amount.toFixed(2) : "");
  const [paidOn, setPaidOn] = useState(() => (existing ? existing.paidOn : today));
  const [method, setMethod] = useState(existing?.method || "");
  const [reference, setReference] = useState(existing?.reference || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEscape(busy, onClose);
  useEffect(() => { firstRef.current?.focus(); firstRef.current?.select(); }, []);

  const check = useMemo(() => {
    if (target.mode === "reverse") return null;
    try { normalizePaymentInput({ amount, paidOn, method, reference, notes }, { today, startDate: loan.startDate, remainingCents }); return null; }
    catch (problem) { return problem instanceof LoanValidationError ? problem : new LoanValidationError("Check the payment."); }
  }, [amount, paidOn, method, reference, notes, today, loan.startDate, remainingCents, target.mode]);
  const reasonError = target.mode !== "pay" && !reason.trim() ? "Say why, so the history stays clear." : null;
  const fieldError = (field: string) => (error?.field === field ? error.message : submitted && check?.field === field ? check.message : null);
  const generalError = (error && !error.field ? error.message : null) || (submitted && check && !check.field ? check.message : null);
  const amountCents = toCents(amount);
  const fullAfter = Number.isFinite(amountCents) && amountCents === remainingCents;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (check || (target.mode !== "pay" && reasonError)) {
      const field = check?.field || "reason";
      document.getElementById(`ln-pay-${field}`)?.focus();
      return;
    }
    const payment: PaymentInput = { id: paymentId, amount: amount.trim(), paidOn, method: method.trim(), reference: reference.trim(), notes: notes.trim() };
    if (target.mode === "pay") onRecord(installment, payment);
    else if (target.mode === "correct") onCorrect(target.payment, reason.trim(), payment);
    else onReverse(target.payment, reason.trim());
  };

  const title = target.mode === "pay" ? `Record payment · installment ${installment.number}` : target.mode === "correct" ? "Correct payment" : "Reverse payment";
  const Icon = target.mode === "pay" ? HandCoins : target.mode === "correct" ? RotateCcw : Undo2;

  return <ModalPortal>
    <ItemModalShell labelledBy="ln-pay-title" className="ln-editor ln-pay" backdropClassName="ln-editor-backdrop" icon={<Icon size={18}/>} iconClassName="ln-modal-icon"
      eyebrow={loan.name} title={title} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="vault-modal-scroll">
          <div className="ln-form">
            <dl className="ln-pay-facts">
              <div><dt>Due</dt><dd>{formatDay(installment.dueDate)}</dd></div>
              <div><dt>Scheduled</dt><dd>{formatMoney(installment.amount, loan.currency)}</dd></div>
              <div><dt>Paid</dt><dd>{formatMoney(installment.paid, loan.currency)}</dd></div>
              <div><dt>Remaining</dt><dd><b>{formatMoney(installment.remaining, loan.currency)}</b></dd></div>
            </dl>
            {existing && <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>
              {target.mode === "correct"
                ? `The ${formatMoney(existing.amount, loan.currency)} payment from ${formatDay(existing.paidOn)} is kept in the history as reversed, and the corrected payment is recorded in its place.`
                : `The ${formatMoney(existing.amount, loan.currency)} payment from ${formatDay(existing.paidOn)} stays in the history, marked reversed, and no longer counts toward this installment.`}
            </span></p>}
            {target.mode !== "reverse" && <>
              <div className="ln-grid-2">
                <label className="field-label"><span>Amount<span className="required-star">*</span></span>
                  <input id="ln-pay-amount" ref={firstRef} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(fieldError("amount"))} autoComplete="off"/>
                  {fieldError("amount") && <span className="ln-field-error" role="alert">{fieldError("amount")}</span>}
                </label>
                <label className="field-label"><span>Paid on<span className="required-star">*</span></span>
                  <input id="ln-pay-paidOn" type="date" value={paidOn} max={today} min={loan.startDate} onChange={(event) => setPaidOn(event.target.value)} aria-invalid={Boolean(fieldError("paidOn"))}/>
                  {fieldError("paidOn") && <span className="ln-field-error" role="alert">{fieldError("paidOn")}</span>}
                </label>
              </div>
              <div className="ln-quick-amounts">
                <button type="button" className={`ln-chip ${fullAfter ? "is-active" : ""}`} onClick={() => setAmount(fromCents(remainingCents).toFixed(2))}>Full remaining · {formatMoney(fromCents(remainingCents), loan.currency)}</button>
                {Number.isFinite(amountCents) && amountCents > 0 && amountCents < remainingCents && <span className="ln-hint">Partial payment — {formatMoney(fromCents(remainingCents - amountCents), loan.currency)} will remain due.</span>}
              </div>
              <div className="ln-grid-2">
                <label className="field-label"><span>Method <small className="ln-optional">optional</small></span>
                  <input id="ln-pay-method" list="ln-payment-methods" value={method} onChange={(event) => setMethod(event.target.value)} maxLength={LOAN_LIMITS.paymentMethod} autoComplete="off"/>
                  <datalist id="ln-payment-methods">{PAYMENT_METHODS.map((entry) => <option key={entry} value={entry}/>)}</datalist>
                </label>
                <label className="field-label"><span>Reference <small className="ln-optional">optional</small></span>
                  <input id="ln-pay-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={LOAN_LIMITS.paymentReference} placeholder="Transaction ID" autoComplete="off"/>
                </label>
              </div>
              <label className="field-label"><span>Notes <small className="ln-optional">optional</small></span>
                <input id="ln-pay-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={LOAN_LIMITS.paymentNote} autoComplete="off"/>
              </label>
            </>}
            {target.mode !== "pay" && <label className="field-label"><span>Reason<span className="required-star">*</span></span>
              <input id="ln-pay-reason" ref={target.mode === "reverse" ? firstRef : undefined} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={LOAN_LIMITS.reversalReason}
                placeholder={target.mode === "correct" ? "e.g. Entered the wrong amount" : "e.g. Payment bounced"} aria-invalid={Boolean(submitted && reasonError) || error?.field === "reason"}/>
              {((submitted && reasonError) || fieldError("reason")) && <span className="ln-field-error" role="alert">{fieldError("reason") || reasonError}</span>}
            </label>}
            {target.mode === "pay" && <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>Payments apply to this installment only and can't exceed what remains. Extra money goes against the next installment as its own payment.</span></p>}
            {generalError && <p className="ln-form-error" role="alert">{generalError}</p>}
          </div>
        </div>
        <div className="editor-form-footer">
          <div/>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={target.mode === "reverse" ? "ln-danger-button" : "editor-submit"} disabled={busy}>
              {busy ? <><Spinner className="size-3.5"/> Saving…</> : target.mode === "pay" ? "Record Payment" : target.mode === "correct" ? "Save Correction" : "Reverse Payment"}
            </button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}

/** Close a loan that still has money outstanding, with an explicit settlement note. */
export function SettleDialog({ loan, busy, error, onConfirm, onClose }: {
  loan: Loan;
  busy: boolean;
  error: { message: string; field?: string } | null;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEscape(busy, onClose);
  const missing = !note.trim();
  return <ModalPortal>
    <ItemModalShell labelledBy="ln-settle-title" className="ln-editor ln-pay" backdropClassName="ln-editor-backdrop" icon={<HandCoins size={18}/>} iconClassName="ln-modal-icon"
      eyebrow={loan.name} title="Close with a settlement" onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); setSubmitted(true); if (!missing) onConfirm(note.trim()); }}>
        <div className="vault-modal-scroll">
          <div className="ln-form">
            <p className="ln-hint"><Info size={13} aria-hidden="true"/><span>
              {formatMoney(loan.summary.outstanding, loan.currency)} is still outstanding. Closing records it as settled or written off — no installment is marked paid and the payment history stays as it is. You can reopen the loan later.
            </span></p>
            <label className="field-label"><span>Settlement note<span className="required-star">*</span></span>
              <textarea id="ln-settle-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={LOAN_LIMITS.closeNote} autoFocus
                placeholder="e.g. Settled early with the bank for a lump sum; remaining interest waived" aria-invalid={Boolean(submitted && missing)}/>
              {((submitted && missing) || error?.field === "note") && <span className="ln-field-error" role="alert">{error?.field === "note" ? error.message : "Add a settlement note explaining why the loan is closed."}</span>}
            </label>
            {error && !error.field && <p className="ln-form-error" role="alert">{error.message}</p>}
          </div>
        </div>
        <div className="editor-form-footer">
          <div/>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="editor-submit" disabled={busy}>{busy ? <><Spinner className="size-3.5"/> Closing…</> : "Close Loan"}</button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
