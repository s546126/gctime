#!/usr/bin/env python3
"""从 USCIS I-485 库存快照生成「排在你前面的人」数据（data/i485_queue.json），并嵌入 index.html。

  python3 scripts/build_i485_queue.py            # 打印各 cell 汇总，不写文件
  python3 scripts/build_i485_queue.py --write    # 写 data/i485_queue.json + data/china_eb1_pd_density.json
  python3 scripts/build_i485_queue.py --inject   # 另把 JSON 写进 index.html 的 I485Q_BEGIN/I485Q_END 之间

输入：data/raw/uscis/I485_Pending_Inventory_<month>_<year>.xlsx（每月一份，check_data_updates.py 下载）。
每个国别一张表，行 = 类别 × 状态(Available / Awaiting Availability) × PD 月，
列 = PD 年（第一列 'Prior Years' 是更早各年同月的合计）。两种状态都是在案 I-485，相加。

口径：
  · 国别按表区分（China / India / Mexico / Philippines / Rest of the World），不看第 0 列——
    China 表有一行国别列为空。India 的 EB-2/EB-3 在单独的表里，且年份列只到 2015：更晚 PD 记 0。
  · 类别标签精确匹配，'3rd Preference Category (EB3)' 不含 Other Worker(EW3)，EB-4 不含宗教工作者(CRW)。
  · 'D' = USCIS 为保护隐私隐藏的 1–9 件。每格记「确切数」和「D 格数」，页面按 1 / 5 / 9 给出下限 / 估计 / 上限。
  · 只取最近 3 期快照（按文件名年月），供页面比较同一 PD 月在几期之间的变化。
输出确定性：不写时间戳、键顺序固定，数据没变时重跑不产生改动。
"""
import argparse
import glob
import json
import os
import re
import sys
from datetime import date

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USCIS = os.path.join(ROOT, "data", "raw", "uscis")
OUT = os.path.join(ROOT, "data", "i485_queue.json")
DENSITY = os.path.join(ROOT, "data", "china_eb1_pd_density.json")
I140 = os.path.join(USCIS, "I140_I360_I526_Approved_FY2026_Q1.xlsx")   # 与 calibrate_categories.py 同口径
INDEX = os.path.join(ROOT, "index.html")
MONTHS = ["january", "february", "march", "april", "may", "june",
          "july", "august", "september", "october", "november", "december"]
MONTH_TITLE = [m.capitalize() for m in MONTHS]
KEEP = 3          # 页面比较的快照期数
D_EST, D_LO, D_HI = 5, 1, 9

# 页面类别 → 库存里的精确行标签。EB-4/EB-5 暂不收录：EB-5 多走领馆、库存覆盖面窄；
# EB-4 在 2026-10 快照里从 4.4 万骤降到 2,400（ROW），口径变化未明，先不展示。
CATEGORIES = {
    "EB-1": "Employment-Based 1st Preference Category (EB1)",
    "EB-2": "Employment-Based 2nd Preference Category (EB2)",
    "EB-3": "Employment-Based 3rd Preference Category (EB3)",
}
COUNTRY_SHEETS = {
    "CN": {"*": "China"},
    "IN": {"EB-2": "India (EB2 EB3)", "EB-3": "India (EB2 EB3)", "*": "India (EB1 EW3 EB4 CRW EB5)"},
    "MX": {"*": "Mexico"},
    "PH": {"*": "Philippines"},
    "ROW": {"*": "Rest of the World"},
}
# 这些类别 × 国别在任何一期都必须读到行；读不到说明表结构变了，直接失败而不是输出 0
REQUIRED = [f"{c}|{co}" for c in CATEGORIES for co in COUNTRY_SHEETS]


def inventory_files():
    """[((year, month), path)]，按年月升序。"""
    out = []
    for f in glob.glob(os.path.join(USCIS, "I485_Pending_Inventory_*.xlsx")):
        m = re.search(r"I485_Pending_Inventory_([a-z]+)_(\d{4})\.xlsx$", os.path.basename(f))
        if m and m.group(1) in MONTHS:
            out.append(((int(m.group(2)), MONTHS.index(m.group(1)) + 1), f))
    return sorted(out)


def _asof(rows):
    for r in rows[:6]:
        m = re.search(r"As of (\w+) (\d+), (\d{4})", str((r or [None])[0] or ""))
        if m and m.group(1) in MONTH_TITLE:
            return date(int(m.group(3)), MONTH_TITLE.index(m.group(1)) + 1, int(m.group(2))).isoformat()
    return None


