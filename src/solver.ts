/**
 * 1D váz-solver: Euler–Bernoulli rúdelem, 3 szabadsági fok csomópontonként
 * (ux, uy, θz). A gerinc-rendszer merev sarkai nyomatást visz át, tehát a rúd
 * két végén a nyomaték nem kiesik.
 *
 * Jelkonvenció (lokális, rúd koordinátarendszerében):
 *   x' a rúd tengelye (i → j), y' a tőle 90°-ra, θz a keresztmetszet
 *   elforgatása. A globális y felfelé pozitív, így a lefelé mutató teher negatív.
 *
 * A visszaadott belső erők az ELEM i VÉGÉN érvényesek, a szolver jeleit megtartva
 * (V az i végén a lokális y' tengely mentén, M a helyi óramutató irányában).
 */

import { GRAVITY, sectionById, sectionProps } from './catalog';
import { beamLength, nodeById } from './geometry';
import type { Beam, Structure, SupportType } from './geometry';
import { matVec, matVecT, solveLinearSystem, zeros } from './linalg';
import type { Matrix } from './linalg';

export interface ElementResult {
  beam: number;
  length: number;
  /** tengelyerő a két végen (N), húzás pozitív */
  N: [number, number];
  /** nyíróerő a két végen (N) */
  V: [number, number];
  /** hajlítási nyomaték a két végen (N·m) */
  M: [number, number];
  /** legnagyobb feszültség a rúdban (Pa) */
  sigmaMax: number;
}

export interface Reaction {
  node: number;
  type: SupportType;
  fx: number;
  fy: number;
  mz: number;
}

export interface SolveResult {
  ok: boolean;
  /** ok = false esetén a hiba magyar nyelven, a felhasználónak szól */
  error?: string;
  /** elmozdulások, 3 DOF csomópontonként: ux (m), uy (m), θz (rad) */
  u: number[];
  reactions: Reaction[];
  elements: ElementResult[];
  /** alkalmazott terhek összege (N, N, N·m) — az egyensúlyi ellenőrzéshez */
  applied: { fx: number; fy: number; mz: number };
  /** reakciók összege (N, N, N·m) — megegyezik az `applied` értékével */
  reaction: { fx: number; fy: number; mz: number };
  maxAbsU: number;
  maxAbsTheta: number;
  maxN: number;
  maxV: number;
  maxM: number;
  maxSigma: number;
  /** szabadsági fokok: rögzített / összes */
  dof: { fixed: number; total: number };
  /**
   * Globális mérlegellenőrzés a koordináta-kezdőpont körül. Hibátlan megoldásnál
   * `applied` és `reaction` a nyomatékra is egyenlő nagyságú, ellenkező előjellel.
   */
  momentBalance: { applied: number; reaction: number; error: number };
}

interface ElementProps {
  beam: Beam;
  L: number;
  cos: number;
  sin: number;
  EA: number;
  EI: number;
  A: number;
  I: number;
  yMax: number;
}

/** DOF-sorszám: a node i. szabadsági foka (3 per csomópont). */
export function dof(node: number, comp: 0 | 1 | 2): number {
  return 3 * node + comp;
}

function elementProps(s: Structure, bm: Beam): ElementProps | null {
  const a = nodeById(s, bm.nodeI);
  const b = nodeById(s, bm.nodeJ);
  if (!a || !b) return null;
  const sec = sectionById(s.catalog, bm.sectionId);
  const mat = s.catalog.materials.find((m) => m.id === bm.materialId);
  if (!sec || !mat) return null;
  const p = sectionProps(sec);
  const L = beamLength(s, bm);
  if (L <= 0) return null;
  return {
    beam: bm,
    L,
    cos: (b.x - a.x) / L,
    sin: (b.y - a.y) / L,
    EA: mat.E * p.A,
    EI: mat.E * p.I,
    A: p.A,
    I: p.I,
    yMax: Math.max(p.yBot, p.yTop),
  };
}

