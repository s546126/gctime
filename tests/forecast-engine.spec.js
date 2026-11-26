const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

// 预测引擎回归：表B 区间与结果同源、典型领先量与表B 首点、PD 等于 cutoff 不算排到。
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors, '预测引擎回归不应产生页面异常').toEqual([])
  }
})

const HISTORY = JSON.parse(readFileSync(resolve(__dirname, '../data/visa_bulletin_history.json'), 'utf8'))
const MONTHLY = HISTORY.monthly
const DAY = 86400000
const MONTH = 31 * DAY

async function openCell(page, profile) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(value => {
    localStorage.setItem('eb1a_user_profile', JSON.stringify({ path: 'AOS', family: 0, chartType: 'A', ...value }))
  }, profile)
  await page.goto('./')
  await expect(page.locator('#welcome-modal')).toBeHidden()
  await expect(page.locator('#chart path').first()).toBeAttached()
}

// 与页面 median() 同口径：偶数长度取中间两数均值
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function expectedLead(cell) {
  const a = MONTHLY[`${cell}|A`], b = MONTHLY[`${cell}|B`], leads = []
  for (const month of Object.keys(b)) {
    if (!(month in a) || ['C', 'U'].includes(a[month]) || ['C', 'U'].includes(b[month])) continue
    leads.push(new Date(b[month]).getTime() - new Date(a[month]).getTime())
  }
  return median(leads)
}

test('B band, B result and chart share one set of per-path projections', async ({ page }) => {
  await openCell(page, { pd: Date.UTC(2024, 7, 1), category: 'EB-3', country: 'CN' })
  const result = await page.evaluate(() => {
    const pd = getYourPD()
    const keys = ['p10', 'p25', 'p50', 'p75', 'p90']
    const chart = comparisonSeries(lastPercentiles, false).B
    const bandOrdered = lastPercentilesB.p50.every((point, i) =>
      lastPercentilesB.p10[i].y >= lastPercentilesB.p25[i].y &&
      lastPercentilesB.p25[i].y >= point.y &&
      point.y >= lastPercentilesB.p75[i].y &&
      lastPercentilesB.p75[i].y >= lastPercentilesB.p90[i].y)
    return {
      bandOrdered,
      chartUsesProjected: keys.every(key => JSON.stringify(chart[key]) === JSON.stringify(lastPercentilesB[key])),
      band: keys.map(key => findCrossingDate(lastPercentilesB[key], pd)),
      result: keys.map(key => crossingsByPctB[key])
    }
  })
  expect(result.bandOrdered, '表B 区间每个月都应 p10 ≥ p50 ≥ p90').toBe(true)
  expect(result.chartUsesProjected, '图表表B 必须直接使用逐条投影后的百分位').toBe(true)
  expect(result.result.every(Boolean)).toBe(true)
  for (let i = 1; i < result.band.length; i++) {
    expect(result.band[i], '表B 区间穿越时间应按快→慢排序').toBeGreaterThanOrEqual(result.band[i - 1])
  }
  // 百分位路径取 floor(0.9n) 一侧、穿越分布取 floor(0.1n) 一侧，相差至多一个样本 → 允许一个月
  for (let i = 0; i < result.band.length; i++) {
    expect(Math.abs(result.band[i] - result.result[i]), '图表区间与结果卡应相差不超过一个月').toBeLessThanOrEqual(MONTH)
  }
})

for (const [category, country, cell, pd] of [
  ['EB-2', 'ROW', 'EB-2|ROW', Date.UTC(2026, 0, 1)],
  ['EB-1', 'CN', 'EB-1A|CN', Date.UTC(2024, 9, 1)]
]) {
  test(`${cell} typical lead skips C/U months and the B path starts at the published B`, async ({ page }) => {
    await openCell(page, { pd, category, country })
    const result = await page.evaluate(() => {
      const bNow = histB()[histB().length - 1].y, typ = typicalLead()
      // 构造 A0 + 中位领先 > 当前表B 的路径：首点仍须等于已公布的表B
      const x0 = lastPercentiles.p50[0].x
      const a0 = bNow - typ + 30 * 86400000
      const projected = projectBPath([{ x: x0, y: a0 }, { x: x0 + 31 * 86400000, y: a0 }])
      return { typ, bNow, first: projected[0].y, second: projected[1].y, a0, band0: lastPercentilesB.p50[0].y }
    })
    expect(result.typ).toBe(expectedLead(cell))
    expect(result.first, '表B 第 0 点 = 最新一期已公布值').toBe(result.bNow)
    expect(result.band0, '表B 区间首点 = 最新一期已公布值').toBe(result.bNow)
    expect(result.second, '从第 1 期起才按 A + 中位领先推进').toBeGreaterThanOrEqual(result.a0 + result.typ)
  })
}

test('a priority date equal to the cutoff is not current yet', async ({ page }) => {
  // 取最新一期 EB-3 中国表A，不写死日期：新公告上线后测试仍然成立
  const raw = MONTHLY['EB-3|CN|A'][HISTORY.last_bulletin]
  test.skip(['C', 'U'].includes(raw), '最新一期 EB-3 中国表A 不是日期')
  const cutoff = new Date(raw).getTime()
  await openCell(page, { pd: cutoff, category: 'EB-3', country: 'CN' })
  const result = await page.evaluate(cutoff => ({
    cutoff: getCurrentCutoff(),
    equal: findCrossingDate([{ x: 1, y: cutoff }], cutoff),
    later: findCrossingDate([{ x: 1, y: cutoff }, { x: 2, y: cutoff + 1 }], cutoff),
    first: lastPercentiles.p50[0].x,
    p10: crossingsByPct.p10,
    lead: document.getElementById('result-lead').textContent,
    expected: tx('result.expected')
  }), cutoff)
  expect(result.cutoff).toBe(cutoff)
  expect(result.equal, 'PD = cutoff 不算穿越').toBeNull()
  expect(result.later, 'cutoff 越过 PD 的那一期才算穿越').toBe(2)
  expect(result.p10, '最快情形也不能是本期').toBeGreaterThan(result.first)
  expect(result.lead).toBe(result.expected)
  await expect(page.locator('#congrats')).toBeHidden()
})
