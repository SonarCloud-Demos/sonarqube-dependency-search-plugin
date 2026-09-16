import React from 'react';
import { Disclaimer } from './components/shared/Disclaimer';

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  padding: '24px 32px',
  maxWidth: '640px',
  marginBottom: '16px',
};

const headingStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: '#1a1a1a',
  marginBottom: '12px',
};

const listStyle: React.CSSProperties = {
  margin: '8px 0 0 0',
  paddingLeft: '20px',
  fontSize: '13px',
  color: '#444',
  lineHeight: '1.7',
};

function AdminPage() {
  return (
    <div style={{ padding: '32px', fontFamily: 'sans-serif' }}>
      <Disclaimer />
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#1a1a1a' }}>
        Dependency Search Plugin
      </h1>

      <div style={cardStyle}>
        <div style={headingStyle}>About</div>
        <p style={{ fontSize: '13px', color: '#444', lineHeight: '1.6', margin: 0 }}>
          Implements <a href="https://sonarsource.atlassian.net/browse/MMF-5549" target="_blank" rel="noreferrer">MMF-5549</a>  - 
          lets a security or compliance lead find every instance of a package/version or a
          license across a project, application, portfolio, or the whole instance. Queries the
          SCA dependency inventory (<code>api/v2/sca/releases</code>)  -  not vulnerability or CVE
          data.
        </p>
      </div>

      <div style={cardStyle}>
        <div style={headingStyle}>Where it appears</div>
        <ul style={listStyle}>
          <li><strong>Projects &amp; Applications</strong>  -  "Dependency Search" tab, targeted branch by default, with an optional switch to all branches + pull requests</li>
          <li><strong>Portfolios &amp; Sub-portfolios</strong>  -  "Dependency Search" tab, each leaf project's main branch by default, with an optional (warned) switch to all branches + pull requests of every leaf project</li>
          <li><strong>Instance-wide</strong>  -  under the top navigation <strong>More</strong> menu, searching every project by default, with an optional picker to narrow to one project/app/portfolio instead</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <div style={headingStyle}>Capabilities</div>
        <ul style={listStyle}>
          <li>Landing view lists the full dependency inventory of the targeted branch  -  same idea as the native Dependencies tab, streamed in page by page so it starts rendering immediately</li>
          <li>Per-column filter + sort (Project, Branch/PR, Package, Version, Manager, License, Scope)  -  all in-memory over the already-fetched list, no extra requests per keystroke. Low-cardinality columns (below the filter dropdown threshold) get a checkbox picker with counts; the rest stay free text with autocomplete</li>
          <li>Optional "all branches &amp; pull requests" switch reuses whatever's already loaded and only fetches the genuinely new branches/PRs, deduplicating entries found on more than one</li>
          <li>Portfolios and the global "all projects" scope always show a run-approval gate first  -  a project count, the all-branches switch, and a live duration estimate  -  since those fan out to many projects at once</li>
          <li>Admin-configurable results pagination bounds how many rows render at once, so scopes with hundreds of thousands of dependencies stay responsive  -  the page itself scrolls, no nested scroll box</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <div style={headingStyle}>Settings</div>
        <p style={{ fontSize: '13px', color: '#444', lineHeight: '1.6', margin: '0 0 10px' }}>
          Editable from <strong>Administration → General Settings → Dependency Search</strong>  - 
          shown there automatically like any other plugin setting, not on this page:
        </p>
        <ul style={listStyle}>
          <li><strong>Enable Dependency Search</strong>  -  when off, the tabs and global menu entry aren't registered at all (no menus in projects, applications, portfolios, or the global "More" menu) and no API calls are made. Since the page registry is built once, toggling this needs a <strong>SonarQube restart</strong> before the menus actually appear or disappear  -  the disabled notice inside the pages themselves, though, takes effect immediately.</li>
          <li><strong>Request throttle (requests/sec)</strong>  -  shared rate limit across every branch/PR/project a search fans out to. Default 10.</li>
          <li><strong>Results page size</strong>  -  rows the results table pages through at once. A display setting only  -  unrelated to the network fetch page size, which is fixed at the server's hard cap of 500 and isn't configurable. Default 1000.</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <div style={headingStyle}>Permissions</div>
        <p style={{ fontSize: '13px', color: '#444', lineHeight: '1.6', margin: 0 }}>
          Users need <strong>Browse</strong> permission on each project to see its dependencies.
          Requires the SCA (Software Composition Analysis) feature to be enabled.
        </p>
      </div>
    </div>
  );
}

(globalThis as any).registerExtension('dependencysearch/admin', () => {
  return <AdminPage />;
});
