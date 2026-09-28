import {chromium} from '@playwright/test'
import {readdirSync, writeFileSync} from 'node:fs'

const DIR = 'fixtures/gcp'
const PRICING = 'https://cloud.google.com/products/compute/pricing/'
const DOCS = 'https://docs.cloud.google.com/compute/docs/'
const PAGES = [
    ['General Purpose VM pricing', PRICING + 'general-purpose'],
    ['Compute-optimized VM pricing', PRICING + 'compute-optimized'],
    ['Memory-optimized VM Pricing', PRICING + 'memory-optimized'],
    ['Network-optimized VM pricing', PRICING + 'network-optimized'],
    ['Storage-optimized VM Pricing', PRICING + 'storage-optimized'],
    ['Google Cloud Hyperdisk overview', DOCS + 'disks/hyperdisks'],
    ['CPU platforms', DOCS + 'cpu-platforms'],
]
const API_KEY = /AIza[0-9A-Za-z_-]{35}/g
const ACCOUNT_HEADER = /aria-label="Google Account:/
const REGION = 'Iowa (us-central1)'

const files = readdirSync(DIR)
const browser = await chromium.launch()
const page = await browser.newPage({locale: 'en-US'})
for (const [prefix, url] of PAGES) {
    const matches = files.filter((f) => f.startsWith(prefix))
    if (matches.length !== 1) throw new Error(`${prefix}: expected 1 file in ${DIR}, found ${matches.length}`)
    await page.goto(url, {waitUntil: 'networkidle', timeout: 120000})
    await page.waitForTimeout(4000)
    const {rendered, regions} = await page.evaluate(() => {
        document.querySelectorAll('script').forEach((s) => s.remove())
        const regions = [...document.querySelectorAll('[role="option"][aria-selected="true"]')]
            .map((o) => o.dataset.value)
            .filter((v) => /\([a-z]+-[a-z]+\d+\)$/.test(v))
        return {rendered: '<!DOCTYPE html>\n' + document.documentElement.outerHTML, regions}
    })
    if (url.startsWith(PRICING) && (regions.length === 0 || regions.some((r) => r !== REGION))) {
        throw new Error(`${prefix}: expected every region picker on ${REGION}, got ${JSON.stringify(regions)}`)
    }
    if (/<script/i.test(rendered)) throw new Error(`${prefix}: a <script> tag survived`)
    if (ACCOUNT_HEADER.test(rendered)) throw new Error(`${prefix}: page carries a signed-in account header`)
    const html = rendered.replace(API_KEY, 'REDACTED_GOOGLE_API_KEY_1')
    writeFileSync(`${DIR}/${matches[0]}`, html)
    console.log(`${matches[0]}: ${html.length} bytes`)
}
await browser.close()
