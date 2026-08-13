const GENERAL_PURPOSE_START = 'General-purpose machine type family'
const GENERAL_PURPOSE_END = 'Tier_1 higher bandwidth network pricing'
const TYPE_TOKEN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/
const PRICE_TOKEN = /^\$([\d.]+) \/ 1 (hour|gibibyte hour)$/
const MEMORY_TOKEN = /^([\d,]+(?:\.\d+)?)\s*GiB$/
// The Network-optimized page renders its Memory column with no "GiB" suffix
// at all (just "7"), unlike every other page's tables.
const MEMORY_VALUE = /^([\d,]+(?:\.\d+)?)\s*(?:GiB)?$/
// familyFromHeading only reads the captured prefix (group 1), never the qualifier
// text itself, so matching case-insensitively can't change the derived family name.
const FAMILY_QUALIFIER =
  /^(.+?) (?:standard|high-memory|highmem|high-cpu|highcpu|shared-core|standard with local ssd|highmem with local ssd|highmem with (?:standard|high)lssd)(?: machine types)?$/i
const BARE_MACHINE_TYPES = /^(.+?) machine types?$/

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/[​﻿]/g, '') // Google's page has at least one stray BOM in a heading
    .replace(/\s+/g, ' ')
    .trim()
}

function findHeadings(html) {
  const re = /<h[23][^>]*>(.*?)<\/h[23]>/gs
  const out = []
  let m
  while ((m = re.exec(html))) out.push({ index: m.index, text: stripTags(m[1]) })
  return out
}

function findTables(html) {
  const re = /<table.*?<\/table>/gs
  const out = []
  let m
  while ((m = re.exec(html))) out.push({ index: m.index, html: m[0] })
  return out
}

function tableCells(tableHtml) {
  const re = /<t[dh][^>]*>(.*?)<\/t[dh]>/gs
  const out = []
  let m
  while ((m = re.exec(tableHtml))) {
    const text = stripTags(m[1])
    if (text) out.push(text)
  }
  return out
}

function familyFromHeading(heading) {
  const qualified = FAMILY_QUALIFIER.exec(heading)
  if (qualified) return qualified[1]
  const bare = BARE_MACHINE_TYPES.exec(heading)
  return bare ? bare[1] : heading
}

function parseInstanceRow(cells, family, requireMemoryUnit) {
  const [type, vcpuCell, memCell, ...rest] = cells
  const memMatch = (requireMemoryUnit ? MEMORY_TOKEN : MEMORY_VALUE).exec(memCell)
  const memGiB = memMatch ? parseFloat(memMatch[1].replace(/,/g, '')) : 0

  // "with Local SSD" tables insert a Local SSD GiB column before the price columns —
  // distinguish it from the price column by the absence of a leading '$'.
  let storageGB = 0
  let priceCells = rest
  if (rest[0] && !rest[0].startsWith('$') && MEMORY_TOKEN.test(rest[0])) {
    storageGB = parseFloat(MEMORY_TOKEN.exec(rest[0])[1].replace(/,/g, ''))
    priceCells = rest.slice(1)
  }

  const priceCell = priceCells.find((c) => c.startsWith('$'))
  const priceMatch = priceCell ? PRICE_TOKEN.exec(priceCell) : null

  return {
    type,
    family,
    vcpu: parseFloat(vcpuCell.replace(/,/g, '')),
    memGiB,
    storageGB,
    usd: priceMatch ? parseFloat(priceMatch[1]) : 0,
  }
}

export function extractInstanceRows(
  html,
  startHeading = GENERAL_PURPOSE_START,
  endHeading = GENERAL_PURPOSE_END,
  { requireMemoryUnit = true } = {},
) {
  const headings = findHeadings(html)
  const tables = findTables(html)

  const start = headings.find((h) => h.text === startHeading)
  const end = headings.find((h) => h.text === endHeading)
  if (!start || !end) {
    throw new Error(`Could not find the "${startHeading}" / "${endHeading}" section boundaries`)
  }

  const rows = []
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading.index <= start.index || heading.index >= end.index) continue
    if (heading.text === 'Consumption model ID:') continue

    const table = tables.find((t) => t.index > heading.index && t.index < end.index)
    if (!table) continue
    // A heading with another heading before its table is a divider, not data —
    // "Consumption model ID:" tooltips nest inside the table, so they don't count.
    const next = headings[i + 1]
    if (next && next.index < table.index) continue

    const cells = tableCells(table.html)
    const firstTypeIdx = cells.findIndex((c) => TYPE_TOKEN.test(c))
    if (firstTypeIdx === -1) continue
    if (cells[0] === 'Item') continue // per-unit rate table, e.g. "custom vCPUs and memory"

    const family = familyFromHeading(heading.text)
    const dataCells = cells.slice(firstTypeIdx)
    const typeIdxs = []
    dataCells.forEach((c, i) => {
      if (TYPE_TOKEN.test(c)) typeIdxs.push(i)
    })

    for (let j = 0; j < typeIdxs.length; j++) {
      const from = typeIdxs[j]
      const to = typeIdxs[j + 1] ?? dataCells.length
      rows.push(parseInstanceRow(dataCells.slice(from, to), family, requireMemoryUnit))
    }
  }
  return rows
}

