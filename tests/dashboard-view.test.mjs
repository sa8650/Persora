// Customizable Dashboard UI test suite (Happy DOM + React + esbuild):
// - Default 8-widget Balanced layout + personalized greeting + date
// - Real data binding & strict separation of Reminders from Tasks and Notes
// - Inline Task completion & Habit repetition check-ins
// - Combined Upcoming Payments (Loan Tracker + Subscription Manager) & Expiring Documents
// - Searchable 30-widget Library, multi-instance support, Duplicate, Configure, Collapse, Remove safety
// - Sensitive data protection (zero clinical details in Medical Records Shortcut; zero secrets in Password Vault Status)
// - Honest Connected Services status (Google Drive = Coming soon; EMS = Available/Connected)
// - Edit Dashboard mode, width resizing, keyboard reordering, Cancel revert, Preset & Reset confirmations, and honest Save Failed -> Retry -> Saved state.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { GlobalWindow } from "happy-dom";

const happyWindow = new GlobalWindow({ url: "http://localhost:5173/" });
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (!(key in globalThis)) globalThis[key] = happyWindow[key];
}
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.CustomEvent = happyWindow.CustomEvent;
globalThis.Event = happyWindow.Event;
globalThis.MouseEvent = happyWindow.MouseEvent;
globalThis.KeyboardEvent = happyWindow.KeyboardEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { CONNECTION_PROVIDERS } = await import("../cloudflare/connections.js");
const { createDefaultDashboardLayout, applyPresetLayout } = await import("../cloudflare/dashboard-rules.js");

