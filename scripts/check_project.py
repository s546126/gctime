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
    if "indexOf('/api/') === 0) return;" not in worker:
        raise SystemExit("Service Worker 不能拦截或缓存 /api/*")
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


def _ym(s):
    y, m = s[:7].split("-")
    return int(y) * 12 + int(m) - 1


def check_bulletin_data():
    """公告数据一致性：data/visa_bulletin_history.json 是唯一来源。
    - last_bulletin 必须等于页面声明的最新一期(VB_YEAR-VB_MON)，且每个序列都到这一期为止；
      否则页面会把旧数据标成新一期(2026-11 只更新了 EB-1 中国就是这样)。
    - index.html 的 HIST_DATA 展开后逐月等于 JSON；CUTOFF_DATA 等于 JSON 末期值。"""
    import re
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    doc = json.loads((ROOT / "data" / "visa_bulletin_history.json").read_text(encoding="utf-8"))
    monthly, last = doc["monthly"], doc["last_bulletin"]
    m = re.search(r"var VB_YEAR = (\d+), VB_MON = (\d+);", html)
    if not m:
        raise SystemExit("index.html 缺 VB_YEAR / VB_MON")
    want = f"{int(m.group(1))}-{int(m.group(2)):02d}"
    if last != want:
        raise SystemExit(f"visa_bulletin_history.json 的 last_bulletin={last}，页面声明最新一期 {want}")
    stale = sorted(k for k, s in monthly.items() if max(s) != last)
    if stale:
        raise SystemExit(f"{len(stale)} 个序列没有更新到 {last}：{', '.join(stale[:8])}{' …' if len(stale) > 8 else ''}")
    if re.search(r"\bvar HISTORY(_B)? = \[", html):
        raise SystemExit("index.html 又出现手写 HISTORY/HISTORY_B；EB-1A 中国必须从 HIST_DATA(=JSON) 读取")

    hm = re.search(r"/\*HIST_DATA_BEGIN\*/(.*?)/\*HIST_DATA_END\*/", html, re.S)
    hist = json.loads(hm.group(1))
    for key, pts in hist.items():
        if key not in monthly:
            raise SystemExit(f"HIST_DATA 有 JSON 中不存在的序列 {key}")
        src = monthly[key]
        exp = {}
        for i, (x, v) in enumerate(pts):
            end = _ym(pts[i + 1][0]) if i + 1 < len(pts) else _ym(x) + 1
            for mi in range(_ym(x), end):
                exp[mi] = v
        got = {_ym(k): v for k, v in src.items()}
        bad = [f"{mi // 12}-{mi % 12 + 1:02d}" for mi in sorted(got) if exp.get(mi) != got[mi]]
        if bad or max(exp) != max(got):
            raise SystemExit(f"HIST_DATA {key} 与 visa_bulletin_history.json 不一致：{', '.join(bad[:6]) or '末期不同'}")
    missing = sorted(k for k in monthly if k not in hist and not k.split("|")[0].startswith("EB-5-"))
    if missing:
        raise SystemExit(f"HIST_DATA 缺少序列：{', '.join(missing[:8])}")

    fh = re.search(r"var FED_HOLIDAYS = \[(.*?)\]; // FED_HOLIDAYS_END", html, re.S)
    sniff = (ROOT / "scripts" / "sniff_visa_bulletin.py").read_text(encoding="utf-8")
    fs = re.search(r"^FED_HOLIDAYS = \{(.*?)\}", sniff, re.S | re.M)
    if not fh or not fs or set(re.findall(r"\d{4}-\d{2}-\d{2}", fh.group(1))) != set(re.findall(r"\d{4}-\d{2}-\d{2}", fs.group(1))):
        raise SystemExit("index.html 与 sniff_visa_bulletin.py 的 FED_HOLIDAYS 不一致")

    cm = re.search(r"var CUTOFF_DATA = \{(.*?)\}; // CUTOFF_DATA_END", html, re.S)
    conv = {"current": "C", "unavailable": "U"}
    for line in cm.group(1).splitlines():
        lm = re.match(r"\s*'([A-Za-z0-9-]+)':\s*\{(.*)\}\s*,?\s*$", line)
        if not lm:
            continue
        for co, a, b in re.findall(r"'([A-Z]+)':\s*\{\s*A:\s*'([^']*)',\s*B:\s*'([^']*)'\s*\}", lm.group(2)):
            for t, v in (("A", a), ("B", b)):
                key = f"{lm.group(1)}|{co}|{t}"
                if key in monthly and monthly[key].get(last) != conv.get(v, v):
                    raise SystemExit(f"CUTOFF_DATA {key}={v} 与 JSON {last} 期 {monthly[key].get(last)} 不一致")


