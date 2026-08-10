import rawIndex from '../../../fixtures/aws/index.json'
import { normalizeAll } from './normalize.js'

export const instances = normalizeAll(rawIndex)

export const families = [...new Set(instances.map((row) => row.family))].sort()

const regionNames = Object.keys(rawIndex.regions)
const firstRow = Object.values(rawIndex.regions[regionNames[0]] ?? {})[0]

export const region = regionNames[0] ?? 'Unknown region'
export const operatingSystem = firstRow?.['Operating System'] ?? 'Unknown OS'
