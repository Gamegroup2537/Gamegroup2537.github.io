// Full build: frames -> soundtrack -> MP4 (1080x1920, 30 fps, H.264 + AAC).
// Works on Windows, macOS and Linux.
//
//   node tools/build.mjs            software rendering (slow, works anywhere)
//   node tools/build.mjs --gpu      use this computer's graphics card (fast)
//   node tools/build.mjs --hud      only the on-screen graphics changed: reuse the 3D frames
//   options: --angle=gl|d3d11|vulkan   graphics backend for --gpu
//            --browser=chrome|msedge   browser for --gpu
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];

const OUT = process.env.OUT_DIR || path.join(ROOT, 'build');
const frames = path.join(OUT, 'frames');
const env = { ...process.env, OUT_DIR: OUT };
if (flag('gpu')) env.GPU = '1';
if (opt('angle')) env.ANGLE = opt('angle');
if (opt('browser')) env.BROWSER = opt('browser');

function run(cmd, cmdArgs, extraEnv = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env: { ...env, ...extraEnv } });
  if (r.error && r.error.code === 'ENOENT') {
    console.error(`\n"${cmd}" was not found. Install it and open a new terminal:`);
    if (cmd === 'ffmpeg') console.error('  Windows: winget install Gyan.FFmpeg     macOS: brew install ffmpeg');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

// fail before the long render, not after it, if ffmpeg is missing
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
  console.error('ffmpeg was not found. Install it, then open a new terminal and run this again:');
  console.error('  Windows: winget install Gyan.FFmpeg     macOS: brew install ffmpeg');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
const t0 = Date.now();

const hudOnly = (flag('hud') || process.env.HUD_ONLY === '1') && fs.existsSync(path.join(frames, 'scene_0959.png'));
if (hudOnly) {
  const q = env.QUERY ? `${env.QUERY}&hud=1` : 'hud=1';
  run(process.execPath, ['tools/render.mjs', 'frames', '0', '959'], { QUERY: q });
} else {
  if (flag('hud')) console.log('No 3D frames from an earlier build were found - rendering everything.');
  fs.rmSync(frames, { recursive: true, force: true });
  run(process.execPath, ['tools/render.mjs', 'frames']);
}
run(process.execPath, ['tools/audio.mjs', path.join(OUT, 'audio.wav')]);
run('ffmpeg', [
  '-v', 'error', '-y',
  '-framerate', '30', '-i', path.join(frames, 'scene_%04d.png'),
  '-framerate', '30', '-i', path.join(frames, 'hud_%04d.png'),
  '-i', path.join(OUT, 'audio.wav'),
  '-filter_complex', '[0:v]scale=1080:1920:flags=neighbor[a];[a][1:v]overlay=format=auto,format=yuv420p[v]',
  '-map', '[v]', '-map', '2:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
  path.join(ROOT, 'out', 'shoulder-clip.mp4'),
]);
console.log(`built out/shoulder-clip.mp4 in ${Math.round((Date.now() - t0) / 1000)}s`);
