// POST /api/lead：免费个案评估表单。只在 Cloudflare Pages 上运行（GitHub Pages 镜像没有 Functions）。
// 数据写入 D1（绑定 LEADS，库 gctime-leads）；不存原始 IP，只存 HMAC(LEAD_SALT, IP)。
// 不调用任何第三方服务。表结构见 scripts/leads_schema.sql，读取见 scripts/leads.sh。

export const MAX_BODY_BYTES = 8 * 1024
export const MAX_MESSAGE = 1000
export const DAILY_LIMIT = 5
export const CATEGORIES = ['EB-1A', 'NIW', 'EB-2', 'EB-3', 'EB-5', 'unsure']
export const COUNTRIES = ['CN', 'IN', 'ROW', 'MX', 'PH']
export const STATUSES = ['h1b', 'f1', 'other_us', 'outside_us']
export const ALLOWED_ORIGINS = [
  'https://bracketboss2026.com',
  'https://www.bracketboss2026.com',
  'https://gc.bracketboss2026.com',
  'https://gctime.pages.dev'
]
// 未配置 LEAD_SALT 时的兜底，仍不可逆，但建议在 Pages 设置 secret。
const FALLBACK_SALT = 'gctime-lead-v1'

const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/
const PRIORITY_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

// 去掉控制字符，压缩首尾空白；超长返回 null 由调用方报错。
function clean(value, max, { multiline = false } = {}) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  let text = value.replace(multiline ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '').trim()
  if (multiline) text = text.replace(/\r\n?/g, '\n')
  return [...text].length > max ? null : text
}

function validDate(text) {
  const match = PRIORITY_DATE.exec(text)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  if (y < 1990 || y > 2100 || m < 1 || m > 12) return false
  if (match[3] === undefined) return true
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

// 纯函数：返回 { lead } 或 { error }。honeypot 单独判断（见 isBot）。
export function validateLead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'bad_request' }
  const name = clean(input.name, 100)
  if (name === null) return { error: 'invalid_name' }
  const email = clean(input.email, 254)
  if (!email || !EMAIL.test(email)) return { error: 'invalid_email' }
  const contact = clean(input.contact, 100)
  if (contact === null) return { error: 'invalid_contact' }
  if (!CATEGORIES.includes(input.category)) return { error: 'invalid_category' }
  if (!COUNTRIES.includes(input.country)) return { error: 'invalid_country' }
  const priorityDate = clean(input.priority_date, 10)
  if (priorityDate === null || (priorityDate && !validDate(priorityDate))) return { error: 'invalid_priority_date' }
  if (!STATUSES.includes(input.status)) return { error: 'invalid_status' }
  const message = clean(input.message, MAX_MESSAGE, { multiline: true })
  if (message === null) return { error: 'message_too_long' }
  if (input.consent !== true) return { error: 'consent_required' }
  const locale = clean(input.locale, 16)
  const source = clean(input.source, 200)
  return {
    lead: {
      name: name || null,
      email: email.toLowerCase(),
      contact: contact || null,
      category: input.category,
      country: input.country,
      priority_date: priorityDate || null,
      status: input.status,
      message: message || null,
      locale: locale && LOCALE.test(locale) ? locale : null,
      source: source && source.startsWith('/') && !source.startsWith('//') ? source : null,
      consent: 1
    }
  }
}

// 真人看不到 website 字段；有值就当作机器人。
export function isBot(input) {
  return Boolean(input && typeof input === 'object' && typeof input.website === 'string' && input.website.trim())
}

export async function hashIp(ip, salt) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(salt || FALLBACK_SALT),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip || 'unknown'))
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// 滚动 24 小时窗口内同一 IP 已成功提交的条数。
export function windowStart(now) {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
}

export async function handleLead(request, env, now = new Date()) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const origin = request.headers.get('Origin')
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden_origin' }, 403)
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415)
  }
  const declared = Number(request.headers.get('Content-Length'))
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  let raw
  try {
    raw = await request.text()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  // 机器人拿到与成功相同的回应，但什么都不写。
  if (isBot(input)) return json({ ok: true })
  const { lead, error } = validateLead(input)
  if (error) return json({ error }, 400)
  if (!env || !env.LEADS) return json({ error: 'unavailable' }, 503)
  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP'), env.LEAD_SALT)
  try {
    const recent = await env.LEADS.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at >= ?')
      .bind(ipHash, windowStart(now)).first()
    if (Number(recent && recent.n) >= DAILY_LIMIT) return json({ error: 'rate_limited' }, 429)
    await env.LEADS.prepare(
      'INSERT INTO leads (created_at, name, email, contact, category, country, priority_date, status, message, locale, source, consent, ip_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(now.toISOString(), lead.name, lead.email, lead.contact, lead.category, lead.country, lead.priority_date,
      lead.status, lead.message, lead.locale, lead.source, lead.consent, ipHash).run()
  } catch {
    return json({ error: 'unavailable' }, 503)
  }
  return json({ ok: true })
}

export const onRequestPost = context => handleLead(context.request, context.env)
export const onRequest = () => json({ error: 'method_not_allowed' }, 405)
