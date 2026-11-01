/* 仅由在线构建注入；预测引擎和离线包不依赖本模块。
   可调参数：
   - SHOW_DELAY_MS：进入页面后多久显示底部横幅。
   - DISMISS_MS：点击「关闭」后的隐藏时长。每次页面加载都会再显示，除非仍处在该窗口内。
   点击赞助链接只收起当前这一次浏览，不写入更长的隐藏时间。 */
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
  const now = Date.now()

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
  region.setAttribute('aria-labelledby', 'gc-sponsor-title')
  const copy = document.createElement('div')
  copy.className = 'sponsor-copy'
  const messages = []
  function message(tag, key, className, parent) {
    const element = document.createElement(tag)
    element.className = className
    messages.push([element, key])
    parent.appendChild(element)
    return element
  }
  message('span', 'sponsor.label', 'sponsor-label', copy)
  message('h2', 'sponsor.title', 'sponsor-title', copy).id = 'gc-sponsor-title'
  message('p', 'sponsor.description', 'sponsor-description', copy)
  message('p', 'sponsor.privacy', 'sponsor-privacy', copy).id = 'gc-sponsor-privacy'
  message('p', 'sponsor.frequency', 'sponsor-frequency', copy)
  const actions = document.createElement('div')
  actions.className = 'sponsor-actions'
  const link = message('a', 'sponsor.open', 'sponsor-link', actions)
  link.id = 'gc-sponsor-link'
  link.href = 'https://www.effectivecpmnetwork.com/bekmfyfbe?key=9b81ed84d79cc96e111986555f43381f'
  link.target = '_blank'
  link.rel = 'sponsored noopener noreferrer'
  link.referrerPolicy = 'no-referrer'
  link.setAttribute('aria-describedby', 'gc-sponsor-privacy')
  const dismiss = message('button', 'sponsor.dismiss', 'sponsor-dismiss', actions)
  dismiss.id = 'gc-sponsor-dismiss'
  dismiss.type = 'button'

  let timer = 0
  let observer = null
  function render() {
    for (const [element, key] of messages) element.textContent = i18n.text(key)
    reserve()
  }
  function reserve() {
    const height = slot.hidden ? 0 : Math.ceil(slot.getBoundingClientRect().height)
    document.documentElement.style.setProperty('--gc-sponsor-reserve', height + 'px')
  }
  function hide() {
    window.clearTimeout(timer)
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
  function reveal() {
    if (navigator.onLine === false) return
    try {
      const last = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(last) && last > 0 && Date.now() - last < DISMISS_MS) return
    } catch {
      return
    }
    slot.hidden = false
    reserve()
  }
  function rememberDismiss() {
    try { localStorage.setItem(storageKey, String(Date.now())) } catch { /* 写失败也先关掉当前页。 */ }
    hide()
  }

  render()
  region.append(copy, actions)
  slot.appendChild(region)
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => reserve())
    observer.observe(slot)
  }
  // 保留原生链接导航；不检测广告是否展示，也不解锁／限制任何功能。
  link.addEventListener('click', hide)
  link.addEventListener('auxclick', event => { if (event.button === 1) hide() })
  dismiss.addEventListener('click', rememberDismiss)
  window.addEventListener('gc:localechange', render)
  window.addEventListener('offline', hide)
  window.addEventListener('resize', reserve)
  window.addEventListener('storage', syncFrequency)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reserve)
  timer = window.setTimeout(reveal, SHOW_DELAY_MS)
})()
