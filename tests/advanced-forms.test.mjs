import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ADVANCED_ANSWER_TYPES,
  ADVANCED_CHOICE_TYPES,
  ADVANCED_CATEGORIES,
  ADVANCED_DEFAULT_DESIGN,
  ADVANCED_DEFAULT_SETTINGS,
  ADVANCED_FIELD_LIBRARY,
  ADVANCED_FIELD_TYPES,
  ADVANCED_LIMITS,
  ADVANCED_LOGIC_OPERATORS,
  advancedFormGate,
  advancedId,
  advancedResponsesToCsv,
  createAdvancedField,
  createAdvancedForm,
  isAnswerField,
  normalizeAdvancedForm,
  resolveVisibleFieldIds,
  validateAdvancedAnswers,
} from "../cloudflare/advanced-forms-rules.js";
import { ADVANCED_TEMPLATES, buildAdvancedTemplate } from "../cloudflare/advanced-forms-templates.js";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const RULES = "cloudflare/advanced-forms-rules.js";
const TEMPLATES = "cloudflare/advanced-forms-templates.js";
const STORE = "src/lib/advanced-forms-store.ts";
const CSS = "src/components/forms/advanced/advanced-forms.css";
const VIEW = "src/components/forms/advanced/AdvancedFormsView.tsx";
const DASHBOARD = "src/components/forms/advanced/AdvancedFormsDashboard.tsx";
const BUILDER = "src/components/forms/advanced/AdvancedFormBuilder.tsx";
const RENDERER = "src/components/forms/advanced/AdvancedFormRenderer.tsx";
const RESPONSES = "src/components/forms/advanced/AdvancedResponsesTab.tsx";

/* ---------------------------------------------------------------- */
/* 1. Element catalogue                                              */
/* ---------------------------------------------------------------- */

test("advanced forms expose the full twenty-element library", () => {
  assert.equal(ADVANCED_FIELD_TYPES.length, 20);
  assert.equal(ADVANCED_FIELD_LIBRARY.length, 20);
  assert.deepEqual(
    [...ADVANCED_FIELD_TYPES].sort(),
    [...ADVANCED_FIELD_LIBRARY.map((entry) => entry.type)].sort(),
    "every field type must appear in the element library",
  );

  const required = [
    "short_text", "long_text", "number", "email", "phone", "radio", "checkbox", "select",
    "date", "time", "color", "rating", "image", "video", "audio", "file",
    "heading", "paragraph", "divider", "spacer",
  ];
  for (const type of required) {
    assert.ok(ADVANCED_FIELD_TYPES.includes(type), `missing element type ${type}`);
  }

  for (const entry of ADVANCED_FIELD_LIBRARY) {
    assert.ok(entry.label && entry.group && entry.hint, `${entry.type} needs label, group and hint`);
  }
});

test("answer, choice and presentational element types are separated correctly", () => {
  assert.deepEqual(ADVANCED_CHOICE_TYPES, ["radio", "checkbox", "select"]);
  for (const type of ["image", "video", "audio", "heading", "paragraph", "divider", "spacer"]) {
    assert.equal(isAnswerField({ type }), false, `${type} must not collect an answer`);
  }
  for (const type of ADVANCED_ANSWER_TYPES) {
    assert.equal(isAnswerField({ type }), true, `${type} must collect an answer`);
  }
});

test("createAdvancedField produces unique ids, defaults and choice options", () => {
  const a = createAdvancedField("radio");
  const b = createAdvancedField("radio");
  assert.notEqual(a.id, b.id);
  assert.equal(a.type, "radio");
  assert.equal(a.required, false);
  assert.equal(a.width, "full");
  assert.equal(a.options.length, 3);
  assert.ok(a.options.every((option) => option.id && option.label));

  const text = createAdvancedField("short_text", { required: true, label: "Your name" });
  assert.equal(text.required, true);
  assert.equal(text.label, "Your name");
  assert.equal(text.options.length, 0);

  const unknown = createAdvancedField("not-a-real-type");
  assert.equal(unknown.type, "short_text");

  const spacer = createAdvancedField("spacer");
  assert.equal(spacer.height, 28);
});

/* ---------------------------------------------------------------- */
/* 2. Validation                                                     */
/* ---------------------------------------------------------------- */

