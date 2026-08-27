#!/usr/bin/env bash
# frames/*.png → out/zhibao-ep01.mp4（9:16、H.264、附靜音音軌，可直接上 Reels/Shorts/TikTok）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FPS="${FPS:-30}"
NAME="${1:-zhibao-ep01}"
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || echo ffmpeg)}"
mkdir -p "$HERE/out"
"$FFMPEG" -y -hide_banner -loglevel error \
  -framerate "$FPS" -i "$HERE/frames/%05d.png" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -shortest \
  -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -g $((FPS*2)) -movflags +faststart \
  -c:a aac -b:a 128k \
  "$HERE/out/$NAME.mp4"
echo "→ $HERE/out/$NAME.mp4"
