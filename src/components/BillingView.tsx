import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, CreditCard, HardDrive, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { BillingSnapshot, PaymentMethod, SubscriptionPlan } from "../types";
import { formatDate, humanSize } from "../lib/utils";
import { loadBilling, submitPaymentRequest } from "../lib/cloud";

export default function BillingView({ initialPlanId, notify }: { initialPlanId?: string; notify: (message: string, kind?: "success" | "error") => void }) {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId || "");
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadBilling();
      setSnapshot(result);
      setMethodId((current) => result.paymentMethods?.some((entry) => entry.id === current) ? current : result.paymentMethods?.[0]?.id || "");
      if (initialPlanId && result.plans.some((plan) => plan.id === initialPlanId)) setSelectedPlanId(initialPlanId);
    } catch (error) { notify(error instanceof Error ? error.message : "Billing details couldn't load.", "error"); }
    finally { setLoading(false); }
  }, [initialPlanId, notify]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selectedPlan = useMemo(() => snapshot?.plans.find((plan) => plan.id === selectedPlanId) || null, [snapshot?.plans, selectedPlanId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPlan || !methodId || !reference.trim()) return;
    setSaving(true);
    try {
      await submitPaymentRequest(selectedPlan.id, methodId, reference.trim());
      setReference("");
      await refresh();
      notify("Payment reference submitted. Your plan will activate after verification.");
    } catch (error) { notify(error instanceof Error ? error.message : "Payment request couldn't be submitted.", "error"); }
    finally { setSaving(false); }
  };

  if (loading && !snapshot) return <div className="billing-view"><div className="billing-loading"><RefreshCw className="admin-spin" size={18} /> Loading your plan…</div></div>;
  if (!snapshot) return <div className="billing-view"><div className="billing-empty"><h2>Subscription information is unavailable</h2><p>Check the Pages Function settings and refresh.</p><button className="billing-button" onClick={() => void refresh()}>Try again</button></div></div>;

  const percentUsed = Math.min(100, snapshot.storage.storageLimitBytes ? (snapshot.storage.bytesUsed / snapshot.storage.storageLimitBytes) * 100 : 0);
  const hasPendingPayment = snapshot.payments.some((payment) => payment.status === "pending");
  const paymentMethods: PaymentMethod[] = Array.isArray(snapshot.paymentMethods) ? snapshot.paymentMethods : [];
  const selectedMethod = paymentMethods.find((entry) => entry.id === methodId);
  return <div className="billing-view">
    <div className="billing-heading"><div><span className="section-eyebrow">Your storage plan</span><h2>Space for what matters.</h2><p>Choose more private storage whenever you need it. The monthly price is based on GB × the admin-set per-GB rate.</p></div><button className="billing-refresh" onClick={() => void refresh()} aria-label="Refresh billing"><RefreshCw size={15} /></button></div>
    <section className="billing-current-card"><div className="billing-current-icon"><HardDrive size={19} /></div><div className="billing-current-main"><span>CURRENT PLAN</span><h3>{snapshot.subscription.plan_name}</h3><p>{snapshot.subscription.status === "active" ? `Up to ${snapshot.subscription.storage_limit_gb} GB · ${snapshot.subscription.current_period_end ? `renews ${formatDate(snapshot.subscription.current_period_end)}` : "no expiration"}` : `Plan status: ${snapshot.subscription.status}`}</p></div><div className="billing-meter-wrap"><div className="billing-meter-label"><span>{humanSize(snapshot.storage.bytesUsed)} used</span><b>{snapshot.storage.storageLimitGb} GB</b></div><div className="billing-meter"><span style={{ width: `${percentUsed}%` }} /></div><small>{percentUsed.toFixed(0)}% of your private quota · {snapshot.storage.objectCount} files</small></div></section>

    <section className="billing-plans-section"><div className="billing-section-heading"><div><span className="section-eyebrow">STORAGE PLANS</span><h3>Pick your space</h3></div><span className="billing-currency-tag">{snapshot.billingSettings.currency} / month</span></div>
      <div className="billing-plan-grid">{snapshot.plans.map((plan) => <BillingPlan key={plan.id} plan={plan} currency={snapshot.billingSettings.currency} current={plan.id === snapshot.subscription.plan_id} selected={plan.id === selectedPlanId} billingEnabled={snapshot.billingSettings.billingEnabled} maxUploadMb={snapshot.maxUploadMb || 25} onSelect={() => setSelectedPlanId(plan.id)} />)}</div>
      {!snapshot.plans.length && <div className="billing-empty">No published storage plans are available yet.</div>}
    </section>

    {selectedPlan && selectedPlan.monthly_price > 0 && <section className="billing-payment-card"><div className="billing-section-heading"><div><span className="section-eyebrow">MANUAL PAYMENT REVIEW</span><h3>Request {selectedPlan.name}</h3></div><span className="billing-due-amount">{formatMoney(selectedPlan.monthly_price, snapshot.billingSettings.currency)} <small>/ month</small></span></div>
      {hasPendingPayment ? <div className="billing-not-open"><CreditCard size={16} /><span>Your payment reference is waiting for manual review. You can submit another request after it is approved or rejected.</span></div> : !snapshot.billingSettings.billingEnabled ? <div className="billing-not-open"><LockKeyhole size={16} /><span>Manual payments are not open yet. Please check back later.</span></div> : !paymentMethods.length ? <div className="billing-not-open"><LockKeyhole size={16} /><span>No payment methods are available yet. Please check back later.</span></div> : <>
        <div className="billing-instructions"><ShieldCheck size={16} /><div><b>Payment instructions</b><p>{snapshot.billingSettings.manualInstructions || "Follow the account details shown for your selected payment method."}</p>{selectedMethod && <div className="billing-method-details"><b>{selectedMethod.name}</b>{selectedMethod.accountName && <span>Account name: {selectedMethod.accountName}</span>}{selectedMethod.accountIdentifier && <span>Account details: {selectedMethod.accountIdentifier}</span>}{selectedMethod.instructions && <span>{selectedMethod.instructions}</span>}</div>}<small>Persora does not collect card numbers or account passwords. Submit only the transaction reference after paying using the official instructions.</small></div></div>
        <form className="billing-payment-form" onSubmit={submit}><label>Payment method<select value={methodId} onChange={(event) => setMethodId(event.target.value)} required>{paymentMethods.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label>Transaction reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={180} placeholder="Enter the reference shown by your payment provider" required /></label><button className="billing-submit" disabled={saving || !methodId || !reference.trim()}>{saving ? "Submitting…" : <>Submit for review <CreditCard size={15} /></>}</button></form>
      </>}
    </section>}

    <section className="billing-payment-history"><div className="billing-section-heading"><div><span className="section-eyebrow">PAYMENT HISTORY</span><h3>Your requests</h3></div></div>{snapshot.payments.length ? <div className="billing-payment-list">{snapshot.payments.map((payment) => <div className="billing-payment-row" key={payment.id}><span className="billing-history-icon"><CreditCard size={15} /></span><span><b>{payment.plan_name} · {formatMoney(payment.amount, payment.currency)}</b><small>{payment.method} · reference {payment.reference} · {formatDate(payment.submitted_at)}</small></span><span className={`billing-status ${payment.status}`}>{payment.status}</span></div>)}</div> : <p className="billing-no-payments">No payment requests yet.</p>}</section>
    <p className="billing-privacy-note"><LockKeyhole size={13} /> Your files stay private. Admins can verify subscription references but cannot open vault attachments.</p>
  </div>;
}

