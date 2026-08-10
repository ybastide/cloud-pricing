# GCP Compute Pricing Table — Design

Date: 2026-08-10
Status: approved

## Goal

Add a GCP tab alongside the existing EC2 table: on-demand Compute Engine pricing for
one region, in the same sortable/filterable/searchable shape as the AWS MVP, plus two
small static reference tables (disk pricing, Hyperdisk compatibility) that don't fit
the instance row shape but live in the same fixtures.

Scope: **Iowa (us-central1), on-demand only**, served entirely from checked-in fixtures
extracted offline from the HTML sources. No network calls at runtime, no formula
reconstruction, no other region.

## Fixture reality

`fixtures/gcp/` holds three files, none of them structured data:

| File | Size | Contents |
| --- | --- | --- |
| `General Purpose VM pricing _ Google Cloud.html` | 35 MB | Full DOM snapshot of Google's pricing page, saved with JS already executed. 76 `<table>` elements. |
| `Google Cloud Hyperdisk overview _ _ Compute Engine _ _ Google Cloud Documentation.html` | 400 KB | Documentation page. 6 tables; only one matters here. |
| `Pricing for My Billing Account.csv` | 36 MB, 165k rows | GCP's full SKU catalog (all products, not just Compute). **Not used by this spec** — see "Why not the CSV" below. |

Unlike AWS's fixtures, none of these are close to the shape the app needs. All parsing
happens once, offline, in an extraction script — the app never touches the HTML or the
CSV.

### Why not the CSV

GCP's billing export prices per vCPU-hour and per-GB-RAM-hour, split by machine family
and by ~100 free-text city names (`"C4 Instance Core running in Frankfurt"`), not by
machine type. It has no vCPU/memory specs at all — reconstructing a per-instance price
would mean inventing a city-name→region mapping and validating a formula per family,
none of which the AWS MVP needed. The HTML fixture already has everything this spec
needs (machine type, vCPU, memory, on-demand price) for one region, with zero formula
risk. Multi-region GCP pricing from the CSV is future scope, not this spec.

### The HTML is a frozen region snapshot

The saved page has a region combobox (`Iowa (us-central1)`, confirmed at byte offset
1469545 in the file) frozen at whatever was selected when the page was saved. Every
price in this fixture is for that one region.

### Verified table structure

The 76 tables are organized under `<h2>`/`<h3>` headings. Only headings between
`"General-purpose machine type family"` and `"Tier_1 higher bandwidth network pricing"`
are in scope — everything before is page furniture, everything after is network tiers,
sole-tenant nodes, OS licensing, and disk/image pricing (disk pricing is used, from its
own two named headings — see below — not from this range).

Within that range, headings come in two shapes:

- **Group dividers** — `"C4 machine types"`, `"Tau T2D machine types"`, `"Shared-core
  machine types"` — have no table of their own; skip them, or the extraction grabs the
  *next* section's table twice.
- **Leaf sections** — `"C4 standard machine types"`, `"C4 high-memory machine types"`,
  `"C4 Standard with Local SSD"`, `"E2 shared-core machine types"`, etc. — each precedes
  exactly one table.

**Measured across all 46 leaf sections, 381 rows, verified by a script against the
actual file (not assumed):**

- **381 distinct machine types, 0 duplicates.** 14 families: `C3, C3D, C4, C4A, C4D, E2,
  N1, N2, N2D, N4, N4A, N4D, Tau T2A, Tau T2D`.
- **Two header label sets for the same fields**, both handled by the same rule below:
  `Machine type | Virtual CPUs | Memory | Price (USD)…` on most tables, `VM Shape |
  vCPUs | Memory | Local SSD | Default (USD)…` on the 52 "with Local SSD" tables (which
  add a `Local SSD` GiB column and name the type e.g. `c4-standard-4-lssd`).
- **On-demand price is always the first `$`-prefixed cell after the spec columns**, not
  a fixed column index or a fixed header label — the label itself varies (`Price (USD)`
  vs `Default* (USD)` vs `Default (USD)`, inconsistently, on the same page). Everything
  after it is CUD/commitment pricing (4, 6, 8, or 9 total cells per row depending on
  which commitment columns that family offers) — out of scope, not extracted.
- **Row boundaries are found by matching machine-type-shaped tokens**
  (`^[a-z][a-z0-9]*(-[a-z0-9]+)+$`, e.g. `c4-standard-2`, `f1-micro`), not by dividing
  the cell list by a fixed row length — row length is not constant (see above).
- **Price cells match `^\$([\d.]+) / 1 (hour|gibibyte hour)$` with zero exceptions**
  across all 381 rows — verified, not assumed.
- **Memory cells match `^[\d.]+\s*GiB$` with zero exceptions** across all 381 rows.
- **vCPU is not always an integer**: `f1-micro` is `0.2`, `g1-small` is `0.5` (both under
  `N1 shared-core machine types`). Every other row is a whole number. This is the one
  real deviation from AWS's `normalize.js`, which parses vCPU with `parseInt`.
