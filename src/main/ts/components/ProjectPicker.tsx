import React, { useEffect, useState } from 'react';
import { ComponentSummary, searchComponents } from '../api/componentSearch';

const QUALIFIER_LABELS: Record<string, string> = {
  TRK: 'Project',
  APP: 'Application',
  VW: 'Portfolio',
  SVW: 'Sub-portfolio',
};

interface ProjectPickerProps {
  onSelect: (component: ComponentSummary) => void;
}

export function ProjectPicker({ onSelect }: Readonly<ProjectPickerProps>) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchComponents(debounced)
      .then((r) => { if (!cancelled) setResults(r); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  return (
    <div style={{ maxWidth: '480px' }}>
      <label htmlFor="dependencysearch-project-picker" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#333' }}>
        Project, application, or portfolio
      </label>
      <input
        id="dependencysearch-project-picker"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing a name…"
        style={{ width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
      />
      {loading && <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>Searching…</div>}
      {error && <div style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626' }}>Error: {error}</div>}
      {!loading && !error && results.length === 0 && debounced.trim() !== '' && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>No matches.</div>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, border: '1px solid #e0e0e0', borderRadius: '4px', maxHeight: '280px', overflowY: 'auto' }}>
          {results.map((c) => (
            <li key={c.key}>
              <button
                onClick={() => onSelect(c)}
                style={{ width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px' }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{c.name}</span>
                <span style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap' }}>{QUALIFIER_LABELS[c.qualifier] ?? c.qualifier}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
