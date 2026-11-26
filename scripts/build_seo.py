#!/usr/bin/env python3
"""Crawlable pages for search engines, generated from data/visa_bulletin_history.json.

The predictor itself is a JS app, so search engines see almost no text on it. These pages are plain
HTML (no app scripts): one page per category × country with the latest Visa Bulletin cutoffs (Chart A
Final Action / Chart B Dates for Filing), month-over-month movement and a 24-month table, plus hubs,
sitemap.xml, robots.txt and an Atom feed. Every number comes from the bulletin history; the pages make
no forecast of their own and send readers to the predictor for that. Online builds add the same
bottom sponsor banner as the app (src/sponsor.js, which only runs on the production hosts). Online builds
also load src/analytics.js on every page, including /consult/; it only loads PostHog on the production hosts.
"""

import html
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://bracketboss2026.com"
NAME = "GC Time"

CATEGORIES = [  # (page slug, data key, English name, Chinese name)
    ("eb-1", "EB-1A", "EB-1", "EB-1 杰出人才"),
    ("eb-2", "EB-2", "EB-2", "EB-2 高学历 / NIW"),
    ("eb-3", "EB-3", "EB-3", "EB-3 专业人才 / 技术工人"),
    ("eb-4", "EB-4", "EB-4", "EB-4 特殊移民"),
    ("eb-5", "EB-5", "EB-5 (unreserved)", "EB-5 投资移民（非预留）"),
]
COUNTRIES = [  # (slug, data key, English name, Chinese name)
    ("china", "CN", "China (mainland-born)", "中国大陆"),
    ("india", "IN", "India", "印度"),
    ("row", "ROW", "Rest of World (All Chargeability)", "其他国家"),
    ("mexico", "MX", "Mexico", "墨西哥"),
    ("philippines", "PH", "Philippines", "菲律宾"),
]
ZH_COUNTRIES = {"CN"}       # Chinese pages only where the Chinese-speaking audience is

TEXT = {
    "en": {
        "lang": "en", "hub_path": "/visa-bulletin/", "current": "Current", "unavailable": "Unavailable",
        "hub_title": "Visa Bulletin Tracker: EB-1 to EB-5 Priority Dates by Country",
        "hub_desc": "Latest employment-based Visa Bulletin cutoffs (Final Action and Dates for Filing) for EB-1, EB-2, EB-3, EB-4 and EB-5 in China, India, Mexico, the Philippines and the rest of the world, with month-over-month movement.",
        "page_title": "{cat} {country} Priority Date: Visa Bulletin History and Forecast",
        "page_desc": "{cat} {country} cutoff in the {month} Visa Bulletin: Final Action {a}, Dates for Filing {b}. Monthly history, 12-month movement and a free tool to estimate when your priority date becomes current.",
        "h1": "{cat} {country}: Visa Bulletin cutoff dates",
        "latest": "Latest bulletin: {month}",
        "chart_a": "Final Action Date (Chart A)", "chart_b": "Dates for Filing (Chart B)",
        "change": "Change from previous month", "moved": "{days} days forward", "back": "{days} days backward",
        "same": "No change", "year": "Movement over the last 12 months (Chart A)",
        "history": "Monthly history", "month": "Bulletin", "cta": "Estimate when your priority date will be current",
        "cta_note": "The free predictor models visa supply and the queue ahead of your priority date, with optimistic, median and conservative scenarios.",
        "faq": "Questions",
        "q1": "What is the difference between Chart A and Chart B?",
        "a1": "Chart A (Final Action Dates) decides when a green card can be approved. Chart B (Dates for Filing) decides when you may file Form I-485 early, if USCIS says that chart can be used that month. Each month USCIS announces which chart applies to adjustment of status.",
        "q2": "What does “Current” mean?",
        "a2": "“C” means there is no backlog: any priority date qualifies that month.",
        "q3": "Where do these dates come from?",
        "a3": "From the monthly U.S. Department of State Visa Bulletin, updated automatically after each release. This page does not change official dates; always confirm with the official bulletin and USCIS.",
        "other": "Other categories and countries", "updated": "Data updated through the {month} Visa Bulletin.",
        "disclaimer": "Not legal advice. Dates are copied from the official Visa Bulletin; forecasts are estimates.",
        "all": "All categories", "feed": "Visa Bulletin updates",
        "consult_path": "/consult/", "consult_cta": "Want a faster route? Free EB-1A / NIW case review",
        "consult_cta_note": "Waiting in EB-2 or EB-3? See whether a self-petitioned EB-1A or NIW could be faster than your current queue. No outcome is promised.",
        "consult_cta_link": "Request a free review",
    },
    "zh": {
        "lang": "zh-CN", "hub_path": "/zh/visa-bulletin/", "current": "C（无排期）", "unavailable": "U（不可用）",
        "hub_title": "美国职业移民排期表：EB-1 至 EB-5 中国排期一览",
        "hub_desc": "最新签证公告（Visa Bulletin）中国大陆 EB-1、EB-2、EB-3、EB-4、EB-5 的表A（最终裁决）与表B（递交申请）排期，以及每月进退。",
        "page_title": "{cat}中国排期：签证公告历史与排期预测",
        "page_desc": "{month} 签证公告 {cat}中国大陆：表A {a}，表B {b}。逐月历史、近 12 个月进度，以及免费的排期到期时间预测工具。",
        "h1": "{cat}中国大陆：签证公告排期",
        "latest": "最新公告：{month}",
        "chart_a": "最终裁决日期（表A）", "chart_b": "递交申请日期（表B）",
        "change": "较上月", "moved": "前进 {days} 天", "back": "倒退 {days} 天", "same": "不变",
        "year": "近 12 个月进度（表A）", "history": "逐月历史", "month": "公告月份",
        "cta": "预测你的优先日什么时候到期",
        "cta_note": "免费工具按签证供给和你前面的排队人数推算，给出乐观、中位、保守三种情景。",
        "faq": "常见问题",
        "q1": "表A 和表B 有什么区别？",
        "a1": "表A（Final Action Dates）决定绿卡何时可以批准；表B（Dates for Filing）决定何时可以提前递交 I-485，但前提是 USCIS 宣布当月可用表B。每月 USCIS 会公布调整身份用哪张表。",
        "q2": "“C” 是什么意思？",
        "a2": "C（Current）表示当月没有排期，任何优先日都可以。",
        "q3": "数据从哪里来？",
        "a3": "来自美国国务院每月发布的签证公告，公告发布后自动更新。本页不修改官方日期，请以官方公告和 USCIS 为准。",
        "other": "其他类别", "updated": "数据已更新至 {month} 签证公告。",
        "disclaimer": "不构成法律意见。日期摘自官方签证公告，预测仅为估算。",
        "all": "全部类别", "feed": "排期更新订阅",
        "consult_path": "/zh/consult/", "consult_cta": "想走更快的路？免费 EB-1A / NIW 个案评估",
        "consult_cta_note": "正在排 EB-2 或 EB-3？看看自主申请的 EB-1A 或 NIW 是否可能比现在的队列更快。不承诺任何结果。",
        "consult_cta_link": "申请免费评估",
    },
}


