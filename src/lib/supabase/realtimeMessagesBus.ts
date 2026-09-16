/**
 * Shared "any new message in this company" feed — ONE postgres_changes
 * subscription on `messages`, fanned out in-process to every listener
 * (MessagesMenu, FloatingMessenger, ...) instead of each one opening its
 * own duplicate Realtime channel for the identical event stream. Every
 * extra channel is its own server-side fanout target and client-side
 * connection overhead for data every listener already gets for free here —
 * cutting the duplicates is a real fix for both "too much RAM" and
 * "delivery feels slow," not just the RAM half.
 */
import { subscribeToAllNewMessages, type MessageRow } from "./messaging";

type Listener = (row: MessageRow) => void;

const listeners = new Set<Listener>();
let unsubscribeUpstream: (() => void) | null = null;

function ensureSubscribed() {
  if (unsubscribeUpstream) return;
  unsubscribeUpstream = subscribeToAllNewMessages((row) => {
    for (const listener of listeners) listener(row);
  });
}

/** Register for every new message in the company. Returns an unsubscribe function. */
export function subscribeMessagesBus(listener: Listener): () => void {
  listeners.add(listener);
  ensureSubscribed();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeUpstream) {
      unsubscribeUpstream();
      unsubscribeUpstream = null;
    }
  };
}
