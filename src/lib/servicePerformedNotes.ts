/**
 * "Service Performed (Tech)" — the visit-edit form's structured
 * replacement for the old free-text "Repair Notes (Tech)" field. Still
 * backed by the single `visits.repair_notes` text column (no migration) —
 * this just parses/composes a fixed 4-section shape around it:
 *   Notes: / Parts Needed: / Additional: / Parts Used:
 *
 * No format enforcement existed anywhere on this field before, so parsing
 * is deliberately lossless for legacy text: anything that isn't inside a
 * recognized section lands in `notes` rather than being dropped.
 *
 * Both mobile and desktop render this as ONE textarea whose value is kept
 * in sync with these helpers on every keystroke (parse -> compose back),
 * so the label lines snap back into place if a user manages to disturb
 * them — see composeServicePerformed's per-block trimEnd, which is what
 * makes recompose(parse(x)) idempotent regardless of which sections are
 * empty. Without that, an empty middle section would gain an extra blank
 * line on every recompose and the field would visibly "jitter" as soon as
 * you typed anything.
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

/** Placeholder-style hint appended (display-only, never persisted) to the
 * "Parts Used:" label while that section is empty. */
export const PARTS_USED_HINT = " (auto-filled when a part is marked Used)";

function matchesLabel(lineTrimmed: string, label: string): boolean {
  return lineTrimmed === label || (label === "Parts Used:" && lineTrimmed === label + PARTS_USED_HINT);
}

export function emptyServicePerformed(): ServicePerformedSections {
  return { notes: "", partsNeeded: "", additional: "", partsUsed: "" };
}

/** Parses a saved (or in-progress, possibly hint-decorated) resolution
 * string back into the 4 sections. */
export function parseServicePerformed(text: string): ServicePerformedSections {
  const buffers: Record<keyof ServicePerformedSections, string[]> = {
    notes: [], partsNeeded: [], additional: [], partsUsed: [],
  };
  if (text) {
    let currentKey: keyof ServicePerformedSections | null = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      const match = SECTION_LABELS.find((s) => matchesLabel(trimmed, s.label));
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

/** Recomposes the 4 sections into one fixed-order string for storage.
 * Each block is trimmed before joining so an empty section never leaves a
 * dangling blank line — that's what keeps this idempotent under
 * parse -> compose regardless of which sections are filled in. */
export function composeServicePerformed(sections: ServicePerformedSections): string {
  return SECTION_LABELS
    .map(({ key, label }) => `${label}\n${sections[key] ?? ""}`.trimEnd())
    .join("\n\n");
}

/** Same as composeServicePerformed, but for what's actually shown inside
 * the single editable textarea: while Parts Used is still empty, its label
 * carries a greyed-in-place hint that disappears the moment it's filled
 * (by hand or by the mobile auto-fill). Never persisted — always strip
 * back through parseServicePerformed/composeServicePerformed before
 * saving. */
export function composeServicePerformedForDisplay(sections: ServicePerformedSections): string {
  const canonical = composeServicePerformed(sections);
  if (sections.partsUsed.trim()) return canonical;
  return canonical.replace(/^Parts Used:$/m, `Parts Used:${PARTS_USED_HINT}`);
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
