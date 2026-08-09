const COMPARATORS = {
  type: (a, b) =>
    a.letters.localeCompare(b.letters) ||
    a.generation - b.generation ||
    a.attrs.localeCompare(b.attrs) ||
    a.sizeRank - b.sizeRank,
  vcpu: (a, b) => a.vcpu - b.vcpu,
  memGiB: (a, b) => a.memGiB - b.memGiB,
  storageGB: (a, b) => a.storageGB - b.storageGB,
  netGbps: (a, b) => a.netGbps - b.netGbps,
  usd: (a, b) => a.usd - b.usd,
}

export const SORT_KEYS = Object.keys(COMPARATORS)

export const DEFAULT_SORT = 'usd'
export const DEFAULT_DIR = 'asc'

export function applyQuery(rows, query) {
  const { search = '', families, arch, sort, dir } = query
  const needle = search.trim().toLowerCase()
  const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]
  const sign = dir === 'desc' ? -1 : 1
  const byFamily = families instanceof Set && families.size > 0
  const byArch = arch === 'arm' || arch === 'x86'

  return rows
    .filter((row) => {
      if (byFamily && !families.has(row.family)) return false
      if (byArch && row.arch !== arch) return false
      if (needle && !row.type.toLowerCase().includes(needle)) return false
      return true
    })
    .sort((a, b) => sign * compare(a, b) || a.type.localeCompare(b.type))
}
