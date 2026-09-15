import React from 'react';

// ── Shared styles ───────────────────────────────────────────────────────────

export const thBase: React.CSSProperties = {
  textAlign: 'left', padding: '6px 10px', background: '#f3f4f4',
  borderBottom: '1px solid #e0e0e0', fontSize: '12px', fontWeight: 700,
  color: '#555', verticalAlign: 'top',
};

export const tdStyle: React.CSSProperties = {
  padding: '7px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', verticalAlign: 'top',
};

export const sortBtn: React.CSSProperties = {
  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', display: 'inline-block',
  background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
  fontSize: '12px', fontWeight: 700, color: 'inherit', textAlign: 'left',
};

export const colInput: React.CSSProperties = {
  marginTop: '4px', padding: '2px 6px', fontSize: '11px', border: '1px solid #ddd',
  borderRadius: '3px', outline: 'none', width: '100%', maxWidth: '150px',
  display: 'block', fontWeight: 400, color: '#333', boxSizing: 'border-box',
};

// ── Shared helpers ──────────────────────────────────────────────────────────

export function sortArrow(field: string, sortBy: string, sortDir: 'asc' | 'desc'): string {
  if (sortBy !== field) return '';
  return sortDir === 'asc' ? ' ↑' : ' ↓';
}

// ── Shared components ───────────────────────────────────────────────────────

export function Badge({ label, color }: Readonly<{ label: string; color: string }>) {
  return (
    <span style={{ background: color, color: '#fff', borderRadius: '2px', padding: '1px 6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

export function TableLink({ href, children }: Readonly<{ href: string; children: React.ReactNode }>) {
  function handleActive(e: React.MouseEvent<HTMLAnchorElement> | React.FocusEvent<HTMLAnchorElement>) {
    (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline';
  }
  function handleInactive(e: React.MouseEvent<HTMLAnchorElement> | React.FocusEvent<HTMLAnchorElement>) {
    (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none';
  }
  return (
    <a href={href} style={{ color: '#1a5276', textDecoration: 'none' }}
      onMouseOver={handleActive} onFocus={handleActive}
      onMouseOut={handleInactive} onBlur={handleInactive}>
      {children}
    </a>
  );
}
