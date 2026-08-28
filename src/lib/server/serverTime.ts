/**
 * Returns the server's own current instant — the untamperable anchor every
 * self-service time punch (Time In/Out, Meal In/Out in TimeClockMenu.tsx and
 * routes/timecard.tsx's day modal) is stamped against, so an employee who
 * changes their computer's clock can't back- or forward-date a punch. No
 * auth required — the server's own clock isn't sensitive, and requiring a
 * token here would just add a reason for the punch to fail. Client-side
 * counterpart: src/lib/serverTime.ts.
 */
export async function handleServerTimeRequest(): Promise<Response> {
  return new Response(JSON.stringify({ nowIso: new Date().toISOString() }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
