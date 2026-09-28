import type { MembraneModel, MembraneResult, Node2, QuadElement } from './membrane';

/**
 * A tartós 2D modell: egy négyzögháló (vagy annak része) a síkban, a hozzá
 * tartozó peremfeltételekkel és terhekkel. Ez a dokumentum része, a
 * `Structure.membrane2d` mezőjében él, így együtt mentődik az 1D modellel.
 */
export interface Membrane2D {
  nodes: { x: number; y: number }[];
  /** elemenként 4 csomópont-index, anticlockwise körüljárással */
  elements: number[][];
  /** rögzítések: maszk 1 = ux, 2 = uy, 3 = mindkettő */
  fixed: { node: number; mask: number }[];
  loads: { node: number; fx: number; fy: number }[];
  edgeLoads: { from: number; to: number; t: number }[];
  /** lemezvastagság [m] */
  thickness: number;
  /** a téglalap háló felbontása (elem a szélesség mentén) */
  divisions: number;
}

export function createMembrane2D(thickness = 0.01, divisions = 4): Membrane2D {
  // a tömbök frissen készülnek: a spreadszintű másolás csak a hivatkozást
  // másolná át, és minden példány ugyanazokat a tömböket látná
  return {
    nodes: [],
    elements: [],
    fixed: [],
    loads: [],
    edgeLoads: [],
    thickness,
    divisions,
  };
}

export function cloneMembrane2D(m: Membrane2D): Membrane2D {
  return {
    nodes: m.nodes.map((n) => ({ ...n })),
    elements: m.elements.map((e) => [...e]),
    fixed: m.fixed.map((f) => ({ ...f })),
    loads: m.loads.map((l) => ({ ...l })),
    edgeLoads: m.edgeLoads.map((e) => ({ ...e })),
    thickness: m.thickness,
    divisions: m.divisions,
  };
}

/** téglalap sarokpontok, a rajzoláshoz (bal alsó → jobb felső) */
export function rectCorners(a: { x: number; y: number }, b: { x: number; y: number }): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/**
 * Négyzögháló építése a téglalapra. A meglévő modellt kiegészíti (a háló
 * a rajzban hozzáadódik), a régi csomópontok és elemek megmaradnak.
 * Visszatér az új elemek index-tartománya.
 */
export function addRectMesh(
  m: Membrane2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  divisions = m.divisions,
): { from: number; to: number } {
  const { x0, y0, x1, y1 } = rectCorners(a, b);
  const nx = Math.max(1, Math.round(divisions));
  const ny = nx;
  const first = m.nodes.length;
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) m.nodes.push({ x: x0 + i * dx, y: y0 + j * dy });
  }
  const at = (i: number, j: number): number => first + j * (nx + 1) + i;
  const from = m.elements.length;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // bal alsó, jobb alsó, jobb felső, bal felső → anticlockwise
      m.elements.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return { from, to: m.elements.length };
}

export function membrane2DIsEmpty(m: Membrane2D): boolean {
  return m.elements.length === 0;
}

export function setFixed(m: Membrane2D, node: number, mask: number): void {
  if (mask === 0) {
    m.fixed = m.fixed.filter((f) => f.node !== node);
    return;
  }
  const hit = m.fixed.find((f) => f.node === node);
  if (hit) hit.mask = mask;
  else m.fixed.push({ node, mask });
}

export function fixedMask(m: Membrane2D, node: number): number {
  return m.fixed.find((f) => f.node === node)?.mask ?? 0;
}

/**
 * Csomópont törlése a hozzá kapcsolódó elemekkel, rögzítésekkel és
 * terhekkel. Az elemek és csomópontok sorszámozása megmarad, mert a
 * dokumentumban az ID az index; a felszabaduló helyeken üres elem marad.
 */
