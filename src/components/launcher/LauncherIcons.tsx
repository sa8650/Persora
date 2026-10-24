// Persora app launcher — original, hand-drawn module icons.
//
// Every icon is inline SVG on a shared 48 × 48 grid (artwork within ~5–43),
// built from layered shapes with restrained two-stop gradients. Nothing is
// fetched, rasterized or borrowed from another product's artwork. Gradient ids
// are namespaced per instance with useId so many icons can share a page.
//
// `--li-gap` is the colour used to separate overlapping layers; the drawer sets
// it to its own surface colour so the cut-outs stay correct in dark mode.
import { useId, type ReactNode } from "react";
import type { LauncherModuleId } from "../../lib/app-launcher";

type Draw = (id: (name: string) => string) => ReactNode;

const gap = { stroke: "var(--li-gap, #fff)" } as const;

/** Two-stop gradient, lit from the top left. */
function Lg({ id, from, to, vertical = false }: { id: string; from: string; to: string; vertical?: boolean }) {
  return (
    <linearGradient id={id} x1={vertical ? "0.5" : "0.15"} y1="0" x2={vertical ? "0.5" : "0.85"} y2="1">
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

const ICONS: Record<LauncherModuleId, Draw> = {
  dashboard: (id) => <>
    <defs>
      <Lg id={id("a")} from="#63a1ff" to="#2f6fe4" />
      <Lg id={id("b")} from="#ffd166" to="#f5a524" />
      <Lg id={id("c")} from="#4fd98f" to="#1ea65f" />
      <Lg id={id("d")} from="#ff8e8e" to="#ec4f4f" />
    </defs>
    <rect x="7" y="7" width="15" height="19" rx="4.5" fill={`url(#${id("a")})`} />
    <rect x="26" y="7" width="15" height="12" rx="4.5" fill={`url(#${id("b")})`} />
    <rect x="26" y="23" width="15" height="18" rx="4.5" fill={`url(#${id("c")})`} />
    <rect x="7" y="30" width="15" height="11" rx="4.5" fill={`url(#${id("d")})`} />
    <path d="M10.5 10.6h8" stroke="#fff" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
  </>,

  calendar: (id) => <>
    <defs>
      <Lg id={id("a")} from="#5596ff" to="#1f63e0" vertical />
      <Lg id={id("b")} from="#ff8a6b" to="#f2553b" />
    </defs>
    <rect x="7" y="9" width="34" height="32" rx="7.5" fill="#fff" stroke="#dbe4f2" strokeWidth="1" />
    <path d="M7 16.5A7.5 7.5 0 0 1 14.5 9h19A7.5 7.5 0 0 1 41 16.5V20H7z" fill={`url(#${id("a")})`} />
    <rect x="14.5" y="5.5" width="4" height="8" rx="2" fill="#1849ad" />
    <rect x="29.5" y="5.5" width="4" height="8" rx="2" fill="#1849ad" />
    <rect x="13" y="24.5" width="5.5" height="5" rx="1.6" fill="#d5e1f4" />
    <rect x="21.25" y="24.5" width="5.5" height="5" rx="1.6" fill="#d5e1f4" />
    <rect x="29.5" y="24.5" width="5.5" height="5" rx="1.6" fill="#d5e1f4" />
    <rect x="13" y="32.5" width="5.5" height="5" rx="1.6" fill="#d5e1f4" />
    <rect x="21.25" y="32.5" width="5.5" height="5" rx="1.6" fill={`url(#${id("b")})`} />
    <rect x="29.5" y="32.5" width="5.5" height="5" rx="1.6" fill="#d5e1f4" />
  </>,

  habits: (id) => <>
    <defs>
      <Lg id={id("a")} from="#2dd4bf" to="#16a34a" />
      <Lg id={id("b")} from="#5be09a" to="#15924a" />
      <Lg id={id("c")} from="#ffd166" to="#f59e0b" />
    </defs>
    {/* Progress ring: track + a three-quarter arc from 12 o'clock, ending in a streak node. */}
    <circle cx="24" cy="24" r="15" stroke="#d3f3e2" strokeWidth="5" />
    <path d="M24 9a15 15 0 1 1-15 15" stroke={`url(#${id("a")})`} strokeWidth="5" strokeLinecap="round" />
    <circle cx="24" cy="24" r="9.6" fill={`url(#${id("b")})`} style={gap} strokeWidth="2" />
    <path d="M19.4 24.3l3.2 3.2 6.1-6.6" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18.6 19.8a6.4 6.4 0 0 1 3.6-2.4" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="9" cy="24" r="4" fill={`url(#${id("c")})`} style={gap} strokeWidth="1.8" />
  </>,

  loans: (id) => <>
    <defs>
      <Lg id={id("a")} from="#4fd1c5" to="#0f8f8a" />
      <Lg id={id("b")} from="#ffd36e" to="#f29a0c" vertical />
      <Lg id={id("c")} from="#ffe39b" to="#f6b21b" vertical />
    </defs>
    {/* Repayment card: four installment slots, the first two settled. */}
    <rect x="6" y="8" width="28" height="31" rx="6" fill={`url(#${id("a")})`} />
    <rect x="11" y="14" width="18" height="3.6" rx="1.8" fill="#fff" />
    <rect x="11" y="20.2" width="18" height="3.6" rx="1.8" fill="#fff" />
    <rect x="11" y="26.4" width="18" height="3.6" rx="1.8" fill="#fff" fillOpacity=".38" />
    <rect x="11" y="32.6" width="10" height="3.6" rx="1.8" fill="#fff" fillOpacity=".38" />
    {/* Coin stack. */}
    <ellipse cx="34" cy="37.2" rx="9" ry="4" fill="#d88407" style={gap} strokeWidth="1.8" />
    <path d="M25 33.4v3.8c0 2.2 4 4 9 4s9-1.8 9-4v-3.8" fill={`url(#${id("b")})`} />
    <ellipse cx="34" cy="33.4" rx="9" ry="4" fill={`url(#${id("b")})`} style={gap} strokeWidth="1.8" />
    <path d="M25 27.6v3.8c0 2.2 4 4 9 4s9-1.8 9-4v-3.8" fill={`url(#${id("b")})`} />
    <ellipse cx="34" cy="27.6" rx="9" ry="4" fill={`url(#${id("c")})`} style={gap} strokeWidth="1.8" />
    <ellipse cx="34" cy="27.6" rx="4.6" ry="1.8" fill="none" stroke="#d88407" strokeOpacity=".55" strokeWidth="1.3" />
  </>,

  tables: (id) => <>
    <defs>
      <Lg id={id("a")} from="#4fd98f" to="#16a05a" />
      <Lg id={id("b")} from="#1f9d55" to="#0f7a3f" vertical />
      <Lg id={id("c")} from="#6aa8ff" to="#2f6fe4" />
    </defs>
    {/* Sheet: header band, grid lines and one highlighted cell. */}
    <rect x="6" y="7" width="32" height="32" rx="6" fill={`url(#${id("a")})`} />
    <path d="M6 13a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v3H6z" fill={`url(#${id("b")})`} />
    <path d="M6 24.5h32M6 31.5h32M17 16v23M27.5 16v23" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" />
    <rect x="18.2" y="18" width="8.1" height="5.3" rx="1.2" fill="#fff" />
    {/* Chart chip. */}
    <rect x="27" y="27" width="16" height="16" rx="4.5" fill={`url(#${id("c")})`} style={gap} strokeWidth="2" />
    <path d="M31.5 38.5v-3.2M35 38.5v-6.4M38.5 38.5v-4.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </>,

  timeline: (id) => <>
    <defs>
      <Lg id={id("a")} from="#b49cff" to="#7c3aed" />
      <Lg id={id("b")} from="#f78bc3" to="#db2777" />
      <Lg id={id("c")} from="#fcc93a" to="#f59e0b" />
    </defs>
    <rect x="12.6" y="10" width="3.2" height="28" rx="1.6" fill="#ddd3fd" />
    <rect x="22" y="8.5" width="19" height="7" rx="3.5" fill="#c9b8fd" />
    <rect x="22" y="20.5" width="14.5" height="7" rx="3.5" fill="#f9b4d8" />
    <rect x="22" y="32.5" width="17" height="7" rx="3.5" fill="#fcd77a" />
    <circle cx="14.2" cy="12" r="4.8" fill={`url(#${id("a")})`} style={gap} strokeWidth="2" />
    <circle cx="14.2" cy="24" r="4.8" fill={`url(#${id("b")})`} style={gap} strokeWidth="2" />
    <circle cx="14.2" cy="36" r="4.8" fill={`url(#${id("c")})`} style={gap} strokeWidth="2" />
  </>,

  "medical-records": (id) => <>
    <defs><Lg id={id("a")} from="#ff8597" to="#e33650" /></defs>
    <path d="M24 41s-15.5-8.6-15.5-20.4C8.5 15.1 12.6 11 17.9 11c2.7 0 4.8 1.2 6.1 3.1 1.3-1.9 3.4-3.1 6.1-3.1 5.3 0 9.4 4.1 9.4 9.6C39.5 32.4 24 41 24 41z" fill={`url(#${id("a")})`} />
    <path d="M13.3 18.4c.6-2.2 2.3-3.6 4.5-3.8" stroke="#fff" strokeOpacity=".5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    <path d="M11.5 25.2h6.6l2.6-5.2 4.2 10.2 3-6.6 1.9 1.6h6.8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </>,

  contacts: (id) => <>
    <defs>
      <Lg id={id("a")} from="#38c4ee" to="#0378c4" />
      <Lg id={id("b")} from="#a5e4fc" to="#64c8f5" />
    </defs>
    <circle cx="31.5" cy="17" r="5.5" fill={`url(#${id("b")})`} />
    <path d="M22 38.4c0-6.6 4.2-11 9.5-11s9.5 4.4 9.5 11a1.6 1.6 0 0 1-1.6 1.6H23.6a1.6 1.6 0 0 1-1.6-1.6z" fill={`url(#${id("b")})`} />
    <path d="M7 39c0-7.6 5.3-12.4 12-12.4S31 31.4 31 39a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill={`url(#${id("a")})`} style={gap} strokeWidth="2" />
    <circle cx="19" cy="17.5" r="7" fill={`url(#${id("a")})`} style={gap} strokeWidth="2" />
    <path d="M15.6 14.6a4.2 4.2 0 0 1 3.4-1.8" stroke="#fff" strokeOpacity=".5" strokeWidth="1.6" strokeLinecap="round" fill="none" />
  </>,

  shared: (id) => <>
    <defs>
      <Lg id={id("a")} from="#8f97fb" to="#4f46e5" />
      <Lg id={id("b")} from="#3ddbc4" to="#0d9488" />
      <Lg id={id("c")} from="#6aacfb" to="#2563eb" />
    </defs>
    <path d="M14.5 24 33 13.5M14.5 24 33 34.5" stroke="#cfd6fb" strokeWidth="3.4" strokeLinecap="round" />
    <circle cx="14" cy="24" r="7" fill={`url(#${id("a")})`} style={gap} strokeWidth="2" />
    <circle cx="33.5" cy="13" r="6.3" fill={`url(#${id("b")})`} style={gap} strokeWidth="2" />
    <circle cx="33.5" cy="35" r="6.3" fill={`url(#${id("c")})`} style={gap} strokeWidth="2" />
    <circle cx="11.7" cy="21.7" r="1.6" fill="#fff" fillOpacity=".55" />
  </>,

  "personal-finance": (id) => <>
    <defs>
      <Lg id={id("a")} from="#3ddca3" to="#10b981" vertical />
      <Lg id={id("b")} from="#17b884" to="#047857" vertical />
      <Lg id={id("c")} from="#fde24f" to="#f59e0b" />
    </defs>
    <rect x="7" y="38.5" width="34" height="2.6" rx="1.3" fill="#cdeedd" />
    <rect x="10" y="27.5" width="7" height="10" rx="2.5" fill="#8ce8bd" />
    <rect x="20.5" y="21" width="7" height="16.5" rx="2.5" fill={`url(#${id("a")})`} />
    <rect x="31" y="13.5" width="7" height="24" rx="2.5" fill={`url(#${id("b")})`} />
    <circle cx="15.5" cy="15" r="7" fill={`url(#${id("c")})`} style={gap} strokeWidth="2" />
    <circle cx="15.5" cy="15" r="3.7" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.6" />
  </>,

  documents: (id) => <>
    <defs><Lg id={id("a")} from="#ffd56e" to="#f5a516" vertical /></defs>
    <path d="M7 14a4 4 0 0 1 4-4h8.3a4 4 0 0 1 2.8 1.2l2.2 2.2c.4.4.9.6 1.4.6H37a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" fill="#e48c0b" />
    <rect x="12" y="14" width="24" height="17" rx="2.5" fill="#fff" />
    <rect x="15.5" y="17.4" width="12" height="2.2" rx="1.1" fill="#c3cddb" />
    <rect x="15.5" y="21.2" width="16" height="2.2" rx="1.1" fill="#dbe2ec" />
    <path d="M7 25.5A3.5 3.5 0 0 1 10.5 22h27a3.5 3.5 0 0 1 3.5 3.5V34a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" fill={`url(#${id("a")})`} />
    <rect x="10.5" y="24.6" width="27" height="1.3" rx=".65" fill="#fff" fillOpacity=".45" />
  </>,

  academics: (id) => <>
    <defs>
      <Lg id={id("a")} from="#5a7cf0" to="#2443b8" />
      <Lg id={id("b")} from="#2f4fc2" to="#1a2f7d" vertical />
      <Lg id={id("c")} from="#fdd34d" to="#f2a20c" vertical />
    </defs>
    <path d="M13 22.5v7.4c0 3 4.9 5.8 11 5.8s11-2.8 11-5.8v-7.4L24 27.8z" fill={`url(#${id("b")})`} />
    <path d="M22.7 9.6a3 3 0 0 1 2.6 0l15.9 7.6a1 1 0 0 1 0 1.8l-15.9 7.6a3 3 0 0 1-2.6 0L6.8 19a1 1 0 0 1 0-1.8z" fill={`url(#${id("a")})`} />
    <path d="M24 12.1 35.2 17.5" stroke="#fff" strokeOpacity=".3" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M24 18.1 37.6 21.6V30" stroke="#f6b522" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="24" cy="18.1" r="1.9" fill="#fcc93a" />
    <rect x="35.9" y="29.2" width="3.4" height="6.6" rx="1.7" fill={`url(#${id("c")})`} />
  </>,

  family: (id) => <>
    <defs>
      <Lg id={id("a")} from="#ffa463" to="#ee6326" vertical />
      <Lg id={id("b")} from="#fff6ee" to="#ffd9bd" vertical />
      <Lg id={id("c")} from="#fb7d92" to="#e11d48" />
    </defs>
    <rect x="31.5" y="10" width="4.6" height="9" rx="1.3" fill="#d3541d" />
    <rect x="11" y="21" width="26" height="20" rx="3.2" fill={`url(#${id("b")})`} />
    <path d="M22.6 8.6a2.2 2.2 0 0 1 2.8 0l15.9 13.3c1 .8.4 2.6-.9 2.6H7.6c-1.3 0-1.9-1.8-.9-2.6z" fill={`url(#${id("a")})`} />
    <path d="M24 38.4s-6.3-3.7-6.3-8.3c0-2.1 1.5-3.7 3.5-3.7 1.2 0 2.2.6 2.8 1.5.6-.9 1.6-1.5 2.8-1.5 2 0 3.5 1.6 3.5 3.7 0 4.6-6.3 8.3-6.3 8.3z" fill={`url(#${id("c")})`} />
  </>,

  "photo-studio": (id) => <>
    <defs>
      <Lg id={id("a")} from="#b77cfb" to="#ec4899" />
      <Lg id={id("b")} from="#6aa8fb" to="#4338ca" />
    </defs>
    <path d="M16.6 15.5 19 11.1A3.2 3.2 0 0 1 21.8 9.4h4.4A3.2 3.2 0 0 1 29 11.1l2.4 4.4z" fill="#a855f7" />
    <rect x="6" y="14" width="36" height="26.5" rx="8" fill={`url(#${id("a")})`} />
    <circle cx="24" cy="27.3" r="9.2" fill="#fff" />
    <circle cx="24" cy="27.3" r="6.3" fill={`url(#${id("b")})`} />
    <circle cx="21.8" cy="25.1" r="1.9" fill="#fff" fillOpacity=".85" />
    <circle cx="35.6" cy="19.6" r="1.9" fill="#fde68a" />
  </>,

  subscriptions: (id) => <>
    <defs>
      <Lg id={id("a")} from="#ffb36b" to="#f97316" />
      <Lg id={id("b")} from="#fb8f3c" to="#e2520a" />
      <Lg id={id("c")} from="#fcd34d" to="#f59e0b" />
    </defs>
    <path d="M12.41 20.89A12 12 0 0 1 32.03 15.08" stroke={`url(#${id("a")})`} strokeWidth="4.6" strokeLinecap="round" fill="none" />
    <path d="M36 19.39 35.25 11.99 28.71 17.87Z" fill="#f97316" stroke="#f97316" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M35.59 27.11A12 12 0 0 1 15.97 32.92" stroke={`url(#${id("b")})`} strokeWidth="4.6" strokeLinecap="round" fill="none" />
    <path d="M12 28.61 12.75 36.01 19.29 30.13Z" fill="#e8590c" stroke="#e8590c" strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="24" cy="24" r="4.6" fill={`url(#${id("c")})`} />
  </>,

  purchases: (id) => <>
    <defs>
      <Lg id={id("a")} from="#f57bc4" to="#c026d3" />
      <Lg id={id("b")} from="#4fe08a" to="#16a34a" />
    </defs>
    <path d="M18.5 18v-4.6a5.5 5.5 0 0 1 11 0V18" stroke="#a21caf" strokeWidth="2.7" strokeLinecap="round" fill="none" />
    <path d="M11.6 17.6A2.6 2.6 0 0 1 14.2 15h19.6a2.6 2.6 0 0 1 2.6 2.6l1.6 19.6a3.5 3.5 0 0 1-3.5 3.8H13.5a3.5 3.5 0 0 1-3.5-3.8z" fill={`url(#${id("a")})`} />
    <circle cx="18.5" cy="19.6" r="1.4" fill="#fff" fillOpacity=".9" />
    <circle cx="29.5" cy="19.6" r="1.4" fill="#fff" fillOpacity=".9" />
    <circle cx="35" cy="35" r="7.2" fill={`url(#${id("b")})`} style={gap} strokeWidth="2.2" />
    <path d="M31.8 35.2 34 37.4 38.2 32.8" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </>,

  accounts: (id) => <>
    <defs>
      <Lg id={id("a")} from="#2cc9b5" to="#0f766e" vertical />
      <Lg id={id("b")} from="#9df2e3" to="#5fd8c4" vertical />
    </defs>
    <path d="M22.9 7.6a2.4 2.4 0 0 1 2.2 0l14.8 7.5c.7.4 1.1 1.1 1.1 1.9V18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-1c0-.8.4-1.5 1.1-1.9z" fill={`url(#${id("a")})`} />
    <circle cx="24" cy="13.6" r="1.9" fill="#fff" fillOpacity=".9" />
    <rect x="10.2" y="21.2" width="4.6" height="12.6" rx="1.4" fill={`url(#${id("b")})`} />
    <rect x="18.1" y="21.2" width="4.6" height="12.6" rx="1.4" fill={`url(#${id("b")})`} />
    <rect x="25.3" y="21.2" width="4.6" height="12.6" rx="1.4" fill={`url(#${id("b")})`} />
    <rect x="33.2" y="21.2" width="4.6" height="12.6" rx="1.4" fill={`url(#${id("b")})`} />
    <rect x="7" y="35.5" width="34" height="5" rx="1.8" fill={`url(#${id("a")})`} />
  </>,

  memberships: (id) => <>
    <defs>
      <Lg id={id("a")} from="#ad8ffb" to="#6d28d9" />
      <Lg id={id("b")} from="#fde24f" to="#f59e0b" />
    </defs>
    <rect x="6" y="11" width="36" height="26" rx="5.5" fill={`url(#${id("a")})`} />
    <rect x="6" y="16" width="36" height="4.2" fill="#4c1d95" fillOpacity=".35" />
    <rect x="11" y="25" width="10" height="2.4" rx="1.2" fill="#fff" fillOpacity=".92" />
    <rect x="11" y="30" width="6.5" height="2.4" rx="1.2" fill="#fff" fillOpacity=".55" />
    <path d="M31 21 32.82 25.49 37.66 25.84 33.95 28.96 35.11 33.66 31 31.1 26.89 33.66 28.05 28.96 24.34 25.84 29.18 25.49Z" fill={`url(#${id("b")})`} stroke={`url(#${id("b")})`} strokeWidth="1.3" strokeLinejoin="round" />
  </>,

  "wallet-cards": (id) => <>
    <defs>
      <Lg id={id("a")} from="#fdaab5" to="#f43f5e" />
      <Lg id={id("b")} from="#66a9fb" to="#2563eb" />
      <Lg id={id("c")} from="#fde68a" to="#f2b31c" vertical />
    </defs>
    <rect x="12" y="8.5" width="30" height="20" rx="4.5" fill={`url(#${id("a")})`} />
    <rect x="6" y="18" width="32" height="21.5" rx="4.5" fill={`url(#${id("b")})`} style={gap} strokeWidth="2" />
    <rect x="10.5" y="23.5" width="7.4" height="5.6" rx="1.6" fill={`url(#${id("c")})`} />
    <rect x="10.5" y="32.6" width="16" height="2.2" rx="1.1" fill="#fff" fillOpacity=".8" />
    <rect x="29" y="32.6" width="4.6" height="2.2" rx="1.1" fill="#fff" fillOpacity=".55" />
  </>,

  "password-manager": (id) => <>
    <defs>
      <Lg id={id("a")} from="#d5dde8" to="#97a6ba" vertical />
      <Lg id={id("b")} from="#9572fb" to="#4f46e5" />
      <Lg id={id("c")} from="#fde24f" to="#f5a30b" vertical />
    </defs>
    <path d="M16 21.5v-5.2a8 8 0 0 1 16 0v5.2" stroke={`url(#${id("a")})`} strokeWidth="4.4" strokeLinecap="round" fill="none" />
    <rect x="9.5" y="20" width="29" height="21" rx="6.5" fill={`url(#${id("b")})`} />
    <rect x="13" y="22.6" width="22" height="1.4" rx=".7" fill="#fff" fillOpacity=".3" />
    <circle cx="24" cy="29.4" r="3.2" fill={`url(#${id("c")})`} />
    <rect x="22.75" y="30.4" width="2.5" height="6" rx="1.25" fill={`url(#${id("c")})`} />
  </>,

  projects: (id) => <>
    <defs>
      <Lg id={id("a")} from="#f3f7ff" to="#dce7fd" vertical />
      <Lg id={id("b")} from="#5d9dff" to="#2563eb" vertical />
      <Lg id={id("c")} from="#ffd166" to="#f59e0b" vertical />
      <Lg id={id("d")} from="#4fd98f" to="#16a34a" vertical />
    </defs>
    <rect x="6" y="8" width="36" height="32" rx="7" fill={`url(#${id("a")})`} stroke="#d3def3" strokeWidth="1" />
    <rect x="10.5" y="12.5" width="7.6" height="11" rx="2.2" fill={`url(#${id("b")})`} />
    <rect x="10.5" y="26" width="7.6" height="7" rx="2.2" fill="#a9c8fd" />
    <rect x="20.2" y="12.5" width="7.6" height="7" rx="2.2" fill={`url(#${id("c")})`} />
    <rect x="20.2" y="22" width="7.6" height="13.5" rx="2.2" fill="#fde3a3" />
    <rect x="29.9" y="12.5" width="7.6" height="15" rx="2.2" fill={`url(#${id("d")})`} />
  </>,

  "pdf-studio": (id) => <>
    <defs><Lg id={id("a")} from="#ff7272" to="#dc2f2f" /></defs>
    <path d="M12.2 6.5h15.3L38.5 17.5v21.8a3.2 3.2 0 0 1-3.2 3.2H12.2A3.2 3.2 0 0 1 9 39.3V9.7a3.2 3.2 0 0 1 3.2-3.2z" fill={`url(#${id("a")})`} />
    <path d="M27.5 6.5v7.8a3.2 3.2 0 0 0 3.2 3.2h7.8z" fill="#ffc7c7" />
    <rect x="14" y="23" width="17" height="2.6" rx="1.3" fill="#fff" />
    <rect x="14" y="29" width="19.5" height="2.6" rx="1.3" fill="#fff" fillOpacity=".9" />
    <rect x="14" y="35" width="11.5" height="2.6" rx="1.3" fill="#fff" fillOpacity=".75" />
  </>,

  study: (id) => <>
    <defs>
      <Lg id={id("a")} from="#8fdbfd" to="#22aeee" />
      <Lg id={id("b")} from="#42bdf8" to="#0284c7" />
    </defs>
    <path d="M6 13.8v25.4c7-.6 13 .4 18 3 5-2.6 11-3.6 18-3V13.8" fill="#0b5f8f" />
    <path d="M24 13.2c-3.6-2.7-8.7-3.7-15.2-3.3v26.4c6.5-.4 11.6.6 15.2 3.3z" fill={`url(#${id("a")})`} />
    <path d="M24 13.2c3.6-2.7 8.7-3.7 15.2-3.3v26.4c-6.5-.4-11.6.6-15.2 3.3z" fill={`url(#${id("b")})`} />
    <path d="M12.5 17.2c2.9-.1 5.4.4 7.6 1.4M12.5 22.4c2.9-.1 5.4.4 7.6 1.4" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    <path d="M30.5 10.4v9.4l2.6-2 2.6 2v-9.9z" fill="#ffb02e" />
  </>,

  notes: (id) => <>
    <defs><Lg id={id("a")} from="#fff1a3" to="#fbcd23" vertical /></defs>
    <path d="M9 12a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v17.5L28.5 40H13a4 4 0 0 1-4-4z" fill={`url(#${id("a")})`} />
    <path d="M39 29.5h-6.5a4 4 0 0 0-4 4V40z" fill="#e3a90a" />
    <path d="M13.6 16.6 15.5 18.5 19 14.8M13.6 24.3 15.5 26.2 19 22.5" stroke="#16a34a" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <rect x="22" y="15.6" width="12.5" height="2.4" rx="1.2" fill="#9a6a05" fillOpacity=".5" />
    <rect x="22" y="23.3" width="10" height="2.4" rx="1.2" fill="#9a6a05" fillOpacity=".5" />
    <rect x="14" y="31" width="10" height="2.4" rx="1.2" fill="#9a6a05" fillOpacity=".32" />
  </>,

  "business-card": (id) => <>
    <defs>
      <Lg id={id("a")} from="#6b7c95" to="#2f3c51" />
      <Lg id={id("b")} from="#ffbe7a" to="#f97316" vertical />
    </defs>
    <rect x="5" y="11" width="38" height="26" rx="5.5" fill={`url(#${id("a")})`} />
    <circle cx="15.5" cy="21.2" r="4.4" fill={`url(#${id("b")})`} />
    <path d="M9.4 31.4c.6-3.2 3.1-5.1 6.1-5.1s5.5 1.9 6.1 5.1z" fill={`url(#${id("b")})`} />
    <rect x="25" y="18" width="13" height="2.6" rx="1.3" fill="#fff" fillOpacity=".95" />
    <rect x="25" y="23.4" width="9" height="2.2" rx="1.1" fill="#fff" fillOpacity=".55" />
    <rect x="25" y="28.4" width="11" height="2.2" rx="1.1" fill="#fff" fillOpacity=".35" />
  </>,

  urls: (id) => <>
    <defs>
      <Lg id={id("a")} from="#4fe0f5" to="#0891b2" />
      <Lg id={id("b")} from="#6aacfb" to="#2563eb" />
    </defs>
    <rect x="6.5" y="17.5" width="21" height="13" rx="6.5" transform="rotate(-45 17 24)" fill="none" stroke={`url(#${id("a")})`} strokeWidth="4.4" />
    <rect x="20.5" y="17.5" width="21" height="13" rx="6.5" transform="rotate(-45 31 24)" fill="none" style={gap} strokeWidth="8" />
    <rect x="20.5" y="17.5" width="21" height="13" rx="6.5" transform="rotate(-45 31 24)" fill="none" stroke={`url(#${id("b")})`} strokeWidth="4.4" />
  </>,
};

export function LauncherModuleIcon({ id, size = 40 }: { id: LauncherModuleId; size?: number }) {
  const prefix = `li${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const draw = ICONS[id];
  return (
    <svg className="launcher-module-icon" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      {draw((name) => `${prefix}${name}`)}
    </svg>
  );
}

/** The 3 × 3 dot grid on the launcher button (inherits the button colour). */
export function LauncherGridGlyph({ size = 18 }: { size?: number }) {
  const dots = [4, 10, 16];
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {dots.flatMap((y) => dots.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill="currentColor" />))}
    </svg>
  );
}

export const LAUNCHER_ICON_IDS = Object.keys(ICONS) as LauncherModuleId[];
