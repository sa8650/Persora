// Persora Forms — Google Forms / Google Sheets-style home dashboard:
// Top "Start a new form" shelf (#F0F4F9 / var(--ds-shelf-bg)) + real templates,
// single-line "Recent forms" toolbar with one combined filter dropdown,
// and responsive miniature preview card grid + simplified 2-row footer.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowUpDown,
  BarChart3,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Eye,
  FileCheck2,
  FolderOpen,
  Globe,
  GlobeLock,
  GraduationCap,
  LayoutGrid,
  Link2,
  List,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  buildPublicFormUrl,
  createBlankQuestion,
  defaultFormSettings,
  getForm,
  type FormDetail,
  type FormQuestion,
  type FormSettings,
  type FormSummary,
} from "../../lib/forms-api";
import { buildFormThemeCssVars } from "../../lib/form-themes";
import { Badge, PersoraDeleteModal, PersoraEmptyState } from "@/design-system";
import { Spinner } from "@/components/ui/spinner";
import ModalPortal from "../ModalPortal";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import FormRespondentRenderer from "./FormRespondentRenderer";
import {
  BlankFormArtwork,
  FormCardPreview,
  FormContentMiniature,
  type FormMiniatureInput,
} from "./FormCardPreview";

type FilterMode = "all" | "published" | "draft" | "quiz" | "event";
type SortMode = "updated" | "responses" | "title" | "created";
type ViewMode = "grid" | "list";

const VIEW_MODE_KEY = "persora.forms.viewMode";
const INLINE_TEMPLATE_LIMIT = 5;

function readInitialViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

interface StarterTemplate {
  id:
    | "event"
    | "feedback"
    | "quiz"
    | "contact"
    | "rsvp"
    | "order"
    | "course";
  label: string;
  description: string;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "event",
    label: "Event Registration",
    description: "Collect attendees with automatic capacity limits",
  },
  {
    id: "feedback",
    label: "Feedback Survey",
    description: "Ratings, linear scales, and open suggestions",
  },
  {
    id: "quiz",
    label: "Blank Quiz",
    description: "Auto-scored questions with instant point feedback",
  },
  {
    id: "contact",
    label: "Contact Information",
    description: "Collect names, emails, phone numbers, and notes",
  },
  {
    id: "rsvp",
    label: "Event RSVP",
    description: "Attendance confirmation, guest count, and dietary needs",
  },
  {
    id: "order",
    label: "Order Request",
    description: "Item selection, quantity, and delivery details",
  },
  {
    id: "course",
    label: "Course Evaluation",
    description: "Session ratings, pace feedback, and takeaways",
  },
];

