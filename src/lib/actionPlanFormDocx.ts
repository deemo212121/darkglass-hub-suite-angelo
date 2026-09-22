/**
 * Native .docx generator for the 4th Warning — Manager's Action Plan Form —
 * mirrors warningFormDocx.ts's approach (real Word tables/shading/images
 * via the `docx` library). Includes the same letterhead (logo + ribbon
 * header, footer graphic) as the HTML/PDF template.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  BorderStyle, WidthType, VerticalAlign, AlignmentType,
} from "docx";
import type { ActionPlanFormData, ActionPlanFormSignatures } from "./actionPlanFormTemplate";

const INK = "111827";
const MUTED = "374151";
const RULE = "9ca3af";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const BOTTOM_RULE_CELL_BORDERS = { ...NO_CELL_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } };
const CELL_MARGINS = { top: 60, bottom: 60, left: 0, right: 120 };

const fmtDate = (iso: string) => {
  if (!iso) return "";
  // A date-only string ("2026-09-17") parses as UTC midnight; formatting
  // it back out in the browser's local timezone (anything behind UTC,
  // i.e. all of the US) rolls it back a day — "9/17" printing as "9/16".
  // Parsing the y/m/d parts directly into a local Date avoids that. A
  // full timestamp has no such ambiguity and is left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, color: MUTED, size: 20 }),
      new TextRun({ text: value || "—", bold: true, color: INK, size: 20 }),
    ],
  });
}

function planItem(title: string, text: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: title, bold: true, size: 20, color: INK })] }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: text || " ", size: 20 })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db", space: 4 } },
    }),
  ];
}

function signatureRow(label: string, name: string, entry: { url: string; signedAt: string } | undefined, signatureImage: Uint8Array | null): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue(label, name)] }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: BOTTOM_RULE_CELL_BORDERS,
            margins: CELL_MARGINS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Signature: ", color: MUTED, size: 20 }),
                  ...(signatureImage ? [new ImageRun({ type: "png", data: signatureImage, transformation: { width: 90, height: 30 } })] : []),
                ],
              }),
            ],
          }),
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Date", entry ? fmtDate(entry.signedAt) : "")] }),
        ],
      }),
    ],
  });
}

export async function buildActionPlanFormDocxBlob(
  data: ActionPlanFormData,
  logoDataUrl: string,
  ribbonDataUrl: string,
  footerDataUrl: string,
  signatures: ActionPlanFormSignatures = {}
): Promise<Blob> {
  const logoBytes = logoDataUrl ? await dataUrlToBytes(logoDataUrl) : null;
  const ribbonBytes = ribbonDataUrl ? await dataUrlToBytes(ribbonDataUrl) : null;
  const footerBytes = footerDataUrl ? await dataUrlToBytes(footerDataUrl) : null;
  const sigBytes: Partial<Record<keyof ActionPlanFormSignatures, Uint8Array>> = {};
  for (const slot of ["manager", "senior_manager", "hr_staff", "executive", "employee"] as const) {
    const entry = signatures[slot];
    if (entry) sigBytes[slot] = await dataUrlToBytes(entry.url);
  }

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: logoBytes ? [new ImageRun({ type: "png", data: logoBytes, transformation: { width: 64, height: 64 } })] : [] })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: ribbonBytes ? [new ImageRun({ type: "png", data: ribbonBytes, transformation: { width: 160, height: 44 } })] : [],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const topInfoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Employee Name", data.employeeName)] }),
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Branch", data.branch)] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Position", data.position)] }),
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Date", fmtDate(data.date))] }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          headerTable,
          new Paragraph({ spacing: { before: 120, after: 60 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "4TH WARNING – MANAGER ACTION PLAN", bold: true, size: 26, color: INK })] }),
          new Paragraph({ spacing: { before: 160 }, children: [] }),
          topInfoTable,
          new Paragraph({
            spacing: { before: 160, after: 60 },
            children: [new TextRun({ text: "Please outline the specific actions you will take to address this employee's continued performance or conduct issues:", size: 20 })],
          }),
          ...planItem("1. Coaching Plan:", data.coachingPlan),
          ...planItem("2. Monitoring Plan:", data.monitoringPlan),
          ...planItem("3. Additional Training or Support:", data.additionalTraining),
          ...planItem("4. Performance Expectations and Timeline:", data.performanceExpectations),
          ...planItem("5. Consequences if Improvement Is Not Achieved:", data.consequences),
          new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: "Manager Comments:", bold: true, size: 20, color: INK })] }),
          new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: data.managerComments || " ", size: 20 })],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db", space: 4 } },
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: "I acknowledge responsibility for implementing the above action plan and monitoring the employee's progress.", italics: true, size: 20 })],
          }),
          signatureRow("Manager's Name", data.recipientSlot === "manager" ? data.recipientName : "", signatures.manager, sigBytes.manager ?? null),
          signatureRow("Senior Manager's Name", data.recipientSlot === "senior_manager" ? data.recipientName : "", signatures.senior_manager, sigBytes.senior_manager ?? null),
          signatureRow("HR/Management's Name", data.recipientSlot === "hr_staff" ? data.recipientName : "", signatures.hr_staff, sigBytes.hr_staff ?? null),
          signatureRow("CEO Name", data.recipientSlot === "executive" ? data.recipientName : "", signatures.executive, sigBytes.executive ?? null),
          signatureRow("Employee Signature", data.recipientSlot === "employee" ? data.recipientName : "", signatures.employee, sigBytes.employee ?? null),
          ...(footerBytes ? [new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: footerBytes, transformation: { width: 500, height: 70 } })] })] : []),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
