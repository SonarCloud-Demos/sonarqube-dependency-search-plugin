import { SearchScope } from '../types/dependency';
import { concurrentMap } from '../utils/concurrentMap';
import { fetchAllBranches } from './projectBranches';
import { fetchPullRequests } from './projectPullRequests';

export interface Component {
  key: string;
  name: string;
  qualifier?: string;
}

export interface BranchLike {
  name: string;
  isMain?: boolean;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${url} failed: HTTP ${res.status}${text ? ' — ' + text : ''}`);
  }
  return res.json();
}

async function resolveApplication(key: string, branch?: string): Promise<SearchScope[]> {
  const qs = new URLSearchParams({ application: key });
  if (branch) qs.set('branch', branch);
  const data = (await fetchJson(`/api/applications/show?${qs}`)) as {
    application: {
      projects: Array<{ key: string; name: string; branch: string; accessible?: boolean }>;
    };
  };
  return data.application.projects
    .filter((p) => p.accessible !== false)
    .map((p) => ({
      projectKey: p.key,
      projectName: p.name,
      branchKey: p.branch,
      label: p.branch,
    }));
}

interface ProjectStub {
  projectKey: string;
  projectName: string;
}

// api/views/projects only returns manually-selected projects at the top level,
// missing sub-portfolio members and rule-based selections.
// api/measures/component_tree with strategy=leaves&qualifiers=TRK returns all
// leaf projects across the full portfolio hierarchy, requires only Browse permission.
async function resolvePortfolioLeafStubs(key: string): Promise<ProjectStub[]> {
  const stubs: ProjectStub[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ component: key, strategy: 'leaves', qualifiers: 'TRK', metricKeys: 'ncloc', ps: '500', p: String(page) });
    const data = (await fetchJson(`/api/measures/component_tree?${qs}`)) as {
      paging: { total: number; pageIndex: number; pageSize: number };
      components: Array<{ key: string; refKey?: string; name: string; qualifier: string }>;
    };
    for (const c of data.components) {
      stubs.push({ projectKey: c.refKey ?? c.key, projectName: c.name });
    }
    if (page * data.paging.pageSize >= data.paging.total) break;
    page++;
  }
  return stubs;
}

// Deliberately doesn't look up each leaf's actual main-branch name (that was an extra,
// unthrottled request per project — a real bottleneck at project counts in the thousands).
// Omitting branchKey and trusting api/v2/sca/releases to default to the main branch, the
// way most other SonarQube v2 endpoints do. Unconfirmed against a live instance for this
// specific endpoint — worth checking if results look wrong for non-"main"-named branches.
function targetedScopeOf(stub: ProjectStub): SearchScope {
  return { projectKey: stub.projectKey, projectName: stub.projectName, label: 'main' };
}

async function resolvePortfolio(key: string): Promise<SearchScope[]> {
  const stubs = await resolvePortfolioLeafStubs(key);
  return stubs.map(targetedScopeOf);
}

/** One cheap call (ps=1, reads only `paging.total`) to size up a portfolio before
 * committing to a full resolution + fetch — backs the pre-run duration estimate. */
export async function fetchPortfolioLeafCount(key: string): Promise<number> {
  const qs = new URLSearchParams({ component: key, strategy: 'leaves', qualifiers: 'TRK', metricKeys: 'ncloc', ps: '1', p: '1' });
  const data = (await fetchJson(`/api/measures/component_tree?${qs}`)) as { paging: { total: number } };
  return data.paging.total;
}

/** Same idea for the global page's implicit "every project" scope. */
export async function fetchAllProjectsCount(): Promise<number> {
  const qs = new URLSearchParams({ qualifiers: 'TRK', ps: '1', p: '1' });
  const data = (await fetchJson(`/api/components/search?${qs}`)) as { paging: { total: number } };
  return data.paging.total;
}

// api/components/search paginated over every TRK project the user can browse — the
// implicit "portfolio" backing the global page's default (no project picked) search.
async function fetchAllVisibleProjectStubs(): Promise<ProjectStub[]> {
  const stubs: ProjectStub[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ qualifiers: 'TRK', ps: '500', p: String(page) });
    const data = (await fetchJson(`/api/components/search?${qs}`)) as {
      paging: { total: number; pageIndex: number; pageSize: number };
      components: Array<{ key: string; name: string }>;
    };
    for (const c of data.components) {
      stubs.push({ projectKey: c.key, projectName: c.name });
    }
    if (page * data.paging.pageSize >= data.paging.total) break;
    page++;
  }
  return stubs;
}

/** Every project the user can browse, on its main branch — the true instance-wide
 * search from the global page when no project/app/portfolio has been picked. */
export async function resolveAllProjectsScopes(): Promise<SearchScope[]> {
  const stubs = await fetchAllVisibleProjectStubs();
  return stubs.map(targetedScopeOf);
}

export async function resolveAllProjectsAllBranchesAndPullRequests(): Promise<SearchScope[]> {
  const stubs = await fetchAllVisibleProjectStubs();
  const perProject = await concurrentMap(stubs, 5, (s) =>
    expandProjectToAllBranchesAndPullRequests(s.projectKey, s.projectName)
  );
  return perProject.flat();
}

async function expandProjectToAllBranchesAndPullRequests(projectKey: string, projectName: string): Promise<SearchScope[]> {
  const [branches, prs] = await Promise.all([
    fetchAllBranches(projectKey),
    fetchPullRequests(projectKey),
  ]);
  const branchScopes: SearchScope[] = branches.map((b) => ({
    projectKey, projectName, branchKey: b.name, label: b.name,
  }));
  const prScopes: SearchScope[] = prs.map((pr) => ({
    projectKey, projectName, pullRequestKey: pr.key, label: `PR #${pr.key}${pr.title ? ' — ' + pr.title : ''}`,
  }));
  return [...branchScopes, ...prScopes];
}

