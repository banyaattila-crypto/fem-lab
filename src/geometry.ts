import { cloneCatalog, defaultCatalog, materialById, sectionById, sectionProps } from './catalog';
import type { Catalog, Material, Section } from './catalog';
import { cloneMembrane2D, createMembrane2D } from './membrane2d';
import type { Membrane2D } from './membrane2d';

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
  materialId: string;
  sectionId: string;
}

export type SupportType = 'pinned' | 'roller' | 'fixed';

export interface Support {
  node: number;
  type: SupportType;
}

/** Koncentrált teher egy csomópontban: erő (N) és nyomaték (N·m). */
/**
 * Terheléscsoport: `dead` = állandó (önsúly, saját súly, földnyomás),
 * `live` = változó (hasznos teher, szél, hó). A terheléskombinációk ezekre
 * külön parancsszorzót adnak.
 */
export type LoadGroup = 'dead' | 'live';

export interface PointLoad {
  id: number;
  node: number;
  fx: number;
  fy: number;
  mz: number;
  group: LoadGroup;
}

/** Megoszló teher egy rúdon: q y irányú vonallinére erő (N/m), pozitív = felfelé. */
export interface DistLoad {
  id: number;
  beam: number;
  qy: number;
  group: LoadGroup;
}

export interface Structure {
  nodes: Node[];
  beams: Beam[];
  supports: Support[];
  loads: PointLoad[];
  distLoads: DistLoad[];
  /** Az önsúly a szolverben külön opció — tároljuk, hogy a fájl hordozza. */
  selfWeight: boolean;
  catalog: Catalog;
  /**
   * A 2D membránmodell. Opcionális, hogy a 1D dokumentumok továbbra is
   * érvényesek legyenek; a `toJSON` csak akkor írja ki, ha van tartalma.
   */
  membrane2d?: Membrane2D;
}

export function createStructure(): Structure {
  return {
    nodes: [],
    beams: [],
    supports: [],
    loads: [],
    distLoads: [],
    selfWeight: false,
    catalog: defaultCatalog(),
    membrane2d: undefined,
  };
}

/** Első katalógusbejegyzés az alapértelmezett (új rúd ezt kapja). */
export function defaultMaterialId(s: Structure): string {
  return s.catalog.materials[0]?.id ?? '';
}

export function defaultSectionId(s: Structure): string {
  return s.catalog.sections[1]?.id ?? s.catalog.sections[0]?.id ?? '';
}

export function addNode(s: Structure, x: number, y: number): number {
  s.nodes.push({ id: s.nodes.length, x, y });
  return s.nodes.length - 1;
}

export function nodeById(s: Structure, id: number): Node | undefined {
  return s.nodes.find((n) => n.id === id);
}

/** Csak érvényes, nem önismétlő rúd jöhet létre (nulla hossz vagy duplikátum esetén null). */
export function addBeam(
  s: Structure,
  nodeI: number,
  nodeJ: number,
  materialId?: string,
  sectionId?: string,
): Beam | null {
  if (nodeI === nodeJ) return null;
  if (!nodeById(s, nodeI) || !nodeById(s, nodeJ)) return null;
  if (findBeamBetween(s, nodeI, nodeJ)) return null;
  // ismeretlen katalógus-hivatkozás esetén az alapértelmezett jön létre, hogy a
  // `structureIsConsistent` soha ne bukjon el import miatt
  const mat = materialId && materialById(s.catalog, materialId) ? materialId : defaultMaterialId(s);
  const sec = sectionId && sectionById(s.catalog, sectionId) ? sectionId : defaultSectionId(s);
  const beam: Beam = { id: s.beams.length, nodeI, nodeJ, materialId: mat, sectionId: sec };
  s.beams.push(beam);
  return beam;
}

/** Kijelölt rudak anyag/szelvény rendelése; ismeretlen id esetén nem csinál semmit. */
export function assignBeams(
  s: Structure,
  beamIds: number[],
  materialId: string,
  sectionId: string,
): number {
  const mat = materialById(s.catalog, materialId);
  const sec = sectionById(s.catalog, sectionId);
  if (!mat || !sec) return 0;
  let n = 0;
  for (const id of beamIds) {
    const bm = s.beams.find((b) => b.id === id);
    if (!bm) continue;
    bm.materialId = mat.id;
    bm.sectionId = sec.id;
    n += 1;
  }
  return n;
}

/** A rúd keresztmetszeti jellemzői a katalógusból (A m², I m⁴). */
export function beamSection(s: Structure, beam: Beam): { A: number; I: number } | null {
  const sec = sectionById(s.catalog, beam.sectionId);
  if (!sec) return null;
  const p = sectionProps(sec);
  return { A: p.A, I: p.I };
}

