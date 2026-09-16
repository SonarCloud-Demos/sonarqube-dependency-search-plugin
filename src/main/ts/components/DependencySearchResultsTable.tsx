import React, { useEffect, useMemo, useState } from 'react';
import { ColumnFilters, SortDir, SortField, TaggedRelease, packageManagerOf, packageNameOf, releaseDetailUrl } from '../types/dependency';
import { Badge, TableLink, thBase, sortBtn, sortArrow, colInput } from './shared/tableUtils';

const FILTER_DEBOUNCE_MS = 120;
// Facets (distinct-value counts per column) are a background enhancement, not
// something the filter needs to function — computing them is a full pass over
// `items` (up to ~300k rows), so it's debounced longer than the filter inputs
// themselves and skipped entirely while data is still streaming in rapidly.
const FACET_DEBOUNCE_MS = 300;

// Encodes a set of exact-match selections into the same string slot the free-text
// filter uses, so ColumnFilters doesn't need a second shape.  (ASCII unit
// separator) is the join delimiter — control character, essentially never appears
// in a real package name/version/license/project name, unlike a comma.
const MULTISELECT_DELIMITER = '\u001F';

function encodeSelection(values: Set<string>): string {
  return [...values].join(MULTISELECT_DELIMITER);
}

function decodeSelection(raw: string): Set<string> {
  return raw ? new Set(raw.split(MULTISELECT_DELIMITER)) : new Set();
}

interface DependencySearchResultsTableProps {
  items: TaggedRelease[];
  showProjectColumn: boolean;
  showScopeColumn: boolean;
  // Raw filter/sort state is owned by the parent (not this component) so it survives
  // the table being briefly removed from the tree while scopes re-resolve (e.g.
  // toggling "all branches") — a filter typed in shouldn't reset just because loading
  // flickered. The table still debounces its own derived copy for the filtering
  // computation below — the input itself stays bound straight to the prop, so typing
  // never lags behind the debounce.
  filters: ColumnFilters;
  onFilterChange: (field: keyof ColumnFilters, value: string) => void;
  sortBy: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField) => void;
  // How many (filtered/sorted) rows the table pages through at once — an admin-
  // configurable UX setting, unrelated to the network fetch page size.
  pageSize: number;
  // Below this many distinct values, a column's filter becomes a checkbox picker of
  // the actual values instead of free text; at/above it, free text stays but gets
  // autocomplete suggestions via a <datalist>. Admin-configurable.
  filterDropdownThreshold: number;
}

const PM_COLORS: Record<string, string> = {
  NPM: '#cb3837', MAVEN: '#c71a36', PYPI: '#3775a9',
  GOLANG: '#00acd7', NUGET: '#004880', GEMS: '#cc342d',
};

// No row virtualization here — deliberately. Virtualizing a box only pays off when
// the box clips content (a fixed-height scroll area shorter than all the rows); this
// table instead paginates (pageSize rows at a time, admin-configurable) and renders
// the *whole* current page in normal flow, letting the page itself scroll. A
// virtualized container sized to fit every row would clip nothing, so the
// virtualizer would do zero work — contradictory, not just redundant. Pagination is
// what bounds the DOM size instead; the earlier 300k-row concern is handled by
// keeping pageSize reasonable (default 1000), not by virtualizing.

function isDirect(item: TaggedRelease): boolean {
  return item.directSummary === true;
}

function fieldValue(item: TaggedRelease, field: SortField): string {
  switch (field) {
    case 'packageName': return packageNameOf(item.packageUrl);
    case 'version': return item.version ?? '';
    case 'licenseExpression': return item.licenseExpression ?? '';
    case 'projectName': return item.projectName;
    case 'scopeLabels': return item.scopeLabels.join(', ');
    case 'packageManager': return packageManagerOf(item.packageUrl);
    case 'scopeSummary': return item.scopeSummary ?? '';
    default: return '';
  }
}

const ALL_FIELDS: SortField[] = [
  'projectName', 'scopeLabels', 'packageName', 'version', 'packageManager', 'licenseExpression', 'scopeSummary',
];

/** One full pass over `items`, building a value→count map per column at once —
 * cheaper than a separate pass per column. */
function computeFacets(items: TaggedRelease[]): Record<SortField, Map<string, number>> {
  const facets: Record<string, Map<string, number>> = {};
  for (const field of ALL_FIELDS) facets[field] = new Map();
  for (const item of items) {
    for (const field of ALL_FIELDS) {
      const v = fieldValue(item, field);
      const map = facets[field];
      map.set(v, (map.get(v) ?? 0) + 1);
    }
  }
  return facets as Record<SortField, Map<string, number>>;
}

