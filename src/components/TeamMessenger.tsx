import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Hash, Home, MessageCircle, Search, Send, Users2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { USER_MANAGEMENT_RECORDS, type UserManagementRecord } from "@/lib/user-management";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

type ThreadKind = "channel" | "dm";

type ChatMessage = {
  id: string;
  sender: string;
  body: string;
  createdAt: string;
  kind: "system" | "me" | "other";
};

type ThreadDef = {
  id: string;
  title: string;
  subtitle: string;
  kind: ThreadKind;
  participant?: UserManagementRecord;
};

const STORE_KEY = "ahs:team-messenger:v1";
const ANNOUNCEMENT_THREAD_ID = "channel:announcements";
const HIGHER_UP_TYPES = new Set(["Admin", "Manager", "HR", "Tech Manager", "Claim Manager", "Part Manager", "Supervisor"]);
const CHANNELS: ThreadDef[] = [
  { id: ANNOUNCEMENT_THREAD_ID, title: "#announcements", subtitle: "Shout-outs and daily company notices", kind: "channel" },
  { id: "channel:all-employees", title: "#all-employees", subtitle: "Broadcast updates to every employee", kind: "channel" },
  { id: "channel:general", title: "#general", subtitle: "Company-wide chat and coordination", kind: "channel" },
  { id: "channel:service", title: "#service", subtitle: "Service, dispatch, and scheduling", kind: "channel" },
  { id: "channel:parts", title: "#parts", subtitle: "Parts ordering and receiving", kind: "channel" },
  { id: "channel:admin", title: "#admin", subtitle: "Leadership, HR, and account ops", kind: "channel" },
];

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function makeMessageId(threadId: string) {
  return `${threadId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function seedThread(thread: ThreadDef, currentUserName: string, currentOffice: string, contacts: UserManagementRecord[]): ChatMessage[] {
  const firstContacts = contacts.slice(0, 4);

  if (thread.kind === "channel") {
    if (thread.id === ANNOUNCEMENT_THREAD_ID) {
      const leaders = contacts.filter((record) => HIGHER_UP_TYPES.has(record.type)).slice(0, 3);
      return [
        {
          id: makeMessageId(thread.id),
          sender: "System",
          body: "Announcements from admin and other higher-ups appear here and surface on login.",
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
          kind: "system",
        },
        {
          id: makeMessageId(thread.id),
          sender: leaders[0]?.userName ?? "Memphis Admin",
          body: "Reminder: review your open tickets before the end of the day.",
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          kind: "other",
        },
        {
          id: makeMessageId(thread.id),
          sender: leaders[1]?.userName ?? "Nashville Admin",
          body: "Great work on the morning schedule. Keep the momentum going.",
          createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
          kind: "other",
        },
        {
          id: makeMessageId(thread.id),
          sender: currentUserName,
          body: `Logged in from ${currentOffice}. Ready for today’s updates.`,
          createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
          kind: "me",
        },
      ];
    }

    if (thread.id === "channel:all-employees") {
      return [
        {
          id: makeMessageId(thread.id),
          sender: "System",
          body: "Welcome to the all employees channel. Use this space for company-wide updates.",
          createdAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
          kind: "system",
        },
        {
          id: makeMessageId(thread.id),
          sender: firstContacts[0]?.userName ?? "Memphis Admin",
          body: "Daily routes are updated and ready for review.",
          createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
          kind: "other",
        },
        {
          id: makeMessageId(thread.id),
          sender: currentUserName,
          body: `Checking in from ${currentOffice}. Please flag any urgent items here.`,
          createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
          kind: "me",
        },
      ];
    }

    if (thread.id === "channel:service") {
      return [
        {
          id: makeMessageId(thread.id),
          sender: "System",
          body: "Service updates and dispatch notes appear here.",
          createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
          kind: "system",
        },
        {
          id: makeMessageId(thread.id),
          sender: firstContacts[1]?.userName ?? "Service Desk",
          body: "Two open visits were moved to afternoon slots.",
          createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
          kind: "other",
        },
        {
          id: makeMessageId(thread.id),
          sender: currentUserName,
          body: "Acknowledged. I’ll keep this thread for dispatch changes.",
          createdAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
          kind: "me",
        },
      ];
    }

    return [
      {
        id: makeMessageId(thread.id),
        sender: "System",
        body: `Channel ${thread.title} is ready for team communication.`,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        kind: "system",
      },
      {
        id: makeMessageId(thread.id),
        sender: firstContacts[2]?.userName ?? "Team Member",
        body: "Please confirm any schedule changes before the end of the day.",
        createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        kind: "other",
      },
      {
        id: makeMessageId(thread.id),
        sender: currentUserName,
        body: "Understood. I’ll keep updates in this channel.",
        createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
        kind: "me",
      },
    ];
  }

  const participant = thread.participant;
  return [
    {
      id: makeMessageId(thread.id),
      sender: "System",
      body: `Direct message thread opened with ${participant?.userName ?? "this employee"}.`,
      createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
      kind: "system",
    },
    {
      id: makeMessageId(thread.id),
      sender: participant?.userName ?? "Employee",
      body: "Hey, can you check the latest status for the open ticket?",
      createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      kind: "other",
    },
    {
      id: makeMessageId(thread.id),
      sender: currentUserName,
      body: "Yes, I’m on it and will update you here once it’s resolved.",
      createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      kind: "me",
    },
  ];
}

function loadStore() {
  if (typeof window === "undefined") return {} as Record<string, ChatMessage[]>;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {} as Record<string, ChatMessage[]>;
    const parsed = JSON.parse(raw) as Record<string, ChatMessage[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {} as Record<string, ChatMessage[]>;
  }
}

function resolveThread(threadId: string, contacts: UserManagementRecord[]): ThreadDef {
  const channel = CHANNELS.find((item) => item.id === threadId);
  if (channel) return channel;

  const loginName = threadId.startsWith("dm:") ? threadId.slice(3) : threadId;
  const participant = contacts.find((record) => record.loginName === loginName || record.email === loginName || record.userName === loginName);
  return {
    id: `dm:${participant?.loginName ?? loginName}`,
    title: participant?.userName ?? loginName,
    subtitle: participant ? `${participant.type} · ${participant.office}` : "Direct message",
    kind: "dm",
    participant,
  };
}

export function TeamMessenger({ mod, sub }: Props) {
  const { email, ready } = useAuth();
  const currentUser = useMemo(() => USER_MANAGEMENT_RECORDS.find((record) => record.email.toLowerCase() === String(email || "").toLowerCase()) ?? null, [email]);
  const currentUserName = currentUser?.userName ?? email ?? "Current User";
  const currentOffice = currentUser?.office ?? "Unknown Office";

  const contacts = useMemo(
    () => [...USER_MANAGEMENT_RECORDS].sort((left, right) => left.userName.localeCompare(right.userName)),
    [],
  );
  const [search, setSearch] = useState("");
  const [activeThreadId, setActiveThreadId] = useState(CHANNELS[0].id);
  const [draft, setDraft] = useState("");
  const [store, setStore] = useState<Record<string, ChatMessage[]>>(() => loadStore());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    setStore((currentStore) => {
      if (currentStore[activeThreadId]) return currentStore;
      const thread = resolveThread(activeThreadId, contacts);
      return {
        ...currentStore,
        [thread.id]: seedThread(thread, currentUserName, currentOffice, contacts),
      };
    });
    setDraft("");
  }, [activeThreadId, contacts, currentOffice, currentUserName, ready]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }, [store]);

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((record) => {
      return [record.userName, record.loginName, record.type, record.office, record.email, record.manager]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [contacts, search]);

  const activeThread = useMemo(() => resolveThread(activeThreadId, contacts), [activeThreadId, contacts]);
  const activeMessages = store[activeThread.id] ?? seedThread(activeThread, currentUserName, currentOffice, contacts);
  const participantCount = activeThread.kind === "channel" ? contacts.length : 2;
  const canPostAnnouncement = !currentUser || HIGHER_UP_TYPES.has(currentUser.type);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeMessages.length, activeThread.id]);

  const sendMessage = () => {
    if (activeThread.id === ANNOUNCEMENT_THREAD_ID && !canPostAnnouncement) return;

    const body = draft.trim();
    if (!body) return;

    const nextMessage: ChatMessage = {
      id: makeMessageId(activeThread.id),
      sender: currentUserName,
      body,
      createdAt: new Date().toISOString(),
      kind: "me",
    };

    setStore((currentStore) => {
      const existing = currentStore[activeThread.id] ?? activeMessages;
      return {
        ...currentStore,
        [activeThread.id]: [...existing, nextMessage],
      };
    });
    setDraft("");
  };

  if (!ready) return null;

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-6 lg:px-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="inline-flex items-center hover:text-foreground" aria-label="Home" title="Home">
          <Home className="h-3.5 w-3.5" />
        </Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link>
        <span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Messenger</h1>
          <p className="text-sm text-muted-foreground">Chat with employees, teams, and broadcast channels.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <aside className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search people or channels"
              className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              <Hash className="h-3.5 w-3.5" />
              Channels
            </div>
            <div className="space-y-2">
              {CHANNELS.map((thread) => {
                const active = activeThread.id === thread.id;
                return (
                  <button
                    key={thread.id}
                    onClick={() => setActiveThreadId(thread.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-blue-400/50 bg-blue-500/15 text-white"
                        : "border-white/10 bg-slate-950/70 text-slate-200 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold">{thread.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{thread.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              <Users2 className="h-3.5 w-3.5" />
              Employees
            </div>
            <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
              {filteredContacts.map((record) => {
                const threadId = `dm:${record.loginName}`;
                const active = activeThread.id === threadId;
                return (
                  <button
                    key={record.loginName}
                    onClick={() => setActiveThreadId(threadId)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-blue-400/50 bg-blue-500/15 text-white"
                        : "border-white/10 bg-slate-950/70 text-slate-200 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                        {initials(record.userName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{record.userName}</div>
                        <div className="truncate text-xs text-slate-400">{record.type} · {record.office}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{activeThread.kind === "channel" ? "Channel" : "Direct Message"}</div>
              <h2 className="mt-1 text-2xl font-bold">{activeThread.title}</h2>
              <p className="mt-1 text-sm text-slate-300">{activeThread.subtitle}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-right text-xs text-slate-400">
              <div className="font-semibold text-white">{currentUserName}</div>
              <div>{currentOffice}</div>
            </div>
          </div>

          <div className="mt-4 max-h-[50rem] space-y-3 overflow-y-auto pr-1">
            {activeMessages.map((message) => {
              const isMe = message.kind === "me";
              const isSystem = message.kind === "system";
              return (
                <div
                  key={message.id}
                  className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                    isSystem
                      ? "border-white/10 bg-white/5 text-slate-300"
                      : isMe
                        ? "ml-auto max-w-[82%] border-blue-500/30 bg-blue-500/15 text-white"
                        : "mr-auto max-w-[82%] border-white/10 bg-slate-950/90 text-slate-100"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                    <span>{message.sender}</span>
                    <span>{formatTimestamp(message.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap leading-6">{message.body}</p>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/80 p-3">
            <label htmlFor="team-messenger-draft" className="sr-only">
              Message composer
            </label>
            <textarea
              id="team-messenger-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={activeThread.id === ANNOUNCEMENT_THREAD_ID && !canPostAnnouncement}
              placeholder={`Message ${activeThread.kind === "channel" ? activeThread.title : activeThread.title}...`}
              className="glass-input min-h-28 w-full resize-none rounded-xl bg-slate-900 text-white placeholder:text-slate-500"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {activeThread.id === ANNOUNCEMENT_THREAD_ID && !canPostAnnouncement
                  ? "Only higher-ups can post announcements."
                  : "Messages are stored locally in this browser for the demo build."}
              </div>
              <button onClick={sendMessage} disabled={activeThread.id === ANNOUNCEMENT_THREAD_ID && !canPostAnnouncement} className="btn btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            <MessageCircle className="h-3.5 w-3.5" />
            Thread Details
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Participants</div>
            <div className="mt-2 text-white">{participantCount} total</div>
            <div className="mt-1 text-slate-300">
              {activeThread.kind === "channel"
                ? "All employees can join this broadcast channel."
                : activeThread.participant
                  ? `Direct conversation with ${activeThread.participant.userName}.`
                  : "Direct conversation with this employee."}
            </div>
          </div>

          {activeThread.kind === "dm" && activeThread.participant ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Employee Info</div>
              <div className="mt-3 space-y-2 text-slate-300">
                <div><span className="text-slate-500">Type:</span> {activeThread.participant.type}</div>
                <div><span className="text-slate-500">Office:</span> {activeThread.participant.office}</div>
                <div><span className="text-slate-500">Manager:</span> {activeThread.participant.manager || "—"}</div>
                <div><span className="text-slate-500">Email:</span> {activeThread.participant.email || "—"}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-300">
              Use the channel list on the left to broadcast updates to everyone or switch to a direct employee thread.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