/** A lokális 6×6 merevségi mátrix. */
function localStiffness(e: ElementProps): number[][] {
  const { L, EA, EI } = e;
  const k = zeros(6);
  const a1 = EA / L;
  const a2 = 12 * EI / L ** 3;
  const a3 = 6 * EI / L ** 2;
  const a4 = 4 * EI / L;
  const a5 = 2 * EI / L;
  const set = (i: number, j: number, v: number): void => {
    k[i]![j] = v;
  };
  set(0, 0, a1);
  set(0, 3, -a1);
  set(3, 0, -a1);
  set(3, 3, a1);
  set(1, 1, a2);
  set(1, 2, a3);
  set(1, 4, -a2);
  set(1, 5, a3);
  set(2, 1, a3);
  set(2, 2, a4);
  set(2, 4, -a3);
  set(2, 5, a5);
  set(4, 1, -a2);
  set(4, 2, -a3);
  set(4, 4, a2);
  set(4, 5, -a3);
  set(5, 1, a3);
  set(5, 2, a5);
  set(5, 4, -a3);
  set(5, 5, a4);
  return k;
}

/** Lokális → globális transzformáció (6×6, két 3×3 forgatás blokkja). */
function transform(e: ElementProps): number[][] {
  const T = zeros(6);
  const c = e.cos;
  const sn = e.sin;
  const R = [
    [c, sn, 0],
    [-sn, c, 0],
    [0, 0, 1],
  ];
  for (let blk = 0; blk < 2; blk++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) T[blk * 3 + i]![blk * 3 + j] = R[i]![j]!;
    }
  }
  return T;
}

function matMulT(A: Matrix, B: Matrix): Matrix {
  const m = B[0]!.length;
  const k = B.length;
  const out = zeros(m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[t]![i]! * B[j]![t]!;
      out[i]![j] = s;
    }
  }
  return out;
}

function matMul(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const k = A[0]!.length;
  const m = B[0]!.length;
  const out = zeros(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i]![t]! * B[t]![j]!;
      out[i]![j] = s;
    }
  }
  return out;
}

/**
 * Megoszló keresztirányú teher konzisztens (nodal) terhelésvektora lokális
 * koordinátákban: q' pozitív = a lokális y' szerint felfelé.
 */
function consistentLocalLoad(L: number, qLocal: number): number[] {
  const f = [0, (qLocal * L) / 2, (qLocal * L * L) / 12, 0, (qLocal * L) / 2, (-qLocal * L * L) / 12];
  return f;
}

