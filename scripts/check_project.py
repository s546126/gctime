#!/usr/bin/env python3
"""不访问外网的语法、JSON 和静态资源检查。"""

import argparse
import ast
import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent.parent


class PageChecks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = False
        self.scripts = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            self.inline = not attrs.get("src") and attrs.get("type", "text/javascript") in (
                "text/javascript", "application/javascript", "module")
            if self.inline:
                self.scripts.append("")
        asset = attrs.get("src") if tag in ("script", "img") else None
        if tag == "link" and attrs.get("rel") in ("stylesheet", "manifest", "icon", "apple-touch-icon"):
            asset = attrs.get("href")
        if asset:
            self.assets.append(asset)

    def handle_data(self, data):
        if self.inline:
            self.scripts[-1] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.inline = False


DESKTOP_AD = "https://bauval.org/22/6d1946abad3d3fdcc79373556a137876"
MOBILE_AD = "https://bauval.org/22/d450c9cf5ef416c8ffc1907634e0d6e6"
PRODUCTION_HOSTS = (
    "bracketboss2026.com",
    "www.bracketboss2026.com",
    "gc.bracketboss2026.com",
)


def check_sponsor():
    source = (ROOT / "src" / "sponsor.js").read_text(encoding="utf-8")
    if source.count(DESKTOP_AD) != 1 or source.count(MOBILE_AD) != 1:
        raise SystemExit("桌面与移动广告脚本地址必须各出现一次，且与后台给出的 URL 一致")
    if "effectivecpmnetwork" in source or "target = '_blank'" in source or "sponsor.open" in source:
        raise SystemExit("赞助横幅不应再使用 Direct Link 或新标签页按钮")
    for host in PRODUCTION_HOSTS:
        if f"'{host}'" not in source:
            raise SystemExit(f"赞助宿主缺失：{host}")
    for snippet in (
        "location.protocol !== 'https:'",
        "const SHOW_DELAY_MS = 1000",
        "const DISMISS_MS = 3 * 60 * 1000",
        "const AD_LOAD_TIMEOUT_MS = 4000",
        "const DESKTOP_MIN_WIDTH = 768",
        "format: 'iframe'",
        "window.atOptions",
        "navigator.onLine === false",
    ):
        if snippet not in source:
            raise SystemExit(f"赞助脚本缺少约束：{snippet}")
    if "24 * 60 * 60" in source:
        raise SystemExit("赞助频控不应再使用 24 小时")
    styles = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
    for snippet in (
        "#gc-sponsor-slot:not([hidden])",
        "position: fixed",
        "--gc-sponsor-reserve",
        "--gc-ad-height: 90px",
        "--gc-ad-height: 50px",
        "env(safe-area-inset-bottom)",
        "min-height: var(--gc-ad-height)",
    ):
        if snippet not in styles:
            raise SystemExit(f"赞助样式缺少约束：{snippet}")
    worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    if "bauval.org" in worker or "effectivecpmnetwork" in worker:
        raise SystemExit("Service Worker 不应预缓存或改写广告脚本")
    if "origin !== self.location.origin" not in worker:
        raise SystemExit("Service Worker 必须放过跨源请求，避免拦截广告脚本")
    build = (ROOT / "scripts" / "build_site.py").read_text(encoding="utf-8")
    if "footer + '\\n    <div id=\"gc-sponsor-slot\"'" in build:
        raise SystemExit("赞助槽不应再注入页脚")
    if '<div id="gc-sponsor-slot" hidden></div>' not in build:
        raise SystemExit("在线构建必须注入赞助槽")
    page_source = (ROOT / "index.html").read_text(encoding="utf-8")
    if 'id="gc-sponsor-slot"' in page_source or "bauval.org" in page_source or "effectivecpmnetwork" in page_source:
        raise SystemExit("源页面和离线页不能包含赞助槽或广告地址")
    policies = [page_source]
    headers = ROOT / "_headers"
    if headers.is_file():
        policies.append(headers.read_text(encoding="utf-8"))
    for policy in policies:
        if "Content-Security-Policy" in policy and "bauval.org" not in policy:
            raise SystemExit("CSP 必须允许 bauval.org 的脚本和框架")
    for path in sorted((ROOT / "src" / "locales").glob("*.js")):
        text = path.read_text(encoding="utf-8")
        if "sponsor.open" in text or "sponsor.title" in text:
            raise SystemExit(f"{path.name} 仍保留打开赞助链接的文案键")
        frequency = privacy = None
        for line in text.splitlines():
            if "'sponsor.frequency'" in line:
                frequency = line.split(":", 1)[1]
            if "'sponsor.privacy'" in line:
                privacy = line.split(":", 1)[1]
        if not frequency or not privacy:
            raise SystemExit(f"缺少赞助文案：{path.name}")
        if "24" in frequency:
            raise SystemExit(f"{path.name} 仍写着 24 小时频控")
        if "3" not in frequency:
            raise SystemExit(f"{path.name} 的频控文案需要说明约 3 分钟")
        if "IP" not in privacy:
            raise SystemExit(f"{path.name} 的隐私说明需要写明广告网络可能收到 IP")


def main(source_only=False):
    for path in sorted((ROOT / "scripts").glob("*.py")):
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for path in sorted((ROOT / "scripts").glob("*.sh")):
        subprocess.run(["bash", "-n", str(path)], check=True)
    for path in [*sorted((ROOT / "scripts").glob("*.mjs")), *sorted(ROOT.glob("*.js")),
                 ROOT / "src" / "sponsor.js"]:
        subprocess.run(["node", "--check", str(path)], check=True)
    subprocess.run(["node", str(ROOT / "scripts" / "build_ui.mjs"), "--check"], cwd=ROOT, check=True)
    for path in [ROOT / "manifest.json", *sorted((ROOT / "data").glob("*.json"))]:
        json.loads(path.read_text(encoding="utf-8"))
    subprocess.run(["node", "--check", str(ROOT / "sw.js")], check=True)
    page = PageChecks()
    page.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    if not page.scripts:
        raise SystemExit("index.html 中没有可检查的脚本")
    for script in page.scripts:
        subprocess.run(["node", "--check"], input=script, text=True, check=True)
    for asset in page.assets:
        url = urlsplit(asset)
        if source_only and url.path.removeprefix("./") in ("assets/ui.js", "assets/ui.css"):
            continue
        if not url.scheme and not url.netloc and not (ROOT / unquote(url.path)).is_file():
            raise SystemExit(f"缺少页面资源：{asset}")
    if not source_only:
        subprocess.run(["node", "--check", str(ROOT / "assets" / "ui.js")], check=True)
    check_sponsor()
    print("✓ Python / Shell / JavaScript 语法、JSON 和页面资源检查通过")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="不要求生成的 UI 产物；供无授权令牌的 PR 检查")
    main(source_only=parser.parse_args().source_only)
