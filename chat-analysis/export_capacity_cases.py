#!/usr/bin/env python3
"""匯出「約工表顯示無能量」的例外案件，供人工比對分析。

第二順位改善項目要回答的問題是：約工表說沒有能量，但人工協調後多半排得掉，
那被系統忽略的能量從哪裡來。要回答它必須逐件比對「約工表當下的狀態」與
「最終實際排入的時段」。

這支腳本把比對所需的左半邊先備妥——案件時間、原始請求、後續對話、
首次回應時間、以及從對話推得的初步研判——剩下兩欄由承辦人填入系統端資料。

用法：
    python3 export_capacity_cases.py --input <資料夾> --out cases.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_chat import load_messages  # noqa: E402

CAPACITY = re.compile(
    r"無能量|沒能量|查無.{0,3}能量|無可約|無相關時間|能量可派|無能量可排|無可約時段"
)
URGENT = re.compile(r"客不接受|希望|盡快|緊急|急件|優先|今天|當天")
DPLUS = re.compile(r"[Dd]\s*\+\s*(\d)")
SCHEDULED = re.compile(r"[Dd]one|OK|ok|好的|可以|沒問題|安排好|排好|已排|已約")
REFUSED = re.compile(r"不行|沒辦法|真的沒|排不進|只能等|最快也")
SLOT = re.compile(r"\d{1,2}\s*[/／-]\s*\d{1,2}|\d{1,2}:\d{2}")

# 供人工歸類用的落差原因選項，一併寫進表頭說明
REASONS = [
    "保留緩衝過大",
    "順工機會未計入",
    "資料更新延遲",
    "跨區支援未列為可用能量",
    "外包能量未計入",
    "特殊技能／料件限制",
    "實際確無能量（系統正確）",
    "其他",
]


def taipei(dt):
    return dt + timedelta(hours=8)


def main() -> int:
    ap = argparse.ArgumentParser(description="匯出約工表無能量的例外案件")
    ap.add_argument("--input", required=True, help="訊息資料夾或 messages.json")
    ap.add_argument("--out", default="capacity-cases.csv", help="輸出 CSV")
    ap.add_argument("--context", type=int, default=3, help="擷取幾則後續對話（預設 3）")
    ap.add_argument("--window", type=int, default=120, help="後續對話的時間窗（分鐘）")
    args = ap.parse_args()

    msgs = [m for m in load_messages(Path(args.input).expanduser()) if m.dt]
    msgs.sort(key=lambda m: m.dt)

    rows = []
    for i, m in enumerate(msgs):
        if not CAPACITY.search(m.text):
            continue

        replies, first_gap = [], ""
        for j in range(i + 1, min(i + 12, len(msgs))):
            n = msgs[j]
            if (n.dt - m.dt) > timedelta(minutes=args.window):
                break
            if n.author == m.author:
                continue
            if not first_gap:
                first_gap = f"{(n.dt - m.dt).total_seconds() / 60:.0f}"
            replies.append(n.text.replace("\n", " "))
            if len(replies) >= args.context:
                break

        blob = " ".join(replies)
        if REFUSED.search(blob):
            verdict = "疑似婉拒／延後"
        elif SCHEDULED.search(blob) or SLOT.search(blob):
            verdict = "疑似已排定"
        elif not replies:
            verdict = "無後續"
        else:
            verdict = "待判讀"

        dn = DPLUS.search(m.text)
        rows.append({
            "案件時間": taipei(m.dt).strftime("%Y-%m-%d %H:%M"),
            "D+N": dn.group(1) if dn else "",
            "急迫性": "是" if URGENT.search(m.text) else "",
            "原始請求": m.text.replace("\n", " "),
            "首次回應(分)": first_gap,
            "後續對話": " ｜ ".join(replies),
            "初步研判": verdict,
            "約工表當下狀態": "",
            "最終排入時段": "",
            "落差原因": "",
            "備註": "",
        })

    out = Path(args.out).expanduser()
    with out.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    from collections import Counter
    stat = Counter(r["初步研判"] for r in rows)
    urgent = sum(1 for r in rows if r["急迫性"])
    d1 = sum(1 for r in rows if r["D+N"] == "1")

    print(f"匯出 {len(rows):,} 件 -> {out}")
    print(f"  D+1 案件      {d1:,} ({d1 / len(rows):.1%})")
    print(f"  帶急迫性      {urgent:,} ({urgent / len(rows):.1%})")
    for k, n in stat.most_common():
        print(f"  {k:<12}{n:>6} ({n / len(rows):>5.1%})")
    print()
    print("待填欄位：約工表當下狀態、最終排入時段、落差原因")
    print("落差原因建議選項：" + "／".join(REASONS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
