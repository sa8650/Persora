export const BUILTIN_RINGTONES = [
  { id: "builtin-soft", name: "Persora soft chime" },
  { id: "builtin-pulse", name: "Persora pulse" },
] as const;

export function startBuiltinRingtone(id: string): () => void {
  const AudioContextCtor = typeof window !== "undefined" ? window.AudioContext : undefined;
  if (!AudioContextCtor) throw new Error("Audio playback is not supported by this browser.");
  const context = new AudioContextCtor();
  let pulseTimer = 0;
  let stopped = false;
  let step = 0;
  const pulse = () => {
    if (stopped) return;
    const notes = id === "builtin-pulse" ? [880, 660, 880, 990] : [659.25, 783.99, 987.77, 783.99];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = id === "builtin-pulse" ? "square" : "sine";
    oscillator.frequency.value = notes[step % notes.length];
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(id === "builtin-pulse" ? 0.12 : 0.075, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (id === "builtin-pulse" ? 0.22 : 0.42));
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + (id === "builtin-pulse" ? 0.23 : 0.44));
    step++;
  };
  void context.resume().then(pulse).catch(() => undefined);
  pulseTimer = window.setInterval(pulse, id === "builtin-pulse" ? 430 : 780);
  return () => {
    stopped = true;
    window.clearInterval(pulseTimer);
    void context.close().catch(() => undefined);
  };
}
