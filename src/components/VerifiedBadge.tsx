export default function VerifiedBadge({ activePlan = false, size = "normal" }: { activePlan?: boolean; size?: "normal" | "small" }) {
  const state = activePlan ? "active" : "inactive";
  return (
    <span
      className={`persora-verified-badge is-${state} ${size === "small" ? "is-small" : ""}`}
      role="img"
      aria-label={activePlan ? "Verified email · active paid plan" : "Verified email · no active paid plan"}
      title={activePlan ? "Verified email · active paid plan" : "Verified email · no active paid plan"}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path d="m5.6 10.2 2.8 2.7 6-6.1" fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
