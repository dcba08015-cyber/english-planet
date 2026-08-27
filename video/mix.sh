#!/usr/bin/env bash
# 把旁白（+選用背景音樂）混進影片。背景音樂會自動避開人聲（sidechain ducking）。
#   ./mix.sh ep01                     只加旁白
#   ./mix.sh ep01 assets/bgm.mp3      旁白 + 背景音樂
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EP="${1:?用法：./mix.sh <episode> [bgm檔]}"
BGM="${2:-}"
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || echo ffmpeg)}"
VID="$HERE/out/zhibao-$EP.mp4"
VO="$HERE/out/$EP-vo.wav"
OUT="$HERE/out/zhibao-$EP-voiced.mp4"
[ -f "$VID" ] || { echo "找不到 $VID，請先 node render.mjs && ./encode.sh zhibao-$EP"; exit 1; }
[ -f "$VO" ]  || { echo "找不到 $VO，請先 python3 voice.py $EP"; exit 1; }

if [ -n "$BGM" ]; then
  # 背景音樂壓到 -22dB，人聲一出現再自動壓低 8dB
  "$FFMPEG" -y -hide_banner -loglevel error \
    -i "$VID" -i "$VO" -stream_loop -1 -i "$BGM" \
    -filter_complex "\
      [1:a]aformat=fltp:44100:stereo,volume=1.0[vo];\
      [2:a]aformat=fltp:44100:stereo,volume=-22dB[bg];\
      [bg][vo]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[bgd];\
      [bgd][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95,atrim=0:36[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -movflags +faststart -shortest "$OUT"
else
  "$FFMPEG" -y -hide_banner -loglevel error \
    -i "$VID" -i "$VO" -map 0:v -map 1:a \
    -c:v copy -c:a aac -b:a 192k -movflags +faststart -shortest "$OUT"
fi
echo "→ $OUT"
