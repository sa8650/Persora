import { useState, type FormEvent } from "react";
import {
  Check, ChevronRight, CircleDollarSign, Landmark, Link2, Pencil, Search,
  ShieldCheck, Trash2, TrendingDown, TrendingUp, UsersRound, WalletCards,
} from "lucide-react";
import { SECTION_BY_ID } from "../data";
import ItemModalShell from "./ItemModalShell";
import type { PersoraContact, VaultItem, ViewId } from "../types";

/**
 * Centralized, standalone item modals for the Personal Finance space.
 * Both dialogs render through Persora's single ItemModalShell so finance
 * records share the exact same modal system as every other space.
 */

export type FinanceKind = "income" | "expense" | "loan" | "asset";
export type FinanceSaveDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string };

export const KIND_LABEL: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expense",
  loan: "Loans & Debt",
  asset: "Asset",
};
export const KIND_ICON = {
  income: TrendingUp,
  expense: TrendingDown,
  loan: Landmark,
  asset: WalletCards,
};
export const CATEGORY_OPTIONS: Record<FinanceKind, string[]> = {
  income: ["Salary", "Business", "Freelance", "Investment", "Rental", "Gift", "Other"],
  expense: ["Housing", "Food & groceries", "Utilities", "Transport", "Healthcare", "Education", "Shopping", "Travel", "Subscriptions", "Other"],
  loan: ["Personal loan", "Mortgage", "Student loan", "Credit card debt", "Informal debt", "Money lent", "Other"],
  asset: ["Savings", "Property", "Vehicle", "Investment", "Business", "Valuables", "Other"],
};
export const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SGD", "CAD", "AUD", "JPY", "CNY", "SAR"];
export const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$", EUR: "€", GBP: "£", INR: "₹", AED: "د.إ", SGD: "S$", CAD: "C$", AUD: "A$", JPY: "¥", CNY: "¥", SAR: "﷼" };

