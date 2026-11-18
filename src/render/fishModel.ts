/**
 * Anatomical fish meshes (v2). Unit-length fish along +X (nose at +0.5, tail tip at -0.5), dorsal +Y,
 * lateral Z. The body is lofted through measured profiles (dorsal height, ventral depth, half width)
 * with a superellipse cross-section; eyes are real spheres; fins are multi-row membranes with
 * species outlines. Attributes for the skin shader:
 *   aPart  0 body, 1 fin, 2 eye
 *   aUV    body: (along 0 nose..1 tail, around 0 belly..1 back); fin: (base 0..1, base->tip 0..1); eye: (angle from pupil /pi, 0)
 *   aFin   fin id (FIN.*), -1 off fins
 */
import * as THREE from "three";
import type { FishSpecies } from "./shaders/fishSkin.glsl";

export const FIN = { dorsal1: 0, dorsal2: 1, anal: 2, caudal: 3, pectoral: 4, pelvic: 5 } as const;

/** [t, dorsal height, ventral depth, half width], fractions of total length; t = 0 nose .. body end. */
type Key = [number, number, number, number];

interface FinOutline {
  t0: number;
  t1: number;
  /** height at base fraction u (0 front .. 1 rear), fraction of length */
  h: (u: number) => number;
  /** rearward sweep of the tip, fraction of length */
  sweep: number;
}

export interface Anatomy {
  body: Key[];
  /** cross-section squareness: 2 = ellipse, higher = boxier */
  squareness: number;
  /** where the head ends (gill cover edge), as t */
  gillT: number;
  eye: { t: number; yFrac: number; r: number };
  /** mouth: end of the gape along t, and its height as a fraction of the local half-height (negative = below axis) */
  mouth: { tEnd: number; yFrac: number };
  dorsal1: FinOutline;
  dorsal2?: FinOutline;
  anal: FinOutline;
  caudal: { len: number; span: number; fork: number };
  pectoral: { t: number; len: number };
  pelvic: { t: number; len: number };
}

const bump = (u: number, peak: number, sharp = 1): number => Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), sharp) * peak;