/** A szerkezet statikus megoldása. */
export function solve(s: Structure): SolveResult {
  const base: SolveResult = {
    ok: false,
    u: [],
    reactions: [],
    elements: [],
    applied: { fx: 0, fy: 0, mz: 0 },
    reaction: { fx: 0, fy: 0, mz: 0 },
    maxAbsU: 0,
    maxAbsTheta: 0,
    maxN: 0,
    maxV: 0,
    maxM: 0,
    maxSigma: 0,
    dof: { fixed: 0, total: 0 },
    momentBalance: { applied: 0, reaction: 0, error: 0 },
  };

  if (s.nodes.length === 0) return { ...base, error: 'Üres a modell — nincs mit számolni.' };
  if (s.beams.length === 0) return { ...base, error: 'Nincs rúd a modellben.' };
  if (s.supports.length === 0) {
    return { ...base, error: 'Nincs támasz — a szerkezet szabadon mozog, nem számítható.' };
  }

  const ndof = 3 * s.nodes.length;
  const K = zeros(ndof);
  const F = new Array<number>(ndof).fill(0);
  const props = new Map<number, ElementProps>();
  for (const bm of s.beams) {
    const p = elementProps(s, bm);
    if (!p) return { ...base, error: `A(z) ${bm.id}. rúd adata hiányzik (anyag vagy szelvény).` };
    props.set(bm.id, p);
  }

  // 1. Globális merevségi mátrix összeállítása
  for (const p of props.values()) {
    const kl = localStiffness(p);
    const T = transform(p);
    const kg = matMul(matMulT(T, kl), T);
    const dofs = [
      dof(p.beam.nodeI, 0),
      dof(p.beam.nodeI, 1),
      dof(p.beam.nodeI, 2),
      dof(p.beam.nodeJ, 0),
      dof(p.beam.nodeJ, 1),
      dof(p.beam.nodeJ, 2),
    ];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        K[dofs[i]!]![dofs[j]!] = K[dofs[i]!]![dofs[j]!]! + kg[i]![j]!;
      }
    }
  }

  // 2. Terhelési vektor: koncentrált terhek
  for (const ld of s.loads) {
    F[dof(ld.node, 0)]! += ld.fx;
    F[dof(ld.node, 1)]! += ld.fy;
    F[dof(ld.node, 2)]! += ld.mz;
  }

  // 3. Terhelési vektor: megoszló és önsúly (lokális konzisztens terhelés)
  const addDist = (beamId: number, qWorldY: number): void => {
    const p = props.get(beamId);
    if (!p) return;
    // a globális y irányú teher lokális keresztirányú komponense
    const qLocal = qWorldY * p.cos;
    const f = consistentLocalLoad(p.L, qLocal);
    const fg = matVecT(transform(p), f);
    const dofs = [
      dof(p.beam.nodeI, 0),
      dof(p.beam.nodeI, 1),
      dof(p.beam.nodeI, 2),
      dof(p.beam.nodeJ, 0),
      dof(p.beam.nodeJ, 1),
      dof(p.beam.nodeJ, 2),
    ];
    for (let i = 0; i < 6; i++) F[dofs[i]!] = F[dofs[i]!]! + fg[i]!;
  };
  for (const dl of s.distLoads) addDist(dl.beam, dl.qy);
  if (s.selfWeight) {
    for (const p of props.values()) {
      addDist(p.beam.id, -p.A * (s.catalog.materials.find((m) => m.id === p.beam.materialId)?.rho ?? 0) * GRAVITY);
    }
  }

  // 4. Támaszok = rögzített szabadsági fokok
  const fixed = new Set<number>();
  for (const sp of s.supports) {
    if (sp.type === 'fixed') {
      fixed.add(dof(sp.node, 0));
      fixed.add(dof(sp.node, 1));
      fixed.add(dof(sp.node, 2));
    } else if (sp.type === 'pinned') {
      // csukló: a tengelyirányú elmozdulást is megfogja, a forgást nem
      fixed.add(dof(sp.node, 0));
      fixed.add(dof(sp.node, 1));
    } else {
      // görgő: csak a függőleges elmozdulást fogja meg, a tengelyirány szabad
      fixed.add(dof(sp.node, 1));
    }
  }
  const free: number[] = [];
  for (let d = 0; d < ndof; d++) if (!fixed.has(d)) free.push(d);
  if (free.length === 0) return { ...base, error: 'Minden szabadsági fok rögzített — nincs mit számolni.' };

  // 5. K·u = F megoldása a szabad szabadsági fokokon
  const kff: Matrix = free.map((di) => free.map((dj) => K[di]![dj]!));
  const ff = free.map((di) => F[di]!);
  const sol = solveLinearSystem(kff, ff);
  if (sol.singular) {
    return {
      ...base,
      error:
        'A szerkezet statikailag nem határozott: a merevségi mátrix szinguláris. ' +
        'Valószínűleg hiányzik egy támasz, vagy a mechanizmus szabálytalan.',
      dof: { fixed: fixed.size, total: ndof },
    };
  }
  const u = new Array<number>(ndof).fill(0);
  free.forEach((d, i) => {
    u[d] = sol.x[i]!;
  });

  // 6. Reakciók: R = K·u − F a rögzített szabadsági fokokon
  const Ku = matVec(K, u);
  const reactions: Reaction[] = [];
  const reaction = { fx: 0, fy: 0, mz: 0 };
  for (const sp of s.supports) {
    const rx = Ku[dof(sp.node, 0)]! - F[dof(sp.node, 0)]!;
    const ry = Ku[dof(sp.node, 1)]! - F[dof(sp.node, 1)]!;
    const rm = Ku[dof(sp.node, 2)]! - F[dof(sp.node, 2)]!;
    reactions.push({ node: sp.node, type: sp.type, fx: rx, fy: ry, mz: rm });
    reaction.fx += rx;
    reaction.fy += ry;
    reaction.mz += rm;
  }

  // 6b. Globális momentummérleg: a reakciók és a terhek nyomatéka a kezdőpont
  // körül. Ez a szolver legfontosabb önellenőrzése.
  let appliedMoment = 0;
  let reactionMoment = 0;
  for (let n = 0; n < s.nodes.length; n++) {
    const { x, y } = s.nodes[n]!;
    appliedMoment += x * F[dof(n, 1)]! - y * F[dof(n, 0)]! + F[dof(n, 2)]!;
  }
  for (const rx of reactions) {
    const { x, y } = s.nodes[rx.node]!;
    reactionMoment += x * rx.fy - y * rx.fx + rx.mz;
  }

  // 7. Elemi belső erők
  const elements: ElementResult[] = [];
  let maxN = 0;
  let maxV = 0;
  let maxM = 0;
  let maxSigma = 0;
  for (const p of props.values()) {
    const dofs = [
      dof(p.beam.nodeI, 0),
      dof(p.beam.nodeI, 1),
      dof(p.beam.nodeI, 2),
      dof(p.beam.nodeJ, 0),
      dof(p.beam.nodeJ, 1),
      dof(p.beam.nodeJ, 2),
    ];
    const ul = dofs.map((d) => u[d]!);
    // lokális elmozdulások: u_l = T·u_g
    const ulg = matVec(transform(p), ul);

    // a rúdra ható külső konzisztens teher lokális vektora
    let fexternal = [0, 0, 0, 0, 0, 0];
    for (const dl of s.distLoads) {
      if (dl.beam !== p.beam.id) continue;
      const f = consistentLocalLoad(p.L, dl.qy * p.cos);
      fexternal = fexternal.map((v, i) => v + f[i]!);
    }
    if (s.selfWeight) {
      const rho = s.catalog.materials.find((m) => m.id === p.beam.materialId)?.rho ?? 0;
      const f = consistentLocalLoad(p.L, -p.A * rho * GRAVITY * p.cos);
      fexternal = fexternal.map((v, i) => v + f[i]!);
    }

    const fl = localStiffness(p)
      .map((row, i) => row.reduce((sum, v, j) => sum + v * ulg[j]!, 0) - fexternal[i]!)
      .slice(0, 6);

    // belső erők az i végen a szokásos szignum-konvencióval:
    // N húzás-pozitív, V és M a lokális tengelyrendszerben értelmezett
    const N = -fl[0]!;
    const V = fl[1]!;
    const M = fl[2]!;
    // a j végén a belső erők a másik irányúak
    const Nj = fl[3]!;
    const Vj = -fl[4]!;
    const Mj = -fl[5]!;
    // legnagyobb feszültség: N/A + M/W, ahol W = I/yMax
    const sigmaEnd = (Nn: number, Mm: number): number => Math.abs(Nn) / p.A + (Math.abs(Mm) * p.yMax) / p.I;
    const sigmaMax = Math.max(sigmaEnd(N, M), sigmaEnd(Nj, Mj));
    elements.push({ beam: p.beam.id, length: p.L, N: [N, Nj], V: [V, Vj], M: [M, Mj], sigmaMax });
    maxN = Math.max(maxN, Math.abs(N), Math.abs(Nj));
    maxV = Math.max(maxV, Math.abs(V), Math.abs(Vj));
    maxM = Math.max(maxM, Math.abs(M), Math.abs(Mj));
    maxSigma = Math.max(maxSigma, sigmaMax);
  }

  // a teljes külső teher: a konzisztens nodal terhelésvektorok összege
  // pontosan a megoszló teher eredője, így ez a koncentrált, megoszló és önsúly
  // terheket is tartalmazza
  const applied = { fx: 0, fy: 0, mz: 0 };
  for (let n = 0; n < s.nodes.length; n++) {
    applied.fx += F[dof(n, 0)]!;
    applied.fy += F[dof(n, 1)]!;
    applied.mz += F[dof(n, 2)]!;
  }

  let maxAbsU = 0;
  let maxAbsTheta = 0;
  for (let n = 0; n < s.nodes.length; n++) {
    maxAbsU = Math.max(maxAbsU, Math.hypot(u[dof(n, 0)]!, u[dof(n, 1)]!));
    maxAbsTheta = Math.max(maxAbsTheta, Math.abs(u[dof(n, 2)]!));
  }

  return {
    ok: true,
    u,
    reactions,
    elements,
    applied,
    reaction,
    maxAbsU,
    maxAbsTheta,
    maxN,
    maxV,
    maxM,
    maxSigma,
    dof: { fixed: fixed.size, total: ndof },
    momentBalance: {
      applied: appliedMoment,
      reaction: reactionMoment,
      error: Math.abs(appliedMoment + reactionMoment),
    },
  };
}

