import { useEffect, useMemo, useRef, useState } from "react";
import { AudioWaveform, BookOpenText, Check, Copy, Dices, Eye, EyeOff, Info, RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";
import ModalPortal from "./ModalPortal";
import ItemModalShell from "./ItemModalShell";
import {
  composeAiPassword,
  evaluateStrength,
  generateAiLocalFallback,
  generateMemorable,
  generateRandom,
  generateRhythm,
  type AIComposerOptions,
  type GeneratorMode,
  type MemorableOptions,
  type RandomOptions,
  type RhythmOptions,
} from "../lib/password-generator";
import { generateAiPasswordSuggestions, isPagesApiConfigured } from "../lib/cloud";
import type { VaultEntry } from "../lib/password-vault-crypto";

const MODE_META: Record<GeneratorMode, { icon: typeof Dices; label: string }> = {
  random: { icon: Dices, label: "Random" },
  memorable: { icon: BookOpenText, label: "Memorable" },
  rhythm: { icon: AudioWaveform, label: "Rhythm" },
  ai: { icon: Sparkles, label: "AI ✦" },
};

const DEFAULT_RANDOM: RandomOptions = { length: 16, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false };
const DEFAULT_MEMORABLE: MemorableOptions = { wordCount: 5, capitalization: "lower", separator: "random", addNumber: true, addSymbol: false };
const DEFAULT_RHYTHM: RhythmOptions = { length: 14, pattern: "syllable", capitalize: false, addNumber: true, addSymbol: false };
const DEFAULT_AI: AIComposerOptions = { style: "rhythmic", length: 18, capitalize: true, addNumber: true, addSymbol: false };

const AI_STYLE_OPTIONS: ReadonlyArray<{ value: AIComposerOptions["style"]; label: string; hint: string }> = [
  { value: "rhythmic", label: "Rhythmic pairs", hint: "beats like drift-swift, lunar-tuner" },
  { value: "pronounceable", label: "Pronounceable words", hint: "invented words you can say" },
  { value: "poetic", label: "Poetic combos", hint: "images like amber horizon" },
  { value: "sonnet", label: "Sonnet-inspired", hint: "classic poetic fragments" },
  { value: "passphrase", label: "Passphrase", hint: "simple uncommon word chains" },
];

const AI_REQUEST_TIMEOUT_MS = 9000;

/** Toggle that never lets every random character class end up disabled. */
const toggleRandomClass = (options: RandomOptions, key: "upper" | "lower" | "digits" | "symbols") => {
  const next = { ...options, [key]: !options[key] };
  return next.upper || next.lower || next.digits || next.symbols ? next : options;
};

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Persora AI took too long to respond.")), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });

export default function PasswordGeneratorPanel({
  entries,
  notify,
  onClose,
  onSaveAsNew,
  onSaveToExisting,
}: {
  entries: VaultEntry[];
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onSaveAsNew: (password: string) => void;
  onSaveToExisting: (id: string, password: string) => void;
}) {
  const [mode, setMode] = useState<GeneratorMode>("random");
  const [password, setPassword] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveTarget, setSaveTarget] = useState<string>("new");
  const [randomOpts, setRandomOpts] = useState<RandomOptions>(DEFAULT_RANDOM);
  const [memoOpts, setMemoOpts] = useState<MemorableOptions>(DEFAULT_MEMORABLE);
  const [rhythmOpts, setRhythmOpts] = useState<RhythmOptions>(DEFAULT_RHYTHM);
  const [aiOpts, setAiOpts] = useState<AIComposerOptions>(DEFAULT_AI);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<"ai" | "local" | "disabled" | "">("");
  const aiTicket = useRef(0);
  const selectedAiStyle = AI_STYLE_OPTIONS.find((option) => option.value === aiOpts.style) || AI_STYLE_OPTIONS[0];

  const regenerateAi = async (options: AIComposerOptions) => {
    const ticket = ++aiTicket.current;
    // The request carries only public style parameters — never the vault, never
    // existing passwords. If the AI is offline or returns junk we fall back to
    // fully local generation with the same controls, without interrupting.
    if (!isPagesApiConfigured) {
      setPassword(generateAiLocalFallback(options));
      setAiStatus("local");
      return;
    }
    setAiBusy(true);
    try {
      const { candidates, source, reason } = await withTimeout(generateAiPasswordSuggestions(options.style, 4, options.length + 8), AI_REQUEST_TIMEOUT_MS);
      if (ticket !== aiTicket.current) return;
      if (source !== "ai" || !candidates.length) {
        setPassword(generateAiLocalFallback(options));
        setAiStatus(reason === "disabled" ? "disabled" : "local");
        return;
      }
      try {
        setPassword(composeAiPassword(candidates, options));
        setAiStatus("ai");
      } catch {
        setPassword(generateAiLocalFallback(options));
        setAiStatus("local");
      }
    } catch {
      if (ticket !== aiTicket.current) return;
      setPassword(generateAiLocalFallback(options));
      setAiStatus("local");
    } finally {
      if (ticket === aiTicket.current) setAiBusy(false);
    }
  };

  const regenerate = () => {
    setCopied(false);
    if (mode === "random") setPassword(generateRandom(randomOpts));
    else if (mode === "memorable") setPassword(generateMemorable(memoOpts));
    else if (mode === "rhythm") setPassword(generateRhythm(rhythmOpts));
    else void regenerateAi(aiOpts);
  };

  // Live generation: any control change (or the initial open) produces a fresh password.
  useEffect(() => {
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, randomOpts, memoOpts, rhythmOpts, aiOpts]);

  const report = useMemo(
    () => evaluateStrength(
      password,
      mode === "memorable"
        ? { kind: "passphrase" }
        : mode === "rhythm"
          ? { kind: "pronounceable" }
          : mode === "ai"
            ? aiOpts.style === "rhythmic" || aiOpts.style === "pronounceable"
              ? { kind: "pronounceable" }
              : { kind: "passphrase" }
            : {},
    ),
    [password, mode, aiOpts.style]
  );

  const copyValue = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      notify("Password copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Clipboard access is unavailable.", "error");
    }
  };

  const saveTargetEntry = saveTarget === "new" ? null : entries.find((entry) => entry.id === saveTarget) || null;

  const save = () => {
    if (!password) return;
    if (saveTarget === "new") {
      onSaveAsNew(password);
      return;
    }
    if (!saveTargetEntry) {
      notify("Pick a login to update first.", "error");
      return;
    }
    onSaveToExisting(saveTargetEntry.id, password);
  };

  return (
    <ModalPortal>
      <ItemModalShell
        labelledBy="pm-generator-title"
        className="vault-modal-editor pm-generator-modal"
        icon={<Dices size={19} />}
        iconClassName="editor-icon documents"
        eyebrow="Advanced password generator"
        title="Create a strong password."
        onClose={onClose}
        closeLabel="Close generator"
      >
        <div className="vault-modal-scroll">
          <p className="editor-intro">Everything is generated with your browser’s cryptographic random generator — including the final AI suggestions. Nothing you create here ever leaves this device.</p>

          <div className="pm-gen-tabs" role="tablist" aria-label="Generator mode">
            {(Object.keys(MODE_META) as GeneratorMode[]).map((candidate) => {
              const meta = MODE_META[candidate];
              const Icon = meta.icon;
              const active = mode === candidate;
              return (
                <button key={candidate} type="button" role="tab" aria-selected={active} className={`pm-gen-tab ${active ? "is-active" : ""}`} onClick={() => setMode(candidate)}>
                  <Icon size={15} />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>

          <div className="pm-gen-display" data-empty={!password || undefined}>
            <code className="pm-gen-value" aria-live="polite">{aiBusy ? "Asking Persora AI…" : password ? (showValue ? password : "•".repeat(password.length)) : "Generating…"}</code>
            <div className="pm-gen-display-actions">
              <button type="button" className="tiny-action" disabled={!password || aiBusy} aria-label={showValue ? "Hide password" : "Show password"} title={showValue ? "Hide password" : "Show password"} aria-pressed={showValue} onClick={() => setShowValue((visible) => !visible)}>
                {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button type="button" className={`tiny-action ${copied ? "is-copied" : ""}`} disabled={!password || aiBusy} aria-label={copied ? "Password copied" : "Copy password"} title={copied ? "Copied" : "Copy password"} onClick={() => void copyValue()}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {mode === "ai" && aiStatus && !aiBusy && (
            <p className={`pm-ai-status ${aiStatus !== "ai" ? "pm-ai-status-local" : ""}`} role="status">
              {aiStatus === "ai"
                ? <><Sparkles size={13} /><span>Suggested by Persora AI, finished with secure local randomness.</span></>
                : aiStatus === "disabled"
                  ? <><Info size={13} /><span>AI suggestions are turned off by an administrator — generated locally with the same settings instead.</span></>
                  : <><Info size={13} /><span>Persora AI is offline right now — generated locally with the same settings instead.</span></>}
            </p>
          )}

          {password && !aiBusy && (
            <div className={`pm-strength is-${report.level}`}>
              <div className="pm-strength-head">
                <span className="pm-strength-title">Password strength</span>
                <span className="pm-strength-bits">{report.bits} bits</span>
                <span className="pm-strength-badge">{report.label}</span>
              </div>
              <div className="pm-meter" role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={report.index + 1} aria-valuetext={report.label} aria-label={`Password strength: ${report.label}, about ${report.bits} bits of entropy`}>
                {[0, 1, 2, 3].map((segment) => <span key={segment} className={`pm-meter-seg ${segment <= report.index ? "is-on" : ""}`} />)}
              </div>
              <ul className="pm-tips">
                {report.tips.map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
            </div>
          )}

          {mode === "random" && (
            <div className="pm-gen-section">
              <div className="pm-gen-section-head"><span>Random password</span><small>Every character is picked at random — the hardest to guess</small></div>
              <div className="pm-range-row">
                <label htmlFor="pm-gen-length">Length</label>
                <input id="pm-gen-length" type="range" min={8} max={64} step={1} value={randomOpts.length} onChange={(event) => setRandomOpts({ ...randomOpts, length: Number(event.target.value) })} />
                <span className="pm-range-value">{randomOpts.length}</span>
              </div>
              <div className="pm-check-grid">
                <label className="pm-check"><input type="checkbox" checked={randomOpts.upper} onChange={() => setRandomOpts(toggleRandomClass(randomOpts, "upper"))} /> Uppercase <b>A–Z</b></label>
                <label className="pm-check"><input type="checkbox" checked={randomOpts.lower} onChange={() => setRandomOpts(toggleRandomClass(randomOpts, "lower"))} /> Lowercase <b>a–z</b></label>
                <label className="pm-check"><input type="checkbox" checked={randomOpts.digits} onChange={() => setRandomOpts(toggleRandomClass(randomOpts, "digits"))} /> Numbers <b>0–9</b></label>
                <label className="pm-check"><input type="checkbox" checked={randomOpts.symbols} onChange={() => setRandomOpts(toggleRandomClass(randomOpts, "symbols"))} /> Symbols <b>!@#$%</b></label>
                <label className="pm-check pm-check-wide"><input type="checkbox" checked={randomOpts.excludeAmbiguous} onChange={(event) => setRandomOpts({ ...randomOpts, excludeAmbiguous: event.target.checked })} /> Exclude ambiguous characters <b>l&nbsp;1&nbsp;I&nbsp;O&nbsp;0</b></label>
              </div>
            </div>
          )}

          {mode === "memorable" && (
            <div className="pm-gen-section">
              <div className="pm-gen-section-head"><span>Memorable passphrase</span><small>Random dictionary words you can say out loud — long, so still strong</small></div>
              <div className="pm-range-row">
                <label htmlFor="pm-gen-words">Words</label>
                <input id="pm-gen-words" type="range" min={3} max={8} step={1} value={memoOpts.wordCount} onChange={(event) => setMemoOpts({ ...memoOpts, wordCount: Number(event.target.value) })} />
                <span className="pm-range-value">{memoOpts.wordCount}</span>
              </div>
              <div className="editor-fields-grid pm-pair-grid">
                <label className="field-label" htmlFor="pm-gen-case">Capitalization
                  <select id="pm-gen-case" value={memoOpts.capitalization} onChange={(event) => setMemoOpts({ ...memoOpts, capitalization: event.target.value as MemorableOptions["capitalization"] })}>
                    <option value="lower">lowercase words</option>
                    <option value="capital">Capitalize Each Word</option>
                    <option value="upper">ALL UPPERCASE</option>
                  </select>
                </label>
                <label className="field-label" htmlFor="pm-gen-separator">Separator
                  <select id="pm-gen-separator" value={memoOpts.separator} onChange={(event) => setMemoOpts({ ...memoOpts, separator: event.target.value as MemorableOptions["separator"] })}>
                    <option value="random">Random mix</option>
                    <option value="-">Hyphen&nbsp;&nbsp;-</option>
                    <option value="_">Underscore&nbsp;&nbsp;_</option>
                    <option value=".">Period&nbsp;&nbsp;.</option>
                    <option value=" ">Space</option>
                  </select>
                </label>
              </div>
              <div className="pm-check-grid">
                <label className="pm-check"><input type="checkbox" checked={memoOpts.addNumber} onChange={(event) => setMemoOpts({ ...memoOpts, addNumber: event.target.checked })} /> Include a number <b>42</b></label>
                <label className="pm-check"><input type="checkbox" checked={memoOpts.addSymbol} onChange={(event) => setMemoOpts({ ...memoOpts, addSymbol: event.target.checked })} /> Include a symbol <b>!</b></label>
              </div>
            </div>
          )}

          {mode === "rhythm" && (
            <div className="pm-gen-section">
              <div className="pm-gen-section-head"><span>Rhythm password</span><small>Pronounceable consonant–vowel syllables that stick in memory</small></div>
              <div className="pm-range-row">
                <label htmlFor="pm-gen-rhythm-length">Length</label>
                <input id="pm-gen-rhythm-length" type="range" min={8} max={24} step={1} value={rhythmOpts.length} onChange={(event) => setRhythmOpts({ ...rhythmOpts, length: Number(event.target.value) })} />
                <span className="pm-range-value">{rhythmOpts.length}</span>
              </div>
              <div className="editor-fields-grid pm-pair-grid">
                <label className="field-label" htmlFor="pm-gen-pattern">Pattern style
                  <select id="pm-gen-pattern" value={rhythmOpts.pattern} onChange={(event) => setRhythmOpts({ ...rhythmOpts, pattern: event.target.value as RhythmOptions["pattern"] })}>
                    <option value="syllable">Syllables — e.g. trekova mi</option>
                    <option value="alternating">Strict alternating — e.g. kelaniso</option>
                  </select>
                </label>
              </div>
              <div className="pm-check-grid">
                <label className="pm-check"><input type="checkbox" checked={rhythmOpts.capitalize} onChange={(event) => setRhythmOpts({ ...rhythmOpts, capitalize: event.target.checked })} /> Capitalize the first letter</label>
                <label className="pm-check"><input type="checkbox" checked={rhythmOpts.addNumber} onChange={(event) => setRhythmOpts({ ...rhythmOpts, addNumber: event.target.checked })} /> Include a number <b>7</b></label>
                <label className="pm-check"><input type="checkbox" checked={rhythmOpts.addSymbol} onChange={(event) => setRhythmOpts({ ...rhythmOpts, addSymbol: event.target.checked })} /> Include a symbol <b>!</b></label>
              </div>
              <p className="pm-gen-note"><Info size={13} /><span>Pronounceable passwords are easier to remember — <b>but pronounceability does not guarantee strength</b>. Rhythm passwords trade some entropy for memorability, so always check the strength meter above and prefer more length.</span></p>
            </div>
          )}

          {mode === "ai" && (
            <div className="pm-gen-section">
              <div className="pm-gen-section-head"><span>AI memorable password</span><small>Persora AI suggests the words — secure local randomness finishes the password</small></div>
              <div className="editor-fields-grid pm-pair-grid">
                <label className="field-label" htmlFor="pm-gen-ai-style">AI style
                  <select id="pm-gen-ai-style" value={aiOpts.style} onChange={(event) => setAiOpts({ ...aiOpts, style: event.target.value as AIComposerOptions["style"] })}>
                    {AI_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <div className="pm-ai-style-hint" aria-live="polite">
                  <Sparkles size={14} />
                  <span>{selectedAiStyle.hint}</span>
                </div>
              </div>
              <div className="pm-range-row">
                <label htmlFor="pm-gen-ai-length">Length</label>
                <input id="pm-gen-ai-length" type="range" min={8} max={32} step={1} value={aiOpts.length} onChange={(event) => setAiOpts({ ...aiOpts, length: Number(event.target.value) })} />
                <span className="pm-range-value">{aiOpts.length}</span>
              </div>
              <div className="pm-check-grid">
                <label className="pm-check"><input type="checkbox" checked={aiOpts.capitalize} onChange={(event) => setAiOpts({ ...aiOpts, capitalize: event.target.checked })} /> Capitalize words</label>
                <label className="pm-check"><input type="checkbox" checked={aiOpts.addNumber} onChange={(event) => setAiOpts({ ...aiOpts, addNumber: event.target.checked })} /> Include a number <b>7</b></label>
                <label className="pm-check"><input type="checkbox" checked={aiOpts.addSymbol} onChange={(event) => setAiOpts({ ...aiOpts, addSymbol: event.target.checked })} /> Include a symbol <b>!</b></label>
              </div>
              <p className="pm-gen-note"><Info size={13} /><span>The AI only suggests word material — it never sees your vault, existing passwords, or master password, and secure randomness on this device always picks, shuffles, and inserts the final characters. If the AI is unreachable you seamlessly get a local generation. <b>Memorable does not always mean strong</b> — check the meter above and add length when in doubt.</span></p>
            </div>
          )}

          <div className="pm-gen-section pm-save-box">
            <div className="pm-gen-section-head"><span>Save it</span><small>Stored encrypted in your private vault</small></div>
            <div className="pm-save-row">
              <label className="field-label pm-save-select" htmlFor="pm-gen-save-target">Save destination
                <select id="pm-gen-save-target" value={saveTarget} onChange={(event) => setSaveTarget(event.target.value)}>
                  <option value="new">New login item</option>
                  {entries.length > 0 && (
                    <optgroup label="Replace an existing password">
                      {entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.title || "Untitled login"}{entry.login ? ` — ${entry.login}` : ""}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <p className="pm-save-hint">{saveTargetEntry ? <>Replaces the password currently saved in <b>“{saveTargetEntry.title || "Untitled login"}”</b>.</> : "Opens the login editor so you can add a title, username and notes."}</p>
            </div>
          </div>
        </div>

        <div className="editor-form-footer">
          <div className="editor-footnote"><ShieldCheck size={14} /><span>Generated on this device · never shared</span></div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={regenerate} disabled={aiBusy} title="Generate a new password with these settings"><RefreshCw size={14} className={aiBusy ? "pm-spin" : ""} /> Regenerate</button>
            <button type="button" className={`quiet-button ${copied ? "is-copied" : ""}`} disabled={!password || aiBusy} onClick={() => void copyValue()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
            <button type="button" className="editor-submit" disabled={!password || aiBusy} onClick={save}><Save size={15} /> {saveTarget === "new" ? "Save as new login" : "Replace & save"}</button>
          </div>
        </div>
      </ItemModalShell>
    </ModalPortal>
  );
}
