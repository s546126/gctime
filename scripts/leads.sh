#!/usr/bin/env bash
# 列出免费个案评估表单收到的线索（Cloudflare D1：gctime-leads）。
# 需要本机 wrangler 已登录（npx wrangler login），账号对 D1 有读权限。
#
#   bash scripts/leads.sh                # 最近 50 条
#   bash scripts/leads.sh 200            # 最近 200 条
#   bash scripts/leads.sh --days 7       # 最近 7 天
#   bash scripts/leads.sh --count        # 按类别 / 出生国统计
#   bash scripts/leads.sh --json         # 原始 JSON，便于导出
#   bash scripts/leads.sh --delete 42    # 删除 id=42（用户要求删除时）
set -euo pipefail

DB=gctime-leads
COLUMNS="id, created_at, name, email, contact, category, country, priority_date, status, locale, source, substr(message, 1, 200) AS message"
limit=50
days=""
json=""
mode=list
delete_id=""

while [ $# -gt 0 ]; do
  case "$1" in
    --days) days="${2:?--days 需要天数}"; shift 2 ;;
    --count) mode=count; shift ;;
    --json) json="--json"; shift ;;
    --delete) mode=delete; delete_id="${2:?--delete 需要 id}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) limit="$1"; shift ;;
  esac
done

for value in "$limit" ${days:+"$days"} ${delete_id:+"$delete_id"}; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "参数必须是正整数：$value" >&2; exit 2; }
done

where=""
[ -n "$days" ] && where="WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-$days days')"

case "$mode" in
  list) sql="SELECT $COLUMNS FROM leads $where ORDER BY id DESC LIMIT $limit" ;;
  count) sql="SELECT category, country, CASE WHEN instr(source, 'utm_source=') > 0 THEN substr(source, instr(source, 'utm_source=') + 11) ELSE 'direct' END AS channel, COUNT(*) AS n FROM leads $where GROUP BY category, country, channel ORDER BY n DESC" ;;
  delete) sql="DELETE FROM leads WHERE id = $delete_id" ;;
esac

exec npx --yes wrangler@4 d1 execute "$DB" --remote $json --command "$sql"