export const ANATOMY: Record<FishSpecies, Anatomy> = {
  pike: {
    body: [
      [0, 0.004, 0.004, 0.01],
      [0.03, 0.013, 0.012, 0.025],
      [0.08, 0.021, 0.021, 0.033],
      [0.14, 0.033, 0.032, 0.04],
      [0.22, 0.047, 0.045, 0.047],
      [0.35, 0.058, 0.057, 0.051],
      [0.5, 0.062, 0.063, 0.049],
      [0.62, 0.059, 0.061, 0.044],
      [0.72, 0.051, 0.052, 0.035],
      [0.8, 0.039, 0.039, 0.024],
      [0.86, 0.029, 0.029, 0.015],
      [0.885, 0.027, 0.027, 0.011],
    ],
    squareness: 2.5,
    gillT: 0.235,
    eye: { t: 0.125, yFrac: 0.55, r: 0.0125 },
    mouth: { tEnd: 0.13, yFrac: -0.1 },
    dorsal1: { t0: 0.69, t1: 0.83, h: (u) => 0.03 + bump(u * 0.85 + 0.1, 0.045, 0.7), sweep: 0.03 },
    anal: { t0: 0.71, t1: 0.84, h: (u) => 0.025 + bump(u * 0.85 + 0.1, 0.04, 0.7), sweep: 0.03 },
    caudal: { len: 0.13, span: 0.1, fork: 0.45 },
    pectoral: { t: 0.24, len: 0.085 },
    pelvic: { t: 0.5, len: 0.07 },
  },
  perch: {
    body: [
      [0, 0.006, 0.006, 0.008],
      [0.04, 0.03, 0.022, 0.02],
      [0.1, 0.062, 0.045, 0.036],
      [0.2, 0.1, 0.07, 0.052],
      [0.32, 0.12, 0.085, 0.058],
      [0.45, 0.115, 0.088, 0.055],
      [0.58, 0.095, 0.08, 0.046],
      [0.7, 0.068, 0.06, 0.034],
      [0.8, 0.045, 0.04, 0.02],
      [0.86, 0.035, 0.032, 0.012],
    ],
    squareness: 2.2,
    gillT: 0.27,
    eye: { t: 0.105, yFrac: 0.45, r: 0.02 },
    mouth: { tEnd: 0.075, yFrac: 0.05 },
    dorsal1: { t0: 0.3, t1: 0.53, h: (u) => 0.03 + 0.085 * Math.pow(1 - u, 0.6) * Math.min(1, u * 8 + 0.4), sweep: 0.03 },
    dorsal2: { t0: 0.56, t1: 0.76, h: (u) => 0.02 + bump(u * 0.9 + 0.08, 0.06, 0.6), sweep: 0.03 },
    anal: { t0: 0.62, t1: 0.76, h: (u) => 0.02 + bump(u * 0.9 + 0.08, 0.05, 0.6), sweep: 0.025 },
    caudal: { len: 0.14, span: 0.11, fork: 0.25 },
    pectoral: { t: 0.27, len: 0.09 },
    pelvic: { t: 0.3, len: 0.085 },
  },
  roach: {
    body: [
      [0, 0.006, 0.006, 0.007],
      [0.04, 0.028, 0.024, 0.018],
      [0.1, 0.06, 0.052, 0.033],
      [0.2, 0.095, 0.08, 0.045],
      [0.33, 0.115, 0.095, 0.048],
      [0.46, 0.112, 0.095, 0.046],
      [0.6, 0.09, 0.082, 0.038],
      [0.72, 0.062, 0.058, 0.028],
      [0.82, 0.04, 0.038, 0.016],
      [0.86, 0.034, 0.032, 0.011],
    ],
    squareness: 2.0,
    gillT: 0.22,
    eye: { t: 0.085, yFrac: 0.3, r: 0.022 },
    mouth: { tEnd: 0.045, yFrac: 0.1 },
    dorsal1: { t0: 0.42, t1: 0.58, h: (u) => 0.02 + 0.09 * Math.pow(1 - u, 0.9) * Math.min(1, u * 6 + 0.3), sweep: 0.04 },
    anal: { t0: 0.64, t1: 0.78, h: (u) => 0.015 + 0.06 * Math.pow(1 - u, 0.9) * Math.min(1, u * 6 + 0.3), sweep: 0.03 },
    caudal: { len: 0.15, span: 0.12, fork: 0.7 },
    pectoral: { t: 0.23, len: 0.085 },
    pelvic: { t: 0.43, len: 0.075 },
  },
  rudd: {
    body: [
      [0, 0.006, 0.006, 0.007],
      [0.04, 0.026, 0.026, 0.018],
      [0.1, 0.056, 0.058, 0.034],
      [0.2, 0.09, 0.092, 0.046],
      [0.33, 0.105, 0.108, 0.049],
      [0.46, 0.1, 0.106, 0.046],
      [0.6, 0.082, 0.088, 0.038],
      [0.72, 0.058, 0.06, 0.028],
      [0.82, 0.039, 0.039, 0.016],
      [0.86, 0.033, 0.033, 0.011],
    ],
    squareness: 2.0,
    gillT: 0.22,
    eye: { t: 0.085, yFrac: 0.35, r: 0.021 },
    mouth: { tEnd: 0.045, yFrac: 0.45 },
    dorsal1: { t0: 0.5, t1: 0.64, h: (u) => 0.02 + 0.085 * Math.pow(1 - u, 0.9) * Math.min(1, u * 6 + 0.3), sweep: 0.04 },
    anal: { t0: 0.64, t1: 0.79, h: (u) => 0.015 + 0.065 * Math.pow(1 - u, 0.9) * Math.min(1, u * 6 + 0.3), sweep: 0.03 },
    caudal: { len: 0.15, span: 0.12, fork: 0.65 },
    pectoral: { t: 0.23, len: 0.085 },
    pelvic: { t: 0.42, len: 0.075 },
  },
};

