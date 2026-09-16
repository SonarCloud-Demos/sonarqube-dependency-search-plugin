import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_THROTTLE_RPS, fetchAllScaReleases } from '../api/scaReleases';
import { DEFAULT_FILTER_DROPDOWN_THRESHOLD, DEFAULT_RESULTS_PAGE_SIZE, syncPluginSettings } from '../api/pluginSettings';
import {
  Component,
  BranchLike,
  fetchAllProjectsCount,
  fetchPortfolioLeafCount,
  resolveAllBranchesAndPullRequests,
  resolveAllProjectsAllBranchesAndPullRequests,
  resolveAllProjectsScopes,
  resolveTargetedScopes,
} from '../api/scopeResolver';
import { ComponentSummary } from '../api/componentSearch';
import {
  ColumnFilters,
  EMPTY_COLUMN_FILTERS,
  SearchScope,
  SortDir,
  SortField,
  TaggedRelease,
  scopeCacheKey,
  upsertDedupedRelease,
} from '../types/dependency';
import { concurrentMap } from '../utils/concurrentMap';
import { DependencySearchResultsTable } from './DependencySearchResultsTable';
import { ProjectPicker } from './ProjectPicker';
import { Disclaimer } from './shared/Disclaimer';

const MAX_CONCURRENT_SCOPES = 20;
const DEFAULT_AVG_BRANCHES_AND_PRS = 5;

/** Sentinel component representing "every project instance-wide" — the global page's
 * implicit target when no project/app/portfolio has been picked to narrow to. */
const ALL_PROJECTS_COMPONENT: Component = { key: '__all_projects__', name: 'All projects', qualifier: 'ALL' };

interface DependencySearchPanelProps {
  /** 'component' — embedded in a project/app/portfolio tab, component is fixed.
   *  'global' — the top-level page under "More"; searches every project by default,
   *  with an optional picker to narrow to one project/app/portfolio instead. */
  mode: 'component' | 'global';
  component?: Component;
  branchLike?: BranchLike;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `~${(seconds / 60).toFixed(1)} min`;
  return `~${(seconds / 3600).toFixed(1)} h`;
}

