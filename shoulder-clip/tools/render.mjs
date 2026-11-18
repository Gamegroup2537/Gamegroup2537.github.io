// Deterministic frame-by-frame renderer.
//   node tools/render.mjs preview 0 60 150 ...   -> contact sheet of chosen frames
//   node tools/render.mjs frames                 -> every frame as two PNG layers
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'build');
const PIX = process.env.PIX || '4';
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
const url = `http://127.0.0.1:${server.address().port}/index.html?pix=${PIX}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction('window.ready === true', null, { timeout: 60000 });

const [mode, ...rest] = process.argv.slice(2);
const b64 = (d) => Buffer.from(d.split(',')[1], 'base64');

if (mode === 'preview') {
  const dir = path.join(OUT, 'preview');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of rest.map(Number)) {
    await page.evaluate((n) => window.renderFrame(n), f);
    const file = path.join(dir, `f${String(f).padStart(4, '0')}.png`);
    await page.locator('#out').screenshot({ path: file });
    console.log(file);
  }
} else if (mode === 'frames') {
  const dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const info = await page.evaluate('window.clipInfo');
  const t0 = Date.now();
  for (let f = 0; f < info.FRAMES; f++) {
    const layers = await page.evaluate((n) => (window.renderFrame(n), window.getLayers()), f);
    const id = String(f).padStart(4, '0');
    fs.writeFileSync(path.join(dir, `scene_${id}.png`), b64(layers.scene));
    fs.writeFileSync(path.join(dir, `hud_${id}.png`), b64(layers.hud));
    if (f % 120 === 0) console.log(`frame ${f}/${info.FRAMES}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log(`done: ${info.FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  console.log('usage: render.mjs preview <frame...> | frames');
}

await browser.close();
server.close();