function buildStarterSeed(id: StarterTemplate["id"] | "blank"): {
  title: string;
  description: string;
  questions: FormQuestion[];
  settings: FormSettings;
} {
  const settings = defaultFormSettings();

  if (id === "event") {
    settings.eventRegistration.enabled = true;
    settings.eventRegistration.maxRegistrations = 100;
    settings.closedMessage =
      "Registration is now full. Thank you for your interest!";
    settings.theme = {
      accentColor: "rose",
      backgroundStyle: "light",
      presetHeader: "celebration-confetti",
    };
    const qName = createBlankQuestion("short_text", true);
    qName.title = "Full name";

    const qEmail = createBlankQuestion("short_text", true);
    qEmail.title = "Email address";

    const qTrack = createBlankQuestion("multiple_choice", true);
    qTrack.title = "Which session will you attend?";
    qTrack.options = [
      { id: `${qTrack.id}_1`, label: "Morning Keynote (9:30 AM)" },
      { id: `${qTrack.id}_2`, label: "Design Workshop (1:00 PM)" },
      { id: `${qTrack.id}_3`, label: "Full-Day Pass" },
    ];

    const qNotes = createBlankQuestion("long_text", false);
    qNotes.title = "Dietary restrictions or accessibility notes";

    return {
      title: "Event Registration",
      description: "Reserve your spot below. Space is limited.",
      questions: [qName, qEmail, qTrack, qNotes],
      settings,
    };
  }

  if (id === "feedback") {
    settings.theme = {
      accentColor: "emerald",
      backgroundStyle: "light",
      presetHeader: "botanical-calm",
    };
    const qScale = createBlankQuestion("linear_scale", true);
    qScale.title = "Overall, how satisfied are you with your experience?";
    qScale.scaleMin = 1;
    qScale.scaleMax = 5;
    qScale.minLabel = "Not satisfied";
    qScale.maxLabel = "Very satisfied";

    const qRecommend = createBlankQuestion("multiple_choice", true);
    qRecommend.title = "Would you recommend us to a colleague?";
    qRecommend.options = [
      { id: `${qRecommend.id}_1`, label: "Definitely" },
      { id: `${qRecommend.id}_2`, label: "Probably" },
      { id: `${qRecommend.id}_3`, label: "Not sure yet" },
    ];

    const qImprove = createBlankQuestion("long_text", false);
    qImprove.title = "What is one thing we could improve next time?";

    return {
      title: "Customer Feedback Survey",
      description: "We read every response — this takes under two minutes.",
      questions: [qScale, qRecommend, qImprove],
      settings,
    };
  }

  if (id === "quiz") {
    settings.quiz.enabled = true;
    settings.quiz.showScoreImmediately = true;
    settings.quiz.showCorrectAnswers = true;
    settings.theme = {
      accentColor: "indigo",
      backgroundStyle: "light",
      presetHeader: "aurora-waves",
    };

    const q1 = createBlankQuestion("multiple_choice", true);
    q1.title = "Question 1";
    const optA = { id: `${q1.id}_a`, label: "Option A" };
    const optB = { id: `${q1.id}_b`, label: "Option B" };
    const optC = { id: `${q1.id}_c`, label: "Option C" };
    q1.options = [optA, optB, optC];
    q1.quiz = {
      points: 5,
      correctOptionIds: [optA.id],
      acceptedAnswers: [],
      explanation: "Add an explanation shown after submission.",
    };

    const q2 = createBlankQuestion("checkboxes", true);
    q2.title = "Select all correct statements";
    const c1 = { id: `${q2.id}_1`, label: "Statement 1" };
    const c2 = { id: `${q2.id}_2`, label: "Statement 2" };
    const c3 = { id: `${q2.id}_3`, label: "Statement 3" };
    q2.options = [c1, c2, c3];
    q2.quiz = {
      points: 5,
      correctOptionIds: [c1.id, c2.id],
      acceptedAnswers: [],
      explanation: "",
    };

    return {
      title: "Untitled Quiz",
      description: "Answer all required questions below to view your score.",
      questions: [q1, q2],
      settings,
    };
  }

  if (id === "contact") {
    settings.theme = {
      accentColor: "blue",
      backgroundStyle: "light",
      presetHeader: "architectural-grid",
    };
    const qName = createBlankQuestion("short_text", true);
    qName.title = "Name";

    const qEmail = createBlankQuestion("short_text", true);
    qEmail.title = "Email";

    const qPhone = createBlankQuestion("short_text", false);
    qPhone.title = "Phone number";

    const qComments = createBlankQuestion("long_text", false);
    qComments.title = "Comments or questions";

    return {
      title: "Contact Information",
      description: "Share your contact details and our team will follow up.",
      questions: [qName, qEmail, qPhone, qComments],
      settings,
    };
  }

  if (id === "rsvp") {
    settings.eventRegistration.enabled = true;
    settings.eventRegistration.maxRegistrations = 80;
    settings.theme = {
      accentColor: "coral",
      backgroundStyle: "light",
      presetHeader: "sunset-horizon",
    };
    const qAttend = createBlankQuestion("multiple_choice", true);
    qAttend.title = "Can you attend?";
    qAttend.options = [
      { id: `${qAttend.id}_1`, label: "Yes, I'll be there" },
      { id: `${qAttend.id}_2`, label: "Sorry, can't make it" },
    ];

    const qNames = createBlankQuestion("short_text", true);
    qNames.title = "Name(s) of attendees";

    const qDiet = createBlankQuestion("checkboxes", false);
    qDiet.title = "Dietary preferences";
    qDiet.options = [
      { id: `${qDiet.id}_1`, label: "Vegetarian" },
      { id: `${qDiet.id}_2`, label: "Vegan" },
      { id: `${qDiet.id}_3`, label: "Gluten-free" },
    ];

    return {
      title: "Event RSVP",
      description: "Please let us know whether you can join us.",
      questions: [qAttend, qNames, qDiet],
      settings,
    };
  }

  if (id === "order") {
    settings.theme = {
      accentColor: "amber",
      backgroundStyle: "light",
      presetHeader: null,
    };
    const qItem = createBlankQuestion("dropdown", true);
    qItem.title = "Choose an item";
    qItem.options = [
      { id: `${qItem.id}_1`, label: "Standard Kit" },
      { id: `${qItem.id}_2`, label: "Team Bundle" },
      { id: `${qItem.id}_3`, label: "Enterprise Pack" },
    ];

    const qQty = createBlankQuestion("short_text", true);
    qQty.title = "Quantity";

    const qAddress = createBlankQuestion("long_text", true);
    qAddress.title = "Delivery address";

    return {
      title: "Order Request",
      description: "Submit your item selection and shipping details below.",
      questions: [qItem, qQty, qAddress],
      settings,
    };
  }

  if (id === "course") {
    settings.theme = {
      accentColor: "teal",
      backgroundStyle: "light",
      presetHeader: null,
    };
    const qInstructor = createBlankQuestion("linear_scale", true);
    qInstructor.title = "How clear and engaging was the instructor?";
    qInstructor.scaleMin = 1;
    qInstructor.scaleMax = 5;

    const qPace = createBlankQuestion("multiple_choice", true);
    qPace.title = "How was the course pace?";
    qPace.options = [
      { id: `${qPace.id}_1`, label: "Too fast" },
      { id: `${qPace.id}_2`, label: "Just right" },
      { id: `${qPace.id}_3`, label: "Too slow" },
    ];

    const qTakeaway = createBlankQuestion("long_text", false);
    qTakeaway.title = "Most valuable takeaway";

    return {
      title: "Course Evaluation",
      description: "Share anonymous feedback to help improve future cohorts.",
      questions: [qInstructor, qPace, qTakeaway],
      settings,
    };
  }

  const firstQuestion = createBlankQuestion("multiple_choice", false);
  firstQuestion.title = "Untitled question";
  return {
    title: "Untitled form",
    description: "",
    questions: [firstQuestion],
    settings,
  };
}

