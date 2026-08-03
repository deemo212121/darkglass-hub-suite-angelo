/**
 * Live announcement banner.
 *
 * Two triggers:
 *  1. On login / first mount, surfaces the most recent UNREAD announcement so
 *     anything posted while the user was away gets seen.
 *  2. While logged in, subscribes to the company's #announcements channel and
 *     pops a banner the instant a new one arrives — plus a notification beep.
 */

import { useEffect, useRef, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  type ChannelRow,
  type MessageRow,
  getAnnouncementsChannel,
  getChannelMessages,
  markThreadRead,
  subscribeToMessages,
} from "@/lib/supabase/messaging";
import { getMyProfileId } from "@/lib/supabase/users";
import { supabase } from "@/lib/supabase/client";
import { playAnnouncementSound } from "@/lib/notifySound";

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AnnouncementBanner() {
  const { ready, uid } = useAuth();
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [announcement, setAnnouncement] = useState<MessageRow | null>(null);
  // Track which announcement ids we've already shown in this session so the
  // realtime subscription doesn't re-pop the same banner if the user closed
  // it and a re-sync happens.
  const seenRef = useRef<Set<string>>(new Set());
  // The user's last_read_at pointer for the announcements channel. Refreshed
  // from Supabase so a previously-read announcement never re-pops.
  const lastReadAtRef = useRef<string | null>(null);

  // Re-read the user's last-read pointer from message_reads. Cheap (single
  // indexed row). Called on mount and after the user dismisses/opens.
  const refreshLastRead = async (pid: string, channelId: string) => {
    try {
      const { data } = await supabase
        .from("message_reads")
        .select("last_read_at")
        .eq("profile_id", pid)
        .eq("channel_id", channelId)
        .maybeSingle();
      lastReadAtRef.current = ((data as any)?.last_read_at as string | undefined) ?? null;
    } catch { /* ignore */ }
  };

  // Resolve identity + show the pending-unread announcement (if any).
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [pid, ch] = await Promise.all([
          getMyProfileId(uid),
          getAnnouncementsChannel(),
        ]);
        if (cancelled || !pid) return;
        setProfileId(pid);
        setChannel(ch);

        // Pull the current read pointer from Supabase BEFORE we decide
        // whether to surface anything.
        await refreshLastRead(pid, ch.id);

        const recent = await getChannelMessages(ch.id, 5);
        const newest = recent
          .filter((m) => m.kind === "user" && m.sender_id !== pid)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (newest && (!lastReadAtRef.current || newest.created_at > lastReadAtRef.current)) {
          if (!seenRef.current.has(newest.id)) {
            seenRef.current.add(newest.id);
            setAnnouncement(newest);
            playAnnouncementSound();
          }
        }
      } catch {
        // Banner stays hidden if Supabase isn't reachable.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid]);

  // Subscribe to NEW announcements arriving while we're online. We use two
  // mechanisms in parallel:
  //   (a) Postgres realtime push — instant, but only fires when Supabase
  //       realtime is enabled on the `messages` table.
  //   (b) Polling every 8s — guaranteed to find new announcements even if
  //       realtime is off in the project settings.
  // In both cases we filter against the user's `last_read_at` so previously
  // read announcements never re-pop.
  useEffect(() => {
    if (!channel || !profileId) return;
    let cancelled = false;

    const handleRow = (row: MessageRow) => {
      if (row.kind !== "user") return;
      if (row.sender_id === profileId) return;
      if (seenRef.current.has(row.id)) return;
      if (lastReadAtRef.current && row.created_at <= lastReadAtRef.current) return;
      seenRef.current.add(row.id);
      setAnnouncement(row);
      playAnnouncementSound();
    };

    const unsub = subscribeToMessages({
      channelId: channel.id,
      onMessage: handleRow,
    });

    const poll = window.setInterval(async () => {
      if (cancelled) return;
      try {
        // Refresh the read pointer first so other tabs / a fresh "mark all
        // read" elsewhere is honored before we decide to pop.
        await refreshLastRead(profileId, channel.id);
        const recent = await getChannelMessages(channel.id, 5);
        const newest = recent
          .filter((m) => m.kind === "user" && m.sender_id !== profileId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (newest) handleRow(newest);
      } catch { /* ignore */ }
    }, 4000);

    // Also re-fetch the read pointer when something elsewhere in the app
    // marks announcements as read (Mark all read button, opening the channel,
    // etc.).
    const onChanged = () => { refreshLastRead(profileId, channel.id); };
    window.addEventListener("ahs:unread-changed", onChanged);

    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(poll);
      window.removeEventListener("ahs:unread-changed", onChanged);
    };
  }, [channel?.id, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !announcement) return null;

  const dismiss = async () => {
    const shown = announcement;
    setAnnouncement(null);
    if (profileId && channel) {
      try {
        await markThreadRead({ profileId, channelId: channel.id });
        // Optimistically advance our local pointer so the next poll cycle
        // doesn't re-pop the same announcement before Supabase round-trips.
        if (shown) lastReadAtRef.current = shown.created_at;
        window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
      } catch { /* ignore */ }
    }
  };

  const open = async () => {
    const shown = announcement;
    setAnnouncement(null);
    if (profileId && channel) {
      try {
        await markThreadRead({ profileId, channelId: channel.id });
        if (shown) lastReadAtRef.current = shown.created_at;
        window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
      } catch { /* ignore */ }
    }
    navigate({ to: "/announcements" });
  };

  return (
    <div className="fixed left-1/2 top-20 z-50 w-[min(92vw,52rem)] -translate-x-1/2 px-4">
      <div className="rounded-2xl border border-amber-400/30 bg-slate-950/95 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex items-start gap-4 p-4 sm:p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-200">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">New announcement</div>
              <div className="text-[11px] text-slate-400">{formatTimestamp(announcement.created_at)}</div>
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{announcement.sender_name || "Unknown"}</div>
            <p className="mt-2 text-sm leading-6 text-slate-200 whitespace-pre-wrap">{announcement.body}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={open}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              View announcements
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss announcement"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