export function parseIds(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}
export function amountOf(item: VaultItem) {
  const amount = Number(item.metadata.financeType === "loan" ? item.metadata.outstandingAmount || item.metadata.amount : item.metadata.amount);
  return Number.isFinite(amount) ? amount : 0;
}
export function formatMoney(value: number, currency: string) {
  const symbol = CURRENCY_SYMBOL[currency] || `${currency} `;
  const formatted = Math.abs(value).toLocaleString("en-BD", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 });
  return `${value < 0 ? "−" : ""}${symbol} ${formatted}`;
}
export function itemDate(item: VaultItem) {
  return item.metadata.transactionDate || item.metadata.startDate || item.metadata.valuationDate || item.metadata.dueDate || "";
}
export function shortDate(value?: string) {
  if (!value) return "Date not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-BD", { day: "numeric", month: "short", year: "numeric" });
}
export function kindOf(item: VaultItem): FinanceKind {
  const value = item.metadata.financeType;
  return value === "income" || value === "expense" || value === "loan" || value === "asset" ? value : "expense";
}
export function relatedRecordLabel(item: VaultItem) {
  if (item.section === "accounts") return item.metadata.accountKind === "Bank Account" ? "Bank account" : "Internet account";
  return SECTION_BY_ID[item.section]?.label || "Vault record";
}
export function relatedRecordMeta(item: VaultItem) {
  if (item.section === "accounts" && item.metadata.accountKind === "Bank Account") return [item.metadata.bankName, item.metadata.bankAccountType].filter(Boolean).join(" · ") || "Bank details";
  if (item.section === "wallet-cards") return [item.metadata.network, item.metadata.lastFour ? `•••• ${item.metadata.lastFour}` : ""].filter(Boolean).join(" · ") || "Payment card";
  return [item.metadata.type, item.metadata.plan, item.metadata.relationship, item.metadata.brand].filter(Boolean).join(" · ") || relatedRecordLabel(item);
}
export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface FinanceFormState {
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
export function defaultStatus(kind: FinanceKind) {
  return kind === "income" ? "Received" : kind === "expense" ? "Paid" : kind === "loan" ? "Active" : "Current";
}
export function formFromItem(item: VaultItem | undefined, defaultType: FinanceKind): FinanceFormState {
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

export function FinanceRecordDialog({ item, defaultType, relatedItems, contacts, onClose, onSave }: { item?: VaultItem; defaultType: FinanceKind; relatedItems: VaultItem[]; contacts: PersoraContact[]; onClose: () => void; onSave: (draft: FinanceSaveDraft) => Promise<void> }) {
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

  return (
    <ItemModalShell
      labelledBy="finance-dialog-title"
      className="vault-modal-editor finance-record-dialog"
      icon={<CircleDollarSign size={18} />}
      eyebrow={item ? "UPDATE RECORD" : "ADD TO YOUR FINANCES"}
      title={item ? "Edit finance record" : "Add a finance record"}
      onClose={onClose}
      closeDisabled={saving}
      dismissable={!saving}
    >
      <form className="finance-dialog-form" onSubmit={(event) => void submit(event)}>
        <div className="vault-modal-scroll">
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
    </ItemModalShell>
  );
}

export function FinanceRecordDetailsDialog({ item, linkedItems, linkedContacts, onClose, onEdit, onDelete, onOpenItem, onNavigate }: { item: VaultItem; linkedItems: VaultItem[]; linkedContacts: PersoraContact[]; onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenItem: (item: VaultItem) => void; onNavigate: (view: ViewId) => void }) {
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
  return (
    <ItemModalShell
      labelledBy="finance-detail-title"
      className="vault-modal-detail finance-detail-dialog"
      icon={<Icon size={18} />}
      iconClassName={`finance-icon-${kind}`}
      eyebrow={KIND_LABEL[kind].toUpperCase()}
      title={item.title}
      onClose={onClose}
    >
      <div className="vault-modal-scroll finance-detail-scroll"><div className="finance-detail-amount"><small>{kind === "loan" ? "Outstanding balance" : kind === "asset" ? "Current value" : kind === "income" ? "Income amount" : "Expense amount"}</small><b>{(kind === "expense" || kind === "loan" && item.metadata.debtDirection !== "Owed to me") ? "−" : kind === "income" || kind === "asset" || item.metadata.debtDirection === "Owed to me" ? "+" : ""}{formatMoney(amount, currency)}</b></div><div className="finance-detail-facts">{facts.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>{item.metadata.notes && <section className="finance-detail-notes"><small>NOTES</small><p>{item.metadata.notes}</p></section>}
        <section className="finance-detail-links"><div className="finance-detail-subhead"><b><Link2 size={14}/> Connected records</b><small>{linkedItems.length}</small></div>{linkedItems.length ? linkedItems.map((entry) => <button key={entry.id} onClick={() => { onClose(); onOpenItem(entry); }}><span><b>{entry.title}</b><small>{relatedRecordLabel(entry)} · {relatedRecordMeta(entry)}</small></span><ChevronRight size={15}/></button>) : <p>No vault records are linked yet.</p>}</section>
        <section className="finance-detail-links"><div className="finance-detail-subhead"><b><UsersRound size={14}/> Connected people</b><small>{linkedContacts.length}</small></div>{linkedContacts.length ? linkedContacts.map((contact) => <button key={contact.id} onClick={() => { onClose(); onNavigate("contacts"); }}><span><b>{contact.name}</b><small>{[contact.jobTitle, contact.company, contact.category].filter(Boolean).join(" · ") || "Contact"}</small></span><ChevronRight size={15}/></button>) : <p>No contacts are linked yet.</p>}</section>
      </div>
      <footer className="finance-detail-footer"><span><ShieldCheck size={13}/> Saved in your private vault</span><div><button className="finance-delete-button" onClick={onDelete} aria-label={`Delete ${item.title}`}><Trash2 size={14}/> Delete</button><button className="finance-primary-button" onClick={onEdit}><Pencil size={14}/> Edit</button></div></footer>
    </ItemModalShell>
  );
}
