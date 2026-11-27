const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

// I-485 库存排位面板：数据来自 data/i485_queue.json（scripts/build_i485_queue.py 从 USCIS xlsx 生成）。
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors, '页面不应出现未捕获的 JavaScript 异常').toEqual([])
  }
})

const QUEUE = JSON.parse(readFileSync(resolve('data/i485_queue.json'), 'utf8'))
const latest = key => QUEUE.cells[key][QUEUE.cells[key].length - 1]
function slotValue(enc, year, month) {
  const slot = year === 'prior' ? month - 1 : 12 * (year - enc.y0 + 1) + month - 1
  const d = enc.d.find(pair => pair[0] === slot)
  return { n: enc.n[slot] || 0, d: d ? d[1] : 0 }
}
// 与页面独立实现的「早于你」估计：确切数 + D 格 × 5
function aheadEstimate(enc, year, month) {
  let total = 0
  const mine = 12 * (year - enc.y0 + 1) + month - 1
  for (let i = 0; i < mine; i++) {
    const value = slotValue(enc, i < 12 ? 'prior' : enc.y0 + Math.floor(i / 12) - 1, i % 12 + 1)
    total += value.n + value.d * QUEUE.d.est
  }
  return total
}

async function openProfile(page, { category, country, pd, language }) {
  await page.addInitScript(({ category, country, pd, language }) => {
    if (!localStorage.getItem('eb1a_user_profile')) {
      localStorage.setItem('eb1a_user_profile', JSON.stringify({ pd, category, country, path: 'AOS', family: 0, chartType: 'A' }))
      if (language) localStorage.setItem('gc_language', language)
    }
  }, { category, country, pd, language })
  await page.goto('./')
  await expect(page.locator('#welcome-modal')).toBeHidden()
  await expect(page.locator('#hero-value')).not.toHaveText('--')
}

// 解析器逐格对照见 scripts/test_i485_queue.py（钉在 2026-10-05 快照上）；这里只断言不随数据窗口滚动而变的结构。
test('embedded queue data covers EB-1/2/3 for every chargeability and stays in range', () => {
  expect(QUEUE.snapshots.length).toBeGreaterThanOrEqual(1)
  expect(QUEUE.snapshots.length).toBeLessThanOrEqual(3)
  expect(QUEUE.snapshots.map(s => s.asof)).toEqual(QUEUE.snapshots.map(s => s.asof).slice().sort())
  expect(Object.keys(QUEUE.cells).sort()).toEqual(['EB-1', 'EB-2', 'EB-3'].flatMap(c => ['CN', 'IN', 'MX', 'PH', 'ROW'].map(co => `${c}|${co}`)).sort())
  for (const [key, per] of Object.entries(QUEUE.cells)) {
    expect(per.length, key).toBe(QUEUE.snapshots.length)
    for (const enc of per.filter(Boolean)) {
      expect(enc.n.length, key).toBeLessThanOrEqual(12 * (enc.y1 - enc.y0 + 2))
      expect(enc.n.every(v => Number.isInteger(v) && v >= 0), key).toBe(true)
    }
  }
  // India EB-2/EB-3 来自单独的表，年份列比其他表早得多
  expect(latest('EB-2|IN').y1).toBeLessThan(latest('EB-1|IN').y1)
})

