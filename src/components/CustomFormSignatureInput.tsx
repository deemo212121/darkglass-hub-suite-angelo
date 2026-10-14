/**
 * A custom form's Signature field, signed the same way as every other HR
 * form — useSignaturePad + SignaturePadControls: Type (the name in a cursive
 * font, the default) or Draw, plus the "my electronic signature is legally
 * binding" checkbox. Rendered by CustomFormRenderer in place of the Signature
 * element's own FillInput (which is in src/lib and can't import components).
 *
 * The answer is a PNG File (what the form already uploads for a signature),
 * or null until there's a signature AND the box is checked — so the field's
 * "required" check doubles as the consent check, as on the other forms.
 *
 * signerName: the form's printed-name line for this signature (see
 * CustomFormRenderer). A pre-printed (read-only) name is used as-is and can't
 * be changed; an editable one fills the typed name as it's entered.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SIGNATURE_FONTS, useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import type { CustomFormField } from "@/lib/formElements";

export function CustomFormSignatureInput({
  field,
  onChange,
  signerName,
  signerNameLocked,
  belowCanvas,
  controlsFirst,
}: {
  field: CustomFormField;
  onChange: (v: File | null) => void;
  signerName?: string;
  signerNameLocked?: boolean;
  /** Rendered right under the signature — paper view puts the signing line and label here. */
  belowCanvas?: ReactNode;
  /** Controls above the signature instead of below (paper view: the signing line stays at the bottom, level with a Date beside it). */
  controlsFirst?: boolean;
}) {
  const width = field.config?.canvasWidth ?? 360;
  const height = field.config?.canvasHeight ?? 120;
  const pad = useSignaturePad({ defaultName: signerName ?? "", width, height });
  const [strokes, setStrokes] = useState(0);

  // A pre-printed name is always the typed name (also after Clear)…
  const { typedName, setTypedName } = pad;
  useEffect(() => {
    if (signerNameLocked && signerName !== undefined && typedName !== signerName) setTypedName(signerName);
  }, [signerNameLocked, signerName, typedName, setTypedName]);
  // …an editable one fills it in as the name line is typed.
  useEffect(() => {
    if (!signerNameLocked && signerName !== undefined) setTypedName(signerName);
  }, [signerNameLocked, signerName, setTypedName]);

  // Report the signature as a File whenever it changes. Type mode redraws
  // the canvas once its cursive font has loaded, so wait for that (and a
  // frame) before reading it; a newer change supersedes an older read.
  const seq = useRef(0);
  const report = useCallback(async () => {
    const mine = ++seq.current;
    if (pad.mode === "type") {
      const font = SIGNATURE_FONTS.find((f) => f.id === pad.fontId) ?? SIGNATURE_FONTS[0];
      await document.fonts?.load(`40px ${font.family}`).catch(() => undefined);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    if (mine !== seq.current) return;
    const url = pad.toDataURL();
    if (!url) { onChange(null); return; }
    const blob = await (await fetch(url)).blob();
    if (mine === seq.current) onChange(new File([blob], `${field.id}-signature.png`, { type: "image/png" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad.mode, pad.fontId, pad.toDataURL, field.id]);
  useEffect(() => { void report(); }, [report, pad.typedName, pad.consentGiven, strokes]);

  const endStroke = () => { pad.canvasProps.onPointerUp(); if (pad.mode === "draw") setStrokes((n) => n + 1); };

  const controls = (
    <div className="sig-controls">
      <SignaturePadControls pad={pad} lockedName={signerNameLocked ? signerName : undefined} />
    </div>
  );
  return (
    <div className="flex flex-col gap-2 w-full">
      {controlsFirst && controls}
      <div>
        <canvas
          {...pad.canvasProps}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          className={`${pad.canvasProps.className} rounded-md border border-white/20`}
          style={{ backgroundColor: field.config?.backgroundColor || "#ffffff", width: "100%", maxWidth: `${width}px`, height: "auto", aspectRatio: `${width} / ${height}` }}
        />
        {belowCanvas}
      </div>
      {!controlsFirst && controls}
    </div>
  );
}