export function beamMaterial(s: Structure, beam: Beam) {
  return materialById(s.catalog, beam.materialId);
}

/** A teljes szerkezet tömege (kg) és súlya (kN) — a méretjegyzék alapján. */
export function massAndWeight(s: Structure): { mass: number; weight: number } {
  let mass = 0;
  for (const bm of s.beams) {
    const mat = beamMaterial(s, bm);
    const sec = beamSection(s, bm);
    if (!mat || !sec) continue;
    mass += sec.A * beamLength(s, bm) * mat.rho;
  }
  return { mass, weight: (mass * 9.81) / 1000 };
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
  s.distLoads = s.distLoads
    .filter((dl) => dl.beam !== beamId)
    .map((dl, i) => ({ ...dl, id: i, beam: dl.beam > beamId ? dl.beam - 1 : dl.beam }));
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
  const kept = s.beams.filter((bm) => bm.nodeI !== nodeId && bm.nodeJ !== nodeId);
  const newIndex = new Map<number, number>();
  kept.forEach((bm, i) => newIndex.set(bm.id, i));
  s.beams = kept.map((bm) => {
    const i = remap(bm.nodeI);
    const j = remap(bm.nodeJ);
    return { ...bm, id: 0, nodeI: Math.min(i, j), nodeJ: Math.max(i, j) };
  });
  s.supports = s.supports
    .filter((sp) => sp.node !== nodeId)
    .map((sp) => ({ ...sp, node: remap(sp.node) }));
  s.loads = s.loads
    .filter((ld) => ld.node !== nodeId)
    .map((ld, i) => ({ ...ld, id: i, node: remap(ld.node) }));
  s.distLoads = s.distLoads
    .filter((dl) => newIndex.has(dl.beam))
    .map((dl, i) => ({ ...dl, id: i, beam: newIndex.get(dl.beam) as number }));
  s.nodes.forEach((n, i) => {
    n.id = i;
  });
  s.beams.forEach((b, i) => {
    b.id = i;
  });
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

export function supportAt(s: Structure, nodeId: number): Support | undefined {
  return s.supports.find((sp) => sp.node === nodeId);
}

/** Egy csomóponton csak egy támasz lehet; az új lerakás felülírja a régit. */
export function setSupport(s: Structure, nodeId: number, type: SupportType): Support | null {
  if (!nodeById(s, nodeId)) return null;
  s.supports = s.supports.filter((sp) => sp.node !== nodeId);
  const sp: Support = { node: nodeId, type };
  s.supports.push(sp);
  return sp;
}

export function removeSupport(s: Structure, nodeId: number): void {
  s.supports = s.supports.filter((sp) => sp.node !== nodeId);
}

export function addPointLoad(
  s: Structure,
  nodeId: number,
  fx: number,
  fy: number,
  mz: number,
  group: LoadGroup = 'dead',
): PointLoad | null {
  if (!nodeById(s, nodeId)) return null;
  if (fx === 0 && fy === 0 && mz === 0) return null;
  const load: PointLoad = { id: s.loads.length, node: nodeId, fx, fy, mz, group };
  s.loads.push(load);
  return load;
}

export function removePointLoad(s: Structure, loadId: number): void {
  const idx = s.loads.findIndex((ld) => ld.id === loadId);
  if (idx < 0) return;
  s.loads.splice(idx, 1);
  s.loads.forEach((ld, i) => {
    ld.id = i;
  });
}

export function addDistLoad(
  s: Structure,
  beamId: number,
  qy: number,
  group: LoadGroup = 'dead',
): DistLoad | null {
  if (!s.beams.some((bm) => bm.id === beamId)) return null;
  if (qy === 0) return null;
  const dl: DistLoad = { id: s.distLoads.length, beam: beamId, qy, group };
  s.distLoads.push(dl);
  return dl;
}

export function removeDistLoad(s: Structure, distId: number): void {
  const idx = s.distLoads.findIndex((dl) => dl.id === distId);
  if (idx < 0) return;
  s.distLoads.splice(idx, 1);
  s.distLoads.forEach((dl, i) => {
    dl.id = i;
  });
}

/** Támaszszám: a szolver kényszeti feltételeinek darabszáma. */
export function supportCount(s: Structure): number {
  return s.supports.length;
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
  if (s.loads.some((ld, i) => ld.id !== i)) return false;
  if (s.distLoads.some((dl, i) => dl.id !== i)) return false;
  for (const bm of s.beams) {
    if (bm.nodeI === bm.nodeJ) return false;
    if (!nodeById(s, bm.nodeI) || !nodeById(s, bm.nodeJ)) return false;
    if (!materialById(s.catalog, bm.materialId)) return false;
    if (!sectionById(s.catalog, bm.sectionId)) return false;
  }
  for (const sp of s.supports) {
    if (!nodeById(s, sp.node)) return false;
  }
  if (new Set(s.supports.map((sp) => sp.node)).size !== s.supports.length) return false;
  for (const ld of s.loads) {
    if (!nodeById(s, ld.node)) return false;
  }
  for (const dl of s.distLoads) {
    if (!s.beams.some((bm) => bm.id === dl.beam)) return false;
  }
  return true;
}

export function cloneStructure(s: Structure): Structure {
  return {
    membrane2d: s.membrane2d ? cloneMembrane2D(s.membrane2d) : undefined,
    nodes: s.nodes.map((n) => ({ ...n })),
    beams: s.beams.map((bm) => ({ ...bm })),
    supports: s.supports.map((sp) => ({ ...sp })),
    loads: s.loads.map((ld) => ({ ...ld })),
    distLoads: s.distLoads.map((dl) => ({ ...dl })),
    selfWeight: s.selfWeight,
    catalog: cloneCatalog(s.catalog),
  };
}

export interface SerializedBeam {
  nodeI: number;
  nodeJ: number;
  materialId?: string;
  sectionId?: string;
}

export interface SerializedStructure {
  version: 1 | 2;
  nodes: Point[];
  beams: SerializedBeam[];
  supports?: { node: number; type: SupportType }[];
  loads?: { node: number; fx: number; fy: number; mz: number; group?: LoadGroup }[];
  distLoads?: { beam: number; qy: number; group?: LoadGroup }[];
  selfWeight?: boolean;
  materials?: Material[];
  sections?: Section[];
  /** a 2D membránmodell — 2. verziójú fájlokban opcionális */
  membrane2d?: Membrane2D;
}

export function toJSON(s: Structure): SerializedStructure {
  const out: SerializedStructure = {
    version: 2,
    nodes: s.nodes.map((n) => ({ x: n.x, y: n.y })),
    beams: s.beams.map((bm) => ({
      nodeI: bm.nodeI,
      nodeJ: bm.nodeJ,
      materialId: bm.materialId,
      sectionId: bm.sectionId,
    })),
    supports: s.supports.map((sp) => ({ node: sp.node, type: sp.type })),
    loads: s.loads.map((ld) => ({
      node: ld.node,
      fx: ld.fx,
      fy: ld.fy,
      mz: ld.mz,
      group: ld.group,
    })),
    distLoads: s.distLoads.map((dl) => ({ beam: dl.beam, qy: dl.qy, group: dl.group })),
    selfWeight: s.selfWeight,
    materials: s.catalog.materials.map((m) => ({ ...m })),
    sections: s.catalog.sections.map((sec) => ({ ...sec })),
  };
  if (s.membrane2d && s.membrane2d.elements.length > 0) out.membrane2d = cloneMembrane2D(s.membrane2d);
  return out;
}

export function fromJSON(data: SerializedStructure): Structure {
  const s = createStructure();
  // 1. verziójú fájloknál a beépített alapkatalógus és az alapértelmezett
  // anyag/szelvény kell, a hiányzó mezőket ez pótolja
  if (data.materials?.length) s.catalog.materials = data.materials.map((m) => ({ ...m }));
  if (data.sections?.length) s.catalog.sections = data.sections.map((sec) => ({ ...sec }));
  s.selfWeight = data.selfWeight ?? false;
  for (const p of data.nodes) addNode(s, p.x, p.y);
  for (const bm of data.beams) addBeam(s, bm.nodeI, bm.nodeJ, bm.materialId, bm.sectionId);
  for (const sp of data.supports ?? []) setSupport(s, sp.node, sp.type);
  // a csoport hiánya 1. verziójú fájlnál: minden teher állandó tehernek számít
  for (const ld of data.loads ?? []) addPointLoad(s, ld.node, ld.fx, ld.fy, ld.mz, ld.group ?? 'dead');
  for (const dl of data.distLoads ?? []) addDistLoad(s, dl.beam, dl.qy, dl.group ?? 'dead');
  if (data.membrane2d) {
    const d = data.membrane2d;
    s.membrane2d = {
      ...createMembrane2D(d.thickness ?? 0.01, d.divisions ?? 4),
      nodes: (d.nodes ?? []).map((p) => ({ ...p })),
      elements: (d.elements ?? []).map((e) => [...e]),
      fixed: (d.fixed ?? []).map((f) => ({ ...f })),
      loads: (d.loads ?? []).map((l) => ({ ...l })),
      edgeLoads: (d.edgeLoads ?? []).map((e) => ({ ...e })),
    };
  }
  return s;
}
