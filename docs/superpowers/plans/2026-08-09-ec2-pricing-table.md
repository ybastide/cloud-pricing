# EC2 On-Demand Pricing Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the 1322 AWS EC2 on-demand rows for us-east-1/Linux as one sortable, filterable, searchable table with a shareable URL.

**Architecture:** Three pure JS modules (`normalize`, `query`, `urlState`) with no Svelte dependency, plus a load step that imports the fixture, under a three-component Svelte 5 tree. `App.svelte` owns a single `$state` query object; everything below it is a dumb renderer over a `$derived` row list. No network calls at runtime.

**Tech Stack:** Vite 8.2, Svelte 5.56 (runes mode), Vitest 4.1, plain CSS. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-09-ec2-pricing-table-design.md`

## Global Constraints

- **Svelte 5 runes only** — `$state`, `$derived`, `$props`, `$effect`. No `export let`, no Svelte 4 stores.
- **No new runtime dependencies.** Vitest is a devDependency. Everything else is already installed.
- **No numeric field may ever be `NaN` or `undefined`.** Unparsed values fall back to `0`; the original display string is always retained alongside. A `NaN` in a comparator silently corrupts an entire sort.
- **Pure data modules.** `normalize.js`, `query.js`, `urlState.js` import nothing from Svelte and touch no globals except `URLSearchParams`.
- **`applyQuery` must not mutate its input array.**
- **Scope is us-east-1 / Linux.** Region and OS render as a fixed text label, never as a disabled control.
- Tests are co-located as `src/lib/data/<module>.test.js`.
- Node's `parseFloat` is the parsing primitive throughout; every call site guards the result.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/data/normalize.js` | Raw AWS row → typed row. All coercion lives here. |
| `src/lib/data/query.js` | Pure `(rows, query) → rows`: family + architecture filter, search, natural sort. |
| `src/lib/data/urlState.js` | `query ⇄ query string`, mutual inverses. |
| `src/lib/data/instances.js` | The load step. Imports the fixture, exports normalized rows. The *only* file that knows where the data comes from. |
| `src/lib/Toolbar.svelte` | Search box, family chips, architecture toggle, unit toggle. No state of its own. |
| `src/lib/InstanceTable.svelte` | Dumb renderer: sortable headers, rows, empty state. |
| `src/App.svelte` | Owns the query state, hydration, `$derived` rows, URL sync. |
| `src/app.css` | Design tokens + table styling. |

`instances.js` exists specifically so the spec's escape hatch holds: swapping the JSON import for a `public/` + `fetch` load is a change to that one file.

---

### Task 1: Fixture decompression, Vitest setup, README correction

Nothing can be imported until the gzip bodies are real JSON. This task folds in the test tooling and the README fix because they share the same "make the fixtures usable and honestly documented" deliverable.

**Files:**
- Modify: `fixtures/aws/index.json`, `fixtures/aws/locations.json`, `fixtures/aws/metadata.json` (decompress in place)
- Modify: `package.json` (add vitest + test script)
- Modify: `vite.config.js` (add test config)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `fixtures/aws/index.json` as plain JSON with shape `{ manifest, regions: { [locationName]: { [rowKey]: RawRow } }, sets }`. A runnable `npm test`.

- [ ] **Step 1: Confirm which fixtures are gzipped**

Run:
```bash
cd /Users/zeb/src/Perso/cloud-pricing
file fixtures/aws/*.json
```

Expected: `index.json`, `locations.json`, `metadata.json` report `gzip compressed data`. The other three report `JSON data` or `ASCII text`.

- [ ] **Step 2: Decompress the three files in place**

```bash
cd /Users/zeb/src/Perso/cloud-pricing/fixtures/aws
for f in index.json locations.json metadata.json; do
  gunzip -c "$f" > "$f.tmp" && command mv -f "$f.tmp" "$f"
done
```

`command mv -f`, not plain `mv`: this shell aliases `mv` to `mv -i`, which would stop
and prompt for each overwrite. `command` bypasses the alias and `-f` covers the case
where it is a function or a different shell.

- [ ] **Step 3: Verify all six fixtures now parse as JSON**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
node -e "
const fs=require('fs');
for (const f of fs.readdirSync('fixtures/aws')) {
  const d=JSON.parse(fs.readFileSync('fixtures/aws/'+f,'utf8'));
  console.log(f, Object.keys(d).slice(0,4).join(','));
}
const idx=JSON.parse(fs.readFileSync('fixtures/aws/index.json','utf8'));
const rows=Object.values(idx.regions['US East (N. Virginia)']);
console.log('rows:', rows.length);
if (rows.length !== 1322) throw new Error('expected 1322 rows, got '+rows.length);
"
```

Expected: six lines of key names, then `rows: 1322`, no throw.

- [ ] **Step 4: Install Vitest**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
npm install -D vitest@^4.1.10
```

Vitest 4.1.10 declares `vite: ^6 || ^7 || ^8` as a peer, which satisfies the installed Vite 8.2.1.

- [ ] **Step 5: Add the test script to `package.json`**

In the `"scripts"` block, alongside the existing `dev`/`build`/`preview` entries:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 6: Configure Vitest in `vite.config.js`**

Replace the whole file with:

```js
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
```

The data modules are pure and need no DOM, so `node` is the right environment — jsdom would only slow the suite down.

- [ ] **Step 7: Verify Vitest runs with no tests yet**

Run: `npm test`
Expected: prints `No test files found, exiting with code 1` and **exits non-zero**. That non-zero exit is the expected outcome at this step, not a failure — there are no tests yet. What it confirms is that the config loads and `include` resolves. A stack trace or a config error means Step 6 is wrong.

- [ ] **Step 8: Correct the Fixtures section of `README.md`**

Replace the existing `## Fixtures` section (everything from `## Fixtures` to the end of the file) with:

````markdown
## Fixtures

See `fixtures/aws`. Six files, fetched with:

```shell
BASE=https://b0.p.awsstatic.com
wget --compression=auto $BASE/partition-config/configuration.json
wget --compression=auto https://c0.b0.p.awsstatic.com/configurations/aws/ec2/on-demand-plan.json
wget --compression=auto $BASE/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/metadata.json
wget --compression=auto $BASE/locations/1.0/aws/current/locations.json
```

`--compression=auto` matters: without it wget saves the `Content-Encoding: gzip`
body raw, producing a gzip file with a `.json` extension that `fetch` and
`import` both choke on.

| File | Contents |
| --- | --- |
| `index.json` | 1322 on-demand rows — us-east-1 / Linux only. The price data. |
| `spot.json` | Spot prices, 40 regions x linux/mswin. No instance specs. |
| `locations.json` | 109 locations: display name → region code, continent. |
| `metadata.json` | Selector vocabulary: 106 locations, 17 operating systems. |
| `on-demand-plan.json` | Table column labels and display order. |
| `configuration.json` | AWS pricing origin base URLs. |

