import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Copy, KeyRound, Link2, Plug, RefreshCw, ShieldCheck, Store, Wand2 } from "lucide-react";
import { formatDate } from "../../lib/utils";
import { loadIntegrationStatus, saveIntegration, testIntegration, type IntegrationStatus } from "../../lib/connections-api";
import { Checkbox } from "@/components/ui/checkbox";

type Notify = (message: string, kind?: "success" | "error") => void;

function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <div className="system-check-row"><span className={`system-check-icon ${ok ? "ok" : "warn"}`}>{ok ? <Check size={15}/> : <CircleAlert size={15}/>}</span><span><b>{label}</b><small>{detail}</small></span></div>;
}

/**
 * Persora Admin Console → Integrations → EMS. The shared secret is write-only:
 * the API returns a masked hint only, and a blank field keeps the stored value.
 */
export default function AdminIntegrationsPanel({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const apply = (next: IntegrationStatus) => { setStatus(next); setEnabled(next.enabled); setBaseUrl(next.baseUrlSource === "console" ? next.baseUrl : ""); };
  const refresh = useCallback(async () => {
    try { setError(""); apply(await loadIntegrationStatus("ems")); }
    catch (err) { setError(err instanceof Error ? err.message : "Integration settings couldn't be loaded."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!status) return;
    setSaving(true);
    try {
      const body: { enabled: boolean; baseUrl?: string; secret?: string } = { enabled };
      if (status.baseUrlSource !== "environment" || baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (secret.trim()) body.secret = secret.trim();
      apply(await saveIntegration("ems", body));
      setSecret(""); setRevealed(false); setTestResult(null);
      notify("EMS integration settings saved.");
    } catch (err) { notify(err instanceof Error ? err.message : "Settings couldn't be saved.", "error"); }
    finally { setSaving(false); }
  };
  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try { const result = await testIntegration("ems"); setTestResult({ ok: result.ok, message: result.message }); apply(result.status); }
    catch (err) { setTestResult({ ok: false, message: err instanceof Error ? err.message : "The test couldn't run." }); }
    finally { setTesting(false); }
  };

  if (error) return <section className="admin-card"><div className="admin-hint-box"><CircleAlert size={15}/><span>{error}</span></div><button className="admin-secondary-button" onClick={() => void refresh()}><RefreshCw size={14}/> Retry</button></section>;
  if (!status) return <section className="admin-card"><p className="admin-section-copy">Loading integration settings…</p></section>;
  const envSecret = status.secretSource === "environment";

  return <div className="admin-content-grid">
    <section className="admin-card">
      <div className="admin-card-heading"><div><span>CONNECTIONS · DEXTER STUDIO</span><h2>EMS integration</h2></div><Store size={18}/></div>
      <p className="admin-section-copy">Lets members connect their EMS administrator account inside Persora and browse their Vaultium files read-only. Access works only while this integration <b>and</b> the EMS Owner Console integration are both enabled with matching shared secrets.</p>
      <form className="admin-form" onSubmit={(e) => void save(e)} autoComplete="off">
        <label className="admin-toggle-row admin-form-wide"><span><b>Enable EMS connections</b><small>{enabled ? "Members can connect EMS and browse Vaultium files." : "Disabled — existing connections are kept but blocked."}</small></span><Checkbox checked={enabled} aria-label="Enable EMS connections" onCheckedChange={(checked) => setEnabled(checked === true)}/></label>
        <label className="admin-form-wide">EMS address (HTTPS)<input type="url" inputMode="url" value={baseUrl} maxLength={300} onChange={(e) => setBaseUrl(e.target.value)} placeholder={status.baseUrlSource === "environment" ? `${status.baseUrl} (from EMS_API_BASE_URL)` : "https://ems.example.com"}/></label>
        <label className="admin-form-wide">{status.secretConfigured ? "Replace shared secret" : "Shared secret"}
          <span style={{ display: "flex", gap: 6 }}>
            <input style={{ flex: 1, minWidth: 0 }} type={revealed ? "text" : "password"} autoComplete="new-password" spellCheck={false} value={secret} disabled={envSecret} minLength={status.minSecretLength} maxLength={256} onChange={(e) => setSecret(e.target.value)} placeholder={envSecret ? "Managed by EMS_INTEGRATION_SECRET" : status.secretConfigured ? "Leave blank to keep the current secret" : `At least ${status.minSecretLength} characters`}/>
            {!envSecret && <button type="button" className="admin-secondary-button" onClick={() => { setSecret(generateSecret()); setRevealed(true); }}><Wand2 size={14}/> Generate</button>}
            {!envSecret && revealed && secret && <button type="button" className="admin-secondary-button" onClick={() => { void navigator.clipboard?.writeText(secret).then(() => notify("Secret copied."), () => notify("Copy failed — select and copy it manually.", "error")); }}><Copy size={14}/></button>}
          </span>
        </label>
        <div className="admin-form-wide admin-hint-box"><KeyRound size={15}/><span>Paste the same secret into <b>EMS Owner Console → Services → Persora Connections</b>. It is encrypted before storage and never shown again. Replacing it blocks requests until both sides match. The secret identifies Persora to EMS only — members still sign in with their own EMS credentials.</span></div>
        <button className="admin-primary-button" disabled={saving}><Check size={15}/> {saving ? "Saving…" : "Save EMS settings"}</button>
      </form>
    </section>
    <section className="admin-card">
      <div className="admin-card-heading"><div><span>STATUS</span><h2>Connection health</h2></div><Plug size={18}/></div>
      <Row label="Integration" ok={status.ready} detail={status.ready ? "Enabled and configured" : status.enabled ? "Enabled, but configuration is incomplete" : "Disabled"}/>
      <Row label="EMS address" ok={Boolean(status.baseUrl)} detail={status.baseUrl ? `${status.baseUrl}${status.baseUrlSource === "environment" ? " · environment" : ""}` : "Not set"}/>
      <Row label="Shared secret" ok={status.secretConfigured} detail={status.secretConfigured ? `${status.secretHint || "Configured"} · ${envSecret ? "environment variable" : "encrypted in database"}` : status.secretReadable ? "Not set" : "Stored secret can't be decrypted — replace it"}/>
      <Row label="Encryption key" ok={status.encryptionConfigured} detail={status.encryptionConfigured ? "Connection secrets are encrypted at rest" : "Set CONNECTIONS_ENCRYPTION_KEY in Cloudflare Pages"}/>
      <div className="admin-form" style={{ marginTop: 12 }}>
        <button type="button" className="admin-secondary-button" onClick={() => void runTest()} disabled={testing || !status.baseUrl || !status.secretConfigured}><Link2 size={14}/> {testing ? "Testing…" : "Test connection to EMS"}</button>
      </div>
      {(testResult || status.lastCheck) && <div className="admin-hint-box" style={{ marginTop: 12 }}>{(testResult?.ok ?? status.lastCheck?.ok) ? <ShieldCheck size={15}/> : <CircleAlert size={15}/>}<span>{testResult?.message || status.lastCheck?.message}{!testResult && status.lastCheck && <> · {formatDate(status.lastCheck.at)}</>}</span></div>}
      <p className="admin-table-footnote"><Plug size={14}/> {status.connections.connected} connected member{status.connections.connected === 1 ? "" : "s"}{status.connections.reauthRequired ? ` · ${status.connections.reauthRequired} need to reconnect` : ""}{status.updatedAt ? ` · updated ${formatDate(status.updatedAt)}` : ""}</p>
    </section>
  </div>;
}
