/**
 * "Service Performed (Tech)" — the visit-edit form's structured
 * replacement for the old free-text "Repair Notes (Tech)" field. Still
 * backed by the single `visits.repair_notes` text column (no migration) —
 * this just parses/composes a fixed section shape around it:
 *   Notes: / Parts Needed: / Additional:
 *
 * Parts Used is deliberately NOT one of these sections — it's rendered
 * separately as a live read-only list (derived straight from the ticket's
 * parts, filtered to status "Used") attached to the latest visit log
 * entry, not baked into this free-text field. Parts don't reliably link to
 * a specific visit (`parts.visit_id` is null on every real row in
 * production) and a tech typing status changes into a notes blob would
 * always risk drifting out of sync with what the Parts tab actually says.
 *
 * No format enforcement existed anywhere on this field before, so parsing
 * is deliberately lossless for legacy text: anything that isn't inside a
 * recognized section lands in `notes` rather than being dropped.
 *
 * Both mobile and desktop render this as ONE textarea whose value is kept
 * in sync with these helpers on blur/save (not live on every keystroke —
 * see composeServicePerformed's per-block trimEnd, which is what makes
 * recompose(parse(x)) idempotent regardless of which sections are empty).
 */

export interface ServicePerformedSections {
  notes: string;
  partsNeeded: string;
  additional: string;
}

const SECTION_LABELS: Array<{ key: keyof ServicePerformedSections; label: string }> = [
  { key: "notes", label: "Notes:" },
  { key: "partsNeeded", label: "Parts Needed:" },
  { key: "additional", label: "Additional:" },
];

export function emptyServicePerformed(): ServicePerformedSections {
  return { notes: "", partsNeeded: "", additional: "" };
}

/** Parses a saved (or in-progress) resolution string back into sections. */
export function parseServicePerformed(text: string): ServicePerformedSections {
  const buffers: Record<keyof ServicePerformedSections, string[]> = {
    notes: [], partsNeeded: [], additional: [],
  };
  if (text) {
    let currentKey: keyof ServicePerformedSections | null = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      const match = SECTION_LABELS.find((s) => trimmed === s.label);
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

/** Recomposes the sections into one fixed-order string for storage.
 * Each block is trimmed before joining so an empty section never leaves a
 * dangling blank line — that's what keeps this idempotent under
 * parse -> compose regardless of which sections are filled in. */
export function composeServicePerformed(sections: ServicePerformedSections): string {
  return SECTION_LABELS
    .map(({ key, label }) => `${label}\n${sections[key] ?? ""}`.trimEnd())
    .join("\n\n");
}
