export interface Point {
  x: number;
  y: number;
}

export interface Node extends Point {
  id: number;
}

export interface Beam {
  id: number;
  nodeI: number;
  nodeJ: number;
}

export interface Structure {
  nodes: Node[];
  beams: Beam[];
}

export function createStructure(): Structure {
  return { nodes: [], beams: [] };
}

export function addNode(s: Structure, x: number, y: number): number {
  s.nodes.push({ id: s.nodes.length, x, y });
  return s.nodes.length - 1;
}

export function nodeById(s: Structure, id: number): Node | undefined {
  return s.nodes.find((n) => n.id === id);
}

/** Csak érvényes, nem önismétlő rúd jöhet létre (nulla hossz vagy duplikátum esetén null). */
export function addBeam(s: Structure, nodeI: number, nodeJ: number): Beam | null {
  if (nodeI === nodeJ) return null;
  if (!nodeById(s, nodeI) || !nodeById(s, nodeJ)) return null;
  if (findBeamBetween(s, nodeI, nodeJ)) return null;
  const beam: Beam = { id: s.beams.length, nodeI, nodeJ };
  s.beams.push(beam);
  return beam;
}

export function findBeamBetween(s: Structure, a: number, b: number): Beam | undefined {
  return s.beams.find(
    (bm) => (bm.nodeI === a && bm.nodeJ === b) || (bm.nodeI === b && bm.nodeJ === a),
  );
}

export function removeBeam(s: Structure, beamId: number): void {
  const idx = s.beams.findIndex((bm) => bm.id === beamId);
  if (idx < 0) return;
  s.beams.splice(idx, 1);
  reindexBeams(s);
}

/**
 * Csomópont törlése a kapcsolódó rudakkal együtt. Az azonosítókat újraszámozza,
 * hogy a `node.id === index` és `beam.id === index` invariáns megmaradjon (a FEM
 * szolver erre a sorszámozásra épül).
 */
export function removeNode(s: Structure, nodeId: number): void {
  const idx = s.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return;
  s.nodes.splice(idx, 1);
  const remap = (id: number): number => (id > nodeId ? id - 1 : id);
  s.beams = s.beams
    .filter((bm) => bm.nodeI !== nodeId && bm.nodeJ !== nodeId)
    .map((bm) => {
      const i = remap(bm.nodeI);
      const j = remap(bm.nodeJ);
      return { id: bm.id, nodeI: Math.min(i, j), nodeJ: Math.max(i, j) };
    });
  s.nodes.forEach((n, i) => {
    n.id = i;
  });
  reindexBeams(s);
}

function reindexBeams(s: Structure): void {
  s.beams.forEach((bm, i) => {
    bm.id = i;
  });
}

export function moveNode(s: Structure, nodeId: number, x: number, y: number): void {
  const n = nodeById(s, nodeId);
  if (!n) return;
  n.x = x;
  n.y = y;
}

export function beamLength(s: Structure, beam: Beam): number {
  const a = nodeById(s, beam.nodeI);
  const b = nodeById(s, beam.nodeJ);
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function totalLength(s: Structure): number {
  return s.beams.reduce((sum, bm) => sum + beamLength(s, bm), 0);
}

export function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function findNodeNear(s: Structure, p: Point, tol: number): Node | undefined {
  let best: Node | undefined;
  let bestD = tol;
  for (const n of s.nodes) {
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function findBeamNear(s: Structure, p: Point, tol: number): Beam | undefined {
  let best: Beam | undefined;
  let bestD = tol;
  for (const bm of s.beams) {
    const a = nodeById(s, bm.nodeI);
    const b = nodeById(s, bm.nodeJ);
    if (!a || !b) continue;
    const d = pointToSegmentDist(p, a, b);
    if (d <= bestD) {
      bestD = d;
      best = bm;
    }
  }
  return best;
}

export function snap(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

export function snapPoint(p: Point, step: number): Point {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}

export function structureIsConsistent(s: Structure): boolean {
  if (s.nodes.some((n, i) => n.id !== i)) return false;
  if (s.beams.some((bm, i) => bm.id !== i)) return false;
  for (const bm of s.beams) {
    if (bm.nodeI === bm.nodeJ) return false;
    if (!nodeById(s, bm.nodeI) || !nodeById(s, bm.nodeJ)) return false;
  }
  return true;
}

export function cloneStructure(s: Structure): Structure {
  return {
    nodes: s.nodes.map((n) => ({ ...n })),
    beams: s.beams.map((bm) => ({ ...bm })),
  };
}

export interface SerializedStructure {
  version: 1;
  nodes: Point[];
  beams: { nodeI: number; nodeJ: number }[];
}

export function toJSON(s: Structure): SerializedStructure {
  return {
    version: 1,
    nodes: s.nodes.map((n) => ({ x: n.x, y: n.y })),
    beams: s.beams.map((bm) => ({ nodeI: bm.nodeI, nodeJ: bm.nodeJ })),
  };
}

export function fromJSON(data: SerializedStructure): Structure {
  const s = createStructure();
  for (const p of data.nodes) addNode(s, p.x, p.y);
  for (const bm of data.beams) addBeam(s, bm.nodeI, bm.nodeJ);
  return s;
}
