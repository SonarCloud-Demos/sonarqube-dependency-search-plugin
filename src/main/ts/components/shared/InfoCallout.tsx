import React from 'react';

/** Matches SonarQube's native `MessageCallout` (Echoes design system, Info variety) look,
 * using the same CSS custom properties the host page already defines on `:root` — so this
 * tracks the real component's colors (light/dark) without needing to import
 * `@sonarsource/echoes-react` itself, which isn't exposed to plugins as a global. Hex
 * fallbacks are the light-theme values, for the rare case this renders outside the host page. */
export function InfoCallout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--echoes-dimension-space-100, 8px)',
        width: '100%',
        boxSizing: 'border-box',
        marginBottom: 'var(--echoes-dimension-space-200, 16px)',
        padding: 'var(--echoes-dimension-space-150, 12px) var(--echoes-dimension-space-200, 16px)',
        background: 'var(--echoes-color-background-info-weak-default, #f5fbff)',
        border: '1px solid var(--echoes-color-border-info-weak, #e9f4fb)',
        borderRadius: 'var(--echoes-border-radius-200, 4px)',
        color: 'var(--echoes-color-text-info, #316c92)',
        fontSize: '13px',
        lineHeight: '1.4',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        style={{ flexShrink: 0, marginTop: '2px', color: 'var(--echoes-color-icon-info, #4595cb)' }}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="7.25" y="7" width="1.5" height="4.5" rx="0.75" fill="currentColor" />
        <rect x="7.25" y="4" width="1.5" height="1.5" rx="0.75" fill="currentColor" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
