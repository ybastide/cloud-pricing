# AWS fixture extraction — design spec

**Issue:** [ybastide/cloud-pricing#2](https://github.com/ybastide/cloud-pricing/issues/2) —
originally opened to code-split AWS/GCP data behind a dynamic `import()` per provider tab.
Rescoped after measurement (see Background) to a build-time fixture-extraction fix instead;
code-splitting is dropped from scope.

## Goal

Shrink AWS's contribution to the production JS bundle by extracting only the fields the app
uses into a small, committed fixture at build time — mirroring the extraction pattern GCP
already uses — instead of shipping AWS's full raw SKU catalog to the browser.

## Background

`npm run build` warns that the JS bundle is ~774 kB raw (~83 kB gzipped). Investigation
found the two providers' fixtures are asymmetric:

| Fixture | Raw size |
| --- | --- |
| `fixtures/aws/index.json` (imported directly by `awsInstances.js`) | 682,096 bytes |
| `fixtures/gcp/instances.json` + `disks.json` + `hyperdisk-compat.json` combined | ~61,000 bytes |

AWS is ~11x larger than everything GCP ships, and is the default provider tab shown on
first load — so provider-level code-splitting (the issue's original idea) would only help a
visitor who lands directly on `?provider=gcp` and never touches the AWS tab; every other
visit pays AWS's cost regardless of whether GCP is split out. That makes code-splitting a
narrow, low-value fix for the actual bundle-size problem.

The real cause: each of the 1322 rows in `fixtures/aws/index.json` carries 14 fields —
`rateCode`, `Location`, `plc:OperatingSystem`, `plc:InstanceFamily`, `Operating System`,
`Pre Installed S/W`, `License Model`, plus the 7 fields actually used — and
`normalizeAws` (`src/lib/data/normalize.js`) only reads 7 of them (`Instance Type`,
`Network Performance`, `Storage`, `Instance Family`, `vCPU`, `Memory`, `price`). A grep of
`src/`, `scripts/`, and `e2e/` confirms no other code reads the other 7 fields, except
`awsInstances.js` reading `Operating System` from the first row.

GCP does not have this problem: `scripts/extract-gcp.mjs` already parses GCP's raw HTML
fixtures at build/dev time and commits a small, already-relevant `fixtures/gcp/instances.json`
containing only the fields the app needs. AWS has no equivalent step — `awsInstances.js`
imports the full raw `index.json` and normalizes it client-side on every load.

**Measured**, trimming AWS's fixture to only the used fields (no change to `normalize.js`,
no change to output shape):

| | Raw | Gzipped |
| --- | --- | --- |
| Current (`fixtures/aws/index.json`) | 682,096 bytes | 53,860 bytes |
| Trimmed, flat (`region`/`operatingSystem`/`instances` at rest, per this spec) | 207,215 bytes | 17,850 bytes |

A fully pre-normalized alternative (running `normalizeAws` at build time and committing its
output, matching GCP's fully-normalized `instances.json` exactly) was measured and rejected:
378,328 bytes raw / ~30,590 bytes gzipped — bigger, because it stores both the raw display
strings (`storage`, `netLabel`) *and* their derived numeric fields (`storageGB`, `netGbps`,
`sizeRank`, etc.) side by side. Trimming fields without pre-normalizing wins here because
AWS's raw strings are still needed for display and are cheap to re-derive client-side.

`Operating System` is confirmed constant (`Linux`) across all 1322 rows in the current
fixture, and the per-region row-object keys (e.g. `"m8in 8xlarge US East N. Virginia
Linux"`) are unused by any consumer — only `Object.values()` is ever called on them — so
both can be dropped/flattened without losing information the app relies on.

## Change

### New: `scripts/extract-aws.mjs`

Mirrors `scripts/extract-gcp.mjs`'s structure (a `main()` that reads fixture(s), computes
output, writes `fixtures/aws/instances.json` pretty-printed with a trailing newline, and a
`node scripts/extract-aws.mjs` entry point gated by `import.meta.url` matching the executed
file, same as `extract-gcp.mjs`'s bottom guard). Exported, testable functions:

- `extractAwsInstances(rawIndex)` — takes the parsed `fixtures/aws/index.json` object,
  returns `{ region, operatingSystem, instances }` where:
  - `region` is the single key of `rawIndex.regions` (there is exactly one; multi-region is
    explicitly out of scope per README's "Fixtures › AWS" section).
  - `operatingSystem` is `firstRow['Operating System']` from that region's first row
    (`Object.values(rawIndex.regions[region])[0]`).
  - `instances` is `Object.values(rawIndex.regions[region]).map(row => ({ 'Instance Type':
    row['Instance Type'], 'Instance Family': row['Instance Family'], vCPU: row['vCPU'],
    Memory: row['Memory'], Storage: row['Storage'], 'Network Performance': row['Network
    Performance'], price: row['price'] }))` — a flat array of objects using AWS's original
    raw field names as keys (not renamed), so `normalizeAws` needs zero changes: it already
    reads exactly these 7 keys off whatever object it's given.

`main()` reads `fixtures/aws/index.json`, calls `extractAwsInstances`, writes the result to
`fixtures/aws/instances.json` as `JSON.stringify(result, null, 2) + '\n'`, and logs the row
count (matching `extract-gcp.mjs`'s `console.log` summary style).

### New: `scripts/extract-aws.test.mjs`

Unit tests for `extractAwsInstances` against a small inline fixture object (2-3 rows,
following `extract-gcp.test.mjs`'s pattern of an inline literal rather than reading the real
fixture), covering: correct field mapping, `region` derived from the `regions` key,
`operatingSystem` derived from the first row.

### New (generated, committed): `fixtures/aws/instances.json`

Generated once by running `node scripts/extract-aws.mjs`, then committed — same as
`fixtures/gcp/instances.json` is committed today. `fixtures/aws/index.json` (the raw source)
stays committed unchanged, for provenance and so the extraction can be re-run if AWS pricing
data is refreshed.

### Modified: `src/lib/data/awsInstances.js`

```js
import data from '../../../fixtures/aws/instances.json'
import { normalizeAws } from './normalize.js'

export const instances = data.instances.map(normalizeAws)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = data.region
export const operatingSystem = data.operatingSystem
```

Structurally now identical in shape to `gcpInstances.js` (import a flat generated fixture,
map over it with the provider's normalize function, derive `families`). `normalizeAws`
itself is unchanged — it still receives an object with `Instance Type`, `Network
Performance`, etc. as keys, exactly as the extraction script's output provides.

### Removed: `normalizeAllAws` and its test

`normalizeAllAws` (`src/lib/data/normalize.js`) exists only to flatten AWS's
`{ regions: { regionName: { rowId: row } } }` structure before mapping `normalizeAws` over
it. Once `awsInstances.js` reads a flat `instances` array directly, `normalizeAllAws` has no
callers. Its one test (`src/lib/data/normalize.test.js`, the `normalizeAllAws` describe
block, currently around line 203) is removed with it — a test for code nothing calls is not
coverage, it's the class of dead-code-with-a-test this project explicitly avoids elsewhere.

### Regression safety

`normalizeAllAws` is deleted in this same change, so the equivalence check against it can't
be a standing test — it must run once, during implementation, before the deletion: with both
code paths still present, compare `JSON.stringify(normalizeAllAws(rawIndex))` (old path,
reading `fixtures/aws/index.json` directly) against `JSON.stringify(extractAwsInstances
(rawIndex).instances.map(normalizeAws))` (new path). Only delete `normalizeAllAws` once
these are confirmed identical. This mirrors how the GCP script-stripping change was verified
("byte-identical output — confirmed, not assumed", per README) rather than assumed safe from
code inspection alone. This is a one-time implementation-time check, not a line item in the
committed test suite — see Testing below for what *does* stay in the suite.

## Global Constraints

- `fixtures/aws/index.json` (raw source) stays committed unchanged. Only the new
  `fixtures/aws/instances.json` is a build artifact of `scripts/extract-aws.mjs`, and it is
  also committed (matching GCP's committed, generated `instances.json`).
- The extracted `instances` array entries must use AWS's original raw field names as keys
  (`'Instance Type'`, `'Network Performance'`, `'Storage'`, `'Instance Family'`, `'vCPU'`,
  `'Memory'`, `'price'`) — not renamed/shortened keys — so `normalizeAws` in
  `src/lib/data/normalize.js` requires zero changes.
- `normalizeAws` and its existing unit tests in `src/lib/data/normalize.test.js` (other than
  the `normalizeAllAws` block being removed) are unchanged.
- No change to `App.svelte`, `query.js`, `urlState.js`, `InstanceTable.svelte`,
  `Toolbar.svelte`, or any GCP-side file — this is scoped entirely to the AWS data-loading
  path.
- No dynamic `import()` / code-splitting / async loading state is introduced. This spec
  replaces, not supplements, the code-splitting idea from issue #2.
- `package.json` gets an `extract:aws` script mirroring the existing `extract:gcp` script
  (`"extract:aws": "node scripts/extract-aws.mjs"`).
- README's "Fixtures › AWS" section is updated to document the new `fixtures/aws/instances.json`
  file and the `npm run extract:aws` regeneration step, mirroring how the GCP section
  documents `npm run extract:gcp`.

## Testing

- `scripts/extract-aws.test.mjs`: unit tests for `extractAwsInstances` against an inline
  fixture (field mapping, region/OS derivation) — the permanent, committed coverage for the
  new extraction logic.
- The old-vs-new equivalence check described under Regression safety above: a one-time
  implementation-time verification against the real `fixtures/aws/index.json`, run before
  `normalizeAllAws` is deleted, not added to the committed suite.
- Existing `normalize.test.js` (minus the removed `normalizeAllAws` block), `query.test.js`,
  `urlState.test.js`, and the Playwright e2e suite must continue to pass unchanged — they
  exercise `normalizeAws`'s output shape and the app's rendering, which this change does not
  alter.