def check_i485_queue():
    """I-485 排位数据：index.html 嵌入块 == data/i485_queue.json，且最新一期就是本地最新的库存快照。
    只用 JSON 与正则（source-checks 没装 openpyxl）。新快照下载后忘了重跑
    scripts/build_i485_queue.py --inject 会在这里失败。"""
    import re
    months = ["january", "february", "march", "april", "may", "june",
              "july", "august", "september", "october", "november", "december"]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r"/\*I485Q_BEGIN\*/(.*?)/\*I485Q_END\*/", html, re.S)
    if not m:
        raise SystemExit("index.html 缺 I485Q_BEGIN/I485Q_END 标记")
    doc = json.loads((ROOT / "data" / "i485_queue.json").read_text(encoding="utf-8"))
    if json.loads(m.group(1)) != doc:
        raise SystemExit("index.html 的 I485_QUEUE 与 data/i485_queue.json 不一致，请运行 scripts/build_i485_queue.py --inject")
    files = []
    for f in (ROOT / "data" / "raw" / "uscis").glob("I485_Pending_Inventory_*.xlsx"):
        fm = re.fullmatch(r"I485_Pending_Inventory_([a-z]+)_(\d{4})\.xlsx", f.name)
        if fm and fm.group(1) in months:
            files.append(((int(fm.group(2)), months.index(fm.group(1))), f.name))
    newest = max(files)[1] if files else None
    snaps = doc.get("snapshots") or []
    if not snaps or snaps[-1]["file"] != newest:
        raise SystemExit(f"data/i485_queue.json 最新一期 {snaps[-1]['file'] if snaps else '无'} 不是本地最新库存 {newest}，"
                         "请运行 scripts/build_i485_queue.py --inject")
    for key, per in doc["cells"].items():
        if len(per) != len(snaps):
            raise SystemExit(f"I485_QUEUE {key} 的期数与 snapshots 不一致")
        for enc in per:
            if enc and len(enc["n"]) > 12 * (enc["y1"] - enc["y0"] + 2):
                raise SystemExit(f"I485_QUEUE {key} 的 n 超出年份范围")


def check_analytics():
    """匿名统计只进在线产物，并且只在正式域名的 HTTPS 页面加载 PostHog。"""
    source = (ROOT / "src" / "analytics.js").read_text(encoding="utf-8")
    for host in PRODUCTION_HOSTS:
        if f"'{host}'" not in source:
            raise SystemExit(f"统计宿主缺失：{host}")
    for snippet in (
        "location.protocol === 'https:'", "person_profiles: 'identified_only'", "autocapture: false",
        "disable_session_recording: true", "respect_dnt: true", "capture_pageview: true",
        "capture_pageleave: true", "before_send", "register({ app: APP })", "__GC_ANALYTICS_MOCK",
    ):
        if snippet not in source:
            raise SystemExit(f"统计脚本缺少约束：{snippet}")
    page_source = (ROOT / "index.html").read_text(encoding="utf-8")
    for forbidden in ("posthog.com", "phc_", "array.js", "assets/analytics"):
        if forbidden in page_source:
            raise SystemExit(f"源页面和离线页不能包含统计加载器：{forbidden}")
    build = (ROOT / "scripts" / "build_site.py").read_text(encoding="utf-8")
    if '"src/analytics.js": "assets/analytics.js"' not in build:
        raise SystemExit("在线构建必须单独复制统计脚本")


def main(source_only=False):
    for path in sorted((ROOT / "scripts").glob("*.py")):
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for path in sorted((ROOT / "scripts").glob("*.sh")):
        subprocess.run(["bash", "-n", str(path)], check=True)
    for path in [*sorted((ROOT / "scripts").glob("*.mjs")), *sorted(ROOT.glob("*.js")),
                 ROOT / "src" / "sponsor.js", ROOT / "src" / "analytics.js", *sorted((ROOT / "functions").rglob("*.js"))]:
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
    check_analytics()
    check_bulletin_data()
    check_i485_queue()
    print("✓ Python / Shell / JavaScript 语法、JSON 和页面资源检查通过")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="不要求生成的 UI 产物；供无授权令牌的 PR 检查")
    main(source_only=parser.parse_args().source_only)
