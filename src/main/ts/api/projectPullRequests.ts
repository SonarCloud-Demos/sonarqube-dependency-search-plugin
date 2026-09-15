export interface PullRequestInfo {
  key: string;
  title?: string;
  branch: string;
  base: string;
}

export async function fetchPullRequests(projectKey: string): Promise<PullRequestInfo[]> {
  const res = await fetch(
    `/api/project_pull_requests/list?project=${encodeURIComponent(projectKey)}`,
    { credentials: 'same-origin' }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `api/project_pull_requests/list failed: HTTP ${res.status}${text ? ' — ' + text : ''}`
    );
  }
  const data = (await res.json()) as { pullRequests: PullRequestInfo[] };
  return data.pullRequests ?? [];
}