/** A rúd lokális keresztirányú elmozdulása az adott helyen (Euler–Bernoulli, Hermite). */
export function localTransverseAt(uLocal: number[], L: number, xi: number): number {
  const [, v1, t1, , v2, t2] = uLocal;
  const N1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
  const N2 = L * (xi - 2 * xi ** 2 + xi ** 3);
  const N3 = 3 * xi ** 2 - 2 * xi ** 3;
  const N4 = L * (xi ** 3 - xi ** 2);
  return N1 * v1! + N2 * t1! + N3 * v2! + N4 * t2!;
}

/** A rúd lokális keresztmetszeti forgatása az adott helyen. */
export function localRotationAt(uLocal: number[], L: number, xi: number): number {
  const [, v1, t1, , v2, t2] = uLocal;
  const d1 = (6 * xi ** 2 - 6 * xi) / L;
  const d2 = (1 - 4 * xi + 3 * xi ** 2);
  const d3 = (6 * xi - 6 * xi ** 2) / L;
  const d4 = 3 * xi ** 2 - 2 * xi;
  return d1 * v1! + d2 * t1! + d3 * v2! + d4 * t2!;
}

/** A deformált alakzat pontja a rúd xi ∈ [0,1] helyén, világ-koordinátákban. */
export function deformedPointAt(s: Structure, res: SolveResult, beamId: number, xi: number): {
  x: number;
  y: number;
} {
  const bm = s.beams.find((b) => b.id === beamId)!;
  const a = nodeById(s, bm.nodeI)!;
  const b = nodeById(s, bm.nodeJ)!;
  const L = beamLength(s, bm);
  // a DOF-sorszám a csomópont számából képződik, nem a szomszéd számozásából
  const ul = [
    res.u[dof(bm.nodeI, 0)]!,
    res.u[dof(bm.nodeI, 1)]!,
    res.u[dof(bm.nodeI, 2)]!,
    res.u[dof(bm.nodeJ, 0)]!,
    res.u[dof(bm.nodeJ, 1)]!,
    res.u[dof(bm.nodeJ, 2)]!,
  ];
  const ax = (1 - xi) * ul[0]! + xi * ul[3]!;
  const theta = (b.y - a.y) / L;
  const phi = (b.x - a.x) / L;
  const v = localTransverseAt(ul, L, xi);
  return {
    x: a.x + xi * (b.x - a.x) + ax * phi - v * theta,
    y: a.y + xi * (b.y - a.y) + ax * theta + v * phi,
  };
}

