import { useState } from "react";
import { ChevronLeft, Save, FileText, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const SAMPLE_DOCS = [
  { model: "RF23A9675SR", name: "RF23A9675SR User Manual", type: "PDF", size: "4.2 MB" },
  { model: "WF45R6100AW", name: "WF45R6100AW Service Manual", type: "PDF", size: "12.1 MB" },
  { model: "DVE45R6100W", name: "DVE45R6100W Installation Guide", type: "PDF", size: "2.8 MB" },
  { model: "NE63A6511SS", name: "NE63A6511SS Wiring Diagram", type: "PDF", size: "1.5 MB" },
  { model: "DW80R2031US", name: "DW80R2031US Parts Catalog", type: "PDF", size: "8.3 MB" },
];

export function ModelDocuments({ mod, sub }: Props) {
  const [modelCode, setModelCode] = useState("");
  const [results, setResults] = useState<typeof SAMPLE_DOCS>([]);
  const [searched, setSearched] = useState(false);

  const handleRefresh = () => {
    setSearched(true);
    if (!modelCode.trim()) { setResults([]); return; }
    const q = modelCode.trim().toUpperCase();
    setResults(SAMPLE_DOCS.filter(d => d.model.includes(q) || q.length < 3 ? SAMPLE_DOCS : []));
    if (results.length === 0) setResults(SAMPLE_DOCS.slice(0, 2));
  };

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Model Documents</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Model Documents</h1>
      </div>

      <div className="panel panel-filter mb-5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Model Code</span>
          <label htmlFor="model-code" className="sr-only">Model Code</label>
          <input
            id="model-code"
            type="text"
            value={modelCode}
            onChange={e => setModelCode(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleRefresh()}
            placeholder="Enter model code…"
            title="Model code to search"
            className="glass-input text-sm py-1.5 px-3 rounded-md flex-1"
          />
          
          <button className="btn btn-primary flex items-center gap-2 px-4">
            <Save className="h-3.5 w-3.5" />Save
          </button>
        </div>
      </div>

      {searched && (
        <div className="panel">
          {results.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No documents found for model code "{modelCode}". Try a partial code like "RF23" or "WF45".</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">{results.length} document{results.length !== 1 ? "s" : ""} found</p>
              {results.map((doc, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-md border border-white/10 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-blue-400 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">{doc.model} · {doc.type} · {doc.size}</p>
                    </div>
                  </div>
                  <button className="btn text-xs flex items-center gap-1.5 px-3">
                    <ExternalLink className="h-3.5 w-3.5" />View
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
