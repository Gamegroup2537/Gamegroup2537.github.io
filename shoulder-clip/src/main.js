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

// ---- static backdrop: flat navy with a few flat curtain bands (no gradients, no dither)
const bg = document.createElement('canvas');
bg.width = W;
bg.height = H;
{
  const x = bg.getContext('2d');
  x.fillStyle = '#10122f';
  x.fillRect(0, 0, W, H);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W; ) {
    const w = 4 + Math.floor(r() * 10);
    x.fillStyle = r() > 0.5 ? '#0d0f29' : '#131638';
    x.fillRect(i, 0, w, Math.round(H * (0.2 + r() * 0.26)));
    i += w + 3 + Math.floor(r() * 9);
  }
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
