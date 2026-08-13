# vCPU/Memory filtering — design spec

## Goal

Let users filter the instance table by vCPU count and/or memory size, using `=` (exact) and
`>=` (at least) comparisons, via both a dedicated pair of controls and inline tokens typed
into the existing search box — the two stay in sync because typed tokens write into the same
canonical state and are stripped from the visible text.

## Background

`applyQuery` (`src/lib/data/query.js`) already filters by family, architecture, and an
instance-type substring search, and sorts by any of `SORT_KEYS` (including `vcpu` and
`memGiB`). There is no way to *filter* by vCPU or memory value today — only sort by them.
Both fields are numeric on every row (`src/lib/data/normalize.js`) but neither is
integer-only: `memGiB` is `parseFloat` on both providers, and while AWS `vcpu` is
`parseInt`, GCP's shared-core types are fractional (`f1-micro` is `vcpu: 0.2`, `g1-small`
is `vcpu: 0.5`) — so vCPU must accept decimals too.

## Change

### State

Four new fields on `query`, defaulted in `urlState.js`:

```js
vcpuOp: '=',  vcpuVal: '',   // '' means the filter is inactive
memOp: '=',   memVal: '',
```

The operator is always one of `'='` / `'>='`; the filter only takes effect once `*Val` is a
non-empty string. Clearing the value field alone deactivates the filter — the operator does
not need to be reset.

### Filtering (`src/lib/data/query.js`)

`applyQuery` gains two more predicates, AND'ed with the existing family/arch/search filters:

```js
function matchesOp(actual, op, target) {
  return op === '>=' ? actual >= target : actual === target
}
```

```js
if (vcpuVal !== '' && !matchesOp(row.vcpu, vcpuOp, Number(vcpuVal))) return false
if (memVal !== '' && !matchesOp(row.memGiB, memOp, Number(memVal))) return false
```

### Search-box token parsing (`src/lib/data/query.js`)

New pure function `parseFilterTokens(text)`:

- Regex `/\b(vcpu|mem)\s*(>=|=)\s*(\d+(?:\.\d+)?)\b/gi` — case-insensitive, tolerant of
  spacing around the operator (`vcpu >= 4`, `VCPU>=4`, `mem=16` all match).
- Matches are consumed left to right; if the same key appears twice, the last match wins.
- Returns `{ text, vcpu, mem }`:
  - `text` — the input with every matched token substring removed, extra whitespace
    collapsed and trimmed.
  - `vcpu` / `mem` — `{ op, val }` (`val` as a number) for the winning match, or `null` if
    that key never appeared.
- Anything that doesn't match the full pattern is left as plain substring text and folds
  into the existing instance-type search — this includes an unsupported operator
  (`vcpu>4`), a non-numeric value (`vcpu=abc`), or a missing value (`mem=`). There is no
  partial strip in these cases.

### Wiring (`src/lib/Toolbar.svelte`)

The search input echoes raw keystrokes into `query.search` immediately, then re-parses that
text 350ms after the last keystroke and writes the parsed result into the canonical fields —
so a typed token and the dedicated control can never disagree about the same key once the
debounce settles:

```js
let debounceTimer

function onSearchInput(value) {
  query.search = value
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const { text, vcpu, mem } = parseFilterTokens(query.search)
    query.search = text
    if (vcpu) { query.vcpuOp = vcpu.op; query.vcpuVal = String(vcpu.val) }
    if (mem) { query.memOp = mem.op; query.memVal = String(mem.val) }
  }, 350)
}
```

The debounce exists to fix two bugs a synchronous `parseFilterTokens(value)` call had: it
parsed and stripped a token after every matching keystroke, so typing a multi-digit value
(`vcpu>=4` then `8`) visibly snapped the search box down to `''` after the first matching
digit instead of once the number was fully typed; and a pasted or programmatically-set value
could be parsed against stale DOM text. Deferring the parse to a quiet period after typing
stops fixes both, while the immediate echo into `query.search` keeps the search box feeling
live rather than laggy.

The callback re-reads `query.search` — not the `value` argument it closed over — when the
timer fires. That's deliberate: it's what makes clicking "Clear" (or switching providers)
mid-debounce safe. Either of those resets `query.search` to `''` synchronously, so by the
time a pending timer fires it re-parses empty text and writes nothing, instead of
resurrecting the filter state the user just cleared.

Two new control pairs added to the existing top toolbar row, alongside the search box and
the arch/unit toggles:

```
[search box]   vCPU [=▾] [___]   Memory [=▾] [___] GiB   [ARM|x86]   [$/hour|$/month]
```

- Operator `<select>`, options `=` / `≥` (values `'='` / `'>='`), bound directly to
  `query.vcpuOp` / `query.memOp`.
- Number `<input type="number">` bound to `query.vcpuVal` / `query.memVal`, both
  `min="0" step="any"` — GCP's shared-core types (`f1-micro`: 0.2 vCPU, `g1-small`: 0.5
  vCPU) and fractional GiB memory values both need decimal input. Memory gets a trailing
  `GiB` label.
- These inputs are the only place `vcpuOp/Val` and `memOp/Val` are written directly by the
  user; the search box only ever writes to them via the debounced `parseFilterTokens` call
  above. The debounced callback does read `query.search` back (see above) — that's what
  makes it Clear-safe — but it never reads `vcpuOp/Val` or `memOp/Val` back, since a matched
  token is stripped from the box on parse.

Existing housekeeping extends to the new fields:

- `clear()` also resets `vcpuVal`/`memVal` to `''` and `vcpuOp`/`memOp` to `'='`.
- The `filtering` derived boolean (which shows the Clear chip) also checks
  `query.vcpuVal !== '' || query.memVal !== ''`.
- `switchProvider()` in `App.svelte` resets these four fields too, alongside the existing
  `search`/`families` reset.

### URL persistence (`src/lib/data/urlState.js`)

`vcpuOp`/`vcpuVal`/`memOp`/`memVal` follow the existing omit-if-default pattern in
`toSearchParams`: written only when the corresponding `*Val` is non-empty (so a bare `=`
operator with no value never appears in the URL), and validated on read in
`fromSearchParams` (operator must be `'='` or `'>='`; value must match
`/^\d+(?:\.\d+)?$/` — an unsigned integer or decimal, the same shape `<input
type="number">` renders — else the pair falls back to the default). The stricter regex
(rather than `Number.isFinite(Number(val))`) exists so a URL like `?vcpuVal=0x10` or
`?vcpuVal=1e3` doesn't slip past validation and silently disagree with the number input,
which the browser would render empty for that same value.

## Testing

- `query.test.js`: `applyQuery` filtering by `vcpu = N`, `vcpu >= N`, `mem = N`,
  `mem >= N`, including fractional vCPU values (e.g. matching `f1-micro`'s `vcpu: 0.2`
  with `vcpu=0.2` or `vcpu>=0.2`); combinations of these with each other and with the
  existing family/arch/search filters; confirms an empty value means the filter is
  inactive.
- New tests for `parseFilterTokens`: single token, both keys in one string, last-one-wins on
  a duplicate key, mixed with plain substring text, case/spacing tolerance, and the
  literal-fallback cases (`vcpu>4`, `vcpu=abc`, `mem=`).
- `urlState.test.js`: round-trips `vcpuOp`/`vcpuVal`/`memOp`/`memVal` through
  `toSearchParams`/`fromSearchParams`, confirming they're omitted when `*Val` is empty and
  that an invalid operator/value falls back to the default.
