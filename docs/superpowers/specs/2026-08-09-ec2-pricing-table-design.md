# EC2 On-Demand Pricing Table — Design

Date: 2026-08-09
Status: approved

## Goal

A Vite+Svelte 5 page that renders the AWS EC2 on-demand price list as one sortable,
filterable, searchable table, in the spirit of https://instances.vantage.sh/.

Scope of this spec: **us-east-1 / Linux only**, served entirely from the checked-in
fixtures. No network calls at runtime.

## Fixture reality

`fixtures/aws/` holds six files, not the four the README lists. Three are gzip bodies
saved with a `.json` extension because `wget` stored the `Content-Encoding: gzip`
response raw.

| File | On disk | Contents |
| --- | --- | --- |
| `index.json` | gzip | 1322 on-demand rows, **us-east-1 / Linux only** |
| `spot.json` | plain | spot prices, 40 regions x linux/mswin, no instance specs |
| `locations.json` | gzip | 109 locations: name -> code, continent |
| `metadata.json` | gzip | selector vocabulary: 106 locations, 17 operating systems |
| `on-demand-plan.json` | plain | table column labels and display order |
| `configuration.json` | plain | AWS pricing origin base URLs |

The 106 locations x 17 operating systems in `metadata.json` are the *selector
vocabulary*, not data. AWS serves each combination as its own `index.json`. Multi-region
on-demand comparison is therefore unreachable from the current fixtures and is out of
scope here.

Only `index.json` is consumed by this MVP.

### Verified row shape

```json
{
  "rateCode": "6C86BEPQVG73ZGGR.JRTCKXETXF.6YS6EN2CT7",
  "price": "0.0960000000",
  "Location": "US East (N. Virginia)",
  "Instance Family": "General purpose",
  "vCPU": "2",
  "Instance Type": "m5.large",
  "Memory": "8 GiB",
  "Storage": "EBS only",
  "Network Performance": "Up to 10 Gigabit",
  "plc:OperatingSystem": "Linux",
  "plc:InstanceFamily": "General Purpose",
  "Operating System": "Linux",
  "Pre Installed S/W": "NA",
  "License Model": "No License required"
}
```

Rows live under `regions["US East (N. Virginia)"]`, keyed by a display string. The key
carries no information the row body lacks; iterate `Object.values()`.

### Verified value formats

Measured across all 1322 rows:

- **1322 rows, 1322 distinct `Instance Type`.** Instance type is a natural primary key;
  no dedup needed. `Pre Installed S/W`, `License Model` and `Operating System` are
  single-valued and carry no signal in this file.
- `vCPU` — always an integer string.
- `Memory` — always `"<number> GiB"`. Values range `0.5 GiB` to `32768 GiB` (99 rows exceed 1152 GiB), and include both
  `1024 GiB` and `1024.0 GiB`.
- `price` — decimal string, `0.0042` to `360.98695`. No zeros, no nulls.
- `Instance Family` — 8 values: Memory optimized (409), General purpose (392), Compute
  optimized (320), Storage optimized (101), GPU instance (79), Machine Learning ASIC
  Instances (12), FPGA Instances (6), Media Accelerator Instances (3). Prefer this over
  `plc:InstanceFamily`, which collapses to 5.
- `Storage` — free text in 8 shapes: `EBS only` (790), `N x N NVMe SSD` (421),
  `N x N SSD` (38), `N x N GB NVMe SSD` (27), `N x N HDD` (14), `N GB NVMe SSD` (11),
  `N x NGB` (11), and an unspaced `NxN GB NVMe SSD` (6).
- `Network Performance` — 94 distinct values across three incompatible encodings:
  Gigabit (`100 Gigabit`), Megabit (`12500 Megabit`), and burstable variants of each
  (`Up to 10 Gigabit`). 18 rows are qualitative: `High` (9), `Low to Moderate` (4),
  `Moderate` (4), `Low` (1).

## Architecture

```
fixtures/aws/index.json          decompressed, imported directly by Vite
        |
        v
src/lib/data/normalize.js        raw row -> typed row
        |
        v
src/lib/data/query.js            pure (rows, query) -> rows
        |
        v
src/lib/data/urlState.js         query <-> query string
        |
        v
src/App.svelte  ->  Toolbar.svelte  +  InstanceTable.svelte
```

Three pure data modules with no Svelte dependency, and a thin component tree over them.
Each module is independently testable and holds one responsibility.

### Loading

```js
import raw from '../../fixtures/aws/index.json'
```

Vite resolves JSON from anywhere in the project and behaves identically in dev and
build. The import is synchronous: no loading state, no spinner, no fetch failure path.

Cost: roughly 682 KB of JSON in the bundle. If that becomes a problem, moving the file
to `public/` and switching to `fetch` is a change confined to the load step — no other
module observes the difference. Not doing it now.

### `normalize.js`

`normalize(rawRow) -> Row`, and `normalizeAll(rawIndex) -> Row[]`.

