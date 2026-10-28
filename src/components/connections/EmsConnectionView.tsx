import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, Download, Eye, FileText, FolderInput, LockKeyhole, RefreshCw, Search, ShieldCheck, Store, UserRound, Wallet } from "lucide-react";
import ItemModalShell from "../ItemModalShell";
import ModalPortal from "../ModalPortal";
import ImagePreview from "../ImagePreview";
import PdfPreview from "../PdfPreview";
import { humanSize } from "../../lib/utils";
import { disconnectEms, fetchEmsFile, loadEmsFiles, loadEmsOverview, saveEmsFileCopy, type EmsFile, type EmsOverview, type EmsShop } from "../../lib/connections-api";
import { ConfirmDisconnectDialog, ConnectionStatusPill, EmsConnectDialog, ProviderLogo } from "./ConnectionParts";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/reui/badge";
import { FileType, getFileType } from "@/components/reui/file-type";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";
import "./connections.css";

type Notify = (message: string, kind?: "success" | "error") => void;
type Scope = { kind: "admin" } | { kind: "shop"; shop: EmsShop };
const PAGE = 50;
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "application/pdf", "text/plain"]);

function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function fileIcon(file: EmsFile) {
  return <FileType type={getFileType(file.name || file.type)} size="sm" variant="light" aria-hidden/>;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.rel = "noopener";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function FilePreviewDialog({ file, canUpload, saving, onClose, onDownload, onSave }: { file: EmsFile; canUpload: boolean; saving: boolean; onClose: () => void; onDownload: () => void; onSave: () => void }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; url?: string; text?: string; message?: string }>({ status: "loading" });
  useEffect(() => {
    let url = ""; let cancelled = false;
    fetchEmsFile(file.id, true).then(async (blob) => {
      if (cancelled) return;
      if (file.type === "text/plain") { const text = await blob.slice(0, 200_000).text(); if (!cancelled) setState({ status: "ready", text }); return; }
      url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: file.type }));
      setState({ status: "ready", url });
    }).catch((err) => { if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "This file couldn't be opened." }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file.id, file.type]);
  return <ModalPortal><ItemModalShell labelledBy="cn-preview-title" className="cn-dialog cn-preview-dialog" icon={fileIcon(file)} iconClassName="cn-dialog-icon" eyebrow={`EMS Vaultium${file.reference ? ` · ${file.reference}` : ""}`} title={<span id="cn-preview-title">{file.name}</span>} onClose={onClose}>
    <div className="cn-preview-stage">
      {state.status === "loading" ? <div className="cn-preview-message"><Spinner className="size-6 text-primary"/><b>Opening file from EMS…</b></div>
        : state.status === "error" ? <div className="cn-preview-message"><CircleAlert size={22}/><b>{state.message}</b></div>
          : state.text !== undefined ? <pre className="cn-preview-text">{state.text}</pre>
            : file.type === "application/pdf" && state.url ? <PdfPreview src={state.url} name={file.name}/>
              : state.url ? <ImagePreview src={state.url} name={file.name}/> : null}
    </div>
    <div className="cn-dialog-actions cn-preview-actions">
      <span className="cn-muted">{humanSize(file.size)} · {formatWhen(file.createdAt)} · read-only original</span>
      <button className="cn-button" onClick={onDownload}><Download size={14}/> Download</button>
      <button className="cn-primary-button" onClick={onSave} disabled={saving} title={canUpload ? undefined : "Saving copies requires an active paid plan"}><FolderInput size={14}/> {saving ? "Saving…" : "Save copy to Persora"}</button>
    </div>
  </ItemModalShell></ModalPortal>;
}

