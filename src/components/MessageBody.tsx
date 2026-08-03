/**
 * Renders a chat-message body with auto-linkified ticket numbers and URLs.
 *
 * Ticket-number detection is STRICT: only tokens prefixed with `#` become
 * ticket references. This avoids false positives on phone numbers, addresses,
 * tracking numbers, etc.
 *
 * Validity check: every `#TICKET` token is verified against the Supabase
 * tickets table. Valid tickets render as a clickable link. Invalid tokens
 * render in red with a warning icon and a tooltip that says the ticket
 * doesn't exist. Lookups are cached in memory so each ticket number is only
 * queried once per session.
 *
 * Examples that COULD link (if they exist in DB):
 *   #SA-3458831, #3864437E1, #064023374135, #TK-MEMPHIS-001
 *
 * Examples that DON'T link:
 *   3864437E1 (no hash), 409-221-5089 (phone), 12345 (too short),
 *   "test" (no hash), #FAKE-TICKET (flagged red)
 */
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

const URL_RE = /(https?:\/\/[^\s<>"]+)/i;

/** A token after the `#` must be 3–40 chars of [A-Z0-9-_]. */
function isValidTicketToken(token: string): boolean {
  if (!token) return false;
  if (token.length < 3 || token.length > 40) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\-_]*$/.test(token);
}

// In-memory cache of ticket existence checks. The page is short-lived so a
// plain Map is fine; reset on hard reload.
type ExistenceState = "unknown" | "checking" | "exists" | "missing";
const ticketExistenceCache = new Map<string, ExistenceState>();
const ticketExistencePromises = new Map<string, Promise<boolean>>();

async function checkTicketExists(ticketNo: string): Promise<boolean> {
  const cached = ticketExistenceCache.get(ticketNo);
  if (cached === "exists") return true;
  if (cached === "missing") return false;
  if (ticketExistencePromises.has(ticketNo)) {
    return ticketExistencePromises.get(ticketNo)!;
  }
  ticketExistenceCache.set(ticketNo, "checking");
  const p = (async () => {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("id")
        .eq("ticket_no", ticketNo)
        .limit(1);
      if (error) {
        console.warn(`[MessageBody] ticket existence check failed for ${ticketNo}:`, error.message);
        // On error, fall back to optimistic linking so chat stays usable.
        ticketExistenceCache.set(ticketNo, "exists");
        return true;
      }
      const ok = (data?.length ?? 0) > 0;
      ticketExistenceCache.set(ticketNo, ok ? "exists" : "missing");
      return ok;
    } finally {
      ticketExistencePromises.delete(ticketNo);
    }
  })();
  ticketExistencePromises.set(ticketNo, p);
  return p;
}

/** Hook: returns the existence state for a ticket number. */
function useTicketExistence(ticketNo: string): ExistenceState {
  const initial = ticketExistenceCache.get(ticketNo) ?? "unknown";
  const [state, setState] = useState<ExistenceState>(initial);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const current = ticketExistenceCache.get(ticketNo);
    if (current === "exists" || current === "missing") {
      setState(current);
      return;
    }
    let cancelled = false;
    setState("checking");
    checkTicketExists(ticketNo).then((ok) => {
      if (cancelled || !mounted.current) return;
      setState(ok ? "exists" : "missing");
    });
    return () => { cancelled = true; };
  }, [ticketNo]);

  return state;
}

interface Props {
  text: string;
  className?: string;
}

type Part =
  | string
  | { kind: "url"; value: string; trailing: string }
  | { kind: "ticket"; value: string; trailing: string }
  | { kind: "namedLink"; label: string; url: string };

// Optional named-link syntax `[label](https://...)` — e.g. for forwarding a
// CV with the actual filename as the clickable text instead of a raw signed
// URL. Matched as a whole-string pass BEFORE the per-token scan below (the
// label can contain spaces, which the token scan alone can't span), so it's
// purely additive — every plain "https://..." URL still auto-linkifies
// exactly as before.
const NAMED_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Runs the existing per-token URL/#ticket scan over one plain-text segment. */
function scanPlainText(text: string, parts: Part[]): void {
  const tokens = text.split(/(\s+)/);
  for (const raw of tokens) {
    if (!raw) continue;
    if (/^\s+$/.test(raw)) {
      parts.push(raw);
      continue;
    }

    const urlMatch = raw.match(URL_RE);
    if (urlMatch) {
      const idx = urlMatch.index ?? 0;
      const before = raw.slice(0, idx);
      const url = urlMatch[1];
      const after = raw.slice(idx + url.length);
      if (before) parts.push(before);
      parts.push({ kind: "url", value: url, trailing: after });
      continue;
    }

    if (raw.startsWith("#") && raw.length > 1) {
      const trailingMatch = raw.slice(1).match(/^([A-Za-z0-9\-_]+)(.*)$/);
      if (trailingMatch) {
        const core = trailingMatch[1];
        const trail = trailingMatch[2] ?? "";
        if (isValidTicketToken(core)) {
          parts.push({ kind: "ticket", value: core, trailing: trail });
          continue;
        }
      }
    }

    parts.push(raw);
  }
}

/** Render `text` with clickable URLs, `[label](url)` named links, and validated `#ticket-no` references. */
export function MessageBody({ text, className }: Props) {
  if (!text) return null;

  const parts: Part[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(NAMED_LINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) scanPlainText(text.slice(lastIndex, idx), parts);
    parts.push({ kind: "namedLink", label: m[1], url: m[2] });
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < text.length) scanPlainText(text.slice(lastIndex), parts);

  return (
    <p className={className}>
      {parts.map((p, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        if (p.kind === "namedLink") {
          return (
            <a
              key={i}
              href={p.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
            >
              📎 {p.label}
            </a>
          );
        }
        if (p.kind === "url") {
          return (
            <Fragment key={i}>
              <a
                href={p.value}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
              >
                {p.value}
              </a>
              {p.trailing}
            </Fragment>
          );
        }
        return <TicketReference key={i} ticketNo={p.value} trailing={p.trailing} />;
      })}
    </p>
  );
}

/**
 * Renders a single `#ticket-no` token. While the existence check is in
 * flight, the token is shown as a muted slate label. Once resolved it's
 * either a blue link (real ticket) or a red flagged span with a warning
 * icon (not found in DB).
 */
function TicketReference({ ticketNo, trailing }: { ticketNo: string; trailing: string }) {
  const state = useTicketExistence(ticketNo);

  if (state === "missing") {
    return (
      <Fragment>
        <span
          className="inline-flex items-center gap-1 rounded border border-rose-400/40 bg-rose-500/10 px-1.5 py-[1px] font-mono text-rose-300 line-through decoration-rose-300/50"
          title={`#${ticketNo} doesn't match any ticket in the system.`}
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          <span aria-label={`Invalid ticket ${ticketNo}`}>#{ticketNo}</span>
        </span>
        {trailing}
      </Fragment>
    );
  }

  if (state === "checking" || state === "unknown") {
    return (
      <Fragment>
        <span
          className="font-mono text-slate-400"
          title="Checking ticket…"
        >
          #{ticketNo}
        </span>
        {trailing}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <Link
        to="/ticket/$ticketNo"
        params={{ ticketNo }}
        className="font-mono text-blue-300 underline decoration-blue-300/40 hover:text-blue-200"
        title={`Open ticket ${ticketNo}`}
      >
        #{ticketNo}
      </Link>
      {trailing}
    </Fragment>
  );
}
