/**
 * Sign Bundle — opened from the single combined link the "Signed
 * Employment Forms" table's "Combine & Send Link" action sends (see
 * ReportHRDaily.tsx), instead of one message per document. Reads a
 * comma-separated list of hr_signable_documents ids from ?ids=, shows a
 * left-side timeline of every document in the bundle (finished vs.
 * pending), and renders the current one's own existing sign/fill page
 * component unmodified (see signableDocumentComponents.tsx) — this page
 * only adds the timeline + Next/Back chrome around it, no per-type
 * signing logic lives here.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Menu, X } from "lucide-react";
import { getSignableDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { signableDocumentLabel } from "@/lib/signableDocumentRegistry";
import { INTERNAL_SIGNABLE_DOCUMENT_COMPONENTS } from "@/lib/signableDocumentComponents";

function parseIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = new URLSearchParams(window.location.search).get("ids") ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isFinished(doc: SignableDocument): boolean {
  return doc.status === "signed" || doc.status === "confirmed";
}

export function SignBundlePage() {
  const ids = useMemo(parseIds, []);
  const [docs, setDocs] = useState<Record<string, SignableDocument | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // Collapsed by default — on mobile the timeline would otherwise permanently
  // eat into the width available for the actual form. md:block below always
  // shows it on wider screens regardless of this state.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setError("No documents were specified in this link.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const results = await Promise.all(ids.map((id) => getSignableDocument(id)));
        if (cancelled) return;
        const byId: Record<string, SignableDocument | null> = {};
        ids.forEach((id, i) => { byId[id] = results[i]; });
        setDocs(byId);
        // Land on the first not-yet-finished document instead of always the first one.
        const firstPending = ids.findIndex((id) => byId[id] && !isFinished(byId[id]!));
        setIndex(firstPending >= 0 ? firstPending : 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load these documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentId = ids[index];
  const currentDoc = currentId ? docs[currentId] : null;

  const refreshCurrent = async () => {
    if (!currentId) return;
    try {
      const fresh = await getSignableDocument(currentId);
      setDocs((prev) => ({ ...prev, [currentId]: fresh }));
    } catch {
      // Non-fatal — the timeline just won't reflect the latest status until next refresh.
    }
  };

  const goNext = async () => {
    await refreshCurrent();
    setIndex((i) => Math.min(ids.length - 1, i + 1));
  };
  const goBack = () => setIndex((i) => Math.max(0, i - 1));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || ids.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="panel max-w-md text-center p-6">
          <h1 className="text-lg font-semibold">Couldn't open these documents</h1>
          <p className="text-sm text-muted-foreground mt-2">{error ?? "This link is missing its documents."}</p>
        </div>
      </div>
    );
  }

  const CurrentComponent = currentDoc ? INTERNAL_SIGNABLE_DOCUMENT_COMPONENTS[currentDoc.documentType] : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between gap-3 bg-slate-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="md:hidden btn text-xs px-2 py-1.5"
            title="Show all documents in this bundle"
          >
            {sidebarOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          </button>
          <p className="text-sm font-semibold">
            Document {index + 1} of {ids.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={index === 0}
            className="btn text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={index >= ids.length - 1}
            className="btn text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 relative">
        <aside className={`${sidebarOpen ? "flex" : "hidden"} md:flex flex-col absolute md:static inset-y-0 left-0 z-20 w-64 shrink-0 border-r border-white/10 bg-slate-900 md:bg-slate-900/60 overflow-y-auto py-3`}>
          {ids.map((id, i) => {
            const doc = docs[id];
            const finished = doc ? isFinished(doc) : false;
            return (
              <button
                key={id}
                type="button"
                onClick={async () => { await refreshCurrent(); setIndex(i); setSidebarOpen(false); }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm transition-colors ${
                  i === index ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {finished ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 opacity-50" />
                )}
                <span className="truncate">{doc ? signableDocumentLabel(doc.documentType) : "Document unavailable"}</span>
              </button>
            );
          })}
        </aside>
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-10 bg-black/50" onClick={() => setSidebarOpen(false)} />
        )}

        <main className="flex-1 min-w-0 overflow-y-auto">
          {!currentDoc || !CurrentComponent ? (
            <div className="p-6 text-sm text-muted-foreground">This document is no longer available.</div>
          ) : (
            <Suspense fallback={<div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <CurrentComponent docId={currentDoc.id} />
            </Suspense>
          )}
          {/* Right where the recipient's eyes already are after a form's own "Submitted" confirmation — the top bar's Back/Next is easy to miss up there.
              Sits flush under that confirmation panel (matching its max-w-4xl column + panel styling, pulled up to close the panel's own bottom margin) so it reads as one connected card instead of a separate control bar. */}
          <div className="max-w-4xl mx-auto px-4">
            <div className="panel !mt-[-1.5rem] !rounded-t-none !border-t-0 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={goBack}
                disabled={index === 0}
                className="btn text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={index >= ids.length - 1}
                className="btn text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
