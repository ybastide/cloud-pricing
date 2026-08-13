import { DEFAULT_DIR, DEFAULT_SORT, SORT_KEYS } from './query.js'

const DEFAULT_UNIT = 'hour'
const DEFAULT_ARCH = 'all'
const DEFAULT_PROVIDER = 'aws'
const DEFAULT_OP = '='
const ARCHES = ['arm', 'x86']
const PROVIDERS = ['aws', 'gcp']
const OPS = ['=', '>=']

export function defaultQuery() {
  return {
    provider: DEFAULT_PROVIDER,
    search: '',
    families: new Set(),
    arch: DEFAULT_ARCH,
    sort: DEFAULT_SORT,
    dir: DEFAULT_DIR,
    unit: DEFAULT_UNIT,
    vcpuOp: DEFAULT_OP,
    vcpuVal: '',
    memOp: DEFAULT_OP,
    memVal: '',
  }
}

export function toSearchParams(query) {
  const params = new URLSearchParams()
  if (query.provider && query.provider !== DEFAULT_PROVIDER) params.set('provider', query.provider)
  if (query.search) params.set('q', query.search)
  for (const family of query.families ?? []) params.append('fam', family)
  if (query.arch && query.arch !== DEFAULT_ARCH) params.set('arch', query.arch)
  if (query.sort && query.sort !== DEFAULT_SORT) params.set('sort', query.sort)
  if (query.dir && query.dir !== DEFAULT_DIR) params.set('dir', query.dir)
  if (query.unit && query.unit !== DEFAULT_UNIT) params.set('unit', query.unit)
  if (query.vcpuVal) {
    params.set('vcpuVal', query.vcpuVal)
    if (query.vcpuOp && query.vcpuOp !== DEFAULT_OP) params.set('vcpuOp', query.vcpuOp)
  }
  if (query.memVal) {
    params.set('memVal', query.memVal)
    if (query.memOp && query.memOp !== DEFAULT_OP) params.set('memOp', query.memOp)
  }
  return params.toString()
}

function readOp(params, key) {
  const op = params.get(key)
  return OPS.includes(op) ? op : DEFAULT_OP
}

function readVal(params, key) {
  const val = params.get(key)
  return val !== null && Number.isFinite(Number(val)) ? val : ''
}

export function fromSearchParams(search) {
  const params = new URLSearchParams(search)
  const query = defaultQuery()

  const provider = params.get('provider')
  if (provider && PROVIDERS.includes(provider)) query.provider = provider

  query.search = params.get('q') ?? ''

  const families = params.getAll('fam').filter(Boolean)
  if (families.length) query.families = new Set(families)

  const arch = params.get('arch')
  if (arch && ARCHES.includes(arch)) query.arch = arch

  const sort = params.get('sort')
  if (sort && SORT_KEYS.includes(sort)) query.sort = sort

  if (params.get('dir') === 'desc') query.dir = 'desc'
  if (params.get('unit') === 'month') query.unit = 'month'

  query.vcpuOp = readOp(params, 'vcpuOp')
  query.vcpuVal = readVal(params, 'vcpuVal')
  query.memOp = readOp(params, 'memOp')
  query.memVal = readVal(params, 'memVal')

  return query
}
