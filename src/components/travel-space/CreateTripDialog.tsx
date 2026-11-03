import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare,
  Compass,
  Edit3,
  ImagePlus,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import ModalPortal from "../ModalPortal";
import {
  Badge,
  Button,
  IconTile,
  PersoraDatePicker,
  PersoraDeleteModal,
  PersoraSegmentedControl,
  Progress,
  Spinner,
} from "@/design-system";
import {
  COMPANION_TYPES,
  DEFAULT_BUDGET_CATEGORIES,
  TASK_PRIORITIES,
  TRAVEL_CURRENCIES,
  TRIP_TYPES,
  computeContributionSummary,
  formatCoordinatePair,
  formatTravelMoney,
  fromMinor,
  isValidDate,
  splitEqualMinor,
  toMinor,
  tripDurationDays,
  type BudgetScope,
  type CompanionType,
  type TaskPriority,
  type TripType,
} from "../../../cloudflare/travel-space-rules.js";
import type { AppUser, PersoraContact } from "../../types";
import {
  describeTravelError,
  getDestinationStopLabel,
  MAX_TRIP_COVER_MB,
  validateTripCoverFile,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import { TripCoverMedia } from "./TripCoverMedia";
import { TravelInteractiveMap, type MapDestinationPoint } from "./TravelInteractiveMap";

interface CompanionDraft {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  contactId: string | null;
  source: "contact" | "persora_user" | "temporary";
  role: "editor" | "expense_contributor" | "viewer";
  responsibility: string;
  plannedAmount: string;
  contributedAmount: string;
  contributedOn: string;
  note: string;
}

interface CategoryDraft {
  id?: string;
  name: string;
  color: string;
  isDefault: boolean;
  allocatedAmount: string;
}

interface InitialTaskDraft {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  assigneeIndex: number; // -1 = unassigned, 0 = owner, 1..N = companion index + 1
}

interface Props {
  user: AppUser;
  contacts: PersoraContact[];
  existingWorkspace?: TravelWorkspace | null;
  onClose: () => void;
  onSubmit: (
    payload: Record<string, any>,
    coverFile: File | null,
    options?: {
      removeCover?: boolean;
      onUploadProgress?: (percent: number) => void;
    },
  ) => Promise<void>;
}

const STEPS = [
  { number: 1, key: "basics", label: "Basics", title: "Trip basics", description: "Give your trip a clear name and choose travel dates." },
  { number: 2, key: "destinations", label: "Destinations", title: "Map & destinations", description: "Pin stops on the map or continue if destinations are undecided." },
  { number: 3, key: "travellers", label: "Travellers", title: "Travellers & companions", description: "Choose who is travelling and assign workspace permissions." },
  { number: 4, key: "budget", label: "Budget", title: "Budget configuration", description: "Configure personal or combined group budget and category caps." },
  { number: 5, key: "tasks", label: "Tasks", title: "Initial preparation tasks", description: "Add optional pre-trip checklist items or skip for later." },
  { number: 6, key: "review", label: "Review", title: "Review & create", description: "Confirm your trip setup before saving to TravelSpace." },
] as const;

const COMPANION_LABELS: Record<CompanionType, string> = {
  solo: "Solo",
  couple: "Couple",
  family: "Family",
  friends: "Friends",
  group: "Group",
};

const TRIP_TYPE_LABELS: Record<TripType, string> = {
  vacation: "Vacation",
  business: "Business",
  "family-tour": "Family Tour",
  educational: "Educational",
  adventure: "Adventure",
  religious: "Religious",
  other: "Other",
};

const STARTER_TASK_IDEAS = [
  "Verify passport & visa requirements",
  "Confirm accommodation booking",
  "Book primary transport tickets",
  "Prepare travel packing list",
];

function localUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStartEnd(): { start: string; end: string } {
  const now = new Date();
  now.setDate(now.getDate() + 7);
  const s = now.toISOString().slice(0, 10);
  now.setDate(now.getDate() + 4);
  const e = now.toISOString().slice(0, 10);
  return { start: s, end: e };
}

export default function CreateTripDialog({
  user,
  contacts,
  existingWorkspace = null,
  onClose,
  onSubmit,
}: Props) {
  const isEdit = Boolean(existingWorkspace);
  const dialogId = useId();
  const defaults = useMemo(() => defaultStartEnd(), []);
  const idempotencyKeyRef = useRef<string>(existingWorkspace?.trip.id || localUid());

  const [step, setStep] = useState<number>(1);
  const [highestVisitedStep, setHighestVisitedStep] = useState<number>(isEdit ? 6 : 1);
  const [mapMounted, setMapMounted] = useState<boolean>(
    () => isEdit || Boolean(existingWorkspace?.destinations?.length),
  );
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (step === 2) setMapMounted(true);
  }, [step]);

  // Step 1: Basics
  const [title, setTitle] = useState(existingWorkspace?.trip.title || "");
  const [description, setDescription] = useState(existingWorkspace?.trip.description || "");
  const [startDate, setStartDate] = useState(existingWorkspace?.trip.startDate || defaults.start);
  const [endDate, setEndDate] = useState(existingWorkspace?.trip.endDate || defaults.end);
  const [tripType, setTripType] = useState<TripType | "">(existingWorkspace?.trip.tripType || "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverRemoved, setCoverRemoved] = useState<boolean>(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(objectUrl);
    return () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore revoke errors
      }
    };
  }, [coverFile]);

  const handleCoverFileSelect = (file: File | null) => {
    if (!file) return;
    const err = validateTripCoverFile(file);
    if (err) {
      setCoverError(err);
      if (coverInputRef.current) coverInputRef.current.value = "";
      return;
    }
    setCoverError(null);
    setCoverFile(file);
    setCoverRemoved(false);
    setDirty(true);
  };

  const handleClearSelectedCover = () => {
    setCoverError(null);
    if (coverFile) {
      setCoverFile(null);
      if (coverInputRef.current) coverInputRef.current.value = "";
      setDirty(true);
      return;
    }
    if (existingWorkspace?.trip.hasCover && !coverRemoved) {
      setCoverRemoved(true);
      setDirty(true);
    }
  };

  // Step 2: Coordinate-Only Destinations (Section 20)
  const [destinations, setDestinations] = useState<MapDestinationPoint[]>(() =>
    (existingWorkspace?.destinations || []).map((d, idx) => ({
      id: d.id || localUid(),
      latitude: d.latitude,
      longitude: d.longitude,
      orderIndex: idx,
    })),
  );

  // Step 3: Travellers
  const [companionType, setCompanionType] = useState<CompanionType>(
    existingWorkspace?.trip.companionType || "solo",
  );
  const [travelerCount, setTravelerCount] = useState<number>(
    existingWorkspace?.trip.travelerCount || 1,
  );
  const [ownerPlanned, setOwnerPlanned] = useState<string>(() => {
    if (!existingWorkspace) return "";
    const ownerTrav = existingWorkspace.travellers.find((t) => t.isOwner);
    const row = existingWorkspace.contributions.find((c) => c.travellerId === ownerTrav?.id);
    return row && row.plannedAmount > 0 ? String(row.plannedAmount) : "";
  });
  const [ownerContributed, setOwnerContributed] = useState<string>(() => {
    if (!existingWorkspace) return "";
    const ownerTrav = existingWorkspace.travellers.find((t) => t.isOwner);
    const row = existingWorkspace.contributions.find((c) => c.travellerId === ownerTrav?.id);
    return row && row.contributedAmount > 0 ? String(row.contributedAmount) : "";
  });

  const [companions, setCompanions] = useState<CompanionDraft[]>(() => {
    if (!existingWorkspace) return [];
    return existingWorkspace.travellers
      .filter((t) => !t.isOwner)
      .map((t) => {
        const contrib = existingWorkspace.contributions.find((c) => c.travellerId === t.id);
        return {
          id: t.id,
          fullName: t.fullName,
          email: t.email || "",
          phone: t.phone || "",
          contactId: t.contactId || null,
          source: t.contactId ? "contact" : t.email ? "persora_user" : "temporary",
          role: (t.role === "owner" ? "editor" : t.role) as CompanionDraft["role"],
          responsibility: t.responsibility || "",
          plannedAmount: contrib && contrib.plannedAmount > 0 ? String(contrib.plannedAmount) : "",
          contributedAmount: contrib && contrib.contributedAmount > 0 ? String(contrib.contributedAmount) : "",
          contributedOn: contrib?.contributedOn || "",
          note: contrib?.note || "",
        };
      });
  });

  // Add companion quick inputs
  const [addMode, setAddMode] = useState<"contact" | "persora_user" | "temporary">("temporary");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [newCompanionName, setNewCompanionName] = useState("");
  const [newCompanionEmail, setNewCompanionEmail] = useState("");
  const [newCompanionPhone, setNewCompanionPhone] = useState("");
  const [newCompanionRole, setNewCompanionRole] = useState<"editor" | "expense_contributor" | "viewer">("editor");

  // Step 4: Budget Configuration
  const [primaryCurrency, setPrimaryCurrency] = useState<string>(
    existingWorkspace?.trip.primaryCurrency || "BDT",
  );
  const [budgetScope, setBudgetScope] = useState<BudgetScope>(
    existingWorkspace?.trip.budgetScope || "personal",
  );
  const [personalBudget, setPersonalBudget] = useState<string>(
    existingWorkspace && existingWorkspace.trip.personalBudget > 0
      ? String(existingWorkspace.trip.personalBudget)
      : "",
  );
  const [groupTotalInput, setGroupTotalInput] = useState<string>(() => {
    if (existingWorkspace?.trip.budgetScope === "group" && existingWorkspace.budgetOverview.totalPlannedBudget > 0) {
      return String(existingWorkspace.budgetOverview.totalPlannedBudget);
    }
    return "";
  });
  const [contribSplitMode, setContribSplitMode] = useState<"equal" | "custom">("equal");

  const [categories, setCategories] = useState<CategoryDraft[]>(() => {
    if (existingWorkspace && existingWorkspace.categories.length > 0) {
      return existingWorkspace.categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        isDefault: c.isDefault,
        allocatedAmount: c.allocatedAmount > 0 ? String(c.allocatedAmount) : "",
      }));
    }
    return DEFAULT_BUDGET_CATEGORIES.map((c) => ({
      name: c.name,
      color: c.color,
      isDefault: true,
      allocatedAmount: "",
    }));
  });
  const [customCategoryName, setCustomCategoryName] = useState("");

  // Step 5: Initial Tasks (Create mode)
  const [initialTasks, setInitialTasks] = useState<InitialTaskDraft[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("normal");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskAssigneeIdx, setTaskAssigneeIdx] = useState<number>(-1);

  // Validation & Submit states
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ownerDisplayName = user.fullName || user.email || "Me (Owner)";

  // Enforce Solo -> travelerCount = 1 & Personal Budget automatically (Section 6 Steps 3 & 4)
  useEffect(() => {
    if (companionType === "solo") {
      setTravelerCount(1);
      if (budgetScope === "group") {
        setBudgetScope("personal");
      }
    } else if (companionType === "couple" && travelerCount < 2) {
      setTravelerCount(Math.max(2, 1 + companions.length));
    } else if (travelerCount < 1 + companions.length) {
      setTravelerCount(1 + companions.length);
    }
  }, [companionType, companions.length, budgetScope, travelerCount]);

  // All traveller slots used for Group Budget contributions & Task assignment
  const effectiveTravellers = useMemo(() => {
    const list: Array<{ label: string; isOwner: boolean; companionIdx: number }> = [
      { label: `${ownerDisplayName} (Owner)`, isOwner: true, companionIdx: -1 },
    ];
    if (companionType !== "solo") {
      companions.forEach((c, idx) => {
        list.push({ label: c.fullName, isOwner: false, companionIdx: idx });
      });
      while (list.length < travelerCount && list.length < 30) {
        list.push({ label: `Traveller ${list.length + 1}`, isOwner: false, companionIdx: -2 });
      }
    }
    return list;
  }, [ownerDisplayName, companionType, companions, travelerCount]);

  // Equal contribution distribution helper
  const applyEqualGroupSplit = (totalStr: string, slotCount = effectiveTravellers.length) => {
    let totalMinorVal = 0;
    try {
      totalMinorVal = Math.max(0, toMinor(totalStr || 0, primaryCurrency));
    } catch {
      totalMinorVal = 0;
    }
    const shares = splitEqualMinor(totalMinorVal, Math.max(1, slotCount));
    setOwnerPlanned(shares[0] > 0 ? String(fromMinor(shares[0], primaryCurrency)) : "");
    setCompanions((prev) =>
      prev.map((c, idx) => ({
        ...c,
        plannedAmount:
          shares[idx + 1] && shares[idx + 1] > 0
            ? String(fromMinor(shares[idx + 1], primaryCurrency))
            : "",
      })),
    );
  };

  // Recompute group contribution summary & category allocation totals live
  const contributionPreview = useMemo(() => {
    if (companionType === "solo" || budgetScope !== "group") {
      return {
        rows: [],
        totalPlannedMinor: 0,
        totalCollectedMinor: 0,
        totalPendingMinor: 0,
        totalPlanned: 0,
        totalCollected: 0,
        totalPending: 0,
      };
    }

    if (contribSplitMode === "equal") {
      let totMinor = 0;
      try {
        totMinor = Math.max(0, toMinor(groupTotalInput || 0, primaryCurrency));
      } catch {
        totMinor = 0;
      }
      const shares = splitEqualMinor(totMinor, effectiveTravellers.length);
      const raw = effectiveTravellers.map((slot, idx) => {
        const planned = fromMinor(shares[idx] || 0, primaryCurrency);
        const contributed = slot.isOwner
          ? Number(ownerContributed || 0)
          : slot.companionIdx >= 0
            ? Number(companions[slot.companionIdx]?.contributedAmount || 0)
            : 0;
        return {
          fullName: slot.label,
          plannedAmount: planned,
          contributedAmount: contributed,
        };
      });
      return computeContributionSummary(raw, primaryCurrency);
    }

    const raw = effectiveTravellers.map((slot) => {
      if (slot.isOwner) {
        return {
          fullName: slot.label,
          plannedAmount: Number(ownerPlanned || 0),
          contributedAmount: Number(ownerContributed || 0),
        };
      }
      if (slot.companionIdx >= 0) {
        const c = companions[slot.companionIdx];
        return {
          fullName: slot.label,
          plannedAmount: Number(c?.plannedAmount || 0),
          contributedAmount: Number(c?.contributedAmount || 0),
        };
      }
      return {
        fullName: slot.label,
        plannedAmount: 0,
        contributedAmount: 0,
      };
    });
    return computeContributionSummary(raw, primaryCurrency);
  }, [
    companionType,
    budgetScope,
    contribSplitMode,
    groupTotalInput,
    effectiveTravellers,
    ownerPlanned,
    ownerContributed,
    companions,
    primaryCurrency,
  ]);

  const plannedBudgetMinor = useMemo(() => {
    try {
      if (budgetScope === "group" && companionType !== "solo") {
        return contributionPreview.totalPlannedMinor;
      }
      if (budgetScope === "personal") {
        return Math.max(0, toMinor(personalBudget || 0, primaryCurrency));
      }
      return 0;
    } catch {
      return 0;
    }
  }, [budgetScope, companionType, contributionPreview.totalPlannedMinor, personalBudget, primaryCurrency]);

  const allocatedMinorTotal = useMemo(() => {
    return categories.reduce((sum, cat) => {
      try {
        return sum + Math.max(0, toMinor(cat.allocatedAmount || 0, primaryCurrency));
      } catch {
        return sum;
      }
    }, 0);
  }, [categories, primaryCurrency]);

  const plannedBudgetAmount = fromMinor(plannedBudgetMinor, primaryCurrency);
  const allocatedAmountTotal = fromMinor(allocatedMinorTotal, primaryCurrency);
  const unallocatedAmount = fromMinor(Math.max(0, plannedBudgetMinor - allocatedMinorTotal), primaryCurrency);
  const overAllocated = plannedBudgetMinor > 0 && allocatedMinorTotal > plannedBudgetMinor;
  const durationDays = tripDurationDays(startDate, endDate);

  // Close with dirty draft protection
  const requestClose = useCallback(() => {
    if (submitting) return;
    if (dirty) {
      setConfirmDiscardOpen(true);
    } else {
      onClose();
    }
  }, [submitting, dirty, onClose]);

  // Escape handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmDiscardOpen && !submitting) {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDiscardOpen, submitting, requestClose]);

  const validateStep = (targetStep: number): string | null => {
    if (targetStep === 1) {
      if (!title.trim()) return "Enter a trip title to continue.";
      if (title.trim().length > 140) return "Trip title must be 140 characters or fewer.";
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return "Select valid start and end dates.";
      }
      if (endDate < startDate) {
        return "Trip end date cannot be earlier than the start date.";
      }
      if (tripDurationDays(startDate, endDate) > 366) {
        return "Keep a single trip within 366 days.";
      }
    }
    if (targetStep === 3) {
      if (companionType !== "solo" && (travelerCount < 1 || travelerCount > 200)) {
        return "Number of travellers must be between 1 and 200.";
      }
      if (companionType === "couple" && travelerCount < 2) {
        return "Couple trips include at least 2 travellers.";
      }
    }
    if (targetStep === 4) {
      if (budgetScope === "personal" && personalBudget.trim() !== "") {
        const val = Number(personalBudget);
        if (!Number.isFinite(val) || val < 0) return "Enter a valid non-negative personal budget.";
      }
      if (overAllocated) {
        return `Total category allocations (${formatTravelMoney(allocatedAmountTotal, primaryCurrency)}) cannot exceed the planned budget (${formatTravelMoney(plannedBudgetAmount, primaryCurrency)}).`;
      }
    }
    return null;
  };

  const goToStep = (next: number) => {
    if (next > step) {
      for (let s = step; s < next; s += 1) {
        const err = validateStep(s);
        if (err) {
          setStep(s);
          setStepError(err);
          return;
        }
      }
    }
    setStepError(null);
    setStep(next);
    setHighestVisitedStep((prev) => Math.max(prev, next));
  };

  const handleAddCompanion = () => {
    if (addMode === "contact") {
      const contact = contacts.find((c) => c.id === selectedContactId);
      if (!contact) {
        setStepError("Choose a contact from your Persora Contacts list.");
        return;
      }
      if (companions.some((c) => c.contactId === contact.id)) {
        setStepError(`${contact.name} is already added to this trip.`);
        return;
      }
      const nextList: CompanionDraft[] = [
        ...companions,
        {
          id: localUid(),
          fullName: contact.name,
          email: contact.email || "",
          phone: contact.phoneNumbers?.[0]?.number || "",
          contactId: contact.id,
          source: "contact",
          role: newCompanionRole,
          responsibility: "",
          plannedAmount: "",
          contributedAmount: "",
          contributedOn: "",
          note: "",
        },
      ];
      setCompanions(nextList);
      setTravelerCount((cur) => Math.max(cur, 1 + nextList.length));
      setSelectedContactId("");
      setStepError(null);
      setDirty(true);
      return;
    }

    const cleanName = newCompanionName.trim();
    const cleanEmail = newCompanionEmail.trim();
    if (!cleanName) {
      setStepError("Enter the traveller's name.");
      return;
    }
    if (addMode === "persora_user" && (!cleanEmail || !cleanEmail.includes("@"))) {
      setStepError("Enter a valid email address to invite a Persora user.");
      return;
    }

    const nextList: CompanionDraft[] = [
      ...companions,
      {
        id: localUid(),
        fullName: cleanName,
        email: cleanEmail,
        phone: newCompanionPhone.trim(),
        contactId: null,
        source: addMode,
        role: newCompanionRole,
        responsibility: "",
        plannedAmount: "",
        contributedAmount: "",
        contributedOn: "",
        note: "",
      },
    ];
    setCompanions(nextList);
    setTravelerCount((cur) => Math.max(cur, 1 + nextList.length));
    setNewCompanionName("");
    setNewCompanionEmail("");
    setNewCompanionPhone("");
    setStepError(null);
    setDirty(true);
  };

  const handleAddCategory = () => {
    const clean = customCategoryName.trim();
    if (!clean) return;
    if (categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      setStepError(`"${clean}" already exists in budget categories.`);
      return;
    }
    setCategories((prev) => [
      ...prev,
      { name: clean, color: "slate", isDefault: false, allocatedAmount: "" },
    ]);
    setCustomCategoryName("");
    setStepError(null);
    setDirty(true);
  };

  const handleAddInitialTask = (presetTitle?: string) => {
    const cleanTitle = (presetTitle ?? taskTitle).trim();
    if (!cleanTitle) return;
    setInitialTasks((prev) => [
      ...prev,
      {
        id: localUid(),
        title: cleanTitle,
        description: presetTitle ? "" : taskDesc.trim(),
        priority: presetTitle ? "normal" : taskPriority,
        dueDate: presetTitle ? "" : taskDueDate,
        assigneeIndex: presetTitle ? -1 : taskAssigneeIdx,
      },
    ]);
    if (!presetTitle) {
      setTaskTitle("");
      setTaskDesc("");
      setTaskPriority("normal");
      setTaskDueDate("");
      setTaskAssigneeIdx(-1);
    }
    setDirty(true);
  };

  const handleFinalSubmit = async () => {
    if (submitting) return;
    for (const s of [1, 3, 4]) {
      const err = validateStep(s);
      if (err) {
        setStep(s);
        setStepError(err);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    setStepError(null);

    try {
      // Strictly send coordinate-only destinations (id, latitude, longitude, orderIndex — NEVER names/addresses)
      const cleanDestinations = destinations.map((d, idx) => ({
        latitude: d.latitude,
        longitude: d.longitude,
        orderIndex: idx,
      }));

      const effectiveScope: BudgetScope = companionType === "solo" ? "personal" : budgetScope;

      let contributionsPayload: any[] = [];
      if (effectiveScope === "group" && companionType !== "solo") {
        contributionsPayload = contributionPreview.rows.map((r: any) => ({
          fullName: r.fullName,
          plannedAmount: r.plannedAmount,
          contributedAmount: r.contributedAmount,
        }));
      }

      const payload: Record<string, any> = {
        ...(!isEdit ? { id: idempotencyKeyRef.current } : {}),
        title: title.trim(),
        description: description.trim(),
        startDate,
        endDate,
        companionType,
        travelerCount: companionType === "solo" ? 1 : Math.max(travelerCount, 1 + companions.length),
        tripType: tripType || null,
        primaryCurrency,
        budgetScope: effectiveScope,
        personalBudget: effectiveScope === "personal" ? Number(personalBudget || 0) : 0,
        destinations: cleanDestinations,
        travellers:
          companionType === "solo"
            ? []
            : companions.map((c) => ({
                fullName: c.fullName,
                email: c.email,
                phone: c.phone,
                contactId: c.contactId,
                role: c.role,
                responsibility: c.responsibility,
              })),
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          isDefault: c.isDefault,
          allocatedAmount: Number(c.allocatedAmount || 0),
        })),
        contributions: contributionsPayload,
        initialTasks: initialTasks.map((t) => ({
          title: t.title,
          description: t.description,
          priority: t.priority,
          dueDate: t.dueDate || null,
          assigneeIndex: t.assigneeIndex >= 0 ? t.assigneeIndex : null,
          status: "todo",
        })),
      };

      setUploadProgress(coverFile ? 0 : null);
      await onSubmit(payload, coverFile, {
        removeCover: coverRemoved && !coverFile,
        onUploadProgress: (pct) => setUploadProgress(pct),
      });
    } catch (err) {
      setSubmitError(describeTravelError(err, "Could not save trip. Your form entries have been preserved."));
      setUploadProgress(null);
      setSubmitting(false);
    }
  };

  const activeStepMeta = STEPS[step - 1];
  const progressValue = Math.round((step / STEPS.length) * 100);

  return (
    <ModalPortal>
      <div
        className="ts-onboarding-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !submitting) {
            requestClose();
          }
        }}
      >
        <section
          className={`ts-onboarding-modal ${step === 2 ? "is-map-step" : ""}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`ts-onb-title-${dialogId}`}
        >
          {/* Compact Persora Header */}
          <header className="ts-onboarding-header">
            <div className="ts-onboarding-header-top">
              <div className="ts-onboarding-title-group">
                <IconTile variant="soft" size="sm" className="text-primary">
                  <Compass size={16} />
                </IconTile>
                <div>
                  <div className="ts-onboarding-eyebrow">
                    <span>{isEdit ? "Edit Trip" : "Create Trip"}</span>
                    <span>·</span>
                    <span>Step {step} of {STEPS.length}</span>
                  </div>
                  <h2 id={`ts-onb-title-${dialogId}`}>{activeStepMeta.title}</h2>
                  <p>{activeStepMeta.description}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close trip onboarding"
                disabled={submitting}
                onClick={requestClose}
              >
                <X size={16} />
              </Button>
            </div>

            {/* Compact Step Progress Bar + Clickable Step Pills */}
            <div className="ts-onboarding-progress-wrap">
              <Progress value={progressValue} className="h-1" />
              <nav className="ts-onboarding-steps" aria-label="Onboarding steps">
                {STEPS.map((s) => {
                  const isCurrent = s.number === step;
                  const isDone = s.number < step;
                  const canJump = isEdit || s.number <= highestVisitedStep;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      disabled={!canJump || submitting}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`ts-onboarding-step-pill ${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`.trim()}
                      onClick={() => goToStep(s.number)}
                    >
                      <span className="ts-onboarding-step-num">
                        {isDone ? <Check size={11} /> : s.number}
                      </span>
                      <span className="ts-onboarding-step-label">{s.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </header>

          {/* Single Scrollable Step Body */}
          <div className="ts-onboarding-body">
            {stepError ? (
              <div className="ts-inline-alert is-error" role="alert">
                <span>{stepError}</span>
              </div>
            ) : null}

            {submitError ? (
              <div className="ts-inline-alert is-error" role="alert">
                <span>{submitError}</span>
              </div>
            ) : null}

            {/* STEP 1 — TRIP BASICS */}
            {step === 1 && (
              <div className="ts-step-grid">
                <label className="field-label is-full" htmlFor={`ts-trip-title-${dialogId}`}>
                  <span>
                    Trip Title <span className="required-star">*</span>
                  </span>
                  <input
                    id={`ts-trip-title-${dialogId}`}
                    type="text"
                    maxLength={140}
                    autoFocus
                    placeholder="e.g. Autumn in Kyoto, Sajek Family Retreat, Singapore Conference"
                    value={title}
                    aria-invalid={Boolean(stepError && !title.trim())}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                      if (stepError) setStepError(null);
                    }}
                  />
                </label>

                <div className="field-label">
                  <span>
                    Start Date <span className="required-star">*</span>
                  </span>
                  <PersoraDatePicker
                    id={`ts-trip-start-${dialogId}`}
                    value={startDate}
                    rangeStart={startDate}
                    rangeEnd={endDate}
                    required
                    ariaLabel="Trip start date"
                    onChange={(next) => {
                      setStartDate(next);
                      if (next && endDate && endDate < next) {
                        setEndDate(next);
                      }
                      setDirty(true);
                      if (stepError) setStepError(null);
                    }}
                  />
                </div>

                <div className="field-label">
                  <span>
                    End Date <span className="required-star">*</span>
                    {durationDays > 0 ? <small>{durationDays} {durationDays === 1 ? "day" : "days"}</small> : null}
                  </span>
                  <PersoraDatePicker
                    id={`ts-trip-end-${dialogId}`}
                    value={endDate}
                    min={startDate || undefined}
                    rangeStart={startDate}
                    rangeEnd={endDate}
                    required
                    ariaLabel="Trip end date"
                    ariaInvalid={Boolean(startDate && endDate && endDate < startDate)}
                    onChange={(next) => {
                      setEndDate(next);
                      setDirty(true);
                      if (stepError) setStepError(null);
                    }}
                  />
                </div>

                <label className="field-label" htmlFor={`ts-trip-type-${dialogId}`}>
                  <span>
                    Trip Type <small>Optional</small>
                  </span>
                  <select
                    id={`ts-trip-type-${dialogId}`}
                    value={tripType}
                    onChange={(e) => {
                      setTripType(e.target.value as TripType | "");
                      setDirty(true);
                    }}
                  >
                    <option value="">Not specified</option>
                    {TRIP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TRIP_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field-label is-full">
                  <span>
                    Cover Image <small>Optional · JPG, PNG, WebP or GIF up to {MAX_TRIP_COVER_MB} MB</small>
                  </span>
                  <input
                    ref={coverInputRef}
                    id={`ts-trip-cover-${dialogId}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="ts-sr-only-file"
                    onChange={(e) => handleCoverFileSelect(e.target.files?.[0] || null)}
                  />
                  {coverPreviewUrl || (existingWorkspace?.trip.hasCover && !coverRemoved) ? (
                    <div className="ts-cover-picker-preview">
                      <TripCoverMedia
                        user={user}
                        trip={existingWorkspace?.trip || null}
                        previewUrl={coverPreviewUrl}
                        forceFallback={coverRemoved}
                        className="ts-cover-picker-thumb"
                        alt={title.trim() ? `${title.trim()} cover preview` : "Trip cover preview"}
                      />
                      <div className="ts-cover-picker-info">
                        <div className="ts-cover-picker-meta">
                          <strong>
                            {coverFile
                              ? coverFile.name
                              : existingWorkspace?.trip.coverFileName || "Current trip cover"}
                          </strong>
                          <small>
                            {coverFile
                              ? `${Math.max(1, Math.round(coverFile.size / 1024))} KB · Ready to upload`
                              : "Saved in private storage"}
                          </small>
                        </div>
                        <div className="ts-cover-picker-actions">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => coverInputRef.current?.click()}
                          >
                            <ImagePlus size={12} /> Change image
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={handleClearSelectedCover}
                          >
                            <Trash2 size={12} /> Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ts-cover-dropzone"
                      onClick={() => coverInputRef.current?.click()}
                    >
                      <ImagePlus size={16} />
                      <span>Choose cover image</span>
                      <small>16:9 landscape recommended</small>
                    </button>
                  )}
                  {coverError ? (
                    <span className="ts-inline-field-error" role="alert">
                      {coverError}
                    </span>
                  ) : null}
                </div>

                <label className="field-label is-full" htmlFor={`ts-trip-desc-${dialogId}`}>
                  <span>
                    Description <small>Optional</small>
                  </span>
                  <textarea
                    id={`ts-trip-desc-${dialogId}`}
                    rows={3}
                    maxLength={2000}
                    placeholder="Short overview, goals, or travel notes..."
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
              </div>
            )}

            {/* STEP 2 — DESTINATIONS (Mounted on first visit to Step 2 and kept alive across steps) */}
            {mapMounted && (
              <div className={step === 2 ? "ts-step-map-container" : "ts-step-map-hidden"} aria-hidden={step !== 2}>
                <TravelInteractiveMap
                  user={user}
                  visible={step === 2}
                  destinations={destinations}
                  onChange={(next) => {
                    setDestinations(next);
                    setDirty(true);
                  }}
                  height={390}
                  emptyHint="Search a destination, click anywhere on the map, or paste coordinates / Google Maps URL. You can also continue with 0 stops."
                />
              </div>
            )}

            {/* STEP 3 — TRAVELLERS */}
            {step === 3 && (
              <div className="ts-step-stack">
                <div className="ts-step-row-split">
                  <div className="field-label">
                    <span>Companion Type</span>
                    <PersoraSegmentedControl<CompanionType>
                      ariaLabel="Companion type"
                      value={companionType}
                      onChange={(val) => {
                        setCompanionType(val);
                        setDirty(true);
                        setStepError(null);
                      }}
                      options={COMPANION_TYPES.map((ct) => ({
                        value: ct,
                        label: COMPANION_LABELS[ct],
                      }))}
                    />
                  </div>

                  <label className="field-label ts-count-field" htmlFor={`ts-trav-count-${dialogId}`}>
                    <span>Travellers</span>
                    <input
                      id={`ts-trav-count-${dialogId}`}
                      type="number"
                      min={companionType === "couple" ? 2 : 1}
                      max={200}
                      disabled={companionType === "solo"}
                      value={companionType === "solo" ? 1 : travelerCount}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(200, Number(e.target.value) || 1));
                        setTravelerCount(v);
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>

                {companionType === "solo" ? (
                  <div className="ts-subtle-box">
                    <div className="ts-subtle-box-row">
                      <IconTile variant="soft" size="sm" className="text-primary">
                        <Users size={15} />
                      </IconTile>
                      <div>
                        <strong>Solo personal trip</strong>
                        <p>
                          You ({ownerDisplayName}) are the sole traveller. Budget automatically uses Personal Budget mode without group contribution or expense-splitting clutter.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ts-step-stack">
                    <div className="ts-subtle-box">
                      <div className="ts-section-head-compact">
                        <div>
                          <h4>Add Travellers</h4>
                          <p>Link from Persora Contacts, invite a Persora user, or add a temporary companion.</p>
                        </div>
                        <PersoraSegmentedControl<"temporary" | "contact" | "persora_user">
                          size="sm"
                          ariaLabel="Traveller source"
                          value={addMode}
                          onChange={(m) => {
                            setAddMode(m);
                            setStepError(null);
                          }}
                          options={[
                            { value: "temporary", label: "Temporary" },
                            { value: "contact", label: `Contacts (${contacts.length})` },
                            { value: "persora_user", label: "Persora User" },
                          ]}
                        />
                      </div>

                      <div className="ts-add-companion-row">
                        {addMode === "contact" ? (
                          <select
                            value={selectedContactId}
                            onChange={(e) => setSelectedContactId(e.target.value)}
                            aria-label="Select Persora Contact"
                          >
                            <option value="">
                              {contacts.length === 0 ? "No saved Persora Contacts yet" : "Select a contact..."}
                            </option>
                            {contacts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.email ? ` (${c.email})` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <input
                              type="text"
                              placeholder="Full name *"
                              value={newCompanionName}
                              onChange={(e) => setNewCompanionName(e.target.value)}
                              aria-label="Traveller full name"
                            />
                            {addMode === "persora_user" ? (
                              <input
                                type="email"
                                placeholder="Persora account email *"
                                value={newCompanionEmail}
                                onChange={(e) => setNewCompanionEmail(e.target.value)}
                                aria-label="Persora user email"
                              />
                            ) : (
                              <input
                                type="tel"
                                placeholder="Phone (optional)"
                                value={newCompanionPhone}
                                onChange={(e) => setNewCompanionPhone(e.target.value)}
                                aria-label="Traveller phone"
                              />
                            )}
                          </>
                        )}

                        <select
                          value={newCompanionRole}
                          onChange={(e) => setNewCompanionRole(e.target.value as CompanionDraft["role"])}
                          aria-label="Traveller permission role"
                        >
                          <option value="editor">Editor</option>
                          <option value="expense_contributor">Expense Contributor</option>
                          <option value="viewer">Viewer</option>
                        </select>

                        <Button type="button" variant="secondary" size="sm" onClick={handleAddCompanion}>
                          <UserPlus size={14} /> Add
                        </Button>
                      </div>
                    </div>

                    <div className="ts-traveller-list">
                      <div className="ts-traveller-row is-owner">
                        <div>
                          <strong>{ownerDisplayName}</strong>
                          <small>{user.email || "Trip creator"}</small>
                        </div>
                        <Badge variant="primary-light" size="sm">Owner</Badge>
                      </div>

                      {companions.map((comp, idx) => (
                        <div key={comp.id} className="ts-traveller-row">
                          <div>
                            <strong>{comp.fullName}</strong>
                            <small>
                              {comp.source === "contact"
                                ? "Linked Persora Contact"
                                : comp.source === "persora_user"
                                  ? comp.email
                                  : comp.phone || "Temporary traveller"}
                            </small>
                          </div>
                          <div className="ts-traveller-row-actions">
                            <select
                              value={comp.role}
                              aria-label={`Role for ${comp.fullName}`}
                              onChange={(e) => {
                                const role = e.target.value as CompanionDraft["role"];
                                setCompanions((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, role } : item)),
                                );
                                setDirty(true);
                              }}
                            >
                              <option value="editor">Editor</option>
                              <option value="expense_contributor">Expense Contributor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${comp.fullName}`}
                              onClick={() => {
                                setCompanions((prev) => prev.filter((_, i) => i !== idx));
                                setDirty(true);
                              }}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {effectiveTravellers.length > 1 + companions.length ? (
                        <p className="ts-helper-note">
                          Remaining {effectiveTravellers.length - (1 + companions.length)} traveller slot(s) will be created as editable placeholder profiles (`Traveller 2`, etc.) if not named now.
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4 — BUDGET CONFIGURATION */}
            {step === 4 && (
              <div className="ts-step-stack">
                <div className="ts-step-row-split">
                  {companionType !== "solo" ? (
                    <div className="field-label">
                      <span>Budget Mode</span>
                      <PersoraSegmentedControl<BudgetScope>
                        ariaLabel="Budget mode"
                        value={budgetScope}
                        onChange={(scope) => {
                          setBudgetScope(scope);
                          setDirty(true);
                          setStepError(null);
                        }}
                        options={[
                          { value: "personal", label: "Personal Budget" },
                          { value: "group", label: "Combined Group Budget" },
                        ]}
                      />
                    </div>
                  ) : (
                    <div className="field-label">
                      <span>Budget Mode</span>
                      <div className="ts-static-pill">Personal Budget (Solo Trip)</div>
                    </div>
                  )}

                  <label className="field-label ts-currency-field" htmlFor={`ts-currency-${dialogId}`}>
                    <span>Primary Currency</span>
                    <select
                      id={`ts-currency-${dialogId}`}
                      value={primaryCurrency}
                      onChange={(e) => {
                        setPrimaryCurrency(e.target.value);
                        setDirty(true);
                      }}
                    >
                      {TRAVEL_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Personal Budget vs Combined Group Budget */}
                {companionType === "solo" || budgetScope === "personal" ? (
                  <label className="field-label" htmlFor={`ts-personal-budget-${dialogId}`}>
                    <span>
                      Total Personal Budget ({primaryCurrency}) <small>Optional — leave 0 if undecided</small>
                    </span>
                    <input
                      id={`ts-personal-budget-${dialogId}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={personalBudget}
                      onChange={(e) => {
                        setPersonalBudget(e.target.value);
                        setDirty(true);
                        if (stepError) setStepError(null);
                      }}
                    />
                  </label>
                ) : (
                  <div className="ts-subtle-box ts-step-stack">
                    <div className="ts-section-head-compact">
                      <div>
                        <h4>Group Planned Contributions</h4>
                        <p>Track each traveller&apos;s planned vs collected pool contribution separately from expenses.</p>
                      </div>
                      <PersoraSegmentedControl<"equal" | "custom">
                        size="sm"
                        ariaLabel="Contribution split mode"
                        value={contribSplitMode}
                        onChange={(m) => {
                          setContribSplitMode(m);
                          if (m === "equal" && groupTotalInput) {
                            applyEqualGroupSplit(groupTotalInput);
                          }
                          setDirty(true);
                        }}
                        options={[
                          { value: "equal", label: "Equal shares" },
                          { value: "custom", label: "Custom per traveller" },
                        ]}
                      />
                    </div>

                    {contribSplitMode === "equal" && (
                      <label className="field-label" htmlFor={`ts-group-total-${dialogId}`}>
                        <span>Total Planned Group Budget ({primaryCurrency})</span>
                        <input
                          id={`ts-group-total-${dialogId}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={groupTotalInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setGroupTotalInput(val);
                            applyEqualGroupSplit(val);
                            setDirty(true);
                          }}
                        />
                      </label>
                    )}

                    <div className="ts-contrib-grid">
                      {effectiveTravellers.map((slot, idx) => {
                        const rowSummary = contributionPreview.rows[idx];
                        return (
                          <div key={`${slot.label}-${idx}`} className="ts-contrib-row">
                            <span className="ts-contrib-name">{slot.label}</span>
                            <div className="ts-contrib-inputs">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                disabled={contribSplitMode === "equal" || slot.companionIdx === -2}
                                placeholder="Planned"
                                aria-label={`Planned contribution for ${slot.label}`}
                                value={
                                  contribSplitMode === "equal"
                                    ? rowSummary?.plannedAmount
                                      ? String(rowSummary.plannedAmount)
                                      : ""
                                    : slot.isOwner
                                      ? ownerPlanned
                                      : slot.companionIdx >= 0
                                        ? companions[slot.companionIdx]?.plannedAmount || ""
                                        : ""
                                }
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (slot.isOwner) setOwnerPlanned(v);
                                  else if (slot.companionIdx >= 0) {
                                    setCompanions((prev) =>
                                      prev.map((c, i) => (i === slot.companionIdx ? { ...c, plannedAmount: v } : c)),
                                    );
                                  }
                                  setDirty(true);
                                }}
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                disabled={slot.companionIdx === -2}
                                placeholder="Collected now"
                                aria-label={`Collected contribution for ${slot.label}`}
                                value={
                                  slot.isOwner
                                    ? ownerContributed
                                    : slot.companionIdx >= 0
                                      ? companions[slot.companionIdx]?.contributedAmount || ""
                                      : ""
                                }
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (slot.isOwner) setOwnerContributed(v);
                                  else if (slot.companionIdx >= 0) {
                                    setCompanions((prev) =>
                                      prev.map((c, i) =>
                                        i === slot.companionIdx ? { ...c, contributedAmount: v } : c,
                                      ),
                                    );
                                  }
                                  setDirty(true);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="ts-budget-kpi-strip">
                      <div>
                        <small>Planned Pool</small>
                        <strong>{formatTravelMoney(contributionPreview.totalPlanned, primaryCurrency)}</strong>
                      </div>
                      <div>
                        <small>Collected</small>
                        <strong className="is-emerald">
                          {formatTravelMoney(contributionPreview.totalCollected, primaryCurrency)}
                        </strong>
                      </div>
                      <div>
                        <small>Pending (Not Collected)</small>
                        <strong>{formatTravelMoney(contributionPreview.totalPending, primaryCurrency)}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {/* Category Budget Allocations */}
                <div className="ts-subtle-box ts-step-stack">
                  <div className="ts-section-head-compact">
                    <div>
                      <h4>Category Allocations</h4>
                      <p>Optional caps per spending category. Unallocated buffer is allowed.</p>
                    </div>
                    <div className="ts-cat-totals">
                      <Badge variant={overAllocated ? "destructive" : "secondary"} size="sm">
                        Allocated: {formatTravelMoney(allocatedAmountTotal, primaryCurrency)}
                      </Badge>
                      {plannedBudgetMinor > 0 && !overAllocated ? (
                        <Badge variant="outline" size="sm">
                          Unallocated: {formatTravelMoney(unallocatedAmount, primaryCurrency)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="ts-category-alloc-grid">
                    {categories.map((cat, idx) => (
                      <div key={cat.name} className="ts-category-alloc-row">
                        <span>{cat.name}</span>
                        <div className="ts-category-alloc-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            aria-label={`${cat.name} allocation`}
                            value={cat.allocatedAmount}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCategories((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, allocatedAmount: val } : c)),
                              );
                              setDirty(true);
                              if (stepError) setStepError(null);
                            }}
                          />
                          {!cat.isDefault ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${cat.name}`}
                              onClick={() => {
                                setCategories((prev) => prev.filter((_, i) => i !== idx));
                                setDirty(true);
                              }}
                            >
                              <Trash2 size={12} />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="ts-inline-add-row">
                    <input
                      type="text"
                      maxLength={60}
                      placeholder="Add custom category (e.g. Shopping, Visas)..."
                      value={customCategoryName}
                      onChange={(e) => setCustomCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCategory();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleAddCategory}>
                      <Plus size={13} /> Add Category
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5 — INITIAL TASKS (Optional / Skippable) */}
            {step === 5 && (
              <div className="ts-step-stack">
                {isEdit ? (
                  <div className="ts-subtle-box">
                    <p>
                      Existing tasks and scheduled itinerary activities are managed directly inside the Trip Workspace Tasks &amp; Itinerary tabs ({existingWorkspace?.items.length || 0} items). You can still add extra preparation tasks below if needed.
                    </p>
                  </div>
                ) : null}

                <div className="ts-starter-chips">
                  <span>Quick add:</span>
                  {STARTER_TASK_IDEAS.map((idea) => {
                    const already = initialTasks.some((t) => t.title.toLowerCase() === idea.toLowerCase());
                    return (
                      <button
                        key={idea}
                        type="button"
                        disabled={already}
                        className="ts-starter-chip"
                        onClick={() => handleAddInitialTask(idea)}
                      >
                        <Plus size={11} /> {idea}
                      </button>
                    );
                  })}
                </div>

                <div className="ts-subtle-box ts-step-stack">
                  <div className="ts-step-grid">
                    <label className="field-label is-full" htmlFor={`ts-task-title-${dialogId}`}>
                      <span>Task Title</span>
                      <input
                        id={`ts-task-title-${dialogId}`}
                        type="text"
                        maxLength={160}
                        placeholder="e.g. Exchange currency, Print boarding passes..."
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && taskTitle.trim()) {
                            e.preventDefault();
                            handleAddInitialTask();
                          }
                        }}
                      />
                    </label>

                    <label className="field-label" htmlFor={`ts-task-priority-${dialogId}`}>
                      <span>Priority</span>
                      <select
                        id={`ts-task-priority-${dialogId}`}
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                      >
                        {TASK_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="field-label">
                      <span>
                        Due Date <small>Optional</small>
                      </span>
                      <PersoraDatePicker
                        value={taskDueDate}
                        allowClear
                        ariaLabel="Task due date"
                        onChange={setTaskDueDate}
                      />
                    </div>

                    <label className="field-label" htmlFor={`ts-task-assignee-${dialogId}`}>
                      <span>
                        Assignee <small>Optional</small>
                      </span>
                      <select
                        id={`ts-task-assignee-${dialogId}`}
                        value={taskAssigneeIdx}
                        onChange={(e) => setTaskAssigneeIdx(Number(e.target.value))}
                      >
                        <option value={-1}>Unassigned</option>
                        {effectiveTravellers.map((tr, idx) => (
                          <option key={`${tr.label}-${idx}`} value={idx}>
                            {tr.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label" htmlFor={`ts-task-desc-${dialogId}`}>
                      <span>
                        Note <small>Optional</small>
                      </span>
                      <input
                        id={`ts-task-desc-${dialogId}`}
                        type="text"
                        maxLength={300}
                        placeholder="Optional details"
                        value={taskDesc}
                        onChange={(e) => setTaskDesc(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="ts-right-row">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!taskTitle.trim()}
                      onClick={() => handleAddInitialTask()}
                    >
                      <Plus size={14} /> Add Task to Checklist
                    </Button>
                  </div>
                </div>

                {initialTasks.length === 0 ? (
                  <p className="ts-helper-note">
                    No initial tasks added — that&apos;s fine. Click <strong>Next</strong> to review and create your trip.
                  </p>
                ) : (
                  <ul className="ts-initial-task-list">
                    {initialTasks.map((task) => (
                      <li key={task.id} className="ts-initial-task-item">
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            Priority: {task.priority}
                            {task.dueDate ? ` · Due ${task.dueDate}` : ""}
                            {task.assigneeIndex >= 0 && effectiveTravellers[task.assigneeIndex]
                              ? ` · ${effectiveTravellers[task.assigneeIndex].label}`
                              : ""}
                          </small>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove task ${task.title}`}
                          onClick={() => setInitialTasks((prev) => prev.filter((t) => t.id !== task.id))}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* STEP 6 — REVIEW & CREATE */}
            {step === 6 && (
              <div className="ts-review-grid">
                <div className="ts-review-card">
                  <div className="ts-review-card-head">
                    <span>
                      <CalendarDays size={14} /> Trip Basics
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => goToStep(1)}>
                      <Edit3 size={12} /> Edit
                    </Button>
                  </div>
                  <div className="ts-review-card-body">
                    {(coverPreviewUrl || (existingWorkspace?.trip.hasCover && !coverRemoved)) ? (
                      <TripCoverMedia
                        user={user}
                        trip={existingWorkspace?.trip || null}
                        previewUrl={coverPreviewUrl}
                        forceFallback={coverRemoved}
                        className="ts-review-cover-preview"
                        alt={title.trim() || "Trip cover"}
                      />
                    ) : null}
                    <strong>{title.trim() || "Untitled Trip"}</strong>
                    <p>
                      {startDate} → {endDate} ({durationDays} {durationDays === 1 ? "day" : "days"})
                      {tripType ? ` · ${TRIP_TYPE_LABELS[tripType]}` : ""}
                    </p>
                    {description.trim() ? <small>{description.trim()}</small> : null}
                  </div>
                </div>

                <div className="ts-review-card">
                  <div className="ts-review-card-head">
                    <span>
                      <MapPin size={14} /> Map Stops ({destinations.length})
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => goToStep(2)}>
                      <Edit3 size={12} /> Edit
                    </Button>
                  </div>
                  <div className="ts-review-card-body">
                    {destinations.length === 0 ? (
                      <p>No stops pinned yet (can be added anytime on the Trip Map).</p>
                    ) : (
                      <ul className="ts-review-stops">
                        {destinations.slice(0, 5).map((d, idx) => (
                          <li key={d.id}>
                            <span className="ts-review-stop-idx">{idx + 1}</span>
                            <span>{getDestinationStopLabel(d, idx)}</span>
                            <small>{formatCoordinatePair(d.latitude, d.longitude, 4)}</small>
                          </li>
                        ))}
                        {destinations.length > 5 ? (
                          <li>
                            <small>+{destinations.length - 5} more stop(s)</small>
                          </li>
                        ) : null}
                      </ul>
                    )}
                    <small>Privacy-safe: only coordinates and stop order are stored in the database.</small>
                  </div>
                </div>

                <div className="ts-review-card">
                  <div className="ts-review-card-head">
                    <span>
                      <Users size={14} /> Travellers
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => goToStep(3)}>
                      <Edit3 size={12} /> Edit
                    </Button>
                  </div>
                  <div className="ts-review-card-body">
                    <strong>
                      {COMPANION_LABELS[companionType]} · {companionType === "solo" ? 1 : Math.max(travelerCount, 1 + companions.length)}{" "}
                      {companionType === "solo" ? "traveller" : "travellers"}
                    </strong>
                    <p>
                      {companionType === "solo"
                        ? `${ownerDisplayName} (Personal trip)`
                        : [ownerDisplayName, ...companions.map((c) => c.fullName)].join(", ")}
                    </p>
                  </div>
                </div>

                <div className="ts-review-card">
                  <div className="ts-review-card-head">
                    <span>
                      <Wallet size={14} /> Budget ({primaryCurrency})
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => goToStep(4)}>
                      <Edit3 size={12} /> Edit
                    </Button>
                  </div>
                  <div className="ts-review-card-body">
                    <strong>
                      {companionType === "solo" || budgetScope === "personal" ? "Personal Budget" : "Combined Group Budget"}:{" "}
                      {formatTravelMoney(plannedBudgetAmount, primaryCurrency)}
                    </strong>
                    <p>
                      Category allocations: {formatTravelMoney(allocatedAmountTotal, primaryCurrency)}
                      {plannedBudgetMinor > 0 ? ` · Unallocated: ${formatTravelMoney(unallocatedAmount, primaryCurrency)}` : ""}
                    </p>
                    {companionType !== "solo" && budgetScope === "group" ? (
                      <small>
                        Collected: {formatTravelMoney(contributionPreview.totalCollected, primaryCurrency)} · Pending:{" "}
                        {formatTravelMoney(contributionPreview.totalPending, primaryCurrency)}
                      </small>
                    ) : null}
                  </div>
                </div>

                <div className="ts-review-card is-full">
                  <div className="ts-review-card-head">
                    <span>
                      <CheckSquare size={14} /> Initial Tasks ({initialTasks.length})
                    </span>
                    <Button type="button" variant="ghost" size="xs" onClick={() => goToStep(5)}>
                      <Edit3 size={12} /> Edit
                    </Button>
                  </div>
                  <div className="ts-review-card-body">
                    {initialTasks.length === 0 ? (
                      <p>No initial checklist tasks queued.</p>
                    ) : (
                      <p>{initialTasks.map((t) => t.title).join(" · ")}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {submitting && uploadProgress !== null ? (
            <div className="ts-upload-progress-bar" role="status" aria-live="polite">
              <div className="ts-upload-progress-label">
                <span>Uploading cover image…</span>
                <span className="ts-num">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          ) : null}

          {/* Footer Navigation: Back on Left, Cancel + Next / Create Trip on Right */}
          <footer className="ts-onboarding-footer">
            <div>
              {step > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => goToStep(step - 1)}
                >
                  <ArrowLeft size={14} /> Back
                </Button>
              ) : null}
            </div>

            <div className="ts-onboarding-footer-right">
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={requestClose}
              >
                Cancel
              </Button>

              {step < STEPS.length ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => goToStep(step + 1)}
                >
                  <span>{step === 5 && initialTasks.length === 0 ? "Skip & Review" : "Next"}</span>
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  disabled={submitting}
                  onClick={handleFinalSubmit}
                >
                  {submitting ? <Spinner className="size-3.5" /> : <Sparkles size={14} />}
                  <span>{submitting ? (isEdit ? "Saving..." : "Creating Trip...") : isEdit ? "Save Changes" : "Create Trip"}</span>
                </Button>
              )}
            </div>
          </footer>
        </section>

        <PersoraDeleteModal
          open={confirmDiscardOpen}
          eyebrow="Unsaved Trip Draft"
          title="Discard trip setup?"
          description="Your draft changes have not been saved yet. Closing now will discard this onboarding progress."
          confirmLabel="Discard Draft"
          cancelLabel="Keep Editing"
          danger
          onCancel={() => setConfirmDiscardOpen(false)}
          onConfirm={() => {
            setConfirmDiscardOpen(false);
            onClose();
          }}
        />
      </div>
    </ModalPortal>
  );
}
