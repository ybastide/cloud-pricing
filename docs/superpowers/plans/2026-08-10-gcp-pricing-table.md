# GCP Compute Pricing Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GCP tab to the pricing app: on-demand Compute Engine pricing for Iowa
(us-central1), extracted offline from a saved HTML fixture into committed JSON, plus
two small static reference tables (disk pricing, Hyperdisk compatibility).

**Architecture:** An offline Node script parses two HTML fixtures once into three
committed JSON files. The app's existing AWS data-layer pattern (loader module → shared
normalize helpers → generic query/urlState/component layer) is extended, not forked:
`normalize.js` gains a `normalizeGcp` beside a renamed `normalizeAws`, a new
`gcpInstances.js` mirrors `awsInstances.js`, and `query.js`/`urlState.js` stay generic
across both providers. `App.svelte` gains a provider tab switch.

**Tech Stack:** Vite + Svelte 5 (runes), Vitest, Playwright. No new dependencies — the
extraction script uses only Node's built-in `fs` and regexes.

## Global Constraints

- Scope is **Iowa (us-central1), on-demand only** — no other GCP region, no CUD/
  preemptible/reservation pricing, no formula reconstruction from the billing CSV.
- The extraction script is **run manually**, never part of `vite build` — mirrors how
  the AWS fixtures are fetched once via documented `wget` commands and then committed.
- No field on a normalized row may ever be `NaN` or `undefined` in a numeric position —
  every numeric field gets a finite fallback, same rule the AWS `normalize.js` already
  follows.
- Every price cell in the source HTML matches `^\$([\d.]+) / 1 (hour|gibibyte hour)$` and
  every memory cell matches `^[\d.]+\s*GiB$` — verified against all 381 real instance
  rows and all 31 real disk rows with zero exceptions. If a re-extraction ever throws on
  these patterns, that means Google changed the page shape, not that the regex needs
  loosening — investigate before widening a pattern.
- `vcpu` is a float, not an integer (`f1-micro` is `0.2`, `g1-small` is `0.5`) — do not
  reuse AWS's `parseInt(raw.vCPU, 10)` for GCP rows.
- `family` comes from the table's heading text, never derived from the type string.
- Stage every commit by explicit path. Never `git add -A` or `git add .`.

---

### Task 1: Rename the AWS loader and normalizer for naming symmetry

**Files:**
- Rename: `src/lib/data/instances.js` → `src/lib/data/awsInstances.js`
- Modify: `src/lib/data/normalize.js`
- Modify: `src/lib/data/normalize.test.js`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: nothing new — this is a pure rename of existing, already-tested code.
- Produces: `normalizeAws(raw) -> Row` and `normalizeAllAws(index) -> Row[]` (renamed
  from `normalize`/`normalizeAll`), exported from `normalize.js`. `awsInstances.js`
  exports `instances`, `families`, `region`, `operatingSystem` — same names, same
  shapes, new file path. Task 4 adds `normalizeGcp` beside `normalizeAws` in this same
  file.

- [ ] **Step 1: Rename the file with git, so history follows it**

```bash
git mv src/lib/data/instances.js src/lib/data/awsInstances.js
```

- [ ] **Step 2: Update the renamed file's internal import**

`src/lib/data/awsInstances.js` currently imports `{ normalizeAll }` — update the call
site to the new name (the function itself is renamed in Step 3):

```js
import rawIndex from '../../../fixtures/aws/index.json'
import { normalizeAllAws } from './normalize.js'

export const instances = normalizeAllAws(rawIndex)

export const families = [...new Set(instances.map((row) => row.family))].sort()

const regionNames = Object.keys(rawIndex.regions)
const firstRow = Object.values(rawIndex.regions[regionNames[0]] ?? {})[0]

export const region = regionNames[0] ?? 'Unknown region'
export const operatingSystem = firstRow?.['Operating System'] ?? 'Unknown OS'
```

- [ ] **Step 3: Rename `normalize`/`normalizeAll` to `normalizeAws`/`normalizeAllAws`**

In `src/lib/data/normalize.js`, rename only the function declarations and their
internal call (lines 65 and 95 in the current file) — the shared helpers above them
(`parseNetwork`, `parseStorageGB`, `parseMemoryGiB`, `parseSeries`, `sizeRank`, `finite`)
are untouched:

```js
export function normalizeAws(raw) {
  const type = raw['Instance Type']
  const netLabel = raw['Network Performance']
  const storage = raw.Storage
  const { netGbps, netBurst } = parseNetwork(netLabel)

  const [series, size = ''] = type.split('.')
  const { letters, generation, attrs } = parseSeries(series)

  return {
    type,
    series,
    letters,
    generation,
    attrs,
    size,
    sizeRank: sizeRank(size),
    arch: attrs.startsWith('g') ? 'arm' : 'x86',
    family: raw['Instance Family'],
    vcpu: finite(parseInt(raw.vCPU, 10)),
    memGiB: parseMemoryGiB(raw.Memory),
    storage,
    storageGB: parseStorageGB(storage),
    netLabel,
    netGbps,
    netBurst,
    usd: finite(parseFloat(raw.price)),
  }
}

export function normalizeAllAws(index) {
  return Object.values(index.regions).flatMap((rows) =>
    Object.values(rows).map(normalizeAws),
  )
}
```

- [ ] **Step 4: Update `normalize.test.js`'s imports and calls**

Change the import line and every call site from `normalize`/`normalizeAll` to
`normalizeAws`/`normalizeAllAws` — this is a mechanical rename, every assertion stays
identical:

```js
import {
  normalizeAws,
  normalizeAllAws,
  parseMemoryGiB,
  parseNetwork,
  parseSeries,
  parseStorageGB,
  sizeRank,
} from './normalize.js'
```

Then in the file: `arch = (type) => normalize({ ... })` → `normalizeAws({ ... })`;
`describe('normalize', ...)` block's two `normalize(RAW)` calls → `normalizeAws(RAW)`;
`describe('normalizeAll over the real fixture', ...)` block's `normalizeAll(index)` →
`normalizeAllAws(index)`. No assertion values change.

- [ ] **Step 5: Update `App.svelte`'s import**

```js
import { families, instances, operatingSystem, region } from './lib/data/awsInstances.js'
```

(this is the only line in `App.svelte` that changes in this task)

- [ ] **Step 6: Run the full test suite and confirm nothing broke**

Run: `npm test`
Expected: same pass count as before this task (this is a pure rename) — no failures.

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/awsInstances.js src/lib/data/normalize.js src/lib/data/normalize.test.js src/App.svelte
git status --short  # confirm the old instances.js path is gone, not just untracked
git commit -m "refactor: rename AWS loader/normalizer for symmetry with the coming GCP counterpart

instances.js -> awsInstances.js, normalize() -> normalizeAws(), so both
providers read symmetrically once gcpInstances.js/normalizeGcp() exist,
instead of AWS being the unqualified original and GCP the one needing a
qualifier."
```

---

### Task 2: Extraction script — machine-type instances

**Files:**
- Create: `scripts/extract-gcp.mjs`
- Create: `scripts/extract-gcp.test.mjs`
- Create (generated, then committed): `fixtures/gcp/instances.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `extractInstanceRows(html) -> Array<{type, family, vcpu, memGiB, storageGB, usd}>`,
  exported from `scripts/extract-gcp.mjs`. Task 3 adds `extractDiskRows` and
  `extractHyperdiskCompat` to this same file, and its `main()` writes all three JSON
  files. Task 4's `gcpInstances.js` imports the `instances.json` this task produces —
  the field names above (`type`, `family`, `vcpu`, `memGiB`, `storageGB`, `usd`) are
  exactly what Task 4's `normalizeGcp` will read.

- [ ] **Step 1: Write the failing test**

Create `scripts/extract-gcp.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractInstanceRows } from './extract-gcp.mjs'

const EXCERPT = `
<h2>General-purpose machine type family</h2>
<h3>C4 machine types</h3>
<h3>C4 standard machine types</h3>
<table>
  <tr><th>Machine type</th><th>Virtual CPUs</th><th>Memory</th><th>Price (USD)</th><th>Compute Flexible CUD - 1 Year (USD)</th></tr>
  <tr><td>c4-standard-2</td><td>2</td><td>7 GiB</td><td>$0.096866 / 1 hour</td><td>$0.0697 / 1 hour</td></tr>
  <tr><td>c4-standard-4</td><td>4</td><td>15 GiB</td><td>$0.19767 / 1 hour</td><td>$0.1423 / 1 hour</td></tr>
</table>
<h3>C4 Standard with Local SSD</h3>
<table>
  <tr><th>VM Shape</th><th>vCPUs</th><th>Memory</th><th>Local SSD</th><th>Default (USD)</th></tr>
  <tr><td>c4-standard-4-lssd</td><td>4</td><td>15 GiB</td><td>375 GiB</td><td>$0.279861781 / 1 hour</td></tr>
</table>
<h3>N4 custom vCPUs and memory</h3>
<table>
  <tr><th>Item</th><th>Default (USD)</th></tr>
  <tr><td>Custom vCPUs</td><td>$0.033 / 1 hour</td></tr>
</table>
<h3>N1 shared-core machine types</h3>
<table>
  <tr><th>Machine type</th><th>Virtual CPUs</th><th>Memory</th><th>Default (USD)</th></tr>
  <tr><td>f1-micro</td><td>0.2</td><td>0.60 GiB</td><td>$0.0076 / 1 hour</td></tr>
  <tr><td>g1-small</td><td>0.5</td><td>1.70 GiB</td><td>$0.0257 / 1 hour</td></tr>
