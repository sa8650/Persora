// Persora Loan Tracker — the workspace page: overview (summary + filtered list)
// and a loan details page with the installment schedule and payment history.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, FileText, HandCoins, History, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import "./loans.css";
import type { AppUser, VaultItem } from "../../types";
import { PagesApiError, isPagesApiConfigured } from "../../lib/cloud";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import {
  LOANS_CHANGED_EVENT, LOANS_RESTORED_EVENT, correctLoanPayment, createLoan, deleteLoan, loadLoan, loadLoans, recordLoanPayment, reverseLoanPayment, setLoanStatus, updateLoan,
} from "../../lib/loan-api";
import type { Loan, LoanDetail, LoanInstallment, LoanPayment, LoansPayload } from "../../lib/loan-api";
import type { LoanInput } from "../../../cloudflare/loan-rules.js";
import { localDateOf, safeTimeZone } from "../../../cloudflare/calendar-rules.js";
import LoanEditor from "./LoanEditor";
import PaymentDialog, { SettleDialog } from "./PaymentDialog";
import type { PaymentDialogMode } from "./PaymentDialog";
import {
  DIRECTION_LABELS, DirectionGlyph, FREQUENCY_LABELS, FREQUENCY_UNITS, ProgressBar, StatusBadge, countLabel, formatDay, formatMoney, rateLabel, relativeDay,
} from "./loan-visuals";

type Filter = "all" | "borrowed" | "lent" | "active" | "completed" | "overdue";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" }, { id: "borrowed", label: "Borrowed" }, { id: "lent", label: "Lent" },
  { id: "active", label: "Active" }, { id: "completed", label: "Completed" }, { id: "overdue", label: "Overdue" },
];
const matches = (loan: Loan, filter: Filter) => {
  switch (filter) {
    case "borrowed": return loan.direction === "borrowed";
    case "lent": return loan.direction === "lent";
    case "active": return loan.status === "active";
    case "completed": return loan.status === "completed" || loan.status === "closed";
    case "overdue": return loan.summary.overdueCount > 0;
    default: return true;
  }
};
const stateRank = { overdue: 0, active: 1, completed: 2, closed: 3 } as const;
const byAttention = (a: Loan, b: Loan) => stateRank[a.summary.state] - stateRank[b.summary.state]
  || (a.summary.next?.dueDate || "9999").localeCompare(b.summary.next?.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt);
// Server messages are shown as-is; network failures (fetch's TypeError) get the friendly fallback.
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.message ? error.message : fallback);
const newId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined);
const counterpartOf = (loan: Loan) => (loan.direction === "borrowed" ? `from ${loan.partyName}` : `to ${loan.borrowerName}`);
const round2 = (value: number) => Math.round(value * 100) / 100;

