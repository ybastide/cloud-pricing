import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractAwsInstances } from './extract-aws.mjs'

const SAMPLE_INDEX = {
  regions: {
    'US East (N. Virginia)': {
      'm8in.8xlarge row': {
        rateCode: 'M7Y26Q6F3QB33TU9.JRTCKXETXF.6YS6EN2CT7',
        price: '2.6732800000',
        Location: 'US East (N. Virginia)',
        'Instance Family': 'General purpose',
        vCPU: '32',
        'Instance Type': 'm8in.8xlarge',
        Memory: '128.0 GiB',
        Storage: 'EBS only',
        'Network Performance': '50 Gigabit',
        'plc:OperatingSystem': 'Linux',
        'plc:InstanceFamily': 'General Purpose',
        'Operating System': 'Linux',
        'Pre Installed S/W': 'NA',
        'License Model': 'No License required',
      },
      't3.micro row': {
        rateCode: 'ABCDEF01234567890.JRTCKXETXF.6YS6EN2CT7',
        price: '0.0104000000',
        Location: 'US East (N. Virginia)',
        'Instance Family': 'General purpose',
        vCPU: '2',
        'Instance Type': 't3.micro',
        Memory: '1.0 GiB',
        Storage: 'EBS only',
        'Network Performance': 'Up to 5 Gigabit',
        'plc:OperatingSystem': 'Linux',
        'plc:InstanceFamily': 'General Purpose',
        'Operating System': 'Linux',
        'Pre Installed S/W': 'NA',
        'License Model': 'No License required',
      },
    },
  },
}

describe('extractAwsInstances', () => {
  const result = extractAwsInstances(SAMPLE_INDEX)

  it('derives region from the single regions key', () => {
    expect(result.region).toBe('US East (N. Virginia)')
  })

  it('derives operatingSystem from the first row', () => {
    expect(result.operatingSystem).toBe('Linux')
  })

  it('extracts every row', () => {
    expect(result.instances).toHaveLength(2)
  })

  it('keeps only the 7 fields normalizeAws reads, under their original keys', () => {
    expect(result.instances[0]).toEqual({
      'Instance Type': 'm8in.8xlarge',
      'Instance Family': 'General purpose',
      vCPU: '32',
      Memory: '128.0 GiB',
      Storage: 'EBS only',
      'Network Performance': '50 Gigabit',
      price: '2.6732800000',
    })
  })

  it('drops fields normalizeAws does not read', () => {
    const keys = Object.keys(result.instances[0])
    expect(keys).not.toContain('rateCode')
    expect(keys).not.toContain('Location')
    expect(keys).not.toContain('plc:OperatingSystem')
    expect(keys).not.toContain('plc:InstanceFamily')
    expect(keys).not.toContain('Operating System')
    expect(keys).not.toContain('Pre Installed S/W')
    expect(keys).not.toContain('License Model')
  })
})

describe('extractAwsInstances over the real fixture', () => {
  it('is in sync with the committed fixture', () => {
    const raw = JSON.parse(readFileSync('fixtures/aws/index.json', 'utf8'))
    expect(JSON.stringify(extractAwsInstances(raw), null, 2) + '\n')
      .toBe(readFileSync('fixtures/aws/instances.json', 'utf8'))
  })
})