function formWithFields(fields, settings = {}) {
  return createAdvancedForm({ fields, settings: { ...ADVANCED_DEFAULT_SETTINGS, ...settings } });
}

test("required answers block submission and report per-field messages", () => {
  const name = createAdvancedField("short_text", { label: "Full name", required: true });
  const form = formWithFields([name]);

  const empty = validateAdvancedAnswers(form, {});
  assert.equal(empty.ok, false);
  assert.match(empty.errors[name.id], /required/i);

  const filled = validateAdvancedAnswers(form, { [name.id]: "Ada Lovelace" });
  assert.equal(filled.ok, true);
  assert.deepEqual(filled.errors, {});
});

test("validation covers email, phone, number ranges, length, rating and choice membership", () => {
  const email = createAdvancedField("email", { label: "Email", required: true });
  const phone = createAdvancedField("phone", { label: "Phone" });
  const qty = createAdvancedField("number", { label: "Quantity", min: 2, max: 8 });
  const message = createAdvancedField("long_text", { label: "Message", minLength: 5, maxLength: 20 });
  const stars = createAdvancedField("rating", { label: "Rating", rateMax: 5 });
  const plan = createAdvancedField("radio", { label: "Plan" });
  const form = formWithFields([email, phone, qty, message, stars, plan]);

  assert.match(validateAdvancedAnswers(form, { [email.id]: "nope" }).errors[email.id], /valid email/i);
  assert.equal(validateAdvancedAnswers(form, { [email.id]: "ada@persora.app" }).errors[email.id], undefined);

  assert.match(validateAdvancedAnswers(form, { [phone.id]: "abc" }).errors[phone.id], /valid phone/i);
  assert.equal(validateAdvancedAnswers(form, { [phone.id]: "+1 555 0100" }).errors[phone.id], undefined);

  assert.match(validateAdvancedAnswers(form, { [qty.id]: 1 }).errors[qty.id], /2 or more/);
  assert.match(validateAdvancedAnswers(form, { [qty.id]: 9 }).errors[qty.id], /8 or less/);
  assert.equal(validateAdvancedAnswers(form, { [qty.id]: 4 }).errors[qty.id], undefined);

  assert.match(validateAdvancedAnswers(form, { [message.id]: "hey" }).errors[message.id], /at least 5/);
  assert.match(
    validateAdvancedAnswers(form, { [message.id]: "x".repeat(21) }).errors[message.id],
    /20 characters or fewer/,
  );

  assert.match(validateAdvancedAnswers(form, { [stars.id]: 9 }).errors[stars.id], /1 to 5/);
  assert.equal(validateAdvancedAnswers(form, { [stars.id]: "4" }).errors[stars.id], undefined);

  assert.match(validateAdvancedAnswers(form, { [plan.id]: "Platinum" }).errors[plan.id], /listed options/);
  assert.equal(validateAdvancedAnswers(form, { [plan.id]: plan.options[0].label }).errors[plan.id], undefined);
});

test("hidden elements are not validated", () => {
  const trigger = createAdvancedField("radio", {
    label: "Do you have a voucher?",
    options: [{ id: "opt_yes", label: "Yes" }, { id: "opt_no", label: "No" }],
  });
  const voucher = createAdvancedField("short_text", { label: "Voucher code", required: true });
  const form = createAdvancedForm({
    fields: [trigger, voucher],
    settings: {
      ...ADVANCED_DEFAULT_SETTINGS,
      logic: [{
        id: advancedId("rule"),
        fieldId: trigger.id,
        operator: "is",
        value: "Yes",
        targetFieldId: voucher.id,
        action: "hide",
      }],
    },
  });

  assert.equal(validateAdvancedAnswers(form, { [trigger.id]: "Yes" }).ok, true);
  assert.equal(validateAdvancedAnswers(form, { [trigger.id]: "No" }).ok, false);
});

/* ---------------------------------------------------------------- */
/* 3. Conditional logic                                              */
/* ---------------------------------------------------------------- */

