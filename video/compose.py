#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把真人代理人影片去背後，合成到動畫圖層上（Windows / Mac / Linux 通用）

單一片段（人物全程同一個待機動作）：
    python compose.py presenter/idle.mp4 --name ep01-v3

多段接續（動作跟著內容走，實際production用這個）：
    python compose.py presenter/ep01.txt --name ep01-v3

presenter/ep01.txt 的格式（起始秒數 + 檔名）：
    0     a-open.mp4
    6     b-point-left.mp4
    19    c-pull.mp4
    33    d-wait.mp4
    42    e-phone.mp4

每一段會自動「正播＋倒播」循環填滿它負責的秒數，段與段之間做 0.4 秒交叉溶接，
所以人物**從頭到尾都在動**，不會有定格或跳接。
"""
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).parent
FPS = 30
# 版面保留給人物的位置
CROP = "660:1174:210:150"   # 從 1080x1920 原始畫面裁出頭到大腿
SIZE = (460, 818)
POS = (595, 680)
XFADE = 0.4                  # 段與段之間的交叉溶接秒數


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


def duration(path):
    p = subprocess.run([FF, "-i", str(path)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for line in p.stdout.decode("utf-8", "ignore").splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    sys.exit(f"讀不到長度：{path}")


def pingpong(src, dst):
    """正播 + 倒播，接點不會跳"""
    run(["-i", str(src), "-filter_complex",
         "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]",
         "-map", "[v]", "-an", "-r", str(FPS),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", str(dst)])


def fill(src, seconds, dst):
    """把一段素材循環填滿指定秒數"""
    run(["-stream_loop", "-1", "-i", str(src), "-t", f"{seconds:.3f}",
         "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", str(dst)])


def xfade(a, b, a_dur, dst):
    """把 b 溶接到 a 後面"""
    off = max(0.0, a_dur - XFADE)
    run(["-i", str(a), "-i", str(b), "-filter_complex",
         f"[0:v][1:v]xfade=transition=fade:duration={XFADE}:offset={off:.3f}[v]",
         "-map", "[v]", "-r", str(FPS),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", str(dst)])


def build_track(spec, total, tmp):
    """依照分鏡表組出一條「全程都在動」的人物軌"""
    segs = []
    for i, (start, clip) in enumerate(spec):
        end = spec[i + 1][0] if i + 1 < len(spec) else total
        # 除了最後一段，每段都多做 XFADE 秒給溶接用
        need = end - start + (XFADE if i + 1 < len(spec) else 0)
        pp = tmp / f"pp{i}.mp4"
        pingpong(clip, pp)
        f = tmp / f"seg{i}.mp4"
        fill(pp, need, f)
        segs.append((f, need))
        print(f"  {start:>5.1f}s – {end:>5.1f}s　{Path(clip).name}")

    acc, acc_dur = segs[0]
    for i, (nxt, nxt_dur) in enumerate(segs[1:], 1):
        out = tmp / f"acc{i}.mp4"
        xfade(acc, nxt, acc_dur, out)
        acc, acc_dur = out, acc_dur + nxt_dur - XFADE
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="人物影片，或分鏡表 .txt")
    ap.add_argument("--name", default="ep01-v3")
    ap.add_argument("--frames", default="frames")
    ap.add_argument("--key", default="0xD9D9D9", help="背景色。綠幕用 0x00B140")
    ap.add_argument("--sim", default="0.26", help="去背容忍度，殘影就調高")
    ap.add_argument("--blend", default="0.10")
    ap.add_argument("--duration", type=float, default=48.0)
    a = ap.parse_args()

    frames = HERE / a.frames
    if not any(frames.glob("*.png")):
        sys.exit(f"{frames} 是空的，請先執行 node render-v3.mjs")
    (HERE / "out").mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    src = Path(a.source)
    if not src.is_absolute():
        src = HERE / src

    if src.suffix.lower() == ".txt":
        spec = []
        for line in src.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if not line:
                continue
            t, clip = line.split(None, 1)
            p = (src.parent / clip.strip())
            if not p.exists():
                sys.exit(f"找不到片段：{p}")
            spec.append((float(t), p))
        if not spec:
            sys.exit("分鏡表是空的")
        spec.sort()
        print(f"組合 {len(spec)} 段人物影片：")
        track = build_track(spec, a.duration, tmp)
    else:
        print(f"單一片段模式：{src.name}（循環填滿 {a.duration} 秒）")
        pp = tmp / "pp.mp4"
        pingpong(src, pp)
        track = tmp / "track.mp4"
        fill(pp, a.duration, track)

    out = HERE / "out" / f"zhibao-{a.name}.mp4"
    print("去背合成中…")
    run(["-framerate", str(FPS), "-i", str(frames / "%05d.png"),
         "-i", str(track), "-filter_complex",
         f"[1:v]crop={CROP},scale={SIZE[0]}:{SIZE[1]},"
         f"colorkey={a.key}:{a.sim}:{a.blend},format=yuva420p[p];"
         f"[0:v][p]overlay={POS[0]}:{POS[1]}:shortest=1[o]",
         "-map", "[o]", "-t", str(a.duration),
         "-c:v", "libx264", "-preset", "slow", "-crf", "19",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)])
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"完成 → {out}")


if __name__ == "__main__":
    main()
