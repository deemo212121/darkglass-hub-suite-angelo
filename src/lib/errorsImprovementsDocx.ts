/**
 * Admin → Errors & Improvements as a .docx — opens in Google Docs (upload to
 * Drive, then Open with Google Docs) or Word. Grouped Errors / Improvements /
 * To do, open items first; each with its area, details, pictures (embedded),
 * other attachments (as links), who added it, who's handling it, and
 * whether (and by whom) it was confirmed.
 */
import type { ErrorImprovementItem, ErrorImprovementKind } from "@/lib/supabase/errorsImprovements";

const KIND_HEADINGS: Record<ErrorImprovementKind, string> = { error: "Errors", improvement: "Improvements", todo: "To do" };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Widest a picture is drawn on the page (px at 96 dpi — about 5 in.), and the pixel width it's saved at. */
const IMAGE_SHOW_WIDTH = 480;
const IMAGE_SAVE_WIDTH = 1200;

/**
 * A stored picture re-encoded as JPEG for the document — .docx can't hold
 * WebP, which is what the page saves most photos as. Fetched through
 * /api/image-proxy (the bucket sends no CORS headers). Null when it can't
 * be loaded; the item then lists it as a link instead.
 */
async function imageForDocx(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, IMAGE_SAVE_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // transparent screenshots would otherwise turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return null;
    const show = Math.min(1, IMAGE_SHOW_WIDTH / canvas.width);
    return { data: new Uint8Array(await blob.arrayBuffer()), width: Math.round(canvas.width * show), height: Math.round(canvas.height * show) };
  } catch {
    return null;
  }
}

export async function buildErrorsImprovementsDocx(items: ErrorImprovementItem[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, ExternalHyperlink } = await import("docx");
  const images = new Map(
    await Promise.all(
      items.flatMap((i) => i.attachments).filter((a) => a.type.startsWith("image/")).map(async (a) => [a.url, await imageForDocx(a.url)] as const),
    ),
  );

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
      for (const a of item.attachments) {
        const img = images.get(a.url);
        children.push(
          img
            ? new Paragraph({ spacing: { before: 80, after: 80 }, children: [new ImageRun({ type: "jpg", data: img.data, transformation: { width: img.width, height: img.height } })] })
            : new Paragraph({
                children: [
                  new TextRun({ text: "Attachment: ", color: "666666", size: 18 }),
                  new ExternalHyperlink({ link: a.url, children: [new TextRun({ text: a.name, style: "Hyperlink", size: 18 })] }),
                ],
              }),
        );
      }
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Added by ${item.addedByName || "—"} on ${fmtDate(item.createdAt)}`, color: "666666", size: 18 }),
            new TextRun({ text: `   Handled by ${item.assignedToName || "— not assigned"}`, color: "666666", size: 18 }),
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