/** Resolve the scope(s) implied by the currently selected/targeted branch — the default. */
export async function resolveTargetedScopes(component: Component, branchLike?: BranchLike): Promise<SearchScope[]> {
  const qualifier = component.qualifier ?? 'TRK';
  if (qualifier === 'APP') {
    return resolveApplication(component.key, branchLike?.name);
  }
  if (qualifier === 'VW' || qualifier === 'SVW') {
    return resolvePortfolio(component.key);
  }
  return [{
    projectKey: component.key,
    projectName: component.name,
    branchKey: branchLike?.name,
    label: branchLike?.name ?? 'main',
  }];
}

/**
 * Expand to every branch and pull request. For a project: its own branches + PRs.
 * For an application: every app branch, each resolved to its member project/branch
 * pairs (app branches don't have their own PR concept). For a portfolio: every leaf
 * project's own branches + PRs, deduplicated by the caller once fetched.
 */
export async function resolveAllBranchesAndPullRequests(component: Component): Promise<SearchScope[]> {
  const qualifier = component.qualifier ?? 'TRK';

  if (qualifier === 'TRK') {
    return expandProjectToAllBranchesAndPullRequests(component.key, component.name);
  }

  if (qualifier === 'APP') {
    const appBranches = await fetchAllBranches(component.key);
    const perBranch = await concurrentMap(appBranches, 5, (b) => resolveApplication(component.key, b.name));
    return perBranch.flatMap((scopes, i) =>
      scopes.map((s) => ({ ...s, label: `${appBranches[i].name} › ${s.label}` }))
    );
  }

  if (qualifier === 'VW' || qualifier === 'SVW') {
    const stubs = await resolvePortfolioLeafStubs(component.key);
    const perProject = await concurrentMap(stubs, 5, (s) =>
      expandProjectToAllBranchesAndPullRequests(s.projectKey, s.projectName)
    );
    return perProject.flat();
  }

  return resolveTargetedScopes(component);
}
