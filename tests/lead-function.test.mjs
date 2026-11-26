// node --test tests/lead-function.test.mjs —— /api/lead 的校验、honeypot、限流与体积上限（不需要 Cloudflare）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleLead, validateLead, isBot, hashIp, DAILY_LIMIT, MAX_BODY_BYTES, onRequest } from '../functions/api/lead.js'

const valid = {
  name: '张三', email: 'Test+GCTime@Example.com', contact: 'wechat_id', category: 'NIW', country: 'CN',
  priority_date: '2023-05-01', status: 'h1b', message: 'Hello\nworld', locale: 'zh-CN', source: '/zh/consult/',
  consent: true, website: ''
}

// 内存版 D1：只实现本函数用到的两条语句。
function fakeD1() {
  const rows = []
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              assert.match(sql, /^SELECT COUNT/)
              const [ipHash, since] = args
              return { n: rows.filter(row => row.ip_hash === ipHash && row.created_at >= since).length }
            },
            async run() {
              assert.match(sql, /^INSERT INTO leads/)
              const names = ['created_at', 'name', 'email', 'contact', 'category', 'country', 'priority_date', 'status',
                'message', 'locale', 'source', 'consent', 'ip_hash']
              rows.push(Object.fromEntries(names.map((key, i) => [key, args[i]])))
              return { success: true }
            }
          }
        }
      }
    }
  }
}

function post(body, { ip = '203.0.113.7', origin = 'https://bracketboss2026.com', type = 'application/json' } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip }
  if (origin) headers.Origin = origin
  return new Request('https://bracketboss2026.com/api/lead', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

const env = () => ({ LEADS: fakeD1(), LEAD_SALT: 'test-salt' })

test('valid lead is normalized and stored without the raw IP', async () => {
  const e = env()
  const res = await handleLead(post(valid), e, new Date('2026-11-26T00:00:00Z'))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(e.LEADS.rows.length, 1)
  const row = e.LEADS.rows[0]
  assert.equal(row.email, 'test+gctime@example.com')
  assert.equal(row.message, 'Hello\nworld')
  assert.equal(row.consent, 1)
  assert.equal(row.created_at, '2026-11-26T00:00:00.000Z')
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(row).includes('203.0.113.7'))
  assert.equal(row.ip_hash, await hashIp('203.0.113.7', 'test-salt'))
  assert.notEqual(row.ip_hash, await hashIp('203.0.113.7', 'other-salt'))
})

test('server-side validation rejects bad fields', () => {
  const cases = [
    [{ email: 'not-an-email' }, 'invalid_email'],
    [{ email: '' }, 'invalid_email'],
    [{ category: 'EB-4' }, 'invalid_category'],
    [{ country: 'US' }, 'invalid_country'],
    [{ status: 'citizen' }, 'invalid_status'],
    [{ priority_date: '2023-02-30' }, 'invalid_priority_date'],
    [{ priority_date: 'soon' }, 'invalid_priority_date'],
    [{ message: 'x'.repeat(1001) }, 'message_too_long'],
    [{ consent: false }, 'consent_required'],
    [{ consent: 'true' }, 'consent_required'],
    [{ name: 42 }, 'invalid_name'],
    [{ contact: 'x'.repeat(101) }, 'invalid_contact']
  ]
  for (const [patch, error] of cases) assert.equal(validateLead({ ...valid, ...patch }).error, error, JSON.stringify(patch))
  assert.equal(validateLead([]).error, 'bad_request')
  assert.equal(validateLead({ ...valid, message: 'x'.repeat(1000) }).lead.message.length, 1000)
  const minimal = validateLead({ email: 'a@b.co', category: 'unsure', country: 'ROW', status: 'outside_us', consent: true })
  assert.equal(minimal.lead.name, null)
  assert.equal(minimal.lead.priority_date, null)
  assert.equal(validateLead({ ...valid, priority_date: '2024-07' }).lead.priority_date, '2024-07')
  assert.equal(validateLead({ ...valid, source: 'https://evil.example/' }).lead.source, null)
  assert.equal(validateLead({ ...valid, locale: '<script>' }).lead.locale, null)
})

test('invalid submission returns a JSON error and stores nothing', async () => {
  const e = env()
  const res = await handleLead(post({ ...valid, email: 'nope' }), e)
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'invalid_email' })
  assert.equal(e.LEADS.rows.length, 0)
})

test('honeypot looks successful but stores nothing', async () => {
  assert.equal(isBot({ website: 'http://spam.example' }), true)
  assert.equal(isBot({ website: '  ' }), false)
  const e = env()
  const res = await handleLead(post({ ...valid, website: 'http://spam.example' }), e)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(e.LEADS.rows.length, 0)
})

test('rate limit: 5 per IP per rolling day', async () => {
  const e = env()
  const t0 = new Date('2026-11-26T10:00:00Z')
  for (let i = 0; i < DAILY_LIMIT; i++) {
    const res = await handleLead(post(valid), e, new Date(t0.getTime() + i * 60000))
    assert.equal(res.status, 200, `submission ${i + 1}`)
  }
  const blocked = await handleLead(post(valid), e, new Date(t0.getTime() + 3600000))
  assert.equal(blocked.status, 429)
  assert.deepEqual(await blocked.json(), { error: 'rate_limited' })
  const otherIp = await handleLead(post(valid, { ip: '198.51.100.9' }), e, new Date(t0.getTime() + 3600000))
  assert.equal(otherIp.status, 200)
  const nextDay = await handleLead(post(valid), e, new Date(t0.getTime() + 25 * 3600000))
  assert.equal(nextDay.status, 200)
  assert.equal(e.LEADS.rows.length, DAILY_LIMIT + 2)
})

test('body size, content type, origin and method are enforced', async () => {
  const e = env()
  const big = await handleLead(post({ ...valid, message: 'x'.repeat(MAX_BODY_BYTES) }), e)
  assert.equal(big.status, 413)
  assert.equal((await handleLead(post('email=a', { type: 'application/x-www-form-urlencoded' }), e)).status, 415)
  assert.equal((await handleLead(post('{not json'), e)).status, 400)
  assert.equal((await handleLead(post(valid, { origin: 'https://evil.example' }), e)).status, 403)
  assert.equal((await handleLead(post(valid, { origin: null }), e)).status, 200)
  assert.equal((await handleLead(new Request('https://x/api/lead'), e)).status, 405)
  assert.equal(onRequest().status, 405)
  const missing = await handleLead(post(valid), {})
  assert.equal(missing.status, 503)
  assert.deepEqual(await missing.json(), { error: 'unavailable' })
  assert.equal(e.LEADS.rows.length, 1)
})
