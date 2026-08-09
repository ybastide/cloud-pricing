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