export default function LoansView({ user, items, notify, onOpenItem, focusRequest }: {
  user: AppUser;
  items: VaultItem[];
  notify: (message: string, kind?: "success" | "error") => void;
  onOpenItem: (item: VaultItem) => void;
  focusRequest?: { loanId: string; nonce: number } | null;
}) {
  const disabled = Boolean(user.demo) || !isPagesApiConfigured;
  const [payload, setPayload] = useState<LoansPayload | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => focusRequest?.loanId || initialLoanFromUrl());
  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [editor, setEditor] = useState<{ loan: Loan | null; createId?: string } | null>(null);
  const [payTarget, setPayTarget] = useState<PaymentDialogMode | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<{ message: string; field?: string } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const zone = payload?.timeZone || safeTimeZone(user.timezone, "UTC");
  const today = detail?.today || payload?.today || localDateOf(Date.now(), zone);

  useEffect(() => {
    const reload = () => setReloadKey((value) => value + 1);
    window.addEventListener(LOANS_RESTORED_EVENT, reload);
    // Another device may have recorded payments: refresh when the tab regains focus.
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener(LOANS_RESTORED_EVENT, reload); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  useEffect(() => { if (focusRequest?.loanId) setSelectedId(focusRequest.loanId); }, [focusRequest]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    setLoadState((state) => (state === "ready" ? "ready" : "loading"));
    loadLoans(controller.signal).then((data) => {
      setPayload(data); setLoadState("ready"); setLoadError("");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadState("error");
      setLoadError(errorMessage(error, "Your loans couldn't be loaded. Check your connection and try again."));
    });
    return () => controller.abort();
  }, [disabled, reloadKey]);

  useEffect(() => {
    if (disabled || !selectedId) { setDetail(null); setDetailState("idle"); return; }
    const controller = new AbortController();
    setDetailState((state) => (state === "ready" && detail?.loan.id === selectedId ? "ready" : "loading"));
    loadLoan(selectedId, controller.signal).then((data) => {
      setDetail(data); setDetailState("ready"); setDetailError("");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setDetailError(error instanceof PagesApiError && error.status === 404 ? "This loan is no longer available. It may have been deleted on another device." : errorMessage(error, "This loan couldn't be loaded. Check your connection and try again."));
    });
    return () => controller.abort();
  }, [disabled, selectedId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => window.dispatchEvent(new Event(LOANS_CHANGED_EVENT));
  /** Applies a fresh detail from the server and mirrors it into the list. */
  const applyDetail = useCallback((next: LoanDetail) => {
    setDetail(next);
    setDetailState("ready");
    setPayload((current) => current ? { ...current, loans: current.loans.some((loan) => loan.id === next.loan.id) ? current.loans.map((loan) => loan.id === next.loan.id ? next.loan : loan) : [...current.loans, next.loan] } : current);
  }, []);
  const closeDialogs = () => { setEditor(null); setPayTarget(null); setSettleOpen(false); setDeleteOpen(false); setDialogError(null); };
  const openLoan = (id: string | null) => {
    setSelectedId(id);
    if (!id) setDetail(null);
    try {
      const url = new URL(window.location.href);
      if (id) { url.searchParams.set("view", "loans"); url.searchParams.set("loan", id); } else url.searchParams.delete("loan");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* address bar sync is cosmetic */ }
  };

  const run = async (work: () => Promise<LoanDetail | void>, success: string, fallback: string) => {
    setBusy(true); setDialogError(null);
    try {
      const result = await work();
      if (result) applyDetail(result);
      notify(success);
      setLiveMessage(success);
      closeDialogs();
      changed();
    } catch (error) {
      setDialogError({ message: errorMessage(error, fallback) });
      if (error instanceof PagesApiError && (error.status === 409 || error.status === 404)) setReloadKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = (input: LoanInput, options: { recalculate: boolean; nextDueDate: string | null }) => {
    if (!editor) return;
    const existing = editor.loan;
    void run(async () => {
      if (existing) {
        try {
          return await updateLoan(existing.id, input, existing.revision, options.recalculate ? { recalculate: true, nextDueDate: options.nextDueDate } : {});
        } catch (error) {
          if (error instanceof PagesApiError && error.status === 428) throw new Error("These changes affect the installment schedule. Review the recalculated schedule and confirm it.");
          throw error;
        }
      }
      const created = await createLoan({ ...input, id: editor.createId || newId() || "" });
      openLoan(created.loan.id);
      return created;
    }, existing ? (options.recalculate ? "Loan updated. Future installments were recalculated." : "Loan updated.") : `“${input.name}” added.`, "The loan couldn't be saved. Check your connection and try again.");
  };

  // ---- derived ------------------------------------------------------------
  const loans = useMemo(() => [...(payload?.loans || [])].sort(byAttention), [payload]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((entry) => [entry.id, loans.filter((loan) => matches(loan, entry.id)).length])) as Record<Filter, number>, [loans]);
  const visible = useMemo(() => loans.filter((loan) => matches(loan, filter)), [loans, filter]);
  const currencies = useMemo(() => {
    const tally = new Map<string, number>();
    for (const loan of visible) tally.set(loan.currency, (tally.get(loan.currency) || 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [visible]);
  const currency = currencies.includes(currencyChoice) ? currencyChoice : currencies[0] || payload?.currencies[0] || "BDT";
  const stats = useMemo(() => {
    const inCurrency = visible.filter((loan) => loan.currency === currency);
    const active = inCurrency.filter((loan) => loan.status === "active");
    let next: { loan: Loan; installment: LoanInstallment } | null = null;
    for (const loan of active) {
      const candidate = loan.summary.next;
      if (candidate && (!next || candidate.dueDate < next.installment.dueDate)) next = { loan, installment: candidate };
    }
    return {
      activeCount: active.length,
      activeAmount: round2(active.reduce((sum, loan) => sum + loan.principal, 0)),
      remaining: round2(active.reduce((sum, loan) => sum + loan.summary.outstanding, 0)),
      overdueCount: inCurrency.reduce((sum, loan) => sum + loan.summary.overdueCount, 0),
      overdueAmount: round2(inCurrency.reduce((sum, loan) => sum + loan.summary.overdueAmount, 0)),
      paid: round2(inCurrency.reduce((sum, loan) => sum + loan.summary.paid, 0)),
      mixed: inCurrency.some((loan) => loan.direction === "borrowed") && inCurrency.some((loan) => loan.direction === "lent"),
      next,
    };
  }, [visible, currency]);

  if (disabled) {
    return <div className="ln-view">
      <div className="ln-gate">
        <span className="ln-empty-icon"><HandCoins size={24}/></span>
        <h2>{user.demo ? "Loan Tracker needs a Persora account" : "Loan Tracker needs the Persora API"}</h2>
        <p>{user.demo
          ? "Demo mode keeps everything on this device. Sign in to track loans, installments and payments in your private, synced account."
          : "This build isn't connected to Persora's Pages Functions API, which stores loans and delivers reminders."}</p>
      </div>
    </div>;
  }

  const initialLoading = loadState === "loading" && !payload;
  const editorEl = editor && payload && <LoanEditor
    key={editor.loan?.id || "new"} loan={editor.loan} installments={editor.loan && detail?.loan.id === editor.loan.id ? detail.installments : []}
    today={today} userName={user.fullName || ""} defaultCurrency={editor.loan?.currency || currencies[0] || "BDT"} currencies={payload.currencies}
    email={detail?.email || payload.email} documents={items} busy={busy} error={dialogError}
    onSave={saveEditor} onClose={() => { if (!busy) { setEditor(null); setDialogError(null); } }}
  />;

  // ---- details page ---------------------------------------------------------
  if (selectedId) {
    return <div className="ln-view">
      <p className="ln-visually-hidden" role="status" aria-live="polite">{liveMessage}</p>
      <div className="ln-toolbar">
        <button type="button" className="ln-button ln-button-small" onClick={() => openLoan(null)}><ArrowLeft size={15}/> All loans</button>
        {detailState === "loading" && detail && <span className="ln-spinner" role="status" aria-label="Refreshing loan"/>}
      </div>
      {detailState === "error" && <div className="ln-banner" role="alert">
        <span>{detailError}</span>
        <div className="ln-banner-actions">
          <button type="button" className="ln-button ln-button-small" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
          <button type="button" className="ln-button ln-button-small" onClick={() => openLoan(null)}>Back to loans</button>
        </div>
      </div>}
      {!detail || detail.loan.id !== selectedId ? (detailState !== "error" && <LoanSkeleton detail/>) : <LoanDetails
        detail={detail} items={items} busy={busy}
        onEdit={() => { setDialogError(null); setEditor({ loan: detail.loan }); }}
        onPay={(installment) => { setDialogError(null); setPayTarget({ mode: "pay", installment }); }}
        onCorrect={(installment, payment) => { setDialogError(null); setPayTarget({ mode: "correct", installment, payment }); }}
        onReverse={(installment, payment) => { setDialogError(null); setPayTarget({ mode: "reverse", installment, payment }); }}
        onComplete={() => void run(() => setLoanStatus(detail.loan.id, "complete"), "Loan marked completed.", "The loan couldn't be updated.")}
        onSettle={() => { setDialogError(null); setSettleOpen(true); }}
        onReopen={() => void run(() => setLoanStatus(detail.loan.id, "reopen"), "Loan reopened.", "The loan couldn't be reopened.")}
        onDelete={() => { setDialogError(null); setDeleteOpen(true); }}
        onOpenItem={onOpenItem}
      />}
      {editorEl}
      {payTarget && detail && <PaymentDialog
        loan={detail.loan} today={detail.today} target={payTarget} busy={busy} error={dialogError}
        onRecord={(installment, payment) => void run(() => recordLoanPayment(detail.loan.id, installment.id, payment), `Payment of ${formatMoney(Number(payment.amount), detail.loan.currency)} recorded.`, "The payment couldn't be recorded. Check your connection and try again — it won't be recorded twice.")}
        onCorrect={(payment, reason, replacement) => void run(() => correctLoanPayment(detail.loan.id, payment.id, reason, replacement), "Payment corrected. The original stays in the history.", "The correction couldn't be saved.")}
        onReverse={(payment, reason) => void run(() => reverseLoanPayment(detail.loan.id, payment.id, reason), "Payment reversed. It stays in the history.", "The payment couldn't be reversed.")}
        onClose={() => { if (!busy) { setPayTarget(null); setDialogError(null); } }}
      />}
      {settleOpen && detail && <SettleDialog loan={detail.loan} busy={busy} error={dialogError}
        onConfirm={(note) => void run(() => setLoanStatus(detail.loan.id, "close", note), "Loan closed with a settlement note.", "The loan couldn't be closed.")}
        onClose={() => { if (!busy) { setSettleOpen(false); setDialogError(null); } }}/>}
      {deleteOpen && detail && <DeleteDialog detail={detail} busy={busy} error={dialogError}
        onConfirm={() => void (async () => {
          setBusy(true); setDialogError(null);
          try {
            await deleteLoan(detail.loan.id);
            setPayload((current) => current ? { ...current, loans: current.loans.filter((loan) => loan.id !== detail.loan.id) } : current);
            notify(`“${detail.loan.name}” deleted.`);
            closeDialogs(); openLoan(null); changed();
          } catch (error) { setDialogError({ message: errorMessage(error, "The loan couldn't be deleted.") }); }
          finally { setBusy(false); }
        })()}
        onClose={() => { if (!busy) { setDeleteOpen(false); setDialogError(null); } }}/>}
    </div>;
  }

  // ---- overview -----------------------------------------------------------------
  return <div className="ln-view">
    <p className="ln-visually-hidden" role="status" aria-live="polite">{liveMessage}</p>
    <header className="ln-toolbar">
      <div className="ln-chips" role="group" aria-label="Filter loans">
        {FILTERS.map((entry) => <button key={entry.id} type="button" className={filter === entry.id ? "is-active" : ""} aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
          {entry.label}{payload && <span className="ln-chip-count">{counts[entry.id]}</span>}</button>)}
      </div>
      <div className="ln-tools">
        {loadState === "loading" && payload && <span className="ln-spinner" role="status" aria-label="Refreshing loans"/>}
        <button type="button" className="ln-primary-button" onClick={() => { setDialogError(null); setEditor({ loan: null, createId: newId() }); }}
          disabled={initialLoading || (loadState === "error" && !payload) || (payload ? payload.loans.length >= payload.limits.loans : false)}>
          <Plus size={16}/><span>New Loan</span>
        </button>
      </div>
    </header>

    {loadState === "error" && <div className="ln-banner" role="alert">
      <span>{loadError}</span>
      <button type="button" className="ln-button ln-button-small" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
    </div>}

    {initialLoading ? <LoanSkeleton/> : payload && <>
      {loans.length > 0 && <section className="ln-stats" aria-label="Loan summary">
        <div className="ln-stat">
          <span className="ln-stat-label">Active amount</span>
          <b>{formatMoney(stats.activeAmount, currency)}</b>
          <small>{stats.activeCount ? `${stats.activeCount} active loan${stats.activeCount === 1 ? "" : "s"}` : "No active loans"}</small>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Remaining balance</span>
          <b>{formatMoney(stats.remaining, currency)}</b>
          <small>{stats.mixed ? "Borrowed and lent combined" : "Still to repay"}</small>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Next installment</span>
          {stats.next ? <>
            <b>{formatMoney(stats.next.installment.remaining, currency)}</b>
            <small>{formatDay(stats.next.installment.dueDate, { month: "short", day: "numeric" })} · {stats.next.loan.name}</small>
          </> : <><b>—</b><small>Nothing scheduled</small></>}
        </div>
        <div className={`ln-stat ${stats.overdueCount ? "is-alert" : ""}`}>
          <span className="ln-stat-label">Overdue</span>
          <b>{formatMoney(stats.overdueAmount, currency)}</b>
          <small>{stats.overdueCount ? `${stats.overdueCount} installment${stats.overdueCount === 1 ? "" : "s"}` : "Nothing overdue"}</small>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Total paid</span>
          <b>{formatMoney(stats.paid, currency)}</b>
          <small>{filter === "all" ? "All loans" : `${FILTERS.find((entry) => entry.id === filter)?.label} loans`}</small>
        </div>
        {currencies.length > 1 && <label className="ln-stat-currency"><span className="ln-visually-hidden">Summary currency</span>
          <select value={currency} onChange={(event) => setCurrencyChoice(event.target.value)} aria-label="Summary currency">
            {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>}
      </section>}

      <section className="ln-panel" aria-label="Loans">
        {loans.length === 0 ? <div className="ln-empty">
          <span className="ln-empty-icon"><HandCoins size={24}/></span>
          <h3>Track a loan or installment plan</h3>
          <p>Add money you borrowed or lent. Persora builds the installment schedule, tracks each payment and shows what's next and what's overdue.</p>
          <button type="button" className="ln-primary-button" onClick={() => { setDialogError(null); setEditor({ loan: null, createId: newId() }); }}><Plus size={16}/><span>New Loan</span></button>
        </div> : visible.length === 0 ? <div className="ln-empty ln-empty-small">
          <p>No {FILTERS.find((entry) => entry.id === filter)?.label.toLowerCase()} loans.</p>
          <button type="button" className="ln-button ln-button-small" onClick={() => setFilter("all")}>Show all loans</button>
        </div> : <ul className="ln-list">
          {visible.map((loan) => <LoanRow key={loan.id} loan={loan} onOpen={() => openLoan(loan.id)}/>)}
        </ul>}
      </section>
    </>}
    {editorEl}
  </div>;
}

// ---------------------------------------------------------------------------
// Overview rows
// ---------------------------------------------------------------------------

function LoanRow({ loan, onOpen }: { loan: Loan; onOpen: () => void }) {
  const { summary } = loan;
  const next = summary.next;
  return <li className={`ln-row is-${summary.state}`}>
    <button type="button" className="ln-row-button" onClick={onOpen} aria-label={`${loan.name}, ${DIRECTION_LABELS[loan.direction].toLowerCase()} ${counterpartOf(loan)}. Open details`}>
      <DirectionGlyph direction={loan.direction}/>
      <span className="ln-row-main">
        <span className="ln-row-name">{loan.name}</span>
        <span className="ln-row-meta">{DIRECTION_LABELS[loan.direction]} {counterpartOf(loan)} · {FREQUENCY_LABELS[loan.frequency].toLowerCase()}</span>
        <span className="ln-row-progress">
          <ProgressBar value={summary.progress} label={`${loan.name} repaid`}/>
          <small>{summary.paidCount}/{summary.installmentsTotal} paid</small>
        </span>
      </span>
      <span className="ln-row-side">
        <span className="ln-row-amount">{formatMoney(summary.state === "closed" ? 0 : summary.outstanding, loan.currency)}<small>{summary.state === "closed" ? "closed" : "remaining"}</small></span>
        <span className="ln-row-next">
          {next ? <>{formatDay(next.dueDate, { month: "short", day: "numeric" })} · {formatMoney(next.remaining, loan.currency)}</> : summary.state === "completed" ? "Fully repaid" : "Settled"}
        </span>
        <StatusBadge status={summary.state}/>
      </span>
      <ChevronRight size={16} className="ln-row-chevron" aria-hidden="true"/>
    </button>
  </li>;
}

function LoanSkeleton({ detail = false }: { detail?: boolean }) {
  return <div className="ln-panel ln-skeleton" aria-busy="true" aria-label={detail ? "Loading loan" : "Loading loans"}>
    {Array.from({ length: detail ? 5 : 4 }, (_, index) => <div className="ln-skeleton-row" key={index}><span/><span/><span/></div>)}
  </div>;
}

// ---------------------------------------------------------------------------
// Details page
// ---------------------------------------------------------------------------

function LoanDetails({ detail, items, busy, onEdit, onPay, onCorrect, onReverse, onComplete, onSettle, onReopen, onDelete, onOpenItem }: {
  detail: LoanDetail;
  items: VaultItem[];
  busy: boolean;
  onEdit: () => void;
  onPay: (installment: LoanInstallment) => void;
  onCorrect: (installment: LoanInstallment, payment: LoanPayment) => void;
  onReverse: (installment: LoanInstallment, payment: LoanPayment) => void;
  onComplete: () => void;
  onSettle: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onOpenItem: (item: VaultItem) => void;
}) {
  const { loan, installments, payments, today } = detail;
  const { summary } = loan;
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const paymentsBy = useMemo(() => {
    const map = new Map<string, LoanPayment[]>();
    for (const payment of payments) map.set(payment.installmentId, [...(map.get(payment.installmentId) || []), payment]);
    return map;
  }, [payments]);
  const next = summary.next;
  const nextIndex = next ? installments.findIndex((row) => row.id === next.id) : installments.length;
  const windowed = !showAll && installments.length > 15;
  const start = windowed ? Math.max(0, Math.min(nextIndex - 2, installments.length - 12)) : 0;
  const shown = windowed ? installments.slice(start, start + 12) : installments;
  const canPay = loan.status === "active";
  const canChange = loan.status !== "closed";
  const original = loan.originalTerms;
  const changedTerms = loan.scheduleChanges.length > 0;
  const docs = loan.documentIds.map((id) => ({ id, item: items.find((entry) => entry.id === id) }));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && (event.target as Element | null)?.closest?.(".ln-menu-wrap")) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menuOpen]);

  const toggle = (id: string) => setExpanded((current) => { const copy = new Set(current); if (copy.has(id)) copy.delete(id); else copy.add(id); return copy; });

  return <div className="ln-details">
    <header className="ln-detail-head">
      <DirectionGlyph direction={loan.direction} size={42}/>
      <div className="ln-detail-title">
        <h2>{loan.name}</h2>
        <p>{DIRECTION_LABELS[loan.direction]} {counterpartOf(loan)}{loan.reference ? ` · Ref ${loan.reference}` : ""}</p>
      </div>
      <StatusBadge status={summary.state}/>
      <div className="ln-detail-actions">
        <button type="button" className="ln-button ln-button-small" onClick={onEdit} disabled={busy}><Pencil size={14}/> Edit</button>
        <div className="ln-menu-wrap">
          <button type="button" className="ln-icon-button" aria-label="More loan actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={18}/></button>
          {menuOpen && <div className="ln-menu" role="menu">
            {loan.status === "active" && summary.outstanding === 0 && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onComplete(); }}><CheckCircle2 size={15}/> Mark completed</button>}
            {loan.status === "active" && summary.outstanding > 0 && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSettle(); }}><HandCoins size={15}/> Close with settlement…</button>}
            {loan.status === "closed" && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onReopen(); }}><RotateCcw size={15}/> Reopen loan</button>}
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={15}/> Delete loan…</button>
          </div>}
        </div>
      </div>
    </header>

    <section className={`ln-next is-${next ? next.status : summary.state}`} aria-label="Next installment">
      {next && loan.status === "active" ? <>
        <div className="ln-next-main">
          <span className="ln-next-label">Next installment · #{next.number} of {summary.installmentsTotal}</span>
          <b className="ln-next-amount">{formatMoney(next.remaining, loan.currency)}</b>
          <span className="ln-next-date">Due {formatDay(next.dueDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {relativeDay(next.dueDate, today)}
            {next.paid > 0 && <> · {formatMoney(next.paid, loan.currency)} of {formatMoney(next.amount, loan.currency)} paid</>}</span>
        </div>
        <StatusBadge status={next.status}/>
        <button type="button" className="ln-primary-button" onClick={() => onPay(next)} disabled={busy}><HandCoins size={16}/><span>Record payment</span></button>
      </> : loan.status === "completed" ? <div className="ln-next-main">
        <span className="ln-next-label">Completed{loan.completedAt ? ` · ${formatDay(loan.completedAt.slice(0, 10))}` : ""}</span>
        <b className="ln-next-amount">Fully repaid</b>
        <span className="ln-next-date">All {summary.installmentsTotal} installments are paid.</span>
      </div> : <div className="ln-next-main">
        <span className="ln-next-label">Closed{loan.closedAt ? ` · ${formatDay(loan.closedAt.slice(0, 10))}` : ""}</span>
        <b className="ln-next-amount">{summary.writtenOff > 0 ? `${formatMoney(summary.writtenOff, loan.currency)} settled / written off` : "Settled"}</b>
        {loan.closeNote && <span className="ln-next-date">“{loan.closeNote}”</span>}
      </div>}
    </section>

    <section className="ln-figures" aria-label="Balance">
      <div><span>Outstanding</span><b>{formatMoney(loan.status === "closed" ? 0 : summary.outstanding, loan.currency)}</b></div>
      <div><span>Paid</span><b>{formatMoney(summary.paid, loan.currency)}</b></div>
      <div><span>Total scheduled</span><b>{formatMoney(summary.scheduled, loan.currency)}</b></div>
      <div className={summary.overdueCount ? "is-alert" : ""}><span>Overdue</span><b>{formatMoney(summary.overdueAmount, loan.currency)}</b><small>{summary.overdueCount ? `${summary.overdueCount} installment${summary.overdueCount === 1 ? "" : "s"}` : "None"}</small></div>
      <div className="ln-figures-progress">
        <ProgressBar value={summary.progress} label="Repayment progress"/>
        <small>{summary.paidCount} of {summary.installmentsTotal} installments paid · {Math.floor(summary.progress * 100)}% of the scheduled total</small>
      </div>
    </section>

    <div className="ln-detail-layout">
      <section className="ln-panel" aria-labelledby="ln-schedule-title">
        <div className="ln-panel-head">
          <h3 id="ln-schedule-title">Installments</h3>
          <span className="ln-muted">{countLabel(summary.installmentsTotal, loan.frequency)}</span>
        </div>
        {windowed && start > 0 && <button type="button" className="ln-link-button ln-show-all" onClick={() => setShowAll(true)}>Show all {installments.length} installments ({start} earlier)</button>}
        <ol className="ln-schedule">
          {shown.map((row) => {
            const rowPayments = paymentsBy.get(row.id) || [];
            const open = expanded.has(row.id);
            return <li key={row.id} className={`ln-inst is-${row.status} ${next?.id === row.id ? "is-next" : ""}`}>
              <div className="ln-inst-row">
                <span className="ln-inst-number" aria-label={`Installment ${row.number}`}>{row.number}</span>
                <span className="ln-inst-date">{formatDay(row.dueDate)}<StatusBadge status={row.status}/></span>
                <span className="ln-inst-amounts">
                  <b>{formatMoney(row.amount, loan.currency)}</b>
                  <small>{row.paid > 0 ? `${formatMoney(row.paid, loan.currency)} paid${row.remaining > 0 ? ` · ${formatMoney(row.remaining, loan.currency)} left` : ""}` : row.interest > 0 ? `${formatMoney(row.principal, loan.currency)} + ${formatMoney(row.interest, loan.currency)} interest` : "Not paid yet"}</small>
                </span>
                <span className="ln-inst-actions">
                  {canPay && row.remaining > 0 && <button type="button" className="ln-button ln-button-small" onClick={() => onPay(row)} disabled={busy} aria-label={`Record payment for installment ${row.number}`}>Pay</button>}
                  {rowPayments.length > 0 && <button type="button" className="ln-icon-button" onClick={() => toggle(row.id)} aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} ${rowPayments.length} payment${rowPayments.length === 1 ? "" : "s"} for installment ${row.number}`} title="Payment history">
                    <ChevronDown size={16} className={open ? "is-open" : ""}/><span className="ln-inst-count">{rowPayments.length}</span>
                  </button>}
                </span>
              </div>
              {open && <ul className="ln-payments">
                {rowPayments.map((payment) => <li key={payment.id} className={payment.status === "reversed" ? "is-reversed" : ""}>
                  <span className="ln-payment-main">
                    <b>{formatMoney(payment.amount, loan.currency)}</b>
                    <span>{formatDay(payment.paidOn)}{payment.method ? ` · ${payment.method}` : ""}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                    {payment.notes && <small>{payment.notes}</small>}
                    {payment.correctsPaymentId && <small className="ln-payment-tag">Correction</small>}
                    {payment.status === "reversed" && <small className="ln-payment-tag is-reversed">Reversed{payment.reversalReason ? ` — ${payment.reversalReason}` : ""}</small>}
                  </span>
                  {payment.status === "recorded" && canChange && <span className="ln-payment-actions">
                    <button type="button" className="ln-link-button" onClick={() => onCorrect(row, payment)} disabled={busy}><RotateCcw size={12}/> Correct</button>
                    <button type="button" className="ln-link-button is-danger" onClick={() => onReverse(row, payment)} disabled={busy}><Undo2 size={12}/> Reverse</button>
                  </span>}
                </li>)}
              </ul>}
            </li>;
          })}
        </ol>
        {windowed && start + shown.length < installments.length && <button type="button" className="ln-link-button ln-show-all" onClick={() => setShowAll(true)}>Show all {installments.length} installments ({installments.length - start - shown.length} later)</button>}
      </section>

      <aside className="ln-side">
        <section className="ln-panel" aria-labelledby="ln-terms-title">
          <div className="ln-panel-head"><h3 id="ln-terms-title">{changedTerms ? "Current terms" : "Terms"}</h3></div>
          <dl className="ln-facts">
            <div><dt>Principal</dt><dd>{formatMoney(loan.principal, loan.currency)}</dd></div>
            <div><dt>Interest</dt><dd>{rateLabel(loan.interestMethod, loan.interestRate)}</dd></div>
            <div><dt>Schedule</dt><dd>{countLabel(loan.installmentCount, loan.frequency)}</dd></div>
            <div><dt>Started</dt><dd>{formatDay(loan.startDate)}</dd></div>
            <div><dt>First due</dt><dd>{formatDay(loan.firstDueDate)}</dd></div>
            <div><dt>Final due</dt><dd>{installments.length ? formatDay(installments[installments.length - 1].dueDate) : "—"}</dd></div>
            <div><dt>Interest (estimate)</dt><dd>{formatMoney(round2(installments.reduce((sum, row) => sum + row.interest, 0)), loan.currency)}</dd></div>
          </dl>
          {changedTerms && <>
            <h4 className="ln-subhead">Original terms</h4>
            <dl className="ln-facts is-muted">
              {original.principal !== undefined && <div><dt>Principal</dt><dd>{formatMoney(original.principal, loan.currency)}</dd></div>}
              {original.interestMethod && <div><dt>Interest</dt><dd>{rateLabel(original.interestMethod, original.interestRate ?? null)}</dd></div>}
              {original.installmentCount && original.frequency && <div><dt>Schedule</dt><dd>{countLabel(original.installmentCount, original.frequency)}</dd></div>}
              {original.totalRepayment !== undefined && <div><dt>Total repayment</dt><dd>{formatMoney(original.totalRepayment, loan.currency)}</dd></div>}
              {original.finalDueDate && <div><dt>Final due</dt><dd>{formatDay(original.finalDueDate)}</dd></div>}
            </dl>
          </>}
          <p className="ln-hint">Figures are estimates for tracking and may differ from a lender's statement.</p>
        </section>

        <section className="ln-panel" aria-labelledby="ln-info-title">
          <div className="ln-panel-head"><h3 id="ln-info-title">Details</h3></div>
          <dl className="ln-facts">
            <div><dt>Lender</dt><dd>{loan.partyName}</dd></div>
            <div><dt>Borrower</dt><dd>{loan.borrowerName}</dd></div>
            {loan.reference && <div><dt>Reference</dt><dd>{loan.reference}</dd></div>}
            <div><dt>Reminders</dt><dd>{[loan.reminderDaysBefore === null ? null : loan.reminderDaysBefore === 0 ? "On the due date" : `${loan.reminderDaysBefore} day${loan.reminderDaysBefore === 1 ? "" : "s"} before`, loan.overdueAlerts ? "when overdue" : null].filter(Boolean).join(", ") || "Off"}{loan.reminderEmail ? " · email" : ""}</dd></div>
          </dl>
          {loan.notes && <p className="ln-notes">{loan.notes}</p>}
          {docs.length > 0 && <ul className="ln-doc-links">
            {docs.map(({ id, item }) => <li key={id}>{item
              ? <button type="button" className="ln-link-button" onClick={() => onOpenItem(item)}><FileText size={13}/> {item.title}</button>
              : <span className="ln-muted"><FileText size={13}/> Linked record unavailable</span>}</li>)}
          </ul>}
        </section>

        {(loan.scheduleChanges.length > 0 || loan.status === "closed") && <section className="ln-panel" aria-labelledby="ln-history-title">
          <div className="ln-panel-head"><h3 id="ln-history-title"><History size={14} aria-hidden="true"/> History</h3></div>
          <ul className="ln-history">
            {loan.status === "closed" && loan.closedAt && <li><b>{formatDay(loan.closedAt.slice(0, 10))}</b><span>Closed with settlement{loan.closeNote ? `: “${loan.closeNote}”` : ""}</span></li>}
            {[...loan.scheduleChanges].reverse().map((change, index) => <li key={`${change.at}-${index}`}>
              <b>{formatDay(change.at.slice(0, 10))}</b>
              <span>Schedule recalculated from installment {change.lockedCount + 1}
                {change.previous?.principal !== undefined && change.next?.principal !== undefined && change.previous.principal !== change.next.principal ? ` · principal ${formatMoney(change.previous.principal, loan.currency)} → ${formatMoney(change.next.principal, loan.currency)}` : ""}
                {change.previous?.installmentCount !== change.next?.installmentCount ? ` · ${change.previous?.installmentCount} → ${change.next?.installmentCount} installments` : ""}
                {change.previous?.frequency && change.next?.frequency && change.previous.frequency !== change.next.frequency ? ` · ${FREQUENCY_UNITS[change.previous.frequency][1]} → ${FREQUENCY_UNITS[change.next.frequency][1]}` : ""}
                {change.previous?.scheduledTotal !== undefined && change.next?.scheduledTotal !== undefined ? ` · total ${formatMoney(change.previous.scheduledTotal, loan.currency)} → ${formatMoney(change.next.scheduledTotal, loan.currency)}` : ""}
              </span>
            </li>)}
          </ul>
        </section>}
      </aside>
    </div>
  </div>;
}

function DeleteDialog({ detail, busy, error, onConfirm, onClose }: { detail: LoanDetail; busy: boolean; error: { message: string } | null; onConfirm: () => void; onClose: () => void }) {
  const recorded = detail.payments.filter((payment) => payment.status === "recorded").length;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return <ModalPortal>
    <ItemModalShell labelledBy="ln-delete-title" className="ln-editor ln-pay" backdropClassName="ln-editor-backdrop" icon={<Trash2 size={18}/>} iconClassName="ln-modal-icon is-danger"
      eyebrow="Loan Tracker" title={`Delete “${detail.loan.name}”?`} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <div className="vault-modal-scroll">
        <div className="ln-form">
          <p className="ln-confirm-text">This permanently deletes the loan, its {detail.installments.length} installments{recorded ? ` and ${recorded} recorded payment${recorded === 1 ? "" : "s"}` : ""}. It can't be undone.
            {detail.loan.status === "active" && detail.loan.summary.outstanding > 0 ? " To keep the record, close it with a settlement note instead." : ""}</p>
          {error && <p className="ln-form-error" role="alert">{error.message}</p>}
        </div>
      </div>
      <div className="editor-form-footer">
        <div/>
        <div className="editor-actions">
          <button type="button" className="quiet-button" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
          <button type="button" className="ln-danger-button" onClick={onConfirm} disabled={busy}>{busy ? <><span className="spinner"/> Deleting…</> : "Delete permanently"}</button>
        </div>
      </div>
    </ItemModalShell>
  </ModalPortal>;
}

/** Reminder emails deep-link to ?view=loans&loan=<id>; App strips both when leaving the page. */
function initialLoanFromUrl(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get("loan") || "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) ? value : null;
  } catch { return null; }
}
