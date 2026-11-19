// Channel symbol (profile picture) drawn as pixel art, 1080x1080 PNG. No dependencies.
//
//   node tools/logo.mjs [bulb|play|cube] [output.png]      default: bulb -> out/logo.png
//
// Every design shows the same idea as the clips: one half solid, the other half
// "scanned" to show what is inside. Drawn on a 60x60 grid and scaled up 18x, so the
// pixels are large and clean. Keep the artwork inside the circle - platforms crop to it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const G = 60; // grid cells per side
const SCALE = 18;
const C = {
  bg: '#070a17', band1: '#0d132c', band2: '#131b3d', band3: '#1a2552',
  ink: '#090b20', gold: '#ffd23f', goldDark: '#d99a1c', white: '#f0f0ff',
  cyan: '#3fd9f2', cyanDim: '#1c5f78', pink: '#ff4fa8', pinkDark: '#b8306f',
  green: '#8be04e', lilac: '#9c9cd6', slate: '#5d6096', hollow: '#0b1030',
};
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const grid = Array.from({ length: G }, () => new Array(G).fill(C.bg));
const set = (x, y, c) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < G && y < G) grid[y][x] = c;
};
const fill = (inside, color) => {
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const c = typeof color === 'function' ? color(x, y) : color;
    if (inside(x, y) && c) grid[y][x] = c;
  }
};
const line = (x0, y0, x1, y1, c) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
  for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
};
// cells of a shape that touch a cell outside it
const edge = (inside) => (x, y) => inside(x, y) && !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1));
const MID = 30; // the scan line: solid to its left, see-through to its right

function backdrop() {
  const d = (x, y) => Math.hypot(x - 29.5, y - 29.5);
  fill((x, y) => d(x, y) < 27, C.band1);
  fill((x, y) => d(x, y) < 21, C.band2);
  fill((x, y) => d(x, y) < 14, C.band3);
  // two-tone ring
  fill((x, y) => d(x, y) >= 27 && d(x, y) < 29, (x) => (x < MID ? C.pink : C.cyan));
}
function scanLine(y0, y1) {
  line(MID, y0, MID, y1, C.white);
  for (const y of [y0, y1]) line(MID - 2, y, MID + 2, y, C.cyan);
}
// solid half: flat colour with a darker lower part and one highlight block
function solidHalf(inside, color, dark, splitY, hl) {
  fill((x, y) => inside(x, y) && x < MID, (x, y) => (y > splitY ? dark : color));
  if (hl) fill((x, y) => inside(x, y) && x >= hl[0] && x < hl[0] + hl[2] && y >= hl[1] && y < hl[1] + hl[3], C.white);
}
// scanned half: outline, dark interior, faint scan rows
function wireHalf(inside, color = C.cyan) {
  fill((x, y) => inside(x, y) && x > MID, (x, y) => (y % 3 === 0 ? C.cyanDim : C.hollow));
  fill((x, y) => edge(inside)(x, y) && x > MID, color);
}

const designs = {
  // a play button: this is a video channel that shows what is inside things
  play() {
    const tri = (x, y) => x >= 15 && x <= 49 && Math.abs(y - 29.5) <= (19.5 * (49 - x)) / 34;
    solidHalf(tri, C.gold, C.goldDark, 31, [19, 17, 3, 6]);
    wireHalf(tri);
    // a little skeleton inside: spine and ribs
    line(MID + 2, 30, 46, 30, C.white);
    for (const [x, h] of [[34, 6], [38, 4], [42, 2]]) line(x, 30 - h, x, 30 + h, C.pink);
    scanLine(8, 51);
  },
  // a light bulb: knowledge, with the filament revealed
  bulb() {
    const bulb = (x, y) =>
      Math.hypot(x - 29.5, y - 23) <= 13 ||
      (Math.abs(x - 29.5) <= 7.5 - (y - 34) * 0.5 && y >= 31 && y <= 38) ||
      (Math.abs(x - 29.5) <= 5.5 && y > 38 && y <= 45) ||
      (Math.abs(x - 29.5) <= 2.5 && y > 45 && y <= 47);
    solidHalf(bulb, C.gold, C.goldDark, 28, [21, 16, 3, 5]);
    fill((x, y) => bulb(x, y) && x < MID && y > 38, (x, y) => (y % 2 ? C.slate : C.lilac));
    wireHalf(bulb);
    fill((x, y) => bulb(x, y) && x > MID && y > 38 && y % 2 === 0, C.cyan);
    // filament
    line(MID + 2, 38, MID + 2, 30, C.white);
    line(38, 38, 38, 30, C.white);
    for (const [a, b] of [[[32, 30], [34, 24]], [[34, 24], [36, 30]], [[36, 30], [38, 24]]]) line(...a, ...b, C.pink);
    scanLine(6, 51);
  },
  // a cube: one "bit", with its core showing
  cube() {
    const top = (x, y) => Math.abs(x - 29.5) / 15 + Math.abs(y - 17.5) / 7.5 <= 1;
    const left = (x, y) => x >= 14.5 && x <= MID && y >= 17.5 + (x - 14.5) * 0.5 && y <= 34.5 + (x - 14.5) * 0.5;
    const right = (x, y) => x >= MID && x <= 44.5 && y >= 25 - (x - 29.5) * 0.5 && y <= 42 - (x - 29.5) * 0.5;
    const all = (x, y) => top(x, y) || left(x, y) || right(x, y);
    fill((x, y) => top(x, y) && x < MID, C.gold);
    fill((x, y) => left(x, y) && !top(x, y), (x, y) => (y > 30 + (x - 14.5) * 0.5 ? C.pinkDark : C.pink));
    fill((x, y) => top(x, y) && x < MID && x >= 21 && x < 24 && y >= 15 && y < 17, C.white);
    wireHalf(all);
    // hidden edges and the core
    line(MID + 1, 25, 44, 18, C.cyanDim);
    line(MID + 1, 10, 44, 18, C.cyan);
    fill((x, y) => x >= 34 && x <= 38 && y >= 26 && y <= 30, C.green);
    fill((x, y) => x >= 34 && x <= 35 && y >= 26 && y <= 27, C.white);
    scanLine(6, 51);
  },
};

const name = designs[process.argv[2]] ? process.argv[2] : 'bulb';
backdrop();
designs[name]();

// ---- PNG
const N = G * SCALE;
const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  const row = y * (N * 3 + 1);
  for (let x = 0; x < N; x++) {
    const [r, g, b] = rgb(grid[Math.floor(y / SCALE)][Math.floor(x / SCALE)]);
    raw[row + 1 + x * 3] = r;
    raw[row + 2 + x * 3] = g;
    raw[row + 3 + x * 3] = b;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const head = Buffer.alloc(13);
head.writeUInt32BE(N, 0);
head.writeUInt32BE(N, 4);
head.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', head),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[3] || path.join(ROOT, 'out', name === 'bulb' ? 'logo.png' : `logo-${name}.png`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, png);
console.log(`logo (${name}): ${file}`);