```js
{
  type:       'm5.large',        // Instance Type, primary key
  series:     'm5',              // substring before the dot, for search
  letters:    'm',               // series family letters, for natural ordering
  generation: 5,                 // series generation number
  attrs:      '',                // series attribute letters ('gd', 'i-flex', ...)
  size:       'large',           // substring after the dot
  sizeRank:   5,                 // derived, for natural ordering
  arch:       'x86',             // derived: 'arm' | 'x86'
  family:     'General purpose', // Instance Family
  vcpu:       2,
  memGiB:     8,
  storage:    'EBS only',        // original string, for display
  storageGB:  0,                 // derived, for sorting
  netLabel:   'Up to 10 Gigabit',// original string, for display
  netGbps:    10,                // derived, for sorting
  netBurst:   true,              // 'Up to' prefix present
  usd:        0.096              // per hour
}
```

Rules:

- `memGiB` — strip the ` GiB` suffix, parse float.
- `netGbps` — `/^(Up to\s+)?([\d.]+)\s*(Gigabit|Megabit)\b/i`. Multiply the number by 1
  for Gigabit, by 0.001 for Megabit. Group 1 sets `netBurst: true`, so a burstable row
  sorts on its ceiling while still displaying "Up to 10 Gigabit". The 18 qualitative
  values match nothing and get `netGbps: 0`, sorting last with `netLabel` verbatim.
- `storageGB` — two patterns, tried in order:
  `/^(\d+)\s*x\s*([\d.]+)(?:\s*GB)?\b/i` yielding count x size, then
  `/^([\d.]+)\s*GB\b/i` yielding size. `EBS only` and anything unmatched yield 0.
  The unit must be optional *as a group* — `(?:\s*GB)?`, not `GB?` — because the
  421 `N x N NVMe SSD` rows omit it entirely, and `\s*` inside the group is what lets
  the unspaced `2 x 40GB` form match.

- `usd` — `parseFloat` once, at normalization time.
- `letters` / `generation` / `attrs` — `/^([a-z]+)(\d+)([a-z0-9-]*)$/` over the substring
  before the dot. `c7i-flex` yields `('c', 7, 'i-flex')`; `p6-b200` yields
  `('p', 6, '-b200')`. Two prefixes in the fixture do not match at all — `u-3tb1` and
  `u-6tb1` — and fall back to `(series, 0, '')`, which keeps them sorted together.
- `sizeRank` — `nano`…`xlarge` map to 1–6; `<N>xlarge` maps to `6 + N`; `metal-<N>xl`
  maps to `1000 + N`; bare `metal` maps to `2000`, placing the whole machine after its
  sized variants. All 31 distinct sizes in the fixture rank.
- `arch` — `'arm'` when `attrs` starts with `g`, else `'x86'`.

Every pattern above was checked against the fixture before this spec was written: all
532 non-EBS storage strings match; all 1322 network strings either parse to a positive
number or fall into the 18 known qualitative values; all 31 sizes rank; and the `arch`
rule classifies all 1322 rows, yielding exactly the 40 Graviton prefixes. Nothing
produces `NaN`.

The `arch` rule is the only derived field with a correctness argument worth stating.
The fixture has **no processor column** — `metadata.json` exposes no secondary
selectors — so architecture is inferred from AWS's naming convention. It is safe only
because the `g` must sit in the *attribute* position: `c6g`, `m7gd`, `x2gd`, `im4gn`
and `hpc7g` are ARM, while the GPU families `g4dn`, `g6e` and `gr6` are not, since
there the `g` is the family letter. `g5g` — Graviton host with a GPU — is correctly
ARM. Intel-vs-AMD is deliberately **not** derived: 277 rows are pre-convention
generations (`m5`, `c5`, `r5`, `t3`) whose processor the name does not encode, so a
three-way split would silently hide matching rows behind an "Intel" filter.

**No field may ever be `NaN`.** A `NaN` in a comparator silently corrupts an entire
sort rather than failing loudly. Anything unparsed falls back to the `0` sentinel, and
the original string is always retained for display.

Normalization runs once at module load over all 1322 rows.

### `query.js`

`applyQuery(rows, query) -> Row[]`, pure, no mutation of the input array.

`App.svelte` holds a single state object with six keys; `applyQuery` reads the first
five and ignores `unit`, which is render-only.

```js
query = {
  search:   '',                  // matches `type` (substring, case-insensitive)
  families: Set<string>,         // empty set means no family filter
  arch:     'all',               // 'all' | 'arm' | 'x86'
  sort:     'usd',               // one of: type vcpu memGiB storageGB netGbps usd
  dir:      'asc',               // 'asc' | 'desc'
  unit:     'hour'               // 'hour' | 'month' — ignored by applyQuery
}
```

Order: filter by family, then architecture, then search, then sort.

