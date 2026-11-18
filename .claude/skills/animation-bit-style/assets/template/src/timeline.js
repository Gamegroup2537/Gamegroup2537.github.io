// Single source of truth for the clip: every visual, HUD element and sound
// reads its state from the functions in this file.

export const FPS = 30;
export const DURATION = 32; // seconds = 16 bars at 120 BPM, loops seamlessly
export const FRAMES = FPS * DURATION;
export const BPM = 120;

// Optional brand watermark drawn on screen (leave empty for none).
export const WATERMARK = '';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const sstep = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const track = (keys, t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) return v0 + (v1 - v0) * sstep(t0, t1, t);
  }
  return keys[keys.length - 1][1];
};
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const nlerp = (a, b, k) =>
  norm([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
const bump = (a, b, t) => sstep(a, a + 0.3, t) * (1 - sstep(b - 0.3, b, t));

// ---------------------------------------------------------------- colours
export const HEADS = [
  { key: 'front', th: 'มัดหน้า', color: '#3fd9f2', move: 'OVERHEAD PRESS' },
  { key: 'mid', th: 'มัดกลาง', color: '#ff4fa8', move: 'LATERAL RAISE' },
  { key: 'rear', th: 'มัดหลัง', color: '#8be04e', move: 'REVERSE FLY' },
];

// ---------------------------------------------------------------- motion channels
// Lateral raise amount (0 = arms down, 1 = shoulder height)
export function chLateral(t) {
  if (t < 4.8) {
    // real-speed reps (one per bar) that decelerate into slow motion
    let ph;
    if (t < 3) ph = t / 2;
    else {
      const d = Math.min(t, 4) - 3;
      ph = 1.5 + (d - 0.335 * d * d) / 2;
    }
    return (0.5 - 0.5 * Math.cos(2 * Math.PI * ph)) * (1 - sstep(4.0, 4.8, t));
  }
  if (t < 14.2) return track([[9.3, 0], [12.0, 1], [12.7, 1], [13.9, 0]], t);
  if (t >= 26) return 0.5 - 0.5 * Math.cos(2 * Math.PI * ((t - 26) / 2));
  return 0;
}
export const chHinge = (t) => track([[14.0, 0], [15.1, 1], [18.9, 1], [19.9, 0]], t);
export const chRear = (t) => track([[15.2, 0], [17.3, 1], [18.0, 1], [18.8, 0]], t);
export const chRack = (t) => track([[19.3, 0], [20.3, 1], [23.9, 1], [25.2, 0]], t);
export const chPress = (t) => track([[20.4, 0], [22.2, 1], [22.7, 1], [23.8, 0]], t);
export const chXray = (t) => track([[3.1, 0], [4.0, 1], [25.0, 1], [26.0, 0]], t);

const HINGE_MAX = 1.13; // rad (~65 deg forward lean)

// Pose for the +x arm in torso-local space (mirror x for the other arm).
export function pose(t) {
  const a = chLateral(t);
  const hg = chHinge(t);
  const b = chRear(t);
  const rk = chRack(t);
  const p = chPress(t);
  const h = hg * HINGE_MAX;

  // lateral raise, in the scapular plane (25 deg in front of the body)
  const ang = ((8 + 77 * a) * Math.PI) / 180;
  const az = (25 * Math.PI) / 180;
  let up = [Math.sin(ang) * Math.cos(az), -Math.cos(ang), Math.sin(ang) * Math.sin(az)];
  let fore = norm([up[0], up[1] - 0.08, up[2] + 0.2]);
  let handle = [0, 0, 1];

  // bent-over reverse fly
  if (hg > 0) {
    const down = [0, -Math.cos(h), Math.sin(h)];
    const bb = ((6 + 80 * b) * Math.PI) / 180;
    const bf = bb - (12 * Math.PI) / 180;
    const upR = norm([Math.sin(bb), down[1] * Math.cos(bb), down[2] * Math.cos(bb)]);
    const foreR = norm([Math.sin(bf), down[1] * Math.cos(bf), down[2] * Math.cos(bf)]);
    up = nlerp(up, upR, hg);
    fore = nlerp(fore, foreR, hg);
    handle = nlerp(handle, [0, 1, 0.2], hg);
  }

  // overhead press
  if (rk > 0) {
    const upP = nlerp([0.8, -0.45, 0.3], [0.2, 1, 0.04], p);
    const foreP = nlerp([-0.1, 1, 0.06], [-0.04, 1, 0], p);
    up = nlerp(up, upP, rk);
    fore = nlerp(fore, foreP, rk);
    handle = nlerp(handle, [1, 0, 0], rk);
  }

  // arm angle away from "hanging straight down", in world space (for the gauge)
  const yWorld = up[1] * Math.cos(h) - up[2] * Math.sin(h);
  const armAngle = (Math.acos(Math.max(-1, Math.min(1, -yWorld))) * 180) / Math.PI;

  return { hinge: h, up, fore, handle, armAngle };
}

// Muscle activation per head [front, mid, rear], 0..1
const W_LAT = [0.32, 1.0, 0.28];
const W_REAR = [0.04, 0.42, 1.0];
const W_PRESS = [1.0, 0.5, 0.08];
const eff = (x) => 0.18 + 0.82 * x;

export function activation(t) {
  const wl =
    t < 4.8
      ? 1 - sstep(4.0, 4.8, t)
      : sstep(9.0, 9.4, t) * (1 - sstep(13.9, 14.2, t)) + sstep(25.6, 26.0, t);
  const wr = chHinge(t);
  const wp = chRack(t);
  const eL = eff(chLateral(t));
  const eR = eff(chRear(t));
  const eP = eff(chPress(t));
  // anatomy intro: each head lights up as it is named
  const hi = [bump(5.2, 6.5, t), bump(6.5, 7.7, t), bump(7.7, 8.9, t)];
  return [0, 1, 2].map((i) =>
    clamp01(wl * W_LAT[i] * eL + wr * W_REAR[i] * eR + wp * W_PRESS[i] * eP + hi[i] * 0.92)
  );
}

// ---------------------------------------------------------------- camera
// az: degrees around the figure (0 = front), el: elevation, d: distance, t*: look-at
const CAM = [
  { t: 0.0, az: 48, el: 15, d: 6.8, tx: -0.11, ty: 1.2, tz: 0.12 },
  { t: 3.0, az: 42, el: 13, d: 6.5, tx: -0.11, ty: 1.2, tz: 0.12 },
  { t: 4.9, az: 28, el: 9, d: 3.5, tx: 0.2, ty: 1.3, tz: 0.02 },
  { t: 6.2, az: 44, el: 9, d: 3.5, tx: 0.2, ty: 1.3, tz: 0.02 },
  { t: 7.0, az: 96, el: 8, d: 3.5, tx: 0.2, ty: 1.3, tz: 0.0 },
  { t: 7.6, az: 104, el: 8, d: 3.5, tx: 0.2, ty: 1.3, tz: 0.0 },
  { t: 8.4, az: 150, el: 11, d: 3.6, tx: 0.2, ty: 1.3, tz: -0.02 },
  { t: 9.5, az: 140, el: 20, d: 4.6, tx: 0.4, ty: 1.28, tz: 0.05 },
  { t: 14.0, az: 134, el: 20, d: 4.6, tx: 0.4, ty: 1.28, tz: 0.05 },
  { t: 15.3, az: 158, el: 33, d: 5.0, tx: 0.3, ty: 1.0, tz: 0.36 },
  { t: 19.0, az: 150, el: 30, d: 5.0, tx: 0.3, ty: 1.0, tz: 0.36 },
  { t: 20.4, az: 24, el: 8, d: 6.0, tx: 0.0, ty: 1.44, tz: 0.0 },
  { t: 24.0, az: 18, el: 8, d: 6.0, tx: 0.0, ty: 1.44, tz: 0.0 },
  { t: 26.2, az: 40, el: 14, d: 6.6, tx: -0.11, ty: 1.2, tz: 0.12 },
  { t: 32.0, az: 48, el: 15, d: 6.8, tx: -0.11, ty: 1.2, tz: 0.12 },
];
export function cameraAt(t) {
  let i = 0;
  while (i < CAM.length - 2 && t > CAM[i + 1].t) i++;
  const a = CAM[i];
  const b = CAM[i + 1];
  const k = sstep(a.t, b.t, t);
  const o = {};
  for (const key of ['az', 'el', 'd', 'tx', 'ty', 'tz']) o[key] = a[key] + (b[key] - a[key]) * k;
  return o;
}

// ---------------------------------------------------------------- HUD content
export const CAPTIONS = [
  { t0: 0.0, t1: 4.6, big: true, l1: 'อยากไหล่กลม ทรงสวย', l2: 'ต้องฝึกท่าไหน?' },
  { t0: 4.8, t1: 9.0, l1: 'ไหล่ = กล้ามเนื้อเดลทอยด์', l2: 'แบ่งเป็น 3 มัด' },
  { t0: 9.0, t1: 11.6, l1: 'มัดกลาง = ไหล่กว้าง ดูกลม', l2: 'ท่า LATERAL RAISE' },
  { t0: 11.6, t1: 14.0, l1: 'ศอกนำ ยกแค่ระดับไหล่', l2: 'อย่ายักไหล่ช่วย' },
  { t0: 14.0, t1: 16.6, l1: 'มัดหลัง = ไหล่หนา มีมิติ', l2: 'ท่า REVERSE FLY' },
  { t0: 16.6, t1: 19.0, l1: 'ก้มตัว กางแขนออกข้าง', l2: 'บีบค้างบนสุด 1 วินาที' },
  { t0: 19.0, t1: 21.6, l1: 'มัดหน้า = ไหล่เต็มด้านหน้า', l2: 'ท่า OVERHEAD PRESS' },
  { t0: 21.6, t1: 24.0, l1: 'ท่าดันอกก็ใช้มัดนี้อยู่แล้ว', l2: 'ไม่ต้องอัดเพิ่มเยอะ' },
  { t0: 24.0, t1: 28.0, l1: '3 ท่า × 3 เซต × 10–15 ครั้ง', l2: 'สัปดาห์ละ 2 วัน เพิ่มน้ำหนักทีละนิด' },
  { t0: 28.0, t1: 31.5, l1: 'ครบ 3 มัด = ไหล่กลม ทรงสวย', l2: 'เซฟไว้ แล้วไปลองที่ยิม!' },
];

// Labels pinned to 3D anchors. off = label offset from the anchor in HUD pixels (540x960).
export const LABELS = [
  { t0: 5.3, t1: 6.9, text: 'มัดหน้า', anchor: 'front', color: HEADS[0].color, off: [-105, -85] },
  { t0: 6.5, t1: 9.0, text: 'มัดกลาง', anchor: 'mid', color: HEADS[1].color, off: [95, -100] },
  { t0: 7.7, t1: 9.0, text: 'มัดหลัง', anchor: 'rear', color: HEADS[2].color, off: [-105, -70] },
  { t0: 10.3, t1: 13.7, text: 'ศอกงอเล็กน้อย', anchor: 'elbow', color: '#e8e8ff', off: [20, 100] },
  { t0: 11.7, t1: 13.2, text: 'หยุดที่ระดับไหล่', anchor: 'wrist', color: '#e8e8ff', off: [70, -120] },
  { t0: 15.6, t1: 18.7, text: 'หลังตรง ไม่แกว่งตัว', anchor: 'back', color: '#e8e8ff', off: [30, 150] },
  { t0: 17.0, t1: 18.4, text: 'บีบมัดหลัง', anchor: 'rear', color: HEADS[2].color, off: [-95, -90] },
  { t0: 20.6, t1: 23.7, text: 'เกร็งหน้าท้อง', anchor: 'belly', color: '#e8e8ff', off: [135, -35] },
  { t0: 21.8, t1: 23.2, text: 'ดันขึ้นตรง ๆ', anchor: 'wrist', color: '#e8e8ff', off: [-150, 40] },
];

// Big one-word cues at the top of each rep (like a comic "BANG!").
export const CALLOUTS = [
  { t0: 12.0, t1: 12.8, text: 'ค้าง!', anchor: 'mid', off: [-70, -66] },
  { t0: 17.3, t1: 18.1, text: 'บีบ!', anchor: 'rear', off: [70, -70] },
  { t0: 22.2, t1: 22.8, text: 'ดัน!', anchor: 'belly', off: [-135, -50] },
];

// Numbered chapter chip, bottom-left.
export const CHAPTERS = [
  { t0: 4.6, n: 1, text: 'รู้จัก 3 มัด' },
  { t0: 9.0, n: 2, text: 'มัดกลาง' },
  { t0: 14.0, n: 3, text: 'มัดหลัง' },
  { t0: 19.0, n: 4, text: 'มัดหน้า' },
  { t0: 24.0, n: 5, text: 'สูตรฝึก' },
];

export const STATUS = [
  { t0: 0, t1: 3, play: true, text: 'ความเร็วจริง' },
  { t0: 3, t1: 4, play: false, text: 'กำลังสโลว์…' },
  { t0: 4, t1: 24, play: false, text: 'สโลว์โมชัน 1/3' },
  { t0: 24, t1: 25, play: false, text: 'กำลังเร่ง…', x: '×3' },
  { t0: 25, t1: 32, play: true, text: 'ความเร็วจริง' },
];

// Bottom panel: live activation bars -> programme summary -> call to action
export const SECTIONS = [
  { t0: 4.6, t1: 9.0, title: 'เดลทอยด์ 3 มัด' },
  { t0: 9.0, t1: 14.0, title: 'LATERAL RAISE' },
  { t0: 14.0, t1: 19.0, title: 'REVERSE FLY' },
  { t0: 19.0, t1: 24.0, title: 'OVERHEAD PRESS' },
];
export const PANELS = { bars: [4.6, 24.0], summary: [24.0, 28.0], cta: [28.0, 31.75] };

// Cover image (thumbnail): one still that says what the clip will tell you.
// Rendered by "npm run cover" to out/cover.png.
export const COVER = {
  t: 11.3, // pose taken from this moment of the clip
  split: true, // outside on one half of the figure, inside on the other
  xray: 0.5,
  act: [0.9, 0.9, 0.9], // light up all three heads
  cam: { az: 0, el: 22, d: 4.8, tx: 0.0, ty: 1.5, tz: 0.0 }, // az must stay 0 with split, so the cut is seen edge-on
  kicker: 'สายเวทต้องรู้',
  title: 'ไหล่กลม',
  sub: ['ต้องฝึกให้ครบ ', '3 มัด', '!'], // the middle part is highlighted
  tags: [
    { n: 1, text: 'มัดหน้า', sub: 'OVERHEAD PRESS' },
    { n: 2, text: 'มัดกลาง', sub: 'LATERAL RAISE' },
    { n: 3, text: 'มัดหลัง', sub: 'REVERSE FLY' },
  ],
  footer: '3 ท่า · ดูจบใน 30 วิ',
};

// Moments the soundtrack reacts to.
export const EVENTS = {
  captions: CAPTIONS.map((c) => c.t0),
  labels: LABELS.map((l) => l.t0),
  callouts: CALLOUTS.map((c) => c.t0),
  chapters: CHAPTERS.map((c) => c.t0),
  slowDown: 3.0,
  speedUp: 24.0,
  panelIn: 4.6,
  summaryRows: [24.0, 24.5, 25.0],
  cta: 28.0,
};
