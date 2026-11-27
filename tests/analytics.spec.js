const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve, extname } = require('node:path')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

// 匿名统计（src/analytics.js）。所有用例都不访问真实网络：本地主机本来就不加载 PostHog；
// 模拟正式域名时，PostHog 的 array.js 由本地替身响应，或用 window.__GC_ANALYTICS_MOCK 完全不加载。
const site = resolve(__dirname, '../dist/site')
const analyticsSource = readFileSync(resolve(__dirname, '../src/analytics.js'), 'utf8')
const pd = Date.UTC(2021, 2, 15)
const pdText = '2021-03-15'
const profile = { pd, category: 'EB-2', country: 'CN', path: 'AOS', family: 0 }
const posthogPattern = /posthog/i

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    expect(errors).toEqual([])
  }
})

async function seed(page, { mock = true, locale = 'zh-CN', dnt = false } = {}) {
  await page.addInitScript(({ saved, locale, mock, dnt }) => {
    if (location.protocol === 'about:') return
    localStorage.setItem('eb1a_user_profile', JSON.stringify(saved))
    localStorage.setItem('gc_language', locale)
    if (mock) window.__GC_ANALYTICS_MOCK = []
    if (dnt) Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })
    // 点评估入口时只记录事件，不离开当前页，便于读取模拟队列。
    window.addEventListener('click', event => {
      if (window.__GC_STAY && event.target.closest && event.target.closest('a[data-gc-cta]')) event.preventDefault()
    })
  }, { saved: profile, locale, mock, dnt })
}

async function openApp(page, path = './') {
  await page.goto(path)
  await expect(page.locator('#gc-root')).toHaveAttribute('data-ui', 'heroui-pro')
  await expect(page.locator('#welcome-modal')).toBeHidden()
  await expect(page.locator('#hero-value')).not.toHaveText('--')
}

const events = page => page.evaluate(() => window.__GC_ANALYTICS_MOCK.slice())
const named = async (page, name) => (await events(page)).filter(item => item.event === name)

function expectNoPii(list) {
  const json = JSON.stringify(list)
  for (const secret of [pdText, '2021-03', 'test+gctime@example.com', 'Playwright check', 'Ada Lovelace', '+1 555 0100']) {
    expect(json, 'analytics must not carry ' + secret).not.toContain(secret)
  }
  for (const item of list) {
    expect(item.properties.app).toBe('gctime')
    for (const key of Object.keys(item.properties)) expect(key).not.toMatch(/^(name|email|contact|phone|message|priority_?date|pd)$/i)
  }
}

// 全部线上域名由本地构建产物替身响应；PostHog 与广告网络只由替身响应。
async function emulateHost(page, context, origin, { blockPosthog = false } = {}) {
  const external = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push(url.href)
      if (blockPosthog && posthogPattern.test(url.hostname)) return route.abort()
      if (url.hostname === 'us.i.posthog.com' && url.pathname === '/static/array.js') {
        return route.fulfill({ contentType: 'text/javascript', body: 'window.__arrayLoaded = true' })
      }
      if (url.hostname === 'bauval.org') return route.fulfill({ contentType: 'text/javascript', body: '' })
      return route.abort()
    }
    const path = resolve(site, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname))
    if (!path.startsWith(site + '/')) return route.abort()
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
    try { return route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', body: readFileSync(path) }) }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
  return external
}

test('local preview never contacts PostHog on the app, landing or consult pages', async ({ page }) => {
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await seed(page, { mock: false })
  await openApp(page)
  await page.locator('.stat[data-pct="p90"]').click()
  await page.waitForTimeout(1300)
  expect(await page.evaluate(() => ({ posthog: typeof window.posthog, live: window.GCAnalytics && window.GCAnalytics.live }))).toEqual({ posthog: 'undefined', live: false })
  for (const path of ['./visa-bulletin/', './visa-bulletin/eb-2-china/', './zh/consult/']) await page.goto(path)
  expect(requests.filter(url => posthogPattern.test(url))).toEqual([])
  expect(await page.evaluate(() => typeof window.posthog)).toBe('undefined')
})

test('offline single file has no analytics loader and makes no PostHog request', async ({ page }) => {
  // 词典里的隐私说明会提到 PostHog 这个名字（与在线版共用文案），但离线产物不能含有任何加载代码或配置。
  for (const path of ['../index.html', '../dist/EB1A.html']) {
    const text = readFileSync(resolve(__dirname, path), 'utf8')
    expect(text.match(/posthog\.com|phc_[A-Za-z0-9]+|\/static\/array\.js|__GC_ANALYTICS_MOCK|api_host|person_profiles|analytics\.[a-f0-9]{16}\.js|assets\/analytics/g), path).toBeNull()
  }
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await seed(page, { mock: false })
  await page.goto(pathToFileURL(resolve(__dirname, '../dist/EB1A.html')).href)
  await expect(page.locator('#hero-value')).not.toHaveText('--')
  await page.locator('.stat[data-pct="p10"]').click()
  await page.waitForTimeout(1300)
  expect(requests.filter(url => posthogPattern.test(url))).toEqual([])
  expect(await page.evaluate(() => typeof window.GCAnalytics)).toBe('undefined')
})

