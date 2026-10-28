// Customizable Dashboard database, RLS, RPCs, validation, and API route tests
// running against real Postgres (PGlite + pgcrypto) loaded with supabase/schema.sql
// and supabase/migrations/20261027000000_customizable_dashboard.sql.
import test from "node:test";
import assert from "node:assert/strict";
import { createVaultDatabase } from "./password-vault-db.mjs";
import { handleDashboard, exportDashboardData } from "../cloudflare/dashboard.js";
import {
  DASHBOARD_PRESETS,
  DASHBOARD_WIDGET_CATALOG,
  buildPresetWidgets,
  createDefaultDashboardLayout,
  createWidgetFromLibrary,
  duplicateWidgetInstance,
  moveWidgetById,
  removeWidgetInstance,
  reorderWidgets,
  stepWidgetOrder,
  updateWidgetInstance,
} from "../cloudflare/dashboard-rules.js";
import worker from "../cloudflare/api.js";

const ORIGIN = "https://persora.example";
const env = { SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "test-service-key" };
const ctx = await createVaultDatabase();
const { db } = ctx;

let failNext = null;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith("/rest/v1/rpc/")) {
    return Response.json([]);
  }
  if (failNext) {
    const fn = failNext;
    failNext = null;
    return fn();
  }
  const name = url.pathname.split("/").pop();
  const args = init.body ? JSON.parse(init.body) : {};
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

async function member(label) {
  const who = await ctx.addMember(label);
  await db.query("update public.profiles set email_verified_at = now() where id = $1", [who.id]);
  return { id: who.id, email: who.email, full_name: label, timezone: "Asia/Dhaka", account_status: "active" };
}

const alice = await member("dash-alice");
const bob = await member("dash-bob");

const apiCall = async (method, path, body, who = alice) => {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const response = await handleDashboard(new Request(`${ORIGIN}/api${path}`, init), who, env, ORIGIN);
  return { status: response.status, body: await response.json() };
};

test("catalog & presets: all 30 widgets across 5 categories and 5 presets validate cleanly", () => {
  assert.equal(DASHBOARD_WIDGET_CATALOG.length, 30);
  assert.equal(DASHBOARD_PRESETS.length, 5);
  const presetIds = DASHBOARD_PRESETS.map((p) => p.id);
  assert.deepEqual(presetIds, ["balanced", "productivity", "personal-records", "payments-and-renewals", "minimal"]);

  const defaultLayout = createDefaultDashboardLayout();
  assert.equal(defaultLayout.customized, false);
  assert.equal(defaultLayout.widgets.length, 8);
  assert.deepEqual(
    defaultLayout.widgets.map((w) => w.title),
    [
      "Quick Actions",
      "Today's Schedule",
      "Tasks",
      "Habit Tracker",
      "Upcoming Reminders",
      "Expiring Documents",
      "Upcoming Payments",
      "Recently Opened",
    ],
  );
});

test("pure layout helpers: add, reorder, step, resize with minWidth guard, duplicate, remove", () => {
  let widgets = buildPresetWidgets("minimal");
  assert.equal(widgets.length, 4);

  const added = createWidgetFromLibrary("expiring-documents", widgets, {
    title: "Passports",
    config: { warningDays: 120, documentCategory: "Passport" },
  });
  widgets = [...widgets, added];
  assert.equal(widgets.length, 5);

  const reordered = reorderWidgets(widgets, 4, 1);
  assert.equal(reordered[1].id, added.id);
  assert.deepEqual(reordered.map((w) => w.position), [0, 1, 2, 3, 4]);

  const stepped = stepWidgetOrder(reordered, added.id, 1);
  assert.equal(stepped[2].id, added.id);

  const moved = moveWidgetById(stepped, added.id, stepped[0].id);
  assert.equal(moved[0].id, added.id);

  // quick-actions has minWidth = "half"; attempting "compact" clamps to "half"
  const resized = updateWidgetInstance(moved, "w-min-actions", { width: "compact", height: "expanded", collapsed: true });
  const qa = resized.find((w) => w.id === "w-min-actions");
  assert.equal(qa.width, "half");
  assert.equal(qa.height, "expanded");
  assert.equal(qa.collapsed, true);

  const duplicated = duplicateWidgetInstance(resized, added.id);
  assert.equal(duplicated.length, 6);
  assert.notEqual(duplicated[1].id, added.id);
  assert.equal(duplicated[1].title, "Passports (Copy)");
  assert.equal(duplicated[1].config.documentCategory, "Passport");

  const removed = removeWidgetInstance(duplicated, duplicated[1].id);
  assert.equal(removed.length, 5);
  assert.deepEqual(removed.map((w) => w.position), [0, 1, 2, 3, 4]);
});

