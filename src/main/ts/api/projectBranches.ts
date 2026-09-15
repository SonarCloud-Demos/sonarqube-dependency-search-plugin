export interface BranchInfo {
  name: string;
  isMain: boolean;
  excludedFromPurge?: boolean;
  type?: string;
}

/** Works for both projects (TRK) and applications (APP) — same underlying service. */
export async function fetchAllBranches(componentKey: string): Promise<BranchInfo[]> {
  const res = await fetch(
    `/api/project_branches/list?project=${encodeURIComponent(componentKey)}`,
    { credentials: 'same-origin' }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `api/project_branches/list failed: HTTP ${res.status}${text ? ' — ' + text : ''}`
    );
  }
  const data = (await res.json()) as { branches: BranchInfo[] };
  return data.branches ?? [];
}
