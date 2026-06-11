/**
 * Client-agnostic paginated fetch helper.
 *
 * PostgREST silently truncates single-request reads at the project's
 * `max_rows` cap (1000 by default). This helper issues sequential
 * `.range()` requests until a short page is returned, collecting all
 * rows across pages.
 *
 * Modelled after `pullSession` in `lib/sync/cloud.ts` (the canonical
 * existing paginator in this codebase).
 *
 * @param fetchPage  Callback that receives `(from, to)` inclusive row
 *                   indices and returns a PostgREST-style `{ data, error }`.
 * @param pageSize   Number of rows per page. Defaults to 1000 (the
 *                   PostgREST cap), so a single page of exactly 1000
 *                   triggers a follow-up request to confirm there are no
 *                   more rows.
 * @returns          All rows collected across pages, or `null` if any
 *                   page request errors.
 */

type FetchPage<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAllPages<T>(
  fetchPage: FetchPage<T>,
  pageSize = 1000,
): Promise<T[] | null> {
  const all: T[] = [];
  let offset = 0;
  try {
    while (true) {
      const { data, error } = await fetchPage(offset, offset + pageSize - 1);
      if (error || !data) return null;
      all.push(...data);
      // A page shorter than `pageSize` means we are on the last page.
      // Using `< pageSize` (not `=== 0`) avoids one extra round trip when
      // the corpus is an exact multiple of `pageSize`.
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  } catch {
    return null;
  }
}
