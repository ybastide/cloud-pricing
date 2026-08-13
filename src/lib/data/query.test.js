import { describe, expect, it } from 'vitest'
import { SORT_KEYS, applyQuery, parseFilterTokens } from './query.js'
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

  it('sorts ascending by architecture, ARM before x86, tie-broken by type', () => {
    const out = applyQuery(rows, { ...base, sort: 'arch', dir: 'asc' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'i4i.large', 'm5.large', 'r6i.4xlarge'])
  })

  it('sorts descending by architecture, x86 before ARM', () => {
    const out = applyQuery(rows, { ...base, sort: 'arch', dir: 'desc' })
    expect(out.map((r) => r.type)).toEqual(['i4i.large', 'm5.large', 'r6i.4xlarge', 'c7g.xlarge'])
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

  it('returns an empty array when nothing matches', () => {
    expect(applyQuery(rows, { ...base, search: 'nope' })).toEqual([])
  })

  it('falls back to the default sort for an unknown key', () => {
    const out = applyQuery(rows, { ...base, sort: 'bogus' })
    expect(out.map((r) => r.type)).toEqual(['c7g.xlarge', 'm5.large', 'i4i.large', 'r6i.4xlarge'])
  })

  it('exposes the sortable keys', () => {
    expect(SORT_KEYS).toEqual(['type', 'arch', 'vcpu', 'memGiB', 'storageGB', 'netGbps', 'usd'])
  })
})

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