def read_snapshot(path):
    """返回 (asof, {cell: {"y0":首个明确年份, "y1":末年, "slots":{slot:(确切数, D格数)}}})。
    slot = 0..11 为 Prior Years 的 1–12 月；之后 12*(年-y0+1)+月-1。"""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets, asofs = {}, set()
    for co, by_cat in COUNTRY_SHEETS.items():
        for sn in set(by_cat.values()):
            if sn in sheets:
                continue
            if sn not in wb.sheetnames:
                raise SystemExit(f"{os.path.basename(path)} 缺少工作表 {sn}")
            rows = list(wb[sn].iter_rows(values_only=True))
            hi = next((i for i, r in enumerate(rows[:12]) if r and r[0] == "Country Of Chargeability"), None)
            if hi is None:
                raise SystemExit(f"{os.path.basename(path)} / {sn} 找不到表头行")
            years = {}
            for ci, c in enumerate(rows[hi]):
                m = re.fullmatch(r"Priority Date Year - (Prior Years|\d{4})", str(c or "").strip())
                if m:
                    years[ci] = "prior" if m.group(1) == "Prior Years" else int(m.group(1))
            ys = sorted(y for y in years.values() if y != "prior")
            if "prior" not in years.values() or len(ys) < 5 or ys != list(range(ys[0], ys[-1] + 1)):
                raise SystemExit(f"{os.path.basename(path)} / {sn} 年份列异常：{list(years.values())}")
            asofs.add(_asof(rows))
            sheets[sn] = (rows[hi + 1:], years, ys[0], ys[-1])
    if len(asofs) != 1 or None in asofs:
        raise SystemExit(f"{os.path.basename(path)} 各表 as-of 日期不一致或缺失：{asofs}")

    cells = {}
    for co, by_cat in COUNTRY_SHEETS.items():
        for cat, label in CATEGORIES.items():
            sn = by_cat.get(cat, by_cat["*"])
            rows, years, y0, y1 = sheets[sn]
            slots, hit = {}, False
            for r in rows:
                if not r or len(r) < 4 or str(r[1] or "").strip() != label:
                    continue
                if str(r[2] or "").strip() not in ("Available", "Awaiting Availability"):
                    raise SystemExit(f"{os.path.basename(path)} / {sn} 未知状态：{r[2]!r}")
                month = str(r[3] or "").strip()
                if month not in MONTH_TITLE:
                    raise SystemExit(f"{os.path.basename(path)} / {sn} 未知 PD 月：{month!r}")
                hit = True
                mi = MONTH_TITLE.index(month)
                for ci, y in years.items():
                    v = r[ci] if ci < len(r) else None
                    slot = mi if y == "prior" else 12 * (y - y0 + 1) + mi
                    n, d = slots.get(slot, (0, 0))
                    if isinstance(v, bool):
                        raise SystemExit(f"{os.path.basename(path)} / {sn} 非数值格：{v!r}")
                    if isinstance(v, (int, float)):
                        n += int(v)
                    elif isinstance(v, str) and v.strip() == "D":
                        d += 1
                    elif isinstance(v, str) and v.strip().isdigit():
                        n += int(v.strip())
                    elif v is None or (isinstance(v, str) and v.strip() in ("", "-")):
                        pass
                    else:
                        raise SystemExit(f"{os.path.basename(path)} / {sn} 无法识别的格：{v!r}")
                    slots[slot] = (n, d)
            key = f"{cat}|{co}"
            if not hit:
                if key in REQUIRED:
                    raise SystemExit(f"{os.path.basename(path)} / {sn} 没有 {label} 行")
                continue
            cells[key] = {"y0": y0, "y1": y1, "slots": slots}
    return asofs.pop(), cells


def encode(cell):
    """紧凑编码：n = 按 slot 排列的确切数（去掉末尾 0），d = [[slot, D格数], ...]。"""
    size = 12 * (cell["y1"] - cell["y0"] + 2)
    n = [cell["slots"].get(i, (0, 0))[0] for i in range(size)]
    while n and n[-1] == 0:
        n.pop()
    d = [[i, cell["slots"][i][1]] for i in range(size) if cell["slots"].get(i, (0, 0))[1]]
    return {"y0": cell["y0"], "y1": cell["y1"], "n": n, "d": d}


def build():
    files = inventory_files()
    if not files:
        raise SystemExit("data/raw/uscis 下没有 I-485 库存文件")
    picked = files[-KEEP:]
    snaps, per_cell = [], {}
    for (y, m), path in picked:
        asof, cells = read_snapshot(path)
        snaps.append({"asof": asof, "file": os.path.basename(path)})
        for key, cell in cells.items():
            per_cell.setdefault(key, {})[asof] = encode(cell)
    if [s["asof"] for s in snaps] != sorted(s["asof"] for s in snaps):
        raise SystemExit("快照 as-of 日期与文件名年月顺序不一致")
    out_cells = {}
    for key in sorted(per_cell):
        # 每期一个元素，与 snapshots 对齐；该期没有这一类别行时为 null
        out_cells[key] = [per_cell[key].get(s["asof"]) for s in snaps]
    doc = {
        "source": "USCIS Form I-485 Pending Applications for Employment-Based Preference Categories",
        "url": "https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data",
        "d": {"lo": D_LO, "est": D_EST, "hi": D_HI},
        "snapshots": snaps,
        "cells": out_cells,
    }
    return doc, picked[-1][1]