export default function EmsConnectionView({ canUpload, notify, onUpgrade, onVaultItemsChanged, onBack, onDisconnected }: { canUpload: boolean; notify: Notify; onUpgrade?: () => void; onVaultItemsChanged?: () => void; onBack: () => void; onDisconnected: () => void }) {
  const [overview, setOverview] = useState<EmsOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: "admin" });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [files, setFiles] = useState<EmsFile[]>([]);
  const [filesState, setFilesState] = useState<{ loading: boolean; error: string; code: string; hasMore: boolean; total: number }>({ loading: false, error: "", code: "", hasMore: false, total: 0 });
  const [preview, setPreview] = useState<EmsFile | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const browserRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);

  const loadOverview = useCallback(async () => {
    setRefreshing(true);
    try { setLoadError(""); setOverview(await loadEmsOverview()); }
    catch (err) { setLoadError(err instanceof Error ? err.message : "EMS details couldn't be loaded."); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(query.trim()), 300); return () => window.clearTimeout(t); }, [query]);

  const status = overview?.status || "not_connected";
  const usable = status === "connected" && overview?.integrationReady !== false;
  const storeId = scope.kind === "shop" ? scope.shop.id : "";

  const loadFiles = useCallback(async (offset = 0) => {
    const ticket = ++requestRef.current;
    setFilesState((s) => ({ ...s, loading: true, error: "", code: "" }));
    try {
      const page = await loadEmsFiles({ storeId: storeId || undefined, q: debounced || undefined, offset, limit: PAGE });
      if (ticket !== requestRef.current) return;
      setFiles((current) => (offset ? [...current, ...page.files] : page.files));
      setFilesState({ loading: false, error: "", code: "", hasMore: page.hasMore, total: page.total });
    } catch (err) {
      if (ticket !== requestRef.current) return;
      const code = (err as { code?: string }).code || "";
      setFilesState({ loading: false, error: err instanceof Error ? err.message : "Files couldn't be loaded.", code, hasMore: false, total: 0 });
      if (code === "reauth_required") void loadOverview();
    }
  }, [storeId, debounced, loadOverview]);
  useEffect(() => { if (usable) void loadFiles(0); else setFiles([]); }, [usable, loadFiles]);

  const shops = overview?.account?.stores || [];
  const admin = overview?.account?.admin || overview?.connection?.account;
  const eligibility = overview?.account?.eligibility;
  const scopeTitle = scope.kind === "admin" ? "All shops" : scope.shop.name;
  const shopName = useMemo(() => new Map(shops.map((s) => [s.id, s.name])), [shops]);

  const choose = (next: Scope) => {
    setScope(next); setQuery(""); setDebounced("");
    window.setTimeout(() => browserRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const download = async (file: EmsFile) => {
    setBusyFile(`dl:${file.id}`);
    try { saveBlob(await fetchEmsFile(file.id), file.name); }
    catch (err) { notify(err instanceof Error ? err.message : "Download failed.", "error"); }
    finally { setBusyFile(null); }
  };
  const saveCopy = async (file: EmsFile) => {
    if (!canUpload) { notify("Saving copies to Persora requires an active paid plan.", "error"); onUpgrade?.(); return; }
    setBusyFile(`save:${file.id}`);
    try {
      const result = await saveEmsFileCopy(file.id);
      notify(`Saved a copy to Documents › ${result.item.folderName}.`);
      onVaultItemsChanged?.();
    } catch (err) { notify(err instanceof Error ? err.message : "The copy couldn't be saved.", "error"); }
    finally { setBusyFile(null); }
  };
  const disconnect = async () => {
    try { await disconnectEms(); notify("EMS disconnected."); setConfirmDisconnect(false); onDisconnected(); }
    catch (err) { notify(err instanceof Error ? err.message : "EMS couldn't be disconnected.", "error"); }
  };

  const connection = overview?.connection;
  const shopStatus = (value: string) => (value && value !== "active" ? value.replace(/_/g, " ") : "");
  return <div className="cn-view cn-ems">
    <nav className="cn-crumbs" aria-label="Breadcrumb"><button className="cn-back" onClick={onBack}><ArrowLeft size={14}/> Connections</button><span aria-hidden="true">/</span><span aria-current="page">EMS</span></nav>

    <header className="cn-page-head cn-ems-head">
      <ProviderLogo id="ems" name="EMS" size="lg"/>
      <div className="cn-ems-title">
        <div className="cn-account-title"><h2>EMS</h2>{overview && <ConnectionStatusPill status={status} degraded={Boolean(overview.degraded)}/>}</div>
        <p>Dexter Studio business management · read-only access to your shops' Vaultium files.</p>
      </div>
      <div className="cn-account-actions">
        <button className="cn-button cn-button-small" onClick={() => void loadOverview()} disabled={refreshing}><RefreshCw size={13} className={refreshing ? "cn-spin" : ""}/> Refresh</button>
        {connection && <button className="cn-button cn-button-small cn-button-danger-text" onClick={() => setConfirmDisconnect(true)}>Disconnect</button>}
      </div>
    </header>

    {loadError && <div className="cn-alert cn-alert-bad" role="alert"><CircleAlert size={15}/><span>{loadError}</span><button className="cn-link-button" onClick={() => void loadOverview()}>Try again</button></div>}
    {status === "reauth_required" && <div className="cn-alert cn-alert-bad cn-alert-action" role="alert"><CircleAlert size={16}/><span><b>Your EMS connection needs attention.</b> {connection?.lastError || "It expired or was revoked in EMS."} Sign in again to keep browsing your files.</span><button className="cn-primary-button" onClick={() => setReconnecting(true)} disabled={overview?.integrationReady === false}><RefreshCw size={14}/> Reconnect EMS</button></div>}
    {overview?.degraded && status === "connected" && <div className="cn-alert cn-alert-warn"><CircleAlert size={15}/><span>{overview.notice || "EMS is temporarily unavailable."} Your connection is kept; showing the last known shops.</span></div>}
    {overview && status === "not_connected" && <div className="cn-alert cn-alert-info cn-alert-action"><Store size={16}/><span>EMS isn't connected to this Persora account.</span><button className="cn-primary-button" onClick={() => setReconnecting(true)} disabled={!overview.integrationReady}>Connect EMS</button></div>}

    {(admin || connection) && <section className="cn-section" aria-labelledby="cn-ems-account">
      <div className="cn-section-head"><h3 id="cn-ems-account">Administrator account</h3></div>
      <dl className="cn-facts">
        <div><dt>Administrator</dt><dd>{admin?.name || "EMS administrator"}</dd></div>
        <div><dt>Email</dt><dd>{admin?.email || "—"}</dd></div>
        <div><dt>Admin ID</dt><dd>{admin?.code ? <span className="cn-code">{admin.code}</span> : "—"}</dd></div>
        <div><dt>Vaultium</dt><dd>{eligibility?.eligible ? <span className="cn-verified"><ShieldCheck size={12}/> Verified{eligibility.vaultium_active === false ? " · purchased previously" : ""}</span> : eligibility ? "Not eligible" : "—"}</dd></div>
        <div><dt>Connected</dt><dd>{formatWhen(connection?.connectedAt)}</dd></div>
        <div><dt>Last synced</dt><dd>{formatWhen(connection?.lastSyncedAt)}</dd></div>
      </dl>
    </section>}

    {(shops.length > 0 || usable) && <section className="cn-section" aria-labelledby="cn-ems-shops">
      <div className="cn-section-head"><h3 id="cn-ems-shops">Accounts &amp; shops</h3><span className="cn-muted">Choose where to browse Vaultium files.</span></div>
      <ul className="cn-rows cn-scope-rows">
        <li><button className={`cn-row cn-scope-row ${scope.kind === "admin" ? "is-active" : ""}`} onClick={() => choose({ kind: "admin" })} disabled={!usable} aria-pressed={scope.kind === "admin"}>
          <IconTile variant="soft" size="sm" className="text-blue-600 dark:text-blue-300"><UserRound size={17}/></IconTile>
          <span className="cn-row-copy"><span className="cn-row-title"><b>{admin?.name || "Administrator"}</b></span><p>Admin · all shops</p></span>
          <span className="cn-scope-count">{overview?.account?.totalFiles ?? "—"}<small>files</small></span>
        </button></li>
        {shops.map((shop) => { const selected = scope.kind === "shop" && scope.shop.id === shop.id; const inactive = shopStatus(shop.status); return <li key={shop.id}><button className={`cn-row cn-scope-row ${selected ? "is-active" : ""}`} onClick={() => choose({ kind: "shop", shop })} disabled={!usable} aria-pressed={selected}>
          <IconTile variant="soft" size="sm" className="text-slate-600 dark:text-slate-300"><Store size={17}/></IconTile>
          <span className="cn-row-copy"><span className="cn-row-title"><b>{shop.name}</b>{inactive ? <Badge variant="secondary" size="xs" radius="full" className="cn-pill cn-pill-muted capitalize"><i aria-hidden="true"/>{inactive}</Badge> : <Badge variant="success-light" size="xs" radius="full" className="cn-pill cn-pill-good"><i aria-hidden="true"/>Active</Badge>}</span><p>{[shop.code, shop.type].filter(Boolean).join(" · ") || "Shop"}</p></span>
          <span className="cn-scope-count">{shop.fileCount ?? "—"}<small>files</small></span>
        </button></li>; })}
      </ul>
    </section>}

    {usable && <section className="cn-section cn-browser" ref={browserRef} aria-labelledby="cn-ems-files">
      <div className="cn-section-head cn-browser-head">
        <div><h3 id="cn-ems-files"><Wallet size={15}/> Vaultium files <span className="cn-browser-scope">· {scopeTitle}</span></h3></div>
        <span className="cn-readonly" title="Originals in EMS can't be changed from Persora"><LockKeyhole size={12}/> Read-only originals</span>
        <label className="cn-search"><Search size={15}/><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search file, invoice or expense…" aria-label="Search Vaultium files" maxLength={120}/></label>
      </div>
      <div className="cn-browser-body">
      {filesState.error ? <div className="cn-alert cn-alert-bad"><CircleAlert size={15}/><span>{filesState.error}</span>{filesState.code !== "reauth_required" && <button className="cn-link-button" onClick={() => void loadFiles(0)}>Try again</button>}</div>
        : !files.length && filesState.loading ? <div className="cn-file-list">{[0, 1, 2, 3].map((i) => <div className="cn-file-row cn-skeleton" key={i}><i/><i/></div>)}</div>
          : !files.length ? <div className="cn-empty"><FileText size={22}/><b>{debounced ? "No files match your search." : "No Vaultium files here yet."}</b><span>{debounced ? "Try a different file name, invoice or expense number." : "Files uploaded to Vaultium in EMS appear here."}</span></div>
            : <ul className="cn-file-list">{files.map((file) => <li key={file.id} className="cn-file-row">
              <Attachment size="sm" className="w-full justify-between border-0 bg-transparent px-0">
                <AttachmentMedia>{fileIcon(file)}</AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                  <AttachmentDescription>{[file.reference, scope.kind === "admin" ? shopName.get(file.storeId) : "", humanSize(file.size), formatWhen(file.createdAt)].filter(Boolean).join(" · ")}</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  {PREVIEWABLE.has(file.type) && <AttachmentAction type="button" onClick={() => setPreview(file)} aria-label={`View ${file.name}`} title="View"><Eye className="size-4"/></AttachmentAction>}
                  <AttachmentAction type="button" onClick={() => void download(file)} disabled={busyFile === `dl:${file.id}`} aria-label={`Download ${file.name}`} title="Download"><Download className="size-4"/></AttachmentAction>
                  <button type="button" className="cn-button cn-button-small ml-1.5" onClick={() => void saveCopy(file)} disabled={busyFile === `save:${file.id}`} title={canUpload ? "Save an independent copy to your Persora Documents" : "Requires an active paid plan"}><FolderInput size={14}/><span>{busyFile === `save:${file.id}` ? "Saving…" : "Save copy"}</span></button>
                </AttachmentActions>
              </Attachment>
            </li>)}</ul>}
      </div>
      {files.length > 0 && <footer className="cn-browser-foot"><span className="cn-muted">Showing {files.length} of {filesState.total} · copies you save belong to your Persora account</span>{filesState.hasMore && <button className="cn-button cn-button-small" onClick={() => void loadFiles(files.length)} disabled={filesState.loading}>{filesState.loading ? "Loading…" : "Load more"}</button>}</footer>}
    </section>}

    {preview && <FilePreviewDialog file={preview} canUpload={canUpload} saving={busyFile === `save:${preview.id}`} onClose={() => setPreview(null)} onDownload={() => void download(preview)} onSave={() => void saveCopy(preview)}/>}
    {reconnecting && <EmsConnectDialog reconnect={status !== "not_connected"} defaultEmail={overview?.connection?.account.email || ""} onClose={() => setReconnecting(false)} onConnected={() => { setReconnecting(false); notify("EMS reconnected."); void loadOverview(); }}/>}
    {confirmDisconnect && <ConfirmDisconnectDialog name="EMS" onCancel={() => setConfirmDisconnect(false)} onConfirm={disconnect}/>}
  </div>;
}
