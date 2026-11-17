/**
 * Profile → Terms & Conditions: the terms this person accepted (migration 0455),
 * newest first — click one to read exactly the version they agreed to.
 * Hidden when there's nothing (no terms published yet, or migration not run).
 */

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronDown, ChevronRight, FileCheck2 } from "lucide-react";
import { getMyAcceptedTerms } from "@/lib/supabase/terms";
import type { TermsAcceptance, TermsVersion } from "@/lib/terms";
import { TERMS_DOC_CLASS, TERMS_DOC_PANEL, TermsDocStyleTag } from "@/components/TermsDocStyle";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function MyAcceptedTerms({ profileId }: { profileId: string | null }) {
  const [rows, setRows] = useState<{ acceptance: TermsAcceptance; version: TermsVersion }[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    getMyAcceptedTerms(profileId).then(setRows).catch(() => setRows([]));
  }, [profileId]);

  if (!rows.length) return null;
  return (
    <section className="panel mt-6">
      <TermsDocStyleTag />
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><FileCheck2 className="h-5 w-5 text-sky-300" /> Terms &amp; Conditions</h2>
      <p className="mb-3 text-sm text-muted-foreground">What you accepted, and when. Click one to read it.</p>
      <div className="divide-y divide-white/5 rounded-lg border border-white/10">
        {rows.map(({ acceptance, version }) => {
          const isOpen = open === acceptance.id;
          return (
            <div key={acceptance.id}>
              <button type="button" onClick={() => setOpen(isOpen ? null : acceptance.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="font-semibold">{version.title}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">v{version.version}</span>
                <span className="ml-auto text-xs text-muted-foreground">Accepted {fmt(acceptance.acceptedAt)}</span>
              </button>
              {isOpen && (
                <div className={`${TERMS_DOC_CLASS} ${TERMS_DOC_PANEL} mx-3 mb-3 max-h-[50vh] overflow-y-auto rounded-md border border-white/10 px-8 py-6`} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(version.body) }} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