function formatModifiedStamp(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "Modified recently";
  const d = new Date(time);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Modified ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `Modified ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

interface FormsMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

function FormsDropdownMenu({
  label,
  title,
  icon,
  items,
  buttonClassName = "pf-icon-button",
  align = "end",
  children,
}: {
  label: string;
  title?: string;
  icon?: ReactNode;
  items: Array<FormsMenuItem | "divider">;
  buttonClassName?: string;
  align?: "start" | "end";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const menuEl = listRef.current;
      const estHeight = menuEl?.offsetHeight || Math.min(340, items.length * 34 + 16);
      const estWidth = menuEl?.offsetWidth || 216;
      const spaceBelow = vh - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < estHeight && spaceAbove > spaceBelow;

      const style: CSSProperties = {
        position: "fixed",
        zIndex: 280,
        maxHeight: `${Math.max(160, openUp ? spaceAbove : spaceBelow)}px`,
      };
      if (openUp) {
        style.bottom = `${Math.max(8, vh - rect.top + 6)}px`;
        style.top = "auto";
      } else {
        style.top = `${Math.max(8, rect.bottom + 6)}px`;
        style.bottom = "auto";
      }
      if (align === "end") {
        style.right = `${Math.max(8, Math.min(vw - estWidth - 8, vw - rect.right))}px`;
        style.left = "auto";
      } else {
        style.left = `${Math.max(8, Math.min(vw - estWidth - 8, rect.left))}px`;
        style.right = "auto";
      }
      setFloatingStyle(style);
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, items.length, open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDownDoc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownDoc, true);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownDoc, true);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    if (!buttons.length) return;
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(idx + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className="pf-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={title || label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {children ?? icon}
      </button>
      {open && (
        <ModalPortal>
          <div
            className="pf-menu-list"
            style={floatingStyle}
            id={menuId}
            role="menu"
            ref={listRef}
            onKeyDown={onKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            {items.map((item, idx) =>
              item === "divider" ? (
                <div key={`div-${idx}`} className="pf-menu-divider" role="separator" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`pf-menu-item ${item.danger ? "is-danger" : ""} ${item.checked ? "is-checked" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.checked !== undefined ? (
                    <span className="pf-menu-check" aria-hidden="true">
                      {item.checked ? <Check size={14} /> : null}
                    </span>
                  ) : item.icon ? (
                    <span className="pf-menu-icon" aria-hidden="true">{item.icon}</span>
                  ) : null}
                  <span className="pf-menu-label">{item.label}</span>
                </button>
              ),
            )}
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

