// The whole figure - skin, skeleton, muscles and dumbbells - is one family of
// signed-distance fields, ray-marched per pixel and shaded with the same
// stepped light ramp. Nothing is assembled from separate meshes, so every
// layer has the same smooth, seamless surface.
//
// Layers:
//   skin    rounded cones + ellipsoids melted together (visible below the scan plane)
//   bones   skeleton in anatomical proportion (visible above the scan plane)
//   muscles spindle-shaped bellies running from origin to insertion
//   deltoid three coloured heads per shoulder, driven by the activation data
import * as THREE from 'three';

const HIP_Y = 0.95;

// ---------------------------------------------------------------- skin: trunk + head (torso frame)
// [cx, cy, cz, blend,  rx, ry, rz]
const SKIN_ELL = [
  [0, -0.03, -0.012, 0.04, 0.15, 0.1, 0.09], // pelvis
  [0, 0.13, -0.006, 0.05, 0.116, 0.13, 0.07], // narrow waist
  [0, 0.33, 0.002, 0.05, 0.15, 0.16, 0.105], // rib cage
  [0, 0.475, -0.006, 0.04, 0.178, 0.07, 0.095], // shoulder girdle
  ...[1].flatMap((s) => [
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
// static leg cones in world space: [ax, ay, az, r1, bx, by, bz, r2]
const legSkin = (s) => [
  [s * 0.092, 0.87, 0, 0.09, s * 0.098, 0.5, 0.012, 0.052],
  [s * 0.108, 0.79, 0.022, 0.062, s * 0.104, 0.6, 0.026, 0.05],
  [s * 0.094, 0.79, -0.036, 0.056, s * 0.096, 0.6, -0.03, 0.045],
  [s * 0.098, 0.5, 0.012, 0.05, s * 0.098, 0.1, 0, 0.034],
  [s * 0.1, 0.43, -0.028, 0.05, s * 0.1, 0.3, -0.022, 0.04],
];

const N_SE = SKIN_ELL.length;
const N_SC = 7 + 5; // one arm (torso space) + one leg (world space); the other side is mirrored
const N_AB = 6; // arm bones per arm
const N_AM = 5; // arm muscles per arm
const N_TM = 5; // pec (3) + lat (2) fibres per side
const N_AD = 6; // deltoid origin slips (2 per head)

const COMMON = `
#define N_SE ${N_SE}
#define N_SC ${N_SC}
#define N_AB ${N_AB}
#define N_AM ${N_AM}
#define N_TM ${N_TM}
#define N_AD ${N_AD}
#define HIP ${HIP_Y.toFixed(3)}
uniform vec4 uSE[N_SE * 2];
uniform vec4 uSC[N_SC * 2];
uniform vec4 uAB[N_AB * 2];
uniform vec4 uAM[N_AM * 2];
uniform vec4 uTM[N_TM * 2];
uniform vec4 uAD[N_AD * 2];
uniform vec4 uDC[3];      // deltoid belly: shoulder, mid, insertion (xyz, radius)
uniform vec3 uDJ, uDlat, uDfb; // shoulder joint, outward and forward directions of the upper arm
uniform vec4 uBell[6];
uniform vec4 uArm[2];    // capsule round the +x arm (torso space)
uniform vec3 uHeadCol[3];
uniform float uAct[3];
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform mat3 uViewRot;
uniform vec3 uCam;
uniform float uHinge;
uniform float uScanY;
uniform float uSkinOn;
uniform float uMusOn;
uniform float uBlush;
uniform vec3 cSkin, cShorts, cBand, cShoe, cSole, cHair, cMus, cDeep, cBlush, cBone, cSocket, cPlate, cMetal, uAmb;
varying vec2 vUv;

float dot2(vec3 v) { return dot(v, v); }
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
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
float cone(vec3 p, vec3 a, float r1, vec3 b, float r2) { return sdCone(p, vec4(a, r1), vec4(b, r2)); }
// muscle belly: thickest in the middle (A.w), tapering to tendons (B.w) at both ends
float sdSpindle(vec3 p, vec4 A, vec4 B) {
  vec3 pa = p - A.xyz;
  vec3 ba = B.xyz - A.xyz;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(B.w, A.w, 4.0 * h * (1.0 - h));
}
float spindle(vec3 p, vec3 a, vec3 b, float r) { return sdSpindle(p, vec4(a, r), vec4(b, r * 0.28)); }
// thin bony plate
float sdBox(vec3 p, vec3 c, vec3 h) {
  vec3 e = abs(p - c) - h;
  return length(max(e, 0.0)) + min(max(e.x, max(e.y, e.z)), 0.0);
}
float armBound(vec3 m) { return sdCone(m, uArm[0], uArm[1]); }
float legBound(vec3 ml) { return cone(ml, vec3(0.1, 0.93, 0.0), 0.17, vec3(0.1, 0.05, 0.02), 0.17); }
float plate(vec3 p, vec3 a, vec3 b, vec3 c, float th) {
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 ac = a - c; vec3 pc = p - c;
  vec3 nor = cross(ba, ac);
  float d2 = (sign(dot(cross(ba, nor), pa)) + sign(dot(cross(cb, nor), pb)) + sign(dot(cross(ac, nor), pc)) < 2.0)
    ? min(min(dot2(ba * clamp(dot(ba, pa) / dot2(ba), 0.0, 1.0) - pa),
              dot2(cb * clamp(dot(cb, pb) / dot2(cb), 0.0, 1.0) - pb)),
              dot2(ac * clamp(dot(ac, pc) / dot2(ac), 0.0, 1.0) - pc))
    : dot(nor, pa) * dot(nor, pa) / dot2(nor);
  return sqrt(d2) - th;
}
vec3 toTorso(vec3 p) {
  vec3 d = p - vec3(0.0, HIP, 0.0);
  float c = cos(uHinge); float s = sin(uHinge);
  return vec3(d.x, c * d.y + s * d.z, -s * d.y + c * d.z);
}

// ---------------------------------------------------------------- skin
float skinBody(vec3 p, vec3 q) {
  float d = 1e3;
  vec3 m = vec3(abs(q.x), q.y, q.z);
  float bt = length(q - vec3(0.0, 0.37, 0.0)) - 0.53;
  if (bt > 0.1) d = bt;
  else {
    for (int i = 0; i < N_SE; i++) {
      vec4 a = uSE[2 * i];
      d = smin(d, sdEll(m - a.xyz, uSE[2 * i + 1].xyz), a.w);
    }
    d = smin(d, cone(q, vec3(0.0, 0.52, -0.012), 0.056, vec3(0.0, 0.67, 0.0), 0.05), 0.03); // neck
  }
  float ba = armBound(m);
  if (ba > 0.05) d = min(d, ba);
  else {
    d = smin(d, sdCone(m, uSC[0], uSC[1]), 0.04); // deltoid melts into chest and back
    for (int i = 1; i < 7; i++) d = smin(d, sdCone(m, uSC[2 * i], uSC[2 * i + 1]), 0.022);
  }
  vec3 ml = vec3(abs(p.x), p.y, p.z);
  float bl = legBound(ml);
  if (bl > 0.05) d = min(d, bl);
  else for (int i = 7; i < 12; i++) d = smin(d, sdCone(ml, uSC[2 * i], uSC[2 * i + 1]), 0.03);
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

// ---------------------------------------------------------------- skeleton
// Left/right symmetric parts are evaluated once on the mirrored point m.
const vec3 EYE = vec3(0.031, 0.748, 0.076);
float skull(vec3 m) {
  float d = sdEll(m - vec3(0.0, 0.778, -0.014), vec3(0.073, 0.08, 0.094));        // cranium
  d = smin(d, sdEll(m - vec3(0.0, 0.722, 0.042), vec3(0.05, 0.05, 0.046)), 0.022); // face
  d = smin(d, sdEll(m - vec3(0.03, 0.766, 0.068), vec3(0.03, 0.009, 0.013)), 0.012); // brow ridge
  d = smin(d, sdEll(m - vec3(0.054, 0.73, 0.046), vec3(0.016, 0.011, 0.03)), 0.012); // cheekbone
  d = smax(d, 0.021 - length(m - EYE), 0.008);                                       // eye socket
  d = smax(d, -sdEll(m - vec3(0.0, 0.718, 0.092), vec3(0.011, 0.017, 0.02)), 0.006);  // nasal opening
  d = smax(d, -sdEll(m - vec3(0.07, 0.735, 0.02), vec3(0.012, 0.024, 0.03)), 0.01);   // temple hollow
  // lower jaw: body, angle and ramus
  float j = cone(m, vec3(0.0, 0.662, 0.074), 0.016, vec3(0.045, 0.668, 0.012), 0.011);
  j = smin(j, cone(m, vec3(0.045, 0.668, 0.012), 0.011, vec3(0.054, 0.728, 0.0), 0.009), 0.008);
  j = smin(j, sdEll(m - vec3(0.0, 0.676, 0.066), vec3(0.03, 0.016, 0.02)), 0.008);     // teeth row
  return smin(d, j, 0.006);
}
float spineCol(vec3 q) {
  float d = cone(q, vec3(0.0, -0.03, -0.062), 0.025, vec3(0.0, 0.14, -0.04), 0.023);
  d = min(d, cone(q, vec3(0.0, 0.14, -0.04), 0.022, vec3(0.0, 0.34, -0.074), 0.019));
  d = min(d, cone(q, vec3(0.0, 0.34, -0.074), 0.019, vec3(0.0, 0.535, -0.062), 0.016));
  d = min(d, cone(q, vec3(0.0, 0.535, -0.062), 0.015, vec3(0.0, 0.672, -0.02), 0.013));
  // spinous processes
  float s = cone(q, vec3(0.0, -0.01, -0.09), 0.009, vec3(0.0, 0.14, -0.068), 0.009);
  s = min(s, cone(q, vec3(0.0, 0.14, -0.068), 0.009, vec3(0.0, 0.34, -0.102), 0.008));
  s = min(s, cone(q, vec3(0.0, 0.34, -0.102), 0.008, vec3(0.0, 0.535, -0.086), 0.007));
  s = min(s, cone(q, vec3(0.0, 0.535, -0.086), 0.007, vec3(0.0, 0.65, -0.045), 0.006));
  d = smin(d, s, 0.012);
  return d - 0.0032 * cos(q.y * 232.7); // one bump per vertebra
}
float ribcage(vec3 q) {
  vec3 r = q - vec3(0.0, 0.335, -0.006);
  float f = 1.0 - 0.52 * smoothstep(0.0, 0.2, r.y); // narrows towards the first rib
  vec3 w = vec3(r.x / f, r.y, r.z / mix(1.0, f, 0.6));
  float e = sdEll(w, vec3(0.146, 0.2, 0.106)) * f;
  float shell = abs(e + 0.004) - 0.0062;
  float sl = r.y + 0.42 * r.z; // ribs slope down towards the front
  float band = abs(fract(sl / 0.0315) - 0.5) * 0.0315 - 0.0086;
  float d = smax(shell, band, 0.006);
  // costal arch: open at the front, lower at the sides and back
  float mg = -0.186 + 0.115 * smoothstep(-0.02, 0.09, r.z) * (1.0 - smoothstep(0.025, 0.135, abs(r.x)));
  d = max(d, mg - r.y);
  d = max(d, min(0.02 - abs(r.x), -r.z - 0.03)); // the ribs stop at the spine
  // breastbone
  float st = cone(q, vec3(0.0, 0.502, 0.047), 0.02, vec3(0.0, 0.44, 0.07), 0.016);
  st = smin(st, cone(q, vec3(0.0, 0.44, 0.07), 0.015, vec3(0.0, 0.3, 0.096), 0.012), 0.01);
  st = min(st, cone(q, vec3(0.0, 0.3, 0.096), 0.008, vec3(0.0, 0.265, 0.1), 0.004));
  return smin(d, st, 0.008);
}
float girdle(vec3 m) {
  // collarbone (S-curve), shoulder blade with its spine and acromion
  float d = cone(m, vec3(0.022, 0.506, 0.048), 0.011, vec3(0.1, 0.526, 0.06), 0.009);
  d = smin(d, cone(m, vec3(0.1, 0.526, 0.06), 0.009, vec3(0.188, 0.55, 0.012), 0.009), 0.008);
  float s = plate(m, vec3(0.068, 0.535, -0.086), vec3(0.094, 0.325, -0.103), vec3(0.166, 0.5, -0.03), 0.005);
  s = smin(s, cone(m, vec3(0.072, 0.502, -0.094), 0.007, vec3(0.2, 0.552, -0.02), 0.009), 0.008);
  s = smin(s, sdEll(m - vec3(0.2, 0.554, 0.0), vec3(0.022, 0.008, 0.026)), 0.008);
  s = smin(s, sdEll(m - vec3(0.162, 0.5, -0.02), vec3(0.01, 0.022, 0.016)), 0.008); // socket
  return min(d, s);
}
float pelvis(vec3 m) {
  // hip blade with its crest
  float d = plate(m, vec3(0.126, 0.02, 0.046), vec3(0.134, 0.072, -0.018), vec3(0.086, -0.03, 0.0), 0.008);
  d = smin(d, plate(m, vec3(0.134, 0.072, -0.018), vec3(0.046, 0.034, -0.086), vec3(0.086, -0.03, 0.0), 0.008), 0.01);
  d = smin(d, cone(m, vec3(0.126, 0.02, 0.046), 0.011, vec3(0.136, 0.074, -0.018), 0.011), 0.01);
  d = smin(d, cone(m, vec3(0.136, 0.074, -0.018), 0.011, vec3(0.046, 0.036, -0.086), 0.01), 0.01);
  // sacrum + tailbone
  d = smin(d, cone(m, vec3(0.0, 0.035, -0.076), 0.042, vec3(0.0, -0.06, -0.09), 0.018), 0.012);
  d = smin(d, cone(m, vec3(0.0, -0.06, -0.09), 0.014, vec3(0.0, -0.105, -0.075), 0.006), 0.008);
  // pubic and sit bones forming the lower ring
  d = smin(d, cone(m, vec3(0.084, -0.036, 0.006), 0.024, vec3(0.082, -0.03, 0.0), 0.024), 0.01);
  d = smin(d, cone(m, vec3(0.08, -0.04, 0.012), 0.012, vec3(0.008, -0.104, 0.056), 0.013), 0.01);
  d = smin(d, cone(m, vec3(0.082, -0.05, -0.006), 0.014, vec3(0.06, -0.14, -0.022), 0.016), 0.01);
  d = smin(d, cone(m, vec3(0.06, -0.14, -0.022), 0.011, vec3(0.012, -0.118, 0.05), 0.009), 0.01);
  return d;
}
float legBones(vec3 m) {
  // thigh bone: head, neck, trochanter, shaft, condyles
  float d = length(m - vec3(0.085, 0.925, 0.0)) - 0.024;
  d = smin(d, cone(m, vec3(0.085, 0.925, 0.0), 0.014, vec3(0.128, 0.9, -0.005), 0.016), 0.008);
  d = smin(d, cone(m, vec3(0.134, 0.91, -0.008), 0.018, vec3(0.126, 0.87, -0.004), 0.016), 0.01);
  d = smin(d, cone(m, vec3(0.126, 0.87, -0.004), 0.016, vec3(0.1, 0.54, 0.012), 0.015), 0.01);
  d = smin(d, sdEll(m - vec3(0.098, 0.51, 0.006), vec3(0.04, 0.027, 0.034)), 0.014);
  d = min(d, sdEll(m - vec3(0.098, 0.514, 0.046), vec3(0.02, 0.023, 0.011))); // kneecap
  // shin bone and the slim fibula beside it
  float t = sdEll(m - vec3(0.098, 0.472, 0.006), vec3(0.038, 0.018, 0.03));
  t = smin(t, cone(m, vec3(0.096, 0.465, 0.01), 0.019, vec3(0.097, 0.11, 0.0), 0.013), 0.014);
  t = smin(t, sdEll(m - vec3(0.094, 0.082, 0.0), vec3(0.026, 0.022, 0.024)), 0.012);
  t = min(t, cone(m, vec3(0.128, 0.452, -0.012), 0.009, vec3(0.123, 0.08, -0.006), 0.008));
  // foot: heel, arch, toes
  float f = sdEll(m - vec3(0.098, 0.036, -0.03), vec3(0.023, 0.03, 0.04));
  f = smin(f, cone(m, vec3(0.086, 0.05, 0.0), 0.022, vec3(0.08, 0.018, 0.115), 0.012), 0.014);
  f = smin(f, cone(m, vec3(0.108, 0.046, 0.0), 0.02, vec3(0.116, 0.016, 0.105), 0.011), 0.014);
  f = smin(f, cone(m, vec3(0.08, 0.014, 0.12), 0.011, vec3(0.08, 0.011, 0.168), 0.008), 0.006);
  f = smin(f, cone(m, vec3(0.116, 0.013, 0.11), 0.01, vec3(0.118, 0.01, 0.15), 0.007), 0.006);
  return min(d, min(t, max(f, 0.001 - m.y)));
}
float bones(vec3 p, vec3 q) {
  float d = 1e3;
  vec3 m = vec3(abs(q.x), q.y, q.z);
  float bt = length(q - vec3(0.0, 0.36, 0.0)) - 0.55;
  if (bt > 0.1) d = bt;
  else {
    // each region is skipped (with a safe distance) unless the point is near it
    float b = length(vec2(q.x, q.z + 0.062)) - 0.062;
    d = b > 0.05 ? b : spineCol(q);
    b = length(q - vec3(0.0, 0.745, 0.01)) - 0.125;
    d = min(d, b > 0.05 ? b : skull(m));
    b = sdBox(q, vec3(0.0, 0.36, -0.006), vec3(0.228, 0.215, 0.125));
    d = min(d, b > 0.05 ? b : min(ribcage(q), girdle(m)));
    b = sdBox(q, vec3(0.0, -0.03, -0.016), vec3(0.152, 0.125, 0.09));
    d = min(d, b > 0.05 ? b : pelvis(m));
  }
  float ba = armBound(m);
  if (ba > 0.05) d = min(d, ba);
  else {
    float a = sdCone(m, uAB[0], uAB[1]);
    for (int i = 1; i < N_AB; i++) a = smin(a, sdCone(m, uAB[2 * i], uAB[2 * i + 1]), 0.007);
    d = min(d, a);
  }
  vec3 ml = vec3(abs(p.x), p.y, p.z);
  float bl = legBound(ml);
  d = min(d, bl > 0.05 ? bl : legBones(ml));
  return d;
}

// ---------------------------------------------------------------- muscles
// Each belly runs from its bony origin to its insertion.
float upperMuscles(vec3 m) {
  // deep neck + sternocleidomastoid (mastoid -> breastbone)
  float d = cone(m, vec3(0.0, 0.54, -0.026), 0.047, vec3(0.0, 0.672, -0.012), 0.04);
  d = smin(d, spindle(m, vec3(0.066, 0.7, -0.012), vec3(0.018, 0.52, 0.044), 0.015), 0.006);
  // trapezius: skull base and spine -> outer collarbone, acromion, spine of the shoulder blade
  // (kept just under the skin's neck and shoulder line)
  d = smin(d, spindle(m, vec3(0.02, 0.685, -0.03), vec3(0.06, 0.585, -0.045), 0.015), 0.03);
  d = smin(d, sdEll(m - vec3(0.07, 0.546, -0.032), vec3(0.082, 0.031, 0.046)), 0.02);
  // upper fibres slope from the neck down to the outer collarbone and acromion,
  // meeting the top edge of the deltoid with no gap
  d = smin(d, cone(m, vec3(0.04, 0.59, -0.03), 0.019, vec3(0.186, 0.542, -0.01), 0.019), 0.035);
  d = smin(d, cone(m, vec3(0.06, 0.565, -0.06), 0.018, vec3(0.19, 0.54, -0.04), 0.017), 0.03);
  d = smin(d, sdEll(m - vec3(0.07, 0.48, -0.088), vec3(0.066, 0.058, 0.018)), 0.02);
  d = smin(d, spindle(m, vec3(0.01, 0.23, -0.08), vec3(0.1, 0.5, -0.09), 0.018), 0.02);
  // latissimus sheet on the flank (its fibres to the arm are added per pose)
  d = smin(d, sdEll(m - vec3(0.115, 0.23, -0.058), vec3(0.062, 0.15, 0.03)), 0.02);
  // pectoralis major: collarbone and breastbone -> upper arm bone, one fan-shaped slab
  float a = sdSpindle(m, uTM[0], uTM[1]);
  a = smin(a, sdSpindle(m, uTM[2], uTM[3]), 0.03);
  a = smin(a, sdSpindle(m, uTM[4], uTM[5]), 0.03);
  // latissimus fibres sweeping from the flank to the upper arm bone
  float l = smin(sdCone(m, uTM[6], uTM[7]), sdCone(m, uTM[8], uTM[9]), 0.02);
  return min(a, smin(d, l, 0.016));
}
float lowerMuscles(vec3 q, vec3 m) {
  // abdominal wall and external oblique (ribs -> hip crest)
  float w = sdEll(q - vec3(0.0, 0.11, -0.004), vec3(0.118, 0.17, 0.074));
  w = smin(w, sdEll(m - vec3(0.104, 0.125, 0.0), vec3(0.04, 0.115, 0.07)), 0.012);
  // rectus abdominis: ribs 5-7 -> pubis, a flat strap crossed by tendon lines
  float rc = cone(vec3(m.x, m.y, m.z * 1.8), vec3(0.031, 0.31, 0.088 * 1.8), 0.032, vec3(0.03, -0.03, 0.05 * 1.8), 0.027) / 1.8;
  rc = smax(rc, 0.0042 - abs(m.y - 0.262), 0.007);
  rc = smax(rc, 0.0042 - abs(m.y - 0.205), 0.007);
  rc = smax(rc, 0.0042 - abs(m.y - 0.146), 0.007);
  w = smin(w, rc, 0.006);
  // gluteus medius and maximus: hip blade and sacrum -> thigh bone
  float g = smin(sdEll(m - vec3(0.122, 0.0, -0.022), vec3(0.036, 0.058, 0.048)),
                 sdEll(m - vec3(0.084, -0.08, -0.064), vec3(0.074, 0.084, 0.058)), 0.02);
  return min(w, g);
}
float legMuscles(vec3 m) {
  // quadriceps: pelvis / thigh bone -> kneecap
  float d = spindle(m, vec3(0.094, 0.93, 0.04), vec3(0.098, 0.545, 0.046), 0.043);
  d = smin(d, spindle(m, vec3(0.136, 0.87, 0.004), vec3(0.118, 0.545, 0.032), 0.043), 0.012);
  d = smin(d, spindle(m, vec3(0.07, 0.73, 0.02), vec3(0.078, 0.53, 0.036), 0.037), 0.012);
  // adductors: pubis -> inner thigh bone
  d = smin(d, spindle(m, vec3(0.022, 0.845, 0.02), vec3(0.076, 0.57, 0.0), 0.042), 0.012);
  // hamstrings: sit bone -> either side of the knee
  d = smin(d, spindle(m, vec3(0.066, 0.82, -0.026), vec3(0.074, 0.47, -0.02), 0.04), 0.012);
  d = smin(d, spindle(m, vec3(0.098, 0.82, -0.034), vec3(0.126, 0.468, -0.018), 0.038), 0.012);
  // calf: two heads from the thigh bone, merging into the Achilles tendon on the heel
  float c = spindle(m, vec3(0.08, 0.525, -0.018), vec3(0.09, 0.25, -0.03), 0.037);
  c = smin(c, spindle(m, vec3(0.116, 0.525, -0.02), vec3(0.108, 0.27, -0.03), 0.033), 0.01);
  c = smin(c, cone(m, vec3(0.098, 0.31, -0.026), 0.028, vec3(0.098, 0.062, -0.05), 0.009), 0.016);
  // tibialis anterior on the outer front of the shin
  c = min(c, spindle(m, vec3(0.118, 0.455, 0.016), vec3(0.104, 0.14, 0.014), 0.023));
  return min(d, c);
}
float muscles(vec3 p, vec3 q) {
  float d = 1e3;
  vec3 m = vec3(abs(q.x), q.y, q.z);
  float bt = length(q - vec3(0.0, 0.33, 0.0)) - 0.52;
  if (bt > 0.1) d = bt;
  else {
    float b = sdBox(q, vec3(0.0, 0.42, -0.02), vec3(0.24, 0.32, 0.14));
    d = b > 0.05 ? b : upperMuscles(m);
    b = sdBox(q, vec3(0.0, 0.07, -0.01), vec3(0.165, 0.27, 0.125));
    d = min(d, b > 0.05 ? b : lowerMuscles(q, m));
  }
  float ba = armBound(m);
  if (ba > 0.05) d = min(d, ba);
  else {
    float a = sdSpindle(m, uAM[0], uAM[1]);
    for (int i = 1; i < N_AM; i++) a = smin(a, sdSpindle(m, uAM[2 * i], uAM[2 * i + 1]), 0.008);
    d = min(d, a);
  }
  vec3 ml = vec3(abs(p.x), p.y, p.z);
  float bl = legBound(ml);
  d = min(d, bl > 0.05 ? bl : legMuscles(ml));
  return d;
}
// Deltoid: one muscle shaped like an inverted triangle. It is widest where it
// arises from the collarbone, acromion and spine of the shoulder blade, wraps the
// front, outer side and back of the shoulder, and narrows to a point on the outer
// side of the upper arm bone. The armpit side is left open.
// hd returns the head at this point: 0 front, 1 middle, 2 rear.
float deltoid(vec3 q, out int hd) {
  vec3 m = vec3(abs(q.x), q.y, q.z);
  hd = 1;
  float ba = armBound(m);
  if (ba > 0.05) return ba;
  vec3 v = m - uDJ;
  float lat = dot(v, uDlat);
  float ph = atan(dot(v, uDfb), lat); // angle round the upper arm, 0 = outer side
  float wf = smoothstep(0.3, 1.0, ph);
  float wr = 1.0 - smoothstep(-1.0, -0.3, ph);
  // the head that is working swells slightly
  float swell = 0.005 * (wf * uAct[0] + (1.0 - wf - wr) * uAct[1] + wr * uAct[2]);
  float belly = smin(sdCone(m, uDC[0], uDC[1]), sdCone(m, uDC[1], uDC[2]), 0.02) - swell;
  belly = smax(belly, -(lat + 0.024), 0.03);
  float d = belly;
  for (int i = 0; i < N_AD; i++) d = smin(d, sdCone(m, uAD[2 * i], uAD[2 * i + 1]), 0.04);
  hd = ph > 0.66 ? 0 : (ph < -0.66 ? 2 : 1);
  return d;
}
float bells(vec3 q) {
  vec3 m = vec3(abs(q.x), q.y, q.z);
  float ba = armBound(m);
  if (ba > 0.05) return ba;
  return min(sdCone(m, uBell[0], uBell[1]), min(sdCone(m, uBell[2], uBell[3]), sdCone(m, uBell[4], uBell[5])));
}

float skinAll(vec3 p, vec3 q) { return min(min(skinBody(p, q), shorts(p)), min(shoes(p), hair(q))); }
float innerAll(vec3 p, vec3 q) {
  int a;
  return min(min(bones(p, q), muscles(p, q)), deltoid(q, a));
}
float map(vec3 p) {
  vec3 q = toTorso(p);
  float d = bells(q);
  if (uSkinOn > 0.5) d = min(d, max(skinAll(p, q), p.y - uScanY)); // skin survives below the scan plane
  if (uMusOn > 0.5) d = min(d, max(innerAll(p, q), uScanY - p.y));
  return d;
}
vec3 normalAt(vec3 p) {
  const vec2 e = vec2(0.0012, -0.0012);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
// stepped light ramp shared by every material
float ramp(float ndl) {
  float t = clamp(ndl * 0.5 + 0.5, 0.0, 0.999) * 8.0;
  int i = int(t);
  float v = i < 2 ? 100.0 : i == 2 ? 108.0 : i == 3 ? 125.0 : i == 4 ? 155.0 : i == 5 ? 195.0 : i == 6 ? 230.0 : 255.0;
  return v / 255.0;
}

// camera ray for this pixel and where it crosses the figure's bounding box
void ray(out vec3 ro, out vec3 rd, out float tn, out float tf) {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 pf = uInvVP * vec4(ndc, 1.0, 1.0);
  rd = normalize(pf.xyz / pf.w - uCam);
  ro = uCam;
  vec3 t0 = (vec3(-1.05, -0.02, -0.8) - ro) / rd;
  vec3 t1 = (vec3(1.05, 2.1, 1.0) - ro) / rd;
  vec3 tsm = min(t0, t1);
  vec3 tbg = max(t0, t1);
  tn = max(max(tsm.x, tsm.y), max(tsm.z, 0.0));
  tf = min(tbg.x, min(tbg.y, tbg.z));
}
`;

// Pass 1: find the surface. Writes the hit distance, and a depth value that marks
// which pixels hit, so that pass 2 is only run for those pixels.
const MARCH = `${COMMON}
void main() {
  vec3 ro; vec3 rd; float tn; float tf;
  ray(ro, rd, tn, tf);
  float t = tn;
  bool hit = false;
  bool live = tn < tf;
  for (int i = 0; i < 96 && live; i++) {
    float d = map(ro + rd * t);
    if (d < 0.0004 * t) { hit = true; live = false; }
    else { t += d * 0.85; live = t <= tf; }
  }
  gl_FragColor = vec4(t, 0.0, 0.0, 1.0);
  gl_FragDepth = hit ? 0.25 : 1.0;
}`;

// Pass 2: material, normal and lighting for the pixels that hit.
const SHADE = `${COMMON}
uniform sampler2D tT;
layout(location = 1) out highp vec4 gAux;
void main() {
  vec3 ro; vec3 rd; float tn; float tf;
  ray(ro, rd, tn, tf);
  float t = texture2D(tT, vUv).r;
  // settle exactly onto the surface so materials and normals are clean
  t += map(ro + rd * t);
  t += map(ro + rd * t);
  vec3 p = ro + rd * t;
  vec3 q = toTorso(p);
  vec3 m = vec3(abs(q.x), q.y, q.z);
  vec3 n = normalAt(p);
  vec3 base;
  vec4 aux;
  float gloss = 0.16;

  float dBell = bells(q);
  float dSkinAll = uSkinOn > 0.5 ? max(skinAll(p, q), p.y - uScanY) : 1e3;
  int hd = 0;
  float dD = 1e3; float dBn = 1e3; float dMs = 1e3;
  if (uMusOn > 0.5) { dD = deltoid(q, hd); dBn = bones(p, q); dMs = muscles(p, q); }
  float dInAll = uMusOn > 0.5 ? max(min(dD, min(dBn, dMs)), uScanY - p.y) : 1e3;

  if (dBell <= min(dSkinAll, dInAll)) {
    // dumbbell: red plates on a steel bar
    float bar = sdCone(m, uBell[0], uBell[1]);
    base = bar < dBell + 0.0005 ? cMetal : cPlate;
    aux = vec4(0.9, 0.25, 0.3, 210.0 / 255.0);
    gloss = 0.3;
  } else if (dSkinAll <= dInAll) {
    float dB = skinBody(p, q);
    float dS = shorts(p);
    float dH = shoes(p);
    float dR = hair(q);
    float dSkin = min(min(dB, dS), min(dH, dR));
    gloss = 0.0;
    if (dR <= dSkin + 1e-4) { base = cHair; aux = vec4(0.2, 0.2, 0.42, 203.0 / 255.0); }
    else if (dH <= dSkin + 1e-4) { base = p.y < 0.024 ? cSole : cShoe; aux = vec4(0.9, 0.9, 0.95, 202.0 / 255.0); }
    else if (dS <= dSkin + 1e-4) { base = p.y > 0.957 ? cBand : cShorts; aux = vec4(0.8, 0.2, 0.3, 201.0 / 255.0); }
    else {
      base = cSkin;
      gloss = 0.16;
      aux = vec4(0.5, 0.5, 0.5, 200.0 / 255.0);
      // working deltoid shows through as a soft blush before the x-ray
      if (sdCone(m, uSC[0], uSC[1]) < 0.012) base = mix(base, cBlush, uBlush);
      // face, painted on
      if (q.z > 0.04 && q.y > 0.64) {
        float ex = abs(abs(q.x) - 0.031);
        if (ex < 0.011 && abs(q.y - 0.752) < 0.0055) base = cHair;
        if (abs(abs(q.x) - 0.032) < 0.016 && abs(q.y - 0.773) < 0.004) base = cHair;
      }
    }
  } else {
    // anatomy layer: bone, muscle or one of the deltoid heads
    int ag = q.x > 0.0 ? 0 : 1;
    aux = vec4(0.5, 0.5, 0.5, 0.0);
    if (dD <= min(dBn, dMs)) {
      float a = uAct[hd];
      base = uHeadCol[hd] * (0.8 + 0.2 * a) * (1.0 + 0.45 * a * a);
      aux = vec4(0.25 + 0.25 * float(hd), 0.6, 0.3, float(1 + ag * 3 + hd) / 255.0);
      gloss = 0.22;
    } else if (dBn <= dMs) {
      base = cBone;
      gloss = 0.22;
      // dark hollows of the skull and the tooth line
      if (q.y > 0.62) {
        if (length(m - EYE) < 0.0235 || sdEll(m - vec3(0.0, 0.718, 0.092), vec3(0.012, 0.018, 0.022)) < 0.0) { base = cSocket; gloss = 0.0; }
        else if (q.z > 0.05 && m.x < 0.032 && abs(q.y - 0.676) < 0.011) {
          base = vec3(1.0);
          if (abs(q.y - 0.676) < 0.0016 || fract(m.x / 0.0085) < 0.2) base = cSocket;
        }
      }
    } else {
      base = cMus;
      // the abdominal wall sits a tone deeper than the bellies over it
      if (q.y < 0.32 && q.y > -0.06 && sdEll(q - vec3(0.0, 0.11, -0.004), vec3(0.118, 0.17, 0.074)) < 0.004) base = cDeep;
    }
  }

  vec3 vn = uViewRot * n;
  vec3 L = normalize(vec3(-5.0, 5.0, 6.5));
  float r = ramp(dot(vn, L));
  vec3 col = base * (uAmb + 2.75 * r) / 3.14159265;
  // flat highlight shape, the same on every material
  if (gloss > 0.0 && dot(vn, normalize(L + vec3(0.0, 0.0, 1.0))) > 0.978) col = mix(col, vec3(1.0), gloss);
  // the scan plane's cut through the body glows
  if (uSkinOn > 0.5 && uMusOn > 0.5 && abs(p.y - uScanY) < 0.004 && abs(n.y) > 0.8) col = vec3(0.35, 0.87, 1.0);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_FragColor = vec4(col, clip.z / clip.w * 0.5 + 0.5);
  gAux = aux;
}`;

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// deltoid origins relative to the shoulder joint (for the +x arm): two per head,
// along the collarbone, the acromion and the spine of the shoulder blade
const DELT_ORIGIN = [
  [-0.07, 0.04, 0.05], [-0.022, 0.048, 0.054], // front
  [0.028, 0.056, 0.028], [0.032, 0.055, -0.024], // middle
  [-0.012, 0.05, -0.056], [-0.086, 0.036, -0.078], // rear
];
const DELT_SCAP = [0.12, 0.22, 0.42, 0.42, 0.42, 0.42]; // how far each origin follows the arm overhead

export function createBody(W, H, colors) {
  // both passes share one depth buffer: pass 1 marks the hit pixels in it, pass 2 tests against it
  const hitMask = new THREE.DepthTexture(W, H);
  const rtT = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: hitMask,
  });
  const rt = new THREE.WebGLRenderTarget(W, H, {
    count: 2,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: hitMask,
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
  const ab = new Float32Array(N_AB * 8);
  const am = new Float32Array(N_AM * 8);
  const tm = new Float32Array(N_TM * 8);
  const ad = new Float32Array(N_AD * 8);
  const dc = new Float32Array(12);
  const bell = new Float32Array(24);
  const armCap = new Float32Array(8);
  const col = (hex) => new THREE.Color(hex);
  const U = {
    uSE: { value: flat(SKIN_ELL) },
    uSC: { value: sc },
    uAB: { value: ab },
    uAM: { value: am },
    uTM: { value: tm },
    uAD: { value: ad },
    uDC: { value: dc },
    uDJ: { value: new THREE.Vector3() },
    uDlat: { value: new THREE.Vector3() },
    uDfb: { value: new THREE.Vector3() },
    uBell: { value: bell },
    uArm: { value: armCap },
    uHeadCol: { value: colors.heads.map(col) },
    uAct: { value: [0, 0, 0] },
    uInvVP: { value: new THREE.Matrix4() },
    uVP: { value: new THREE.Matrix4() },
    uViewRot: { value: new THREE.Matrix3() },
    uCam: { value: new THREE.Vector3() },
    uHinge: { value: 0 },
    uScanY: { value: 10 },
    uSkinOn: { value: 1 },
    uMusOn: { value: 0 },
    uBlush: { value: 0 },
    cSkin: { value: col(colors.skin) },
    cShorts: { value: col(colors.shorts) },
    cBand: { value: col(colors.shortsDark) },
    cShoe: { value: col(colors.shoe) },
    cSole: { value: col(colors.sole) },
    cHair: { value: col(colors.hair) },
    cMus: { value: col(colors.muscle) },
    cDeep: { value: col(colors.muscleDeep) },
    cBlush: { value: col(colors.blush) },
    cBone: { value: col(colors.bone) },
    cSocket: { value: col(colors.socket) },
    cPlate: { value: col(colors.plate) },
    cMetal: { value: col(colors.metal) },
    uAmb: { value: col(colors.ambient).multiplyScalar(colors.ambientIntensity) },
  };
  const marchScene = new THREE.Scene();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const plane = new THREE.PlaneGeometry(2, 2);
  marchScene.add(
    new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({ uniforms: U, vertexShader: QUAD_VERT, fragmentShader: MARCH, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true })
    )
  );
  const shadeScene = new THREE.Scene();
  shadeScene.add(
    new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({
        uniforms: { ...U, tT: { value: rtT.texture } },
        vertexShader: QUAD_VERT,
        fragmentShader: SHADE,
        // the quad sits at depth 0.5: it passes only where pass 1 stored 0.25 (a hit)
        depthTest: true,
        depthFunc: THREE.GreaterDepth,
        depthWrite: false,
      })
    )
  );

  // full-screen quads that drop the ray-marched result into the normal passes (with real depth)
  const compose = (tex, rgbOnly) =>
    new THREE.ShaderMaterial({
      uniforms: { tC: { value: rt.textures[0] }, tX: { value: tex } },
      vertexShader: QUAD_VERT,
      fragmentShader: `uniform sampler2D tC; uniform sampler2D tX; varying vec2 vUv;
        void main(){ float z = texture2D(tC, vUv).a; if (z >= 0.99999) discard;
          vec4 c = texture2D(tX, vUv); gl_FragColor = ${rgbOnly ? 'vec4(c.rgb, 1.0)' : 'c'}; gl_FragDepth = z; }`,
    });
  const colorMat = compose(rt.textures[0], true);
  const auxMat = compose(rt.textures[1], false);
  const quad = new THREE.Mesh(plane, colorMat);
  quad.frustumCulled = false;

  // ---- pose -> primitives
  const put = (arr, i, a, r1, b, r2) => arr.set([a.x, a.y, a.z, r1, b.x, b.y, b.z, r2], i * 8);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // point = base + sum(k_i * v_i)
  const pt = (base, ...terms) => {
    const o = base.clone();
    for (let i = 0; i < terms.length; i += 2) o.addScaledVector(terms[i], terms[i + 1]);
    return o;
  };

  legSkin(1).forEach((c, i) => sc.set(c, (7 + i) * 8));

  const qI = new THREE.Quaternion();
  const qS = new THREE.Quaternion();
  // per head of the +x shoulder: points used for labels, glows and sparks (torso space)
  const heads = [0, 1, 2].map(() => ({ a: V(0, 0, 0), b: V(0, 0, 0), ins: V(0, 0, 0), centroid: V(0, 0, 0), r: 0.04 }));

  return {
    quad,
    colorMat,
    auxMat,
    heads,
    // Pose of the +x arm, all vectors in torso space. The other arm is its mirror image.
    setArm(J, E, Wp, Hc, up, fore, fb, nLat, handle, q, act) {
      const s = 1;
      const g = 0;
      armCap.set([J.x, J.y, J.z, 0.17, Hc.x, Hc.y, Hc.z, 0.17]);
      // ---- skin
      put(sc, 0, pt(J, nLat, 0.014, up, 0.005), 0.084, pt(J, up, 0.1, nLat, 0.01), 0.058); // deltoid
      put(sc, 1, pt(J, up, 0.06), 0.05, E, 0.04);
      put(sc, 2, pt(J, up, 0.11, fb, 0.02), 0.04, pt(J, up, 0.245, fb, 0.016), 0.033); // biceps
      put(sc, 3, pt(J, up, 0.09, fb, -0.022), 0.041, pt(J, up, 0.23, fb, -0.018), 0.034); // triceps
      put(sc, 4, E, 0.041, Wp, 0.028);
      put(sc, 5, pt(E, fore, 0.035), 0.046, pt(E, fore, 0.14), 0.037);
      put(sc, 6, pt(Hc, fore, -0.012), 0.036, pt(Hc, fore, 0.02), 0.034); // fist

      // ---- bones (torso space): upper arm bone, forearm pair, hand
      const b = g * N_AB;
      put(ab, b, J, 0.033, pt(J, up, 0.006), 0.032); // head of the humerus in its socket
      put(ab, b + 1, pt(J, up, 0.03), 0.016, pt(E, up, -0.035), 0.013);
      put(ab, b + 2, pt(E, nLat, 0.024, up, -0.006), 0.016, pt(E, nLat, -0.026, up, -0.006), 0.017); // epicondyles
      put(ab, b + 3, pt(E, nLat, 0.014, fore, 0.012), 0.011, pt(Wp, nLat, 0.014), 0.012); // radius
      put(ab, b + 4, pt(E, nLat, -0.012, fb, -0.014), 0.014, pt(Wp, nLat, -0.013), 0.008); // ulna + olecranon
      put(ab, b + 5, pt(Wp, fore, 0.004), 0.021, pt(Hc, fore, 0.026), 0.024); // hand
      // dumbbell
      const d = g * 3;
      put(bell, d, pt(Hc, handle, -0.08), 0.012, pt(Hc, handle, 0.08), 0.012);
      put(bell, d + 1, pt(Hc, handle, 0.066), 0.05, pt(Hc, handle, 0.092), 0.05);
      put(bell, d + 2, pt(Hc, handle, -0.066), 0.05, pt(Hc, handle, -0.092), 0.05);

      // ---- arm muscles: origin -> insertion, belly radius, tendon radius
      const sp = (arr, i, a, bq, r, tendon = 0.28) => put(arr, i, a, r, bq, r * tendon);
      const m = g * N_AM;
      sp(am, m, pt(J, up, 0.015, fb, 0.03), pt(E, fore, 0.055, fb, 0.014), 0.037); // biceps: shoulder blade -> radius
      sp(am, m + 1, pt(J, up, 0.03, fb, -0.03), pt(E, fb, -0.024, up, 0.004), 0.039); // triceps -> olecranon
      sp(am, m + 2, pt(J, up, 0.13, nLat, 0.016), pt(E, fore, 0.04, nLat, 0.004), 0.027); // brachialis
      sp(am, m + 3, pt(E, nLat, 0.03, up, -0.05), pt(E, fore, 0.22, nLat, 0.012), 0.031); // extensors from the outer epicondyle
      sp(am, m + 4, pt(E, nLat, -0.03, up, -0.03), pt(E, fore, 0.22, nLat, -0.01), 0.033); // flexors from the inner epicondyle

      // ---- chest and back fibres converging on the upper arm bone
      const t = g * N_TM;
      const pecIns = pt(J, up, 0.085, fb, 0.016);
      sp(tm, t, V(s * 0.085, 0.518, 0.056), pecIns, 0.036, 0.45);
      sp(tm, t + 1, V(s * 0.028, 0.435, 0.084), pecIns, 0.046, 0.45);
      sp(tm, t + 2, V(s * 0.034, 0.35, 0.092), pecIns, 0.04, 0.45);
      const latIns = pt(J, up, 0.075, fb, -0.004, nLat, -0.014);
      put(tm, t + 3, V(s * 0.148, 0.37, -0.076), 0.032, latIns, 0.014);
      put(tm, t + 4, V(s * 0.166, 0.29, -0.05), 0.034, latIns, 0.014);

      // ---- deltoid
      const theta = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      const k = 1 + 0.1 * Math.min(1, theta / 2); // thickens a little as it shortens
      const top = pt(J, up, 0.012, nLat, 0.012);
      const mid = pt(J, up, 0.078, nLat, 0.016);
      const ins = pt(J, up, 0.152, nLat, 0.017); // deltoid tuberosity, half-way down the bone
      dc.set([top.x, top.y, top.z, 0.062 * k, mid.x, mid.y, mid.z, 0.049 * k, ins.x, ins.y, ins.z, 0.016]);
      U.uDJ.value.copy(J);
      U.uDlat.value.copy(nLat);
      U.uDfb.value.copy(fb);
      // slips from the bony origin of each head down onto the belly
      const onto = [pt(J, up, 0.05, fb, 0.032, nLat, 0.012), pt(J, up, 0.03, nLat, 0.03), pt(J, up, 0.05, fb, -0.032, nLat, 0.012)];
      DELT_ORIGIN.forEach((rel, i) => {
        // the collarbone end barely moves; the acromion and shoulder blade swing up with the arm
        qS.copy(qI).slerp(q, theta > 0.5 ? ((theta - 0.5) * DELT_SCAP[i]) / theta : 0);
        const org = V(rel[0] * s, rel[1], rel[2]).applyQuaternion(qS).add(J);
        put(ad, i, org, 0.017, onto[i >> 1], 0.03);
      });
      // a point on the surface of each head, for labels, glows and sparks
      [[0.5, 0.87], [1, 0], [0.5, -0.87]].forEach(([cl, cf], hi) => {
        const h = heads[hi];
        h.centroid.copy(pt(J, up, 0.07, nLat, cl * 0.052 * k, fb, cf * 0.052 * k));
        h.a.copy(h.centroid);
        h.b.copy(pt(J, up, 0.03, nLat, cl * 0.056 * k, fb, cf * 0.056 * k));
        h.ins.copy(ins);
        h.r = 0.012;
      });
    },
    update(hinge, scanY, skinOn, musOn, blush, act) {
      U.uHinge.value = hinge;
      U.uScanY.value = scanY;
      U.uSkinOn.value = skinOn ? 1 : 0;
      U.uMusOn.value = musOn ? 1 : 0;
      U.uBlush.value = blush;
      for (let i = 0; i < 3; i++) U.uAct.value[i] = act[i];
    },
    // ray-march the figure into its own target before the main passes
    prepass(renderer, camera) {
      U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      U.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      U.uViewRot.value.setFromMatrix4(camera.matrixWorldInverse);
      U.uCam.value.copy(camera.position);
      renderer.setRenderTarget(rtT);
      renderer.render(marchScene, ortho);
      const auto = renderer.autoClear;
      renderer.autoClear = false; // keep the hit mask from pass 1
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      renderer.render(shadeScene, ortho);
      renderer.autoClear = auto;
    },
  };
}
export { HIP_Y };
