#!/usr/bin/env bash
# 把真人代理人影片去背後，合成到動畫圖層上
#   ./compose.sh presenter/idle.mp4 ep01-v3
#
# 人物影片需求：1080x1920、純色背景（淺灰或綠幕）、人物置中站立
# 版面保留給人物的位置：x=595 y=680 寬460 高818（頭到大腿）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:?用法：./compose.sh <人物影片> <輸出名稱>}"
NAME="${2:-ep01-v3}"
FPS=30; DUR=48
KEY="${KEY:-0xD9D9D9}"      # 背景色，淺灰預設；綠幕改 0x00B140
SIM="${SIM:-0.26}"           # 容忍度，去不乾淨就調高
BLEND="${BLEND:-0.10}"
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || echo ffmpeg)}"
mkdir -p "$HERE/out" "$HERE/tmp"

# ① 做成「正播＋倒播」的來回循環，接點不會跳
"$FFMPEG" -y -hide_banner -loglevel error -i "$SRC" \
  -filter_complex "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -an -c:v libx264 -preset veryfast -crf 18 "$HERE/tmp/loop.mp4"

# ② 去背 → 裁切頭到大腿 → 縮放 → 疊上去
"$FFMPEG" -y -hide_banner -loglevel error \
  -framerate $FPS -i "$HERE/frames/%05d.png" \
  -stream_loop -1 -i "$HERE/tmp/loop.mp4" \
  -filter_complex "\
    [1:v]crop=660:1174:210:150,scale=460:818,\
colorkey=$KEY:$SIM:$BLEND,despill=type=green:mix=0,format=yuva420p[p];\
    [0:v][p]overlay=595:680:shortest=1[o]" \
  -map "[o]" -t $DUR \
  -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart \
  "$HERE/out/zhibao-$NAME.mp4"

rm -f "$HERE/tmp/loop.mp4"
echo "→ $HERE/out/zhibao-$NAME.mp4"