`index.json` and `spot.json` are not in the wget list above — their exact source
URLs were not recorded. `index.json` is the per-`(region, OS)` artifact AWS
serves under the `meteredUnitMaps` path; the 106 locations x 17 operating
systems in `metadata.json` are the selector vocabulary, and each combination is
a separate file. That is why multi-region on-demand comparison is out of scope
for the MVP.
````

- [ ] **Step 9: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add fixtures/aws package.json package-lock.json vite.config.js README.md
git commit -m "chore: decompress fixtures, add vitest, document all six fixture files"
```

---

### Task 2: `normalize.js` — raw row to typed row

**Files:**
- Create: `src/lib/data/normalize.js`
- Test: `src/lib/data/normalize.test.js`

**Interfaces:**
- Consumes: the `index.json` shape from Task 1.
- Produces:
  - `parseNetwork(label) → { netGbps: number, netBurst: boolean }`
  - `parseStorageGB(label) → number`
  - `parseMemoryGiB(label) → number`
  - `parseSeries(series) → { letters: string, generation: number, attrs: string }`
  - `sizeRank(size) → number`
  - `normalize(rawRow) → Row`
  - `normalizeAll(index) → Row[]`
  - `Row` = `{ type, series, letters, generation, attrs, size, sizeRank, arch, family, vcpu, memGiB, storage, storageGB, netLabel, netGbps, netBurst, usd }`
  - `arch` is `'arm' | 'x86'`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/data/normalize.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalize,
  normalizeAll,
  parseMemoryGiB,
  parseNetwork,
  parseSeries,
  parseStorageGB,
  sizeRank,
} from './normalize.js'

const index = JSON.parse(readFileSync('fixtures/aws/index.json', 'utf8'))

const RAW = {
  rateCode: '6C86BEPQVG73ZGGR.JRTCKXETXF.6YS6EN2CT7',
  price: '0.0960000000',
  Location: 'US East (N. Virginia)',
  'Instance Family': 'General purpose',
  vCPU: '2',
  'Instance Type': 'm5.large',
  Memory: '8 GiB',
  Storage: 'EBS only',
  'Network Performance': 'Up to 10 Gigabit',
  'plc:OperatingSystem': 'Linux',
}

describe('parseNetwork', () => {
  it('reads plain gigabit', () => {
    expect(parseNetwork('100 Gigabit')).toEqual({ netGbps: 100, netBurst: false })
  })

  it('converts megabit to gigabit', () => {
    expect(parseNetwork('12500 Megabit')).toEqual({ netGbps: 12.5, netBurst: false })
  })

  it('sorts a burstable row on its ceiling and flags it', () => {
    expect(parseNetwork('Up to 10 Gigabit')).toEqual({ netGbps: 10, netBurst: true })
  })

  it('handles fractional gigabit', () => {
    expect(parseNetwork('Up to 16.667 Gigabit')).toEqual({ netGbps: 16.667, netBurst: true })
  })

  it('gives qualitative values a zero sentinel so they sort last', () => {
    expect(parseNetwork('Low to Moderate')).toEqual({ netGbps: 0, netBurst: false })
    expect(parseNetwork('High')).toEqual({ netGbps: 0, netBurst: false })
  })
})

describe('parseStorageGB', () => {
  it('is zero for EBS-only', () => {
    expect(parseStorageGB('EBS only')).toBe(0)
  })

  it('multiplies count by size when the unit is absent', () => {
    expect(parseStorageGB('4 x 1900 NVMe SSD')).toBe(7600)
  })

  it('multiplies count by size when the unit is present', () => {
    expect(parseStorageGB('1 x 950 GB NVMe SSD')).toBe(950)
  })

  it('handles the unspaced multiplier form', () => {
    expect(parseStorageGB('2x1900 GB NVMe SSD')).toBe(3800)
  })

  it('handles the unspaced unit form', () => {
    expect(parseStorageGB('2 x 40GB')).toBe(80)
  })

  it('handles a single disk with no multiplier', () => {
    expect(parseStorageGB('474 GB NVMe SSD')).toBe(474)
  })
})

describe('parseMemoryGiB', () => {
  it('strips the unit', () => {
    expect(parseMemoryGiB('8 GiB')).toBe(8)
  })

  it('handles sub-gigabyte sizes', () => {
    expect(parseMemoryGiB('0.5 GiB')).toBe(0.5)
  })

  it('handles the trailing-zero form', () => {
    expect(parseMemoryGiB('1024.0 GiB')).toBe(1024)
  })
})

describe('parseSeries', () => {
  it('splits family letters, generation, and attributes', () => {
    expect(parseSeries('m5')).toEqual({ letters: 'm', generation: 5, attrs: '' })
    expect(parseSeries('c6gd')).toEqual({ letters: 'c', generation: 6, attrs: 'gd' })
  })

  it('handles multi-letter families', () => {
    expect(parseSeries('hpc7g')).toEqual({ letters: 'hpc', generation: 7, attrs: 'g' })
    expect(parseSeries('im4gn')).toEqual({ letters: 'im', generation: 4, attrs: 'gn' })
  })

  it('handles hyphenated attributes', () => {
    expect(parseSeries('c7i-flex')).toEqual({ letters: 'c', generation: 7, attrs: 'i-flex' })
    expect(parseSeries('p6-b200')).toEqual({ letters: 'p', generation: 6, attrs: '-b200' })
    expect(parseSeries('u7in-32tb')).toEqual({ letters: 'u', generation: 7, attrs: 'in-32tb' })
  })

  it('falls back for the two prefixes that do not match the convention', () => {
    expect(parseSeries('u-3tb1')).toEqual({ letters: 'u-3tb1', generation: 0, attrs: '' })
    expect(parseSeries('u-6tb1')).toEqual({ letters: 'u-6tb1', generation: 0, attrs: '' })
  })
})

describe('sizeRank', () => {
  it('orders the named sizes', () => {
    const named = ['nano', 'micro', 'small', 'medium', 'large', 'xlarge']
    const ranks = named.map(sizeRank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(6)
  })

  it('orders numbered sizes numerically, not as text', () => {
    expect(sizeRank('2xlarge')).toBeLessThan(sizeRank('10xlarge'))
    expect(sizeRank('10xlarge')).toBeLessThan(sizeRank('224xlarge'))
  })

  it('puts every numbered size after xlarge', () => {
    expect(sizeRank('xlarge')).toBeLessThan(sizeRank('2xlarge'))
  })

  it('puts sized metal after the numbered sizes and bare metal last', () => {
    expect(sizeRank('224xlarge')).toBeLessThan(sizeRank('metal-12xl'))
    expect(sizeRank('metal-12xl')).toBeLessThan(sizeRank('metal-96xl'))
    expect(sizeRank('metal-96xl')).toBeLessThan(sizeRank('metal'))
  })
})

describe('arch', () => {
  const arch = (type) => normalize({ ...RAW, 'Instance Type': type }).arch

  it('reads a g in the attribute position as Graviton', () => {
    expect(arch('c6g.large')).toBe('arm')
    expect(arch('m7gd.xlarge')).toBe('arm')
    expect(arch('x2gd.metal')).toBe('arm')
    expect(arch('im4gn.large')).toBe('arm')
    expect(arch('hpc7g.4xlarge')).toBe('arm')
    expect(arch('t4g.nano')).toBe('arm')
  })

  it('does not mistake a g in the family position for Graviton', () => {
    expect(arch('g4dn.xlarge')).toBe('x86')
    expect(arch('g6e.2xlarge')).toBe('x86')
    expect(arch('gr6.4xlarge')).toBe('x86')
  })

  it('classifies a Graviton host with a GPU as ARM', () => {
    expect(arch('g5g.xlarge')).toBe('arm')
  })

  it('treats AMD and Intel markers as x86', () => {
    expect(arch('c5a.large')).toBe('x86')
    expect(arch('c7i-flex.large')).toBe('x86')
  })

  it('treats unmarked generations as x86', () => {
    expect(arch('m5.large')).toBe('x86')
    expect(arch('u-6tb1.112xlarge')).toBe('x86')
  })
})

describe('normalize', () => {
  it('maps a row to the typed shape', () => {
    expect(normalize(RAW)).toEqual({
      type: 'm5.large',
      series: 'm5',
      letters: 'm',
      generation: 5,
      attrs: '',
      size: 'large',
      sizeRank: sizeRank('large'),
      arch: 'x86',
      family: 'General purpose',
      vcpu: 2,
      memGiB: 8,
      storage: 'EBS only',
      storageGB: 0,
      netLabel: 'Up to 10 Gigabit',
      netGbps: 10,
      netBurst: true,
      usd: 0.096,
    })
  })

  it('keeps the original strings for display', () => {
    const row = normalize({ ...RAW, Storage: '4 x 1900 NVMe SSD' })
    expect(row.storage).toBe('4 x 1900 NVMe SSD')
    expect(row.netLabel).toBe('Up to 10 Gigabit')
  })
})

describe('normalizeAll over the real fixture', () => {
  const rows = normalizeAll(index)

  it('returns every row', () => {
    expect(rows).toHaveLength(1322)
  })

  it('produces a finite number for every numeric field in every row', () => {
    const bad = rows.filter(
      (r) =>
        !Number.isFinite(r.vcpu) ||
        !Number.isFinite(r.memGiB) ||
        !Number.isFinite(r.storageGB) ||
        !Number.isFinite(r.netGbps) ||
        !Number.isFinite(r.usd) ||
        !Number.isFinite(r.generation) ||
        !Number.isFinite(r.sizeRank),
    )
    expect(bad).toEqual([])
  })

  it('ranks every size in the fixture', () => {
    expect(rows.filter((r) => r.sizeRank <= 0)).toEqual([])
    expect(new Set(rows.map((r) => r.size)).size).toBe(31)
  })

  it('classifies every row as arm or x86', () => {
    expect(rows.filter((r) => r.arch !== 'arm' && r.arch !== 'x86')).toEqual([])
  })

  it('finds the 40 Graviton prefixes and nothing else', () => {
    const arm = rows.filter((r) => r.arch === 'arm')
    expect(arm).toHaveLength(390)
    expect(new Set(arm.map((r) => r.series)).size).toBe(40)
    expect(arm.every((r) => r.attrs.startsWith('g'))).toBe(true)
  })

  it('keeps the GPU families on x86', () => {
    const gpu = rows.filter((r) => ['g4dn', 'g6e', 'gr6'].includes(r.series))
    expect(gpu.length).toBeGreaterThan(0)
    expect(gpu.every((r) => r.arch === 'x86')).toBe(true)
  })

  it('never leaves a display string empty', () => {
    const bad = rows.filter((r) => !r.type || !r.family || !r.storage || !r.netLabel)
    expect(bad).toEqual([])
  })

  it('gives every row a positive price and vcpu', () => {
    expect(rows.every((r) => r.usd > 0)).toBe(true)
    expect(rows.every((r) => r.vcpu > 0)).toBe(true)
  })

  it('finds exactly 18 rows with a qualitative network rating', () => {
    expect(rows.filter((r) => r.netGbps === 0)).toHaveLength(18)
  })

  it('keys uniquely on instance type', () => {
    expect(new Set(rows.map((r) => r.type)).size).toBe(1322)
  })
})
```