export function DependencySearchPanel({ mode, component: fixedComponent, branchLike }: Readonly<DependencySearchPanelProps>) {
  const [pickedComponent, setPickedComponent] = useState<Component | null>(null);
  const activeComponent = mode === 'component'
    ? (fixedComponent ?? null)
    : (pickedComponent ?? ALL_PROJECTS_COMPONENT);

  const [allBranchesMode, setAllBranchesMode] = useState(false);

  // Portfolios and the true instance-wide search fan out to many projects at once —
  // both require an explicit "run" approval, with an upfront duration estimate, before
  // any resolution/fetch happens. Projects and applications are bounded to one
  // component and never need this.
  const needsRunApproval =
    activeComponent?.qualifier === 'VW' || activeComponent?.qualifier === 'SVW' || activeComponent?.qualifier === 'ALL';
  const [runApproved, setRunApproved] = useState(false);
  const [avgBranchesAndPRs, setAvgBranchesAndPRs] = useState(DEFAULT_AVG_BRANCHES_AND_PRS);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [projectCountLoading, setProjectCountLoading] = useState(false);
  const [projectCountError, setProjectCountError] = useState<string | null>(null);

  const [scopes, setScopes] = useState<SearchScope[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesError, setScopesError] = useState<string | null>(null);

  // Streamed in page-by-page as each scope's requests land — the landing view should
  // render the first page as soon as it arrives rather than block on the full inventory.
  const [baseReleases, setBaseReleases] = useState<TaggedRelease[]>([]);
  const [scopesInFlight, setScopesInFlight] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const genRef = useRef(0);
  const [throttleRps, setThrottleRps] = useState(DEFAULT_THROTTLE_RPS);
  const [resultsPageSize, setResultsPageSize] = useState(DEFAULT_RESULTS_PAGE_SIZE);
  const [filterDropdownThreshold, setFilterDropdownThreshold] = useState(DEFAULT_FILTER_DROPDOWN_THRESHOLD);

  // null = not checked yet (render nothing that could imply an answer either way),
  // false = administrator disabled the plugin — show a notice and make no other calls.
  const [pluginEnabled, setPluginEnabled] = useState<boolean | null>(null);

  // Completed scope fetches, keyed by project+branch/PR — persists across scope-set
  // changes so toggling "all branches" reuses the already-loaded main branch instead
  // of refetching everything from scratch. Cleared only when the target itself changes.
  const scopeCacheRef = useRef<Map<string, TaggedRelease[]>>(new Map());

  // Filter/sort state lives here (not in the table) so it survives the table
  // being briefly unmounted while scopes re-resolve. Kept as the raw (undebounced)
  // value — the table debounces its own derived copy for the filtering computation,
  // but the input itself must stay instant, or typing would feel laggy.
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [sortBy, setSortBy] = useState<SortField>('packageName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleFilterChange(field: keyof ColumnFilters, value: string) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function handleSortChange(field: SortField) {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir('asc'); }
  }

  // Pull all admin-configured settings once per page load, before any other fetch —
  // whether the plugin is enabled at all, the throttle (reflected in the duration
  // estimate below, not a hardcoded guess), and the results table's page size.
  useEffect(() => {
    syncPluginSettings().then(({ enabled, throttleRps: rps, resultsPageSize: size, filterDropdownThreshold: threshold }) => {
      setPluginEnabled(enabled);
      setThrottleRps(rps);
      setResultsPageSize(size);
      setFilterDropdownThreshold(threshold);
    });
  }, []);

  // Reset all target-scoped state whenever the target itself changes — but NOT when
  // just the all-branches toggle changes, so switching that on/off reuses cached
  // scopes and keeps whatever filters/sort the user already had.
  useEffect(() => {
    setAllBranchesMode(false);
    setRunApproved(false);
    setAvgBranchesAndPRs(DEFAULT_AVG_BRANCHES_AND_PRS);
    setProjectCount(null);
    setProjectCountError(null);
    setFilters(EMPTY_COLUMN_FILTERS);
    scopeCacheRef.current = new Map();
  }, [activeComponent?.key, activeComponent?.qualifier]);

  // Size up the scope with one cheap (paging-total-only) call, to back the run-approval estimate.
  useEffect(() => {
    if (!activeComponent || !needsRunApproval || runApproved || pluginEnabled !== true) return;
    let cancelled = false;
    setProjectCountLoading(true);
    setProjectCountError(null);
    const p = activeComponent.qualifier === 'ALL'
      ? fetchAllProjectsCount()
      : fetchPortfolioLeafCount(activeComponent.key);
    p.then((n) => { if (!cancelled) setProjectCount(n); })
      .catch((e: unknown) => { if (!cancelled) setProjectCountError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setProjectCountLoading(false); });
    return () => { cancelled = true; };
  }, [activeComponent, needsRunApproval, runApproved, pluginEnabled]);

  // Resolve scopes whenever the target (component/branch) or the branch toggle changes —
  // gated behind run approval for portfolios/instance-wide search, and behind the
  // plugin being enabled at all (no API calls whatsoever when disabled).
  useEffect(() => {
    if (!activeComponent || (needsRunApproval && !runApproved) || pluginEnabled !== true) {
      setScopes([]);
      return;
    }
    let cancelled = false;
    setScopesLoading(true);
    setScopesError(null);
    const isAllProjects = activeComponent.qualifier === 'ALL';
    let resolver;
    if (isAllProjects && allBranchesMode) resolver = resolveAllProjectsAllBranchesAndPullRequests();
    else if (isAllProjects) resolver = resolveAllProjectsScopes();
    else if (allBranchesMode) resolver = resolveAllBranchesAndPullRequests(activeComponent);
    else resolver = resolveTargetedScopes(activeComponent, branchLike);
    resolver
      .then((s) => { if (!cancelled) setScopes(s); })
      .catch((e: unknown) => { if (!cancelled) setScopesError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setScopesLoading(false); });
    return () => { cancelled = true; };
  }, [activeComponent, branchLike, allBranchesMode, needsRunApproval, runApproved, pluginEnabled]);

  // Stream the dependency inventory for the resolved scopes — this is the landing view
  // (same idea as the native "Dependencies" tab). Every page is pushed into state as
  // soon as it arrives so the table — and the running count top-right — fill in live
  // instead of waiting for every scope/page to finish. Per-column filtering/sorting
  // happens inside the results table, over this same streamed list.
  //
  // Scopes already fully fetched (scopeCacheRef) are reused as-is — toggling "all
  // branches" on a scope that already has its main branch loaded only fetches the
  // *new* branches/PRs, not the whole thing over again.
  useEffect(() => {
    if (scopes.length === 0) {
      setBaseReleases([]);
      setScopesInFlight(0);
      return;
    }

    const gen = ++genRef.current;
    const abortSignal = { aborted: false };
    setFetchError(null);

    // Pages still streaming in for this effect run — kept separate from the
    // persistent cache until a scope's fetch completes cleanly, so an aborted or
    // failed fetch never poisons the cache with a partial result.
    const inProgress = new Map<string, TaggedRelease[]>();

    function currentDisplay(): TaggedRelease[] {
      const sources = scopes.map((s) => {
        const key = scopeCacheKey(s);
        return scopeCacheRef.current.get(key) ?? inProgress.get(key) ?? [];
      });
      if (!allBranchesMode) return sources.flat();
      const map = new Map<string, TaggedRelease>();
      for (const list of sources) for (const item of list) upsertDedupedRelease(map, item);
      return [...map.values()];
    }

    // Show whatever's already cached immediately — e.g. the main branch's data
    // reappears instantly when toggling "all branches" back on.
    setBaseReleases(currentDisplay());

    const scopesToFetch = scopes.filter((s) => !scopeCacheRef.current.has(scopeCacheKey(s)));
    setScopesInFlight(scopesToFetch.length);
    if (scopesToFetch.length === 0) return;

    const concurrency = Math.min(scopesToFetch.length, MAX_CONCURRENT_SCOPES);
    concurrentMap(scopesToFetch, concurrency, async (scope) => {
      const key = scopeCacheKey(scope);
      try {
        const releases = await fetchAllScaReleases(
          { projectKey: scope.projectKey, branchKey: scope.branchKey, pullRequestKey: scope.pullRequestKey },
          abortSignal,
          (page) => {
            if (genRef.current !== gen) return;
            const tagged = page.map((r): TaggedRelease => ({
              ...r, projectKey: scope.projectKey, projectName: scope.projectName, scopeLabels: [scope.label],
            }));
            inProgress.set(key, [...(inProgress.get(key) ?? []), ...tagged]);
            setBaseReleases(currentDisplay());
          }
        );
        if (!abortSignal.aborted && genRef.current === gen) {
          scopeCacheRef.current.set(key, releases.map((r): TaggedRelease => ({
            ...r, projectKey: scope.projectKey, projectName: scope.projectName, scopeLabels: [scope.label],
          })));
        }
      } finally {
        if (genRef.current === gen) setScopesInFlight((n) => n - 1);
      }
    }).catch((e: unknown) => {
      if (genRef.current === gen) setFetchError(errorMessage(e));
    });

    return () => { abortSignal.aborted = true; };
  }, [scopes, allBranchesMode]);

  function handlePickComponent(c: ComponentSummary) {
    setPickedComponent({ key: c.key, name: c.name, qualifier: c.qualifier });
  }

  const isMultiProject = (activeComponent?.qualifier ?? 'TRK') !== 'TRK';
  const isFetching = scopesInFlight > 0;

  let estimatedRequests: number | null = null;
  if (projectCount !== null) estimatedRequests = allBranchesMode ? projectCount * avgBranchesAndPRs : projectCount;
  const estimatedSeconds = estimatedRequests === null ? null : estimatedRequests / throttleRps;

  if (pluginEnabled === false) {
    return (
      <div style={{ padding: '16px 24px', fontFamily: 'sans-serif' }}>
        <Disclaimer />
        <h2 style={{ margin: '0 0 12px', fontSize: '18px', fontWeight: 700 }}>Dependency Search</h2>
        <div style={{ padding: '12px 16px', background: '#f3f4f4', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#555', fontSize: '13px', maxWidth: '480px' }}>
          Dependency Search has been disabled by your administrator.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px', fontFamily: 'sans-serif' }}>
      <Disclaimer />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Dependency Search</h2>
        {activeComponent && scopes.length > 0 && (
          <div style={{ fontSize: '13px', color: '#444', whiteSpace: 'nowrap' }}>
            <strong style={{ fontSize: '16px' }}>{baseReleases.length.toLocaleString()}</strong>{' '}
            dependenc{baseReleases.length === 1 ? 'y' : 'ies'}
            {isFetching && <span style={{ marginLeft: '6px', color: '#2563eb' }}>loading...</span>}
          </div>
        )}
      </div>

      {isMultiProject && (
        <div style={{ marginBottom: '12px', fontSize: '12px', color: '#555', background: '#f3f4f4', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '8px 12px', maxWidth: '640px' }}>
          Results respect your project permissions. Dependencies of projects you don't have access to stay hidden and unsearchable here.
        </div>
      )}

      {mode === 'global' && pickedComponent && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#444' }}>
          Searching <strong>{pickedComponent.name}</strong>{' '}
          <button
            onClick={() => setPickedComponent(null)}
            style={{ marginLeft: '8px', fontSize: '12px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            change
          </button>
        </div>
      )}

      {needsRunApproval && !runApproved && (
        <div style={{ marginBottom: '16px', maxWidth: '560px' }}>
          <div style={{ fontSize: '13px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', padding: '12px 14px', marginBottom: '12px' }}>
            <p style={{ margin: '0 0 10px' }}>
              {activeComponent?.qualifier === 'ALL'
                ? 'This searches every project you can access, instance-wide.'
                : 'This searches every project in this portfolio.'}
              {' '}Every project needs at least one request. Approve the estimate below before it runs.
            </p>

            {projectCountLoading && <p style={{ margin: '0 0 8px', fontSize: '12px' }}>Counting projects...</p>}
            {projectCountError && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#dc2626' }}>Failed to count projects: {projectCountError}</p>}

            {projectCount !== null && (
              <>
                <p style={{ margin: '0 0 10px' }}>
                  <strong>{projectCount.toLocaleString()}</strong> project{projectCount === 1 ? '' : 's'} in scope.
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginBottom: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={allBranchesMode} onChange={(e) => setAllBranchesMode(e.target.checked)} />
                  {' '}Include all branches &amp; pull requests (not just each project's main branch)
                </label>

                {allBranchesMode && (
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                      Assumed average branches + PRs per project: <strong>{avgBranchesAndPRs}</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={avgBranchesAndPRs}
                      onChange={(e) => setAvgBranchesAndPRs(Number(e.target.value))}
                      style={{ width: '240px' }}
                    />
                  </div>
                )}

                {estimatedRequests !== null && estimatedSeconds !== null && (
                  <p style={{ margin: '0 0 10px', fontSize: '12px' }}>
                    Estimated <strong>{estimatedRequests.toLocaleString()}</strong> requests at {throttleRps}/s
                    (<a href="/admin/settings?category=Dependency+Search" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>admin-configurable</a>): <strong>{formatDuration(estimatedSeconds)}</strong>.
                  </p>
                )}

                <button
                  onClick={() => setRunApproved(true)}
                  style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '4px', border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
                >
                  Run search
                </button>
              </>
            )}
          </div>

          {mode === 'global' && !pickedComponent && (
            <>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>Or narrow to one project, application, or portfolio:</div>
              <ProjectPicker onSelect={handlePickComponent} />
            </>
          )}
        </div>
      )}

      {needsRunApproval && runApproved && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#444' }}>
          {activeComponent?.qualifier === 'ALL' ? 'Searching all projects' : 'Searching this portfolio'}
          {allBranchesMode ? ' · all branches & pull requests' : ' · main branch'}{' '}
          <button
            onClick={() => setRunApproved(false)}
            style={{ marginLeft: '8px', fontSize: '12px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            change settings
          </button>
        </div>
      )}

      {activeComponent && !needsRunApproval && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#444', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allBranchesMode}
              onChange={(e) => setAllBranchesMode(e.target.checked)}
            />
            {' '}Search all branches &amp; pull requests
          </label>
          {!allBranchesMode && isMultiProject && (
            <span style={{ fontSize: '12px', color: '#888' }}>Uses each project's main branch</span>
          )}
          {!scopesLoading && scopes.length > 0 && (
            <span style={{ fontSize: '12px', color: '#888' }}>
              across {scopes.length} {scopes.length === 1 ? 'branch' : 'branches/PRs'}
            </span>
          )}
        </div>
      )}

      {(!needsRunApproval || runApproved) && (
        <>
          {scopesError && (
            <div style={{ marginBottom: '10px', fontSize: '12px', color: '#dc2626' }}>Failed to resolve search scope: {scopesError}</div>
          )}

          {fetchError && (
            <div style={{ marginBottom: '10px', padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', color: '#dc2626', fontSize: '13px' }}>
              <strong>Error:</strong> {fetchError}
            </div>
          )}

          {scopesLoading && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#666', fontSize: '13px' }}>Resolving scope...</div>
          )}

          {!scopesLoading && scopes.length > 0 && (
            <DependencySearchResultsTable
              items={baseReleases}
              showProjectColumn={isMultiProject}
              showScopeColumn={allBranchesMode || isMultiProject}
              filters={filters}
              onFilterChange={handleFilterChange}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={handleSortChange}
              pageSize={resultsPageSize}
              filterDropdownThreshold={filterDropdownThreshold}
            />
          )}
        </>
      )}
    </div>
  );
}