def esc(value):
    return html.escape(str(value), quote=True)


def month_label(month, lang):
    year, mon = map(int, month.split("-"))
    if lang == "zh":
        return f"{year} 年 {mon} 月"
    return date(year, mon, 1).strftime("%B %Y")


def show(value, t):
    if value == "C":
        return t["current"]
    if value in (None, "", "U"):
        return t["unavailable"]
    return value


def days_between(old, new):
    try:
        return (date.fromisoformat(new) - date.fromisoformat(old)).days
    except (TypeError, ValueError):
        return None


def movement(old, new, t):
    if old == new:
        return t["same"]
    days = days_between(old, new)
    if days is None:
        return f"{show(old, t)} → {show(new, t)}"
    return t["moved"].format(days=days) if days > 0 else t["back"].format(days=-days)


def series(monthly, key, chart):
    return monthly.get(f"{key}|{chart}") or {}


def page_path(lang, cat, country):
    if lang == "zh":
        return f"/zh/{cat[0]}-{country[0]}/"
    return f"/visa-bulletin/{cat[0]}-{country[0]}/"


def page_label(lang, cat, country):
    return f"{cat[3] if lang == 'zh' else cat[2]} {country[3] if lang == 'zh' else country[2]}"


def countries_for(lang):
    return [c for c in COUNTRIES if lang == "en" or c[1] in ZH_COUNTRIES]