The `Number.isFinite` sweep is what covers all 95 network strings and all 8 storage shapes without enumerating them. It is the most valuable test in this file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: FAIL — `Failed to resolve import "./normalize.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/data/normalize.js`:

```js
const NETWORK = /^(Up to\s+)?([\d.]+)\s*(Gigabit|Megabit)\b/i
const STORAGE_MULTI = /^(\d+)\s*x\s*([\d.]+)(?:\s*GB)?\b/i
const STORAGE_SINGLE = /^([\d.]+)\s*GB\b/i
const SERIES = /^([a-z]+)(\d+)([a-z0-9-]*)$/i
const NUMBERED_SIZE = /^(\d+)xlarge$/i
const SIZED_METAL = /^metal-(\d+)xl$/i

const NAMED_SIZES = {
  nano: 1,
  micro: 2,
  small: 3,
  medium: 4,
  large: 5,
  xlarge: 6,
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function parseNetwork(label) {
  const match = NETWORK.exec(label ?? '')
  if (!match) return { netGbps: 0, netBurst: false }
  const value = parseFloat(match[2])
  const gbps = match[3].toLowerCase() === 'gigabit' ? value : value / 1000
  return { netGbps: finite(gbps), netBurst: Boolean(match[1]) }
}

export function parseStorageGB(label) {
  const multi = STORAGE_MULTI.exec(label ?? '')
  if (multi) return finite(parseInt(multi[1], 10) * parseFloat(multi[2]))
  const single = STORAGE_SINGLE.exec(label ?? '')
  if (single) return finite(parseFloat(single[1]))
  return 0
}

export function parseMemoryGiB(label) {
  return finite(parseFloat(label))
}

export function parseSeries(series) {
  const match = SERIES.exec(series)
  if (!match) return { letters: series, generation: 0, attrs: '' }
  return {
    letters: match[1],
    generation: finite(parseInt(match[2], 10)),
    attrs: match[3],
  }
}

export function sizeRank(size) {
  if (size in NAMED_SIZES) return NAMED_SIZES[size]

  const numbered = NUMBERED_SIZE.exec(size)
  if (numbered) return 6 + finite(parseInt(numbered[1], 10))

  const sizedMetal = SIZED_METAL.exec(size)
  if (sizedMetal) return 1000 + finite(parseInt(sizedMetal[1], 10))

  if (size === 'metal') return 2000

  return 0
}

export function normalize(raw) {
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

export function normalizeAll(index) {
  return Object.values(index.regions).flatMap((rows) =>
    Object.values(rows).map(normalize),
  )
}
```

