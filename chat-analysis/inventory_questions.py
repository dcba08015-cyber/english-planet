#!/usr/bin/env python3
"""盤點工程單位丟給技術客服的問題，產出可逐項處理的清單。

和 analyze_chat.py 的差別：
  analyze_chat.py  回答「問題分布在哪些類別、各佔幾成」
  本工具           回答「工程到底在問哪些事、每件發生幾次」

前者給的是百分比，沒辦法逐一解決；後者給的是一條條具體請求，
每條都能對應到一個處置方式（開放自助、建 SOP、做工具、或維持人工）。

做法：
  1. 篩出丟給技術客服的訊息
  2. 從每則訊息抽出「被請求的動作」——幫X、請協助X、可以X嗎、麻煩X
  3. 正規化後依動作歸併，排出次數
  4. 另輸出分層樣本，供人工或模型閱讀後建立細緻分類

用法：
    python3 inventory_questions.py --input <資料夾> --targets targets.smartdaily.json \\
        --out-dir inventory
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_chat import (  # noqa: E402
    classify_kind, load_messages, load_targets, mention_targets,
)

# 被請求的動作通常跟在這些詞後面。比對時一律取「最長的前綴」，
# 否則「再麻煩你們追蹤」會被短前綴「再麻煩你」切成「們追蹤」。
_ASK_PREFIX = sorted(
    [
        "再麻煩您們協助", "再麻煩你們協助", "再麻煩您協助", "再麻煩你協助",
        "再麻煩您們", "再麻煩你們", "再麻煩協助", "再請協助", "再請幫忙",
        "再麻煩幫忙", "再麻煩幫", "再麻煩您", "再麻煩你", "再麻煩",
        "麻煩您們協助", "麻煩你們協助", "麻煩您協助", "麻煩你協助",
        "麻煩您們", "麻煩你們", "麻煩幫忙", "麻煩幫", "麻煩您", "麻煩你", "麻煩",
        "煩請協助", "煩請", "請協助", "請幫我", "請幫忙", "請幫",
        "協助確認", "幫忙確認", "幫我確認", "幫確認",
        "幫我", "幫忙", "幫",
        "可不可以", "是否可以", "能不能", "可以",
        "想請問", "請問", "問一下",
    ],
    key=len, reverse=True,
)

# 單獨出現沒有辨識價值的動作，標記起來另外處理而不是混入排行
_TOO_VAGUE = {"確認", "看看", "處理", "協助", "幫忙", "追蹤", "安排", "查", "看"}

# 動作描述到這些字就結束了
_ASK_SUFFIX = re.compile(
    r"(嗎|呢|謝謝|感謝|感恩|3Q|thanks|謝|唷|喔|哦|囉|了|\?|？|！|!|。|，|,|$)"
)

# 這些字出現在動作裡沒有辨識價值，正規化時拿掉
_NOISE = re.compile(r"[一-鿿]{0,4}(社區|大樓|廣場|花園|名邸|世紀|家園)")
_NUM = re.compile(r"[0-9０-９]+")
_EN = re.compile(r"[A-Za-z]{3,}")


def extract_ask(text: str) -> str | None:
    """抽出這則訊息在請求什麼動作，抽不出來回傳 None。

    取最早出現的位置；同一位置上取最長的前綴，避免動作被切頭。
    """
    best: tuple[int, int] | None = None   # (位置, 前綴長度)
    for prefix in _ASK_PREFIX:
        idx = text.find(prefix)
        if idx < 0:
            continue
        if best is None or idx < best[0] or (idx == best[0] and len(prefix) > best[1]):
            best = (idx, len(prefix))

    if best is None:
        return None

    prefix = text[best[0]: best[0] + best[1]]
    rest = text[best[0] + best[1]:].strip()

    if not rest:
        # 「…已更換NAT 幫確認」這種結尾式請求：動作就是前綴本身，
        # 受詞是前面整段完工回報。這是本群組量最大的一類，不能算抽取失敗。
        return prefix if prefix in ("幫確認", "幫忙確認", "幫我確認") else None
    end = _ASK_SUFFIX.search(rest)
    action = (rest[: end.start()] if end and end.start() > 0 else rest).strip(" 　,，。、")
    return action if 2 <= len(action) <= 24 else None


def normalise(action: str) -> str:
    """把社區名、門牌號、型號抽掉，只留動作本身，方便歸併同類請求。"""
    a = _NUM.sub("#", action)
    a = _EN.sub("X", a)
    a = _NOISE.sub("", a)
    return a.strip() or action


def main() -> int:
    ap = argparse.ArgumentParser(description="盤點工程丟給技術客服的問題")
    ap.add_argument("--input", required=True, help="訊息資料夾或 messages.json")
    ap.add_argument("--targets", required=True, help="收件單位對照表 JSON")
    ap.add_argument("--unit", default="技術客服", help="要盤點哪個收件單位")
    ap.add_argument("--out-dir", default="inventory", help="輸出目錄")
    ap.add_argument("--sample", type=int, default=400, help="分層樣本筆數")
    args = ap.parse_args()

    targets = load_targets(Path(args.targets).expanduser())
    msgs = [m for m in load_messages(Path(args.input).expanduser()) if m.dt]

    inbound = [
        m for m in msgs
        if classify_kind(m.text) and mention_targets(m.text, targets) == [args.unit]
    ]
    if not inbound:
        print(f"[error] 找不到丟給「{args.unit}」的訊息。", file=sys.stderr)
        return 1

    months = len({m.dt.strftime("%Y-%m") for m in inbound}) or 1

    asks: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    unparsed: list[str] = []

    for m in inbound:
        action = extract_ask(m.text)
        if not action:
            unparsed.append(m.text)
            continue
        key = normalise(action)
        if key in _TOO_VAGUE:
            key = f"（籠統）{key}"
        asks[key] += 1
        if len(examples[key]) < 5:
            examples[key].append(m.text.replace("\n", " ")[:160])

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) 請求動作排行，供後續歸納成問題清單
    with (out_dir / "asks.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["請求動作", "次數", "每月約", "原文範例", "歸納問題", "建議解法"])
        for key, n in asks.most_common():
            w.writerow([key, n, round(n / months, 1), " ｜ ".join(examples[key][:3]), "", ""])

    # 2) 分層樣本：每月等量抽取，供人工或模型閱讀後建立細緻分類
    by_month: dict[str, list] = defaultdict(list)
    for m in inbound:
        by_month[m.dt.strftime("%Y-%m")].append(m)
    per = max(1, args.sample // len(by_month))
    rng = random.Random(20260101)
    sample = []
    for month in sorted(by_month):
        pool = by_month[month]
        sample.extend(rng.sample(pool, min(per, len(pool))))

    with (out_dir / "sample.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["日期", "原文", "抽出的請求動作", "歸納問題"])
        for m in sample:
            w.writerow([
                m.dt.strftime("%Y-%m-%d"),
                m.text.replace("\n", " "),
                extract_ask(m.text) or "",
                "",
            ])

    parsed = sum(asks.values())
    print(f"丟給「{args.unit}」的需回應訊息：{len(inbound):,} 則，橫跨 {months} 個月")
    print(f"  成功抽出請求動作：{parsed:,} ({parsed / len(inbound):.1%})")
    print(f"  抽不出動作：{len(unparsed):,} ({len(unparsed) / len(inbound):.1%})")
    print(f"  不重複動作樣式：{len(asks):,}")
    print()
    print("前 25 名請求動作：")
    for key, n in asks.most_common(25):
        print(f"  {n:>5}  ({n / months:>5.1f}/月)  {key}")
    print()
    print(f"輸出：{out_dir / 'asks.csv'}　（請求動作排行，含歸納與建議欄位）")
    print(f"　　　{out_dir / 'sample.csv'}　（{len(sample)} 筆分層樣本，供閱讀歸納）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