/** Catmull-Rom through the keys for column `col` (1 top, 2 bottom, 3 width); clamps outside the body. */
export function profile(keys: Key[], col: 1 | 2 | 3, t: number): number {
  const n = keys.length;
  if (t <= keys[0]![0]) return keys[0]![col];
  if (t >= keys[n - 1]![0]) return keys[n - 1]![col];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1]![0]) i++;
  const k0 = keys[Math.max(0, i - 1)]!, k1 = keys[i]!, k2 = keys[i + 1]!, k3 = keys[Math.min(n - 1, i + 2)]!;
  const u = (t - k1[0]) / (k2[0] - k1[0]);
  const p0 = k0[col], p1 = k1[col], p2 = k2[col], p3 = k3[col];
  const u2 = u * u, u3 = u2 * u;
  const v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  return Math.max(0.002, v);
}

const sgnPow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

interface Builder {
  pos: number[];
  uv: number[];
  part: number[];
  fin: number[];
  idx: number[];
}

function addGrid(b: Builder, rows: number, cols: number, at: (r: number, c: number) => [number, number, number], uvAt: (r: number, c: number) => [number, number], part: number, fin: number, wrapCols = false): void {
  const o = b.pos.length / 3;
  const nc = wrapCols ? cols : cols + 1;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < nc; c++) {
      b.pos.push(...at(r, c));
      b.uv.push(...uvAt(r, c));
      b.part.push(part);
      b.fin.push(fin);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = wrapCols ? (c + 1) % cols : c + 1;
      const a = o + r * nc + c, bb = o + r * nc + c1, cc = o + (r + 1) * nc + c, d = o + (r + 1) * nc + c1;
      b.idx.push(a, cc, bb, bb, cc, d);
    }
  }
}

export interface FishDetail {
  along: number;
  around: number;
  finCols: number;
  finRows: number;
  eyeSeg: number;
}

export const DETAIL: Record<"high" | "low" | "hero", FishDetail> = {
  hero: { along: 110, around: 36, finCols: 22, finRows: 5, eyeSeg: 18 },
  high: { along: 56, around: 22, finCols: 12, finRows: 3, eyeSeg: 10 },
  low: { along: 32, around: 14, finCols: 7, finRows: 2, eyeSeg: 8 },
};

