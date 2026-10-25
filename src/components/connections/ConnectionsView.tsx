import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, CircleAlert, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type { AppUser } from "../../types";
import { connectionsAvailable, disconnectEms, loadConnections, type ConnectionProvider } from "../../lib/connections-api";
import { ConfirmDisconnectDialog, ConnectionStatusPill, EmsConnectDialog, ProviderLogo } from "./ConnectionParts";
import EmsConnectionView from "./EmsConnectionView";
import "./connections.css";

type Notify = (message: string, kind?: "success" | "error") => void;
type Tab = "browse" | "connected" | "manage";
type TypeFilter = "all" | "dexter" | "third-party";
const FIRST_PARTY_VENDOR = "Dexter Studio";
const TABS: { id: Tab; label: string }[] = [{ id: "browse", label: "Browse connections" }, { id: "connected", label: "Connected" }, { id: "manage", label: "Manage" }];

const hasConnection = (p: ConnectionProvider) => p.status === "connected" || p.status === "reauth_required";
function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

type RowHandlers = { demo: boolean; onConnect: (p: ConnectionProvider) => void; onManage: (p: ConnectionProvider) => void };

/** One service row. Only functional providers get an action button; future services just say so. */
function ProviderRow({ provider, demo, onConnect, onManage }: { provider: ConnectionProvider } & RowHandlers) {
  const { status } = provider;
  const comingSoon = status === "coming_soon";
  const account = provider.connection?.account;
  const blocked = !provider.enabled || demo;
  const blockedReason = demo ? "Available in your Persora cloud account" : "Turned off by the Persora administrator";
  let action;
  if (comingSoon) action = <span className="cn-row-note">Coming soon</span>;
  else if (status === "connected") action = <button className="cn-button cn-button-small" onClick={() => onManage(provider)}>Manage</button>;
  else if (status === "reauth_required") action = <button className="cn-button cn-button-small cn-button-attention" onClick={() => onConnect(provider)} disabled={!provider.enabled} title={provider.enabled ? undefined : blockedReason}><RefreshCw size={13}/> Reconnect</button>;
  else if (blocked) action = <span className="cn-row-note" title={blockedReason}>Unavailable</span>;
  else action = <button className="cn-button cn-button-small" onClick={() => onConnect(provider)}>Connect</button>;
  return <li className={`cn-row ${comingSoon ? "is-soon" : ""}`}>
    <ProviderLogo id={provider.id} name={provider.name}/>
    <div className="cn-row-copy">
      <div className="cn-row-title"><b>{provider.name}</b>{!comingSoon && status !== "not_connected" && status !== "revoked" && <ConnectionStatusPill status={status}/>}</div>
      <p>{hasConnection(provider) && account ? <>{account.name || "Signed in"}{account.email && <> · {account.email}</>}</> : provider.description}</p>
      {status === "reauth_required" && provider.connection?.lastError && <p className="cn-row-error"><CircleAlert size={12}/> {provider.connection.lastError}</p>}
    </div>
    <div className="cn-row-action">{action}</div>
  </li>;
}

function AddConnectionMenu({ providers, demo, onConnect, onManage }: { providers: ConnectionProvider[] } & RowHandlers) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const available = providers.filter((p) => p.available && p.status !== "coming_soon");
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); wrapRef.current?.querySelector<HTMLButtonElement>(".cn-add-trigger")?.focus(); } };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    window.setTimeout(() => wrapRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus(), 0);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(wrapRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") || [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  return <div className="cn-add" ref={wrapRef}>
    <button className="cn-primary-button cn-add-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((v) => !v)}><Plus size={15}/> Add connection <ChevronDown size={14}/></button>
    {open && <div className="cn-menu" role="menu" id={menuId} aria-label="Add connection" onKeyDown={moveFocus}>
      <div className="cn-menu-label">Available now</div>
      {available.map((p) => {
        const linked = hasConnection(p);
        const disabled = !linked && (!p.enabled || demo);
        return <button key={p.id} role="menuitem" className="cn-menu-item" disabled={disabled} onClick={() => { setOpen(false); if (p.status === "connected") onManage(p); else onConnect(p); }}>
          <ProviderLogo id={p.id} name={p.name} size="sm"/>
          <span className="cn-menu-copy"><b>{p.name}</b><small>{p.status === "connected" ? "Connected · open" : p.status === "reauth_required" ? "Reconnect needed" : disabled ? (demo ? "Not available in the demo" : "Currently unavailable") : p.vendor}</small></span>
        </button>;
      })}
      <div className="cn-menu-foot">More services coming soon</div>
    </div>}
  </div>;
}

