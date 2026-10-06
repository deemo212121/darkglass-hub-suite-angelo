/**
 * What a list shows when there's nothing in it: an icon, one line saying
 * what's (not) here, an optional hint, and an optional next step.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-12"}`}>
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-foreground)_6%,transparent)] text-[var(--color-muted-foreground)] [&_svg]:h-5 [&_svg]:w-5">
        {icon ?? <Inbox />}
      </div>
      <p className="text-sm font-semibold text-[var(--color-foreground)]">{title}</p>
      {hint && <p className="max-w-md text-[13px] text-[var(--color-muted-foreground)]">{hint}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