export function removeMembraneNode(m: Membrane2D, node: number): void {
  if (node < 0 || node >= m.nodes.length) return;
  m.fixed = m.fixed.filter((f) => f.node !== node);
  m.loads = m.loads.filter((l) => l.node !== node);
  m.edgeLoads = m.edgeLoads.filter((e) => e.from !== node && e.to !== node);
  for (const el of m.elements) {
    for (let k = 0; k < el.length; k++) {
      if (el[k] === node) {
        el.length = 0;
        break;
      }
    }
  }
  m.elements = m.elements.filter((el) => el.length === 4);
  m.nodes = m.nodes.filter((_, i) => i !== node);
  reindexMembrane(m);
}

/** Az üres helyek után újrasorszámozza a csomópontokat és az elemeket. */
function reindexMembrane(m: Membrane2D): void {
  const live = m.nodes.map((_, i) => i).filter((i) => m.elements.some((el) => el.includes(i)));
  const map = new Map<number, number>();
  live.forEach((old, idx) => map.set(old, idx));
  m.nodes = live.map((i) => m.nodes[i]!);
  m.elements = m.elements.map((el) => el.map((n) => map.get(n)!) as [number, number, number, number]);
  m.fixed = m.fixed
    .filter((f) => map.has(f.node))
    .map((f) => ({ node: map.get(f.node)!, mask: f.mask }));
  m.loads = m.loads.filter((l) => map.has(l.node)).map((l) => ({ ...l, node: map.get(l.node)! }));
  m.edgeLoads = m.edgeLoads
    .filter((e) => map.has(e.from) && map.has(e.to))
    .map((e) => ({ ...e, from: map.get(e.from)!, to: map.get(e.to)! }));
}

/** A lemezvastagság és a háló felbontásának beállítása. */
export function setMembraneSize(m: Membrane2D, thickness: number, divisions: number): void {
  m.thickness = thickness > 0 ? thickness : 0.01;
  m.divisions = Math.max(1, Math.min(40, Math.round(divisions)));
}

export function addMembraneLoad(m: Membrane2D, node: number, fx: number, fy: number): void {
  const hit = m.loads.find((l) => l.node === node);
  if (hit) {
    hit.fx = fx;
    hit.fy = fy;
  } else m.loads.push({ node, fx, fy });
}

export function addMembraneEdgeLoad(m: Membrane2D, from: number, to: number, t: number): void {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const hit = m.edgeLoads.find((e) => Math.min(e.from, e.to) === a && Math.max(e.from, e.to) === b);
  if (hit) hit.t = t;
  else m.edgeLoads.push({ from, to, t });
}

/** a dokumentum számsításra átfordítása */
export function toMembraneModel(m: Membrane2D, E: number, nu: number): MembraneModel {
  return {
    nodes: m.nodes.map((n) => ({ x: n.x, y: n.y })),
    elements: m.elements.map((e, id) => ({ id, nodes: e.slice(0, 4) })) as QuadElement[],
    E,
    nu,
    thickness: m.thickness,
    constraints: { fixed: new Map(m.fixed.map((f) => [f.node, f.mask])) },
    loads: m.loads.map((l) => ({ node: l.node, fx: l.fx, fy: l.fy })),
    edgeLoads: m.edgeLoads.map((e) => ({ from: e.from, to: e.to, t: e.t })),
  };
}

/**
 * A modell szerkezeti értelemben rendezett-e: létező csomópontok, négyszögletű
 * elemek szomszédos csomópontokkal, érvényes rögzítések és terhek.
 */
export function membrane2DIsConsistent(m: Membrane2D): boolean {
  const n = m.nodes.length;
  if (!(m.thickness > 0)) return false;
  if (!Number.isInteger(m.divisions) || m.divisions < 1) return false;
  for (const el of m.elements) {
    if (el.length !== 4) return false;
    for (const i of el) if (!Number.isInteger(i) || i < 0 || i >= n) return false;
    // szomszédos csomópontok, és nincs ismétlés
    for (let k = 0; k < 4; k++) {
      const a = el[k]!;
      const b = el[(k + 1) % 4]!;
      if (a === b) return false;
      const na = m.nodes[a]!;
      const nb = m.nodes[b]!;
      if (Math.hypot(nb.x - na.x, nb.y - na.y) < 1e-12) return false;
    }
  }
  for (const f of m.fixed) if (f.node < 0 || f.node >= n) return false;
  for (const l of m.loads) if (l.node < 0 || l.node >= n) return false;
  for (const e of m.edgeLoads) {
    if (e.from < 0 || e.from >= n || e.to < 0 || e.to >= n || e.from === e.to) return false;
  }
  return true;
}

