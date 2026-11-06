import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Receipt,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import ModalPortal from "../ModalPortal";
import { Checkbox, PersoraDatePicker } from "@/design-system";
import {
  TRAVEL_CURRENCIES,
  canRolePerform,
  formatTravelMoney,
  fromMinor,
  splitEqualMinor,
  toMinor,
  type BudgetScope,
} from "../../../cloudflare/travel-space-rules.js";
import {
  createTripSettlement,
  deleteTripExpense,
  deleteTripSettlement,
  openTripFile,
  saveTripBudget,
  saveTripExpense,
  uploadTripAttachment,
  type TravelExpense,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import type { AppUser, VaultItem } from "../../types";

interface Props {
  mode: "expenses" | "budget";
  user: AppUser;
  workspace: TravelWorkspace;
  onWorkspaceChange: (ws: TravelWorkspace) => void;
  onSaveVaultItem?: (draft: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) => Promise<VaultItem | void>;
  notify: (msg: string, kind?: "success" | "error") => void;
  initialOpenExpenseModal?: boolean;
  onModalHandled?: () => void;
}

export default function TripFinanceTabs({
  mode,
  user,
  workspace,
  onWorkspaceChange,
  onSaveVaultItem,
  notify,
  initialOpenExpenseModal,
  onModalHandled,
}: Props) {
  const canAddExpense = canRolePerform(workspace.role, "create_expense");
  const canEditBudget = canRolePerform(workspace.role, "edit_budget");
  const canSettle = canRolePerform(workspace.role, "edit_settlements");
  const primaryCur = workspace.trip.primaryCurrency;
  const overview = workspace.budgetOverview;

  const [typeFilter, setTypeFilter] = useState<"all" | "personal" | "shared">("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [travellerFilter, setTravellerFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [expenseModalOpen, setExpenseModalOpen] = useState<boolean>(Boolean(initialOpenExpenseModal));
  const [editingExpense, setEditingExpense] = useState<TravelExpense | null>(null);
  const [budgetEditorOpen, setBudgetEditorOpen] = useState<boolean>(false);
  const [settleModalOpen, setSettleModalOpen] = useState<boolean>(false);
  const [settlePreset, setSettlePreset] = useState<{ fromId: string; toId: string; amount: string } | null>(null);

  const travellerMap = useMemo(
    () => new Map(workspace.travellers.map((t) => [t.id, t.fullName])),
    [workspace.travellers],
  );

  const filteredExpenses = useMemo(() => {
    return workspace.expenses.filter((exp) => {
      if (typeFilter !== "all" && exp.expenseType !== typeFilter) return false;
      if (catFilter !== "all" && exp.categoryName.toLowerCase() !== catFilter.toLowerCase()) return false;
      if (travellerFilter !== "all") {
        const inSplit = exp.splits.some((s) => s.travellerId === travellerFilter);
        if (exp.paidByTravellerId !== travellerFilter && !inSplit) return false;
      }
      if (dateFrom && exp.expenseDate < dateFrom) return false;
      if (dateTo && exp.expenseDate > dateTo) return false;
      return true;
    });
  }, [workspace.expenses, typeFilter, catFilter, travellerFilter, dateFrom, dateTo]);

  const handleOpenReceipt = async (exp: TravelExpense) => {
    try {
      const url = await openTripFile(user, workspace.trip.id, "expense_receipt", exp.id, exp.localReceiptDataUrl);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      notify(err?.message || "Could not open receipt.", "error");
    }
  };

  const handleDeleteExp = async (exp: TravelExpense) => {
    try {
      const ws = await deleteTripExpense(user, workspace.trip.id, exp.id);
      onWorkspaceChange(ws);
      notify("Expense removed.");
    } catch (err: any) {
      notify(err?.message || "Could not delete expense.", "error");
    }
  };

  // =========================================================================
  // BUDGET TAB
  // =========================================================================
  if (mode === "budget") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ts-header-row">
          <div>
            <strong style={{ fontSize: "var(--ds-type-headline-size)", lineHeight: "var(--ds-type-headline-line-height)" }}>
              {overview.budgetScope === "group"
                ? "Combined Group Budget"
                : overview.budgetScope === "personal"
                  ? "Personal Budget"
                  : "Unconfigured Budget"}
            </strong>
            <span style={{ marginLeft: 8, fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-secondary)" }}>
              Primary currency: {primaryCur}
            </span>
          </div>
          {canEditBudget && (
            <button type="button" className="ts-btn ts-btn-primary" onClick={() => setBudgetEditorOpen(true)}>
              <Settings2 size={14} /> Configure Budget
            </button>
          )}
        </div>

        {overview.budgetAlert !== "ok" && (
          <div className={`ts-alert ${overview.budgetAlert === "exceeded" ? "is-error" : ""}`}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} />
              {overview.budgetAlert === "exceeded"
                ? `Budget exceeded: ${formatTravelMoney(overview.budgetUsed, primaryCur)} used against ${formatTravelMoney(overview.totalPlannedBudget, primaryCur)} planned.`
                : `Approaching budget limit: ${overview.usagePercent}% of planned budget used.`}
            </span>
          </div>
        )}

        <div className="ts-stat-grid">
          <div className="ts-stat-card">
            <span>Planned Budget</span>
            <strong>{formatTravelMoney(overview.totalPlannedBudget, primaryCur)}</strong>
            <small>
              Allocated {formatTravelMoney(overview.totalAllocated, primaryCur)} · Unallocated{" "}
              {formatTravelMoney(overview.unallocated, primaryCur)}
            </small>
          </div>

          {overview.budgetScope === "group" && (
            <>
              <div className="ts-stat-card">
                <span>Collected Fund</span>
                <strong>{formatTravelMoney(overview.totalCollected, primaryCur)}</strong>
                <small>Actual contributed money</small>
              </div>
              <div className="ts-stat-card">
                <span>Pending Contributions</span>
                <strong>{formatTravelMoney(overview.totalPendingContributions, primaryCur)}</strong>
                <small>Planned minus collected</small>
              </div>
            </>
          )}

          <div className="ts-stat-card">
            <span>Budget Used</span>
            <strong>{formatTravelMoney(overview.budgetUsed, primaryCur)}</strong>
            <small>{overview.usagePercent}% of planned</small>
          </div>

          <div className="ts-stat-card">
            <span>Remaining Budget</span>
            <strong style={{ color: overview.remainingBudget < 0 ? "#b91c1c" : undefined }}>
              {formatTravelMoney(overview.remainingBudget, primaryCur)}
            </strong>
            <small>
              Personal {formatTravelMoney(overview.personalExpenses, primaryCur)} · Shared{" "}
              {formatTravelMoney(overview.sharedExpenses, primaryCur)}
            </small>
          </div>
        </div>

        {/* Category Progress Breakdown */}
        <div className="ts-panel">
          <div className="ts-panel-head">
            <h3>Category Allocations &amp; Spending</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {overview.categories.map((cat) => (
              <div key={cat.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)" }}>
                  <span>
                    <b>{cat.name}</b>
                    {cat.alertStatus === "exceeded" && (
                      <small style={{ color: "#b91c1c", marginLeft: 6 }}>(Over category limit)</small>
                    )}
                    {cat.alertStatus === "warning" && (
                      <small style={{ color: "#b45309", marginLeft: 6 }}>(Near limit)</small>
                    )}
                  </span>
                  <span className="ts-num">
                    {formatTravelMoney(cat.spent, primaryCur)} / {formatTravelMoney(cat.allocated, primaryCur)}{" "}
                    <small style={{ color: "var(--ds-text-muted)" }}>
                      ({cat.allocated > 0 ? `${cat.usagePercent}%` : "Unallocated"})
                    </small>
                  </span>
                </div>
                <div className="ts-progress-track">
                  <div
                    className={`ts-progress-fill ${
                      cat.alertStatus === "exceeded" ? "is-danger" : cat.alertStatus === "warning" ? "is-warn" : ""
                    }`}
                    style={{ width: `${Math.min(100, cat.allocated > 0 ? cat.usagePercent : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Group Contributions Table */}
        {overview.budgetScope === "group" && (
          <div className="ts-panel">
            <div className="ts-panel-head">
              <h3>Traveller Contributions</h3>
              <span style={{ fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)", color: "var(--ds-text-muted)" }}>
                Tracked separately from shared expense splits
              </span>
            </div>
            <div className="ts-table-wrap">
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>Traveller</th>
                    <th>Planned</th>
                    <th>Contributed</th>
                    <th>Pending</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.travellers.map((tr) => {
                    const c = overview.contributions.find((x) => x.travellerId === tr.id);
                    return (
                      <tr key={tr.id}>
                        <td>
                          <b>{tr.fullName}</b>
                        </td>
                        <td className="ts-num">{formatTravelMoney(c?.plannedAmount || 0, primaryCur)}</td>
                        <td className="ts-num">{formatTravelMoney(c?.contributedAmount || 0, primaryCur)}</td>
                        <td className="ts-num">{formatTravelMoney(c?.pendingAmount || 0, primaryCur)}</td>
                        <td>
                          <span className={`ts-status-pill ts-status-${c?.status === "paid" ? "completed" : "planning"}`}>
                            {c?.status || "pending"}
                          </span>
                        </td>
                        <td style={{ color: "var(--ds-text-secondary)" }}>{c?.note || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {budgetEditorOpen && (
          <BudgetConfigModal
            user={user}
            workspace={workspace}
            onClose={() => setBudgetEditorOpen(false)}
            onSaved={(ws) => {
              onWorkspaceChange(ws);
              setBudgetEditorOpen(false);
            }}
            notify={notify}
          />
        )}
      </div>
    );
  }

  // =========================================================================
  // EXPENSES & SETTLEMENTS TAB
  // =========================================================================
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ts-filter-bar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="ts-segmented">
            <button type="button" className={typeFilter === "all" ? "is-active" : ""} onClick={() => setTypeFilter("all")}>
              All ({workspace.expenses.length})
            </button>
            <button
              type="button"
              className={typeFilter === "personal" ? "is-active" : ""}
              onClick={() => setTypeFilter("personal")}
            >
              Personal
            </button>
            {workspace.trip.companionType !== "solo" && (
              <button
                type="button"
                className={typeFilter === "shared" ? "is-active" : ""}
                onClick={() => setTypeFilter("shared")}
              >
                Shared
              </button>
            )}
          </div>

          <select
            aria-label="Filter by category"
            className="ts-select"
            style={{ width: "auto", height: 32, fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)" }}
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {workspace.categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {workspace.travellers.length > 1 && (
            <select
              aria-label="Filter by traveller"
              className="ts-select"
              style={{ width: "auto", height: 32, fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)" }}
              value={travellerFilter}
              onChange={(e) => setTravellerFilter(e.target.value)}
            >
              <option value="all">All travellers</option>
              {workspace.travellers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          )}

          <div style={{ width: 152 }}>
            <PersoraDatePicker
              aria-label="From date"
              value={dateFrom}
              onChange={setDateFrom}
              clearable
              placeholder="From date"
            />
          </div>
          <div style={{ width: 152 }}>
            <PersoraDatePicker
              aria-label="To date"
              value={dateTo}
              onChange={setDateTo}
              minDate={dateFrom || undefined}
              clearable
              placeholder="To date"
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {workspace.trip.companionType !== "solo" && canSettle && (
            <button
              type="button"
              className="ts-btn"
              onClick={() => {
                setSettlePreset(null);
                setSettleModalOpen(true);
              }}
            >
              Settle Up
            </button>
          )}
          {canAddExpense && (
            <button
              type="button"
              className="ts-btn ts-btn-primary"
              onClick={() => {
                setEditingExpense(null);
                setExpenseModalOpen(true);
                onModalHandled?.();
              }}
            >
              <Plus size={14} /> Add Expense
            </button>
          )}
        </div>
      </div>

      {/* Expense List */}
      <div className="ts-panel">
        <div className="ts-panel-head">
          <h3>Recorded Expenses ({filteredExpenses.length})</h3>
          <span className="ts-num" style={{ fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-secondary)" }}>
            Total Trip Spend: <b>{formatTravelMoney(overview.totalExpenses, primaryCur)}</b>
          </span>
        </div>

        {filteredExpenses.length === 0 ? (
          <div style={{ fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-muted)", padding: "14px 0" }}>
            No expenses recorded matching the current filters.
          </div>
        ) : (
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Paid By</th>
                  <th>Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((exp) => {
                  const canModify =
                    workspace.role === "owner" ||
                    workspace.role === "editor" ||
                    (workspace.role === "expense_contributor" && exp.createdBy === user.id);
                  return (
                    <tr key={exp.id}>
                      <td className="ts-num" style={{ whiteSpace: "nowrap" }}>
                        {exp.expenseDate}
                      </td>
                      <td>
                        <div>
                          <b>{exp.title}</b>
                        </div>
                        {exp.expenseType === "shared" && exp.splits.length > 0 && (
                          <small style={{ color: "var(--ds-text-muted)" }}>
                            Split ({exp.splitMethod}):{" "}
                            {exp.splits
                              .map(
                                (s) =>
                                  `${travellerMap.get(s.travellerId) || "Traveller"} ${formatTravelMoney(s.shareAmount, exp.currency)}`,
                              )
                              .join(", ")}
                          </small>
                        )}
                      </td>
                      <td>{exp.categoryName}</td>
                      <td>
                        <span className="ts-status-pill">{exp.expenseType}</span>
                      </td>
                      <td>{travellerMap.get(exp.paidByTravellerId) || "Traveller"}</td>
                      <td className="ts-num">
                        <div>
                          <b>{formatTravelMoney(exp.tripAmount, primaryCur)}</b>
                        </div>
                        {exp.currency !== primaryCur && (
                          <small style={{ color: "var(--ds-text-muted)" }}>
                            Orig: {formatTravelMoney(exp.amount, exp.currency)} @ {exp.exchangeRate}
                          </small>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {exp.hasReceipt && (
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() => void handleOpenReceipt(exp)}
                              title="View receipt"
                            >
                              <Eye size={11} />
                            </button>
                          )}
                          {canModify && (
                            <>
                              <button
                                type="button"
                                className="ts-btn ts-btn-sm"
                                onClick={() => {
                                  setEditingExpense(exp);
                                  setExpenseModalOpen(true);
                                }}
                                aria-label={`Edit ${exp.title}`}
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                type="button"
                                className="ts-btn ts-btn-sm ts-btn-danger"
                                onClick={() => void handleDeleteExp(exp)}
                                aria-label={`Delete ${exp.title}`}
                              >
                                <Trash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balances & Settlements (Group / Multi-traveller only) */}
      {workspace.trip.companionType !== "solo" && (
        <div className="ts-two-col">
          <div className="ts-panel">
            <div className="ts-panel-head">
              <h3>Shared Expense Balances</h3>
            </div>
            <div className="ts-table-wrap">
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>Traveller</th>
                    <th>Paid (Shared)</th>
                    <th>Fair Share</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.balances.map((b) => (
                    <tr key={b.travellerId}>
                      <td>
                        <b>{b.fullName}</b>
                      </td>
                      <td className="ts-num">{formatTravelMoney(b.totalPaid, primaryCur)}</td>
                      <td className="ts-num">{formatTravelMoney(b.totalShare, primaryCur)}</td>
                      <td className="ts-num">
                        {b.settled ? (
                          <span className="ts-status-pill ts-status-completed">Settled</span>
                        ) : b.shouldReceive > 0 ? (
                          <span style={{ color: "#15803d", fontWeight: "var(--ds-font-weight-semibold)" }}>
                            Receives {formatTravelMoney(b.shouldReceive, primaryCur)}
                          </span>
                        ) : (
                          <span style={{ color: "#b91c1c", fontWeight: "var(--ds-font-weight-semibold)" }}>
                            Owes {formatTravelMoney(b.owes, primaryCur)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ts-panel">
            <div className="ts-panel-head">
              <h3>Settlements</h3>
            </div>
            {overview.suggestedSettlements.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                <small style={{ color: "var(--ds-text-muted)", fontWeight: "var(--ds-font-weight-semibold)" }}>SUGGESTED TRANSFERS</small>
                {overview.suggestedSettlements.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--ds-border)",
                      fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)",
                    }}
                  >
                    <span>
                      <b>{s.fromName}</b> <ArrowRight size={12} style={{ verticalAlign: "middle" }} /> <b>{s.toName}</b>:{" "}
                      <span className="ts-num" style={{ fontWeight: "var(--ds-font-weight-semibold)" }}>
                        {formatTravelMoney(s.amount, primaryCur)}
                      </span>
                    </span>
                    {canSettle && (
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm ts-btn-primary"
                        onClick={() => {
                          setSettlePreset({
                            fromId: s.fromTravellerId,
                            toId: s.toTravellerId,
                            amount: String(s.amount),
                          });
                          setSettleModalOpen(true);
                        }}
                      >
                        <CheckCircle2 size={11} /> Mark Paid
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-muted)", marginBottom: 10 }}>
                All shared expenses are settled.
              </div>
            )}

            {workspace.settlements.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <small style={{ color: "var(--ds-text-muted)", fontWeight: "var(--ds-font-weight-semibold)" }}>RECORDED SETTLEMENTS</small>
                {workspace.settlements.map((st) => (
                  <div
                    key={st.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--ds-border)",
                    }}
                  >
                    <span>
                      {st.settledOn} · <b>{travellerMap.get(st.fromTravellerId)}</b> paid{" "}
                      <b>{travellerMap.get(st.toTravellerId)}</b>{" "}
                      <span className="ts-num">{formatTravelMoney(st.amount, st.currency)}</span>
                    </span>
                    {canSettle && (
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={async () => {
                          try {
                            const ws = await deleteTripSettlement(user, workspace.trip.id, st.id);
                            onWorkspaceChange(ws);
                          } catch (err: any) {
                            notify(err?.message || "Could not remove settlement.", "error");
                          }
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {expenseModalOpen && (
        <ExpenseEditorModal
          user={user}
          workspace={workspace}
          editingExpense={editingExpense}
          onSaveVaultItem={onSaveVaultItem}
          onClose={() => setExpenseModalOpen(false)}
          onSaved={(ws) => {
            onWorkspaceChange(ws);
            setExpenseModalOpen(false);
          }}
          notify={notify}
        />
      )}

      {settleModalOpen && (
        <SettlementModal
          user={user}
          workspace={workspace}
          preset={settlePreset}
          onClose={() => setSettleModalOpen(false)}
          onSaved={(ws) => {
            onWorkspaceChange(ws);
            setSettleModalOpen(false);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function ExpenseEditorModal({
  user,
  workspace,
  editingExpense,
  onSaveVaultItem,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  editingExpense: TravelExpense | null;
  onSaveVaultItem?: (draft: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) => Promise<VaultItem | void>;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const isSolo = workspace.trip.companionType === "solo";
  const primaryCur = workspace.trip.primaryCurrency;
  const todayIso = new Date().toISOString().slice(0, 10);

  const [title, setTitle] = useState(editingExpense?.title || "");
  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount) : "");
  const [currency, setCurrency] = useState(editingExpense?.currency || primaryCur);
  const [exchangeRate, setExchangeRate] = useState(
    editingExpense && editingExpense.currency !== primaryCur ? String(editingExpense.exchangeRate) : "",
  );
  const [convertedAmount, setConvertedAmount] = useState(
    editingExpense && editingExpense.currency !== primaryCur ? String(editingExpense.tripAmount) : "",
  );
  const [convertedOn, setConvertedOn] = useState(editingExpense?.convertedOn || todayIso);
  const [expenseDate, setExpenseDate] = useState(editingExpense?.expenseDate || workspace.trip.startDate || todayIso);
  const [categoryName, setCategoryName] = useState(
    editingExpense?.categoryName || workspace.categories[0]?.name || "Transportation",
  );
  const [expenseType, setExpenseType] = useState<"personal" | "shared">(
    isSolo ? "personal" : editingExpense?.expenseType || "personal",
  );
  const [paidById, setPaidById] = useState(
    editingExpense?.paidByTravellerId || workspace.travellers[0]?.id || "",
  );
  const [paidFromGroupFund, setPaidFromGroupFund] = useState(Boolean(editingExpense?.paidFromGroupFund));
  const [splitMethod, setSplitMethod] = useState<"equal" | "custom">(
    editingExpense?.splitMethod === "custom" ? "custom" : "equal",
  );
  const [participantIds, setParticipantIds] = useState<string[]>(
    editingExpense?.splits?.length
      ? editingExpense.splits.map((s) => s.travellerId)
      : workspace.travellers.map((t) => t.id),
  );
  const [customShares, setCustomShares] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (editingExpense?.splits) {
      editingExpense.splits.forEach((s) => {
        init[s.travellerId] = String(s.shareAmount);
      });
    }
    return init;
  });
  const [paymentMethod, setPaymentMethod] = useState(editingExpense?.paymentMethod || "");
  const [notes, setNotes] = useState(editingExpense?.notes || "");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [recordInPersonalFinance, setRecordInPersonalFinance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleParticipant = (tid: string) => {
    setParticipantIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let linkedFinanceItemId = editingExpense?.linkedFinanceItemId || null;
      if (recordInPersonalFinance && onSaveVaultItem && !linkedFinanceItemId) {
        const saved = await onSaveVaultItem({
          section: "personal-finance",
          title: `${workspace.trip.title}: ${title.trim()}`,
          subtitle: `${categoryName} · ${currency} ${amount}`,
          metadata: {
            recordType: "expense",
            category: categoryName,
            amount: String(amount),
            currency,
            date: expenseDate,
            notes: `Linked from TravelSpace trip "${workspace.trip.title}"`,
          },
        });
        if (saved && typeof saved === "object" && "id" in saved) {
          linkedFinanceItemId = saved.id;
        }
      }

      const catObj = workspace.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
      const body: Record<string, any> = {
        title: title.trim(),
        amount,
        currency,
        exchangeRate: currency !== primaryCur ? exchangeRate : 1,
        convertedAmount: currency !== primaryCur && convertedAmount ? convertedAmount : undefined,
        convertedOn,
        expenseDate,
        categoryId: catObj?.id || null,
        categoryName,
        expenseType: isSolo ? "personal" : expenseType,
        paidByTravellerId: paidById,
        paidFromGroupFund,
        splitMethod: expenseType === "shared" ? splitMethod : "none",
        participantIds,
        customSplits: Object.entries(customShares).map(([travellerId, shareAmt]) => ({
          travellerId,
          amount: shareAmt,
        })),
        paymentMethod,
        linkedFinanceItemId,
        notes,
      };

      let ws = await saveTripExpense(user, workspace.trip.id, body, editingExpense?.id);
      if (receiptFile) {
        const target = editingExpense?.id || ws.expenses[0]?.id;
        if (target) {
          ws = await uploadTripAttachment(user, workspace.trip.id, "expense_receipt", receiptFile, target);
        }
      }
      notify(editingExpense ? "Expense updated." : "Expense recorded.");
      onSaved(ws);
    } catch (err: any) {
      setError(err?.message || "Could not save expense.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label={editingExpense ? "Edit expense" : "Add expense"}>
        <form className="ts-modal-card" onSubmit={handleSubmit}>
          <div className="ts-modal-head">
            <h3>{editingExpense ? "Edit Expense" : "Add Expense"}</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            {error && <div className="ts-alert is-error">{error}</div>}
            <div className="ts-field-grid">
              <div className="ts-field is-full">
                <label htmlFor="ts-exp-title">What was it? *</label>
                <input
                  id="ts-exp-title"
                  className="ts-input"
                  placeholder="e.g. Seafood dinner, Airport taxi, Hotel deposit…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-exp-amount">Amount *</label>
                <input
                  id="ts-exp-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="ts-input ts-num"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-exp-currency">Currency *</label>
                <select
                  id="ts-exp-currency"
                  className="ts-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {TRAVEL_CURRENCIES.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </select>
              </div>

              {currency !== primaryCur && (
                <>
                  <div className="ts-field">
                    <label htmlFor="ts-exp-rate">Exchange Rate (1 {currency} = ? {primaryCur})</label>
                    <input
                      id="ts-exp-rate"
                      type="number"
                      min="0.000001"
                      step="any"
                      className="ts-input ts-num"
                      placeholder="e.g. 120.5"
                      value={exchangeRate}
                      onChange={(e) => {
                        setExchangeRate(e.target.value);
                        setConvertedAmount("");
                      }}
                    />
                  </div>
                  <div className="ts-field">
                    <label htmlFor="ts-exp-conv">Or Converted {primaryCur} Amount</label>
                    <input
                      id="ts-exp-conv"
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="ts-input ts-num"
                      placeholder={`Total in ${primaryCur}`}
                      value={convertedAmount}
                      onChange={(e) => setConvertedAmount(e.target.value)}
                    />
                  </div>
                  <div className="ts-field is-full">
                    <label htmlFor="ts-exp-conv-date">Conversion Date</label>
                    <PersoraDatePicker
                      id="ts-exp-conv-date"
                      value={convertedOn}
                      onChange={setConvertedOn}
                      clearable
                      placeholder="Select conversion date"
                    />
                  </div>
                </>
              )}

              <div className="ts-field">
                <label htmlFor="ts-exp-date">Date *</label>
                <PersoraDatePicker
                  id="ts-exp-date"
                  value={expenseDate}
                  onChange={setExpenseDate}
                  placeholder="Select expense date"
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-exp-cat">Category *</label>
                <select
                  id="ts-exp-cat"
                  className="ts-select"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                >
                  {workspace.categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  {!workspace.categories.some((c) => c.name === "Others") && <option value="Others">Others</option>}
                </select>
              </div>

              {!isSolo && (
                <div className="ts-field">
                  <label>Expense Type *</label>
                  <div className="ts-segmented">
                    <button
                      type="button"
                      className={expenseType === "personal" ? "is-active" : ""}
                      onClick={() => setExpenseType("personal")}
                    >
                      Personal
                    </button>
                    <button
                      type="button"
                      className={expenseType === "shared" ? "is-active" : ""}
                      onClick={() => setExpenseType("shared")}
                    >
                      Shared
                    </button>
                  </div>
                </div>
              )}

              <div className="ts-field">
                <label htmlFor="ts-exp-paidby">Paid By *</label>
                <select
                  id="ts-exp-paidby"
                  className="ts-select"
                  value={paidById}
                  onChange={(e) => setPaidById(e.target.value)}
                >
                  {workspace.travellers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
              </div>

              {!isSolo && expenseType === "personal" && workspace.trip.budgetScope === "group" && (
                <div className="ts-field is-full">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ds-text)", cursor: "pointer" }}>
                    <Checkbox
                      checked={paidFromGroupFund}
                      onCheckedChange={(v) => setPaidFromGroupFund(v === true)}
                    />
                    <span>Paid from shared group fund</span>
                  </label>
                </div>
              )}

              {!isSolo && expenseType === "shared" && (
                <div className="ts-field is-full">
                  <div className="ts-header-row" style={{ marginBottom: 6 }}>
                    <label>Split Between &amp; Method *</label>
                    <div className="ts-segmented">
                      <button
                        type="button"
                        className={splitMethod === "equal" ? "is-active" : ""}
                        onClick={() => setSplitMethod("equal")}
                      >
                        Equal Split
                      </button>
                      <button
                        type="button"
                        className={splitMethod === "custom" ? "is-active" : ""}
                        onClick={() => setSplitMethod("custom")}
                      >
                        Custom Split
                      </button>
                    </div>
                  </div>

                  {splitMethod === "equal" ? (
                    <div className="ts-chip-list">
                      {workspace.travellers.map((tr) => (
                        <label
                          key={tr.id}
                          className="ts-dest-chip"
                          style={{ cursor: "pointer" }}
                        >
                          <Checkbox
                            checked={participantIds.includes(tr.id)}
                            onCheckedChange={() => toggleParticipant(tr.id)}
                          />
                          <span>{tr.fullName}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="ts-field-grid">
                      {workspace.travellers.map((tr) => (
                        <div key={tr.id} className="ts-field">
                          <label>{tr.fullName} ({currency})</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="ts-input ts-num"
                            placeholder="0.00"
                            value={customShares[tr.id] || ""}
                            onChange={(e) =>
                              setCustomShares((prev) => ({ ...prev, [tr.id]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="ts-field">
                <label htmlFor="ts-exp-method">Payment Method</label>
                <input
                  id="ts-exp-method"
                  className="ts-input"
                  placeholder="Cash, Card, bKash…"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-exp-receipt">Receipt Image / PDF</label>
                <input
                  id="ts-exp-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  className="ts-input"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="ts-field is-full">
                <label htmlFor="ts-exp-notes">Notes</label>
                <input
                  id="ts-exp-notes"
                  className="ts-input"
                  placeholder="Optional details"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {onSaveVaultItem && !editingExpense && expenseType === "personal" && (
                <div className="ts-field is-full">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ds-text)", cursor: "pointer" }}>
                    <Checkbox
                      checked={recordInPersonalFinance}
                      onCheckedChange={(v) => setRecordInPersonalFinance(v === true)}
                    />
                    <span>Also link &amp; record in Persora Personal Finance</span>
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              <Receipt size={14} /> {saving ? "Saving…" : editingExpense ? "Update Expense" : "Save Expense"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function BudgetConfigModal({
  user,
  workspace,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const isSolo = workspace.trip.companionType === "solo";
  const cur = workspace.trip.primaryCurrency;
  const [scope, setScope] = useState<BudgetScope>(
    isSolo && workspace.trip.budgetScope === "group" ? "personal" : workspace.trip.budgetScope,
  );
  const [personalBudget, setPersonalBudget] = useState(String(workspace.trip.personalBudget || ""));
  const [equalTotal, setEqualTotal] = useState("");
  const [contribs, setContribs] = useState(() =>
    workspace.travellers.map((tr) => {
      const c = workspace.contributions.find((x) => x.travellerId === tr.id);
      return {
        travellerId: tr.id,
        fullName: tr.fullName,
        plannedAmount: c ? String(c.plannedAmount) : "0",
        contributedAmount: c ? String(c.contributedAmount) : "0",
        note: c?.note || "",
      };
    }),
  );
  const [cats, setCats] = useState(() =>
    workspace.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      isDefault: c.isDefault,
      allocatedAmount: String(c.allocatedAmount || 0),
    })),
  );
  const [newCat, setNewCat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const splitEqual = () => {
    try {
      const totalMinor = toMinor(equalTotal || 0, cur);
      const shares = splitEqualMinor(totalMinor, contribs.length);
      setContribs((prev) =>
        prev.map((c, idx) => ({ ...c, plannedAmount: String(fromMinor(shares[idx] || 0, cur)) })),
      );
    } catch {
      // ignore
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const ws = await saveTripBudget(user, workspace.trip.id, {
        budgetScope: scope,
        personalBudget: scope === "personal" ? Number(personalBudget || 0) : 0,
        categories: cats.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          isDefault: c.isDefault,
          allocatedAmount: Number(c.allocatedAmount || 0),
        })),
        contributions:
          scope === "group"
            ? contribs.map((c) => ({
                travellerId: c.travellerId,
                plannedAmount: Number(c.plannedAmount || 0),
                contributedAmount: Number(c.contributedAmount || 0),
                note: c.note,
              }))
            : [],
      });
      notify("Budget configuration updated.");
      onSaved(ws);
    } catch (err: any) {
      setError(err?.message || "Could not update budget.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Configure budget">
        <form className="ts-modal-card is-wide" onSubmit={handleSave}>
          <div className="ts-modal-head">
            <h3>Configure Trip Budget ({cur})</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            {error && <div className="ts-alert is-error">{error}</div>}
            <div className="ts-segmented">
              <button type="button" className={scope === "personal" ? "is-active" : ""} onClick={() => setScope("personal")}>
                Personal Budget
              </button>
              {!isSolo && (
                <button type="button" className={scope === "group" ? "is-active" : ""} onClick={() => setScope("group")}>
                  Combined Group Budget
                </button>
              )}
              <button type="button" className={scope === "none" ? "is-active" : ""} onClick={() => setScope("none")}>
                No Budget Target
              </button>
            </div>

            {scope === "personal" && (
              <div className="ts-field">
                <label>Planned Personal Budget ({cur})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="ts-input ts-num"
                  value={personalBudget}
                  onChange={(e) => setPersonalBudget(e.target.value)}
                />
              </div>
            )}

            {scope === "group" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div className="ts-field" style={{ flex: 1 }}>
                    <label>Split Group Target Equally ({cur})</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="ts-input ts-num"
                      value={equalTotal}
                      onChange={(e) => setEqualTotal(e.target.value)}
                    />
                  </div>
                  <button type="button" className="ts-btn" onClick={splitEqual}>
                    Split Equally
                  </button>
                </div>

                <div className="ts-table-wrap">
                  <table className="ts-table">
                    <thead>
                      <tr>
                        <th>Traveller</th>
                        <th>Planned ({cur})</th>
                        <th>Contributed ({cur})</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contribs.map((c, idx) => (
                        <tr key={c.travellerId}>
                          <td>{c.fullName}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ts-input ts-num"
                              value={c.plannedAmount}
                              onChange={(e) =>
                                setContribs((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, plannedAmount: e.target.value } : x)),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ts-input ts-num"
                              value={c.contributedAmount}
                              onChange={(e) =>
                                setContribs((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, contributedAmount: e.target.value } : x)),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="ts-input"
                              value={c.note}
                              onChange={(e) =>
                                setContribs((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)),
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {scope !== "none" && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Category Allocations ({cur})</h4>
                <div className="ts-field-grid">
                  {cats.map((c, idx) => (
                    <div key={c.name} className="ts-field">
                      <label style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{c.name}</span>
                        {!c.isDefault && (
                          <button
                            type="button"
                            style={{ border: 0, background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)" }}
                            onClick={() => setCats((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        )}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="ts-input ts-num"
                        value={c.allocatedAmount}
                        onChange={(e) =>
                          setCats((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, allocatedAmount: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="ts-input"
                    placeholder="New custom category…"
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ts-btn"
                    onClick={() => {
                      const nm = newCat.trim();
                      if (!nm || cats.some((c) => c.name.toLowerCase() === nm.toLowerCase())) return;
                      setCats((prev) => [...prev, { id: "", name: nm, color: "indigo", isDefault: false, allocatedAmount: "0" }]);
                      setNewCat("");
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Budget"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function SettlementModal({
  user,
  workspace,
  preset,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  preset: { fromId: string; toId: string; amount: string } | null;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [fromId, setFromId] = useState(preset?.fromId || workspace.travellers[0]?.id || "");
  const [toId, setToId] = useState(preset?.toId || workspace.travellers[1]?.id || "");
  const [amount, setAmount] = useState(preset?.amount || "");
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ws = await createTripSettlement(user, workspace.trip.id, {
        fromTravellerId: fromId,
        toTravellerId: toId,
        amount,
        settledOn,
        method,
        note,
        status: "completed",
      });
      notify("Settlement recorded.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not record settlement.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Record settlement">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>Record Settlement ({workspace.trip.primaryCurrency})</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-field-grid">
              <div className="ts-field">
                <label>Who Paid</label>
                <select className="ts-select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  {workspace.travellers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Paid To</label>
                <select className="ts-select" value={toId} onChange={(e) => setToId(e.target.value)}>
                  {workspace.travellers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Amount ({workspace.trip.primaryCurrency}) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="ts-input ts-num"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="ts-field">
                <label>Settlement Date</label>
                <PersoraDatePicker
                  value={settledOn}
                  onChange={setSettledOn}
                  placeholder="Select settlement date"
                />
              </div>
              <div className="ts-field">
                <label>Method</label>
                <input
                  className="ts-input"
                  placeholder="Cash, Bank, bKash…"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                />
              </div>
              <div className="ts-field">
                <label>Note</label>
                <input className="ts-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Settlement"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
