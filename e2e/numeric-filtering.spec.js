import { expect, test } from '@playwright/test'

const TOTAL = 1322

const searchBox = (page) => page.getByRole('searchbox', { name: 'Filter by instance type' })
const vcpuOp = (page) => page.getByRole('combobox', { name: 'vCPU operator' })
const vcpuVal = (page) => page.getByRole('spinbutton', { name: 'vCPU value' })
const memOp = (page) => page.getByRole('combobox', { name: 'Memory operator' })
const memVal = (page) => page.getByRole('spinbutton', { name: 'Memory value' })
const count = (page) => page.locator('p.count')
const typeCells = (page) => page.locator('tbody td.type')
const sortByInstance = (page) => page.getByRole('button', { name: 'Instance', exact: true }).click()

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.errors = errors
})

test('filters by exact vCPU count', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuVal(page).fill('96')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`2 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText(['c5.24xlarge', 'c5.metal'])
})

test('filters by vCPU at-least', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuOp(page).selectOption('>=')
  await vcpuVal(page).fill('48')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText([
    'c5.12xlarge',
    'c5.18xlarge',
    'c5.24xlarge',
    'c5.metal',
  ])
})

test('filters by exact memory size', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await memVal(page).fill('32')
  await expect(count(page)).toHaveText(`1 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText(['c5.4xlarge'])
})

test('filters by memory at-least', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await memOp(page).selectOption('>=')
  await memVal(page).fill('96')
  await sortByInstance(page)
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
  await expect(typeCells(page)).toHaveText([
    'c5.12xlarge',
    'c5.18xlarge',
    'c5.24xlarge',
    'c5.metal',
  ])
})

test('parses a vcpu token typed into the search box and strips it', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5. vcpu>=48')
  await expect(searchBox(page)).toHaveValue('c5.')
  await expect(vcpuOp(page)).toHaveValue('>=')
  await expect(vcpuVal(page)).toHaveValue('48')
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
})

test('leaves an unrecognised token as plain substring text', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('vcpu>4')
  await expect(searchBox(page)).toHaveValue('vcpu>4')
  await expect(vcpuVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`0 of ${TOTAL} instances`)
})

test('round-trips vcpu/mem filters through the URL', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuOp(page).selectOption('>=')
  await vcpuVal(page).fill('48')

  await expect(page).toHaveURL('/?q=c5.&vcpuVal=48&vcpuOp=%3E%3D')

  await page.reload()
  await expect(vcpuOp(page)).toHaveValue('>=')
  await expect(vcpuVal(page)).toHaveValue('48')
  await expect(count(page)).toHaveText(`4 of ${TOTAL} instances`)
})

test('clears vcpu/mem filters along with everything else', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('c5.')
  await vcpuVal(page).fill('96')
  await memVal(page).fill('32')
  await page.getByRole('button', { name: 'Clear' }).click()

  await expect(vcpuVal(page)).toHaveValue('')
  await expect(memVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
})

test('does not resurrect a token after Clear is clicked mid-debounce', async ({ page }) => {
  await page.goto('/')
  await searchBox(page).fill('vcpu>=4')
  await page.getByRole('button', { name: 'Clear' }).click()
  // Wait past the 350ms debounce window so the pending timer from fill() above has fired
  // before we assert — otherwise this test passes trivially regardless of what fires.
  await page.waitForTimeout(500)
  await expect(vcpuVal(page)).toHaveValue('')
  await expect(count(page)).toHaveText(`${TOTAL} of ${TOTAL} instances`)
})

test.afterEach(async ({ page }) => {
  expect(page.errors ?? []).toEqual([])
})