/** Build the full fish (body, fins, eyes) for a species at a detail level. */
export function buildFishModel(species: FishSpecies, detail: FishDetail): THREE.BufferGeometry {
  const a = ANATOMY[species];
  const b: Builder = { pos: [], uv: [], part: [], fin: [], idx: [] };
  const tEnd = a.body[a.body.length - 1]![0];
  const top = (t: number) => profile(a.body, 1, t);
  const bot = (t: number) => profile(a.body, 2, t);
  const wid = (t: number) => profile(a.body, 3, t);
  const e = 2 / a.squareness;

  // --- body: rows along t (denser at the head, where the detail is), columns around ---
  const tAt = (r: number) => tEnd * (1 - Math.cos((r / detail.along) * Math.PI * 0.5) * 0.35 - (1 - (r / detail.along)) * 0.65);
  const bodyPoint = (t: number, ang: number): [number, number, number] => {
    const s = Math.sin(ang);
    const c = Math.cos(ang);
    const h = s >= 0 ? top(t) : bot(t);
    // pike snout: flatter (boxier) toward the nose; belly a little flatter than the back
    const sq = s >= 0 ? e : e * 0.92;
    return [0.5 - t, sgnPow(s, sq) * h, sgnPow(c, sq) * wid(t)];
  };
  addGrid(
    b,
    detail.along,
    detail.around,
    (r, c) => bodyPoint(tAt(r), (c / detail.around) * Math.PI * 2),
    (r, c) => [tAt(r), 0.5 + 0.5 * Math.sin((c / detail.around) * Math.PI * 2)],
    0,
    -1,
    true,
  );
  // nose cap
  {
    const o = b.pos.length / 3;
    b.pos.push(0.5 + 0.002, 0, 0);
    b.uv.push(0, 0.5);
    b.part.push(0);
    b.fin.push(-1);
    for (let c = 0; c < detail.around; c++) b.idx.push(o, c, (c + 1) % detail.around);
  }

  // --- fins ---
  const R = detail.finRows;
  const C = detail.finCols;
  const median = (o: FinOutline, sign: number, finId: number): void => {
    addGrid(
      b,
      R,
      C,
      (r, c) => {
        const u = c / C;
        const v = r / R;
        const t = o.t0 + (o.t1 - o.t0) * u;
        const base = (sign > 0 ? top(t) : bot(t)) * 0.96;
        const h = o.h(u);
        return [0.5 - t - o.sweep * v * v, sign * (base + h * v), 0.004 * Math.sin(u * 9 + v * 2) * v];
      },
      (r, c) => [c / C, r / R],
      1,
      finId,
    );
  };
  median(a.dorsal1, 1, FIN.dorsal1);
  if (a.dorsal2) median(a.dorsal2, 1, FIN.dorsal2);
  median(a.anal, -1, FIN.anal);

  // caudal: fan from the peduncle, forked outline
  {
    const xb = 0.5 - tEnd + 0.005;
    const hb = Math.min(top(tEnd), bot(tEnd)) * 0.95;
    const cf = a.caudal;
    addGrid(
      b,
      R,
      C,
      (r, c) => {
        const u = c / C;
        const v = r / R;
        const s = u * 2 - 1;
        const reach = cf.len * (1 - cf.fork + cf.fork * Math.pow(Math.abs(s), 0.7)) * (1 - 0.15 * (1 - Math.abs(s)) * cf.fork);
        const tipY = s * cf.span;
        return [xb - reach * v, s * hb * (1 - v) + tipY * v, 0];
      },
      (r, c) => [c / C, r / R],
      1,
      FIN.caudal,
    );
  }

  // paired fins (left and right): pectoral just behind the gill cover, pelvic under the belly
  const paired = (t: number, len: number, yAt: (t: number) => number, out: number, down: number, finId: number): void => {
    for (const side of [1, -1]) {
      addGrid(
        b,
        R,
        Math.max(3, Math.round(C / 2)),
        (r, c) => {
          const cols = Math.max(3, Math.round(C / 2));
          const u = c / cols;
          const v = r / R;
          // a fan: the base runs along the body, the leading rays reach back and down, the trailing ones back
          const tt = t + len * 0.45 * u;
          const reach = len * (1 - 0.45 * u) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, v * 1.2)));
          const dn = down * (1.2 - 0.9 * u);
          return [0.5 - tt - reach * v * 0.9, yAt(tt) - reach * v * dn, side * (wid(tt) * 0.95 + reach * v * out)];
        },
        (r, c) => [c / Math.max(3, Math.round(C / 2)), r / R],
        1,
        finId,
      );
    }
  };
  paired(a.pectoral.t, a.pectoral.len, (t) => -bot(t) * 0.45, 0.28, 0.5, FIN.pectoral);
  paired(a.pelvic.t, a.pelvic.len, (t) => -bot(t) * 0.88, 0.22, 0.45, FIN.pelvic);

  // --- eyes: spheres set into the head, slightly proud of the skin ---
  {
    const t = a.eye.t;
    const r = a.eye.r;
    const y = top(t) * a.eye.yFrac;
    const sinA = Math.max(-1, Math.min(1, y / top(t)));
    const zSkin = wid(t) * Math.pow(Math.max(0, 1 - Math.abs(sinA) ** a.squareness), 1 / a.squareness);
    const n = detail.eyeSeg;
    for (const side of [1, -1]) {
      const cz = side * (zSkin - r * 0.35);
      addGrid(
        b,
        n,
        n * 2,
        (i, j) => {
          const th = (i / n) * Math.PI; // 0 at the pupil (pointing out), pi at the back
          const ph = (j / (n * 2)) * Math.PI * 2;
          return [0.5 - t + Math.sin(th) * Math.cos(ph) * r, y + Math.sin(th) * Math.sin(ph) * r, cz + side * Math.cos(th) * r];
        },
        (i) => [i / n, 0],
        2,
        -1,
        true,
      );
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("aUV", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(b.part, 1));
  g.setAttribute("aFin", new THREE.Float32BufferAttribute(b.fin, 1));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  return g;
}
