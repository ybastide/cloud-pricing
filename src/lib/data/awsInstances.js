import data from '../../../fixtures/aws/instances.json'
import { normalizeAws } from './normalize.js'

export const instances = data.instances.map(normalizeAws)

export const families = [...new Set(instances.map((row) => row.family))].sort()

export const region = data.region
export const operatingSystem = data.operatingSystem
