#!/usr/bin/env python3
"""build_seo 生成的排期页：数字来自历史数据，链接与站点地图一致，页面可被解析。"""

import json
import re
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_seo  # noqa: E402

CONSULT = ("/consult/", "/zh/consult/")
LANGS = build_seo.ORDER
TEXT = build_seo.TEXT
# 每种语言一个不同的 sponsor.label，用来确认每页内联的是它自己语言的文案。
CATALOGS = {TEXT[code]["catalog"]: {"sponsor.label": f"AD-{code}", "app.brand": "x"} for code in LANGS}
PLACEHOLDER = re.compile(r"\{([A-Za-z_]+)\}")
# 这些键在各语言里刻意保持一致（术语与 app 一致），其余字符串不应与英文相同。
SAME_OK = {"current", "label", "unavailable", "consult_path", "month_fmt", "arrow", "dir", "catalog", "lang", "name", "hub_path"}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.title, self.alternates, self.html = [], 0, {}, {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href", "").startswith("/"):
            self.links.append(attrs["href"])
        if tag == "link" and attrs.get("rel") == "alternate" and "hreflang" in attrs:
            assert attrs["hreflang"] not in self.alternates, attrs
            self.alternates[attrs["hreflang"]] = attrs["href"].removeprefix(build_seo.ORIGIN)
        if tag == "html":
            self.html = attrs
        self.title += tag == "title"


def check_consult(site):
    """免费评估页：两种语言、必填同意框、蜜罐、隐私说明，表单提交到站点根的 /api/lead。"""
    for path, lang, consent in (("/consult/", "en", "partner immigration attorneys or agencies who may contact me"),
                                ("/zh/consult/", "zh-CN", "合作的移民律师或机构")):
        text = (site / path.strip("/") / "index.html").read_text(encoding="utf-8")
        assert f'<html lang="{lang}" dir="ltr">' in text, path
        assert 'id="consult-form"' in text and "fetch('/api/lead'" in text, path
        assert 'type="checkbox" name="consent" value="1" required' in text and consent in text, path
        assert 'name="email" type="email"' in text and 'maxlength="1000"' in text, path
        assert 'name="website" tabindex="-1" autocomplete="off"' in text and 'class="hp" aria-hidden="true"' in text, path
        for value in ("EB-1A", "NIW", "EB-2", "EB-3", "EB-5", "unsure", "CN", "IN", "ROW", "MX", "PH",
                      "h1b", "f1", "other_us", "outside_us"):
            assert f'<option value="{value}">' in text, (path, value)
        assert 'class="privacy"' in text and "github.com/s546126/gctime" in text, path
        assert "guarantee" not in text.lower(), path
        assert f'<link rel="canonical" href="{build_seo.ORIGIN}{path}">' in text, path
        assert f'<meta property="og:image" content="{build_seo.ORIGIN}/og-image.png">' in text, path
        assert '<meta name="twitter:card" content="summary_large_image">' in text, path


def check_text():
    """每种语言的键与 {占位符} 都和英文一致；抽查几处没有漏翻成英文。"""
    assert sorted(TEXT) == sorted(LANGS) and len(LANGS) == 11, LANGS
    en = TEXT["en"]
    for code in LANGS:
        t = TEXT[code]
        assert set(t) == set(en), (code, set(t) ^ set(en))
        for key, value in en.items():
            if key == "month_fmt":
                assert "{y}" in t[key] and set(PLACEHOLDER.findall(t[key])) <= {"y", "n", "m"}, code
            elif isinstance(value, str):
                assert sorted(PLACEHOLDER.findall(t[key])) == sorted(PLACEHOLDER.findall(value)), (code, key)
            else:
                assert len(t[key]) == len(value), (code, key)
        if code == "en":
            continue
        for key in ("hub_title", "chart_a", "change", "moved", "same", "history", "cta", "q1", "a1", "faq",
                    "other", "disclaimer", "all", "legend", "consult_cta", "lang_label"):
            assert t[key] != en[key], (code, key)
        for key, value in t.items():
            if key not in SAME_OK and isinstance(value, str) and len(value) > 12:
                assert value != en[key], (code, key, value)
    assert TEXT["ar"]["dir"] == "rtl" and all(TEXT[c]["dir"] == "ltr" for c in LANGS if c != "ar")


def expected_paths():
    monthly = json.loads((build_seo.ROOT / "data" / "visa_bulletin_history.json").read_text())["monthly"]
    combos = [(c, k) for c in build_seo.CATEGORIES for k in build_seo.COUNTRIES
              if build_seo.series(monthly, f"{c[1]}|{k[1]}", "A") or build_seo.series(monthly, f"{c[1]}|{k[1]}", "B")]
    assert len(combos) == 25, len(combos)
    return {code: [TEXT[code]["hub_path"]] + [build_seo.page_path(code, c, k) for c, k in combos] for code in LANGS}


def main():
    check_text()
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        paths = build_seo.build(site, sponsor_src="/assets/sponsor.test.js", catalogs=CATALOGS,
                               analytics_src="/assets/analytics.test.js")
        assert len(paths) == len(set(paths)), "重复路径"
        expected = expected_paths()
        # 原有 URL 保持不变。
        for keep in ("/visa-bulletin/", "/visa-bulletin/eb-2-china/", "/zh/visa-bulletin/", "/zh/eb-2-china/",
                     "/es/visa-bulletin/", "/es/eb-2-mexico/", "/hi/eb-2-india/", "/pt-br/eb-3-row/", "/ar/visa-bulletin/"):
            assert keep in paths, keep
        want = {"/", *CONSULT, *(p for group in expected.values() for p in group)}
        assert set(paths) == want, set(paths) ^ want
        assert len(paths) == 1 + 2 + 11 * 26, len(paths)

        sitemap = (site / "sitemap.xml").read_text(encoding="utf-8")
        locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
        assert sorted(locs) == sorted(build_seo.ORIGIN + p for p in paths), "站点地图与页面不一致"
        assert 'xmlns:xhtml="http://www.w3.org/1999/xhtml"' in sitemap

        langs_of = {p: code for code, group in expected.items() for p in group}
        langs_of.update({"/consult/": "en", "/zh/consult/": "zh"})
        seen = {}
        for path in paths:
            if path == "/":
                continue
            text = (site / path.strip("/") / "index.html").read_text(encoding="utf-8")
            parser = Links()
            parser.feed(text)
            assert parser.title == 1, path
            for link in parser.links:
                assert link == "/" or link in paths, (path, link)
            code = langs_of[path]
            t = TEXT[code]
            assert parser.html.get("lang") == t["lang"] and parser.html.get("dir") == t["dir"], (path, parser.html)
            alts = parser.alternates
            # hreflang 完整：自己在内、x-default 指向英文版，且每个目标都存在。
            assert alts.get(t["lang"]) == path, (path, alts)
            assert alts.get("x-default") == alts.get("en"), (path, alts)
            assert all(target in paths for target in alts.values()), (path, alts)
            group = 2 if path in CONSULT else 11
            assert len(alts) == group + 1, (path, len(alts))
            seen[path] = alts
            # 站点地图里这页的 alternates 与页面一致。
            entry = re.search(rf"<url><loc>{re.escape(build_seo.ORIGIN + path)}</loc>.*?</url>", sitemap).group(0)
            assert len(re.findall("<xhtml:link ", entry)) == len(alts), path
            # 语言切换器列出同一页面的每个语言版本。
            for target in alts.values():
                assert f'<a href="{target}"' in text, (path, target)
            # 匿名统计在所有静态页（含评估页）加载，挂在 <head> 里。
            assert text.count('<script src="/assets/analytics.test.js" defer></script>') == 1, path
            assert text.index("analytics.test.js") < text.index("</head>"), path
            if path in CONSULT:
                assert "lead_submit_result" in text and "PostHog" in text, path
                assert "no ads or tracking scripts" not in text and "没有广告或追踪脚本" not in text, path
                # 收集联系方式的页面不加载第三方广告脚本。
                assert 'id="gc-sponsor-slot"' not in text and "sponsor.test.js" not in text, path
                continue
            assert 'id="gc-sponsor-slot"' in text and "/assets/sponsor.test.js" in text, path
            assert f'"sponsor.label": "AD-{code}"' in text, (path, "sponsor 文案应来自本语言词典")
            consult = "/zh/consult/" if code == "zh" else "/consult/"
            assert '<section class="consult-cta">' in text and f'href="{consult}"' in text, path
            placement = "hub" if path == t["hub_path"] else "landing"
            assert f'href="{consult}" data-gc-cta="{placement}"' in text, path
            assert "app.brand" not in text, "只应带 sponsor.* 文案"
            # 窄屏表格：短表头 + 说明 + 日期不换行。
            assert f"<th>{t['chart_a_short']}</th>" in text.replace("&#x27;", "'") and 'class="muted legend"' in text, path
            assert 'class="d"' in text, path
        # hreflang 互惠：A 指向 B，则 B 也指向 A。
        for path, alts in seen.items():
            for target in alts.values():
                assert path in seen[target].values(), (path, target)

        monthly = json.loads((build_seo.ROOT / "data" / "visa_bulletin_history.json").read_text())["monthly"]
        hist = monthly["EB-2|CN|A"]
        last = max(hist)
        page = (site / "visa-bulletin" / "eb-2-china" / "index.html").read_text(encoding="utf-8")
        assert build_seo.show(hist[last], TEXT["en"]) in page
        # I-485 库存段：EB-1/2/3 页面有、EB-4/5 没有；合计与 data/i485_queue.json 最新一期一致（D 按 5 件）。
        queue = json.loads((build_seo.ROOT / "data" / "i485_queue.json").read_text(encoding="utf-8"))
        enc = queue["cells"]["EB-2|CN"][-1]
        total = sum(enc["n"]) + queue["d"]["est"] * sum(c for _, c in enc["d"])
        assert '<section class="inventory" id="i485-inventory">' in page, "eb-2-china 缺库存段"
        assert f"<b>≈ {total:,}</b>" in page and queue["snapshots"][-1]["asof"] in page, "库存合计或日期不符"
        assert "Before 2017" in page and "Pending I-485s by priority date year" in page
        zh_page = (site / "zh" / "eb-1-india" / "index.html").read_text(encoding="utf-8")
        assert "按优先日年份的在案 I-485" in zh_page and "在案 I-485 共" in zh_page
        for path in ("/visa-bulletin/eb-4-china/", "/zh/eb-5-india/"):
            assert 'id="i485-inventory"' not in (site / path.strip("/") / "index.html").read_text(encoding="utf-8"), path
        hub = (site / "zh" / "visa-bulletin" / "index.html").read_text(encoding="utf-8")
        assert hub.count("<tr><td><a ") == 25 and 'class="stack"' in hub and "最终裁决日期（表A）</th>" not in hub
        ar = (site / "ar" / "visa-bulletin" / "index.html").read_text(encoding="utf-8")
        assert '<html lang="ar" dir="rtl">' in ar and "جميع الفئات" in ar
        es = (site / "es" / "eb-2-mexico" / "index.html").read_text(encoding="utf-8")
        y, m = map(int, last.split("-"))
        assert f"{TEXT['es']['months'][m - 1]} de {y}" in es and "Tabla A" in es and "Final Action Date (Chart A)" not in es
        assert "Sitemap: https://bracketboss2026.com/sitemap.xml" in (site / "robots.txt").read_text()
        assert (site / "feed.xml").read_text().count("<entry>") == 12
        check_consult(site)
        empty = Path(tmp) / "plain"
        build_seo.build(empty)
        assert 'id="gc-sponsor-slot"' not in (empty / "visa-bulletin" / "index.html").read_text(encoding="utf-8")
        assert "analytics" not in (empty / "consult" / "index.html").read_text(encoding="utf-8").split("<main>")[0]
    head = build_seo.add_head("<html><head></head><body></body></html>")
    assert "/og-image.png" in head and "summary_large_image" in head
    assert head.count('rel="canonical"') == 1 and "/visa-bulletin/eb-1-india/" in head and "/ar/visa-bulletin/" in head
    print(f"✅ SEO 页面检查通过（{len(paths)} 个 URL，{len(LANGS)} 种语言）")


if __name__ == "__main__":
    main()
