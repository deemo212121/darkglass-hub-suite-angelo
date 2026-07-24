/**
 * "Service Performed (Tech)" — the mobile visit-edit form's structured
 * replacement for the old free-text "Repair Notes (Tech)" field. Still
 * backed by the single `visits.repair_notes` text column (no migration) —
 * this just parses/composes a fixed 4-section shape around it:
 *   Notes: / Parts Needed: / Additional: / Parts Used:
 *
 * No format enforcement existed anywhere on this field before, so parsing
 * is deliberately lossless for legacy text: anything that isn't inside a
 * recognized section lands in `notes` rather than being dropped.
 */

export interface ServicePerformedSections {
  notes: string;
  partsNeeded: string;
  additional: string;
  partsUsed: string;
}

const SECTION_LABELS: Array<{ key: keyof ServicePerformedSections; label: string }> = [
  { key: "notes", label: "Notes:" },
  { key: "partsNeeded", label: "Parts Needed:" },
  { key: "additional", label: "Additional:" },
  { key: "partsUsed", label: "Parts Used:" },
];

export function emptyServicePerformed(): ServicePerformedSections {
  return { notes: "", partsNeeded: "", additional: "", partsUsed: "" };
}

/** Parses a saved resolution string back into the 4 sections. */
export function parseServicePerformed(text: string): ServicePerformedSections {
  const buffers: Record<keyof ServicePerformedSections, string[]> = {
    notes: [], partsNeeded: [], additional: [], partsUsed: [],
  };
  if (text) {
    let currentKey: keyof ServicePerformedSections | null = null;
    for (const line of text.split("\n")) {
      const match = SECTION_LABELS.find((s) => line.trim() === s.label);
      if (match) {
        currentKey = match.key;
        continue;
      }
      // Before the first recognized label (or for text that never had any
      // labels at all - every pre-existing visit note) everything lands in
      // "notes" so nothing a technician already wrote is ever lost.
      buffers[currentKey ?? "notes"].push(line);
    }
  }
  const sections = emptyServicePerformed();
  for (const { key } of SECTION_LABELS) sections[key] = buffers[key].join("\n").trim();
  return sections;
}

/** Recomposes the 4 sections into one fixed-order string for storage. */
export function composeServicePerformed(sections: ServicePerformedSections): string {
  return SECTION_LABELS
    .map(({ key, label }) => `${label}\n${sections[key] ?? ""}`)
    .join("\n\n")
    .trimEnd();
}

/**
 * Idempotently appends one line to the Parts Used section text — skips if a
 * line for this exact part # is already present, so toggling a part's
 * status back and forth (or re-saving) doesn't spam duplicate lines.
 */
export function appendPartUsedLine(partsUsed: string, partNo: string, line: string): string {
  const needle = partNo.trim();
  if (!needle) return partsUsed;
  const alreadyPresent = partsUsed.split("\n").some((existing) => existing.includes(needle));
  if (alreadyPresent) return partsUsed;
  const base = partsUsed.trimEnd();
  return base ? `${base}\n${line}` : line;
}
