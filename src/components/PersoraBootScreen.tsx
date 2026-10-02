import { Activity, AlarmClock, BellRing, BookOpen, BriefcaseBusiness, CalendarClock, Cloud, ContactRound, FileText, GraduationCap, HeartPulse, Link2, NotebookPen, Share2, ShieldCheck, WalletCards } from "lucide-react";
import { OrbitingCircles } from "./ui/orbiting-circles";

type OrbitIcon = typeof FileText;
type OrbitItem = { icon: OrbitIcon; tone: string; label: string };

const innerItems: OrbitItem[] = [
  { icon: FileText, tone: "blue", label: "Documents" },
  { icon: HeartPulse, tone: "red", label: "Medical records" },
  { icon: ContactRound, tone: "blue", label: "Contacts" },
  { icon: NotebookPen, tone: "amber", label: "Notes" },
  { icon: BellRing, tone: "blue", label: "Reminders" },
];

const middleItems: OrbitItem[] = [
  { icon: AlarmClock, tone: "purple", label: "Alarms" },
  { icon: CalendarClock, tone: "purple", label: "Life timeline" },
  { icon: WalletCards, tone: "blue", label: "Subscriptions and memberships" },
  { icon: Share2, tone: "amber", label: "Shared documents" },
  { icon: BriefcaseBusiness, tone: "blue", label: "Business cards" },
];

const outerItems: OrbitItem[] = [
  { icon: GraduationCap, tone: "blue", label: "Academics" },
  { icon: Cloud, tone: "blue", label: "Private cloud vault" },
  { icon: Link2, tone: "purple", label: "Linked records" },
  { icon: BookOpen, tone: "red", label: "Personal records" },
  { icon: Activity, tone: "amber", label: "Health archive" },
];

function renderOrbitItems(items: OrbitItem[]) {
  return items.map(({ icon: Icon, tone, label }) => <span key={label} className={`persora-orbit-icon tone-${tone}`} aria-label={label}><Icon strokeWidth={1.9}/></span>);
}

export default function PersoraBootScreen() {
  return <main className="persora-boot-screen" role="status" aria-live="polite">
    <div className="persora-boot-orbit-stage" aria-hidden="true">
      <OrbitingCircles className="persora-orbiting-item" radius={56} duration={19} speed={1.12} iconSize={24}>
        {renderOrbitItems(innerItems)}
      </OrbitingCircles>
      <OrbitingCircles className="persora-orbiting-item" radius={96} duration={30} speed={1.08} iconSize={32} reverse>
        {renderOrbitItems(middleItems)}
      </OrbitingCircles>
      <OrbitingCircles className="persora-orbiting-item" radius={136} duration={41} speed={1.05} iconSize={40}>
        {renderOrbitItems(outerItems)}
      </OrbitingCircles>
      <span className="persora-boot-core"><ShieldCheck size={35} strokeWidth={2.15}/></span>
    </div>
    <div className="persora-boot-copy">
      <span className="persora-boot-eyebrow">YOUR PRIVATE SPACE</span>
      <strong>Persora</strong>
      <span>Preparing your personal vault…</span>
    </div>
  </main>;
}
