/**
 * Négyszögletű (Q4) síkruszalmassági elem — a szerkezet saját síkjában nyúlik.
 *
 * A modell 2 szabadsági fokot használ csomópontonként (ux, uy); a lemezvastagság
 * a merevségi mátrixban és a feszültségekben jelenik meg, a keresztmetszeti
 * súlypont a csomópontokban van. Ez a MEMBRÁN modell: kiszámolja a síkbeli
 * feszültségeket (σxx, σyy, τxy), de NEM a síkra merőleges kihajlást — ahhoz
 * három szabadsági fokos (w, θx, θy) lemezelem kell.
 *
 * Az integrálás 2x2-es Gauss-pontokkal történik; síkbeli nyúlásnál nincs
 * locking, és a nyíróenergiát is jól közelíti (az 1 pontos integrálás ezt
 * elhanyagolná).
 */
import { solveLinearSystem } from './linalg';

export interface Node2 {
  x: number;
  y: number;
}

/** Négyszögletű elem: 4 csomópont, körüljárási sorrendben (anticlockwise). */
export interface QuadElement {
  id: number;
  nodes: [number, number, number, number];
}

export interface MembraneMesh {
  nodes: Node2[];
  elements: QuadElement[];
}

export interface MembraneLoad {
  node: number;
  fx: number;
  fy: number;
}

/** Él menti vonallinére teher (N/m); a megadott végpontok határozzák meg az élt. */
export interface EdgeLoad {
  from: number;
  to: number;
  /**
   * a teher a szegmensre merőleges, előjeles komponense az élre merőleges irányban;
   * a pozitív előjel kifelé húz (t = σ·n), anticlockwise elemhálónál a
   * from→to szegmens -90°-os forgatásával kapott normális mentén
   */
  t: number;
}

export interface MembraneConstraints {
  /** rögzített csomópontok és szabadsági fokjaik: bit 1 = ux, bit 2 = uy */
  fixed: Map<number, number>;
}

export interface MembraneModel extends MembraneMesh {
  /** Young-modulus (Pa) */
  E: number;
  /** Poisson-arány */
  nu: number;
  /** lemezvastagság (m) */
  thickness: number;
  constraints: MembraneConstraints;
  loads: MembraneLoad[];
  edgeLoads: EdgeLoad[];
}

export interface MembraneStress {
  element: number;
  /** Gauss-pont helye a referencia-rendszerben */
  xi: number;
  eta: number;
  /** feszültségek a világ-x, világ-y és nyírtengelyben (Pa) */
  sxx: number;
  syy: number;
  sxy: number;
  /** fősajtos feszültségek (Pa) */
  s1: number;
  s2: number;
  /** egyenérték (von Mises) feszültség (Pa) */
  vonMises: number;
}

export interface QuadResult {
  element: number;
  /** átlagos feszültségek az elemben (Pa) */
  sxx: number;
  syy: number;
  sxy: number;
  vonMises: number;
  /** a legnagyobb egyenérték feszültség Gauss-pontjai között (Pa) */
  vonMisesMax: number;
}

export interface MembraneResult {
  ok: boolean;
  error?: string;
  /** elmozdulások: 2 szabadsági fok csomópontonként */
  u: number[];
  stresses: MembraneStress[];
  elements: QuadResult[];
  reactions: { node: number; fx: number; fy: number }[];
  applied: { fx: number; fy: number };
  reaction: { fx: number; fy: number };
  maxU: number;
  maxVonMises: number;
  maxSxx: number;
  maxSyy: number;
  maxSxy: number;
  dof: { fixed: number; total: number };
  forceBalance: { error: number; appliedFx: number };
  /** folyáshatár [Pa] */
  yield: number;
  /** kihasználtság: max |σ| / f_yd */
  utilization: number;
  /** a meghatározó elem a legnagyobb egyenérték feszültségnél */
  criticalElement: number;
}

/**
 * A síkrugalmassági (plane stress) alakfüggvény-mátrix. A vastagság itt nem
 * szerepel: a feszültségek a síkban értendők, ezért a mátrix dimenziója Pa.
 */
export function planeStressStiffness(E: number, nu: number, t: number): number[][] {
  const c = E / (1 - nu * nu);
  const k = c * t;
  return [
    [k, k * nu, 0],
    [k * nu, k, 0],
    [0, 0, k * (1 - nu) / 2],
  ];
}