</table>
<h2>Tier_1 higher bandwidth network pricing</h2>
<h3>Some later section</h3>
<table><tr><th>Item</th><th>Default (USD)</th></tr><tr><td>Not in scope</td><td>$1 / 1 hour</td></tr></table>
`

describe('extractInstanceRows', () => {
  const rows = extractInstanceRows(EXCERPT)

  it('extracts every row across standard, with-Local-SSD, and shared-core tables', () => {
    expect(rows.map((r) => r.type).sort()).toEqual([
      'c4-standard-2',
      'c4-standard-4',
      'c4-standard-4-lssd',
      'f1-micro',
      'g1-small',
    ])
  })

  it('skips the custom-vCPUs rate table entirely', () => {
    expect(rows.find((r) => r.type === 'Custom vCPUs')).toBeUndefined()
  })

  it('skips content after the section boundary', () => {
    expect(rows.find((r) => r.type === 'Not in scope')).toBeUndefined()
  })

  it('assigns family from the heading, stripping the qualifier', () => {
    const c4 = rows.find((r) => r.type === 'c4-standard-2')
    expect(c4.family).toBe('C4')
    const lssd = rows.find((r) => r.type === 'c4-standard-4-lssd')
    expect(lssd.family).toBe('C4')
    const shared = rows.find((r) => r.type === 'f1-micro')
    expect(shared.family).toBe('N1')
  })

  it('parses the on-demand price, not a CUD column', () => {
    expect(rows.find((r) => r.type === 'c4-standard-2').usd).toBeCloseTo(0.096866)
    expect(rows.find((r) => r.type === 'c4-standard-4').usd).toBeCloseTo(0.19767)
  })

  it('populates storageGB only for the with-Local-SSD row', () => {
    expect(rows.find((r) => r.type === 'c4-standard-4-lssd').storageGB).toBe(375)
    expect(rows.find((r) => r.type === 'c4-standard-2').storageGB).toBe(0)
  })

  it('keeps fractional vCPU counts exact, not floored to zero', () => {
    expect(rows.find((r) => r.type === 'f1-micro').vcpu).toBe(0.2)
    expect(rows.find((r) => r.type === 'g1-small').vcpu).toBe(0.5)
  })

  it('parses memGiB as a number', () => {
    expect(rows.find((r) => r.type === 'c4-standard-4').memGiB).toBe(15)
  })
})

describe('extractInstanceRows over the real fixture', () => {
  const files = readFileSync('fixtures/gcp/General Purpose VM pricing _ Google Cloud.html', 'utf8')
  const rows = extractInstanceRows(files)

  it('extracts exactly 381 rows with no duplicate type', () => {
    expect(rows).toHaveLength(381)
    expect(new Set(rows.map((r) => r.type)).size).toBe(381)
  })

  it('produces a finite number for every numeric field in every row', () => {
    const bad = rows.filter(
      (r) =>
        !Number.isFinite(r.vcpu) ||
        !Number.isFinite(r.memGiB) ||
        !Number.isFinite(r.storageGB) ||
        !Number.isFinite(r.usd),
    )
    expect(bad).toEqual([])
  })

  it('gives every row a positive price', () => {
    expect(rows.every((r) => r.usd > 0)).toBe(true)
  })

  it('finds all 14 families and no others', () => {
    expect(new Set(rows.map((r) => r.family))).toEqual(
      new Set(['C3', 'C3D', 'C4', 'C4A', 'C4D', 'E2', 'N1', 'N2', 'N2D', 'N4', 'N4A', 'N4D', 'Tau T2A', 'Tau T2D']),
    )
  })

  it('finds exactly 52 rows with a Local SSD', () => {
    expect(rows.filter((r) => r.storageGB > 0)).toHaveLength(52)
  })

  it('keeps the two fractional-vCPU rows exact', () => {
    expect(rows.find((r) => r.type === 'f1-micro').vcpu).toBe(0.2)
    expect(rows.find((r) => r.type === 'g1-small').vcpu).toBe(0.5)
  })
})
```

Note: the second `describe` block reads the real 35 MB fixture directly, the same way
`normalize.test.js` reads the real `fixtures/aws/index.json` — this is intentional, not
a mistake to "optimize away." It is the only thing that proves the regexes below
actually work against Google's real markup, not just a hand-written excerpt.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/extract-gcp.test.mjs`
Expected: FAIL — `extract-gcp.mjs` does not exist yet, so the import fails.

- [ ] **Step 3: Write the extraction logic**

Create `scripts/extract-gcp.mjs`:

```js
const GENERAL_PURPOSE_START = 'General-purpose machine type family'
const GENERAL_PURPOSE_END = 'Tier_1 higher bandwidth network pricing'
const DIVIDER_HEADING = /^(?:Tau )?[A-Za-z0-9]+ machine types$|^Shared-core machine types$/
const TYPE_TOKEN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/
const PRICE_TOKEN = /^\$([\d.]+) \/ 1 (hour|gibibyte hour)$/
const MEMORY_TOKEN = /^([\d.]+)\s*GiB$/
const FAMILY_QUALIFIER =
  /^(.+?) (?:standard|high-memory|high-CPU|high-cpu|shared-core|Standard with Local SSD|Highmem with Local SSD)(?: machine types)?$/

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/[​﻿]/g, '') // Google's page has at least one stray BOM in a heading
    .replace(/\s+/g, ' ')
    .trim()
}

function findHeadings(html) {
  const re = /<h[23][^>]*>(.*?)<\/h[23]>/gs
  const out = []
  let m
  while ((m = re.exec(html))) out.push({ index: m.index, text: stripTags(m[1]) })
  return out
}

function findTables(html) {
  const re = /<table.*?<\/table>/gs
  const out = []
  let m
  while ((m = re.exec(html))) out.push({ index: m.index, html: m[0] })
  return out
}

function tableCells(tableHtml) {
  const re = /<t[dh][^>]*>(.*?)<\/t[dh]>/gs
  const out = []
  let m
  while ((m = re.exec(tableHtml))) {
    const text = stripTags(m[1])
    if (text) out.push(text)
  }
  return out
}

function familyFromHeading(heading) {
  const match = FAMILY_QUALIFIER.exec(heading)
  return match ? match[1] : heading
}

function parseInstanceRow(cells, family) {
  const [type, vcpuCell, memCell, ...rest] = cells
  const memMatch = MEMORY_TOKEN.exec(memCell)
  const memGiB = memMatch ? parseFloat(memMatch[1]) : 0

  // "with Local SSD" tables insert a Local SSD GiB column before the price columns —
  // distinguish it from the price column by the absence of a leading '$'.
  let storageGB = 0
  let priceCells = rest
  if (rest[0] && !rest[0].startsWith('$') && MEMORY_TOKEN.test(rest[0])) {
    storageGB = parseFloat(MEMORY_TOKEN.exec(rest[0])[1])
    priceCells = rest.slice(1)
  }

  const priceCell = priceCells.find((c) => c.startsWith('$'))
  const priceMatch = priceCell ? PRICE_TOKEN.exec(priceCell) : null

  return {
    type,
    family,
    vcpu: parseFloat(vcpuCell),
    memGiB,
    storageGB,
    usd: priceMatch ? parseFloat(priceMatch[1]) : 0,
  }
}

export function extractInstanceRows(html) {
  const headings = findHeadings(html)
  const tables = findTables(html)

  const start = headings.find((h) => h.text === GENERAL_PURPOSE_START)
  const end = headings.find((h) => h.text === GENERAL_PURPOSE_END)
  if (!start || !end) {
    throw new Error('Could not find the general-purpose machine type section boundaries')
  }

  const rows = []
  for (const heading of headings) {
    if (heading.index <= start.index || heading.index >= end.index) continue
    if (heading.text === 'Consumption model ID:') continue
    if (DIVIDER_HEADING.test(heading.text)) continue

    const table = tables.find((t) => t.index > heading.index)
    if (!table) continue

    const cells = tableCells(table.html)
    const firstTypeIdx = cells.findIndex((c) => TYPE_TOKEN.test(c))
    if (firstTypeIdx === -1) continue
    if (cells[0] === 'Item') continue // per-unit rate table, e.g. "custom vCPUs and memory"

    const family = familyFromHeading(heading.text)
    const dataCells = cells.slice(firstTypeIdx)
    const typeIdxs = []
    dataCells.forEach((c, i) => {
      if (TYPE_TOKEN.test(c)) typeIdxs.push(i)
    })

    for (let j = 0; j < typeIdxs.length; j++) {
      const from = typeIdxs[j]
      const to = typeIdxs[j + 1] ?? dataCells.length
      rows.push(parseInstanceRow(dataCells.slice(from, to), family))
    }
  }
  return rows
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/extract-gcp.test.mjs`
Expected: all tests in both `describe` blocks PASS, including the 381-row count against
the real fixture.

- [ ] **Step 5: Add the CLI entry point and generate the real fixture**

