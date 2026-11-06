import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Eye,
  FileText,
  Link2,
  Pencil,
  Plus,
  Shield,
  Ticket,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import ModalPortal from "../ModalPortal";
import { Checkbox, PersoraDatePicker } from "@/design-system";
import {
  BOOKING_CATEGORIES,
  BOOKING_STATUSES,
  DOCUMENT_CATEGORIES,
  PAYMENT_STATUSES,
  TRAVEL_CURRENCIES,
  canRolePerform,
  formatTravelMoney,
  type BookingCategory,
  type BookingStatus,
  type DocumentCategory,
  type PaymentStatus,
  type TravellerRole,
} from "../../../cloudflare/travel-space-rules.js";
import {
  createTripDocument,
  createTripItem,
  deleteTripBooking,
  deleteTripDocument,
  deleteTripTraveller,
  openTripFile,
  saveTripBooking,
  saveTripTraveller,
  uploadTripAttachment,
  type TravelBooking,
  type TravelTraveller,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import type { AppUser, PersoraContact, VaultItem } from "../../types";

interface Props {
  mode: "bookings" | "travellers" | "documents";
  user: AppUser;
  workspace: TravelWorkspace;
  vaultItems: VaultItem[];
  contacts: PersoraContact[];
  onOpenVaultItem?: (item: VaultItem) => void;
  onWorkspaceChange: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
  initialOpenModal?: boolean;
  onModalHandled?: () => void;
}

const BOOKING_CAT_LABELS: Record<BookingCategory, string> = {
  flight: "Flight",
  bus: "Bus",
  train: "Train",
  hotel: "Hotel",
  car_rental: "Car Rental",
  activity: "Activities / Attractions",
  other: "Other",
};

const DOC_CAT_LABELS: Record<DocumentCategory, string> = {
  passport: "Passport",
  visa: "Visa",
  national_id: "National ID",
  driving_licence: "Driving Licence",
  insurance: "Travel Insurance",
  ticket: "Ticket",
  hotel_confirmation: "Hotel Confirmation",
  permit: "Permit",
  other: "Other",
};

export default function TripOrganizationTabs({
  mode,
  user,
  workspace,
  vaultItems,
  contacts,
  onOpenVaultItem,
  onWorkspaceChange,
  notify,
  initialOpenModal,
  onModalHandled,
}: Props) {
  const canEdit = canRolePerform(workspace.role, "edit_bookings");
  const isOwner = workspace.role === "owner";

  // Bookings state
  const [bookingFilter, setBookingFilter] = useState<string>("all");
  const [bookingModalOpen, setBookingModalOpen] = useState<boolean>(Boolean(initialOpenModal && mode === "bookings"));
  const [editingBooking, setEditingBooking] = useState<TravelBooking | null>(null);

  // Travellers state
  const [travellerModalOpen, setTravellerModalOpen] = useState<boolean>(Boolean(initialOpenModal && mode === "travellers"));
  const [editingTraveller, setEditingTraveller] = useState<TravelTraveller | null>(null);

  // Documents state
  const [docModalOpen, setDocModalOpen] = useState<boolean>(Boolean(initialOpenModal && mode === "documents"));

  const membershipItems = useMemo(
    () => vaultItems.filter((i) => i.section === "memberships"),
    [vaultItems],
  );
  const documentVaultItems = useMemo(
    () => vaultItems.filter((i) => i.section === "documents"),
    [vaultItems],
  );
  const familyItems = useMemo(
    () => vaultItems.filter((i) => i.section === "family"),
    [vaultItems],
  );
  const travellerMap = useMemo(
    () => new Map(workspace.travellers.map((t) => [t.id, t.fullName])),
    [workspace.travellers],
  );

  // =========================================================================
  // BOOKINGS TAB
  // =========================================================================
  if (mode === "bookings") {
    const visible = workspace.bookings.filter(
      (b) => bookingFilter === "all" || b.category === bookingFilter,
    );

    const addBookingToItinerary = async (b: TravelBooking) => {
      try {
        const ws = await createTripItem(user, workspace.trip.id, {
          title: `${BOOKING_CAT_LABELS[b.category]}: ${b.title}`,
          scheduledDate: b.startDate || workspace.trip.startDate,
          location: b.location,
          bookingId: b.id,
          estimatedCost: b.price,
          notes: b.bookingReference ? `Ref: ${b.bookingReference}` : "",
        });
        onWorkspaceChange(ws);
        notify("Linked booking activity onto Itinerary.");
      } catch (err: any) {
        notify(err?.message || "Could not add to itinerary.", "error");
      }
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ts-filter-bar">
          <div className="ts-segmented">
            <button
              type="button"
              className={bookingFilter === "all" ? "is-active" : ""}
              onClick={() => setBookingFilter("all")}
            >
              All ({workspace.bookings.length})
            </button>
            {BOOKING_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={bookingFilter === cat ? "is-active" : ""}
                onClick={() => setBookingFilter(cat)}
              >
                {BOOKING_CAT_LABELS[cat]}
              </button>
            ))}
          </div>

          {canEdit && (
            <button
              type="button"
              className="ts-btn ts-btn-primary"
              onClick={() => {
                setEditingBooking(null);
                setBookingModalOpen(true);
                onModalHandled?.();
              }}
            >
              <Plus size={14} /> Add Booking
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="ts-panel" style={{ color: "var(--ds-text-muted)", fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)" }}>
            No bookings saved yet. Record flights, hotels, trains, buses, car rentals, or activity reservations manually.
          </div>
        ) : (
          <div className="ts-trips-grid">
            {visible.map((b) => (
              <div key={b.id} className="ts-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <small style={{ color: "var(--ds-text-muted)", fontWeight: "var(--ds-font-weight-semibold)" }}>
                      {BOOKING_CAT_LABELS[b.category].toUpperCase()}
                    </small>
                    <h4 style={{ margin: "2px 0 0", fontSize: "var(--ds-type-headline-size)", lineHeight: "var(--ds-type-headline-line-height)" }}>{b.title}</h4>
                  </div>
                  <span
                    className={`ts-status-pill ts-status-${
                      b.bookingStatus === "confirmed" || b.bookingStatus === "completed"
                        ? "completed"
                        : b.bookingStatus === "cancelled"
                          ? "cancelled"
                          : "planning"
                    }`}
                  >
                    {b.bookingStatus}
                  </span>
                </div>

                <div className="ts-meta-row">
                  {b.provider && <span>Provider: {b.provider}</span>}
                  {b.bookingReference && <span>Ref: {b.bookingReference}</span>}
                  {b.startDate && (
                    <span>
                      {b.startDate}
                      {b.endDate && b.endDate !== b.startDate ? ` → ${b.endDate}` : ""}
                    </span>
                  )}
                  {b.price !== null && (
                    <span>
                      <b>{formatTravelMoney(b.price, b.currency)}</b> ({b.paymentStatus})
                    </span>
                  )}
                </div>

                {b.location && <div style={{ fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-secondary)" }}>{b.location}</div>}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {b.hasAttachment && (
                    <button
                      type="button"
                      className="ts-btn ts-btn-sm"
                      onClick={async () => {
                        try {
                          const url = await openTripFile(user, workspace.trip.id, "booking", b.id, b.localDataUrl);
                          window.open(url, "_blank", "noopener,noreferrer");
                        } catch (err: any) {
                          notify(err?.message || "Could not open attachment.", "error");
                        }
                      }}
                    >
                      <Eye size={11} /> Confirmation
                    </button>
                  )}
                  {canEdit && (
                    <>
                      <button type="button" className="ts-btn ts-btn-sm" onClick={() => void addBookingToItinerary(b)}>
                        <CalendarPlus size={11} /> Add to Itinerary
                      </button>
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm"
                        onClick={() => {
                          setEditingBooking(b);
                          setBookingModalOpen(true);
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={async () => {
                          try {
                            const ws = await deleteTripBooking(user, workspace.trip.id, b.id);
                            onWorkspaceChange(ws);
                            notify("Booking deleted.");
                          } catch (err: any) {
                            notify(err?.message || "Could not delete booking.", "error");
                          }
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {bookingModalOpen && (
          <BookingModal
            user={user}
            workspace={workspace}
            membershipItems={membershipItems}
            editingBooking={editingBooking}
            onClose={() => setBookingModalOpen(false)}
            onSaved={(ws) => {
              onWorkspaceChange(ws);
              setBookingModalOpen(false);
            }}
            notify={notify}
          />
        )}
      </div>
    );
  }

  // =========================================================================
  // TRAVELLERS & PERMISSIONS TAB
  // =========================================================================
  if (mode === "travellers") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ts-header-row">
          <div>
            <strong style={{ fontSize: "var(--ds-type-headline-size)", lineHeight: "var(--ds-type-headline-line-height)" }}>Trip Travellers &amp; Access Roles ({workspace.travellers.length})</strong>
            <div style={{ fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)", color: "var(--ds-text-muted)" }}>
              Roles are enforced server-side: Owner · Editor · Expense Contributor · Viewer
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              className="ts-btn ts-btn-primary"
              onClick={() => {
                setEditingTraveller(null);
                setTravellerModalOpen(true);
                onModalHandled?.();
              }}
            >
              <UserPlus size={14} /> Add Traveller
            </button>
          )}
        </div>

        <div className="ts-panel">
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Responsibility</th>
                  <th>Emergency Contact</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspace.travellers.map((tr) => {
                  const bal = workspace.budgetOverview.balances.find((b) => b.travellerId === tr.id);
                  return (
                    <tr key={tr.id}>
                      <td>
                        <b>{tr.fullName}</b>
                        {tr.isOwner && (
                          <small style={{ marginLeft: 6, color: "var(--ds-accent)" }}>(Creator)</small>
                        )}
                      </td>
                      <td>
                        <div>{tr.email || "—"}</div>
                        {tr.phone && <small style={{ color: "var(--ds-text-muted)" }}>{tr.phone}</small>}
                      </td>
                      <td>
                        {isOwner && !tr.isOwner ? (
                          <select
                            aria-label={`Role for ${tr.fullName}`}
                            className="ts-select"
                            style={{ height: 28, fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", width: "auto" }}
                            value={tr.role}
                            onChange={async (e) => {
                              try {
                                const ws = await saveTripTraveller(
                                  user,
                                  workspace.trip.id,
                                  { role: e.target.value as TravellerRole },
                                  tr.id,
                                );
                                onWorkspaceChange(ws);
                                notify(`Updated ${tr.fullName}'s role.`);
                              } catch (err: any) {
                                notify(err?.message || "Could not update role.", "error");
                              }
                            }}
                          >
                            <option value="editor">Editor</option>
                            <option value="expense_contributor">Expense Contributor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className="ts-status-pill">
                            <Shield size={11} /> {tr.role.replace("_", " ")}
                          </span>
                        )}
                      </td>
                      <td>{tr.responsibility || "—"}</td>
                      <td>
                        {tr.emergencyContactName
                          ? `${tr.emergencyContactName}${tr.emergencyContactPhone ? ` (${tr.emergencyContactPhone})` : ""}`
                          : "—"}
                      </td>
                      <td className="ts-num">
                        {!bal || bal.settled
                          ? "Settled"
                          : bal.shouldReceive > 0
                            ? `+${formatTravelMoney(bal.shouldReceive, workspace.trip.primaryCurrency)}`
                            : `-${formatTravelMoney(bal.owes, workspace.trip.primaryCurrency)}`}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {canEdit && (
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() => {
                                setEditingTraveller(tr);
                                setTravellerModalOpen(true);
                              }}
                              aria-label={`Edit ${tr.fullName}`}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {isOwner && !tr.isOwner && (
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm ts-btn-danger"
                              onClick={async () => {
                                try {
                                  const ws = await deleteTripTraveller(user, workspace.trip.id, tr.id);
                                  onWorkspaceChange(ws);
                                  notify("Traveller removed.");
                                } catch (err: any) {
                                  notify(err?.message || "Could not remove traveller.", "error");
                                }
                              }}
                              aria-label={`Remove ${tr.fullName}`}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {travellerModalOpen && (
          <TravellerModal
            user={user}
            workspace={workspace}
            contacts={contacts}
            familyItems={familyItems}
            editingTraveller={editingTraveller}
            onClose={() => setTravellerModalOpen(false)}
            onSaved={(ws) => {
              onWorkspaceChange(ws);
              setTravellerModalOpen(false);
            }}
            notify={notify}
          />
        )}
      </div>
    );
  }

  // =========================================================================
  // DOCUMENTS TAB
  // =========================================================================
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ts-header-row">
        <div>
          <strong style={{ fontSize: "var(--ds-type-headline-size)", lineHeight: "var(--ds-type-headline-line-height)" }}>Travel Documents ({workspace.documents.length})</strong>
          <div style={{ fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)", color: "var(--ds-text-muted)" }}>
            Upload trip documents or link existing Persora Documents without duplicating files.
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            className="ts-btn ts-btn-primary"
            onClick={() => {
              setDocModalOpen(true);
              onModalHandled?.();
            }}
          >
            <Plus size={14} /> Add Document
          </button>
        )}
      </div>

      {workspace.documents.length === 0 ? (
        <div className="ts-panel" style={{ fontSize: "var(--ds-type-body-2-size)", lineHeight: "var(--ds-type-body-2-line-height)", color: "var(--ds-text-muted)" }}>
          No documents attached yet. Link Passports, Visas, National IDs, Insurance, or Tickets from Persora Documents or upload new files.
        </div>
      ) : (
        <div className="ts-trips-grid">
          {workspace.documents.map((doc) => {
            const linkedVault = doc.linkedVaultItemId
              ? vaultItems.find((v) => v.id === doc.linkedVaultItemId)
              : undefined;
            const effectiveExpiry = doc.expiryDate || linkedVault?.metadata?.expiryDate || null;
            const isExpired = Boolean(effectiveExpiry && effectiveExpiry < todayIso);
            return (
              <div key={doc.id} className="ts-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <small style={{ color: "var(--ds-text-muted)", fontWeight: "var(--ds-font-weight-semibold)" }}>
                      {DOC_CAT_LABELS[doc.docCategory].toUpperCase()}
                    </small>
                    <h4 style={{ margin: "2px 0 0", fontSize: "var(--ds-type-headline-size)", lineHeight: "var(--ds-type-headline-line-height)" }}>{doc.title}</h4>
                  </div>
                  <span className="ts-status-pill">
                    {doc.sourceType === "vault_item" ? (
                      <>
                        <Link2 size={11} /> Linked Vault
                      </>
                    ) : (
                      <>
                        <FileText size={11} /> Uploaded
                      </>
                    )}
                  </span>
                </div>

                <div className="ts-meta-row">
                  {doc.travellerId && travellerMap.get(doc.travellerId) && (
                    <span>Traveller: {travellerMap.get(doc.travellerId)}</span>
                  )}
                  {doc.documentNumber && <span>No: {doc.documentNumber}</span>}
                  {effectiveExpiry && (
                    <span style={{ color: isExpired ? "#b91c1c" : undefined, fontWeight: isExpired ? 600 : 400 }}>
                      {isExpired && <AlertTriangle size={11} />} Expires {effectiveExpiry}
                    </span>
                  )}
                  {doc.isPrivate && <span>Private</span>}
                </div>

                {doc.notes && <div style={{ fontSize: "var(--ds-type-caption-1-size)", lineHeight: "var(--ds-type-caption-1-line-height)", color: "var(--ds-text-secondary)" }}>{doc.notes}</div>}

                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {linkedVault && onOpenVaultItem ? (
                    <button type="button" className="ts-btn ts-btn-sm" onClick={() => onOpenVaultItem(linkedVault)}>
                      <Eye size={11} /> Open Vault Record
                    </button>
                  ) : (
                    doc.hasFile && (
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm"
                        onClick={async () => {
                          try {
                            const url = await openTripFile(user, workspace.trip.id, "document", doc.id, doc.localDataUrl);
                            window.open(url, "_blank", "noopener,noreferrer");
                          } catch (err: any) {
                            notify(err?.message || "Could not open document.", "error");
                          }
                        }}
                      >
                        <Eye size={11} /> Preview
                      </button>
                    )
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="ts-btn ts-btn-sm ts-btn-danger"
                      onClick={async () => {
                        try {
                          const ws = await deleteTripDocument(user, workspace.trip.id, doc.id);
                          onWorkspaceChange(ws);
                          notify("Document removed from trip.");
                        } catch (err: any) {
                          notify(err?.message || "Could not remove document.", "error");
                        }
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {docModalOpen && (
        <DocumentModal
          user={user}
          workspace={workspace}
          documentVaultItems={documentVaultItems}
          onClose={() => setDocModalOpen(false)}
          onSaved={(ws) => {
            onWorkspaceChange(ws);
            setDocModalOpen(false);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function BookingModal({
  user,
  workspace,
  membershipItems,
  editingBooking,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  membershipItems: VaultItem[];
  editingBooking: TravelBooking | null;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [category, setCategory] = useState<BookingCategory>(editingBooking?.category || "flight");
  const [title, setTitle] = useState(editingBooking?.title || "");
  const [provider, setProvider] = useState(editingBooking?.provider || "");
  const [bookingReference, setBookingReference] = useState(editingBooking?.bookingReference || "");
  const [startDate, setStartDate] = useState(editingBooking?.startDate || workspace.trip.startDate);
  const [endDate, setEndDate] = useState(editingBooking?.endDate || workspace.trip.startDate);
  const [location, setLocation] = useState(editingBooking?.location || "");
  const [price, setPrice] = useState(editingBooking?.price !== null && editingBooking?.price !== undefined ? String(editingBooking.price) : "");
  const [currency, setCurrency] = useState(editingBooking?.currency || workspace.trip.primaryCurrency);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(editingBooking?.paymentStatus || "paid");
  const [bookingStatus, setBookingStatus] = useState<BookingStatus>(editingBooking?.bookingStatus || "confirmed");
  const [membershipItemId, setMembershipItemId] = useState(editingBooking?.membershipItemId || "");
  const [notes, setNotes] = useState(editingBooking?.notes || "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let ws = await saveTripBooking(
        user,
        workspace.trip.id,
        {
          category,
          title: title.trim(),
          provider,
          bookingReference,
          startDate: startDate || null,
          endDate: endDate || null,
          location,
          price: price === "" ? null : Number(price),
          currency,
          paymentStatus,
          bookingStatus,
          membershipItemId: membershipItemId || null,
          notes,
        },
        editingBooking?.id,
      );
      if (file) {
        const target = editingBooking?.id || ws.bookings[ws.bookings.length - 1]?.id;
        if (target) {
          ws = await uploadTripAttachment(user, workspace.trip.id, "booking", file, target);
        }
      }
      notify(editingBooking ? "Booking updated." : "Booking saved.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not save booking.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Save booking">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>{editingBooking ? "Edit Booking" : "Add Booking"}</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-field-grid">
              <div className="ts-field">
                <label>Booking Category *</label>
                <select className="ts-select" value={category} onChange={(e) => setCategory(e.target.value as BookingCategory)}>
                  {BOOKING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {BOOKING_CAT_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Title *</label>
                <input
                  className="ts-input"
                  placeholder="e.g. DAC -> CXB Morning Flight"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="ts-field">
                <label>Provider / Airline / Hotel</label>
                <input className="ts-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
              </div>
              <div className="ts-field">
                <label>Booking Reference / PNR</label>
                <input className="ts-input" value={bookingReference} onChange={(e) => setBookingReference(e.target.value)} />
              </div>
              <div className="ts-field">
                <label>Start / Check-in Date</label>
                <PersoraDatePicker value={startDate} onChange={setStartDate} clearable placeholder="Select check-in date" />
              </div>
              <div className="ts-field">
                <label>End / Check-out Date</label>
                <PersoraDatePicker value={endDate} onChange={setEndDate} minDate={startDate || undefined} clearable placeholder="Select check-out date" />
              </div>
              <div className="ts-field">
                <label>Price</label>
                <input type="number" min="0" step="0.01" className="ts-input ts-num" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className="ts-field">
                <label>Currency</label>
                <select className="ts-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {TRAVEL_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Payment Status</label>
                <select className="ts-select" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}>
                  {PAYMENT_STATUSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Booking Status</label>
                <select className="ts-select" value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value as BookingStatus)}>
                  {BOOKING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Location / Route</label>
                <input className="ts-input" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              {membershipItems.length > 0 && (
                <div className="ts-field">
                  <label>Loyalty / Membership Card</label>
                  <select className="ts-select" value={membershipItemId} onChange={(e) => setMembershipItemId(e.target.value)}>
                    <option value="">None</option>
                    {membershipItems.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="ts-field is-full">
                <label>Confirmation PDF / Image</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="ts-input"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="ts-field is-full">
                <label>Notes</label>
                <textarea className="ts-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              <Ticket size={14} /> {saving ? "Saving…" : "Save Booking"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function TravellerModal({
  user,
  workspace,
  contacts,
  familyItems,
  editingTraveller,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  contacts: PersoraContact[];
  familyItems: VaultItem[];
  editingTraveller: TravelTraveller | null;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [sourceMode, setSourceMode] = useState<"manual" | "contact" | "family" | "member">("manual");
  const [fullName, setFullName] = useState(editingTraveller?.fullName || "");
  const [email, setEmail] = useState(editingTraveller?.email || "");
  const [phone, setPhone] = useState(editingTraveller?.phone || "");
  const [memberQuery, setMemberQuery] = useState("");
  const [contactId, setContactId] = useState(editingTraveller?.contactId || "");
  const [familyItemId, setFamilyItemId] = useState(editingTraveller?.familyItemId || "");
  const [role, setRole] = useState<TravellerRole>(
    editingTraveller?.role && editingTraveller.role !== "owner" ? editingTraveller.role : "editor",
  );
  const [responsibility, setResponsibility] = useState(editingTraveller?.responsibility || "");
  const [emergencyContactName, setEmergencyContactName] = useState(editingTraveller?.emergencyContactName || "");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(editingTraveller?.emergencyContactPhone || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ws = await saveTripTraveller(
        user,
        workspace.trip.id,
        {
          fullName: fullName.trim(),
          email,
          phone,
          memberQuery: sourceMode === "member" ? memberQuery.trim() : undefined,
          contactId: contactId || null,
          familyItemId: familyItemId || null,
          role,
          responsibility,
          emergencyContactName,
          emergencyContactPhone,
        },
        editingTraveller?.id,
      );
      notify(editingTraveller ? "Traveller updated." : "Traveller added.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not save traveller.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Save traveller">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>{editingTraveller ? "Edit Traveller" : "Add Traveller"}</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            {!editingTraveller && (
              <div className="ts-segmented">
                <button type="button" className={sourceMode === "manual" ? "is-active" : ""} onClick={() => setSourceMode("manual")}>
                  Guest / Temporary
                </button>
                <button type="button" className={sourceMode === "contact" ? "is-active" : ""} onClick={() => setSourceMode("contact")}>
                  Persora Contact
                </button>
                <button type="button" className={sourceMode === "family" ? "is-active" : ""} onClick={() => setSourceMode("family")}>
                  Family Member
                </button>
                <button type="button" className={sourceMode === "member" ? "is-active" : ""} onClick={() => setSourceMode("member")}>
                  Persora Account
                </button>
              </div>
            )}

            <div className="ts-field-grid">
              {!editingTraveller && sourceMode === "contact" && (
                <div className="ts-field is-full">
                  <label>Select Persora Contact</label>
                  <select
                    className="ts-select"
                    value={contactId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setContactId(cid);
                      const c = contacts.find((x) => x.id === cid);
                      if (c) {
                        setFullName(c.name);
                        setEmail(c.email || "");
                        setPhone(c.phoneNumbers?.[0]?.number || "");
                      }
                    }}
                  >
                    <option value="">Choose contact…</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!editingTraveller && sourceMode === "family" && (
                <div className="ts-field is-full">
                  <label>Select Family Record</label>
                  <select
                    className="ts-select"
                    value={familyItemId}
                    onChange={(e) => {
                      const fid = e.target.value;
                      setFamilyItemId(fid);
                      const f = familyItems.find((x) => x.id === fid);
                      if (f) setFullName(f.title);
                    }}
                  >
                    <option value="">Choose family member…</option>
                    {familyItems.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!editingTraveller && sourceMode === "member" && (
                <div className="ts-field is-full">
                  <label>Persora Member Email or 7-Digit Persora ID *</label>
                  <input
                    className="ts-input"
                    placeholder="member@example.com or 1234567"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="ts-field">
                <label>Full Name {sourceMode !== "member" ? "*" : "(optional override)"}</label>
                <input
                  className="ts-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required={sourceMode !== "member"}
                />
              </div>

              {workspace.role === "owner" && !editingTraveller?.isOwner && (
                <div className="ts-field">
                  <label>Trip Permission Role</label>
                  <select className="ts-select" value={role} onChange={(e) => setRole(e.target.value as TravellerRole)}>
                    <option value="editor">Editor (Plan &amp; Expenses)</option>
                    <option value="expense_contributor">Expense Contributor</option>
                    <option value="viewer">Viewer (Read-Only)</option>
                  </select>
                </div>
              )}

              <div className="ts-field">
                <label>Email</label>
                <input className="ts-input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div className="ts-field">
                <label>Phone</label>
                <input className="ts-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="ts-field is-full">
                <label>Assigned Responsibility</label>
                <input
                  className="ts-input"
                  placeholder="e.g. Navigator, Hotel bookings, Treasurer…"
                  value={responsibility}
                  onChange={(e) => setResponsibility(e.target.value)}
                />
              </div>

              <div className="ts-field">
                <label>Emergency Contact Name</label>
                <input
                  className="ts-input"
                  value={emergencyContactName}
                  onChange={(e) => setEmergencyContactName(e.target.value)}
                />
              </div>

              <div className="ts-field">
                <label>Emergency Contact Phone</label>
                <input
                  className="ts-input"
                  value={emergencyContactPhone}
                  onChange={(e) => setEmergencyContactPhone(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Traveller"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function DocumentModal({
  user,
  workspace,
  documentVaultItems,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  documentVaultItems: VaultItem[];
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [sourceType, setSourceType] = useState<"upload" | "vault_item">(
    documentVaultItems.length > 0 ? "vault_item" : "upload",
  );
  const [linkedVaultItemId, setLinkedVaultItemId] = useState("");
  const [title, setTitle] = useState("");
  const [docCategory, setDocCategory] = useState<DocumentCategory>("passport");
  const [travellerId, setTravellerId] = useState(workspace.travellers[0]?.id || "");
  const [bookingId, setBookingId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let ws = await createTripDocument(user, workspace.trip.id, {
        title: title.trim(),
        docCategory,
        sourceType,
        linkedVaultItemId: sourceType === "vault_item" ? linkedVaultItemId : null,
        travellerId: travellerId || null,
        bookingId: bookingId || null,
        documentNumber,
        expiryDate: expiryDate || null,
        isPrivate,
        notes,
      });
      if (sourceType === "upload" && file && ws.documents[0]?.id) {
        ws = await uploadTripAttachment(user, workspace.trip.id, "document", file, ws.documents[0].id);
      }
      notify("Travel document linked.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not save document.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Add travel document">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>Add Travel Document</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-segmented">
              <button
                type="button"
                className={sourceType === "vault_item" ? "is-active" : ""}
                onClick={() => setSourceType("vault_item")}
              >
                Link Persora Vault Document
              </button>
              <button
                type="button"
                className={sourceType === "upload" ? "is-active" : ""}
                onClick={() => setSourceType("upload")}
              >
                Upload New File
              </button>
            </div>

            <div className="ts-field-grid">
              {sourceType === "vault_item" ? (
                <div className="ts-field is-full">
                  <label>Select Existing Persora Document *</label>
                  <select
                    className="ts-select"
                    value={linkedVaultItemId}
                    onChange={(e) => {
                      const vid = e.target.value;
                      setLinkedVaultItemId(vid);
                      const v = documentVaultItems.find((x) => x.id === vid);
                      if (v) {
                        setTitle(v.title);
                        if (v.metadata?.expiryDate) setExpiryDate(v.metadata.expiryDate);
                        if (v.metadata?.number) setDocumentNumber(v.metadata.number);
                      }
                    }}
                    required
                  >
                    <option value="">Choose from Persora Documents…</option>
                    {documentVaultItems.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} {d.metadata?.type ? `(${d.metadata.type})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="ts-field is-full">
                  <label>Upload File (PDF / Image)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="ts-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setFile(f);
                      if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
                    }}
                  />
                </div>
              )}

              <div className="ts-field">
                <label>Document Title *</label>
                <input className="ts-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>

              <div className="ts-field">
                <label>Category</label>
                <select className="ts-select" value={docCategory} onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {DOC_CAT_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ts-field">
                <label>Traveller</label>
                <select className="ts-select" value={travellerId} onChange={(e) => setTravellerId(e.target.value)}>
                  <option value="">Any / Trip-wide</option>
                  {workspace.travellers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ts-field">
                <label>Expiry Date</label>
                <PersoraDatePicker value={expiryDate} onChange={setExpiryDate} clearable placeholder="Select expiry date" />
              </div>

              <div className="ts-field">
                <label>Document Number</label>
                <input className="ts-input" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
              </div>

              {workspace.bookings.length > 0 && (
                <div className="ts-field">
                  <label>Linked Booking</label>
                  <select className="ts-select" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
                    <option value="">None</option>
                    {workspace.bookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ts-field is-full">
                <label>Notes</label>
                <input
                  className="ts-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional document notes"
                />
              </div>

              <div className="ts-field is-full">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ds-text)", cursor: "pointer" }}>
                  <Checkbox checked={isPrivate} onCheckedChange={(v) => setIsPrivate(v === true)} />
                  <span>Restrict visibility to Owner &amp; uploader only</span>
                </label>
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Document"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
