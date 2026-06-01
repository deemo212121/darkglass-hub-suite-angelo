import { USER_MANAGEMENT_RECORDS } from "@/lib/user-management";

export type AnnouncementMessage = {
  id: string;
  sender: string;
  body: string;
  createdAt: string;
  kind: "system" | "me" | "other";
};

export type AnnouncementStore = Record<string, AnnouncementMessage[]>;

export type ReadState = Record<string, string[]>;

export const ANNOUNCEMENT_THREAD_ID = "channel:announcements";
export const ANNOUNCEMENT_STORE_KEY = "ahs:team-messenger:v1";
export const ANNOUNCEMENT_READ_KEY_PREFIX = "ahs:announcement-read:";

const HIGHER_UP_TYPES = new Set(["Admin", "Manager", "HR", "Tech Manager", "Claim Manager", "Part Manager", "Supervisor"]);

function safeToday() {
  return new Date().toISOString().slice(0, 10);
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function currentUserDisplayName(email: string | null) {
  const record = USER_MANAGEMENT_RECORDS.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
  return record?.userName ?? email ?? "Current User";
}

function currentUserType(email: string | null) {
  const record = USER_MANAGEMENT_RECORDS.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
  return record?.type ?? "";
}

export function canPostAnnouncements(email: string | null) {
  const type = currentUserType(email);
  return HIGHER_UP_TYPES.has(type);
}

export function loadAnnouncementStore() {
  return loadJson<AnnouncementStore>(ANNOUNCEMENT_STORE_KEY, {});
}

export function saveAnnouncementStore(store: AnnouncementStore) {
  saveJson(ANNOUNCEMENT_STORE_KEY, store);
}

export function seedAnnouncementThread(currentUserEmail: string | null) {
  const currentName = currentUserDisplayName(currentUserEmail);
  return [
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-system`,
      sender: "System",
      body: "Company announcements and leadership updates appear here.",
      createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      kind: "system",
    },
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-1`,
      sender: "Admin Office",
      body: "Please review your open work queue before the end of the day.",
      createdAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
      kind: "other",
    },
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-2`,
      sender: "HR Team",
      body: `Thanks for logging in, ${currentName}. This is the announcements center for the published site.`,
      createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      kind: "other",
    },
  ] satisfies AnnouncementMessage[];
}

export function ensureAnnouncementThread(email: string | null) {
  const store = loadAnnouncementStore();
  if (!store[ANNOUNCEMENT_THREAD_ID] || store[ANNOUNCEMENT_THREAD_ID].length === 0) {
    store[ANNOUNCEMENT_THREAD_ID] = seedAnnouncementThread(email);
    saveAnnouncementStore(store);
  }
  return store;
}

export function getAnnouncementMessages(email: string | null) {
  const store = ensureAnnouncementThread(email);
  return store[ANNOUNCEMENT_THREAD_ID] ?? [];
}

export function getAnnouncementReadIds(email: string | null) {
  if (typeof window === "undefined" || !email) return new Set<string>();
  const raw = window.localStorage.getItem(`${ANNOUNCEMENT_READ_KEY_PREFIX}${email.toLowerCase()}`);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function saveAnnouncementReadIds(email: string | null, ids: Set<string>) {
  if (typeof window === "undefined" || !email) return;
  saveJson(`${ANNOUNCEMENT_READ_KEY_PREFIX}${email.toLowerCase()}`, [...ids]);
}

export function getUnreadAnnouncements(email: string | null, messages: AnnouncementMessage[]) {
  const readIds = getAnnouncementReadIds(email);
  return messages.filter((message) => message.kind !== "system" && !readIds.has(message.id));
}

export function markAnnouncementRead(email: string | null, messageId: string) {
  if (!email) return;
  const readIds = getAnnouncementReadIds(email);
  readIds.add(messageId);
  saveAnnouncementReadIds(email, readIds);
}

export function markAllAnnouncementsRead(email: string | null, messages: AnnouncementMessage[]) {
  if (!email) return;
  const readIds = getAnnouncementReadIds(email);
  messages.forEach((message) => {
    if (message.kind !== "system") readIds.add(message.id);
  });
  saveAnnouncementReadIds(email, readIds);
}

export function getUnreadAnnouncementCount(email: string | null, messages: AnnouncementMessage[]) {
  return getUnreadAnnouncements(email, messages).length;
}

export function formatAnnouncementTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
