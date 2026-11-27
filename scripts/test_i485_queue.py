#!/usr/bin/env python3
"""I-485 库存解析器回归：钉在已提交的 2026-10-05 快照上，逐格对照手工从 xlsx 读到的值。

跑法：python scripts/test_i485_queue.py（需要 openpyxl）。数据工作流在下载新快照、重建排位数据之前运行，
新文件到达时先确认解析器没坏；钉住旧文件，所以数据窗口滚动不会让它失效。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_i485_queue as B  # noqa: E402

FAILED = []


def check(name, got, want):
    print(f"  {'✅' if got == want else '❌'} {name}" + ("" if got == want else f"\n     期望: {want}\n     实得: {got}"))
    if got != want:
        FAILED.append(name)


def cell(cells, key, year, month):
    c = cells[key]
    slot = month - 1 if year == "prior" else 12 * (year - c["y0"] + 1) + month - 1
    return c["slots"].get(slot, (0, 0))


path = os.path.join(B.USCIS, "I485_Pending_Inventory_october_2026.xlsx")
asof, cells = B.read_snapshot(path)
print("## I485_Pending_Inventory_october_2026.xlsx")
check("as-of 日期", asof, "2026-10-05")
check("只收 EB-1/2/3 × 五国", sorted(cells), sorted(f"{c}|{co}" for c in B.CATEGORIES for co in B.COUNTRY_SHEETS))
# China 表：Available 2023-01 = 221；Awaiting 2023-07 = 595（Available 0）；2024-01 Awaiting = D
check("China EB1 2023-01", cell(cells, "EB-1|CN", 2023, 1), (221, 0))
check("China EB1 2023-07（Awaiting）", cell(cells, "EB-1|CN", 2023, 7), (595, 0))
check("China EB1 2024-01 = D", cell(cells, "EB-1|CN", 2024, 1), (0, 1))
check("China EB1 2023-12（Awaiting 11）", cell(cells, "EB-1|CN", 2023, 12), (11, 0))
check("China EB1 Prior Years 3 月", cell(cells, "EB-1|CN", "prior", 3), (19, 0))
check("China EB1 Prior Years 1 月 = D", cell(cells, "EB-1|CN", "prior", 1), (0, 1))
# India EB-2/EB-3 在单独的表里，年份列 2006–2015
check("India EB2 年份范围", (cells["EB-2|IN"]["y0"], cells["EB-2|IN"]["y1"]), (2006, 2015))
check("India EB2 2013-05", cell(cells, "EB-2|IN", 2013, 5), (188, 0))
check("India EB1 用另一张表（年份到 2026）", cells["EB-1|IN"]["y1"], 2026)
# 合计（确切数 + D 格数），与 build_i485_queue.py 的汇总一致
check("China EB1 合计", (sum(n for n, _ in cells["EB-1|CN"]["slots"].values()),
                        sum(d for _, d in cells["EB-1|CN"]["slots"].values())), (6007, 60))
check("ROW EB3 不含 EW3", sum(n for n, _ in cells["EB-3|ROW"]["slots"].values()), 27871)

print()
if FAILED:
    print(f"❌ {len(FAILED)} 项失败: {FAILED}")
    sys.exit(1)
print("✅ 全部通过")
