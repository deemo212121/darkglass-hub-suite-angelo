/**
 * The email window's Signature dropdown: your own uploaded signatures plus any
 * shared with HR, whichever Gmail the email goes out from (migration 0430).
 * gmailBridge.ts checks the same rule on every send. It starts on the last one
 * you sent with; "None" sends without a photo.
 */
import { useEffect, useState } from "react";
import { ImagePlus, Loader2, Settings2 } from "lucide-react";
import {
  addHiringEmailSignature,
  deleteHiringEmailSignature,
  getHiringEmailSignatureImage,
  getHiringEmailSignatures,
  setHiringEmailSignatureShared,
  type HiringEmailSignature,
} from "@/lib/supabase/gmailConnection";
import { prepareSignatureImage } from "@/lib/signatureImage";
import { MAX_SIGNATURE_NAME_LENGTH, NO_SIGNATURE, defaultSignatureId, selectableSignatures } from "@/lib/hiringEmails";

const LAST_SIGNATURE_KEY = "ahs.hiringEmail.lastSignature";

function readLastSignature(): string | null {
  try {
    return localStorage.getItem(LAST_SIGNATURE_KEY);
  } catch {
    return null;
  }
}

/** Call after a successful send, so the next email starts on the same choice. */
export function rememberSignature(signatureId: string | null) {
  try {
    localStorage.setItem(LAST_SIGNATURE_KEY, signatureId ?? NO_SIGNATURE);
  } catch {
    /* A remembered choice is only a convenience. */
  }
}

export interface SignatureSelection {
  signatureId: string | null;
  signatureName: string | null;
  /** Why Send has to wait, if it does. */
  blocked: string | null;
}

export type SignatureChange = { action: "added" | "removed" | "shared" | "unshared"; name: string };

const fieldClass = "glass-input text-sm py-1.5 px-3 rounded-md";
const linkClass = "inline-flex items-center gap-1 text-xs text-blue-300 underline hover:text-blue-200 whitespace-nowrap";

