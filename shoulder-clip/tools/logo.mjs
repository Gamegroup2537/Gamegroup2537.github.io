// Channel symbol (profile picture) drawn as pixel art, 1080x1080 PNG. No dependencies.
//
//   node tools/logo.mjs [arm|torso|dumbbell|bulb|cube] [output.png]      default: arm -> out/logo.png
//
// Fitness marks (arm, torso, dumbbell) pick out muscle in the clips' accent colours;
// the generic marks (bulb, cube) are half solid and half "scanned". Drawn on a 60x60 grid and scaled up 18x, so the
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

// 1-cell dark outline round a shape, so it stays crisp on any background
const outline = (inside) => fill((x, y) => !inside(x, y) && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)), C.ink);
const cap = (x, y, ax, ay, bx, by, r) => {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= r;
};

const designs = {
  // a body with its muscle groups mapped in colour: training explained through anatomy
  torso() {
    const d = (x) => Math.abs(x - MID);
    const hw = (y) =>
      y < 19 ? -1 : y < 21 ? 3 : y === 21 ? 8 : y === 22 ? 13 : y === 23 ? 17 : y < 29 ? 19 : y === 29 ? 18
      : y <= 42 ? 16.5 - (y - 30) * 0.5 : y <= 49 ? 10.5 : -1;
    const head = (x, y) => Math.hypot(x - MID, y - 12) <= 6.2;
    const body = (x, y) => head(x, y) || d(x) <= hw(y);
    outline(body);
    fill(body, (x, y) => {
      if (y < 19) return C.gold; // head
      if (y < 23) return d(x) <= 3 ? C.goldDark : C.lilac; // neck | trapezius
      if (y < 30) return d(x) >= 13 ? C.cyan : C.pink; // deltoids | chest
      if (y >= 46) return C.slate;
      return d(x) <= 6 ? C.green : C.lilac; // abs | obliques
    });
    // grooves between the groups
    fill((x, y) => body(x, y) && y >= 23 && (
      y === 30 || y === 45 || (d(x) === 12 && y < 30) || (x === MID && y >= 23 && y < 45) ||
      (d(x) === 7 && y > 30 && y < 45) || ((y === 35 || y === 40) && d(x) < 7)
    ), C.ink);
    // highlights
    fill((x, y) => (x >= 26 && x <= 27 && y >= 8 && y <= 10) || (x >= 13 && x <= 14 && y >= 24 && y <= 26) || (x >= 20 && x <= 22 && y === 24), C.white);
  },
  // a flexed arm with the biceps picked out
  arm() {
    const fist = (x, y) => Math.abs(x - 31) <= 7 && Math.abs(y - 14) <= 6 && Math.abs(x - 31) + Math.abs(y - 14) <= 11;
    const biceps = (x, y) => ((x - 29) / 9.5) ** 2 + ((y - 33) / 7) ** 2 <= 1;
    const arm = (x, y) =>
      cap(x, y, 17, 43, 41, 42, 7) || Math.hypot(x - 42, y - 40) <= 8 || cap(x, y, 42, 38, 34, 22, 6) || fist(x, y) || biceps(x, y);
    outline(arm);
    fill(arm, (x, y) => (y > 43 ? C.goldDark : C.gold));
    fill((x, y) => biceps(x, y) && y < 40, (x, y) => ((x + y) % 4 === 0 ? C.pinkDark : C.pink));
    fill((x, y) => edge(biceps)(x, y) && y < 40, C.ink);
    fill((x, y) => fist(x, y) && y === 20, C.ink);
    fill((x, y) => (x >= 27 && x <= 29 && y >= 10 && y <= 11) || (x >= 24 && x <= 26 && y >= 29 && y <= 30), C.white);
  },
  // a dumbbell over a muscle-signal trace
  dumbbell() {
    const pts = [[6, 30], [14, 30], [18, 20], [23, 40], [27, 24], [30, 30], [34, 30], [38, 36], [42, 22], [46, 30], [54, 30]];
    for (let k = 0; k < pts.length - 1; k++) line(...pts[k], ...pts[k + 1], C.cyanDim);
    const rot = (x, y) => [((x - 30) + (y - 30)) * 0.7071, ((y - 30) - (x - 30)) * 0.7071]; // 45 degrees
    const part = (x, y, lo, hi, h) => { const [u, v] = rot(x, y); return u >= lo && u <= hi && Math.abs(v) <= h; };
    const bar = (x, y) => part(x, y, -19, 19, 2);
    const inner = (x, y) => part(x, y, -14, -9, 10) || part(x, y, 9, 14, 10);
    const outer = (x, y) => part(x, y, -19, -15, 7) || part(x, y, 15, 19, 7);
    const bell = (x, y) => bar(x, y) || inner(x, y) || outer(x, y);
    outline(bell);
    fill(bar, C.lilac);
    fill(outer, C.pink);
    fill(inner, (x, y) => (rot(x, y)[1] > 2 ? C.goldDark : C.gold));
    fill((x, y) => { const [u, v] = rot(x, y); return v >= -8 && v <= -5 && ((u >= -13 && u <= -11) || (u >= 10 && u <= 12)); }, C.white);
  },
  // generic marks, for channels on other subjects
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
    line(MID + 2, 38, MID + 2, 30, C.white);
    line(38, 38, 38, 30, C.white);
    for (const [a, b] of [[[32, 30], [34, 24]], [[34, 24], [36, 30]], [[36, 30], [38, 24]]]) line(...a, ...b, C.pink);
    scanLine(6, 51);
  },
  cube() {
    const top = (x, y) => Math.abs(x - 29.5) / 15 + Math.abs(y - 17.5) / 7.5 <= 1;
    const left = (x, y) => x >= 14.5 && x <= MID && y >= 17.5 + (x - 14.5) * 0.5 && y <= 34.5 + (x - 14.5) * 0.5;
    const right = (x, y) => x >= MID && x <= 44.5 && y >= 25 - (x - 29.5) * 0.5 && y <= 42 - (x - 29.5) * 0.5;
    const all = (x, y) => top(x, y) || left(x, y) || right(x, y);
    fill((x, y) => top(x, y) && x < MID, C.gold);
    fill((x, y) => left(x, y) && !top(x, y), (x, y) => (y > 30 + (x - 14.5) * 0.5 ? C.pinkDark : C.pink));
    fill((x, y) => top(x, y) && x < MID && x >= 21 && x < 24 && y >= 15 && y < 17, C.white);
    wireHalf(all);
    line(MID + 1, 25, 44, 18, C.cyanDim);
    line(MID + 1, 10, 44, 18, C.cyan);
    fill((x, y) => x >= 34 && x <= 38 && y >= 26 && y <= 30, C.green);
    fill((x, y) => x >= 34 && x <= 35 && y >= 26 && y <= 27, C.white);
    scanLine(6, 51);
  },
};

const name = designs[process.argv[2]] ? process.argv[2] : 'arm';
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
const file = process.argv[3] || path.join(ROOT, 'out', name === 'arm' ? 'logo.png' : `logo-${name}.png`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, png);
console.log(`logo (${name}): ${file}`);
