import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, X } from "lucide-react";
import { ShimmerButton } from "./magic-ui";
import { sendPasswordRecoveryCode, resetPasswordWithRecoveryCode } from "../lib/cloud";

export type AuthMode = "signin" | "signup" | "recover";

interface AuthDialogProps {
  initialMode: AuthMode;
  connected: boolean;
  variant?: "user" | "admin";
  busy?: boolean;
  onClose: () => void;
  onSubmit: (mode: "signin" | "signup", values: { fullName: string; email: string; identifier: string; password: string }) => Promise<string | void>;
}

export default function AuthDialog({ initialMode, connected, variant = "user", busy = false, onClose, onSubmit }: AuthDialogProps) {
  const admin = variant === "admin";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Recovery flow state
  const [recoveryStep, setRecoveryStep] = useState<"request" | "reset">("request");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (mode === "recover") return;
    try {
      const result = await onSubmit(mode, { fullName, email, identifier, password });
      if (typeof result === "string") setMessage(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    }
  };

  const handleRequestRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recoveryIdentifier.trim()) return;
    setRecoveryBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await sendPasswordRecoveryCode(recoveryIdentifier.trim());
      setMessage(res.message || (res.emailMasked ? `Recovery code sent to ${res.emailMasked}. Check your inbox.` : "A 6-digit recovery code has been sent to your email."));
      setRecoveryStep("reset");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't send recovery email. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recoveryCode.trim() || !newPassword) return;
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters long.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.");
      return;
    }
    setRecoveryBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await resetPasswordWithRecoveryCode(recoveryIdentifier.trim(), recoveryCode.trim(), newPassword);
      setMessage(res.message || "Password successfully changed. You can now sign in.");
      setMode("signin");
      setIdentifier(recoveryIdentifier.trim());
      setRecoveryStep("request");
      setRecoveryCode("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset password. Please verify the code.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setMessage("");
    if (next === "recover") {
      setRecoveryStep("request");
      if (identifier) setRecoveryIdentifier(identifier);
    }
  };

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`auth-dialog ${admin ? "auth-dialog-admin" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="icon-button auth-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        <div className="auth-art">
          <div className="auth-art-glow" />
          <div className="auth-brand-mark"><ShieldCheck size={21} strokeWidth={2.2} /></div>
          <div className="auth-art-copy">
            <span className="auth-kicker">{admin ? "A protected workspace" : "A quieter kind of organized"}</span>
            <h2>{admin ? <>Steward the<br /><em>Persora space.</em></> : <>Everything important,<br /><em>close at hand.</em></>}</h2>
            <p>{admin ? "A focused control room for the people entrusted to care for Persora." : "One private home for the details that make up your life."}</p>
          </div>
          <div className="auth-mini-card">
            <div className="auth-mini-lock"><LockKeyhole size={15} /></div>
            <div><strong>{admin ? "Administrator access" : "Your vault stays yours"}</strong><span>{admin ? "Role checked securely by the server." : "Private by default. Always."}</span></div>
            <span className="auth-mini-check">✓</span>
          </div>
          <div className="auth-orbit orbit-a" /><div className="auth-orbit orbit-b" />
        </div>
        <div className="auth-panel">
          <div className="auth-panel-top">
            <div className="auth-logo"><span className="brand-mark small"><ShieldCheck size={17} /></span><span>persora</span></div>
            <div className={`auth-connected ${admin ? "auth-connected-admin" : ""}`}><span className={`status-dot ${connected ? "is-live" : "is-demo"}`} />{connected ? admin ? "Admin service ready" : "Secure sign in" : "Setup required"}</div>
          </div>
          <div className="auth-heading">
            <span className="section-eyebrow">
              {mode === "recover" ? "Account security" : admin ? mode === "signin" ? "Administrator access" : "First-owner setup" : mode === "signin" ? "Welcome back" : "Start your private space"}
            </span>
            <h1 id="auth-title">
              {mode === "recover" ? "Recover password" : admin ? mode === "signin" ? "Sign in to your console" : "Create the owner account" : mode === "signin" ? "Sign in to Persora" : "Create your account"}
            </h1>
            <p>
              {mode === "recover"
                ? "Enter your account email or 7-digit Persora ID to receive a secure recovery code via Brevo."
                : admin
                  ? mode === "signin" ? "Use an authorized account to continue to the admin area." : "Create your account, then complete secure first-admin setup."
                  : mode === "signin" ? "Your personal digital life, right where you left it." : "A little more calm for everything you keep."}
            </p>
          </div>

          {mode === "recover" ? (
            recoveryStep === "request" ? (
              <form onSubmit={handleRequestRecovery} className="auth-form">
                <label className="field-label">Email or 7-digit Persora ID
                  <input
                    value={recoveryIdentifier}
                    onChange={(event) => setRecoveryIdentifier(event.target.value)}
                    type="text"
                    autoComplete="username"
                    placeholder="you@example.com or 4827613"
                    maxLength={254}
                    required
                  />
                </label>
                {error && <div className="form-alert error-alert" role="alert">{error}</div>}
                {message && <div className="form-alert success-alert" role="status">{message}</div>}
                <ShimmerButton type="submit" disabled={recoveryBusy || !connected} className="auth-submit">
                  {recoveryBusy ? <><span className="spinner" /> Sending code…</> : <>Send recovery code <Mail size={16} /></>}
                </ShimmerButton>
                <button type="button" className="auth-back" onClick={() => changeMode("signin")}>
                  <ArrowLeft size={14} /> Back to sign in
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="auth-form">
                <label className="field-label">6-digit recovery code
                  <input
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    required
                  />
                  <small className="auth-field-hint">Sent to your registered email address via Brevo.</small>
                </label>
                <label className="field-label">New password
                  <div className="password-wrap">
                    <input
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 12 characters"
                      minLength={12}
                      maxLength={72}
                      required
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
                <label className="field-label">Confirm new password
                  <input
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repeat new password"
                    minLength={12}
                    maxLength={72}
                    required
                  />
                </label>
                {error && <div className="form-alert error-alert" role="alert">{error}</div>}
                {message && <div className="form-alert success-alert" role="status">{message}</div>}
                <ShimmerButton type="submit" disabled={recoveryBusy || !connected} className="auth-submit">
                  {recoveryBusy ? <><span className="spinner" /> Updating…</> : <>Set new password <KeyRound size={16} /></>}
                </ShimmerButton>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <button type="button" className="auth-switch-link" onClick={() => setRecoveryStep("request")} style={{ background: "none", border: "none", color: "#1a73e8", fontSize: "11px", cursor: "pointer", padding: 0 }}>
                    Resend code
                  </button>
                  <button type="button" className="auth-switch-link" onClick={() => changeMode("signin")} style={{ background: "none", border: "none", color: "#5f6368", fontSize: "11px", cursor: "pointer", padding: 0 }}>
                    Cancel
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={submit} className="auth-form">
              {mode === "signup" && (
                <label className="field-label">Full name
                  <input value={fullName} onChange={(event) => setFullName(event.target.value)} type="text" autoComplete="name" placeholder="e.g. Amina Rahman" maxLength={100} required />
                </label>
              )}
              {mode === "signup" ? (
                <label className="field-label">Email address
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required />
                  <small className="auth-field-hint">After signup, verify this address in Settings to add your check badge.</small>
                </label>
              ) : (
                <label className="field-label">Email or 7-digit Persora ID
                  <input value={identifier} onChange={(event) => setIdentifier(event.target.value.slice(0, 254))} type="text" autoComplete="username" placeholder="you@example.com or 4827613" maxLength={254} required />
                </label>
              )}
              <label className="field-label">Password
                <div className="password-wrap">
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signup" ? "At least 12 characters" : "Your password"} minLength={mode === "signup" ? 12 : 1} maxLength={72} required />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
              </label>
              {mode === "signin" && (
                <div style={{ textAlign: "right", marginTop: "-4px", marginBottom: "4px" }}>
                  <button type="button" onClick={() => changeMode("recover")} style={{ background: "none", border: "none", color: "#1a73e8", fontSize: "11px", cursor: "pointer", padding: 0 }}>
                    Forgot password?
                  </button>
                </div>
              )}
              {error && <div className="form-alert error-alert" role="alert">{error}</div>}
              {message && <div className="form-alert success-alert" role="status">{message}</div>}
              <ShimmerButton type="submit" disabled={busy || !connected} className="auth-submit">
                {busy ? <><span className="spinner" /> Working…</> : <>{admin && mode === "signin" ? "Continue securely" : mode === "signin" ? "Sign in" : "Create account"}<ArrowRight size={17} /></>}
              </ShimmerButton>
            </form>
          )}

          {mode !== "recover" && (
            <div className="auth-switch">
              {mode === "signin" ? <>{admin ? "Need an owner account?" : "New to Persora?"} <button type="button" onClick={() => changeMode("signup")}>{admin ? "Create account" : "Create an account"}</button></> : <>Already have an account? <button type="button" onClick={() => changeMode("signin")}>Sign in</button></>}
            </div>
          )}
          {!connected && <div className="form-alert error-alert" role="status">Online sign-in is unavailable until the Cloudflare Pages Functions API is enabled for this deployment.</div>}
          <div className="auth-footnote"><ShieldCheck size={13} /><span>{connected ? admin ? "Administrator permissions are verified server-side after sign in." : "Passwords are salted and hashed. Your session is kept in a private HttpOnly cookie." : "Account registration and sign-in are disabled until the production backend is connected."}</span></div>
          <button type="button" className="auth-back" onClick={onClose}><ArrowLeft size={14} /> Back to Persora</button>
        </div>
      </section>
    </div>
  );
}
