// Soundtrack synthesised from code: chiptune loop + sound effects that follow
// the same timeline as the picture. Output: 44.1 kHz stereo WAV, exactly one loop.
import fs from 'node:fs';
import { DURATION, BPM, EVENTS, activation, pose } from '../src/timeline.js';

const SR = 44100;
const N = SR * DURATION;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const bus = () => [new Float32Array(N), new Float32Array(N)];
const music = bus(); // goes through the "slow motion" low-pass
const sfx = bus(); // always crisp

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(b, i, v, pan = 0) {
  i = ((i % N) + N) % N; // tails wrap around so the loop is seamless
  b[0][i] += v * (pan > 0 ? 1 - pan : 1);
  b[1][i] += v * (pan < 0 ? 1 + pan : 1);
}
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

// One synth note. type: pulse | saw | tri | sine
function note(b, o) {
  const { type = 'pulse', f, t, dur, vol = 0.1, pan = 0, a = 0.004, r = 0.04, duty = 0.5, decay = 0, vib = 0, f1 = 0 } = o;
  const len = Math.floor((dur + r) * SR);
  const i0 = Math.floor(t * SR);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const tt = n / SR;
    let fr = f1 ? f * Math.pow(f1 / f, Math.min(1, tt / dur)) : f;
    if (vib) fr *= 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.15);
    const dt = fr / SR;
    ph += dt;
    ph -= Math.floor(ph);
    let v;
    if (type === 'pulse') v = (ph < duty ? 1 : -1) + blep(ph, dt) - blep((ph - duty + 1) % 1, dt);
    else if (type === 'saw') v = 2 * ph - 1 - blep(ph, dt);
    else if (type === 'tri') v = 4 * Math.abs(ph - 0.5) - 1;
    else v = Math.sin(2 * Math.PI * ph);
    let env = Math.min(1, tt / a) * (tt > dur ? Math.max(0, 1 - (tt - dur) / r) : 1);
    if (decay) env *= Math.exp(-tt / decay);
    add(b, i0 + n, v * env * vol, pan);
  }
}
function kick(t, vol = 0.5) {
  let ph = 0;
  const i0 = Math.floor(t * SR);
  for (let n = 0; n < SR * 0.3; n++) {
    const tt = n / SR;
    ph += (46 + 120 * Math.exp(-tt / 0.028)) / SR;
    add(music, i0 + n, Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.11) * vol);
  }
}
function snare(t, vol = 0.24) {
  const i0 = Math.floor(t * SR);
  let prev = 0;
  let ph = 0;
  for (let n = 0; n < SR * 0.22; n++) {
    const tt = n / SR;
    const w = rnd() * 2 - 1;
    const hp = w - prev * 0.6;
    prev = w;
    ph += 185 / SR;
    add(music, i0 + n, (hp * 0.7 * Math.exp(-tt / 0.06) + Math.sin(2 * Math.PI * ph) * 0.5 * Math.exp(-tt / 0.04)) * vol);
  }
}
function hat(t, vol = 0.07, pan = 0.2) {
  const i0 = Math.floor(t * SR);
  let prev = 0;
  for (let n = 0; n < SR * 0.05; n++) {
    const w = rnd() * 2 - 1;
    const hp = w - prev;
    prev = w;
    add(music, i0 + n, hp * Math.exp(-n / SR / 0.012) * vol, pan);
  }
}

// ---------------------------------------------------------------- music (A minor: Am F C G)
const CHORDS = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [57, 60, 65] }, // F
  { root: 48, tones: [55, 60, 64] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];