test("conditional logic shows and hides later elements from earlier answers", () => {
  const trigger = createAdvancedField("select", { label: "Ticket type" });
  const workshop = createAdvancedField("short_text", { label: "Workshop preference" });
  const evening = createAdvancedField("short_text", { label: "Evening session" });
  const form = createAdvancedForm({
    fields: [trigger, workshop, evening],
    settings: {
      ...ADVANCED_DEFAULT_SETTINGS,
      logic: [
        { id: advancedId("rule"), fieldId: trigger.id, operator: "is", value: "Workshop", targetFieldId: workshop.id, action: "hide" },
        { id: advancedId("rule"), fieldId: trigger.id, operator: "is", value: "Evening", targetFieldId: evening.id, action: "hide" },
      ],
    },
  });

  const visibleFor = (answer) => resolveVisibleFieldIds(form, { [trigger.id]: answer });
  assert.deepEqual(visibleFor("Workshop"), [trigger.id, evening.id]);
  assert.deepEqual(visibleFor("Evening"), [trigger.id, workshop.id]);
  assert.deepEqual(visibleFor("Other"), [trigger.id, workshop.id, evening.id]);
});

test("logic supports every documented operator and never targets earlier elements", () => {
  assert.deepEqual(
    ADVANCED_LOGIC_OPERATORS.map((operator) => operator.id),
    ["is", "is_not", "contains", "is_empty", "is_not_empty", "gt", "lt"],
  );

  const first = createAdvancedField("number", { label: "Guests" });
  const second = createAdvancedField("short_text", { label: "Dietary needs" });
  const backward = createAdvancedForm({
    fields: [first, second],
    settings: {
      ...ADVANCED_DEFAULT_SETTINGS,
      logic: [{ id: advancedId("rule"), fieldId: second.id, operator: "is_not_empty", targetFieldId: first.id, action: "hide" }],
    },
  });
  // A rule pointing at an earlier element is ignored, so nothing disappears.
  assert.deepEqual(resolveVisibleFieldIds(backward, { [second.id]: "Vegan" }), [first.id, second.id]);
});

/* ---------------------------------------------------------------- */
/* 4. Availability, limits, CSV                                      */
/* ---------------------------------------------------------------- */

