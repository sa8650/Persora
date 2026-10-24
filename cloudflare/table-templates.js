// Persora Table — starter templates. Each call builds fresh ids. Smart Table
// example records carry `example: true` (shown with an "Example" label and
// removable in one step); spreadsheet example rows are labelled "Example:".
// Habits, loans and subscriptions have their own Persora modules, so there are
// deliberately no templates for them here.

import { emptySheetData, makeChoices, newField, newLocalId, newView } from "./table-rules.js";

const choices = (...labels) => makeChoices(labels.map((entry) => (Array.isArray(entry) ? { label: entry[0], color: entry[1] } : { label: entry })));

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Builds a Smart Table: spec fields are [name, type, options]; rows map field name → typed value (choice labels are resolved). */
function smart(spec) {
  const fields = spec.fields.map(([name, type, options = {}]) => {
    const field = newField(name, type, options);
    if (options.choices) field.choices = choices(...options.choices);
    if (options.width) field.width = options.width;
    return field;
  });
  const byName = new Map(fields.map((field) => [field.name, field]));
  const choiceId = (field, label) => field.choices.find((choice) => choice.label === label)?.id;
  const records = spec.rows.map((row, position) => {
    const values = {};
    for (const [name, value] of Object.entries(row)) {
      const field = byName.get(name);
      if (!field || value === null || value === undefined) continue;
      if (field.type === "select" || field.type === "status") values[field.id] = choiceId(field, value);
      else if (field.type === "multiselect") values[field.id] = value.map((label) => choiceId(field, label)).filter(Boolean);
      else values[field.id] = value;
    }
    return { id: crypto.randomUUID(), position: position + 1, values, example: true };
  });
  const views = spec.views.map(([type, name, options = {}]) => {
    const view = newView(type, name);
    if (options.groupBy) view.groupBy = byName.get(options.groupBy).id;
    if (options.dateField) view.dateField = byName.get(options.dateField).id;
    if (options.coverField) view.coverField = byName.get(options.coverField).id;
    if (options.sort) view.sort = options.sort.map(([fieldName, dir]) => ({ fieldId: byName.get(fieldName).id, dir }));
    return view;
  });
  const charts = (spec.charts || []).map(([type, groupField, valueField = null, aggregate = "count"]) => ({
    id: newLocalId("ch"), type, groupField: byName.get(groupField).id, valueField: valueField ? byName.get(valueField).id : null, aggregate,
  }));
  return { kind: "smart", meta: { fields, views, charts, primaryField: fields[0].id }, records };
}

/** Builds a spreadsheet sheet from rows of raw inputs (numbers, text, "=formulas") plus styles. */
function sheet(name, { rows, header = true, widths = [], money = [], percent = [], date = [], totalRow = null, cols = 26, rowCount = 100, currency = "BDT" }) {
  const data = emptySheetData(Math.max(rowCount, rows.length + 10), cols);
  rows.forEach((line, r) => line.forEach((input, c) => {
    if (input === null || input === undefined || input === "") return;
    const cell = typeof input === "string" && input.startsWith("=") ? { f: input } : { v: input };
    const style = {};
    if (header && r === 0) { style.b = 1; style.bg = "#F2F4F7"; style.bd = "b"; }
    if (totalRow !== null && r === totalRow) { style.b = 1; style.bd = "t"; }
    if (money.includes(c) && r > 0) { style.nf = "currency"; style.cur = currency; }
    if (percent.includes(c) && r > 0) { style.nf = "percent"; style.dp = 0; }
    if (date.includes(c) && r > 0) style.nf = "date";
    if (Object.keys(style).length) cell.s = style;
    data.cells[`${r}:${c}`] = cell;
  }));
  widths.forEach((width, c) => { if (width) data.colWidths[c] = width; });
  if (header) data.frozenRows = 1;
  return { id: crypto.randomUUID(), name, position: 0, data };
}

