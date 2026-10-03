import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight, BarChart3, CalendarDays, Check, ChevronRight,
  CircleDollarSign, Clock3, CreditCard, Landmark, Link2, Pencil, Plus, Receipt,
  Search, ShieldCheck, Trash2, TrendingDown, TrendingUp, UsersRound, WalletCards, X,
} from "lucide-react";
import { SECTION_BY_ID } from "../data";
import ModalPortal from "./ModalPortal";
import type { PersoraContact, VaultItem, ViewId } from "../types";
import "../personal-finance.css";

type FinanceKind = "income" | "expense" | "loan" | "asset";
type FinanceTab = "dashboard" | FinanceKind;
type FinanceSaveDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string };

interface PersonalFinanceViewProps {
  items: VaultItem[];
  contacts: PersoraContact[];
  onSave: (draft: FinanceSaveDraft) => Promise<void>;
  onOpenItem: (item: VaultItem) => void;
  onDeleteItem: (item: VaultItem) => void;
  onNavigate: (view: ViewId) => void;
}

const KIND_LABEL: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expense",
  loan: "Loans & Debt",
  asset: "Asset",
};
const KIND_PLURAL: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expenses",
  loan: "Loans & Debt",
  asset: "Assets",
};
const KIND_ICON = {
  income: TrendingUp,
  expense: TrendingDown,
  loan: Landmark,
  asset: WalletCards,
};
const CATEGORY_OPTIONS: Record<FinanceKind, string[]> = {
  income: ["Salary", "Business", "Freelance", "Investment", "Rental", "Gift", "Other"],
  expense: ["Housing", "Food & groceries", "Utilities", "Transport", "Healthcare", "Education", "Shopping", "Travel", "Subscriptions", "Other"],
  loan: ["Personal loan", "Mortgage", "Student loan", "Credit card debt", "Informal debt", "Money lent", "Other"],
  asset: ["Savings", "Property", "Vehicle", "Investment", "Business", "Valuables", "Other"],
};
const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SGD", "CAD", "AUD", "JPY", "CNY", "SAR"];
const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$", EUR: "€", GBP: "£", INR: "₹", AED: "د.إ", SGD: "S$", CAD: "C$", AUD: "A$", JPY: "¥", CNY: "¥", SAR: "﷼" };
const RELATED_SECTIONS = new Set(["documents", "wallet-cards", "accounts", "subscriptions", "family", "purchases", "memberships", "academics"]);

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function parseIds(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}
function amountOf(item: VaultItem) {
  const amount = Number(item.metadata.financeType === "loan" ? item.metadata.outstandingAmount || item.metadata.amount : item.metadata.amount);
  return Number.isFinite(amount) ? amount : 0;
}
function formatMoney(value: number, currency: string) {
  const symbol = CURRENCY_SYMBOL[currency] || `${currency} `;
  const formatted = Math.abs(value).toLocaleString("en-BD", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 });
  return `${value < 0 ? "−" : ""}${symbol} ${formatted}`;
}
function itemDate(item: VaultItem) {
  return item.metadata.transactionDate || item.metadata.startDate || item.metadata.valuationDate || item.metadata.dueDate || "";
}
function shortDate(value?: string) {
  if (!value) return "Date not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-BD", { day: "numeric", month: "short", year: "numeric" });
}
function kindOf(item: VaultItem): FinanceKind {
  const value = item.metadata.financeType;
  return value === "income" || value === "expense" || value === "loan" || value === "asset" ? value : "expense";
}
function relatedRecordLabel(item: VaultItem) {
  if (item.section === "accounts") return item.metadata.accountKind === "Bank Account" ? "Bank account" : "Internet account";
  return SECTION_BY_ID[item.section]?.label || "Vault record";
}
function relatedRecordMeta(item: VaultItem) {
  if (item.section === "accounts" && item.metadata.accountKind === "Bank Account") return [item.metadata.bankName, item.metadata.bankAccountType].filter(Boolean).join(" · ") || "Bank details";
  if (item.section === "wallet-cards") return [item.metadata.network, item.metadata.lastFour ? `•••• ${item.metadata.lastFour}` : ""].filter(Boolean).join(" · ") || "Payment card";
  return [item.metadata.type, item.metadata.plan, item.metadata.relationship, item.metadata.brand].filter(Boolean).join(" · ") || relatedRecordLabel(item);
}
function monthlyFlowAmount(item: VaultItem, year: number, month: number) {
  if (kindOf(item) !== "income" && kindOf(item) !== "expense") return 0;
  const value = item.metadata.transactionDate || "";
  if (!value) return 0;
  const start = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const monthDistance = (year - start.getFullYear()) * 12 + month - start.getMonth();
  if (monthDistance < 0) return 0;
  const frequency = item.metadata.frequency || "One-time";
  if (frequency === "One-time") return monthDistance === 0 ? amountOf(item) : 0;
  if (frequency === "Weekly") return amountOf(item) * 4.345;
  if (frequency === "Quarterly") return monthDistance % 3 === 0 ? amountOf(item) : 0;
  if (frequency === "Yearly") return monthDistance % 12 === 0 ? amountOf(item) : 0;
  return amountOf(item);
}

