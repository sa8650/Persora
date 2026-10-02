import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Check, CreditCard, HardDrive, LockKeyhole, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { BillingSnapshot, PaymentMethod, PaymentRecord, SubscriptionPlan } from "../types";
import { formatDate, humanSize } from "../lib/utils";
import { loadBilling, submitPaymentRequest } from "../lib/cloud";
import ModalPortal from "./ModalPortal";

type BillingPeriod = "monthly" | "yearly";

export default function BillingView({ initialPlanId, notify }: { initialPlanId?: string; notify: (message: string, kind?: "success" | "error") => void }) {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId || "");
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [durationCount, setDurationCount] = useState("1");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadBilling();
      setSnapshot(result);
      setMethodId((current) => result.paymentMethods?.some((entry) => entry.id === current) ? current : result.paymentMethods?.[0]?.id || "");
      setSelectedPlanId((current) => {
        if (initialPlanId && result.plans.some((plan) => plan.id === initialPlanId)) return initialPlanId;
        if (current && result.plans.some((plan) => plan.id === current)) return current;
        const preferred = result.plans.find((plan) => plan.monthly_price > 0 && plan.id !== result.subscription.plan_id) || result.plans.find((plan) => plan.monthly_price > 0) || result.plans[0];
        return preferred?.id || "";
      });
    } catch (error) { notify(error instanceof Error ? error.message : "Billing details couldn't load.", "error"); }
    finally { setLoading(false); }
  }, [initialPlanId, notify]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setCheckoutOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [checkoutOpen]);

  const selectedPlan = useMemo(() => snapshot?.plans.find((plan) => plan.id === selectedPlanId) || null, [snapshot?.plans, selectedPlanId]);
  const minTermMonths = Math.max(1, Math.trunc(Number(snapshot?.billingSettings.minTermMonths) || 1));
  const maxTermMonths = Math.min(120, Math.max(minTermMonths, Math.trunc(Number(snapshot?.billingSettings.maxTermMonths) || 12)));
  const periodMonths = billingPeriod === "yearly" ? 12 : 1;
  const minDuration = Math.ceil(minTermMonths / periodMonths);
  const maxDuration = Math.floor(maxTermMonths / periodMonths);
  const periodUnavailable = maxDuration < minDuration;
  const parsedDuration = Number(durationCount);
  const validDuration = !periodUnavailable && Number.isInteger(parsedDuration) && parsedDuration >= minDuration && parsedDuration <= maxDuration;
  const safeDuration = validDuration ? parsedDuration : Math.max(minDuration, Math.min(maxDuration, Number.isInteger(parsedDuration) ? parsedDuration : minDuration));
  const termMonths = safeDuration * periodMonths;
  const estimatedTotal = selectedPlan ? Math.round(selectedPlan.monthly_price * termMonths * 100) / 100 : 0;
  const paymentMethods: PaymentMethod[] = Array.isArray(snapshot?.paymentMethods) ? snapshot.paymentMethods : [];
  const selectedMethod = paymentMethods.find((entry) => entry.id === methodId);
  const hasPendingPayment = Boolean(snapshot?.payments.some((payment) => payment.status === "pending"));

  const choosePeriod = (period: BillingPeriod) => {
    const monthsPerCycle = period === "yearly" ? 12 : 1;
    const low = Math.ceil(minTermMonths / monthsPerCycle);
    const high = Math.floor(maxTermMonths / monthsPerCycle);
    if (high < low) return;
    const current = Number(durationCount);
    setBillingPeriod(period);
    setDurationCount(String(Math.max(low, Math.min(high, Number.isInteger(current) ? current : low))));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPlan || !methodId || !reference.trim() || !validDuration) return;
    setSaving(true);
    try {
      await submitPaymentRequest(selectedPlan.id, methodId, reference.trim(), billingPeriod, parsedDuration);
      setReference("");
      setCheckoutOpen(false);
      await refresh();
      notify("Payment reference submitted. Your selected term will activate after verification.");
    } catch (error) { notify(error instanceof Error ? error.message : "Payment request couldn't be submitted.", "error"); }
    finally { setSaving(false); }
  };

  if (loading && !snapshot) return <div className="billing-view"><div className="billing-loading"><RefreshCw className="admin-spin" size={18} /> Loading your plan…</div></div>;
  if (!snapshot) return <div className="billing-view"><div className="billing-empty"><h2>Subscription information is unavailable</h2><p>Check the Pages Function settings and refresh.</p><button className="billing-button" onClick={() => void refresh()}>Try again</button></div></div>;

  const percentUsed = Math.min(100, snapshot.storage.storageLimitBytes ? (snapshot.storage.bytesUsed / snapshot.storage.storageLimitBytes) * 100 : 0);
  const canCheckout = Boolean(selectedPlan && selectedPlan.monthly_price > 0 && snapshot.billingSettings.billingEnabled && paymentMethods.length && !hasPendingPayment && validDuration);
  return <div className="billing-view">
    <div className="billing-heading"><div><span className="section-eyebrow">Your storage plan</span><h2>Space for what matters.</h2><p>Choose more private storage whenever you need it. Each plan has a monthly price; select a monthly or yearly term and set a custom duration within the limits configured by Persora.</p></div><button className="billing-refresh" onClick={() => void refresh()} aria-label="Refresh billing"><RefreshCw size={15} /></button></div>
    <section className="billing-current-card"><div className="billing-current-icon"><HardDrive size={19} /></div><div className="billing-current-main"><span>CURRENT PLAN</span><h3>{snapshot.subscription.plan_name}</h3><p>{snapshot.subscription.status === "active" ? `Up to ${snapshot.subscription.storage_limit_gb} GB · ${snapshot.subscription.current_period_end ? `valid until ${formatDate(snapshot.subscription.current_period_end)}` : "no expiration"}` : `Plan status: ${snapshot.subscription.status}`}</p></div><div className="billing-meter-wrap"><div className="billing-meter-label"><span>{humanSize(snapshot.storage.bytesUsed)} total used</span><b>{snapshot.storage.storageLimitGb} GB</b></div><div className="billing-meter"><span style={{ width: `${percentUsed}%` }} /></div><small>{percentUsed.toFixed(0)}% of your combined quota · Includes saved records and attached files</small></div></section>

    <section className="billing-plans-section"><div className="billing-section-heading"><div><span className="section-eyebrow">STORAGE PLANS</span><h3>Pick your space</h3></div><span className="billing-currency-tag">{snapshot.billingSettings.currency} / month</span></div>
      <div className="billing-plan-grid">{snapshot.plans.map((plan) => <BillingPlan key={plan.id} plan={plan} currency={snapshot.billingSettings.currency} current={plan.id === snapshot.subscription.plan_id} selected={plan.id === selectedPlanId} billingEnabled={snapshot.billingSettings.billingEnabled} maxUploadMb={snapshot.maxUploadMb || 25} onSelect={() => setSelectedPlanId(plan.id)} />)}</div>
      {!snapshot.plans.length && <div className="billing-empty">No published storage plans are available yet.</div>}
    </section>

    {selectedPlan && selectedPlan.monthly_price > 0 && <section className="billing-checkout-selector"><div className="billing-section-heading"><div><span className="section-eyebrow">CUSTOM TERM</span><h3>Choose your billing duration</h3></div><span className="billing-currency-tag">{formatMoney(selectedPlan.monthly_price, snapshot.billingSettings.currency)} / month</span></div>
      <div className="billing-term-controls"><div className="billing-period-picker" role="group" aria-label="Billing period"><button type="button" aria-pressed={billingPeriod === "monthly"} className={billingPeriod === "monthly" ? "active" : ""} onClick={() => choosePeriod("monthly")}>Monthly</button><button type="button" aria-pressed={billingPeriod === "yearly"} className={billingPeriod === "yearly" ? "active" : ""} disabled={Math.floor(maxTermMonths / 12) < Math.ceil(minTermMonths / 12)} onClick={() => choosePeriod("yearly")}>Yearly</button></div>
        <label className="billing-duration-label">Duration <span className="billing-duration-input"><input type="number" min={minDuration} max={maxDuration} step="1" value={durationCount} disabled={periodUnavailable} onChange={(event) => setDurationCount(event.target.value)} aria-label={`Custom duration in ${billingPeriod === "yearly" ? "years" : "months"}`} /><b>{billingPeriod === "yearly" ? "year(s)" : "month(s)"}</b></span></label>
        <div className="billing-term-estimate"><span><CalendarDays size={15}/> {termMonths} month{termMonths === 1 ? "" : "s"} of plan coverage</span><b>{formatMoney(estimatedTotal, snapshot.billingSettings.currency)} total</b><small>Allowed term: {minTermMonths}–{maxTermMonths} months. Yearly terms count as 12 months each.</small></div>
        <button className="billing-checkout-open" type="button" disabled={!canCheckout} onClick={() => setCheckoutOpen(true)}>Continue to checkout <ArrowRight size={16}/></button>
      </div>
      {hasPendingPayment ? <div className="billing-not-open"><CreditCard size={16}/><span>Your payment request is awaiting manual review. You can start another checkout after it has been approved or rejected.</span></div> : !snapshot.billingSettings.billingEnabled ? <div className="billing-not-open"><LockKeyhole size={16}/><span>Manual payments are not open yet. Please check back later.</span></div> : !paymentMethods.length ? <div className="billing-not-open"><LockKeyhole size={16}/><span>No payment methods are available yet. Please check back later.</span></div> : periodUnavailable && <div className="billing-not-open"><CalendarDays size={16}/><span>The current admin-configured term range does not include a {billingPeriod} checkout. Choose another period or contact Persora support.</span></div>}
    </section>}

    <section className="billing-payment-history"><div className="billing-section-heading"><div><span className="section-eyebrow">PAYMENT HISTORY</span><h3>Your requests</h3></div></div>{snapshot.payments.length ? <div className="billing-payment-list">{snapshot.payments.map((payment) => <div className="billing-payment-row" key={payment.id}><span className="billing-history-icon"><CreditCard size={15} /></span><span><b>{payment.plan_name} · {formatMoney(payment.amount, payment.currency)}</b><small>{termLabel(payment)} · {payment.method} · reference {payment.reference} · {formatDate(payment.submitted_at)}</small></span><span className={`billing-status ${payment.status}`}>{payment.status}</span></div>)}</div> : <p className="billing-no-payments">No payment requests yet.</p>}</section>
    <p className="billing-privacy-note"><LockKeyhole size={13} /> Your files stay private. Admins can verify subscription references but cannot open vault attachments.</p>

    {checkoutOpen && selectedPlan && <ModalPortal><div className="billing-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckoutOpen(false); }}><aside className="billing-checkout-drawer" role="dialog" aria-modal="true" aria-labelledby="billing-drawer-title"><header className="billing-drawer-header"><div><span className="section-eyebrow">SECURE MANUAL CHECKOUT</span><h2 id="billing-drawer-title">Complete your request</h2></div><button type="button" className="billing-drawer-close" onClick={() => setCheckoutOpen(false)} aria-label="Close checkout"><X size={19}/></button></header>
      <div className="billing-drawer-content"><div className="billing-drawer-summary"><span className="billing-drawer-plan-icon"><HardDrive size={18}/></span><div><b>{selectedPlan.name}</b><small>{selectedPlan.storage_gb} GB · {termLabel({ billing_period: billingPeriod, duration_count: parsedDuration, term_months: termMonths })}</small></div><strong>{formatMoney(estimatedTotal, snapshot.billingSettings.currency)}</strong></div>
        <div className="billing-instructions"><ShieldCheck size={17}/><div><b>Payment instructions</b><p>{snapshot.billingSettings.manualInstructions || "Follow the account details shown for your selected payment method."}</p><small>Pay the amount shown, then provide the transaction reference below. Persora never asks for card numbers, PINs, or account passwords.</small></div></div>
        <form className="billing-drawer-form" onSubmit={submit}><fieldset className="billing-method-choice"><legend>Choose a payment method</legend><div className="billing-method-grid">{paymentMethods.map((entry) => <label key={entry.id} className={`billing-method-option ${methodId === entry.id ? "selected" : ""}`}><input type="radio" name="billing-method" value={entry.id} checked={methodId === entry.id} onChange={() => setMethodId(entry.id)} required/><span className="billing-method-mark"><CreditCard size={15}/></span><span className="billing-method-option-copy"><b>{entry.name}</b><small>{entry.accountName || "Manual payment"}</small></span></label>)}</div></fieldset>
          {selectedMethod && <div className="billing-method-details"><b>{selectedMethod.name} payment details</b>{selectedMethod.accountName && <span>Account name: {selectedMethod.accountName}</span>}{selectedMethod.accountIdentifier && <span>Account details: {selectedMethod.accountIdentifier}</span>}{selectedMethod.instructions && <span>{selectedMethod.instructions}</span>}</div>}
          <label className="billing-reference-label">Transaction reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={180} placeholder="Enter the reference shown by your provider" required/></label>
          <button className="billing-submit" disabled={saving || !methodId || !reference.trim() || !validDuration}>{saving ? "Submitting…" : <>Submit {formatMoney(estimatedTotal, snapshot.billingSettings.currency)} for review <CreditCard size={15}/></>}</button>
        </form>
        <p className="billing-drawer-privacy"><LockKeyhole size={13}/> Your request will stay pending until a Persora administrator verifies the payment.</p>
      </div></aside></div></ModalPortal>}
  </div>;
}

