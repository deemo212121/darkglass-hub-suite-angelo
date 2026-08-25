/**
 * The Type/Draw mode toggle, typed-name input, cursive font picker, and
 * Clear button for a useSignaturePad() handle — the "chrome" half of the
 * signature-capture pair (see useSignaturePad.ts's header comment for why
 * this is deliberately separate from the `<canvas>` itself). Drop this in
 * wherever a form's old "Clear signature" button used to sit.
 */
import { SIGNATURE_FONTS, type SignaturePadHandle } from "@/hooks/useSignaturePad";

export function SignaturePadControls({ pad }: { pad: SignaturePadHandle }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-md p-0.5">
        <button
          type="button"
          onClick={() => pad.setMode("type")}
          className={`text-xs px-3 py-1 rounded transition ${pad.mode === "type" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-white"}`}
        >
          Type
        </button>
        <button
          type="button"
          onClick={() => pad.setMode("draw")}
          className={`text-xs px-3 py-1 rounded transition ${pad.mode === "draw" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-white"}`}
        >
          Draw
        </button>
      </div>

      {pad.mode === "type" && (
        <div className="flex flex-col items-center gap-1.5">
          <input
            type="text"
            value={pad.typedName}
            onChange={(e) => pad.setTypedName(e.target.value)}
            placeholder="Type your full name"
            className="glass-input text-sm py-1.5 px-3 rounded-md text-center"
          />
          <div className="flex items-center gap-1.5">
            {SIGNATURE_FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => pad.setFontId(f.id)}
                title={f.label}
                style={{ fontFamily: f.family }}
                className={`text-base px-2.5 py-1 rounded border transition ${
                  pad.fontId === f.id ? "border-blue-400 bg-blue-500/10 text-white" : "border-white/10 text-slate-300 hover:border-white/25"
                }`}
              >
                Ag
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={pad.clear} className="btn text-xs px-3 py-1.5">
        Clear signature
      </button>
    </div>
  );
}
