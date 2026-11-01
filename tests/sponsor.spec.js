const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve, extname } = require('node:path')
const { createHash } = require('node:crypto')

const site = resolve(__dirname, '../dist/site')
const storageKey = 'gc_sponsor_last_shown'
const sponsorSource = readFileSync(resolve(__dirname, '../src/sponsor.js'), 'utf8')
const showDelay = Number(sponsorSource.match(/const SHOW_DELAY_MS = (\d+)/)[1])
const adLoadTimeout = Number(sponsorSource.match(/const AD_LOAD_TIMEOUT_MS = (\d+)/)[1])
const dismissFactors = sponsorSource.match(/const DISMISS_MS = (\d+) \* (\d+) \* (\d+)/).slice(1)
const dismissWindow = dismissFactors.reduce((total, part) => total * Number(part), 1)
const adSrcs = sponsorSource.match(/https:\/\/bauval\.org\/22\/[a-f0-9]{32}/g)
const [desktopSrc, mobileSrc] = adSrcs
const desktopKey = desktopSrc.slice(desktopSrc.lastIndexOf('/') + 1)
const mobileKey = mobileSrc.slice(mobileSrc.lastIndexOf('/') + 1)
const day = 24 * 60 * 60 * 1000
const iframeStub = `(function () {
  var options = window.atOptions || {}
  var script = document.currentScript
  var frame = document.createElement('iframe')
  frame.width = String(options.width || '')
  frame.height = String(options.height || '')
  frame.setAttribute('data-ad-key', options.key || '')
  frame.title = 'Advertisement'
  frame.src = 'about:blank'
  if (script && script.parentNode) script.parentNode.insertBefore(frame, script.nextSibling)
})()`
const writeStub = `document.write('<iframe data-ad-key="' + window.atOptions.key + '" width="' + window.atOptions.width + '" height="' + window.atOptions.height + '" title="Advertisement" src="about:blank"></iframe>')`
const now = Date.UTC(2026, 9, 1, 12)
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  }
})

// 全部线上域名由本地构建产物替身响应。Adsterra 脚本被本地替身替换，测试不访问广告网络。
async function openSite(page, context, { origin = 'https://bracketboss2026.com', last, storageFails, offline = false, blockSponsor = false, blockAd = false, adMode = 'iframe', reveal = true } = {}) {
  const external = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push({ url: url.href, referer: route.request().headers().referer })
      if (url.hostname === 'bauval.org') {
        if (blockAd) return route.abort()
        return route.fulfill({ contentType: 'text/javascript', body: adMode === 'write' ? writeStub : iframeStub })
      }
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
  if (reveal) await page.clock.runFor(showDelay)
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
    expect(external.map(item => item.url)).toEqual([mobileSrc])
    expect(external[0].referer || '').not.toMatch(/#|private-priority-date|eb1a_user_profile/)
    await expect(page.locator('#gc-sponsor-link')).toHaveCount(0)
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(1)
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
    await page.locator('#gc-sponsor-dismiss').click()
    await expect(slot).toBeHidden()
    expect(await page.evaluate(key => Number(localStorage.getItem(key)), storageKey)).toBe(now)
    await page.reload()
    await expect(slot).toBeHidden()
    expect(external).toHaveLength(1)
  })
}

for (const origin of ['http://bracketboss2026.com', 'https://bracketboss2026.com.evil.test', 'https://preview.bracketboss2026.com', 'https://gctime.pages.dev', 'https://s546126.github.io', 'http://localhost']) {
  test(`sponsor disabled at ${origin}`, async ({ page, context }) => {
    const external = await openSite(page, context, { origin })
    await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
    expect(external).toEqual([])
  })
}

