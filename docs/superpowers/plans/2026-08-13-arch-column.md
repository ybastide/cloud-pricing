# Arch Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each instance's processor architecture (ARM/x86) as a sortable column, right
after Instance/Machine type, in both the AWS and GCP tables.

**Architecture:** Add an `arch` comparator to `query.js`'s `COMPARATORS` (which drives
`SORT_KEYS`), and insert a matching `{ key: 'arch', ... }` column into both
`InstanceTable.svelte`'s `DEFAULT_COLUMNS` (AWS) and `App.svelte`'s `GCP_COLUMNS` (GCP). No
new abstractions — the column's one-line render ternary is duplicated in both arrays.

**Tech Stack:** Svelte 5 (runes), Vite, Vitest, Playwright.

## Global Constraints

- The column goes right after Instance/Machine type in both tables' column order.
- Cell text is `'ARM'` for `row.arch === 'arm'`, `'x86'` otherwise — matching the Toolbar's
  existing ARM/x86 toggle labels exactly.
- The column is sortable via the existing generic header-click mechanism (any key present in
  `SORT_KEYS` sorts); `arch` sorts by `row.arch.localeCompare(...)`, so `'arm'` sorts before
  `'x86'` ascending with no special-casing.
- Inserting a column at index 1 shifts every later column's index by one in both tables — any
  test using positional `td.nth(N)` cell lookups must account for this.

---

### Task 1: `arch` sort comparator

**Files:**
- Modify: `src/lib/data/query.js:1-14` (the `COMPARATORS` object and `SORT_KEYS` export)
- Test: `src/lib/data/query.test.js`

**Interfaces:**
- Produces: `SORT_KEYS` (still `Object.keys(COMPARATORS)`) now includes `'arch'`, positioned
  second (`['type', 'arch', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd']`). `applyQuery`
  accepts `{ ...query, sort: 'arch' }` with no other changes needed — the existing
  `COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]` lookup and generic sort/tiebreak logic
  (`src/lib/data/query.js:36,54`, unchanged by this task) already handle any key present in
  `COMPARATORS`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/data/query.test.js`, right after the existing `'sorts numerically, not
lexicographically'` test (ends at the line before `'sorts instance type in natural AWS
order'`). The `rows` fixture at the top of the file already has: `m5.large` (x86),
`c7g.xlarge` (arm), `r6i.4xlarge` (x86), `i4i.large` (x86):

```js
  it('sorts ascending by architecture, ARM before x86, tie-broken by type', () => {
    const out = applyQuery(rows, { ...base, sort: 'arch', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'i4i.large', 'm5.large', 'r6i.4xlarge'])
  })

  it('sorts descending by architecture, x86 before ARM', () => {
    const out = applyQuery(rows, { ...base, sort: 'arch', dir: 'desc' })
    expect(out.map((r) => r.type)).toEqual(['i4i.large', 'm5.large', 'r6i.4xlarge', 'c7g.xlarge'])
  })
```

Then update the existing exact-equality test near the bottom of the same `describe` block:

```js
  it('exposes the sortable keys', () => {
    expect(SORT_KEYS).toEqual(['type', 'arch', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd'])
  })
```