export default function FormsDashboard({
  forms,
  loading,
  creating,
  notify,
  onCreate,
  onOpenForm,
  onTogglePublish,
  onRename,
  onDuplicate,
  onDelete,
}: {
  forms: FormSummary[];
  loading: boolean;
  creating: boolean;
  notify: (msg: string, kind?: "error" | "success") => void;
  onCreate: (seed: {
    title: string;
    description: string;
    questions: FormQuestion[];
    settings: FormSettings;
  }) => Promise<void>;
  onOpenForm: (formId: string, tab?: "builder" | "responses" | "settings") => void;
  onTogglePublish: (form: FormSummary) => Promise<void>;
  onRename?: (form: FormSummary, title: string) => Promise<void>;
  onDuplicate: (form: FormSummary) => Promise<void>;
  onDelete: (formId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const [renaming, setRenaming] = useState<FormSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<FormSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [quickPreviewSummary, setQuickPreviewSummary] = useState<FormSummary | null>(null);
  const [quickPreviewDetail, setQuickPreviewDetail] = useState<FormDetail | null>(null);
  const [quickPreviewLoading, setQuickPreviewLoading] = useState(false);

  const changeViewMode = (next: ViewMode) => {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      /* ignore storage restrictions */
    }
  };

  const starterItems = useMemo(() => {
    const visible = galleryOpen
      ? STARTER_TEMPLATES
      : STARTER_TEMPLATES.slice(0, INLINE_TEMPLATE_LIMIT);
    return visible.map((tpl) => {
      const seed = buildStarterSeed(tpl.id);
      const miniature: FormMiniatureInput = {
        title: seed.title,
        description: seed.description,
        questions: seed.questions,
        settings: seed.settings,
      };
      return { tpl, miniature };
    });
  }, [galleryOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = forms.filter((f) => {
      if (filter === "published" && f.status !== "published") return false;
      if (filter === "draft" && f.status !== "draft") return false;
      if (filter === "quiz" && !f.quizEnabled) return false;
      if (filter === "event" && !f.eventEnabled) return false;
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sort === "responses") return b.responseCount - a.responseCount;
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "created") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    return list;
  }, [forms, search, filter, sort]);

  const activeFilterLabel = useMemo(() => {
    switch (filter) {
      case "published": return "Published";
      case "draft": return "Drafts";
      case "quiz": return "Quizzes";
      case "event": return "Event forms";
      default: return "All forms";
    }
  }, [filter]);

  const filterMenuItems = useMemo<Array<FormsMenuItem | "divider">>(
    () => [
      { id: "all", label: "All forms", checked: filter === "all", onSelect: () => setFilter("all") },
      { id: "published", label: "Published", icon: <Globe size={14} />, checked: filter === "published", onSelect: () => setFilter("published") },
      { id: "draft", label: "Drafts", icon: <FileCheck2 size={14} />, checked: filter === "draft", onSelect: () => setFilter("draft") },
      { id: "quiz", label: "Quizzes", icon: <GraduationCap size={14} />, checked: filter === "quiz", onSelect: () => setFilter("quiz") },
      { id: "event", label: "Event forms", icon: <CalendarCheck2 size={14} />, checked: filter === "event", onSelect: () => setFilter("event") },
    ],
    [filter],
  );

  const sortMenuItems = useMemo<Array<FormsMenuItem | "divider">>(
    () => [
      { id: "updated", label: "Last modified", checked: sort === "updated", onSelect: () => setSort("updated") },
      { id: "responses", label: "Most responses", checked: sort === "responses", onSelect: () => setSort("responses") },
      { id: "title", label: "Title (A–Z)", checked: sort === "title", onSelect: () => setSort("title") },
      { id: "created", label: "Newest created", checked: sort === "created", onSelect: () => setSort("created") },
    ],
    [sort],
  );

  const openQuickPreview = async (form: FormSummary) => {
    setQuickPreviewSummary(form);
    setQuickPreviewDetail(null);
    setQuickPreviewLoading(true);
    try {
      const env = await getForm(form.id);
      setQuickPreviewDetail(env.form);
    } catch {
      notify("Form preview could not be loaded.", "error");
      setQuickPreviewSummary(null);
    } finally {
      setQuickPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!quickPreviewSummary) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuickPreviewSummary(null);
        setQuickPreviewDetail(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [quickPreviewSummary]);

  useEffect(() => {
    if (!renaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !renameBusy) {
        setRenaming(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [renaming, renameBusy]);

  const copyLink = async (form: FormSummary) => {
    if (form.status !== "published" || !form.publicSlug) {
      notify("Publish this form first to share a public link.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildPublicFormUrl(form.publicSlug));
      notify("Public form link copied to clipboard.");
    } catch {
      notify("Could not copy link automatically.", "error");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming || !onRename) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    setRenameBusy(true);
    try {
      await onRename(renaming, trimmed);
      setRenaming(null);
    } finally {
      setRenameBusy(false);
    }
  };

  const buildFormMenu = (form: FormSummary): Array<FormsMenuItem | "divider"> => {
    const items: Array<FormsMenuItem | "divider"> = [
      {
        id: "open",
        label: "Open builder",
        icon: <FolderOpen size={14} />,
        onSelect: () => onOpenForm(form.id, "builder"),
      },
    ];
    if (onRename) {
      items.push({
        id: "rename",
        label: "Rename",
        icon: <Pencil size={14} />,
        onSelect: () => {
          setRenaming(form);
          setRenameDraft(form.title);
        },
      });
    }
    items.push(
      {
        id: "responses",
        label: `Responses (${form.responseCount.toLocaleString()})`,
        icon: <BarChart3 size={14} />,
        onSelect: () => onOpenForm(form.id, "responses"),
      },
      {
        id: "preview",
        label: "Quick preview",
        icon: <Eye size={14} />,
        onSelect: () => void openQuickPreview(form),
      },
      {
        id: "copy-link",
        label: "Copy public link",
        icon: <Link2 size={14} />,
        disabled: form.status !== "published" || !form.publicSlug,
        onSelect: () => void copyLink(form),
      },
      {
        id: "publish",
        label: form.status === "published" ? "Unpublish form" : "Publish form",
        icon: form.status === "published" ? <GlobeLock size={14} /> : <Globe size={14} />,
        onSelect: () => void onTogglePublish(form),
      },
      {
        id: "duplicate",
        label: "Duplicate",
        icon: <Copy size={14} />,
        onSelect: () => void onDuplicate(form),
      },
      "divider",
      {
        id: "delete",
        label: "Delete form",
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => setPendingDelete(form),
      },
    );
    return items;
  };

  const renderCard = (form: FormSummary) => {
    const isPublished = form.status === "published";
    const modifiedLabel = formatModifiedStamp(form.updatedAt);

    return (
      <li key={form.id} className="pf-card-item">
        <article
          className="pf-grid-card"
          onClick={() => onOpenForm(form.id, "builder")}
        >
          <div className="pf-card-preview">
            <FormCardPreview form={form} />
          </div>

          <div className="pf-card-footer">
            <div className="pf-card-main-row">
              <button
                type="button"
                className="pf-card-title-btn"
                title={form.title || "Untitled form"}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenForm(form.id, "builder");
                }}
              >
                {form.title || "Untitled form"}
              </button>
              <div
                className="pf-card-menu-wrap"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <FormsDropdownMenu
                  label={`Actions for ${form.title || "Untitled form"}`}
                  icon={<MoreVertical size={15} />}
                  buttonClassName="pf-icon-button pf-card-more"
                  items={buildFormMenu(form)}
                />
              </div>
            </div>

            <div className="pf-card-meta-row">
              <span className="pf-card-app-icon" aria-hidden="true">
                <LauncherModuleIcon id="forms" size={16} />
              </span>
              {isPublished && (
                <span
                  className="pf-card-shared-icon"
                  title="Published — accepting public link visits"
                  aria-label="Published"
                >
                  <Users size={13} aria-hidden="true" />
                </span>
              )}
              <span className="pf-card-modified">{modifiedLabel}</span>
            </div>
          </div>
        </article>
      </li>
    );
  };

  const renderListRow = (form: FormSummary) => {
    const isPublished = form.status === "published";
    const modifiedLabel = formatModifiedStamp(form.updatedAt);

    return (
      <li
        key={form.id}
        className="pf-list-row"
        onClick={() => onOpenForm(form.id, "builder")}
      >
        <span className="pf-card-app-icon" aria-hidden="true">
          <LauncherModuleIcon id="forms" size={18} />
        </span>

        <button
          type="button"
          className="pf-list-title-btn"
          onClick={(event) => {
            event.stopPropagation();
            onOpenForm(form.id, "builder");
          }}
        >
          <span className="pf-list-title">{form.title || "Untitled form"}</span>
          {isPublished && (
            <span className="pf-card-shared-icon" title="Published">
              <Users size={13} aria-hidden="true" />
            </span>
          )}
        </button>

        <span className="pf-list-badges">
          <Badge variant={isPublished ? "success-light" : "secondary"} size="xs">
            {isPublished ? "Published" : "Draft"}
          </Badge>
          {form.quizEnabled && (
            <Badge variant="info-light" size="xs">Quiz</Badge>
          )}
        </span>

        <button
          type="button"
          className="pf-list-responses-btn"
          title="View responses"
          onClick={(event) => {
            event.stopPropagation();
            onOpenForm(form.id, "responses");
          }}
        >
          <BarChart3 size={13} aria-hidden="true" />
          <span>{form.responseCount.toLocaleString()}</span>
        </button>

        <span className="pf-list-date">{modifiedLabel}</span>

        <div
          className="pf-card-menu-wrap"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <FormsDropdownMenu
            label={`Actions for ${form.title || "Untitled form"}`}
            icon={<MoreVertical size={15} />}
            buttonClassName="pf-icon-button pf-card-more"
            items={buildFormMenu(form)}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="pf-dashboard">
      {/* Top Google Forms-style creation & real template shelf (#F0F4F9) */}
      <section className="pf-start-shelf" aria-labelledby="pf-start-heading">
        <div className="pf-start-head">
          <h2 className="pf-start-title" id="pf-start-heading">Start a new form</h2>
          <div className="pf-start-controls">
            <button
              type="button"
              className={`pf-gallery-toggle ${galleryOpen ? "is-open" : ""}`}
              aria-expanded={galleryOpen}
              onClick={() => setGalleryOpen((prev) => !prev)}
            >
              <span>Template gallery</span>
              <ChevronsUpDown size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul className="pf-starter-grid">
          <li className="pf-starter-item">
            <button
              type="button"
              className="pf-starter-card"
              disabled={creating}
              onClick={() => void onCreate(buildStarterSeed("blank"))}
            >
              <span className="pf-starter-thumb">
                <BlankFormArtwork />
              </span>
              <span className="pf-starter-label">Blank form</span>
            </button>
          </li>

          {starterItems.map(({ tpl, miniature }) => (
            <li key={tpl.id} className="pf-starter-item">
              <button
                type="button"
                className="pf-starter-card"
                disabled={creating}
                title={tpl.description}
                onClick={() => void onCreate(buildStarterSeed(tpl.id))}
              >
                <span className="pf-starter-thumb">
                  <FormContentMiniature input={miniature} compact />
                </span>
                <span className="pf-starter-label">{tpl.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent forms toolbar + responsive preview card grid */}
      <section className="pf-recent-section" aria-labelledby="pf-recent-heading">
        <div className="pf-recent-bar">
          <h2 className="pf-recent-heading" id="pf-recent-heading">Recent forms</h2>

          <div className="pf-recent-controls">
            <label className="pf-home-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search forms…"
                aria-label="Search forms"
              />
              {search && (
                <button
                  type="button"
                  className="pf-search-clear"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </label>

            <FormsDropdownMenu
              label="Filter forms"
              align="end"
              buttonClassName={`pf-filter-box ${filter !== "all" ? "is-filtered" : ""}`}
              items={filterMenuItems}
            >
              <span className="pf-filter-box-text">{activeFilterLabel}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </FormsDropdownMenu>

            <div className="pf-recent-icon-group">
              <button
                type="button"
                className="pf-icon-button pf-toolbar-icon-btn"
                aria-label={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
                title={viewMode === "grid" ? "List view" : "Grid view"}
                onClick={() => changeViewMode(viewMode === "grid" ? "list" : "grid")}
              >
                {viewMode === "grid" ? (
                  <List size={15} aria-hidden="true" />
                ) : (
                  <LayoutGrid size={15} aria-hidden="true" />
                )}
              </button>

              <FormsDropdownMenu
                label="Sort forms"
                title="Sort options"
                icon={<ArrowUpDown size={15} />}
                buttonClassName="pf-icon-button pf-toolbar-icon-btn"
                items={sortMenuItems}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="pf-loading" role="status">
            <Spinner className="size-4" />
            <span>Loading your forms…</span>
          </div>
        ) : forms.length === 0 ? (
          <PersoraEmptyState
            className="pf-empty"
            moduleId="forms"
            title="No forms yet"
            description="Start from a blank form or choose a starter template above to collect responses, run scored quizzes, or manage event registrations."
            action={(
              <button
                type="button"
                className="pf-btn pf-btn-primary"
                disabled={creating}
                onClick={() => void onCreate(buildStarterSeed("blank"))}
              >
                Blank form
              </button>
            )}
          />
        ) : filtered.length === 0 ? (
          <PersoraEmptyState
            className="pf-empty"
            moduleId="forms"
            title="No matching forms"
            description="No forms match your current search or filter."
            action={(
              <button
                type="button"
                className="pf-btn"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          />
        ) : viewMode === "grid" ? (
          <ul className="pf-card-grid">
            {filtered.map(renderCard)}
          </ul>
        ) : (
          <ul className="pf-list">
            {filtered.map(renderListRow)}
          </ul>
        )}
      </section>

      {/* Rename Form Modal */}
      {renaming && (
        <ModalPortal>
          <div
            className="pf-modal-backdrop"
            role="presentation"
            onClick={() => !renameBusy && setRenaming(null)}
          >
            <div
              className="pf-rename-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pf-rename-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pf-rename-head">
                <h3 id="pf-rename-title">Rename form</h3>
                <button
                  type="button"
                  className="pf-icon-button"
                  aria-label="Close"
                  disabled={renameBusy}
                  onClick={() => setRenaming(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <form className="pf-rename-form" onSubmit={(e) => void submitRename(e)}>
                <label className="pf-rename-label" htmlFor="pf-rename-input">Form title</label>
                <input
                  id="pf-rename-input"
                  type="text"
                  className="pf-input"
                  value={renameDraft}
                  maxLength={160}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                />
                <div className="pf-rename-foot">
                  <button
                    type="button"
                    className="pf-btn"
                    disabled={renameBusy}
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pf-btn pf-btn-primary"
                    disabled={renameBusy || !renameDraft.trim()}
                  >
                    {renameBusy ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      <PersoraDeleteModal
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete "${pendingDelete.title || "Untitled form"}"?` : ""}
        description={
          pendingDelete
            ? `This permanently deletes the form, all ${pendingDelete.responseCount} submitted response${
                pendingDelete.responseCount === 1 ? "" : "s"
              }, and any uploaded images.`
            : undefined
        }
        confirmLabel="Delete permanently"
        busy={deleting}
        onCancel={() => !deleting && setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      {/* Quick Respondent Preview Modal */}
      {quickPreviewSummary && (
        <ModalPortal>
          <div
            className="pf-modal-backdrop"
            role="presentation"
            onClick={() => {
              setQuickPreviewSummary(null);
              setQuickPreviewDetail(null);
            }}
          >
            <div
              className="pf-preview-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Preview: ${quickPreviewSummary.title}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pf-preview-modal-header">
                <div className="pf-preview-modal-title">
                  <Eye size={15} />
                  <span>{quickPreviewSummary.title || "Untitled form"}</span>
                  <Badge variant="primary-light" size="xs">Respondent preview</Badge>
                </div>
                <div className="pf-preview-modal-actions">
                  {quickPreviewSummary.status === "published" && quickPreviewSummary.publicSlug && (
                    <a
                      href={buildPublicFormUrl(quickPreviewSummary.publicSlug)}
                      target="_blank"
                      rel="noreferrer"
                      className="pf-btn pf-btn-sm"
                    >
                      <ExternalLink size={13} />
                      <span>Public page</span>
                    </a>
                  )}
                  <button
                    type="button"
                    className="pf-btn pf-btn-sm pf-btn-primary"
                    onClick={() => {
                      const id = quickPreviewSummary.id;
                      setQuickPreviewSummary(null);
                      setQuickPreviewDetail(null);
                      onOpenForm(id, "builder");
                    }}
                  >
                    <Pencil size={13} />
                    <span>Edit form</span>
                  </button>
                  <button
                    type="button"
                    className="pf-icon-button"
                    aria-label="Close preview"
                    onClick={() => {
                      setQuickPreviewSummary(null);
                      setQuickPreviewDetail(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div
                className="pf-preview-modal-body pf-themed-surface"
                style={buildFormThemeCssVars(quickPreviewDetail?.settings)}
              >
                {quickPreviewLoading || !quickPreviewDetail ? (
                  <div className="pf-loading">
                    <Spinner className="size-4" />
                    <span>Loading form preview…</span>
                  </div>
                ) : (
                  <FormRespondentRenderer
                    title={quickPreviewDetail.title}
                    description={quickPreviewDetail.description}
                    headerImage={quickPreviewDetail.headerImage}
                    theme={quickPreviewDetail.settings.theme}
                    questions={quickPreviewDetail.questions}
                    quizEnabled={quickPreviewDetail.quizEnabled}
                    eventRegistration={quickPreviewDetail.settings.eventRegistration}
                    formId={quickPreviewDetail.id}
                    previewMode
                    onSubmit={() => {}}
                  />
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