for (const [label, last, visible] of [
  ['just dismissed', String(now - 1000), false],
  ['inside 3 minutes', String(now - dismissWindow + 1), false],
  ['3 minutes', String(now - dismissWindow), true],
  ['expired', String(now - dismissWindow - 1), true],
  ['previous 24 hour cap', String(now - day + 1), true],
  ['malformed', 'garbage', true],
  ['infinite', 'Infinity', true],
  ['negative', '-1', true],
  ['future', String(now + day), false]
]) {
  test(`frequency cap: ${label}`, async ({ page, context }) => {
    const external = await openSite(page, context, { last })
    if (visible) {
      await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
      expect(external.map(item => item.url)).toEqual([mobileSrc])
    } else {
      await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
      expect(external).toEqual([])
    }
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

test('the banner shows one iframe unit and does not navigate or open a tab', async ({ page, context }) => {
  const before = await openSite(page, context).then(async external => {
    const state = await page.evaluate(() => ({ rng: _rngState, result: document.querySelector('#ab-status').textContent, hash: location.hash }))
    return { external, state }
  })
  await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(1)
  await expect(page.locator('#gc-sponsor-ad script')).toHaveCount(1)
  expect(await page.evaluate(() => window.atOptions)).toEqual({ key: mobileKey, format: 'iframe', height: 50, width: 320, params: {} })
  expect(before.external.map(item => item.url)).toEqual([mobileSrc])
  expect(context.pages()).toHaveLength(1)
  expect(await page.evaluate(() => ({ rng: _rngState, result: document.querySelector('#ab-status').textContent, hash: location.hash }))).toEqual(before.state)
  expect(await page.evaluate(() => document.documentElement.innerHTML.includes('effectivecpmnetwork'))).toBe(false)
})

for (const [width, src, key, frameWidth, frameHeight] of [
  [767, mobileSrc, mobileKey, '320', '50'],
  [768, desktopSrc, desktopKey, '728', '90'],
  [1440, desktopSrc, desktopKey, '728', '90']
]) {
  test(`viewport ${width}px loads only the ${frameWidth}x${frameHeight} unit`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 })
    const external = await openSite(page, context)
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(1)
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveAttribute('data-ad-key', key)
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveAttribute('width', frameWidth)
    await expect(page.locator('#gc-sponsor-ad iframe')).toHaveAttribute('height', frameHeight)
    expect(external.map(item => item.url)).toEqual([src])
    await page.setViewportSize({ width: width >= 768 ? 375 : 1440, height: 900 })
    await expect(page.locator('#gc-sponsor-ad script')).toHaveCount(1)
    expect(external.map(item => item.url)).toEqual([src])
  })
}

test('document.write from the ad script stays inside the banner', async ({ page, context }) => {
  await openSite(page, context, { adMode: 'write' })
  await expect(page.locator('#gc-root')).toHaveAttribute('data-ui', 'heroui-pro')
  await expect(page.locator('#hero-value')).not.toHaveText('--')
  await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(1)
  await expect(page.locator('#gc-sponsor-ad iframe')).toHaveAttribute('data-ad-key', mobileKey)
  expect(context.pages()).toHaveLength(1)
})

test('a blocked ad script hides the bar instead of leaving it empty', async ({ page, context }) => {
  await openSite(page, context, { blockAd: true, reveal: false })
  await page.clock.runFor(showDelay)
  await page.clock.runFor(adLoadTimeout)
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  await expect(page.locator('#gc-sponsor-ad iframe')).toHaveCount(0)
  await expect(page.locator('#ab-status .ab-pred')).toHaveCount(2)
  await page.locator('#share-btn').click()
})

test('dismiss still leaves predictions usable', async ({ page, context }) => {
  await openSite(page, context)
  await page.locator('#gc-sponsor-dismiss').click()
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
      const labels = await page.evaluate(() => ({
        privacy: GCI18n.text('sponsor.privacy'),
        frequency: GCI18n.text('sponsor.frequency'),
        label: GCI18n.text('sponsor.label')
      }))
      expect(labels.frequency).not.toMatch(/24/)
      expect(labels.frequency).toMatch(/3/)
      expect(labels.privacy).toMatch(/IP/)
      await expect(page.locator('#gc-sponsor-link')).toHaveCount(0)
      await expect(page.locator('#gc-sponsor-ad script')).toHaveCount(1)
      await expect(page.locator('#gc-sponsor-slot')).toContainText(labels.privacy)
      await expect(page.locator('#gc-sponsor-slot')).toContainText(labels.frequency)
      await expect(page.locator('.sponsor-label')).toHaveText(labels.label)
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1)).toBe(true)
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

