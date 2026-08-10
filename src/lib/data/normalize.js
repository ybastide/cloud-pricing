const NETWORK = /^(Up to\s+)?([\d.]+)\s*(Gigabit|Megabit)\b/i
const STORAGE_MULTI = /^(\d+)\s*x\s*([\d.]+)(?:\s*GB)?\b/i
const STORAGE_SINGLE = /^([\d.]+)\s*GB\b/i
const SERIES = /^([a-z]+)(\d+)([a-z0-9-]*)$/i
const NUMBERED_SIZE = /^(\d+)xlarge$/i
const SIZED_METAL = /^metal-(\d+)xl$/i

const NAMED_SIZES = {
  nano: 1,
  micro: 2,
  small: 3,
  medium: 4,
  large: 5,
  xlarge: 6,
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function parseNetwork(label) {
  const match = NETWORK.exec(label ?? '')
  if (!match) return { netGbps: 0, netBurst: false }
  const value = parseFloat(match[2])
  const gbps = match[3].toLowerCase() === 'gigabit' ? value : value / 1000
  return { netGbps: finite(gbps), netBurst: Boolean(match[1]) }
}

export function parseStorageGB(label) {
  const multi = STORAGE_MULTI.exec(label ?? '')
  if (multi) return finite(parseInt(multi[1], 10) * parseFloat(multi[2]))
  const single = STORAGE_SINGLE.exec(label ?? '')
  if (single) return finite(parseFloat(single[1]))
  return 0
}

export function parseMemoryGiB(label) {
  return finite(parseFloat(label))
}

export function parseSeries(series) {
  const match = SERIES.exec(series)
  if (!match) return { letters: series, generation: 0, attrs: '' }
  return {
    letters: match[1],
    generation: finite(parseInt(match[2], 10)),
    attrs: match[3],
  }
}

export function sizeRank(size) {
  if (size in NAMED_SIZES) return NAMED_SIZES[size]

  const numbered = NUMBERED_SIZE.exec(size)
  if (numbered) return 6 + finite(parseInt(numbered[1], 10))

  const sizedMetal = SIZED_METAL.exec(size)
  if (sizedMetal) return 1000 + finite(parseInt(sizedMetal[1], 10))

  if (size === 'metal') return 2000

  return 0
}

export function normalizeAws(raw) {
  const type = raw['Instance Type']
  const netLabel = raw['Network Performance']
  const storage = raw.Storage
  const { netGbps, netBurst } = parseNetwork(netLabel)

  const [series, size = ''] = type.split('.')
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
    family: raw['Instance Family'],
    vcpu: finite(parseInt(raw.vCPU, 10)),
    memGiB: parseMemoryGiB(raw.Memory),
    storage,
    storageGB: parseStorageGB(storage),
    netLabel,
    netGbps,
    netBurst,
    usd: finite(parseFloat(raw.price)),
  }
}

export function normalizeAllAws(index) {
  return Object.values(index.regions).flatMap((rows) =>
    Object.values(rows).map(normalizeAws),
  )
}
