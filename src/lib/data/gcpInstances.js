import rawInstances from '../../../fixtures/gcp/instances.json'
import { normalizeGcp } from './normalize.js'

export const instances = rawInstances.map(normalizeGcp)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = 'Iowa (us-central1)'