const MELODY = [
  [76, 0, 74, 76, 0, 79, 81, 0],
  [81, 0, 79, 77, 0, 76, 72, 0],
  [76, 0, 74, 76, 0, 79, 84, 0],
  [83, 0, 81, 79, 0, 74, 71, 0],
];
const BARS = DURATION / BAR;
for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR;
  const ch = CHORDS[bar % 4];
  const full = bar < 2 || bar >= 12; // real-speed sections
  const e8 = BEAT / 2;
  const s16 = BEAT / 4;

  if (full) {
    for (let i = 0; i < 4; i++) kick(t0 + i * BEAT, 0.5);
    snare(t0 + BEAT);
    snare(t0 + 3 * BEAT);
    for (let i = 0; i < 8; i++) hat(t0 + i * e8, i % 2 ? 0.08 : 0.04, i % 2 ? 0.25 : -0.25);
    for (let i = 0; i < 8; i++) {
      const m = ch.root + (i % 4 === 2 ? 12 : 0);
      note(music, { type: 'pulse', duty: 0.25, f: mtof(m), t: t0 + i * e8, dur: e8 * 0.8, vol: 0.17, r: 0.02 });
    }
    const arp = [0, 1, 2, 1].map((k) => ch.tones[k]);
    for (let i = 0; i < 16; i++) {
      const m = arp[i % 4] + (i % 8 >= 4 ? 12 : 0);
      note(music, { type: 'pulse', duty: 0.125, f: mtof(m), t: t0 + i * s16, dur: s16 * 0.7, vol: 0.075, pan: i % 2 ? 0.5 : -0.5, r: 0.02 });
    }
    const mel = MELODY[bar % 4];
    for (let i = 0; i < 8; i++) {
      if (!mel[i]) continue;
      const hold = mel[i + 1] === 0 ? 2 : 1;
      const o = { type: 'pulse', duty: 0.5, f: mtof(mel[i]), dur: e8 * hold * 0.92, vol: 0.13, vib: 1, r: 0.05 };
      note(music, { ...o, t: t0 + i * e8 });
      note(music, { ...o, t: t0 + i * e8 + BEAT * 0.75, vol: 0.035, pan: 0.6 }); // echo
    }
  } else {
    // slow-motion section: half-time, soft, filtered
    kick(t0, 0.5);
    kick(t0 + 2.5 * BEAT, 0.36);
    snare(t0 + 2 * BEAT, 0.2);
    for (let i = 0; i < 4; i++) hat(t0 + i * BEAT + e8, 0.05, 0.2);
    for (const [bt, bd, bm] of [[0, 1.9, 0], [2, 1.4, 0], [3.5, 0.4, 12]]) {
      const f = mtof(ch.root + bm);
      note(music, { type: 'tri', f, t: t0 + bt * BEAT, dur: BEAT * bd, vol: 0.2, r: 0.08 });
      note(music, { type: 'pulse', duty: 0.25, f: f * 2, t: t0 + bt * BEAT, dur: BEAT * bd, vol: 0.05, r: 0.08 });
    }
    ch.tones.forEach((m, k) => {
      note(music, { type: 'saw', f: mtof(m) * (1 + (k - 1) * 0.003), t: t0, dur: BAR * 0.98, vol: 0.075, a: 0.25, r: 0.25, pan: (k - 1) * 0.5 });
    });
    const arp = [0, 1, 2, 1, 2, 1, 0, 1].map((k) => ch.tones[k] + 12);
    for (let i = 0; i < 8; i++) {
      note(music, { type: 'tri', f: mtof(arp[i]), t: t0 + i * e8, dur: e8 * 0.9, vol: 0.19, decay: 0.2, pan: i % 2 ? 0.4 : -0.4 });
    }
    if (bar >= 7) {
      // build: add a quiet sparkle line towards the end of the slow section
      for (let i = 0; i < 16; i++) {
        const m = ch.tones[i % 3] + 24;
        note(music, { type: 'pulse', duty: 0.125, f: mtof(m), t: t0 + i * s16, dur: s16 * 0.5, vol: 0.03 + 0.008 * (bar - 7), pan: i % 2 ? -0.6 : 0.6, r: 0.02 });
      }
    }
  }
}

// "underwater" low-pass while time is slowed down
const cutoff = (t) => {
  if (t < 3) return 17000;
  if (t < 4) return 17000 * Math.pow(1800 / 17000, t - 3);
  if (t < 24) return 1800 + ((t - 4) / 20) * 1800;
  if (t < 25) return 3600 * Math.pow(17000 / 3600, t - 24);
  return 17000;
};
for (const chn of music) {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    const k = 1 - Math.exp((-2 * Math.PI * cutoff(i / SR)) / SR);
    s1 += k * (chn[i] - s1);
    s2 += k * (s1 - s2);
    chn[i] = s2;
  }
}

