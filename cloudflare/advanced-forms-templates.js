// Persora Advanced Forms — starter templates.
// Each template is a complete, self-contained form document (design + elements),
// so the gallery previews and the published form always look identical.
import {
  advancedId,
  createAdvancedField,
  normalizeAdvancedDesign,
  normalizeAdvancedSettings,
} from "./advanced-forms-rules.js";

const base = {
  description: "",
  category: "General",
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
  responses: [],
};

function field(type, label, overrides = {}) {
  return createAdvancedField(type, { label, ...overrides });
}

function options(...labels) {
  return labels.map((label) => ({ id: advancedId("opt"), label }));
}

function form({ id, title, description, category, design, fields, settings }) {
  return {
    ...base,
    id,
    slug: id,
    title,
    description,
    category,
    design: normalizeAdvancedDesign(design),
    settings: normalizeAdvancedSettings(settings),
    fields,
  };
}

export const ADVANCED_TEMPLATES = [
  form({
    id: "tpl-feedback",
    title: "Customer Feedback",
    description: "Tell us how we did and what we can improve.",
    category: "Feedback",
    design: {
      background: { type: "gradient", from: "#eef2ff", to: "#fdf2f8", angle: 135, color: "#eef2ff" },
      surface: { color: "#ffffff", radius: 22, shadow: "soft" },
      typography: { font: "sans", headingSize: 32, align: "left" },
      layout: { maxWidth: 760, columns: 1, gap: 16, paddingX: 30, paddingY: 32 },
      controls: { radius: 12, buttonBg: "#4f46e5", focusColor: "#4f46e5", buttonRadius: 12 },
    },
    fields: [
      field("heading", "Your experience"),
      field("paragraph", "Three quick questions — it takes less than a minute."),
      field("short_text", "Your name", { placeholder: "Full name", width: "half" }),
      field("email", "Email address", { placeholder: "name@example.com", width: "half" }),
      field("rating", "How would you rate your experience?", { rateMax: 5 }),
      field("radio", "Would you recommend us?", { options: options("Definitely", "Maybe", "Not right now") }),
      field("long_text", "What could we do better?", { placeholder: "Share as much detail as you like" }),
    ],
  }),
  form({
    id: "tpl-event",
    title: "Event Registration",
    description: "Reserve a seat at our next in-person session.",
    category: "Registration",
    design: {
      background: { type: "gradient", from: "#0f172a", to: "#1e293b", angle: 160, color: "#0f172a" },
      surface: { color: "#111827", radius: 18, shadow: "strong" },
      typography: { font: "sans", headingSize: 34, titleColor: "#f8fafc", textColor: "#cbd5e1", labelColor: "#e2e8f0", align: "center" },
      layout: { maxWidth: 700, columns: 2, gap: 16, paddingX: 32, paddingY: 34 },
      controls: { radius: 10, borderColor: "#334155", inputBg: "#0b1220", focusColor: "#38bdf8", buttonBg: "#38bdf8", buttonText: "#04121f", buttonFullWidth: true },
    },
    fields: [
      field("heading", "Product Night · Dhaka"),
      field("paragraph", "Thursday, 12 November · 6:30 PM · Lakeside Hall"),
      field("short_text", "Full name", { required: true, width: "half" }),
      field("email", "Email", { required: true, width: "half" }),
      field("phone", "Mobile number", { width: "half" }),
      field("select", "Ticket type", { options: options("General admission", "Student", "Team of four"), width: "half" }),
      field("date", "Arrival date"),
      field("checkbox", "Dietary needs", { options: options("Vegetarian", "Vegan", "Gluten free", "No restrictions") }),
    ],
  }),
  form({
    id: "tpl-application",
    title: "Job Application",
    description: "A short application for the role you are interested in.",
    category: "Application",
    design: {
      background: { type: "solid", color: "#f4f1ec" },
      surface: { color: "#fffdf8", radius: 6, shadow: "soft" },
      typography: { font: "serif", headingSize: 34, headingWeight: 600, titleColor: "#1c1917", textColor: "#57534e", labelColor: "#292524", align: "left" },
      layout: { maxWidth: 720, columns: 1, gap: 14, paddingX: 34, paddingY: 36 },
      controls: { radius: 4, borderColor: "#e7e5e4", buttonBg: "#1c1917", buttonRadius: 4, focusColor: "#b45309" },
    },
    fields: [
      field("heading", "Applicant details"),
      field("paragraph", "We read every application personally."),
      field("short_text", "Full name", { required: true }),
      field("email", "Email address", { required: true }),
      field("phone", "Phone number"),
      field("select", "Role", { options: options("Product designer", "Frontend engineer", "Operations") }),
      field("file", "Attach your CV"),
      field("long_text", "Why this role?", { placeholder: "A few sentences is plenty" }),
    ],
  }),
  form({
    id: "tpl-order",
    title: "Product Order",
    description: "Order a print of any photo in the studio gallery.",
    category: "Order",
    design: {
      background: { type: "gradient", from: "#fff7ed", to: "#fed7aa", angle: 120, color: "#fff7ed" },
      surface: { color: "#ffffff", radius: 24, shadow: "strong" },
      typography: { font: "rounded", headingSize: 30, titleColor: "#7c2d12", textColor: "#57534e", labelColor: "#7c2d12", align: "left" },
      layout: { maxWidth: 780, columns: 2, gap: 14, paddingX: 28, paddingY: 30 },
      controls: { radius: 14, buttonBg: "#ea580c", focusColor: "#ea580c", buttonRadius: 14 },
    },
    fields: [
      field("heading", "Print order"),
      field("paragraph", "Choose a size and finish — we print on archival paper."),
      field("short_text", "Name", { required: true, width: "half" }),
      field("email", "Email", { required: true, width: "half" }),
      field("select", "Size", { options: options("A4", "A3", "A2", "Square 30×30") }),
      field("radio", "Finish", { options: options("Matte", "Satin", "Gloss") }),
      field("number", "Quantity", { min: 1, max: 20, placeholder: "1" }),
      field("color", "Preferred accent colour"),
      field("long_text", "Delivery notes"),
    ],
  }),
  form({
    id: "tpl-booking",
    title: "Workshop Booking",
    description: "Book a seat in the weekend photography workshop.",
    category: "Booking",
    design: {
      background: { type: "gradient", from: "#ecfeff", to: "#ccfbf1", angle: 150, color: "#ecfeff" },
      surface: { color: "#ffffff", radius: 20, shadow: "soft" },
      typography: { font: "sans", headingSize: 31, titleColor: "#0f766e", labelColor: "#115e59", textColor: "#475569" },
      layout: { maxWidth: 720, columns: 2, gap: 16, paddingX: 30, paddingY: 32 },
      controls: { radius: 12, buttonBg: "#0d9488", focusColor: "#0d9488", buttonRadius: 12 },
    },
    fields: [
      field("heading", "Weekend photography workshop"),
      field("paragraph", "Saturday 10:00–13:00 · Studio 4, Jessore"),
      field("short_text", "Name", { required: true, width: "half" }),
      field("phone", "Mobile", { required: true, width: "half" }),
      field("date", "Preferred date", { width: "half" }),
      field("time", "Preferred start time", { width: "half" }),
      field("radio", "Experience level", { options: options("Beginner", "Intermediate", "Advanced") }),
    ],
  }),
  form({
    id: "tpl-onboarding",
    title: "Employee Onboarding",
    description: "Everything we need before your first day.",
    category: "Contact",
    design: {
      background: { type: "solid", color: "#f1f5f9" },
      surface: { color: "#ffffff", radius: 14, shadow: "soft" },
      typography: { font: "sans", baseSize: 14, headingSize: 27, align: "left" },
      layout: { maxWidth: 820, columns: 2, gap: 12, sectionGap: 20, paddingX: 26, paddingY: 26, fieldSpacing: 12 },
      controls: { radius: 8, buttonBg: "#0f172a", focusColor: "#2563eb", buttonRadius: 8 },
    },
    fields: [
      field("heading", "Your first week"),
      field("short_text", "Legal name", { required: true, width: "half" }),
      field("short_text", "Preferred name", { width: "half" }),
      field("email", "Work email", { required: true, width: "half" }),
      field("phone", "Phone", { width: "half" }),
      field("date", "Start date", { width: "half" }),
      field("select", "Department", { options: options("Design", "Engineering", "Operations", "Support"), width: "half" }),
      field("short_text", "Emergency contact", { width: "half" }),
      field("phone", "Emergency phone", { width: "half" }),
      field("checkbox", "Confirmations", { options: options("I have read the handbook", "I completed the security training") }),
    ],
  }),
  form({
    id: "tpl-contact",
    title: "Customer Contact",
    description: "Send us a message and we will reply within a day.",
    category: "Contact",
    design: {
      background: { type: "none", color: "#ffffff" },
      surface: { color: "#ffffff", radius: 0, shadow: "none", border: false },
      typography: { font: "mono", headingSize: 26, headingWeight: 600, titleColor: "#111827", textColor: "#4b5563", labelColor: "#111827" },
      layout: { maxWidth: 640, columns: 1, gap: 12, paddingX: 24, paddingY: 24 },
      controls: { radius: 0, borderColor: "#d1d5db", buttonBg: "#111827", buttonRadius: 0, focusColor: "#111827" },
    },
    fields: [
      field("heading", "Get in touch"),
      field("short_text", "Name", { required: true }),
      field("email", "Email", { required: true }),
      field("select", "Topic", { options: options("Order", "Billing", "Partnership", "Something else") }),
      field("long_text", "Message", { required: true }),
    ],
  }),
  form({
    id: "tpl-satisfaction",
    title: "Team Satisfaction Pulse",
    description: "A quick anonymous pulse survey for the team.",
    category: "Survey",
    design: {
      background: { type: "gradient", from: "#f5f3ff", to: "#ede9fe", angle: 200, color: "#f5f3ff" },
      surface: { color: "#ffffff", radius: 26, shadow: "soft" },
      typography: { font: "sans", headingSize: 29, titleColor: "#4c1d95", labelColor: "#5b21b6", textColor: "#52525b", align: "center" },
      layout: { maxWidth: 680, columns: 1, gap: 16, paddingX: 32, paddingY: 34 },
      controls: { radius: 16, buttonBg: "#7c3aed", focusColor: "#7c3aed", buttonRadius: 16, buttonFullWidth: true },
    },
    fields: [
      field("heading", "How is the week going?"),
      field("paragraph", "Responses are collected without names."),
      field("rating", "Overall energy this week", { rateMax: 5 }),
      field("radio", "Do you have what you need to do your best work?", { options: options("Yes", "Mostly", "Not yet") }),
      field("long_text", "Anything the team should know?")
    ],
  }),
];

export function buildAdvancedTemplate(templateId) {
  const template = ADVANCED_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) return null;
  const clone = JSON.parse(JSON.stringify(template));
  const now = new Date().toISOString();
  return {
    ...clone,
    id: advancedId("afm"),
    slug: advancedId("slug"),
    createdAt: now,
    updatedAt: now,
    status: "draft",
  };
}
