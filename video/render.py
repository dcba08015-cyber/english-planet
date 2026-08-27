#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐格渲染 scene.html → frames/*.png（Python 版，不需要 Node）

    pip install playwright imageio-ffmpeg
    playwright install chromium
    python render.py            # 產生 frames/
    python encode.py ep01       # frames → out/zhibao-ep01.mp4
"""
import argparse, os, shutil, sys
from pathlib import Path

HERE = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out", default="frames")
    ap.add_argument("--scale", type=float, default=1.0, help="0.5 = 540x960 快速預覽")
    a = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("請先執行：pip install playwright && playwright install chromium")

    W, H = int(1080 * a.scale), int(1920 * a.scale)
    out = HERE / a.out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    with sync_playwright() as pw:
        # PW_CHROMIUM 可指定既有的 Chromium，避免重複下載瀏覽器
        launch = {"args": ["--force-color-profile=srgb", "--font-render-hinting=none"]}
        if os.environ.get("PW_CHROMIUM"):
            launch["executable_path"] = os.environ["PW_CHROMIUM"]
        browser = pw.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1080, "height": 1920},
                                device_scale_factor=a.scale)
        page.goto((HERE / "scene.html").as_uri(), wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(400)

        dur = page.evaluate("window.VIDEO_DURATION")
        total = round(dur * a.fps)
        print(f"渲染 {total} 格 @ {a.fps}fps（{dur} 秒，{W}x{H}）")
        for i in range(total):
            page.evaluate("(t) => window.setT(t)", i / a.fps)
            page.screenshot(path=str(out / f"{i:05d}.png"), animations="disabled")
            if i % 60 == 0:
                print(f"  {i}/{total}")
        browser.close()
    print(f"完成 → {out}")


if __name__ == "__main__":
    main()
