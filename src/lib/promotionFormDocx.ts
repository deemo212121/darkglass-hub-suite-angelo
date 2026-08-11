/**
 * Native .docx generator for the Employee Promotion / Role Change form —
 * mirrors warningFormDocx.ts's approach exactly (real Word tables/shading/
 * images via the `docx` library, not an HTML-tagged-as-.doc trick — see
 * that file's header comment for why).
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  BorderStyle, WidthType, VerticalAlign, AlignmentType,
} from "docx";
import type { PromotionFormData, PromotionFormSignatures } from "./promotionFormTemplate";

const INK = "111827";
const MUTED = "374151";
const RULE = "9ca3af";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const BOTTOM_RULE_CELL_BORDERS = { ...NO_CELL_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } };
const CELL_MARGINS = { top: 60, bottom: 60, left: 0, right: 120 };

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
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

function sectionTitle(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text, bold: true, color: INK, size: 22 })] });
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

export async function buildPromotionFormDocxBlob(data: PromotionFormData, logoDataUrl: string, signatures: PromotionFormSignatures = {}): Promise<Blob> {
  const rc = data.roleChangeType;
  const p = data.performance;

  const logoBytes = logoDataUrl ? await dataUrlToBytes(logoDataUrl) : null;
  const sigBytes: Partial<Record<keyof PromotionFormSignatures, Uint8Array>> = {};
  for (const slot of ["employee", "manager", "senior_manager", "hr_staff", "executive"] as const) {
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
            width: { size: 75, type: WidthType.PERCENTAGE },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ children: [new TextRun({ text: "US IN HOME SERVICES", bold: true, size: 26, color: INK })] }),
              new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "EMPLOYEE PROMOTION / ROLE CHANGE APPROVAL FORM", bold: true, size: 20, color: INK })] }),
            ],
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: logoBytes ? [new ImageRun({ type: "png", data: logoBytes, transformation: { width: 64, height: 64 } })] : [],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const employeeInfoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Employee Name", data.employeeName)] })] }),
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Current Position", data.currentPosition)] })] }),
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Department/Branch", data.department)] })] }),
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Date of Hire", fmtDate(data.dateOfHire))] })] }),
    ],
  });

  const roleChangeTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("New Position Title", data.newPositionTitle)] })] }),
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("New Department/Branch", data.newDepartment)] })] }),
      new TableRow({ children: [new TableCell({ borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue("Effective Date", fmtDate(data.effectiveDate))] })] }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          headerTable,
          sectionTitle("1. Employee Information"),
          employeeInfoTable,
          sectionTitle("2. Role Change Details"),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(rc.promotion)} Promotion`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(rc.positionTitleChange)} Position Title Change`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(rc.departmentTransfer)} Department Transfer`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(rc.technicianTierRaise)} Technician Tier Raise`, size: 20 })] }),
          new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${checkbox(rc.other)} Other: ${rc.otherText || ""}`, size: 20 })] }),
          roleChangeTable,
          sectionTitle("3. Performance & Qualification Summary (For Direct Manager)"),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(p.meetsExpectations)} Meets performance expectations`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(p.exceedsExpectations)} Exceeds performance expectations`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(p.leadershipDemonstrated)} Leadership capability demonstrated`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(p.trainingCompleted)} Required training completed`, size: 20 })] }),
          new Paragraph({ children: [new TextRun({ text: `${checkbox(p.other)} Other justification: ${p.otherText || ""}`, size: 20 })] }),
          sectionTitle("4. Responsibilities Acknowledgment"),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: "I acknowledge that I understand the responsibilities and expectations of my new role and agree to fulfill them to the best of my ability.", size: 20 })],
          }),
          signatureRow("Employee Signature", data.employeeName, signatures.employee, sigBytes.employee ?? null),
          sectionTitle("5. Approval Signatures"),
          new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "Direct Manager", bold: true, size: 20 })] }),
          signatureRow("Name", data.recipientSlot === "manager" ? data.recipientName : "", signatures.manager, sigBytes.manager ?? null),
          new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "Senior Manager", bold: true, size: 20 })] }),
          signatureRow("Name", data.recipientSlot === "senior_manager" ? data.recipientName : "", signatures.senior_manager, sigBytes.senior_manager ?? null),
          new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "HR", bold: true, size: 20 })] }),
          signatureRow("Name", data.recipientSlot === "hr_staff" ? data.recipientName : "", signatures.hr_staff, sigBytes.hr_staff ?? null),
          new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "Executive", bold: true, size: 20 })] }),
          signatureRow("Name", data.recipientSlot === "executive" ? data.recipientName : "", signatures.executive, sigBytes.executive ?? null),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
