/**
 * Reading a bulk paystub upload for Accounting → Paystubs: every PDF is
 * split into single pages (pdf-lib), each page is drawn (pdf.js) for a
 * preview, and the payee name is read off it with OCR (tesseract.js) — the
 * check-run PDFs are scanned images with no text in them.
 *
 * Laid out for the US Appliance check stub: the name is the first line of
 * "TO THE ORDER OF", the pay date is top right, and the stub's NETPAY row
 * says "Period 10/11/26-10/24/26". Net pay comes from the written amount
 * ("PAY Four Hundred Seventy-One Dollars & 45 Cents") — words OCR cleanly,
 * where the digits' asterisks and dotted dividers get mistaken for "1"s.
 * When the words can't be parsed it falls back to the check amount
 * ("$*******2,479.27") and the NETPAY row's Current cell, kept only when
 * the two agree (or only one could be read). The regions are generous, and a page
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
  /** Net pay read off the page; null when it couldn't be read with confidence. */
  netPay: number | null;
}

/** Fractions of the page: [left, top, right, bottom]. */
const NAME_BOX = [0.095, 0.175, 0.6, 0.235] as const;
const DATE_BOX = [0.58, 0.075, 0.97, 0.11] as const;
const PERIOD_BOX = [0.36, 0.585, 0.66, 0.62] as const;
const NETPAY_BOX = [0.195, 0.59, 0.29, 0.613] as const;
const WRITTEN_BOX = [0.05, 0.115, 0.8, 0.15] as const;

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

/** "2479 27" → { dollars: "2479", cents: "27" } when the last digit group is the 2-digit cents. */
function splitAmount(groups: string[]): { dollars: string; cents: string } | null {
  if (groups.length >= 2 && groups[groups.length - 1].length === 2) return { dollars: groups.slice(0, -1).join(""), cents: groups[groups.length - 1] };
  return null;
}

/** The check amount, "$*******2,479.27". The asterisks can leave a stray "]", and a leading 1 can read as "]" — so up to two readings. */
function checkAmountReadings(text: string): number[] {
  const line = text.split("\n").find((l) => l.includes("$")) ?? "";
  const tail = (line.trim().match(/[\d\],.\s]+$/) ?? [""])[0];
  const parts = splitAmount(tail.match(/[\d\]]+/g) ?? []);
  if (!parts) return [];
  const options = new Set([parts.dollars.replace(/\]/g, ""), parts.dollars.replace(/^\]+/, "1").replace(/\]/g, "")]);
  return [...options].filter((d) => /^\d+$/.test(d)).map((d) => Number(`${d}.${parts.cents}`));
}

/** The NETPAY row's "2479 27". The dotted divider before the cents reads as anything — or as a "1", or not at all. */
function netRowReadings(text: string): number[] {
  const groups = (text.split("\n").find((l) => /\d/.test(l)) ?? "").match(/\d+/g) ?? [];
  const parts = splitAmount(groups);
  if (parts) return [Number(`${parts.dollars}.${parts.cents}`)];
  const d = groups.join("");
  if (d.length < 3) return [];
  const out = [Number(`${d.slice(0, -2)}.${d.slice(-2)}`)];
  if (d.length >= 4 && d[d.length - 3] === "1") out.push(Number(`${d.slice(0, -3)}.${d.slice(-2)}`));
  return out;
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "PAY Four Hundred Seventy-One Dollars & 45 Cents" → 471.45; null when any word isn't a number word. */
export function readWrittenAmount(text: string): number | null {
  const m = text.match(/PAY\s+([A-Za-z\s-]+?)\s+Dollars?\s*&\s*(\d{2})\s*Cents/i);
  if (!m) return null;
  let total = 0, group = 0;
  for (const w of m[1].toLowerCase().split(/[\s-]+/).filter(Boolean)) {
    if (w in SMALL) group += SMALL[w];
    else if (w === "hundred") group *= 100;
    else if (w === "thousand") { total += group * 1000; group = 0; }
    else return null;
  }
  return Number(`${total + group}.${m[2]}`);
}

/** Net pay from the check-amount and NETPAY-row text: the one value both agree on, or the only reading there is; null when unsure. */
export function readNetPay(checkText: string, netRowText: string): number | null {
  const a = checkAmountReadings(checkText), b = netRowReadings(netRowText);
  const both = a.filter((x) => b.includes(x));
  if (both.length > 0) return both.length === 1 ? both[0] : null;
  if (a.length === 1 && b.length === 0) return a[0];
  if (b.length === 1 && a.length === 0) return b[0];
  return null;
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
        const dateText = (await worker.recognize(crop(canvas, DATE_BOX))).data.text;
        const payDate = readDate(dateText);
        const period = readPeriod((await worker.recognize(crop(canvas, PERIOD_BOX))).data.text);
        const netPay =
          readWrittenAmount((await worker.recognize(crop(canvas, WRITTEN_BOX))).data.text) ??
          readNetPay(dateText, (await worker.recognize(crop(canvas, NETPAY_BOX))).data.text);
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
          netPay,
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