export function HiringSignaturePicker({
  signerName,
  canManageAll,
  onSelectionChange,
  onChanged,
}: {
  /** Starts the name box for a new upload. */
  signerName: string;
  /** Admin / Super Admin: can share or remove anyone's. */
  canManageAll: boolean;
  onSelectionChange: (selection: SignatureSelection) => void;
  onChanged: (change: SignatureChange) => void;
}) {
  // undefined = still loading; null = migration 0430 hasn't been run.
  const [list, setList] = useState<HiringEmailSignature[] | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ image: string; name: string; shared: boolean } | null>(null);
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectable = selectableSignatures(list ?? []);
  const selected = selectable.find((s) => s.id === selectedId) ?? null;
  const manageable = (list ?? []).filter((s) => s.mine || canManageAll);
  const loadingImage = !!selected && !(selected.id in images);

  useEffect(() => {
    let cancelled = false;
    getHiringEmailSignatures()
      .then((rows) => {
        if (cancelled) return;
        setList(rows);
        setSelectedId(defaultSignatureId(selectableSignatures(rows ?? []), readLastSignature()));
      })
      .catch(() => {
        if (cancelled) return;
        setList([]);
        setError("Couldn't load the signatures, so this email will go without one.");
      });
    return () => { cancelled = true; };
  }, []);

  const selectedKey = selected?.id ?? null;
  useEffect(() => {
    if (!selectedKey || !loadingImage) return;
    let cancelled = false;
    getHiringEmailSignatureImage(selectedKey)
      .then((image) => {
        if (cancelled) return;
        if (image) {
          setImages((m) => ({ ...m, [selectedKey]: image }));
        } else {
          setSelectedId("");
          setError("That signature isn't available anymore, so none is selected.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedId("");
        setError("Couldn't load that signature, so none is selected. Pick it again to retry.");
      });
    return () => { cancelled = true; };
  }, [selectedKey, loadingImage]);

  const blocked = pending
    ? "Save or cancel the new signature first."
    : list === undefined || loadingImage || busy
    ? "Waiting for the signature…"
    : null;
  useEffect(() => {
    onSelectionChange({ signatureId: selectedKey, signatureName: selected?.name ?? null, blocked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, selected?.name, blocked]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the signature.");
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (file: File) =>
    run(async () => {
      const image = await prepareSignatureImage(file);
      setPending({ image, name: signerName.slice(0, MAX_SIGNATURE_NAME_LENGTH), shared: false });
    });

  const savePending = () =>
    run(async () => {
      if (!pending) return;
      const name = pending.name.trim();
      const id = await addHiringEmailSignature(name, pending.image, pending.shared);
      setImages((m) => ({ ...m, [id]: pending.image }));
      setList(await getHiringEmailSignatures());
      setSelectedId(id);
      setPending(null);
      onChanged({ action: "added", name });
    });

  const toggleShared = (s: HiringEmailSignature) =>
    run(async () => {
      await setHiringEmailSignatureShared(s.id, !s.shared);
      setList(await getHiringEmailSignatures());
      onChanged({ action: s.shared ? "unshared" : "shared", name: s.name });
    });

  const remove = (s: HiringEmailSignature) => {
    if (!confirm(s.shared ? `Remove "${s.name}"? The whole team will lose it.` : `Remove "${s.name}"?`)) return;
    void run(async () => {
      await deleteHiringEmailSignature(s.id);
      setList(await getHiringEmailSignatures());
      onChanged({ action: "removed", name: s.name });
    });
  };

  if (list === null) {
    return (
      <div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signature</span>
        <p className="mt-1 text-xs text-amber-300">Signatures need the database update first (migration 0430). This email will go without one.</p>
      </div>
    );
  }

  return (
    <div>
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signature</span>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <select
          aria-label="Signature"
          value={selected?.id ?? ""}
          onChange={(e) => { setError(null); setSelectedId(e.target.value); }}
          disabled={list === undefined}
          className={`${fieldClass} !w-auto min-w-[12rem] max-w-full flex-1`}
        >
          <option value="">None</option>
          {selectable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.mine ? (s.shared ? " (shared)" : "") : ` (shared by ${s.createdByName || "HR"})`}
            </option>
          ))}
        </select>
        <label className={`${linkClass} ${busy || pending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          <ImagePlus className="h-3.5 w-3.5" />
          Upload new
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            aria-label="Signature file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pickFile(file);
            }}
          />
        </label>
        {manageable.length > 0 && (
          <button type="button" onClick={() => setManaging((m) => !m)} aria-expanded={managing} className={linkClass}>
            <Settings2 className="h-3.5 w-3.5" />
            Manage
          </button>
        )}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      {selected && (
        <div className="mt-2 flex items-center gap-3 rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground">
          {/* White behind it: dark ink on a clear background would vanish on this dark window. */}
          {images[selected.id] ? (
            <img src={images[selected.id]} alt="Signature preview" className="max-h-20 max-w-[16rem] rounded bg-white p-1" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Goes after the sign-off.
        </div>
      )}

      {pending && (
        <div className="mt-2 space-y-2 rounded-md border border-blue-400/30 bg-blue-500/5 px-3 py-2 text-xs">
          <img src={pending.image} alt="New signature preview" className="max-h-20 max-w-[16rem] rounded bg-white p-1" />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              aria-label="Signature name"
              value={pending.name}
              maxLength={MAX_SIGNATURE_NAME_LENGTH}
              onChange={(e) => setPending({ ...pending, name: e.target.value })}
              placeholder="Name it, e.g. Ana Cruz or HR Team"
              className={`${fieldClass} !w-auto min-w-[12rem] flex-1`}
            />
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-200">
              <input type="checkbox" checked={pending.shared} onChange={(e) => setPending({ ...pending, shared: e.target.checked })} className="accent-blue-500" />
              Share with HR
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} disabled={busy} className="rounded-md border border-white/10 px-3 py-1 font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={() => void savePending()} disabled={busy || !pending.name.trim()} className="rounded-md bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">Save signature</button>
          </div>
        </div>
      )}

      {managing && manageable.length > 0 && (
        <ul className="mt-2 divide-y divide-white/5 rounded-md border border-white/10 text-xs">
          {manageable.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1 break-words text-slate-200">
                {s.name}
                <span className="text-slate-500"> · {s.mine ? "You" : s.createdByName || "Someone else"}{s.shared ? " · Shared with HR" : ""}</span>
              </span>
              <button type="button" disabled={busy} onClick={() => void toggleShared(s)} className="text-blue-300 underline hover:text-blue-200 disabled:opacity-50">
                {s.shared ? "Stop sharing" : "Share with HR"}
              </button>
              <button type="button" disabled={busy} onClick={() => remove(s)} aria-label={`Remove ${s.name}`} className="text-red-300 underline hover:text-red-200 disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