Every column sorts numerically except `type`, which sorts in **natural AWS order** —
`letters`, then `generation`, then `attrs`, then `sizeRank`, compared in that order.
This is the whole reason those four fields exist. Plain `localeCompare` on the type
string produces `c4.2xlarge < c4.4xlarge < c4.8xlarge < c4.large < c4.xlarge`, which
scrambles the size ladder within every family, and would order a hypothetical `c10g`
before `c4g`. Natural order gives `c5.large < c5.xlarge < c5.2xlarge < … < c5.metal <
c5a.large < c6g.medium`.

Ties break on `type` so the order is stable and reproducible.

### `urlState.js`

`toSearchParams(query) -> string` and `fromSearchParams(string) -> query`, mutual
inverses. Keys: `q`, `fam` (repeated once per selected family), `arch`, `sort`, `dir`,
`unit`.

`fam` repeats rather than comma-joining because a comma-joined list cannot represent a
value containing a comma: `Set(['a,b'])` would serialise to `fam=a%2Cb` and parse back
as two families. No AWS family name contains a comma today, so the bug would have been
latent — but `params.append` / `params.getAll` costs nothing and removes the class of
error entirely.

Defaults are omitted from the URL so an untouched view has a clean address. Unknown or
malformed values fall back to the default rather than throwing — a hand-edited URL must
not white-screen the page.

`unit` lives in the URL alongside the query but is not consumed by `query.js`; it is a
render-time concern.

### Components

- **`App.svelte`** — owns the single `$state` query object, hydrates it from
  `location.search` on mount, `$derived` the visible rows via `applyQuery`, and an
  `$effect` writes changes back with `history.replaceState`. Renders the fixed context
  label "US East (N. Virginia) · Linux" and the row count.
- **`Toolbar.svelte`** — search input, 8 family filter chips, an All / ARM / x86
  architecture toggle, and the $/hour vs $/month unit toggle. Emits changes upward;
  holds no state of its own.
- **`InstanceTable.svelte`** — a dumb renderer over the derived rows. Sortable column
  headers, and the empty state. Columns: Instance Type, vCPU, Memory, Storage, Network
  Performance, Price.

The `unit` toggle multiplies `usd` by 730 at render only. It never re-sorts and never
touches the normalized data.

**Every column is right-aligned**, including Instance Type. The table is read by
comparing figures down a column, and a consistent right edge is what makes that
scanning work; `font-variant-numeric: tabular-nums` keeps the digits on a common grid.

**Typography is macOS-first**: `-apple-system, BlinkMacSystemFont, 'SF Pro Text'` for
text and `'SF Mono', Menlo, ui-monospace` for the instance type and price columns.

All 1322 rows render straight into the DOM. No virtualization: filters cut the set down
in practice, and adding a virtualizer before measuring a real problem is speculative.
If it proves sluggish, that is a follow-up with a measurement attached.

## Error handling

There is no network and no user-supplied data, so the surface is three cases:

1. **Unparsable field** — sentinel value, never `NaN`, original string kept for display.
2. **Empty result set** — an explicit "no instances match" row, not a blank table.
3. **Malformed URL parameters** — fall back to defaults silently.

## Testing

Vitest, on the three data modules only. Components are verified by running the app.

- `normalize.js` — the memory/network/storage/price coercions, including the unspaced
  storage variant and the `1024.0 GiB` form; the series parser including the `c7i-flex`,
  `p6-b200` and unparseable `u-3tb1` cases; the size ranking; and the `arch` rule
  including the `g4dn`-is-x86 / `g5g`-is-ARM distinction. One test asserts that **all
  1322 fixture rows normalize with no `NaN` and no `undefined` in any numeric field**,
  which covers every one of the 94 network strings without enumerating them, and a
  second asserts every row ranks and classifies.
- `query.js` — family filter, architecture filter, search, each sort column in both
  directions, natural type ordering, tie-breaking, empty result, and that the input
  array is not mutated. One test asserts the full natural ordering of a scrambled
  single-family ladder, since that is the behaviour `localeCompare` gets wrong.
- `urlState.js` — round-trip for a populated query, default omission, and that garbage
  input yields defaults.

## Housekeeping in scope

- Decompress `index.json`, `locations.json`, `metadata.json` in place; commit them as
  plain JSON.
- Fix the README: document all six files, and add `--compression=auto` to the `wget`
  lines so a re-fetch does not reintroduce gzip.
- Delete the Vite/Svelte scaffold: `src/lib/Counter.svelte`, `src/assets/hero.png`,
  `src/assets/svelte.svg`, `src/assets/vite.svg`, and the demo CSS in `src/app.css`.

## Out of scope

Region and OS switching, spot prices, GCP, S3, cross-region transfer. Region and OS
appear as a fixed label, not as disabled dropdowns that imply a broken feature.

The data layer takes region and OS as ordinary row fields rather than assuming a single
value, so admitting more `(region, OS)` fixture files later is an additive change to the
load step. That is the only concession made to future scope.

## Note on version control

This directory is not a git repository, so this document cannot be committed as the
brainstorming workflow normally requires. Run `git init` if you want the design and the
implementation history tracked.
