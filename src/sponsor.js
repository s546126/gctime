/* 仅由在线构建注入；预测引擎和离线包不依赖本模块。
   可调参数：
   - SHOW_DELAY_MS：进入页面后多久放上底部横幅。
   - DISMISS_MS：点击「关闭」后的隐藏时长。每次页面加载都会再显示，除非仍处在该窗口内。
   - AD_LOAD_TIMEOUT_MS：广告脚本或 iframe 未出现时，多久后收起横幅，避免留下空条。
   视口宽度 >= 768 只用 728×90；更窄只用 320×50。每次页面只注入一个单元。
   站点目前没有 CSP。若以后增加，需要允许 https://bauval.org 的 script-src 与 frame-src。 */
;(function () {
  'use strict'

  const hosts = ['bracketboss2026.com', 'www.bracketboss2026.com', 'gc.bracketboss2026.com']
  if (location.protocol !== 'https:' || !hosts.includes(location.hostname) || navigator.onLine === false) return

  const slot = document.getElementById('gc-sponsor-slot')
  const i18n = window.GCI18n
  if (!slot || !i18n || slot.childElementCount) return

  const storageKey = 'gc_sponsor_last_shown'
  const SHOW_DELAY_MS = 1000
  const DISMISS_MS = 3 * 60 * 1000
  const AD_LOAD_TIMEOUT_MS = 4000
  const DESKTOP_MIN_WIDTH = 768
  const units = {
    desktop: { src: 'https://bauval.org/22/6d1946abad3d3fdcc79373556a137876', width: 728, height: 90 },
    mobile: { src: 'https://bauval.org/22/d450c9cf5ef416c8ffc1907634e0d6e6', width: 320, height: 50 }
  }
  const now = Date.now()

  function unitForViewport() {
    const selected = (window.innerWidth || 0) >= DESKTOP_MIN_WIDTH ? units.desktop : units.mobile
    const slash = selected.src.lastIndexOf('/')
    return {
      src: selected.src,
      width: selected.width,
      height: selected.height,
      key: selected.src.slice(slash + 1)
    }
  }

  function dismissed(last) {
    return Number.isFinite(last) && last > 0 && now - last < DISMISS_MS
  }

  try {
    // 先确认本地存储可写。无法可靠记录关闭时间时不展示，避免关不掉。
    const raw = localStorage.getItem(storageKey)
    if (raw === null) {
      localStorage.setItem(storageKey, '0')
      localStorage.removeItem(storageKey)
    } else {
      localStorage.setItem(storageKey, raw)
    }
    const last = Number(raw)
    if (dismissed(last)) {
      // 时钟回拨不造成反复展示；修正未来值，从本次访问重新计时。
      if (last > now) localStorage.setItem(storageKey, String(now))
      return
    }
  } catch {
    return
  }

  const region = document.createElement('section')
  region.className = 'sponsor-entry'
  region.setAttribute('aria-labelledby', 'gc-sponsor-label')
  const toolbar = document.createElement('div')
  toolbar.className = 'sponsor-toolbar'
  const messages = []
  function message(tag, key, className, parent) {
    const element = document.createElement(tag)
    element.className = className
    messages.push([element, key])
    parent.appendChild(element)
    return element
  }
  const label = message('span', 'sponsor.label', 'sponsor-label', toolbar)
  label.id = 'gc-sponsor-label'
  const dismiss = message('button', 'sponsor.dismiss', 'sponsor-dismiss', toolbar)
  dismiss.id = 'gc-sponsor-dismiss'
  dismiss.type = 'button'
  const ad = document.createElement('div')
  ad.className = 'sponsor-ad'
  ad.id = 'gc-sponsor-ad'
  const privacy = message('p', 'sponsor.privacy', 'sponsor-privacy', region)
  privacy.id = 'gc-sponsor-privacy'
  message('p', 'sponsor.frequency', 'sponsor-frequency', region)

  let timer = 0
  let loadTimer = 0
  let observer = null
  let adObserver = null
  let restoreWrite = null
  let mounted = false

  function render() {
    for (const [element, key] of messages) element.textContent = i18n.text(key)
    reserve()
  }
  function reserve() {
    const height = slot.hidden ? 0 : Math.ceil(slot.getBoundingClientRect().height)
    document.documentElement.style.setProperty('--gc-sponsor-reserve', height + 'px')
  }
  function restoreDocumentWrite() {
    if (restoreWrite) restoreWrite()
    restoreWrite = null
  }
  function hide() {
    window.clearTimeout(timer)
    window.clearTimeout(loadTimer)
    restoreDocumentWrite()
    if (adObserver) adObserver.disconnect()
    adObserver = null
    ad.replaceChildren()
    slot.hidden = true
    reserve()
    window.removeEventListener('gc:localechange', render)
    window.removeEventListener('offline', hide)
    window.removeEventListener('resize', reserve)
    window.removeEventListener('storage', syncFrequency)
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', reserve)
    if (observer) observer.disconnect()
  }
  function syncFrequency(event) {
    if (event.key !== storageKey) return
    const value = Number(event.newValue)
    if (Number.isFinite(value) && value > 0 && (value >= now || now - value < DISMISS_MS)) hide()
  }
  function rememberDismiss() {
    try { localStorage.setItem(storageKey, String(Date.now())) } catch { /* 写失败也先关掉当前页。 */ }
    hide()
  }
  function adReady() {
    window.clearTimeout(loadTimer)
    restoreDocumentWrite()
    if (adObserver) adObserver.disconnect()
    adObserver = null
    reserve()
  }
  function mount(unit) {
    if (mounted || ad.querySelector('script, iframe')) return
    mounted = true
    slot.dataset.unit = unit.width >= 728 ? 'desktop' : 'mobile'
    const previousWrite = document.write
    const previousWriteln = document.writeln
    function writeIntoBanner(markup) {
      const fragment = document.createRange().createContextualFragment(String(markup))
      ad.appendChild(fragment)
    }
    document.write = writeIntoBanner
    document.writeln = writeIntoBanner
    restoreWrite = function () {
      if (document.write === writeIntoBanner) document.write = previousWrite
      if (document.writeln === writeIntoBanner) document.writeln = previousWriteln
    }
    // 紧挨着插入脚本之前设置全局配置。广告脚本会在该脚本旁边写入一个 iframe。
    window.atOptions = { key: unit.key, format: 'iframe', height: unit.height, width: unit.width, params: {} }
    const script = document.createElement('script')
    script.src = unit.src
    script.async = true
    script.addEventListener('error', hide)
    script.addEventListener('load', () => { if (ad.querySelector('iframe')) adReady() })
    ad.appendChild(script)
    if (typeof MutationObserver === 'function') {
      adObserver = new MutationObserver(() => { if (ad.querySelector('iframe')) adReady() })
      adObserver.observe(ad, { childList: true, subtree: true })
    }
    loadTimer = window.setTimeout(() => { if (!ad.querySelector('iframe')) hide() }, AD_LOAD_TIMEOUT_MS)
    if (ad.querySelector('iframe')) adReady()
  }
  function reveal() {
    if (navigator.onLine === false) return
    try {
      const last = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(last) && last > 0 && Date.now() - last < DISMISS_MS) return
    } catch {
      return
    }
    const unit = unitForViewport()
    slot.dataset.unit = unit.width >= 728 ? 'desktop' : 'mobile'
    slot.hidden = false
    reserve()
    mount(unit)
  }

  render()
  region.prepend(toolbar, ad)
  slot.appendChild(region)
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => reserve())
    observer.observe(slot)
  }
  // 不自动打开、不跳转；广告加载失败就收起横幅。关闭只隐藏，不解锁或限制预测。
  dismiss.addEventListener('click', rememberDismiss)
  window.addEventListener('gc:localechange', render)
  window.addEventListener('offline', hide)
  window.addEventListener('resize', reserve)
  window.addEventListener('storage', syncFrequency)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reserve)
  timer = window.setTimeout(reveal, SHOW_DELAY_MS)
})()