STYLE = """
:root{color-scheme:light;--ink:#14211b;--muted:#53625a;--line:#d8e0db;--bg:#f6f8f6;--card:#fff;--accent:#0f6b47}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--bg);padding-bottom:var(--gc-sponsor-reserve,0)}
main{max-width:880px;margin:0 auto;padding:24px 18px 64px}header.site{max-width:880px;margin:0 auto;padding:14px 18px;display:flex;justify-content:space-between;gap:12px;align-items:center}
header.site a{color:var(--ink);font-weight:700;text-decoration:none}nav.lang a{margin-left:12px;color:var(--muted)}
h1{font-size:1.75rem;line-height:1.25;margin:.3em 0 .2em}h2{font-size:1.2rem;margin:1.6em 0 .5em}p{margin:.5em 0}.muted{color:var(--muted);font-size:.92rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:16px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card b{display:block;font-size:1.45rem;margin-top:2px}.card span{color:var(--muted);font-size:.9rem}
.consult-cta{margin:24px 0;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:12px}
.consult-cta h2{margin:0 0 .3em;font-size:1.05rem}.consult-cta p{margin:0 0 .4em}.consult-cta a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font-weight:700}
.cta{display:inline-block;margin:18px 0 4px;padding:12px 18px;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none;min-height:44px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}th{background:#eef3f0;font-size:.9rem}
.links{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.links a{display:inline-block;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);text-decoration:none;font-size:.92rem}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0}summary{font-weight:700;cursor:pointer}
.consult-form{display:grid;gap:6px;max-width:560px}.consult-form[hidden]{display:none}.consult-form label{font-weight:600;margin-top:8px}
.consult-form input,.consult-form select,.consult-form textarea{font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);width:100%}
.consult-form input:focus-visible,.consult-form select:focus-visible,.consult-form textarea:focus-visible,.consult-form button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.consult-form .consent{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin-top:14px}.consult-form .consent input{width:22px;min-height:22px;height:22px;flex:none;margin-top:2px}
.consult-form button{margin-top:14px;min-height:44px;padding:10px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer;justify-self:start}
.consult-form button:active{transform:scale(.97)}.consult-form button:disabled{opacity:.6;cursor:progress}
.consult-form .muted{margin:0}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.consult-status{min-height:1.6em;font-weight:600}.consult-status:empty{display:none}.privacy{padding-inline-start:1.2em;color:var(--muted);font-size:.92rem}
@media (prefers-reduced-motion:reduce){.consult-form button:active{transform:none}}
footer{max-width:880px;margin:0 auto;padding:0 18px 40px;color:var(--muted);font-size:.85rem}
#gc-sponsor-slot{--gc-ad-width:320px;--gc-ad-height:50px}#gc-sponsor-slot[data-unit=desktop]{--gc-ad-width:728px;--gc-ad-height:90px}#gc-sponsor-slot[hidden]{display:none}
#gc-sponsor-slot:not([hidden]){position:fixed;z-index:15;inset-inline:0;bottom:0;background:#17271f;color:#f2f6f3;border-top:3px solid #e2c065;padding:8px 12px calc(8px + env(safe-area-inset-bottom))}
.sponsor-entry{display:flex;flex-direction:column;gap:6px;width:min(1600px,100%);margin:0 auto}.sponsor-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sponsor-label{padding:2px 8px;border-radius:999px;background:#e2c065;color:#3a2f12;font-size:11px;font-weight:700}.sponsor-ad{width:min(100%,var(--gc-ad-width));height:var(--gc-ad-height);margin-inline:auto;overflow:hidden}
.sponsor-ad iframe{display:block;width:var(--gc-ad-width);max-width:100%;height:var(--gc-ad-height);border:0}.sponsor-privacy,.sponsor-frequency{margin:0;color:#c9d6cf;font-size:11px;line-height:1.4}
#gc-sponsor-slot .sponsor-dismiss{min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid #ffffff55;background:transparent;color:inherit;font-size:13px;font-weight:700;cursor:pointer}
"""


def sponsor_bits(lang, sponsor_src, catalogs):
    """The app's banner script with a minimal GCI18n for these static pages."""
    if not sponsor_src:
        return ""
    messages = catalogs["en" if lang == "en" and "en" in catalogs else "zh-CN"]
    stub = json.dumps({k: v for k, v in messages.items() if k.startswith("sponsor.")}, ensure_ascii=False)
    return ('<div id="gc-sponsor-slot" hidden></div>\n'
            f'<script>window.GCI18n={{text:function(k){{return ({stub})[k]||""}}}};</script>\n'
            f'<script src="{sponsor_src}" defer></script>\n')


def layout(lang, title, desc, path, body, jsonld, alternates, sponsor, other_path=None, analytics=""):
    t = TEXT[lang]
    alt = "".join(f'<link rel="alternate" hreflang="{esc(h)}" href="{ORIGIN}{esc(p)}">\n' for h, p in alternates)
    other = TEXT["zh" if lang == "en" else "en"]
    return f"""<!DOCTYPE html>
<html lang="{t['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} | {NAME}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{ORIGIN}{esc(path)}">
{alt}<meta property="og:type" content="article">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{ORIGIN}{esc(path)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="{esc(t['feed'])}" href="/feed.xml">
<style>{STYLE}</style>
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
{analytics}</head>
<body>
<header class="site"><a href="/">{NAME}</a><nav class="lang"><a href="{t['hub_path']}">{esc(t['all'])}</a><a href="{other_path or other['hub_path']}" hreflang="{other['lang']}">{'中文' if lang == 'en' else 'English'}</a></nav></header>
<main>
{body}
</main>
<footer><p>{esc(t['disclaimer'])}</p></footer>
{sponsor}</body>
</html>
"""


def faq_block(t):
    items = [(t["q1"], t["a1"]), (t["q2"], t["a2"]), (t["q3"], t["a3"])]
    body = f"<h2>{esc(t['faq'])}</h2>" + "".join(
        f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in items)
    ld = {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in items]}
    return body, ld


def consult_block(t, placement):
    """Quiet link from every bulletin page to the free case review form. placement: landing | hub (analytics)."""
    return (f'<section class="consult-cta"><h2>{esc(t["consult_cta"])}</h2><p class="muted">{esc(t["consult_cta_note"])}</p>'
            f'<a href="{t["consult_path"]}" data-gc-cta="{placement}">{esc(t["consult_cta_link"])} →</a></section>')


def analytics_tag(analytics_src):
    """Anonymous usage analytics (src/analytics.js); the script itself only loads PostHog on the production hosts."""
    return f'<script src="{esc(analytics_src)}" defer></script>\n' if analytics_src else ""


