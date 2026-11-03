// Persora TravelSpace — Vector PDF Travel Journal & Trip Summary Exporter (pdf-lib).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatCoordinatePair, formatTravelMoney } from "../../cloudflare/travel-space-rules.js";
import { getDestinationStopLabel, type TravelWorkspace } from "./travel-space-api";

function safeAscii(input: string): string {
  return String(input || "")
    .replace(/৳/g, "BDT ")
    .replace(/₹/g, "INR ")
    .replace(/฿/g, "THB ")
    .replace(/→/g, "->")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "");
}

function wrapText(text: string, maxChars: number): string[] {
  const paragraphs = safeAscii(text).split(/\r?\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const words = para.trim().split(/\s+/);
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function buildTravelJournalPdfBytes(ws: TravelWorkspace): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safeAscii(`${ws.trip.title} - Travel Journal`));
  pdf.setCreator("Persora TravelSpace");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 612;
  const H = 792;
  const MX = 52;
  let page = pdf.addPage([W, H]);
  let y = H - 56;

  const ensureSpace = (needed: number) => {
    if (y - needed < 56) {
      page = pdf.addPage([W, H]);
      y = H - 56;
    }
  };

  const drawHeading = (label: string) => {
    ensureSpace(34);
    y -= 10;
    page.drawText(safeAscii(label), {
      x: MX,
      y,
      size: 13,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 6;
    page.drawLine({
      start: { x: MX, y },
      end: { x: W - MX, y },
      thickness: 0.7,
      color: rgb(0.86, 0.89, 0.93),
    });
    y -= 14;
  };

  const drawLine = (txt: string, opts?: { bold?: boolean; size?: number; indent?: number; muted?: boolean }) => {
    const size = opts?.size ?? 10;
    const indent = opts?.indent ?? 0;
    const lines = wrapText(txt, Math.floor((W - MX * 2 - indent) / (size * 0.52)));
    for (const ln of lines) {
      ensureSpace(size + 6);
      if (ln) {
        page.drawText(ln, {
          x: MX + indent,
          y,
          size,
          font: opts?.bold ? fontBold : font,
          color: opts?.muted ? rgb(0.4, 0.45, 0.53) : rgb(0.12, 0.16, 0.23),
        });
      }
      y -= size + 5;
    }
  };

  // Header Banner
  page.drawText("PERSORA TRAVELSPACE", {
    x: MX,
    y,
    size: 8.5,
    font: fontBold,
    color: rgb(0.15, 0.39, 0.92),
  });
  y -= 20;
  page.drawText(safeAscii(ws.trip.title), {
    x: MX,
    y,
    size: 20,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 18;

  const destLabel =
    ws.destinations
      .map((d, idx) => `${getDestinationStopLabel(d, idx)} [${formatCoordinatePair(d.latitude, d.longitude)}]`)
      .join(" -> ") || "No route stops pinned";
  drawLine(`${destLabel}  |  ${ws.trip.startDate} to ${ws.trip.actualReturnDate || ws.trip.endDate} (${ws.trip.durationDays} days)`, {
    muted: true,
    size: 10,
  });
  drawLine(
    `Status: ${ws.trip.status.toUpperCase()}  |  Companion: ${ws.trip.companionType} (${ws.travellers.length} travellers)  |  Primary Currency: ${ws.trip.primaryCurrency}`,
    { muted: true, size: 9.5 },
  );
  if (ws.trip.rating) {
    drawLine(`Trip Rating: ${ws.trip.rating} / 5`, { bold: true, size: 10 });
  }
  if (ws.trip.description) {
    y -= 4;
    drawLine(ws.trip.description, { size: 10 });
  }

  // Travellers
  drawHeading("Travellers");
  for (const tr of ws.travellers) {
    drawLine(`- ${tr.fullName} (${tr.role}${tr.responsibility ? ` - ${tr.responsibility}` : ""})`, { size: 9.5 });
  }

  // Financial Summary
  drawHeading("Budget & Expense Summary");
  const b = ws.budgetOverview;
  const cur = ws.trip.primaryCurrency;
  drawLine(`Planned Budget: ${formatTravelMoney(b.totalPlannedBudget, cur)}   |   Total Expenses: ${formatTravelMoney(b.totalExpenses, cur)}   |   Remaining: ${formatTravelMoney(b.remainingBudget, cur)}`, { bold: true, size: 10 });
  drawLine(`Personal Expenses: ${formatTravelMoney(b.personalExpenses, cur)}   |   Shared Expenses: ${formatTravelMoney(b.sharedExpenses, cur)}`, { size: 9.5, muted: true });

  // Itinerary Highlights
  const scheduled = ws.items.filter((i) => i.scheduledDate);
  if (scheduled.length > 0) {
    drawHeading("Itinerary & Activities");
    for (const day of ws.days) {
      const dayItems = scheduled.filter((i) => i.scheduledDate === day.date);
      if (!dayItems.length) continue;
      drawLine(`Day ${day.dayNumber} (${day.date})`, { bold: true, size: 10 });
      for (const act of dayItems) {
        const timePart = act.startTime ? `${act.startTime}${act.endTime ? `-${act.endTime}` : ""} ` : "";
        drawLine(`- ${timePart}${act.title}${act.location ? ` @ ${act.location}` : ""} [${act.status}]`, {
          size: 9.5,
          indent: 10,
        });
      }
    }
  }

  // Travel Journal & Memories
  if (ws.memories.length > 0 || ws.trip.completionNotes) {
    drawHeading("Travel Journal & Memories");
    if (ws.trip.completionNotes) {
      drawLine("Trip Reflection:", { bold: true, size: 10 });
      drawLine(ws.trip.completionNotes, { size: 9.5, indent: 8 });
      y -= 4;
    }
    for (const mem of ws.memories) {
      drawLine(
        `${mem.title}${mem.memoryDate ? ` (${mem.memoryDate})` : ""}${mem.location ? ` - ${mem.location}` : ""}`,
        { bold: true, size: 10 },
      );
      if (mem.caption) drawLine(mem.caption, { size: 9.5, muted: true, indent: 8 });
      if (mem.journalBody) drawLine(mem.journalBody, { size: 9.5, indent: 8 });
      y -= 4;
    }
  }

  return pdf.save();
}

export async function downloadTravelJournalPdf(ws: TravelWorkspace): Promise<void> {
  const bytes = await buildTravelJournalPdfBytes(ws);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = ws.trip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
  a.href = url;
  a.download = `${slug}-travel-journal.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