function ManageList({ providers, demo, onConnect, onManage, onDisconnect }: { providers: ConnectionProvider[]; onDisconnect: (p: ConnectionProvider) => void } & RowHandlers) {
  return <div className="cn-table" role="table" aria-label="Connected accounts">
    <div className="cn-table-head" role="row"><span role="columnheader">Service</span><span role="columnheader">Account</span><span role="columnheader">Connected</span><span role="columnheader">Last synced</span><span role="columnheader">Status</span><span role="columnheader"><span className="cn-sr-only">Actions</span></span></div>
    {providers.map((p) => {
      const c = p.connection;
      return <div className="cn-table-row" role="row" key={p.id}>
        <span role="cell" className="cn-table-service"><ProviderLogo id={p.id} name={p.name} size="sm"/><b>{p.name}</b></span>
        <span role="cell" className="cn-table-account"><b>{c?.account.name || "—"}</b>{c?.account.email && <small>{c.account.email}</small>}</span>
        <span role="cell" data-label="Connected">{formatWhen(c?.connectedAt)}</span>
        <span role="cell" data-label="Last synced">{formatWhen(c?.lastSyncedAt)}</span>
        <span role="cell"><ConnectionStatusPill status={p.status}/></span>
        <span role="cell" className="cn-table-actions">
          {p.status === "reauth_required" && <button className="cn-button cn-button-small cn-button-attention" onClick={() => onConnect(p)} disabled={!p.enabled || demo}><RefreshCw size={13}/> Reconnect</button>}
          <button className="cn-button cn-button-small" onClick={() => onManage(p)}>{p.status === "connected" ? "Manage" : "View"}</button>
          <button className="cn-button cn-button-small cn-button-danger-text" onClick={() => onDisconnect(p)}>Disconnect</button>
        </span>
      </div>;
    })}
  </div>;
}