export const TABLE_TEMPLATES = Object.freeze([
  { id: "monthly-budget", name: "Monthly Budget", kind: "spreadsheet", description: "Planned vs actual spending with totals." },
  { id: "expense-tracker", name: "Expense Tracker", kind: "smart", description: "Log expenses by date, category and payment method." },
  { id: "savings-tracker", name: "Savings Tracker", kind: "spreadsheet", description: "Goals, amounts saved and progress." },
  { id: "contact-directory", name: "Contact Directory", kind: "smart", description: "People, companies, emails and tags." },
  { id: "inventory-list", name: "Inventory List", kind: "smart", description: "Items, quantities, costs and stock status." },
  { id: "content-calendar", name: "Content Calendar", kind: "smart", description: "Plan posts by date, channel and status." },
  { id: "job-applications", name: "Job Application Tracker", kind: "smart", description: "Applications from applied to offer." },
  { id: "study-planner", name: "Study Planner", kind: "smart", description: "Tasks by subject, due date and status." },
  { id: "reading-list", name: "Reading List", kind: "smart", description: "Books to read, reading and finished." },
  { id: "event-guests", name: "Event Guest List", kind: "smart", description: "Invitations, RSVPs and check-in." },
]);

/**
 * Builds a template's content. `today` is the member's local date (YYYY-MM-DD) for example dates.
 * @returns {{kind: "smart", meta: object, records: object[]} | {kind: "spreadsheet", sheets: object[]}}
 */
