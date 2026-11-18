// HUD drawn in a 540x960 coordinate space onto a 1080x1920 canvas.
// Options:
//   font   - CSS font family for all text
//   smooth - true: crisp anti-aliased text; false: alpha-thresholded "pixel" text
//   motion - 0 pop | 1 wipe/type | 2 slide + spring | 3 glitch/scan
import { CAPTIONS, LABELS, HEADS, WATERMARK, STATUS, SECTIONS, PANELS, CALLOUTS, CHAPTERS, DURATION, activation, pose } from './timeline.js';

export const HW = 540;
export const HH = 960;
const S = 2; // device pixels per HUD unit

const INK = '#090b20';
const WHITE = '#f0f0ff';
const LILAC = '#9c9cd6';
const CYAN = '#3fd9f2';
const PINK = '#ff4fa8';
const GOLD = '#ffd23f';
const DIM = '#262a58';

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = (c, k) => {
  const [r, g, b] = hex(c);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
};
const backOut = (p) => {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function createHud({ font = 'Chakra Petch', smooth = false, motion = 0, tag = '' } = {}) {
  const FONT = `"${font}", "Loma", sans-serif`;
  const canvas = mk(HW * S, HH * S);
  const m = canvas.getContext('2d');
  m.imageSmoothingEnabled = false;
  const scratch = mk(HW * S, HH * S);
  const g = scratch.getContext('2d');
  g.setTransform(S, 0, 0, S, 0, 0);
  g.imageSmoothingEnabled = false;
  const tint = mk(HW * S, HH * S);
  const tg = tint.getContext('2d');
  let now = 0;

  // ---------------------------------------------------------------- text
  const cache = new Map();
  function sprite(text, px, color, weight) {
    const key = `${text}|${px}|${color}|${weight}`;
    let s = cache.get(key);
    if (s) return s;
    const c = document.createElement('canvas');
    let x = c.getContext('2d');
    const f = `${weight} ${px}px ${FONT}`;
    x.font = f;
    const mt = x.measureText(text);
    const asc = Math.ceil(Math.max(mt.actualBoundingBoxAscent, px * 0.95)) + 2;
    const desc = Math.ceil(Math.max(mt.actualBoundingBoxDescent, px * 0.35)) + 2;
    const w = Math.ceil(mt.width) + 4;
    c.width = w;
    c.height = asc + desc;
    x = c.getContext('2d', { willReadFrequently: true });
    x.font = f;
    x.fillStyle = '#fff';
    x.fillText(text, 2, asc);
    const img = x.getImageData(0, 0, w, c.height);
    const d = img.data;
    const [r, gg, b] = hex(color);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] >= 112) {
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      } else d[i + 3] = 0;
    }
    x.putImageData(img, 0, 0);
    s = { c, asc, tw: Math.ceil(mt.width) };
    cache.set(key, s);
    return s;
  }
  // (x, y) is the baseline; align = 'l' | 'c' | 'r'
  function text(str, x, y, px, color, align = 'l', weight = 700) {
    if (smooth) {
      g.font = `${weight} ${px}px ${FONT}`;
      g.fillStyle = color;
      g.textAlign = align === 'c' ? 'center' : align === 'r' ? 'right' : 'left';
      g.textBaseline = 'alphabetic';
      g.fillText(str, x, y);
      return;
    }
    const s = sprite(str, px, color, weight);
    const ox = align === 'c' ? -Math.round(s.tw / 2) : align === 'r' ? -s.tw : 0;
    g.drawImage(s.c, Math.round(x + ox) - 2, Math.round(y) - s.asc);
  }
  function width(str, px, weight = 700) {
    if (smooth) {
      g.font = `${weight} ${px}px ${FONT}`;
      return Math.ceil(g.measureText(str).width);
    }
    return sprite(str, px, WHITE, weight).tw;
  }

  // ---------------------------------------------------------------- pixel primitives
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

  // ---------------------------------------------------------------- motion
  // Paint one element into the scratch layer, then composite it with the
  // entrance / exit animation of the chosen motion style.
  function blit(x, y, w, h, dx = 0, dy = 0, alpha = 1, src = scratch) {
    m.globalAlpha = alpha;
    m.drawImage(src, x * S, y * S, w * S, h * S, Math.round((x + dx) * S), Math.round((y + dy) * S), w * S, h * S);
    m.globalAlpha = 1;
  }
  function bands(x, y, w, h, amp, alpha) {
    const n = 6;
    const fr = Math.floor(now * 30);
    for (let i = 0; i < n; i++) {
      const y0 = y + Math.floor((i * h) / n);
      const y1 = y + Math.floor(((i + 1) * h) / n);
      blit(x, y0, w, y1 - y0, (hash(i * 7.3 + fr * 13.1) - 0.5) * 2 * amp, 0, alpha);
    }
  }
  function ghost(x, y, w, h, dx, color) {
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(x * S, y * S, w * S, h * S);
    tg.drawImage(scratch, x * S, y * S, w * S, h * S, x * S, y * S, w * S, h * S);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = color;
    tg.fillRect(x * S, y * S, w * S, h * S);
    blit(x, y, w, h, dx, 0, 0.75, tint);
  }
  function element(b, t0, t1, paint, o = {}) {
    const a = now - t0;
    const rem = t1 - now;
    if (a < 0 || rem <= 0) return;
    const x = Math.max(0, Math.floor(b[0]) - 4);
    const y = Math.max(0, Math.floor(b[1]) - 4);
    const w = Math.min(HW - x, Math.ceil(b[2]) + 8);
    const h = Math.min(HH - y, Math.ceil(b[3]) + 8);
    g.clearRect(x, y, w, h);
    paint();
    const noIn = o.noIn || t0 <= 0;
    const noOut = o.noOut;
    if (motion === 1) {
      const IN = 0.26;
      const OUT = 0.1;
      // typewriter style: boxes pop in (optionally with a wipe), the text types itself
      if (o.boot && a < 0.3 && !noIn) {
        // CRT power-on: a line snaps across, then the panel unfolds from it
        if (a < 0.1) {
          const ww = w * (a / 0.1);
          m.fillStyle = '#f0f0ff';
          m.fillRect(Math.round((x + w / 2 - ww / 2) * S), Math.round((y + h / 2 - 1) * S), Math.round(ww * S), 2 * S);
        } else {
          const k = (a - 0.1) / 0.2;
          const hh = Math.max(2, h * k);
          m.drawImage(scratch, x * S, y * S, w * S, h * S, x * S, Math.round((y + (h - hh) / 2) * S), w * S, Math.round(hh * S));
          m.globalAlpha = (1 - k) * 0.55;
          m.fillStyle = '#9ff0ff';
          m.fillRect((x + 6) * S, Math.round((y + (h - hh) / 2 + 4) * S), (w - 12) * S, Math.max(1, Math.round((hh - 8) * S)));
          m.globalAlpha = 1;
        }
      } else if (o.wipe && a < IN && !noIn) blit(x, y, Math.ceil((w * Math.ceil((a / IN) * 10)) / 10), h);
      else blit(x, y, w, h);
    } else if (motion === 2) {
      const IN = 0.42;
      const OUT = 0.16;
      if (rem < OUT && !noOut) {
        const q = rem / OUT;
        blit(x, y, w, h, 0, -(1 - q) * 12, q);
      } else if (a < IN && !noIn) {
        const p = a / IN;
        const e = backOut(p);
        const al = Math.min(1, p * 3);
        if (o.pivot) {
          m.save();
          m.globalAlpha = al;
          m.translate(o.pivot[0] * S, o.pivot[1] * S);
          m.scale(e, e);
          m.translate(-o.pivot[0] * S, -o.pivot[1] * S);
          m.drawImage(scratch, x * S, y * S, w * S, h * S, x * S, y * S, w * S, h * S);
          m.restore();
          m.globalAlpha = 1;
        } else blit(x, y, w, h, 0, (o.from === 'below' ? 1 : -1) * (1 - e) * (o.dist || 34), al);
      } else blit(x, y, w, h);
    } else if (motion === 3) {
      const IN = 0.32;
      const OUT = 0.14;
      const fr = Math.floor(now * 30);
      if (rem < OUT && !noOut) {
        const q = rem / OUT;
        if (fr % 2) bands(x, y, w, h, (1 - q) * 46, q);
      } else if (a < IN && !noIn) {
        const p = a / IN;
        if (fr % 3 === 1 && p < 0.7) return;
        ghost(x, y, w, h, -12 * (1 - p), CYAN);
        ghost(x, y, w, h, 12 * (1 - p), PINK);
        bands(x, y, w, h, 24 * (1 - p) * (1 - p), 1);
        m.fillStyle = 'rgba(240,240,255,0.85)';
        m.fillRect(x * S, Math.round((y + h * p) * S), w * S, S);
      } else blit(x, y, w, h);
    } else blit(x, y, w, h);
  }
  // Entrance animation for a part inside an element (e.g. the panel title).
  function sub(age, x, y, w, h, paint, IN = 0.32) {
    if (age < 0) return;
    if (motion === 0 || age >= IN) return paint(0);
    const p = age / IN;
    if (motion === 1) {
      g.save();
      g.beginPath();
      const ww = Math.ceil((w * Math.ceil(p * 12)) / 12);
      g.rect(x, y, ww, h);
      g.clip();
      paint(0);
      g.restore();
      rect(x + ww + 1, y + h * 0.25, 5, h * 0.55, GOLD); // cursor
    } else if (motion === 2) {
      g.globalAlpha = Math.min(1, p * 2);
      paint((1 - backOut(p)) * -24);
      g.globalAlpha = 1;
    } else {
      const fr = Math.floor(now * 30);
      if (fr % 3 === 1) return;
      paint((hash(fr * 3.7) - 0.5) * 18 * (1 - p));
    }
  }

  // ---------------------------------------------------------------- effect helpers
  const withAlpha = (al, fn) => {
    g.globalAlpha = Math.max(0, Math.min(1, al));
    fn();
    g.globalAlpha = 1;
  };
  // pixel halo behind a lit shape
  function glowRect(x, y, w, h, color, k = 1) {
    withAlpha(0.1 * k, () => rect(x - 4, y - 4, w + 8, h + 8, color));
    withAlpha(0.16 * k, () => rect(x - 2, y - 2, w + 4, h + 4, color));
    withAlpha(0.26 * k, () => rect(x - 1, y - 1, w + 2, h + 2, color));
  }
  function brackets(x, y, w, h, color, len = 10, th = 2) {
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      rect(sx > 0 ? cx : cx - len, sy > 0 ? cy : cy - th, len, th, color);
      rect(sx > 0 ? cx : cx - th, sy > 0 ? cy : cy - len, th, len, color);
    }
  }
  // a light that runs round a frame's border
  function runner(x, y, w, h, speed, color, tail = 26) {
    const per = 2 * (w + h);
    const head = (now * speed) % per;
    for (let i = 0; i < tail; i += 2) {
      let d = (head - i + per) % per;
      let px;
      let py;
      if (d < w) { px = x + d; py = y; }
      else if (d < w + h) { px = x + w - 2; py = y + (d - w); }
      else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h - 2; }
      else { px = x; py = y + h - (d - 2 * w - h); }
      withAlpha(1 - i / tail, () => rect(px, py, 2, 2, color));
    }
  }
  function poly(pts, color, al = 1) {
    g.globalAlpha = al;
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }
  // diagonal sheen crossing a box; p runs 0..1
  function shine(x, y, w, h, p, al = 0.2) {
    if (p <= 0 || p >= 1) return;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    const sx = x - 50 + p * (w + 100);
    poly([[sx, y], [sx + 22, y], [sx + 22 - h * 0.6, y + h], [sx - h * 0.6, y + h]], '#ffffff', al);
    poly([[sx + 30, y], [sx + 36, y], [sx + 36 - h * 0.6, y + h], [sx + 30 - h * 0.6, y + h]], '#ffffff', al * 0.7);
    g.restore();
  }
  function sparkle(x, y, size, color) {
    rect(x - size, y, size * 2 + 1, 1, color);
    rect(x, y - size, 1, size * 2 + 1, color);
    if (size > 2) rect(x - 1, y - 1, 3, 3, color);
  }
  const actAt = (t) => activation(Math.max(0, Math.min(DURATION, t)));

  // ---------------------------------------------------------------- elements
  function drawStatus() {
    const st = STATUS.find((k) => now >= k.t0 && now < k.t1);
    if (!st) return;
    const color = st.play ? '#ff4466' : CYAN;
    const w = width(st.text, 17) + 34;
    element([8, 22, w, 28], st.t0, st.t1, () => {
      frame(8, 22, w, 28, color, 2);
      const pulse = Math.floor(now * 3) % 2 === 0;
      if (st.play) for (let i = 0; i < 6; i++) rect(16 + i, 29 + i, 1, 14 - 2 * i, pulse ? color : WHITE);
      else {
        rect(15, 29, 3, 14, pulse ? color : WHITE);
        rect(21, 29, 3, 14, pulse ? color : WHITE);
      }
      text(st.text, 30, 43, 17, color);
      shine(10, 24, w - 4, 24, (now - st.t0) / 0.5, 0.3);
    }, { noOut: true });
    if (st.x && Math.floor(now * 6) % 2 === 0) {
      element([HW - 90, 20, 84, 44], st.t0, st.t1, () => text(st.x, HW - 14, 52, 34, GOLD, 'r'), { noIn: true, noOut: true });
    }
  }

  function drawCaption() {
    const c = CAPTIONS.find((k) => now >= k.t0 && now < k.t1);
    if (!c) return;
    const px = c.big ? 34 : 23;
    const lh = c.big ? 46 : 32;
    const w = Math.max(width(c.l1, px), width(c.l2, px)) + (c.big ? 36 : 26);
    const h = lh * 2 + (c.big ? 20 : 14);
    const x = Math.round((HW - w) / 2);
    const y = 64;
    element([x - 6, y - 6, w + 14, h + 14], c.t0, c.t1, () => {
      withAlpha(0.5, () => rect(x + 5, y + 5, w, h, '#000008')); // hard drop shadow
      frame(x, y, w, h, motion === 0 && now - c.t0 < 0.07 ? CYAN : WHITE, 2);
      brackets(x - 5, y - 5, w + 10, h + 10, GOLD, c.big ? 14 : 10, 2);
      const base = y + (c.big ? 12 : 8) + Math.round(lh * 0.74);
      const typed = motion === 1 && c.t0 > 0;
      const w1 = width(c.l1, px);
      const w2 = width(c.l2, px);
      const d1 = typed ? Math.min(0.5, c.l1.length * 0.024) : 0.32;
      const d2 = typed ? Math.min(0.5, c.l2.length * 0.024) : 0.32;
      const age1 = typed ? now - c.t0 : 9;
      sub(age1, HW / 2 - w1 / 2 - 2, base - lh + 6, w1 + 4, lh, () => text(c.l1, HW / 2, base, px, WHITE, 'c'), d1);
      // the second line follows the first in the animated styles
      const age2 = motion && c.t0 > 0 ? now - c.t0 - (typed ? d1 : 0.18) : 9;
      sub(age2, HW / 2 - w2 / 2 - 2, base + 6, w2 + 4, lh, (dx) => text(c.l2, HW / 2 + dx, base + lh, px, GOLD, 'c'), d2);
      // sheen once the text has landed (the hook caption repeats it)
      const sAge = now - c.t0 - (typed ? d1 + d2 : 0);
      shine(x + 2, y + 2, w - 4, h - 4, c.big ? ((sAge + 0.4) % 1.6) / 0.5 : sAge / 0.45, 0.22);
    });
  }

  function drawLabels(project) {
    for (const l of LABELS) {
      if (now < l.t0 || now >= l.t1) continue;
      const [ax, ay] = project(l.anchor, HW, HH);
      const w = width(l.text, 17) + 14;
      const h = 26;
      const lx = Math.max(w / 2 + 6, Math.min(HW - w / 2 - 6, ax + l.off[0]));
      const ly = Math.max(160, Math.min(590, ay + l.off[1]));
      const bx = Math.round(lx - w / 2);
      const by = Math.round(ly - h / 2);
      const ex = ax < lx ? bx : bx + w - 1;
      const ey = by + (h >> 1);
      const x0 = Math.min(bx, ax - 20);
      const y0 = Math.min(by, ay - 20);
      const x1 = Math.max(bx + w, ax + 21);
      const y1 = Math.max(by + h, ay + 21);
      element([x0, y0, x1 - x0, y1 - y0], l.t0, l.t1, () => {
        const age = now - l.t0;
        const grow = Math.min(1, age / 0.2);
        line(ex, ey, ex + (ax - ex) * grow, ey + (ay - ey) * grow, WHITE, 1);
        if (grow >= 1) {
          // radar ping on the target + a pulse travelling down the leader
          const ph = (age % 0.9) / 0.9;
          withAlpha(0.9 * (1 - ph), () => ring(ax, ay, 5 + ph * 13, l.color, 2));
          const k = (age * 1.4) % 1;
          rect(ex + (ax - ex) * k - 1, ey + (ay - ey) * k - 1, 3, 3, l.color);
          glowRect(ax - 2, ay - 2, 5, 5, l.color);
          rect(ax - 2, ay - 2, 5, 5, WHITE);
        }
        withAlpha(0.45, () => rect(bx + 3, by + 3, w, h, '#000008'));
        frame(bx, by, w, h, l.color, 1);
        rect(bx, by, 3, h, l.color);
        text(l.text, bx + 8, by + 19, 17, WHITE);
        shine(bx + 1, by + 1, w - 2, h - 2, (age - 0.15) / 0.4, 0.3);
      }, { pivot: [ax, ay] });
    }
  }

  const PX = 40;
  const PY = 612;
  const PW = 460;
  const PH = 132;
  const BOX = [PX - 8, PY - 18, PW + 16, PH + 28];
  function panelHead(left, right, rightAge) {
    withAlpha(0.5, () => rect(PX + 6, PY + 6, PW, PH, '#000008'));
    frame(PX, PY, PW, PH, '#5a5ea8', 2);
    rect(PX + 2, PY + 2, PW - 4, 32, '#12153c'); // title strip
    brackets(PX - 5, PY - 5, PW + 10, PH + 10, CYAN, 12, 2);
    runner(PX, PY, PW, PH, 260, WHITE);
    // bouncing equaliser icon
    for (let k = 0; k < 4; k++) {
      const hh = 3 + Math.round(10 * Math.abs(Math.sin(now * 6.5 + k * 1.9)));
      rect(PX + 13 + k * 6, PY + 27 - hh, 4, hh, k % 2 ? CYAN : LILAC);
    }
    text(left, PX + 44, PY + 26, 17, WHITE);
    const lw = width(left, 17);
    if (Math.floor(now * 2.5) % 2 === 0) {
      glowRect(PX + 52 + lw, PY + 14, 7, 7, '#ff4466');
      rect(PX + 52 + lw, PY + 14, 7, 7, '#ff4466');
    }
    const tw = width(right, 17);
    sub(rightAge, PX + PW - 14 - tw - 4, PY + 7, tw + 8, 26, (dx) => text(right, PX + PW - 14 + dx, PY + 26, 17, CYAN, 'r'));
    for (let i = 0; i < PW - 4; i += 6) rect(PX + 2 + i, PY + 34, 3, 1, '#5a5ea8');
  }

  const SEG = 12;
  const SEG_X = PX + 108;
  const SEG_P = 23;
  function drawPanel(act) {
    const o = { from: 'below', dist: 46, boot: true };
    element(BOX, PANELS.bars[0], PANELS.bars[1], () => {
      const sec = SECTIONS.find((k) => now >= k.t0 && now < k.t1) || SECTIONS[0];
      panelHead('กล้ามเนื้อที่ทำงาน', sec.title, sec === SECTIONS[0] ? 1 : now - sec.t0);
      const fr = Math.floor(now * 30);
      HEADS.forEach((hd, i) => {
        const y = PY + 41 + i * 29;
        const a = act[i];
        const hot = a >= 0.88;
        // whole row lights up while the muscle is near its peak
        if (a > 0.6) withAlpha((a - 0.6) * (hot && fr % 6 < 3 ? 0.5 : 0.34), () => rect(PX + 4, y, PW - 8, 24, hd.color));
        const sq = a > 0.55 ? 14 : 12;
        if (a > 0.55) glowRect(PX + 13, y + 5, 14, 14, hd.color);
        rect(PX + 20 - sq / 2, y + 12 - sq / 2, sq, sq, hd.color);
        text(hd.th, PX + 36, y + 18, 17, a > 0.55 ? WHITE : LILAC);

        const lit = Math.round(a * SEG);
        const sweep = Math.floor(now * 16) % (SEG + 8);
        for (let k = 0; k < SEG; k++) {
          const cx = SEG_X + k * SEG_P;
          if (k < lit) {
            const top = k === lit - 1;
            if (top) glowRect(cx, y + 3, 20, 18, hd.color, 1.6);
            rect(cx, y + 3, 20, 18, top ? WHITE : hd.color);
            rect(cx + 2, y + 5, 16, 14, top ? hd.color : shade(hd.color, k === sweep ? 0.95 : 0.55));
            rect(cx + 2, y + 5, 16, 3, top ? WHITE : shade(hd.color, 0.8)); // bevel highlight
          } else {
            rect(cx, y + 3, 20, 18, DIM);
            rect(cx + 1, y + 4, 18, 16, '#0d1030');
            rect(cx + 8, y + 11, 4, 2, DIM);
          }
        }
        // peak-hold marker that falls back slowly
        let peak = 0;
        for (let k = 0; k <= 15; k++) peak = Math.max(peak, actAt(now - k * 0.1)[i] - k * 0.035);
        if (peak > a + 0.03 && peak > 0.08) rect(SEG_X + Math.round(peak * SEG * SEG_P) - 4, y + 2, 3, 20, WHITE);
        // sparks thrown off the tip of a hard-working bar
        if (a > 0.75) {
          const tx = SEG_X + lit * SEG_P - 4;
          for (let j = 0; j < 6; j++) {
            const ph = (now * 2.2 + j * 0.37 + i * 0.21) % 1;
            const vx = 14 + 26 * hash(j * 9.1 + i * 3.3 + Math.floor(now * 2.2 + j * 0.37));
            const vy = (hash(j * 5.7 + i) - 0.5) * 34;
            withAlpha(1 - ph, () => rect(tx + vx * ph, y + 11 + vy * ph, 3, 3, j % 2 ? WHITE : hd.color));
          }
        }
        const pct = `${Math.round(a * 100)}%`;
        if (hot) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) withAlpha(0.5, () => text(pct, PX + PW - 12 + ox, y + 19 + oy, 18, hd.color, 'r'));
        text(pct, PX + PW - 12, y + 19, 18, hot ? (fr % 6 < 3 ? GOLD : WHITE) : a > 0.55 ? WHITE : LILAC, 'r');
      });
    }, o);

    element(BOX, PANELS.summary[0], PANELS.summary[1], () => {
      const ages = HEADS.map((_, i) => now - PANELS.summary[0] - 0.15 - i * 0.45);
      const done = ages[2] > 0.4;
      panelHead('ครบทั้ง 3 มัด', done ? 'ครบ 100%' : 'สูตรไหล่กลม', done ? ages[2] - 0.4 : 1);
      HEADS.forEach((hd, i) => {
        const y = PY + 41 + i * 29;
        const age = ages[i];
        if (age >= 0 && age < 0.35) withAlpha(0.5 * (1 - age / 0.35), () => rect(PX + 4, y, 300, 24, hd.color));
        sub(age, PX + 10, y, 300, 26, (dx) => {
          // tick box
          rect(PX + 13 + dx, y + 4, 15, 15, hd.color);
          rect(PX + 15 + dx, y + 6, 11, 11, INK);
          if (age > 0.2) {
            line(PX + 17 + dx, y + 11, PX + 20 + dx, y + 14, WHITE, 2);
            line(PX + 20 + dx, y + 14, PX + 25 + dx, y + 7, WHITE, 2);
          }
          text(hd.th, PX + 36 + dx, y + 18, 17, WHITE);
          rect(PX + 106 + dx, y + 10, 12, 2, LILAC);
          rect(PX + 114 + dx, y + 7, 2, 8, LILAC);
          rect(PX + 116 + dx, y + 9, 2, 4, LILAC);
          text(hd.move, PX + 126 + dx, y + 18, 18, hd.color);
        });
      });
      // radar chart: the triangle fills out as each head is covered
      const cx = PX + 388;
      const cy = PY + 88;
      const R = 40;
      const dirs = [-90, 30, 150].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)]);
      for (const k of [1 / 3, 2 / 3, 1]) {
        dirs.forEach((d, i) => {
          const e = dirs[(i + 1) % 3];
          line(cx + d[0] * R * k, cy + d[1] * R * k, cx + e[0] * R * k, cy + e[1] * R * k, k === 1 ? '#5a5ea8' : DIM, 1);
        });
      }
      const vals = ages.map((a) => 0.14 + 0.86 * Math.max(0, Math.min(1, a / 0.4)));
      const pulse = done ? 1 + 0.06 * Math.sin((now - PANELS.summary[0]) * 9) : 1;
      const pts = dirs.map((d, i) => [cx + d[0] * R * vals[i] * pulse, cy + d[1] * R * vals[i] * pulse]);
      poly(pts, GOLD, done ? 0.5 : 0.32);
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % 3];
        line(p[0], p[1], q[0], q[1], done ? WHITE : GOLD, 2);
        line(cx, cy, cx + dirs[i][0] * R, cy + dirs[i][1] * R, DIM, 1);
        glowRect(p[0] - 3, p[1] - 3, 7, 7, HEADS[i].color, vals[i]);
        rect(p[0] - 3, p[1] - 3, 7, 7, HEADS[i].color);
      });
      if (done) {
        for (let j = 0; j < 5; j++) {
          const ph = (now * 1.3 + j * 0.31) % 1;
          const an = hash(j * 3.1 + Math.floor(now * 1.3 + j * 0.31)) * Math.PI * 2;
          withAlpha(1 - ph, () => sparkle(Math.round(cx + Math.cos(an) * (R + 6) * ph), Math.round(cy + Math.sin(an) * (R + 6) * ph), 2, WHITE));
        }
      }
    }, { ...o, noIn: true, boot: false });

    element(BOX, PANELS.cta[0], PANELS.cta[1], () => {
      const age = now - PANELS.cta[0];
      withAlpha(0.5, () => rect(PX + 6, PY + 6, PW, PH, '#000008'));
      rect(PX, PY, PW, PH, INK);
      // marching border
      const off = Math.floor(now * 12);
      const dot = (px, py, d) => rect(px, py, 3, 3, Math.floor((d + off) / 8) % 2 ? CYAN : PINK);
      for (let d = 0; d < PW; d += 4) {
        dot(PX + d, PY, d);
        dot(PX + PW - 3 - d, PY + PH - 3, d + PW + PH);
      }
      for (let d = 0; d < PH; d += 4) {
        dot(PX + PW - 3, PY + d, d + PW);
        dot(PX, PY + PH - 3 - d, d + 2 * PW + PH);
      }
      brackets(PX - 5, PY - 5, PW + 10, PH + 10, GOLD, 14, 2);
      const chip = 'เซฟคลิปนี้ไว้';
      const cw = width(chip, 17) + 34;
      const bob = Math.round(Math.sin(now * 6) * 2);
      glowRect(HW / 2 - cw / 2, PY - 13 + bob, cw, 26, CYAN, 1.4);
      rect(HW / 2 - cw / 2, PY - 13 + bob, cw, 26, CYAN);
      for (let i = 0; i < 6; i++) rect(HW / 2 - cw / 2 + 9 + i, PY - 7 + i + bob, 1, 14 - 2 * i, INK);
      text(chip, HW / 2 + 9, PY + 6 + bob, 17, INK, 'c');
      text('ไหล่กลม = ฝึกครบ 3 มัด', HW / 2, PY + 58, 30, WHITE, 'c');
      // the three heads light up in turn
      const names = ['หน้า', 'กลาง', 'หลัง'];
      const on = Math.floor(now * 2.5) % 3;
      const ws = names.map((nm) => width(nm, 19));
      let nx = HW / 2 - (ws.reduce((p, c) => p + c, 0) + 3 * 18 + 2 * 22) / 2;
      names.forEach((nm, i) => {
        if (i === on) glowRect(nx, PY + 74, 12, 12, HEADS[i].color);
        rect(nx, PY + 74, 12, 12, HEADS[i].color);
        text(nm, nx + 18, PY + 87, 19, i === on ? WHITE : LILAC);
        nx += 18 + ws[i] + 22;
      });
      text(Math.floor(now * 4) % 2 ? '♥ แชร์ให้เพื่อนสายยิม ♥' : 'แชร์ให้เพื่อนสายยิม', HW / 2, PY + 117, 18, PINK, 'c');
      shine(PX + 3, PY + 3, PW - 6, PH - 6, ((age + 0.2) % 1.5) / 0.6, 0.16);
      for (let j = 0; j < 7; j++) {
        const ph = (now * 1.1 + j * 0.29) % 1;
        const sd = Math.floor(now * 1.1 + j * 0.29) * 7.3 + j * 13.7;
        const sx = PX + 10 + hash(sd) * (PW - 20);
        const sy = hash(sd + 3.3) > 0.5 ? PY - 2 : PY + PH + 1;
        withAlpha(Math.sin(ph * Math.PI), () => sparkle(Math.round(sx), sy, ph < 0.5 ? 3 : 2, j % 2 ? GOLD : WHITE));
      }
    }, o);
  }

  // live "muscle signal" scope: three scrolling bursts driven by the same activation data
  function drawScope() {
    const X = 12;
    const Y = 802;
    const W = 372;
    const H = 110;
    element([X - 6, Y - 6, W + 12, H + 12], PANELS.bars[0] + 0.15, PANELS.bars[1], () => {
      withAlpha(0.5, () => rect(X + 5, Y + 5, W, H, '#000008'));
      frame(X, Y, W, H, '#5a5ea8', 2);
      brackets(X - 4, Y - 4, W + 8, H + 8, CYAN, 8, 2);
      text('สัญญาณกล้ามเนื้อ', X + 10, Y + 17, 13, LILAC);
      if (Math.floor(now * 2.5) % 2) rect(X + W - 46, Y + 8, 6, 6, '#ff4466');
      text('LIVE', X + W - 8, Y + 16, 12, '#ff4466', 'r');
      const x0 = X + 30;
      const x1 = X + W - 10;
      const DT = 0.03;
      const kNow = Math.floor(now / DT);
      const offs = (now / DT - kNow) * 3;
      // time grid scrolling with the signal
      for (let n = 0; n < 130; n++) {
        const k = kNow - n;
        if (k % 33 !== 0) continue;
        const gx = Math.round(x1 - n * 3 - offs);
        if (gx > x0) for (let yy = Y + 24; yy < Y + H - 6; yy += 4) rect(gx, yy, 1, 2, DIM);
      }
      HEADS.forEach((hd, i) => {
        const cy = Y + 36 + i * 27;
        rect(X + 10, cy - 5, 10, 10, hd.color);
        for (let xx = x0; xx < x1; xx += 6) rect(xx, cy, 3, 1, DIM);
        for (let n = 0; n < 130; n++) {
          const gx = Math.round(x1 - n * 3 - offs);
          if (gx <= x0) break;
          const k = kNow - n;
          const a = actAt(k * DT)[i];
          const amp = Math.round(a * (0.3 + 0.7 * hash(k * 1.37 + i * 17.7)) * 11);
          if (amp < 1) continue;
          const fade = gx < x0 + 50 ? (gx - x0) / 50 : 1;
          withAlpha(fade, () => {
            rect(gx, cy - amp, 2, amp * 2 + 1, n < 3 ? WHITE : shade(hd.color, 0.75));
            rect(gx, cy - amp, 2, 2, hd.color);
            rect(gx, cy + amp - 1, 2, 2, hd.color);
          });
        }
        const aN = actAt(now)[i];
        if (aN > 0.3) glowRect(x1 - 1, cy - 2, 4, 5, hd.color, aN * 1.6);
        rect(x1 - 1, cy - 2, 4, 5, aN > 0.3 ? WHITE : DIM);
      });
    }, { boot: true });
  }

  function drawGauge(angle) {
    const cx = 458;
    const cy = 850;
    const r = 60;
    const inZone = angle >= 78 && angle <= 96;
    const fr = Math.floor(now * 30);
    element([cx - r - 12, cy - r - 36, 2 * r + 24, 2 * r + 50], -1, 1e9, () => {
      // slowly spinning outer ring
      for (let k = 0; k < 24; k++) {
        const an = (k / 24) * Math.PI * 2 + now * 0.6;
        withAlpha(k % 3 ? 0.35 : 0.9, () => rect(cx + Math.cos(an) * (r + 7) - 1, cy + Math.sin(an) * (r + 7) - 1, 3, 3, inZone ? PINK : LILAC));
      }
      disc(cx, cy, r, INK);
      if (inZone) withAlpha(0.35 + 0.25 * Math.sin(now * 14), () => ring(cx, cy, r + 2, PINK, 3));
      ring(cx, cy, r, inZone ? PINK : '#c8c8f0', 2);
      // swept arc: lights up to the current angle
      const cl = Math.max(0, Math.min(180, angle));
      for (let d = 0; d <= 180; d += 5) {
        const a = (d * Math.PI) / 180;
        const px = cx + Math.sin(a) * (r - 7);
        const py = cy + Math.cos(a) * (r - 7);
        const zone = d >= 80 && d <= 95;
        if (d <= cl) {
          const head = d + 5 > cl;
          if (head) glowRect(px - 2, py - 2, 4, 4, GOLD, 1.8);
          rect(px - 2, py - 2, 4, 4, head ? WHITE : zone ? PINK : GOLD);
        } else rect(px - 1, py - 1, 3, 3, zone ? '#7a2a58' : DIM);
      }
      for (let d = 0; d <= 180; d += 30) {
        const a = (d * Math.PI) / 180;
        line(cx + Math.sin(a) * (r - 17), cy + Math.cos(a) * (r - 17), cx + Math.sin(a) * (r - 12), cy + Math.cos(a) * (r - 12), d === 90 ? PINK : LILAC, d === 90 ? 2 : 1);
      }
      // needle with motion ghosts
      for (let k = 3; k >= 1; k--) {
        const ga = (Math.max(0, Math.min(180, pose(Math.max(0, now - k * 0.07)).armAngle)) * Math.PI) / 180;
        withAlpha(0.42 - k * 0.1, () => line(cx, cy, cx + Math.sin(ga) * (r - 20), cy + Math.cos(ga) * (r - 20), GOLD, 2));
      }
      const a = (cl * Math.PI) / 180;
      const nx = cx + Math.sin(a) * (r - 19);
      const ny = cy + Math.cos(a) * (r - 19);
      line(cx, cy, nx, ny, GOLD, 2);
      glowRect(nx - 2, ny - 2, 4, 4, GOLD);
      rect(nx - 2, ny - 2, 4, 4, WHITE);
      disc(cx, cy, 4, WHITE);
      disc(cx, cy, 2, INK);
      text(`${Math.round(angle)}°`, cx - 8, cy + 2, 24, inZone && fr % 6 < 3 ? WHITE : GOLD, 'r');
      // label flips to a "shoulder height" badge inside the target zone
      const label = inZone ? 'ระดับไหล่!' : 'มุมแขน';
      const lw = width(label, 16) + 14;
      if (inZone) {
        glowRect(cx - lw / 2, cy - r - 34, lw, 25, PINK, 1.5);
        rect(cx - lw / 2, cy - r - 34, lw, 25, PINK);
        text(label, cx, cy - r - 16, 16, INK, 'c');
      } else {
        frame(cx - lw / 2, cy - r - 34, lw, 25, '#5a5ea8', 1);
        text(label, cx, cy - r - 16, 16, WHITE, 'c');
      }
    });
  }

  // dotted arc + arrowhead that follows the dumbbell, showing the direction of travel
  function drawTrail(pts) {
    if (!pts || pts.length < 6) return;
    const [x1, y1] = pts[pts.length - 1];
    const [x0, y0] = pts[0];
    if (Math.hypot(x1 - x0, y1 - y0) < 26) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const bx = Math.min(...xs) - 12;
    const by = Math.min(...ys) - 12;
    element([bx, by, Math.max(...xs) - bx + 12, Math.max(...ys) - by + 12], -1, 1e9, () => {
      for (let i = 0; i < pts.length - 2; i += 2) {
        const k = i / pts.length;
        rect(pts[i][0] - 1, pts[i][1] - 1, 3, 3, k < 0.35 ? '#6b5a1c' : k < 0.7 ? '#b8962c' : GOLD);
      }
      const [px, py] = pts[pts.length - 4];
      const d = Math.hypot(x1 - px, y1 - py) || 1;
      const ux = (x1 - px) / d;
      const uy = (y1 - py) / d;
      const tx = x1 + ux * 34;
      const ty = y1 + uy * 34;
      for (let i = 0; i < 9; i++) {
        const hw = (9 - i) * 0.9;
        line(tx - ux * (9 - i) - uy * hw, ty - uy * (9 - i) + ux * hw, tx - ux * (9 - i) + uy * hw, ty - uy * (9 - i) - ux * hw, GOLD, 2);
      }
    });
  }

  function drawCallouts(project) {
    for (const c of CALLOUTS) {
      if (now < c.t0 || now >= c.t1) continue;
      const [ax, ay] = project(c.anchor, HW, HH);
      const age = now - c.t0;
      const px = age < 0.07 ? 56 : age < 0.14 ? 47 : 40; // punch in
      const w = width(c.text, 56);
      const jig = age < 0.2 ? Math.round((hash(Math.floor(now * 30)) - 0.5) * 8) : 0;
      const cx = Math.max(w / 2 + 44, Math.min(HW - w / 2 - 44, ax + c.off[0])) + jig;
      const cy = Math.max(210, Math.min(580, ay + c.off[1]));
      element([cx - w / 2 - 40, cy - 78, w + 80, 120], c.t0, c.t1, () => {
        // impact burst
        if (age < 0.4) {
          const k = age / 0.4;
          for (let j = 0; j < 14; j++) {
            const an = (j / 14) * Math.PI * 2 + 0.2;
            const r0 = 30 + k * 34 + (j % 2) * 6;
            const len = (1 - k) * (j % 2 ? 22 : 14);
            line(cx + Math.cos(an) * r0 * 1.25, cy - 16 + Math.sin(an) * r0 * 0.8, cx + Math.cos(an) * (r0 + len) * 1.25, cy - 16 + Math.sin(an) * (r0 + len) * 0.8, j % 2 ? GOLD : WHITE, 2);
          }
        }
        for (const [ox, oy] of [[4, 4], [-2, 0], [2, 0], [0, -2], [0, 2]]) text(c.text, cx + ox, cy + oy, px, INK, 'c');
        text(c.text, cx, cy, px, age < 0.1 ? WHITE : GOLD, 'c');
      }, { noIn: true, noOut: true });
    }
  }

  function drawChapter() {
    const c = CHAPTERS.find((k) => now >= k.t0 && now < k.t0 + 2.4);
    if (!c) return;
    const tw = width(c.text, 20);
    const w = tw + 62;
    const Y = 752;
    element([12, Y - 4, w + 8, 52], c.t0, c.t0 + 2.4, () => {
      const age = now - c.t0;
      withAlpha(0.5, () => rect(16, Y + 4, w, 44, '#000008'));
      frame(12, Y, w, 44, WHITE, 2);
      rect(14, Y + 2, 34, 40, GOLD);
      text(String(c.n), 31, Y + 33, 30, INK, 'c');
      sub(motion === 1 ? age - 0.1 : 9, 54, Y + 8, tw + 4, 30, () => text(c.text, 56, Y + 30, 20, WHITE), Math.min(0.5, c.text.length * 0.035));
      shine(14, Y + 2, w - 4, 40, (age - 0.3) / 0.45, 0.3);
    }, { wipe: true });
  }

  function draw(t, state, project, trail) {
    now = t;
    m.clearRect(0, 0, HW * S, HH * S);
    drawTrail(trail);
    drawLabels(project);
    drawCallouts(project);
    drawPanel(state.act);
    drawScope();
    drawGauge(state.armAngle);
    drawChapter();
    drawCaption();
    drawStatus();
    if (tag) {
      const tw = width(tag, 20) + 24;
      element([HW / 2 - tw / 2, 150, tw, 36], -1, 1e9, () => {
        frame(HW / 2 - tw / 2, 150, tw, 36, '#ffc13d', 2, '#ffc13d');
        text(tag, HW / 2, 175, 20, INK, 'c');
      });
    }
    if (WATERMARK) element([8, 580, 300, 26], -1, 1e9, () => text(WATERMARK, 10, 598, 16, '#7f81bd', 'l', 600));
  }

  // ---------------------------------------------------------------- cover image
  // text with a dark outline and a hard shadow, readable over anything
  function outlined(str, x, y, px, color, align = 'c') {
    const o = Math.max(2, Math.round(px / 16));
    text(str, x + o + 2, y + o + 3, px, '#000008', align);
    for (let dx = -o; dx <= o; dx += o) for (let dy = -o; dy <= o; dy += o) if (dx || dy) text(str, x + dx, y + dy, px, INK, align);
    text(str, x, y, px, color, align);
  }
  function drawCover(c, project) {
    now = 0;
    m.clearRect(0, 0, HW * S, HH * S);
    g.clearRect(0, 0, HW, HH);
    // a row of numbered tags, one per compared thing, in its accent colour
    const tw = c.tags.map((tg) => Math.max(width(tg.text, 24), width(tg.sub, 13)) + 50);
    const gap = 8;
    let tx = Math.round((HW - (tw.reduce((a, b) => a + b, 0) + gap * (c.tags.length - 1))) / 2);
    const ty = 700;
    c.tags.forEach((tg, i) => {
      const color = HEADS[i].color;
      const w = tw[i];
      withAlpha(0.6, () => rect(tx + 4, ty + 4, w, 56, '#000008'));
      frame(tx, ty, w, 56, color, 3);
      rect(tx, ty, 36, 56, color);
      text(String(tg.n), tx + 18, ty + 40, 34, INK, 'c');
      text(tg.text, tx + 43, ty + 28, 24, WHITE);
      text(tg.sub, tx + 43, ty + 46, 13, color);
      tx += w + gap;
    });
    // headline
    if (c.kicker) {
      const kw = width(c.kicker, 22) + 28;
      rect(HW / 2 - kw / 2 + 4, 116, kw, 34, '#000008');
      rect(HW / 2 - kw / 2, 112, kw, 34, PINK);
      text(c.kicker, HW / 2, 137, 22, INK, 'c');
    }
    let px = 118;
    while (width(c.title, px) > HW - 56 && px > 40) px -= 4;
    outlined(c.title, HW / 2, 152 + px * 0.86, px, GOLD);
    const sy = 152 + px * 0.86 + 62;
    const ws = c.sub.map((part) => width(part, 44));
    let x = HW / 2 - ws.reduce((a, b) => a + b, 0) / 2;
    c.sub.forEach((part, i) => {
      outlined(part, x, sy, 44, i === 1 ? GOLD : WHITE, 'l');
      x += ws[i];
    });
    // footer strip with a play mark
    if (c.footer) {
      const fw = width(c.footer, 28) + 74;
      const fx = HW / 2 - fw / 2;
      const fy = 776;
      withAlpha(0.6, () => rect(fx + 5, fy + 5, fw, 52, '#000008'));
      frame(fx, fy, fw, 52, GOLD, 3);
      brackets(fx - 7, fy - 7, fw + 14, 66, CYAN, 14, 3);
      for (let i = 0; i < 11; i++) rect(fx + 18 + i, fy + 15 + i, 1, 22 - 2 * i, GOLD);
      text(c.footer, fx + 42 + (fw - 60) / 2, fy + 37, 28, WHITE, 'c');
    }
    if (WATERMARK) outlined(WATERMARK, HW / 2, 868, 20, WHITE);
    m.drawImage(scratch, 0, 0);
  }

  return { canvas, draw, drawCover };
}
