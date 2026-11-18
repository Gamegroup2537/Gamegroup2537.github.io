// Deterministic frame-by-frame renderer.
//   node tools/render.mjs preview 0 60 150 ...   -> contact sheet of chosen frames
//   node tools/render.mjs frames [first last]    -> frames as two PNG layers
//   node tools/render.mjs bench 30 366 ...        -> time individual frames
// env: QUERY="font=Kanit&smooth=1&motion=2" selects the look
//      GPU=1     render with the computer's graphics card (opens a browser window)
//      ANGLE=gl  graphics backend to use with GPU=1 (default: the browser's own choice)
//      BROWSER=chrome|msedge  which installed browser GPU=1 should use
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is missing. Run "npm install" in the project folder first.');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'build');
const QUERY = process.env.QUERY || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(p.endsWith(path.sep) || p === ROOT ? path.join(p, 'index.html') : p, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?${QUERY}`;

const GPU = process.env.GPU === '1';
async function launch() {
  if (!GPU) {
    // software rendering: works anywhere, slow
    return chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
    });
  }
  // hardware rendering needs a real (headed) browser; use one that is already installed
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  if (process.env.ANGLE) args.push(`--use-angle=${process.env.ANGLE}`);
  const channels = process.env.BROWSER ? [process.env.BROWSER] : ['chrome', 'msedge', undefined];
  let lastErr;
  for (const channel of channels) {
    try {
      const b = await chromium.launch({ headless: false, channel, args });
      console.log(`browser: ${channel || 'bundled chromium'}`);
      return b;
    } catch (e) {
      lastErr = e;
    }
  }
  console.error('Could not start Chrome or Edge. Install Google Chrome, or run "npx playwright install chromium".');
  throw lastErr;
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
// the first frame includes compiling the shaders, which can take minutes on some graphics drivers
await page.waitForFunction('window.ready === true', null, { timeout: 15 * 60000 });
const gfx = await page.evaluate('window.clipInfo.gpu');
console.log(`graphics: ${gfx}`);
if (GPU && /swiftshader|llvmpipe|software|basic render/i.test(gfx)) {
  console.log('WARNING: the browser is still rendering in software. Check the graphics driver, or try ANGLE=gl / ANGLE=d3d11.');
}

const [mode, ...rest] = process.argv.slice(2);
const b64 = (d) => Buffer.from(d.split(',')[1], 'base64');

if (mode === 'preview') {
  const dir = path.join(OUT, process.env.TAG ? `preview_${process.env.TAG}` : 'preview');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of rest.map(Number)) {
    await page.evaluate((n) => window.renderFrame(n), f);
    const file = path.join(dir, `f${String(f).padStart(4, '0')}.png`);
    fs.writeFileSync(file, b64(await page.evaluate(() => document.getElementById('out').toDataURL('image/png'))));
    console.log(file);
  }
} else if (mode === 'frames') {
  const dir = path.join(OUT, process.env.TAG ? `frames_${process.env.TAG}` : 'frames');
  if (!rest.length) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const info = await page.evaluate('window.clipInfo');
  const t0 = Date.now();
  const first = Number(rest[0] || 0);
  const last = Number(rest[1] || info.FRAMES - 1);
  for (let f = first; f <= last; f++) {
    const layers = await page.evaluate((n) => (window.renderFrame(n), window.getLayers()), f);
    const id = String(f).padStart(4, '0');
    if (layers.scene) fs.writeFileSync(path.join(dir, `scene_${id}.png`), b64(layers.scene));
    fs.writeFileSync(path.join(dir, `hud_${id}.png`), b64(layers.hud));
    if (f % 60 === 0) console.log(`frame ${f}/${info.FRAMES}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log(`done: frames ${first}-${last} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else if (mode === 'bench') {
  let total = 0;
  const out = [];
  for (const f of rest.map(Number)) {
    const ms = await page.evaluate((n) => {
      const t = performance.now();
      window.renderFrame(n);
      window.getLayers();
      return performance.now() - t;
    }, f);
    total += ms;
    out.push(`${f}:${Math.round(ms)}`);
  }
  console.log(`bench ms  ${out.join('  ')}  | mean ${Math.round(total / rest.length)}`);
} else {
  console.log('usage: render.mjs preview <frame...> | frames [first last] | bench <frame...>');
}

await browser.close();
server.close();