interface ColumnDef {
  field: SortField;
  label: string;
  width: string;
}

function renderCell(item: TaggedRelease, field: SortField): React.ReactNode {
  switch (field) {
    case 'projectName':
      return <span style={{ fontSize: '12px', color: '#336' }}>{item.projectName}</span>;
    case 'scopeLabels':
      return <span title={item.scopeLabels.join(', ')}>{item.scopeLabels.join(', ')}</span>;
    case 'packageName': {
      const url = releaseDetailUrl(item, item.projectKey);
      return (
        <span style={{ fontFamily: 'monospace' }}>
          {url ? <TableLink href={url}>{packageNameOf(item.packageUrl)}</TableLink> : packageNameOf(item.packageUrl)}
          <span style={{ marginLeft: '5px', fontSize: '10px', color: isDirect(item) ? '#8b5cf6' : '#6b7280', fontFamily: 'sans-serif', fontWeight: 600 }}>
            {isDirect(item) ? 'direct' : 'transitive'}
          </span>
        </span>
      );
    }
    case 'version':
      return <span style={{ fontFamily: 'monospace' }}>{item.version ?? '—'}</span>;
    case 'packageManager': {
      const pm = packageManagerOf(item.packageUrl);
      return <Badge label={pm} color={PM_COLORS[pm] ?? '#777'} />;
    }
    case 'licenseExpression':
      return <span style={{ fontFamily: 'monospace' }}>{item.licenseExpression ?? '—'}</span>;
    case 'scopeSummary':
      return <span style={{ color: '#666' }}>{item.scopeSummary ?? '—'}</span>;
    default:
      return null;
  }
}

interface FacetDropdownProps {
  label: string;
  values: Map<string, number>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

function FacetDropdown({ label, values, selected, onChange }: Readonly<FacetDropdownProps>) {
  const sorted = useMemo(() => [...values.entries()].sort((a, b) => a[0].localeCompare(b[0])), [values]);

  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  }