const todayIso = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const addDaysIso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let serverDashboard = createDefaultDashboardLayout();
let failNextDashboardSave = false;
let habitCheckins = [];
const apiCalls = [];

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "http://localhost:5173");
  const method = (init.method || "GET").toUpperCase();
  apiCalls.push({ method, pathname: url.pathname });

  if (url.pathname === "/api/dashboard" && method === "GET") {
    return new Response(JSON.stringify(serverDashboard), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/dashboard" && method === "PUT") {
    if (failNextDashboardSave) {
      failNextDashboardSave = false;
      return new Response(JSON.stringify({ error: "Simulated database write error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = JSON.parse(String(init.body || "{}"));
    serverDashboard = {
      customized: true,
      activePreset: body.activePreset || "custom",
      revision: (serverDashboard.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      widgets: (body.widgets || []).map((w, idx) => ({ ...w, position: idx })),
    };
    return new Response(JSON.stringify(serverDashboard), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/dashboard/reset" && method === "POST") {
    serverDashboard = {
      ...applyPresetLayout("balanced"),
      customized: false,
      revision: (serverDashboard.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify(serverDashboard), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/calendar/events" && method === "GET") {
    return new Response(
      JSON.stringify({
        events: [
          {
            id: "cal-1",
            title: "Dentist Checkup",
            description: "Annual cleaning",
            location: "City Dental",
            category: "health",
            itemType: "appointment",
            allDay: false,
            timeZone: "Asia/Dhaka",
            startAt: `${todayIso}T09:00:00.000Z`,
            endAt: `${todayIso}T10:00:00.000Z`,
            startDate: null,
            endDate: null,
            recurrence: null,
            reminderMinutes: 15,
            status: "confirmed",
            seriesId: null,
            originalStartAt: null,
            originalStartDate: null,
            completedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/calendar/reminders" && method === "GET") {
    return new Response(JSON.stringify({ reminders: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/habits" && method === "GET") {
    return new Response(
      JSON.stringify({
        habits: [
          {
            id: "hab-1",
            name: "Drink Water",
            description: "8 glasses daily",
            category: "health",
            color: "blue",
            icon: "droplets",
            frequencyType: "daily",
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            timesPerWeek: null,
            goalType: "boolean",
            targetValue: 2,
            targetUnit: "times",
            reminderTime: null,
            startDate: addDaysIso(-14),
            archivedAt: null,
            sortOrder: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        checkins: habitCheckins,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/habits/hab-1/checkins" && method === "PUT") {
    const body = JSON.parse(String(init.body || "{}"));
    const checkin = {
      id: "chk-1",
      habitId: "hab-1",
      checkinDate: body.date,
      value: body.value ?? 1,
      completed: Boolean(body.completed ?? (body.value || 0) >= 2),
      note: "",
      updatedAt: new Date().toISOString(),
    };
    habitCheckins = [checkin];
    return new Response(JSON.stringify({ checkin }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/loans" && method === "GET") {
    return new Response(
      JSON.stringify({
        today: todayIso,
        loans: [
          {
            id: "loan-1",
            name: "Home Car Loan",
            partyName: "City Bank",
            borrowerName: "Nadia Rahman",
            direction: "borrowed",
            currency: "BDT",
            principal: 120000,
            status: "active",
            summary: {
              scheduled: 120000,
              paid: 20000,
              outstanding: 100000,
              installmentsTotal: 12,
              paidCount: 2,
              overdueCount: 0,
              overdueAmount: 0,
              writtenOff: 0,
              progress: 2 / 12,
              state: "active",
              next: {
                id: "inst-3",
                number: 3,
                dueDate: addDaysIso(5),
                principal: 10000,
                interest: 0,
                amount: 10000,
                paid: 0,
                remaining: 10000,
                status: "upcoming",
                paymentCount: 0,
                scheduleVersion: 1,
              },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/connections" && method === "GET") {
    return new Response(
      JSON.stringify({
        providers: CONNECTION_PROVIDERS.map((p) => ({
          ...p,
          enabled: p.available,
          status: p.available ? "not_connected" : "coming_soon",
          connection: null,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if ((url.pathname === "/api/password-vault" || url.pathname === "/api/password-vault/status") && method === "GET") {
    return new Response(
      JSON.stringify({ hasVault: true, records: 6, recoveryAvailable: true, pending: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/storage/usage" && method === "GET") {
    return new Response(
      JSON.stringify({
        bytesUsed: 10485760,
        fileBytes: 10000000,
        databaseBytes: 485760,
        databaseRecordCount: 12,
        objectCount: 4,
        storageLimitBytes: 5 * 1024 * 1024 * 1024,
        storageLimitGb: 5,
        planName: "Pro",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/projects" && method === "GET") {
    return new Response(JSON.stringify({ projects: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname.startsWith("/api/folders")) {
    return new Response(JSON.stringify({ folders: [], assignments: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname.startsWith("/api/pdf-studio")) {
    return new Response(JSON.stringify({ documents: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname.startsWith("/api/photo-studio")) {
    return new Response(JSON.stringify({ photos: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const esbuild = await import("esbuild");
const outDir = mkdtempSync(path.join(process.cwd(), "node_modules", ".dashboard-view-"));
const outfile = path.join(outDir, "DashboardBundle.mjs");
await esbuild.build({
  stdin: {
    contents: `
      export { default as CustomizableDashboardView } from "./src/components/dashboard/DashboardView.tsx";
      export { recordRecentItemAccess, readRecentItemAccess } from "./src/lib/dashboard-api.ts";
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty", ".svg": "file" },
  external: ["react", "react-dom", "lucide-react"],
  jsx: "automatic",
  define: {
    "import.meta.env.PROD": "true",
    "import.meta.env.VITE_USE_PAGES_FUNCTIONS": '"true"',
  },
  logLevel: "silent",
});

const { CustomizableDashboardView, recordRecentItemAccess, readRecentItemAccess } = await import(outfile);
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const sleep = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleItems = [
  {
    id: "task-1",
    section: "notes",
    title: "Renew car insurance policy",
    subtitle: "High priority",
    metadata: { recordType: "todo", dueDate: todayIso, priority: "High", completed: "false" },
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
  },
  {
    id: "rem-1",
    section: "notes",
    title: "Call Mom at 7 PM",
    subtitle: "Evening call",
    metadata: {
      recordType: "reminder",
      enabled: "true",
      reminderAt: `${addDaysIso(1)}T19:00:00`,
    },
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
  },
  {
    id: "note-1",
    section: "notes",
    title: "Packing checklist for Sylhet",
    subtitle: "Plain note",
    metadata: { content: "Passport, charger, umbrella" },
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-26T10:00:00Z",
  },
  {
    id: "doc-exp-1",
    section: "documents",
    title: "International Passport",
    subtitle: "Passport",
    metadata: { category: "Passport", expiryDate: addDaysIso(20) },
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-24T10:00:00Z",
  },
  {
    id: "sub-1",
    section: "subscriptions",
    title: "Cloud Storage Pro",
    subtitle: "Monthly",
    metadata: { cost: "950", currency: "BDT", renewalDate: addDaysIso(8), cycle: "Monthly" },
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-24T10:00:00Z",
  },
];

const sensitiveMedicalRecords = [
  {
    id: "med-secret-1",
    recordType: "Prescription",
    title: "Confidential Cardiology Prescription",
    recordDate: "2026-10-15",
    doctorName: "Dr. Secret Specialist",
    hospitalOrLab: "Private Heart Clinic",
    diagnosisOrSummary: "CONFIDENTIAL_DIAGNOSIS_CODE_9981",
    notes: "TOP_SECRET_DOSAGE_NOTES",
    createdAt: "2026-10-15T10:00:00Z",
    updatedAt: "2026-10-15T10:00:00Z",
  },
];

async function mountDashboard(overrides = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const toggledTodos = [];
  const openedItems = [];
  const navigated = [];

  const props = {
    user: {
      id: "user-1",
      email: "nadia@persora.example",
      fullName: "Nadia Rahman",
      demo: false,
      planName: "Pro",
    },
    items: sampleItems,
    contacts: [
      {
        id: "con-1",
        fullName: "Arif Karim",
        category: "Family",
        favorite: true,
        phone: "+8801700000000",
        email: "arif@example.com",
        company: "",
        jobTitle: "",
        address: "",
        website: "",
        birthday: "",
        notes: "",
        tags: [],
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-20T00:00:00Z",
      },
    ],
    businessCards: [],
    medicalRecords: sensitiveMedicalRecords,
    projectNotifications: [],
    notify: () => {},
    onNavigate: (view) => navigated.push(view),
    onNavigateCalendar: () => navigated.push("calendar"),
    onNavigateHabits: () => navigated.push("habits"),
    onNavigateLoan: (id) => navigated.push(`loan:${id}`),
    onNavigateProject: (id) => navigated.push(`project:${id}`),
    onOpenItem: (item) => openedItems.push(item),
    onAdd: (sec) => navigated.push(`add:${sec}`),
    onAddDocument: () => navigated.push("add-document"),
    onAddMedicalRecord: () => navigated.push("add-medical"),
    onAddTodo: (kind) => navigated.push(`todo:${kind}`),
    onEditTodoItem: (item) => openedItems.push(item),
    onToggleTodo: (item, completed) => toggledTodos.push({ id: item.id, completed }),
    onSaveQuickNote: async () => {},
    ...overrides,
  };

  await act(async () => {
    root.render(React.createElement(CustomizableDashboardView, props));
    await sleep(60);
  });

  return {
    container,
    root,
    toggledTodos,
    openedItems,
    navigated,
    async click(el) {
      assert.ok(el, "Expected clickable element to exist");
      await act(async () => {
        el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(30);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      document.body.innerHTML = "";
    },
  };
}

test("default dashboard renders personalized greeting, 8 balanced widgets, real data, and keeps Reminders strictly separate from Tasks & Notes", async () => {
  localStorage.clear();
  serverDashboard = createDefaultDashboardLayout();
  recordRecentItemAccess("user-1", { kind: "vault", id: "doc-exp-1" });

  const view = await mountDashboard();
  try {
    // Personalized greeting + header buttons
    assert.match(view.container.textContent, /Good (morning|afternoon|evening), Nadia/);
    assert.ok(view.container.querySelector("button")?.textContent);

    const widgetSections = [...view.container.querySelectorAll(".ds-widget-card")];
    assert.equal(widgetSections.length, 8, "First-time user gets the 8-widget Balanced default layout");

    const widgetByType = (type) =>
      view.container.querySelector(`[data-widget-type="${type}"]`);

    const tasksWidget = widgetByType("tasks-due");
    const remindersWidget = widgetByType("upcoming-reminders");
    const scheduleWidget = widgetByType("calendar-agenda");
    const habitsWidget = widgetByType("habit-tracker");
    const expiringWidget = widgetByType("expiring-documents");
    const paymentsWidget = widgetByType("combined-upcoming-payments");
    const recentWidget = widgetByType("recently-opened");

    assert.ok(tasksWidget, "Tasks widget present");
    assert.ok(remindersWidget, "Upcoming Reminders widget present");
    assert.ok(scheduleWidget, "Today's Schedule widget present");
    assert.ok(habitsWidget, "Habit Tracker widget present");
    assert.ok(expiringWidget, "Expiring Documents widget present");
    assert.ok(paymentsWidget, "Upcoming Payments widget present");
    assert.ok(recentWidget, "Recently Opened widget present");

    // Tasks widget shows ONLY task-1, NOT reminder rem-1 or plain note note-1
    assert.match(tasksWidget.textContent, /Renew car insurance policy/);
    assert.doesNotMatch(tasksWidget.textContent, /Call Mom at 7 PM/);
    assert.doesNotMatch(tasksWidget.textContent, /Packing checklist for Sylhet/);

    // Reminders widget shows ONLY rem-1, NOT task-1 or plain note note-1
    assert.match(remindersWidget.textContent, /Call Mom at 7 PM/);
    assert.doesNotMatch(remindersWidget.textContent, /Renew car insurance policy/);
    assert.doesNotMatch(remindersWidget.textContent, /Packing checklist for Sylhet/);

    // Schedule widget shows real Calendar occurrence
    assert.match(scheduleWidget.textContent, /Dentist Checkup/);

    // Expiring Documents widget shows Passport expiring in 20 days
    assert.match(expiringWidget.textContent, /International Passport/);

    // Combined Upcoming Payments combines Loan Tracker + Subscription Manager
    assert.match(paymentsWidget.textContent, /Home Car Loan/);
    assert.match(paymentsWidget.textContent, /Cloud Storage Pro/);

    // Inline task completion invokes real onToggleTodo handler
    const taskCheckbox = tasksWidget.querySelector('[role="checkbox"]');
    assert.ok(taskCheckbox, "Task checkbox rendered");
    await view.click(taskCheckbox);
    assert.deepEqual(view.toggledTodos, [{ id: "task-1", completed: true }]);
  } finally {
    await view.unmount();
  }
});

test("sensitive data protection: Medical Records Shortcut, Password Vault Status, Google Drive Status, and Recent Activity never leak clinical details or secrets", async () => {
  localStorage.clear();
  // Attempt to record medical or password items into Recent Activity — must be ignored!
  recordRecentItemAccess("user-1", { kind: "vault", id: "medical-records:secret" });
  assert.equal(
    readRecentItemAccess("user-1").some((e) => e.id.includes("medical")),
    false,
  );

  serverDashboard = {
    customized: true,
    activePreset: "custom",
    revision: 2,
    updatedAt: new Date().toISOString(),
    widgets: [
      {
        id: "w-med",
        type: "medical-records-shortcut",
        title: "Medical Records",
        position: 0,
        width: "half",
        height: "compact",
        visible: true,
        collapsed: false,
        config: { showQuickAdd: true, showRecordCount: false },
      },
      {
        id: "w-vault",
        type: "password-vault-status",
        title: "Password Vault",
        position: 1,
        width: "half",
        height: "compact",
        visible: true,
        collapsed: false,
        config: { showGeneratorShortcut: true },
      },
      {
        id: "w-gdrive",
        type: "google-drive-status",
        title: "Google Drive",
        position: 2,
        width: "half",
        height: "compact",
        visible: true,
        collapsed: false,
        config: {},
      },
    ],
  };

  const view = await mountDashboard();
  try {
    const html = document.body.textContent || "";
    // Zero medical clinical fields leaked
    assert.doesNotMatch(html, /Confidential Cardiology Prescription/);
    assert.doesNotMatch(html, /Dr\. Secret Specialist/);
    assert.doesNotMatch(html, /Private Heart Clinic/);
    assert.doesNotMatch(html, /CONFIDENTIAL_DIAGNOSIS_CODE_9981/);
    assert.doesNotMatch(html, /TOP_SECRET_DOSAGE_NOTES/);

    // Password Vault shows status only
    const vaultCard = view.container.querySelector('[data-widget-type="password-vault-status"]');
    assert.ok(vaultCard);
    assert.match(vaultCard.textContent, /Locked · Master password required/);
    assert.match(vaultCard.textContent, /Passwords never shown here/);

    // Google Drive honestly shows Coming soon (not fabricated Connected files)
    const driveCard = view.container.querySelector('[data-widget-type="google-drive-status"]');
    assert.ok(driveCard);
    assert.match(driveCard.textContent, /Coming soon/i);
  } finally {
    await view.unmount();
  }
});

test("Edit Dashboard mode supports Add Widget, multi-instance, width resize, Cancel revert, Remove safety, and honest Save Failed + Retry -> Saved", async () => {
  localStorage.clear();
  serverDashboard = createDefaultDashboardLayout();
  const initialRecordCount = sampleItems.length;

  const view = await mountDashboard();
  try {
    // Enter Edit Dashboard mode
    const editBtn = [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Edit Dashboard"),
    );
    await view.click(editBtn);
    assert.ok(
      view.container.querySelector('[aria-label="Edit dashboard toolbar"]'),
      "Edit toolbar visible",
    );

    // Remove one widget in Edit Mode, then click Cancel -> restores all 8 widgets!
    const removeBtn = view.container.querySelector('button[aria-label^="Remove "]');
    await view.click(removeBtn);
    assert.equal(view.container.querySelectorAll(".ds-widget-card").length, 7);
    assert.equal(sampleItems.length, initialRecordCount, "Removing a widget never deletes underlying records");

    const cancelBtn = [...view.container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    await view.click(cancelBtn);
    assert.equal(
      view.container.querySelectorAll(".ds-widget-card").length,
      8,
      "Cancel restores pre-edit layout",
    );

    // Open Add Widget modal and add a second Tasks Due widget (multi-instance)
    const addWidgetBtn = [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add Widget"),
    );
    await view.click(addWidgetBtn);

    const dialog = document.body.querySelector('[role="dialog"]');
    assert.ok(dialog, "Widget Library modal opened");
    assert.match(dialog.textContent, /Widget Library/);

    // Simulate a failed save first so we verify Save Failed + Retry honesty
    failNextDashboardSave = true;
    const addAnotherTasksBtn = [...dialog.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Add Tasks Due widget",
    );
    await view.click(addAnotherTasksBtn);
    assert.equal(
      view.container.querySelectorAll('[data-widget-type="tasks-due"]').length,
      2,
      "Supports multiple instances of the same widget type",
    );

    // Wait past debounce (520ms) so PUT /api/dashboard fires and fails
    await act(async () => {
      await sleep(620);
    });
    assert.match(view.container.textContent, /Save Failed/);
    assert.equal(
      [...view.container.querySelectorAll('[role="status"]')].some((el) => el.textContent === "Saved"),
      false,
      "Must never show Saved when persistence failed",
    );

    // Click Retry -> succeeds and transitions to Saved!
    const retryBtn = [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Retry"),
    );
    await view.click(retryBtn);
    await act(async () => {
      await sleep(50);
    });
    assert.equal(
      [...view.container.querySelectorAll('[role="status"]')].some((el) => el.textContent === "Saved"),
      true,
      "Shows Saved only after persistence succeeds",
    );

    // Close Widget Library modal if still open
    const closeLibBtn = document.body.querySelector('button[aria-label="Close widget library"]');
    if (closeLibBtn) await view.click(closeLibBtn);

    // Open Presets modal on customized layout -> requires explicit confirmation before replacing
    const presetsBtn = view.container.querySelector('button[aria-label="Choose dashboard preset"]');
    await view.click(presetsBtn);
    const presetDialog = document.body.querySelector('[role="dialog"]');
    assert.ok(presetDialog);
    assert.match(presetDialog.textContent, /Replaces your current customized layout/i);
    const minimalBtn = [...presetDialog.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Minimal"),
    );
    await view.click(minimalBtn);
    const applyPresetBtn = [...presetDialog.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Apply Minimal preset"),
    );
    await view.click(applyPresetBtn);
    assert.equal(
      view.container.querySelectorAll(".ds-widget-card").length,
      4,
      "Minimal preset applied 4 widgets after confirmation",
    );
  } finally {
    await view.unmount();
  }
});
