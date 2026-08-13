import { expect, test } from '@playwright/test'

const GCP_TOTAL = 470

const searchBox = (page) => page.getByRole('searchbox', { name: 'Filter by instance type' })
const archButton = (page, name) =>
  page.getByRole('group', { name: 'Processor architecture' }).getByRole('button', { name })
const count = (page) => page.locator('p.count')
// Scoped to the main pricing table: an unscoped `tbody td.type` also matches rows in the
// Disk pricing / Hyperdisk compatibility panels rendered below it on the GCP tab (543 vs 470).
const typeCells = (page) => page.locator('main > table tbody td.type')
const gcpTab = (page) => page.getByRole('tab', { name: 'GCP' })
const awsTab = (page) => page.getByRole('tab', { name: 'AWS' })
const vcpuVal = (page) => page.getByRole('spinbutton', { name: 'vCPU value' })
const memVal = (page) => page.getByRole('spinbutton', { name: 'Memory value' })

test('switches to the GCP tab and renders its table', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('heading', { name: 'GCP Compute On-Demand Pricing' })).toBeVisible()
  await expect(page.locator('p.context')).toHaveText('Iowa (us-central1)')
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
  await expect(typeCells(page)).toHaveCount(GCP_TOTAL)
})

test('shows the architecture toggle on the GCP tab and filters correctly', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('group', { name: 'Processor architecture' })).toBeVisible()
  await archButton(page, 'ARM').click()
  await expect(count(page)).toHaveText(`72 of ${GCP_TOTAL} instances`)
  await archButton(page, 'x86').click()
  await expect(count(page)).toHaveText(`398 of ${GCP_TOTAL} instances`)
  await archButton(page, 'All').click()
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
})

test('shows GCP-specific columns and no Network column', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('button', { name: 'Machine type', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Local SSD', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toHaveCount(0)
})

test('sorts by Local SSD without NaN corrupting the order', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  // First click on a non-type column sorts descending (same convention as the AWS spec's
  // memory-sort test); click twice to reach ascending, where no-Local-SSD rows sort first.
  await page.getByRole('button', { name: 'Local SSD', exact: true }).click()
  await page.getByRole('button', { name: 'Local SSD', exact: true }).click()
  const firstRowCells = page.locator('main > table tbody tr').first().locator('td')
  await expect(firstRowCells.nth(3)).toHaveText('') // ascending: no-Local-SSD rows sort first
})

test('renders the disk pricing and Hyperdisk compatibility panels', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page.getByRole('heading', { name: 'Disk pricing' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hyperdisk compatibility' })).toBeVisible()
})

test('round-trips provider through the URL and back', async ({ page }) => {
  await page.goto('/')
  await gcpTab(page).click()
  await expect(page).toHaveURL(/provider=gcp/)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'GCP Compute On-Demand Pricing' })).toBeVisible()

  await awsTab(page).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'EC2 On-Demand Pricing' })).toBeVisible()
})

test('resets filters when switching providers', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('m5')
  await vcpuVal(page).fill('4')
  await memVal(page).fill('16')
  await gcpTab(page).click()
  await expect(searchBox(page)).toHaveValue('')
  await expect(vcpuVal(page)).toHaveValue('')
  await expect(memVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${GCP_TOTAL} of ${GCP_TOTAL} instances`)
})
