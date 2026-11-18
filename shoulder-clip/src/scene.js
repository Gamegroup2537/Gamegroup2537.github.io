// Anatomy figure rendered at low resolution (pixel-art look).
// model: 'a' detailed skeleton + dotted ghost body
//        'b' écorché: surface muscles over the skeleton, deltoids highlighted
//        'c' hologram: glass body with glowing rim around the skeleton
import * as THREE from 'three';
import { pose, activation, cameraAt, chXray, HEADS } from './timeline.js';

const COL = {
  skin: 0x8a8ab6,
  shorts: 0xc9223c,
  bone: 0xe9e4f6,
  cartilage: 0xa9a6d0,
  socket: 0x15173f,
  metal: 0x6a6d96,
  plate: 0xd0243c,
  floor: 0x10123a,
  muscle: 0xb24a6c,
  muscleDeep: 0x7c3558,
  holo: 0x5f7dff,
  glass: 0x4f8dff,
};

const BAYER = `
uniform float uAlpha;
const float BM[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float bayer4(vec2 p){ ivec2 i = ivec2(mod(p, 4.0)); return (BM[i.x + i.y * 4] + 0.5) / 16.0; }
void main() {
  if (bayer4(gl_FragCoord.xy) >= uAlpha) discard;
`;

// Lambert material with screen-door (dithered) transparency driven by a shared uniform.
function ditherMat(color, alphaUniform, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAlpha = alphaUniform;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', BAYER);
  };
  return m;
}

// Additive rim-light "glass" used by the hologram model.
function glassMat(color, opacityUniform) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOp: opacityUniform },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOp;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(uColor * (0.05 + 1.25 * f) * uOp, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

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
const cyl = (r0, r1, mat, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, seg), mat);
const ball = (r, mat, detail = 1) => new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
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

