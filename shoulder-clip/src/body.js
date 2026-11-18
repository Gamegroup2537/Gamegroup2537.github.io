// The figure's skin and its deep muscles are not built from separate meshes.
// They are one continuous surface: a signed-distance field made of rounded
// cones and ellipsoids melted together with smooth unions, ray-marched per
// pixel. Joints therefore blend seamlessly in every pose and the cel-shading
// bands follow the form without seams.
import * as THREE from 'three';

const HIP_Y = 0.95;
const J0 = [0.19, 0.5, 0];

// ---------------------------------------------------------------- skin: trunk + head (torso frame)
// [cx, cy, cz, blend,  rx, ry, rz]
const SKIN_ELL = [
  [0, -0.03, -0.012, 0.04, 0.15, 0.1, 0.09], // pelvis
  [0, 0.13, -0.006, 0.05, 0.116, 0.13, 0.07], // narrow waist
  [0, 0.33, 0.002, 0.05, 0.15, 0.16, 0.105], // rib cage
  [0, 0.475, -0.006, 0.04, 0.178, 0.07, 0.095], // shoulder girdle
  ...[1, -1].flatMap((s) => [
    [s * 0.078, 0.425, 0.066, 0.02, 0.09, 0.058, 0.05], // pec
    [s * 0.15, 0.33, -0.03, 0.04, 0.048, 0.14, 0.085], // lat -> V taper
    [s * 0.07, 0.548, -0.03, 0.035, 0.09, 0.042, 0.056], // trap
    [s * 0.09, 0.44, -0.07, 0.03, 0.075, 0.1, 0.045], // upper back
    [s * 0.108, 0.12, 0.008, 0.03, 0.036, 0.085, 0.066], // oblique
    [s * 0.032, 0.302, 0.092, 0.012, 0.03, 0.026, 0.02], // abs
    [s * 0.032, 0.246, 0.08, 0.012, 0.03, 0.026, 0.02],
    [s * 0.032, 0.19, 0.06, 0.012, 0.03, 0.026, 0.02],
    [s * 0.086, 0.745, -0.004, 0.008, 0.013, 0.026, 0.018], // ear
    [s * 0.075, -0.07, -0.07, 0.04, 0.08, 0.085, 0.065], // glute
  ]),
  [0, 0.762, 0.0, 0.02, 0.086, 0.1, 0.097], // cranium
  [0, 0.71, 0.022, 0.03, 0.064, 0.075, 0.068], // face
  [0, 0.662, 0.045, 0.025, 0.036, 0.03, 0.036], // chin
  [0, 0.728, 0.09, 0.01, 0.012, 0.024, 0.018], // nose
];
// ---------------------------------------------------------------- deep muscles (torso frame)
const MUS_ELL = [
  [0, 0.105, 0.0, 0.04, 0.13, 0.168, 0.092], // abdominal wall
  ...[1, -1].flatMap((s) => [
    [s * 0.075, -0.09, -0.06, 0.03, 0.085, 0.085, 0.068], // glute
    [s * 0.106, 0.12, 0.0, 0.03, 0.04, 0.1, 0.075], // oblique
  ]),
];
// static leg cones in world space: [ax, ay, az, r1, bx, by, bz, r2]
const legSkin = (s) => [
  [s * 0.092, 0.87, 0, 0.09, s * 0.098, 0.5, 0.012, 0.052],
  [s * 0.108, 0.79, 0.022, 0.062, s * 0.104, 0.6, 0.026, 0.05],
  [s * 0.094, 0.79, -0.036, 0.056, s * 0.096, 0.6, -0.03, 0.045],
  [s * 0.098, 0.5, 0.012, 0.05, s * 0.098, 0.1, 0, 0.034],
  [s * 0.1, 0.43, -0.028, 0.05, s * 0.1, 0.3, -0.022, 0.04],
];
const legMus = (s) => [
  [s * 0.1, 0.86, 0.02, 0.07, s * 0.098, 0.56, 0.022, 0.045],
  [s * 0.12, 0.78, 0, 0.045, s * 0.112, 0.6, 0.01, 0.035],
  [s * 0.094, 0.84, -0.035, 0.06, s * 0.096, 0.57, -0.025, 0.04],
  [s * 0.1, 0.44, -0.028, 0.05, s * 0.099, 0.2, -0.012, 0.02],
  [s * 0.108, 0.44, 0.012, 0.022, s * 0.104, 0.2, 0.008, 0.012],
];