/** A rúd elmozdulásai a két végén — a csomópontok pozícióinak frissítéséhez. */
export function deformedNode(s: Structure, res: SolveResult, node: number): { x: number; y: number } {
  const n = nodeById(s, node)!;
  return { x: n.x + res.u[dof(node, 0)]!, y: n.y + res.u[dof(node, 1)]! };
}

/**
 * A rúd hajlítási nyomatéka az adott helyen a két vég értékéből lineárisan
 * interpolálva (a vázsolverben a nyomaték a hossz mentén lineáris).
 */
export function momentAt(res: SolveResult, beamId: number, xi: number): number {
  const e = res.elements.find((el) => el.beam === beamId)!;
  return e.M[0]! * (1 - xi) + e.M[1]! * xi;
}

/** A rúd nyíróereje az adott helyen (állandó a rúd mentén, ha nincs koncentrált teher). */
export function shearAt(res: SolveResult, beamId: number): number {
  const e = res.elements.find((el) => el.beam === beamId)!;
  return e.V[0]!;
}

/** A rúd tengelyereje az adott helyen. */
export function axialAt(res: SolveResult, beamId: number, xi: number): number {
  const e = res.elements.find((el) => el.beam === beamId)!;
  return e.N[0]! * (1 - xi) + e.N[1]! * xi;
}
