import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  BookOpen,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  Heart,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import ModalPortal from "../ModalPortal";
import { Checkbox, PersoraDatePicker } from "@/design-system";
import {
  BOOKING_STATUSES,
  canRolePerform,
  formatTravelMoney,
  type BookingStatus,
  type MemoryType,
} from "../../../cloudflare/travel-space-rules.js";
import {
  completeTripFlow,
  deleteTripMemory,
  getDestinationStopLabel,
  loadLinkableAudios,
  loadLinkablePhotos,
  openTripFile,
  saveTripMemory,
  uploadTripAttachment,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import { downloadTravelJournalPdf } from "../../lib/travel-space-pdf";
import type { AppUser, TimelineDraft } from "../../types";

interface MemoriesProps {
  user: AppUser;
  workspace: TravelWorkspace;
  onWorkspaceChange: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}

export function TripMemoriesTab({ user, workspace, onWorkspaceChange, notify }: MemoriesProps) {
  const canEdit = canRolePerform(workspace.role, "edit_memories");
  const [filter, setFilter] = useState<"all" | "journal" | "photo" | "audio" | "favorites">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const visibleMemories = useMemo(() => {
    return workspace.memories.filter((m) => {
      if (filter === "favorites") return m.favorite;
      if (filter !== "all") return m.memoryType === filter;
      return true;
    });
  }, [workspace.memories, filter]);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await downloadTravelJournalPdf(workspace);
      notify("Downloaded Travel Journal PDF.");
    } catch (err: any) {
      notify(err?.message || "Could not export PDF.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ts-filter-bar">
        <div className="ts-segmented">
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
            All ({workspace.memories.length})
          </button>
          <button type="button" className={filter === "journal" ? "is-active" : ""} onClick={() => setFilter("journal")}>
            Journal
          </button>
          <button type="button" className={filter === "photo" ? "is-active" : ""} onClick={() => setFilter("photo")}>
            Photos
          </button>
          <button type="button" className={filter === "audio" ? "is-active" : ""} onClick={() => setFilter("audio")}>
            Audio
          </button>
          <button
            type="button"
            className={filter === "favorites" ? "is-active" : ""}
            onClick={() => setFilter("favorites")}
          >
            Favourites
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ts-btn" onClick={() => void handleExportPdf()} disabled={exporting}>
            <Download size={14} /> {exporting ? "Exporting…" : "Export Journal PDF"}
          </button>
          {canEdit && (
            <button type="button" className="ts-btn ts-btn-primary" onClick={() => setModalOpen(true)}>
              <Plus size={14} /> Add Memory / Entry
            </button>
          )}
        </div>
      </div>

      {/* Completed Trip Summary Banner */}
      {workspace.trip.status === "completed" && (
        <div className="ts-panel" style={{ borderColor: "rgba(22, 163, 74, 0.3)" }}>
          <div className="ts-panel-head">
            <h3>Completed Trip Summary</h3>
            {workspace.trip.rating && (
              <span className="ts-status-pill ts-status-completed">
                <Star size={11} /> Rated {workspace.trip.rating} / 5
              </span>
            )}
          </div>
          <div className="ts-stat-grid">
            <div className="ts-stat-card">
              <span>Route Stops</span>
              <strong style={{ fontSize: 14 }}>
                {workspace.destinations.length > 0
                  ? workspace.destinations
                      .slice(0, 3)
                      .map((d, idx) => getDestinationStopLabel(d, idx))
                      .join(" → ")
                  : "No stops pinned"}
              </strong>
              <small>Returned {workspace.trip.actualReturnDate || workspace.trip.endDate}</small>
            </div>
            <div className="ts-stat-card">
              <span>Activities Done</span>
              <strong>
                {workspace.items.filter((i) => i.status === "done").length} / {workspace.items.length}
              </strong>
              <small>{workspace.trip.durationDays} days</small>
            </div>
            <div className="ts-stat-card">
              <span>Total Spent</span>
              <strong>
                {formatTravelMoney(workspace.budgetOverview.totalExpenses, workspace.trip.primaryCurrency)}
              </strong>
              <small>
                Planned {formatTravelMoney(workspace.budgetOverview.totalPlannedBudget, workspace.trip.primaryCurrency)}
              </small>
            </div>
            <div className="ts-stat-card">
              <span>Memories Saved</span>
              <strong>{workspace.memories.length}</strong>
              <small>{workspace.trip.timelineEventId ? "Linked to Life Timeline" : "Preserved in TravelSpace"}</small>
            </div>
          </div>
          {workspace.trip.completionNotes && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ds-text-secondary)", lineHeight: 1.5 }}>
              {workspace.trip.completionNotes}
            </p>
          )}
        </div>
      )}

      {visibleMemories.length === 0 ? (
        <div className="ts-panel" style={{ fontSize: 13, color: "var(--ds-text-muted)" }}>
          Preserve photos, link Photo Studio or AudioSpace recordings, or write daily travel journal reflections.
        </div>
      ) : (
        <div className="ts-trips-grid">
          {visibleMemories.map((mem) => (
            <div key={mem.id} className="ts-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <small style={{ color: "var(--ds-text-muted)", fontWeight: 600 }}>
                    {mem.memoryType === "photo" ? (
                      <>
                        <Camera size={11} style={{ verticalAlign: "middle" }} /> PHOTO
                      </>
                    ) : mem.memoryType === "audio" ? (
                      <>
                        <AudioLines size={11} style={{ verticalAlign: "middle" }} /> AUDIO
                      </>
                    ) : (
                      <>
                        <BookOpen size={11} style={{ verticalAlign: "middle" }} /> JOURNAL
                      </>
                    )}
                    {mem.dayNumber ? ` · DAY ${mem.dayNumber}` : ""}
                  </small>
                  <h4 style={{ margin: "3px 0 0", fontSize: 14.5 }}>{mem.title}</h4>
                </div>

                {canEdit && (
                  <button
                    type="button"
                    className="ts-btn ts-btn-sm"
                    onClick={async () => {
                      const ws = await saveTripMemory(
                        user,
                        workspace.trip.id,
                        { favorite: !mem.favorite },
                        mem.id,
                      );
                      onWorkspaceChange(ws);
                    }}
                    aria-label="Toggle favourite"
                  >
                    <Heart size={12} fill={mem.favorite ? "#dc2626" : "none"} color={mem.favorite ? "#dc2626" : "currentColor"} />
                  </button>
                )}
              </div>

              {(mem.memoryDate || mem.location) && (
                <div className="ts-meta-row">
                  {mem.memoryDate && <span>{mem.memoryDate}</span>}
                  {mem.location && <span>{mem.location}</span>}
                </div>
              )}

              {mem.caption && <div style={{ fontSize: 12.5, color: "var(--ds-text-secondary)" }}>{mem.caption}</div>}
              {mem.journalBody && (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ds-text)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {mem.journalBody}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {mem.hasFile && (
                  <button
                    type="button"
                    className="ts-btn ts-btn-sm"
                    onClick={async () => {
                      try {
                        const url = await openTripFile(user, workspace.trip.id, "memory", mem.id, mem.localDataUrl);
                        window.open(url, "_blank", "noopener,noreferrer");
                      } catch (err: any) {
                        notify(err?.message || "Could not open media.", "error");
                      }
                    }}
                  >
                    <Eye size={11} /> {mem.memoryType === "audio" ? "Play Audio" : "View Media"}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="ts-btn ts-btn-sm ts-btn-danger"
                    onClick={async () => {
                      const ws = await deleteTripMemory(user, workspace.trip.id, mem.id);
                      onWorkspaceChange(ws);
                      notify("Memory deleted.");
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <MemoryEditorModal
          user={user}
          workspace={workspace}
          onClose={() => setModalOpen(false)}
          onSaved={(ws) => {
            onWorkspaceChange(ws);
            setModalOpen(false);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function MemoryEditorModal({
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
  const [memoryType, setMemoryType] = useState<MemoryType>("journal");
  const [sourceType, setSourceType] = useState<"journal" | "upload" | "photo_studio" | "audio_space">("journal");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [journalBody, setJournalBody] = useState("");
  const [memoryDate, setMemoryDate] = useState(workspace.trip.startDate);
  const [location, setLocation] = useState(
    workspace.destinations[0] ? getDestinationStopLabel(workspace.destinations[0], 0) : "",
  );
  const [favorite, setFavorite] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [linkedPhotoId, setLinkedPhotoId] = useState("");
  const [linkedAudioId, setLinkedAudioId] = useState("");
  const [studioPhotos, setStudioPhotos] = useState<Array<{ id: string; title: string }>>([]);
  const [audioItems, setAudioItems] = useState<Array<{ id: string; title: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadLinkablePhotos(user).then(setStudioPhotos);
    void loadLinkableAudios(user).then(setAudioItems);
  }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const dayMatch = workspace.days.find((d) => d.date === memoryDate);
      let ws = await saveTripMemory(user, workspace.trip.id, {
        memoryType,
        sourceType: memoryType === "journal" ? "journal" : sourceType,
        title: title.trim(),
        caption,
        journalBody: memoryType === "journal" ? journalBody : "",
        memoryDate: memoryDate || null,
        dayNumber: dayMatch?.dayNumber || null,
        location,
        favorite,
        linkedPhotoId: sourceType === "photo_studio" ? linkedPhotoId : null,
        linkedAudioId: sourceType === "audio_space" ? linkedAudioId : null,
      });
      if (memoryType === "photo" && sourceType === "upload" && file) {
        const last = ws.memories[ws.memories.length - 1];
        if (last) {
          ws = await uploadTripAttachment(user, workspace.trip.id, "memory", file, last.id);
        }
      }
      notify("Memory saved.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not save memory.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Add travel memory">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>Add Travel Memory / Journal Entry</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-segmented">
              <button
                type="button"
                className={memoryType === "journal" ? "is-active" : ""}
                onClick={() => {
                  setMemoryType("journal");
                  setSourceType("journal");
                }}
              >
                Journal Entry
              </button>
              <button
                type="button"
                className={memoryType === "photo" ? "is-active" : ""}
                onClick={() => {
                  setMemoryType("photo");
                  setSourceType("upload");
                }}
              >
                Photo
              </button>
              <button
                type="button"
                className={memoryType === "audio" ? "is-active" : ""}
                onClick={() => {
                  setMemoryType("audio");
                  setSourceType("audio_space");
                }}
              >
                AudioSpace Note
              </button>
            </div>

            <div className="ts-field-grid">
              {memoryType === "photo" && (
                <div className="ts-field is-full">
                  <div className="ts-segmented" style={{ marginBottom: 6 }}>
                    <button
                      type="button"
                      className={sourceType === "upload" ? "is-active" : ""}
                      onClick={() => setSourceType("upload")}
                    >
                      Upload Photo
                    </button>
                    {studioPhotos.length > 0 && (
                      <button
                        type="button"
                        className={sourceType === "photo_studio" ? "is-active" : ""}
                        onClick={() => setSourceType("photo_studio")}
                      >
                        Link Photo Studio
                      </button>
                    )}
                  </div>
                  {sourceType === "upload" ? (
                    <input
                      type="file"
                      accept="image/*"
                      className="ts-input"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setFile(f);
                        if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
                      }}
                    />
                  ) : (
                    <select
                      className="ts-select"
                      value={linkedPhotoId}
                      onChange={(e) => {
                        setLinkedPhotoId(e.target.value);
                        const p = studioPhotos.find((x) => x.id === e.target.value);
                        if (p && !title) setTitle(p.title);
                      }}
                    >
                      <option value="">Select Photo Studio image…</option>
                      {studioPhotos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {memoryType === "audio" && (
                <div className="ts-field is-full">
                  <label>Link AudioSpace Recording</label>
                  <select
                    className="ts-select"
                    value={linkedAudioId}
                    onChange={(e) => {
                      setLinkedAudioId(e.target.value);
                      const a = audioItems.find((x) => x.id === e.target.value);
                      if (a && !title) setTitle(a.title);
                    }}
                  >
                    <option value="">Choose AudioSpace recording…</option>
                    {audioItems.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ts-field is-full">
                <label>Title *</label>
                <input
                  className="ts-input"
                  placeholder="e.g. Sunset walk along Inani Beach"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="ts-field">
                <label>Date</label>
                <PersoraDatePicker value={memoryDate} onChange={setMemoryDate} placeholder="Select memory date" />
              </div>

              <div className="ts-field">
                <label>Location</label>
                <input className="ts-input" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>

              <div className="ts-field is-full">
                <label>Short Caption</label>
                <input className="ts-input" value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>

              {memoryType === "journal" && (
                <div className="ts-field is-full">
                  <label>Travel Journal Reflection</label>
                  <textarea
                    className="ts-textarea"
                    style={{ minHeight: 110 }}
                    placeholder="Write your day's story, favourite moments, and travel notes…"
                    value={journalBody}
                    onChange={(e) => setJournalBody(e.target.value)}
                  />
                </div>
              )}

              <div className="ts-field is-full">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ds-text)", cursor: "pointer" }}>
                  <Checkbox checked={favorite} onCheckedChange={(v) => setFavorite(v === true)} />
                  <span>Mark as favourite memory</span>
                </label>
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save Memory"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

// ===========================================================================
// 5-STEP COMPLETE TRIP WORKFLOW MODAL
// ===========================================================================

export function CompleteTripModal({
  user,
  workspace,
  onSaveTimelineEvent,
  onClose,
  onCompleted,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  onSaveTimelineEvent?: (draft: TimelineDraft) => Promise<void>;
  onClose: () => void;
  onCompleted: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [actualReturnDate, setActualReturnDate] = useState(
    workspace.trip.actualReturnDate || workspace.trip.endDate,
  );
  const [rating, setRating] = useState<number>(workspace.trip.rating || 5);
  const [completionNotes, setCompletionNotes] = useState(workspace.trip.completionNotes || "");
  const [createTimelineEvent, setCreateTimelineEvent] = useState(true);
  const [bookingReviews, setBookingReviews] = useState(() =>
    workspace.bookings.map((b) => ({
      id: b.id,
      title: b.title,
      category: b.category,
      bookingStatus: (b.bookingStatus === "confirmed" ? "completed" : b.bookingStatus) as BookingStatus,
      refundAmount: b.refundAmount !== null ? String(b.refundAmount) : "",
      cancellationNote: b.cancellationNote || "",
    })),
  );
  const [saving, setSaving] = useState(false);

  const cur = workspace.trip.primaryCurrency;
  const b = workspace.budgetOverview;

  const finishTrip = async () => {
    setSaving(true);
    try {
      const ws = await completeTripFlow(user, workspace.trip.id, {
        actualReturnDate,
        rating,
        completionNotes,
        createTimelineEvent,
        bookingUpdates: bookingReviews.map((br) => ({
          id: br.id,
          bookingStatus: br.bookingStatus,
          refundAmount: br.refundAmount === "" ? null : Number(br.refundAmount),
          cancellationNote: br.cancellationNote,
        })),
      });

      // Sync Persora Life Timeline in both Demo mode (local state) and Cloud mode (reloads encrypted server timeline)
      if (createTimelineEvent && onSaveTimelineEvent) {
        await onSaveTimelineEvent({
          id: ws.trip.timelineEventId || undefined,
          eventDate: actualReturnDate,
          title: `Completed Trip: ${ws.trip.title}`,
          description: `Stops: ${ws.destinations.map((d, idx) => getDestinationStopLabel(d, idx)).join(" -> ") || "None"}\nNotes: ${completionNotes}`,
          url: `/?view=travel-space&trip=${ws.trip.id}`,
          linkedRecordIds: [],
        }).catch(() => {});
      }

      notify("Trip marked as Completed and summary preserved.");
      onCompleted(ws);
    } catch (err: any) {
      notify(err?.message || "Could not complete trip.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Complete trip workflow">
        <div className="ts-modal-card is-wide">
          <div className="ts-modal-head">
            <div>
              <h3>Complete Trip — Step {step} of 5</h3>
              <small style={{ color: "var(--ds-text-muted)" }}>{workspace.trip.title}</small>
            </div>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="ts-modal-body">
            {step === 1 && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Step 1: Trip Completion Confirmation</h4>
                <div className="ts-field-grid">
                  <div className="ts-field">
                    <label htmlFor="ts-complete-return">Actual Return Date</label>
                    <PersoraDatePicker
                      id="ts-complete-return"
                      value={actualReturnDate}
                      onChange={setActualReturnDate}
                      placeholder="Select return date"
                    />
                  </div>
                  <div className="ts-field">
                    <label htmlFor="ts-complete-rating">Trip Rating (1–5)</label>
                    <select
                      id="ts-complete-rating"
                      className="ts-select"
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                    >
                      {[5, 4, 3, 2, 1].map((r) => (
                        <option key={r} value={r}>
                          {r} {r === 1 ? "Star" : "Stars"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ts-field is-full">
                    <label htmlFor="ts-complete-notes">Completion Notes &amp; Highlights</label>
                    <textarea
                      id="ts-complete-notes"
                      className="ts-textarea"
                      placeholder="What stood out on this trip?"
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Step 2: Expense &amp; Balance Review</h4>
                <div className="ts-stat-grid">
                  <div className="ts-stat-card">
                    <span>Planned Budget</span>
                    <strong>{formatTravelMoney(b.totalPlannedBudget, cur)}</strong>
                  </div>
                  <div className="ts-stat-card">
                    <span>Actual Expenses</span>
                    <strong>{formatTravelMoney(b.totalExpenses, cur)}</strong>
                  </div>
                  <div className="ts-stat-card">
                    <span>Unsettled Transfers</span>
                    <strong>{b.suggestedSettlements.length}</strong>
                    <small>Unsettled balances do not block completion</small>
                  </div>
                </div>
                {b.suggestedSettlements.length > 0 && (
                  <div className="ts-alert">
                    <span>
                      {b.suggestedSettlements.length} shared balance transfer(s) remain unsettled. You can still complete
                      the trip and settle them later in the Expenses tab.
                    </span>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Step 3: Booking Review</h4>
                {bookingReviews.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--ds-text-secondary)" }}>
                    No bookings recorded for this trip. Proceed to Trip Summary.
                  </p>
                ) : (
                  <div className="ts-table-wrap">
                    <table className="ts-table">
                      <thead>
                        <tr>
                          <th>Booking</th>
                          <th>Final Status</th>
                          <th>Refund Amount</th>
                          <th>Cancellation / Refund Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookingReviews.map((br, idx) => (
                          <tr key={br.id}>
                            <td>
                              <b>{br.title}</b> <small>({br.category})</small>
                            </td>
                            <td>
                              <select
                                className="ts-select"
                                value={br.bookingStatus}
                                onChange={(e) =>
                                  setBookingReviews((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, bookingStatus: e.target.value as BookingStatus } : x,
                                    ),
                                  )
                                }
                              >
                                {BOOKING_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="ts-input ts-num"
                                placeholder="0.00"
                                value={br.refundAmount}
                                onChange={(e) =>
                                  setBookingReviews((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, refundAmount: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="ts-input"
                                value={br.cancellationNote}
                                onChange={(e) =>
                                  setBookingReviews((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, cancellationNote: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Step 4: Trip Summary Preview</h4>
                <div className="ts-meta-row">
                  <span>
                    Route:{" "}
                    <b>
                      {workspace.destinations.length > 0
                        ? workspace.destinations.map((d, idx) => getDestinationStopLabel(d, idx)).join(" → ")
                        : "No stops pinned"}
                    </b>
                  </span>
                  <span>
                    Dates: <b>{workspace.trip.startDate}</b> to <b>{actualReturnDate}</b>
                  </span>
                  <span>
                    Travellers: <b>{workspace.travellers.length}</b>
                  </span>
                  <span>
                    Activities Done:{" "}
                    <b>
                      {workspace.items.filter((i) => i.status === "done").length} / {workspace.items.length}
                    </b>
                  </span>
                </div>
                {completionNotes && (
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ds-text-secondary)" }}>
                    {completionNotes}
                  </p>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="ts-form-section">
                <h4 className="ts-form-section-title">Step 5: Finish Trip &amp; Preserve Milestone</h4>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ds-text-secondary)" }}>
                  Completing this trip transitions its status to <b>Completed</b>, preserves all expenses, bookings,
                  itinerary items, and documents, and unlocks your PDF Travel Journal summary.
                </p>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, cursor: "pointer" }}>
                  <Checkbox
                    checked={createTimelineEvent}
                    onCheckedChange={(v) => setCreateTimelineEvent(v === true)}
                  />
                  <span>Add completed trip milestone to <b>Persora Life Timeline</b></span>
                </label>
              </div>
            )}
          </div>

          <div className="ts-modal-foot">
            <button
              type="button"
              className="ts-btn"
              onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as any))}
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>
            {step < 5 ? (
              <button type="button" className="ts-btn ts-btn-primary" onClick={() => setStep((s) => (s + 1) as any)}>
                Next Step
              </button>
            ) : (
              <button type="button" className="ts-btn ts-btn-primary" disabled={saving} onClick={() => void finishTrip()}>
                <CheckCircle2 size={14} /> {saving ? "Completing…" : "Complete Trip"}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