`normalizeAll` iterates *all* regions rather than hardcoding `'US East (N. Virginia)'`. The fixture happens to contain one, but this is the single line that makes adding more `(region, OS)` files an additive change.

Two details that look like style but are not: `(?:\s*GB)?` must group the whole unit — `GB?` matches `"G"` or `"GB"` but never empty, which would silently return 0 for all 421 `"4 x 1900 NVMe SSD"` rows. And `\s*` *inside* that group is what lets `"2 x 40GB"` match.

`sizeRank` returns `0` for a size it does not recognise, and the fixture-wide test asserts no row ranks `0`. That pairing is deliberate: if AWS ships a size shape nobody anticipated, the suite fails loudly instead of silently sorting it alongside `nano`.

`arch` is derived from the naming convention because **the fixture has no processor column** — the row has no such field and `metadata.json` exposes no secondary selectors. The rule is safe only because the `g` must sit in the *attribute* position: `c6g`, `m7gd`, `x2gd`, `im4gn`, `hpc7g` and `t4g` are Graviton, while the GPU families `g4dn`, `g6e` and `gr6` are not, because there the `g` is the family letter that `parseSeries` splits off first. `g5g` — a Graviton host with a GPU — correctly lands on ARM. Verified against the fixture: 390 rows across exactly 40 prefixes.

Intel-vs-AMD is deliberately not derived. 277 rows are pre-convention generations (`m5`, `c5`, `r5`, `t3`) whose processor the name does not encode, so a three-way split would leave an "Intel" filter silently hiding rows that match it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/data/normalize.test.js`
Expected: PASS, 39 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add src/lib/data/normalize.js src/lib/data/normalize.test.js
git commit -m "feat: normalize AWS EC2 rows into typed, sortable records"
```

---

### Task 3: `query.js` — filter, search, sort

**Files:**
- Create: `src/lib/data/query.js`
- Test: `src/lib/data/query.test.js`

**Interfaces:**
- Consumes: `Row` from Task 2.
- Produces:
  - `SORT_KEYS` — `['type', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd']`
  - `DEFAULT_SORT` — `'usd'` (Task 4 imports this)
  - `DEFAULT_DIR` — `'asc'` (Task 4 imports this)
  - `applyQuery(rows, query) → Row[]` where `query` is `{ search, families: Set<string>, arch, sort, dir }`. Extra keys such as `unit` are ignored. `arch` filters only when it is exactly `'arm'` or `'x86'`; `'all'` and anything unrecognised mean no filter.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/data/query.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { SORT_KEYS, applyQuery } from './query.js'
import { parseSeries, sizeRank } from './normalize.js'

function row(type, over = {}) {
  const [series, size] = type.split('.')
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
    family: 'General purpose',
    vcpu: 2,
    memGiB: 8,
    storage: 'EBS only',
    storageGB: 0,
    netLabel: '10 Gigabit',
    netGbps: 10,
    netBurst: false,
    usd: 1,
    ...over,
  }
}

const rows = [
  row('m5.large', { usd: 0.096, vcpu: 2, memGiB: 8 }),
  row('c7g.xlarge', { usd: 0.058, vcpu: 4, memGiB: 8, family: 'Compute optimized' }),
  row('r6i.4xlarge', { usd: 1.008, vcpu: 16, memGiB: 128, family: 'Memory optimized' }),
  row('i4i.large', { usd: 0.172, vcpu: 2, memGiB: 16, family: 'Storage optimized', storageGB: 468 }),
]

const base = { search: '', families: new Set(), arch: 'all', sort: 'usd', dir: 'asc' }