def build_page(lang, cat, country, monthly, sponsor, analytics=""):
    t = TEXT[lang]
    key = f"{cat[1]}|{country[1]}"
    a_hist, b_hist = series(monthly, key, "A"), series(monthly, key, "B")
    months = sorted(set(a_hist) | set(b_hist))
    if not months:
        return None
    last = months[-1]
    prev = months[-2] if len(months) > 1 else None
    a, b = a_hist.get(last), b_hist.get(last)
    label = page_label(lang, cat, country)
    cat_name = cat[3] if lang == "zh" else cat[2]
    country_name = country[3] if lang == "zh" else country[2]
    title = t["page_title"].format(cat=cat_name, country=country_name)
    desc = t["page_desc"].format(cat=cat_name, country=country_name, month=month_label(last, lang),
                                 a=show(a, t), b=show(b, t))
    year_ago = next((m for m in reversed(months) if m <= f"{int(last[:4]) - 1}{last[4:]}"), None)
    year_move = movement(a_hist.get(year_ago), a, t) if year_ago and a_hist.get(year_ago) else "—"
    cards = (f'<div class="cards">'
             f'<div class="card"><span>{esc(t["chart_a"])}</span><b>{esc(show(a, t))}</b>'
             f'<span>{esc(t["change"])}: {esc(movement(a_hist.get(prev), a, t) if prev else "—")}</span></div>'
             f'<div class="card"><span>{esc(t["chart_b"])}</span><b>{esc(show(b, t))}</b>'
             f'<span>{esc(t["change"])}: {esc(movement(b_hist.get(prev), b, t) if prev else "—")}</span></div>'
             f'<div class="card"><span>{esc(t["year"])}</span><b>{esc(year_move)}</b></div></div>')
    rows = "".join(f"<tr><td>{esc(month_label(m, lang))}</td><td>{esc(show(a_hist.get(m), t))}</td>"
                   f"<td>{esc(show(b_hist.get(m), t))}</td></tr>" for m in reversed(months[-24:]))
    table = (f"<h2>{esc(t['history'])}</h2><table><thead><tr><th>{esc(t['month'])}</th><th>{esc(t['chart_a'])}</th>"
             f"<th>{esc(t['chart_b'])}</th></tr></thead><tbody>{rows}</tbody></table>")
    faq, faq_ld = faq_block(t)
    links = "".join(f'<li><a href="{page_path(lang, c, k)}">{esc(page_label(lang, c, k))}</a></li>'
                    for c in CATEGORIES for k in countries_for(lang) if (c, k) != (cat, country))
    path = page_path(lang, cat, country)
    body = (f"<h1>{esc(t['h1'].format(cat=cat_name, country=country_name))}</h1>"
            f'<p class="muted">{esc(t["latest"].format(month=month_label(last, lang)))}</p>{cards}'
            f'<a class="cta" href="/">{esc(t["cta"])}</a><p class="muted">{esc(t["cta_note"])}</p>'
            f"{table}{consult_block(t, 'landing')}{faq}<h2>{esc(t['other'])}</h2><ul class=\"links\">{links}</ul>"
            f'<p class="muted">{esc(t["updated"].format(month=month_label(last, lang)))}</p>')
    alternates = [("en", page_path("en", cat, country))]
    if country[1] in ZH_COUNTRIES:
        alternates.append(("zh-CN", page_path("zh", cat, country)))
    alternates.append(("x-default", page_path("en", cat, country)))
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "name": title, "description": desc, "url": ORIGIN + path, "inLanguage": t["lang"],
         "dateModified": last + "-01"},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": NAME, "item": ORIGIN + "/"},
            {"@type": "ListItem", "position": 2, "name": t["all"], "item": ORIGIN + t["hub_path"]},
            {"@type": "ListItem", "position": 3, "name": label, "item": ORIGIN + path}]},
        faq_ld]}
    return path, last, layout(lang, title, desc, path, body, jsonld, alternates, sponsor, analytics=analytics)


def build_hub(lang, monthly, sponsor, analytics=""):
    t = TEXT[lang]
    rows, latest = [], "0000-00"
    for cat in CATEGORIES:
        for country in countries_for(lang):
            key = f"{cat[1]}|{country[1]}"
            a_hist, b_hist = series(monthly, key, "A"), series(monthly, key, "B")
            months = sorted(set(a_hist) | set(b_hist))
            if not months:
                continue
            last, prev = months[-1], (months[-2] if len(months) > 1 else None)
            latest = max(latest, last)
            rows.append(f'<tr><td><a href="{page_path(lang, cat, country)}">{esc(page_label(lang, cat, country))}</a></td>'
                        f"<td>{esc(show(a_hist.get(last), t))}</td><td>{esc(show(b_hist.get(last), t))}</td>"
                        f"<td>{esc(movement(a_hist.get(prev), a_hist.get(last), t) if prev else '—')}</td></tr>")
    body = (f"<h1>{esc(t['hub_title'])}</h1><p class=\"muted\">{esc(t['latest'].format(month=month_label(latest, lang)))}</p>"
            f"<p>{esc(t['hub_desc'])}</p><a class=\"cta\" href=\"/\">{esc(t['cta'])}</a>"
            f"<h2>{esc(t['all'])}</h2><table><thead><tr><th></th><th>{esc(t['chart_a'])}</th><th>{esc(t['chart_b'])}</th>"
            f"<th>{esc(t['change'])}</th></tr></thead><tbody>{''.join(rows)}</tbody></table>")
    faq, faq_ld = faq_block(t)
    body += consult_block(t, "hub") + faq
    path = t["hub_path"]
    alternates = [("en", TEXT["en"]["hub_path"]), ("zh-CN", TEXT["zh"]["hub_path"]), ("x-default", TEXT["en"]["hub_path"])]
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "name": t["hub_title"], "description": t["hub_desc"], "url": ORIGIN + path,
         "inLanguage": t["lang"], "dateModified": latest + "-01"}, faq_ld]}
    return path, latest, layout(lang, t["hub_title"], t["hub_desc"], path, body, jsonld, alternates, sponsor, analytics=analytics)


