/**
 * Chat reactions, replies and forwards (migration 0360). Everything here
 * degrades quietly before the migration is run: no reactions / links are
 * shown, and adding one says the migration is needed.
 */
import { supabase } from "./client";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export interface ReactionGroup {
  emoji: string;
  profileIds: string[];
}

export interface MessageLink {
  replyToId: string | null;
  forwardedFromMessageId: string | null;
  forwardedFromName: string | null;
}

const isMissing = (msg: string, table: string) => msg.includes(table) && /does not exist|schema cache|could not find/i.test(msg);
const SETUP_MSG = "Reactions, replies and forwards aren't set up yet — run migration 0360 in Supabase first.";

/** message id → reactions grouped by emoji (in first-used order). */
export async function getReactions(messageIds: string[]): Promise<Map<string, ReactionGroup[]>> {
  const out = new Map<string, ReactionGroup[]>();
  if (messageIds.length === 0) return out;
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, profile_id, emoji, created_at")
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissing(error.message, "message_reactions")) console.error("getReactions error:", error.message);
    return out;
  }
  for (const r of data ?? []) {
    const list = out.get(r.message_id as string) ?? [];
    let g = list.find((x) => x.emoji === r.emoji);
    if (!g) {
      g = { emoji: r.emoji as string, profileIds: [] };
      list.push(g);
    }
    g.profileIds.push(r.profile_id as string);
    out.set(r.message_id as string, list);
  }
  return out;
}

/** Add my reaction, or take it back if I already reacted with that emoji. */
export async function toggleReaction(messageId: string, emoji: string, myProfileId: string, alreadyReacted: boolean): Promise<void> {
  const { error } = alreadyReacted
    ? await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("profile_id", myProfileId).eq("emoji", emoji)
    : await supabase.from("message_reactions").insert({ message_id: messageId, profile_id: myProfileId, emoji });
  if (error && !/duplicate key/i.test(error.message)) {
    throw new Error(isMissing(error.message, "message_reactions") ? SETUP_MSG : error.message);
  }
}

/** Re-run `onChange` whenever anyone reacts or un-reacts (realtime). Returns an unsubscribe. */
export function subscribeReactions(onChange: () => void): () => void {
  const ch = supabase
    .channel(`message-reactions-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function getMessageLinks(messageIds: string[]): Promise<Map<string, MessageLink>> {
  const out = new Map<string, MessageLink>();
  if (messageIds.length === 0) return out;
  const { data, error } = await supabase
    .from("message_links")
    .select("message_id, reply_to_id, forwarded_from_message_id, forwarded_from_name")
    .in("message_id", messageIds);
  if (error) {
    if (!isMissing(error.message, "message_links")) console.error("getMessageLinks error:", error.message);
    return out;
  }
  for (const r of data ?? []) {
    out.set(r.message_id as string, {
      replyToId: (r.reply_to_id as string) ?? null,
      forwardedFromMessageId: (r.forwarded_from_message_id as string) ?? null,
      forwardedFromName: (r.forwarded_from_name as string) ?? null,
    });
  }
  return out;
}

export async function saveMessageLink(messageId: string, link: Partial<MessageLink>): Promise<void> {
  const { error } = await supabase.from("message_links").insert({
    message_id: messageId,
    reply_to_id: link.replyToId ?? null,
    forwarded_from_message_id: link.forwardedFromMessageId ?? null,
    forwarded_from_name: link.forwardedFromName ?? null,
  });
  if (error) throw new Error(isMissing(error.message, "message_links") ? SETUP_MSG : error.message);
}
