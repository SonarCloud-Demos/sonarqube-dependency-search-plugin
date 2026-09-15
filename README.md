# SonarQube Dependency Search Plugin

> ⚠️ **Experimental** — personal project, not an official Sonar product.

Covers [MMF-5549](https://sonarsource.atlassian.net/browse/MMF-5549) — *Better SCA search for security personas*
— scoped to the **dependency inventory** (package name/version, license). Vulnerability/CVE
search is explicitly out of scope for this plugin; it queries `api/v2/sca/releases` (the SCA
dependency inventory), never `api/v2/sca/issues-releases` (vulnerability findings).

## What it does

Lets a security or compliance lead find every instance of a package/version, or a license,
across a project, application, portfolio, or the whole SonarQube instance — instead of filtering
a portfolio view by package name and reading version rows one by one.

### Where it appears

| Scope | Location |
|---|---|
| Project | "Dependency Search" tab |
| Application | "Dependency Search" tab |
| Portfolio / sub-portfolio | "Dependency Search" tab |
| Instance-wide | Top nav **More** menu → "Dependency Search" — searches every project by default, with an optional picker to narrow to one project/app/portfolio |

### How search works

- **Landing view** — with the filter fields empty, shows the full dependency inventory of the
  targeted branch, same as the native "Dependencies" tab. Results stream in page by page as
  they're fetched, so the table starts filling in immediately instead of waiting for everything.
- **Per-column filter + sort** — every column (Project, Branch/PR, Package, Version, Manager,
  License, Scope) has its own filter box and sort arrow, AND-combined, over the already-fetched
  list. No extra request per keystroke, and the filters you've typed survive the table briefly
  reloading (e.g. when you toggle all-branches) instead of resetting.
- **"Search all branches & pull requests"** (optional, off by default) — fetches every branch and
  PR instead of just the targeted one, and deduplicates rows for the same package/version/license
  found on more than one branch/PR of the same project. Reuses whatever's already loaded (e.g.
  the main branch) instead of refetching it — only genuinely new branches/PRs are fetched.
- **Handles very large inventories** — up to ~300k dependencies. The results table paginates
  (admin-configurable rows/page, default 1000, Prev/Next controls) rather than rendering
  everything at once — the current page renders in normal page flow (no nested scroll box) and
  stays responsive to sort/filter regardless of the total loaded.

### Branch / PR scope

- **Projects and applications**: default is the targeted (currently selected) branch. All-branches
  + pull-request toggle is a plain, unwarned checkbox — bounded to one component.
- **Portfolios and the global "all projects" scope**: default is every project's main branch.
  Nothing runs automatically here — landing on either shows a **run-approval gate** first: a
  project count (one cheap call), the all-branches checkbox, an "average branches + PRs per
  project" slider (default 5, only relevant if all-branches is on), and a live duration estimate.
  Only clicking **Run search** starts the actual fetch.

### Performance

All calls to `api/v2/sca/releases` go through a shared rate limiter — **10 requests/sec by
default, admin-configurable**. Network fetch page size is fixed at **500** (the server's
confirmed hard cap — sending more gets HTTP 400) and is *not* configurable; that's a separate
knob from the results table's own page size (see above), which is admin-configurable and has
nothing to do with the network layer. The throttle is deliberately bursty rather than a fixed
100ms-per-request cadence, so concurrent scopes' first pages can render together instead of being
staggered for no throughput benefit. Scopes fetch concurrently (up to 20 at once); pagination
within one scope is sequential, and each page renders as soon as it lands. Targeted mode skips
looking up each project's actual main-branch name (a real bottleneck at thousands of projects) —
it omits the branch param and trusts the server to default to main. Completed scopes are cached
for the session, so toggling all-branches never refetches a branch that's already loaded. The
filter fields themselves never trigger a fetch.

### Settings

Editable from the standard **Administration → General Settings → Dependency Search** page (no
separate custom editor — the plugin's own admin page is informational only):

| Setting | Default | Notes |
|---|---|---|
| Enable Dependency Search | on | Off = no tabs/menu entries anywhere, no API calls. Removing the menus requires a SonarQube **restart**; the "no API calls" part is immediate. |
| Request throttle (requests/sec) | 10 | Shared across every branch/PR/project a search fans out to. |
| Results page size | 1000 | Results table pagination only — unrelated to the network fetch page size (fixed, not configurable). |

## Requirements

- SonarQube with the SCA (Software Composition Analysis) feature enabled
- Browse permission on the target project(s)

## Building

```bash
yarn install
mvn package -DskipTests
cp target/sonar-dependency-search-plugin-*.jar $SONARQUBE_HOME/extensions/plugins/
# Restart SonarQube
```