function BillingPlan({ plan, currency, current, selected, billingEnabled, maxUploadMb, onSelect }: { plan: SubscriptionPlan; currency: string; current: boolean; selected: boolean; billingEnabled: boolean; maxUploadMb: number; onSelect: () => void }) {
  const money = formatMoney(plan.monthly_price, currency);
  const unavailable = plan.monthly_price > 0 && !billingEnabled;
  return <article className={`billing-plan-card ${selected ? "selected" : ""} ${current ? "current" : ""}`}><div className="billing-plan-top"><b>{plan.name}</b>{current && <span className="billing-current-pill"><Check size={11} /> Current</span>}</div><h4>{plan.storage_gb}<small> GB</small></h4><p>{plan.description || "Private storage for your Persora vault."}</p><ul className="billing-plan-benefits"><li><Check size={13}/><span>{plan.storage_gb} GB for your saved records and attachments</span></li><li><Check size={13}/><span>Uploads up to {maxUploadMb} MB per file</span></li><li><Check size={13}/><span>Works across all Persora vault sections</span></li><li><Check size={13}/><span>{plan.monthly_price > 0 ? "Admin-verified plan activation" : "Free plan, no payment required"}</span></li></ul><div className="billing-plan-price"><b>{money}</b><span>/ month</span></div><small className="billing-per-gb">{formatRate(plan.price_per_gb_monthly, currency)} per GB / month</small><button onClick={onSelect} disabled={unavailable || current} className={selected ? "billing-plan-button selected" : "billing-plan-button"}>{current ? "Your current plan" : unavailable ? "Payments opening soon" : plan.monthly_price > 0 ? "Select plan" : "Included"}</button></article>;
}
function formatMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0); } catch { return `${currency} ${Number(value || 0).toFixed(2)}`; } }
function formatRate(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(value || 0); } catch { return `${currency} ${Number(value || 0).toFixed(4)}`; } }
