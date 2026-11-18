// Pixel-style HUD drawn at 540x960 and upscaled 2x with nearest-neighbour.
// Text is rasterised then alpha-thresholded so Thai glyphs get hard pixel edges.
import { CAPTIONS, LABELS, HEADS, WATERMARK, statusAt, panelAt } from './timeline.js';

export const HW = 540;
export const HH = 960;
const FONT = '"Chakra Petch", "Loma", sans-serif';

const INK = '#090b20';
const WHITE = '#f0f0ff';
const LILAC = '#9c9cd6';
const CYAN = '#3fd9f2';
const PINK = '#ff4fa8';
const DIM = '#262a58';

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = (c, k) => {
  const [r, g, b] = hex(c);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
};

const cache = new Map();
function sprite(text, px, color, weight = 700) {
  const key = `${text}|${px}|${color}|${weight}`;
  let s = cache.get(key);
  if (s) return s;
  const c = document.createElement('canvas');
  let x = c.getContext('2d');
  const font = `${weight} ${px}px ${FONT}`;
  x.font = font;
  const m = x.measureText(text);
  const asc = Math.ceil(Math.max(m.actualBoundingBoxAscent, px * 0.95)) + 2;
  const desc = Math.ceil(Math.max(m.actualBoundingBoxDescent, px * 0.35)) + 2;
  const w = Math.ceil(m.width) + 4;
  c.width = w;
  c.height = asc + desc;
  x = c.getContext('2d', { willReadFrequently: true });
  x.font = font;
  x.fillStyle = '#fff';
  x.fillText(text, 2, asc);
  const img = x.getImageData(0, 0, w, c.height);
  const d = img.data;
  const [r, g, b] = hex(color);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 112) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    } else d[i + 3] = 0;
  }
  x.putImageData(img, 0, 0);
  s = { c, w, h: c.height, asc, tw: Math.ceil(m.width) };
  cache.set(key, s);
  return s;
}

