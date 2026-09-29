import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { ShimmerButton } from "./magic-ui";

export type AuthMode = "signin" | "signup";

interface AuthDialogProps {
  initialMode: AuthMode;
  connected: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (mode: AuthMode, values: { fullName: string; email: string; identifier: string; password: string }) => Promise<string | void>;
}

export default function AuthDialog({ initialMode, connected, busy = false, onClose, onSubmit }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const result = await onSubmit(mode, { fullName, email, identifier, password });
      if (typeof result === "string") setMessage(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    }
  };

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setMessage("");
  };

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="icon-button auth-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        <div className="auth-art">
          <div className="auth-art-glow" />
          <div className="auth-brand-mark"><ShieldCheck size={21} strokeWidth={2.2} /></div>
          <div className="auth-art-copy">
            <span className="auth-kicker">A quieter kind of organized</span>
            <h2>Everything important,<br /><em>close at hand.</em></h2>
            <p>One private home for the details that make up your life.</p>
          </div>
          <div className="auth-mini-card">
            <div className="auth-mini-lock"><LockKeyhole size={15} /></div>
            <div><strong>Your vault stays yours</strong><span>Private by default. Always.</span></div>
            <span className="auth-mini-check">✓</span>
          </div>
          <div className="auth-orbit orbit-a" /><div className="auth-orbit orbit-b" />
        </div>
        <div className="auth-panel">
          <div className="auth-panel-top">
            <div className="auth-logo"><span className="brand-mark small"><ShieldCheck size={17} /></span><span>persora</span></div>
            <div className="auth-connected"><span className={`status-dot ${connected ? "is-live" : "is-demo"}`} />{connected ? "Secure sign in" : "Setup required"}</div>
          </div>
          <div className="auth-heading">
            <span className="section-eyebrow">{mode === "signin" ? "Welcome back" : "Start your private space"}</span>
            <h1 id="auth-title">{mode === "signin" ? "Sign in to Persora" : "Create your account"}</h1>
            <p>{mode === "signin" ? "Your personal digital life, right where you left it." : "A little more calm for everything you keep."}</p>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && (
              <label className="field-label">Full name
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} type="text" autoComplete="name" placeholder="e.g. Amina Rahman" maxLength={100} required />
              </label>
            )}
            {mode === "signup" ? <label className="field-label">Email address
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required />
            </label> : <label className="field-label">Email or 7-digit Persora ID
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value.slice(0, 254))} type="text" autoComplete="username" placeholder="you@example.com or 4827613" maxLength={254} required />
            </label>}
            <label className="field-label">Password
              <div className="password-wrap">
                <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signup" ? "At least 12 characters" : "Your password"} minLength={mode === "signup" ? 12 : 1} maxLength={72} required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </label>
            {error && <div className="form-alert error-alert" role="alert">{error}</div>}
            {message && <div className="form-alert success-alert" role="status">{message}</div>}
            <ShimmerButton type="submit" disabled={busy || !connected} className="auth-submit">
              {busy ? <><span className="spinner" /> Working…</> : <>{mode === "signin" ? "Sign in" : "Create account"}<ArrowRight size={17} /></>}
            </ShimmerButton>
          </form>
          <div className="auth-switch">
            {mode === "signin" ? <>New to Persora? <button type="button" onClick={() => changeMode("signup")}>Create an account</button></> : <>Already have an account? <button type="button" onClick={() => changeMode("signin")}>Sign in</button></>}
          </div>
          {!connected && <div className="form-alert error-alert" role="status">Online sign-in is unavailable until the Cloudflare Pages Functions API is enabled for this deployment.</div>}
          <div className="auth-footnote"><ShieldCheck size={13} /><span>{connected ? "Passwords are salted and hashed. Your session is kept in a private HttpOnly cookie." : "Account registration and sign-in are disabled until the production backend is connected."}</span></div>
          <button type="button" className="auth-back" onClick={onClose}><ArrowLeft size={14} /> Back to Persora</button>
        </div>
      </section>
    </div>
  );
}
