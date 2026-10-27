/**
 * Admin → Errors & Improvements as a .docx — opens in Google Docs (upload to
 * Drive, then Open with Google Docs) or Word. Grouped Errors / Improvements /
 * To do, open items first; each with its area, details, who added it and
 * whether (and by whom) it was confirmed.
 */
import type { ErrorImprovementItem, ErrorImprovementKind } from "@/lib/supabase/errorsImprovements";

const KIND_HEADINGS: Record<ErrorImprovementKind, string> = { error: "Errors", improvement: "Improvements", todo: "To do" };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function buildErrorsImprovementsDocx(items: ErrorImprovementItem[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Errors and Improvements")] }),
    new Paragraph({
      children: [
        new TextRun({
          text: `As of ${fmtDate(new Date().toISOString())} · ${items.filter((i) => !i.confirmedAt).length} open, ${items.filter((i) => i.confirmedAt).length} confirmed`,
          color: "666666",
        }),
      ],
    }),
  ];

  for (const kind of ["error", "improvement", "todo"] as const) {
    const rows = items
      .filter((i) => i.kind === kind)
      .sort((a, b) => Number(!!a.confirmedAt) - Number(!!b.confirmedAt) || a.createdAt.localeCompare(b.createdAt));
    if (rows.length === 0) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300 }, children: [new TextRun(KIND_HEADINGS[kind])] }));
    rows.forEach((item, n) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200 },
          children: [new TextRun(`${n + 1}. ${item.title}`), ...(item.area ? [new TextRun({ text: `  (${item.area})`, color: "666666" })] : [])],
        }),
      );
      for (const line of item.details.split(/\r?\n/).filter((l) => l.trim())) children.push(new Paragraph({ children: [new TextRun(line)] }));
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Added by ${item.addedByName || "—"} on ${fmtDate(item.createdAt)}`, color: "666666", size: 18 }),
            new TextRun({
              text: item.confirmedAt ? `   ✓ Confirmed by ${item.confirmedByName || "—"} on ${fmtDate(item.confirmedAt)}` : "   ☐ Not confirmed yet",
              bold: true,
              color: item.confirmedAt ? "2E7D32" : "B26A00",
              size: 18,
            }),
          ],
        }),
      );
    });
  }

  return Packer.toBlob(new Document({ sections: [{ children }] }));
}
