// Stage, camera and effects around the ray-marched figure (see body.js).
//
// Passes per frame:
//   0. body   - the figure is ray-marched into its own colour / id / depth target
//   1. colour - stage + figure
//   2. aux    - flat ids + depth for the outline pass
//   3. ink    - a pale rim where the silhouette meets the backdrop and a
//               coloured edge round whichever deltoid head is working
import * as THREE from 'three';
import { pose, activation, cameraAt, chXray, HEADS } from './timeline.js';
import { createBody, HIP_Y } from './body.js';

const COL = {
  skin: 0xe4a67c,
  hair: 0x2a2350,
  shoe: 0xf0f0fa,
  sole: 0x2c2f6e,
  shorts: 0xd0283f,
  shortsDark: 0xa01b33,
  bone: 0xf0e0b4,
  socket: 0x1a1740,
  metal: 0x9a9dc4,
  plate: 0xd0243c,
  floor: 0x090d1f,
  floorIn: 0x0f1530,
  podium: 0x1c2760,
  grid: 0x18224e,
  rim: 0xa8ecff,
  muscle: 0x8587bd,
  muscleDeep: 0x6567a0,
  ink: 0x15133a,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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

const INK_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tAux;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform vec3 uRim;
uniform vec3 uHi[3];
uniform float uHiAmt[3];
varying vec2 vUv;
float lin(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
bool isBg(vec4 a) { return a.r + a.g + a.b + a.a < 0.001; }
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
  float edge = max(e1, e2);
  bool b0 = isBg(a0);
  bool sil = b0 != isBg(a1) || b0 != isBg(a2);
  float h = max(headOf(a0), max(headOf(a1), headOf(a2)));

  if (sil) col = uRim;                         // silhouette against the backdrop
  else if (h >= 0.0 && edge > 0.5) {           // edge of a deltoid head
    int k = int(h + 0.5);
    col = mix(col * 0.55, uHi[k], uHiAmt[k]);
  } else if (edge > 0.5) col = mix(col, uInk, 0.85); // between different objects
  else if (max(abs(d0 - d1), abs(d0 - d2)) > 0.09) col *= 0.62; // one part passing in front of another
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createScene(W, H, bgCanvas, { forceXray = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);

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
  key.position.set(-5, 5, 1.5);
  camera.add(key, key.target);
  key.target.position.set(0, 0, -5);

  // the figure: skin, skeleton, muscles and dumbbells
  const body = createBody(W, H, {
    skin: COL.skin,
    shorts: COL.shorts,
    shortsDark: COL.shortsDark,
    shoe: COL.shoe,
    sole: COL.sole,
    hair: COL.hair,
    muscle: COL.muscle,
    muscleDeep: COL.muscleDeep,
    bone: COL.bone,
    socket: COL.socket,
    plate: COL.plate,
    metal: COL.metal,
    heads: HEADS.map((h) => h.color),
    blush: 0xff8fb0,
    ambient: 0xa0a4e8,
    ambientIntensity: 0.72,
  });
  scene.add(body.quad);

  // ------------------------------------------------ stage
  const FLOOR_Y = -0.05;
  const decor = []; // flat stage dressing: drawn in colour only, never outlined
  const flat = (geo, color, y) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    decor.push(m);
    return m;
  };
  flat(new THREE.CircleGeometry(1.7, 40), COL.floor, FLOOR_Y);
  flat(new THREE.CircleGeometry(0.95, 40), COL.floorIn, FLOOR_Y + 0.001);
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
    const grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COL.grid }));
    scene.add(grid);
    decor.push(grid);
  }
  const grad = new THREE.DataTexture(
    new Uint8Array([100, 100, 108, 125, 155, 195, 230, 255].flatMap((v) => [v, v, v, 255])),
    8, 1, THREE.RGBAFormat
  );
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.5, 0.05, 32),
    new THREE.MeshToonMaterial({ color: COL.podium, gradientMap: grad })
  );
  podium.position.y = FLOOR_Y + 0.025;
  scene.add(podium);
  const podiumAux = new THREE.MeshBasicMaterial({ color: 0x808080 });
  const podiumMain = podium.material;
  flat(new THREE.RingGeometry(0.5, 0.515, 48), 0x3fd9f2, FLOOR_Y + 0.003);
  flat(new THREE.RingGeometry(0.455, 0.465, 48), 0x3fd9f2, FLOOR_Y + 0.0505);
  flat(new THREE.CircleGeometry(0.26, 28).scale(1, 0.78, 1), 0x0c1230, FLOOR_Y + 0.0508);

  // the torso frame: everything above the hips hinges about it
  const torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);
  scene.add(torso);

  // ------------------------------------------------ arm kinematics
  const L1 = 0.3;
  const L2 = 0.27;
  const DOWN = V(0, -1, 0);
  const J = V(0.19, 0.5, 0); // +x shoulder joint; the other arm mirrors it
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
  const glows = [1, -1].map(() =>
    HEADS.map((hd) => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: hd.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
      );
      torso.add(sp);
      decor.push(sp);
      return sp;
    })
  );
  const headCol = HEADS.map((h) => new THREE.Color(h.color));

  const vUp = V(0, 0, 0);
  const vFore = V(0, 0, 0);
  const vHandle = V(0, 0, 0);
  const E = V(0, 0, 0);
  const Wp = V(0, 0, 0);
  const Hc = V(0, 0, 0);
  const nLat = V(0, 0, 0);
  const fb = V(0, 0, 0);
  const q = new THREE.Quaternion();
  function updateArms(p, act, xr) {
    vUp.set(p.up[0], p.up[1], p.up[2]);
    vFore.set(p.fore[0], p.fore[1], p.fore[2]);
    vHandle.set(p.handle[0], p.handle[1], p.handle[2]).normalize();
    E.copy(J).addScaledVector(vUp, L1);
    Wp.copy(E).addScaledVector(vFore, L2);
    Hc.copy(Wp).addScaledVector(vFore, 0.045);
    q.setFromUnitVectors(DOWN, vUp);
    nLat.set(1, 0, 0).applyQuaternion(q);
    fb.set(0, 0, 1).applyQuaternion(q);
    body.setArm(J, E, Wp, Hc, vUp, vFore, fb, nLat, vHandle, q, act);
    body.heads.forEach((h, hi) => {
      const a = act[hi];
      const gs = 0.14 + 0.2 * a;
      [1, -1].forEach((s, g) => {
        const sp = glows[g][hi];
        sp.position.set(h.centroid.x * s, h.centroid.y, h.centroid.z);
        sp.scale.set(gs, gs, 1);
        sp.material.opacity = xr >= 1 ? Math.max(0, a - 0.3) * 0.3 : 0;
      });
    });
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
  decor.push(points);
  let rand = rng(7);
  let pNext = 0;
  const wv = V(0, 0, 0);
  const tmpC = new THREE.Color();
  const white = new THREE.Color(0xffffff);

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
      for (const s of [1, -1]) {
        body.heads.forEach((h, hi) => {
          const a = act[hi];
          if (a < 0.45) return;
          if (rand() > (a - 0.4) * 1.5) return;
          // a point on the surface of the belly, mirrored for the other shoulder
          const k = 0.2 + rand() * 0.5;
          wv.copy(rand() > 0.5 ? h.a : h.b).lerp(h.ins, k);
          wv.add(tmpV.copy(wv).sub(J).normalize().multiplyScalar(h.r * 0.8));
          wv.x *= s;
          torso.localToWorld(wv);
          const i = pNext++ % PN;
          pPos[i * 3] = wv.x;
          pPos[i * 3 + 1] = wv.y;
          pPos[i * 3 + 2] = wv.z;
          pVel[i * 3] = (rand() - 0.5) * 0.28 + s * 0.08;
          pVel[i * 3 + 1] = 0.1 + rand() * 0.28;
          pVel[i * 3 + 2] = (rand() - 0.5) * 0.28;
          pLife[i] = 0.35 + rand() * 0.45;
          pSize[i] = 2 + Math.floor(rand() * 4);
          tmpC.copy(headCol[hi]).lerp(white, rand() * 0.75);
          pCol[i * 3] = tmpC.r;
          pCol[i * 3 + 1] = tmpC.g;
          pCol[i * 3 + 2] = tmpC.b;
        });
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
  }
  const tmpV = V(0, 0, 0);

  // scan bar shown while the x-ray plane sweeps the body
  const scanBar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.012, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9ff0ff, side: THREE.DoubleSide })
  );
  scanBar.visible = false;
  scene.add(scanBar);
  decor.push(scanBar);

  // ------------------------------------------------ ink pass
  const inkU = {
    tColor: { value: colorRT.texture },
    tAux: { value: auxRT.texture },
    tDepth: { value: auxRT.depthTexture },
    uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uInk: { value: new THREE.Color(COL.ink) },
    uRim: { value: new THREE.Color(COL.rim) },
    uHi: { value: HEADS.map((h) => new THREE.Color(h.color).lerp(white, 0.55)) },
    uHiAmt: { value: [0, 0, 0] },
  };
  const inkScene = new THREE.Scene();
  const inkCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  inkScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: inkU,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: INK_FRAG,
        depthTest: false,
      })
    )
  );

  // ------------------------------------------------ per-frame update
  const anchors = {
    front: V(0, 0, 0),
    mid: V(0, 0, 0),
    rear: V(0, 0, 0),
    elbow: V(0, 0, 0),
    wrist: V(0, 0, 0),
    back: V(0, 0, 0),
    belly: V(0, 0, 0),
  };
  const state = { act: [0, 0, 0], armAngle: 0, xray: 0 };

  function update(t) {
    const p = pose(t);
    const act = activation(t);
    // ?xray=0|1 pins the layer for comparing skin and anatomy in the same pose
    const xr = forceXray === null ? chXray(t) : forceXray;
    state.act = act;
    state.armAngle = p.armAngle;
    state.xray = xr;

    torso.rotation.x = p.hinge;
    torso.updateMatrixWorld(true);
    // scan plane sweeps from above the head down to the floor
    const scanY = 1.95 - xr * 2.05;
    scanBar.visible = xr > 0 && xr < 1;
    scanBar.position.y = scanY;
    for (let i = 0; i < 3; i++) inkU.uHiAmt.value[i] = xr >= 1 ? Math.min(1, Math.max(0, (act[i] - 0.3) / 0.3)) : 0;

    body.update(p.hinge, scanY, xr < 1, xr > 0, 0.45 * act[1] * act[1], act);
    updateArms(p, act, xr);
    const h0 = body.heads;
    anchors.front.copy(h0[0].centroid);
    anchors.mid.copy(h0[1].centroid);
    anchors.rear.copy(h0[2].centroid);
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

  const pv = V(0, 0, 0);
  const toHud = (v, hw, hh) => {
    pv.copy(v).project(camera);
    return [Math.round((pv.x * 0.5 + 0.5) * hw), Math.round((1 - (pv.y * 0.5 + 0.5)) * hh)];
  };

  function render() {
    // 0. ray-march the figure, 1. colour
    body.prepass(renderer, camera);
    body.quad.material = body.colorMat;
    renderer.setRenderTarget(colorRT);
    renderer.render(scene, camera);
    // 2. ids + depth (stage dressing left out)
    body.quad.material = body.auxMat;
    podium.material = podiumAux;
    for (const o of decor) {
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
    podium.material = podiumMain;
    for (const o of decor) o.visible = o.userData.wasVisible;
    // 3. outlines to the canvas
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