- **"Custom vCPUs and memory" / "extended custom memory" tables are per-unit rate
  tables, not instances** — their header's first cell is literally `Item`, e.g. `Custom
  vCPUs → $0.033/hour`. Recognizable and skipped by that header check; there are 12 of
  them in range, all correctly excluded by the "first cell is `Item`" rule above.
- **`family` comes from the heading text, not the type string.** `"C4 high-memory
  machine types"` → family `C4`. This mirrors AWS's `Instance Family` being a source
  label rather than something parsed out of `Instance Type`.

### Verified disk pricing table

`"Persistent disk space pricing"` is one flat 30-row key/value table — Persistent Disk
(Standard/SSD/Balanced/Extreme, plus Regional variants) **and every Hyperdisk product**
(Extreme, Throughput, Balanced, Balanced HA, Storage Pool Throughput, Storage Pool
Balanced, ML), each with a `$/GiB-hour` space rate and, where applicable, a separate
`$/hour` IOPS or throughput rate as its own row (e.g. `Hyperdisk Extreme provisioned
IOPS`). All 30 price cells match the same `PRICE_RE` above — zero exceptions.

`"Local SSD pricing"` is a separate one-row table with CUD columns (same shape as the
instance tables); only its `Default` (on-demand) cell is taken, for consistency with
the rest of this spec's on-demand-only scope.

31 rows total feed `disks.json`.

### Verified Hyperdisk compatibility matrix

The other HTML's third `<table>` is a 42-row `Machine series × 5 Hyperdisk types` grid.
Each cell carries an unambiguous, self-documenting signal — no icon-sniffing needed:

```html
<td aria-label="A2 instances don't support Hyperdisk Balanced">
  <span style="color:red"><b>&mdash;</b></span>
</td>
<td aria-label="A3+H100 instances support Hyperdisk Balanced">
  <span class="compare-yes"></span>
</td>
```

Extraction reads the `aria-label` string directly (`"don't support"` /
`"doesn't support"` / `"aren't support"` → false, `"support"` → true) rather than
matching on the icon markup. **All 42 rows parsed with zero anomalies** — every cell
matched one of those two phrasings.

This table's scope is Google's *entire* compute catalog (42 series: accelerator
families, TPUs, memory-optimized, etc.), not just the 14 general-purpose families this
spec prices. All 14 priced families are present in it (`T2A`/`T2D` there, vs. `Tau
T2A`/`Tau T2D` in the pricing fixture — same series, different label text; the two
tables are rendered side by side, never joined, so this naming mismatch has no runtime
effect, just a footnote for whoever reads the extraction code next). The table is shown
in full — 42 rows, not filtered down to the 14 that overlap — since it's a general
reference, not something derived from the priced instance list.

## Architecture

```
scripts/extract-gcp.mjs (run manually, like the AWS wget commands)
        |
        v
fixtures/gcp/instances.json         381 rows: type, family, vcpu, memGiB, storageGB, usd
fixtures/gcp/disks.json             31 rows: name, rateType, usd
fixtures/gcp/hyperdisk-compat.json  42 rows: series, balanced, balancedHA, extreme, throughput, ml
        |
        v
src/lib/data/normalize.js    extended with normalizeGcp(raw) -> Row, reusing
                              parseMemoryGiB / parseStorageGB / parseSeries / sizeRank
        |
        v
src/lib/data/gcpInstances.js  mirrors instances.js: imports instances.json, calls
                              normalizeGcp, exports instances/families
        |
        v
src/lib/data/query.js        unchanged — applyQuery/COMPARATORS already operate on
                              the shared row shape
        |
        v
src/App.svelte  ->  provider tabs  ->  Toolbar + InstanceTable  (existing components)
                                   ->  DiskPricingPanel.svelte (new, GCP tab only)
                                   ->  HyperdiskCompatTable.svelte (new, GCP tab only)
```

### `normalizeGcp(raw)`

```js
{
  type:      'c4-standard-4-lssd',
  series:    'c4-standard-4-lssd',   // no dot to split on, unlike AWS — see below
  letters:   'c',
  generation: 4,
  attrs:     '',
  family:    'C4',                  // from the heading, not derived
  vcpu:      4,                     // float, not parseInt — f1-micro is 0.2
  memGiB:    15,
  storageGB: 375,                   // 0 for the 329 rows with no Local SSD
  usd:       0.279861781,
}
```

Reuses `parseMemoryGiB` and `sizeRank` unchanged. Does **not** reuse AWS's `series`
split-on-dot logic — GCP type strings have no dot (`c4-standard-4`, not
`c4.standard4`) — so `letters`/`generation`/`attrs` come from a GCP-specific regex over
the *first hyphen-delimited segment plus digits* (`c4` → `c`, `4`, `''`; `n2d` → `n`,
`2`, `d`), reusing `parseSeries`'s existing pattern, just fed a different substring.
`vcpu` uses `parseFloat`, not `parseInt`, to keep `f1-micro`'s `0.2` and `g1-small`'s
`0.5` correct — the two rows this spec's AWS-derived code would otherwise silently
floor to `0`.

