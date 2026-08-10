const GENERAL_PURPOSE_START = 'General-purpose machine type family'
const GENERAL_PURPOSE_END = 'Tier_1 higher bandwidth network pricing'
const DIVIDER_HEADING = /^(?:Tau )?[A-Za-z0-9]+ machine types$|^Shared-core machine types$/
const TYPE_TOKEN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/
const PRICE_TOKEN = /^\$([\d.]+) \/ 1 (hour|gibibyte hour)$/
const MEMORY_TOKEN = /^([\d.]+)\s*GiB$/
const FAMILY_QUALIFIER =
  /^(.+?) (?:standard|high-memory|high-CPU|high-cpu|shared-core|Standard with Local SSD|Highmem with Local SSD)(?: machine types)?$/

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
  const match = FAMILY_QUALIFIER.exec(heading)
  return match ? match[1] : heading
}

function parseInstanceRow(cells, family) {
  const [type, vcpuCell, memCell, ...rest] = cells
  const memMatch = MEMORY_TOKEN.exec(memCell)
  const memGiB = memMatch ? parseFloat(memMatch[1]) : 0

  // "with Local SSD" tables insert a Local SSD GiB column before the price columns —
  // distinguish it from the price column by the absence of a leading '$'.
  let storageGB = 0
  let priceCells = rest
  if (rest[0] && !rest[0].startsWith('$') && MEMORY_TOKEN.test(rest[0])) {
    storageGB = parseFloat(MEMORY_TOKEN.exec(rest[0])[1])
    priceCells = rest.slice(1)
  }

  const priceCell = priceCells.find((c) => c.startsWith('$'))
  const priceMatch = priceCell ? PRICE_TOKEN.exec(priceCell) : null

  return {
    type,
    family,
    vcpu: parseFloat(vcpuCell),
    memGiB,
    storageGB,
    usd: priceMatch ? parseFloat(priceMatch[1]) : 0,
  }
}

export function extractInstanceRows(html) {
  const headings = findHeadings(html)
  const tables = findTables(html)

  const start = headings.find((h) => h.text === GENERAL_PURPOSE_START)
  const end = headings.find((h) => h.text === GENERAL_PURPOSE_END)
  if (!start || !end) {
    throw new Error('Could not find the general-purpose machine type section boundaries')
  }

  const rows = []
  for (const heading of headings) {
    if (heading.index <= start.index || heading.index >= end.index) continue
    if (heading.text === 'Consumption model ID:') continue
    if (DIVIDER_HEADING.test(heading.text)) continue

    const table = tables.find((t) => t.index > heading.index)
    if (!table) continue

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
      rows.push(parseInstanceRow(dataCells.slice(from, to), family))
    }
  }
  return rows
}

function parseDiskRow(name, priceCell) {
  const match = PRICE_TOKEN.exec(priceCell)
  const rateType = name.endsWith('IOPS') ? 'iops' : name.endsWith('throughput') ? 'throughput' : 'space'
  return { name, rateType, usd: match ? parseFloat(match[1]) : 0 }
}

export function extractDiskRows(html) {
  const headings = findHeadings(html)
  const tables = findTables(html)
  const rows = []

  const persistentHeading = headings.find((h) => h.text === 'Persistent disk space pricing')
  const persistentTable = tables.find((t) => t.index > persistentHeading.index)
  const pCells = tableCells(persistentTable.html).slice(2) // drop the 2-cell header row
  for (let i = 0; i < pCells.length; i += 2) {
    rows.push(parseDiskRow(pCells[i], pCells[i + 1]))
  }

  const localSsdHeading = headings.find((h) => h.text === 'Local SSD pricing')
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

function findFixture(prefix) {
  const files = readdirSync('fixtures/gcp')
  const match = files.find((f) => f.startsWith(prefix))
  if (!match) throw new Error(`No file starting with "${prefix}" in fixtures/gcp`)
  return `fixtures/gcp/${match}`
}

function main() {
  const pricingHtml = readFileSync(findFixture('General Purpose VM pricing'), 'utf8')
  const hyperdiskHtml = readFileSync(findFixture('Google Cloud Hyperdisk overview'), 'utf8')

  const instances = extractInstanceRows(pricingHtml)
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
