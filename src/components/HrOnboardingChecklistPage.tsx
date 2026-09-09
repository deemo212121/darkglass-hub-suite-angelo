/**
 * HR module -> To-Do List. The per-hire onboarding punch list
 * (employee_onboarding_tasks, migration 0220), seeded when User Management
 * creates an account. Lists every employee who still has open setup steps
 * and lets HR tick them off / add notes / clear a finished hire.
 *
 * Dispatched from m.$module.$submodule.tsx for custom === "hr-todo-list";
 * the route already renders <AppHeader /> and gates access to ADMIN / HR
 * (DASHBOARD_ROLE_GATES["todo-list"]).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ClipboardCheck, Loader2, ChevronDown, ExternalLink, X, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import {
  getOnboardingBoard,
  setOnboardingTaskStatus,
  setOnboardingTaskNote,
  dismissOnboarding,
  ONBOARDING_TASK_DEFS,
  type OnboardingBoardEntry,
  type OnboardingTaskStatus,
} from "@/lib/supabase/employeeOnboarding";

const TASK_DEF_BY_KEY = new Map(ONBOARDING_TASK_DEFS.map((d) => [d.key, d]));

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export function HrOnboardingChecklistPage() {
  const navigate = useNavigate();
  const { displayName, email } = useAuth();
  const actorName = displayName || email || "HR";

  const [board, setBoard] = useState<OnboardingBoardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ key: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getOnboardingBoard();
      setBoard(next);
      setExpanded((cur) => (cur && next.some((e) => e.profileId === cur) ? cur : next[0]?.profileId ?? null));
    } catch (err) {
      console.error("Onboarding board load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTask = async (profileId: string, taskKey: string, nextDone: boolean) => {
    const key = `${profileId}:${taskKey}`;
    setBusyKey(key);
    setBoard((prev) =>
      prev
        .map((e) =>
          e.profileId !== profileId
            ? e
            : {
                ...e,
                tasks: e.tasks.map((t) =>
                  t.taskKey === taskKey ? { ...t, status: (nextDone ? "done" : "open") as OnboardingTaskStatus } : t,
                ),
                openCount: e.openCount + (nextDone ? -1 : 1),
              },
        )
        .filter((e) => e.openCount > 0),
    );
    try {
      await setOnboardingTaskStatus(profileId, taskKey, nextDone ? "done" : "open", actorName);
      await load();
    } catch (err) {
      console.error("Onboarding task update failed:", err);
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const saveNote = async (profileId: string, taskKey: string, value: string) => {
    setNoteDraft(null);
    try {
      await setOnboardingTaskNote(profileId, taskKey, value);
      await load();
    } catch (err) {
      console.error("Onboarding note save failed:", err);
    }
  };

  const handleDismiss = async (profileId: string) => {
    if (!confirm("Clear this employee off the list? Any unchecked steps are marked not applicable.")) return;
    setBusyKey(`dismiss:${profileId}`);
    try {
      await dismissOnboarding(profileId, actorName);
      await load();
    } catch (err) {
      console.error("Onboarding dismiss failed:", err);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <ClipboardCheck className="h-5 w-5" /> To-Do List
          </h1>
          <p className="text-sm text-slate-400">New-hire setup — steps left after an account is created in User Management.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && board.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : board.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-6 py-16 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">Nothing pending.</p>
          <p className="mt-1 text-xs text-slate-500">New hires added in User Management show up here with their setup checklist.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {board.map((entry) => {
            const done = entry.totalCount - entry.openCount;
            const isOpen = expanded === entry.profileId;
            return (
              <div key={entry.profileId} className="rounded-xl border border-white/10 bg-slate-900/40">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : entry.profileId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{entry.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {getRoleDepartmentBreakdown(entry.roleLabel).roleLabel} · added {daysSince(entry.addedAt)}d ago
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-300">
                    {done}/{entry.totalCount}
                  </span>
                  <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/10 sm:block">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${entry.totalCount ? (done / entry.totalCount) * 100 : 0}%` }}
                    />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/10 px-4 py-3">
                    <ul className="space-y-2">
                      {entry.tasks.map((t) => {
                        const def = TASK_DEF_BY_KEY.get(t.taskKey);
                        const key = `${entry.profileId}:${t.taskKey}`;
                        const isDone = t.status === "done" || t.status === "na";
                        const editingNote = noteDraft?.key === key;
                        return (
                          <li key={t.taskKey} className="flex gap-2.5 text-sm">
                            <button
                              type="button"
                              disabled={busyKey === key}
                              onClick={() => toggleTask(entry.profileId, t.taskKey, !isDone)}
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                isDone ? "border-emerald-500 bg-emerald-500 text-slate-950" : "border-white/25 bg-transparent"
                              } disabled:opacity-40`}
                            >
                              {busyKey === key ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              ) : isDone ? (
                                <span className="text-[10px] font-bold leading-none">✓</span>
                              ) : null}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={isDone ? "text-slate-500 line-through" : "text-slate-200"}>
                                  {def?.label ?? t.taskKey}
                                </span>
                                {def?.link && (
                                  <Link
                                    to={def.link.to as any}
                                    params={(def.link.params ?? { employeeId: entry.profileId }) as any}
                                    className="inline-flex shrink-0 items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                                  >
                                    open <ExternalLink className="h-3 w-3" />
                                  </Link>
                                )}
                                {!editingNote && (
                                  <button
                                    type="button"
                                    onClick={() => setNoteDraft({ key, value: t.note ?? "" })}
                                    className="text-[11px] text-slate-500 hover:text-slate-300"
                                  >
                                    {t.note ? "edit note" : "+ note"}
                                  </button>
                                )}
                              </div>
                              {!isDone && def?.detail && (
                                <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{def.detail}</p>
                              )}
                              {editingNote ? (
                                <input
                                  autoFocus
                                  defaultValue={noteDraft?.value}
                                  onBlur={(e) => saveNote(entry.profileId, t.taskKey, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setNoteDraft(null);
                                  }}
                                  placeholder="Note…"
                                  className="mt-1 w-full rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                                />
                              ) : (
                                t.note && <p className="mt-0.5 text-[11px] text-amber-300/80">{t.note}</p>
                              )}
                              {isDone && t.doneByName && (
                                <p className="mt-0.5 text-[10px] text-slate-600">by {t.doneByName}</p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      disabled={busyKey === `dismiss:${entry.profileId}`}
                      onClick={() => handleDismiss(entry.profileId)}
                      className="mt-3 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-300 disabled:opacity-40"
                    >
                      <X className="h-3 w-3" /> Clear from list
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
