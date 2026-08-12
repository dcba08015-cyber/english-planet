#!/usr/bin/env python3
"""從 Google Takeout 的巨大 zip 裡，只挑出聊天記錄的 JSON。

Google Chat 的 Takeout 匯出會把群組裡分享過的圖片、影片全部包進去，
動輒數十 GB；但「訊息文字」只存在 messages.json 裡，通常只有幾 MB。

這支工具讀取 zip 的檔案索引，只解出 messages.json 與 group_info.json，
不碰任何附件，所以就算來源是 40GB 也能在幾秒內跑完。

Takeout 的資料夾名稱是一串看不懂的 ID（Space AAAAxxxx、DM xxxx），
所以先用 --list 把每個群組的「真實名稱」列出來：

    python3 extract_json.py --input ~/Downloads/ --list

確認要哪個之後再抽取：

    python3 extract_json.py --input ~/Downloads/
    python3 extract_json.py --input ~/Downloads/ --space "客服"

預設只處理群組（Space），會跳過一對一私訊（DM）—— 私訊通常是私人對話，
不該混進群組統計，也不該被一起分享出去。真的需要才加 --include-dms。

輸出一個 chat-json/ 資料夾，以及一個可以直接分享的 chat-json.zip，
接著就能餵給 analyze_chat.py：

    python3 analyze_chat.py --input chat-json.zip
"""

from __future__ import annotations

import argparse
import json
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


def is_dm(zip_member_path: str) -> bool:
    """Takeout 用資料夾前綴區分：Space ... 是群組，DM ... 是一對一私訊。"""
    parts = Path(zip_member_path).parts
    folder = parts[-2] if len(parts) >= 2 else ""
    return folder.startswith("DM ")


def read_space_name(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> str:
    """從 group_info.json 讀出群組的顯示名稱。"""
    try:
        with zf.open(info) as fh:
            payload = json.loads(fh.read().decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError):
        return "(讀取失敗)"
    name = payload.get("name")
    if name:
        return str(name)
    members = payload.get("members") or []
    who = "、".join(str(m.get("name", "?")) for m in members[:4])
    return f"(未命名，成員：{who})" if who else "(未命名)"


def list_spaces(zips: list[Path], include_dms: bool) -> int:
    """把每個聊天室的資料夾 ID 與真實名稱印出來，不解出任何檔案。"""
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    for zpath in zips:
        try:
            zf = zipfile.ZipFile(zpath)
        except zipfile.BadZipFile:
            print(f"[warn] {zpath.name} 不是有效的 zip，略過", file=sys.stderr)
            continue
        with zf:
            for info in zf.infolist():
                if os.path.basename(info.filename) != "group_info.json":
                    continue
                if not include_dms and is_dm(info.filename):
                    continue
                folder = Path(info.filename).parts[-2]
                if folder in seen:
                    continue
                seen.add(folder)
                rows.append((folder, read_space_name(zf, info), zpath.name))

    if not rows:
        print(
            "\n沒有找到任何群組（Space）。\n"
            "可能這批 zip 裡只有一對一私訊，或群組資料在另一個 part 裡。\n"
            "把四個 zip 都放進同一個資料夾再跑一次，或加 --include-dms 看私訊。",
            file=sys.stderr,
        )
        return 1

    rows.sort(key=lambda r: r[1])
    width = max(len(r[0]) for r in rows)
    print(f"\n找到 {len(rows)} 個聊天室：\n")
    print(f"  {'資料夾 ID'.ljust(width)}   群組名稱")
    print(f"  {'-' * width}   {'-' * 40}")
    for folder, name, source in rows:
        print(f"  {folder.ljust(width)}   {name}")
    print("\n記下你要的群組名稱，然後用 --space \"名稱的一部分\" 抽取它。\n")
    return 0


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
        "--list", action="store_true",
        help="只列出每個群組的資料夾 ID 與真實名稱，不解出任何檔案",
    )
    parser.add_argument(
        "--space", help="只抽取名稱含此字串的群組（子字串比對、不分大小寫）"
    )
    parser.add_argument(
        "--include-dms", action="store_true",
        help="連一對一私訊也一起抽取（預設跳過）",
    )
    parser.add_argument(
        "--no-zip", action="store_true", help="只輸出資料夾，不另外打包成 zip"
    )
    args = parser.parse_args()

    zips = collect_zips(args.input)
    if not zips:
        print("[error] 沒有找到任何 zip 檔。", file=sys.stderr)
        return 1

    if args.list:
        return list_spaces(zips, args.include_dms)

    # 先建立「資料夾 ID → 群組名稱」對照表，--space 才能用名稱比對
    folder_names: dict[str, str] = {}
    for zpath in zips:
        try:
            zf = zipfile.ZipFile(zpath)
        except zipfile.BadZipFile:
            continue
        with zf:
            for info in zf.infolist():
                if os.path.basename(info.filename) == "group_info.json":
                    folder = Path(info.filename).parts[-2]
                    folder_names.setdefault(folder, read_space_name(zf, info))

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
                if not args.include_dms and is_dm(info.filename):
                    continue

                # 攤平成 <空間名>/<檔名>，避免 Takeout 的長路徑
                parts = Path(info.filename).parts
                space = parts[-2] if len(parts) >= 2 else "unknown"

                if args.space:
                    display = folder_names.get(space, space)
                    if args.space.lower() not in display.lower():
                        continue

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
        hint = (
            f"        沒有名稱含「{args.space}」的群組，先用 --list 看看有哪些。"
            if args.space
            else "        確認匯出時有勾選 Google Chat，而不是別的服務。\n"
                 "        若只看到 DM（私訊），群組資料可能在另一個 part 的 zip 裡。"
        )
        print(f"\n[error] 沒有抽出任何 messages.json。\n{hint}", file=sys.stderr)
        return 1

    print(f"\n{'=' * 54}")
    extracted = sorted({p.parent.name for p in out_dir.rglob("messages.json")})
    print(f"  抽出的群組：")
    for folder in extracted:
        print(f"    · {folder_names.get(folder, folder)}")
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
