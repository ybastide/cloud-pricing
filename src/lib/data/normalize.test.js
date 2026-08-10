import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeAws,
  normalizeAllAws,
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
  const arch = (type) => normalizeAws({ ...RAW, 'Instance Type': type }).arch

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
    expect(normalizeAws(RAW)).toEqual({
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
    const row = normalizeAws({ ...RAW, Storage: '4 x 1900 NVMe SSD' })
    expect(row.storage).toBe('4 x 1900 NVMe SSD')
    expect(row.netLabel).toBe('Up to 10 Gigabit')
  })
})

describe('normalizeAll over the real fixture', () => {
  const rows = normalizeAllAws(index)

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
