import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
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

  it('classifies every Hyperdisk Storage Pool row correctly despite the trailing tier qualifier', () => {
    const throughputRow = rows.find((r) => r.name === 'Hyperdisk Storage Pool Balanced provisioned IOPS standard')
    expect(throughputRow.rateType).toBe('iops')
    const spaceRow = rows.find((r) => r.name === 'Hyperdisk Storage Pool Throughput provisioned space standard')
    expect(spaceRow.rateType).toBe('space')
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
