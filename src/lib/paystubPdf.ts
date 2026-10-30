/**
 * Reading a bulk paystub upload for Accounting → Paystubs: every PDF is
 * split into single pages (pdf-lib), each page is drawn (pdf.js) for a
 * preview, and the payee name is read off it with OCR (tesseract.js) — the
 * check-run PDFs are scanned images with no text in them.
 *
 * Laid out for the US Appliance check stub: the name is the first line of
 * "TO THE ORDER OF", the pay date is top right, and the stub's NETPAY row
 * says "Period 10/11/26-10/24/26". The regions are generous, and a page
 * where nothing readable comes back falls to the file name (a single
 * "Jane Doe - 10-30-2026.pdf"), then to Accounting picking the person.
 */
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export interface PaystubPage {
  /** Stable key for the review table. */
  key: string;
  sourceFileName: string;
  /** 1-based page in the source file. */
  page: number;
  pageCount: number;
  /** The page alone, as its own PDF — what gets stored. */
  bytes: Uint8Array;
  /** JPEG data URL for the preview. */
  preview: string;
  /** Payee name read off the page (or the file name), "" when nothing was found. */
  name: string;
  /** "ocr" | "filename" | "none" — where `name` came from. */
  nameSource: "ocr" | "filename" | "none";
  /** "YYYY-MM-DD" read off the page, when found. */
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

/** Fractions of the page: [left, top, right, bottom]. */
const NAME_BOX = [0.095, 0.175, 0.6, 0.235] as const;
const DATE_BOX = [0.58, 0.075, 0.97, 0.11] as const;
const PERIOD_BOX = [0.36, 0.585, 0.66, 0.62] as const;

const RENDER_SCALE = 2;
const PREVIEW_WIDTH = 900;

function crop(src: HTMLCanvasElement, box: readonly [number, number, number, number]): HTMLCanvasElement {
  const [l, t, r, b] = box;
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * (r - l));
  out.height = Math.round(src.height * (b - t));
  out.getContext("2d")!.drawImage(src, src.width * l, src.height * t, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function fullYear(yy: string): string {
  return yy.length === 4 ? yy : `20${yy.padStart(2, "0")}`;
}

function isoDate(m: string, d: string, y: string): string | null {
  const mm = Number(m), dd = Number(d);
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  return `${fullYear(y)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "10/30/2026" (or 10-30-2026) anywhere in the text. */
export function readDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/);
  return m ? isoDate(m[1], m[2], m[3]) : null;
}

/** "Period 10/11/26-10/24/26". */
export function readPeriod(text: string): { start: string; end: string } | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const start = isoDate(m[1], m[2], m[3]), end = isoDate(m[4], m[5], m[6]);
  return start && end && start <= end ? { start, end } : null;
}

/** First line that looks like a person's name: letters (with ' . -), at least two words. */
export function readName(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[^A-Za-z'’.\- ]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(to the|order|of|pay)\b/i.test(line)) continue;
    if (line.split(" ").filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 2) return line;
  }
  return "";
}

/** A person's name from a file name — "Jane Doe - 10-30-2026.pdf", "Paystub_Jane_Doe.pdf". */
export function nameFromFileName(fileName: string): string {
  return readName(
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/\b\d{1,4}([/-]\d{1,4}){1,2}\b/g, " ")
      .replace(/\b(pay ?stubs?|pay ?slips?|check|stub|us appliance|inc)\b/gi, " ")
  );
}

/** How many pages a PDF has. */
export async function pdfPageCount(file: File): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true })).getPageCount();
}

/** One page (1-based) of a PDF as its own PDF — the whole file when it's a single page. */
export async function extractPdfPage(file: File, page: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (src.getPageCount() === 1) return bytes;
  const single = await PDFDocument.create();
  const [copied] = await single.copyPages(src, [page - 1]);
  single.addPage(copied);
  return single.save();
}

type OcrWorker ={ recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };

/**
 * Splits and reads every PDF. `onProgress` gets pages done / total and a
 * short status line. OCR runs in the browser; the first use downloads its
 * English model (a few MB), after which it's cached.
 */
export async function readPaystubFiles(
  files: File[],
  onProgress?: (done: number, total: number, status: string) => void
): Promise<PaystubPage[]> {
  onProgress?.(0, 0, "Opening the PDFs…");
  const [{ PDFDocument }, pdfjs, { createWorker }] = await Promise.all([
    import("pdf-lib"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("tesseract.js"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const sources: { file: File; bytes: Uint8Array; pages: number }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    sources.push({ file, bytes, pages: doc.getPageCount() });
  }
  const total = sources.reduce((s, x) => s + x.pages, 0);

  onProgress?.(0, total, "Loading the text reader…");
  const worker = (await createWorker("eng")) as unknown as OcrWorker;
  const out: PaystubPage[] = [];
  try {
    for (const src of sources) {
      const lib = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
      const view = await pdfjs.getDocument({ data: src.bytes.slice() }).promise;
      const fileName = nameFromFileName(src.file.name);
      for (let i = 0; i < src.pages; i++) {
        onProgress?.(out.length, total, `Reading ${src.file.name} — page ${i + 1} of ${src.pages}`);
        const single = await PDFDocument.create();
        const [copied] = await single.copyPages(lib, [i]);
        single.addPage(copied);
        const pageBytes = await single.save();

        const page = await view.getPage(i + 1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const preview = document.createElement("canvas");
        preview.width = PREVIEW_WIDTH;
        preview.height = Math.round((canvas.height / canvas.width) * PREVIEW_WIDTH);
        preview.getContext("2d")!.drawImage(canvas, 0, 0, preview.width, preview.height);

        const ocrName = readName((await worker.recognize(crop(canvas, NAME_BOX))).data.text);
        const payDate = readDate((await worker.recognize(crop(canvas, DATE_BOX))).data.text);
        const period = readPeriod((await worker.recognize(crop(canvas, PERIOD_BOX))).data.text);
        const name = ocrName || (src.pages === 1 ? fileName : "");

        out.push({
          key: `${out.length}-${src.file.name}-${i + 1}`,
          sourceFileName: src.file.name,
          page: i + 1,
          pageCount: src.pages,
          bytes: pageBytes,
          preview: preview.toDataURL("image/jpeg", 0.72),
          name,
          nameSource: ocrName ? "ocr" : name ? "filename" : "none",
          payDate,
          periodStart: period?.start ?? null,
          periodEnd: period?.end ?? null,
        });
        page.cleanup();
      }
      await view.cleanup();
    }
  } finally {
    await worker.terminate();
  }
  onProgress?.(total, total, "Done");
  return out;
}