Append to `scripts/extract-gcp.mjs` (this part is exercised by running the script, not
by the test file — it does file I/O, which the pure functions above deliberately don't):

```js
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

function findFixture(prefix) {
  const files = readdirSync('fixtures/gcp')
  const match = files.find((f) => f.startsWith(prefix))
  if (!match) throw new Error(`No file starting with "${prefix}" in fixtures/gcp`)
  return `fixtures/gcp/${match}`
}

function main() {
  const pricingHtml = readFileSync(findFixture('General Purpose VM pricing'), 'utf8')
  const instances = extractInstanceRows(pricingHtml)
  writeFileSync('fixtures/gcp/instances.json', JSON.stringify(instances, null, 2) + '\n')
  console.log(`instances: ${instances.length} rows`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
```

(`findFixture` matches by prefix rather than a literal path because the real filenames
on disk use non-breaking spaces around their underscores, not regular spaces — a
literal path string here would silently fail to open the file.)

- [ ] **Step 6: Run the script for real and inspect the output**

Run: `node scripts/extract-gcp.mjs`
Expected output: `instances: 381 rows`
Then: `cat fixtures/gcp/instances.json | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).length)"`
Expected: `381`

- [ ] **Step 7: Commit, including the generated fixture**

```bash
git add scripts/extract-gcp.mjs scripts/extract-gcp.test.mjs fixtures/gcp/instances.json
git commit -m "feat: extract GCP machine-type pricing from the HTML fixture into instances.json

381 rows across 14 families (C3, C3D, C4, C4A, C4D, E2, N1, N2, N2D, N4,
N4A, N4D, Tau T2A, Tau T2D), Iowa/us-central1 on-demand only. Verified
against the real 35MB fixture with zero parse failures on price, memory,
or vCPU across every row."
```

---

### Task 3: Extraction script — disk pricing and Hyperdisk compatibility

**Files:**
- Modify: `scripts/extract-gcp.mjs`
- Modify: `scripts/extract-gcp.test.mjs`
- Create (generated, then committed): `fixtures/gcp/disks.json`
- Create (generated, then committed): `fixtures/gcp/hyperdisk-compat.json`

**Interfaces:**
- Consumes: `stripTags`, `findHeadings`, `findTables`, `tableCells`, `PRICE_TOKEN` from
  Task 2's `scripts/extract-gcp.mjs` (same file, same module scope — no import needed).
- Produces: `extractDiskRows(html) -> Array<{name, rateType, usd}>` where `rateType` is
  `'space' | 'iops' | 'throughput'`, and `extractHyperdiskCompat(html) ->
  Array<{series, balanced, balancedHA, extreme, throughput, ml}>` (booleans), both
  exported from `scripts/extract-gcp.mjs`. `disks.json`/`hyperdisk-compat.json` are what
  Task 5's `DiskPricingPanel.svelte`/`HyperdiskCompatTable.svelte` import directly.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/extract-gcp.test.mjs`:

```js
import { extractDiskRows, extractHyperdiskCompat } from './extract-gcp.mjs'

const DISK_EXCERPT = `
<h3>Persistent disk space pricing</h3>
<table>
  <tr><th>Item</th><th>Default (USD)</th></tr>
  <tr><td>Standard provisioned space</td><td>$0.000054795 / 1 gibibyte hour</td></tr>
  <tr><td>Hyperdisk Extreme provisioned IOPS</td><td>$0.000043836 / 1 hour</td></tr>
</table>
<h3>Local SSD pricing</h3>
<table>
  <tr><th>Type</th><th>Default (USD)</th><th>Compute Flexible CUD - 1 Year (USD)</th><th>Compute Flexible CUD - 3 Year (USD)</th><th>Compute Resource CUDs - 1 Year (USD)</th><th>Compute Resource CUDs - 3 Year (USD)</th></tr>
  <tr><td>Local SSD provisioned space</td><td>$0.000109589 / 1 gibibyte hour</td><td>$0.000078904 / 1 gibibyte hour</td><td>$0.000059178 / 1 gibibyte hour</td><td>$0.000069041 / 1 gibibyte hour</td><td>$0.000049315 / 1 gibibyte hour</td></tr>
</table>
`

describe('extractDiskRows', () => {
  const rows = extractDiskRows(DISK_EXCERPT)

  it('extracts persistent disk and Local SSD rows', () => {
    expect(rows.map((r) => r.name)).toEqual([
      'Standard provisioned space',
      'Hyperdisk Extreme provisioned IOPS',
      'Local SSD provisioned space',
    ])
  })

  it('classifies rate type from the row name', () => {
    expect(rows.find((r) => r.name === 'Standard provisioned space').rateType).toBe('space')
    expect(rows.find((r) => r.name === 'Hyperdisk Extreme provisioned IOPS').rateType).toBe('iops')
  })

  it('takes only the Default (on-demand) column for Local SSD, not a CUD column', () => {
    expect(rows.find((r) => r.name === 'Local SSD provisioned space').usd).toBeCloseTo(0.000109589)
  })
})

describe('extractDiskRows over the real fixture', () => {
  const html = readFileSync('fixtures/gcp/General Purpose VM pricing _ Google Cloud.html', 'utf8')
  const rows = extractDiskRows(html)

  it('extracts exactly 31 rows', () => {
    expect(rows).toHaveLength(31)
  })

  it('gives every row a positive price', () => {
    expect(rows.every((r) => r.usd > 0)).toBe(true)
  })
})

const COMPAT_EXCERPT = `
<table>
  <tr><th>Machine series</th><th>Hyperdisk Balanced</th><th>Hyperdisk Balanced HA</th><th>Hyperdisk Extreme</th><th>Hyperdisk Throughput</th><th>Hyperdisk ML</th></tr>
  <tr>
    <td><a href='/x'>A2</a></td>
    <td aria-label="A2 instances don't support Hyperdisk Balanced"><span style="color:red"><b>&mdash;</b></span></td>
    <td aria-label="A2 instances don't support Hyperdisk Balanced HA"><span style="color:red"><b>&mdash;</b></span></td>
    <td aria-label="A2 instances don't support Hyperdisk Extreme"><span style="color:red"><b>&mdash;</b></span></td>
    <td aria-label="A2 instances don't support Hyperdisk Throughput"><span style="color:red"><b>&mdash;</b></span></td>
    <td aria-label="A2 instances support Hyperdisk ML"><span class="compare-yes"></span></td>
  </tr>
  <tr>
    <td><a href='/y'>C4</a></td>
    <td aria-label="C4 instances support Hyperdisk Balanced"><span class="compare-yes"></span></td>
    <td aria-label="C4 instances support Hyperdisk Balanced HA"><span class="compare-yes"></span></td>
    <td aria-label="C4 instances support Hyperdisk Extreme"><span class="compare-yes"></span></td>
    <td aria-label="C4 instances support Hyperdisk Throughput"><span class="compare-yes"></span></td>
    <td aria-label="C4 instances support Hyperdisk ML"><span class="compare-yes"></span></td>
  </tr>
</table>
`

describe('extractHyperdiskCompat', () => {
  const rows = extractHyperdiskCompat(COMPAT_EXCERPT)

  it('reads the aria-label, not the icon markup', () => {
    expect(rows).toEqual([
      { series: 'A2', balanced: false, balancedHA: false, extreme: false, throughput: false, ml: true },
      { series: 'C4', balanced: true, balancedHA: true, extreme: true, throughput: true, ml: true },
    ])
  })
})

describe('extractHyperdiskCompat over the real fixture', () => {
  const files = readdirSync('fixtures/gcp')
  const hyperdiskFile = files.find((f) => f.includes('Hyperdisk overview'))
  const html = readFileSync(`fixtures/gcp/${hyperdiskFile}`, 'utf8')
  const rows = extractHyperdiskCompat(html)

  it('extracts exactly 42 machine series', () => {
    expect(rows).toHaveLength(42)
  })

  it('includes every family this app prices', () => {
    const series = new Set(rows.map((r) => r.series))
    for (const s of ['C3', 'C3D', 'C4', 'C4A', 'C4D', 'E2', 'N1', 'N2', 'N2D', 'N4', 'N4A', 'N4D', 'T2A', 'T2D']) {
      expect(series.has(s)).toBe(true)
    }
  })
})
```

Add `readdirSync` to the existing `node:fs` import at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/extract-gcp.test.mjs`
Expected: FAIL — `extractDiskRows` and `extractHyperdiskCompat` are not exported yet.

- [ ] **Step 3: Write the disk and Hyperdisk-compatibility extraction logic**

Insert into `scripts/extract-gcp.mjs`, above the `findFixture`/`main` block added in
Task 2:

```js
function parseDiskRow(name, priceCell) {
  const match = PRICE_TOKEN.exec(priceCell)
  const rateType = name.endsWith('IOPS') ? 'iops' : name.endsWith('throughput') ? 'throughput' : 'space'
  return { name, rateType, usd: match ? parseFloat(match[1]) : 0 }
}

export function extractDiskRows(html) {
  const headings = findHeadings(html)
  const tables = findTables(html)
  const rows = []

  const persistentHeading = headings.find((h) => h.text === 'Persistent disk space pricing')
  const persistentTable = tables.find((t) => t.index > persistentHeading.index)
  const pCells = tableCells(persistentTable.html).slice(2) // drop the 2-cell header row
  for (let i = 0; i < pCells.length; i += 2) {
    rows.push(parseDiskRow(pCells[i], pCells[i + 1]))
  }

  const localSsdHeading = headings.find((h) => h.text === 'Local SSD pricing')
  const localSsdTable = tables.find((t) => t.index > localSsdHeading.index)
  const lCells = tableCells(localSsdTable.html)
  // 6-cell header (Type + 5 price columns), then the row: name at index 6, Default price at index 7
  rows.push(parseDiskRow(lCells[6], lCells[7]))

  return rows
}

const DISK_TYPES = ['Hyperdisk Balanced', 'Hyperdisk Balanced HA', 'Hyperdisk Extreme', 'Hyperdisk Throughput', 'Hyperdisk ML']

export function extractHyperdiskCompat(html) {
  const tables = findTables(html)
  const compatTable = tables.find((t) => tableCells(t.html)[0] === 'Machine series')
  if (!compatTable) throw new Error('Could not find the Hyperdisk compatibility table')

  const rowsHtml = compatTable.html.match(/<tr[^>]*>.*?<\/tr>/gs) ?? []
  return rowsHtml.slice(1).map((rowHtml) => {
    const tds = rowHtml.match(/<td[^>]*>.*?<\/td>/gs) ?? []
    const series = stripTags(tds[0])
    const flags = tds.slice(1).map((td, i) => {
      const m = /aria-label="([^"]*)"/.exec(td)
      const label = m ? m[1] : ''
      if (/don't support|doesn't support|aren't support/.test(label)) return false
      if (/support/.test(label)) return true
      throw new Error(`Ambiguous Hyperdisk compatibility label for ${series} / ${DISK_TYPES[i]}: "${label}"`)
    })
    return {
      series,
      balanced: flags[0],
      balancedHA: flags[1],
      extreme: flags[2],
      throughput: flags[3],
      ml: flags[4],
    }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/extract-gcp.test.mjs`
Expected: all tests PASS, including the 31-row and 42-row real-fixture counts.

- [ ] **Step 5: Wire both into the CLI entry point**

Replace the `main()` function added in Task 2 with:

```js
function main() {
  const pricingHtml = readFileSync(findFixture('General Purpose VM pricing'), 'utf8')
  const hyperdiskHtml = readFileSync(findFixture('Google Cloud Hyperdisk overview'), 'utf8')

  const instances = extractInstanceRows(pricingHtml)
  const disks = extractDiskRows(pricingHtml)
  const hyperdiskCompat = extractHyperdiskCompat(hyperdiskHtml)

  writeFileSync('fixtures/gcp/instances.json', JSON.stringify(instances, null, 2) + '\n')
  writeFileSync('fixtures/gcp/disks.json', JSON.stringify(disks, null, 2) + '\n')
  writeFileSync('fixtures/gcp/hyperdisk-compat.json', JSON.stringify(hyperdiskCompat, null, 2) + '\n')

  console.log(`instances: ${instances.length} rows`)
  console.log(`disks: ${disks.length} rows`)
  console.log(`hyperdisk-compat: ${hyperdiskCompat.length} rows`)
}
```

- [ ] **Step 6: Run the script for real**

Run: `node scripts/extract-gcp.mjs`
Expected output:
```
instances: 381 rows
disks: 31 rows
hyperdisk-compat: 42 rows
```

- [ ] **Step 7: Commit**

```bash
git add scripts/extract-gcp.mjs scripts/extract-gcp.test.mjs fixtures/gcp/disks.json fixtures/gcp/hyperdisk-compat.json
git commit -m "feat: extract GCP disk pricing and Hyperdisk compatibility into JSON fixtures

disks.json: 31 rows (Persistent Disk + every Hyperdisk product + Local
SSD, on-demand only). hyperdisk-compat.json: 42 machine series x 5
Hyperdisk types, read from the documentation page's aria-label text
rather than icon markup — self-documenting and unambiguous."
```

---

### Task 4: `normalizeGcp` and the `gcpInstances.js` data module

**Files:**
- Modify: `src/lib/data/normalize.js`
- Modify: `src/lib/data/normalize.test.js`
- Create: `src/lib/data/gcpInstances.js`

**Interfaces:**
- Consumes: `fixtures/gcp/instances.json` (Task 2's output — fields `type`, `family`,
  `vcpu`, `memGiB`, `storageGB`, `usd`). Reuses `parseMemoryGiB`, `sizeRank`, `finite`
  from the existing `normalize.js`.
- Produces: `normalizeGcp(raw) -> Row` where `Row` is
  `{type, series, letters, generation, attrs, family, vcpu, memGiB, storageGB, sizeRank, usd}`
  (no `size`, `arch`, `netGbps`, `netBurst`, `netLabel` — this fixture has none of
  those). `src/lib/data/gcpInstances.js` exports `instances`, `families`, `region`
  (`'Iowa (us-central1)'`) — same export names as `awsInstances.js`, so Task 5's
  `App.svelte` change can treat both providers uniformly.

**Note on `sizeRank`:** the design spec's example `normalizeGcp` row omitted `sizeRank`,
but `query.js`'s existing `type` comparator reads `a.sizeRank - b.sizeRank`
unconditionally — an omitted field there would produce `NaN` and silently corrupt
sorting by type, which is exactly the failure mode `normalize.js`'s own house rule
forbids. Fix: `sizeRank: vcpu`, so within the same family/generation/attrs group, more
vCPUs sorts after fewer (e.g. `c4-standard-2` before `c4-standard-4`).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/data/normalize.test.js`:

```js
import { normalizeGcp } from './normalize.js'

const GCP_RAW = {
  type: 'c4-standard-4',
  family: 'C4',
  vcpu: 4,
  memGiB: 15,
  storageGB: 0,
  usd: 0.19767,
}

describe('normalizeGcp', () => {
  it('maps a standard row to the typed shape', () => {
    expect(normalizeGcp(GCP_RAW)).toEqual({
      type: 'c4-standard-4',
      series: 'c4-standard-4',
      letters: 'c',
      generation: 4,
      attrs: '',
      family: 'C4',
      vcpu: 4,
      memGiB: 15,
      storageGB: 0,
      sizeRank: 4,
      usd: 0.19767,
    })
  })

  it('splits letters/generation/attrs from the first hyphenated segment, not the whole type', () => {
    expect(normalizeGcp({ ...GCP_RAW, type: 'n2d-highmem-8', family: 'N2D' })).toMatchObject({
      letters: 'n',
      generation: 2,
      attrs: 'd',
    })
    expect(normalizeGcp({ ...GCP_RAW, type: 't2a-standard-1', family: 'Tau T2A' })).toMatchObject({
      letters: 't',
      generation: 2,
      attrs: 'a',
    })
  })

  it('keeps fractional vCPU counts exact', () => {
    const row = normalizeGcp({ ...GCP_RAW, type: 'f1-micro', family: 'N1', vcpu: 0.2, memGiB: 0.6 })
    expect(row.vcpu).toBe(0.2)
    expect(row.sizeRank).toBe(0.2)
  })

  it('carries storageGB through for a Local SSD row', () => {
    const row = normalizeGcp({ ...GCP_RAW, type: 'c4-standard-4-lssd', storageGB: 375 })
    expect(row.storageGB).toBe(375)
  })

  it('has no NaN when a field is missing', () => {
    const row = normalizeGcp({ type: 'x-unknown-1', family: 'X' })
    expect(Number.isFinite(row.vcpu)).toBe(true)
    expect(Number.isFinite(row.memGiB)).toBe(true)
    expect(Number.isFinite(row.storageGB)).toBe(true)
    expect(Number.isFinite(row.sizeRank)).toBe(true)
    expect(Number.isFinite(row.usd)).toBe(true)
    expect(Number.isFinite(row.generation)).toBe(true)
  })
})

describe('normalizeGcp over the real fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/gcp/instances.json', 'utf8'))
  const rows = raw.map(normalizeGcp)

  it('returns every row', () => {
    expect(rows).toHaveLength(381)
  })

  it('produces a finite number for every numeric field in every row', () => {
    const bad = rows.filter(
      (r) =>
        !Number.isFinite(r.vcpu) ||
        !Number.isFinite(r.memGiB) ||
        !Number.isFinite(r.storageGB) ||
        !Number.isFinite(r.sizeRank) ||
        !Number.isFinite(r.usd) ||
        !Number.isFinite(r.generation),
    )
    expect(bad).toEqual([])
  })

  it('keys uniquely on type', () => {
    expect(new Set(rows.map((r) => r.type)).size).toBe(381)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: FAIL — `normalizeGcp` is not exported yet.

- [ ] **Step 3: Write `normalizeGcp`**

Append to `src/lib/data/normalize.js` (below `normalizeAllAws`):

```js
const GCP_SERIES = /^([a-z]+)(\d+)([a-z0-9-]*)$/i

export function normalizeGcp(raw) {
  const type = raw.type
  const [firstSegment = ''] = type.split('-')
  const match = GCP_SERIES.exec(firstSegment)
  const letters = match ? match[1] : firstSegment
  const generation = match ? finite(parseInt(match[2], 10)) : 0
  const attrs = match ? match[3] : ''
  const vcpu = finite(raw.vcpu)

  return {
    type,
    series: type,
    letters,
    generation,
    attrs,
    family: raw.family,
    vcpu,
    memGiB: finite(raw.memGiB),
    storageGB: finite(raw.storageGB),
    sizeRank: vcpu,
    usd: finite(raw.usd),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: all tests PASS, including both the AWS and the new GCP describe blocks.

- [ ] **Step 5: Create `gcpInstances.js`**

```js
import rawInstances from '../../../fixtures/gcp/instances.json'
import { normalizeGcp } from './normalize.js'

export const instances = rawInstances.map(normalizeGcp)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = 'Iowa (us-central1)'
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new GCP ones and the untouched AWS ones.

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/normalize.js src/lib/data/normalize.test.js src/lib/data/gcpInstances.js
git commit -m "feat: add normalizeGcp and gcpInstances.js

Mirrors awsInstances.js's export shape (instances/families/region) so
App.svelte can treat both providers uniformly. sizeRank is set to vcpu -
the design spec's row shape omitted it, but query.js's existing type
comparator reads it unconditionally; without it, sorting GCP rows by
type would produce NaN."
```

---

### Task 5: Provider tabs, disk-pricing panel, and Hyperdisk compatibility table

**Files:**
- Modify: `src/lib/data/urlState.js`
- Modify: `src/lib/data/urlState.test.js`
- Modify: `src/lib/data/query.js`
- Modify: `src/lib/data/query.test.js`
- Modify: `src/lib/Toolbar.svelte`
- Modify: `src/lib/InstanceTable.svelte`
- Modify: `src/App.svelte`
- Create: `src/lib/DiskPricingPanel.svelte`
- Create: `src/lib/HyperdiskCompatTable.svelte`
- Modify: `src/app.css`

**Interfaces:**
- Consumes: `instances`/`families`/`region` from both `awsInstances.js` (Task 1) and
  `gcpInstances.js` (Task 4); `fixtures/gcp/disks.json` and
  `fixtures/gcp/hyperdisk-compat.json` (Task 3).
- Produces: `defaultQuery()` now includes a `provider` key (`'aws' | 'gcp'`, default
  `'aws'`); `Toolbar` gains `showArch` (boolean, default `true`) and `placeholders`
  (object, default the existing AWS map) props; `InstanceTable` gains a `columns` prop
  (array, default the existing AWS 6-column set) so GCP can supply its own column list
  instead of inheriting AWS's `Network` column, which GCP rows have no data for. Task
  6's e2e spec drives the UI this task builds.

**Why `InstanceTable` needs a `columns` prop, not just reuse:** its `COLUMNS` array and
row template are hardcoded to AWS's six fields, including `netGbps`/`netLabel`. GCP rows
carry neither field. Left as-is, the GCP tab would render a `Network` column bound to
`undefined` on every row, and `query.js`'s existing `netGbps: (a, b) => a.netGbps - b.netGbps`
comparator would compute `undefined - undefined` — `NaN` — the instant a user clicked
that column header, silently scrambling the sort. This is the same class of bug the
design spec's own `normalizeGcp` section (and Task 4's `sizeRank` fix) exists to prevent;
it just surfaces in the table component instead of the data layer.

- [ ] **Step 1: Write the failing `urlState` tests**

Append to `src/lib/data/urlState.test.js`:

```js
describe('provider in the query state', () => {
  it('defaults to aws', () => {
    expect(defaultQuery().provider).toBe('aws')
  })

  it('omits provider from the URL when it is the default', () => {
    expect(toSearchParams({ ...defaultQuery(), provider: 'aws' })).toBe('')
  })

  it('serialises a non-default provider', () => {
    expect(toSearchParams({ ...defaultQuery(), provider: 'gcp' })).toBe('provider=gcp')
  })

  it('accepts a known provider', () => {
    expect(fromSearchParams('provider=gcp').provider).toBe('gcp')
  })

  it('falls back to aws for an unknown provider', () => {
    expect(fromSearchParams('provider=azure').provider).toBe('aws')
  })

  it('round-trips a gcp query with other fields set', () => {
    const query = { ...defaultQuery(), provider: 'gcp', search: 'c4', sort: 'vcpu', dir: 'desc' }
    expect(fromSearchParams(toSearchParams(query))).toEqual(query)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: FAIL — `defaultQuery()` has no `provider` key yet.

- [ ] **Step 3: Add `provider` to `urlState.js`**

```js
import { DEFAULT_DIR, DEFAULT_SORT, SORT_KEYS } from './query.js'

const DEFAULT_UNIT = 'hour'
const DEFAULT_ARCH = 'all'
const DEFAULT_PROVIDER = 'aws'
const ARCHES = ['arm', 'x86']
const PROVIDERS = ['aws', 'gcp']

export function defaultQuery() {
  return {
    provider: DEFAULT_PROVIDER,
    search: '',
    families: new Set(),
    arch: DEFAULT_ARCH,
    sort: DEFAULT_SORT,
    dir: DEFAULT_DIR,
    unit: DEFAULT_UNIT,
  }
}

export function toSearchParams(query) {
  const params = new URLSearchParams()
  if (query.provider && query.provider !== DEFAULT_PROVIDER) params.set('provider', query.provider)
  if (query.search) params.set('q', query.search)
  for (const family of query.families ?? []) params.append('fam', family)
  if (query.arch && query.arch !== DEFAULT_ARCH) params.set('arch', query.arch)
  if (query.sort && query.sort !== DEFAULT_SORT) params.set('sort', query.sort)
  if (query.dir && query.dir !== DEFAULT_DIR) params.set('dir', query.dir)
  if (query.unit && query.unit !== DEFAULT_UNIT) params.set('unit', query.unit)
  return params.toString()
}

export function fromSearchParams(search) {
  const params = new URLSearchParams(search)
  const query = defaultQuery()

  const provider = params.get('provider')
  if (provider && PROVIDERS.includes(provider)) query.provider = provider

  query.search = params.get('q') ?? ''

  const families = params.getAll('fam').filter(Boolean)
  if (families.length) query.families = new Set(families)

  const arch = params.get('arch')
  if (arch && ARCHES.includes(arch)) query.arch = arch

  const sort = params.get('sort')
  if (sort && SORT_KEYS.includes(sort)) query.sort = sort

  if (params.get('dir') === 'desc') query.dir = 'desc'
  if (params.get('unit') === 'month') query.unit = 'month'

  return query
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: all tests PASS, including the pre-existing AWS-only ones (no default changed
for them — `provider` simply wasn't a key they asserted on before, and
`toEqual(defaultQuery())`-style assertions still pass because both sides now include
the same new key).

- [ ] **Step 5: Make `query.js`'s `netGbps` comparator defensive to a missing field**

A hand-typed URL like `?provider=gcp&sort=netGbps` passes `urlState.js`'s validation —
`netGbps` genuinely is a valid `SORT_KEYS` entry, just not for GCP rows — and reaches
`COMPARATORS.netGbps` with `a.netGbps`/`b.netGbps` both `undefined` on every row, since
GCP rows carry no network field by design (per the spec's `normalizeGcp` section).
`undefined - undefined` is `NaN`, and a `NaN`-returning comparator doesn't throw, it
silently produces an inconsistent sort order — worse than the "malformed URL" case the
AWS spec already handles, because nothing visibly indicates anything went wrong. This is
the same class of gap Task 4's `sizeRank` fix and this task's `columns` prop fix close
elsewhere; closing it here too rather than leaving one instance undefended.

First, extend `src/lib/data/query.test.js` with a case that would fail without the fix:

```js
it('does not corrupt sort order when netGbps is absent from every row', () => {
  const noNetwork = rows.map((r) => {
    const { netGbps, ...rest } = r
    return rest
  })
  const out = applyQuery(noNetwork, { ...base, sort: 'netGbps' })
  expect(out.every((r) => Number.isFinite(r.usd))).toBe(true)
  expect(out).toHaveLength(noNetwork.length)
})
```

Run: `npx vitest run src/lib/data/query.test.js` — this specific test passes even
without the fix below (a `NaN`-scrambled order is still a full-length array of valid
rows, just possibly reordered), so it does not prove much on its own; the real
protection is the fix itself plus Task 6's e2e test that exercises the actual URL. Apply
the fix regardless — it is one line, matching the `?? 0` pattern rather than assuming
the field exists:

```js
const COMPARATORS = {
  type: (a, b) =>
    a.letters.localeCompare(b.letters) ||
    a.generation - b.generation ||
    a.attrs.localeCompare(b.attrs) ||
    a.sizeRank - b.sizeRank,
  vcpu: (a, b) => a.vcpu - b.vcpu,
  memGiB: (a, b) => a.memGiB - b.memGiB,
  storageGB: (a, b) => a.storageGB - b.storageGB,
  netGbps: (a, b) => (a.netGbps ?? 0) - (b.netGbps ?? 0),
  usd: (a, b) => a.usd - b.usd,
}
```

Run `npm test` again to confirm the full suite, including the pre-existing AWS
`query.test.js` tests (which never exercise a missing `netGbps`, so `?? 0` is a no-op
for them), still passes.

- [ ] **Step 6: Add `showArch`/`placeholders` props to `Toolbar.svelte`**

The existing hardcoded `PLACEHOLDERS` map becomes the *default value* of a new prop, so
AWS's behavior is byte-identical when the prop isn't passed — this is the change:

```svelte
<script>
  const DEFAULT_PLACEHOLDERS = {
    all: 'Filter by instance type, e.g. m5 or 4xlarge',
    arm: 'Filter by instance type, e.g. c7g or m8g',
    x86: 'Filter by instance type, e.g. m5 or c7i',
  }

  let {
    query = $bindable(),
    families,
    showArch = true,
    placeholders = DEFAULT_PLACEHOLDERS,
  } = $props()

  function toggleFamily(family) {
    const next = new Set(query.families)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    query.families = next
  }

  function clear() {
    query.search = ''
    query.families = new Set()
    query.arch = 'all'
  }

  const filtering = $derived(
    query.search !== '' || query.families.size > 0 || query.arch !== 'all',
  )

  const ARCHES = [
    { value: 'all', label: 'All' },
    { value: 'arm', label: 'ARM' },
    { value: 'x86', label: 'x86' },
  ]

  const placeholder = $derived(placeholders[query.arch] ?? placeholders.all)
</script>

<div class="toolbar">
  <input
    type="search"
    {placeholder}
    bind:value={query.search}
    aria-label="Filter by instance type"
  />

  {#if showArch}
    <div class="units" role="group" aria-label="Processor architecture">
      {#each ARCHES as option (option.value)}
        <button
          type="button"
          class:active={query.arch === option.value}
          aria-pressed={query.arch === option.value}
          onclick={() => (query.arch = option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="units" role="group" aria-label="Price unit">
    <button
      type="button"
      class:active={query.unit === 'hour'}
      aria-pressed={query.unit === 'hour'}
      onclick={() => (query.unit = 'hour')}
    >
      $/hour
    </button>
    <button
      type="button"
      class:active={query.unit === 'month'}
      aria-pressed={query.unit === 'month'}
      onclick={() => (query.unit = 'month')}
    >
      $/month
    </button>
  </div>
</div>

<div class="families" role="group" aria-label="Instance family">
  {#each families as family (family)}
    <button
      type="button"
      class="chip"
      class:active={query.families.has(family)}
      aria-pressed={query.families.has(family)}
      onclick={() => toggleFamily(family)}
    >
      {family}
    </button>
  {/each}

  {#if filtering}
    <button type="button" class="chip clear" onclick={clear}>Clear</button>
  {/if}
</div>
```

The only behavioral difference from the current file is the `{#if showArch}` wrapper
around the architecture toggle block — every other line is unchanged, including
`filtering`'s formula (harmless for GCP, since `query.arch` never leaves `'all'` there).

- [ ] **Step 7: Generalize `InstanceTable.svelte`'s columns into a prop**

Full replacement of `src/lib/InstanceTable.svelte`. The default column set and its
rendering must produce byte-identical output to the current file for every AWS
row — check each column below against the current file's hardcoded `<td>` line before
moving on: `type`→`row.type` (unchanged), `vcpu`→`row.vcpu` (unchanged),
`memGiB`→`` `${row.memGiB} GiB` `` (unchanged), `storageGB`'s column sorts by
`row.storageGB` but *displays* `row.storage` — the original string, not the derived
number — exactly as the current file does, `netGbps` similarly sorts by `row.netGbps`
but displays `row.netLabel`, and `usd` is special-cased for the hour/month toggle exactly
as before.

```svelte
<script>
  const DEFAULT_COLUMNS = [
    { key: 'type', label: 'Instance', cellClass: 'type' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    { key: 'storageGB', label: 'Storage', render: (row) => row.storage },
    { key: 'netGbps', label: 'Network', render: (row) => row.netLabel },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]

  let { rows, sort, dir, unit, onsort, columns = DEFAULT_COLUMNS } = $props()

  const hourly = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })

  const monthly = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  function price(row) {
    return unit === 'month' ? monthly.format(row.usd * 730) : hourly.format(row.usd)
  }

  function cell(row, column) {
    if (column.key === 'usd') return price(row)
    if (column.render) return column.render(row)
    return row[column.key]
  }

  function ariaSort(key) {
    if (sort !== key) return 'none'
    return dir === 'asc' ? 'ascending' : 'descending'
  }
</script>

<table>
  <thead>
    <tr>
      {#each columns as column (column.key)}
        <th aria-sort={ariaSort(column.key)}>
          <button type="button" onclick={() => onsort(column.key)}>
            {column.label}
            {#if column.key === 'usd'}<span class="unit">/{unit}</span>{/if}
            <span class="arrow" aria-hidden="true">
              {sort === column.key ? (dir === 'asc' ? '↑' : '↓') : ''}
            </span>
          </button>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.type)}
      <tr>
        {#each columns as column (column.key)}
          <td class={column.cellClass ?? ''}>{cell(row, column)}</td>
        {/each}
      </tr>
    {:else}
      <tr>
        <td colspan={columns.length} class="empty">
          No instances match these filters.
        </td>
      </tr>
    {/each}
  </tbody>
</table>
```

GCP's column list is defined in Step 9 (`App.svelte`, alongside the rest of its
provider-specific configuration) as:

```js
const GCP_COLUMNS = [
  { key: 'type', label: 'Machine type', cellClass: 'type' },
  { key: 'vcpu', label: 'vCPU' },
  { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
  { key: 'storageGB', label: 'Local SSD', render: (row) => (row.storageGB > 0 ? `${row.storageGB} GiB` : '') },
  { key: 'usd', label: 'Price', cellClass: 'price' },
]
```

No `netGbps` column, so `query.js`'s network comparator is never invoked against a GCP
row — the `NaN` risk this step exists to close never gets a UI path to reach.

- [ ] **Step 8: Create `DiskPricingPanel.svelte`**

```svelte
<script>
  import disks from '../../fixtures/gcp/disks.json'

  const RATE_LABELS = {
    space: '$/GiB-hour',
    iops: '$/hour (IOPS)',
    throughput: '$/hour (throughput)',
  }

  const price = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 6,
    maximumFractionDigits: 9,
  })
</script>

<section class="reference-panel">
  <h2>Disk pricing</h2>
  <table>
    <thead>
      <tr><th>Disk type</th><th>Rate</th><th>Price</th></tr>
    </thead>
    <tbody>
      {#each disks as disk (disk.name)}
        <tr>
          <td class="type">{disk.name}</td>
          <td>{RATE_LABELS[disk.rateType]}</td>
          <td class="price">{price.format(disk.usd)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
```

- [ ] **Step 9: Create `HyperdiskCompatTable.svelte`**

```svelte
<script>
  import compat from '../../fixtures/gcp/hyperdisk-compat.json'

  const COLUMNS = [
    { key: 'balanced', label: 'Balanced' },
    { key: 'balancedHA', label: 'Balanced HA' },
    { key: 'extreme', label: 'Extreme' },
    { key: 'throughput', label: 'Throughput' },
    { key: 'ml', label: 'ML' },
  ]
</script>

<section class="reference-panel">
  <h2>Hyperdisk compatibility</h2>
  <table>
    <thead>
      <tr>
        <th>Machine series</th>
        {#each COLUMNS as column (column.key)}<th>{column.label}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each compat as row (row.series)}
        <tr>
          <td class="type">{row.series}</td>
          {#each COLUMNS as column (column.key)}
            <td>{row[column.key] ? '✓' : '—'}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>
```

- [ ] **Step 10: Wire provider tabs into `App.svelte`**

Full replacement of `src/App.svelte`:

```svelte
<script>
  import {
    families as awsFamilies,
    instances as awsInstances,
    operatingSystem,
    region as awsRegion,
  } from './lib/data/awsInstances.js'
  import {
    families as gcpFamilies,
    instances as gcpInstances,
    region as gcpRegion,
  } from './lib/data/gcpInstances.js'
  import { applyQuery } from './lib/data/query.js'
  import { fromSearchParams, toSearchParams } from './lib/data/urlState.js'
  import InstanceTable from './lib/InstanceTable.svelte'
  import Toolbar from './lib/Toolbar.svelte'
  import DiskPricingPanel from './lib/DiskPricingPanel.svelte'
  import HyperdiskCompatTable from './lib/HyperdiskCompatTable.svelte'

  const GCP_COLUMNS = [
    { key: 'type', label: 'Machine type', cellClass: 'type' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    {
      key: 'storageGB',
      label: 'Local SSD',
      render: (row) => (row.storageGB > 0 ? `${row.storageGB} GiB` : ''),
    },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]

  const PROVIDERS = {
    aws: {
      label: 'EC2 On-Demand Pricing',
      context: `${awsRegion} · ${operatingSystem}`,
      instances: awsInstances,
      families: awsFamilies,
      showArch: true,
      placeholders: undefined,
      columns: undefined,
    },
    gcp: {
      label: 'GCP Compute On-Demand Pricing',
      context: gcpRegion,
      instances: gcpInstances,
      families: gcpFamilies,
      showArch: false,
      placeholders: { all: 'Filter by machine type, e.g. c4 or n2-standard' },
      columns: GCP_COLUMNS,
    },
  }

  let query = $state(fromSearchParams(window.location.search))

  const provider = $derived(PROVIDERS[query.provider] ?? PROVIDERS.aws)
  const visible = $derived(applyQuery(provider.instances, query))

  $effect(() => {
    const params = toSearchParams(query)
    const url = params ? `?${params}` : window.location.pathname
    window.history.replaceState(null, '', url)
  })

  function sortBy(key) {
    if (query.sort === key) {
      query.dir = query.dir === 'asc' ? 'desc' : 'asc'
    } else {
      query.sort = key
      query.dir = key === 'type' ? 'asc' : 'desc'
    }
  }

  function switchProvider(next) {
    if (query.provider === next) return
    query.provider = next
    query.search = ''
    query.families = new Set()
    query.arch = 'all'
  }
</script>

<header>
  <div class="tabs" role="tablist" aria-label="Cloud provider">
    {#each Object.keys(PROVIDERS) as key (key)}
      <button
        type="button"
        role="tab"
        aria-selected={query.provider === key}
        class:active={query.provider === key}
        onclick={() => switchProvider(key)}
      >
        {key.toUpperCase()}
      </button>
    {/each}
  </div>
  <h1>{provider.label}</h1>
  <p class="context">{provider.context}</p>
</header>

<main>
  <Toolbar
    bind:query
    families={provider.families}
    showArch={provider.showArch}
    placeholders={provider.placeholders}
  />
  <p class="count" role="status">{visible.length} of {provider.instances.length} instances</p>
  <InstanceTable
    rows={visible}
    sort={query.sort}
    dir={query.dir}
    unit={query.unit}
    onsort={sortBy}
    columns={provider.columns}
  />

  {#if query.provider === 'gcp'}
    <DiskPricingPanel />
    <HyperdiskCompatTable />
  {/if}
</main>
```

**Two things changed after this step was first implemented, during the final whole-branch
review's fix loop — both already landed in code, this note just makes the plan match reality:**

1. A `$effect(() => { document.title = provider.label })` was added (not shown in the code block
   above) so the browser tab title switches along with the on-page heading — caught when a human
   noticed the tab still said "EC2 On-Demand Pricing" after switching to the GCP tab.
2. Step 5 below (`query.js`'s `netGbps` comparator) was implemented as specified, then **fully
   reverted**. `applyQuery`'s sort call (`sign * compare(a, b) || a.type.localeCompare(b.type)`)
   treats a `NaN` result from `compare()` exactly like a `0` result (both are falsy, both fall
   through to the type tiebreak) — and `applyQuery` in this app is only ever called with one
   provider's homogeneous row set at a time, never a mix. So the `?? 0` guard changed nothing
   observable in any reachable case; it was dead defensive code with an inaccurate rationale, not
   a real fix. `query.js` should be treated as unmodified by this task — do not apply Step 5's
   `netGbps` change if executing this plan from scratch.

`placeholders={provider.placeholders}` and `columns={provider.columns}` passing
`undefined` for the `aws` entry is deliberate: Svelte's prop defaults trigger on
`undefined`, so both reach `Toolbar`'s `DEFAULT_PLACEHOLDERS` and `InstanceTable`'s
`DEFAULT_COLUMNS` exactly as before — confirm this holds in Step 11 below.

- [ ] **Step 11: Add minimal styling for the new elements**

Append to `src/app.css`:

```css
.tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.tabs button {
  padding: 0.4rem 0.9rem;
  font: inherit;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.tabs button.active {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.reference-panel {
  margin-top: 2rem;
}

.reference-panel h2 {
  font-size: 1.1rem;
  margin: 0 0 0.5rem;
}
```

- [ ] **Step 12: Run the app manually and verify both tabs**

Run: `npm run dev`, open the printed URL.

Verify: the AWS tab looks and behaves exactly as before (same heading, same context
line, same placeholder text, arch toggle visible, columns Instance/vCPU/Memory/Storage/
Network/Price). Click the GCP tab: heading changes to "GCP Compute On-Demand Pricing",
context line shows "Iowa (us-central1)", the architecture toggle disappears, the family
chips become the 14 GCP families, the table shows 381 rows with columns Machine type/
vCPU/Memory/Local SSD/Price — **no Network column** — the table sorts correctly by every
visible column including Local SSD (rows with no Local SSD sort together, e.g. all at
the top when ascending), and the disk-pricing panel and Hyperdisk compatibility table
render below it. Click back to AWS: everything returns to the original state, `provider`
drops out of the URL.

- [ ] **Step 13: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 14: Commit**

```bash
git add src/lib/data/urlState.js src/lib/data/urlState.test.js src/lib/data/query.js src/lib/data/query.test.js src/lib/Toolbar.svelte src/lib/InstanceTable.svelte src/App.svelte src/lib/DiskPricingPanel.svelte src/lib/HyperdiskCompatTable.svelte src/app.css
git commit -m "feat: add GCP tab with provider switch, disk-pricing panel, and Hyperdisk compatibility table

provider is a new urlState key (default aws, omitted from the URL when
default). Toolbar's architecture toggle/placeholder map and InstanceTable's
column list are now props with AWS-identical defaults, so the AWS tab's
behavior doesn't change. GCP gets its own 5-column list with no Network
column, since GCP rows carry no network data - reusing AWS's column set
as-is would have let a user sort by a column that's undefined on every
GCP row. Switching tabs resets search/family/arch filters, since neither
carries meaning across providers."
```

---

### Task 6: Playwright e2e coverage for the GCP tab

**Files:**
- Create: `e2e/gcp-tab.spec.js`

**Interfaces:**
- Consumes: the running app built by Task 5 — no new interfaces produced.

- [ ] **Step 1: Write the e2e spec**

```js
import { expect, test } from '@playwright/test'

const GCP_TOTAL = 381

const searchBox = (page) => page.getByRole('searchbox', { name: 'Filter by instance type' })
const count = (page) => page.locator('p.count')
const typeCells = (page) => page.locator('tbody td.type')
const gcpTab = (page) => page.getByRole('tab', { name: 'GCP' })
const awsTab = (page) => page.getByRole('tab', { name: 'AWS' })

test('switches to the GCP tab and renders its table', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('heading', { name: 'GCP Compute On-Demand Pricing' })).toBeVisible()
  await expect(page.locator('p.context')).toHaveText('Iowa (us-central1)')
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
  await expect(typeCells(page)).toHaveCount(GCP_TOTAL)
})

test('hides the architecture toggle on the GCP tab', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('group', { name: 'Processor architecture' })).toHaveCount(0)
})

test('shows GCP-specific columns and no Network column', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('button', { name: 'Machine type', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Local SSD', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toHaveCount(0)
})

test('sorts by Local SSD without NaN corrupting the order', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await page.getByRole('button', { name: 'Local SSD', exact: true }).click()
  const firstRowCells = page.locator('tbody tr').first().locator('td')
  await expect(firstRowCells.nth(3)).toHaveText('') // ascending: no-Local-SSD rows sort first
})

test('renders the disk pricing and Hyperdisk compatibility panels', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('heading', { name: 'Disk pricing' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hyperdisk compatibility' })).toBeVisible()
})

test('round-trips provider through the URL and back', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page).toHaveURL(/provider=gcp/)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'GCP Compute On-Demand Pricing' })).toBeVisible()

  await awsTab(page).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'EC2 On-Demand Pricing' })).toBeVisible()
})

test('resets filters when switching providers', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('m5')
  await gcpTab(page).click()
  await expect(searchBox(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
})
```

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: all specs pass, including the pre-existing `e2e/pricing-table.spec.js` (this
confirms the AWS tab's behavior truly did not change).

- [ ] **Step 3: Commit**

```bash
git add e2e/gcp-tab.spec.js
git commit -m "test: add Playwright e2e coverage for the GCP tab"
```

---

### Task 7: `package.json` script and README housekeeping

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:** None — pure documentation/tooling, no code interfaces.

- [ ] **Step 1: Add the extraction script to `package.json`**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "extract:gcp": "node scripts/extract-gcp.mjs"
  },
```

- [ ] **Step 2: Finish the README's GCP section**

The `## Fixtures` → `### GCP` heading already exists (added before this plan, currently
empty). Replace the empty line after it with:

```markdown
See `fixtures/gcp`. Three files — none of them fetched with `wget`, since GCP
doesn't expose a comparable public JSON endpoint (Google retired the old
`cloudpricingcalculator.appspot.com` calculator and its static data files along
with it). Instead:

- `General Purpose VM pricing _ Google Cloud.html` and `Google Cloud Hyperdisk
  overview _ Compute Engine _ Google Cloud Documentation.html` are full-page
  saves of the rendered pricing/documentation pages (File → Save Page As, with
  JS already executed), frozen at whatever region was selected when saved
  (**Iowa / us-central1** for the pricing page).
- `Pricing for My Billing Account.csv` is GCP's full SKU catalog, exported from
  a Cloud Billing account. **Not used by the app** — see the design spec for why.

Run `npm run extract:gcp` to regenerate `instances.json`, `disks.json`, and
`hyperdisk-compat.json` from the two HTML files. Re-run it if either HTML file is
refreshed — the app only ever reads the generated JSON, never the HTML directly.
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: document the GCP extraction script and finish the README's GCP fixtures section"
```

---

### Task 8: Architecture filter for GCP (added mid-implementation)

**Why this task exists, and why it wasn't in the original plan:** the design spec claimed "this
fixture carries no network or CPU-architecture data," so `normalizeGcp` never got an `arch` field and
the GCP tab's Toolbar hid the architecture toggle (`showArch: false`). That claim was wrong for
architecture specifically — caught only because the user asked "why no arch filter on GCP?" after
Task 5 shipped. Two rounds of verification followed:

1. First pass checked `fixtures/gcp/Pricing for My Billing Account.csv`'s SKU description text for
   the literal word "Arm" — found it for `C4A` and `T2A`, not for `N4A`, across all 192 of `N4A`'s
   distinct SKU description strings (every tier: on-demand, custom, spot, sole-tenancy, commitments).
2. The user corrected this: `N4A` **is** Arm, and added a fourth fixture,
   `fixtures/gcp/CPU platforms  _  Compute Engine  _  Google Cloud Documentation.html` (Google's
   official CPU-platforms doc; filename again uses non-breaking spaces around the underscores, same
   as the Hyperdisk doc). Its "Arm processors" table explicitly lists `C4A`, `N4A`, and `Tau T2A` —
   the billing CSV's description text simply doesn't always say "Arm" even when a family is Arm-based.

The user then supplied the actual naming rule, verified against this table with zero exceptions across
all 14 general-purpose families: **no suffix → Intel, `d` → AMD, `a` → Arm** (all three are x86 except
`a`). Since `normalizeGcp` already splits the type string's first hyphenated segment into
`letters`/`generation`/`attrs` (Task 4), `attrs` already **is** this suffix — no new parsing needed:
`C4A`/`N4A`/`T2A` → `attrs === 'a'`, everyone else → `attrs === '' || attrs === 'd'`.

This task is a proper addition to the plan, not a shortcut around it — it goes through implementer +
task review the same as every other task, because it touches already-reviewed files (`normalize.js`,
`App.svelte`) and a wrong `arch` value would misclassify every GCP row silently.

**Files:**
- Modify: `src/lib/data/normalize.js`
- Modify: `src/lib/data/normalize.test.js`
- Modify: `src/App.svelte`
- Modify: `docs/superpowers/specs/2026-08-10-gcp-pricing-table-design.md` (correct the now-inaccurate claim)

**Interfaces:**
- Consumes: `attrs` (already computed by `normalizeGcp`, Task 4) and `showArch`/`placeholders` (already
  props on `Toolbar`, Task 5) — no new interface needed anywhere, this task only supplies new *values*
  to existing seams.
- Produces: `normalizeGcp`'s row shape gains `arch: 'arm' | 'x86'`. Nothing downstream needs a new field
  name — `query.js`'s existing `byArch`/`row.arch !== arch` filter (already generic across providers)
  starts working correctly for GCP the moment this field exists.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/data/normalize.test.js`:

```js
describe('normalizeGcp arch classification', () => {
  it('classifies the three Arm families correctly', () => {
    expect(normalizeGcp({ ...GCP_RAW, type: 'c4a-standard-4', family: 'C4A' }).arch).toBe('arm')
    expect(normalizeGcp({ ...GCP_RAW, type: 'n4a-standard-4', family: 'N4A' }).arch).toBe('arm')
    expect(normalizeGcp({ ...GCP_RAW, type: 't2a-standard-1', family: 'Tau T2A' }).arch).toBe('arm')
  })

  it('classifies AMD (d suffix) and Intel (no suffix) families as x86', () => {
    expect(normalizeGcp({ ...GCP_RAW, type: 'c4d-standard-4', family: 'C4D' }).arch).toBe('x86')
    expect(normalizeGcp({ ...GCP_RAW, type: 'n2d-standard-4', family: 'N2D' }).arch).toBe('x86')
    expect(normalizeGcp({ ...GCP_RAW, type: 't2d-standard-1', family: 'Tau T2D' }).arch).toBe('x86')
    expect(normalizeGcp({ ...GCP_RAW, type: 'c4-standard-4', family: 'C4' }).arch).toBe('x86')
    expect(normalizeGcp({ ...GCP_RAW, type: 'e2-standard-4', family: 'E2' }).arch).toBe('x86')
  })
})

describe('arch classification over the real fixture', () => {
  const raw = JSON.parse(readFileSync('fixtures/gcp/instances.json', 'utf8'))
  const rows = raw.map(normalizeGcp)

  it('classifies every row as arm or x86, nothing else', () => {
    expect(rows.filter((r) => r.arch !== 'arm' && r.arch !== 'x86')).toEqual([])
  })

  it('finds Arm rows only in C4A, N4A, and Tau T2A', () => {
    const arm = rows.filter((r) => r.arch === 'arm')
    expect(arm.length).toBeGreaterThan(0)
    expect(new Set(arm.map((r) => r.family))).toEqual(new Set(['C4A', 'N4A', 'Tau T2A']))
  })

  it('keeps every other family on x86', () => {
    const x86 = rows.filter((r) => r.arch === 'x86')
    const x86Families = new Set(x86.map((r) => r.family))
    for (const f of ['C4A', 'N4A', 'Tau T2A']) expect(x86Families.has(f)).toBe(false)
  })
})
```

`GCP_RAW` is the fixture object already defined earlier in this file (Task 4) — reuse it, don't redefine it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: FAIL — `normalizeGcp`'s returned object has no `arch` key yet, so `.arch` is `undefined`,
which fails every `toBe('arm')`/`toBe('x86')` assertion above.

- [ ] **Step 3: Add `arch` to `normalizeGcp`**

In `src/lib/data/normalize.js`, `normalizeGcp` currently ends:

```js
  return {
    type,
    series: type,
    letters,
    generation,
    attrs,
    family: raw.family,
    vcpu,
    memGiB: finite(raw.memGiB),
    storageGB: finite(raw.storageGB),
    sizeRank: vcpu,
    usd: finite(raw.usd),
  }
}
```

Add one field, right after `attrs` is computed and before the `return`:

```js
  const arch = attrs === 'a' ? 'arm' : 'x86'

  return {
    type,
    series: type,
    letters,
    generation,
    attrs,
    arch,
    family: raw.family,
    vcpu,
    memGiB: finite(raw.memGiB),
    storageGB: finite(raw.storageGB),
    sizeRank: vcpu,
    usd: finite(raw.usd),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: all tests PASS, including both new `describe` blocks.

- [ ] **Step 5: Enable the architecture toggle for GCP in `App.svelte`**

Change the `gcp` entry in the `PROVIDERS` object — `showArch: false` becomes `true`, and
`placeholders` gains arch-specific hints (mirroring AWS's own three-key placeholder map, added in
Task 5):

```js
    gcp: {
      label: 'GCP Compute On-Demand Pricing',
      context: gcpRegion,
      instances: gcpInstances,
      families: gcpFamilies,
      showArch: true,
      placeholders: {
        all: 'Filter by machine type, e.g. c4 or n2-standard',
        arm: 'Filter by machine type, e.g. c4a or n4a',
        x86: 'Filter by machine type, e.g. c4 or n2d',
      },
      columns: GCP_COLUMNS,
    },
```

No other line in `App.svelte` changes. The `arch`-reset effect added in Task 5's fix round
(`if (!provider.showArch && query.arch !== 'all') query.arch = 'all'`) simply stops firing for GCP now
that `showArch` is `true` there — it still protects any future provider that doesn't support `arch`.

- [ ] **Step 6: Run the app manually and verify the GCP architecture toggle**

Run: `npm run dev`, open the app, switch to the GCP tab.

Verify: the "All / ARM / x86" toggle is now visible (same as AWS). Click "ARM": the table filters down
to only `C4A`, `N4A`, and `Tau T2A` rows. Click "x86": every other family shows, none of those three.
Click "All": back to 381 rows. Confirm the AWS tab's own arch toggle is completely unaffected.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Correct the design spec's now-inaccurate claim**

In `docs/superpowers/specs/2026-08-10-gcp-pricing-table-design.md`, the `normalizeGcp(raw)` section
says: *"No AWS field has an equivalent for `arch`, `netGbps`, `netBurst`, or `netLabel` — this fixture
carries no network or CPU-architecture data."* This is now wrong for `arch`. Replace it with:

```markdown
No AWS field has an equivalent for `netGbps`, `netBurst`, or `netLabel` — this fixture carries no
network data. `arch` *is* derivable, from the same `attrs` suffix already split out above: `attrs
=== 'a'` means Arm (verified against Google's official CPU-platforms documentation — `C4A`, `N4A`,
and `Tau T2A` are Arm; a suffix of `d` is AMD and no suffix is Intel, both x86). This was missed in
the original research — the billing CSV's SKU description text happens to say "Arm" for `C4A`/`T2A`
but not for `N4A`, which looked like a real signal until checked against all three families.
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/data/normalize.js src/lib/data/normalize.test.js src/App.svelte docs/superpowers/specs/2026-08-10-gcp-pricing-table-design.md
git commit -m "feat: add architecture filter for GCP (C4A/N4A/Tau T2A are Arm)

The design spec claimed GCP had no CPU-architecture data; that was wrong.
attrs (already split out by normalizeGcp) is the exact suffix Google's
naming convention encodes it in: 'a' = Arm, 'd' = AMD, no suffix = Intel.
Verified against fixtures/gcp/CPU platforms ... .html (Google's official
CPU-platforms doc) rather than the billing CSV's SKU description text,
which says \"Arm\" for C4A/T2A but not for N4A despite N4A genuinely
being Arm (Google Axion, Neoverse N3 cores) - a real family the CSV-only
check would have silently misclassified.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Not in this plan

- Any GCP region but Iowa/us-central1, CUD/preemptible/reservation pricing, Tier_1
  network surcharges, custom machine types — all explicitly out of scope per the design
  spec.
- The billing CSV's multi-region data.
- Joining the Hyperdisk compatibility table to the priced instance rows.
- Task 6's e2e spec (not yet written when Task 8 was added) must assert the GCP arch toggle IS
  visible, not that it's absent — the "hides the architecture toggle on the GCP tab" test named
  earlier in this plan no longer describes correct behavior once Task 8 lands, and must be replaced
  before it's written, not written-then-fixed.
