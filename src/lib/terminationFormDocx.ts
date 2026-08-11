/**
 * Native .docx generator for the Notice of Termination form — mirrors
 * warningFormDocx.ts's approach (real Word tables/shading/images via the
 * `docx` library). Includes the same letterhead (logo + ribbon header,
 * footer graphic) as actionPlanFormDocx.ts.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  BorderStyle, WidthType, VerticalAlign, AlignmentType,
} from "docx";
import type { TerminationFormData, TerminationFormSignatures } from "./terminationFormTemplate";

const INK = "111827";
const MUTED = "374151";
const RULE = "9ca3af";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const BOTTOM_RULE_CELL_BORDERS = { ...NO_CELL_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } };
const CELL_MARGINS = { top: 60, bottom: 60, left: 0, right: 120 };

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

function bodyText(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, size: 20 })] });
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, color: MUTED, size: 20 }),
      new TextRun({ text: value || "—", bold: true, color: INK, size: 20 }),
    ],
  });
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

export async function buildTerminationFormDocxBlob(
  data: TerminationFormData,
  logoDataUrl: string,
  ribbonDataUrl: string,
  footerDataUrl: string,
  signatures: TerminationFormSignatures = {}
): Promise<Blob> {
  const logoBytes = logoDataUrl ? await dataUrlToBytes(logoDataUrl) : null;
  const ribbonBytes = ribbonDataUrl ? await dataUrlToBytes(ribbonDataUrl) : null;
  const footerBytes = footerDataUrl ? await dataUrlToBytes(footerDataUrl) : null;
  const sigBytes: Partial<Record<keyof TerminationFormSignatures, Uint8Array>> = {};
  for (const slot of ["employee", "manager", "senior_manager", "hr_staff"] as const) {
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

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          headerTable,
          new Paragraph({ spacing: { before: 120, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Notice of Termination", bold: true, size: 28, color: INK })] }),
          bodyText(`Dear ${data.employeeName || "—"},`),
          bodyText(`This letter serves as formal notice of the termination of your employment with US Appliance Repair DBA US in Home Services, effective ${fmtDate(data.effectiveDate) || "—"}.`),
          new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Reason for Termination:", bold: true, size: 20, color: INK })] }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: data.reason || " ", size: 20 })],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db", space: 4 } },
          }),
          bodyText("This decision has been made after careful consideration. Despite any prior discussions or opportunities for improvement where applicable, we have determined that it is in the best interest of both parties to conclude your employment."),
          bodyText("You will receive your final paycheck, including any outstanding compensation and accrued benefits, in accordance with company policy and applicable laws. Please ensure that all company property in your possession is returned on or before your final day of employment."),
          bodyText("We appreciate your contributions during your time with US Appliance Repair DBA US in Home Services and wish you the best in your future endeavors."),
          bodyText("Sincerely,"),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: "Please sign below to acknowledge receipt of this notice.", size: 20 })] }),
          signatureRow("Employee Signature", data.recipientSlot === "employee" ? data.recipientName : "", signatures.employee, sigBytes.employee ?? null),
          signatureRow("Manager Signature", data.recipientSlot === "manager" ? data.recipientName : "", signatures.manager, sigBytes.manager ?? null),
          signatureRow("Senior Manager Signature", data.recipientSlot === "senior_manager" ? data.recipientName : "", signatures.senior_manager, sigBytes.senior_manager ?? null),
          signatureRow("HR Staff Signature", data.recipientSlot === "hr_staff" ? data.recipientName : "", signatures.hr_staff, sigBytes.hr_staff ?? null),
          ...(footerBytes ? [new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: footerBytes, transformation: { width: 500, height: 70 } })] })] : []),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