CONSULT = {
    "en": {
        "title": "Free EB-1A / NIW Case Review: Could a Faster Green Card Route Work for You?",
        "desc": "Free case review for EB-1A, NIW, EB-2, EB-3 and EB-5. See whether EB-1A or NIW could be faster than your current priority date queue. No outcome is promised; not legal advice.",
        "h1": "Free case review: see whether EB-1A / NIW could be faster than your current queue",
        "pitch": [
            "Waiting years in EB-2 or EB-3, especially if you were born in China or India? Some people qualify for a self-petitioned EB-1A or a National Interest Waiver (NIW), which can sometimes mean a shorter wait. Considering EB-5 instead? We can point you to EB-5 agencies too.",
            "Tell us a little about your case. With your permission, GC Time passes it to independent partner immigration attorneys or EB-5 agencies, who may contact you about a review. GC Time is not a law firm, and no outcome or timeline is promised.",
        ],
        "form": "Your case",
        "name": "Name (optional)", "email": "Email", "contact": "WeChat or phone (optional)",
        "category": "Category you are working on",
        "categories": [("EB-1A", "EB-1A (extraordinary ability)"), ("NIW", "NIW (National Interest Waiver)"), ("EB-2", "EB-2 (PERM)"),
                       ("EB-3", "EB-3"), ("EB-5", "EB-5 (investor)"), ("unsure", "Not sure yet")],
        "country": "Country of birth",
        "countries": [("CN", "China (mainland)"), ("IN", "India"), ("ROW", "Another country"), ("MX", "Mexico"), ("PH", "Philippines")],
        "pd": "Priority date (optional)", "pd_hint": "If you already have one, for example from an approved I-140.",
        "status": "Current status",
        "statuses": [("h1b", "In the US on H-1B"), ("f1", "In the US on F-1 / OPT"), ("other_us", "In the US, other status"),
                     ("outside_us", "Outside the US")],
        "message": "Anything else (optional, up to 1000 characters)",
        "message_hint": "For example your field, publications, awards or current employer sponsorship. Please do not include passport or A-numbers.",
        "consent": "I agree GC Time may share my information with partner immigration attorneys or agencies who may contact me.",
        "choose": "Choose…", "submit": "Request free review", "sending": "Sending…",
        "ok": "Thank you. Your request was received. A partner attorney or agency may contact you by email; GC Time itself will not give legal advice.",
        "errors": {
            "invalid_email": "Please enter a valid email address.",
            "consent_required": "Please tick the consent box so we can pass your request on.",
            "message_too_long": "Please keep the message under 1000 characters.",
            "invalid_priority_date": "Please enter the priority date as a full date, or leave it empty.",
            "rate_limited": "Too many requests from this network today. Please try again tomorrow.",
            "generic": "Something went wrong. Please check the fields and try again.",
            "offline": "This copy of the site cannot receive the form. Please submit it on the main site:",
        },
        "privacy_title": "Privacy",
        "privacy": [
            "What we collect: the fields above, the page language, the page you came from, the time, and a one-way hash of your IP address that is only used to limit spam. Your IP address itself is not stored. This page has no ads.",
            "Anonymous usage analytics: on the main site we use PostHog to count page views, clicks on this review link and whether a submission succeeded, together with the category and country of birth you chose. Your name, email, WeChat or phone, priority date and message are never sent to PostHog. Nothing is collected when your browser sends Do Not Track.",
            "Why: only to pass your request to partner immigration attorneys or EB-5 agencies who may contact you, and only with your consent above.",
            "Deletion: submit this form again with the same email and write “delete my data” in the message, or open an issue in the GitHub repository github.com/s546126/gctime (issues are public, so do not post personal details there). We will delete your record.",
            "Not legal advice: GC Time is an independent tool, not a law firm. Nothing here is legal advice, and no approval, timeline or result is promised.",
        ],
    },
    "zh": {
        "title": "免费 EB-1A / NIW 个案评估：有没有更快的绿卡路线",
        "desc": "EB-1A、NIW、EB-2、EB-3、EB-5 免费个案评估：看看 EB-1A 或 NIW 是否可能比你现在的排期更快。不承诺结果，不构成法律意见。",
        "h1": "免费个案评估：看看 EB-1A / NIW 是否可能比你现在的队列更快",
        "pitch": [
            "在 EB-2 或 EB-3 排了好几年，尤其是中国大陆或印度出生？有些人符合自主申请的 EB-1A 或国家利益豁免（NIW），有时能缩短等待。也在考虑 EB-5？我们同样可以帮你对接 EB-5 机构。",
            "简单介绍一下你的情况。经你同意后，GC Time 会把信息转给独立的合作移民律师或 EB-5 机构，由他们联系你做评估。GC Time 不是律所，不承诺任何结果或时间。",
        ],
        "form": "你的情况",
        "name": "称呼（选填）", "email": "邮箱", "contact": "微信或电话（选填）",
        "category": "正在办理或考虑的类别",
        "categories": [("EB-1A", "EB-1A 杰出人才"), ("NIW", "NIW 国家利益豁免"), ("EB-2", "EB-2（PERM）"),
                       ("EB-3", "EB-3"), ("EB-5", "EB-5 投资移民"), ("unsure", "还不确定")],
        "country": "出生国",
        "countries": [("CN", "中国大陆"), ("IN", "印度"), ("ROW", "其他国家"), ("MX", "墨西哥"), ("PH", "菲律宾")],
        "pd": "优先日（选填）", "pd_hint": "已有优先日的话填写，例如 I-140 批准通知上的日期。",
        "status": "当前身份",
        "statuses": [("h1b", "在美国，H-1B"), ("f1", "在美国，F-1 / OPT"), ("other_us", "在美国，其他身份"), ("outside_us", "不在美国")],
        "message": "补充说明（选填，最多 1000 字）",
        "message_hint": "例如研究领域、论文、获奖或雇主担保情况。请不要填写护照号或 A 号码。",
        "consent": "我同意 GC Time 将我的信息提供给合作的移民律师或机构，他们可能会联系我。",
        "choose": "请选择…", "submit": "申请免费评估", "sending": "正在提交…",
        "ok": "谢谢，已收到你的申请。合作律师或机构可能会通过邮箱联系你；GC Time 本身不提供法律意见。",
        "errors": {
            "invalid_email": "请填写有效的邮箱地址。",
            "consent_required": "请勾选同意，我们才能转交你的申请。",
            "message_too_long": "补充说明请控制在 1000 字以内。",
            "invalid_priority_date": "优先日请填写完整日期，或留空。",
            "rate_limited": "该网络今天提交次数过多，请明天再试。",
            "generic": "提交失败，请检查各项后重试。",
            "offline": "当前站点副本无法接收表单，请到主站提交：",
        },
        "privacy_title": "隐私说明",
        "privacy": [
            "收集内容：上面填写的各项、页面语言、来源页面、提交时间，以及 IP 地址的单向哈希（仅用于限制垃圾提交，不保存 IP 本身）。本页没有广告。",
            "匿名使用统计：主站使用 PostHog 统计页面访问、评估入口的点击和提交是否成功，并附带你选择的类别和出生国；你的称呼、邮箱、微信或电话、优先日和补充说明绝不会发送给 PostHog。浏览器开启“请勿追踪”（Do Not Track）时不收集。",
            "用途：仅在你同意的前提下，把申请转给可能联系你的合作移民律师或 EB-5 机构。",
            "删除：用同一邮箱再提交一次，并在补充说明里写“删除我的数据”；或在 GitHub 仓库 github.com/s546126/gctime 提 issue（issue 是公开的，请不要写个人信息）。我们会删除你的记录。",
            "不构成法律意见：GC Time 是独立工具，不是律所。本页内容不构成法律意见，也不承诺任何批准、时间或结果。",
        ],
    },
}

