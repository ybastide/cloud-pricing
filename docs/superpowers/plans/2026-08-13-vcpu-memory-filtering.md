# vCPU/Memory Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter the instance table by vCPU count and/or memory size using `=` and
`>=` comparisons, via dedicated Toolbar controls that stay in sync with `vcpu=`/`mem=` tokens
typed into the existing search box.

**Architecture:** Two new numeric-filter fields (`vcpuOp`/`vcpuVal`, `memOp`/`memVal`) join
`query` state. `applyQuery` (`src/lib/data/query.js`) gains two more AND'ed predicates. A new
pure function `parseFilterTokens` (same file) extracts `vcpu`/`mem` tokens out of free-typed
search text; `Toolbar.svelte`'s search handler feeds every keystroke through it and writes the
result straight into the canonical fields, so the dedicated `<select>`+`<input type="number">`
pair and the search box can never disagree. `urlState.js` persists the two pairs following the
existing omit-if-default pattern.

**Tech Stack:** Svelte 5 (runes), Vite, Vitest, Playwright.

## Global Constraints

- Both operators are exactly `'='` and `'>='` (as literal string values) — no other operator is
  ever valid, per the spec's title.
- vCPU is **not** integer-only: GCP's shared-core types are fractional (`f1-micro`: 0.2 vCPU,
  `g1-small`: 0.5 vCPU) — both vCPU and Memory numeric inputs must accept decimals
  (`step="any"`).
- A filter is inactive whenever its `*Val` field is the empty string `''` — the operator field
  is irrelevant while `*Val` is `''` and never needs to be reset for the filter to become
  inactive.
- Token regex, exact: `/\b(vcpu|mem)\s*(>=|=)\s*(\d+(?:\.\d+)?)\b/gi` — case/spacing-insensitive
  on the key and operator; anything not matching this exact shape (wrong operator, non-numeric
  value, missing value) is left untouched as plain substring text, never partially stripped.
- When the same key appears twice in typed text, the last occurrence wins.
- A matched token is always stripped from the visible search-box text; the dedicated control is
  the only thing ever written back into by the user directly — nothing writes tokens back into
  the search box.

---

### Task 1: Numeric filter predicates in `applyQuery`

**Files:**
- Modify: `src/lib/data/query.js:19-35` (the `applyQuery` function)
- Test: `src/lib/data/query.test.js`