function parseDiskRow(name, priceCell) {
  const match = PRICE_TOKEN.exec(priceCell)
  const base = name.replace(/ (standard|advanced)$/, '')
  const rateType = base.endsWith('IOPS') ? 'iops' : base.endsWith('throughput') ? 'throughput' : 'space'
  return { name, rateType, usd: match ? parseFloat(match[1]) : 0 }
}

export function extractDiskRows(html) {
  const headings = findHeadings(html)
  const tables = findTables(html)
  const rows = []

  const persistentHeading = headings.find((h) => h.text === 'Persistent disk space pricing')
  if (!persistentHeading) throw new Error('Could not find the "Persistent disk space pricing" heading')
  const persistentTable = tables.find((t) => t.index > persistentHeading.index)
  const pCells = tableCells(persistentTable.html).slice(2) // drop the 2-cell header row
  for (let i = 0; i < pCells.length; i += 2) {
    rows.push(parseDiskRow(pCells[i], pCells[i + 1]))
  }

  const localSsdHeading = headings.find((h) => h.text === 'Local SSD pricing')
  if (!localSsdHeading) throw new Error('Could not find the "Local SSD pricing" heading')
  const localSsdTable = tables.find((t) => t.index > localSsdHeading.index)
  const lCells = tableCells(localSsdTable.html)
  // 6-cell header (Type + 5 price columns), then the row: name at index 6, Default price at index 7
  rows.push(parseDiskRow(lCells[6], lCells[7]))

  return rows
}

const DISK_TYPES = ['Hyperdisk Balanced', 'Hyperdisk Balanced HA', 'Hyperdisk Extreme', 'Hyperdisk Throughput', 'Hyperdisk ML']

export function extractHyperdiskCompat(html) {
  const tables = findTables(html)
  const compatTable = tables.find((t) => tableCells(t.html)[0] === 'Machine series')
  if (!compatTable) throw new Error('Could not find the Hyperdisk compatibility table')

  const rowsHtml = compatTable.html.match(/<tr[^>]*>.*?<\/tr>/gs) ?? []
  return rowsHtml.slice(1).map((rowHtml) => {
    const tds = rowHtml.match(/<td[^>]*>.*?<\/td>/gs) ?? []
    const series = stripTags(tds[0])
    const flags = tds.slice(1).map((td, i) => {
      const m = /aria-label="([^"]*)"/.exec(td)
      const label = m ? m[1] : ''
      if (/don't support|doesn't support|aren't support/.test(label)) return false
      if (/support/.test(label)) return true
      throw new Error(`Ambiguous Hyperdisk compatibility label for ${series} / ${DISK_TYPES[i]}: "${label}"`)
    })
    return {
      series,
      balanced: flags[0],
      balancedHA: flags[1],
      extreme: flags[2],
      throughput: flags[3],
      ml: flags[4],
    }
  })
}

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

// Prefix-match rather than a literal path: the real filenames on disk use
// non-breaking spaces around their underscores, not regular spaces — a
// literal path string here would silently fail to open the file.
export function findFixture(prefix) {
  const files = readdirSync('fixtures/gcp')
  const match = files.find((f) => f.startsWith(prefix))
  if (!match) throw new Error(`No file starting with "${prefix}" in fixtures/gcp`)
  return `fixtures/gcp/${match}`
}

// Google splits VM pricing across separate category pages with no unified
// table; each has its own section start/end heading text.
export const INSTANCE_SOURCES = [
  { prefix: 'Compute-optimized VM pricing', start: 'Compute-optimized pricing', end: 'Simulated maintenance event pricing' },
  { prefix: 'Memory-optimized VM Pricing', start: 'Memory-optimized pricing', end: 'Tier_1 higher bandwidth network pricing' },
  {
    prefix: 'Network-optimized VM pricing',
    start: 'Network-optimized pricing',
    end: 'How pricing works',
    requireMemoryUnit: false,
  },
  { prefix: 'Storage-optimized VM Pricing', start: 'Storage-optimized pricing', end: 'Simulated maintenance event pricing' },
]

function main() {
  const pricingHtml = readFileSync(findFixture('General Purpose VM pricing'), 'utf8')
  const hyperdiskHtml = readFileSync(findFixture('Google Cloud Hyperdisk overview'), 'utf8')

  const instances = [
    ...extractInstanceRows(pricingHtml),
    ...INSTANCE_SOURCES.flatMap(({ prefix, start, end, requireMemoryUnit }) =>
      extractInstanceRows(readFileSync(findFixture(prefix), 'utf8'), start, end, { requireMemoryUnit }),
    ),
  ]
  const disks = extractDiskRows(pricingHtml)
  const hyperdiskCompat = extractHyperdiskCompat(hyperdiskHtml)

  writeFileSync('fixtures/gcp/instances.json', JSON.stringify(instances, null, 2) + '\n')
  writeFileSync('fixtures/gcp/disks.json', JSON.stringify(disks, null, 2) + '\n')
  writeFileSync('fixtures/gcp/hyperdisk-compat.json', JSON.stringify(hyperdiskCompat, null, 2) + '\n')

  console.log(`instances: ${instances.length} rows`)
  console.log(`disks: ${disks.length} rows`)
  console.log(`hyperdisk-compat: ${hyperdiskCompat.length} rows`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
