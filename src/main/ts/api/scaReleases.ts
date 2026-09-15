import { ScaRelease } from '../types/dependency';
import { RateLimiter } from '../utils/rateLimiter';

/**
 * Global throttle for GET api/v2/sca/releases — shared by every scope fetched
 * concurrently across a search, so total dispatch rate to the server stays
 * bounded regardless of how many branches/projects/PRs are fanned out.
 * Initial cap: 10 req/s (admin-configurable — see api/pluginSettings.ts).
 */
export const DEFAULT_THROTTLE_RPS = 10;
export const scaReleasesRateLimiter = new RateLimiter(DEFAULT_THROTTLE_RPS);

/**
 * Rows fetched per network request. This is a pure network-chunking detail, unrelated
 * to how many rows the results table shows or paginates — confirmed server-side hard
 * cap, not admin-configurable: api/v2/sca/releases rejects pageSize > 500 with HTTP 400
 * ("must be less than or equal to 500"). Always send the max to minimize request count.
 */
export const FETCH_PAGE_SIZE = 500;

export interface ScaReleasesQuery {
  projectKey: string;
  branchKey?: string;
  pullRequestKey?: string;
}

interface ReleasesPageResponse {
  releases?: ScaRelease[];
  page?: { pageIndex: number; pageSize: number; total: number };
}

async function fetchScaReleasesPage(
  query: ScaReleasesQuery,
  pageIndex: number
): Promise<{ releases: ScaRelease[]; pageIndex: number; pageSize: number; total: number }> {
  const params = new URLSearchParams({
    projectKey: query.projectKey,
    pageIndex: String(pageIndex),
    pageSize: String(FETCH_PAGE_SIZE),
  });
  if (query.branchKey) params.set('branchKey', query.branchKey);
  if (query.pullRequestKey) params.set('pullRequestKey', query.pullRequestKey);

  const res = await scaReleasesRateLimiter.schedule(() =>
    fetch(`/api/v2/sca/releases?${params}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`api/v2/sca/releases failed: HTTP ${res.status}${text ? ' — ' + text : ''}`);
  }

  const raw = (await res.json()) as ReleasesPageResponse;
  const releases = raw.releases ?? [];
  const page = raw.page ?? { pageIndex, pageSize: FETCH_PAGE_SIZE, total: releases.length };
  return { releases, pageIndex: page.pageIndex, pageSize: page.pageSize, total: page.total };
}

/**
 * Fetches every page for a single project/branch/PR scope. Pages within one scope
 * are inherently sequential (page N+1 needs page N's total) — the rate limiter is
 * what bounds *overall* request rate when many scopes are fetched in parallel.
 * Pass an `abortSignal` so a superseded search (new query/scope) stops paging early
 * instead of burning throttled request slots on results nobody will see.
 *
 * `onPage` fires as soon as each page arrives, before pagination finishes — callers
 * that want the landing view to render immediately (rather than block on the whole
 * inventory) should push rows to the UI from here instead of waiting on the resolved
 * array below.
 */
export async function fetchAllScaReleases(
  query: ScaReleasesQuery,
  abortSignal?: { aborted: boolean },
  onPage?: (releases: ScaRelease[]) => void
): Promise<ScaRelease[]> {
  const all: ScaRelease[] = [];
  let pageIndex = 1;
  while (true) {
    if (abortSignal?.aborted) return all;
    const page = await fetchScaReleasesPage(query, pageIndex);
    all.push(...page.releases);
    onPage?.(page.releases);
    if (page.releases.length === 0 || pageIndex * page.pageSize >= page.total) break;
    pageIndex++;
  }
  return all;
}
