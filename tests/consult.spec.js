const { test: base, expect } = require('@playwright/test')

const profile = { pd: Date.UTC(2026, 0, 15), category: 'EB-1A', country: 'CN', path: 'AOS', family: 0, chartType: 'A' }
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  }
})

async function openApp(page, locale) {
  await page.addInitScript(({ saved, locale }) => {
    localStorage.setItem('eb1a_user_profile', JSON.stringify(saved))
    localStorage.setItem('gc_language', locale)
  }, { saved: profile, locale })
  await page.goto('./')
  await expect(page.locator('#welcome-modal')).toBeHidden()
  await expect(page.locator('#hero-value')).not.toHaveText('--')
}

test('free case review CTA sits in the forecast sheet, below the trend, in every locale', async ({ page }) => {
  await openApp(page, 'zh-CN')
  const cta = page.locator('.forecast-sheet > #consult-cta')
  await expect(cta).toBeVisible()
  await expect(cta.locator('a')).toHaveText('免费 EB-1A / NIW 个案评估')
  await expect(cta.locator('a')).toHaveAttribute('href', './zh/consult/')
  const box = await cta.locator('a').boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(44)
  await page.locator('#language-select').selectOption('hi')
  await expect(cta.locator('a')).toHaveAttribute('href', './consult/?lang=hi')
  await expect(cta.locator('a')).toHaveText('मुफ़्त EB-1A / NIW केस समीक्षा')
  await cta.locator('a').click()
  await expect(page).toHaveURL(/\/site\/consult\/\?lang=hi$/)
  await expect(page.locator('#consult-form')).toBeVisible()
})

async function fill(page) {
  await page.fill('#f-email', 'test+gctime@example.com')
  await page.selectOption('#f-category', 'NIW')
  await page.selectOption('#f-country', 'CN')
  await page.selectOption('#f-status', 'h1b')
  await page.fill('#f-message', 'Playwright check')
  await page.check('input[name=consent]')
}

test('consult form posts the lead as JSON and confirms', async ({ page }) => {
  let sent
  await page.route('**/api/lead', async route => {
    sent = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto('./consult/?lang=de')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.consult-cta')).toHaveCount(0)
  await expect(page.locator('#gc-sponsor-slot')).toHaveCount(0)
  // 同意框必填：未勾选时浏览器拦下，不发请求。
  await page.fill('#f-email', 'test+gctime@example.com')
  await page.click('#consult-form button[type=submit]')
  expect(sent).toBeUndefined()
  await fill(page)
  await page.click('#consult-form button[type=submit]')
  await expect(page.locator('#consult-status')).toContainText('Your request was received')
  await expect(page.locator('#consult-form')).toBeHidden()
  expect(sent).toMatchObject({
    email: 'test+gctime@example.com', category: 'NIW', country: 'CN', status: 'h1b', consent: true,
    website: '', locale: 'de', message: 'Playwright check'
  })
})

test('server errors are shown in the page language', async ({ page }) => {
  await page.route('**/api/lead', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate_limited"}' }))
  await page.goto('./zh/consult/')
  await fill(page)
  await page.click('#consult-form button[type=submit]')
  await expect(page.locator('#consult-status')).toHaveText('该网络今天提交次数过多，请明天再试。')
  await expect(page.locator('#consult-form')).toBeVisible()
  await expect(page.locator('#consult-form button[type=submit]')).toBeEnabled()
})

test('mirror without Functions fails gracefully and points to the main site', async ({ page }) => {
  // 本地静态服务器与 GitHub Pages 一样，对 POST /api/lead 返回非 JSON 错误。
  await page.goto('./consult/')
  await fill(page)
  await page.click('#consult-form button[type=submit]')
  const status = page.locator('#consult-status')
  await expect(status).toContainText('Please submit it on the main site')
  await expect(status.locator('a')).toHaveAttribute('href', 'https://bracketboss2026.com/consult/')
  await expect(page.locator('#consult-form')).toBeVisible()
})

test('bulletin pages link to the matching consult page', async ({ page }) => {
  await page.goto('./visa-bulletin/eb-2-china/')
  await expect(page.locator('.consult-cta a')).toHaveAttribute('href', '/consult/')
  await page.goto('./zh/visa-bulletin/')
  await expect(page.locator('.consult-cta a')).toHaveAttribute('href', '/zh/consult/')
})
