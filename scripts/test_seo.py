#!/usr/bin/env python3
"""build_seo 生成的排期页：数字来自历史数据，链接与站点地图一致，页面可被解析。"""

import json
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_seo  # noqa: E402

CATALOGS = {"zh-CN": {"sponsor.label": "广告", "app.brand": "x"}, "en": {"sponsor.label": "Ad"}}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.title = [], 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href", "").startswith("/"):
            self.links.append(attrs["href"])
        self.title += tag == "title"


def main():
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        paths = build_seo.build(site, sponsor_src="/assets/sponsor.test.js", catalogs=CATALOGS)
        assert "/visa-bulletin/eb-2-china/" in paths and "/zh/eb-2-china/" in paths, paths
        sitemap = (site / "sitemap.xml").read_text(encoding="utf-8")
        for path in paths:
            assert f"<loc>{build_seo.ORIGIN}{path}</loc>" in sitemap, path
            if path == "/":
                continue
            text = (site / path.strip("/") / "index.html").read_text(encoding="utf-8")
            parser = Links()
            parser.feed(text)
            assert parser.title == 1, path
            for link in parser.links:
                assert link == "/" or link in paths, (path, link)
            assert 'id="gc-sponsor-slot"' in text and "/assets/sponsor.test.js" in text, path
            assert "app.brand" not in text, "只应带 sponsor.* 文案"
        monthly = json.loads((build_seo.ROOT / "data" / "visa_bulletin_history.json").read_text())["monthly"]
        hist = monthly["EB-2|CN|A"]
        last = max(hist)
        page = (site / "visa-bulletin" / "eb-2-china" / "index.html").read_text(encoding="utf-8")
        assert build_seo.show(hist[last], build_seo.TEXT["en"]) in page
        assert "Sitemap: https://bracketboss2026.com/sitemap.xml" in (site / "robots.txt").read_text()
        assert (site / "feed.xml").read_text().count("<entry>") == 12
        empty = Path(tmp) / "plain"
        build_seo.build(empty)
        assert 'id="gc-sponsor-slot"' not in (empty / "visa-bulletin" / "index.html").read_text(encoding="utf-8")
    head = build_seo.add_head("<html><head></head><body></body></html>")
    assert head.count('rel="canonical"') == 1 and "/visa-bulletin/eb-1-india/" in head
    print("✅ SEO 页面检查通过")


if __name__ == "__main__":
    main()