test('EB-2 China shows filed I-485s ahead, share, change across snapshots and caveats', async ({ page }) => {
  await openProfile(page, { category: 'EB-2', country: 'CN', pd: Date.UTC(2022, 5, 15) })
  const panel = page.locator('#queue-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('#queue-title')).toHaveText('I-485 库存里排在你前面的人')
  const expected = aheadEstimate(latest('EB-2|CN'), 2022, 6)
  const hasD = latest('EB-2|CN').d.some(([slot]) => slot < 12 * (2022 - latest('EB-2|CN').y0 + 1) + 5)
  await expect(panel.locator('[data-queue-ahead]')).toHaveText((hasD ? '≈ ' : '') + expected.toLocaleString('zh-CN'))
  if (hasD) await expect(panel.locator('.queue-range')).toContainText('D 格按 1–9 件计')
  await expect(panel).toContainText('2022年6月')
  await expect(panel).toContainText('在案总数')
  const first = aheadEstimate(QUEUE.cells['EB-2|CN'][0], 2022, 6)
  const change = panel.locator('[data-queue-change]')
  await expect(change).toHaveAttribute('data-queue-change', first - expected >= 10 ? 'cleared' : first - expected <= -10 ? 'grew' : 'flat')
  const asofs = QUEUE.snapshots.map(s => s.asof)
  await expect(change).toContainText(asofs[0])
  await expect(panel.locator('.queue-table tbody tr')).toHaveCount(asofs.length)
  await expect(panel.locator('.queue-table tbody tr').first().locator('th')).toHaveText(asofs[asofs.length - 1])
  await expect(panel.locator('.queue-note')).toHaveText('只计已递交的 I-485，是下界 · USCIS 数据截至 ' + asofs[asofs.length - 1])
  await panel.locator('.queue-details summary').click()
  await expect(panel.locator('.queue-details li')).toHaveCount(5)
  await expect(panel.locator('.queue-details')).toContainText('NVC')
  await expect(panel.locator('.queue-details')).toContainText('China')
  await expect(panel.locator('.queue-details a')).toHaveAttribute('href', QUEUE.url)
  expect(await panel.innerText()).not.toMatch(/NaN|undefined|Infinity/)
})

test('a month nobody could file yet is explained instead of reporting zero movement', async ({ page }) => {
  // India EB-2 的表只到 2015 年：PD 2020 时全部在案申请都早于你，同月为 0
  await openProfile(page, { category: 'EB-2', country: 'IN', pd: Date.UTC(2020, 5, 1) })
  const panel = page.locator('#queue-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('还没有 I-485')
  await expect(panel).toContainText('100%')
  await expect(panel.locator('.queue-details')).toContainText('India')
})

test('priority dates in the aggregated Prior Years bucket show an upper limit only', async ({ page }) => {
  await openProfile(page, { category: 'EB-2', country: 'IN', pd: Date.UTC(2005, 0, 10) })
  const panel = page.locator('#queue-panel')
  await expect(panel.locator('[data-queue-ahead]')).toHaveText(/^≤ /)
  await expect(panel).toContainText('只能给出上限')
  await expect(panel.locator('.queue-range')).toHaveCount(0)
})

test('current categories still show the queue; uncovered categories hide it', async ({ page }) => {
  await openProfile(page, { category: 'EB-1', country: 'ROW', pd: Date.UTC(2023, 10, 14) })
  await expect(page.locator('.chart-panel')).toBeHidden()
  await expect(page.locator('#queue-panel')).toBeVisible()
  await page.evaluate(() => { profile.category = 'EB-4'; renderHero() })
  await expect(page.locator('#queue-panel')).toBeHidden()
})

test('switching language re-renders the panel in every supported locale', async ({ page }) => {
  await openProfile(page, { category: 'EB-1', country: 'CN', pd: Date.UTC(2023, 6, 1) })
  const panel = page.locator('#queue-panel')
  await expect(panel).toBeVisible()
  const languages = await page.locator('#language-select option').evaluateAll(options => options.map(o => o.value))
  expect(languages.length).toBe(11)
  for (const language of languages) {
    await page.locator('#language-select').selectOption(language)
    await expect(panel.locator('[data-queue-ahead]')).not.toHaveText('')
    const text = await panel.innerText()
    expect(text, language).not.toMatch(/NaN|undefined|Infinity|queue\./)
  }
  await page.locator('#language-select').selectOption('en')
  await expect(panel.locator('#queue-title')).toHaveText('Pending I-485s ahead of you')
  await expect(panel.locator('.queue-note')).toContainText('lower bound')
})

test('the panel fits a 375px screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openProfile(page, { category: 'EB-3', country: 'ROW', pd: Date.UTC(2024, 2, 1) })
  await expect(page.locator('#queue-panel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  const summary = await page.locator('.queue-details summary').boundingBox()
  expect(summary.height).toBeGreaterThanOrEqual(44)
})