# 表单脚本：POST 到站点根的 /api/lead（GitHub Pages 镜像没有 Functions，失败时提示去主站）。
CONSULT_SCRIPT = r"""(function(){
var M=__MESSAGES__,form=document.getElementById('consult-form'),out=document.getElementById('consult-status'),btn=form.querySelector('button[type=submit]');
function say(text,link){out.textContent=text;if(link){out.appendChild(document.createTextNode(' '));var a=document.createElement('a');a.href=link;a.textContent=link;out.appendChild(a);}}
function source(){try{var r=document.referrer&&new URL(document.referrer);if(r&&r.origin===location.origin)return r.pathname;}catch(e){}return location.pathname;}
function locale(){var q=new URLSearchParams(location.search).get('lang');return q&&/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(q)?q:document.documentElement.lang;}
form.addEventListener('submit',function(e){
e.preventDefault();if(btn.disabled)return;
var f=form.elements;
// 匿名统计只带结果代码、类别、出生国和语言；不带姓名、邮箱、电话、优先日或留言。
function track(code){try{var a=window.GCAnalytics;if(a)a.capture('lead_submit_result',{result:code==='ok'?'ok':'error',code:code,category:f.category.value,country:f.country.value,locale:locale()});}catch(x){}}
var body={name:f.name.value,email:f.email.value,contact:f.contact.value,category:f.category.value,country:f.country.value,
priority_date:f.priority_date.value,status:f.status.value,message:f.message.value,consent:f.consent.checked,website:f.website.value,
locale:locale(),source:source()};
btn.disabled=true;btn.textContent=M.sending;say('');
fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit'})
.then(function(r){var type=r.headers.get('content-type')||'';if(type.indexOf('application/json')<0)throw new Error('offline');return r.json();})
.then(function(d){var ok=!!(d&&d.ok);track(ok?'ok':(d&&d.error)||'generic');if(ok){form.hidden=true;say(M.ok);out.focus();return;}say(M.errors[d&&d.error]||M.errors.generic);})
.catch(function(){track('offline');say(M.errors.offline,M.home);})
.then(function(){btn.disabled=false;btn.textContent=M.submit;});
});
})();"""


