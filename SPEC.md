# SPEC — Dependency Search

Source: [MMF-5549 — Better SCA search for security personas](https://sonarsource.atlassian.net/browse/MMF-5549)

**Scope note:** this implementation covers the *dependency inventory* half of the ticket only
(package name/version, license). Vulnerability/CVE search — the `issues-releases` half — is
explicitly excluded; see "Out of scope" below.

## Why

Security admins get asked, after high-profile incidents (Log4Shell, Shai-Hulud, ...):

- "Where do we have that?"
- "Are we safe?"

Today that means filtering a portfolio by package name and reading version rows one by one — and
only works if an all-projects portfolio already exists.

## Use cases covered

- As a security lead, I can find all instances of `log4j-1.2.3` across a project, application,
  portfolio, or the whole instance
- As a compliance lead, I can discover all instances where I use `AGPL-3.0`

## Use case NOT covered (out of scope)

- ~~As a security lead, I can find out what Sonar knows about `CVE-2026-12345`~~ — removed by
  request. No vulnerability/CVE search, no `issues-releases` API usage.

## UX model

- **Landing view** (all filter fields empty) duplicates the native "Dependencies" tab: the full
  dependency inventory of the targeted branch. No query required to see anything — and, like the
  native tab, it doesn't wait for the whole inventory before showing something: each fetched page
  streams into the table immediately.
- **Per-column filter + sort** — every column (Project, Branch/PR, Package, Direct/Transitive,
  Version, Manager, License, Scope) has its own sort button and filter control in the header, AND-combined,
  filtering that already-fetched list in-memory; no network call per keystroke. Every column
  shows a visible (dimmed) sort icon even when it isn't the active sort field — an earlier
  version showed nothing at all on inactive columns, which read as "not sortable" rather than
  "sortable, just not right now." Filter/sort state
  lives in the panel, not the table, so it survives the table being briefly unmounted while scopes
  re-resolve (e.g. toggling "all branches") — typing something in doesn't get reset by an
  unrelated loading flicker.
- **Low-cardinality columns get a checkbox picker instead of free text** — below
  `filterDropdownThreshold` distinct values (admin-configurable, default 12; typically Manager,
  Scope, sometimes License), the filter is a value+count checklist rather than a text box.
  Above the threshold (Package, Version, Project, ...), it stays free text but gets `<datalist>`-
  backed autocomplete suggestions. See "Faceting" below for how this stays cheap at 300k rows.
- **"All branches & pull requests" toggle** (optional, off by default) re-resolves the scope to
  every branch and PR instead of just the targeted one, and deduplicates rows for the same
  project + package + version + license found on more than one branch/PR (their branch/PR labels
  are merged into one row instead of listed as separate rows). Toggling it does **not** refetch
  scopes already fully loaded (e.g. the main branch, from the targeted-mode landing view) — a
  per-scope cache (keyed by project + branch/PR) is checked first, and only the genuinely new
  branches/PRs are fetched. Toggling back off and on again reuses everything already cached, no
  matter how many times.
- **Run-approval gate** — portfolios and the global page's implicit "every project" scope
  (qualifiers VW/SVW/ALL) never auto-fire. Landing there shows a duration estimate first: one
  cheap paging-total-only call gets the project count, the all-branches checkbox and an
  "average branches + PRs per project" slider (default 5) live there too, and the estimate
  (`projects × [1 or avg-branches] ÷ throttle`) updates as those change. Only clicking
  "Run search" starts resolution/fetch. Project and application scope never show this — they're
  bounded to one component, so their all-branches checkbox is a plain, unwarned toggle.
- The global page defaults to this instance-wide "all projects" scope; an optional picker lets
  the user narrow to one project/application/portfolio instead (which drops the gate for
  project/application, or keeps a portfolio-specific version of it).
- **Results pagination** — the table pages through the filtered/sorted list `resultsPageSize`
  rows at a time (default 1000, admin-configurable), with Prev/Next controls; the current page
  renders in normal page flow (no nested scroll box — see "Rendering at scale" below for why
  there's no row virtualization either). Changing a filter or sort resets to page 1; new rows
  streaming in from an in-progress fetch do not (nobody wants to be bumped off the page they're
  reading because more data arrived in the background).
- **Enabling/disabling** — off (`dependencysearch.enabled = false`) means no tabs, no global menu
  entry, anywhere, and no API calls. See "Enable/disable" below for how that's actually enforced.

## Acceptance criteria

- [x] A project/application/portfolio's dependency inventory can be searched by package name and
      version (or purl) — filtered results in the UI
- [x] A project/application/portfolio's dependency inventory can be searched by license
      identifier — filtered results in the UI
- [x] Search works at project, application, and portfolio scope, matching where other tabs like
      this appear
- [x] Search also works instance-wide, from a global page under the "More" nav menu — and is
      genuinely instance-wide by default (no project pick required), matching "the entire estate
      can be searched" from the ticket's stretch goals, with an optional picker to narrow instead
- [x] Targeted (currently selected) branch by default, everywhere
- [x] Optional: search all branches + pull requests, everywhere (including portfolios now),
      deduplicated
- [x] Run-approval gate with a duration estimate (project count × assumed branches/PRs ÷
      throttle) before portfolio or instance-wide search fires, not just before the all-branches
      toggle
- [x] API calls are throttled (10 req/s default, admin-configurable) and optimized
      (sequential-per-scope, concurrent-across-scopes pagination; network fetch page size fixed
      at the server's hard cap of 500 — see below; fetch-once-filter-in-memory instead of a
      request per keystroke; no per-project main-branch lookup call; completed scopes cached so
      toggling all-branches doesn't refetch what's already loaded)
- [x] The landing view and its filters/sort stay responsive up to ~300k entries — the results
      table paginates (admin-configurable rows/page, default 1000; unrelated to the network fetch
      page size) rather than rendering everything at once. (An earlier iteration also row-
      virtualized with `@tanstack/react-virtual`; dropped once pagination existed, since
      virtualizing a box sized to show every row of a page clips nothing — see "Rendering at
      scale" below.)
- [x] Low-cardinality column filters (below an admin-configurable threshold, default 12) render
      as a checkbox picker of actual values with counts; higher-cardinality columns keep free
      text but get autocomplete suggestions — both computed client-side, debounced, off the
      already-fetched list (see "Faceting")
- [x] Disabling the plugin actually removes the tabs/menu entries everywhere (not just a client-
      side notice) — see "Enable/disable" below for the restart caveat

Out of scope (per this iteration): vulnerability ID + alias search, vulnerability-first search.
LaunchDarkly flag and telemetry: N/A per ticket.

## How it works

### API

`GET api/v2/sca/releases` — the SCA dependency inventory endpoint (confirmed distinct from
`api/v2/sca/issues-releases`, which is vulnerability/issue-centric and intentionally unused here).

Confirmed real params/response shape (reverse-engineered from the compiled SonarQube web bundle,
since the controller source isn't in the open checkouts):

- `projectKey` (required), `branchKey`, `pullRequestKey`, `pageIndex`, `pageSize` — **confirmed
  hard-capped at 500 server-side** (found empirically: sending 1000 returns HTTP 400, "must be
  less than or equal to 500"; the reference UI itself defaults to 100). This plugin always sends
  500 — `FETCH_PAGE_SIZE` in `api/scaReleases.ts`, a fixed constant, deliberately **not**
  admin-configurable, to avoid a setting that silently breaks every request if raised past the
  cap. (Don't confuse this with "results page size" below — same word, unrelated knobs; see
  "Throttling & fetch size" for why they're kept apart.) The reference UI also has a server-side
  `q` param — **not used by this plugin**: since the landing view always needs the
  full inventory anyway (to match the native Dependencies tab), and license had no confirmed
  server-side filter, everything is filtered client-side on the already-fetched list instead. One
  fewer moving part, one less untested assumption.
- Response: `{ releases: [{ key, branchUuid, packageUrl, packageManager, packageName, version,
  licenseExpression, knownPackage, directSummary, scopeSummary, dependencyFilePaths }],
  branches: [...], page: { pageIndex, pageSize, total } }`

### Scope resolution

| Component qualifier | Targeted (default) | All branches + PRs (optional) |
|---|---|---|
| Project (TRK) | current branch | every branch + every open PR |
| Application (APP) | member projects on the app's selected branch (`api/applications/show`) | every app branch, each resolved the same way |
| Portfolio/sub-portfolio (VW/SVW) | every leaf project, **main branch assumed, not looked up** (`api/measures/component_tree`, strategy=leaves) | every leaf project's own branches + PRs |
| Global "all projects" (ALL, synthetic) | every visible project, same main-branch assumption (`api/components/search?qualifiers=TRK`) | every visible project's own branches + PRs |

Targeted mode deliberately skips a per-project main-branch-name lookup — that used to be an
unthrottled `fetchMainBranch` call per leaf, which at project counts in the thousands was itself a
multi-minute bottleneck *before* any dependency fetch even started. `branchKey` is now omitted
entirely, trusting `api/v2/sca/releases` to default to the main branch like most other SonarQube
v2 endpoints — unconfirmed for this specific endpoint, worth checking against a live instance.

### Dedup (all-branches mode only)

Key: `projectKey :: packageUrl (or packageName) :: version :: licenseExpression`. Matching rows
found on different branches/PRs of the same project are merged into one row; their scope labels
are unioned (shown joined, e.g. `main, release-2.0, PR #42`); `directSummary` is OR'd across
matches. Targeted-branch mode has at most one scope per project already, so dedup is a no-op there.

### Throttling & fetch size — two independent, easily-confused knobs

Learned the hard way: "page size" means two completely different things here, and they must
**not** be coupled:

1. **Network fetch page size** (`FETCH_PAGE_SIZE` in `api/scaReleases.ts`) — how many rows come
   back per HTTP request to `api/v2/sca/releases`. Fixed at 500 (the confirmed server cap), not a
   setting, not exposed anywhere. Purely an implementation detail of how pagination against the
   API works.
2. **Results page size** (`dependencysearch.pageSize`, admin-configurable, default 1000) — how
   many rows the *results table* pages through at once. A pure display/UX setting over the
   already-fetched, already-filtered/sorted list. Has nothing to do with #1, can be smaller,
   equal, or (as it is by default) larger than the fetch page size with no correctness impact —
   pagination here is client-side slicing of an in-memory array, not a network operation.

Both settings — throttle and results page size — are read once per page load via
`syncPluginSettings()` (`api/pluginSettings.ts`) in a single `api/settings/values` call, alongside
whether the plugin is enabled at all (see "Enable/disable"). They're edited from the **standard**
SonarQube settings UI — Administration → General Settings → Dependency Search — auto-generated
from the plugin's `PropertyDefinition`s; there's no separate custom editor on the plugin's own
admin page (an earlier iteration had one, redundant with the built-in one, removed).

- A single `RateLimiter` (sliding 1s window, 10 req/s default) wraps every `fetch` to
  `api/v2/sca/releases`, shared across the whole search — so fanning out to many
  branches/PRs/projects can't exceed the cap. Deliberately bursty, not a fixed "one request every
  100ms" cadence: a fixed-interval limiter would stagger even a lone project's sequential page
  requests, or the first page of many concurrent scopes, for no throughput benefit — bursting up
  to the cap and then waiting out the window gets more scopes' first page rendering sooner, which
  is what the progressive/streaming landing view is for. Both approaches yield the same *average*
  throughput (N requests ÷ rate); only the burst-capable one keeps first-paint fast.
- Scopes are fetched concurrently (up to 20 at once) but pagination within one scope is
  sequential; the rate limiter is what actually bounds total dispatch rate, not the concurrency
  count.
- A generation counter + abort signal cancels an in-flight fetch superseded by a scope/toggle
  change, so stale requests don't keep consuming throttled slots.
- Each page is pushed into the results table via `onPage` as soon as it lands — the landing view
  never blocks on the full inventory finishing, which is what makes it feel as immediate as the
  native Dependencies tab even for large projects/portfolios.
- **Completed-scope cache**: once a scope's fetch finishes cleanly (not aborted, not errored),
  its releases are kept in a `Map` keyed by `projectKey::branchKey::pullRequestKey`
  (`scopeCacheKey`), for the lifetime of the current target (project/app/portfolio/all-projects).
  Re-resolving scopes (typically: toggling "all branches") only fetches scopes *not* already in
  that cache — the display recomputes instantly from cache for everything else. Partial results
  from an aborted/failed fetch are never promoted into the cache, so a cancelled scope is retried
  fresh rather than showing stale/incomplete data forever. The cache itself is cleared only when
  the target changes (different project/app/portfolio, or narrowing/un-narrowing on the global
  page) — not by the all-branches toggle.
- The filter fields themselves never trigger a fetch — they're a `useMemo` over already-streamed
  data (debounced 120ms inside the table), so typing is free regardless of throttle/latency.

### Rendering at scale — pagination, not virtualization

First pass at the 300k-row concern used `@tanstack/react-virtual` (only visible rows in the DOM,
inside a fixed-height scroll box). Dropped it after two rounds of feedback:

1. A short fixed-height scroll box made a 1000-row *page* look like it was only showing ~15
   results — technically correct (virtualization works exactly like that) but reads as broken.
2. Making the box tall enough to show every row of a page removes the contradiction above, but
   also removes the point of virtualizing: a container sized to fit all its content never clips
   anything, so the virtualizer has nothing to hide and does zero useful work. Virtualization
   and "always show the whole page" are mutually exclusive, not complementary.

Once results pagination existed (previous section), it became the actual bound on DOM size, not
virtualization — a page is at most `resultsPageSize` rows (default 1000, admin-configurable), and
the *entire* current page renders as plain grid rows in normal document flow. No inner scroll
box, no `<tr>`s (still a CSS-grid layout, not a literal `<table>`, purely so column widths stay
declarative — nothing to do with virtualization). The page itself scrolls, the way any long page
does. The 300k-entry scale is handled by keeping `resultsPageSize` reasonable, the same way it
was already handled for the *fetch* side by `FETCH_PAGE_SIZE`.

### Faceting — checkbox pickers vs. free-text autocomplete

Motivation: typing a substring into a plain text box works fine for Package/Version (thousands
of distinct values, no realistic alternative), but is bad UX for something like Manager or Scope
— a handful of exact values (`NPM`, `MAVEN`, `PYPI`, ...) where a picker beats typing.

- **Two separate facet computations, on purpose** — conflating them was a bug, not a
  simplification:
  - `computeFullFacets` (`DependencySearchResultsTable.tsx`) makes **one pass** over the full,
    unfiltered `items`, building a `value → count` `Map` for all 8 columns simultaneously (not 8
    separate passes). Debounced 300ms off `items` (longer than the 120ms filter debounce) — a
    background enhancement, not something filtering depends on to function. Used **only** to
    decide *mode* (checkbox picker vs. free text, via cardinality) and to seed the free-text
    columns' `<datalist>`. Deliberately not re-narrowed by other filters: a column flipping
    between checkbox and text mode as you type elsewhere would be far more jarring than a
    free-text autocomplete list staying a little stale.
  - `narrowedFacetValues` (a `useMemo`) is the part that actually re-narrows: for each
    checkbox-picker column, it applies every *other* active filter first, then counts what's
    left — so picking "NPM" under Manager immediately shrinks License's option list/counts to
    only what NPM packages actually have. Recomputed whenever the debounced filters or `items`
    change. Deliberately limited to checkbox-mode columns only (typically 2-3 of 7, low-
    cardinality by definition) — doing this for Package/Version too would mean an extra full
    pass over up to 300k rows per keystroke on the expensive columns, the exact cost this
    feature was trying to avoid; free-text autocomplete stays on the static list instead.
  - A value the user has already checked stays visible (at count 0) even if other filters just
    narrowed it out, rather than a checked box silently disappearing from the list.
- A column becomes a **checkbox picker** (`FacetDropdown`, a native `<details>/<summary>` for
  open/close — no click-outside-to-close handling, matching plain `<details>` semantics) when
  its distinct-value count (from the full, static pass) is below `filterDropdownThreshold`
  (admin-configurable, default 12). Selections are OR'd within the column, AND'd across columns
  like every other filter.
  - **The panel itself renders through a portal to `document.body`**, positioned in `fixed`
    coordinates from the `<summary>`'s live `getBoundingClientRect()` (re-measured on scroll/
    resize while open). Rendering it as a normal in-place child — even `position: absolute`
    with a high `z-index` — doesn't work here: the table sits inside two ancestors that clip
    overflow (the rounded-corner wrapper, `overflow: hidden`, and the header's own horizontal-
    scroll region, `overflowX: auto`), and CSS overflow clipping is based on DOM containment,
    not paint order — no `z-index` escapes a clipping ancestor. First version got this wrong:
    the panel rendered clipped/behind the row content instead of floating above it.
- At or above the threshold, the column stays a plain text input with a `<datalist>` of up to
  500 of its distinct values (from the static pass) for browser-native autocomplete — no extra
  library, no custom typeahead component, and not re-narrowed (see above).
- **Encoding**: rather than giving `ColumnFilters` a second shape (string | string[]), a
  checkbox selection is encoded into the same string slot the free-text filter already uses,
  joined with `U+001F` (ASCII unit separator) — a control character that won't collide with any
  real package/version/license/project name, unlike a comma. `isFacetField` (derived from the
  live facet count, not stored state) decides at filter-time whether a column's stored string is
  interpreted as "exact match against this decoded set" or "substring, case-insensitive."
- Until the first facet pass completes (or if a column's cardinality never drops below the
  threshold), every column just behaves like free-text substring filtering always did — there's
  no broken/loading state, only a delayed upgrade to picker/autocomplete once facets are ready.

### Enable/disable

`dependencysearch.enabled` (default true) is meant to fully remove the feature when off — no
tabs on projects/apps/portfolios, no entry in the global "More" menu, no API calls. That requires
two layers, both implemented:

1. **Server-side (the one that actually removes the menus)**: `DependencySearchPageDefinition`
   and `DependencySearchGlobalPageDefinition` take a `Configuration` via constructor injection and
   simply don't call `context.addPage(...)` when the setting is off. `DependencySearchAdminPageDefinition`
   is deliberately **not** gated — it must always stay reachable, or there'd be no way to
   re-enable the feature once disabled. Caveat: SonarQube builds its page registry once (server
   startup), so **toggling this setting requires a restart** before the menus actually
   appear/disappear — flipping it and refreshing the browser isn't enough.
2. **Client-side (the one that's instant)**: `syncPluginSettings()` also returns `enabled`; if
   false, `DependencySearchPanel` renders a "disabled by administrator" notice and every
   fetch-triggering effect short-circuits — no scope resolution, no `api/v2/sca/releases` calls.
   This is what makes disabling *effective immediately*, covering the gap before the next
   restart, and stays as defense-in-depth afterward (belt-and-suspenders, not required once the
   page really is gone from the registry).

### Permission scoping

Every scope this plugin fans out to (targeted project/branch/PR, all-branches, all-projects,
portfolio) goes through the normal `api/v2/sca/releases` endpoint on the caller's own session — it
never elevates privilege or fetches on behalf of the user. A project the caller can't Browse simply
never contributes a scope, and its dependencies never surface, whether the search was run from that
project directly (blocked before ever reaching this plugin) or from a portfolio/global/all-projects
search that happens to contain it (silently skipped). Nothing here re-checks permissions itself;
it's inherited for free from every call being made as the logged-in user. The project-level view
doesn't need a reminder about this — there's exactly one project in scope, and you already needed
Browse on it to be looking at the tab at all. Application, portfolio, and global (all-projects)
views show a small permissions-boundary notice for this reason (`isMultiProject` in
`DependencySearchPanel.tsx`, true whenever the qualifier isn't `TRK`).

### UI text convention

Rendered page text (panels, admin info page, table cells/placeholders) sticks to plain ASCII
punctuation - hyphens, three-dot ellipses, straight quotes - no em/en dashes, curly quotes, or
typographic ellipsis characters. Code comments and docs are unaffected by this; the rule is about
what a user actually sees rendered in the browser, not about how the source is written.

### Matching the native look — Echoes design tokens

`InfoCallout` (`components/shared/InfoCallout.tsx`) reproduces SonarQube's native `MessageCallout`
(Info variety) look for the permission-boundary notice, without importing
`@sonarsource/echoes-react` itself — that package isn't exposed to plugins as a global (only
`react`/`react-dom`/`sonar-request`/`i18n`/`sonar-config` are, per `conf/esbuild-config.js`).
Instead it references the same CSS custom properties the host page already defines globally on
`:root` (`--echoes-color-background-info-weak-default`, `--echoes-color-border-info-weak`,
`--echoes-color-text-info`, `--echoes-color-icon-info`, `--echoes-dimension-space-*`,
`--echoes-border-radius-200`) via `var(--x, <light-theme-hex-fallback>)`. Confirmed real values
by pulling the running instance's own `echoes-*.css` and reading the actual
`:root,[data-echoes-theme=light]` / `[data-echoes-theme=dark]` blocks (not guessed) — and found
the real `MessageCallout` usage pattern in the `sonarqube-webapp` source checkout
(`@sonarsource/echoes-react`'s `<MessageCallout variety={MessageVariety.Info}>`) to confirm this
is in fact the right visual target to match. Net effect: light/dark theme switching is automatic
(the host flips the CSS variables, this component just reads them), with no theme-detection code
needed here. Also dropped the notice's `maxWidth: 640px` in favor of `width: 100%` so it spans the
page like the rest of the panel, per explicit feedback that it looked cramped next to a full-width
results table.

### Bytecode target — Java 21

`jdk.min.version` and `maven-compiler-plugin`'s `<release>` are both `21` (bumped from the initial
`11`). Trade-off: the built jar now requires a Java 21+ SonarQube instance to load at all — older
instances will fail with `UnsupportedClassVersionError` at plugin-load time. Accepted deliberately;
no compatibility shim.

### Release workflow

`.github/workflows/release.yml` is `workflow_dispatch`-only — it never runs on push/commit, so
merging to any branch can't accidentally cut a release. Run it manually from the Actions tab after
bumping `<version>` in `pom.xml` to a final (non-SNAPSHOT) value. It builds with JDK 21 + the pinned
Node/Yarn toolchain, refuses to proceed on a SNAPSHOT version or a tag that already exists, then
tags `v<version>` and publishes the built jar as a GitHub Release asset via
`softprops/action-gh-release`.

**No npm registry secrets, on purpose.** `.yarnrc.yml`'s committed `npmRegistryServer` points at an
internal Artifactory mirror (`repox.jfrog.io`) because the local dev network this was built on
blocks `registry.npmjs.org` directly — that's a local-machine constraint, not something CI needs or
should inherit. GitHub Actions runners reach the public npm registry directly, so the workflow's
"Install frontend dependencies" step sets `YARN_NPM_REGISTRY_SERVER: https://registry.npmjs.org` as
a step-level env var, which overrides the committed mirror setting for that run only (Yarn env-var
settings take precedence over `.yarnrc.yml`) — no token, no secret, nothing to rotate. The one thing
that had to change to make this safe: `.yarnrc.yml`'s `npmAuthToken: "${YARN_NPM_AUTH_TOKEN}"` used
strict interpolation that hard-errors ("Environment variable not found") if the var is unset, which
is exactly the CI case now that no secret is configured — changed to
`"${YARN_NPM_AUTH_TOKEN:-}"` (Yarn's supported default-value syntax) so it resolves to an empty,
harmless value instead. Local dev is unaffected either way, since the corporate token is still set
there and still gets picked up when present. First attempt at this release mistakenly added
`NPM_AUTH_TOKEN`/`YARN_NPM_AUTH_TOKEN` as real repo secrets pointing at the jfrog mirror — removed
once it was clear the mirror (and any token for it) was never the right thing for CI to depend on.

### Dependency CVE remediation (2026-09-16)

Found via SonarCloud's Dependency Risks page for this repo itself (not the plugin's own feature -
these are test-scope/dev-tooling dependencies of the *build*, not anything shipped in the jar):

- `org.postgresql:postgresql` 42.5.1 -> 42.7.11 (test scope, only used by `sonar-orchestrator`
  integration tests) - fixes CVE-2024-1597 (SQL injection via `preferQueryMode=simple`) and
  CVE-2026-42198 (unbounded CPU during SCRAM-SHA-256 auth, client-side DoS)
- `org.assertj:assertj-core` 3.24.2 -> 3.27.7 (test scope) - fixes CVE-2026-24400 (XXE in
  `isXmlEqualTo`/`XmlStringPrettyFormatter`; this plugin's tests don't use either API, so was never
  exploitable here, but bumped anyway)
- `uuid` (npm) 8.3.2 -> **11.1.1**, pinned via a `resolutions` entry in `package.json` since it's a
  transitive dependency of `jest-junit` (dev-only, JUnit XML test reporting), not a direct
  dependency - fixes CVE-2026-41907 (out-of-bounds write in `v3()`/`v5()`/`v6()` when given an
  external buffer). `jest-junit` only calls `v1()` with no buffer argument, so this one was also
  never actually exploitable via this project's usage, but bumped for hygiene.

  First attempt used the latest patched version, **14.0.2** — passed every local check, including
  `require('uuid')` and a full `jest`/`jest-junit` run, and got committed/pushed on that basis. It
  broke for a completely different reason on the *actual* release workflow: `actions/setup-node@v4`
  pins Node **16.14.0** (matching `frontend-maven-plugin`'s configured version), and uuid 14.x's
  package.json is `"type": "module"` with only a `"node"` exports condition (no explicit
  `"require"`) pointing at `dist-node/index.js` — a file Node 16 cannot `require()` at all
  (`ERR_REQUIRE_ESM`), while newer Node versions silently made it work via a `require(esm)`
  capability Node 16 doesn't have. My local verification passed because it ran against my
  machine's system Node (v26), not the project's actual pinned toolchain — a false positive that
  only local per-tool commands could produce; `mvn test` locally *also* passed for the same
  reason, since exec-maven-plugin's `npm test` step resolves `npm`/`node` from `PATH`, not from
  the pinned copy `frontend-maven-plugin` caches under `./node/`. The real check, run after the
  fact: `./node/node ./node_modules/.bin/jest` — the actual pinned binary — reproduced the exact
  CI failure. **Lesson**: when a project pins a specific Node version, verify against that exact
  binary (`./node/node`, not whatever's on `PATH`), not just "it built/tested locally."

  11.1.1 is one of the CVE advisory's explicit backport-patch releases (alongside 12.0.1, 13.0.1)
  for pre-14 major lines, and unlike 12.0.1/13.0.1, its `exports` map has a real explicit
  `"require"` condition pointing at a genuinely separate `dist/cjs/` build — verified this actually
  resolves and runs correctly under `./node/node` (the pinned 16.14.0 binary), not just under a
  newer system Node.

Second pass (3 more risks found once the first 4 dropped off the list):

- `org.postgresql:postgresql` 42.7.11 -> 42.7.12 - fixes CVE-2026-54291 (channel-binding downgrade,
  "Failing Open")
- `org.sonarsource.sonarqube:sonar-ws` / `sonar-testing-harness` (`sonarqube.version` property)
  10.1.0.73491 -> **26.1.0.118079** (the 2026.1 LTA release, not the latest bleeding-edge train -
  keeps these test-tooling dependencies aligned with the SonarQube LTA line rather than a version
  most self-hosted instances won't have reached yet) - fixes CVE-2024-38460 (encrypted values
  leaked in cleartext via GET params in logs; fixed as of 10.4/9.9.4 LTA, well below 26.1).
  `sonar-orchestrator`/`sonar-orchestrator-junit4` bumped alongside (4.1.0.495 ->
  6.4.3.4676) to stay compatible with the newer harness. **Important:** these three are all
  `test`-scope only — used to write integration/black-box tests that talk to a real SonarQube
  instance during development, excluded from the packaged jar, and have zero relationship to
  which SonarQube Server versions can load this plugin. That's governed entirely by
  `sonar.apiVersion` / `pluginApiMinVersion` (currently `11.1.0.2693`, unchanged by this bump).
  Also confirmed: nothing in `src/` actually uses `Orchestrator`/`WsClient`/sonar-ws at all (no
  `*BBT.java` files exist either) - this bump is pure hygiene on unused scaffolding, not a real
  fix for an exploitable path in this project.
- `eslint` (npm, dev only) 8.49.0 -> 10.10.0 (latest, well past the 9.26.0 minimum fix) - fixes
  CVE-2025-50537 (stack overflow via circular references in `RuleTester`, an eslint-internal
  testing utility this project never uses since it defines no custom rules). Not wired into any
  script here (no `lint` script in `package.json`, no `.eslintrc`/`eslint.config.js` in the repo),
  so bumping across the 8->9 flat-config-only breaking change carries no verifiable risk - there's
  nothing to break, since eslint is never actually invoked by this project's own tooling. A future
  `lint` script would need `eslint-config-sonarqube` and friends migrated to flat config first.

## Open questions (for further iteration)

- With virtualization gone, `resultsPageSize` is the only thing bounding per-page DOM size — an
  admin who sets it to something extreme (e.g. 100,000) reintroduces the freeze this whole effort
  was trying to avoid. No guardrail on the setting today (no max clamp, no warning). Worth adding
  a sane upper bound or a confirmation if someone sets it unreasonably high.
- Does `q` on `api/v2/sca/releases` matter for anything here, given we don't use it? Worth
  revisiting only if fetch-everything-then-filter turns out too slow for very large inventories —
  at that point, a confirmed server-side `q` (if it also matches license) could replace the
  client-side scan for the *filtered* view, while the landing view would still need a full fetch.
- The run-approval duration estimate assumes ≤1 fetch page (≤500 dependencies, the fixed network
  page size) per targeted-branch scope and doesn't account for scopes that need multiple pages —
  it estimates *request count from project/branch count*, not from total dependency rows (which
  aren't known until fetched). Could undercount the estimate for portfolios of unusually
  dependency-heavy projects.
- Is there a way to make the enable/disable toggle take effect without a restart? Would need
  SonarQube to re-invoke `PageDefinition.define()` per request (or per settings change) rather
  than once at startup — not something this plugin controls.
- The main-branch-name skip (targeted mode omits `branchKey`) is unconfirmed against a live
  instance for this specific endpoint — verify results look right for projects whose main branch
  isn't literally named "main".
- The completed-scope cache has no eviction — long sessions that switch between many different
  projects/portfolios/toggle states will accumulate memory for as long as the page stays open.
  Not addressed; likely fine for a single search session, worth revisiting if it becomes an issue.
