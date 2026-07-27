/**
 * Posts a Discord "Incoming Webhook" message when a custom form gets a new
 * submission (see CustomFormBuilder.tsx's "Discord Webhook URL" field). A
 * webhook URL is created on Discord's side (Channel Settings > Integrations
 * > Webhooks > New Webhook > Copy Webhook URL) — no OAuth or bot needed,
 * posting to it is just a plain POST.
 *
 * Deliberately dependency-free, same reasoning as customFormsBridge.ts's
 * FILE_BEARING_TYPES/STRUCTURAL_TYPES comment — this duplicates a minimal
 * version of generate.ts's stringifyValue rather than importing it, since
 * that module pulls in pdfCapture.ts (browser-only) at the top.
 */
import type { CustomFormField } from "@/lib/formElements/types";

const STRUCTURAL_TYPES = new Set(["heading", "paragraph", "divider", "image", "sectionCollapse", "pageBreak", "submitButton"]);

function stringifyResponseValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) return (value as unknown[][]).map((row) => row.join(", ")).join("; ") || "—";
    return (value as unknown[]).filter((v) => v !== "" && v != null).join(", ") || "—";
  }
  if (typeof value === "object" && "fileName" in (value as Record<string, unknown>)) return `Attachment: ${(value as { fileName?: string }).fileName || "file"}`;
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ") || "—";
}

// Discord's own "blurple" — reads as on-brand inside a Discord channel rather than an arbitrary color.
const DISCORD_EMBED_COLOR = 0x5865f2;

export async function postDiscordSubmissionNotice(
  webhookUrl: string,
  opts: { formTitle: string; submitterName: string | null; submittedAt: string; fields: CustomFormField[]; responses: Record<string, unknown> }
): Promise<void> {
  const answered = opts.fields
    .filter((f) => !STRUCTURAL_TYPES.has(f.type))
    .map((f) => ({ name: (f.label || "Untitled field").slice(0, 256), value: stringifyResponseValue(opts.responses[f.id]).slice(0, 1024), inline: false }))
    .slice(0, 24); // Discord's own embed limit is 25 fields total

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: opts.formTitle.slice(0, 256),
          description: `New submission from **${opts.submitterName || "Anonymous"}**`,
          color: DISCORD_EMBED_COLOR,
          timestamp: opts.submittedAt,
          fields: answered,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook responded ${res.status}: ${await res.text()}`);
}

export async function postDiscordTestMessage(webhookUrl: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Test message from AHS Form Maker — this channel is connected correctly." }),
  });
  if (!res.ok) throw new Error(`Discord webhook responded ${res.status}: ${await res.text()}`);
}
