import { scaReleasesRateLimiter } from './scaReleases';

const ENABLED_SETTING_KEY = 'dependencysearch.enabled';
const THROTTLE_SETTING_KEY = 'dependencysearch.throttle.rps';
const RESULTS_PAGE_SIZE_SETTING_KEY = 'dependencysearch.pageSize';

/**
 * Rows shown per page in the results table — an admin-configurable UX setting,
 * deliberately unrelated to FETCH_PAGE_SIZE (the network-chunking constant, fixed
 * at the server's hard cap of 500). This one just controls how much of the
 * already-fetched, already-filtered/sorted list the table paginates through at once.
 */
export const DEFAULT_RESULTS_PAGE_SIZE = 1000;

/**
 * Pulls all admin-configured settings (Administration → Dependency Search) in one
 * request: whether the plugin is enabled at all, the request throttle (applied
 * directly to the shared rate limiter), and the results page size (returned for the
 * caller to pass into the table). Call once per page load, before doing anything else
 * — if `enabled` comes back false, the caller should render a disabled notice and
 * skip every other fetch, same as the description on the setting promises.
 *
 * Note: when the setting is off, the page/menu entry itself is normally already gone
 * (DependencySearchPageDefinition/DependencySearchGlobalPageDefinition don't register
 * it — see their Javadoc) — but that requires a SonarQube restart to take effect.
 * This check is what makes disabling effective *immediately*, in the gap before that
 * restart, and is defense-in-depth afterward.
 */
export async function syncPluginSettings(): Promise<{ enabled: boolean; throttleRps: number; resultsPageSize: number }> {
  let enabled = true;
  let resultsPageSize = DEFAULT_RESULTS_PAGE_SIZE;
  try {
    const res = await fetch(
      `/api/settings/values?keys=${ENABLED_SETTING_KEY},${THROTTLE_SETTING_KEY},${RESULTS_PAGE_SIZE_SETTING_KEY}`,
      { credentials: 'same-origin' }
    );
    if (res.ok) {
      const data = (await res.json()) as { settings?: Array<{ key: string; value?: string }> };
      const settings = data.settings ?? [];
      const enabledValue = settings.find((s) => s.key === ENABLED_SETTING_KEY)?.value;
      const throttle = Number(settings.find((s) => s.key === THROTTLE_SETTING_KEY)?.value);
      const size = Number(settings.find((s) => s.key === RESULTS_PAGE_SIZE_SETTING_KEY)?.value);
      if (enabledValue !== undefined) enabled = enabledValue !== 'false';
      if (Number.isFinite(throttle) && throttle > 0) scaReleasesRateLimiter.setRate(throttle);
      if (Number.isFinite(size) && size > 0) resultsPageSize = size;
    }
  } catch {
    // keep defaults (enabled)
  }
  return { enabled, throttleRps: scaReleasesRateLimiter.getRate(), resultsPageSize };
}
