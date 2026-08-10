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

  it('gives every row a positive price, vCPU, and memory', () => {
    expect(rows.every((r) => r.usd > 0)).toBe(true)
    expect(rows.every((r) => r.vcpu > 0)).toBe(true)
    expect(rows.every((r) => r.memGiB > 0)).toBe(true)
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
