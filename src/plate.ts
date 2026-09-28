import { GAUSS, quadJacobian, shapeQ4 } from './membrane';
import type { Node2 } from './membrane';
import { solveLinearSystem } from './linalg';
import type { Matrix } from './linalg';

/**
 * Reissner–Mindlin félemlemez-hajlítási elem: csomópontonként három
 * szabadsági fok — w (normális elmozdulás), θx és θy (forgatás a két
 * in-sik tengely körül). A membránelemmel szemben ez a síkra merőleges
 * kihajlítást is számolja.
 *
 * A nyíróenergia miatt a modell alkalmas a vastag lemezekre is; vékony
 * lemeznél a szelektíven csökkentett integrálás miatt (hajlítás 2×2, nyírás
 * 1×1) nincs nyírózár.
 *
 * Jelölés: a forgatásvektor ω = (θx, θy, 0), a kiterjedés r = (0, 0, z),
 * így u = ω × r + (0, 0, w) = (z·θy, −z·θx, w). Ebből:
 *   γxz = ∂w/∂x + θy,   γyz = ∂w/∂y − θx
 *   κxx = ∂θy/∂x, κyy = −∂θx/∂y, κxy = ∂θy/∂y − ∂θx/∂x
 */
export interface PlateMesh {
  nodes: Node2[];
  elements: { id: number; nodes: [number, number, number, number] }[];
}

/** rögzítések: maszk 1 = w, 2 = θx, 4 = θy */
export interface PlateConstraint {
  node: number;
  /** 1 = w, 2 = θx, 4 = θy */
  mask: number;
}

export interface PlateConstraints {
  fixed: PlateConstraint[];
}

export interface PlateLoad {
  node: number;
  /** normális erő [N] */
  fw: number;
}

/** felületi (nyomó) teher [Pa] egy adott elemen */
export interface PlatePressure {
  element: number;
  p: number;
}

export interface PlateModel extends PlateMesh {
  /** Young-modulus (Pa) */
  E: number;
  /** Poisson-arány */
  nu: number;
  /** lemezvastagság (m) */
  thickness: number;
  constraints: PlateConstraints;
  loads: PlateLoad[];
  pressures: PlatePressure[];
}

export interface PlateCurvature {
  element: number;
  xi: number;
  eta: number;
  /** görbületi alakváltozások [1/m] */
  kxx: number;
  kyy: number;
  kxy: number;
  /** hajlítási momentumok egységnyi szélességre [N·m/m] */
  mxx: number;
  myy: number;
  mxy: number;
  /** a felső és alsó szál feszültsége [Pa] */
  sigmaTop: number;
  sigmaBottom: number;
  /** a legnagyobb abszolút hajlítási feszültség az elem bármely szálán */
  sigmaMax: number;
}

export interface PlateElementResult {
  element: number;
  /** átlagos görbületek az elemben [1/m] */
  kxx: number;
  kyy: number;
  kxy: number;
  /** átlagos hajlítási momentumok [N·m/m] */
  mxx: number;
  myy: number;
  mxy: number;
  /** a legnagyobb feszültség az elem bármely szálán [Pa] */
  sigmaMax: number;
}

export interface PlateResult {
  ok: boolean;
  error?: string;
  /** elmozdulások: 3 szabadsági fok csomópontonként (w, θx, θy) */
  u: number[];
  curvatures: PlateCurvature[];
  elements: PlateElementResult[];
  reactions: { node: number; fw: number; mtx: number; mty: number }[];
  applied: { fw: number };
  reaction: { fw: number };
  dof: { fixed: number; total: number };
  /** legnagyobb normális elmozdulás [m] */
  maxW: number;
  /** a legnagyobb elmozdulással járó csomópont */
  criticalNode: number;
  /** legnagyobb hajlítási feszültség [Pa] */
  maxSigma: number;
  criticalElement: number;
  /** folyáshatár [Pa] — a szerkesztő tölti be az anyagból */
  yield: number;
  utilization: number;
}

/** hajlítási merevség egységnyi szélességre (N·m) */
export function plateRigidity(E: number, nu: number, t: number): number {
  return (E * t * t * t) / (12 * (1 - nu * nu));
}

/** nyírómodulus (Pa) */
export function shearModulus(E: number, nu: number): number {
  return E / (2 * (1 + nu));
}

