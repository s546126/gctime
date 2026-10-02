const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve, extname } = require('node:path')
const { createHash } = require('node:crypto')

const site = resolve(__dirname, '../dist/site')
const adUrl = 'https://www.effectivecpmnetwork.com/bekmfyfbe?key=9b81ed84d79cc96e111986555f43381f'
const storageKey = 'gc_sponsor_last_shown'
const day = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 1, 12)
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  }
})

// 全部线上域名由本地构建产物替身响应，广告点击永远不连接真实网络。
async function openSite(page, context, { origin = 'https://bracketboss2026.com', last, storageFails, offline = false, blockSponsor = false } = {}) {
  const external = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push({ url: url.href, referer: route.request().headers().referer })
      return route.fulfill({ contentType: 'text/html', body: '<title>Mock sponsor destination</title>' })
    }
    const path = resolve(site, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
    if (blockSponsor && /\/assets\/sponsor\./.test(url.pathname)) return route.abort()
    if (!path.startsWith(site + '/')) return route.abort()
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
    try { return route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', body: readFileSync(path) }) }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
  await page.clock.setFixedTime(now)
  await page.addInitScript(({ last, storageFails, offline, storageKey }) => {
    localStorage.setItem('eb1a_user_profile', JSON.stringify({ pd: Date.UTC(2026, 0, 15), category: 'EB-1A', country: 'CN', path: 'AOS', family: 0 }))
    if (!sessionStorage.getItem('sponsor-test-initialized')) {
      if (last !== undefined) localStorage.setItem(storageKey, last)
      sessionStorage.setItem('sponsor-test-initialized', '1')
    }
    if (offline) Object.defineProperty(navigator, 'onLine', { get: () => false })
    if (storageFails) {
      const original = Storage.prototype[storageFails]
      Storage.prototype[storageFails] = function (key, ...args) {
        if (key === storageKey) throw new DOMException('Blocked', 'SecurityError')
        return original.call(this, key, ...args)
      }
    }
  }, { last, storageFails, offline, storageKey })
  await page.goto(origin + '/?unrelated=private#private-priority-date')
  await expect(page.locator('#gc-root')).toHaveAttribute('data-ui', 'heroui-pro')
  await expect(page.locator('#hero-value')).not.toHaveText('--')
  return external
}

for (const host of ['bracketboss2026.com', 'www.bracketboss2026.com', 'gc.bracketboss2026.com']) {
  test(`voluntary sponsor on exact production host ${host}`, async ({ page, context }) => {
    const external = await openSite(page, context, { origin: `https://${host}` })
    const slot = page.locator('#gc-sponsor-slot')
    await expect(slot).toBeVisible()
    await expect(slot).toContainText('广告')
    await expect(page.locator('#welcome-modal')).toBeHidden()
    await expect(page.locator('#ab-status .ab-chip')).toHaveCount(2)
    expect(external).toEqual([])
    expect(await page.evaluate(key => Number(localStorage.getItem(key)), storageKey)).toBe(now)
    await page.locator('#gc-sponsor-dismiss').click()
    await expect(slot).toBeHidden()
    await page.reload()
    await expect(slot).toBeHidden()
    expect(external).toEqual([])
  })
}

for (const origin of ['http://bracketboss2026.com', 'https://bracketboss2026.com.evil.test', 'https://preview.bracketboss2026.com', 'https://gctime.pages.dev', 'https://s546126.github.io', 'http://localhost']) {
  test(`sponsor disabled at ${origin}`, async ({ page, context }) => {
    const external = await openSite(page, context, { origin })
    await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
    await expect(page.locator('#gc-sponsor-link')).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
    expect(external).toEqual([])
  })
}

for (const [label, last, visible] of [
  ['recent', String(now - 1000), false],
  ['under 24 hours', String(now - day + 1), false],
  ['24 hours', String(now - day), true],
  ['expired', String(now - day - 1), true],
  ['malformed', 'garbage', true],
  ['infinite', 'Infinity', true],
  ['negative', '-1', true],
  ['future', String(now + day), false]
]) {
  test(`frequency cap: ${label}`, async ({ page, context }) => {
    await openSite(page, context, { last })
    if (visible) await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
    else await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  })
}

for (const storageFails of ['getItem', 'setItem']) {
  test(`unavailable storage (${storageFails}) fails closed without breaking predictions`, async ({ page, context }) => {
    await openSite(page, context, { storageFails })
    await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
    await expect(page.locator('#ab-status .ab-pred')).toHaveCount(2)
    await page.locator('#share-btn').click()
    await expect(page.locator('#ab-status .ab-pred')).toHaveCount(2)
  })
}

test('only an explicit click opens fixed isolated destination without profile or referrer', async ({ page, context }) => {
  const external = await openSite(page, context)
  const link = page.locator('#gc-sponsor-link')
  await expect(link).toHaveAttribute('href', adUrl)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  for (const token of ['sponsored', 'noopener', 'noreferrer']) await expect(link).toHaveAttribute('rel', new RegExp(`\\b${token}\\b`))
  const before = await page.evaluate(() => ({ rng: _rngState, result: document.querySelector('#ab-status').textContent, hash: location.hash }))
  expect(external).toEqual([])
  const popupPromise = context.waitForEvent('page')
  await link.click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe(adUrl)
  expect(await popup.evaluate(() => ({ opener: window.opener, referrer: document.referrer }))).toEqual({ opener: null, referrer: '' })
  expect(external).toEqual([{ url: adUrl, referer: undefined }])
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  expect(await page.evaluate(() => ({ rng: _rngState, result: document.querySelector('#ab-status').textContent, hash: location.hash }))).toEqual(before)
  await popup.close()
})

test('blocked navigation and dismiss never gate core features', async ({ page, context }) => {
  await openSite(page, context)
  await page.locator('#gc-sponsor-link').evaluate(link => link.addEventListener('click', event => event.preventDefault()))
  await page.locator('#gc-sponsor-link').click()
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  await page.locator('[data-pct="p90"]').click()
  await expect(page.locator('#ab-status .ab-pred')).toHaveCount(2)
  await page.locator('#share-btn').click()
})

test('online shell does not display sponsor when offline', async ({ page, context }) => {
  await openSite(page, context, { offline: true })
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
})

test('missing sponsor script cannot block predictions or sharing', async ({ page, context }) => {
  await openSite(page, context, { blockSponsor: true })
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  await expect(page.locator('#ab-status .ab-pred')).toHaveCount(2)
  await page.locator('#share-btn').click()
})

test('another tab frequency update hides the existing entry', async ({ page, context }) => {
  await openSite(page, context)
  await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
  await page.evaluate(({ storageKey, now }) => {
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue: String(now + 1) }))
  }, { storageKey, now })
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
})