describe('applyQuery', () => {
  it('returns every row when nothing is set', () => {
    expect(applyQuery(rows, base)).toHaveLength(4)
  })

  it('does not mutate the input array', () => {
    const order = rows.map((r) => r.type)
    applyQuery(rows, { ...base, sort: 'usd', dir: 'desc' })
    expect(rows.map((r) => r.type)).toEqual(order)
  })

  it('sorts ascending by price', () => {
    const out = applyQuery(rows, { ...base, sort: 'usd', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'm5.large', 'i4i.large', 'r6i.4xlarge'])
  })

  it('sorts descending by price', () => {
    const out = applyQuery(rows, { ...base, sort: 'usd', dir: 'desc' })
    expect(out.map((r) => r.type)).toEqual(['r6i.4xlarge', 'i4i.large', 'm5.large', 'c7g.xlarge'])
  })

  it('sorts numerically, not lexicographically', () => {
    const out = applyQuery(rows, { ...base, sort: 'memGiB', dir: 'desc' })
    expect(out.map((r) => r.memGiB)).toEqual([128, 16, 8, 8])
  })

  it('sorts instance type in natural AWS order', () => {
    const out = applyQuery(rows, { ...base, sort: 'type', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'i4i.large', 'm5.large', 'r6i.4xlarge'])
  })

  it('orders the size ladder within a family, which localeCompare gets wrong', () => {
    const ladder = ['c5.4xlarge', 'c5.large', 'c5.metal', 'c5.xlarge', 'c5.2xlarge'].map((t) =>
      row(t),
    )
    const out = applyQuery(ladder, { ...base, sort: 'type', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual([
      'c5.large',
      'c5.xlarge',
      'c5.2xlarge',
      'c5.4xlarge',
      'c5.metal',
    ])
  })

  it('orders generation numerically, not as text', () => {
    const gens = ['c10g.large', 'c4g.large', 'c9g.large'].map((t) => row(t))
    const out = applyQuery(gens, { ...base, sort: 'type', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual(['c4g.large', 'c9g.large', 'c10g.large'])
  })

  it('orders attributes after generation', () => {
    const variants = ['c7i.large', 'c7g.large', 'c7a.large', 'c7gd.large'].map((t) => row(t))
    const out = applyQuery(variants, { ...base, sort: 'type', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual([
      'c7a.large',
      'c7g.large',
      'c7gd.large',
      'c7i.large',
    ])
  })

  it('breaks ties on instance type so the order is stable', () => {
    const out = applyQuery(rows, { ...base, sort: 'memGiB', dir: 'asc' })
    expect(out.slice(0, 2).map((r) => r.type)).toEqual(['c7g.xlarge', 'm5.large'])
  })

  it('filters by family', () => {
    const out = applyQuery(rows, { ...base, families: new Set(['Memory optimized']) })
    expect(out.map((r) => r.type)).toEqual(['r6i.4xlarge'])
  })

  it('treats multiple families as a union', () => {
    const families = new Set(['Memory optimized', 'Storage optimized'])
    const out = applyQuery(rows, { ...base, families })
    expect(out.map((r) => r.type).sort()).toEqual(['i4i.large', 'r6i.4xlarge'])
  })

  it('filters to ARM', () => {
    expect(applyQuery(rows, { ...base, arch: 'arm' }).map((r) => r.type)).toEqual(['c7g.xlarge'])
  })

  it('filters to x86', () => {
    const out = applyQuery(rows, { ...base, arch: 'x86' })
    expect(out).toHaveLength(3)
    expect(out.every((r) => r.arch === 'x86')).toBe(true)
  })

  it("treats 'all' as no architecture filter", () => {
    expect(applyQuery(rows, { ...base, arch: 'all' })).toHaveLength(4)
  })

  it('ignores an unrecognised architecture value', () => {
    expect(applyQuery(rows, { ...base, arch: 'sparc' })).toHaveLength(4)
  })

  it('combines the architecture and family filters', () => {
    const query = { ...base, arch: 'arm', families: new Set(['Memory optimized']) }
    expect(applyQuery(rows, query)).toEqual([])
  })

  it('searches instance type case-insensitively', () => {
    expect(applyQuery(rows, { ...base, search: 'C7G' }).map((r) => r.type)).toEqual(['c7g.xlarge'])
  })

  it('searches on a partial series prefix', () => {
    expect(applyQuery(rows, { ...base, search: 'm5' }).map((r) => r.type)).toEqual(['m5.large'])
  })

  it('ignores surrounding whitespace in the search term', () => {
    expect(applyQuery(rows, { ...base, search: '  m5  ' }).map((r) => r.type)).toEqual(['m5.large'])
  })

  it('combines family filter and search', () => {
    const query = { ...base, families: new Set(['General purpose']), search: 'c7g' }
    expect(applyQuery(rows, query)).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    expect(applyQuery(rows, { ...base, search: 'nope' })).toEqual([])
  })

  it('falls back to the default sort for an unknown key', () => {
    const out = applyQuery(rows, { ...base, sort: 'bogus' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'm5.large', 'i4i.large', 'r6i.4xlarge'])
  })

  it('exposes the sortable keys', () => {
    expect(SORT_KEYS).toEqual(['type', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: FAIL — `Failed to resolve import "./query.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/data/query.js`:

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
  netGbps: (a, b) => a.netGbps - b.netGbps,
  usd: (a, b) => a.usd - b.usd,
}

export const SORT_KEYS = Object.keys(COMPARATORS)

export const DEFAULT_SORT = 'usd'
export const DEFAULT_DIR = 'asc'

export function applyQuery(rows, query) {
  const { search = '', families, arch, sort, dir } = query
  const needle = search.trim().toLowerCase()
  const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]
  const sign = dir === 'desc' ? -1 : 1
  const byFamily = families instanceof Set && families.size > 0
  const byArch = arch === 'arm' || arch === 'x86'

  return rows
    .filter((row) => {
      if (byFamily && !families.has(row.family)) return false
      if (byArch && row.arch !== arch) return false
      if (needle && !row.type.toLowerCase().includes(needle)) return false
      return true
    })
    .sort((a, b) => sign * compare(a, b) || a.type.localeCompare(b.type))
}
```

`.filter` returns a fresh array, so the `.sort` that follows cannot touch the caller's data — that is what satisfies the no-mutation constraint. The `|| a.type.localeCompare(b.type)` tail is the tie-break: without it, equal-memory rows come out in fixture order and the table reshuffles for no visible reason.

The `type` comparator is the reason `normalize` bothers to split each instance type into `letters` / `generation` / `attrs` / `sizeRank`. Comparing the type *string* gives `c4.2xlarge < c4.4xlarge < c4.8xlarge < c4.large < c4.xlarge` — the size ladder scrambled inside every family — and would sort a future `c10g` before `c4g`. Comparing the four parts in order gives `c5.large < c5.xlarge < c5.2xlarge < … < c5.metal < c5a.large < c6g.medium`.

`arch` filters only on an exact `'arm'` or `'x86'`. That is what lets `'all'` — and any stale or hand-edited value — mean "no filter" without a separate validation step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add src/lib/data/query.js src/lib/data/query.test.js
git commit -m "feat: add pure filter/search/sort query layer"
```

---

### Task 4: `urlState.js` — shareable links

**Files:**
- Create: `src/lib/data/urlState.js`
- Test: `src/lib/data/urlState.test.js`

**Interfaces:**
- Consumes: `SORT_KEYS`, `DEFAULT_SORT`, `DEFAULT_DIR` from Task 3.
- Produces:
  - `defaultQuery() → Query` where `Query` = `{ search: string, families: Set<string>, arch: 'all'|'arm'|'x86', sort: string, dir: 'asc'|'desc', unit: 'hour'|'month' }`
  - `toSearchParams(query) → string` (no leading `?`)
  - `fromSearchParams(search) → Query`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/data/urlState.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { defaultQuery, fromSearchParams, toSearchParams } from './urlState.js'

describe('defaultQuery', () => {
  it('starts empty, sorted by price ascending, priced hourly', () => {
    expect(defaultQuery()).toEqual({
      search: '',
      families: new Set(),
      arch: 'all',
      sort: 'usd',
      dir: 'asc',
      unit: 'hour',
    })
  })

  it('returns a fresh Set each call', () => {
    const a = defaultQuery()
    a.families.add('General purpose')
    expect(defaultQuery().families.size).toBe(0)
  })
})

describe('toSearchParams', () => {
  it('is empty for an untouched query', () => {
    expect(toSearchParams(defaultQuery())).toBe('')
  })

  it('serialises a search term', () => {
    expect(toSearchParams({ ...defaultQuery(), search: 'm5' })).toBe('q=m5')
  })

  it('joins families with commas', () => {
    const families = new Set(['General purpose', 'Compute optimized'])
    expect(toSearchParams({ ...defaultQuery(), families })).toBe(
      'fam=General+purpose%2CCompute+optimized',
    )
  })

  it('omits sort and dir when they are the defaults', () => {
    expect(toSearchParams({ ...defaultQuery(), sort: 'usd', dir: 'asc' })).toBe('')
  })

  it('serialises a non-default sort and direction', () => {
    expect(toSearchParams({ ...defaultQuery(), sort: 'vcpu', dir: 'desc' })).toBe(
      'sort=vcpu&dir=desc',
    )
  })

  it('serialises a non-default unit', () => {
    expect(toSearchParams({ ...defaultQuery(), unit: 'month' })).toBe('unit=month')
  })

  it('omits arch when it is the default', () => {
    expect(toSearchParams({ ...defaultQuery(), arch: 'all' })).toBe('')
  })

  it('serialises a non-default arch', () => {
    expect(toSearchParams({ ...defaultQuery(), arch: 'arm' })).toBe('arch=arm')
  })
})

describe('fromSearchParams', () => {
  it('returns defaults for an empty string', () => {
    expect(fromSearchParams('')).toEqual(defaultQuery())
  })

  it('tolerates a leading question mark', () => {
    expect(fromSearchParams('?q=m5').search).toBe('m5')
  })

  it('splits families on commas', () => {
    const q = fromSearchParams('fam=General+purpose%2CCompute+optimized')
    expect(q.families).toEqual(new Set(['General purpose', 'Compute optimized']))
  })

  it('accepts a known sort key', () => {
    expect(fromSearchParams('sort=memGiB').sort).toBe('memGiB')
  })

  it('falls back to the default for an unknown sort key', () => {
    expect(fromSearchParams('sort=bogus').sort).toBe('usd')
  })

  it('falls back to the default for a malformed direction', () => {
    expect(fromSearchParams('dir=sideways').dir).toBe('asc')
  })

  it('falls back to the default for a malformed unit', () => {
    expect(fromSearchParams('unit=fortnight').unit).toBe('hour')
  })

  it('accepts a known architecture', () => {
    expect(fromSearchParams('arch=arm').arch).toBe('arm')
    expect(fromSearchParams('arch=x86').arch).toBe('x86')
  })

  it('falls back to the default for an unknown architecture', () => {
    expect(fromSearchParams('arch=sparc').arch).toBe('all')
  })

  it('survives complete garbage without throwing', () => {
    expect(() => fromSearchParams('%%%&&&===')).not.toThrow()
    expect(fromSearchParams('&&&').sort).toBe('usd')
  })
})

describe('round trip', () => {
  it('survives a fully populated query', () => {
    const query = {
      search: 'm5',
      families: new Set(['General purpose', 'Memory optimized']),
      arch: 'arm',
      sort: 'vcpu',
      dir: 'desc',
      unit: 'month',
    }
    expect(fromSearchParams(toSearchParams(query))).toEqual(query)
  })

  it('survives an untouched query', () => {
    expect(fromSearchParams(toSearchParams(defaultQuery()))).toEqual(defaultQuery())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: FAIL — `Failed to resolve import "./urlState.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/data/urlState.js`:

```js
import { DEFAULT_DIR, DEFAULT_SORT, SORT_KEYS } from './query.js'

const DEFAULT_UNIT = 'hour'
const DEFAULT_ARCH = 'all'
const ARCHES = ['arm', 'x86']

export function defaultQuery() {
  return {
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
  if (query.search) params.set('q', query.search)
  if (query.families?.size) params.set('fam', [...query.families].join(','))
  if (query.arch && query.arch !== DEFAULT_ARCH) params.set('arch', query.arch)
  if (query.sort && query.sort !== DEFAULT_SORT) params.set('sort', query.sort)
  if (query.dir && query.dir !== DEFAULT_DIR) params.set('dir', query.dir)
  if (query.unit && query.unit !== DEFAULT_UNIT) params.set('unit', query.unit)
  return params.toString()
}

export function fromSearchParams(search) {
  const params = new URLSearchParams(search)
  const query = defaultQuery()

  query.search = params.get('q') ?? ''

  const families = params.get('fam')
  if (families) {
    query.families = new Set(families.split(',').filter(Boolean))
  }

  const arch = params.get('arch')
  if (arch && ARCHES.includes(arch)) query.arch = arch

  const sort = params.get('sort')
  if (sort && SORT_KEYS.includes(sort)) query.sort = sort

  if (params.get('dir') === 'desc') query.dir = 'desc'
  if (params.get('unit') === 'month') query.unit = 'month'

  return query
}
```

Every read is a whitelist rather than a validation-and-throw, so a hand-edited or truncated URL degrades to the default view instead of white-screening the page. `URLSearchParams` accepts a leading `?` and ignores malformed pairs, which is why the garbage test passes without extra code.

An unrecognised family is deliberately *not* filtered out: it simply matches no rows and lands in the empty state, which is a legitimate outcome rather than an error.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: PASS, 22 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 85 tests across 3 files.

- [ ] **Step 6: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add src/lib/data/urlState.js src/lib/data/urlState.test.js
git commit -m "feat: encode query state in the URL for shareable views"
```

---

### Task 5: The load step, the table, and scaffold removal

First visible pixels. This task deletes the Vite demo, adds the load step, and renders an unfiltered table sorted by price.

**Files:**
- Create: `src/lib/data/instances.js`
- Create: `src/lib/InstanceTable.svelte`
- Rewrite: `src/App.svelte`
- Rewrite: `src/app.css`
- Delete: `src/lib/Counter.svelte`, `src/assets/hero.png`, `src/assets/svelte.svg`, `src/assets/vite.svg`, `README-svelte.md`, `public/icons.svg`
- Rewrite: `public/favicon.svg` (currently the Svelte logo)
- Modify: `index.html` (title)

**Interfaces:**
- Consumes: `normalizeAll` (Task 2), `applyQuery` (Task 3), `defaultQuery` (Task 4).
- Produces:
  - From `src/lib/data/instances.js`: `instances: Row[]`, `families: string[]`, `region: string`, `operatingSystem: string`
  - `InstanceTable` props: `{ rows: Row[], sort: string, dir: string, unit: string, onsort: (key: string) => void }`

- [ ] **Step 1: Delete the scaffold**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git rm src/lib/Counter.svelte src/assets/hero.png src/assets/svelte.svg src/assets/vite.svg
git rm README-svelte.md public/icons.svg
```

`public/favicon.svg` is also the Svelte logo and `index.html` links it, so replace its contents rather than deleting it (deleting would leave a 404 on every page load):

```bash
cat > /Users/zeb/src/Perso/cloud-pricing/public/favicon.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#aa3bff"/>
  <text x="16" y="23" font-family="-apple-system, sans-serif" font-size="18"
        font-weight="600" fill="#fff" text-anchor="middle">$</text>
</svg>
SVG
```

- [ ] **Step 2: Create the load step**

Create `src/lib/data/instances.js`:

```js
import rawIndex from '../../../fixtures/aws/index.json'
import { normalizeAll } from './normalize.js'

export const instances = normalizeAll(rawIndex)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = 'US East (N. Virginia)'
export const operatingSystem = 'Linux'
```

This is the only module that knows where the data comes from. Swapping the import for a `public/` + `fetch` load later touches this file and nothing else.

The path is three levels up because this file sits at `src/lib/data/`.

- [ ] **Step 3: Create the table component**

Create `src/lib/InstanceTable.svelte`:

```svelte
<script>
  let { rows, sort, dir, unit, onsort } = $props()

  const COLUMNS = [
    { key: 'type', label: 'Instance' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory' },
    { key: 'storageGB', label: 'Storage' },
    { key: 'netGbps', label: 'Network' },
    { key: 'usd', label: 'Price' },
  ]

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

  function ariaSort(key) {
    if (sort !== key) return 'none'
    return dir === 'asc' ? 'ascending' : 'descending'
  }
</script>

<table>
  <thead>
    <tr>
      {#each COLUMNS as column (column.key)}
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
        <td class="type">{row.type}</td>
        <td>{row.vcpu}</td>
        <td>{row.memGiB} GiB</td>
        <td>{row.storage}</td>
        <td>{row.netLabel}</td>
        <td class="price">{price(row)}</td>
      </tr>
    {:else}
      <tr>
        <td colspan={COLUMNS.length} class="empty">
          No instances match these filters.
        </td>
      </tr>
    {/each}
  </tbody>
</table>
```

The `{:else}` branch of `{#each}` is Svelte's empty-list block — that is the spec's required empty state, and it costs one block rather than a wrapping `{#if}`.

Storage and Network display `row.storage` / `row.netLabel` — the original strings — while sorting on the derived `storageGB` / `netGbps` columns. That split is the whole point of normalization.

- [ ] **Step 4: Rewrite `src/App.svelte`**

Replace the entire file with:

```svelte
<script>
  import { instances, operatingSystem, region } from './lib/data/instances.js'
  import { applyQuery } from './lib/data/query.js'
  import { defaultQuery } from './lib/data/urlState.js'
  import InstanceTable from './lib/InstanceTable.svelte'

  let query = $state(defaultQuery())

  const visible = $derived(applyQuery(instances, query))

  function sortBy(key) {
    if (query.sort === key) {
      query.dir = query.dir === 'asc' ? 'desc' : 'asc'
    } else {
      query.sort = key
      query.dir = key === 'type' ? 'asc' : 'desc'
    }
  }
</script>

<header>
  <h1>EC2 On-Demand Pricing</h1>
  <p class="context">{region} &middot; {operatingSystem}</p>
</header>

<main>
  <p class="count">{visible.length} of {instances.length} instances</p>
  <InstanceTable
    rows={visible}
    sort={query.sort}
    dir={query.dir}
    unit={query.unit}
    onsort={sortBy}
  />
</main>
```

Region and OS are a plain `<p>`, not a disabled `<select>` — a greyed-out dropdown reads as a broken feature rather than a deliberate scope boundary.

Clicking a new column defaults to descending for numeric columns and ascending for the text column, because "most expensive" and "A first" are the useful first looks.

- [ ] **Step 5: Replace `src/app.css`**

Replace the entire file (all 296 lines of Vite demo styling) with:

```css
:root {
  --text: #24222a;
  --text-dim: #6b6375;
  --bg: #fff;
  --bg-alt: #faf9fb;
  --border: #e5e4e7;
  --accent: #aa3bff;
  --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  --mono: 'SF Mono', SFMono-Regular, Menlo, ui-monospace, monospace;

  font: 15px/1.45 var(--sans);
  color: var(--text);
  background: var(--bg);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --text: #ece9f1;
    --text-dim: #a29bab;
    --bg: #16141a;
    --bg-alt: #1e1b24;
    --border: #322e3a;
  }
}

body {
  margin: 0;
  padding: 1.5rem;
  background: var(--bg);
  color: var(--text);
}

header h1 {
  margin: 0;
  font-size: 1.4rem;
}

.context,
.count {
  margin: 0.25rem 0 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}

.count {
  margin: 1rem 0 0.5rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 0.35rem 0.6rem;
  text-align: right;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  background: var(--bg);
  padding: 0;
}

th button {
  width: 100%;
  padding: 0.5rem 0.6rem;
  font: inherit;
  font-weight: 600;
  color: inherit;
  text-align: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

th button:hover {
  color: var(--accent);
}

.arrow {
  display: inline-block;
  width: 1ch;
  color: var(--accent);
}

.unit {
  font-weight: 400;
  color: var(--text-dim);
}

td.type {
  font-family: var(--mono);
}

td.price {
  font-family: var(--mono);
}

tbody tr:nth-child(even) {
  background: var(--bg-alt);
}

.empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-dim);
}
```

- [ ] **Step 6: Update the page title in `index.html`**

Change the `<title>` line from `<title>cloud-pricing</title>` to:

```html
    <title>EC2 On-Demand Pricing</title>
```

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: succeeds. The bundle summary shows a chunk of roughly 725 KB — the inlined fixture — and Vite prints a `Some chunks are larger than 500 kB after minification` warning. That warning is expected and is not a failure; the size is the fixture, and moving it out of the bundle is the documented follow-up. Anything reported as an *error* is a real problem.

- [ ] **Step 8: Verify it renders**

Run: `npm run dev`, open the printed URL.

Expected, checked by eye:
- Header reads "EC2 On-Demand Pricing" with "US East (N. Virginia) · Linux" beneath.
- Count reads "1322 of 1322 instances".
- Rows are sorted cheapest first, so the first price is `$0.0042`.
- Clicking "Price" flips to `$360.9870` at the top.
- Clicking "Memory" sorts numerically — `32768 GiB` first (`u7in-32tb.224xlarge`), not `8 GiB` before `1024 GiB`. 99 rows exceed 1152 GiB, so do not expect `1152 GiB` at the top.
- Storage shows the original strings (`EBS only`, `4 x 1900 NVMe SSD`), and sorting by it puts the largest disks first rather than ordering them as text.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add -A
git commit -m "feat: render the sortable EC2 price table, drop the vite scaffold"
```

---

### Task 6: `Toolbar.svelte` — search, family filter, unit toggle

**Files:**
- Create: `src/lib/Toolbar.svelte`
- Modify: `src/App.svelte` (import and render the toolbar)
- Modify: `src/app.css` (append toolbar styles)

**Interfaces:**
- Consumes: `families` from `src/lib/data/instances.js` (Task 5); the `query` `$state` proxy from `App.svelte`.
- Produces: `Toolbar` props `{ query: Query, families: string[] }`. The component mutates `query` in place, including `query.arch`.

- [ ] **Step 1: Create the toolbar**

Create `src/lib/Toolbar.svelte`:

```svelte
<script>
  let { query, families } = $props()

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
</script>

<div class="toolbar">
  <input
    type="search"
    placeholder="Filter by instance type, e.g. m5 or 4xlarge"
    bind:value={query.search}
    aria-label="Filter by instance type"
  />

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

  <div class="units" role="group" aria-label="Price unit">
    <button
      type="button"
      class:active={query.unit === 'hour'}
      onclick={() => (query.unit = 'hour')}
    >
      $/hour
    </button>
    <button
      type="button"
      class:active={query.unit === 'month'}
      onclick={() => (query.unit = 'month')}
    >
      $/month
    </button>
  </div>
</div>

<div class="families">
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

`query.families = next` assigns a **new** `Set` rather than mutating the existing one. Svelte 5's `$state` proxy tracks property assignment on plain objects but does not make a `Set`'s internal mutations reactive, so `query.families.add(x)` would update the data and never re-render. Replacing the Set wholesale is what makes the chips work, and it is also what `applyQuery` expects.

`bind:value` on a prop works here because `query` is the same `$state` proxy object `App` created — it is passed by reference, so mutations propagate upward without `$bindable`.

**Expect a dev-mode console warning and do not "fix" it.** Svelte logs `ownership_invalid_mutation` — *"Mutating unbound props (`query`...) is strongly discouraged. Consider using `bind:query={...}`"* — on every mutation, so a three-character search prints three warnings. This was verified end to end: the behaviour is correct, the warning is cosmetic, and it does not appear in a production build. If the noise is unwanted, the silencing change is `bind:query={query}` in `App.svelte` plus `let { query = $bindable(), families } = $props()` here — functionally identical.

- [ ] **Step 2: Wire the toolbar into `src/App.svelte`**

Add to the imports:

```js
  import { families, instances, operatingSystem, region } from './lib/data/instances.js'
  import Toolbar from './lib/Toolbar.svelte'
```

(That replaces the existing `instances.js` import line, adding `families`.)

Then inside `<main>`, immediately before the `<p class="count">` line:

```svelte
  <Toolbar {query} {families} />
```

- [ ] **Step 3: Append toolbar styles to `src/app.css`**

```css
.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1.25rem;
}

.toolbar input[type='search'] {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  font: inherit;
  color: inherit;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.toolbar input[type='search']:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.units {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.units button {
  padding: 0.5rem 0.75rem;
  font: inherit;
  color: var(--text-dim);
  background: var(--bg-alt);
  border: 0;
  cursor: pointer;
}

.units button.active {
  color: var(--bg);
  background: var(--accent);
}

.families {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.chip {
  padding: 0.3rem 0.7rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--text-dim);
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.chip:hover {
  color: var(--text);
}

.chip.active {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.chip.clear {
  border-style: dashed;
}
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`

Expected, checked by eye:
- Typing `m5` in the search box narrows the count and the table live.
- Clicking "General purpose" narrows to 392 rows; the chip fills with the accent colour.
- Adding "Compute optimized" widens to 712 rows — the two families union rather than intersect.
- Clicking an active chip again removes it.
- "Clear" appears only while filtering, and resets both search and chips.
- The `$/month` toggle multiplies every price by 730 and the header reads "Price /month". The row order does **not** change.
- The ARM toggle narrows to 390 rows, all Graviton (`c6g`, `m7g`, `t4g`, …), and no GPU family (`g4dn`, `g6e`, `gr6`) appears in it. x86 gives the remaining 932.
- "Clear" resets the architecture toggle back to All along with the search and chips.
- Searching for `zzz` shows "No instances match these filters."

Stop the dev server when done.

- [ ] **Step 5: Run the test suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS, 85 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add src/lib/Toolbar.svelte src/App.svelte src/app.css
git commit -m "feat: add search, family filter, and hourly/monthly price toggle"
```

---

### Task 7: URL synchronisation

**Files:**
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `fromSearchParams`, `toSearchParams` (Task 4).
- Produces: nothing further.

- [ ] **Step 1: Hydrate the query from the URL**

In `src/App.svelte`, change the import line:

```js
  import { defaultQuery } from './lib/data/urlState.js'
```

to:

```js
  import { fromSearchParams, toSearchParams } from './lib/data/urlState.js'
```

and change the state declaration from:

```js
  let query = $state(defaultQuery())
```

to:

```js
  let query = $state(fromSearchParams(window.location.search))
```

- [ ] **Step 2: Write changes back to the URL**

Add this immediately after the `visible` declaration in `src/App.svelte`:

```js
  $effect(() => {
    const params = toSearchParams(query)
    const url = params ? `?${params}` : window.location.pathname
    window.history.replaceState(null, '', url)
  })
```

`replaceState`, not `pushState`: every keystroke in the search box would otherwise add a history entry and make the back button useless.

The effect reads `query` through `toSearchParams`, which touches `search`, `families`, `sort`, `dir` and `unit` — so all five are tracked as dependencies and any change re-syncs the URL.

- [ ] **Step 3: Verify round-tripping in the browser**

Run: `npm run dev`

Expected, checked by eye:
- The address bar stays clean on first load — no `?` with default values.
- Typing `c7g`, clicking "Compute optimized", sorting by vCPU descending, and switching to `$/month` produces a URL like
  `?q=c7g&fam=Compute+optimized&sort=vcpu&dir=desc&unit=month`.
- Reloading that URL restores the search text, the filled chip, the sort arrow on vCPU, and the monthly prices.
- Copying the URL into a fresh tab reproduces the same view.
- Clearing every filter empties the query string again.
- Hand-editing the URL to `?sort=bogus&dir=sideways&unit=fortnight` loads the default view instead of a blank page.
- The browser back button still leaves the page rather than stepping through each keystroke.

Stop the dev server when done.

- [ ] **Step 4: Run the full suite and build**

Run:
```bash
cd /Users/zeb/src/Perso/cloud-pricing
npm test && npm run build
```
Expected: 85 tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/zeb/src/Perso/cloud-pricing
git add src/App.svelte
git commit -m "feat: sync filter and sort state to the URL for shareable views"
```

---

## Done When

- `npm test` passes 85 tests across three files (39 normalize, 24 query, 22 urlState).
- `npm run build` succeeds.
- The table renders 1322 rows, sorts numerically on every numeric column, filters by family and search, toggles hourly/monthly, and round-trips through the URL.
- No `Counter.svelte`, no demo CSS, and no Vite/Svelte branding remains — including `public/favicon.svg`, `public/icons.svg` and `README-svelte.md`.
- `README.md` documents all six fixtures and the `--compression=auto` flag.

## Deliberately Not Done

Region and OS switching, spot prices, GCP, S3, cross-region transfer, row virtualization, and column visibility toggles. Virtualization in particular should only be added against a measured frame time, not on suspicion — 1322 rows is well within what the DOM handles.