(This replaces the current `expect(SORT_KEYS).toEqual(['type', 'vcpu', 'memGiB', 'storageGB',
'netGbps', 'usd'])` line — same test name, updated expectation.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: FAIL — the two new tests fail because sorting by `'arch'` falls back to the default
sort (`usd`, since `COMPARATORS.arch` doesn't exist yet), and `'exposes the sortable keys'`
fails because `SORT_KEYS` doesn't yet include `'arch'`.

- [ ] **Step 3: Implement the minimal code**

In `src/lib/data/query.js`, add the `arch` comparator to `COMPARATORS`, positioned right after
`type`:

```js
const COMPARATORS = {
  type: (a, b) =>
    a.letters.localeCompare(b.letters) ||
    a.generation - b.generation ||
    a.attrs.localeCompare(b.attrs) ||
    a.sizeRank - b.sizeRank,
  arch: (a, b) => a.arch.localeCompare(b.arch),
  vcpu: (a, b) => a.vcpu - b.vcpu,
  memGiB: (a, b) => a.memGiB - b.memGiB,
  storageGB: (a, b) => a.storageGB - b.storageGB,
  netGbps: (a, b) => a.netGbps - b.netGbps,
  usd: (a, b) => a.usd - b.usd,
}
```

Nothing else in the file changes — `SORT_KEYS`, `applyQuery`, and every other export are
already generic over `COMPARATORS`'s keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/query.test.js`
Expected: PASS, all tests including the 2 new ones and the updated `SORT_KEYS` assertion.

Also run the full suite once to confirm nothing else broke:

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/query.js src/lib/data/query.test.js
git commit -m "feat: make architecture a sortable column key"
```

---

### Task 2: Arch column in both tables

**Files:**
- Modify: `src/lib/InstanceTable.svelte` (the `DEFAULT_COLUMNS` array, currently lines 2-9)
- Modify: `src/App.svelte:20-30` (the `GCP_COLUMNS` array)

**Interfaces:**
- Consumes: `'arch'` as a valid `SORT_KEYS` entry (Task 1).
- Produces: no new exports — both column arrays gain a `{ key: 'arch', label: 'Arch', render:
  ... }` entry at index 1. `InstanceTable.svelte`'s existing generic column rendering
  (`cell(row, column)`, `ariaSort(key)`, the `onsort={() => onsort(column.key)}` button —
  unchanged by this task) already handles any column object in either array with no further
  wiring. No test file — Svelte components have no unit-test harness in this repo (only
  `src/lib/data/` has `.test.js` files); this task is verified by the e2e suite in Task 3.

- [ ] **Step 1: Add the column to AWS's `DEFAULT_COLUMNS`**

In `src/lib/InstanceTable.svelte`, insert one entry right after `type` in `DEFAULT_COLUMNS`:

```js
  const DEFAULT_COLUMNS = [
    { key: 'type', label: 'Instance', cellClass: 'type' },
    { key: 'arch', label: 'Arch', render: (row) => (row.arch === 'arm' ? 'ARM' : 'x86') },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    { key: 'storageGB', label: 'Storage', render: (row) => row.storage },
    { key: 'netGbps', label: 'Network', render: (row) => row.netLabel },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]
```

- [ ] **Step 2: Add the column to GCP's `GCP_COLUMNS`**

In `src/App.svelte`, insert the same entry right after `type` in `GCP_COLUMNS`:

```js
  const GCP_COLUMNS = [
    { key: 'type', label: 'Machine type', cellClass: 'type' },
    { key: 'arch', label: 'Arch', render: (row) => (row.arch === 'arm' ? 'ARM' : 'x86') },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    {
      key: 'storageGB',
      label: 'Local SSD',
      render: (row) => (row.storageGB > 0 ? `${row.storageGB} GiB` : ''),
    },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]
```

- [ ] **Step 3: Manual smoke-check**

Run: `npm run dev`, open the printed local URL in a browser.

Expected: on the AWS tab, the table header reads `Instance | Arch | vCPU | Memory | Storage |
Network | Price`, with each row's Arch cell showing `ARM` or `x86`; clicking the Arch header
sorts the table (arrow indicator appears, rows re-order). Switch to the GCP tab: header reads
`Machine type | Arch | vCPU | Memory | Local SSD | Price`, same behavior. Stop the dev server
(Ctrl-C) once confirmed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/InstanceTable.svelte src/App.svelte
git commit -m "feat: add an Arch column to the AWS and GCP tables"
```

---

### Task 3: Fix shifted e2e assertions, add Arch column coverage

**Files:**
- Modify: `e2e/pricing-table.spec.js:40` (index shift) and a new test
- Modify: `e2e/gcp-tab.spec.js:56` (index shift) and a new test

**Interfaces:**
- Consumes: the running app (built by Tasks 1-2). Both new tests sort the *entire* table (no
  family/search scoping) and check only the first and last rendered row's Arch cell — this
  works because AWS is confirmed to have both architectures overall (390 ARM / 932 x86 out of
  1322, per the existing `'splits the fleet into ARM and x86 with no overlap'` test), and GCP
  likewise (72 ARM / 398 x86 out of 470, per the existing `'shows the architecture toggle...'`
  test) — an ascending architecture sort of the whole table always puts the entire ARM group
  first, then the entire x86 group, regardless of which specific instance ends up first/last
  within each group.

- [ ] **Step 1: Fix the two shifted positional assertions**

In `e2e/pricing-table.spec.js`, the `'sorts memory numerically, not lexicographically'` test
currently reads column index 2 for Memory; with Arch now at index 1, Memory moves to index 3:

```js
test('sorts memory numerically, not lexicographically', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(typeCells(page).first()).toHaveText('u7in-32tb.224xlarge')
  await expect(page.locator('tbody tr').first().locator('td').nth(3)).toHaveText('32768 GiB')
})
```

(Only the `.nth(2)` → `.nth(3)` change; everything else in the test is unchanged.)

In `e2e/gcp-tab.spec.js`, the `'sorts by Local SSD without NaN corrupting the order'` test
currently reads column index 3 for Local SSD; with Arch now at index 1, Local SSD moves to
index 4:

```js
test('sorts by Local SSD without NaN corrupting the order', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  // First click on a non-type column sorts descending (same convention as the AWS spec's
  // memory-sort test); click twice to reach ascending, where no-Local-SSD rows sort first.
  await page.getByRole('button', { name: 'Local SSD', exact: true }).click()
  await page.getByRole('button', { name: 'Local SSD', exact: true }).click()
  const firstRowCells = page.locator('main > table tbody tr').first().locator('td')
  await expect(firstRowCells.nth(4)).toHaveText('') // ascending: no-Local-SSD rows sort first
})
```

(Only the `.nth(3)` → `.nth(4)` change; the comment and everything else is unchanged.)

- [ ] **Step 2: Run the two fixed tests to confirm they pass against Task 1-2's build**

Run: `npx playwright test e2e/pricing-table.spec.js -g "sorts memory numerically"`
Run: `npx playwright test e2e/gcp-tab.spec.js -g "sorts by Local SSD"`
Expected: both PASS (they'd fail with the old `.nth(2)`/`.nth(3)` indices once Tasks 1-2 have
landed, since those positions now hold the Arch column's `'ARM'`/`'x86'` text instead of the
expected values).

- [ ] **Step 3: Add the AWS Arch-column e2e test**

In `e2e/pricing-table.spec.js`, add (anywhere near the other sort-related tests, e.g. right
after the now-fixed `'sorts memory numerically, not lexicographically'` test):

```js
test('sorts by architecture, grouping ARM before x86', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveText('ARM')
  await expect(page.locator('tbody tr').last().locator('td').nth(1)).toHaveText('x86')
})
```

(Two clicks: the app's `sortBy()` defaults a newly-selected non-`type` column to descending on
the first click, same convention the existing Local-SSD/Memory sort tests already rely on; the
second click reaches ascending, where the whole ARM group sorts before the whole x86 group.)

- [ ] **Step 4: Add the GCP Arch-column e2e test**

In `e2e/gcp-tab.spec.js`, add (anywhere near the other GCP table tests, e.g. right after
`'shows GCP-specific columns and no Network column'`):

```js
test('sorts by architecture, grouping ARM before x86', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  const rows = page.locator('main > table tbody tr')
  await expect(rows.first().locator('td').nth(1)).toHaveText('ARM')
  await expect(rows.last().locator('td').nth(1)).toHaveText('x86')
})
```

(Scoped to `main > table` like the file's other tests, since the Disk pricing / Hyperdisk
compatibility panels below the main table would otherwise also match `tbody tr`.)

- [ ] **Step 5: Run both new tests, then the full suite**

Run: `npx playwright test e2e/pricing-table.spec.js -g "sorts by architecture"`
Run: `npx playwright test e2e/gcp-tab.spec.js -g "sorts by architecture"`
Expected: both PASS.

Run: `npm test && npx playwright test`
Expected: PASS — full unit suite and full e2e suite, including the two fixed tests and the two
new ones.

- [ ] **Step 6: Commit**

```bash
git add e2e/pricing-table.spec.js e2e/gcp-tab.spec.js
git commit -m "test: cover the Arch column and fix column-index shift in existing e2e tests"
```