// ---------------------------------------------------------------- sound effects
const blip = (t, m, vol = 0.1, pan = 0) => note(sfx, { type: 'pulse', duty: 0.5, f: mtof(m), t, dur: 0.045, vol, pan, r: 0.03 });
for (const t of EVENTS.captions) {
  blip(t, 88, 0.09);
  blip(t + 0.055, 93, 0.09);
}
for (const t of EVENTS.labels) blip(t, 96, 0.07, 0.3);
[81, 84, 88].forEach((m, i) => blip(EVENTS.panelIn + i * 0.06, m, 0.08, -0.3));
EVENTS.summaryRows.forEach((t, i) => blip(t + 0.02, 84 + i * 4, 0.1, -0.2));
blip(EVENTS.cta, 83, 0.12);
note(sfx, { type: 'pulse', f: mtof(88), t: EVENTS.cta + 0.07, dur: 0.3, vol: 0.12, decay: 0.12, r: 0.1 });

// time-warp sweeps
note(sfx, { type: 'saw', f: 700, f1: 70, t: EVENTS.slowDown, dur: 1.0, vol: 0.09, a: 0.05, r: 0.2 });
note(sfx, { type: 'tri', f: 1400, f1: 140, t: EVENTS.slowDown, dur: 1.0, vol: 0.08, a: 0.05, r: 0.2 });
note(sfx, { type: 'saw', f: 70, f1: 900, t: EVENTS.speedUp, dur: 1.0, vol: 0.08, a: 0.3, r: 0.05 });
{
  const i0 = Math.floor(EVENTS.speedUp * SR);
  let lp = 0;
  for (let n = 0; n < SR; n++) {
    const k = n / SR;
    lp += (0.02 + 0.5 * k * k) * (rnd() * 2 - 1 - lp);
    add(sfx, i0 + n, lp * k * k * 0.22);
  }
}

// muscle sounds: a soft tone that follows the arm, plus "fibre crackle" that
// gets denser as each head works harder (one pitch per head)
{
  const HEAD_F = [988, 740, 554];
  let ph = 0;
  let prevAng = pose(0).armAngle;
  let level = 0;
  let toneF = 90;
  const next = [0, 0, 0];
  for (let i = 0; i < N; i += 1) {
    const t = i / SR;
    if (i % 64 === 0) {
      const p = pose(t);
      const act = activation(t);
      const speed = Math.abs(p.armAngle - prevAng) / (64 / SR); // deg / s
      prevAng = p.armAngle;
      level += 0.15 * (Math.min(1, speed / 90) - level);
      toneF = 90 + p.armAngle * 2.2;
      for (let h = 0; h < 3; h++) {
        if (act[h] > 0.3 && t >= next[h]) {
          const rate = 5 + 34 * (act[h] - 0.3);
          next[h] = t + (0.4 + rnd() * 1.2) / rate;
          note(sfx, { type: 'sine', f: HEAD_F[h] * (0.97 + rnd() * 0.06), t, dur: 0.012, vol: 0.02 + 0.045 * act[h], pan: rnd() * 1.2 - 0.6, a: 0.001, r: 0.03 });
        }
      }
    }
    ph += toneF / SR;
    const x = ph - Math.floor(ph);
    add(sfx, i, (4 * Math.abs(x - 0.5) - 1) * level * 0.06);
  }
}

// ---------------------------------------------------------------- master
const out = new Int16Array(N * 2);
let peak = 0;
const mix = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) {
  for (let i = 0; i < N; i++) {
    const v = Math.tanh((music[c][i] * 0.95 + sfx[c][i]) * 0.9);
    mix[c][i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
}
const g = 0.84 / peak;
for (let i = 0; i < N; i++) {
  out[i * 2] = Math.round(mix[0][i] * g * 32767);
  out[i * 2 + 1] = Math.round(mix[1][i] * g * 32767);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + out.byteLength, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(out.byteLength, 40);
const file = process.argv[2] || 'build/audio.wav';
fs.writeFileSync(file, Buffer.concat([header, Buffer.from(out.buffer)]));
console.log(`wrote ${file}  peak=${peak.toFixed(3)}`);
