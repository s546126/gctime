/* 仅由在线构建注入；预测引擎和离线包不依赖本模块。 */
;(function () {
  'use strict'

  const hosts = ['bracketboss2026.com', 'www.bracketboss2026.com', 'gc.bracketboss2026.com']
  if (location.protocol !== 'https:' || !hosts.includes(location.hostname) || navigator.onLine === false) return

  const slot = document.getElementById('gc-sponsor-slot')
  const i18n = window.GCI18n
  if (!slot || !i18n || slot.childElementCount) return

  const storageKey = 'gc_sponsor_last_shown'
  const interval = 24 * 60 * 60 * 1000
  const now = Date.now()
  try {
    const last = Number(localStorage.getItem(storageKey))
    if (Number.isFinite(last) && last > 0 && now - last < interval) {
      // 时钟回拨不造成反复展示；修正未来值，从本次访问重新计时。
      if (last > now) localStorage.setItem(storageKey, String(now))
      return
    }
    localStorage.setItem(storageKey, String(now))
  } catch {
    // 无法可靠频控时不展示；不影响预测、分享和离线功能。
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

  function render() {
    for (const [element, key] of messages) element.textContent = i18n.text(key)
  }
  function hide() {
    slot.hidden = true
    window.removeEventListener('gc:localechange', render)
    window.removeEventListener('offline', hide)
    window.removeEventListener('storage', syncFrequency)
  }
  function syncFrequency(event) {
    if (event.key === storageKey && Number(event.newValue) >= now) hide()
  }
  render()
  region.append(copy, actions)
  slot.appendChild(region)
  slot.hidden = false
  // 保留原生链接导航；不检测广告是否展示，也不解锁／限制任何功能。
  link.addEventListener('click', hide)
  link.addEventListener('auxclick', event => { if (event.button === 1) hide() })
  dismiss.addEventListener('click', hide)
  window.addEventListener('gc:localechange', render)
  window.addEventListener('offline', hide)
  window.addEventListener('storage', syncFrequency)
})()