  return (
    <details style={{ marginTop: '4px' }}>
      <summary style={{ fontSize: '11px', color: '#333', cursor: 'pointer', listStyle: 'none' }}>
        {selected.size > 0 ? `${selected.size} selected` : 'any'} ▾
      </summary>
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute', zIndex: 10, top: '2px', left: 0, minWidth: '160px', maxHeight: '220px', overflowY: 'auto',
          background: '#fff', border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', padding: '4px 0',
        }}>
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', fontSize: '11px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
          {sorted.map(([v, count]) => (
            <label key={v || '(empty)'} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 10px', fontSize: '12px', fontWeight: 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} aria-label={`${label}: ${v || '(empty)'}`} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v || '(empty)'}</span>
              <span style={{ color: '#999', marginLeft: 'auto' }}>{count}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

export function DependencySearchResultsTable({
  items, showProjectColumn, showScopeColumn, filters, onFilterChange, sortBy, sortDir, onSortChange, pageSize, filterDropdownThreshold,
}: Readonly<DependencySearchResultsTableProps>) {
  const [debouncedFilters, setDebouncedFilters] = useState<ColumnFilters>(filters);
  const [currentPage, setCurrentPage] = useState(0);
  const [facets, setFacets] = useState<Record<SortField, Map<string, number>> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filters), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters]);

  // Static faceting: computed once (debounced) from the full unfiltered `items`, not
  // recomputed as other columns' filters change. Cheaper, and avoids counts shifting
  // confusingly while someone's mid-selection on another column.
  useEffect(() => {
    const t = setTimeout(() => setFacets(computeFacets(items)), FACET_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [items]);

  // Back to page 1 when the filter/sort criteria change — not when `items` merely
  // grows (streaming in more pages shouldn't kick the user off whatever page they're
  // reading). If filtering shrinks the result set below the current page, `safePage`
  // below clamps it without needing its own effect.
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedFilters, sortBy, sortDir]);

  function isFacetField(field: SortField): boolean {
    const count = facets?.[field]?.size;
    return count !== undefined && count > 0 && count < filterDropdownThreshold;
  }

  const filteredAndSorted = useMemo(() => {
    const activeFilters = (Object.entries(debouncedFilters) as Array<[SortField, string]>)
      .filter(([, v]) => v.trim() !== '');

    const rows = activeFilters.length === 0
      ? items
      : items.filter((item) => activeFilters.every(([field, raw]) => {
        if (isFacetField(field)) {
          return decodeSelection(raw).has(fieldValue(item, field));
        }
        return fieldValue(item, field).toLowerCase().includes(raw.trim().toLowerCase());
      }));

    return [...rows].sort((a, b) => {
      const cmp = fieldValue(a, sortBy).localeCompare(fieldValue(b, sortBy));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isFacetField reads `facets`, already a dep
  }, [items, debouncedFilters, sortBy, sortDir, facets, filterDropdownThreshold]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageItems = useMemo(
    () => filteredAndSorted.slice(pageStart, pageStart + pageSize),
    [filteredAndSorted, pageStart, pageSize]
  );

  const columns = useMemo<ColumnDef[]>(() => {
    const cols: ColumnDef[] = [];
    if (showProjectColumn) cols.push({ field: 'projectName', label: 'Project', width: '160px' });
    if (showScopeColumn) cols.push({ field: 'scopeLabels', label: 'Branch / PR', width: '180px' });
    cols.push({ field: 'packageName', label: 'Package', width: 'minmax(220px, 2fr)' });
    cols.push({ field: 'version', label: 'Version', width: '140px' });
    cols.push({ field: 'packageManager', label: 'Manager', width: '110px' });
    cols.push({ field: 'licenseExpression', label: 'License', width: '170px' });
    cols.push({ field: 'scopeSummary', label: 'Scope', width: '100px' });
    return cols;
  }, [showProjectColumn, showScopeColumn]);

  const gridTemplateColumns = columns.map((c) => c.width).join(' ');

  if (items.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#666', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: '4px', marginTop: '16px' }}>
        No dependencies found.
      </div>
    );
  }

  function headerControl(field: SortField, label: string) {
    if (isFacetField(field)) {
      return (
        <FacetDropdown
          label={label}
          values={facets![field]}
          selected={decodeSelection(filters[field])}
          onChange={(next) => onFilterChange(field, encodeSelection(next))}
        />
      );
    }
    const datalistId = `dependencysearch-${field}-options`;
    const facetValues = facets?.[field];
    return (
      <>
        <input
          type="text"
          list={facetValues ? datalistId : undefined}
          placeholder="filter…"
          value={filters[field]}
          onChange={(e) => onFilterChange(field, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={colInput}
          aria-label={`Filter by ${label}`}
        />
        {facetValues && (
          <datalist id={datalistId}>
            {[...facetValues.keys()].filter(Boolean).slice(0, 500).map((v) => <option value={v} key={v} />)}
          </datalist>
        )}
      </>
    );
  }

  return (
    <div style={{ marginTop: '8px', border: '1px solid #e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns, background: '#f3f4f4', borderBottom: '1px solid #e0e0e0', overflowX: 'auto' }}>
        {columns.map((col) => (
          <div key={col.field} style={{ ...thBase, background: 'transparent', borderBottom: 'none' }}>
            <button style={sortBtn} onClick={() => onSortChange(col.field)}>{col.label}{sortArrow(col.field, sortBy, sortDir)}</button>
            {headerControl(col.field, col.label)}
          </div>
        ))}
      </div>

      <div>
        {pageItems.map((item, idx) => (
          <div
            key={`${item.projectKey}-${item.scopeLabels.join(',')}-${item.key ?? idx}`}
            style={{
              display: 'grid', gridTemplateColumns,
              alignItems: 'center',
              borderBottom: '1px solid #f0f0f0',
              background: idx % 2 === 1 ? '#fafafa' : '#fff',
              fontSize: '13px',
              padding: '7px 0',
            }}
          >
            {columns.map((col) => (
              <div key={col.field} style={{ padding: '0 12px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {renderCell(item, col.field)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '6px 12px', fontSize: '12px', color: '#666', borderTop: '1px solid #e0e0e0', background: '#fafafa', flexWrap: 'wrap' }}>
        <span>
          {filteredAndSorted.length === 0
            ? '0 shown'
            : `${(pageStart + 1).toLocaleString()}–${Math.min(pageStart + pageSize, filteredAndSorted.length).toLocaleString()} of ${filteredAndSorted.length.toLocaleString()}`}
        </span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={{ padding: '2px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: safePage === 0 ? 'not-allowed' : 'pointer', opacity: safePage === 0 ? 0.5 : 1 }}
            >
              Prev
            </button>
            <span>Page {safePage + 1} of {totalPages}</span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              style={{ padding: '2px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: safePage >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: safePage >= totalPages - 1 ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