test("availability gate honours closed status, schedules and response limits", () => {
  const base = createAdvancedForm();

  assert.equal(advancedFormGate(base).open, true);

  const closed = createAdvancedForm({ settings: { ...ADVANCED_DEFAULT_SETTINGS, availability: "closed", closedMessage: "Closed for now." } });
  const closedGate = advancedFormGate(closed);
  assert.equal(closedGate.open, false);
  assert.equal(closedGate.message, "Closed for now.");

  const future = createAdvancedForm({
    settings: { ...ADVANCED_DEFAULT_SETTINGS, availability: "scheduled", opensAt: "2099-01-01T00:00:00.000Z" },
  });
  assert.equal(advancedFormGate(future).open, false);
  assert.equal(advancedFormGate(future).reason, "scheduled");

  const past = createAdvancedForm({
    settings: { ...ADVANCED_DEFAULT_SETTINGS, availability: "scheduled", closesAt: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(advancedFormGate(past).open, false);

  const limited = normalizeAdvancedForm({
    ...base,
    settings: { ...ADVANCED_DEFAULT_SETTINGS, responseLimit: 1 },
    responses: [{ id: "res_1", submittedAt: new Date().toISOString(), answers: {}, device: "Web" }],
  });
  const limitGate = advancedFormGate(limited);
  assert.equal(limitGate.open, false);
  assert.equal(limitGate.reason, "limit");
});

test("CSV export writes a header per question and escapes quotes and arrays", () => {
  const name = createAdvancedField("short_text", { label: "Name" });
  const tags = createAdvancedField("checkbox", { label: "Tags" });
  const form = normalizeAdvancedForm({
    ...createAdvancedForm({ fields: [name, tags] }),
    responses: [{
      id: "res_1",
      submittedAt: "2026-10-30T09:00:00.000Z",
      answers: { [name.id]: 'Ada "Countess"', [tags.id]: ["One", "Two"] },
      device: "Web",
    }],
  });

  const csv = advancedResponsesToCsv(form);
  const [header, row] = csv.split("\r\n");
  assert.equal(header, '"Submitted at","Name","Tags"');
  assert.equal(row, '"2026-10-30T09:00:00.000Z","Ada ""Countess""","One; Two"');
});

/* ---------------------------------------------------------------- */
/* 5. Form document normalisation                                    */
/* ---------------------------------------------------------------- */

test("normalisation clamps design values and keeps a valid document shape", () => {
  const form = normalizeAdvancedForm({
    title: "  Feedback  ",
    design: { layout: { columns: 9, maxWidth: 99999 }, controls: { radius: -4 } },
    settings: { submitLabel: "Send", responseLimit: "3" },
    fields: [{ type: "email", label: "Email", width: "half" }, { type: "nonsense" }],
    responses: [{ answers: { a: "b" } }],
  });

  assert.equal(form.title, "Feedback");
  assert.equal(form.design.layout.columns, 3);
  assert.equal(form.design.layout.maxWidth, 1200);
  assert.equal(form.design.controls.radius, 0);
  assert.equal(form.settings.submitLabel, "Send");
  assert.equal(form.settings.responseLimit, 3);
  assert.equal(form.fields.length, 2);
  assert.equal(form.fields[0].width, "half");
  assert.equal(form.fields[1].type, "short_text");
  assert.equal(form.responses.length, 1);
  assert.ok(form.responses[0].id && form.responses[0].submittedAt);
  assert.equal(form.status, "draft");
  assert.ok(form.id && form.slug);
  assert.deepEqual(Object.keys(form.design), ["background", "surface", "typography", "layout", "controls"]);
  assert.equal(ADVANCED_DEFAULT_DESIGN.layout.columns, 1);
  assert.equal(ADVANCED_LIMITS.fieldsPerForm, 120);
  assert.ok(ADVANCED_CATEGORIES.includes("Feedback"));
});

/* ---------------------------------------------------------------- */
/* 6. Templates                                                      */
/* ---------------------------------------------------------------- */

test("eight complete advanced form templates ship with designs and elements", () => {
  assert.equal(ADVANCED_TEMPLATES.length, 8);
  const ids = new Set();
  for (const template of ADVANCED_TEMPLATES) {
    assert.ok(template.id.startsWith("tpl-"), `${template.id} must use the tpl- prefix`);
    assert.equal(ids.has(template.id), false, `${template.id} is duplicated`);
    ids.add(template.id);
    assert.ok(template.title.length > 3, `${template.id} needs a title`);
    assert.ok(ADVANCED_CATEGORIES.includes(template.category), `${template.id} needs a known category`);
    assert.ok(template.fields.length >= 4, `${template.id} needs real content`);
    assert.ok(template.fields.some((field) => isAnswerField(field)), `${template.id} needs a question`);
    assert.ok(template.design && template.design.background, `${template.id} needs a real design`);
    const fieldIds = new Set(template.fields.map((field) => field.id));
    assert.equal(fieldIds.size, template.fields.length, `${template.id} has duplicate element ids`);
  }
});

test("buildAdvancedTemplate returns a fresh draft of the chosen template", () => {
  const [first, second] = ADVANCED_TEMPLATES;
  const a = buildAdvancedTemplate(first.id);
  const b = buildAdvancedTemplate(first.id);

  assert.notEqual(a.id, b.id);
  assert.notEqual(a.slug, b.slug);
  assert.equal(a.title, first.title);
  assert.equal(a.status, "draft");
  assert.equal(a.responses.length, 0);

  // Editing the clone must not mutate the shipped template.
  a.fields[0].label = "Changed";
  a.design.surface.radius = 2;
  assert.notEqual(first.fields[0].label, "Changed");
  assert.notEqual(first.design.surface.radius, 2);

  // Every element of the clone can be validated by the rules layer.
  assert.ok(validateAdvancedAnswers(a, {}).errors);
  assert.equal(buildAdvancedTemplate(second.id).title, second.title);
  assert.equal(buildAdvancedTemplate("tpl-does-not-exist"), null);
});

/* ---------------------------------------------------------------- */
/* 7. Wired surfaces and files                                       */
/* ---------------------------------------------------------------- */

test("advanced forms are reachable from Persora Forms through the right-edge pull tab", () => {
  const view = read("src/components/forms/FormsView.tsx");
  assert.match(view, /import AdvancedFormsView from "\.\/advanced\/AdvancedFormsView"/);
  assert.match(view, /persora\.forms\.surface/, "the chosen surface survives a reload");
  assert.match(view, /sessionStorage/, "surface memory is session-scoped so Persora Forms still opens standard");
  assert.match(view, /if \(advancedOpen\)/, "the advanced surface must render before the standard gate");
  assert.match(view, /pf-advanced-pull/, "the pull tab markup must exist");
  assert.match(view, /AdvancedFormPullButton/, "the pull tab is a named component");
  assert.match(view, /role|aria-label="Open Persora Advanced Forms"/);
  assert.match(view, /setAdvancedOpen\(false\)/, "the advanced surface must be closable back to standard Forms");

  const css = read(CSS);
  assert.match(css, /\.pf-surface-slide\s*\{[^}]*animation:/, "leaving the standard surface slides in");
  assert.match(css, /@keyframes pf-surface-in/, "the surface needs a horizontal slide keyframe");
  assert.match(css, /@keyframes aff-view-in-back/, "surfaces need a reverse slide");
  assert.match(css, /prefers-reduced-motion/, "motion must respect the user preference");
});

test("advanced forms dashboard keeps the Persora Forms structure", () => {
  const dashboard = read(DASHBOARD);
  assert.match(dashboard, /aff-gallery-shell/, "template gallery sits at the top");
  assert.match(dashboard, /aff-template-rail/, "the gallery scrolls horizontally");
  assert.match(dashboard, /Scroll templates left/);
  assert.match(dashboard, /Scroll templates right/);
  assert.match(dashboard, /Template gallery/, "there is a control to browse more templates");
  assert.match(dashboard, /aff-recent/, "recent forms section");
  assert.match(dashboard, /aff-form-grid/);
  assert.match(dashboard, /aff-form-list/, "grid/list toggle");
  assert.match(dashboard, /persora\.advanced-forms\.layout/, "layout preference persists");
  assert.match(dashboard, /type="search"/, "search field");
  assert.match(dashboard, /All categories/, "category dropdown");
  assert.match(dashboard, /SORTS/, "sorting controls");
  assert.match(dashboard, /AdvancedFormMiniature/, "cards show a live miniature of the real design");
  assert.match(dashboard, /sharedWith/, "shared indicator");
  for (const label of ["Rename", "Duplicate", "Share / copy respondent link", "Delete"]) {
    assert.match(dashboard, new RegExp(label), `three-dot menu must offer ${label}`);
  }
  assert.match(dashboard, /PersoraDeleteModal/, "delete uses the shared Persora modal");
  assert.match(dashboard, /PromptDialog/, "rename uses the shared prompt dialog");
});

test("advanced form builder provides Design, Configure and Responses tabs", () => {
  const builder = read(BUILDER);
  for (const tab of ["design", "configure", "responses"]) {
    assert.match(builder, new RegExp(`"${tab}"`), `builder needs a ${tab} tab`);
  }
  assert.match(builder, /AdvancedFormLibrary|ADVANCED_FIELD_LIBRARY/, "element library rail");
  assert.match(builder, /draggable/, "elements are draggable");
  assert.match(builder, /onDragOver/, "elements accept drag-over feedback");
  assert.match(builder, /const reorder = /, "drag reorder is wired");
  for (const control of ["Move element up", "Move element down", "Duplicate element", "Delete element"]) {
    assert.match(builder, new RegExp(control), `canvas tools must include ${control}`);
  }
  assert.match(builder, /Grid|WIDTHS/, "resize control (full / half / third)");
  assert.match(builder, /Conditional logic/, "logic builder");
  assert.match(builder, /responseLimit/, "response limits");
  assert.match(builder, /availability/, "availability setting");
  assert.match(builder, /confirmationMessage/, "confirmation message");
  assert.match(builder, /submitLabel/, "submission behaviour");
  assert.match(builder, /undo|redo/i, "undo / redo");
  assert.doesNotMatch(builder, /React\.createElement/, "builder stays declarative");
});

test("preview, publishing and the respondent view reuse one renderer", () => {
  const view = read(VIEW);
  const renderer = read(RENDERER);

  for (const mode of ["live", "preview", "mini"]) {
    assert.match(renderer, new RegExp(`"${mode}"`), `renderer must support ${mode} mode`);
  }
  assert.match(renderer, /advancedFormVars/, "one token bridge for every surface");
  assert.match(renderer, /advancedBackgroundStyle/);
  assert.match(view, /surface === "preview"/);
  assert.match(view, /surface === "respondent"/);
  assert.match(view, /handleSubmitResponse/);
  assert.match(view, /recordAdvancedResponse/);
  assert.match(view, /confirmationTitle/, "confirmation screen after submit");
  assert.match(view, /advancedFormGate/, "availability gate in the respondent view");
  assert.match(view, /device/, "responsive preview sizes");
  assert.match(view, /advanced-form=/, "shareable respondent links");
});

test("responses tab offers counts, search, filtering, detail and CSV export", () => {
  const responses = read(RESPONSES);
  assert.match(responses, /Export CSV/);
  assert.match(responses, /advancedResponsesToCsv/);
  assert.match(responses, /type="search"/);
  assert.match(responses, /filterField/, "per-question filter");
  assert.match(responses, /Answer summary/, "per-question inspection");
  assert.match(responses, /submittedAt/, "timestamps");
  assert.match(responses, /PersoraDeleteModal/, "deleting a response uses the shared modal");
  assert.match(responses, /aria-modal="true"/, "response detail is a dialog");
});

test("advanced forms store keeps one document per account under a versioned key", () => {
  const store = read(STORE);
  assert.match(store, /persora\.advanced-forms\.v1/);
  assert.match(store, /ADVANCED_LIMITS\.formsPerUser/);
  for (const fn of [
    "listAdvancedForms",
    "getAdvancedForm",
    "getAdvancedFormBySlug",
    "saveAdvancedForm",
    "createAdvancedFormDocument",
    "duplicateAdvancedForm",
    "deleteAdvancedForm",
    "recordAdvancedResponse",
    "deleteAdvancedResponse",
    "listPublishedAdvancedForms",
  ]) {
    assert.match(store, new RegExp(`export function ${fn}`), `store must export ${fn}`);
  }
});

test("advanced forms styles stay on canonical design-system tokens", () => {
  assert.ok(exists(CSS));
  const css = read(CSS);
  assert.ok(css.length > 4000, "the stylesheet must actually style the surfaces");

  // No raw font stacks: every font-family declaration resolves through a token.
  for (const match of css.matchAll(/font-family:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    assert.match(value, /var\(--(?:ds-font|aff-font)|^inherit$/, `font-family must use tokens: ${value}`);
  }

  // The renderer paints a page background, surface, grid and controls.
  for (const selector of [".aff-page", ".aff-surface", ".aff-fields", ".aff-input", ".aff-submit"]) {
    assert.ok(css.includes(`${selector} `) || css.includes(`${selector}{`) || css.includes(`${selector},`), `missing ${selector}`);
  }
  // Builder, dashboard, responses and preview surfaces are all styled.
  for (const prefix of ["affb-", "affr-", "aff-dash", "aff-preview", "aff-template", "aff-form-card"]) {
    assert.ok(css.includes(prefix), `missing styles for ${prefix}`);
  }
  // Responsive rules exist for tablet/mobile.
  assert.match(css, /@media \(max-width: 1320px\)/);
  assert.match(css, /@media \(max-width: 1080px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  // Narrow form surfaces reflow to a single column via a container query.
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /@container aff \(max-width: 480px\)/);
});

test("the advanced forms layer adds no new design tokens or global side effects", () => {
  const css = read(CSS);
  // Form-scoped custom properties only; canonical --ds-* tokens are read, never redefined.
  const redefined = [...css.matchAll(/(^|\n)\s*(--ds-[a-z0-9-]+)\s*:/g)].map((match) => match[2]);
  assert.deepEqual(redefined, [], "advanced-forms.css must not redefine --ds-* tokens");
  // Selectors stay scoped to advanced forms / the pull tab.
  const globalSelectors = [...css.matchAll(/(^|\n)([a-z][a-z0-9-]*)\s*\{/g)].map((match) => match[2]);
  assert.deepEqual(
    globalSelectors.filter((selector) => !["aff", "affb", "affr"].some((prefix) => selector.startsWith(prefix))),
    [],
    "advanced-forms.css must not style bare element selectors",
  );

  for (const file of [RULES, TEMPLATES, RENDERER]) {
    assert.ok(exists(file), `${file} must exist`);
  }
});