const N_SE = SKIN_ELL.length;
const N_SC = 1 + 14 + 10; // neck, 2 arms x 7, 2 legs x 5
const N_ME = MUS_ELL.length;
const N_MC = 3 + 8 + 10; // neck + 2 scm, 2 arms x 4, 2 legs x 5

const FRAG = `
#define N_SE ${N_SE}
#define N_SC ${N_SC}
#define N_ME ${N_ME}
#define N_MC ${N_MC}
#define HIP ${HIP_Y.toFixed(3)}
uniform vec4 uSE[N_SE * 2];
uniform vec4 uSC[N_SC * 2];
uniform vec4 uME[N_ME * 2];
uniform vec4 uMC[N_MC * 2];
uniform vec4 uGrp[4];
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform mat3 uViewRot;
uniform vec3 uCam;
uniform float uHinge;
uniform float uScanY;
uniform float uSkinOn;
uniform float uMusOn;
uniform float uBlush;
uniform vec3 cSkin, cShorts, cBand, cShoe, cSole, cHair, cMus, cDeep, cBlush, uAmb;
varying vec2 vUv;
layout(location = 1) out highp vec4 gAux;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 < 1e-4 ? -min(r.x, min(r.y, r.z)) : k0 * (k0 - 1.0) / k1;
}
float sdCone(vec3 p, vec4 A, vec4 B) {
  vec3 a = A.xyz; vec3 b = B.xyz; float r1 = A.w; float r2 = B.w;
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
vec3 toTorso(vec3 p) {
  vec3 d = p - vec3(0.0, HIP, 0.0);
  float c = cos(uHinge); float s = sin(uHinge);
  return vec3(d.x, c * d.y + s * d.z, -s * d.y + c * d.z);
}

// ---------------------------------------------------------------- skin
float skinBody(vec3 p, vec3 q) {
  float d = 1e3;
  float bt = length(q - vec3(0.0, 0.37, 0.0)) - 0.53;
  if (bt > 0.1) d = bt;
  else {
    for (int i = 0; i < N_SE; i++) {
      vec4 a = uSE[2 * i];
      d = smin(d, sdEll(q - a.xyz, uSE[2 * i + 1].xyz), a.w);
    }
    d = smin(d, sdCone(p, uSC[0], uSC[1]), 0.03);
  }
  for (int g = 0; g < 2; g++) {
    vec4 G = uGrp[g];
    float bd = length(p - G.xyz) - G.w;
    if (bd > 0.1) d = min(d, bd);
    else {
      int o = 1 + g * 7;
      d = smin(d, sdCone(p, uSC[2 * o], uSC[2 * o + 1]), 0.04); // deltoid melts into chest and back
      for (int i = 1; i < 7; i++) d = smin(d, sdCone(p, uSC[2 * (o + i)], uSC[2 * (o + i) + 1]), 0.022);
    }
  }
  for (int g = 0; g < 2; g++) {
    vec4 G = uGrp[2 + g];
    float bd = length(p - G.xyz) - G.w;
    if (bd > 0.1) d = min(d, bd);
    else {
      int o = 15 + g * 5;
      for (int i = 0; i < 5; i++) d = smin(d, sdCone(p, uSC[2 * (o + i)], uSC[2 * (o + i) + 1]), 0.03);
    }
  }
  return d;
}
float shorts(vec3 p) {
  float bs = length(p - vec3(0.0, 0.8, 0.0)) - 0.3;
  if (bs > 0.1) return bs;
  float d = sdEll(p - vec3(0.0, 0.905, -0.008), vec3(0.172, 0.13, 0.112));
  d = smin(d, sdCone(p, vec4(0.094, 0.84, 0.0, 0.1), vec4(0.097, 0.6, 0.004, 0.094)), 0.03);
  d = smin(d, sdCone(p, vec4(-0.094, 0.84, 0.0, 0.1), vec4(-0.097, 0.6, 0.004, 0.094)), 0.03);
  return max(max(d, p.y - 0.99), 0.615 - p.y);
}
float shoes(vec3 p) {
  float bs = length(vec3(abs(p.x) - 0.098, p.y - 0.07, p.z - 0.04)) - 0.16;
  if (bs > 0.1) return bs;
  vec3 m = vec3(abs(p.x), p.y, p.z);
  float d = sdCone(m, vec4(0.098, 0.045, -0.035, 0.048), vec4(0.098, 0.04, 0.125, 0.042));
  d = smin(d, sdCone(m, vec4(0.098, 0.05, 0.0, 0.043), vec4(0.098, 0.14, 0.0, 0.041)), 0.015);
  return max(d, 0.002 - p.y);
}
float hair(vec3 q) {
  float bs = length(q - vec3(0.0, 0.77, 0.0)) - 0.13;
  if (bs > 0.1) return bs;
  float d = sdEll(q - vec3(0.0, 0.77, -0.012), vec3(0.093, 0.106, 0.105));
  return max(d, -dot(q - vec3(0.0, 0.83, 0.07), vec3(0.0, 0.753, -0.658)));
}
// ---------------------------------------------------------------- deep muscles
float muscles(vec3 p, vec3 q) {
  float d = 1e3;
  float bt = length(q - vec3(0.0, 0.3, 0.0)) - 0.46;
  if (bt > 0.1) d = bt;
  else {
    for (int i = 0; i < N_ME; i++) {
      vec4 a = uME[2 * i];
      d = smin(d, sdEll(q - a.xyz, uME[2 * i + 1].xyz), a.w);
    }
    for (int i = 0; i < 3; i++) d = smin(d, sdCone(p, uMC[2 * i], uMC[2 * i + 1]), 0.02);
  }
  for (int g = 0; g < 2; g++) {
    vec4 G = uGrp[g];
    float bd = length(p - G.xyz) - G.w;
    if (bd > 0.1) d = min(d, bd);
    else {
      int o = 3 + g * 4;
      for (int i = 0; i < 4; i++) d = smin(d, sdCone(p, uMC[2 * (o + i)], uMC[2 * (o + i) + 1]), 0.018);
    }
  }
  for (int g = 0; g < 2; g++) {
    vec4 G = uGrp[2 + g];
    float bd = length(p - G.xyz) - G.w;
    if (bd > 0.1) d = min(d, bd);
    else {
      int o = 11 + g * 5;
      for (int i = 0; i < 5; i++) d = smin(d, sdCone(p, uMC[2 * (o + i)], uMC[2 * (o + i) + 1]), 0.02);
    }
  }
  return d;
}

float map(vec3 p) {
  vec3 q = toTorso(p);
  float d = 1e3;
  if (uSkinOn > 0.5) {
    float s = min(min(skinBody(p, q), shorts(p)), min(shoes(p), hair(q)));
    d = max(s, p.y - uScanY); // skin survives below the scan plane
  }
  if (uMusOn > 0.5) d = min(d, max(muscles(p, q), uScanY - p.y));
  return d;
}
vec3 normalAt(vec3 p) {
  const vec2 e = vec2(0.0012, -0.0012);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
// stepped light ramp shared with the mesh materials
float ramp(float ndl) {
  float t = clamp(ndl * 0.5 + 0.5, 0.0, 0.999) * 8.0;
  int i = int(t);
  float v = i < 2 ? 100.0 : i == 2 ? 108.0 : i == 3 ? 125.0 : i == 4 ? 155.0 : i == 5 ? 195.0 : i == 6 ? 230.0 : 255.0;
  return v / 255.0;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 pf = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 rd = normalize(pf.xyz / pf.w - uCam);
  vec3 ro = uCam;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  gAux = vec4(0.0);

  // bounding box of the figure
  vec3 bmin = vec3(-1.05, -0.02, -0.8);
  vec3 bmax = vec3(1.05, 2.1, 1.0);
  vec3 t0 = (bmin - ro) / rd;
  vec3 t1 = (bmax - ro) / rd;
  vec3 tsm = min(t0, t1);
  vec3 tbg = max(t0, t1);
  float tn = max(max(tsm.x, tsm.y), max(tsm.z, 0.0));
  float tf = min(tbg.x, min(tbg.y, tbg.z));
  if (tn >= tf) return;

  float t = tn;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float d = map(ro + rd * t);
    if (d < 0.0004 * t) { hit = true; break; }
    t += d * 0.85;
    if (t > tf) break;
  }
  if (!hit) return;

  // settle exactly onto the surface so materials and normals are clean
  t += map(ro + rd * t);
  t += map(ro + rd * t);
  vec3 p = ro + rd * t;
  vec3 q = toTorso(p);
  vec3 n = normalAt(p);
  vec3 base;
  vec4 aux;
  // which layer did the ray land on: skin (below the scan plane) or muscle (above it)
  float dSkinAll = 1e3;
  float dMusAll = 1e3;
  if (uSkinOn > 0.5) dSkinAll = max(min(min(skinBody(p, q), shorts(p)), min(shoes(p), hair(q))), p.y - uScanY);
  if (uMusOn > 0.5) dMusAll = max(muscles(p, q), uScanY - p.y);
  float dSkin = 1e3;
  if (dSkinAll <= dMusAll) {
    float dB = skinBody(p, q);
    float dS = shorts(p);
    float dH = shoes(p);
    float dR = hair(q);
    dSkin = min(min(dB, dS), min(dH, dR));
    if (dR <= dSkin + 1e-4) { base = cHair; aux = vec4(0.2, 0.2, 0.42, 203.0 / 255.0); }
    else if (dH <= dSkin + 1e-4) { base = p.y < 0.024 ? cSole : cShoe; aux = vec4(0.9, 0.9, 0.95, 202.0 / 255.0); }
    else if (dS <= dSkin + 1e-4) { base = p.y > 0.957 ? cBand : cShorts; aux = vec4(0.8, 0.2, 0.3, 201.0 / 255.0); }
    else {
      base = cSkin;
      aux = vec4(0.5, 0.5, 0.5, 200.0 / 255.0);
      // working deltoid shows through as a soft blush before the x-ray
      float dD = min(sdCone(p, uSC[2], uSC[3]), sdCone(p, uSC[16], uSC[17]));
      if (dD < 0.012) base = mix(base, cBlush, uBlush);
      // face, painted on
      if (q.z > 0.04 && q.y > 0.64) {
        float ex = abs(abs(q.x) - 0.031);
        if (ex < 0.011 && abs(q.y - 0.752) < 0.0055) base = cHair;
        if (abs(abs(q.x) - 0.032) < 0.016 && abs(q.y - 0.773) < 0.004) base = cHair;
      }
    }
  }
  if (dSkinAll > dMusAll) {
    // deep muscle layer
    base = cMus;
    aux = vec4(0.45, 0.47, 0.8, 0.0);
    float dAbd = sdEll(q - uME[0].xyz, uME[1].xyz);
    if (dAbd < 0.012) {
      base = cDeep;
      if (q.z > 0.02 && abs(q.x) < 0.064 && q.y > 0.01 && q.y < 0.265) {
        base = cMus; // rectus abdominis with its grooves
        float gy = min(min(abs(q.y - 0.075), abs(q.y - 0.137)), abs(q.y - 0.2));
        if (abs(q.x) < 0.0035 || gy < 0.0035) base = cDeep * 0.72;
      }
    }
  }

  vec3 vn = uViewRot * n;
  vec3 L = normalize(vec3(-5.0, 5.0, 6.5));
  float r = ramp(dot(vn, L));
  vec3 col = base * (uAmb + 2.75 * r) / 3.14159265;
  // flat highlight shape, like the reference's polished surfaces
  if (aux.a > 0.78 && aux.a < 0.786 && dot(vn, normalize(L + vec3(0.0, 0.0, 1.0))) > 0.978) col = mix(col, vec3(1.0), 0.16);
  // the scan plane's cut through the body glows
  if (uSkinOn > 0.5 && uMusOn > 0.5 && abs(p.y - uScanY) < 0.004 && abs(n.y) > 0.8) col = vec3(0.35, 0.87, 1.0);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_FragColor = vec4(col, clip.z / clip.w * 0.5 + 0.5);
  gAux = aux;
}`;

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createBody(W, H, colors) {
  const rt = new THREE.WebGLRenderTarget(W, H, {
    count: 2,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });

  const flat = (list) => {
    const out = new Float32Array(list.length * 8);
    list.forEach((e, i) => {
      out.set([e[0], e[1], e[2], e[3]], i * 8);
      out.set([e[4], e[5], e[6], 0], i * 8 + 4);
    });
    return out;
  };
  const sc = new Float32Array(N_SC * 8);
  const mc = new Float32Array(N_MC * 8);
  const grp = new Float32Array(16);
  const lin = (hex) => new THREE.Color(hex);
  const U = {
    uSE: { value: flat(SKIN_ELL) },
    uSC: { value: sc },
    uME: { value: flat(MUS_ELL) },
    uMC: { value: mc },
    uGrp: { value: grp },
    uInvVP: { value: new THREE.Matrix4() },
    uVP: { value: new THREE.Matrix4() },
    uViewRot: { value: new THREE.Matrix3() },
    uCam: { value: new THREE.Vector3() },
    uHinge: { value: 0 },
    uScanY: { value: 10 },
    uSkinOn: { value: 1 },
    uMusOn: { value: 0 },
    uBlush: { value: 0 },
    cSkin: { value: lin(colors.skin) },
    cShorts: { value: lin(colors.shorts) },
    cBand: { value: lin(colors.shortsDark) },
    cShoe: { value: lin(colors.shoe) },
    cSole: { value: lin(colors.sole) },
    cHair: { value: lin(colors.hair) },
    cMus: { value: lin(colors.muscle) },
    cDeep: { value: lin(colors.muscleDeep) },
    cBlush: { value: lin(colors.blush) },
    uAmb: { value: lin(colors.ambient).multiplyScalar(colors.ambientIntensity) },
  };
  const marchScene = new THREE.Scene();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const plane = new THREE.PlaneGeometry(2, 2);
  marchScene.add(new THREE.Mesh(plane, new THREE.ShaderMaterial({ uniforms: U, vertexShader: QUAD_VERT, fragmentShader: FRAG, depthTest: false })));

  // full-screen quads that drop the ray-marched result into the normal passes (with real depth)
  const compose = (tex) =>
    new THREE.ShaderMaterial({
      uniforms: { tC: { value: rt.textures[0] }, tX: { value: tex } },
      vertexShader: QUAD_VERT,
      fragmentShader: `uniform sampler2D tC; uniform sampler2D tX; varying vec2 vUv;
        void main(){ float z = texture2D(tC, vUv).a; if (z >= 0.99999) discard;
          vec4 c = texture2D(tX, vUv); gl_FragColor = c; gl_FragDepth = z; }`,
    });
  const colorMat = compose(rt.textures[0]);
  colorMat.fragmentShader = colorMat.fragmentShader.replace('gl_FragColor = c;', 'gl_FragColor = vec4(c.rgb, 1.0);');
  const auxMat = compose(rt.textures[1]);
  const quad = new THREE.Mesh(plane, colorMat);
  quad.frustumCulled = false;

  // ---- pose -> primitives
  const put = (arr, i, a, r1, b, r2) => {
    arr.set([a.x, a.y, a.z, r1, b.x, b.y, b.z, r2], i * 8);
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const pt = (m, base, v1, k1, v2, k2, v3, k3) => {
    const o = m.o.copy(base);
    if (v1) o.addScaledVector(v1, k1);
    if (v2) o.addScaledVector(v2, k2);
    if (v3) o.addScaledVector(v3, k3);
    return o.applyMatrix4(m.mat);
  };
  const ctx = { o: a, mat: null };
  const ctx2 = { o: b, mat: null };

  [1, -1].forEach((s, g) => {
    legSkin(s).forEach((c, i) => sc.set(c, (15 + g * 5 + i) * 8));
    legMus(s).forEach((c, i) => mc.set(c, (11 + g * 5 + i) * 8));
    grp.set([s * 0.1, 0.48, 0, 0.52], (2 + g) * 4);
  });

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const neckA = V(0, 0.52, -0.012);
  const neckB = V(0, 0.67, 0.0);
  const mNeckA = V(0, 0.54, -0.03);
  const mNeckB = V(0, 0.655, -0.016);

  return {
    quad,
    colorMat,
    auxMat,
    // torso-space points for one arm (g = 0 for +x, 1 for -x)
    setArm(g, mat, J, E, Wp, Hc, up, fore, fb, nLat) {
      ctx.mat = mat;
      ctx2.mat = mat;
      const o = 1 + g * 7;
      put(sc, o, pt(ctx, J, nLat, 0.014, up, 0.005), 0.084, pt(ctx2, J, up, 0.1, nLat, 0.01), 0.058); // deltoid
      put(sc, o + 1, pt(ctx, J, up, 0.06), 0.05, pt(ctx2, E), 0.04);
      put(sc, o + 2, pt(ctx, J, up, 0.11, fb, 0.02), 0.04, pt(ctx2, J, up, 0.245, fb, 0.016), 0.033); // biceps
      put(sc, o + 3, pt(ctx, J, up, 0.09, fb, -0.022), 0.041, pt(ctx2, J, up, 0.23, fb, -0.018), 0.034); // triceps
      put(sc, o + 4, pt(ctx, E), 0.041, pt(ctx2, Wp), 0.028);
      put(sc, o + 5, pt(ctx, E, fore, 0.035), 0.046, pt(ctx2, E, fore, 0.14), 0.037);
      put(sc, o + 6, pt(ctx, Hc, fore, -0.012), 0.036, pt(ctx2, Hc, fore, 0.02), 0.034); // fist
      const m = 3 + g * 4;
      put(mc, m, pt(ctx, J, up, 0.07, fb, 0.024), 0.034, pt(ctx2, J, up, 0.26, fb, 0.02), 0.03);
      put(mc, m + 1, pt(ctx, J, up, 0.05, fb, -0.026), 0.036, pt(ctx2, J, up, 0.27, fb, -0.018), 0.028);
      put(mc, m + 2, pt(ctx, J, up, 0.1), 0.03, pt(ctx2, J, up, 0.26), 0.028);
      put(mc, m + 3, pt(ctx, E, fore, 0.02), 0.04, pt(ctx2, E, fore, 0.2), 0.022);
      // bounding sphere of the arm for culling
      const c = pt(ctx, E);
      grp.set([c.x, c.y, c.z, 0.46], g * 4);
    },
    update(torsoMatrix, hinge, scanY, skinOn, musOn, blush) {
      ctx.mat = torsoMatrix;
      ctx2.mat = torsoMatrix;
      put(sc, 0, pt(ctx, neckA), 0.056, pt(ctx2, neckB), 0.05);
      put(mc, 0, pt(ctx, mNeckA), 0.05, pt(ctx2, mNeckB), 0.042);
      [1, -1].forEach((s, i) => {
        put(mc, 1 + i, pt(ctx, V(s * 0.022, 0.52, 0.03)), 0.012, pt(ctx2, V(s * 0.058, 0.67, -0.018)), 0.013);
      });
      U.uHinge.value = hinge;
      U.uScanY.value = scanY;
      U.uSkinOn.value = skinOn ? 1 : 0;
      U.uMusOn.value = musOn ? 1 : 0;
      U.uBlush.value = blush;
    },
    // ray-march the figure into its own target before the main passes
    prepass(renderer, camera) {
      U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      U.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      U.uViewRot.value.setFromMatrix4(camera.matrixWorldInverse);
      U.uCam.value.copy(camera.position);
      renderer.setRenderTarget(rt);
      renderer.render(marchScene, ortho);
    },
  };
}
export { HIP_Y, J0 };