def consult_page(lang, latest, analytics=""):
    t, c = TEXT[lang], CONSULT[lang]
    path = t["consult_path"]

    def select(name, label, options):
        opts = f'<option value="">{esc(c["choose"])}</option>' + "".join(
            f'<option value="{esc(v)}">{esc(text)}</option>' for v, text in options)
        return (f'<label for="f-{name}">{esc(label)}</label>'
                f'<select id="f-{name}" name="{name}" required>{opts}</select>')

    fields = (
        f'<label for="f-name">{esc(c["name"])}</label><input id="f-name" name="name" maxlength="100" autocomplete="name">'
        f'<label for="f-email">{esc(c["email"])}</label><input id="f-email" name="email" type="email" maxlength="254" autocomplete="email" required>'
        f'<label for="f-contact">{esc(c["contact"])}</label><input id="f-contact" name="contact" maxlength="100" autocomplete="tel">'
        + select("category", c["category"], c["categories"])
        + select("country", c["country"], c["countries"])
        + f'<label for="f-pd">{esc(c["pd"])}</label><input id="f-pd" name="priority_date" type="date" min="1990-01-01" max="2100-12-31" aria-describedby="f-pd-hint">'
        f'<p class="muted" id="f-pd-hint">{esc(c["pd_hint"])}</p>'
        + select("status", c["status"], c["statuses"])
        + f'<label for="f-message">{esc(c["message"])}</label><textarea id="f-message" name="message" rows="4" maxlength="1000" aria-describedby="f-message-hint"></textarea>'
        f'<p class="muted" id="f-message-hint">{esc(c["message_hint"])}</p>'
        # 蜜罐：视觉和读屏都隐藏，键盘跳过；真人不会填。
        '<div class="hp" aria-hidden="true"><label for="f-website">Website</label>'
        '<input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>'
        f'<label class="consent"><input type="checkbox" name="consent" value="1" required><span>{esc(c["consent"])}</span></label>'
        f'<button type="submit">{esc(c["submit"])}</button>'
    )
    messages = {"ok": c["ok"], "errors": c["errors"], "sending": c["sending"], "submit": c["submit"],
                "home": ORIGIN + path}
    script = CONSULT_SCRIPT.replace("__MESSAGES__", json.dumps(messages, ensure_ascii=False).replace("</", "<\\/"))
    privacy = "".join(f"<li>{esc(item)}</li>" for item in c["privacy"])
    body = (f"<h1>{esc(c['h1'])}</h1>" + "".join(f"<p>{esc(x)}</p>" for x in c["pitch"])
            + f'<h2>{esc(c["form"])}</h2><form id="consult-form" class="consult-form">{fields}</form>'
            f'<p id="consult-status" class="consult-status" role="status" aria-live="polite" tabindex="-1"></p>'
            f'<h2>{esc(c["privacy_title"])}</h2><ul class="privacy">{privacy}</ul>'
            f"<script>{script}</script>")
    alternates = [("en", CONSULT_PATHS["en"]), ("zh-CN", CONSULT_PATHS["zh"]), ("x-default", CONSULT_PATHS["en"])]
    jsonld = {"@context": "https://schema.org", "@type": "WebPage", "name": c["title"], "description": c["desc"],
              "url": ORIGIN + path, "inLanguage": t["lang"]}
    # 收集联系方式的页面不加载第三方广告脚本。
    return path, latest, layout(lang, c["title"], c["desc"], path, body, jsonld, alternates, "",
                  other_path=CONSULT_PATHS["zh" if lang == "en" else "en"], analytics=analytics)


CONSULT_PATHS = {"en": TEXT["en"]["consult_path"], "zh": TEXT["zh"]["consult_path"]}


