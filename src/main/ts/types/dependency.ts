/** One entry from GET api/v2/sca/releases — the SCA dependency inventory, not the
 * vulnerability/issue-centric api/v2/sca/issues-releases endpoint. */
export interface ScaRelease {
  key: string;
  branchUuid?: string;
  packageUrl?: string;
  packageManager?: string;
  packageName?: string;
  version?: string;
  licenseExpression?: string;
  declaredLicenseExpression?: string;
  knownPackage?: boolean;
  directSummary?: boolean;
  scopeSummary?: string;
  dependencyFilePaths?: string[];
}

/** A release tagged with where it was found, for display in multi-scope result sets.
 * `scopeLabels` has more than one entry once "all branches" dedup merges the same
 * release found on several branches/PRs of the same project into a single row. */
export interface TaggedRelease extends ScaRelease {
  projectKey: string;
  projectName: string;
  scopeLabels: string[];
}

/** One project/branch or project/pull-request pair to run a dependency search against. */
export interface SearchScope {
  projectKey: string;
  projectName: string;
  branchKey?: string;
  pullRequestKey?: string;
  label: string;
}

/** Stable key identifying a scope's fetched data, independent of how it's labeled —
 * used to cache completed fetches so re-resolving scopes (e.g. toggling "all branches")
 * doesn't refetch a branch/PR that's already loaded. */
export function scopeCacheKey(s: SearchScope): string {
  return `${s.projectKey}::${s.branchKey ?? ''}::${s.pullRequestKey ?? ''}`;
}

export type SortField = 'packageName' | 'version' | 'licenseExpression' | 'projectName' | 'scopeLabels' | 'packageManager' | 'scopeSummary';
export type SortDir = 'asc' | 'desc';

export interface ColumnFilters {
  projectName: string;
  scopeLabels: string;
  packageName: string;
  version: string;
  packageManager: string;
  licenseExpression: string;
  scopeSummary: string;
}

export const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  projectName: '', scopeLabels: '', packageName: '', version: '', packageManager: '', licenseExpression: '', scopeSummary: '',
};

function releaseDedupeKey(item: TaggedRelease): string {
  return [
    item.projectKey,
    item.packageUrl ?? item.packageName ?? '',
    item.version ?? '',
    item.licenseExpression ?? '',
  ].join('::');
}

/** Merges one release into a dedupe map in place — same project/package/version/license
 * found on a different branch or PR gets its scope label unioned into the existing row
 * instead of appearing twice. Used incrementally as pages stream in ("all branches" mode);
 * the targeted-branch landing view has at most one scope per project, so this is a no-op
 * there but still cheap to run unconditionally. */
export function upsertDedupedRelease(map: Map<string, TaggedRelease>, item: TaggedRelease): void {
  const key = releaseDedupeKey(item);
  const existing = map.get(key);
  if (existing) {
    existing.scopeLabels = [...new Set([...existing.scopeLabels, ...item.scopeLabels])];
    existing.directSummary = existing.directSummary || item.directSummary;
  } else {
    map.set(key, { ...item, scopeLabels: [...item.scopeLabels] });
  }
}

export function packageManagerOf(packageUrl?: string): string {
  if (!packageUrl) return '—';
  const m = /^pkg:([^/]+)\//.exec(packageUrl);
  return m ? m[1].toUpperCase() : '—';
}

export function packageNameOf(packageUrl?: string): string {
  if (!packageUrl) return '—';
  return decodeURIComponent(packageUrl.replace(/^pkg:[^/]+\//, ''));
}

export function releaseDetailUrl(release: ScaRelease, projectKey: string): string | undefined {
  if (!release.key) return undefined;
  return `/dependencies/${encodeURIComponent(release.key)}?id=${encodeURIComponent(projectKey)}`;
}
