import { expect, test } from '@playwright/test'

const TOTAL = 1322

const searchBox = (page) => page.getByRole('searchbox', { name: 'Filter by instance type' })
const archButton = (page, name) =>
  page.getByRole('group', { name: 'Processor architecture' }).getByRole('button', { name })
const unitButton = (page, name) =>
  page.getByRole('group', { name: 'Price unit' }).getByRole('button', { name })
const count = (page) => page.locator('p.count')
const typeCells = (page) => page.locator('tbody td.type')

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.errors = errors
})

test('renders every instance for the fixed region and OS', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'EC2 On-Demand Pricing' })).toBeVisible()
  await expect(page.locator('p.context')).toHaveText('US East (N. Virginia) · Linux')
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveCount(TOTAL)
})

test('sorts by price ascending on load', async ({ page }) => {
  await page.goto('/')
  await expect(typeCells(page).first()).toHaveText('t4g.nano')
  await expect(page.locator('tbody tr').first().locator('td.price')).toHaveText('$0.0042')
})

test('sorts memory numerically, not lexicographically', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(typeCells(page).first()).toHaveText('u7in-32tb.224xlarge')
  await expect(page.locator('tbody tr').first().locator('td').nth(3)).toHaveText('32768 GiB')
})

test('sorts by architecture, grouping ARM before x86', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  await page.getByRole('button', { name: 'Arch', exact: true }).click()
  await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveText('ARM')
  await expect(page.locator('tbody tr').last().locator('td').nth(1)).toHaveText('x86')
})

test('orders the instance-type size ladder naturally', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await page.getByRole('button', { name: 'Instance', exact: true }).click()
  await expect(typeCells(page)).toHaveText([
    'c5.large',
    'c5.xlarge',
    'c5.2xlarge',
    'c5.4xlarge',
    'c5.9xlarge',
    'c5.12xlarge',
    'c5.18xlarge',
    'c5.24xlarge',
    'c5.metal',
  ])
})

test('unions family filters rather than intersecting them', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'General purpose' }).click()
  await expect(count(page)).toHaveText(`392 of ${TOTAL} instances`)
  await page.getByRole('button', { name: 'Compute optimized' }).click()
  await expect(count(page)).toHaveText(`712 of ${TOTAL} instances`)
})

test('splits the fleet into ARM and x86 with no overlap', async ({ page }) => {
  await page.goto('/')
  await archButton(page, 'ARM').click()
  await expect(count(page)).toHaveText(`390 of ${TOTAL} instances`)
  for (const gpu of ['g4dn', 'g6e', 'gr6']) {
    await expect(typeCells(page).filter({ hasText: new RegExp(`^${gpu}\\.`) })).toHaveCount(0)
  }
  await archButton(page, 'x86').click()
  await expect(count(page)).toHaveText(`932 of ${TOTAL} instances`)
})

test('varies the search placeholder with the architecture filter', async ({ page }) => {
  await page.goto('/')
  await expect(searchBox(page)).toHaveAttribute('placeholder', /m5 or 4xlarge/)
  await archButton(page, 'ARM').click()
  await expect(searchBox(page)).toHaveAttribute('placeholder', /c7g or m8g/)
  await expect(searchBox(page)).toHaveAttribute('aria-label', 'Filter by instance type')
})

test('the month toggle rescales prices without reordering rows', async ({ page }) => {
  await page.goto('/')
  const before = await typeCells(page).allTextContents()
  await unitButton(page, '$/month').click()
  await expect(page.locator('tbody tr').first().locator('td.price')).toHaveText('$3.07')
  expect(await typeCells(page).allTextContents()).toEqual(before)
})

test('shows an empty state when nothing matches', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('zzz-no-such-instance')
  await expect(count(page)).toHaveText(`0 of ${TOTAL} instances`)
  await expect(page.locator('td.empty')).toHaveText('No instances match these filters.')
})

test('round-trips filter state through the URL', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)

  await searchBox(page).fill('c7g')
  await page.getByRole('button', { name: 'Compute optimized' }).click()
  await page.getByRole('button', { name: 'vCPU', exact: true }).click()
  await unitButton(page, '$/month').click()

  await expect(page).toHaveURL(
    '/?q=c7g&fam=Compute+optimized&sort=vcpu&dir=desc&unit=month',
  )

  const rows = await typeCells(page).allTextContents()
  await page.reload()
  await expect(searchBox(page)).toHaveValue('c7g')
  await expect(page.getByRole('button', { name: 'Compute optimized' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(await typeCells(page).allTextContents()).toEqual(rows)
})

test('replaces history entries instead of pushing one per interaction', async ({ page }) => {
  await page.goto('/')
  const before = await page.evaluate(() => history.length)

  await searchBox(page).fill('c7g')
  await archButton(page, 'ARM').click()
  await unitButton(page, '$/month').click()
  await page.getByRole('button', { name: 'vCPU', exact: true }).click()
  await expect(page).toHaveURL(/unit=month/)

  expect(await page.evaluate(() => history.length)).toBe(before)
})

test('degrades a hand-edited URL to the default view', async ({ page }) => {
  await page.goto('/?sort=bogus&dir=sideways&unit=fortnight&arch=sparc')
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
  await expect(typeCells(page).first()).toHaveText('t4g.nano')
  await expect(page).toHaveURL(/\/$/)
})

test('clears every filter at once', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c7')
  await page.getByRole('button', { name: 'General purpose' }).click()
  await archButton(page, 'ARM').click()
  await page.getByRole('button', { name: 'Clear' }).click()

  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
  await expect(searchBox(page)).toHaveValue('')
  await expect(page.getByRole('button', { name: 'General purpose' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page).toHaveURL(/\/$/)
})

test.afterEach(async ({ page }) => {
  expect(page.errors ?? []).toEqual([])
})