export function createScene(W, H, bgCanvas, { model = 'a' } = {}) {
  const MUSCLES = model === 'b';
  const GLASS = model === 'c';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.magFilter = THREE.NearestFilter;
  bgTex.minFilter = THREE.NearestFilter;
  scene.background = bgTex;

  const camera = new THREE.PerspectiveCamera(20, W / H, 0.5, 40);
  scene.add(camera);
  camera.add(new THREE.AmbientLight(0x8088d8, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-2.5, 4, 3);
  camera.add(key, key.target);
  key.target.position.set(0, 0, -5);
  const rim = new THREE.DirectionalLight(0xff5fa8, 1.0);
  rim.position.set(3, 1.5, -6);
  camera.add(rim, rim.target);
  rim.target.position.set(0, 0, -5);

  // shared dither-alpha uniforms
  const A = {
    skin: { value: 1 },
    arm: { value: 1 },
    cap: { value: 1 },
    inner: { value: 0 },
    solid: { value: 1 },
    glass: { value: 0 },
  };
  const skinMat = ditherMat(COL.skin, A.skin);
  const armMat = ditherMat(COL.skin, A.arm);
  const capMat = ditherMat(COL.skin, A.cap);
  capMat.emissive = new THREE.Color(HEADS[1].color);
  capMat.emissiveIntensity = 0;
  const shortsMat = ditherMat(COL.shorts, A.skin);
  const boneMat = ditherMat(COL.bone, A.inner, { flatShading: false });
  const boneFlat = ditherMat(COL.bone, A.inner, { side: THREE.DoubleSide });
  const cartMat = ditherMat(COL.cartilage, A.inner, { flatShading: false });
  const socketMat = ditherMat(COL.socket, A.inner);
  const metalMat = ditherMat(COL.metal, A.solid);
  const plateMat = ditherMat(COL.plate, A.solid);
  const muscleMat = ditherMat(COL.muscle, A.inner, { flatShading: false });
  const deepMat = ditherMat(COL.muscleDeep, A.inner, { flatShading: false });
  const glass = glassMat(COL.glass, A.glass);
  const skinBase = new THREE.Color(COL.skin);
  const holo = new THREE.Color(COL.holo);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), new THREE.MeshBasicMaterial({ color: COL.floor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  scene.add(floor);

  const root = new THREE.Group();
  scene.add(root);
  const HIP_Y = 0.95;
  const torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);
  root.add(torso);

  // Adds a skin mesh and, for the hologram model, a matching glass shell.
  function skin(parent, geo, mat) {
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    if (GLASS) {
      const shell = new THREE.Mesh(geo, glass);
      mesh.add(shell);
    }
    return mesh;
  }

  // ------------------------------------------------ lower body (static)
  skin(root, loft([[0.73, 0.168, 0.114], [0.8, 0.176, 0.12], [0.9, 0.17, 0.118], [1.0, 0.15, 0.106]]), shortsMat);
  for (const s of [1, -1]) {
    const hipJ = V(s * 0.085, 0.925, 0);
    const troch = V(s * 0.132, 0.9, -0.005);
    const knee = V(s * 0.098, 0.5, 0.012);
    const ankle = V(s * 0.098, 0.075, 0);
    const thigh = skin(root, new THREE.CylinderGeometry(0.084, 0.058, 1, 10), skinMat);
    between(thigh, knee, V(s * 0.092, 0.78, 0));
    const shin = skin(root, new THREE.CylinderGeometry(0.058, 0.04, 1, 10), skinMat);
    between(shin, ankle, knee);
    const foot = skin(root, new THREE.BoxGeometry(0.095, 0.07, 0.22), skinMat);
    foot.position.set(s * 0.098, 0.035, 0.05);
    // bones
    const fHead = ball(0.025, boneMat);
    fHead.position.copy(hipJ);
    const neck = cyl(0.014, 0.014, boneMat, 6);
    between(neck, hipJ, troch);
    const tro = ball(0.022, boneMat);
    tro.position.copy(troch);
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
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.07), boneMat);
    heel.position.set(ankle.x, 0.03, -0.01);
    const toes = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.022, 0.12), boneMat);
    toes.position.set(ankle.x, 0.02, 0.085);
    root.add(fHead, neck, tro, femur, cond, patella, tibia, fibula, heel, toes);
    if (MUSCLES) {
      const quad = cyl(0.052, 0.078, muscleMat, 10);
      between(quad, V(knee.x, knee.y + 0.04, knee.z), V(s * 0.095, 0.86, 0));
      const calf = ball(0.05, muscleMat, 2);
      calf.scale.set(0.95, 2.6, 1.0);
      calf.position.set(knee.x, 0.34, -0.02);
      root.add(quad, calf);
    }
  }

  // ------------------------------------------------ torso skin
  const torsoGeo = loft([
    [-0.04, 0.148, 0.104, 0],
    [0.06, 0.14, 0.098, 0],
    [0.17, 0.127, 0.09, 0],
    [0.3, 0.15, 0.106, 0.006],
    [0.4, 0.172, 0.118, 0.012],
    [0.47, 0.176, 0.112, 0.006],
    [0.525, 0.15, 0.09, 0],
    [0.555, 0.07, 0.06, -0.005],
    [0.578, 0.05, 0.05, -0.005],
    [0.64, 0.046, 0.048, 0],
  ]);
  skin(torso, torsoGeo, skinMat);
  const headS = skin(torso, new THREE.IcosahedronGeometry(0.105, 2), skinMat);
  headS.scale.set(0.88, 1.1, 0.98);
  headS.position.set(0, 0.745, 0.012);

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
    const tan = spine.getTangentAt(u);
    const r = i < 5 ? 0.027 : i < 17 ? 0.021 : 0.016;
    const v = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.021, 8), boneMat);
    v.position.copy(p);
    v.quaternion.setFromUnitVectors(UP, tan);
    torso.add(v);
    if (i < 18) {
      const proc = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.034), boneMat);
      proc.position.copy(p);
      proc.position.z -= r + 0.012;
      proc.position.y -= 0.006;
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
      torso.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, i < 10 ? 0.0085 : 0.007, 5), boneMat));
      if (s === 1) ribEnd[i] = curve.getPoint(1);
    }
  }
  // sternum follows the front ends of ribs 1-7
  {
    const top = V(0, ribEnd[0].y + 0.012, ribEnd[0].z - 0.004);
    const bot = V(0, ribEnd[6].y + 0.012, ribEnd[6].z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.036, 1, 0.012), boneMat);
    between(body, bot, top);
    const manu = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.045, 0.014), boneMat);
    manu.position.copy(top).add(V(0, -0.012, 0.004));
    manu.quaternion.copy(body.quaternion);
    const xiph = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.008), cartMat);
    xiph.position.copy(bot).add(V(0, -0.016, 0.002));
    torso.add(body, manu, xiph);
    // costal margin: cartilage joining the false ribs up to the sternum
    for (const s of [1, -1]) {
      const pts = [V(s * 0.016, bot.y + 0.005, bot.z), ...[7, 8, 9].map((i) => V(s * ribEnd[i].x, ribEnd[i].y, ribEnd[i].z))];
      torso.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008, 5), cartMat));
    }
  }

  // ------------------------------------------------ skull
  {
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.088, 18, 14), boneMat);
    cranium.scale.set(0.86, 0.96, 1.08);
    cranium.position.set(0, 0.765, -0.004);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.042, 0.075, 10), boneMat);
    face.scale.set(1, 1, 0.82);
    face.position.set(0, 0.7, 0.038);
    const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.034, 0.036, 8), boneMat);
    jaw.scale.set(1, 1, 0.95);
    jaw.position.set(0, 0.652, 0.032);
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), ditherMat(0xffffff, A.inner));
    teeth.position.set(0, 0.672, 0.076);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.024, 4), socketMat);
    nose.position.set(0, 0.712, 0.082);
    torso.add(cranium, face, jaw, teeth, nose);
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), socketMat);
      eye.scale.set(1.15, 1, 0.6);
      eye.position.set(s * 0.031, 0.748, 0.078);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.05), boneMat);
      cheek.position.set(s * 0.055, 0.722, 0.04);
      torso.add(eye, cheek);
    }
  }

  // ------------------------------------------------ pelvis (moves with the torso in a hip hinge)
  {
    for (const s of [1, -1]) {
      const wing = new THREE.Mesh(
        new THREE.SphereGeometry(0.115, 12, 6, 0.6 * Math.PI, 0.85 * Math.PI, 0.18 * Math.PI, 0.4 * Math.PI),
        ditherMat(COL.bone, A.inner, { flatShading: false, side: THREE.DoubleSide })
      );
      wing.scale.set(s, 0.85, 0.78);
      wing.position.set(s * 0.032, -0.04, -0.018);
      const isch = cyl(0.012, 0.016, boneMat, 6);
      between(isch, V(s * 0.06, -0.13, -0.01), V(s * 0.095, -0.04, -0.01));
      const pubR = cyl(0.011, 0.011, boneMat, 6);
      between(pubR, V(s * 0.008, -0.105, 0.05), V(s * 0.085, -0.045, 0.02));
      const lowR = cyl(0.01, 0.01, boneMat, 6);
      between(lowR, V(s * 0.008, -0.105, 0.05), V(s * 0.06, -0.13, -0.01));
      torso.add(wing, isch, pubR, lowR);
    }
    const sacrum = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.018, 0.1, 6), boneMat);
    sacrum.scale.set(1, 1, 0.45);
    sacrum.position.set(0, -0.045, -0.072);
    sacrum.rotation.x = 0.25;
    torso.add(sacrum);
  }

  // ------------------------------------------------ fan / sheet muscles
  // A sheet is a grid of fibres (u across, t along) rebuilt every frame.
  function makeSheet(nU, nT, color, { stripe = 0.6, tendonFrom = 0.8, tendon = 0.75, emissive = false } = {}) {
    const g = new THREE.BufferGeometry();
    const n = nU * nT * 6;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3);
    const base = new THREE.Color(color);
    const tend = new THREE.Color(0xf4ecff);
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < nU; i++) {
      for (let j = 0; j < nT; j++) {
        const tt = (j + 0.5) / nT;
        c.copy(base).multiplyScalar(i % 2 ? stripe : 1.0);
        c.lerp(tend, Math.max(0, (tt - tendonFrom) / (1 - tendonFrom)) * tendon);
        for (let v = 0; v < 6; v++) {
          col[k++] = c.r; col[k++] = c.g; col[k++] = c.b;
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = ditherMat(0xffffff, A.inner, { vertexColors: true, side: THREE.DoubleSide });
    if (emissive) {
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 0;
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    torso.add(mesh);
    const grid = [];
    for (let i = 0; i <= nU; i++) {
      grid.push([]);
      for (let j = 0; j <= nT; j++) grid[i].push(new THREE.Vector3());
    }
    return { nU, nT, mesh, mat, grid, base };
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

  function makeArm(s) {
    const arm = { s };
    const mir = (p) => V(p[0] * s, p[1], p[2]);
    arm.J = V(J0.x * s, J0.y, J0.z);
    arm.curve = new THREE.CatmullRomCurve3(originRel.map((p) => mir(p).add(arm.J)));

    // clavicle (S-curve) and scapula, fixed to the rib cage
    const clav = new THREE.CatmullRomCurve3([
      V(s * 0.024, 0.512, 0.03), V(s * 0.08, 0.526, 0.056), V(s * 0.14, 0.54, 0.04), V(s * 0.19, 0.55, 0.03),
    ]);
    torso.add(new THREE.Mesh(new THREE.TubeGeometry(clav, 14, 0.0095, 6), boneMat));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([
      s * 0.082, 0.535, -0.092, s * 0.17, 0.505, -0.05, s * 0.1, 0.33, -0.108,
      s * 0.082, 0.535, -0.092, s * 0.1, 0.33, -0.108, s * 0.075, 0.45, -0.108,
    ], 3));
    sg.computeVertexNormals();
    torso.add(new THREE.Mesh(sg, boneFlat));
    const sSpine = cyl(0.009, 0.011, boneMat, 6);
    between(sSpine, V(s * 0.08, 0.5, -0.1), V(s * 0.2, 0.55, -0.03));
    const acro = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.05), boneMat);
    acro.position.set(s * 0.205, 0.553, -0.004);
    const glen = ball(0.022, boneMat);
    glen.scale.set(0.5, 1, 0.9);
    glen.position.set(s * 0.158, 0.5, -0.012);
    torso.add(sSpine, acro, glen);

    // moving bones
    arm.humerus = cyl(0.016, 0.018, boneMat);
    arm.humHead = ball(0.04, boneMat, 2);
    arm.cond = ball(0.026, boneMat);
    arm.radius = cyl(0.009, 0.011, boneMat, 6);
    arm.ulna = cyl(0.008, 0.012, boneMat, 6);
    arm.palm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.075, 0.04), boneMat);
    // skin
    arm.upperS = skin(torso, new THREE.CylinderGeometry(0.054, 0.043, 1, 10), armMat);
    arm.elbowS = skin(torso, new THREE.IcosahedronGeometry(0.044, 2), armMat);
    arm.foreS = skin(torso, new THREE.CylinderGeometry(0.042, 0.03, 1, 10), armMat);
    arm.hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.05), armMat);
    arm.cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.094, 2), capMat);
    arm.cap.scale.set(1, 0.95, 0.98);
    // dumbbell
    arm.bell = new THREE.Group();
    arm.bell.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 6), metalMat));
    for (const k of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 6), plateMat);
      pl.position.y = k * 0.075;
      arm.bell.add(pl);
    }
    torso.add(arm.humerus, arm.humHead, arm.cond, arm.radius, arm.ulna, arm.palm, arm.hand, arm.cap, arm.bell);

    arm.heads = HEADS.map((hd, hi) => {
      const sh = makeSheet(NU[hi], NT, hd.color, { stripe: 0.58, emissive: true });
      sh.hi = hi;
      sh.centroid = new THREE.Vector3();
      sh.glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: hd.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
      );
      torso.add(sh.glow);
      return sh;
    });

    if (MUSCLES) {
      const o = { stripe: 0.72, tendonFrom: 0.86, tendon: 0.6 };
      arm.pec = makeSheet(7, 7, COL.muscle, o);
      arm.pecCurve = new THREE.CatmullRomCurve3([
        V(s * 0.12, 0.538, 0.05), V(s * 0.034, 0.5, 0.04), V(s * 0.022, 0.42, 0.078), V(s * 0.032, 0.335, 0.11),
      ]);
      arm.lat = makeSheet(7, 7, COL.muscle, o);
      arm.latCurve = new THREE.CatmullRomCurve3([
        V(s * 0.012, 0.31, -0.092), V(s * 0.016, 0.16, -0.062), V(s * 0.03, 0.03, -0.085), V(s * 0.11, 0.005, -0.07),
      ]);
      // trapezius: fixed, from the spine out to the shoulder girdle
      const trap = makeSheet(8, 5, COL.muscle, { stripe: 0.72, tendonFrom: 1, tendon: 0 });
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
      arm.triceps = ball(1, muscleMat, 2);
      arm.foreM = cyl(0.022, 0.04, muscleMat, 10);
      torso.add(arm.biceps, arm.triceps, arm.foreM);
      const scm = cyl(0.011, 0.013, muscleMat, 6);
      between(scm, V(s * 0.02, 0.515, 0.035), V(s * 0.062, 0.675, -0.02));
      torso.add(scm);
    }
    return arm;
  }
  const arms = [makeArm(1), makeArm(-1)];

  if (MUSCLES) {
    // abdominal wall + "six pack"
    torso.add(new THREE.Mesh(
      loft([[-0.04, 0.138, 0.096, 0], [0.06, 0.13, 0.09, 0], [0.17, 0.118, 0.084, 0], [0.25, 0.128, 0.09, 0.004]]),
      deepMat
    ));
    for (let r = 0; r < 4; r++) {
      for (const s of [1, -1]) {
        const ab = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.046, 0.02), muscleMat);
        ab.position.set(s * 0.027, 0.045 + r * 0.056, 0.088 + (r === 3 ? 0.008 : 0));
        torso.add(ab);
      }
    }
    for (const s of [1, -1]) {
      const glute = ball(0.085, muscleMat, 2);
      glute.scale.set(1, 1, 0.8);
      glute.position.set(s * 0.075, -0.09, -0.06);
      torso.add(glute);
    }
  }

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
  const DOWN = new THREE.Vector3(0, -1, 0);
  const nLat = new THREE.Vector3();
  const fb = new THREE.Vector3();
  const I = new THREE.Vector3();
  const O = new THREE.Vector3();
  const Iu = new THREE.Vector3();
  const Cc = new THREE.Vector3();
  const oh = new THREE.Vector3();
  const od = new THREE.Vector3();
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
    arm.cap.position.copy(J).addScaledVector(vUp, 0.012);
    arm.cap.position.x += s * 0.006;
    arm.bell.position.copy(Hc);
    arm.bell.quaternion.setFromUnitVectors(UP, vHandle);

    // deltoid: fibres run from the origin horseshoe to the humerus insertion
    I.copy(J).addScaledVector(vUp, 0.14).addScaledVector(nLat, 0.02);
    for (const hd of arm.heads) {
      const [u0, u1] = U_RANGE[hd.hi];
      const a = act[hd.hi];
      for (let i = 0; i <= hd.nU; i++) {
        const v = i / hd.nU;
        const u = u0 + (u1 - u0) * v;
        arm.curve.getPoint(u, O);
        Iu.copy(I).addScaledVector(fb, (0.5 - u) * 0.034);
        const th = ((85 - 170 * u) * Math.PI) / 180;
        oh.set(Math.cos(th) * s, 0, Math.sin(th)).applyQuaternion(qH);
        od.subVectors(O, J).normalize();
        id.subVectors(Iu, J).normalize();
        const belly = 0.8 + 0.2 * Math.sin(Math.PI * v);
        const rest = Math.hypot(0.02 * s + J.x - O.x, J.y - 0.14 - O.y, (0.5 - u) * 0.034 - O.z);
        const boost = Math.min(1.65, Math.max(0.85, Math.sqrt(rest / Iu.distanceTo(O))));
        const rc = 0.142 * belly * (1 + 0.2 * a) * boost;
        Cc.copy(od).multiplyScalar(0.5).addScaledVector(id, 0.5).addScaledVector(oh, 1.2).normalize().multiplyScalar(rc).add(J);
        fibre(hd, i, O, Cc, Iu);
      }
      commit(hd);
      hd.centroid.copy(hd.grid[hd.nU >> 1][4]);
      hd.mat.emissiveIntensity = 0.04 + a * a * 0.45;
      hd.mat.color.copy(white).multiplyScalar((MUSCLES ? 0.82 : 0.7) + (MUSCLES ? 0.18 : 0.3) * a);
      hd.glow.position.copy(hd.centroid).addScaledVector(oh, 0.02);
      const gs = 0.14 + 0.2 * a;
      hd.glow.scale.set(gs, gs, 1);
      hd.glow.material.opacity = xray * Math.max(0, a - 0.3) * 0.4;
    }

    if (MUSCLES) {
      // pectoralis major: sternum + clavicle -> front of the humerus
      for (let i = 0; i <= arm.pec.nU; i++) {
        const v = i / arm.pec.nU;
        arm.pecCurve.getPoint(v, O);
        Iu.copy(J).addScaledVector(vUp, 0.07 + 0.06 * v).addScaledVector(fb, 0.02);
        Cc.copy(O).lerp(Iu, 0.55);
        Cc.z = Math.max(Cc.z, 0.075) + 0.03 + 0.02 * Math.sin(Math.PI * v);
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
  }

  // ------------------------------------------------ particles (pixel "sparks" off working fibres)
  const PN = 160;
  const pPos = new Float32Array(PN * 3).fill(999);
  const pCol = new Float32Array(PN * 3);
  const pVel = new Float32Array(PN * 3);
  const pLife = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
  points.frustumCulled = false;
  scene.add(points);
  let rand = rng(7);
  let pNext = 0;
  const wv = new THREE.Vector3();
  const tmpC = new THREE.Color();

  function resetParticles() {
    pPos.fill(999);
    pLife.fill(0);
    rand = rng(7);
    pNext = 0;
  }
  function stepParticles(dt, act, xray) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        pPos[i * 3 + 1] = 999;
        continue;
      }
      pVel[i * 3 + 1] += 0.5 * dt;
      for (let k = 0; k < 3; k++) pPos[i * 3 + k] += pVel[i * 3 + k] * dt;
    }
    if (xray > 0.6) {
      for (const arm of arms) {
        for (const hd of arm.heads) {
          const a = act[hd.hi];
          if (a < 0.45) continue;
          if (rand() > (a - 0.4) * 1.3) continue;
          const g = hd.grid[1 + Math.floor(rand() * (hd.nU - 1))][2 + Math.floor(rand() * 4)];
          wv.copy(g);
          torso.localToWorld(wv);
          const i = pNext++ % PN;
          pPos[i * 3] = wv.x;
          pPos[i * 3 + 1] = wv.y;
          pPos[i * 3 + 2] = wv.z;
          pVel[i * 3] = (rand() - 0.5) * 0.25 + arm.s * 0.08;
          pVel[i * 3 + 1] = 0.1 + rand() * 0.25;
          pVel[i * 3 + 2] = (rand() - 0.5) * 0.25;
          pLife[i] = 0.35 + rand() * 0.4;
          tmpC.copy(hd.base).lerp(white, rand() * 0.6);
          pCol[i * 3] = tmpC.r;
          pCol[i * 3 + 1] = tmpC.g;
          pCol[i * 3 + 2] = tmpC.b;
        }
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

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
  const innerMats = [boneMat, boneFlat, cartMat, socketMat, muscleMat, deepMat];

  function update(t) {
    const p = pose(t);
    const act = activation(t);
    const xr = chXray(t);
    state.act = act;
    state.armAngle = p.armAngle;
    state.xray = xr;

    torso.rotation.x = p.hinge;
    A.inner.value = xr;
    // how much of the outer body stays visible once the x-ray is on
    const ghost = MUSCLES ? 0 : GLASS ? 0 : 0.26;
    A.skin.value = 1 - (1 - ghost) * xr;
    A.arm.value = 1 - (1 - ghost * 0.7) * xr;
    A.cap.value = 1 - xr;
    A.glass.value = xr;
    capMat.emissiveIntensity = 0.55 * act[1] * act[1];
    for (const m of [skinMat, armMat]) m.color.copy(skinBase).lerp(holo, xr);
    for (const m of innerMats) m.visible = xr > 0.01;
    glass.visible = xr > 0.01;

    torso.updateMatrixWorld(true);
    updateArm(arms[1], p, act, xr);
    updateArm(arms[0], p, act, xr); // last, so the scratch vectors hold the +x arm
    for (const arm of arms) for (const hd of arm.heads) hd.mesh.visible = xr > 0.01;
    const a0 = arms[0];
    anchors.front.copy(a0.heads[0].centroid);
    anchors.mid.copy(a0.heads[1].centroid);
    anchors.rear.copy(a0.heads[2].centroid);
    anchors.elbow.copy(E);
    anchors.wrist.copy(Hc);
    anchors.back.set(0, 0.36, -0.1);
    anchors.belly.set(0, 0.14, 0.09);
    for (const k in anchors) torso.localToWorld(anchors[k]);

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
  function project(name, hw, hh) {
    pv.copy(anchors[name]).project(camera);
    return [Math.round((pv.x * 0.5 + 0.5) * hw), Math.round((1 - (pv.y * 0.5 + 0.5)) * hh)];
  }

  return {
    canvas,
    state,
    update,
    step(dt) {
      stepParticles(dt, state.act, state.xray);
    },
    reset: resetParticles,
    render() {
      renderer.render(scene, camera);
    },
    project,
  };
}