/** a hajlítási alakváltozás-mátrix (3×12): κxx, κyy, κxy */
function bendingB(dN: number[][], Jinv: number[][]): number[][] {
  const B = Array.from({ length: 3 }, () => new Array(12).fill(0));
  for (let i = 0; i < 4; i++) {
    const gx = dN[i]![0]! * Jinv[0]![0]! + dN[i]![1]! * Jinv[0]![1]!;
    const gy = dN[i]![0]! * Jinv[1]![0]! + dN[i]![1]! * Jinv[1]![1]!;
    const d = 3 * i;
    // dθy/dx, -dθx/dy, dθy/dy - dθx/dx
    B[0]![d + 2]! = gx;
    B[1]![d + 1]! = -gy;
    B[2]![d + 2]! = gy;
    B[2]![d + 1]! = -gx;
  }
  return B;
}

/** a nyírási alakváltozás-mátrix (2×12): γxz, γyz */
/**
 * γxz = ∂w/∂x + θy, γyz = ∂w/∂y − θx
 *
 * A forgatások az alakfüggvényekkel interpoláltak, ezért a B mátrixban a
 * forgatás oszlopához N_i tartozik (Σ N_i = 1), nem 1 — különben a merev
 * test elfordulás nem nulla energiát adna.
 */
function shearB(N: number[], dN: number[][], Jinv: number[][]): number[][] {
  const B = Array.from({ length: 2 }, () => new Array<number>(12).fill(0));
  for (let i = 0; i < 4; i++) {
    const gx = dN[i]![0]! * Jinv[0]![0]! + dN[i]![1]! * Jinv[0]![1]!;
    const gy = dN[i]![0]! * Jinv[1]![0]! + dN[i]![1]! * Jinv[1]![1]!;
    const d = 3 * i;
    B[0]![d]! = gx;
    B[0]![d + 2]! = N[i]!;
    B[1]![d + 1]! = -N[i]!;
    B[1]![d]! = gy;
  }
  return B;
}

function btdb(B: number[][], D: number[][]): Matrix {
  const n = B[0]!.length;
  const K: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < B.length; a++) {
    for (let b = 0; b < B.length; b++) {
      const dab = D[a]![b]!;
      if (dab === 0) continue;
      for (let i = 0; i < n; i++) {
        const v = B[a]![i]! * dab;
        if (v === 0) continue;
        for (let j = 0; j < n; j++) K[i]![j]! += v * B[b]![j]!;
      }
    }
  }
  return K;
}

/**
 * Egy négyzögletű lemezelem 12×12 merevségi mátrixa. Exportálva van, mert
 * ezzel ellenőrizhető a számsítás: ismert alakállapot energiája számolható
 * a K·u·u/2 képlettel, illetve a merev test elmozdulásához nulla energia tartozik.
 */
export function plateElementStiffness(
  nodeCoords: Node2[],
  E: number,
  nu: number,
  t: number,
): Matrix {
  const D = plateRigidity(E, nu, t);
  const G = shearModulus(E, nu);
  const Db: number[][] = [
    [D, D * nu, 0],
    [D * nu, D, 0],
    [0, 0, (D * (1 - nu)) / 2],
  ];
  const Ds: number[][] = [
    [G * t, 0],
    [0, G * t],
  ];
  const ke: Matrix = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (const [xi, eta] of GAUSS) {
    const { dN } = shapeQ4(xi, eta);
    const { det, Jinv } = quadJacobian(nodeCoords, dN);
    const Kb = btdb(bendingB(dN, Jinv), Db);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ke[i]![j]! += Kb[i]![j]! * det;
  }
  {
    const { N, dN } = shapeQ4(0, 0);
    const { det, Jinv } = quadJacobian(nodeCoords, dN);
    const Ks = btdb(shearB(N, dN, Jinv), Ds);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ke[i]![j]! += Ks[i]![j]! * 4 * det;
  }
  return ke;
}

function fail(error: string): PlateResult {
  return {
    ok: false,
    error,
    u: [],
    curvatures: [],
    elements: [],
    reactions: [],
    applied: { fw: 0 },
    reaction: { fw: 0 },
    dof: { fixed: 0, total: 0 },
    maxW: 0,
    criticalNode: -1,
    maxSigma: 0,
    criticalElement: -1,
    yield: 0,
    utilization: 0,
  };
}

/**
 * A lemez számsítása. A hajlítási mátrixot 2×2 Gauss-pontokkal, a nyírót
 * 1 pontban számoljuk (szelektíven csökkentett integrálás): vékony lemeznél
 * így nincs nyírózár, vastag lemeznél pedig a nyíróenergia pontosan számít.
 */