`storageGB` is set directly from the extracted Local SSD GiB value for the 52 `-lssd`
rows (no regex parsing needed — the extraction script already isolated that column as a
number), `0` for the other 329.

No AWS field has an equivalent for `arch`, `netGbps`, `netBurst`, or `netLabel` — this
fixture carries no network or CPU-architecture data. Those fields are simply absent from
the GCP row shape rather than defaulted to a sentinel, and `query.js`'s existing
`arch`/`netGbps` comparators and filters are only ever invoked by the AWS tab's Toolbar
— the GCP Toolbar variant doesn't offer those controls, so the comparators for those
keys are never exercised against GCP rows. `COMPARATORS` and `SORT_KEYS` in `query.js`
are unchanged; a component decides which sort keys to expose, not the query layer.

### Components

- **`App.svelte`** — gains a `provider` tab state (`'aws' | 'gcp'`), included in the URL
  (`?provider=gcp&...`) alongside the existing query params. Switching tabs swaps which
  fixture's rows feed `Toolbar`/`InstanceTable`, and shows/hides the two GCP-only panels.
  Context label for the GCP tab: `"Iowa (us-central1)"` (fixed, like AWS's fixed
  region/OS label).
- **`Toolbar.svelte`** — family chips become data-driven from whichever provider is
  active (`families` prop already exists; GCP's 14 replace AWS's 8). The architecture
  toggle (All/ARM/x86) is AWS-only and hidden on the GCP tab, since the fixture carries
  no architecture data.
- **`InstanceTable.svelte`** — unchanged. Columns for GCP: Machine type, vCPU, Memory,
  Local SSD (blank for the 329 rows without one), Price. No Network Performance column
  on this tab — the field doesn't exist.
- **`DiskPricingPanel.svelte`** (new) — static render of `disks.json`'s 31 rows: name,
  rate ($/GiB-hour or $/hour), no sorting/filtering needed for 31 rows.
- **`HyperdiskCompatTable.svelte`** (new) — static render of `hyperdisk-compat.json`'s
  42 rows as a series × 5-column ✓/— grid.

## Error handling

Same three cases as the AWS spec, since the constraints are identical (no network, no
user-supplied data, fixtures are frozen at build time):

1. Unparsable field in the *extraction script* — the script asserts zero parse
   failures against the checked-in fixture (see Testing) and fails loudly if Google
   changes the page shape on a future re-extraction; it never silently emits `0`/`NaN`
   into the committed JSON the way a runtime parser would have to guard against.
2. Empty filtered result set — same explicit "no instances match" row as AWS.
3. Malformed URL parameters, including an unrecognized `provider` value — falls back to
   `provider=aws` (today's default), same silent-fallback rule as AWS's other query
   params.

## Testing

- **`scripts/extract-gcp.test.mjs`** (new) — the extraction logic is pure string/table
  parsing, tested the same way `normalize.test.js` tests AWS's regexes: feed it real
  excerpts copied from the two HTML files (one standard table, one "with Local SSD"
  table, one shared-core table with fractional vCPU, one "custom vCPUs" rate table that
  must be skipped, the disk table, three rows of the compatibility matrix including one
  `don't support` and one `support` cell) and assert the JSON it produces. One test
  asserts **all 381 real rows** extract with no parse failure, mirroring the AWS spec's
  "all 1322 fixture rows normalize with no NaN" test.
- **`normalize.test.js`** — extended with `normalizeGcp` cases: a standard row, a
  `-lssd` row (confirms `storageGB` is populated), and the two fractional-vCPU rows
  (confirms `parseFloat` not `parseInt` is in play).
- **`query.test.js`** — unchanged tests still pass unmodified (GCP rows are just more
  rows of the same shape); no new tests needed here since `applyQuery`/`COMPARATORS`
  aren't changing.
- **Playwright e2e** — one new spec: switch to the GCP tab, confirm the table renders
  381 rows collapsing under filters correctly, confirm `provider=gcp` round-trips
  through `history.replaceState` the same way the existing AWS e2e spec checks.

## Housekeeping in scope

- Add `scripts/extract-gcp.mjs` to `package.json` as a documented, manually-run script
  (not part of `build`), and document it in the README next to the AWS `wget` commands
  — including that it must be re-run if any of the three source HTML/CSV files are
  refreshed, since the committed JSON is the only thing the app reads.

## Out of scope

- Any GCP region but Iowa/us-central1 — the CSV's multi-region data is untouched.
- CUD, preemptible, sole-tenant, and reservation pricing — on-demand only.
- Tier_1 network bandwidth surcharges — a different pricing shape (per-family hourly
  upgrade fee) than "disk," excluded from the disk panel.
- Custom machine types (custom vCPU/memory sizing) — formula-based, not a fixed row.
- Joining the Hyperdisk compatibility matrix to the priced instance table (e.g.
  expanding a row to show its compatible disk types) — both render as independent
  static tables; no cross-reference UI in this spec.