/** a modell minden pontja és mérete a rajzoláshoz */
export function membrane2DBounds(m: Membrane2D): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (m.nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of m.nodes) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function distToSeg(p: { x: number; y: number }, a: Node2, b: Node2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** a legközelebbi csomópont indexe a megadott sugaron belül, különben -1 */
export function nodeNear(m: Membrane2D, p: { x: number; y: number }, tol: number): number {
  let best = -1;
  let bestD = tol;
  for (let i = 0; i < m.nodes.length; i++) {
    const d = Math.hypot(m.nodes[i]!.x - p.x, m.nodes[i]!.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface EdgeHit {
  from: number;
  to: number;
  distance: number;
  /** a világbeli érintőirány egységnyi vektora */
  ux: number;
  uy: number;
}

/** a legközelebbi él (a keresési sugáron belül) */
export function edgeNear(m: Membrane2D, p: { x: number; y: number }, tol: number): EdgeHit | null {
  const seen = new Set<string>();
  let best: EdgeHit | null = null;
  for (const el of m.elements) {
    for (let k = 0; k < 4; k++) {
      const from = el[k]!;
      const to = el[(k + 1) % 4]!;
      const key = from < to ? `${from}-${to}` : `${to}-${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = m.nodes[from]!;
      const b = m.nodes[to]!;
      const d = distToSeg(p, a, b);
      if (d > tol) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-12) continue;
      if (!best || d < best.distance) {
        best = { from, to, distance: d, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
      }
    }
  }
  return best;
}

/** a pont egy elemen belül van-e (sugár a súlypont felé) */
export function elementAt(m: Membrane2D, p: { x: number; y: number }): number {
  for (let i = 0; i < m.elements.length; i++) {
    const el = m.elements[i]!;
    const c = elementCentroid(m, i);
    // sugaras próba: a középpontból a pont irányába induló szakasz
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < 1e-9) return i;
    const far = rayHitQuad(m, el, c, (p.x - c.x) / d, (p.y - c.y) / d);
    if (far !== null && far >= d) return i;
  }
  return -1;
}

function elementCentroid(m: Membrane2D, index: number): { x: number; y: number } {
  const el = m.elements[index]!;
  let x = 0;
  let y = 0;
  for (const i of el) {
    x += m.nodes[i]!.x / 4;
    y += m.nodes[i]!.y / 4;
  }
  return { x, y };
}

/** a centroidból adott irányban a négyszög székháza, vagy null */
function rayHitQuad(
  m: Membrane2D,
  el: number[],
  from: { x: number; y: number },
  dx: number,
  dy: number,
): number | null {
  const pts = el.map((i) => m.nodes[i]!);
  // a négyszög szélei egy félsíkon belül vannak; sík-egyenes metszés
  let best: number | null = null;
  for (let k = 0; k < 4; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % 4]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const s = ((a.x - from.x) * dy - (a.y - from.y) * dx) / den;
    if (t > 1e-12 && s >= -1e-9 && s <= 1 + 1e-9) {
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

/** szerkezeti ellenőrző adatok az üzenetsorhoz */
export function membrane2DStats(
  m: Membrane2D,
  result: MembraneResult | null,
): { nodes: number; elements: number; dof: number; maxVM: number; maxU: number } {
  return {
    nodes: m.nodes.length,
    elements: m.elements.length,
    dof: 2 * m.nodes.length,
    maxVM: result?.ok ? result.maxVonMises : 0,
    maxU: result?.ok ? result.maxU : 0,
  };
}