export default function PersonalFinanceView({ items, contacts, onSave, onOpenItem, onDeleteItem, onNavigate }: PersonalFinanceViewProps) {
  const records = useMemo(() => items.filter((item) => item.section === "personal-finance").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items]);
  const relatedItems = useMemo(() => items.filter((item) => RELATED_SECTIONS.has(item.section)).sort((a, b) => a.title.localeCompare(b.title)), [items]);
  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const relatedById = useMemo(() => new Map(relatedItems.map((item) => [item.id, item])), [relatedItems]);
  const [activeTab, setActiveTab] = useState<FinanceTab>("dashboard");
  const [summaryCurrency, setSummaryCurrency] = useState("BDT");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VaultItem | null>(null);
  const [newRecordType, setNewRecordType] = useState<FinanceKind>("expense");
  const [detailRecord, setDetailRecord] = useState<VaultItem | null>(null);

  const openAdd = (kind?: FinanceKind) => {
    setEditingRecord(null);
    setNewRecordType(kind || (activeTab === "dashboard" ? "expense" : activeTab));
    setEditorOpen(true);
  };
  const closeEditor = () => { setEditorOpen(false); setEditingRecord(null); };
  const recordsForTab = activeTab === "dashboard" ? [] : records.filter((item) => kindOf(item) === activeTab).filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || `${item.title} ${Object.values(item.metadata).join(" ")}`.toLowerCase().includes(query);
  });

  const now = new Date();
  const currencyRecords = records.filter((item) => (item.metadata.currency || "BDT") === summaryCurrency);
  const monthlyIncomeRecords = currencyRecords.filter((item) => kindOf(item) === "income" && monthlyFlowAmount(item, now.getFullYear(), now.getMonth()) > 0);
  const monthlyExpenseRecords = currencyRecords.filter((item) => kindOf(item) === "expense" && monthlyFlowAmount(item, now.getFullYear(), now.getMonth()) > 0);
  const monthlyIncome = currencyRecords.filter((item) => kindOf(item) === "income").reduce((sum, item) => sum + monthlyFlowAmount(item, now.getFullYear(), now.getMonth()), 0);
  const monthlyExpenses = currencyRecords.filter((item) => kindOf(item) === "expense").reduce((sum, item) => sum + monthlyFlowAmount(item, now.getFullYear(), now.getMonth()), 0);
  const assetsValue = records.filter((item) => kindOf(item) === "asset" && (item.metadata.currency || "BDT") === summaryCurrency && item.metadata.status !== "Sold").reduce((sum, item) => sum + amountOf(item), 0);
  const debtValue = records.filter((item) => kindOf(item) === "loan" && (item.metadata.currency || "BDT") === summaryCurrency && item.metadata.status !== "Settled" && item.metadata.debtDirection !== "Owed to me").reduce((sum, item) => sum + amountOf(item), 0);
  const receivablesValue = records.filter((item) => kindOf(item) === "loan" && (item.metadata.currency || "BDT") === summaryCurrency && item.metadata.status !== "Settled" && item.metadata.debtDirection === "Owed to me").reduce((sum, item) => sum + amountOf(item), 0);
  const netWorth = assetsValue + receivablesValue - debtValue;
  const currenciesInUse = [...new Set(records.map((item) => item.metadata.currency || "BDT"))].filter((currency) => currency !== summaryCurrency);

  const monthlySeries = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const periodRecords = records.filter((item) => (item.metadata.currency || "BDT") === summaryCurrency);
    return {
      label: date.toLocaleDateString("en", { month: "short" }),
      income: periodRecords.filter((item) => kindOf(item) === "income").reduce((sum, item) => sum + monthlyFlowAmount(item, date.getFullYear(), date.getMonth()), 0),
      expenses: periodRecords.filter((item) => kindOf(item) === "expense").reduce((sum, item) => sum + monthlyFlowAmount(item, date.getFullYear(), date.getMonth()), 0),
    };
  });
  const chartMax = Math.max(1, ...monthlySeries.flatMap((month) => [month.income, month.expenses]));
  const hasCashFlow = monthlySeries.some((month) => month.income > 0 || month.expenses > 0);

  const upcoming = useMemo(() => {
    const rows: { id: string; title: string; label: string; date: string; item: VaultItem }[] = [];
    records.forEach((item) => {
      if (kindOf(item) === "loan" && item.metadata.dueDate) rows.push({ id: item.id, title: item.title, label: "Debt payment due", date: item.metadata.dueDate, item });
    });
    items.forEach((item) => {
      if (item.section === "subscriptions" && item.metadata.renewalDate) rows.push({ id: item.id, title: item.title, label: "Subscription renewal", date: item.metadata.renewalDate, item });
      if (item.section === "purchases" && item.metadata.warrantyExpiry) rows.push({ id: item.id, title: item.title, label: "Warranty expiry", date: item.metadata.warrantyExpiry, item });
    });
    const start = new Date(`${localToday()}T00:00:00`).getTime();
    return rows.filter((row) => {
      const due = new Date(`${row.date.slice(0, 10)}T00:00:00`).getTime();
      return Number.isFinite(due) && due >= start && due <= start + 45 * 86_400_000;
    }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [items, records]);

  const relatedCounts = [
    { label: "Accounts & banks", count: relatedItems.filter((item) => item.section === "accounts").length, view: "accounts" as ViewId, icon: Landmark },
    { label: "Cards", count: relatedItems.filter((item) => item.section === "wallet-cards").length, view: "wallet-cards" as ViewId, icon: CreditCard },
    { label: "Subscriptions", count: relatedItems.filter((item) => item.section === "subscriptions").length, view: "subscriptions" as ViewId, icon: Receipt },
    { label: "Purchases & warranties", count: relatedItems.filter((item) => item.section === "purchases").length, view: "purchases" as ViewId, icon: ShieldCheck },
  ];

  const tabs: { id: FinanceTab; label: string; icon: typeof WalletCards; count: number }[] = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3, count: records.length },
    { id: "income", label: "Income", icon: TrendingUp, count: records.filter((item) => kindOf(item) === "income").length },
    { id: "expense", label: "Expenses", icon: TrendingDown, count: records.filter((item) => kindOf(item) === "expense").length },
    { id: "loan", label: "Loans & Debt", icon: Landmark, count: records.filter((item) => kindOf(item) === "loan").length },
    { id: "asset", label: "Assets", icon: WalletCards, count: records.filter((item) => kindOf(item) === "asset").length },
  ];

  return <div className="personal-finance-page">
    <header className="finance-page-heading">
      <div className="finance-page-copy"><span className="finance-eyebrow"><span className="finance-eyebrow-dot"/> PERSONAL FINANCE · PRIVATE SPACE</span><h2>Make sense of where it goes.</h2><p>Bring your income, everyday spending, debt and assets into one calm, connected view.</p></div>
      <div className="finance-heading-actions"><label className="finance-currency-picker"><span>Summary currency</span><select aria-label="Summary currency" value={summaryCurrency} onChange={(event) => setSummaryCurrency(event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><button className="finance-primary-button" onClick={() => openAdd()}><Plus size={16}/> Add record</button></div>
    </header>

    <div className="finance-tabs" role="tablist" aria-label="Personal finance sections">{tabs.map(({ id, label, icon: Icon, count }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "is-active" : ""} onClick={() => { setActiveTab(id); setSearch(""); }}><Icon size={15}/><span>{label}</span><small>{count}</small></button>)}</div>

    {activeTab === "dashboard" ? <>
      <section className="finance-summary-section" aria-label={`Monthly cash flow in ${summaryCurrency}`}>
        <div className="finance-summary-heading"><div><span className="finance-panel-kicker">THIS MONTH · {summaryCurrency}</span><h3>Monthly cash flow</h3></div><small>{currencyRecords.length} records tracked</small></div>
        <div className="finance-metric-grid finance-monthly-metrics">
          <FinanceMetric label="Income this month" value={formatMoney(monthlyIncome, summaryCurrency)} note={`${monthlyIncomeRecords.length} active records`} tone="green" icon={TrendingUp}/>
          <FinanceMetric label="Expenses this month" value={formatMoney(monthlyExpenses, summaryCurrency)} note={`${monthlyExpenseRecords.length} active records`} tone="orange" icon={TrendingDown}/>
          <FinanceMetric label="Net cash flow" value={formatMoney(monthlyIncome - monthlyExpenses, summaryCurrency)} note="Income minus expenses" tone={monthlyIncome - monthlyExpenses >= 0 ? "blue" : "rose"} icon={CircleDollarSign}/>
        </div>
      </section>
      <div className="finance-dashboard-grid">
        <section className="finance-panel finance-cashflow-panel"><div className="finance-panel-heading"><div><span className="finance-panel-kicker">Last six months · {summaryCurrency}</span><h3>Cash flow</h3></div><div className="finance-chart-legend"><span><i className="finance-legend-income"/>Income</span><span><i className="finance-legend-expense"/>Expenses</span></div></div>
          {hasCashFlow ? <div className="finance-chart" role="img" aria-label="Six-month income and expenses comparison">{monthlySeries.map((month) => <div className="finance-chart-month" key={month.label}><div className="finance-chart-bars"><div className="finance-chart-bar finance-bar-income" style={{ height: `${Math.max(3, month.income / chartMax * 100)}%` }} title={`Income ${formatMoney(month.income, summaryCurrency)}`}/><div className="finance-chart-bar finance-bar-expense" style={{ height: `${Math.max(3, month.expenses / chartMax * 100)}%` }} title={`Expenses ${formatMoney(month.expenses, summaryCurrency)}`}/></div><span>{month.label}</span></div>)}</div> : <div className="finance-chart-empty"><BarChart3 size={22}/><span>Add income or expenses to see your cash flow.</span></div>}
          <p className="finance-currency-note">Recurring income and expenses are projected from their start date; weekly amounts use a monthly average. {currenciesInUse.length > 0 ? "Switch the summary currency to view other currencies; values are not converted." : "Different currencies are never combined or converted."}</p>
        </section>
        <section className="finance-panel finance-upcoming-panel"><div className="finance-panel-heading"><div><span className="finance-panel-kicker">The next 45 days</span><h3>Coming up</h3></div><CalendarDays size={17}/></div>
          {upcoming.length ? <div className="finance-upcoming-list">{upcoming.map((row) => <button key={row.id} className="finance-upcoming-row" onClick={() => row.item.section === "personal-finance" ? setDetailRecord(row.item) : onOpenItem(row.item)}><span className="finance-upcoming-date">{new Date(`${row.date.slice(0, 10)}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" })}</span><span className="finance-upcoming-copy"><b>{row.title}</b><small>{row.label}</small></span><ChevronRight size={15}/></button>)}</div> : <div className="finance-upcoming-empty"><Clock3 size={19}/><span>No loan due dates, renewals or warranties are coming up soon.</span></div>}
          <div className="finance-upcoming-footer"><span>Subscriptions and warranties are included from your vault.</span><button onClick={() => onNavigate("subscriptions")}>Review <ArrowRight size={13}/></button></div>
        </section>
      </div>
      <section className="finance-summary-section finance-position-section" aria-label={`Financial position in ${summaryCurrency}`}>
        <div className="finance-summary-heading"><div><span className="finance-panel-kicker">FINANCIAL POSITION · {summaryCurrency}</span><h3>What you own and owe</h3></div><small>Current recorded balances</small></div>
        <div className="finance-metric-grid finance-position-metrics">
          <FinanceMetric label="Assets" value={formatMoney(assetsValue, summaryCurrency)} note={`${records.filter((item) => kindOf(item) === "asset" && (item.metadata.currency || "BDT") === summaryCurrency && item.metadata.status !== "Sold").length} active records`} tone="violet" icon={WalletCards}/>
          <FinanceMetric label="Debt outstanding" value={formatMoney(debtValue, summaryCurrency)} note="Unsettled amounts you owe" tone="rose" icon={Landmark}/>
          <FinanceMetric label="Owed to you" value={formatMoney(receivablesValue, summaryCurrency)} note="Money lent or receivable" tone="blue" icon={CircleDollarSign}/>
          <FinanceMetric label="Estimated net worth" value={formatMoney(netWorth, summaryCurrency)} note="Assets + receivables − debt" tone="slate" icon={ShieldCheck}/>
        </div>
      </section>
      <section className="finance-panel finance-recent-panel"><div className="finance-panel-heading"><div><span className="finance-panel-kicker">Your latest money records</span><h3>Recent activity</h3></div><button className="finance-text-link" onClick={() => setActiveTab("expense")}>View expenses <ArrowRight size={14}/></button></div>
        {records.length ? <div className="finance-recent-list">{records.slice(0, 5).map((item) => <FinanceRecordRow key={item.id} item={item} onOpen={() => setDetailRecord(item)} onEdit={() => { setEditingRecord(item); setNewRecordType(kindOf(item)); setEditorOpen(true); }} onDelete={() => onDeleteItem(item)}/>)}</div> : <FinanceEmpty onAdd={() => openAdd("income")} />}
      </section>
      <section className="finance-panel finance-links-panel"><div className="finance-panel-heading"><div><span className="finance-panel-kicker">Connected to your life</span><h3>Related spaces</h3></div><Link2 size={17}/></div><div className="finance-linked-spaces">{relatedCounts.map(({ label, count, view, icon: Icon }) => <button key={label} onClick={() => onNavigate(view)}><span><Icon size={15}/></span><b>{label}</b><small>{count} records</small><ChevronRight size={15}/></button>)}<button onClick={() => onNavigate("family")}><span><UsersRound size={15}/></span><b>Family & people</b><small>{relatedItems.filter((item) => item.section === "family").length + contacts.length} records</small><ChevronRight size={15}/></button></div><p className="finance-links-note">Link related vault records or contacts to any income, expense, loan or asset.</p></section>
    </> : <>
      <div className="finance-records-toolbar"><div><span className="finance-panel-kicker">{KIND_PLURAL[activeTab]}</span><h3>{activeTab === "loan" ? "Keep obligations visible." : activeTab === "asset" ? "Know what you own." : activeTab === "income" ? "Track money coming in." : "See where money goes."}</h3></div><div className="finance-records-actions"><label className="finance-record-search"><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${KIND_PLURAL[activeTab].toLowerCase()}…`} aria-label={`Search ${KIND_PLURAL[activeTab].toLowerCase()}`}/></label><button className="finance-primary-button" onClick={() => openAdd(activeTab)}><Plus size={15}/> Add {KIND_LABEL[activeTab].toLowerCase()}</button></div></div>
      <div className="finance-list-summary"><span><b>{recordsForTab.length}</b> {recordsForTab.length === 1 ? KIND_LABEL[activeTab].toLowerCase() : KIND_PLURAL[activeTab].toLowerCase()}</span><span><ShieldCheck size={12}/> Private to you</span></div>
      {recordsForTab.length ? <div className="finance-record-list">{recordsForTab.map((item) => <FinanceRecordRow key={item.id} item={item} onOpen={() => setDetailRecord(item)} onEdit={() => { setEditingRecord(item); setNewRecordType(kindOf(item)); setEditorOpen(true); }} onDelete={() => onDeleteItem(item)}/>)}</div> : <FinanceEmpty onAdd={() => openAdd(activeTab)}/>}
    </>}

    <ModalPortal>
      {editorOpen && <FinanceRecordDialog key={editingRecord?.id || `new-${newRecordType}`} item={editingRecord || undefined} defaultType={newRecordType} relatedItems={relatedItems} contacts={contacts} onClose={closeEditor} onSave={onSave}/>}
      {detailRecord && <FinanceRecordDetailsDialog item={detailRecord} linkedItems={parseIds(detailRecord.metadata.relatedItemIds).map((id) => relatedById.get(id)).filter((item): item is VaultItem => Boolean(item))} linkedContacts={parseIds(detailRecord.metadata.relatedContactIds).map((id) => contactById.get(id)).filter((contact): contact is PersoraContact => Boolean(contact))} onClose={() => setDetailRecord(null)} onEdit={() => { setEditingRecord(detailRecord); setNewRecordType(kindOf(detailRecord)); setEditorOpen(true); setDetailRecord(null); }} onDelete={() => { onDeleteItem(detailRecord); setDetailRecord(null); }} onOpenItem={onOpenItem} onNavigate={onNavigate}/>} 
    </ModalPortal>
  </div>;
}

function FinanceMetric({ label, value, note, tone, icon: Icon }: { label: string; value: string; note: string; tone: string; icon: typeof TrendingUp }) {
  return <article className={`finance-metric finance-metric-${tone}`}><span className="finance-metric-icon"><Icon size={17}/></span><span className="finance-metric-label">{label}</span><b className="finance-metric-value">{value}</b><small>{note}</small></article>;
}

function FinanceEmpty({ onAdd }: { onAdd: () => void }) {
  return <div className="finance-empty-state"><span><CircleDollarSign size={22}/></span><h3>Nothing here yet</h3><p>Add a record to start building your personal finance picture.</p><button className="finance-primary-button" onClick={onAdd}><Plus size={15}/> Add a record</button></div>;
}

function FinanceRecordRow({ item, onOpen, onEdit, onDelete }: { item: VaultItem; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const kind = kindOf(item);
  const Icon = KIND_ICON[kind];
  const amount = amountOf(item);
  const valueDate = itemDate(item);
  const status = item.metadata.status || (kind === "asset" ? "Current" : "Active");
  const category = item.metadata.category || item.metadata.assetCategory || item.metadata.debtCategory || KIND_LABEL[kind];
  const currency = item.metadata.currency || "BDT";
  const isNegative = kind === "expense" || (kind === "loan" && item.metadata.debtDirection !== "Owed to me");
  return <article className="finance-record-row">
    <button className={`finance-record-icon finance-icon-${kind}`} aria-label={`Open ${item.title}`} onClick={onOpen}><Icon size={17}/></button>
    <button className="finance-record-main" onClick={onOpen}><span><b>{item.title}</b><small>{category}{item.metadata.frequency && item.metadata.frequency !== "One-time" ? ` · ${item.metadata.frequency}` : ""}{valueDate ? ` · ${shortDate(valueDate)}` : ""}</small></span><span className={`finance-status finance-status-${status.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{status}</span></button>
    <b className={`finance-record-amount ${isNegative ? "amount-negative" : "amount-positive"}`}>{isNegative ? "−" : kind === "income" || kind === "asset" || item.metadata.debtDirection === "Owed to me" ? "+" : ""}{formatMoney(amount, currency)}</b>
    <div className="finance-record-actions"><button type="button" onClick={onEdit} aria-label={`Edit ${item.title}`} title="Edit"><Pencil size={14}/></button><button type="button" onClick={onDelete} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={14}/></button></div>
  </article>;
}

interface FinanceFormState {
  financeType: FinanceKind;
  title: string;
  amount: string;
  currency: string;
  category: string;
  date: string;
  dueDate: string;
  frequency: string;
  status: string;
  notes: string;
  debtDirection: string;
  principalAmount: string;
  interestRate: string;
  monthlyPayment: string;
  location: string;
  relatedItemIds: string[];
  relatedContactIds: string[];
}
function defaultStatus(kind: FinanceKind) {
  return kind === "income" ? "Received" : kind === "expense" ? "Paid" : kind === "loan" ? "Active" : "Current";
}
function formFromItem(item: VaultItem | undefined, defaultType: FinanceKind): FinanceFormState {
  const kind = item ? kindOf(item) : defaultType;
  const amount = item?.metadata.amount || item?.metadata.outstandingAmount || "";
  return {
    financeType: kind,
    title: item?.title || "",
    amount,
    currency: item?.metadata.currency || "BDT",
    category: item?.metadata.category || item?.metadata.assetCategory || item?.metadata.debtCategory || CATEGORY_OPTIONS[kind][0],
    date: item ? itemDate(item) : localToday(),
    dueDate: item?.metadata.dueDate || "",
    frequency: item?.metadata.frequency || "One-time",
    status: item?.metadata.status || defaultStatus(kind),
    notes: item?.metadata.notes || "",
    debtDirection: item?.metadata.debtDirection || "I owe",
    principalAmount: item?.metadata.principalAmount || "",
    interestRate: item?.metadata.interestRate || "",
    monthlyPayment: item?.metadata.monthlyPayment || "",
    location: item?.metadata.location || "",
    relatedItemIds: parseIds(item?.metadata.relatedItemIds),
    relatedContactIds: parseIds(item?.metadata.relatedContactIds),
  };
}

function FinanceRecordDialog({ item, defaultType, relatedItems, contacts, onClose, onSave }: { item?: VaultItem; defaultType: FinanceKind; relatedItems: VaultItem[]; contacts: PersoraContact[]; onClose: () => void; onSave: (draft: FinanceSaveDraft) => Promise<void> }) {
  const [form, setForm] = useState<FinanceFormState>(() => formFromItem(item, defaultType));
  const [relatedSearch, setRelatedSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof FinanceFormState,>(key: K, value: FinanceFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const linkedItems = relatedItems.filter((entry) => form.relatedItemIds.includes(entry.id));
  const filteredRelatedItems = relatedItems.filter((entry) => `${entry.title} ${relatedRecordLabel(entry)} ${relatedRecordMeta(entry)}`.toLowerCase().includes(relatedSearch.toLowerCase())).slice(0, 28);
  const kind = form.financeType;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    const amount = Number(form.amount);
    if (!title) { setError("Add a clear name for this record."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an amount greater than zero."); return; }
    setError(""); setSaving(true);
    const metadata: Record<string, string> = {
      financeType: kind,
      amount: String(amount),
      currency: form.currency,
      status: form.status,
      notes: form.notes.trim(),
      relatedItemIds: JSON.stringify(form.relatedItemIds),
      relatedContactIds: JSON.stringify(form.relatedContactIds),
    };
    if (kind === "income" || kind === "expense") {
      metadata.category = form.category;
      metadata.transactionDate = form.date;
      metadata.frequency = form.frequency;
    } else if (kind === "loan") {
      metadata.debtCategory = form.category;
      metadata.debtDirection = form.debtDirection;
      metadata.outstandingAmount = String(amount);
      metadata.principalAmount = form.principalAmount.trim();
      metadata.interestRate = form.interestRate.trim();
      metadata.monthlyPayment = form.monthlyPayment.trim();
      metadata.startDate = form.date;
      metadata.dueDate = form.dueDate;
    } else {
      metadata.assetCategory = form.category;
      metadata.valuationDate = form.date;
      metadata.location = form.location.trim();
    }
    try {
      await onSave({ section: "personal-finance", title, metadata, file: item?.file, favorite: item?.favorite, pinned: item?.pinned, ...(item?.id ? { id: item.id } : {}) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The finance record could not be saved.");
    } finally { setSaving(false); }
  };

  const toggleRelatedItem = (id: string) => set("relatedItemIds", form.relatedItemIds.includes(id) ? form.relatedItemIds.filter((value) => value !== id) : [...form.relatedItemIds, id]);
  const toggleRelatedContact = (id: string) => set("relatedContactIds", form.relatedContactIds.includes(id) ? form.relatedContactIds.filter((value) => value !== id) : [...form.relatedContactIds, id]);

  return <div className="finance-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className="finance-record-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-dialog-title">
      <header className="finance-dialog-header"><span className="finance-dialog-icon"><CircleDollarSign size={18}/></span><div><small>{item ? "UPDATE RECORD" : "ADD TO YOUR FINANCES"}</small><h2 id="finance-dialog-title">{item ? "Edit finance record" : "Add a finance record"}</h2></div><button className="finance-dialog-close" type="button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18}/></button></header>
      <form className="finance-dialog-form" onSubmit={(event) => void submit(event)}>
        <div className="finance-dialog-scroll">
          <label className="finance-form-label">Record type<select value={form.financeType} onChange={(event) => { const next = event.target.value as FinanceKind; setForm((current) => ({ ...current, financeType: next, category: CATEGORY_OPTIONS[next][0], status: defaultStatus(next) })); }}><option value="income">Income</option><option value="expense">Expense</option><option value="loan">Loans &amp; Debt</option><option value="asset">Asset</option></select></label>
          <div className="finance-form-grid"><label className="finance-form-label finance-form-wide">Name<input value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={160} placeholder={kind === "income" ? "e.g. Monthly salary" : kind === "expense" ? "e.g. Household groceries" : kind === "loan" ? "e.g. Student loan" : "e.g. Emergency savings"} required/></label>
            <label className="finance-form-label">{kind === "loan" ? "Outstanding balance" : kind === "asset" ? "Current value" : "Amount"}<input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={(event) => set("amount", event.target.value)} placeholder="0.00" required/></label>
            <label className="finance-form-label">Currency<select value={form.currency} onChange={(event) => set("currency", event.target.value)}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            <label className="finance-form-label">Category<select value={form.category} onChange={(event) => set("category", event.target.value)}>{CATEGORY_OPTIONS[kind].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="finance-form-label">{kind === "income" ? "Date received" : kind === "expense" ? "Date" : kind === "loan" ? "Start date" : "Valuation date"}<input type="date" value={form.date} onChange={(event) => set("date", event.target.value)}/></label>
            {(kind === "income" || kind === "expense") && <><label className="finance-form-label">Frequency<select value={form.frequency} onChange={(event) => set("frequency", event.target.value)}><option>One-time</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option></select></label><label className="finance-form-label">Status<select value={form.status} onChange={(event) => set("status", event.target.value)}>{(kind === "income" ? ["Received", "Expected"] : ["Paid", "Planned"]).map((status) => <option key={status}>{status}</option>)}</select></label></>}
            {kind === "loan" && <><label className="finance-form-label">Direction<select value={form.debtDirection} onChange={(event) => set("debtDirection", event.target.value)}><option>I owe</option><option>Owed to me</option></select></label><label className="finance-form-label">Original principal<input type="number" min="0" step="0.01" value={form.principalAmount} onChange={(event) => set("principalAmount", event.target.value)} placeholder="Optional"/></label><label className="finance-form-label">Interest rate (%)<input type="number" min="0" step="0.01" value={form.interestRate} onChange={(event) => set("interestRate", event.target.value)} placeholder="Optional"/></label><label className="finance-form-label">Monthly payment<input type="number" min="0" step="0.01" value={form.monthlyPayment} onChange={(event) => set("monthlyPayment", event.target.value)} placeholder="Optional"/></label><label className="finance-form-label">Next due date<input type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)}/></label><label className="finance-form-label">Status<select value={form.status} onChange={(event) => set("status", event.target.value)}><option>Active</option><option>Settled</option></select></label></>}
            {kind === "asset" && <><label className="finance-form-label">Status<select value={form.status} onChange={(event) => set("status", event.target.value)}><option>Current</option><option>Sold</option></select></label><label className="finance-form-label finance-form-wide">Location / account details<input value={form.location} onChange={(event) => set("location", event.target.value)} placeholder="Optional"/></label></>}
            <label className="finance-form-label finance-form-wide">Notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Add context, reminders or a short description…"/></label>
          </div>
          <section className="finance-link-picker"><div className="finance-link-picker-heading"><div><b><Link2 size={14}/> Connect vault records</b><small>Link documents, bank accounts, cards, subscriptions, family or purchases.</small></div><span>{linkedItems.length}</span></div><label className="finance-link-search"><Search size={13}/><input value={relatedSearch} onChange={(event) => setRelatedSearch(event.target.value)} placeholder="Find a record…" aria-label="Find a related vault record"/></label><div className="finance-link-options">{filteredRelatedItems.map((entry) => <label key={entry.id} className="finance-link-option"><input type="checkbox" checked={form.relatedItemIds.includes(entry.id)} onChange={() => toggleRelatedItem(entry.id)}/><span className="finance-link-option-main"><b>{entry.title}</b><small>{relatedRecordLabel(entry)} · {relatedRecordMeta(entry)}</small></span><Check size={14}/></label>)}{!filteredRelatedItems.length && <span className="finance-link-none">No matching vault records.</span>}</div></section>
          <section className="finance-link-picker finance-contacts-picker"><div className="finance-link-picker-heading"><div><b><UsersRound size={14}/> Connect people</b><small>Optionally relate a contact such as a client, lender or family member.</small></div><span>{form.relatedContactIds.length}</span></div>{contacts.length ? <div className="finance-contact-options">{contacts.map((contact) => <label key={contact.id} className="finance-contact-option"><input type="checkbox" checked={form.relatedContactIds.includes(contact.id)} onChange={() => toggleRelatedContact(contact.id)}/><span>{contact.name}<small>{[contact.jobTitle, contact.company, contact.category].filter(Boolean).join(" · ") || "Contact"}</small></span><Check size={14}/></label>)}</div> : <p className="finance-no-contacts">No contacts yet. Add people in Contacts, then link them here.</p>}</section>
        </div>
        {error && <div className="finance-form-error" role="alert">{error}</div>}
        <footer className="finance-dialog-footer"><span><ShieldCheck size={13}/> Private to your account</span><div><button type="button" className="finance-cancel-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="finance-primary-button" disabled={saving}>{saving ? "Saving…" : item ? "Save changes" : "Save record"}<Check size={14}/></button></div></footer>
      </form>
    </section>
  </div>;
}

function FinanceRecordDetailsDialog({ item, linkedItems, linkedContacts, onClose, onEdit, onDelete, onOpenItem, onNavigate }: { item: VaultItem; linkedItems: VaultItem[]; linkedContacts: PersoraContact[]; onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenItem: (item: VaultItem) => void; onNavigate: (view: ViewId) => void }) {
  const kind = kindOf(item);
  const Icon = KIND_ICON[kind];
  const category = item.metadata.category || item.metadata.assetCategory || item.metadata.debtCategory || KIND_LABEL[kind];
  const amount = amountOf(item);
  const currency = item.metadata.currency || "BDT";
  const date = itemDate(item);
  const facts: [string, string][] = [
    ["Type", KIND_LABEL[kind]], ["Category", category], ["Status", item.metadata.status || "Active"],
    ["Currency", currency], ...(date ? [[kind === "loan" ? "Started" : kind === "asset" ? "Valued" : "Date", shortDate(date)] as [string, string]] : []),
    ...(item.metadata.frequency && item.metadata.frequency !== "One-time" ? [["Frequency", item.metadata.frequency] as [string, string]] : []),
    ...(kind === "loan" && item.metadata.debtDirection ? [["Direction", item.metadata.debtDirection] as [string, string]] : []),
    ...(kind === "loan" && item.metadata.principalAmount ? [["Original principal", formatMoney(Number(item.metadata.principalAmount), currency)] as [string, string]] : []),
    ...(kind === "loan" && item.metadata.interestRate ? [["Interest rate", `${item.metadata.interestRate}%`] as [string, string]] : []),
    ...(kind === "loan" && item.metadata.monthlyPayment ? [["Monthly payment", formatMoney(Number(item.metadata.monthlyPayment), currency)] as [string, string]] : []),
    ...(kind === "loan" && item.metadata.dueDate ? [["Next due date", shortDate(item.metadata.dueDate)] as [string, string]] : []),
    ...(kind === "asset" && item.metadata.location ? [["Location / account", item.metadata.location] as [string, string]] : []),
  ];
  return <div className="finance-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="finance-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-detail-title"><header><span className={`finance-dialog-icon finance-icon-${kind}`}><Icon size={18}/></span><div><small>{KIND_LABEL[kind].toUpperCase()}</small><h2 id="finance-detail-title">{item.title}</h2></div><button className="finance-dialog-close" onClick={onClose} aria-label="Close"><X size={18}/></button></header><div className="finance-detail-scroll"><div className="finance-detail-amount"><small>{kind === "loan" ? "Outstanding balance" : kind === "asset" ? "Current value" : kind === "income" ? "Income amount" : "Expense amount"}</small><b>{(kind === "expense" || kind === "loan" && item.metadata.debtDirection !== "Owed to me") ? "−" : kind === "income" || kind === "asset" || item.metadata.debtDirection === "Owed to me" ? "+" : ""}{formatMoney(amount, currency)}</b></div><div className="finance-detail-facts">{facts.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>{item.metadata.notes && <section className="finance-detail-notes"><small>NOTES</small><p>{item.metadata.notes}</p></section>}
      <section className="finance-detail-links"><div className="finance-detail-subhead"><b><Link2 size={14}/> Connected records</b><small>{linkedItems.length}</small></div>{linkedItems.length ? linkedItems.map((entry) => <button key={entry.id} onClick={() => { onClose(); onOpenItem(entry); }}><span><b>{entry.title}</b><small>{relatedRecordLabel(entry)} · {relatedRecordMeta(entry)}</small></span><ChevronRight size={15}/></button>) : <p>No vault records are linked yet.</p>}</section>
      <section className="finance-detail-links"><div className="finance-detail-subhead"><b><UsersRound size={14}/> Connected people</b><small>{linkedContacts.length}</small></div>{linkedContacts.length ? linkedContacts.map((contact) => <button key={contact.id} onClick={() => { onClose(); onNavigate("contacts"); }}><span><b>{contact.name}</b><small>{[contact.jobTitle, contact.company, contact.category].filter(Boolean).join(" · ") || "Contact"}</small></span><ChevronRight size={15}/></button>) : <p>No contacts are linked yet.</p>}</section>
    </div><footer className="finance-detail-footer"><span><ShieldCheck size={13}/> Saved in your private vault</span><div><button className="finance-delete-button" onClick={onDelete} aria-label={`Delete ${item.title}`}><Trash2 size={14}/> Delete</button><button className="finance-primary-button" onClick={onEdit}><Pencil size={14}/> Edit</button></div></footer></section></div>;
}