export function solvePlate(m: PlateModel): PlateResult {
  const E = m.E;
  const nu = m.nu;
  const t = m.thickness;
  if (!(E > 0) || !(t > 0)) return fail('Az E és a vastagság legyen pozitív.');
  if (Math.abs(nu) >= 0.5) return fail('A Poisson-arány legyen |ν| < 0,5.');

  const D = plateRigidity(E, nu, t);
  const G = shearModulus(E, nu);
  const Db: number[][] = [
    [D, D * nu, 0],
    [D * nu, D, 0],
    [0, 0, (D * (1 - nu)) / 2],
  ];
  const Ds: number[][] = [
    [G * t, 0],
    [0, G * t],
  ];

  const ndof = 3 * m.nodes.length;
  const K: Matrix = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0));
  const F = new Array<number>(ndof).fill(0);

  for (const el of m.elements) {
    const nodes = el.nodes.map((n) => m.nodes[n]!);
    const ke: Matrix = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
    // szelektíven csökkentett integrálás: a hajlítást 2x2 Gauss-pontokkal,
    // a nyíróenergiát a középpontban számoljuk. A középponti szabály súlya
    // a (-1,1)^2 tartomány területével egyezik meg, tehát 4*det.
    for (const [xi, eta] of GAUSS) {
      const { dN } = shapeQ4(xi, eta);
      const { det, Jinv } = quadJacobian(nodes, dN);
      if (!(Math.abs(det) > 1e-14)) return fail('Zsugorodott vagy fordított elem — a háló nem megfelelő.');
      const Kb = btdb(bendingB(dN, Jinv), Db);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ke[i]![j]! += Kb[i]![j]! * det;
    }
    {
      const { N, dN } = shapeQ4(0, 0);
      const { det, Jinv } = quadJacobian(nodes, dN);
      const Ks = btdb(shearB(N, dN, Jinv), Ds);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ke[i]![j]! += Ks[i]![j]! * 4 * det;
    }
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) K[3 * el.nodes[Math.floor(a / 3)]! + (a % 3)]![
        3 * el.nodes[Math.floor(b / 3)]! + (b % 3)
      ]! += ke[a]![b]!;
    }
  }

  // Felületi nyomóteher: egyenletes p esetén a konzisztens csomópointerő
  // p·∫N_i dA, ami négyzetes elemenre éppen p·det (mivel ∫N_i dA = A/4 = det).
  const press = new Map<number, number>();
  for (const pr of m.pressures) {
    if (pr.p === 0) continue;
    press.set(pr.element, (press.get(pr.element) ?? 0) + pr.p);
  }
  for (const [elId, p] of press) {
    const el = m.elements[elId];
    if (!el) continue;
    const nodes = el.nodes.map((n) => m.nodes[n]!);
    const { det } = quadJacobian(nodes, shapeQ4(0, 0).dN);
    if (!(Math.abs(det) > 1e-14)) return fail('Zsugorodott vagy fordított elem — a háló nem megfelelő.');
    for (let i = 0; i < 4; i++) F[3 * el.nodes[i]!]! -= p * det;
  }
  for (const ld of m.loads) {
    if (ld.node < 0 || ld.node >= m.nodes.length) return fail('A teher csomópontindexe nem létezik.');
    F[3 * ld.node]! += ld.fw;
  }

  const fixed = new Array<number>(ndof).fill(0);
  for (const c of m.constraints.fixed) {
    if (c.node < 0 || c.node >= m.nodes.length) return fail('A rögzítés csomópontindexe nem létezik.');
    for (let d = 0; d < 3; d++) {
      const bit = 1 << d;
      if (c.mask & bit) fixed[3 * c.node + d] = 1;
    }
  }
  let free = 0;
  for (let i = 0; i < ndof; i++) if (!fixed[i]) free++;
  if (free === ndof) return fail('Nincs rögzített csomópont: a szerkezet mechanizmus.');

  const index = new Array<number>(ndof).fill(-1);
  let next = 0;
  for (let i = 0; i < ndof; i++) if (!fixed[i]) index[i] = next++;
  const kff: Matrix = Array.from({ length: free }, () => new Array<number>(free).fill(0));
  const ff = new Array<number>(free).fill(0);
  for (let i = 0; i < ndof; i++) {
    if (fixed[i]) continue;
    ff[index[i]!] = F[i]!;
    for (let j = 0; j < ndof; j++) {
      if (fixed[j]) continue;
      kff[index[i]!]![index[j]!] = K[i]![j]!;
    }
  }

  const sol = solveLinearSystem(kff, ff);
  if (sol.singular) {
    return fail('A merevségi mátrix szingularis — a lemez mechanizmusa nem gátolt.');
  }
  const u = new Array<number>(ndof).fill(0);
  for (let i = 0; i < ndof; i++) if (!fixed[i]) u[i] = sol.x[index[i]!]!;

  // reakciók és egyensúly
  const reactions: PlateResult['reactions'] = [];
  let sumRx = 0;
  const sumFw = F.reduce<number>((a, v) => a + v, 0);
  for (let i = 0; i < ndof; i++) {
    if (!fixed[i]) continue;
    // A reakció a rözgítés által kifejtett erő: a belső merevségi erő és a
    // külső teher különbsége. Ezzel a reakciók összege éppen a terhek
    // összegének ellentettje (globális egyensúly).
    let r = -F[i]!;
    for (let j = 0; j < ndof; j++) r += K[i]![j]! * u[j]!;
    if (Math.abs(r) < 1e-12) continue;
    const n = Math.floor(i / 3);
    const d = i % 3;
    if (d === 0) sumRx += r;
    const cur = reactions.find((x) => x.node === n);
    if (cur) {
      if (d === 0) cur.fw += r;
      else if (d === 1) cur.mtx += r;
      else cur.mty += r;
    } else {
      reactions.push({ node: n, fw: d === 0 ? r : 0, mtx: d === 1 ? r : 0, mty: d === 2 ? r : 0 });
    }
  }

  // feszültség-visszanyerés
  const curvatures: PlateCurvature[] = [];
  const elementResults: PlateElementResult[] = [];
  let maxSigma = 0;
  let criticalElement = -1;
  for (const el of m.elements) {
    const nodes = el.nodes.map((n) => m.nodes[n]!);
    const ue = new Array(12).fill(0);
    for (let i = 0; i < 4; i++) {
      ue[3 * i] = u[3 * el.nodes[i]!]!;
      ue[3 * i + 1] = u[3 * el.nodes[i]! + 1]!;
      ue[3 * i + 2] = u[3 * el.nodes[i]! + 2]!;
    }
    let skxx = 0;
    let skyy = 0;
    let skxy = 0;
    let sSigma = 0;
    for (const [xi, eta] of GAUSS) {
      const { dN } = shapeQ4(xi, eta);
      const { Jinv } = quadJacobian(nodes, dN);
      const B = bendingB(dN, Jinv);
      const k = [0, 0, 0];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 12; b++) k[a] = k[a]! + B[a]![b]! * ue[b]!;
      const mom = [0, 0, 0];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) mom[a] = mom[a]! + Db[a]![b]! * k[b]!;
      // a szálak távolsága a középsíktól: t/2, a feszültség M·(t/2)/I = 6M/t
      const c = 6 / t;
      const sTop = c * (mom[0]! + mom[1]!);
      const sBot = -c * (mom[0]! + mom[1]!);
      const sigmaMax = Math.max(
        Math.abs(sTop),
        Math.abs(sBot),
        Math.abs(c * (mom[0]! - mom[1]!)),
        Math.abs(2 * c * mom[2]!),
      );
      curvatures.push({
        element: el.id,
        xi,
        eta,
        kxx: k[0]!,
        kyy: k[1]!,
        kxy: k[2]!,
        mxx: mom[0]!,
        myy: mom[1]!,
        mxy: mom[2]!,
        sigmaTop: sTop,
        sigmaBottom: sBot,
        sigmaMax,
      });
      skxx += k[0]! / 4;
      skyy += k[1]! / 4;
      skxy += k[2]! / 4;
      if (sigmaMax > sSigma) sSigma = sigmaMax;
      if (sigmaMax > maxSigma) {
        maxSigma = sigmaMax;
        criticalElement = el.id;
      }
    }
    const avgMom = [
      curvatures.filter((c) => c.element === el.id).reduce((a, c) => a + c.mxx, 0) / 4,
      curvatures.filter((c) => c.element === el.id).reduce((a, c) => a + c.myy, 0) / 4,
      curvatures.filter((c) => c.element === el.id).reduce((a, c) => a + c.mxy, 0) / 4,
    ];
    elementResults.push({
      element: el.id,
      kxx: skxx,
      kyy: skyy,
      kxy: skxy,
      mxx: avgMom[0]!,
      myy: avgMom[1]!,
      mxy: avgMom[2]!,
      sigmaMax: sSigma,
    });
  }

  let maxW = 0;
  let criticalNode = -1;
  for (let n = 0; n < m.nodes.length; n++) {
    const w = Math.abs(u[3 * n]!);
    if (w > maxW) {
      maxW = w;
      criticalNode = n;
    }
  }

  return {
    ok: true,
    u,
    curvatures,
    elements: elementResults,
    reactions,
    applied: { fw: sumFw },
    reaction: { fw: sumRx },
    dof: { fixed: ndof - free, total: ndof },
    maxW,
    criticalNode,
    maxSigma,
    criticalElement,
    yield: 0,
    utilization: 0,
  };
}
