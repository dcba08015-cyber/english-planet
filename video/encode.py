#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""frames/*.png → out/zhibao-<ep>.mp4（Python 版，不需要 bash）

    python encode.py ep01
"""
import argparse, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent


def ffmpeg_bin():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        exe = shutil.which("ffmpeg")
        return exe or sys.exit("請先執行：pip install imageio-ffmpeg")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode", nargs="?", default="ep01")
    ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args()

    frames = HERE / "frames"
    if not any(frames.glob("*.png")):
        sys.exit("frames/ 是空的，請先執行 python render.py")
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    dst = out / f"zhibao-{a.episode}.mp4"

    cmd = [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error",
           "-framerate", str(a.fps), "-i", str(frames / "%05d.png"),
           "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
           "-shortest",
           "-c:v", "libx264", "-preset", "slow", "-crf", "19",
           "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
           "-g", str(a.fps * 2), "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k", str(dst)]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        sys.exit(p.stdout.decode("utf-8", "ignore")[-1500:])
    print(f"完成 → {dst}")


if __name__ == "__main__":
    main()