export default function ConnectionsView({ user, notify, canUpload, onUpgrade, onVaultItemsChanged }: { user: AppUser; notify: Notify; canUpload: boolean; onUpgrade?: () => void; onVaultItemsChanged?: () => void }) {
  const demo = Boolean(user.demo) || !connectionsAvailable;
  const [providers, setProviders] = useState<ConnectionProvider[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [connectFor, setConnectFor] = useState<{ id: string; reconnect: boolean; email: string } | null>(null);
  const [disconnectFor, setDisconnectFor] = useState<ConnectionProvider | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);

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

  const all = useMemo(() => providers || [], [providers]);
  const connected = all.filter(hasConnection);
  const categories = useMemo(() => [...new Set(all.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((p) => (category === "all" || p.category === category)
      && (type === "all" || (type === "dexter") === (p.vendor === FIRST_PARTY_VENDOR))
      && (!q || [p.name, p.vendor, p.description, p.category].some((v) => v.toLowerCase().includes(q))))
      // Working integrations first, then alphabetical — stable and predictable.
      .sort((a, b) => Number(a.status === "coming_soon") - Number(b.status === "coming_soon") || a.name.localeCompare(b.name));
  }, [all, query, category, type]);
  const filtering = Boolean(query.trim()) || category !== "all" || type !== "all";
  const clearFilters = () => { setQuery(""); setCategory("all"); setType("all"); };

  const handlers: RowHandlers = {
    demo,
    onConnect: (p) => setConnectFor({ id: p.id, reconnect: p.status === "reauth_required", email: p.connection?.account.email || "" }),
    onManage: (p) => setActive(p.id),
  };
  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  if (active === "ems") {
    return <EmsConnectionView canUpload={canUpload} notify={notify} onUpgrade={onUpgrade} onVaultItemsChanged={onVaultItemsChanged}
      onBack={() => { setActive(null); void refresh(); }}
      onDisconnected={() => { setActive(null); void refresh(); }}/>;
  }

  const listFor = (items: ConnectionProvider[]) => <ul className="cn-rows">{items.map((p) => <ProviderRow key={p.id} provider={p} {...handlers}/>)}</ul>;
  return <div className="cn-view">
    <header className="cn-page-head">
      <h2>Connections</h2>
      <p>Link the services you already use. Persora only reads what you allow, keeps saved copies private in your vault, and you can disconnect at any time.</p>
    </header>

    <div className="cn-tabs" role="tablist" aria-label="Connections" ref={tabsRef} onKeyDown={onTabKey}>
      {TABS.map((t) => <button key={t.id} role="tab" id={`cn-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`cn-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} className={`cn-tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}>
        {t.label}{t.id === "connected" && <span className="cn-count" aria-label={`${connected.length} connected`}>{connected.length}</span>}
      </button>)}
    </div>

    {demo && <div className="cn-alert cn-alert-info"><CircleAlert size={15}/><span>Connections are available in your Persora cloud account. They aren't active in the local demo.</span></div>}
    {error && <div className="cn-alert cn-alert-bad" role="alert"><CircleAlert size={15}/><span>{error}</span><button className="cn-link-button" onClick={() => void refresh()}>Try again</button></div>}

    <section className="cn-panel" role="tabpanel" id={`cn-panel-${tab}`} aria-labelledby={`cn-tab-${tab}`}>
      {tab === "browse" && <>
        <div className="cn-toolbar">
          <label className="cn-search"><Search size={15}/><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connections" aria-label="Search connections" maxLength={80}/>{query && <button className="cn-search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={13}/></button>}</label>
          <label className="cn-select"><span className="cn-sr-only">Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category"><option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></label>
          <label className="cn-select"><span className="cn-sr-only">Type</span><select value={type} onChange={(e) => setType(e.target.value as TypeFilter)} aria-label="Filter by type"><option value="all">All types</option><option value="dexter">Dexter Studio apps</option><option value="third-party">Third-party</option></select><ChevronDown size={14} aria-hidden="true"/></label>
          <span className="cn-toolbar-spacer"/>
          {providers && <AddConnectionMenu providers={all} {...handlers}/>}
        </div>
        {!providers ? <ul className="cn-rows">{[0, 1, 2, 3].map((i) => <li className="cn-row cn-skeleton" key={i}><i/><i/></li>)}</ul>
          : filtered.length ? listFor(filtered)
            : <div className="cn-empty"><Search size={20}/><b>No connections match {query.trim() ? `“${query.trim()}”` : "these filters"}.</b><button className="cn-link-button" onClick={clearFilters}>Clear filters</button></div>}
        {providers && filtering && filtered.length > 0 && <p className="cn-result-count">{filtered.length} of {all.length} services · <button className="cn-link-button" onClick={clearFilters}>Clear filters</button></p>}
      </>}

      {tab === "connected" && (!providers ? <ul className="cn-rows">{[0, 1].map((i) => <li className="cn-row cn-skeleton" key={i}><i/><i/></li>)}</ul>
        : connected.length ? listFor(connected)
          : <div className="cn-empty"><b>No services connected yet.</b><span>Connect EMS to browse your shops' Vaultium files from Persora.</span><button className="cn-button cn-button-small" onClick={() => setTab("browse")}>Browse connections</button></div>)}

      {tab === "manage" && (!providers ? <ul className="cn-rows">{[0].map((i) => <li className="cn-row cn-skeleton" key={i}><i/><i/></li>)}</ul>
        : connected.length ? <ManageList providers={connected} {...handlers} onDisconnect={setDisconnectFor}/>
          : <div className="cn-empty"><b>Nothing to manage yet.</b><span>Connected accounts, their status and disconnect options appear here.</span><button className="cn-button cn-button-small" onClick={() => setTab("browse")}>Browse connections</button></div>)}
    </section>

    <p className="cn-footnote"><ShieldCheck size={13}/> Connections run between Persora's servers and the service. Access tokens are encrypted and never reach your browser.</p>
    {connectFor && <EmsConnectDialog reconnect={connectFor.reconnect} defaultEmail={connectFor.email} onClose={() => setConnectFor(null)} onConnected={() => { setConnectFor(null); notify(connectFor.reconnect ? "EMS reconnected." : "EMS connected."); void refresh(); setActive("ems"); }}/>}
    {disconnectFor && <ConfirmDisconnectDialog name={disconnectFor.name} onCancel={() => setDisconnectFor(null)} onConfirm={disconnect}/>}
  </div>;
}

/** Shown in the local demo where the cloud API isn't running. Mirrors CONNECTION_PROVIDERS in cloudflare/connections.js. */
const OFFLINE_PROVIDERS: ConnectionProvider[] = [
  { id: "ems", name: "EMS", vendor: "Dexter Studio", category: "Business", available: true, enabled: false, status: "unavailable", connection: null,
    description: "Browse your EMS shops' Vaultium files, download them, and save private copies to Persora.", capabilities: ["View Vaultium files", "Download", "Save copies to Persora"] },
  ...([
    ["google-drive", "Google Drive", "Google", "Storage", "Bring files from your Drive into Persora."],
    ["google-photos", "Google Photos", "Google", "Photos", "Save selected photos to your private vault."],
    ["google-docs", "Google Docs", "Google", "Documents", "Keep copies of important documents in Persora."],
    ["google-calendar", "Google Calendar", "Google", "Calendar", "See your calendar alongside Persora reminders."],
    ["notion", "Notion", "Notion Labs", "Notes", "Link pages and notes from your workspace."],
    ["microsoft-onedrive", "Microsoft OneDrive", "Microsoft", "Storage", "Keep copies of your OneDrive files in Persora."],
    ["microsoft-outlook", "Microsoft Outlook", "Microsoft", "Calendar", "Bring Outlook calendar events next to your Persora reminders."],
  ] as const).map(([id, name, vendor, category, description]) => ({ id, name, vendor, category, description, available: false, enabled: false, status: "coming_soon" as const, connection: null, capabilities: [] })),
];