function BillingPlan({ plan, currency, current, selected, billingEnabled, maxUploadMb, onSelect }: { plan: SubscriptionPlan; currency: string; current: boolean; selected: boolean; billingEnabled: boolean; maxUploadMb: number; onSelect: () => void }) {
  const money = formatMoney(plan.monthly_price, currency);
  const unavailable = plan.monthly_price > 0 && !billingEnabled;
  return <article className={`billing-plan-card ${selected ? "selected" : ""} ${current ? "current" : ""}`}><div className="billing-plan-top"><b>{plan.name}</b>{current && <span className="billing-current-pill"><Check size={11} /> Current</span>}</div><h4>{plan.storage_gb}<small> GB</small></h4><p>{plan.description || "Private storage for your Persora vault."}</p><ul className="billing-plan-benefits"><li><Check size={13}/><span>{plan.storage_gb} GB for your saved records and attachments</span></li><li><Check size={13}/><span>Uploads up to {maxUploadMb} MB per file</span></li><li><Check size={13}/><span>Works across all Persora vault sections</span></li><li><Check size={13}/><span>{plan.monthly_price > 0 ? "Admin-verified plan activation" : "Free plan, no payment required"}</span></li></ul><div className="billing-plan-price"><b>{money}</b><span>/ month</span></div><small className="billing-per-gb">{formatRate(plan.price_per_gb_monthly, currency)} per GB / month</small><button onClick={onSelect} disabled={unavailable || current} className={selected ? "billing-plan-button selected" : "billing-plan-button"}>{current ? "Your current plan" : unavailable ? "Payments opening soon" : plan.monthly_price > 0 ? "Select plan" : "Included"}</button></article>;
}
function termLabel(payment: Pick<PaymentRecord, "billing_period" | "duration_count" | "term_months">) {
  if (payment.billing_period === "yearly") { const years = payment.duration_count || Math.max(1, Math.round((payment.term_months || 12) / 12)); return `${years} year${years === 1 ? "" : "s"}`; }
  const months = payment.duration_count || payment.term_months || 1;
  return `${months} month${months === 1 ? "" : "s"}`;
}
function formatMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0); } catch { return `${currency} ${Number(value || 0).toFixed(2)}`; } }
function formatRate(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(value || 0); } catch { return `${currency} ${Number(value || 0).toFixed(4)}`; } }
