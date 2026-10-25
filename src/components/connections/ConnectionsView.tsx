import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Briefcase, CircleAlert, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import type { AppUser } from "../../types";
import { connectionsAvailable, disconnectEms, loadConnections, type ConnectionProvider } from "../../lib/connections-api";
import { ConfirmDisconnectDialog, ConnectionStatusPill, EmsConnectDialog, ProviderMark } from "./ConnectionParts";
import EmsConnectionView from "./EmsConnectionView";
import "./connections.css";

type Notify = (message: string, kind?: "success" | "error") => void;

function ProviderCard({ provider, demo, onConnect, onManage, onDisconnect }: { provider: ConnectionProvider; demo: boolean; onConnect: () => void; onManage: () => void; onDisconnect: () => void }) {
  const connected = provider.status === "connected";
  const reauth = provider.status === "reauth_required";
  const comingSoon = provider.status === "coming_soon";
  const account = provider.connection?.account;
  return <article className={`cn-card ${comingSoon ? "is-soon" : ""} ${connected ? "is-connected" : ""}`}>
    <div className="cn-card-top">
      <ProviderMark id={provider.id}/>
      <div className="cn-card-title"><h3>{provider.name}</h3><span>{provider.vendor} · {provider.category}</span>{comingSoon && <ConnectionStatusPill status={provider.status}/>}</div>
      {!comingSoon && <ConnectionStatusPill status={provider.status}/>}
    </div>
    <p className="cn-card-desc">{provider.description}</p>
    {account && (connected || reauth) && <div className="cn-card-account"><Briefcase size={13}/><span><b>{account.name || "EMS administrator"}</b>{account.email && <small>{account.email}</small>}</span></div>}
    {reauth && provider.connection?.lastError && <div className="cn-alert cn-alert-bad cn-alert-compact"><CircleAlert size={14}/><span>{provider.connection.lastError}</span></div>}
    {!comingSoon && provider.capabilities.length > 0 && <ul className="cn-chips">{provider.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>}
    <div className="cn-card-actions">
      {comingSoon ? <span className="cn-muted">We're working on it.</span>
        : connected ? <><button className="cn-primary-button" onClick={onManage}>Manage <ArrowRight size={14}/></button><button className="cn-button" onClick={onDisconnect}>Disconnect</button></>
          : reauth ? <><button className="cn-primary-button" onClick={onConnect} disabled={!provider.enabled}><RefreshCw size={14}/> Reconnect EMS</button><button className="cn-button" onClick={onManage}>View</button><button className="cn-link-button" onClick={onDisconnect}>Disconnect</button></>
            : <button className="cn-primary-button" onClick={onConnect} disabled={!provider.enabled || demo}><Plug size={14}/> Connect</button>}
      {!comingSoon && !connected && !reauth && !provider.enabled && !demo && <span className="cn-muted">Currently unavailable — turned off by the Persora administrator.</span>}
      {!comingSoon && reauth && !provider.enabled && <span className="cn-muted">Reconnecting is unavailable right now.</span>}
    </div>
  </article>;
}

export default function ConnectionsView({ user, notify, canUpload, onUpgrade, onVaultItemsChanged }: { user: AppUser; notify: Notify; canUpload: boolean; onUpgrade?: () => void; onVaultItemsChanged?: () => void }) {
  const demo = Boolean(user.demo) || !connectionsAvailable;
  const [providers, setProviders] = useState<ConnectionProvider[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [connectFor, setConnectFor] = useState<{ id: string; reconnect: boolean; email: string } | null>(null);
  const [disconnectFor, setDisconnectFor] = useState<ConnectionProvider | null>(null);

  const refresh = useCallback(async () => {
    if (demo) { setProviders(OFFLINE_PROVIDERS); return; }
    try { setError(""); setProviders(await loadConnections()); }
    catch (err) { setError(err instanceof Error ? err.message : "Connections couldn't be loaded."); setProviders((current) => current || []); }
  }, [demo]);
  useEffect(() => { void refresh(); }, [refresh]);

  const disconnect = async () => {
    try {
      const result = await disconnectEms();
      notify(result.remoteRevoked ? "EMS disconnected." : "EMS disconnected from Persora.");
      setDisconnectFor(null); setActive(null);
      await refresh();
    } catch (err) { notify(err instanceof Error ? err.message : "EMS couldn't be disconnected.", "error"); }
  };

  if (active === "ems") {
    return <EmsConnectionView canUpload={canUpload} notify={notify} onUpgrade={onUpgrade} onVaultItemsChanged={onVaultItemsChanged}
      onBack={() => { setActive(null); void refresh(); }}
      onDisconnected={() => { setActive(null); void refresh(); }}/>;
  }

  const live = (providers || []).filter((p) => p.status !== "coming_soon");
  const soon = (providers || []).filter((p) => p.status === "coming_soon");
  return <div className="cn-view">
    <section className="cn-hero">
      <span className="cn-hero-icon"><Plug size={20}/></span>
      <div><h2>Your connected services</h2><p>Link the services you already use. Persora only reads what you allow, keeps saved copies private in your vault, and you can disconnect at any time.</p></div>
    </section>
    {demo && <div className="cn-alert cn-alert-info"><CircleAlert size={15}/><span>Connections are available in your Persora cloud account. They aren't active in the local demo.</span></div>}
    {error && <div className="cn-alert cn-alert-bad" role="alert"><CircleAlert size={15}/><span>{error}</span><button className="cn-link-button" onClick={() => void refresh()}>Try again</button></div>}
    {!providers ? <div className="cn-grid">{[0, 1].map((i) => <div className="cn-card cn-skeleton" key={i}><i/><i/><i/></div>)}</div> : <>
      {live.length > 0 && <div className="cn-grid">{live.map((p) => <ProviderCard key={p.id} provider={p} demo={demo}
        onConnect={() => setConnectFor({ id: p.id, reconnect: p.status === "reauth_required", email: p.connection?.account.email || "" })}
        onManage={() => setActive(p.id)} onDisconnect={() => setDisconnectFor(p)}/>)}</div>}
      {soon.length > 0 && <><div className="cn-section-label">Coming soon</div><div className="cn-grid cn-grid-soon">{soon.map((p) => <ProviderCard key={p.id} provider={p} demo={demo} onConnect={() => undefined} onManage={() => undefined} onDisconnect={() => undefined}/>)}</div></>}
    </>}
    <p className="cn-footnote"><ShieldCheck size={13}/> Connections run between Persora's servers and the service. Access tokens are encrypted and never reach your browser.</p>
    {connectFor && <EmsConnectDialog reconnect={connectFor.reconnect} defaultEmail={connectFor.email} onClose={() => setConnectFor(null)} onConnected={() => { setConnectFor(null); notify(connectFor.reconnect ? "EMS reconnected." : "EMS connected."); void refresh(); setActive("ems"); }}/>}
    {disconnectFor && <ConfirmDisconnectDialog name={disconnectFor.name} onCancel={() => setDisconnectFor(null)} onConfirm={disconnect}/>}
  </div>;
}

/** Shown in the local demo where the cloud API isn't running. */
const OFFLINE_PROVIDERS: ConnectionProvider[] = [
  { id: "ems", name: "EMS", vendor: "Dexter Studio", category: "Business", available: true, enabled: false, status: "unavailable", connection: null,
    description: "Browse your EMS shops' Vaultium files, download them, and save private copies to Persora.", capabilities: ["View Vaultium files", "Download", "Save copies to Persora"] },
  ...([["google-drive", "Google Drive", "Google", "Storage", "Bring files from your Drive into Persora."], ["google-photos", "Google Photos", "Google", "Photos", "Save selected photos to your private vault."], ["notion", "Notion", "Notion Labs", "Notes", "Link pages and notes from your workspace."]] as const)
    .map(([id, name, vendor, category, description]) => ({ id, name, vendor, category, description, available: false, enabled: false, status: "coming_soon" as const, connection: null, capabilities: [] })),
];

