import rawIndex from '../../../fixtures/aws/index.json'
import { normalizeAll } from './normalize.js'

export const instances = normalizeAll(rawIndex)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = 'US East (N. Virginia)'
export const operatingSystem = 'Linux'