/** hajlítási merevség (Pa·m³) — a vékonylemez-képlet, referenciaként */
export function membraneSectionRigidity(E: number, nu: number, t: number): number {
  return (E * t * t * t) / (12 * (1 - nu * nu));
}

const GP = 1 / Math.sqrt(3);

/** a 2x2-es Gauss-szabály pontjai és súlyai */
export const GAUSS: [number, number][] = [
  [-GP, -GP],
  [GP, -GP],
  [GP, GP],
  [-GP, GP],
];

/** a Q4 elem alakfüggvényei és deriváltjai a (xi, eta) pontban */
export function shapeQ4(xi: number, eta: number): { N: number[]; dN: number[][] } {
  const N = [
    ((1 - xi) * (1 - eta)) / 4,
    ((1 + xi) * (1 - eta)) / 4,
    ((1 + xi) * (1 + eta)) / 4,
    ((1 - xi) * (1 + eta)) / 4,
  ];
  const dN = [
    [-(1 - eta) / 4, -(1 - xi) / 4],
    [(1 - eta) / 4, -(1 + xi) / 4],
    [(1 + eta) / 4, (1 + xi) / 4],
    [-(1 + eta) / 4, (1 - xi) / 4],
  ];
  return { N, dN };
}

/**
 * az elem B-mátrixa (3 x 8) a megadott referencia-pontban, a világkoordinátákból
 * számított Jacobian transzformáltjával együtt
 */
function bMatrix(dN: number[][], Jinv: number[][]): number[][] {
  const B = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const gx = dN[i]![0]! * Jinv[0]![0]! + dN[i]![1]! * Jinv[0]![1]!;
    const gy = dN[i]![0]! * Jinv[1]![0]! + dN[i]![1]! * Jinv[1]![1]!;
    B[0]![2 * i] = gx;
    B[1]![2 * i + 1] = gy;
    B[2]![2 * i] = gy;
    B[2]![2 * i + 1] = gx;
  }
  return B;
}

function jacobian(
  nodes: Node2[],
  dN: number[][],
): { J: number[][]; det: number; Jinv: number[][] } {
  const J = [
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 4; i++) {
    J[0]![0]! += dN[i]![0]! * nodes[i]!.x;
    J[0]![1]! += dN[i]![0]! * nodes[i]!.y;
    J[1]![0]! += dN[i]![1]! * nodes[i]!.x;
    J[1]![1]! += dN[i]![1]! * nodes[i]!.y;
  }
  const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!;
  const Jinv = [
    [J[1]![1]! / det, -J[0]![1]! / det],
    [-J[1]![0]! / det, J[0]![0]! / det],
  ];
  return { J, det, Jinv };
}

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