test('online build fingerprints the analytics script and the worker never touches PostHog', async () => {
  const online = readFileSync(resolve(site, 'index.html'), 'utf8')
  const worker = readFileSync(resolve(site, 'sw.js'), 'utf8')
  const hash = createHash('sha256').update(analyticsSource).digest('hex').slice(0, 16)
  const asset = `assets/analytics.${hash}.js`
  expect(online).toContain(`<script src="${asset}" defer></script>`)
  expect(online.indexOf(asset)).toBeLessThan(online.indexOf('</head>'))
  expect(readFileSync(resolve(site, asset), 'utf8')).toBe(analyticsSource)
  for (const page of ['visa-bulletin/index.html', 'visa-bulletin/eb-2-china/index.html', 'zh/eb-2-china/index.html', 'consult/index.html', 'zh/consult/index.html']) {
    expect(readFileSync(resolve(site, page), 'utf8'), page).toContain(`<script src="/${asset}" defer></script>`)
  }
  // 跨源请求一律放过，PostHog 不会被拦截或写入缓存；统计脚本也不是 worker 安装的依赖。
  expect(worker).toContain('origin !== self.location.origin')
  expect(worker).not.toMatch(/posthog|analytics/i)
})

test('predict_run is debounced and carries only coarse, non-personal properties', async ({ page }) => {
  await seed(page)
  await openApp(page)
  await page.locator('.stat[data-pct="p10"]').click()
  await page.locator('.stat[data-pct="p50"]').click()
  await page.locator('.stat[data-pct="p90"]').click()
  await expect.poll(() => named(page, 'predict_run')).toHaveLength(1)
  await page.waitForTimeout(1200)
  const runs = await named(page, 'predict_run')
  expect(runs).toHaveLength(1)
  const props = runs[0].properties
  expect(props).toMatchObject({ trigger: 'scenario', category: 'EB-2', country: 'CN', scenario: 'conservative', pace: 'model', shared: false, locale: 'zh-CN', app: 'gctime' })
  expect(['A', 'B', 'unknown']).toContain(props.chart)
  for (const key of ['result_bucket', 'result_bucket_a', 'result_bucket_b']) {
    expect(props[key] === null || (Number.isInteger(props[key]) && props[key] >= 0)).toBe(true)
  }
  expect(props.result_bucket).toBe(props.chart === 'B' ? props.result_bucket_b : props.result_bucket_a)
  // 页面加载本身不算一次预测。
  expect((await events(page)).map(item => item.event)).toEqual(['predict_run'])

  // 拖动参数滑杆只上报一次。
  const slider = page.locator('#params-container input[type=range]').first()
  if (await slider.count()) {
    await slider.evaluate(element => {
      for (let i = 0; i < 6; i++) {
        element.value = String(Number(element.min) + (Number(element.max) - Number(element.min)) * (i + 1) / 8)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await expect.poll(() => named(page, 'predict_run')).toHaveLength(2)
    expect((await named(page, 'predict_run'))[1].properties.trigger).toBe('params')
  }
  expectNoPii(await events(page))
})

test('share, locale and app consult CTA events fire with expected props', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seed(page)
  await openApp(page)
  await page.locator('#share-btn').click()
  await expect.poll(() => named(page, 'share_link_created')).toHaveLength(1)
  expect((await named(page, 'share_link_created'))[0].properties).toMatchObject({ category: 'EB-2', country: 'CN', locale: 'zh-CN' })

  await page.locator('#language-select').selectOption('en')
  await expect.poll(() => named(page, 'locale_changed')).toHaveLength(1)
  expect((await named(page, 'locale_changed'))[0].properties).toMatchObject({ from: 'zh-CN', to: 'en' })

  // 去抖中的预测在点评估入口前先补发，漏斗顺序保持 predict_run → consult_cta_click。
  await page.evaluate(() => { window.__GC_STAY = true })
  await page.locator('.stat[data-pct="p10"]').click()
  await page.locator('#consult-cta a').click()
  const order = (await events(page)).map(item => item.event)
  expect(order.slice(-2)).toEqual(['predict_run', 'consult_cta_click'])
  expect((await named(page, 'consult_cta_click'))[0].properties).toMatchObject({ placement: 'app', page: '/site/', locale: 'en' })
  expectNoPii(await events(page))
})

test('a shared link with an exact priority date never leaks it', async ({ page }) => {
  await seed(page)
  await page.goto('./')
  const url = await page.evaluate(date => window.GCShare.build(location.href, {
    category: 'EB-3', country: 'IN', pd: date, pace: 'model', percentile: 'p50', supply: 'normal', params: {}, lang: 'zh-CN'
  }), pdText)
  expect(url).toContain(pdText)
  await page.goto('about:blank')
  await openApp(page, url)
  await page.locator('.stat[data-pct="p90"]').click()
  await expect.poll(() => named(page, 'predict_run')).toHaveLength(1)
  expect((await named(page, 'predict_run'))[0].properties).toMatchObject({ category: 'EB-3', country: 'IN', shared: true })
  expectNoPii(await events(page))
  // 发送前的 URL 过滤：去掉 # 片段，只保留 utm / lang / ref 查询参数。
  expect(await page.evaluate(() => window.GCAnalytics.cleanUrl('https://bracketboss2026.com/?utm_source=x&email=a%40b.c&lang=en#share=1&pd=2021-03-15')))
    .toBe('https://bracketboss2026.com/?utm_source=x&lang=en')
})

async function fillLead(page) {
  await page.fill('#f-name', 'Ada Lovelace')
  await page.fill('#f-email', 'test+gctime@example.com')
  await page.fill('#f-contact', '+1 555 0100')
  await page.selectOption('#f-category', 'NIW')
  await page.selectOption('#f-country', 'CN')
  await page.fill('#f-pd', pdText)
  await page.selectOption('#f-status', 'h1b')
  await page.fill('#f-message', 'Playwright check')
  await page.check('input[name=consent]')
}

// 静态页用站点根路径引用 /assets/…，所以在正式域名替身上测试（模拟接缝开启，不加载 PostHog）。
const prod = 'https://bracketboss2026.com'

test('consult pages report views and lead results without personal data', async ({ page, context }) => {
  const external = await emulateHost(page, context, prod)
  await seed(page)
  let status = 200, body = '{"ok":true}'
  await page.route('**/api/lead', route => route.fulfill({ status, contentType: 'application/json', body }))
  await page.goto(prod + '/visa-bulletin/')
  await page.locator('.consult-cta a').click()
  await expect(page).toHaveURL(prod + '/consult/')
  await expect.poll(() => named(page, 'consult_view')).toHaveLength(1)
  expect((await named(page, 'consult_view'))[0].properties).toMatchObject({ page: '/consult/', locale: 'en', source: '/visa-bulletin/' })
  await fillLead(page)
  await page.click('#consult-form button[type=submit]')
  await expect(page.locator('#consult-status')).toContainText('Your request was received')
  expect((await named(page, 'lead_submit_result'))[0].properties).toMatchObject({ result: 'ok', code: 'ok', category: 'NIW', country: 'CN', locale: 'en' })
  expectNoPii(await events(page))

  status = 429; body = '{"error":"rate_limited"}'
  await page.goto(prod + '/zh/consult/')
  await fillLead(page)
  await page.click('#consult-form button[type=submit]')
  await expect(page.locator('#consult-status')).toHaveText('该网络今天提交次数过多，请明天再试。')
  expect((await named(page, 'lead_submit_result'))[0].properties).toMatchObject({ result: 'error', code: 'rate_limited', category: 'NIW', country: 'CN', locale: 'zh-CN' })
  expectNoPii(await events(page))
  expect(external.filter(url => posthogPattern.test(url))).toEqual([])
})

test('lead source keeps the first utm_source of the session', async ({ page, context }) => {
  await emulateHost(page, context, prod)
  await seed(page)
  const sent = []
  await page.route('**/api/lead', route => { sent.push(JSON.parse(route.request().postData())); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
  await page.goto(prod + '/visa-bulletin/?utm_source=X&utm_medium=reply<b>')
  await page.goto(prod + '/visa-bulletin/?utm_source=later')
  await page.locator('.consult-cta a').click()
  await expect(page).toHaveURL(prod + '/consult/')
  await fillLead(page)
  await page.click('#consult-form button[type=submit]')
  await expect(page.locator('#consult-status')).toContainText('Your request was received')
  expect(sent[0].source).toBe('/visa-bulletin/?utm_source=x&utm_medium=replyb')
})

for (const [path, placement] of [['/visa-bulletin/eb-2-china/', 'landing'], ['/zh/eb-2-china/', 'landing'], ['/visa-bulletin/', 'hub'], ['/zh/visa-bulletin/', 'hub']]) {
  test(`static ${placement} page ${path} reports the consult CTA click`, async ({ page, context }) => {
    await emulateHost(page, context, prod)
    await seed(page)
    await page.goto(prod + path)
    await page.evaluate(() => { window.__GC_STAY = true })
    await page.locator('.consult-cta a').click()
    const clicks = await named(page, 'consult_cta_click')
    expect(clicks).toHaveLength(1)
    expect(clicks[0].properties).toMatchObject({ placement, page: path, app: 'gctime' })
  })
}

test('production host loads PostHog once with the privacy configuration', async ({ page, context }) => {
  const external = await emulateHost(page, context, 'https://bracketboss2026.com')
  await seed(page, { mock: false })
  await openApp(page, 'https://bracketboss2026.com/#lang=zh-CN')
  await expect.poll(() => page.evaluate(() => window.__arrayLoaded === true)).toBe(true)
  expect(external.filter(url => posthogPattern.test(url))).toEqual(['https://us.i.posthog.com/static/array.js'])
  const state = await page.evaluate(() => {
    const [token, config] = window.posthog._i[0]
    const queued = Array.from(window.posthog).map(item => Array.from(item))
    const cleaned = config.before_send({
      event: '$pageview',
      properties: { $current_url: 'https://bracketboss2026.com/?utm_campaign=c&x=1#share=1&pd=2021-03-15', email: 'a@b.c', $referrer: 'https://www.google.com/search?q=secret' },
      $set_once: { $initial_current_url: 'https://bracketboss2026.com/#pd=2021-03-15' }
    })
    const { before_send, ...rest } = config
    return { token, config: rest, hasBeforeSend: typeof before_send === 'function', queued, cleaned }
  })
  expect(state.token).toMatch(/^phc_/)
  expect(state.hasBeforeSend).toBe(true)
  expect(state.config).toEqual({
    api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only', capture_pageview: true, capture_pageleave: true,
    autocapture: false, disable_session_recording: true, disable_surveys: true, enable_heatmaps: false,
    capture_dead_clicks: false, respect_dnt: true
  })
  expect(state.queued[0]).toEqual(['register', { app: 'gctime' }])
  expect(state.cleaned).toEqual({
    event: '$pageview',
    properties: { $current_url: 'https://bracketboss2026.com/?utm_campaign=c', $referrer: 'https://www.google.com/search', app: 'gctime' },
    $set_once: { $initial_current_url: 'https://bracketboss2026.com/' }
  })

  await page.locator('.stat[data-pct="p90"]').click()
  // 横幅事件（sponsor_*）也会进入同一队列，这里只看预测。
  const predictions = () => page.evaluate(() => Array.from(window.posthog).filter(item => item[0] === 'capture' && item[1] === 'predict_run').map(item => item[2]))
  await expect.poll(predictions).toHaveLength(1)
  const capture = (await predictions())[0]
  expect(capture).toMatchObject({ trigger: 'scenario', category: 'EB-2', country: 'CN', scenario: 'conservative' })
  expect(JSON.stringify(capture)).not.toContain('2021-03')

  // 落地页同样加载 PostHog（同一份 array.js）。
  await page.goto('https://bracketboss2026.com/visa-bulletin/eb-2-china/')
  await expect.poll(() => page.evaluate(() => window.__arrayLoaded === true)).toBe(true)
  expect(await page.evaluate(() => window.posthog._i[0][1].api_host)).toBe('https://us.i.posthog.com')
})

for (const [label, origin, dnt] of [['Do Not Track', 'https://bracketboss2026.com', true], ['a preview host', 'https://gctime.pages.dev', false], ['plain http', 'http://bracketboss2026.com', false]]) {
  test(`no PostHog request under ${label}`, async ({ page, context }) => {
    const external = await emulateHost(page, context, origin)
    await seed(page, { mock: false, dnt })
    await openApp(page, origin + '/')
    await page.locator('.stat[data-pct="p90"]').click()
    await page.waitForTimeout(1300)
    expect(external.filter(url => posthogPattern.test(url))).toEqual([])
    expect(await page.evaluate(() => typeof window.posthog)).toBe('undefined')
  })
}

test('blocked PostHog never breaks predictions', async ({ page, context }) => {
  const external = await emulateHost(page, context, 'https://www.bracketboss2026.com', { blockPosthog: true })
  await seed(page, { mock: false })
  await openApp(page, 'https://www.bracketboss2026.com/')
  await page.locator('.stat[data-pct="p10"]').click()
  await page.waitForTimeout(1300)
  await expect(page.locator('#hero-value')).not.toHaveText('--')
  expect(external.filter(url => posthogPattern.test(url)).length).toBeLessThanOrEqual(1)
})
