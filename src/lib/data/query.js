const COMPARATORS = {
  type: (a, b) =>
    a.letters.localeCompare(b.letters) ||
    a.generation - b.generation ||
    a.attrs.localeCompare(b.attrs) ||
    a.sizeRank - b.sizeRank,
  arch: (a, b) => a.arch.localeCompare(b.arch),
  vcpu: (a, b) => a.vcpu - b.vcpu,
  memGiB: (a, b) => a.memGiB - b.memGiB,
  storageGB: (a, b) => a.storageGB - b.storageGB,
  netGbps: (a, b) => a.netGbps - b.netGbps,
  usd: (a, b) => a.usd - b.usd,
}

export const SORT_KEYS = Object.keys(COMPARATORS)

export const DEFAULT_SORT = 'usd'
export const DEFAULT_DIR = 'asc'

function matchesOp(actual, op, target) {
  return op === '>=' ? actual >= target : actual === target
}

export function applyQuery(rows, query) {
  const {
    search = '',
    families,
    arch,
    sort,
    dir,
    vcpuOp = '=',
    vcpuVal = '',
    memOp = '=',
    memVal = '',
  } = query
  const needle = search.trim().toLowerCase()
  const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]
  const sign = dir === 'desc' ? -1 : 1
  const byFamily = families instanceof Set && families.size > 0
  const byArch = arch === 'arm' || arch === 'x86'
  const byVcpu = vcpuVal !== ''
  const byMem = memVal !== ''
  const vcpuTarget = Number(vcpuVal)
  const memTarget = Number(memVal)

  return rows
    .filter((row) => {
      if (byFamily && !families.has(row.family)) return false
      if (byArch && row.arch !== arch) return false
      if (byVcpu && !matchesOp(row.vcpu, vcpuOp, vcpuTarget)) return false
      if (byMem && !matchesOp(row.memGiB, memOp, memTarget)) return false
      return !(needle && !row.type.toLowerCase().includes(needle))
    })
    .sort((a, b) => sign * compare(a, b) || a.type.localeCompare(b.type))
}

const TOKEN = /\b(vcpu|mem)\s*(>=|=)\s*(\d+(?:\.\d+)?)\b/gi

export function parseFilterTokens(text) {
  let vcpu = null
  let mem = null

  const stripped = text.replace(TOKEN, (_match, key, op, val) => {
    const parsed = { op, val: Number(val) }
    if (key.toLowerCase() === 'vcpu') vcpu = parsed
    else mem = parsed
    return ''
  })

  return { text: stripped.replace(/\s+/g, ' ').trim(), vcpu, mem }
}
