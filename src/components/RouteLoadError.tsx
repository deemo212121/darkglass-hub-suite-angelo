import { useEffect, useState, type ReactNode } from "react";
import { isStaleChunkError, reloadForNewVersion } from "@/lib/staleChunkReload";

/**
 * A route's error screen. When the error is a page file from before the
 * last deploy (lib/staleChunkReload.ts), it reloads to the new version and
 * says so instead of showing the error; otherwise — or if that reload
 * already happened — it shows `children`, the route's own error screen.
 */
export function RouteLoadError({ error, children }: { error: unknown; children: ReactNode }) {
  const stale = isStaleChunkError(error);
  const [updating, setUpdating] = useState(stale);
  useEffect(() => {
    if (stale && !reloadForNewVersion()) setUpdating(false);
  }, [stale]);
  if (updating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="panel text-center max-w-md">
          <h1 className="text-xl font-semibold">Updating to the latest version…</h1>
          <p className="text-sm text-muted-foreground mt-2">AHS was updated since this page was opened — reloading.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
