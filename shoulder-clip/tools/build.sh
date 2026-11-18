#!/usr/bin/env bash
# Full build: frames -> soundtrack -> MP4 (1080x1920, 30 fps, H.264 + AAC)
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT_DIR="${OUT_DIR:-$PWD/build}"
mkdir -p "$OUT_DIR" out
node tools/render.mjs frames
node tools/audio.mjs "$OUT_DIR/audio.wav"
ffmpeg -v error -y \
  -framerate 30 -i "$OUT_DIR/frames/scene_%04d.png" \
  -framerate 30 -i "$OUT_DIR/frames/hud_%04d.png" \
  -i "$OUT_DIR/audio.wav" \
  -filter_complex "[0:v]scale=1080:1920:flags=neighbor[a];[a][1:v]overlay=format=auto,format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -movflags +faststart -shortest out/shoulder-clip.mp4
echo "built out/shoulder-clip.mp4"
