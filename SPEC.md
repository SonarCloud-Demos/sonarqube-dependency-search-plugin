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
- **Per-column filter + sort** — every column (Project, Branch/PR, Package, Version, Manager,
  License, Scope) has its own sort-arrow button and filter input in the header, AND-combined,
  filtering that already-fetched list in-memory; no network call per keystroke. Filter/sort state
  lives in the panel, not the table, so it survives the table being briefly unmounted while scopes
  re-resolve (e.g. toggling "all branches") — typing something in doesn't get reset by an
  unrelated loading flicker.
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