test('banner stays hidden until the short delay elapses', async ({ page, context }) => {
  await openSite(page, context, { reveal: false })
  const slot = page.locator('#gc-sponsor-slot')
  await expect(slot).toBeHidden()
  await page.clock.runFor(showDelay)
  await expect(slot).toBeVisible()
})

test('dismiss hides only for the short window, then the next page load shows it again', async ({ page, context }) => {
  await openSite(page, context)
  await page.locator('#gc-sponsor-dismiss').click()
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  await page.clock.setFixedTime(now + dismissWindow - 1)
  await page.reload()
  await page.clock.runFor(showDelay)
  await expect(page.locator('#gc-sponsor-slot')).toBeHidden()
  await page.clock.setFixedTime(now + dismissWindow)
  await page.reload()
  await page.clock.runFor(showDelay)
  await expect(page.locator('#gc-sponsor-slot')).toBeVisible()
})

for (const width of [375, 1440]) {
  test(`fixed banner stays in view at ${width}px and clears primary controls`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 })
    await openSite(page, context)
    const slot = page.locator('#gc-sponsor-slot')
    await expect(slot).toBeVisible()
    expect(await slot.evaluate(element => element.parentElement.tagName)).toBe('BODY')
    await expect(slot).toHaveCSS('position', 'fixed')
    const metrics = await page.evaluate(() => {
      const slot = document.getElementById('gc-sponsor-slot')
      const root = document.getElementById('gc-root')
      const banner = slot.getBoundingClientRect()
      const share = document.getElementById('share-btn').getBoundingClientRect()
      const reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gc-sponsor-reserve'))
      root.scrollTop = root.scrollHeight
      const workspace = root.getBoundingClientRect()
      const footer = document.querySelector('.footer').getBoundingClientRect()
      const above = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.max(0, banner.top - 2))
      return {
        bannerTop: banner.top,
        bannerBottom: banner.bottom,
        bannerLeft: banner.left,
        bannerWidth: banner.width,
        bannerHeight: banner.height,
        workspaceBottom: workspace.bottom,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        footerBottom: footer.bottom,
        shareBottom: share.bottom,
        reserve,
        scrollWidth: Math.max(document.documentElement.scrollWidth, root.scrollWidth),
        aboveIsBanner: slot.contains(above),
        scrolled: root.scrollTop > 0
      }
    })
    expect(metrics.bannerLeft).toBeLessThanOrEqual(1)
    expect(metrics.bannerWidth).toBeGreaterThanOrEqual(metrics.innerWidth - 1)
    expect(Math.abs(metrics.bannerBottom - metrics.innerHeight)).toBeLessThanOrEqual(1)
    expect(metrics.bannerTop).toBeGreaterThan(metrics.innerHeight * 0.55)
    const expectedAdHeight = width >= 768 ? 90 : 50
    expect(metrics.bannerHeight).toBeGreaterThanOrEqual(expectedAdHeight)
    expect(metrics.reserve).toBeGreaterThanOrEqual(metrics.bannerHeight - 1)
    expect(Math.abs(metrics.workspaceBottom - metrics.bannerTop)).toBeLessThanOrEqual(2)
    expect(metrics.scrolled).toBe(true)
    expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.bannerTop + 1)
    expect(metrics.shareBottom).toBeLessThanOrEqual(metrics.bannerTop + 1)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1)
    expect(metrics.aboveIsBanner).toBe(false)
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
    expect(worker).toContain('origin !== self.location.origin')
    expect(worker).not.toContain('bauval.org')
    const forbidden = offline.match(/effectivecpmnetwork|bauval\.org|6d1946abad3d3fdcc79373556a137876|d450c9cf5ef416c8ffc1907634e0d6e6|id=["']gc-sponsor-slot["']|sponsor\.[a-f0-9]{16}\.js|gc_sponsor_last_shown/g)
    expect(forbidden, path + ' must not include an ad destination, slot or loader').toBeNull()
  }
})
