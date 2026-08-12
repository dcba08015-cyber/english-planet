#!/usr/bin/env python3
"""從 Google Takeout 的巨大 zip 裡，只挑出聊天記錄的 JSON。

Google Chat 的 Takeout 匯出會把群組裡分享過的圖片、影片全部包進去，
動輒數十 GB；但「訊息文字」只存在 messages.json 裡，通常只有幾 MB。

這支工具讀取 zip 的檔案索引，只解出 messages.json 與 group_info.json，
不碰任何附件，所以就算來源是 40GB 也能在幾秒內跑完。

用法：
    # 處理整個資料夾裡的所有 takeout zip
    python3 extract_json.py --input ~/Downloads/

    # 或明確指定
    python3 extract_json.py --input takeout-001.zip takeout-002.zip

輸出一個 chat-json/ 資料夾，以及一個可以直接分享的 chat-json.zip，
接著就能餵給 analyze_chat.py：

    python3 analyze_chat.py --input chat-json.zip
"""

from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path

WANTED = {"messages.json", "group_info.json", "user_info.json"}


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024.0
    return f"{n:.1f}TB"


def collect_zips(inputs: list[str]) -> list[Path]:
    zips: list[Path] = []
    for raw in inputs:
        path = Path(raw).expanduser()
        if path.is_dir():
            zips.extend(sorted(p for p in path.glob("*.zip") if p.is_file()))
        elif path.is_file():
            zips.append(path)
        else:
            print(f"[warn] 找不到：{path}", file=sys.stderr)
    return zips


def main() -> int:
    parser = argparse.ArgumentParser(
        description="從 Takeout 的大 zip 裡只抽出聊天 JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--input", nargs="+", required=True,
        help="Takeout 的 zip 檔（可多個），或包含這些 zip 的資料夾",
    )
    parser.add_argument("--out-dir", default="chat-json", help="輸出資料夾（預設 chat-json）")
    parser.add_argument(
        "--no-zip", action="store_true", help="只輸出資料夾，不另外打包成 zip"
    )
    args = parser.parse_args()

    zips = collect_zips(args.input)
    if not zips:
        print("[error] 沒有找到任何 zip 檔。", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    total_found = 0
    total_bytes = 0
    skipped_bytes = 0
    seen: set[str] = set()

    for zpath in zips:
        print(f"\n掃描 {zpath.name}  ({human(zpath.stat().st_size)})", file=sys.stderr)
        try:
            zf = zipfile.ZipFile(zpath)
        except zipfile.BadZipFile:
            print(f"  [warn] 不是有效的 zip，略過", file=sys.stderr)
            continue

        with zf:
            found_here = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if os.path.basename(info.filename) not in WANTED:
                    skipped_bytes += info.file_size
                    continue

                # 攤平成 <空間名>/<檔名>，避免 Takeout 的長路徑
                parts = Path(info.filename).parts
                space = parts[-2] if len(parts) >= 2 else "unknown"
                target_rel = f"{space}/{os.path.basename(info.filename)}"

                if target_rel in seen:
                    continue  # 多個 zip 之間可能重複
                seen.add(target_rel)

                target = out_dir / target_rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, target.open("wb") as dst:
                    dst.write(src.read())

                found_here += 1
                total_found += 1
                total_bytes += info.file_size

            print(f"  取出 {found_here} 個 JSON", file=sys.stderr)

    if total_found == 0:
        print(
            "\n[error] 這些 zip 裡沒有找到 messages.json。\n"
            "        確認匯出時有勾選 Google Chat，而不是別的服務。",
            file=sys.stderr,
        )
        return 1

    print(f"\n{'=' * 54}")
    print(f"  取出 {total_found} 個 JSON 檔，共 {human(total_bytes)}")
    print(f"  略過附件 {human(skipped_bytes)}（圖片／影片，用不到）")
    print(f"  輸出：{out_dir}/")

    if not args.no_zip:
        bundle = out_dir.with_suffix(".zip")
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as z:
            for path in sorted(out_dir.rglob("*")):
                if path.is_file():
                    z.write(path, path.relative_to(out_dir.parent).as_posix())
        print(f"        {bundle}  ({human(bundle.stat().st_size)})  ← 傳這個就好")

    print(f"{'=' * 54}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
