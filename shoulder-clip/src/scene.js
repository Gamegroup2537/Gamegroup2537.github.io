// Low-poly anatomy figure rendered at low resolution (pixel-art look).
import * as THREE from 'three';
import { pose, activation, cameraAt, chXray, HEADS } from './timeline.js';

const COL = {
  skin: 0x8a8ab6,
  shorts: 0xc9223c,
  bone: 0xdcdaf2,
  metal: 0x6a6d96,
  plate: 0xd0243c,
  floor: 0x10123a,
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

function loft(sections, n = 12) {
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
  // caps
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
const cyl = (r0, r1, mat, seg = 7) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, seg), mat);

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

export function createScene(W, H, bgCanvas) {
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
  camera.add(new THREE.AmbientLight(0x8088d8, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-2.5, 4, 3);
  camera.add(key);
  camera.add(key.target);
  key.target.position.set(0, 0, -5);
  const rim = new THREE.DirectionalLight(0xff5fa8, 1.0);
  rim.position.set(3, 1.5, -6);
  camera.add(rim);
  camera.add(rim.target);
  rim.target.position.set(0, 0, -5);

  // shared dither-alpha uniforms
  const A = { skin: { value: 1 }, arm: { value: 1 }, cap: { value: 1 }, inner: { value: 0 }, solid: { value: 1 } };
  const skinMat = ditherMat(COL.skin, A.skin);
  const armMat = ditherMat(COL.skin, A.arm);
  const capMat = ditherMat(COL.skin, A.cap);
  capMat.emissive = new THREE.Color(HEADS[1].color);
  capMat.emissiveIntensity = 0;
  const shortsMat = ditherMat(COL.shorts, A.skin);
  const boneMat = ditherMat(COL.bone, A.inner);
  const skinBase = new THREE.Color(COL.skin);
  const holo = new THREE.Color(0x5f7dff);
  const metalMat = ditherMat(COL.metal, A.solid);
  const plateMat = ditherMat(COL.plate, A.solid);

  // floor disc
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), new THREE.MeshBasicMaterial({ color: COL.floor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  scene.add(floor);

  const root = new THREE.Group();
  scene.add(root);

  // ------------------------------------------------ lower body (static)
  const HIP_Y = 0.95;
  const shorts = new THREE.Mesh(
    loft([[0.73, 0.168, 0.114], [0.8, 0.176, 0.12], [0.9, 0.17, 0.118], [1.0, 0.15, 0.106]]),
    shortsMat
  );
  root.add(shorts);
  const pelvisBone = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.085, 0.13), boneMat);
  pelvisBone.position.set(0, 0.93, -0.01);
  root.add(pelvisBone);
  for (const s of [1, -1]) {
    const hip = new THREE.Vector3(s * 0.092, 0.78, 0);
    const knee = new THREE.Vector3(s * 0.098, 0.5, 0.012);
    const ankle = new THREE.Vector3(s * 0.098, 0.07, 0);
    const thigh = cyl(0.058, 0.084, skinMat, 8);
    between(thigh, knee, hip);
    const shin = cyl(0.04, 0.058, skinMat, 8);
    between(shin, ankle, knee);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.07, 0.22), skinMat);
    foot.position.set(s * 0.098, 0.035, 0.05);
    const femur = cyl(0.02, 0.02, boneMat, 5);
    between(femur, knee, new THREE.Vector3(s * 0.092, 0.92, 0));
    const tibia = cyl(0.016, 0.016, boneMat, 5);
    between(tibia, ankle, knee);
    root.add(thigh, shin, foot, femur, tibia);
  }

  // ------------------------------------------------ torso (hinges at the hip)
  const torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);
  root.add(torso);

  const torsoSkin = new THREE.Mesh(
    loft([
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
    ]),
    skinMat
  );
  torso.add(torsoSkin);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 1), skinMat);
  head.scale.set(0.88, 1.1, 0.98);
  head.position.set(0, 0.74, 0.012);
  torso.add(head);

  // bones
  for (let i = 0; i < 11; i++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.04, 0.04), boneMat);
    v.position.set(0, 0.03 + i * 0.058, -0.055 + Math.sin(i / 3.2) * 0.012);
    torso.add(v);
  }
  const ribR = [0.116, 0.134, 0.146, 0.15, 0.138, 0.112];
  ribR.forEach((r, i) => {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 4, 12), boneMat);
    rib.rotation.x = Math.PI / 2;
    rib.scale.set(1, 0.7, 1); // torus Y (now world Z) squashed front-to-back
    rib.position.set(0, 0.2 + i * 0.052, 0.004);
    torso.add(rib);
  });
  const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.2, 0.014), boneMat);
  sternum.position.set(0, 0.37, 0.094);
  torso.add(sternum);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.084, 1), boneMat);
  skull.scale.set(0.9, 1.05, 1);
  skull.position.set(0, 0.755, 0.008);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.085), boneMat);
  jaw.position.set(0, 0.668, 0.03);
  torso.add(skull, jaw);
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.02), ditherMat(0x1a1c4a, A.inner));
    eye.position.set(s * 0.032, 0.752, 0.088);
    torso.add(eye);
  }

  // ------------------------------------------------ arms + deltoids
  const J0 = new THREE.Vector3(0.19, 0.5, 0);
  const L1 = 0.3;
  const L2 = 0.27;
  // deltoid origin "horseshoe" relative to the joint (clavicle -> acromion -> scapular spine)
  const originRel = [
    [-0.075, 0.038, 0.062],
    [0.0, 0.05, 0.056],
    [0.05, 0.052, 0.0],
    [0.005, 0.048, -0.056],
    [-0.085, 0.032, -0.074],
  ];
  const U_RANGE = [
    [0.0, 0.345],
    [0.375, 0.625],
    [0.655, 1.0],
  ];
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
    const mir = (v) => new THREE.Vector3(v[0] * s, v[1], v[2]);
    arm.J = new THREE.Vector3(J0.x * s, J0.y, J0.z);
    arm.curve = new THREE.CatmullRomCurve3(originRel.map((p) => mir(p).add(arm.J)));

    // static bones attached to the torso
    const clav = cyl(0.011, 0.012, boneMat, 5);
    between(clav, new THREE.Vector3(s * 0.02, 0.5, 0.082), new THREE.Vector3(s * 0.19, 0.548, 0.04));
    const spineS = cyl(0.01, 0.012, boneMat, 5);
    between(spineS, new THREE.Vector3(s * 0.075, 0.51, -0.09), new THREE.Vector3(s * 0.215, 0.552, -0.012));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [s * 0.072, 0.515, -0.088, s * 0.2, 0.545, -0.05, s * 0.105, 0.33, -0.098],
        3
      )
    );
    const scap = new THREE.Mesh(sg, ditherMat(0xc4c2e2, A.inner, { side: THREE.DoubleSide }));
    torso.add(clav, spineS, scap);

    // moving bones
    arm.humerus = cyl(0.017, 0.019, boneMat, 6);
    arm.humHead = new THREE.Mesh(new THREE.IcosahedronGeometry(0.041, 1), boneMat);
    arm.elbowB = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024, 0), boneMat);
    arm.foreB = cyl(0.012, 0.016, boneMat, 5);
    // skin
    arm.upperS = cyl(0.043, 0.054, armMat, 8);
    arm.elbowS = new THREE.Mesh(new THREE.IcosahedronGeometry(0.044, 1), armMat);
    arm.foreS = cyl(0.03, 0.042, armMat, 8);
    arm.hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.05), ditherMat(COL.skin, A.solid));
    arm.cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.094, 1), capMat);
    arm.cap.scale.set(1, 0.95, 0.98);
    // dumbbell
    arm.bell = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 6), metalMat);
    arm.bell.add(bar);
    for (const k of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 6), plateMat);
      pl.position.y = k * 0.075;
      arm.bell.add(pl);
    }
    torso.add(arm.humerus, arm.humHead, arm.elbowB, arm.foreB, arm.upperS, arm.elbowS, arm.foreS, arm.hand, arm.cap, arm.bell);

    // deltoid heads
    arm.heads = HEADS.map((hd, hi) => {
      const nU = NU[hi];
      const g = new THREE.BufferGeometry();
      const n = nU * NT * 6;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const col = new Float32Array(n * 3);
      const base = new THREE.Color(hd.color);
      const tendon = new THREE.Color(0xf4ecff);
      const c = new THREE.Color();
      let k = 0;
      for (let i = 0; i < nU; i++) {
        for (let j = 0; j < NT; j++) {
          const tt = (j + 0.5) / NT;
          c.copy(base).multiplyScalar(i % 2 ? 0.58 : 1.0);
          const tn = Math.max(0, (tt - 0.8) / 0.2);
          c.lerp(tendon, tn * 0.75);
          for (let v = 0; v < 6; v++) {
            col[k++] = c.r;
            col[k++] = c.g;
            col[k++] = c.b;
          }
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = ditherMat(0xffffff, A.inner, { vertexColors: true, side: THREE.DoubleSide });
      mat.emissive = new THREE.Color(hd.color);
      mat.emissiveIntensity = 0;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      torso.add(mesh);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: hd.color,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        })
      );
      torso.add(glow);
      const grid = [];
      for (let i = 0; i <= nU; i++) {
        grid.push([]);
        for (let j = 0; j <= NT; j++) grid[i].push(new THREE.Vector3());
      }
      return { hi, nU, mesh, mat, glow, grid, centroid: new THREE.Vector3(), base };
    });
    return arm;
  }
  const arms = [makeArm(1), makeArm(-1)];

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

    between(arm.humerus, J, E);
    arm.humHead.position.copy(J);
    arm.elbowB.position.copy(E);
    between(arm.foreB, E, Wp);
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
    q.setFromUnitVectors(DOWN, vUp);
    qH.copy(qI).slerp(q, 0.5);
    nLat.set(s, 0, 0).applyQuaternion(q);
    fb.set(0, 0, 1).applyQuaternion(q);
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
        for (let j = 0; j <= NT; j++) {
          const t = j / NT;
          const w0 = (1 - t) * (1 - t);
          const w1 = 2 * t * (1 - t);
          const w2 = t * t;
          hd.grid[i][j].set(
            O.x * w0 + Cc.x * w1 + Iu.x * w2,
            O.y * w0 + Cc.y * w1 + Iu.y * w2,
            O.z * w0 + Cc.z * w1 + Iu.z * w2
          );
        }
      }
      const pos = hd.mesh.geometry.attributes.position;
      const arr = pos.array;
      let k = 0;
      const put = (v) => {
        arr[k++] = v.x;
        arr[k++] = v.y;
        arr[k++] = v.z;
      };
      for (let i = 0; i < hd.nU; i++) {
        for (let j = 0; j < NT; j++) {
          const g00 = hd.grid[i][j];
          const g10 = hd.grid[i + 1][j];
          const g01 = hd.grid[i][j + 1];
          const g11 = hd.grid[i + 1][j + 1];
          put(g00); put(g01); put(g10);
          put(g10); put(g01); put(g11);
        }
      }
      pos.needsUpdate = true;
      hd.centroid.copy(hd.grid[hd.nU >> 1][4]);
      hd.mat.emissiveIntensity = 0.04 + a * a * 0.45;
      hd.mat.color.copy(white).multiplyScalar(0.7 + 0.3 * a);
      hd.glow.position.copy(hd.centroid).addScaledVector(oh, 0.02);
      const gs = 0.14 + 0.2 * a;
      hd.glow.scale.set(gs, gs, 1);
      hd.glow.material.opacity = xray * Math.max(0, a - 0.3) * 0.4;
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

  function update(t) {
    const p = pose(t);
    const act = activation(t);
    const xr = chXray(t);
    state.act = act;
    state.armAngle = p.armAngle;
    state.xray = xr;

    torso.rotation.x = p.hinge;
    A.inner.value = xr;
    A.skin.value = 1 - 0.74 * xr;
    A.arm.value = 1 - 0.82 * xr;
    A.cap.value = 1 - xr;
    // before the x-ray reveal, the shoulders pulse with the colour of the working head
    capMat.emissiveIntensity = 0.55 * act[1] * act[1];
    for (const m of [skinMat, armMat]) m.color.copy(skinBase).lerp(holo, xr);
    boneMat.visible = xr > 0.01;

    for (const arm of arms) for (const hd of arm.heads) hd.mesh.visible = xr > 0.01;
    torso.updateMatrixWorld(true);

    // anchors (world space) from the +x arm
    const a0 = arms[0];
    updateArm(a0, p, act, xr); // leaves scratch vectors E/Wp for the +x arm
    anchors.front.copy(a0.heads[0].centroid);
    anchors.mid.copy(a0.heads[1].centroid);
    anchors.rear.copy(a0.heads[2].centroid);
    anchors.elbow.copy(E);
    anchors.wrist.copy(Hc);
    anchors.back.set(0, 0.36, -0.1);
    anchors.belly.set(0, 0.14, 0.09);
    for (const k in anchors) torso.localToWorld(anchors[k]);
    updateArm(arms[1], p, act, xr);

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
