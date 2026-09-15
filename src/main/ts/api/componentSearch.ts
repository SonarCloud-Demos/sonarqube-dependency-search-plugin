export interface ComponentSummary {
  key: string;
  name: string;
  qualifier: string;
}

/** Backs the global-page project/app/portfolio picker. */
export async function searchComponents(query: string): Promise<ComponentSummary[]> {
  const params = new URLSearchParams({
    qualifiers: 'TRK,APP,VW,SVW',
    ps: '20',
  });
  if (query.trim()) params.set('q', query.trim());

  const res = await fetch(`/api/components/search?${params}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`api/components/search failed: HTTP ${res.status}${text ? ' — ' + text : ''}`);
  }
  const data = (await res.json()) as { components: ComponentSummary[] };
  return data.components ?? [];
}
