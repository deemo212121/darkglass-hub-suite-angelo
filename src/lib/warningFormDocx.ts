/**
 * Native .docx generator for the Employee Warning Form — a real Word
 * document (tables/shading/images via the `docx` library), not the
 * "HTML tagged as .doc" trick tried first. That approach silently
 * degraded: Word's own HTML importer doesn't support the flexbox/CSS
 * Grid layout warningFormTemplate.ts's two-column section relies on (it
 * just linearizes everything into single-column blocks), and doesn't
 * reliably render `data:` URI images at all — which is exactly why the
 * logo showed as a broken-image icon. Word tables and ImageRun (real
 * embedded image bytes, not an HTML `<img src="data:...">`) are both
 * things Word's native format actually understands, so this reproduces
 * the same layout/content using those instead.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  BorderStyle, WidthType, VerticalAlign, ShadingType, AlignmentType,
} from "docx";
import type { WarningFormData, WarningFormSignatures } from "./warningFormTemplate";

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

function labelValue(label: string, value: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, color: MUTED, size: 20 }),
      new TextRun({ text: value || "—", bold: opts.bold !== false, color: INK, size: 20 }),
    ],
  });
}

function barHeading(text: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.SOLID, color: INK, fill: INK },
    children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })],
  });
}

function smallLabel(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, color: MUTED, size: 17 })], spacing: { before: 100 } });
}

/** Mimics the underlined free-text box from the PDF — a paragraph with just a bottom rule, standing in for wherever the actual answer is empty/short. */
function freeTextBlock(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text || " ", size: 20 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "d1d5db", space: 4 } },
    spacing: { after: 120 },
  });
}

function twoColRow(leftLabel: string, leftValue: string, rightLabel: string, rightValue: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue(leftLabel, leftValue)] }),
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: BOTTOM_RULE_CELL_BORDERS, margins: CELL_MARGINS, children: [labelValue(rightLabel, rightValue)] }),
    ],
  });
}

function signatureRow(label: string, name: string, entry: { url: string; signedAt: string } | undefined, signatureImage: Uint8Array | null): TableRow {
  return new TableRow({
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
  });
}

export async function buildWarningFormDocxBlob(data: WarningFormData, logoDataUrl: string, signatures: WarningFormSignatures = {}): Promise<Blob> {
  const r = data.reasons;
  const prev = [0, 1, 2].map((i) => data.previousWarnings[i]);

  const logoBytes = logoDataUrl ? await dataUrlToBytes(logoDataUrl) : null;
  const sigBytes: Partial<Record<keyof WarningFormSignatures, Uint8Array>> = {};
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
            width: { size: 75, type: WidthType.PERCENTAGE },
            borders: NO_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: "EMPLOYEE WARNING FORM", bold: true, size: 32, color: INK })] })],
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

  const topInfoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      twoColRow("Employee Name", data.employeeName, "Branch Location", data.branch),
      twoColRow("Role", data.role, "Warning Date", fmtDate(data.warningDate)),
    ],
  });

  const typeColumn: Paragraph[] = [
    barHeading("TYPE OF WARNING"),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [
        new TextRun({ text: `${checkbox(data.level === "1st")} 1st Warning    `, size: 20 }),
        new TextRun({ text: `${checkbox(data.level === "2nd")} 2nd Warning    `, size: 20 }),
        new TextRun({ text: `${checkbox(data.level === "3rd")} 3rd Warning`, size: 20 }),
      ],
    }),
    smallLabel("Provide a detailed description of the specific actions or behaviors that led to this warning:"),
    freeTextBlock(data.description),
    smallLabel("The employee must implement the following corrective actions immediately:"),
    freeTextBlock(data.correctiveActions),
  ];

  const reasonColumn: Paragraph[] = [
    barHeading("REASON(S) FOR WARNING"),
    new Paragraph({
      spacing: { before: 120 },
      children: [new TextRun({ text: `${checkbox(r.absence)} Absence    ${checkbox(r.tardiness)} Tardiness`, size: 20 })],
    }),
    new Paragraph({ children: [new TextRun({ text: `${checkbox(r.inappropriateBehavior)} Inappropriate Behavior    ${checkbox(r.insubordination)} Insubordination`, size: 20 })] }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: `${checkbox(r.policyViolation)} Policy Violation    ${checkbox(r.equipmentDamage)} Equipment Damage`, size: 20 })],
    }),
    new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `${checkbox(r.other)} Other: ${r.otherText || ""}`, size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: "PREVIOUS WARNING(S) ISSUED (If any)", bold: true, size: 18 })] }),
    ...prev.flatMap((w, i) => [
      new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: `${i + 1}. ${w ? w.cause : "—"}`, size: 19 })] }),
      new Paragraph({
        children: [new TextRun({ text: w ? `Date: ${fmtDate(w.date)}   Issued By: ${w.issuedBy}` : "", color: "4b5563", size: 17 })],
      }),
    ]),
  ];

  const columnsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 52, type: WidthType.PERCENTAGE }, borders: NO_CELL_BORDERS, margins: { top: 0, bottom: 0, left: 0, right: 200 }, children: typeColumn }),
          new TableCell({ width: { size: 48, type: WidthType.PERCENTAGE }, borders: NO_CELL_BORDERS, margins: { top: 0, bottom: 0, left: 200, right: 0 }, children: reasonColumn }),
        ],
      }),
    ],
  });

  const signatureTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      signatureRow("Employee Name", data.employeeName, signatures.employee, sigBytes.employee ?? null),
      signatureRow("Manager Name", data.recipientSlot === "manager" ? data.recipientName : "", signatures.manager, sigBytes.manager ?? null),
      signatureRow("Senior Manager Name", data.recipientSlot === "senior_manager" ? data.recipientName : "", signatures.senior_manager, sigBytes.senior_manager ?? null),
      signatureRow("HR Staff Name", data.recipientSlot === "hr_staff" ? data.recipientName : "", signatures.hr_staff, sigBytes.hr_staff ?? null),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          headerTable,
          new Paragraph({ spacing: { before: 160 }, children: [] }),
          topInfoTable,
          new Paragraph({ spacing: { before: 200 }, children: [] }),
          columnsTable,
          new Paragraph({
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: "Please be advised that failure to demonstrate immediate and sustained improvement may result in further disciplinary action.", italics: true, size: 20 })],
          }),
          signatureTable,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
