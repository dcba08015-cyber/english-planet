#!/usr/bin/env python3
"""把 episodes/<ep>.json 的旁白合成成一條對齊時間軸的 vo.wav。

用法：
    python3 voice.py ep01                 # 預設 edge 引擎（免費、台灣女聲、無需金鑰）
    python3 voice.py ep01 --engine piper --model voice/zh-cn-huayan-x-low.onnx

edge 引擎需要能連到 speech.platform.bing.com。若該主機被網路政策擋住，
就在自己的電腦上跑：pip install edge-tts && python3 voice.py ep01
"""
import argparse, json, os, subprocess, sys, tempfile, wave
from pathlib import Path

HERE = Path(__file__).parent
SR = 44100

def ffmpeg_bin():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"

FFMPEG = ffmpeg_bin()

def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def to_wav(src, dst):
    run([FFMPEG, "-y", "-i", str(src), "-ar", str(SR), "-ac", "1", str(dst)])

def synth_edge(text, out_wav, voice, rate, pitch):
    import asyncio, edge_tts
    mp3 = out_wav.with_suffix(".mp3")
    async def go():
        c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await c.save(str(mp3))
    asyncio.run(go())
    to_wav(mp3, out_wav)
    mp3.unlink()

def synth_piper(text, out_wav, model):
    raw = out_wav.with_name(out_wav.stem + "_raw.wav")
    p = subprocess.run(["piper", "-m", model, "-f", str(raw)],
                       input=text.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if p.returncode:
        sys.exit("piper 合成失敗")
    to_wav(raw, out_wav)
    raw.unlink()

def wav_seconds(p):
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--engine", default="edge", choices=["edge", "piper"])
    ap.add_argument("--model", default="")
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    ep = json.loads((HERE / "episodes" / f"{a.episode}.json").read_text(encoding="utf-8"))
    v = ep.get("voice", {})
    out = Path(a.out) if a.out else HERE / "out" / f"{a.episode}-vo.wav"
    out.parent.mkdir(parents=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp())
    clips, overrun = [], []
    lines = ep["narration"]
    for i, ln in enumerate(lines):
        w = tmp / f"{i:02d}.wav"
        if a.engine == "edge":
            synth_edge(ln["text"], w, v.get("edge", "zh-TW-HsiaoChenNeural"),
                       v.get("rate", "+0%"), v.get("pitch", "+0Hz"))
        else:
            synth_piper(ln["text"], w, a.model or sys.exit("--model 必填"))
        d = wav_seconds(w)
        clips.append((ln["t"], w, d))
        # 這句會不會蓋到下一句？講不完就要改短句子，不是硬擠
        nxt = lines[i + 1]["t"] if i + 1 < len(lines) else ep["duration"]
        if ln["t"] + d > nxt + 0.05:
            overrun.append((ln["t"], round(ln["t"] + d - nxt, 2), ln["text"]))
        print(f"  {ln['t']:>5.2f}s  {d:>5.2f}s  {ln['text']}")

    # 把每段延遲到自己的時間點後疊起來，長度切齊影片
    ins, filt = [], []
    for i, (t, w, _) in enumerate(clips):
        ins += ["-i", str(w)]
        filt.append(f"[{i}:a]adelay={int(t*1000)}|{int(t*1000)}[d{i}]")
    filt.append("".join(f"[d{i}]" for i in range(len(clips))) +
                f"amix=inputs={len(clips)}:normalize=0,alimiter=limit=0.95,"
                f"apad,atrim=0:{ep['duration']}[out]")
    run([FFMPEG, "-y", *ins, "-filter_complex", ";".join(filt),
         "-map", "[out]", "-ar", str(SR), "-ac", "2", str(out)])

    print(f"\n→ {out}")
    if overrun:
        print("\n⚠ 這幾句會蓋到下一句，建議把文字改短：")
        for t, over, txt in overrun:
            print(f"   {t}s 超出 {over}s：{txt}")

if __name__ == "__main__":
    main()