export function createHud() {
  const canvas = document.createElement('canvas');
  canvas.width = HW;
  canvas.height = HH;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  // text helpers: (x, y) is the baseline; align = 'l' | 'c' | 'r'
  function text(str, x, y, px, color, align = 'l', weight = 700) {
    const s = sprite(str, px, color, weight);
    const ox = align === 'c' ? -Math.round(s.tw / 2) : align === 'r' ? -s.tw : 0;
    g.drawImage(s.c, Math.round(x + ox) - 2, Math.round(y) - s.asc);
    return s.tw;
  }
  const width = (str, px, weight = 700) => sprite(str, px, WHITE, weight).tw;

  function rect(x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function frame(x, y, w, h, color, th = 2, fill = INK) {
    rect(x, y, w, h, color);
    rect(x + th, y + th, w - 2 * th, h - 2 * th, fill);
  }
  function dotted(x, y, w, h, c1, c2) {
    rect(x, y, w, h, INK);
    for (let i = 0; i < w; i += 4) {
      rect(x + i, y, 2, 2, (i / 4) % 2 ? c1 : c2);
      rect(x + i, y + h - 2, 2, 2, (i / 4) % 2 ? c2 : c1);
    }
    for (let i = 0; i < h; i += 4) {
      rect(x, y + i, 2, 2, (i / 4) % 2 ? c1 : c2);
      rect(x + w - 2, y + i, 2, 2, (i / 4) % 2 ? c2 : c1);
    }
  }
  function line(x0, y0, x1, y1, color, th = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    g.fillStyle = color;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      g.fillRect(x0, y0, th, th);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function ring(cx, cy, r, color, th = 2) {
    g.fillStyle = color;
    const steps = Math.ceil(r * 7);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), th, th);
    }
  }
  function disc(cx, cy, r, color) {
    g.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y));
      g.fillRect(cx - w, cy + y, 2 * w + 1, 1);
    }
  }

  // ---------------------------------------------------------------- elements
  function drawStatus(t) {
    const st = statusAt(t);
    const color = st.play ? '#ff4466' : CYAN;
    const tw = width(st.text, 17);
    const w = tw + 34;
    frame(8, 22, w, 28, color, 2);
    if (st.play) {
      for (let i = 0; i < 6; i++) rect(16 + i, 29 + i, 1, 14 - 2 * i, color);
    } else {
      rect(15, 29, 3, 14, color);
      rect(21, 29, 3, 14, color);
    }
    text(st.text, 30, 43, 17, color);
    if (st.x && Math.floor(t * 6) % 2 === 0) text(st.x, HW - 14, 52, 34, CYAN, 'r');
  }

  function drawCaption(t) {
    const c = CAPTIONS.find((k) => t >= k.t0 && t < k.t1);
    if (!c) return;
    const px = c.big ? 34 : 23;
    const lh = c.big ? 46 : 32;
    const w = Math.max(width(c.l1, px), width(c.l2, px)) + (c.big ? 36 : 26);
    const h = lh * 2 + (c.big ? 20 : 14);
    const x = Math.round((HW - w) / 2);
    const y = 64;
    const age = t - c.t0;
    frame(x, y, w, h, age < 0.07 ? CYAN : WHITE, 2);
    const base = y + (c.big ? 12 : 8) + Math.round(lh * 0.74);
    text(c.l1, HW / 2, base, px, WHITE, 'c');
    text(c.l2, HW / 2, base + lh, px, CYAN, 'c');
  }

  function drawLabels(t, project) {
    for (const l of LABELS) {
      if (t < l.t0 || t >= l.t1) continue;
      const [ax, ay] = project(l.anchor, HW, HH);
      const tw = width(l.text, 17);
      const w = tw + 14;
      const h = 26;
      const lx = Math.max(w / 2 + 6, Math.min(HW - w / 2 - 6, ax + l.off[0]));
      const ly = Math.max(160, Math.min(590, ay + l.off[1]));
      const bx = Math.round(lx - w / 2);
      const by = Math.round(ly - h / 2);
      // leader from the box edge that faces the anchor
      const ex = ax < lx ? bx : bx + w - 1;
      const ey = by + (h >> 1);
      const grow = Math.min(1, (t - l.t0) / 0.2);
      line(ex, ey, ex + (ax - ex) * grow, ey + (ay - ey) * grow, WHITE, 1);
      if (grow >= 1) rect(ax - 2, ay - 2, 5, 5, l.color);
      frame(bx, by, w, h, l.color, 1);
      text(l.text, bx + 7, by + 19, 17, WHITE);
    }
  }

  const PX = 40;
  const PY = 612;
  const PW = 460;
  const PH = 132;
  function drawPanel(t, act) {
    const p = panelAt(t);
    if (p.mode === 'none') return;
    if (p.mode === 'cta') {
      const blink = Math.floor(t * 4) % 2;
      dotted(PX, PY, PW, PH, CYAN, PINK);
      const chip = 'เซฟคลิปนี้ไว้';
      const cw = width(chip, 17) + 34;
      rect(HW / 2 - cw / 2, PY - 13, cw, 26, CYAN);
      for (let i = 0; i < 6; i++) rect(HW / 2 - cw / 2 + 9 + i, PY - 7 + i, 1, 14 - 2 * i, INK);
      text(chip, HW / 2 + 9, PY + 6, 17, INK, 'c');
      text('ไหล่กลม = ฝึกครบ 3 มัด', HW / 2, PY + 58, 30, WHITE, 'c');
      text('หน้า · กลาง · หลัง', HW / 2, PY + 88, 19, LILAC, 'c');
      text(blink ? '♥ แชร์ให้เพื่อนสายยิม ♥' : '  แชร์ให้เพื่อนสายยิม  ', HW / 2, PY + 117, 18, PINK, 'c');
      return;
    }
    frame(PX, PY, PW, PH, '#5a5ea8', 2);
    // title row
    rect(PX + 14, PY + 15, 4, 10, LILAC);
    rect(PX + 18, PY + 18, 10, 4, LILAC);
    rect(PX + 28, PY + 15, 4, 10, LILAC);
    text(p.mode === 'summary' ? 'ครบทั้ง 3 มัด' : 'กล้ามเนื้อที่ทำงาน', PX + 42, PY + 27, 17, LILAC);
    text(p.title, PX + PW - 14, PY + 27, 17, CYAN, 'r');
    HEADS.forEach((hd, i) => {
      const y = PY + 40 + i * 29;
      if (p.mode === 'summary') {
        if (p.reveal < i) return;
        const fresh = p.reveal - i < 0.3;
        rect(PX + 14, y + 5, 12, 12, hd.color);
        text(hd.th, PX + 36, y + 18, 17, WHITE);
        rect(PX + 112, y + 10, 14, 2, LILAC);
        rect(PX + 122, y + 7, 2, 8, LILAC);
        rect(PX + 124, y + 9, 2, 4, LILAC);
        text(hd.move, PX + 138, y + 18, 18, fresh ? WHITE : hd.color);
        return;
      }
      const a = act[i];
      rect(PX + 14, y + 5, 12, 12, hd.color);
      text(hd.th, PX + 36, y + 18, 17, a > 0.55 ? WHITE : LILAC);
      const n = 10;
      const lit = Math.round(a * n);
      for (let k = 0; k < n; k++) {
        const cx = PX + 112 + k * 34;
        if (k < lit) {
          const top = k === lit - 1;
          rect(cx, y + 3, 30, 17, top ? WHITE : hd.color);
          rect(cx + 2, y + 5, 26, 13, top ? hd.color : shade(hd.color, 0.5));
        } else {
          rect(cx, y + 3, 30, 17, DIM);
          rect(cx + 1, y + 4, 28, 15, '#0d1030');
        }
      }
    });
  }

  function drawGauge(angle) {
    const cx = 458;
    const cy = 850;
    const r = 60;
    disc(cx, cy, r, INK);
    ring(cx, cy, r, '#c8c8f0', 2);
    // ticks on the right half: 0 (down) .. 180 (up)
    for (let d = 0; d <= 180; d += 30) {
      const a = (d * Math.PI) / 180;
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      line(cx + sx * (r - 9), cy + sy * (r - 9), cx + sx * (r - 3), cy + sy * (r - 3), d === 90 ? PINK : '#c8c8f0', d === 90 ? 2 : 1);
    }
    // pink "shoulder height" bracket
    for (let d = 82; d <= 98; d += 2) {
      const a = (d * Math.PI) / 180;
      rect(cx + Math.sin(a) * (r - 13), cy + Math.cos(a) * (r - 13), 2, 2, PINK);
    }
    const a = (Math.max(0, Math.min(180, angle)) * Math.PI) / 180;
    line(cx, cy, cx + Math.sin(a) * (r - 14), cy + Math.cos(a) * (r - 14), CYAN, 2);
    disc(cx, cy, 3, WHITE);
    text(`${Math.round(angle)}°`, cx - 7, cy + 2, 23, CYAN, 'r');
    const lw = width('มุมแขน', 16) + 14;
    frame(cx - lw / 2, cy - r - 30, lw, 25, '#5a5ea8', 1);
    text('มุมแขน', cx, cy - r - 12, 16, WHITE, 'c');
  }

  function draw(t, state, project) {
    g.clearRect(0, 0, HW, HH);
    drawLabels(t, project);
    drawPanel(t, state.act);
    drawGauge(state.armAngle);
    drawCaption(t);
    drawStatus(t);
    if (WATERMARK) text(WATERMARK, 10, 598, 16, '#7f81bd', 'l', 600);
  }

  return { canvas, draw };
}
