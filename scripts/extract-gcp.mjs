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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

function findFixture(prefix) {
  const files = readdirSync('fixtures/gcp')
  const match = files.find((f) => f.startsWith(prefix))
  if (!match) throw new Error(`No file starting with "${prefix}" in fixtures/gcp`)
  return `fixtures/gcp/${match}`
}

function main() {
  const pricingHtml = readFileSync(findFixture('General Purpose VM pricing'), 'utf8')
  const instances = extractInstanceRows(pricingHtml)
  writeFileSync('fixtures/gcp/instances.json', JSON.stringify(instances, null, 2) + '\n')
  console.log(`instances: ${instances.length} rows`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