/** a síkbeli lemez megoldása */
export function solveMembrane(m: MembraneModel): MembraneResult {
  const fail = (error: string): MembraneResult => ({
    ok: false,
    error,
    u: [],
    stresses: [],
    elements: [],
    reactions: [],
    applied: { fx: 0, fy: 0 },
    reaction: { fx: 0, fy: 0 },
    maxU: 0,
    maxVonMises: 0,
    maxSxx: 0,
    maxSyy: 0,
    maxSxy: 0,
    dof: { fixed: 0, total: 0 },
    forceBalance: { error: 0, appliedFx: 0 },
    yield: 0,
    utilization: 0,
    criticalElement: -1,
  });

  if (m.nodes.length < 4) return fail('A lemezhez legalább 4 csomópont kell.');
  if (m.elements.length === 0) return fail('Nincs lemezelem a modellben.');
  if (!(m.E > 0)) return fail('A Young-modulus nem lehet nulla vagy negatív.');
  if (!(m.thickness > 0)) return fail('A lemezvastagság nem lehet nulla vagy negatív.');
  if (!(m.nu > -1 && m.nu < 0.5)) return fail('A Poisson-arány -1 és 0,5 közé eshet.');

  const ndof = 2 * m.nodes.length;
  const D = planeStressStiffness(m.E, m.nu, 1);

  // 1. Globális merevségi mátrix — 2x2-es Gauss-integrálással
  const K: number[][] = Array.from({ length: ndof }, () => zeros(ndof));
  for (const el of m.elements) {
    const nodes = el.nodes.map((i) => m.nodes[i]!);
    if (nodes.length !== 4) return fail('A négyszögletű elemnek 4 csomópontja kell (Q4).');
    let positive = true;
    for (const [xi, eta] of GAUSS) {
      const { dN } = shapeQ4(xi, eta);
      const { det, Jinv } = jacobian(nodes, dN);
      if (!(det > 0)) positive = false;
      const B = bMatrix(dN, Jinv);
      // a súly 1 minden Gauss-pontban; a térfogati elem detJ * t
      const k = det * m.thickness;
      for (let i = 0; i < 8; i++) {
        const gi = 2 * el.nodes[Math.floor(i / 2)]! + (i % 2);
        for (let j = 0; j < 8; j++) {
          const gj = 2 * el.nodes[Math.floor(j / 2)]! + (j % 2);
          let sum = 0;
          for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) sum += B[a]![i]! * D[a]![b]! * B[b]![j]!;
          }
          K[gi]![gj] = K[gi]![gj]! + sum * k;
        }
      }
    }
    if (!positive) return fail('Zsugorodott vagy fordított elem — ellenőrizd a körüljárási sorrendet.');
  }

  // 2. Terhelési vektor
  const F = zeros(ndof);
  const applied = { fx: 0, fy: 0 };
  for (const ld of m.loads) {
    if (ld.node < 0 || ld.node >= m.nodes.length) continue;
    F[2 * ld.node]! += ld.fx;
    F[2 * ld.node + 1]! += ld.fy;
    applied.fx += ld.fx;
    applied.fy += ld.fy;
  }
  // az élteherek egy élre csak egyszer kerülnek rá: egy belső él két elemhez is
  // tartozik, ezért a feldolgozott élcsomópont-párokat kizárózzuk
  const doneEdges = new Set<string>();
  for (const e of m.edgeLoads) {
    // az élnek két szomszédos csomópontja kell lennie valamelyik elemben
    if (e.from < 0 || e.from >= m.nodes.length) continue;
    if (e.to < 0 || e.to >= m.nodes.length) continue;
    const a = m.nodes[e.from]!;
    const b = m.nodes[e.to]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const exists = m.elements.some((el) => {
      const i0 = el.nodes.indexOf(e.from);
      if (i0 < 0) return false;
      return el.nodes[(i0 + 1) % 4] === e.to || el.nodes[(i0 + 3) % 4] === e.to;
    });
    if (!exists) continue;
    const key = e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`;
    if (doneEdges.has(key)) continue;
    doneEdges.add(key);
    // Az élre merőleges egységnyi irány: a from→to iránynak a -90°-os
    // forgatása. Anticlockwise körüljárású elemhálónál ez a kifelé mutató
    // normális, tehát a pozitív t a lemezből kifelé húz (t = σ·n).
    const nx = (b.y - a.y) / len;
    const ny = -(b.x - a.x) / len;
    const fx = nx * e.t * len;
    const fy = ny * e.t * len;
    // egy egyenletes, t hosszanti értékű élteher a két csomópont között
    // lineárisan oszlik meg: mindkettőre f/2, ahol f = t * len
    F[2 * e.from]! += fx / 2;
    F[2 * e.from + 1]! += fy / 2;
    F[2 * e.to]! += fx / 2;
    F[2 * e.to + 1]! += fy / 2;
    applied.fx += fx;
    applied.fy += fy;
  }

  // 3. Megoldás a szabad szabadsági fokokon
  const fixed = zeros(ndof);
  let free = 0;
  for (const [node, mask] of m.constraints.fixed) {
    if (node < 0 || node >= m.nodes.length) continue;
    for (let d = 0; d < 2; d++) {
      if (mask & (1 << d)) fixed[2 * node + d] = 1;
    }
  }
  for (let i = 0; i < ndof; i++) if (!fixed[i]) free++;
  if (free === 0) return fail('Minden szabadsági fok rögzített — nincs mit számolni.');
  if (free === ndof) return fail('Nincs rögzített csomópont: a szerkezet mechanizmus.');

  const index = new Array<number>(ndof).fill(-1);
  let next = 0;
  for (let i = 0; i < ndof; i++) if (!fixed[i]) index[i] = next++;
  const Kr: number[][] = Array.from({ length: free }, () => zeros(free));
  const Fr = zeros(free);
  for (let i = 0; i < ndof; i++) {
    const ri = index[i]!;
    if (ri < 0) continue;
    Fr[ri] = F[i]!;
    for (let j = 0; j < ndof; j++) {
      const rj = index[j]!;
      if (rj < 0) continue;
      Kr[ri]![rj] = K[i]![j]!;
    }
  }
  const solved = solveLinearSystem(Kr, Fr);
  if (solved.singular) return fail('A merevségi mátrix szingularis — a szerkezet nem állhat meg.');

  const u = zeros(ndof);
  for (let i = 0; i < ndof; i++) {
    const ri = index[i]!;
    if (ri >= 0) u[i] = solved.x[ri]!;
  }

  // 4. Reakciók
  const reactions: { node: number; fx: number; fy: number }[] = [];
  const reaction = { fx: 0, fy: 0 };
  for (const [node, mask] of m.constraints.fixed) {
    if (node < 0 || node >= m.nodes.length) continue;
    const fx = mask & 1 ? K[2 * node]!.reduce((t, v, j) => t + v * u[j]!, 0) - F[2 * node]! : 0;
    const fy = mask & 2 ? K[2 * node + 1]!.reduce((t, v, j) => t + v * u[j]!, 0) - F[2 * node + 1]! : 0;
    reactions.push({ node, fx, fy });
    reaction.fx += fx;
    reaction.fy += fy;
  }

  // 5. Feszültségek 2x2 Gauss-pontokon
  const stresses: MembraneStress[] = [];
  const elementResults: QuadResult[] = [];
  let maxVonMises = 0;
  let criticalElement = -1;
  const gauss = GAUSS;
  for (const el of m.elements) {
    const nodes = el.nodes.map((i) => m.nodes[i]!);
    const ulg: number[] = [];
    for (const i of el.nodes) ulg.push(u[2 * i]!, u[2 * i + 1]!);
    let sumSxx = 0;
    let sumSyy = 0;
    let sumSxy = 0;
    let sumVm = 0;
    let maxVm = 0;
    for (const [xi, eta] of gauss) {
      const { dN } = shapeQ4(xi, eta);
      const { Jinv } = jacobian(nodes, dN);
      const B = bMatrix(dN, Jinv);
      // alakváltozások, majd a Hooke-törvény: ε = B·u, σ = D·ε
      const eps = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        let s = 0;
        for (let k = 0; k < 8; k++) s += B[a]![k]! * ulg[k]!;
        eps[a] = s;
      }
      const s: number[] = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) s[a] = (s[a] ?? 0) + D[a]![b]! * eps[b]!;
      }
      const [sxx, syy, sxy] = [s[0]!, s[1]!, s[2]!];
      // fősajtos feszültségek és az egyenérték feszültség
      const c = (sxx + syy) / 2;
      const r = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
      const vm = Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy);
      stresses.push({ element: el.id, xi, eta, sxx, syy, sxy, s1: c + r, s2: c - r, vonMises: vm });
      sumSxx += sxx / 4;
      sumSyy += syy / 4;
      sumSxy += sxy / 4;
      sumVm += vm / 4;
      if (vm > maxVm) maxVm = vm;
      if (vm > maxVonMises) {
        maxVonMises = vm;
        criticalElement = el.id;
      }
    }
    elementResults.push({
      element: el.id,
      sxx: sumSxx,
      syy: sumSyy,
      sxy: sumSxy,
      vonMises: sumVm,
      vonMisesMax: maxVm,
    });
  }

  let maxU = 0;
  for (let n = 0; n < m.nodes.length; n++) {
    maxU = Math.max(maxU, Math.hypot(u[2 * n]!, u[2 * n + 1]!));
  }

  return {
    ok: true,
    u,
    stresses,
    elements: elementResults,
    reactions,
    applied,
    reaction,
    maxU,
    maxVonMises,
    maxSxx: elementResults.reduce((mx, e) => Math.max(mx, Math.abs(e.sxx)), 0),
    maxSyy: elementResults.reduce((mx, e) => Math.max(mx, Math.abs(e.syy)), 0),
    maxSxy: elementResults.reduce((mx, e) => Math.max(mx, Math.abs(e.sxy)), 0),
    dof: { fixed: ndof - free, total: ndof },
    forceBalance: { error: Math.abs(applied.fx - reaction.fx) + Math.abs(applied.fy - reaction.fy), appliedFx: applied.fx },
    yield: 0,
    utilization: 0,
    criticalElement,
  };
}
