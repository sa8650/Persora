import { useState, type FormEvent } from "react";
import { Check, CircleAlert, Eye, EyeOff, LockKeyhole, ShieldCheck, Unplug } from "lucide-react";
import ItemModalShell from "../ItemModalShell";
import ModalPortal from "../ModalPortal";
import { connectEms, type ConnectionStatus } from "../../lib/connections-api";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";
import { PersoraDeleteModal } from "@/design-system";
import emsLogo from "../../assets/connections/ems.svg";
import googleDriveLogo from "../../assets/connections/google-drive.svg";
import googlePhotosLogo from "../../assets/connections/google-photos.svg";
import googleDocsLogo from "../../assets/connections/google-docs.svg";
import googleCalendarLogo from "../../assets/connections/google-calendar.svg";
import notionLogo from "../../assets/connections/notion.svg";
import oneDriveLogo from "../../assets/connections/microsoft-onedrive.svg";
import outlookLogo from "../../assets/connections/microsoft-outlook.svg";
import "./connections.css";

/**
 * Each service's own official logo, bundled locally (see src/assets/connections/README.md).
 * A new provider needs its real logo here — never a generic icon or a shared brand mark.
 */
export const PROVIDER_LOGOS: Record<string, string> = {
  ems: emsLogo,
  "google-drive": googleDriveLogo,
  "google-photos": googlePhotosLogo,
  "google-docs": googleDocsLogo,
  "google-calendar": googleCalendarLogo,
  notion: notionLogo,
  "microsoft-onedrive": oneDriveLogo,
  "microsoft-outlook": outlookLogo,
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected", reauth_required: "Reconnect needed", revoked: "Disconnected", not_connected: "Not connected", unavailable: "Unavailable", coming_soon: "Coming soon",
};

export function ConnectionStatusPill({ status, degraded = false }: { status: ConnectionStatus; degraded?: boolean }) {
  const tone = degraded && status === "connected" ? "warn" : status === "connected" ? "good" : status === "reauth_required" ? "bad" : "muted";
  const variant = tone === "good" ? "success-light" : tone === "warn" ? "warning-light" : tone === "bad" ? "destructive-light" : "secondary";
  return <Badge variant={variant} size="xs" radius="full" className={`cn-pill cn-pill-${tone}`}><i aria-hidden="true"/>{degraded && status === "connected" ? "Connected · limited" : STATUS_LABEL[status]}</Badge>;
}

/** The service's official logo in a consistent tile; proportions are preserved (object-fit: contain). */
export function ProviderLogo({ id, name, size = "md" }: { id: string; name: string; size?: "sm" | "md" | "lg" }) {
  const src = PROVIDER_LOGOS[id];
  return <span className={`cn-logo cn-logo-${size}`}>
    {src ? <img src={src} alt={`${name} logo`} draggable={false} decoding="async"/> : <b aria-label={name}>{name.slice(0, 1).toUpperCase()}</b>}
  </span>;
}

/** Connect / reconnect EMS inside Persora — no redirect to EMS. */
export function EmsConnectDialog({ reconnect = false, defaultEmail = "", onClose, onConnected }: { reconnect?: boolean; defaultEmail?: string; onClose: () => void; onConnected: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await connectEms(email.trim(), password);
      setPassword("");
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "EMS couldn't be connected.");
    } finally { setBusy(false); }
  };
  return <ModalPortal><ItemModalShell labelledBy="cn-connect-title" className="cn-dialog" icon={<img className="cn-dialog-logo" src={emsLogo} alt="" draggable={false}/>} iconClassName="cn-dialog-icon" eyebrow="EMS · Dexter Studio" title={<span id="cn-connect-title">{reconnect ? "Reconnect EMS" : "Connect EMS"}</span>} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
    <form className="cn-connect-form" onSubmit={(e) => void submit(e)}>
      <p className="cn-connect-lead">Sign in with your <b>EMS administrator</b> account. Persora checks it directly with EMS — you stay right here.</p>
      <label className="cn-field"><span>EMS administrator email</span><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@yourbusiness.com" disabled={busy} autoFocus/></label>
      <label className="cn-field"><span>EMS password</span><span className="cn-password"><input type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={512} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}/><button type="button" className="cn-icon-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15}/> : <Eye size={15}/>}</button></span></label>
      {error && <div className="cn-alert cn-alert-bad" role="alert"><CircleAlert size={15}/><span>{error}</span></div>}
      <ul className="cn-assurances">
        <li><LockKeyhole size={13}/> Your EMS password is used once to verify you and is never stored by Persora.</li>
        <li><ShieldCheck size={13}/> Read-only: Persora can't add, change or delete anything in EMS.</li>
        <li><Check size={13}/> Requires Vaultium to have been purchased on this EMS account at least once.</li>
      </ul>
      <div className="cn-dialog-actions">
        <button type="button" className="cn-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="cn-primary-button" disabled={busy || !email || !password}>{busy ? <><Spinner className="size-3.5"/> Verifying…</> : <>{reconnect ? "Reconnect" : "Connect"} EMS</>}</button>
      </div>
    </form>
  </ItemModalShell></ModalPortal>;
}

export function ConfirmDisconnectDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <PersoraDeleteModal
      eyebrow="Connections"
      title={`Disconnect ${name}?`}
      titleId="cn-disconnect-title"
      icon={<Unplug size={18} />}
      confirmLabel={busy ? "Disconnecting…" : "Disconnect"}
      busy={busy}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Persora will stop accessing {name} and forget this connection. Nothing in {name} is changed or deleted, and copies you already saved to Persora stay in your vault.
      </p>
    </PersoraDeleteModal>
  );
}