test("database security: RLS enabled, anon/authenticated closed, JWT owner policies isolate members", async () => {
  const tables = ["dashboard_layouts", "dashboard_widgets"];
  const rls = (await db.query("select relname, relrowsecurity from pg_class where relname = any($1)", [tables])).rows;
  assert.equal(rls.length, 2);
  assert.ok(rls.every((row) => row.relrowsecurity), "RLS enabled on both dashboard tables");

  // Direct anon / authenticated access is revoked by default
  for (const role of ["anon", "authenticated"]) {
    for (const table of tables) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
    for (const fnCall of [
      `public.persora_dashboard_load('${alice.id}')`,
      `public.persora_dashboard_reset('${alice.id}', null)`,
    ]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.query(`select ${fnCall}`), /permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  }

  // Seed a row for Alice via RPC, then prove that even if table privileges were granted
  // to `authenticated`, RLS strictly enforces `user_id = persora_jwt_uid()`.
  await apiCall("PUT", "/dashboard", {
    activePreset: "minimal",
    expectedRevision: 0,
    widgets: buildPresetWidgets("minimal"),
  }, alice);

  await db.exec("grant select, insert, update, delete on public.dashboard_layouts, public.dashboard_widgets to authenticated");
  try {
    // Without JWT claim -> sees 0 rows
    await db.exec("set role authenticated");
    assert.equal((await db.query("select count(*)::int as n from public.dashboard_widgets")).rows[0].n, 0);
    await db.exec("reset role");

    // With Bob's JWT claim -> sees 0 of Alice's rows and cannot insert under Alice's user_id
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${bob.id}', false);`);
    assert.equal((await db.query("select count(*)::int as n from public.dashboard_widgets")).rows[0].n, 0);
    await assert.rejects(
      db.query(
        `insert into public.dashboard_layouts (user_id, active_preset, revision) values ($1, 'minimal', 1)`,
        [alice.id],
      ),
      /row-level security/,
    );
    await db.exec("reset role");

    // With Alice's JWT claim -> sees Alice's 4 widgets
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${alice.id}', false);`);
    assert.equal((await db.query("select count(*)::int as n from public.dashboard_widgets")).rows[0].n, 4);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); reset role;`);
  } finally {
    await db.exec("reset role; revoke all on public.dashboard_layouts, public.dashboard_widgets from authenticated");
  }

  // Clean Alice back to default for subsequent tests
  await apiCall("POST", "/dashboard/reset", {}, alice);
});

test("API routes: GET default, PUT save ignoring spoofed user_id, revision conflict (409), validation (400), reset", async () => {
  // Unauthenticated request via top-level worker returns 401
  const unauthRes = await worker.fetch(new Request(`${ORIGIN}/api/dashboard`), env);
  assert.equal(unauthRes.status, 401);

  // First-time GET returns uncustomized 8-widget Balanced default
  const initial = await apiCall("GET", "/dashboard", undefined, alice);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.customized, false);
  assert.equal(initial.body.revision, 0);
  assert.equal(initial.body.widgets.length, 8);

  // Save customized layout with spoofed user_id in body -> persisted strictly to Alice, Bob unaffected
  const customWidgets = [
    createWidgetFromLibrary("tasks-due", [], { id: "w-tasks-1", title: "Urgent Tasks", width: "two-thirds", height: "expanded", config: { filter: "overdue", limit: 8 } }),
    createWidgetFromLibrary("medical-records-shortcut", [], { id: "w-med-1", width: "compact", height: "compact", config: { showRecordCount: false } }),
  ];
  const saved = await apiCall("PUT", "/dashboard", {
    user_id: bob.id,
    userId: bob.id,
    activePreset: "custom",
    expectedRevision: 0,
    widgets: customWidgets,
  }, alice);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.customized, true);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.widgets.length, 2);
  assert.equal(saved.body.widgets[0].title, "Urgent Tasks");
  assert.equal(saved.body.widgets[0].width, "two-thirds");
  assert.equal(saved.body.widgets[0].config.filter, "overdue");

  // Bob's dashboard is still untouched
  const bobInitial = await apiCall("GET", "/dashboard", undefined, bob);
  assert.equal(bobInitial.body.customized, false);

  // Stale expectedRevision (0 instead of 1) returns 409 Conflict with authoritative current layout
  const stale = await apiCall("PUT", "/dashboard", {
    activePreset: "minimal",
    expectedRevision: 0,
    widgets: buildPresetWidgets("minimal"),
  }, alice);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "revision_conflict");
  assert.equal(stale.body.current.revision, 1);
  assert.equal(stale.body.current.widgets.length, 2);

  // Rejects unknown widget types and unknown config keys with 400
  const badType = await apiCall("PUT", "/dashboard", {
    expectedRevision: 1,
    widgets: [{ id: "w-bad", type: "crypto-ticker", title: "Fake", width: "half", height: "standard", config: {} }],
  }, alice);
  assert.equal(badType.status, 400);

  const badConfigKey = await apiCall("PUT", "/dashboard", {
    expectedRevision: 1,
    widgets: [{ id: "w-bad-cfg", type: "tasks-due", title: "Tasks", width: "half", height: "standard", config: { unknownField: true } }],
  }, alice);
  assert.equal(badConfigKey.status, 400);

  // Export includes Alice's persisted layout
  const exported = await exportDashboardData(alice.id, env);
  assert.equal(exported.customized, true);
  assert.equal(exported.widgets.length, 2);

  // Reset restores default layout cleanly
  const reset = await apiCall("POST", "/dashboard/reset", { expectedRevision: 1 }, alice);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.customized, false);
  assert.equal(reset.body.revision, 0);
  assert.equal(reset.body.widgets.length, 8);

  // Every catalog widget type passes Postgres CHECK constraint
  const allTypesWidgets = DASHBOARD_WIDGET_CATALOG.map((meta, i) =>
    createWidgetFromLibrary(meta.type, [], { id: `w-all-${i}` }),
  );
  const saveAll = await apiCall("PUT", "/dashboard", {
    activePreset: "custom",
    expectedRevision: 0,
    widgets: allTypesWidgets,
  }, alice);
  assert.equal(saveAll.status, 200);
  assert.equal(saveAll.body.widgets.length, 30);
  await apiCall("POST", "/dashboard/reset", { expectedRevision: 1 }, alice);
});
