#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""智寶網路急救室 EP01 — 一鍵配音（Windows / Mac / Linux 都能跑）

這個檔案是獨立的，不需要整包程式碼。把它跟 zhibao-ep01.mp4 放在同一個資料夾，然後：

    pip install edge-tts imageio-ffmpeg
    python make_ep01.py

會產生 zhibao-ep01-voiced.mp4（含台灣女聲旁白）。

要加背景音樂：
    python make_ep01.py --bgm bgm.mp3

只想聽旁白、先對時間：
    python make_ep01.py --vo-only
"""
import argparse, asyncio, os, shutil, subprocess, sys, tempfile, wave
from pathlib import Path

DURATION = 36.0
VOICE, RATE, PITCH = "zh-TW-HsiaoChenNeural", "+8%", "+0Hz"

# 旁白：(出現秒數, 文字)
NARRATION = [
    (0.35,  "WiFi 滿格，卻上不了網？"),
    (2.50,  "三行指令抓出兇手。"),
    (4.60,  "第一步，先確認你到分享器。"),
    (7.40,  "ping 分享器，192.168.1.1。"),
    (10.70, "秒回，這段就沒問題。"),
    (13.90, "第二步，換確認對外。"),
    (16.70, "這次 ping 外面的 8.8.8.8。"),
    (20.40, "也通，線路正常。"),
    (22.90, "第三步，只剩下它了。"),
    (25.30, "改打網址，用 nslookup。"),
    (27.70, "Server failed，兇手是 DNS。"),
    (31.60, "解法：DNS 改成 1.1.1.1。"),
    (34.40, "記得追蹤智寶。"),
]


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
        sys.exit("找不到 ffmpeg。請執行：pip install imageio-ffmpeg")


FFMPEG = None


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        sys.exit(f"ffmpeg 失敗：\n{p.stdout.decode('utf-8', 'ignore')[-1500:]}")


def synth(text, out_wav, silent=False):
    """合成一句話成 44.1kHz 單聲道 wav。"""
    if silent:  # --dry-run：用等長靜音代替，純粹拿來驗證流程
        run([FFMPEG, "-y", "-f", "lavfi", "-i",
             f"anullsrc=r=44100:cl=mono:d={len(text)*0.22:.2f}", str(out_wav)])
        return
    import edge_tts
    mp3 = out_wav.with_suffix(".mp3")

    async def go():
        await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(str(mp3))
    asyncio.run(go())
    run([FFMPEG, "-y", "-i", str(mp3), "-ar", "44100", "-ac", "1", str(out_wav)])
    mp3.unlink(missing_ok=True)


def wav_seconds(p):
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()


def main():
    global FFMPEG
    ap = argparse.ArgumentParser()
    ap.add_argument("video", nargs="?", default="zhibao-ep01.mp4", help="來源影片")
    ap.add_argument("--bgm", default="", help="背景音樂檔（選用）")
    ap.add_argument("--vo-only", action="store_true", help="只產旁白 wav，不合成影片")
    ap.add_argument("--dry-run", action="store_true", help="用靜音代替語音，測流程用")
    a = ap.parse_args()

    FFMPEG = find_ffmpeg()
    here = Path.cwd()
    vo = here / "ep01-vo.wav"

    if not a.dry_run:
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            sys.exit("請先執行：pip install edge-tts imageio-ffmpeg")

    print(f"合成 {len(NARRATION)} 句旁白（{VOICE}）…\n")
    tmp = Path(tempfile.mkdtemp())
    clips, overrun = [], []
    for i, (t, text) in enumerate(NARRATION):
        w = tmp / f"{i:02d}.wav"
        synth(text, w, silent=a.dry_run)
        d = wav_seconds(w)
        clips.append((t, w))
        nxt = NARRATION[i + 1][0] if i + 1 < len(NARRATION) else DURATION
        if t + d > nxt + 0.05:
            overrun.append((t, round(t + d - nxt, 2), text))
        print(f"  {t:>5.2f}s  長 {d:>5.2f}s  {text}")

    ins, filt = [], []
    for i, (t, w) in enumerate(clips):
        ins += ["-i", str(w)]
        filt.append(f"[{i}:a]adelay={int(t*1000)}|{int(t*1000)}[d{i}]")
    filt.append("".join(f"[d{i}]" for i in range(len(clips))) +
                f"amix=inputs={len(clips)}:normalize=0,alimiter=limit=0.95,"
                f"apad,atrim=0:{DURATION}[out]")
    run([FFMPEG, "-y", *ins, "-filter_complex", ";".join(filt),
         "-map", "[out]", "-ar", "44100", "-ac", "2", str(vo)])
    print(f"\n旁白 → {vo}")

    if overrun:
        print("\n⚠ 這幾句會蓋到下一句，建議把文字改短（改本檔上方的 NARRATION）：")
        for t, over, text in overrun:
            print(f"   {t}s 超出 {over}s：{text}")

    if a.vo_only:
        return

    src = Path(a.video)
    if not src.is_absolute():
        src = here / src
    if not src.exists():
        sys.exit(f"\n找不到影片 {src}\n"
                 f"請把 zhibao-ep01.mp4 放到這個資料夾（{here}），"
                 f"或指定路徑：python make_ep01.py C:\\路徑\\zhibao-ep01.mp4")

    out = src.with_name(src.stem + "-voiced.mp4")
    if a.bgm:
        bgm = Path(a.bgm)
        if not bgm.is_absolute():
            bgm = here / bgm
        if not bgm.exists():
            sys.exit(f"找不到背景音樂 {bgm}")
        run([FFMPEG, "-y", "-i", str(src), "-i", str(vo),
             "-stream_loop", "-1", "-i", str(bgm), "-filter_complex",
             "[1:a]aformat=fltp:44100:stereo[vo];"
             "[2:a]aformat=fltp:44100:stereo,volume=-22dB[bg];"
             "[bg][vo]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[bgd];"
             f"[bgd][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95,atrim=0:{DURATION}[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac",
             "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)])
    else:
        run([FFMPEG, "-y", "-i", str(src), "-i", str(vo), "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", "-shortest", str(out)])
    print(f"完成 → {out}")


if __name__ == "__main__":
    main()
