import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, CalendarDays, Check, Clock3, CreditCard, Database, FileCheck2, HardDrive, LockKeyhole,
  RefreshCw, ShieldCheck, Sparkles, UploadCloud, WalletCards, X,
} from "lucide-react";
import type { BillingSnapshot, PaymentMethod, PaymentRecord, SubscriptionPlan } from "../types";
import { formatDate, humanSize } from "../lib/utils";
import { loadBilling, submitPaymentRequest } from "../lib/cloud";
import ModalPortal from "./ModalPortal";
import { Badge, Button, IconTile, PersoraEmptyState, Progress, Spinner } from "@/design-system";

type BillingPeriod = "monthly" | "yearly";

export default function BillingView({
  initialPlanId,
  notify,
}: {
  initialPlanId?: string;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId || "");
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [previewCycle, setPreviewCycle] = useState<BillingPeriod>("monthly");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [durationCount, setDurationCount] = useState("1");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const handledInitialPlan = useRef("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadBilling();
      setSnapshot(result);
      setMethodId((current) =>
        result.paymentMethods?.some((entry) => entry.id === current)
          ? current
          : result.paymentMethods?.[0]?.id || "",
      );
      setSelectedPlanId((current) => {
        if (initialPlanId && result.plans.some((plan) => plan.id === initialPlanId)) return initialPlanId;
        if (current && result.plans.some((plan) => plan.id === current)) return current;
        const preferred =
          result.plans.find((plan) => plan.monthly_price > 0 && plan.id !== result.subscription.plan_id) ||
          result.plans.find((plan) => plan.monthly_price > 0) ||
          result.plans[0];
        return preferred?.id || "";
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Billing details couldn't load.", "error");
    } finally {
      setLoading(false);
    }
  }, [initialPlanId, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!initialPlanId || !snapshot || handledInitialPlan.current === initialPlanId) return;
    const plan = snapshot.plans.find((entry) => entry.id === initialPlanId);
    if (!plan) return;
    handledInitialPlan.current = initialPlanId;
    setSelectedPlanId(plan.id);
    if (plan.monthly_price > 0) setCheckoutOpen(true);
  }, [initialPlanId, snapshot]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCheckoutOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [checkoutOpen]);

  const selectedPlan = useMemo(
    () => snapshot?.plans.find((plan) => plan.id === selectedPlanId) || null,
    [snapshot?.plans, selectedPlanId],
  );
  const currentPlanObj = useMemo(
    () => snapshot?.plans.find((plan) => plan.id === snapshot.subscription.plan_id) || null,
    [snapshot?.plans, snapshot?.subscription.plan_id],
  );

  const minTermMonths = Math.max(1, Math.trunc(Number(snapshot?.billingSettings.minTermMonths) || 1));
  const maxTermMonths = Math.min(120, Math.max(minTermMonths, Math.trunc(Number(snapshot?.billingSettings.maxTermMonths) || 12)));
  const yearlySupported = Math.floor(maxTermMonths / 12) >= Math.ceil(minTermMonths / 12);

  useEffect(() => {
    if (!yearlySupported && previewCycle === "yearly") setPreviewCycle("monthly");
  }, [yearlySupported, previewCycle]);

  const periodMonths = billingPeriod === "yearly" ? 12 : 1;
  const minDuration = Math.ceil(minTermMonths / periodMonths);
  const maxDuration = Math.floor(maxTermMonths / periodMonths);
  const periodUnavailable = maxDuration < minDuration;
  const parsedDuration = Number(durationCount);
  const validDuration =
    !periodUnavailable &&
    Number.isInteger(parsedDuration) &&
    parsedDuration >= minDuration &&
    parsedDuration <= maxDuration;
  const safeDuration = validDuration
    ? parsedDuration
    : Math.max(minDuration, Math.min(maxDuration, Number.isInteger(parsedDuration) ? parsedDuration : minDuration));
  const termMonths = safeDuration * periodMonths;
  const estimatedTotal = selectedPlan ? Math.round(selectedPlan.monthly_price * termMonths * 100) / 100 : 0;

  const paymentMethods: PaymentMethod[] = Array.isArray(snapshot?.paymentMethods) ? snapshot.paymentMethods : [];
  const selectedMethod = paymentMethods.find((entry) => entry.id === methodId);
  const hasPendingPayment = Boolean(snapshot?.payments.some((payment) => payment.status === "pending"));
  const canCheckout = Boolean(
    selectedPlan &&
      selectedPlan.monthly_price > 0 &&
      snapshot?.billingSettings.billingEnabled &&
      paymentMethods.length &&
      !hasPendingPayment &&
      validDuration,
  );

  const openCheckoutForPlan = (planId: string, preferredCycle: BillingPeriod = previewCycle) => {
    const cycle: BillingPeriod = preferredCycle === "yearly" && yearlySupported ? "yearly" : "monthly";
    const monthsPerCycle = cycle === "yearly" ? 12 : 1;
    const low = Math.max(1, Math.ceil(minTermMonths / monthsPerCycle));
    setSelectedPlanId(planId);
    setBillingPeriod(cycle);
    setDurationCount(String(low));
    setReference("");
    setCheckoutOpen(true);
  };

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
    if (!selectedPlan || !canCheckout || !methodId || !reference.trim() || !validDuration) return;
    setSaving(true);
    try {
      await submitPaymentRequest(selectedPlan.id, methodId, reference.trim(), billingPeriod, parsedDuration);
      setReference("");
      setCheckoutOpen(false);
      await refresh();
      notify("Payment reference submitted. Your selected term will activate after verification.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payment request couldn't be submitted.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="billing-view ds-page">
        <div className="billing-loading" role="status">
          <Spinner className="size-5 text-primary" />
          <span>Loading your plan and usage limits…</span>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="billing-view ds-page">
        <PersoraEmptyState
          className="billing-empty"
          moduleId="subscriptions"
          tone="blue"
          title="Subscription information is unavailable"
          description="Check your connection or Pages Function configuration and try again."
          action={
            <Button variant="default" onClick={() => void refresh()}>
              <RefreshCw size={15} /> Try again
            </Button>
          }
        />
      </div>
    );
  }

  const currency = snapshot.billingSettings.currency || "BDT";
  const percentUsed = Math.min(
    100,
    snapshot.storage.storageLimitBytes ? (snapshot.storage.bytesUsed / snapshot.storage.storageLimitBytes) * 100 : 0,
  );
  const firstPaidPlan =
    snapshot.plans.find((p) => p.monthly_price > 0 && p.id !== snapshot.subscription.plan_id) ||
    snapshot.plans.find((p) => p.monthly_price > 0) ||
    null;
  const currentIsPaid = Boolean(currentPlanObj && currentPlanObj.monthly_price > 0);

  return (
    <div className="billing-view ds-page">
      {/* Page Header */}
      <header className="billing-page-header">
        <div className="billing-page-copy">
          <span className="section-eyebrow">Plans &amp; Billing</span>
          <h2>Space and clarity for what matters.</h2>
          <p>
            Review your current plan, combined storage usage, billing cycle options, manual payment channels, and verification history.
          </p>
        </div>
        <div className="billing-header-actions">
          {firstPaidPlan && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => openCheckoutForPlan(currentIsPaid && currentPlanObj ? currentPlanObj.id : firstPaidPlan.id)}
            >
              <Sparkles size={14} />
              {currentIsPaid ? "Extend or change plan" : "Upgrade plan"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh billing"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </Button>
        </div>
      </header>

      {/* Top Overview Grid: Current Plan + Usage Limits */}
      <div className="billing-overview-grid">
        <section className="billing-surface-card billing-current-card">
          <div className="billing-card-head">
            <div className="billing-card-title-row">
              <IconTile variant="soft" size="default" className="text-blue-600 dark:text-blue-300">
                <HardDrive size={18} />
              </IconTile>
              <div>
                <span className="section-eyebrow">Current Plan</span>
                <h3>{snapshot.subscription.plan_name}</h3>
              </div>
            </div>
            <Badge
              variant={snapshot.subscription.status === "active" ? "success-light" : "warning-light"}
              size="sm"
              radius="full"
              className="capitalize"
            >
              {snapshot.subscription.status}
            </Badge>
          </div>

          <div className="billing-current-facts">
            <div className="billing-fact-item">
              <span>Allocated storage</span>
              <b>{snapshot.subscription.storage_limit_gb} GB</b>
            </div>
            <div className="billing-fact-item">
              <span>Current term</span>
              <b>
                {snapshot.subscription.current_period_end
                  ? `Valid until ${formatDate(snapshot.subscription.current_period_end)}`
                  : "No expiration"}
              </b>
            </div>
            <div className="billing-fact-item">
              <span>Plan rate</span>
              <b>
                {currentPlanObj && currentPlanObj.monthly_price > 0
                  ? `${formatMoney(currentPlanObj.monthly_price, currency)} / month`
                  : "Free tier"}
              </b>
            </div>
          </div>

          <div className="billing-current-footer">
            <Badge variant={snapshot.uploadsEnabled ? "info-light" : "secondary"} size="xs" radius="full">
              {snapshot.uploadsEnabled
                ? "New file, photo & PDF uploads enabled"
                : "New uploads paused · existing files remain accessible"}
            </Badge>
            {currentIsPaid && currentPlanObj ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openCheckoutForPlan(currentPlanObj.id)}
              >
                Renew term
              </Button>
            ) : firstPaidPlan ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openCheckoutForPlan(firstPaidPlan.id)}
              >
                View paid options
              </Button>
            ) : null}
          </div>
        </section>

        <section className="billing-surface-card billing-usage-card" aria-label="Usage limits">
          <div className="billing-card-head">
            <div className="billing-card-title-row">
              <IconTile variant="soft" size="default" className="text-emerald-600 dark:text-emerald-300">
                <Database size={18} />
              </IconTile>
              <div>
                <span className="section-eyebrow">Usage Limits</span>
                <h3>
                  {humanSize(snapshot.storage.bytesUsed)} <small>of {snapshot.storage.storageLimitGb} GB</small>
                </h3>
              </div>
            </div>
            <span className="billing-usage-pct">{percentUsed.toFixed(percentUsed > 0 && percentUsed < 1 ? 1 : 0)}%</span>
          </div>

          <div className="billing-meter-wrap">
            <Progress value={percentUsed} aria-label="Storage quota used" className="h-2.5" />
            <small>Combined quota across vault attachments, studio files, and structured records.</small>
          </div>

          <div className="billing-usage-breakdown">
            <div className="billing-usage-stat">
              <FileCheck2 size={14} />
              <div>
                <span>Attached files ({snapshot.storage.objectCount.toLocaleString()})</span>
                <b>{humanSize(snapshot.storage.fileBytes || 0)}</b>
              </div>
            </div>
            <div className="billing-usage-stat">
              <Database size={14} />
              <div>
                <span>Saved records ({snapshot.storage.databaseRecordCount.toLocaleString()})</span>
                <b>{humanSize(snapshot.storage.databaseBytes || 0)}</b>
              </div>
            </div>
            <div className="billing-usage-stat">
              <UploadCloud size={14} />
              <div>
                <span>Max upload size</span>
                <b>{snapshot.maxUploadMb || 25} MB / file</b>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Pending payment banner if applicable */}
      {hasPendingPayment && (
        <div className="billing-banner is-pending" role="status">
          <Clock3 size={16} />
          <div>
            <b>A payment request is awaiting administrator verification.</b>
            <span>Your selected storage term will activate once verified. You can review its status in Billing History below.</span>
          </div>
        </div>
      )}

      {/* Available Plans + Billing Cycle Selector */}
      <section className="billing-plans-section" aria-labelledby="billing-plans-heading">
        <div className="billing-section-heading">
          <div>
            <span className="section-eyebrow">Available Plans</span>
            <h3 id="billing-plans-heading">Choose your storage tier</h3>
          </div>
          <div className="billing-cycle-bar">
            <div className="billing-cycle-toggle" role="group" aria-label="Billing cycle display">
              <button
                type="button"
                aria-pressed={previewCycle === "monthly"}
                className={previewCycle === "monthly" ? "is-active" : ""}
                onClick={() => setPreviewCycle("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={previewCycle === "yearly"}
                className={previewCycle === "yearly" ? "is-active" : ""}
                disabled={!yearlySupported}
                title={yearlySupported ? "Preview 12-month billing totals" : "Current term limits only allow monthly durations"}
                onClick={() => setPreviewCycle("yearly")}
              >
                Yearly (12 mo)
              </button>
            </div>
            <Badge variant="outline" size="xs" radius="full">
              {currency} · Manual checkout
            </Badge>
          </div>
        </div>

        {snapshot.plans.length ? (
          <div className="billing-plan-grid">
            {snapshot.plans.map((plan) => (
              <BillingPlanCard
                key={plan.id}
                plan={plan}
                currency={currency}
                cycle={previewCycle}
                current={plan.id === snapshot.subscription.plan_id}
                selected={plan.id === selectedPlanId}
                maxUploadMb={snapshot.maxUploadMb || 25}
                onSelect={() => openCheckoutForPlan(plan.id, previewCycle)}
              />
            ))}
          </div>
        ) : (
          <PersoraEmptyState
            className="billing-empty-inline"
            moduleId="subscriptions"
            tone="slate"
            compact
            title="No published storage plans yet"
            description="Storage tiers configured by your workspace administrator will appear here."
          />
        )}
      </section>

      {/* Payment Settings & Billing History */}
      <div className="billing-bottom-grid">
        <section className="billing-surface-card billing-settings-card" aria-labelledby="billing-settings-heading">
          <div className="billing-section-heading is-compact">
            <div>
              <span className="section-eyebrow">Payment Settings</span>
              <h3 id="billing-settings-heading">Checkout &amp; payment channels</h3>
            </div>
            <Badge
              variant={snapshot.billingSettings.billingEnabled ? "success-light" : "secondary"}
              size="xs"
              radius="full"
            >
              {snapshot.billingSettings.billingEnabled ? "Checkout open" : "Checkout paused"}
            </Badge>
          </div>

          <div className="billing-settings-meta">
            <div className="billing-setting-row">
              <span>Billing currency</span>
              <b>{currency}</b>
            </div>
            <div className="billing-setting-row">
              <span>Allowed term length</span>
              <b>
                {minTermMonths}–{maxTermMonths} month{maxTermMonths === 1 ? "" : "s"}
              </b>
            </div>
            <div className="billing-setting-row">
              <span>Renewal model</span>
              <b>Manual reference · never auto-charged</b>
            </div>
          </div>

          <div className="billing-methods-preview">
            <span className="billing-methods-label">Accepted payment methods</span>
            {paymentMethods.length ? (
              <ul className="billing-methods-list">
                {paymentMethods.map((method) => (
                  <li key={method.id} className="billing-method-pill">
                    <WalletCards size={15} />
                    <div>
                      <b>{method.name}</b>
                      <small>
                        {[method.accountName, method.accountIdentifier].filter(Boolean).join(" · ") ||
                          "Details shown during checkout"}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="billing-muted-copy">No manual payment channels are currently configured.</p>
            )}
          </div>
        </section>

        <section className="billing-surface-card billing-payment-history" aria-labelledby="billing-history-heading">
          <div className="billing-section-heading is-compact">
            <div>
              <span className="section-eyebrow">Billing History</span>
              <h3 id="billing-history-heading">Payment requests</h3>
            </div>
            {snapshot.payments.length > 0 && (
              <Badge variant="secondary" size="xs" radius="full">
                {snapshot.payments.length} record{snapshot.payments.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>

          {snapshot.payments.length ? (
            <div className="billing-payment-list">
              {snapshot.payments.map((payment) => (
                <article className="billing-payment-row" key={payment.id}>
                  <IconTile variant="soft" size="sm" className="text-blue-600 dark:text-blue-300">
                    <CreditCard size={15} />
                  </IconTile>
                  <div className="billing-payment-copy">
                    <div className="billing-payment-top">
                      <b>
                        {payment.plan_name} · {formatMoney(payment.amount, payment.currency)}
                      </b>
                      <Badge
                        variant={
                          payment.status === "approved"
                            ? "success-light"
                            : payment.status === "rejected"
                              ? "destructive-light"
                              : "warning-light"
                        }
                        size="xs"
                        radius="full"
                        className="capitalize"
                      >
                        {payment.status}
                      </Badge>
                    </div>
                    <small>
                      {termLabel(payment)} · {payment.method} · Ref <code>{payment.reference}</code> · Submitted{" "}
                      {formatDate(payment.submitted_at)}
                    </small>
                    {payment.admin_note && <p className="billing-payment-note">Note: {payment.admin_note}</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <PersoraEmptyState
              className="billing-empty-history"
              moduleId="subscriptions"
              tone="slate"
              compact
              title="No payment requests yet"
              description="Submitted payment references and verification updates will appear here."
            />
          )}
        </section>
      </div>

      <p className="billing-privacy-note">
        <LockKeyhole size={14} />
        <span>
          Your files stay private. Workspace administrators verify payment references only and cannot open vault attachments.
        </span>
      </p>

      {/* Manual Checkout Drawer */}
      {checkoutOpen && selectedPlan && (
        <ModalPortal>
          <div
            className="billing-drawer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) setCheckoutOpen(false);
            }}
          >
            <aside
              className="billing-checkout-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="billing-drawer-title"
            >
              <header className="billing-drawer-header">
                <div>
                  <span className="section-eyebrow">Manual Plan Checkout</span>
                  <h2 id="billing-drawer-title">Choose your Persora plan</h2>
                  <p>Review your storage tier, billing cycle, and payment reference before submitting.</p>
                </div>
                <button
                  type="button"
                  className="billing-drawer-close"
                  onClick={() => setCheckoutOpen(false)}
                  aria-label="Close checkout"
                  disabled={saving}
                >
                  <X size={18} />
                </button>
              </header>

              <form className="billing-drawer-form" onSubmit={submit}>
                <div className="billing-drawer-content">
                  <fieldset className="billing-plan-choice-group">
                    <legend>1. Select a storage plan</legend>
                    <div className="billing-plan-choice-list">
                      {snapshot.plans.map((plan) => {
                        const isCurrent = plan.id === snapshot.subscription.plan_id;
                        const notPurchasable = plan.monthly_price <= 0;
                        return (
                          <label
                            key={plan.id}
                            className={`billing-plan-choice ${selectedPlanId === plan.id ? "selected" : ""} ${
                              isCurrent ? "is-current" : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name="checkout-plan"
                              value={plan.id}
                              checked={selectedPlanId === plan.id}
                              disabled={notPurchasable && selectedPlanId !== plan.id}
                              onChange={() => setSelectedPlanId(plan.id)}
                            />
                            <span className="billing-plan-choice-copy">
                              <b>
                                {plan.name}
                                {isCurrent && <small className="billing-plan-choice-current">Current</small>}
                              </b>
                              <small>{plan.storage_gb} GB · {plan.description || "Private storage for your Persora vault."}</small>
                            </span>
                            <strong>
                              {formatMoney(plan.monthly_price, currency)}
                              <small> / mo</small>
                            </strong>
                            <span className="billing-radio-mark" aria-hidden="true" />
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  <section className="billing-drawer-section billing-term-section">
                    <div className="billing-drawer-section-title">
                      <span>2. Choose billing cycle &amp; duration</span>
                      <small>Allowed: {minTermMonths}–{maxTermMonths} months</small>
                    </div>
                    <div className="billing-term-controls billing-drawer-term-controls">
                      <div className="billing-period-picker" role="group" aria-label="Billing period">
                        <button
                          type="button"
                          aria-pressed={billingPeriod === "monthly"}
                          className={billingPeriod === "monthly" ? "active" : ""}
                          onClick={() => choosePeriod("monthly")}
                        >
                          Monthly
                        </button>
                        <button
                          type="button"
                          aria-pressed={billingPeriod === "yearly"}
                          className={billingPeriod === "yearly" ? "active" : ""}
                          disabled={!yearlySupported}
                          onClick={() => choosePeriod("yearly")}
                        >
                          Yearly
                        </button>
                      </div>
                      <label className="billing-duration-label">
                        Duration
                        <span className="billing-duration-input">
                          <input
                            type="number"
                            min={minDuration}
                            max={maxDuration}
                            step="1"
                            value={durationCount}
                            disabled={periodUnavailable}
                            onChange={(event) => setDurationCount(event.target.value)}
                            aria-label={`Custom duration in ${billingPeriod === "yearly" ? "years" : "months"}`}
                          />
                          <b>{billingPeriod === "yearly" ? "year(s)" : "month(s)"}</b>
                        </span>
                      </label>
                    </div>
                  </section>

                  <section className="billing-price-summary" aria-live="polite">
                    <div className="billing-drawer-section-title">
                      <span>Price summary</span>
                      <small>
                        {termMonths} month{termMonths === 1 ? "" : "s"} coverage
                      </small>
                    </div>
                    <div className="billing-price-line">
                      <span>Selected plan</span>
                      <b>
                        {selectedPlan.name} · {selectedPlan.storage_gb} GB
                      </b>
                    </div>
                    <div className="billing-price-line">
                      <span>Monthly rate</span>
                      <b>{formatMoney(selectedPlan.monthly_price, currency)} / month</b>
                    </div>
                    <div className="billing-price-line">
                      <span>Billing term</span>
                      <b>
                        {termLabel({
                          billing_period: billingPeriod,
                          duration_count: safeDuration,
                          term_months: termMonths,
                        })}
                      </b>
                    </div>
                    <div className="billing-price-equation">
                      <span>
                        {formatMoney(selectedPlan.monthly_price, currency)} × {termMonths} month
                        {termMonths === 1 ? "" : "s"}
                      </span>
                      <b>{formatMoney(estimatedTotal, currency)}</b>
                    </div>
                    <div className="billing-price-total">
                      <span>Total due</span>
                      <strong>{formatMoney(estimatedTotal, currency)}</strong>
                    </div>
                    <small className="billing-price-note">
                      Calculated directly from the published monthly rate for your selected term. No automatic recurring charges.
                    </small>
                  </section>

                  <fieldset className="billing-method-choice">
                    <legend>3. Select a payment method</legend>
                    {paymentMethods.length ? (
                      <div className="billing-method-grid">
                        {paymentMethods.map((entry) => (
                          <label
                            key={entry.id}
                            className={`billing-method-option ${methodId === entry.id ? "selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name="billing-method"
                              value={entry.id}
                              checked={methodId === entry.id}
                              onChange={() => setMethodId(entry.id)}
                              required
                            />
                            <span className="billing-method-mark">
                              <CreditCard size={15} />
                            </span>
                            <span className="billing-method-option-copy">
                              <b>{entry.name}</b>
                              <small>{entry.accountName || "Manual transfer"}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="billing-not-open">
                        <LockKeyhole size={15} />
                        <span>No payment methods are available yet. Please check back later.</span>
                      </div>
                    )}
                  </fieldset>

                  {selectedMethod && (
                    <div className="billing-method-details">
                      <b>{selectedMethod.name} payment details</b>
                      {selectedMethod.accountName && <span>Account name: {selectedMethod.accountName}</span>}
                      {selectedMethod.accountIdentifier && <span>Account details: {selectedMethod.accountIdentifier}</span>}
                      {selectedMethod.instructions && <span>{selectedMethod.instructions}</span>}
                    </div>
                  )}

                  <div className="billing-instructions">
                    <ShieldCheck size={17} />
                    <div>
                      <b>Payment instructions</b>
                      <p>
                        {snapshot.billingSettings.manualInstructions ||
                          "Send the exact total shown using your chosen payment method, then paste your transaction reference below."}
                      </p>
                      <small>Persora never asks for card numbers, PINs, or banking passwords.</small>
                    </div>
                  </div>

                  {hasPendingPayment && (
                    <div className="billing-not-open">
                      <CreditCard size={15} />
                      <span>
                        Your payment request is awaiting manual review. You can submit another checkout once it has been reviewed.
                      </span>
                    </div>
                  )}
                  {!snapshot.billingSettings.billingEnabled && (
                    <div className="billing-not-open">
                      <LockKeyhole size={15} />
                      <span>Manual payments are currently paused. You can review plans, but checkout is disabled.</span>
                    </div>
                  )}
                  {periodUnavailable && (
                    <div className="billing-not-open">
                      <CalendarDays size={15} />
                      <span>
                        Current billing limits do not include a {billingPeriod} term. Switch billing cycle or contact support.
                      </span>
                    </div>
                  )}
                  {selectedPlan.monthly_price <= 0 && (
                    <div className="billing-not-open">
                      <Check size={15} />
                      <span>This is a free tier — no payment request is needed.</span>
                    </div>
                  )}

                  <label className="billing-reference-label">
                    4. Transaction reference
                    <input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      maxLength={180}
                      placeholder="Enter the transaction ID / reference from your payment receipt"
                      autoComplete="off"
                      required
                    />
                  </label>
                </div>

                <footer className="billing-drawer-footer">
                  <div className="billing-drawer-footer-total">
                    <span>
                      Total due for{" "}
                      {termLabel({
                        billing_period: billingPeriod,
                        duration_count: safeDuration,
                        term_months: termMonths,
                      })}
                    </span>
                    <b>{formatMoney(estimatedTotal, currency)}</b>
                  </div>
                  <button
                    type="submit"
                    className="billing-submit"
                    disabled={saving || !canCheckout || !reference.trim()}
                  >
                    {saving ? (
                      "Submitting…"
                    ) : (
                      <>
                        Submit payment for review <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                  <p>
                    <LockKeyhole size={12} /> Plan activation begins as soon as an administrator verifies the reference.
                  </p>
                </footer>
              </form>
            </aside>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

function BillingPlanCard({
  plan,
  currency,
  cycle,
  current,
  selected,
  maxUploadMb,
  onSelect,
}: {
  plan: SubscriptionPlan;
  currency: string;
  cycle: BillingPeriod;
  current: boolean;
  selected: boolean;
  maxUploadMb: number;
  onSelect: () => void;
}) {
  const displayAmount = cycle === "yearly" ? Math.round(plan.monthly_price * 12 * 100) / 100 : plan.monthly_price;
  const priceText = plan.monthly_price <= 0 ? formatMoney(0, currency) : formatMoney(displayAmount, currency);
  const paid = plan.monthly_price > 0;

  return (
    <article className={`billing-plan-card ${selected ? "selected" : ""} ${current ? "current" : ""}`}>
      <div className="billing-plan-top">
        <b>{plan.name}</b>
        {current ? (
          <Badge variant="success-light" size="xs" radius="full">
            <Check size={11} /> Current
          </Badge>
        ) : paid ? (
          <Badge variant="primary-light" size="xs" radius="full">
            Paid tier
          </Badge>
        ) : (
          <Badge variant="secondary" size="xs" radius="full">
            Free
          </Badge>
        )}
      </div>

      <div className="billing-plan-capacity">
        <h4>
          {plan.storage_gb}
          <small> GB</small>
        </h4>
        <p>{plan.description || "Private encrypted storage across your Persora workspace."}</p>
      </div>

      <div className="billing-plan-price-block">
        <div className="billing-plan-price">
          <b>{priceText}</b>
          <span>{paid ? (cycle === "yearly" ? "/ year (12 months)" : "/ month") : "forever"}</span>
        </div>
        <small className="billing-per-gb">
          {paid
            ? `${formatRate(plan.price_per_gb_monthly, currency)} per GB / month${
                cycle === "yearly" ? ` · ${formatMoney(plan.monthly_price, currency)}/mo` : ""
              }`
            : "Included with every Persora account"}
        </small>
      </div>

      <ul className="billing-plan-benefits">
        <li>
          <Check size={14} />
          <span>{plan.storage_gb} GB combined storage for records &amp; files</span>
        </li>
        <li>
          <Check size={14} />
          <span>
            {paid
              ? `Uploads enabled up to ${maxUploadMb} MB per file`
              : "Full record editing · existing files remain accessible"}
          </span>
        </li>
        <li>
          <Check size={14} />
          <span>Works across Vault, PDF Studio, Photo Studio &amp; Tables</span>
        </li>
        <li>
          <Check size={14} />
          <span>{paid ? "Manual verification · no auto-renewal" : "No payment required"}</span>
        </li>
      </ul>

      <button
        type="button"
        onClick={onSelect}
        disabled={!paid}
        className={`billing-plan-button ${selected && paid ? "selected" : ""} ${current ? "is-current" : ""}`}
      >
        {!paid ? "Included" : current ? "Extend / renew plan" : "Select plan"}
      </button>
    </article>
  );
}

function termLabel(payment: Pick<PaymentRecord, "billing_period" | "duration_count" | "term_months">) {
  if (payment.billing_period === "yearly") {
    const years = payment.duration_count || Math.max(1, Math.round((payment.term_months || 12) / 12));
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  const months = payment.duration_count || payment.term_months || 1;
  return `${months} month${months === 1 ? "" : "s"}`;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
}

function formatRate(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toFixed(4)}`;
  }
}
