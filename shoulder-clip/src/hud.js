// HUD drawn in a 540x960 coordinate space onto a 1080x1920 canvas.
// Options:
//   font   - CSS font family for all text
//   smooth - true: crisp anti-aliased text; false: alpha-thresholded "pixel" text
//   motion - 0 pop | 1 wipe/type | 2 slide + spring | 3 glitch/scan
import { CAPTIONS, LABELS, HEADS, WATERMARK, STATUS, SECTIONS, PANELS, CALLOUTS, CHAPTERS } from './timeline.js';

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
      if (o.wipe && a < IN && !noIn) blit(x, y, Math.ceil((w * Math.ceil((a / IN) * 10)) / 10), h);
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

  // ---------------------------------------------------------------- elements
  function drawStatus() {
    const st = STATUS.find((k) => now >= k.t0 && now < k.t1);
    if (!st) return;
    const color = st.play ? '#ff4466' : CYAN;
    const w = width(st.text, 17) + 34;
    element([8, 22, w, 28], st.t0, st.t1, () => {
      frame(8, 22, w, 28, color, 2);
      if (st.play) for (let i = 0; i < 6; i++) rect(16 + i, 29 + i, 1, 14 - 2 * i, color);
      else {
        rect(15, 29, 3, 14, color);
        rect(21, 29, 3, 14, color);
      }
      text(st.text, 30, 43, 17, color);
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
    element([x, y, w, h], c.t0, c.t1, () => {
      frame(x, y, w, h, motion === 0 && now - c.t0 < 0.07 ? CYAN : WHITE, 2);
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
      const x0 = Math.min(bx, ax - 3);
      const y0 = Math.min(by, ay - 3);
      const x1 = Math.max(bx + w, ax + 4);
      const y1 = Math.max(by + h, ay + 4);
      element([x0, y0, x1 - x0, y1 - y0], l.t0, l.t1, () => {
        const grow = motion === 0 ? Math.min(1, (now - l.t0) / 0.2) : 1;
        line(ex, ey, ex + (ax - ex) * grow, ey + (ay - ey) * grow, WHITE, 1);
        if (grow >= 1) rect(ax - 2, ay - 2, 5, 5, l.color);
        frame(bx, by, w, h, l.color, 1);
        text(l.text, bx + 7, by + 19, 17, WHITE);
      }, { pivot: [ax, ay] });
    }
  }

  const PX = 40;
  const PY = 612;
  const PW = 460;
  const PH = 132;
  function panelHead(left, right, rightAge) {
    frame(PX, PY, PW, PH, '#5a5ea8', 2);
    rect(PX + 14, PY + 15, 4, 10, LILAC);
    rect(PX + 18, PY + 18, 10, 4, LILAC);
    rect(PX + 28, PY + 15, 4, 10, LILAC);
    text(left, PX + 42, PY + 27, 17, LILAC);
    const tw = width(right, 17);
    sub(rightAge, PX + PW - 14 - tw - 4, PY + 8, tw + 8, 26, (dx) => text(right, PX + PW - 14 + dx, PY + 27, 17, CYAN, 'r'));
  }
  function drawPanel(act) {
    const box = [PX, PY - 14, PW, PH + 14];
    const o = { from: 'below', dist: 46 };
    element(box, PANELS.bars[0], PANELS.bars[1], () => {
      const sec = SECTIONS.find((k) => now >= k.t0 && now < k.t1) || SECTIONS[0];
      panelHead('กล้ามเนื้อที่ทำงาน', sec.title, sec === SECTIONS[0] ? 1 : now - sec.t0);
      HEADS.forEach((hd, i) => {
        const y = PY + 40 + i * 29;
        const a = act[i];
        rect(PX + 14, y + 5, 12, 12, hd.color);
        text(hd.th, PX + 36, y + 18, 17, a > 0.55 ? WHITE : LILAC);
        if (motion === 2) {
          // smooth meter with a percentage read-out
          const tw = 286;
          rect(PX + 112, y + 5, tw, 13, DIM);
          rect(PX + 113, y + 6, tw - 2, 11, '#0d1030');
          const fw = Math.round((tw - 2) * a);
          rect(PX + 113, y + 6, fw, 11, shade(hd.color, 0.62));
          rect(PX + 113, y + 6, fw, 4, hd.color);
          if (fw > 3) rect(PX + 113 + fw - 3, y + 4, 3, 15, WHITE);
          text(`${Math.round(a * 100)}%`, PX + PW - 14, y + 18, 16, a > 0.55 ? WHITE : LILAC, 'r');
          return;
        }
        const n = 10;
        const lit = Math.round(a * n);
        for (let k = 0; k < n; k++) {
          const cx = PX + 112 + k * 34;
          if (k < lit) {
            let top = k === lit - 1;
            if (motion === 3 && top && Math.floor(now * 30) % 4 === 0) top = false;
            rect(cx, y + 3, 30, 17, top ? WHITE : hd.color);
            rect(cx + 2, y + 5, 26, 13, top ? hd.color : shade(hd.color, 0.5));
          } else {
            rect(cx, y + 3, 30, 17, DIM);
            rect(cx + 1, y + 4, 28, 15, '#0d1030');
          }
        }
      });
    }, o);
    element(box, PANELS.summary[0], PANELS.summary[1], () => {
      panelHead('ครบทั้ง 3 มัด', 'สูตรไหล่กลม', 1);
      HEADS.forEach((hd, i) => {
        const y = PY + 40 + i * 29;
        const age = now - PANELS.summary[0] - 0.15 - i * 0.45;
        sub(age, PX + 10, y, PW - 20, 26, (dx) => {
          rect(PX + 14 + dx, y + 5, 12, 12, hd.color);
          text(hd.th, PX + 36 + dx, y + 18, 17, WHITE);
          rect(PX + 112 + dx, y + 10, 14, 2, LILAC);
          rect(PX + 122 + dx, y + 7, 2, 8, LILAC);
          rect(PX + 124 + dx, y + 9, 2, 4, LILAC);
          text(hd.move, PX + 138 + dx, y + 18, 18, age < 0.3 && motion === 0 ? WHITE : hd.color);
        });
      });
    }, { ...o, noIn: true });
    element(box, PANELS.cta[0], PANELS.cta[1], () => {
      const blink = Math.floor(now * 4) % 2;
      dotted(PX, PY, PW, PH, CYAN, PINK);
      const chip = 'เซฟคลิปนี้ไว้';
      const cw = width(chip, 17) + 34;
      rect(HW / 2 - cw / 2, PY - 13, cw, 26, CYAN);
      for (let i = 0; i < 6; i++) rect(HW / 2 - cw / 2 + 9 + i, PY - 7 + i, 1, 14 - 2 * i, INK);
      text(chip, HW / 2 + 9, PY + 6, 17, INK, 'c');
      text('ไหล่กลม = ฝึกครบ 3 มัด', HW / 2, PY + 58, 30, WHITE, 'c');
      text('หน้า · กลาง · หลัง', HW / 2, PY + 88, 19, LILAC, 'c');
      text(blink ? '♥ แชร์ให้เพื่อนสายยิม ♥' : 'แชร์ให้เพื่อนสายยิม', HW / 2, PY + 117, 18, PINK, 'c');
    }, o);
  }

  function drawGauge(angle) {
    const cx = 458;
    const cy = 850;
    const r = 60;
    element([cx - r - 2, cy - r - 32, 2 * r + 6, 2 * r + 36], -1, 1e9, () => {
      disc(cx, cy, r, INK);
      ring(cx, cy, r, '#c8c8f0', 2);
      for (let d = 0; d <= 180; d += 30) {
        const a = (d * Math.PI) / 180;
        const sx = Math.sin(a);
        const sy = Math.cos(a);
        line(cx + sx * (r - 9), cy + sy * (r - 9), cx + sx * (r - 3), cy + sy * (r - 3), d === 90 ? PINK : '#c8c8f0', d === 90 ? 2 : 1);
      }
      for (let d = 82; d <= 98; d += 2) {
        const a = (d * Math.PI) / 180;
        rect(cx + Math.sin(a) * (r - 13), cy + Math.cos(a) * (r - 13), 2, 2, PINK);
      }
      const a = (Math.max(0, Math.min(180, angle)) * Math.PI) / 180;
      line(cx, cy, cx + Math.sin(a) * (r - 14), cy + Math.cos(a) * (r - 14), GOLD, 2);
      disc(cx, cy, 3, WHITE);
      text(`${Math.round(angle)}°`, cx - 7, cy + 2, 23, GOLD, 'r');
      const lw = width('มุมแขน', 16) + 14;
      frame(cx - lw / 2, cy - r - 30, lw, 25, '#5a5ea8', 1);
      text('มุมแขน', cx, cy - r - 12, 16, WHITE, 'c');
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
      const tx = x1 + ux * 16;
      const ty = y1 + uy * 16;
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
      const px = 40;
      const w = width(c.text, px);
      const jig = age < 0.2 ? Math.round((hash(Math.floor(now * 30)) - 0.5) * 8) : 0;
      const cx = Math.max(w / 2 + 10, Math.min(HW - w / 2 - 10, ax + c.off[0])) + jig;
      const cy = Math.max(200, Math.min(590, ay + c.off[1]));
      element([cx - w / 2 - 6, cy - px, w + 14, px + 22], c.t0, c.t1, () => {
        for (const [ox, oy] of [[3, 3], [-2, 0], [2, 0], [0, -2], [0, 2]]) text(c.text, cx + ox, cy + oy, px, INK, 'c');
        text(c.text, cx, cy, px, GOLD, 'c');
      }, { noIn: true, noOut: true });
    }
  }

  function drawChapter() {
    const c = CHAPTERS.find((k) => now >= k.t0 && now < k.t0 + 2.4);
    if (!c) return;
    const tw = width(c.text, 20);
    const w = tw + 62;
    element([12, 826, w, 44], c.t0, c.t0 + 2.4, () => {
      frame(12, 826, w, 44, WHITE, 2);
      text(String(c.n), 26, 859, 30, GOLD);
      sub(motion === 1 ? now - c.t0 - 0.1 : 9, 54, 834, tw + 4, 30, () => text(c.text, 56, 856, 20, WHITE), Math.min(0.5, c.text.length * 0.035));
    }, { wipe: true });
  }

  function draw(t, state, project, trail) {
    now = t;
    m.clearRect(0, 0, HW * S, HH * S);
    drawTrail(trail);
    drawLabels(project);
    drawCallouts(project);
    drawPanel(state.act);
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

  return { canvas, draw };
}
