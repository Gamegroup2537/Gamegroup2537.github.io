import { createScene } from './scene.js';
import { createHud, HW, HH } from './hud.js';
import { FPS, FRAMES } from './timeline.js';

const params = new URLSearchParams(location.search);
const PIX = Number(params.get('pix') || 3); // size of one 3D "pixel" in the final 1080x1920 frame
const FONT = params.get('font') || 'Kanit';
const SMOOTH = params.get('smooth') === '1';
const MOTION = Number(params.get('motion') ?? 1);
const MODEL = params.get('model') || 'a';
const HUD_ONLY = params.get('hud') === '1'; // skip the slow 3D pass when only the HUD changed
const W = Math.round(1080 / PIX);
const H = Math.round(1920 / PIX);

// ---- static backdrop: near-black navy with a stepped spotlight behind the figure.
// Flat bands only (no gradients), cooler than the figure so it separates by hue and value.
const bg = document.createElement('canvas');
bg.width = W;
bg.height = H;
{
  const x = bg.getContext('2d');
  x.fillStyle = '#05070f';
  x.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.4;
  const steps = [
    [1.05, 0.66, '#070a17'],
    [0.86, 0.54, '#0a0e21'],
    [0.68, 0.43, '#0d132c'],
    [0.52, 0.33, '#111938'],
    [0.37, 0.24, '#152045'],
    [0.23, 0.15, '#1a2852'],
  ];
  for (const [rx, ry, col] of steps) {
    x.fillStyle = col;
    x.beginPath();
    x.ellipse(cx, cy, W * rx, H * ry, 0, 0, Math.PI * 2);
    x.fill();
  }
  // snap the anti-aliased band edges back to flat colours
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const pal = ['#05070f', ...steps.map((s) => s[2])].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < d.length; i += 4) {
    let best = 0;
    let bd = 1e9;
    pal.forEach((c, k) => {
      const e = Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);
      if (e < bd) { bd = e; best = k; }
    });
    d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2];
  }
  x.putImageData(img, 0, 0);
}

await Promise.all([
  document.fonts.load(`700 24px "${FONT}"`, 'ไหล่กลม ABC 123'),
  document.fonts.load(`600 24px "${FONT}"`, 'ไหล่กลม ABC 123'),
]);
const scene = createScene(W, H, bg, { forceXray: params.get('xray') === null ? null : Number(params.get('xray')) });
const hud = createHud({ font: FONT, smooth: SMOOTH, motion: MOTION, tag: params.get('tag') || '' });

const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = W;
sceneCanvas.height = H;
const sctx = sceneCanvas.getContext('2d', { willReadFrequently: true });

const out = document.getElementById('out');
const octx = out.getContext('2d');
octx.imageSmoothingEnabled = false;

let cur = -1;
function advance(f) {
  const t = f / FPS;
  scene.update(t);
  scene.step(1 / FPS);
  cur = f;
}

window.renderFrame = (f) => {
  f = Math.max(0, Math.min(FRAMES, Math.round(f)));
  if (f < cur) {
    scene.reset();
    cur = -1;
  }
  // particles are stateful, so walk forward to keep every render deterministic
  for (let k = Math.max(cur + 1, f - 45); k <= f; k++) advance(k);
  const t = f / FPS;
  if (!HUD_ONLY) {
    scene.render();
    sctx.drawImage(scene.canvas, 0, 0);
  }
  hud.draw(t, scene.state, scene.project, scene.trail(HW, HH));
  octx.drawImage(sceneCanvas, 0, 0, out.width, out.height);
  octx.drawImage(hud.canvas, 0, 0, out.width, out.height);
  return true;
};

window.getLayers = () => ({ scene: HUD_ONLY ? null : sceneCanvas.toDataURL('image/png'), hud: hud.canvas.toDataURL('image/png') });

window.renderFrame(0);
window.clipInfo = { W, H, HW, HH, FPS, FRAMES };
window.ready = true;

// live preview when opened in a normal browser
if (params.get('play') !== null) {
  const t0 = performance.now();
  const loop = () => {
    window.renderFrame(Math.floor(((performance.now() - t0) / 1000) * FPS) % FRAMES);
    requestAnimationFrame(loop);
  };
  loop();
}
