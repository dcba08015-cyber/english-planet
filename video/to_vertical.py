#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""橫式影片 → 直式短影音（1080×1920）

    python to_vertical.py 原影片.mp4 --mode crop      置中裁切
    python to_vertical.py 原影片.mp4 --mode blur      模糊背景填滿
    python to_vertical.py 原影片.mp4 --mode template  上標題／中影片／下字幕（建議）

crop 模式可以調水平位置（主體不在正中間時）：
    python to_vertical.py 原影片.mp4 --mode crop --pan -0.25   往左移
"""
import argparse, shutil, subprocess, sys
from pathlib import Path

W, H = 1080, 1920


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return shutil.which("ffmpeg") or sys.exit("請先執行：pip install imageio-ffmpeg")


FF = ffmpeg()


def run(args):
    p = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", *args],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        sys.exit("ffmpeg 失敗：\n" + p.stdout.decode("utf-8", "ignore")[-1800:])


def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def build(mode, pan, title, sub):
    if mode == "crop":
        # 從原片裁出 9:16。pan：-0.5 最左、0 置中、+0.5 最右
        x = f"(iw-ih*{W}/{H})/2+(iw-ih*{W}/{H})*{pan}"
        return f"[0:v]crop=ih*{W}/{H}:ih:{x}:0,scale={W}:{H},setsar=1[v]"

    if mode == "blur":
        # 模糊放大版當背景，原片原比例置中
        return (f"[0:v]split[bg][fg];"
                f"[bg]scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},gblur=sigma=42,eq=brightness=-0.08[b];"
                f"[fg]scale={W}:-2[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")

    # template 由 make_overlay() 另外處理
    raise RuntimeError("template mode handled separately")


def make_overlay(title, sub, top, vh, dst):
    """用瀏覽器把標題／字幕／品牌線排版成透明 PNG。
    ffmpeg 的 drawtext 多數建置沒編 freetype，中文更是排不出來，所以走這條。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("template 模式需要：pip install playwright && playwright install chromium")
    import os
    html = (Path(__file__).parent / "vertical_frame.html").as_uri()
    with sync_playwright() as pw:
        launch = {}
        if os.environ.get("PW_CHROMIUM"):
            launch["executable_path"] = os.environ["PW_CHROMIUM"]
        b = pw.chromium.launch(**launch)
        p = b.new_page(viewport={"width": W, "height": H})
        p.goto(html, wait_until="networkidle")
        p.evaluate("document.fonts.ready")
        p.wait_for_timeout(300)
        p.evaluate("(o) => window.setFrame(o)",
                   {"title": title, "sub": sub, "top": top, "vh": vh})
        p.screenshot(path=str(dst), omit_background=True)
        b.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--mode", default="template", choices=["crop", "blur", "template"])
    ap.add_argument("--pan", type=float, default=0.0, help="crop 模式的水平位置 -0.5～0.5")
    ap.add_argument("--title", default="", help="template 模式：上方大標")
    ap.add_argument("--sub", default="", help="template 模式：下方字幕")
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    src = Path(a.source)
    if not src.is_absolute():
        src = Path.cwd() / src
    if not src.exists():
        sys.exit(f"找不到影片：{src}")
    out = Path(a.out) if a.out else src.with_name(src.stem + f"-vertical-{a.mode}.mp4")

    if a.mode == "template":
        vh = round(W * 9 / 16 / 2) * 2      # 影片放到 1080 寬之後的高度
        top = (H - vh) // 2 + 90            # 略低於正中，上方留給大標
        import tempfile
        png = Path(tempfile.mkdtemp()) / "overlay.png"
        print("排版標題與字幕…")
        make_overlay(a.title, a.sub, top, vh, png)
        fc = (f"color=c=0xFFF9F2:s={W}x{H}[base];"
              f"[0:v]scale={W}:-2,setsar=1[f];"
              f"[base][f]overlay=0:{top}:shortest=1[o];"
              f"[o][1:v]overlay=0:0[v]")
        args = ["-i", str(src), "-i", str(png), "-filter_complex", fc]
    else:
        fc = build(a.mode, a.pan, a.title, a.sub)
        args = ["-i", str(src), "-filter_complex", fc]
    args += ["-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "slow",
             "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             "-c:a", "aac", "-b:a", "192k", str(out)]
    print(f"{a.mode} 模式轉檔中…")
    run(args)
    print(f"完成 → {out}")


if __name__ == "__main__":
    main()
