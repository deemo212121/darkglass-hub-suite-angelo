/**
 * Supabase (PostgREST) never returns more than 1000 rows per request — a
 * `.limit(5000)` is silently cut to 1000 with no error. This pages through
 * with `.range()` until a short page comes back, so a growing table never
 * quietly drops rows. `makeQuery` must build a FRESH query each call and
 * should be ordered (stable paging).
 */
export async function selectAllPages<T>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> },
  pageSize = 1000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}
