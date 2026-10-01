import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, ShieldCheck, UsersRound, X } from "lucide-react";

export default function ShareRecordDialog({ title, kind, onClose, onShare }: { title: string; kind: "contact" | "business card"; onClose: () => void; onShare: (recipient: string) => Promise<void> }) {
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipient.trim()) return;
    setBusy(true); setError("");
    try { await onShare(recipient.trim()); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This record could not be shared."); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop record-share-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section className="record-share-dialog" role="dialog" aria-modal="true" aria-labelledby="record-share-title"><header><span><UsersRound size={17}/></span><div><small>Share securely with a Persora member</small><h2 id="record-share-title">Share {kind}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17}/></button></header><p className="record-share-target">{title}</p><form onSubmit={(event) => void submit(event)}><label>Persora ID or account email<input autoFocus value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="7-digit Persora ID or email@example.com" maxLength={254} required/></label><div className="record-share-privacy"><ShieldCheck size={14}/><span>Only this selected {kind} will be shared. Private account and vault details stay hidden.</span></div>{error && <div className="record-share-error"><CircleAlert size={14}/>{error}</div>}<footer><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy || !recipient.trim()}>{busy ? "Sharing…" : "Share record"}<ArrowRight size={14}/></button></footer></form></section></div>;
}
