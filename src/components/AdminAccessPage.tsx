import { useState, type FormEvent } from "react";
import "../admin-portal.css";
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import type { AppUser } from "../types";
import type { AuthMode } from "./AuthDialog";
import { claimFirstAdmin } from "../lib/cloud";

interface BootstrapStatus { initialized: boolean | null; enabled: boolean }
interface AdminAccessPageProps {
  user: AppUser | null;
  status: BootstrapStatus;
  backendConnected: boolean;
  pagesApiConnected: boolean;
  onOpenAuth: (mode: AuthMode) => void;
  onBootstrapComplete: () => Promise<void>;
  onBack: () => void;
  onSignOut: () => void;
}

export default function AdminAccessPage({ user, status, backendConnected, pagesApiConnected, onOpenAuth, onBootstrapComplete, onBack, onSignOut }: AdminAccessPageProps) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const initialize = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pagesApiConnected) return;
    setBusy(true);
    setError("");
    try {
      await claimFirstAdmin(secret);
      setSecret("");
      setDone(true);
      await onBootstrapComplete();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Administrator initialization failed."); }
    finally { setBusy(false); }
  };

  const canInitialize = status.enabled && status.initialized === false && pagesApiConnected;
  const setupUnavailable = status.initialized === null || !pagesApiConnected;

  return <div className="admin-access-page">
    <header className="admin-access-header"><a className="admin-access-brand" href="/"><span className="brand-mark"><ShieldCheck size={18} /></span><b>persora</b></a><span className="admin-access-lock"><LockKeyhole size={14} /> Protected administrator area</span></header>
    <main className="admin-access-main"><div className="admin-access-orbit orbit-one"/><div className="admin-access-orbit orbit-two"/>
      <section className="admin-access-card">
        <div className="admin-access-emblem"><ShieldCheck size={26} /></div>
        <span className="admin-eyebrow">PERSORA · ADMIN</span>
        {!user ? <>
          <h1>Administrator sign in</h1>
          <p className="admin-access-intro">This area is restricted to verified Persora administrators. Sign in with your personal account to continue.</p>
          {!backendConnected && <div className="admin-access-alert">The Pages Functions API is not enabled, so administrator sign-in is unavailable.</div>}
          {canInitialize && <div className="admin-access-info"><KeyRound size={16}/><span>First-admin setup is ready. Sign in with the account that should own Persora, then enter the one-time setup code.</span></div>}
          {setupUnavailable && <div className="admin-access-alert">The admin setup service is not connected. Check the Pages Function deployment and encrypted Supabase secrets before continuing.</div>}
          <button className="admin-access-primary" disabled={!backendConnected} onClick={() => onOpenAuth("signin")}>Sign in <ArrowRight size={16}/></button>
          <button className="admin-access-secondary" disabled={!backendConnected} onClick={() => onOpenAuth("signup")}>Create the owner account</button>
          <button className="admin-access-back" onClick={onBack}><ArrowLeft size={14}/> Back to Persora</button>
        </> : user.role === "admin" ? <>
          <h1>Access verified</h1>
          <p className="admin-access-intro">You are signed in as <b>{user.email}</b>. The admin console is ready.</p>
          <button className="admin-access-primary" onClick={onBack}>Open administrator console <ArrowRight size={16}/></button>
        </> : canInitialize ? <>
          <h1>Initialize first admin</h1>
          <p className="admin-access-intro">Signed in as <b>{user.email}</b>. If this is the owner account, enter the one-time setup code configured as an encrypted Cloudflare Pages secret.</p>
          <form className="admin-bootstrap-form" onSubmit={(event) => void initialize(event)}>
            <label>One-time setup code<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" minLength={32} maxLength={256} required placeholder="Paste the generated secret" /></label>
            {error && <div className="admin-access-alert" role="alert">{error}</div>}
            {done && <div className="admin-access-info"><ShieldCheck size={16}/><span>Administrator initialized. The setup latch is closed; remove the bootstrap secret from Cloudflare Pages settings.</span></div>}
            <button className="admin-access-primary" disabled={busy || secret.length < 32}>{busy ? "Verifying…" : "Initialize administrator"}<ArrowRight size={16}/></button>
          </form>
          <div className="admin-bootstrap-note"><LockKeyhole size={13}/>This code is checked only by the server-side Pages Function and is never saved to the database.</div>
          <button className="admin-access-back" onClick={onSignOut}><ArrowLeft size={14}/> Sign out</button>
        </> : <>
          <h1>Administrator access required</h1>
          <p className="admin-access-intro">The account <b>{user.email}</b> is not an administrator. If you are the first owner, check that the one-time setup is enabled; otherwise sign out and use an authorized admin account.</p>
          {setupUnavailable && <div className="admin-access-alert">First-admin setup is unavailable. Check the Pages Function deployment and encrypted secret configuration.</div>}
          <button className="admin-access-primary" onClick={onSignOut}>Sign out <ArrowRight size={16}/></button>
          <button className="admin-access-back" onClick={onBack}><ArrowLeft size={14}/> Back to Persora</button>
        </>}
      </section>
    </main>
    <footer className="admin-access-footer"><span>Private by architecture</span><span>Persora custom auth · Cloudflare Pages Functions</span></footer>
  </div>;
}