def feed(monthly, latest):
    """One Atom entry per bulletin month (newest 12) with the Chart A moves that changed."""
    entries = []
    months = sorted({m for values in monthly.values() for m in values})[-12:]
    for i, month in enumerate(reversed(months)):
        prev = months[-i - 2] if len(months) > i + 1 else None
        moves = []
        for cat in CATEGORIES:
            for country in COUNTRIES:
                hist = series(monthly, f"{cat[1]}|{country[1]}", "A")
                if prev and month in hist and prev in hist and hist[month] != hist[prev]:
                    moves.append(f"{cat[2]} {country[2]}: {movement(hist[prev], hist[month], TEXT['en'])}")
        summary = "; ".join(moves) or "No Chart A changes in the main categories."
        entries.append(f"<entry><title>{esc(month_label(month, 'en'))} Visa Bulletin: employment-based cutoffs</title>"
                       f"<id>{ORIGIN}/visa-bulletin/#{month}</id><link href=\"{ORIGIN}/visa-bulletin/\"/>"
                       f"<updated>{month}-01T00:00:00Z</updated><summary>{esc(summary)}</summary></entry>")
    return (f'<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'
            f"<title>{NAME} · Visa Bulletin updates</title><id>{ORIGIN}/feed.xml</id>"
            f'<link rel="self" href="{ORIGIN}/feed.xml"/><link href="{ORIGIN}/visa-bulletin/"/>'
            f"<updated>{latest}-01T00:00:00Z</updated>{''.join(entries)}</feed>\n")


HEAD_SEO = """<meta name="description" content="Free EB-1, EB-2, EB-3, EB-4 and EB-5 priority date predictor for China, India, Mexico, the Philippines and the rest of the world. Estimates when your priority date becomes current from Visa Bulletin history, visa supply and the queue ahead of you. 免费绿卡排期预测。">
<link rel="canonical" href="{origin}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GC Time">
<meta property="og:title" content="GC Time · Green card priority date predictor (EB-1 to EB-5)">
<meta property="og:description" content="Estimate when your EB priority date becomes current. Free, private, works offline.">
<meta property="og:url" content="{origin}/">
<meta property="og:image" content="{origin}/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/atom+xml" title="Visa Bulletin updates" href="/feed.xml">
<script type="application/ld+json">{ld}</script>
"""
NOSCRIPT = """<noscript><nav aria-label="Visa Bulletin"><p>Visa Bulletin cutoffs by category and country:</p><ul>{links}</ul></nav></noscript>
"""


def add_head(html_text):
    """Description, canonical, Open Graph and WebApplication data for the app page itself."""
    ld = json.dumps({"@context": "https://schema.org", "@type": "WebApplication", "name": "GC Time",
                     "url": ORIGIN + "/", "applicationCategory": "UtilitiesApplication", "operatingSystem": "Any",
                     "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                     "description": "Employment-based green card priority date predictor (EB-1 to EB-5)."})
    if html_text.count("</head>") != 1 or 'rel="canonical"' in html_text:
        raise SystemExit("index.html 的 <head> 不唯一或已有 canonical")
    html_text = html_text.replace("</head>", HEAD_SEO.format(origin=ORIGIN, ld=ld) + "</head>", 1)
    links = "".join(f'<li><a href="{page_path("en", c, k)}">{esc(page_label("en", c, k))}</a></li>'
                    for c in CATEGORIES for k in COUNTRIES)
    links += f'<li><a href="{TEXT["en"]["hub_path"]}">All categories</a></li><li><a href="{TEXT["zh"]["hub_path"]}">中文排期表</a></li>'
    return html_text.replace("</body>", NOSCRIPT.format(links=links) + "</body>", 1)


def load_catalogs():
    """sponsor.* strings for the banner on static pages (zh-CN always; en when the locale exists)."""
    import subprocess
    out = subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import { catalogs } from './src/i18n.js'; console.log(JSON.stringify(catalogs))"], cwd=ROOT, text=True)
    return json.loads(out)


def build(site, sponsor_src=None, catalogs=None, analytics_src=None):
    """Write the pages into `site` (dist/site). Returns the paths written, for tests."""
    monthly = json.loads((ROOT / "data" / "visa_bulletin_history.json").read_text(encoding="utf-8"))["monthly"]
    catalogs = catalogs if catalogs is not None else (load_catalogs() if sponsor_src else {})
    pages, latest = [], "0000-00"
    analytics = analytics_tag(analytics_src)
    for lang in ("en", "zh"):
        sponsor = sponsor_bits(lang, sponsor_src, catalogs) if sponsor_src else ""
        built = [build_hub(lang, monthly, sponsor, analytics)]
        built += [build_page(lang, c, k, monthly, sponsor, analytics) for c in CATEGORIES for k in countries_for(lang)]
        for item in filter(None, built):
            path, month, text = item
            target = site / path.strip("/") / "index.html"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
            pages.append((path, month))
            latest = max(latest, month)
    for lang in ("en", "zh"):
        path, month, text = consult_page(lang, latest, analytics)
        target = site / path.strip("/") / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        pages.append((path, month))
    urls = [("/", latest)] + pages
    (site / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"<url><loc>{ORIGIN}{p}</loc><lastmod>{m}-01</lastmod></url>\n" for p, m in urls)
        + "</urlset>\n", encoding="utf-8")
    (site / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {ORIGIN}/sitemap.xml\n", encoding="utf-8")
    (site / "feed.xml").write_text(feed(monthly, latest), encoding="utf-8")
    return [p for p, _ in urls]


if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "dist" / "seo-preview")
    print("\n".join(build(out)))