**Interfaces:**
- Produces: `applyQuery(rows, query)` now also reads `query.vcpuOp`, `query.vcpuVal`,
  `query.memOp`, `query.memVal` (all optional; default to `'='`/`''`/`'='`/`''` respectively
  when absent, so every existing caller that doesn't pass them keeps working unchanged).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/data/query.test.js`, right after the existing `'searches...'` tests and before
the `'returns an empty array when nothing matches'` test (the `rows` fixture already defines
`m5.large` (vcpu 2, mem 8), `c7g.xlarge` (vcpu 4, mem 8), `r6i.4xlarge` (vcpu 16, mem 128),
`i4i.large` (vcpu 2, mem 16) — see the top of the file):

```js
  it('filters vcpu by exact match', () => {
    const out = applyQuery(rows, { ...base, vcpuOp: '=', vcpuVal: '4' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge'])
  })

  it('filters vcpu by >=', () => {
    const out = applyQuery(rows, { ...base, vcpuOp: '>=', vcpuVal: '4' })
    expect(out.map((r) => r.type).sort()).toEqual(['c7g.xlarge', 'r6i.4xlarge'])
  })

  it('filters mem by exact match', () => {
    const out = applyQuery(rows, { ...base, memOp: '=', memVal: '8' })
    expect(out.map((r) => r.type).sort()).toEqual(['c7g.xlarge', 'm5.large'])
  })

  it('filters mem by >=', () => {
    const out = applyQuery(rows, { ...base, memOp: '>=', memVal: '16' })
    expect(out.map((r) => r.type).sort()).toEqual(['i4i.large', 'r6i.4xlarge'])
  })

  it('matches fractional vcpu values, e.g. GCP shared-core types', () => {
    const withFractional = [...rows, row('f1-micro', { vcpu: 0.2, memGiB: 0.6 })]
    const exact = applyQuery(withFractional, { ...base, vcpuOp: '=', vcpuVal: '0.2' })
    expect(exact.map((r) => r.type)).toEqual(['f1-micro'])
    const atLeast = applyQuery(withFractional, { ...base, vcpuOp: '>=', vcpuVal: '0.2' })
    expect(atLeast).toHaveLength(5)
  })

  it('treats an empty vcpu/mem value as an inactive filter', () => {
    expect(applyQuery(rows, { ...base, vcpuOp: '>=', vcpuVal: '', memOp: '=', memVal: '' })).toHaveLength(4)
  })

  it('combines vcpu and mem filters with each other (AND)', () => {
    const out = applyQuery(rows, { ...base, vcpuOp: '>=', vcpuVal: '2', memOp: '=', memVal: '8' })
    expect(out.map((r) => r.type).sort()).toEqual(['c7g.xlarge', 'm5.large'])
  })

  it('combines a vcpu filter with the family filter', () => {
    const query = { ...base, families: new Set(['Memory optimized']), vcpuOp: '>=', vcpuVal: '2' }
    expect(applyQuery(rows, query).map((r) => r.type)).toEqual(['r6i.4xlarge'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: the 8 new tests FAIL (vcpu/mem filters not yet implemented — either a runtime error
reading `undefined` fields, or filters silently not applied so counts don't match).

- [ ] **Step 3: Implement the minimal code**

In `src/lib/data/query.js`, add a helper above `applyQuery` and extend the destructuring and
filter predicate:

```js
function matchesOp(actual, op, target) {
  return op === '>=' ? actual >= target : actual === target
}

export function applyQuery(rows, query) {
  const {
    search = '',
    families,
    arch,
    sort,
    dir,
    vcpuOp = '=',
    vcpuVal = '',
    memOp = '=',
    memVal = '',
  } = query
  const needle = search.trim().toLowerCase()
  const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]
  const sign = dir === 'desc' ? -1 : 1
  const byFamily = families instanceof Set && families.size > 0
  const byArch = arch === 'arm' || arch === 'x86'
  const byVcpu = vcpuVal !== ''
  const byMem = memVal !== ''
  const vcpuTarget = Number(vcpuVal)
  const memTarget = Number(memVal)

  return rows
    .filter((row) => {
      if (byFamily && !families.has(row.family)) return false
      if (byArch && row.arch !== arch) return false
      if (byVcpu && !matchesOp(row.vcpu, vcpuOp, vcpuTarget)) return false
      if (byMem && !matchesOp(row.memGiB, memOp, memTarget)) return false
      if (needle && !row.type.toLowerCase().includes(needle)) return false
      return true
    })
    .sort((a, b) => sign * compare(a, b) || a.type.localeCompare(b.type))
}
```

(`row` is already imported/defined at the top of `query.test.js` — no new import needed there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: PASS, all tests including the 8 new ones and every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/query.js src/lib/data/query.test.js
git commit -m "feat: filter instances by vCPU and memory with = and >="
```

---

### Task 2: `parseFilterTokens` for the search box

**Files:**
- Modify: `src/lib/data/query.js` (add the new function; no existing lines change)
- Test: `src/lib/data/query.test.js`