export function buildTemplate(id, today) {
  const d = (days) => addDays(today, days);
  switch (id) {
    case "monthly-budget": {
      const rows = [
        ["Category", "Planned", "Actual", "Difference", "Notes"],
        ["Example: Rent", 18000, 18000, "=B2-C2", ""],
        ["Example: Groceries", 9000, 9850, "=B3-C3", "Includes Eid shopping"],
        ["Example: Utilities", 3500, 3120, "=B4-C4", "Electricity, gas, water"],
        ["Example: Transport", 2500, 2900, "=B5-C5", ""],
        ["Example: Internet & phone", 1500, 1500, "=B6-C6", ""],
        ["Example: Savings", 5000, 5000, "=B7-C7", "Moved to savings account"],
        ["Total", "=SUM(B2:B7)", "=SUM(C2:C7)", "=SUM(D2:D7)", ""],
        [],
        ["Monthly income", 45000],
        ["Left after spending", "=B10-C8"],
      ];
      const budget = sheet("Budget", { rows, widths: [190, 120, 120, 120, 220], money: [1, 2, 3], totalRow: 7, cols: 10 });
      budget.data.cells["9:0"].s = { b: 1 };
      budget.data.cells["10:0"].s = { b: 1 };
      budget.data.cells["9:1"].s = { nf: "currency", cur: "BDT" };
      budget.data.cells["10:1"].s = { nf: "currency", cur: "BDT", b: 1 };
      return { kind: "spreadsheet", sheets: [budget] };
    }
    case "savings-tracker": {
      const rows = [
        ["Goal", "Target", "Saved", "Remaining", "Progress", "Target date"],
        ["Example: Emergency fund", 100000, 42000, "=B2-C2", "=C2/B2", d(240)],
        ["Example: New laptop", 85000, 30000, "=B3-C3", "=C3/B3", d(120)],
        ["Example: Family trip", 60000, 15500, "=B4-C4", "=C4/B4", d(180)],
        ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)", "=IF(B5=0, 0, C5/B5)", ""],
      ];
      return { kind: "spreadsheet", sheets: [sheet("Savings", { rows, widths: [200, 120, 120, 120, 100, 130], money: [1, 2, 3], percent: [4], date: [5], totalRow: 4, cols: 10 })] };
    }
    case "expense-tracker": return smart({
      fields: [
        ["Expense", "text", { width: 220 }], ["Date", "date"], ["Category", "select", { choices: [["Food", "orange"], ["Transport", "blue"], ["Bills", "violet"], ["Shopping", "teal"], ["Health", "red"], ["Other", "gray"]] }],
        ["Amount", "currency", { currency: "BDT" }], ["Payment method", "select", { choices: ["Cash", "Card", "Mobile banking", "Bank transfer"] }], ["Receipt", "attachment"], ["Notes", "text"],
      ],
      rows: [
        { Expense: "Weekly groceries", Date: d(-6), Category: "Food", Amount: 2450, "Payment method": "Card" },
        { Expense: "Bus card top-up", Date: d(-4), Category: "Transport", Amount: 500, "Payment method": "Mobile banking" },
        { Expense: "Electricity bill", Date: d(-2), Category: "Bills", Amount: 1820, "Payment method": "Bank transfer", Notes: "October" },
        { Expense: "Pharmacy", Date: d(-1), Category: "Health", Amount: 640, "Payment method": "Cash" },
      ],
      views: [["table", "All expenses", { sort: [["Date", "desc"]] }], ["board", "By category", { groupBy: "Category" }], ["calendar", "Calendar", { dateField: "Date" }]],
      charts: [["donut", "Category", "Amount", "sum"], ["line", "Date", "Amount", "sum"]],
    });
    case "contact-directory": return smart({
      fields: [
        ["Name", "text", { width: 200 }], ["Email", "email"], ["Phone", "text"], ["Company", "text"],
        ["Tags", "multiselect", { choices: [["Family", "green"], ["Friend", "blue"], ["Work", "violet"], ["Service", "orange"]] }], ["Website", "url"], ["Notes", "text"],
      ],
      rows: [
        { Name: "Nadia Rahman", Email: "nadia@example.com", Phone: "+880 1711-000001", Company: "Green Leaf Ltd", Tags: ["Work"] },
        { Name: "Dr. Karim Hossain", Email: "clinic@example.com", Phone: "+880 1811-000002", Company: "City Clinic", Tags: ["Service"], Website: "https://example.com" },
        { Name: "Ayesha Siddiqua", Email: "ayesha@example.com", Phone: "+880 1911-000003", Tags: ["Friend", "Family"] },
      ],
      views: [["table", "All contacts", { sort: [["Name", "asc"]] }], ["gallery", "Cards"]],
      charts: [["bar", "Tags"]],
    });
    case "inventory-list": return smart({
      fields: [
        ["Item", "text", { width: 200 }], ["SKU", "text"], ["Quantity", "number", { decimals: 0 }], ["Unit cost", "currency", { currency: "BDT" }],
        ["Location", "select", { choices: ["Shelf A", "Shelf B", "Storeroom"] }], ["Stock status", "status", { choices: [["In stock", "green"], ["Low", "yellow"], ["Out of stock", "red"]] }], ["Photo", "attachment"],
      ],
      rows: [
        { Item: "A4 paper (ream)", SKU: "PAP-A4", Quantity: 24, "Unit cost": 420, Location: "Shelf A", "Stock status": "In stock" },
        { Item: "Printer toner", SKU: "TON-12", Quantity: 2, "Unit cost": 3800, Location: "Storeroom", "Stock status": "Low" },
        { Item: "Whiteboard markers", SKU: "MRK-BL", Quantity: 0, "Unit cost": 60, Location: "Shelf B", "Stock status": "Out of stock" },
      ],
      views: [["table", "All items"], ["board", "By stock status", { groupBy: "Stock status" }], ["gallery", "Photos", { coverField: "Photo" }]],
      charts: [["bar", "Location", "Quantity", "sum"], ["donut", "Stock status"]],
    });
    case "content-calendar": return smart({
      fields: [
        ["Title", "text", { width: 240 }], ["Publish date", "date"], ["Status", "status", { choices: [["Idea", "gray"], ["Drafting", "yellow"], ["Scheduled", "blue"], ["Published", "green"]] }],
        ["Channel", "select", { choices: ["Blog", "Facebook", "Instagram", "YouTube", "Newsletter"] }], ["Owner", "person"], ["Link", "url"], ["Notes", "text"],
      ],
      rows: [
        { Title: "Monsoon travel tips", "Publish date": d(3), Status: "Drafting", Channel: "Blog" },
        { Title: "Behind the scenes video", "Publish date": d(7), Status: "Scheduled", Channel: "YouTube" },
        { Title: "Monthly newsletter", "Publish date": d(10), Status: "Idea", Channel: "Newsletter" },
      ],
      views: [["calendar", "Calendar", { dateField: "Publish date" }], ["board", "Pipeline", { groupBy: "Status" }], ["table", "All posts", { sort: [["Publish date", "asc"]] }]],
      charts: [["donut", "Status"], ["bar", "Channel"]],
    });
    case "job-applications": return smart({
      fields: [
        ["Company", "text", { width: 200 }], ["Role", "text", { width: 200 }], ["Status", "status", { choices: [["Applied", "blue"], ["Interview", "yellow"], ["Offer", "green"], ["Rejected", "red"]] }],
        ["Applied on", "date"], ["Salary", "currency", { currency: "BDT" }], ["Job link", "url"], ["Contact email", "email"], ["Notes", "text"],
      ],
      rows: [
        { Company: "Brightline Software", Role: "Frontend developer", Status: "Interview", "Applied on": d(-12), Salary: 90000, "Job link": "https://example.com/jobs/1" },
        { Company: "Delta Logistics", Role: "Operations analyst", Status: "Applied", "Applied on": d(-5), "Contact email": "hr@example.com" },
        { Company: "Riverbank Foods", Role: "Data assistant", Status: "Rejected", "Applied on": d(-30) },
      ],
      views: [["board", "Pipeline", { groupBy: "Status" }], ["table", "All applications", { sort: [["Applied on", "desc"]] }], ["calendar", "Calendar", { dateField: "Applied on" }]],
      charts: [["donut", "Status"]],
    });
    case "study-planner": return smart({
      fields: [
        ["Task", "text", { width: 240 }], ["Subject", "select", { choices: [["Mathematics", "blue"], ["Physics", "violet"], ["English", "green"], ["Chemistry", "orange"]] }], ["Due date", "date"],
        ["Status", "status"], ["Hours", "number", { decimals: 1 }], ["Priority", "select", { choices: [["High", "red"], ["Medium", "yellow"], ["Low", "gray"]] }],
      ],
      rows: [
        { Task: "Calculus problem set 4", Subject: "Mathematics", "Due date": d(2), Status: "In progress", Hours: 3, Priority: "High" },
        { Task: "Lab report: pendulum", Subject: "Physics", "Due date": d(5), Status: "Not started", Hours: 2.5, Priority: "Medium" },
        { Task: "Essay outline", Subject: "English", "Due date": d(-1), Status: "Done", Hours: 1.5, Priority: "Low" },
      ],
      views: [["table", "All tasks", { sort: [["Due date", "asc"]] }], ["calendar", "Due dates", { dateField: "Due date" }], ["board", "By status", { groupBy: "Status" }]],
      charts: [["bar", "Subject", "Hours", "sum"], ["donut", "Status"]],
    });
    case "reading-list": return smart({
      fields: [
        ["Title", "text", { width: 220 }], ["Author", "text"], ["Status", "status", { choices: [["Want to read", "gray"], ["Reading", "blue"], ["Finished", "green"]] }],
        ["Rating", "number", { decimals: 0 }], ["Finished on", "date"], ["Genre", "multiselect", { choices: ["Fiction", "Non-fiction", "History", "Science", "Poetry"] }], ["Cover", "attachment"],
      ],
      rows: [
        { Title: "Gitanjali", Author: "Rabindranath Tagore", Status: "Finished", Rating: 5, "Finished on": d(-20), Genre: ["Poetry"] },
        { Title: "A Brief History of Time", Author: "Stephen Hawking", Status: "Reading", Genre: ["Science", "Non-fiction"] },
        { Title: "Padma Nadir Majhi", Author: "Manik Bandopadhyay", Status: "Want to read", Genre: ["Fiction"] },
      ],
      views: [["gallery", "Shelf", { coverField: "Cover" }], ["board", "By status", { groupBy: "Status" }], ["table", "All books"]],
      charts: [["donut", "Status"]],
    });
    case "event-guests": return smart({
      fields: [
        ["Guest", "text", { width: 200 }], ["Email", "email"], ["RSVP", "status", { choices: [["Invited", "gray"], ["Attending", "green"], ["Maybe", "yellow"], ["Not attending", "red"]] }],
        ["Party size", "number", { decimals: 0 }], ["Dietary needs", "multiselect", { choices: ["Vegetarian", "Vegan", "Halal", "Gluten-free", "No restrictions"] }], ["Table no.", "number", { decimals: 0 }], ["Checked in", "checkbox"],
      ],
      rows: [
        { Guest: "Farhan & family", Email: "farhan@example.com", RSVP: "Attending", "Party size": 4, "Dietary needs": ["Halal"], "Table no.": 2, "Checked in": false },
        { Guest: "Mitu Akter", Email: "mitu@example.com", RSVP: "Maybe", "Party size": 1, "Dietary needs": ["Vegetarian"] },
        { Guest: "Tanvir Ahmed", RSVP: "Invited", "Party size": 2 },
      ],
      views: [["table", "Guest list"], ["board", "By RSVP", { groupBy: "RSVP" }]],
      charts: [["donut", "RSVP"], ["bar", "RSVP", "Party size", "sum"]],
    });
    default: return null;
  }
}

/** A blank Smart Table: Name, Notes, Status and a Table view. */
export function blankSmartTable() {
  const name = newField("Name", "text");
  name.width = 220;
  const fields = [name, newField("Notes", "text"), newField("Status", "status")];
  return { kind: "smart", meta: { fields, views: [newView("table", "Grid")], charts: [], primaryField: name.id }, records: [] };
}
export function blankSpreadsheet() {
  return { kind: "spreadsheet", sheets: [{ id: crypto.randomUUID(), name: "Sheet1", position: 0, data: emptySheetData() }] };
}
