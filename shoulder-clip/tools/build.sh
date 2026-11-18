#!/usr/bin/env bash
# Full build: frames -> soundtrack -> MP4 (1080x1920, 30 fps, H.264 + AAC)
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT_DIR="${OUT_DIR:-$PWD/build}"
mkdir -p "$OUT_DIR" out
# The body is ray-marched, so frames are rendered in parallel chunks. Chunks
# start at moments with no live particles, which keeps the result identical
# to a single pass.
rm -rf "$OUT_DIR/frames"
pids=()
for range in "0 272" "273 429" "430 584" "585 779" "780 959"; do
  node tools/render.mjs frames $range &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
node tools/audio.mjs "$OUT_DIR/audio.wav"
ffmpeg -v error -y \
  -framerate 30 -i "$OUT_DIR/frames/scene_%04d.png" \
  -framerate 30 -i "$OUT_DIR/frames/hud_%04d.png" \
  -i "$OUT_DIR/audio.wav" \
  -filter_complex "[0:v]scale=1080:1920:flags=neighbor[a];[a][1:v]overlay=format=auto,format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -movflags +faststart -shortest out/shoulder-clip.mp4
echo "built out/shoulder-clip.mp4"
