-- GC Time 咨询线索（Cloudflare D1：gctime-leads，Pages 绑定名 LEADS）。
-- 应用：npx wrangler d1 execute gctime-leads --remote --file scripts/leads_schema.sql
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,            -- ISO 8601 UTC
  name TEXT,
  email TEXT NOT NULL,
  contact TEXT,                        -- 微信或电话
  category TEXT NOT NULL,              -- EB-1A / NIW / EB-2 / EB-3 / EB-5 / unsure
  country TEXT NOT NULL,               -- CN / IN / ROW / MX / PH
  priority_date TEXT,                  -- YYYY-MM-DD 或 YYYY-MM
  status TEXT NOT NULL,                -- h1b / f1 / other_us / outside_us
  message TEXT,
  locale TEXT,
  source TEXT,
  consent INTEGER NOT NULL CHECK (consent = 1),
  ip_hash TEXT NOT NULL                -- HMAC-SHA256(LEAD_SALT, IP)，不存原始 IP
);
CREATE INDEX IF NOT EXISTS leads_ip_time ON leads (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS leads_time ON leads (created_at);