test('sponsor is removed if the connection goes offline', async ({ page, context }) => {
  await openSite(page, context)
  await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
})

for (const width of [375, 1440]) {
  test(`ten languages and RTL fit ${width}px without changing predictions`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await openSite(page, context)
    const languages = await page.evaluate(() => GCI18n.availableLanguages().map(item => item.id))
    expect(languages).toHaveLength(10)
    const rng = await page.evaluate(() => _rngState)
    for (const locale of languages) {
      await page.evaluate(locale => GCI18n.setLocale(locale), locale)
      await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
      const labels = await page.evaluate(() => ({ open: GCI18n.text('sponsor.open'), privacy: GCI18n.text('sponsor.privacy') }))
      await expect(page.locator('#gc-sponsor-link')).toHaveText(labels.open)
      await expect(page.locator('#gc-sponsor-slot')).toContainText(labels.privacy)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      expect(await page.evaluate(() => _rngState)).toBe(rng)
      if (locale === 'ar') {
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await page.locator('#gc-sponsor-slot').screenshot({ path: testInfo.outputPath(`sponsor-ar-${width}.png`) })
      }
    }
    await page.evaluate(() => GCI18n.setLocale('zh-CN'))
    await page.locator('#gc-sponsor-slot').screenshot({ path: testInfo.outputPath(`sponsor-zh-${width}.png`) })
  })
}

test('online sponsor is fingerprinted and optional; offline artifact has no loader or ad URL', async () => {
  const online = readFileSync(resolve(site, 'index.html'), 'utf8')
  const worker = readFileSync(resolve(site, 'sw.js'), 'utf8')
  const source = readFileSync(resolve(__dirname, '../src/sponsor.js'))
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const asset = `assets/sponsor.${hash}.js`
  expect(online).toContain(`src="${asset}"`)
  expect(readFileSync(resolve(site, asset))).toEqual(source)
  expect(worker).not.toContain('sponsor.')
  for (const path of ['../index.html', '../dist/EB1A.html']) {
    const offline = readFileSync(resolve(__dirname, path), 'utf8')
    const forbidden = offline.match(/effectivecpmnetwork|id=["']gc-sponsor-slot["']|sponsor\.[a-f0-9]{16}\.js|gc_sponsor_last_shown/g)
    expect(forbidden, path + ' must not include an ad destination, slot or loader').toBeNull()
  }
})
