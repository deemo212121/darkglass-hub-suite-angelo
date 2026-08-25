/**
 * Shared signature-capture logic for every signable HR document (the
 * Fill-/ExternalFill-page pairs' PDF-overlay forms, the Sign-/ExternalSign-
 * FormPage pairs' DOCX-based forms, and ReportHRDaily.tsx's employer/HR-side
 * completion dialogs) — offers BOTH a "Type your name in a cursive font"
 * mode (default) and the original freehand "Draw" mode, sharing one
 * `<canvas>` so `toDataURL()` behaves identically regardless of which mode
 * produced the final image.
 *
 * Deliberately just a hook, not a single all-in-one component: the
 * signature canvas itself needs to stay exactly where each form already
 * positions it (often absolutely overlaid right on a printed signature
 * line, sometimes with only a few points of vertical clearance) — there's
 * rarely room to also fit a mode toggle/name input/font picker directly
 * above it without overlapping unrelated page content. Callers render the
 * canvas via `canvasProps` wherever their old `<canvas ref={sigCanvasRef}>`
 * used to sit, and render `<SignaturePadControls pad={...} />` (see
 * SignaturePad.tsx) whereever their old "Clear signature" button used to
 * sit instead — usually in a control bar below the whole page, which is
 * not space-constrained the way the signature line itself is.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SignaturePadMode = "type" | "draw";

export const SIGNATURE_FONTS = [
  { id: "dancing-script", label: "Dancing Script", family: '"Dancing Script", cursive' },
  { id: "great-vibes", label: "Great Vibes", family: '"Great Vibes", cursive' },
  { id: "pacifico", label: "Pacifico", family: '"Pacifico", cursive' },
  { id: "sacramento", label: "Sacramento", family: '"Sacramento", cursive' },
] as const;

export interface UseSignaturePadOptions {
  /** Prefills the typed-name field — e.g. the employee's name typed elsewhere in the same form. */
  defaultName?: string;
  width?: number;
  height?: number;
}

export interface SignaturePadHandle {
  mode: SignaturePadMode;
  setMode: (m: SignaturePadMode) => void;
  typedName: string;
  setTypedName: (v: string) => void;
  fontId: string;
  setFontId: (id: string) => void;
  canvasProps: {
    ref: React.RefObject<HTMLCanvasElement | null>;
    width: number;
    height: number;
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    className: string;
  };
  /** True once there's something that would produce a non-empty toDataURL() — a typed name in Type mode, or an actual stroke in Draw mode. */
  hasContent: () => boolean;
  toDataURL: () => string | null;
  /** Resets both modes' state — the typed name AND any drawn strokes — regardless of which mode is currently active. */
  clear: () => void;
}

export function useSignaturePad(options: UseSignaturePadOptions = {}): SignaturePadHandle {
  const { defaultName = "", width = 440, height = 100 } = options;
  const [mode, setModeState] = useState<SignaturePadMode>("type");
  const [typedName, setTypedName] = useState(defaultName);
  const [fontId, setFontId] = useState<string>(SIGNATURE_FONTS[0].id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [mode]);
  const moveDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw" || !drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    hasDrawnRef.current = true;
  }, [mode]);
  const endDraw = useCallback(() => { drawingRef.current = false; }, []);

  const setMode = useCallback((m: SignaturePadMode) => {
    const c = canvasRef.current;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
    setModeState(m);
  }, []);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
    setTypedName("");
  }, []);

  // Type-mode rendering — redraws the canvas with the typed name in the
  // selected cursive font whenever either changes, so what's on screen is
  // exactly what toDataURL() returns (no separate "preview" vs. "actual"
  // rendering to keep in sync). document.fonts.load(...) makes sure the
  // web font is actually ready before drawing text to canvas — canvas text
  // silently falls back to a system font if the face isn't loaded yet.
  useEffect(() => {
    if (mode !== "type") return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const font = SIGNATURE_FONTS.find((f) => f.id === fontId) ?? SIGNATURE_FONTS[0];
    const fontSize = Math.min(Math.round(height * 0.55), 40);
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      if (!typedName.trim()) return;
      ctx.font = `${fontSize}px ${font.family}`;
      ctx.fillStyle = "#0f172a";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(typedName.trim(), c.width / 2, c.height / 2);
    };
    if (typeof document !== "undefined" && document.fonts?.load) {
      document.fonts.load(`${fontSize}px ${font.family}`).then(draw).catch(draw);
    } else {
      draw();
    }
  }, [mode, typedName, fontId, height]);

  const hasContent = useCallback(() => {
    return mode === "type" ? typedName.trim().length > 0 : hasDrawnRef.current;
  }, [mode, typedName]);

  const toDataURL = useCallback((): string | null => {
    if (!hasContent()) return null;
    return canvasRef.current?.toDataURL("image/png") ?? null;
  }, [hasContent]);

  return {
    mode,
    setMode,
    typedName,
    setTypedName,
    fontId,
    setFontId,
    canvasProps: {
      ref: canvasRef,
      width,
      height,
      onPointerDown: startDraw,
      onPointerMove: moveDraw,
      onPointerUp: endDraw,
      onPointerLeave: endDraw,
      className: mode === "draw" ? "touch-none cursor-crosshair" : "touch-none",
    },
    hasContent,
    toDataURL,
    clear,
  };
}