def china_eb1_density(path):
    """data/china_eb1_pd_density.json：EB-1 中国按 PD 月的在案 I-485（只计确切数，含 D 的月份不计），
    以及与 I-140 待签总数的比值。口径与 2026-04 版一致（用该版快照重跑可逐项复现）。"""
    asof, cells = read_snapshot(path)
    cell = cells["EB-1|CN"]
    months, total = {}, 0
    for slot in sorted(cell["slots"]):
        n, d = cell["slots"][slot]
        if slot < 12:          # Prior Years 跨多个年份，不按月计，也不计入总数（与旧版一致）
            continue
        total += n
        if d or not n:
            continue
        y = cell["y0"] + slot // 12 - 1
        months[f"{y}-{slot % 12 + 1:02d}"] = n
    wb = openpyxl.load_workbook(I140, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    awaiting = next(r[1] for r in rows if r and r[0] == "China")
    i140_asof = next(str(r[0]) for r in rows if r and str(r[0] or "").startswith("As of"))
    a = date.fromisoformat(asof)
    return {
        "source": f"USCIS I-485 Pending Inventory (As of {MONTH_TITLE[a.month - 1]} {a.day}, {a.year}) + "
                  f"I-140/360/526 Awaiting Visa ({_short_month(i140_asof)})",
        "country": "China",
        "category": "EB1",
        "i485_pd_month_inventory": dict(sorted(months.items())),
        "i485_total_numeric": total,
        "i140_approved_awaiting_visa_total": awaiting,
        "i140_to_i485_ratio": round(awaiting / total, 3),
        "notes": [
            "i485 是已递交 AOS 的人，按真实 PD 月精确分布；仅覆盖当时 DFF 允许递交的 PD，更晚 PD 不在其中(=0 是资格截断，非无需求)。含 D(1–9 件被隐藏)的月份不计入。",
            "i140 awaiting 仅有国别总数、无 PD 维度；用 ratio 把 i485 月密度按比例放大估算总需求(Density Expansion)。",
            "总需求月密度 ≈ i485月值 × ratio。由 scripts/build_i485_queue.py --write 从最新库存快照生成。",
        ],
    }


def _short_month(text):
    """'As of December 2025' → 'As of Dec 2025'（沿用旧文件的写法）。"""
    return re.sub(r"\b(" + "|".join(MONTH_TITLE) + r")\b", lambda m: m.group(1)[:3], text)


def blob(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=False)


def pretty(doc):
    """每个 cell 一行：文件小、按 cell 可读 diff。内容与 blob(doc) 等价。"""
    head = {k: v for k, v in doc.items() if k != "cells"}
    lines = ["{"] + [f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, separators=(',', ':'))}," for k, v in head.items()]
    lines.append(' "cells": {')
    items = list(doc["cells"].items())
    for i, (k, v) in enumerate(items):
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" + ("," if i < len(items) - 1 else ""))
    lines += [" }", "}"]
    return "\n".join(lines) + "\n"


def inject(doc):
    s = open(INDEX, encoding="utf-8").read()
    new = "/*I485Q_BEGIN*/" + blob(doc) + "/*I485Q_END*/"
    s2, n = re.subn(r"/\*I485Q_BEGIN\*/.*?/\*I485Q_END\*/", lambda m: new, s, flags=re.S)
    if n != 1:
        raise SystemExit("index.html 缺 I485Q_BEGIN/I485Q_END 标记")
    if s2 != s:
        open(INDEX, "w", encoding="utf-8").write(s2)
    return s2 != s


def summary(doc):
    snaps = doc["snapshots"]
    print("快照：" + "、".join(f"{s['asof']}({s['file']})" for s in snaps))
    print(f"{'cell':18s} " + " ".join(f"{s['asof']:>16s}" for s in snaps))
    for key, per in doc["cells"].items():
        cols = []
        for enc in per:
            if enc is None:
                cols.append(f"{'—':>16s}")
                continue
            n, dn = sum(enc["n"]), sum(c for _, c in enc["d"])
            cols.append(f"{n:>9,d} +D×{dn:<4d}")
        print(f"{key:18s} " + " ".join(cols))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--inject", action="store_true")
    args = ap.parse_args()
    doc, newest = build()
    summary(doc)
    if args.write or args.inject:
        with open(OUT, "w", encoding="utf-8") as fh:
            fh.write(pretty(doc))
        with open(DENSITY, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(china_eb1_density(newest), ensure_ascii=False, indent=2) + "\n")
        print("写入", os.path.relpath(OUT, ROOT), "和", os.path.relpath(DENSITY, ROOT))
    if args.inject:
        print("已注入 index.html" if inject(doc) else "index.html 无变化")


if __name__ == "__main__":
    sys.exit(main())
