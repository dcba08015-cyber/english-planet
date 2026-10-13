#!/usr/bin/env python3
"""把工程丟給技術客服的訊息，依問題分類表歸類，產出可逐項處理的清單。

和 inventory_questions.py 的差別：
  inventory_questions.py  用正規表示式抽出「請求動作」，產出的是原始素材
  本工具                  套用人工歸納的分類表，產出的是可逐項處理的問題清單

分類表（taxonomy.engineering-asks.json）不是從關鍵字頻率推出來的，
是實際閱讀樣本後歸納的；本工具只負責把它套用到全部訊息並統計。

分類由上往下比對，第一個命中的算數，因此分類表的順序本身就是判斷邏輯。

用法：
    python3 classify_asks.py --input <資料夾> --targets targets.smartdaily.json \\
        --taxonomy taxonomy.engineering-asks.json --out-dir out
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_chat import (  # noqa: E402
    classify_kind, load_messages, load_targets, mention_targets,
)

UNMATCHED = ("Z", "未歸類")


def load_taxonomy(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data["categories"]


def classify(text: str, taxonomy: list[dict]) -> tuple[str, str]:
    for cat in taxonomy:
        if any(p in text for p in cat["patterns"]):
            return cat["code"], cat["name"]
    return UNMATCHED


def main() -> int:
    ap = argparse.ArgumentParser(description="依分類表歸類工程丟給客服的問題")
    ap.add_argument("--input", required=True)
    ap.add_argument("--targets", required=True)
    ap.add_argument("--taxonomy", required=True)
    ap.add_argument("--unit", default="技術客服")
    ap.add_argument("--out-dir", default="asks-classified")
    ap.add_argument("--examples", type=int, default=6)
    args = ap.parse_args()

    taxonomy = load_taxonomy(Path(args.taxonomy).expanduser())
    targets = load_targets(Path(args.targets).expanduser())
    msgs = [m for m in load_messages(Path(args.input).expanduser()) if m.dt]

    inbound = [
        m for m in msgs
        if classify_kind(m.text) and mention_targets(m.text, targets) == [args.unit]
    ]
    if not inbound:
        print(f"[error] 找不到丟給「{args.unit}」的訊息。", file=sys.stderr)
        return 1

    months = sorted({m.dt.strftime("%Y-%m") for m in inbound})
    n_months = len(months) or 1

    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    examples: dict[str, list] = defaultdict(list)
    monthly: dict[str, Counter[str]] = defaultdict(Counter)
    rows = []

    for m in inbound:
        code, name = classify(m.text, taxonomy)
        counts[code] += 1
        names[code] = name
        monthly[code][m.dt.strftime("%Y-%m")] += 1
        if len(examples[code]) < args.examples:
            examples[code].append(m)
        rows.append({
            "日期": m.dt.strftime("%Y-%m-%d %H:%M"),
            "分類代碼": code,
            "問題類型": name,
            "原文": m.text.replace("\n", " "),
        })

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    with (out_dir / "classified.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    summary = []
    for code, n in counts.most_common():
        summary.append({
            "分類代碼": code,
            "問題類型": names[code],
            "件數": n,
            "每月約": round(n / n_months, 1),
            "佔比": f"{n / len(inbound):.1%}",
            "月分布": " / ".join(f"{mo}:{monthly[code].get(mo, 0)}" for mo in months),
            "原文範例": " ｜ ".join(m.text.replace("\n", " ")[:70] for m in examples[code][:3]),
            "目前怎麼處理": "",
            "建議解法": "",
        })

    with (out_dir / "summary.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(summary[0].keys()))
        w.writeheader()
        w.writerows(summary)

    matched = len(inbound) - counts[UNMATCHED[0]]
    print(f"丟給「{args.unit}」的需回應訊息：{len(inbound):,} 則")
    print(f"期間 {months[0]} ~ {months[-1]}（{n_months} 個月），每月約 {len(inbound) / n_months:.0f} 則")
    print(f"歸類成功：{matched:,} ({matched / len(inbound):.1%})"
          f"　未歸類：{counts[UNMATCHED[0]]:,} ({counts[UNMATCHED[0]] / len(inbound):.1%})")
    print()
    print(f"{'代碼':<5}{'問題類型':<24}{'件數':>6}{'每月':>7}{'佔比':>8}")
    print("-" * 56)
    for code, n in counts.most_common():
        label = names[code]
        pad = 24 - sum(2 if "⺀" <= c <= "鿿" else 1 for c in label)
        print(f"{code:<5}{label}{' ' * max(1, pad)}{n:>6}{n / n_months:>7.0f}{n / len(inbound):>8.1%}")
    print()
    print(f"輸出：{out_dir / 'summary.csv'}　（問題清單，含待填的處理方式與建議解法）")
    print(f"　　　{out_dir / 'classified.csv'}　（每則訊息的分類，可人工校對）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
