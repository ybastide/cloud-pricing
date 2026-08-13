# Arch column — design spec

## Goal

Show each instance's processor architecture (ARM/x86) as a sortable column in both the AWS
and GCP tables, right after the Instance/Machine type column.

## Background

Every row already carries `arch` (`'arm'`/`'x86'`, computed in `src/lib/data/normalize.js`),
and the Toolbar already filters by it (`src/lib/Toolbar.svelte`'s ARM/x86 toggle, labelled
`'ARM'`/`'x86'`). There is no column displaying it today, and `arch` isn't a sortable key —
`src/lib/data/query.js`'s `SORT_KEYS` (`type`, `vcpu`, `memGiB`, `storageGB`, `netGbps`, `usd`)
has no entry for it.

## Change

### Sorting (`src/lib/data/query.js`)

Add an `arch` comparator to `COMPARATORS`, positioned right after `type` (so `SORT_KEYS`
reflects the column's visual order):

```js
const COMPARATORS = {
  type: (a, b) => /* unchanged */,
  arch: (a, b) => a.arch.localeCompare(b.arch),
  vcpu: (a, b) => a.vcpu - b.vcpu,
  memGiB: (a, b) => a.memGiB - b.memGiB,
  storageGB: (a, b) => a.storageGB - b.storageGB,
  netGbps: (a, b) => a.netGbps - b.netGbps,
  usd: (a, b) => a.usd - b.usd,
}
```

`localeCompare` sorts `'arm'` before `'x86'` ascending with no special-casing. `SORT_KEYS`
becomes `['type', 'arch', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd']`; the existing exact
`toEqual` test on `SORT_KEYS` in `query.test.js` is updated to match.

### Column definitions

Insert a new column right after `type` in both column arrays:

```js
{ key: 'arch', label: 'Arch', render: (row) => (row.arch === 'arm' ? 'ARM' : 'x86') }
```

- `src/lib/InstanceTable.svelte`'s `DEFAULT_COLUMNS` (AWS).
- `src/App.svelte`'s `GCP_COLUMNS` (GCP).

No shared helper for the one-line render ternary — duplicated in both arrays rather than
introducing a new module for it. `InstanceTable.svelte`'s existing generic header-click
sorting (`onsort(column.key)`) and cell rendering (`column.render`) require no changes; they
already handle any column whose `key` exists in `SORT_KEYS`.

### Existing e2e fallout

Inserting a column at index 1 shifts every later column's index by one. Two existing tests use
positional `td.nth(N)` lookups that must be bumped:

- `e2e/pricing-table.spec.js`'s `'sorts memory numerically, not lexicographically'` test:
  `.nth(2)` → `.nth(3)`.
- `e2e/gcp-tab.spec.js`'s `'sorts by Local SSD without NaN corrupting the order'` test:
  `.nth(3)` → `.nth(4)`.

## Testing

- `query.test.js`: a unit test for the new `arch` comparator (ascending sorts ARM before x86;
  descending reverses it), and the updated `SORT_KEYS` exact-equality assertion.
- e2e: one test per provider confirming the Arch column renders (`'Arch'` header button
  visible) and sorts correctly (click the header, assert ARM-vs-x86 grouping in the resulting
  row order) — same shape as the existing `'sorts memory numerically, not lexicographically'`
  test. Plus the two index-bump fixes above.
