import { createScene } from './scene.js';
import { createHud, HW, HH } from './hud.js';
import { FPS, FRAMES } from './timeline.js';

const params = new URLSearchParams(location.search);
const PIX = Number(params.get('pix') || 3); // size of one 3D "pixel" in the final 1080x1920 frame
const FONT = params.get('font') || 'Chakra Petch';
const SMOOTH = params.get('smooth') === '1';
const MOTION = Number(params.get('motion') || 0);
const MODEL = params.get('model') || 'a';
const W = Math.round(1080 / PIX);
const H = Math.round(1920 / PIX);

// ---- static backdrop: navy gradient + faint curtain stripes + vignette
const bg = document.createElement('canvas');
bg.width = W;
bg.height = H;
{
  const x = bg.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1b1d4c');
  grad.addColorStop(0.55, '#141640');
  grad.addColorStop(1, '#0d0f30');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W; ) {
    const w = 3 + Math.floor(r() * 9);
    const len = H * (0.18 + r() * 0.3);
    const g2 = x.createLinearGradient(0, 0, 0, len);
    g2.addColorStop(0, `rgba(8,9,36,${0.25 + r() * 0.35})`);
    g2.addColorStop(1, 'rgba(8,9,36,0)');
    x.fillStyle = g2;
    x.fillRect(i, 0, w, len);
    i += w + 2 + Math.floor(r() * 8);
  }
  const vg = x.createRadialGradient(W / 2, H * 0.42, H * 0.2, W / 2, H * 0.45, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4,4,20,0.55)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);
}

await Promise.all([
  document.fonts.load(`700 24px "${FONT}"`, 'ไหล่กลม ABC 123'),
  document.fonts.load(`600 24px "${FONT}"`, 'ไหล่กลม ABC 123'),
]);
const scene = createScene(W, H, bg, { model: MODEL });
const hud = createHud({ font: FONT, smooth: SMOOTH, motion: MOTION, tag: params.get('tag') || '' });

const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = W;
sceneCanvas.height = H;
const sctx = sceneCanvas.getContext('2d', { willReadFrequently: true });

const out = document.getElementById('out');
const octx = out.getContext('2d');
octx.imageSmoothingEnabled = false;

// ordered dithering + palette reduction for the 3D layer
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LEVELS = 7;
function dither() {
  const img = sctx.getImageData(0, 0, W, H);
  const d = img.data;
  const step = 255 / (LEVELS - 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const th = (BAYER[(x & 3) + ((y & 3) << 2)] + 0.5) / 16 - 0.5;
      for (let k = 0; k < 3; k++) {
        const v = Math.round(d[i + k] / step + th) * step;
        d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  sctx.putImageData(img, 0, 0);
}

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
  scene.render();
  sctx.drawImage(scene.canvas, 0, 0);
  dither();
  hud.draw(t, scene.state, scene.project);
  octx.drawImage(sceneCanvas, 0, 0, out.width, out.height);
  octx.drawImage(hud.canvas, 0, 0, out.width, out.height);
  return true;
};

window.getLayers = () => ({ scene: sceneCanvas.toDataURL('image/png'), hud: hud.canvas.toDataURL('image/png') });

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