**Interfaces:**
- Produces: `parseFilterTokens(text: string) -> { text: string, vcpu: {op, val}|null, mem:
  {op, val}|null }`. `op` is `'='`/`'>='`, `val` is a `number`. Consumed by `Toolbar.svelte` in
  Task 4.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/lib/data/query.test.js`, importing the new export:

```js
import { SORT_KEYS, applyQuery, parseFilterTokens } from './query.js'
```

(replace the existing `import { SORT_KEYS, applyQuery } from './query.js'` line at the top of
the file with the line above)

```js
describe('parseFilterTokens', () => {
  it('extracts a single vcpu token and strips it from the text', () => {
    expect(parseFilterTokens('vcpu>=4')).toEqual({ text: '', vcpu: { op: '>=', val: 4 }, mem: null })
  })

  it('extracts a single mem token and strips it from the text', () => {
    expect(parseFilterTokens('mem=16')).toEqual({ text: '', vcpu: null, mem: { op: '=', val: 16 } })
  })

  it('extracts both keys from one string, leaving the remaining substring text', () => {
    expect(parseFilterTokens('c7g vcpu>=4 mem=16')).toEqual({
      text: 'c7g',
      vcpu: { op: '>=', val: 4 },
      mem: { op: '=', val: 16 },
    })
  })

  it('keeps the last match when the same key appears twice', () => {
    expect(parseFilterTokens('vcpu>=4 vcpu=8')).toEqual({ text: '', vcpu: { op: '=', val: 8 }, mem: null })
  })

  it('is case- and spacing-insensitive', () => {
    expect(parseFilterTokens('VCPU >= 4')).toEqual({ text: '', vcpu: { op: '>=', val: 4 }, mem: null })
  })

  it('parses fractional values', () => {
    expect(parseFilterTokens('vcpu=0.2')).toEqual({ text: '', vcpu: { op: '=', val: 0.2 }, mem: null })
  })

  it('leaves an unsupported operator as plain text', () => {
    expect(parseFilterTokens('vcpu>4')).toEqual({ text: 'vcpu>4', vcpu: null, mem: null })
  })

  it('leaves a non-numeric value as plain text', () => {
    expect(parseFilterTokens('vcpu=abc')).toEqual({ text: 'vcpu=abc', vcpu: null, mem: null })
  })

  it('leaves a missing value as plain text', () => {
    expect(parseFilterTokens('mem=')).toEqual({ text: 'mem=', vcpu: null, mem: null })
  })

  it('returns the original text unchanged when there are no tokens', () => {
    expect(parseFilterTokens('m5.large')).toEqual({ text: 'm5.large', vcpu: null, mem: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: FAIL with "parseFilterTokens is not a function" / "not exported".

- [ ] **Step 3: Implement the minimal code**

Add to `src/lib/data/query.js` (anywhere below the existing exports):

```js
const TOKEN = /\b(vcpu|mem)\s*(>=|=)\s*(\d+(?:\.\d+)?)\b/gi

export function parseFilterTokens(text) {
  let vcpu = null
  let mem = null

  const stripped = text.replace(TOKEN, (_match, key, op, val) => {
    const parsed = { op, val: Number(val) }
    if (key.toLowerCase() === 'vcpu') vcpu = parsed
    else mem = parsed
    return ''
  })

  return { text: stripped.replace(/\s+/g, ' ').trim(), vcpu, mem }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/query.js src/lib/data/query.test.js
git commit -m "feat: parse vcpu/mem tokens out of free-typed search text"
```

---

### Task 3: URL persistence for vcpu/mem filters

**Files:**
- Modify: `src/lib/data/urlState.js` (all functions)
- Test: `src/lib/data/urlState.test.js`

**Interfaces:**
- Consumes: nothing new (no dependency on Tasks 1/2's code, only on the `query` shape they
  established: `vcpuOp`/`vcpuVal`/`memOp`/`memVal`).
- Produces: `defaultQuery()` now includes `vcpuOp: '=', vcpuVal: '', memOp: '=', memVal: ''`.
  `toSearchParams`/`fromSearchParams` round-trip those four fields. Consumed by `App.svelte`
  (already calls both) and by `Toolbar.svelte`/`App.svelte` in Tasks 4–5, which read/write
  these fields on the bound `query` object.

- [ ] **Step 1: Write the failing tests**

First, update the existing `defaultQuery` test's expectation in
`src/lib/data/urlState.test.js` (it currently lists 7 fields and needs the 4 new ones added):

```js
describe('defaultQuery', () => {
  it('starts empty, sorted by price ascending, priced hourly', () => {
    expect(defaultQuery()).toEqual({
      provider: 'aws',
      search: '',
      families: new Set(),
      arch: 'all',
      sort: 'usd',
      dir: 'asc',
      unit: 'hour',
      vcpuOp: '=',
      vcpuVal: '',
      memOp: '=',
      memVal: '',
    })
  })
```

Then add a new `describe` block at the end of the file:

```js
describe('vcpu and mem filters in the query state', () => {
  it('omits vcpu/mem params when the values are empty', () => {
    expect(toSearchParams(defaultQuery())).toBe('')
  })

  it('serialises a vcpu value with the default operator omitted', () => {
    expect(toSearchParams({ ...defaultQuery(), vcpuVal: '4' })).toBe('vcpuVal=4')
  })

  it('serialises a vcpu value with a non-default operator', () => {
    expect(toSearchParams({ ...defaultQuery(), vcpuOp: '>=', vcpuVal: '4' })).toBe(
      'vcpuVal=4&vcpuOp=%3E%3D',
    )
  })

  it('serialises a mem value with a non-default operator', () => {
    expect(toSearchParams({ ...defaultQuery(), memOp: '>=', memVal: '16' })).toBe(
      'memVal=16&memOp=%3E%3D',
    )
  })

  it('accepts a known operator paired with a valid value', () => {
    const q = fromSearchParams('vcpuVal=4&vcpuOp=%3E%3D')
    expect(q.vcpuOp).toBe('>=')
    expect(q.vcpuVal).toBe('4')
  })

  it('falls back to the default operator for an unknown operator', () => {
    expect(fromSearchParams('vcpuVal=4&vcpuOp=%3C').vcpuOp).toBe('=')
  })

  it('falls back to an inactive (empty) value for a non-numeric value', () => {
    expect(fromSearchParams('vcpuVal=abc').vcpuVal).toBe('')
  })

  it('falls back to an inactive value when missing', () => {
    expect(fromSearchParams('').memVal).toBe('')
  })

  it('round-trips vcpu and mem filters together with other fields', () => {
    const query = {
      ...defaultQuery(),
      search: 'm5',
      vcpuOp: '>=',
      vcpuVal: '4',
      memOp: '=',
      memVal: '16',
    }
    expect(fromSearchParams(toSearchParams(query))).toEqual(query)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: FAIL — `defaultQuery` test fails on the missing 4 fields, and every test in the new
`describe` block fails (fields don't exist yet).

- [ ] **Step 3: Implement the minimal code**

Replace the full contents of `src/lib/data/urlState.js` with:

```js
import { DEFAULT_DIR, DEFAULT_SORT, SORT_KEYS } from './query.js'

const DEFAULT_UNIT = 'hour'
const DEFAULT_ARCH = 'all'
const DEFAULT_PROVIDER = 'aws'
const DEFAULT_OP = '='
const ARCHES = ['arm', 'x86']
const PROVIDERS = ['aws', 'gcp']
const OPS = ['=', '>=']

export function defaultQuery() {
  return {
    provider: DEFAULT_PROVIDER,
    search: '',
    families: new Set(),
    arch: DEFAULT_ARCH,
    sort: DEFAULT_SORT,
    dir: DEFAULT_DIR,
    unit: DEFAULT_UNIT,
    vcpuOp: DEFAULT_OP,
    vcpuVal: '',
    memOp: DEFAULT_OP,
    memVal: '',
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
  if (query.vcpuVal) {
    params.set('vcpuVal', query.vcpuVal)
    if (query.vcpuOp && query.vcpuOp !== DEFAULT_OP) params.set('vcpuOp', query.vcpuOp)
  }
  if (query.memVal) {
    params.set('memVal', query.memVal)
    if (query.memOp && query.memOp !== DEFAULT_OP) params.set('memOp', query.memOp)
  }
  return params.toString()
}

function readOp(params, key) {
  const op = params.get(key)
  return OPS.includes(op) ? op : DEFAULT_OP
}

function readVal(params, key) {
  const val = params.get(key)
  return val !== null && Number.isFinite(Number(val)) ? val : ''
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

  query.vcpuOp = readOp(params, 'vcpuOp')
  query.vcpuVal = readVal(params, 'vcpuVal')
  query.memOp = readOp(params, 'memOp')
  query.memVal = readVal(params, 'memVal')

  return query
}
```

Each of `vcpuOp`/`vcpuVal`/`memOp`/`memVal` is validated independently (same style as the
existing `arch`/`sort`/`dir`/`unit` fields): an invalid operator falls back to `'='` regardless
of whether the value is valid, and a missing/non-numeric value falls back to `''` (inactive)
regardless of the operator.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/urlState.test.js`
Expected: PASS, all tests in the file, including the untouched pre-existing ones (they all
spread `defaultQuery()`, which now carries the 4 new fields, so they keep passing unchanged).

Also run the full suite once to confirm nothing else broke:

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/urlState.js src/lib/data/urlState.test.js
git commit -m "feat: persist vcpu/mem filters in the URL"
```

---

### Task 4: Toolbar UI — dedicated controls and search-box token wiring

**Files:**
- Modify: `src/lib/Toolbar.svelte` (script and markup)
- Modify: `src/app.css:138-140` (insert new rules between the search-input focus rule and
  `.units`)

**Interfaces:**
- Consumes: `parseFilterTokens` from `src/lib/data/query.js` (Task 2).
- Produces: no new exports — `Toolbar.svelte`'s `query` prop (already `$bindable()`) now also
  carries `vcpuOp`/`vcpuVal`/`memOp`/`memVal`, consumed by `App.svelte` via `applyQuery` (Task
  1, already wired in `App.svelte`) and by `urlState.js` (Task 3, already wired in
  `App.svelte`). No test file — Svelte components have no unit-test harness in this repo
  (verify with `find src -iname "*.test.*"`, which lists only files under `src/lib/data/`);
  this task is verified by manual smoke-check in Step 4 and by the e2e suite in Task 6.

- [ ] **Step 1: Update the script block**

Replace the `<script>` block of `src/lib/Toolbar.svelte` (currently lines 1–39) with:

```svelte
<script>
  import { parseFilterTokens } from './data/query.js'

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

  let debounceTimer

  function onSearchInput(value) {
    query.search = value
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const { text, vcpu, mem } = parseFilterTokens(query.search)
      query.search = text
      if (vcpu) {
        query.vcpuOp = vcpu.op
        query.vcpuVal = String(vcpu.val)
      }
      if (mem) {
        query.memOp = mem.op
        query.memVal = String(mem.val)
      }
    }, 350)
  }

  function clear() {
    query.search = ''
    query.families = new Set()
    query.arch = 'all'
    query.vcpuOp = '='
    query.vcpuVal = ''
    query.memOp = '='
    query.memVal = ''
  }

  const filtering = $derived(
    query.search !== '' ||
      query.families.size > 0 ||
      query.arch !== 'all' ||
      query.vcpuVal !== '' ||
      query.memVal !== '',
  )

  const ARCHES = [
    { value: 'all', label: 'All' },
    { value: 'arm', label: 'ARM' },
    { value: 'x86', label: 'x86' },
  ]

  const placeholder = $derived(placeholders[query.arch] ?? placeholders.all)
</script>
```

- [ ] **Step 2: Update the markup**

Replace the search `<input>` (currently lines 42–47) with a controlled input that routes
through `onSearchInput` instead of `bind:value` (it can no longer be a plain two-way bind,
since raw keystrokes echo into `query.search` immediately but only get parsed into tokens
after the 350ms debounce settles):

```svelte
  <input
    type="search"
    {placeholder}
    value={query.search}
    oninput={(e) => onSearchInput(e.currentTarget.value)}
    aria-label="Filter by instance type"
  />
```

Immediately after that input (still inside the first `<div class="toolbar">`, before the
`{#if showArch}` block), add the two dedicated control pairs:

```svelte
  <div class="numeric-filter" role="group" aria-label="vCPU filter">
    <span class="numeric-filter-label">vCPU</span>
    <select bind:value={query.vcpuOp} aria-label="vCPU operator">
      <option value="=">=</option>
      <option value=">=">≥</option>
    </select>
    <input
      type="number"
      min="0"
      step="any"
      value={query.vcpuVal}
      oninput={(e) => (query.vcpuVal = e.currentTarget.value)}
      aria-label="vCPU value"
    />
  </div>

  <div class="numeric-filter" role="group" aria-label="Memory filter">
    <span class="numeric-filter-label">Memory</span>
    <select bind:value={query.memOp} aria-label="Memory operator">
      <option value="=">=</option>
      <option value=">=">≥</option>
    </select>
    <input
      type="number"
      min="0"
      step="any"
      value={query.memVal}
      oninput={(e) => (query.memVal = e.currentTarget.value)}
      aria-label="Memory value"
    />
    <span class="numeric-filter-unit">GiB</span>
  </div>
```

(The number inputs use `value=`/`oninput=` rather than `bind:value` deliberately: Svelte
coerces `bind:value` on `<input type="number">` to a JS number and to a non-string sentinel
when empty, but every field in `query` for this feature is defined as a string — `''` means
inactive — to match `urlState.js`'s params, which are always strings. The plain `<select>`
above doesn't have this problem, since `bind:value` on a `<select>` always yields the chosen
`<option>`'s string `value`.)

- [ ] **Step 3: Add the CSS**

In `src/app.css`, insert the following between the `.toolbar input[type='search']:focus-visible`
rule and the `.units` rule (i.e. right after the closing `}` at line 138, before the blank line
and `.units {` at line 140):

```css
.numeric-filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}

.numeric-filter-label,
.numeric-filter-unit {
  font-size: 0.85rem;
  color: var(--text-dim);
}

.numeric-filter select,
.numeric-filter input[type='number'] {
  padding: 0.5rem 0.5rem;
  font: inherit;
  color: inherit;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.numeric-filter input[type='number'] {
  width: 4.5rem;
}
```

- [ ] **Step 4: Manual smoke-check**

Run: `npm run dev`, open the printed local URL in a browser.

Expected: the toolbar shows the search box, then a `vCPU [=▾][__]` pair, then a
`Memory [=▾][__] GiB` pair, then the ARM/x86 toggle, then the $/hour/$/month toggle — typing
`vcpu>=4` into the search box clears the typed text down to whatever's left, sets the vCPU
select to `≥` and its number field to `4`, and the table/count shrink accordingly. Stop the dev
server (Ctrl-C) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte src/app.css
git commit -m "feat: add vCPU/memory filter controls to the toolbar"
```

---

### Task 5: Reset vcpu/mem filters on provider switch

**Files:**
- Modify: `src/App.svelte:88-93` (the `switchProvider` function)
- Modify: `e2e/gcp-tab.spec.js` (extend the existing `'resets filters when switching
  providers'` test)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — internal behavior only.

- [ ] **Step 1: Write the failing e2e assertions**

In `e2e/gcp-tab.spec.js`, add two locators near the top (alongside the existing `searchBox`,
`archButton`, etc. locator definitions):

```js
const vcpuVal = (page) => page.getByRole('spinbutton', { name: 'vCPU value' })
const memVal = (page) => page.getByRole('spinbutton', { name: 'Memory value' })
```

Then extend the existing test:

```js
test('resets filters when switching providers', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('m5')
  await vcpuVal(page).fill('4')
  await memVal(page).fill('16')
  await gcpTab(page).click()
  await expect(searchBox(page)).toHaveValue('')
  await expect(vcpuVal(page)).toHaveValue('')
  await expect(memVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/gcp-tab.spec.js -g "resets filters"`
Expected: FAIL — after switching to GCP, `vcpuVal`/`memVal` still show `'4'`/`'16'` because
`switchProvider` doesn't reset them yet.

- [ ] **Step 3: Implement the minimal code**

In `src/App.svelte`, update `switchProvider`:

```js
  function switchProvider(next) {
    if (query.provider === next) return
    query.provider = next
    query.search = ''
    query.families = new Set()
    query.vcpuOp = '='
    query.vcpuVal = ''
    query.memOp = '='
    query.memVal = ''
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/gcp-tab.spec.js -g "resets filters"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte e2e/gcp-tab.spec.js
git commit -m "fix: reset vcpu/mem filters when switching providers"
```

---

### Task 6: End-to-end coverage for filtering, token parsing, and URL round-trip

**Files:**
- Create: `e2e/numeric-filtering.spec.js`

**Interfaces:**
- Consumes: the running app (built by Tasks 1–5). Uses the AWS `c5` family as a fixed,
  verified fixture: `c5.large` (2 vCPU / 4 GiB), `c5.xlarge` (4 / 8), `c5.2xlarge` (8 / 16),
  `c5.4xlarge` (16 / 32), `c5.9xlarge` (36 / 72), `c5.12xlarge` (48 / 96), `c5.18xlarge` (72 /
  144), `c5.24xlarge` (96 / 192), `c5.metal` (96 / 192) — confirmed against
  `fixtures/aws/instances.json`.

- [ ] **Step 1: Write the test file**

Create `e2e/numeric-filtering.spec.js`:

```js
import { expect, test } from '@playwright/test'

const TOTAL = 1322

const searchBox = (page) => page.getByRole('searchbox', { name: 'Filter by instance type' })
const vcpuOp = (page) => page.getByRole('combobox', { name: 'vCPU operator' })
const vcpuVal = (page) => page.getByRole('spinbutton', { name: 'vCPU value' })
const memOp = (page) => page.getByRole('combobox', { name: 'Memory operator' })
const memVal = (page) => page.getByRole('spinbutton', { name: 'Memory value' })
const count = (page) => page.locator('p.count')
const typeCells = (page) => page.locator('tbody td.type')
const sortByInstance = (page) => page.getByRole('button', { name: 'Instance', exact: true }).click()

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.errors = errors
})

test('filters by exact vCPU count', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuVal(page).fill('96')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`2 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText(['c5.24xlarge', 'c5.metal'])
})

test('filters by vCPU at-least', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuOp(page).selectOption('>=')
  await vcpuVal(page).fill('48')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText([
    'c5.12xlarge',
    'c5.18xlarge',
    'c5.24xlarge',
    'c5.metal',
  ])
})

test('filters by exact memory size', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await memVal(page).fill('32')
  await expect(count(page)).toHaveText(`1 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText(['c5.4xlarge'])
})

test('filters by memory at-least', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await memOp(page).selectOption('>=')
  await memVal(page).fill('96')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText([
    'c5.12xlarge',
    'c5.18xlarge',
    'c5.24xlarge',
    'c5.metal',
  ])
})

test('parses a vcpu token typed into the search box and strips it', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5. vcpu>=48')
  await expect(searchBox(page)).toHaveValue('c5.')
  await expect(vcpuOp(page)).toHaveValue('>=')
  await expect(vcpuVal(page)).toHaveValue('48')
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
})

test('leaves an unrecognised token as plain substring text', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('vcpu>4')
  await expect(searchBox(page)).toHaveValue('vcpu>4')
  await expect(vcpuVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`0 of ${TOTAL} instances`)
})

test('round-trips vcpu/mem filters through the URL', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuOp(page).selectOption('>=')
  await vcpuVal(page).fill('48')

  await expect(page).toHaveURL('/?q=c5.&vcpuVal=48&vcpuOp=%3E%3D')

  await page.reload()
  await expect(vcpuOp(page)).toHaveValue('>=')
  await expect(vcpuVal(page)).toHaveValue('48')
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
})

test('clears vcpu/mem filters along with everything else', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuVal(page).fill('96')
  await memVal(page).fill('32')
  await page.getByRole('button', { name: 'Clear' }).click()

  await expect(vcpuVal(page)).toHaveValue('')
  await expect(memVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
})

test.afterEach(async ({ page }) => {
  expect(page.errors ?? []).toEqual([])
})
```

- [ ] **Step 2: Run the tests**

Unlike Tasks 1–5, there's no separate "implement" step here: Tasks 1–5 already built the
feature this file exercises end-to-end, so this is verification, not TDD red/green. Run:

`npx playwright test e2e/numeric-filtering.spec.js`

Expected: PASS, all 8 tests. If anything fails, that's a real bug in Tasks 1–5 — go fix it
there (don't work around it here), then re-run this command until it's green, per
`superpowers:verification-before-completion`.

- [ ] **Step 3: Run the full test suite one last time**

Run: `npm test && npx playwright test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/numeric-filtering.spec.js
git commit -m "test: cover vcpu/memory filtering end-to-end"
```
