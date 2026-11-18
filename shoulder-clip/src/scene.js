// Anatomy figure rendered at low resolution with cel shading and ink outlines.
//
// Three passes per frame:
//   1. colour  - toon-shaded scene
//   2. aux     - every mesh drawn in a flat id colour (+ depth)
//   3. ink     - full-screen pass that draws a 1px outline wherever the id or
//                depth changes, tinted with a muscle's colour while it works
import * as THREE from 'three';
import { pose, activation, cameraAt, chXray, HEADS } from './timeline.js';

const COL = {
  skin: 0xe4a67c,
  hair: 0x2a2350,
  shoe: 0xf0f0fa,
  sole: 0x2c2f6e,
  shorts: 0xd0283f,
  shortsDark: 0xa01b33,
  bone: 0xf0e0b4,
  cartilage: 0xcfc39a,
  socket: 0x1a1740,
  metal: 0x7a7da8,
  plate: 0xd0243c,
  floor: 0x121440,
  podium: 0x232a72,
  grid: 0x1e2260,
  muscle: 0x8587bd,
  muscleDeep: 0x6567a0,
  ink: 0x15133a,
};

function loft(sections, n = 14) {
  const pos = [];
  const idx = [];
  sections.forEach(([y, rx, rz, cz = 0]) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
    }
  });
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const a = s * n + i;
      const b = s * n + ((i + 1) % n);
      const c = a + n;
      const d = b + n;
      idx.push(a, c, b, b, c, d);
    }
  }
  const base = pos.length / 3;
  const first = sections[0];
  const last = sections[sections.length - 1];
  pos.push(0, first[0], first[3] || 0, 0, last[0], last[3] || 0);
  const top = (sections.length - 1) * n;
  for (let i = 0; i < n; i++) {
    idx.push(base, i, (i + 1) % n);
    idx.push(base + 1, top + ((i + 1) % n), top + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
function between(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
  mesh.scale.set(1, len, 1);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// One rib: an ellipse from the spine round to the front, sloping downwards.
class RibCurve extends THREE.Curve {
  constructor(s, a, b, y0, zc, drop, end) {
    super();
    Object.assign(this, { s, a, b, y0, zc, drop, end });
  }
  getPoint(t, target = new THREE.Vector3()) {
    const ph = 0.06 * Math.PI + t * (this.end - 0.06 * Math.PI);
    return target.set(
      this.s * this.a * Math.sin(ph),
      this.y0 - this.drop * Math.sin(ph / 2) ** 2,
      this.zc - this.b * Math.cos(ph)
    );
  }
}

// Small deterministic RNG so every render is identical.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUX_VERT = `
#include <common>
#include <clipping_planes_pars_vertex>
attribute vec4 aAux;
uniform vec4 uAux;
uniform float uUseAttr;
varying vec4 vAux;
void main() {
  vAux = mix(uAux, aAux, uUseAttr);
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
}`;
const AUX_FRAG = `
#include <clipping_planes_pars_fragment>
varying vec4 vAux;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vAux;
}`;

const INK_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tAux;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform vec3 uHi[3];
uniform float uHiAmt[3];
varying vec2 vUv;
float lin(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// which deltoid head (0..2) an aux sample belongs to, or -1
float headOf(vec4 a) {
  float g = floor(a.a * 255.0 + 0.5);
  return (g >= 1.0 && g <= 6.0) ? mod(g - 1.0, 3.0) : -1.0;
}
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, -uTexel.y);
  vec4 a0 = texture2D(tAux, vUv);
  vec4 a1 = texture2D(tAux, vUv + dx);
  vec4 a2 = texture2D(tAux, vUv + dy);
  float d0 = lin(texture2D(tDepth, vUv).r);
  float d1 = lin(texture2D(tDepth, vUv + dx).r);
  float d2 = lin(texture2D(tDepth, vUv + dy).r);

  float e1 = step(0.003, distance(a0.rgb, a1.rgb) + abs(a0.a - a1.a));
  float e2 = step(0.003, distance(a0.rgb, a2.rgb) + abs(a0.a - a2.a));
  // same muscle, different fibre strip -> thin fibre line instead of an outline
  float f1 = e1 * step(abs(a0.a - a1.a), 0.001) * step(0.001, a0.a);
  float f2 = e2 * step(abs(a0.a - a2.a), 0.001) * step(0.001, a0.a);
  float fibre = max(f1, f2);
  float outer = max(e1 - f1, e2 - f2);
  outer = max(outer, step(0.07, max(abs(d0 - d1), abs(d0 - d2))));

  vec3 line = uInk;
  float h = max(headOf(a0), max(headOf(a1), headOf(a2)));
  if (h >= 0.0) {
    int k = int(h + 0.5);
    line = mix(uInk, uHi[k], uHiAmt[k]);
  }
  col = mix(col, col * 0.62, fibre * (1.0 - outer));
  col = mix(col, line, outer);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createScene(W, H, bgCanvas) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.localClippingEnabled = true;

  const colorRT = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const auxRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  auxRT.depthTexture = new THREE.DepthTexture(W, H);

  const scene = new THREE.Scene();
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.magFilter = THREE.NearestFilter;
  bgTex.minFilter = THREE.NearestFilter;
  scene.background = bgTex;

  const camera = new THREE.PerspectiveCamera(20, W / H, 0.5, 40);
  scene.add(camera);
  camera.add(new THREE.AmbientLight(0xa0a4e8, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 2.75);
  key.position.set(-2.5, 4, 3);
  camera.add(key, key.target);
  key.target.position.set(0, 0, -5);

  // ------------------------------------------------ materials
  // X-ray reveal = a horizontal scan plane: skin exists below it, anatomy above it.
  const skinPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  const innerPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 10);
  const grad = new THREE.DataTexture(
    // stepped light ramp: shadow -> half tone -> light (texel n covers n.l from -1 to 1)
    new Uint8Array([105, 105, 120, 142, 178, 218, 255, 255].flatMap((v) => [v, v, v, 255])),
    8, 1, THREE.RGBAFormat
  );
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const skinMats = [];
  const innerMats = [];
  function toon(color, kind = 'solid', opts = {}) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts });
    if (kind === 'skin') {
      m.clippingPlanes = [skinPlane];
      skinMats.push(m);
    } else if (kind === 'inner') {
      m.clippingPlanes = [innerPlane];
      innerMats.push(m);
    }
    return m;
  }
  const skinMat = toon(COL.skin, 'skin');
  const capMat = toon(COL.skin, 'skin');
  capMat.emissive = new THREE.Color(HEADS[1].color);
  capMat.emissiveIntensity = 0;
  const shortsMat = toon(COL.shorts, 'skin');
  const bandMat = toon(COL.shortsDark, 'skin');
  const hairMat = toon(COL.hair, 'skin');
  const shoeMat = toon(COL.shoe, 'skin');
  const soleMat = toon(COL.sole, 'skin');
  const boneMat = toon(COL.bone, 'inner');
  const boneFlat = toon(COL.bone, 'inner', { side: THREE.DoubleSide });
  const cartMat = toon(COL.cartilage, 'inner');
  const socketMat = toon(COL.socket, 'inner');
  const teethMat = toon(0xffffff, 'inner');
  const muscleMat = toon(COL.muscle, 'inner');
  const deepMat = toon(COL.muscleDeep, 'inner');
  const metalMat = toon(COL.metal);
  const plateMat = toon(COL.plate);

  const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
  const cyl = (r0, r1, mat, seg = 8) => mesh(new THREE.CylinderGeometry(r1, r0, 1, seg), mat);
  const ball = (r, mat, detail = 1) => mesh(new THREE.IcosahedronGeometry(r, detail), mat);
  // Skin parts that share a tag merge into one shape; parts with different tags
  // are separated by a soft definition line rather than a full ink outline.
  const sk = (m, tag = 'body') => {
    m.userData.aux = tag;
    return m;
  };
  const blob = (sx, sy, sz, x, y, z, tag = 'body', mat = skinMat) => {
    const b = ball(1, mat, 2);
    b.scale.set(sx, sy, sz);
    b.position.set(x, y, z);
    return sk(b, tag);
  };

  // ------------------------------------------------ stage
  const FLOOR_Y = -0.05;
  const floor = mesh(new THREE.CircleGeometry(1.7, 40), new THREE.MeshBasicMaterial({ color: COL.floor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);
  {
    const pts = [];
    const R = 1.7;
    for (let k = -8; k <= 8; k++) {
      const x = k * 0.2;
      const c = Math.sqrt(Math.max(0, R * R - x * x));
      pts.push(x, FLOOR_Y + 0.002, -c, x, FLOOR_Y + 0.002, c, -c, FLOOR_Y + 0.002, x, c, FLOOR_Y + 0.002, x);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COL.grid })));
    const podium = mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.05, 20), toon(COL.podium));
    podium.position.y = FLOOR_Y + 0.025;
    scene.add(podium);
  }

  const root = new THREE.Group();
  scene.add(root);
  const HIP_Y = 0.95;
  const torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);
  root.add(torso);

  // ------------------------------------------------ lower body (static)
  root.add(mesh(loft([[0.7, 0.172, 0.12, -0.006], [0.8, 0.18, 0.128, -0.008], [0.9, 0.168, 0.122, -0.006], [0.985, 0.14, 0.1, 0]], 20), shortsMat));
  root.add(mesh(loft([[0.972, 0.146, 0.104, 0], [1.006, 0.139, 0.099, 0]], 20), bandMat));
  for (const s of [1, -1]) {
    const hipJ = V(s * 0.085, 0.925, 0);
    const troch = V(s * 0.132, 0.9, -0.005);
    const knee = V(s * 0.098, 0.5, 0.012);
    const ankle = V(s * 0.098, 0.075, 0);
    // athletic leg: quad sweep, teardrop above the knee, hamstring, diamond calf
    const tag = 'leg' + s;
    const thigh = sk(cyl(0.05, 0.08, skinMat, 12), tag);
    between(thigh, knee, V(s * 0.092, 0.8, 0));
    const shin = sk(cyl(0.034, 0.05, skinMat, 12), tag);
    between(shin, V(ankle.x, 0.1, 0), knee);
    root.add(
      thigh,
      shin,
      blob(0.06, 0.17, 0.064, s * 0.106, 0.67, 0.024, tag),
      blob(0.036, 0.07, 0.04, s * 0.078, 0.565, 0.032, tag),
      blob(0.05, 0.15, 0.052, s * 0.094, 0.68, -0.034, tag),
      blob(0.05, 0.05, 0.05, knee.x, knee.y, knee.z, tag),
      blob(0.047, 0.115, 0.054, s * 0.101, 0.36, -0.026, tag)
    );
    // trainers
    const sock = cyl(0.04, 0.042, shoeMat, 10);
    between(sock, V(ankle.x, 0.07, 0), V(ankle.x, 0.135, 0));
    const upper = mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), shoeMat);
    upper.position.set(ankle.x, 0.052, 0.03);
    const toe = ball(1, shoeMat, 2);
    toe.scale.set(0.05, 0.036, 0.075);
    toe.position.set(ankle.x, 0.046, 0.13);
    for (const m of [sock, upper, toe]) sk(m, 'shoe' + s);
    const sole = mesh(new THREE.BoxGeometry(0.106, 0.022, 0.29), soleMat);
    sole.position.set(ankle.x, 0.011, 0.055);
    const sleeve = cyl(0.088, 0.096, shortsMat, 12);
    between(sleeve, V(s * 0.097, 0.61, 0.004), V(s * 0.092, 0.79, 0));
    root.add(sock, upper, toe, sole, sleeve);
    // bones
    const fHead = ball(0.025, boneMat);
    fHead.position.copy(hipJ);
    const neck = cyl(0.014, 0.014, boneMat, 6);
    between(neck, hipJ, troch);
    const femur = cyl(0.021, 0.017, boneMat);
    between(femur, knee, troch);
    const cond = ball(0.033, boneMat);
    cond.scale.set(1.15, 0.8, 0.95);
    cond.position.copy(knee);
    const patella = ball(0.017, boneMat);
    patella.position.set(knee.x, knee.y + 0.005, knee.z + 0.034);
    const tibia = cyl(0.014, 0.022, boneMat);
    between(tibia, ankle, V(knee.x, knee.y - 0.02, knee.z));
    const fibula = cyl(0.007, 0.008, boneMat, 5);
    between(fibula, V(ankle.x + s * 0.022, ankle.y, ankle.z - 0.005), V(knee.x + s * 0.03, knee.y - 0.04, knee.z - 0.012));
    const heel = mesh(new THREE.BoxGeometry(0.045, 0.04, 0.07), boneMat);
    heel.position.set(ankle.x, 0.03, -0.01);
    const toes = mesh(new THREE.BoxGeometry(0.06, 0.022, 0.12), boneMat);
    toes.position.set(ankle.x, 0.02, 0.085);
    // leg muscles
    const quad = ball(1, muscleMat, 2);
    quad.scale.set(0.07, 0.19, 0.075);
    quad.position.set(s * 0.1, 0.7, 0.018);
    const ham = ball(1, deepMat, 2);
    ham.scale.set(0.062, 0.17, 0.06);
    ham.position.set(s * 0.095, 0.7, -0.035);
    const calf = ball(1, muscleMat, 2);
    calf.scale.set(0.046, 0.13, 0.05);
    calf.position.set(knee.x, 0.34, -0.022);
    root.add(fHead, neck, femur, cond, patella, tibia, fibula, heel, toes, quad, ham, calf);
  }

  // ------------------------------------------------ torso skin
  // Athletic build: wide shoulder girdle tapering to a narrow waist.
  torso.add(sk(mesh(loft([
    [-0.05, 0.15, 0.106, -0.004],
    [0.02, 0.145, 0.1, 0],
    [0.1, 0.127, 0.088, 0.002],
    [0.17, 0.119, 0.083, 0.004],
    [0.25, 0.134, 0.094, 0.008],
    [0.33, 0.156, 0.108, 0.012],
    [0.41, 0.174, 0.116, 0.014],
    [0.48, 0.178, 0.108, 0.008],
    [0.525, 0.15, 0.088, 0],
    [0.555, 0.088, 0.066, -0.008],
    [0.585, 0.058, 0.057, -0.008],
    [0.66, 0.052, 0.055, 0],
  ], 20), skinMat)));
  // muscle masses layered on the trunk so the cel shading picks them out
  for (const s of [1, -1]) {
    const pec = blob(0.102, 0.058, 0.044, s * 0.084, 0.426, 0.088, 'pec' + s);
    pec.rotation.z = s * 0.12;
    const lat = blob(0.046, 0.13, 0.086, s * 0.16, 0.33, -0.024);
    lat.rotation.z = -s * 0.24;
    const trap = blob(0.088, 0.04, 0.056, s * 0.086, 0.55, -0.024);
    trap.rotation.z = -s * 0.42;
    torso.add(
      pec,
      lat,
      trap,
      blob(0.03, 0.075, 0.06, s * 0.116, 0.12, 0.012),
      blob(0.072, 0.095, 0.036, s * 0.096, 0.44, -0.09),
      blob(0.03, 0.17, 0.03, s * 0.036, 0.2, -0.076)
    );
    // collarbone ridge
    const clavS = blob(0.075, 0.008, 0.011, s * 0.095, 0.522, 0.062, 'clav' + s);
    clavS.rotation.z = s * 0.16;
    clavS.rotation.y = -s * 0.22;
    torso.add(clavS);
    // six-pack: each cell is outlined with a soft line
    [[0.302, 0.112], [0.246, 0.1], [0.19, 0.09]].forEach(([y, z], r) => {
      const ab = sk(mesh(new THREE.BoxGeometry(0.054, 0.044, 0.024), skinMat), `ab${r}${s}`);
      ab.position.set(s * 0.031, y, z - 0.002);
      torso.add(ab);
    });
    torso.add(
      blob(0.015, 0.027, 0.018, s * 0.088, 0.742, -0.004),
      mesh(new THREE.BoxGeometry(0.022, 0.009, 0.008), hairMat).translateX(s * 0.033).translateY(0.75).translateZ(0.089),
      mesh(new THREE.BoxGeometry(0.03, 0.007, 0.008), hairMat).translateX(s * 0.033).translateY(0.772).translateZ(0.09)
    );
  }
  // head: skull-shaped with a tapered jaw, short hair
  {
    const jaw = sk(mesh(new THREE.CylinderGeometry(0.07, 0.044, 0.105, 14), skinMat));
    jaw.scale.set(1, 1, 0.96);
    jaw.position.set(0, 0.696, 0.02);
    const hair = mesh(new THREE.SphereGeometry(0.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
    hair.scale.set(0.95, 1.1, 1.06);
    hair.position.set(0, 0.765, -0.012);
    hair.rotation.x = -0.46;
    torso.add(blob(0.089, 0.104, 0.098, 0, 0.756, 0.0), jaw, blob(0.012, 0.022, 0.014, 0, 0.724, 0.096), hair);
  }

  // ------------------------------------------------ spine
  const spinePts = [
    [-0.03, -0.062], [0.05, -0.04], [0.14, -0.034], [0.24, -0.05], [0.34, -0.072],
    [0.45, -0.078], [0.535, -0.06], [0.6, -0.034], [0.655, -0.018],
  ];
  const spine = new THREE.CatmullRomCurve3(spinePts.map(([y, z]) => V(0, y, z)));
  const spineZ = (y) => {
    for (let i = 0; i < spinePts.length - 1; i++) {
      const [y0, z0] = spinePts[i];
      const [y1, z1] = spinePts[i + 1];
      if (y <= y1) return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
    }
    return spinePts[spinePts.length - 1][1];
  };
  const NV = 24;
  for (let i = 0; i < NV; i++) {
    const u = (i + 0.5) / NV;
    const p = spine.getPointAt(u);
    const r = i < 5 ? 0.027 : i < 17 ? 0.021 : 0.016;
    const v = mesh(new THREE.CylinderGeometry(r, r, 0.021, 8), boneMat);
    v.position.copy(p);
    v.quaternion.setFromUnitVectors(UP, spine.getTangentAt(u));
    torso.add(v);
    if (i < 18) {
      const proc = mesh(new THREE.BoxGeometry(0.012, 0.016, 0.034), boneMat);
      proc.position.set(p.x, p.y - 0.006, p.z - r - 0.012);
      torso.add(proc);
    }
  }

  // ------------------------------------------------ rib cage
  const RA = [0.062, 0.088, 0.108, 0.122, 0.133, 0.141, 0.146, 0.148, 0.145, 0.138, 0.122, 0.104];
  const ribEnd = [];
  for (let i = 0; i < 12; i++) {
    const a = RA[i];
    const b = 0.015 + 0.55 * a;
    const y0 = 0.53 - 0.028 * i;
    const zc = spineZ(y0) + b * 0.982;
    const drop = 0.028 + 0.004 * i;
    const end = (i < 7 ? 0.93 : i < 10 ? 0.8 : 0.52) * Math.PI;
    for (const s of [1, -1]) {
      const curve = new RibCurve(s, a, b, y0, zc, drop, end);
      torso.add(mesh(new THREE.TubeGeometry(curve, 18, i < 10 ? 0.0085 : 0.007, 5), boneMat));
      if (s === 1) ribEnd[i] = curve.getPoint(1);
    }
  }
  {
    const top = V(0, ribEnd[0].y + 0.012, ribEnd[0].z - 0.004);
    const bot = V(0, ribEnd[6].y + 0.012, ribEnd[6].z);
    const body = mesh(new THREE.BoxGeometry(0.036, 1, 0.012), boneMat);
    between(body, bot, top);
    const manu = mesh(new THREE.BoxGeometry(0.056, 0.045, 0.014), boneMat);
    manu.position.copy(top).add(V(0, -0.012, 0.004));
    manu.quaternion.copy(body.quaternion);
    const xiph = mesh(new THREE.BoxGeometry(0.016, 0.03, 0.008), cartMat);
    xiph.position.copy(bot).add(V(0, -0.016, 0.002));
    torso.add(body, manu, xiph);
    for (const s of [1, -1]) {
      const pts = [V(s * 0.016, bot.y + 0.005, bot.z), ...[7, 8, 9].map((i) => V(s * ribEnd[i].x, ribEnd[i].y, ribEnd[i].z))];
      torso.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008, 5), cartMat));
    }
  }

  // ------------------------------------------------ skull
  {
    const cranium = mesh(new THREE.SphereGeometry(0.088, 18, 14), boneMat);
    cranium.scale.set(0.86, 0.96, 1.08);
    cranium.position.set(0, 0.765, -0.004);
    const face = mesh(new THREE.CylinderGeometry(0.056, 0.042, 0.075, 10), boneMat);
    face.scale.set(1, 1, 0.82);
    face.position.set(0, 0.7, 0.038);
    const jaw = mesh(new THREE.CylinderGeometry(0.046, 0.034, 0.036, 8), boneMat);
    jaw.position.set(0, 0.652, 0.032);
    const teeth = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), teethMat);
    teeth.position.set(0, 0.672, 0.076);
    const nose = mesh(new THREE.ConeGeometry(0.011, 0.024, 4), socketMat);
    nose.position.set(0, 0.712, 0.082);
    torso.add(cranium, face, jaw, teeth, nose);
    for (const s of [1, -1]) {
      const eye = mesh(new THREE.SphereGeometry(0.019, 8, 6), socketMat);
      eye.scale.set(1.15, 1, 0.6);
      eye.position.set(s * 0.031, 0.748, 0.078);
      const cheek = mesh(new THREE.BoxGeometry(0.018, 0.012, 0.04), boneMat);
      cheek.position.set(s * 0.05, 0.722, 0.04);
      torso.add(eye, cheek);
    }
  }

  // ------------------------------------------------ pelvis (moves with the torso in a hip hinge)
  {
    for (const s of [1, -1]) {
      const wing = mesh(
        new THREE.SphereGeometry(0.115, 12, 6, 0.6 * Math.PI, 0.85 * Math.PI, 0.18 * Math.PI, 0.4 * Math.PI),
        boneFlat
      );
      wing.scale.set(s, 0.85, 0.78);
      wing.position.set(s * 0.032, -0.04, -0.018);
      const isch = cyl(0.012, 0.016, boneMat, 6);
      between(isch, V(s * 0.06, -0.13, -0.01), V(s * 0.095, -0.04, -0.01));
      const pubR = cyl(0.011, 0.011, boneMat, 6);
      between(pubR, V(s * 0.008, -0.105, 0.05), V(s * 0.085, -0.045, 0.02));
      const glute = ball(1, muscleMat, 2);
      glute.scale.set(0.085, 0.085, 0.068);
      glute.position.set(s * 0.075, -0.09, -0.06);
      torso.add(wing, isch, pubR, glute);
    }
    const sacrum = mesh(new THREE.CylinderGeometry(0.052, 0.018, 0.1, 6), boneMat);
    sacrum.scale.set(1, 1, 0.45);
    sacrum.position.set(0, -0.045, -0.072);
    sacrum.rotation.x = 0.25;
    torso.add(sacrum);
  }

  // ------------------------------------------------ abdomen + neck muscles
  torso.add(mesh(
    loft([[-0.04, 0.138, 0.096, 0], [0.06, 0.13, 0.09, 0], [0.17, 0.118, 0.084, 0], [0.25, 0.128, 0.09, 0.004]]),
    deepMat
  ));
  for (let r = 0; r < 4; r++) {
    for (const s of [1, -1]) {
      const ab = mesh(new THREE.BoxGeometry(0.046, 0.046, 0.02), muscleMat);
      ab.position.set(s * 0.027, 0.045 + r * 0.056, 0.088 + (r === 3 ? 0.008 : 0));
      torso.add(ab);
    }
  }
  {
    const neckM = cyl(0.05, 0.04, deepMat, 10);
    between(neckM, V(0, 0.545, -0.03), V(0, 0.66, -0.016));
    torso.add(neckM);
  }

  // ------------------------------------------------ fan / sheet muscles
  // A sheet is a grid of fibres (u across, t along) rebuilt every frame.
  // Each fibre strip gets its own aux id so the ink pass draws fibre lines.
  let sheetCount = 10;
  const sheetRand = rng(99);
  function makeSheet(nU, nT, color, { stripe = 0.86, tendonFrom = 0.8, tendon = 0.75, emissive = false, group = 0 } = {}) {
    const g = new THREE.BufferGeometry();
    const n = nU * nT * 6;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3);
    const aux = new Float32Array(n * 4);
    const base = new THREE.Color(color);
    const tend = new THREE.Color(0xfff4d8);
    const c = new THREE.Color();
    const alpha = (group || ++sheetCount) / 255;
    let k = 0;
    let q4 = 0;
    for (let i = 0; i < nU; i++) {
      const id = [0.15 + sheetRand() * 0.8, 0.15 + sheetRand() * 0.8, 0.15 + sheetRand() * 0.8];
      for (let j = 0; j < nT; j++) {
        const tt = (j + 0.5) / nT;
        c.copy(base).multiplyScalar(i % 2 ? stripe : 1.0);
        c.lerp(tend, Math.max(0, (tt - tendonFrom) / (1 - tendonFrom)) * tendon);
        for (let v = 0; v < 6; v++) {
          col[k++] = c.r; col[k++] = c.g; col[k++] = c.b;
          aux[q4++] = id[0]; aux[q4++] = id[1]; aux[q4++] = id[2]; aux[q4++] = alpha;
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aAux', new THREE.BufferAttribute(aux, 4));
    const mat = toon(0xffffff, 'inner', { vertexColors: true, side: THREE.DoubleSide });
    if (emissive) {
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 0;
    }
    const m = mesh(g, mat);
    m.frustumCulled = false;
    torso.add(m);
    const grid = [];
    for (let i = 0; i <= nU; i++) {
      grid.push([]);
      for (let j = 0; j <= nT; j++) grid[i].push(new THREE.Vector3());
    }
    return { nU, nT, mesh: m, mat, grid, base };
  }
  function fibre(sh, i, O, C, I) {
    for (let j = 0; j <= sh.nT; j++) {
      const t = j / sh.nT;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * t * (1 - t);
      const w2 = t * t;
      sh.grid[i][j].set(O.x * w0 + C.x * w1 + I.x * w2, O.y * w0 + C.y * w1 + I.y * w2, O.z * w0 + C.z * w1 + I.z * w2);
    }
  }
  function commit(sh) {
    const pos = sh.mesh.geometry.attributes.position;
    const arr = pos.array;
    let k = 0;
    const put = (v) => {
      arr[k++] = v.x; arr[k++] = v.y; arr[k++] = v.z;
    };
    for (let i = 0; i < sh.nU; i++) {
      for (let j = 0; j < sh.nT; j++) {
        const g00 = sh.grid[i][j];
        const g10 = sh.grid[i + 1][j];
        const g01 = sh.grid[i][j + 1];
        const g11 = sh.grid[i + 1][j + 1];
        put(g00); put(g01); put(g10);
        put(g10); put(g01); put(g11);
      }
    }
    pos.needsUpdate = true;
    sh.mesh.geometry.computeVertexNormals();
  }

  // ------------------------------------------------ arms + deltoids
  const J0 = V(0.19, 0.5, 0);
  const L1 = 0.3;
  const L2 = 0.27;
  // deltoid origin "horseshoe" relative to the joint (clavicle -> acromion -> scapular spine)
  const originRel = [
    [-0.075, 0.038, 0.05],
    [0.0, 0.05, 0.05],
    [0.05, 0.052, 0.0],
    [0.005, 0.048, -0.056],
    [-0.085, 0.032, -0.074],
  ];
  const U_RANGE = [[0.0, 0.345], [0.375, 0.625], [0.655, 1.0]];
  const NU = [8, 6, 8];
  const NT = 9;

  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  function makeArm(s, ai) {
    const arm = { s };
    const mir = (p) => V(p[0] * s, p[1], p[2]);
    arm.J = V(J0.x * s, J0.y, J0.z);
    arm.curve = new THREE.CatmullRomCurve3(originRel.map((p) => mir(p).add(arm.J)));

    // clavicle (S-curve) and scapula, fixed to the rib cage
    const clav = new THREE.CatmullRomCurve3([
      V(s * 0.024, 0.512, 0.03), V(s * 0.08, 0.526, 0.056), V(s * 0.14, 0.54, 0.04), V(s * 0.19, 0.55, 0.03),
    ]);
    torso.add(mesh(new THREE.TubeGeometry(clav, 14, 0.0095, 6), boneMat));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([
      s * 0.082, 0.535, -0.092, s * 0.17, 0.505, -0.05, s * 0.1, 0.33, -0.108,
      s * 0.082, 0.535, -0.092, s * 0.1, 0.33, -0.108, s * 0.075, 0.45, -0.108,
    ], 3));
    sg.computeVertexNormals();
    torso.add(mesh(sg, boneFlat));
    const sSpine = cyl(0.009, 0.011, boneMat, 6);
    between(sSpine, V(s * 0.08, 0.5, -0.1), V(s * 0.2, 0.55, -0.03));
    const acro = mesh(new THREE.BoxGeometry(0.045, 0.012, 0.05), boneMat);
    acro.position.set(s * 0.205, 0.553, -0.004);
    torso.add(sSpine, acro);

    // moving bones
    arm.humerus = cyl(0.016, 0.018, boneMat);
    arm.humHead = ball(0.04, boneMat, 2);
    arm.cond = ball(0.026, boneMat);
    arm.radius = cyl(0.009, 0.011, boneMat, 6);
    arm.ulna = cyl(0.008, 0.012, boneMat, 6);
    arm.palm = mesh(new THREE.BoxGeometry(0.04, 0.075, 0.04), boneMat);
    // skin
    const tU = 'armU' + s;
    const tF = 'armF' + s;
    arm.upperS = sk(cyl(0.04, 0.046, skinMat, 12), tU);
    arm.bicS = sk(ball(1, skinMat, 2), tU);
    arm.triS = sk(ball(1, skinMat, 2), tU);
    arm.elbowS = sk(ball(0.04, skinMat, 2), tU);
    arm.foreS = sk(cyl(0.028, 0.04, skinMat, 12), tF);
    arm.foreB = sk(ball(1, skinMat, 2), tF);
    arm.hand = sk(mesh(new THREE.BoxGeometry(0.056, 0.075, 0.06), skinMat), tF);
    arm.cap = sk(ball(1, capMat, 2), 'delt' + s);
    // dumbbell
    arm.bell = new THREE.Group();
    arm.bell.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 6), metalMat));
    for (const k of [1, -1]) {
      const pl = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 6), plateMat);
      pl.position.y = k * 0.075;
      arm.bell.add(pl);
    }
    torso.add(arm.humerus, arm.humHead, arm.cond, arm.radius, arm.ulna, arm.palm, arm.upperS, arm.bicS, arm.triS, arm.elbowS, arm.foreS, arm.foreB, arm.hand, arm.cap, arm.bell);

    arm.heads = HEADS.map((hd, hi) => {
      const sh = makeSheet(NU[hi], NT, hd.color, { stripe: 0.8, emissive: true, group: 1 + ai * 3 + hi });
      // the deltoid lies on top of its neighbours
      sh.mat.polygonOffset = true;
      sh.mat.polygonOffsetFactor = -3;
      sh.mat.polygonOffsetUnits = -3;
      sh.hi = hi;
      sh.centroid = new THREE.Vector3();
      sh.glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: hd.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
      );
      torso.add(sh.glow);
      return sh;
    });

    const o = { tendonFrom: 0.86, tendon: 0.6 };
    arm.pec = makeSheet(7, 7, COL.muscle, o);
    arm.pecCurve = new THREE.CatmullRomCurve3([
      V(s * 0.12, 0.538, 0.05), V(s * 0.034, 0.5, 0.04), V(s * 0.022, 0.42, 0.078), V(s * 0.032, 0.335, 0.11),
    ]);
    arm.lat = makeSheet(7, 7, COL.muscle, o);
    arm.latCurve = new THREE.CatmullRomCurve3([
      V(s * 0.012, 0.31, -0.092), V(s * 0.016, 0.16, -0.062), V(s * 0.03, 0.03, -0.085), V(s * 0.11, 0.005, -0.07),
    ]);
    // trapezius: fixed, from the spine out to the shoulder girdle
    const trap = makeSheet(8, 5, COL.muscle, { tendonFrom: 1, tendon: 0 });
    const tO = new THREE.CatmullRomCurve3([V(s * 0.012, 0.655, -0.03), V(s * 0.006, 0.55, -0.088), V(s * 0.006, 0.42, -0.1), V(s * 0.006, 0.25, -0.078)]);
    const tI = new THREE.CatmullRomCurve3([V(s * 0.15, 0.558, 0.02), V(s * 0.215, 0.56, -0.02), V(s * 0.15, 0.53, -0.085), V(s * 0.09, 0.5, -0.108)]);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i <= trap.nU; i++) {
      const v = i / trap.nU;
      tO.getPoint(v, a);
      tI.getPoint(Math.pow(v, 0.8), b);
      c.copy(a).lerp(b, 0.5).add(V(0, v < 0.35 ? 0.012 : 0, -0.012));
      fibre(trap, i, a, c, b);
    }
    commit(trap);
    arm.biceps = ball(1, muscleMat, 2);
    arm.triceps = ball(1, deepMat, 2);
    arm.foreM = cyl(0.024, 0.04, muscleMat, 10);
    const scm = cyl(0.011, 0.013, muscleMat, 6);
    between(scm, V(s * 0.022, 0.52, 0.03), V(s * 0.058, 0.67, -0.018));
    torso.add(arm.biceps, arm.triceps, arm.foreM, scm);
    return arm;
  }
  const arms = [makeArm(1, 0), makeArm(-1, 1)];
  // fibre lengths with the arm hanging, used to bunch the muscle up as it shortens
  const restLen = U_RANGE.map(([u0, u1], hi) => {
    const out = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= NU[hi]; i++) {
      const u = u0 + ((u1 - u0) * i) / NU[hi];
      arms[0].curve.getPoint(u, p);
      out.push(Math.hypot(J0.x + 0.02 - p.x, J0.y - 0.14 - p.y, (0.5 - u) * 0.034 - p.z));
    }
    return out;
  });

  // scratch vectors
  const vUp = new THREE.Vector3();
  const vFore = new THREE.Vector3();
  const vHandle = new THREE.Vector3();
  const E = new THREE.Vector3();
  const Wp = new THREE.Vector3();
  const Hc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qH = new THREE.Quaternion();
  const qI = new THREE.Quaternion();
  const qS = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const nLat = new THREE.Vector3();
  const fb = new THREE.Vector3();
  const I = new THREE.Vector3();
  const O = new THREE.Vector3();
  const Iu = new THREE.Vector3();
  const Cc = new THREE.Vector3();
  const oh = new THREE.Vector3();
  const od = new THREE.Vector3();
  const ob = new THREE.Vector3();
  const id = new THREE.Vector3();
  const ta = new THREE.Vector3();
  const tb = new THREE.Vector3();
  const white = new THREE.Color(0xffffff);

  function updateArm(arm, p, act, xray) {
    const s = arm.s;
    vUp.set(p.up[0] * s, p.up[1], p.up[2]);
    vFore.set(p.fore[0] * s, p.fore[1], p.fore[2]);
    vHandle.set(p.handle[0] * s, p.handle[1], p.handle[2]).normalize();
    const J = arm.J;
    E.copy(J).addScaledVector(vUp, L1);
    Wp.copy(E).addScaledVector(vFore, L2);
    Hc.copy(Wp).addScaledVector(vFore, 0.045);

    q.setFromUnitVectors(DOWN, vUp);
    qH.copy(qI).slerp(q, 0.5);
    nLat.set(s, 0, 0).applyQuaternion(q);
    fb.set(0, 0, 1).applyQuaternion(q);

    between(arm.humerus, J, E);
    arm.humHead.position.copy(J);
    arm.cond.position.copy(E);
    arm.cond.quaternion.copy(q);
    arm.cond.scale.set(1.25, 0.8, 0.9);
    between(arm.radius, ta.copy(E).addScaledVector(nLat, 0.011), tb.copy(Wp).addScaledVector(nLat, 0.012));
    between(arm.ulna, ta.copy(E).addScaledVector(nLat, -0.011), tb.copy(Wp).addScaledVector(nLat, -0.01));
    arm.palm.position.copy(Hc);
    arm.palm.quaternion.setFromUnitVectors(UP, vFore);
    between(arm.upperS, J, E);
    arm.elbowS.position.copy(E);
    between(arm.foreS, E, Wp);
    arm.hand.position.copy(Hc);
    arm.hand.quaternion.setFromUnitVectors(UP, vFore);
    arm.bicS.position.copy(J).addScaledVector(vUp, 0.17).addScaledVector(fb, 0.022);
    arm.bicS.quaternion.copy(q);
    arm.bicS.scale.set(0.043, 0.1, 0.047);
    arm.triS.position.copy(J).addScaledVector(vUp, 0.15).addScaledVector(fb, -0.024);
    arm.triS.quaternion.copy(q);
    arm.triS.scale.set(0.042, 0.115, 0.045);
    arm.foreB.position.copy(E).addScaledVector(vFore, 0.085);
    arm.foreB.quaternion.setFromUnitVectors(UP, vFore);
    arm.foreB.scale.set(0.045, 0.095, 0.047);
    // rounded, capped deltoid that follows the arm
    arm.cap.position.copy(J).addScaledVector(vUp, 0.034).addScaledVector(nLat, 0.014);
    arm.cap.quaternion.copy(q);
    arm.cap.scale.set(0.088, 0.104, 0.09);
    arm.bell.position.copy(Hc);
    arm.bell.quaternion.setFromUnitVectors(UP, vHandle);

    // the shoulder blade rotates with the arm once it passes ~30 degrees
    const theta = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const over = Math.min(1, Math.max(0, (theta - 1.75) / 0.85)); // 0 below ~100 deg, 1 overhead
    // deltoid: fibres run from the origin horseshoe to the humerus insertion
    I.copy(J).addScaledVector(vUp, 0.14).addScaledVector(nLat, 0.02);
    for (const hd of arm.heads) {
      const [u0, u1] = U_RANGE[hd.hi];
      const a = act[hd.hi];
      for (let i = 0; i <= hd.nU; i++) {
        const v = i / hd.nU;
        const u = u0 + (u1 - u0) * v;
        arm.curve.getPoint(u, O);
        // the collarbone end barely moves; the acromion and scapular spine swing up with the arm
        const fS = 0.12 + 0.3 * Math.min(1, Math.max(0, (u - 0.2) / 0.25));
        qS.copy(qI).slerp(q, theta > 0.5 ? ((theta - 0.5) * fS) / theta : 0);
        O.sub(J).applyQuaternion(qS).add(J);
        Iu.copy(I).addScaledVector(fb, (0.5 - u) * 0.034);
        const th = ((85 - 170 * u) * Math.PI) / 180;
        // bulge direction: outwards from the joint, kept square to the arm so the
        // muscle faces the viewer instead of turning edge-on when the arm is overhead
        ob.set(Math.cos(th) * s, 0, Math.sin(th));
        oh.copy(ob).applyQuaternion(qH);
        oh.addScaledVector(vUp, -0.9 * oh.dot(vUp)).normalize();
        ob.addScaledVector(vUp, -ob.dot(vUp));
        if (ob.lengthSq() > 1e-4) oh.lerp(ob.normalize(), over).normalize();
        od.subVectors(O, J).normalize();
        id.subVectors(Iu, J).normalize();
        const belly = 0.8 + 0.2 * Math.sin(Math.PI * v);
        const rest = restLen[hd.hi][i];
        const boost = Math.min(1.65, Math.max(0.85, Math.sqrt(rest / Iu.distanceTo(O))));
        const rc = 0.142 * belly * (1 + 0.2 * a) * boost;
        Cc.copy(od).multiplyScalar(0.5).addScaledVector(id, 0.5).addScaledVector(oh, 1.2).normalize().multiplyScalar(rc).add(J);
        fibre(hd, i, O, Cc, Iu);
      }
      commit(hd);
      hd.centroid.copy(hd.grid[hd.nU >> 1][4]);
      hd.mat.emissiveIntensity = a * a * 0.4;
      hd.mat.color.copy(white).multiplyScalar(0.8 + 0.2 * a);
      hd.glow.position.copy(hd.centroid).addScaledVector(oh, 0.02);
      const gs = 0.14 + 0.2 * a;
      hd.glow.scale.set(gs, gs, 1);
      hd.glow.material.opacity = xray >= 1 ? Math.max(0, a - 0.3) * 0.16 : 0;
    }

    // pectoralis major: sternum + clavicle -> front of the humerus
    for (let i = 0; i <= arm.pec.nU; i++) {
      const v = i / arm.pec.nU;
      arm.pecCurve.getPoint(v, O);
      Iu.copy(J).addScaledVector(vUp, 0.07 + 0.06 * v).addScaledVector(fb, 0.006);
      Cc.copy(O).lerp(Iu, 0.4);
      Cc.z = Math.max(Cc.z, 0.075) + 0.022 + 0.018 * Math.sin(Math.PI * v);
      fibre(arm.pec, i, O, Cc, Iu);
    }
    commit(arm.pec);
    // latissimus dorsi: lower spine + pelvis -> wraps the ribs -> humerus
    for (let i = 0; i <= arm.lat.nU; i++) {
      const v = i / arm.lat.nU;
      arm.latCurve.getPoint(v, O);
      Iu.copy(J).addScaledVector(vUp, 0.06 + 0.03 * v).addScaledVector(fb, -0.004).addScaledVector(nLat, -0.016);
      Cc.set(s * 0.185, 0.4 - 0.2 * v, -0.075);
      fibre(arm.lat, i, O, Cc, Iu);
    }
    commit(arm.lat);
    arm.biceps.position.copy(J).addScaledVector(vUp, 0.165).addScaledVector(fb, 0.026);
    arm.biceps.quaternion.copy(q);
    arm.biceps.scale.set(0.034, 0.105, 0.036);
    arm.triceps.position.copy(J).addScaledVector(vUp, 0.155).addScaledVector(fb, -0.03);
    arm.triceps.quaternion.copy(q);
    arm.triceps.scale.set(0.036, 0.118, 0.036);
    between(arm.foreM, ta.copy(E).addScaledVector(vFore, 0.19), tb.copy(E).addScaledVector(vFore, 0.01));
  }

  // ------------------------------------------------ particles: chunky pixel sparks off working fibres
  const PN = 200;
  const pPos = new Float32Array(PN * 3).fill(999);
  const pCol = new Float32Array(PN * 3);
  const pSize = new Float32Array(PN);
  const pVel = new Float32Array(PN * 3);
  const pLife = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const points = new THREE.Points(
    pGeo,
    new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 aColor; attribute float aSize; varying vec3 vC;
        void main(){ vC = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize; }`,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    })
  );
  points.frustumCulled = false;
  scene.add(points);
  let rand = rng(7);
  let pNext = 0;
  const wv = new THREE.Vector3();
  const tmpC = new THREE.Color();

  // wrist trail (world space) for the motion arrow drawn by the HUD
  const TRAIL = 16;
  let trail = [];

  function reset() {
    pPos.fill(999);
    pLife.fill(0);
    rand = rng(7);
    pNext = 0;
    trail = [];
  }
  function stepParticles(dt, act, xray) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        pPos[i * 3 + 1] = 999;
        continue;
      }
      pVel[i * 3 + 1] += 0.45 * dt;
      for (let k = 0; k < 3; k++) pPos[i * 3 + k] += pVel[i * 3 + k] * dt;
    }
    if (xray >= 1) {
      for (const arm of arms) {
        for (const hd of arm.heads) {
          const a = act[hd.hi];
          if (a < 0.45) continue;
          if (rand() > (a - 0.4) * 1.5) continue;
          const g = hd.grid[1 + Math.floor(rand() * (hd.nU - 1))][2 + Math.floor(rand() * 4)];
          wv.copy(g);
          torso.localToWorld(wv);
          const i = pNext++ % PN;
          pPos[i * 3] = wv.x;
          pPos[i * 3 + 1] = wv.y;
          pPos[i * 3 + 2] = wv.z;
          pVel[i * 3] = (rand() - 0.5) * 0.28 + arm.s * 0.08;
          pVel[i * 3 + 1] = 0.1 + rand() * 0.28;
          pVel[i * 3 + 2] = (rand() - 0.5) * 0.28;
          pLife[i] = 0.35 + rand() * 0.45;
          pSize[i] = 2 + Math.floor(rand() * 4);
          tmpC.copy(hd.base).lerp(white, rand() * 0.75);
          pCol[i * 3] = tmpC.r;
          pCol[i * 3 + 1] = tmpC.g;
          pCol[i * 3 + 2] = tmpC.b;
        }
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
  }

  // scan bar shown while the x-ray plane sweeps the body
  const scanBar = mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.012, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9ff0ff, side: THREE.DoubleSide })
  );
  scanBar.visible = false;
  scene.add(scanBar);

  // ------------------------------------------------ aux (id) materials for the ink pass
  const auxList = [];
  let idCount = 0;
  const idRand = rng(1234);
  const tagIds = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o === scanBar || o === floor) return;
    idCount++;
    const id4 = new THREE.Vector4(0.1 + idRand() * 0.85, 0.1 + idRand() * 0.85, 0.1 + idRand() * 0.85, 0);
    const tag = o.userData.aux;
    if (tag) {
      if (!tagIds.has(tag)) tagIds.set(tag, id4.clone().setW(200 / 255));
      id4.copy(tagIds.get(tag));
    }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uAux: { value: id4 },
        uUseAttr: { value: o.geometry.attributes.aAux ? 1 : 0 },
      },
      vertexShader: AUX_VERT,
      fragmentShader: AUX_FRAG,
      clipping: true,
      side: o.material.side,
    });
    if (o.material.polygonOffset) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = o.material.polygonOffsetFactor;
      m.polygonOffsetUnits = o.material.polygonOffsetUnits;
    }
    m.clippingPlanes = o.material.clippingPlanes;
    auxList.push({ o, main: o.material, aux: m });
  });
  const hidden = [];
  scene.traverse((o) => {
    if (o.isSprite || o.isPoints || o.isLineSegments) hidden.push(o);
  });
  hidden.push(scanBar, floor);

  // ------------------------------------------------ ink pass
  const inkU = {
    tColor: { value: colorRT.texture },
    tAux: { value: auxRT.texture },
    tDepth: { value: auxRT.depthTexture },
    uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uInk: { value: new THREE.Color(COL.ink) },
    uHi: { value: HEADS.map((h) => new THREE.Color(h.color).lerp(white, 0.55)) },
    uHiAmt: { value: [0, 0, 0] },
  };
  const inkScene = new THREE.Scene();
  const inkCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  inkScene.add(mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: inkU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: INK_FRAG,
      depthTest: false,
    })
  ));

  // ------------------------------------------------ per-frame update
  const anchors = {
    front: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    rear: new THREE.Vector3(),
    elbow: new THREE.Vector3(),
    wrist: new THREE.Vector3(),
    back: new THREE.Vector3(),
    belly: new THREE.Vector3(),
  };
  const state = { act: [0, 0, 0], armAngle: 0, xray: 0 };

  function update(t) {
    const p = pose(t);
    const act = activation(t);
    const xr = chXray(t);
    state.act = act;
    state.armAngle = p.armAngle;
    state.xray = xr;

    torso.rotation.x = p.hinge;
    // scan plane sweeps from above the head down to the floor
    const scanY = 1.95 - xr * 2.05;
    skinPlane.constant = scanY;
    innerPlane.constant = -scanY;
    for (const m of skinMats) m.visible = xr < 1;
    for (const m of innerMats) m.visible = xr > 0;
    scanBar.visible = xr > 0 && xr < 1;
    scanBar.position.y = scanY;
    capMat.emissiveIntensity = 0.16 * act[1] * act[1];
    for (let i = 0; i < 3; i++) inkU.uHiAmt.value[i] = xr >= 1 ? Math.min(1, Math.max(0, (act[i] - 0.3) / 0.3)) : 0;

    torso.updateMatrixWorld(true);
    updateArm(arms[1], p, act, xr);
    updateArm(arms[0], p, act, xr); // last, so the scratch vectors hold the +x arm
    const a0 = arms[0];
    anchors.front.copy(a0.heads[0].centroid);
    anchors.mid.copy(a0.heads[1].centroid);
    anchors.rear.copy(a0.heads[2].centroid);
    anchors.elbow.copy(E);
    anchors.wrist.copy(Hc);
    anchors.back.set(0, 0.36, -0.1);
    anchors.belly.set(0, 0.14, 0.09);
    for (const k in anchors) torso.localToWorld(anchors[k]);
    trail.push(anchors.wrist.clone());
    if (trail.length > TRAIL) trail.shift();

    const c = cameraAt(t);
    const az = ((c.az + 3 * Math.sin((2 * Math.PI * t) / 16)) * Math.PI) / 180;
    const el = (c.el * Math.PI) / 180;
    camera.position.set(
      c.tx + c.d * Math.sin(az) * Math.cos(el),
      c.ty + c.d * Math.sin(el),
      c.tz + c.d * Math.cos(az) * Math.cos(el)
    );
    camera.lookAt(c.tx, c.ty, c.tz);
    camera.updateMatrixWorld(true);
  }

  const pv = new THREE.Vector3();
  const toHud = (v, hw, hh) => {
    pv.copy(v).project(camera);
    return [Math.round((pv.x * 0.5 + 0.5) * hw), Math.round((1 - (pv.y * 0.5 + 0.5)) * hh)];
  };

  function render() {
    // 1. colour
    renderer.setRenderTarget(colorRT);
    renderer.render(scene, camera);
    // 2. ids + depth
    for (const a of auxList) {
      a.aux.visible = a.main.visible;
      a.o.material = a.aux;
    }
    for (const o of hidden) {
      o.userData.wasVisible = o.visible;
      o.visible = false;
    }
    const bg = scene.background;
    scene.background = null;
    renderer.setRenderTarget(auxRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    scene.background = bg;
    for (const a of auxList) a.o.material = a.main;
    for (const o of hidden) o.visible = o.userData.wasVisible;
    // 3. ink outlines to the canvas
    renderer.setRenderTarget(null);
    renderer.render(inkScene, inkCam);
  }

  return {
    canvas,
    state,
    update,
    step(dt) {
      stepParticles(dt, state.act, state.xray);
    },
    reset,
    render,
    project: (name, hw, hh) => toHud(anchors[name], hw, hh),
    trail: (hw, hh) => trail.map((v) => toHud(v, hw, hh)),
  };
}
