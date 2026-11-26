/* 匿名使用统计（PostHog）。仅由在线构建注入应用页和静态落地页；离线包和本地开发不包含本文件。
   - 只在 bracketboss2026.com / www. / gc. 的 HTTPS 页面加载 PostHog；其它主机、浏览器发送
     Do Not Track、或测试设置了 window.__GC_ANALYTICS_MOCK 时都不发任何网络请求。
   - 与 Bracket Boss 共用同一个 PostHog 项目：每个事件都带 app=gctime，可按 app 和 $host 区分。
   - 不发送个人信息：不采集姓名、邮箱、电话、留言或具体优先日；URL 的 # 片段（分享链接里含优先日）
     和非 utm 查询参数在发送前删除。自动采集和录屏关闭。
   - 被拦截或加载失败时只是没有统计，绝不影响预测、表单或广告横幅。
   页面代码只通过 window.GCAnalytics.capture(event, props) 调用，并且总是可选调用。 */
;(function () {
  'use strict'

  const TOKEN = 'phc_vkVQhLxCASV7X6tWN9M3z4MBAGUcYTUaoCnEZ3tWSQDR'
  const API_HOST = 'https://us.i.posthog.com'
  const APP = 'gctime'
  const hosts = ['bracketboss2026.com', 'www.bracketboss2026.com', 'gc.bracketboss2026.com']
  const keepQuery = /^(utm_(source|medium|campaign|term|content)|lang|ref)$/
  // 这些键即使被误传也不发送。
  const blocked = /^(name|email|contact|phone|wechat|message|priority_?date|pd)$/i

  if (window.GCAnalytics) return

  // 只保留来源、路径和允许的查询参数；不保留 # 片段。
  function cleanUrl(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value
    try {
      const url = new URL(value)
      const kept = new URLSearchParams()
      url.searchParams.forEach((v, k) => { if (keepQuery.test(k)) kept.append(k, v) })
      const query = kept.toString()
      return url.origin + url.pathname + (query ? '?' + query : '')
    } catch {
      return ''
    }
  }
  function cleanProps(props) {
    const out = {}
    if (!props || typeof props !== 'object') return out
    for (const key of Object.keys(props)) {
      if (blocked.test(key)) continue
      const value = props[key]
      out[key] = typeof value === 'string' ? cleanUrl(value) : value
    }
    return out
  }
  // PostHog 发送前的最后一道过滤：整理所有 URL 字段，补上 app。
  function beforeSend(event) {
    if (!event) return event
    for (const field of ['properties', '$set', '$set_once']) {
      if (event[field] && typeof event[field] === 'object') event[field] = cleanProps(event[field])
    }
    event.properties = Object.assign(event.properties || {}, { app: APP })
    return event
  }

  const mock = window.__GC_ANALYTICS_MOCK
  const dnt = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(v => v === '1' || v === 'yes')
  const live = !mock && location.protocol === 'https:' && hosts.includes(location.hostname) && !dnt
  let send = function () {}

  if (Array.isArray(mock)) {
    // 测试接缝：记录事件，不加载脚本、不发请求。
    send = function (event, props) { mock.push({ event, properties: Object.assign(cleanProps(props), { app: APP }) }) }
  } else if (live) {
    try {
      // 官方 array.js 启动片段的精简版：调用先压入 posthog 数组，脚本加载后按顺序回放。
      const ph = window.posthog = window.posthog || []
      if (!ph.__SV) {
        ph._i = []
        ph.people = ph.people || []
        ph.init = function (token, config, name) {
          const methods = ['capture', 'register', 'register_once', 'unregister', 'opt_out_capturing', 'opt_in_capturing',
            'set_config', 'reset', 'get_distinct_id', 'getFeatureFlag', 'isFeatureEnabled', 'onFeatureFlags', 'reloadFeatureFlags']
          for (const method of methods) {
            if (typeof ph[method] !== 'function') ph[method] = function () { ph.push([method].concat(Array.prototype.slice.call(arguments))) }
          }
          ph._i.push([token, config, name])
        }
        ph.__SV = 1
        const script = document.createElement('script')
        script.async = true
        script.crossOrigin = 'anonymous'
        script.src = API_HOST + '/static/array.js'
        ;(document.head || document.documentElement).appendChild(script)
      }
      ph.init(TOKEN, {
        api_host: API_HOST,
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        // 与 Bracket Boss 共用项目：项目级开启的热图、死点击也不在本站采集。
        enable_heatmaps: false,
        capture_dead_clicks: false,
        respect_dnt: true,
        before_send: beforeSend
      })
      ph.register({ app: APP })
      send = function (event, props, beacon) {
        try {
          const clean = cleanProps(props)
          if (beacon) window.posthog.capture(event, clean, { transport: 'sendBeacon' })
          else window.posthog.capture(event, clean)
        } catch { /* 统计失败不影响页面。 */ }
      }
    } catch {
      send = function () {}
    }
  }

  // 预测事件去抖：拖动滑杆或连续点按只记最后一次；离开页面或点评估入口前先补发。
  let pending = null
  let pendingTimer = 0
  function flush(beacon) {
    window.clearTimeout(pendingTimer)
    if (!pending) return
    const item = pending
    pending = null
    try { send(item[0], item[1](), beacon) } catch { /* 读取状态失败就放弃这次。 */ }
  }
  const api = {
    // props 可以是对象，或在发送时才读取状态的函数。
    capture(event, props, options) {
      try {
        if (options && options.beacon) flush(true)
        send(event, typeof props === 'function' ? props() : props, options && options.beacon)
      } catch { /* 永不抛出。 */ }
    },
    debounce(event, readProps, wait) {
      try {
        pending = [event, readProps]
        window.clearTimeout(pendingTimer)
        pendingTimer = window.setTimeout(() => flush(false), wait || 1000)
      } catch { /* 永不抛出。 */ }
    },
    flush() { flush(true) },
    live,
    cleanUrl
  }
  window.GCAnalytics = api
  window.addEventListener('pagehide', () => flush(true))

  function locale() {
    const query = new URLSearchParams(location.search).get('lang')
    return query && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(query) ? query : document.documentElement.lang
  }
  function sameOriginReferrer() {
    try {
      const r = document.referrer && new URL(document.referrer)
      if (r && r.origin === location.origin) return r.pathname
    } catch { /* 忽略 */ }
    return ''
  }

  // 评估入口：应用、排期页和汇总页的链接都带 data-gc-cta。点击后会离开页面，用 sendBeacon 发送。
  document.addEventListener('click', event => {
    const link = event.target && event.target.closest && event.target.closest('a[data-gc-cta]')
    if (!link) return
    api.capture('consult_cta_click', { placement: link.dataset.gcCta, page: location.pathname, locale: locale() }, { beacon: true })
  }, true)

  function onReady() {
    if (document.getElementById('consult-form')) {
      api.capture('consult_view', { page: location.pathname, locale: locale(), source: sameOriginReferrer() })
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady)
  else onReady()
})()
