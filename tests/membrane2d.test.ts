import { describe, expect, it } from 'vitest';
import { cloneStructure, createStructure, fromJSON, structureIsConsistent, toJSON } from '../src/geometry';
import {
  addMembraneEdgeLoad,
  addMembraneLoad,
  addRectMesh,
  cloneMembrane2D,
  createMembrane2D,
  edgeNear,
  elementAt,
  fixedMask,
  membrane2DBounds,
  membrane2DIsConsistent,
  membrane2DStats,
  nodeNear,
  rectCorners,
  setFixed,
  toMembraneModel,
} from '../src/membrane2d';
import { solveMembrane } from '../src/membrane';

const E = 210e9;
const NU = 0.3;

function square(side = 2, div = 4): ReturnType<typeof createMembrane2D> {
  const m = createMembrane2D(0.01, div);
  addRectMesh(m, { x: 0, y: 0 }, { x: side, y: side }, div);
  return m;
}

describe('2D modell — négyzögháló', () => {
  it('a háló méretei és az elemek száma helyesek', () => {
    const m = square(2, 4);
    expect(m.nodes).toHaveLength(25);
    expect(m.elements).toHaveLength(16);
    expect(m.elements[0]).toEqual([0, 1, 6, 5]);
    expect(membrane2DIsConsistent(m)).toBe(true);
  });

  it('a sarokpontok a megadott téglalapon belül vannak', () => {
    const m = createMembrane2D();
    addRectMesh(m, { x: 3, y: 1 }, { x: 1, y: 4 }, 2);
    expect(rectCorners({ x: 3, y: 1 }, { x: 1, y: 4 })).toEqual({ x0: 1, y0: 1, x1: 3, y1: 4 });
    for (const n of m.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(n.x).toBeLessThanOrEqual(3 + 1e-12);
      expect(n.y).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(n.y).toBeLessThanOrEqual(4 + 1e-12);
    }
    expect(membrane2DBounds(m)).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 4 });
  });

  it('minden elem anticlockwise, tehát pozitív determinánsú', () => {
    const m = square(2, 3);
    for (const el of m.elements) {
      let area = 0;
      for (let k = 0; k < 4; k++) {
        const a = m.nodes[el[k]!]!;
        const b = m.nodes[el[(k + 1) % 4]!]!;
        area += a.x * b.y - b.x * a.y;
      }
      expect(area).toBeGreaterThan(0);
    }
  });

  it('a háló felbontása korrekt, és a meglévő modellhez hozzáadódik', () => {
    const m = createMembrane2D(0.01, 2);
    addRectMesh(m, { x: 0, y: 0 }, { x: 1, y: 1 });
    const before = m.elements.length;
    const range = addRectMesh(m, { x: 2, y: 0 }, { x: 3, y: 1 });
    expect(before).toBe(4);
    expect(range).toEqual({ from: 4, to: 8 });
    expect(m.nodes).toHaveLength(18);
    expect(membrane2DIsConsistent(m)).toBe(true);
  });

  it('a méretnél kisebb felbontás is legalább 1x1 elemet ad', () => {
    const m = createMembrane2D(0.01, 0);
    addRectMesh(m, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(m.nodes).toHaveLength(4);
    expect(m.elements).toHaveLength(1);
  });
});

describe('2D modell — peremfeltételek és terhek', () => {
  it('a rögzítés maszkja hozzáadáskor és törléskor kezelhető', () => {
    const m = square();
    setFixed(m, 0, 1);
    expect(fixedMask(m, 0)).toBe(1);
    setFixed(m, 0, 3);
    expect(fixedMask(m, 0)).toBe(3);
    expect(m.fixed).toHaveLength(1);
    setFixed(m, 0, 0);
    expect(fixedMask(m, 0)).toBe(0);
    expect(m.fixed).toHaveLength(0);
  });

  it('a pontteher felülírja a csomópont meglévő terhét', () => {
    const m = square();
    addMembraneLoad(m, 12, 100, 0);
    addMembraneLoad(m, 12, 0, -50);
    expect(m.loads).toHaveLength(1);
    expect(m.loads[0]).toEqual({ node: 12, fx: 0, fy: -50 });
  });

  it('az élteher a fordított élmegadással ugyanaz az él', () => {
    const m = square();
    addMembraneEdgeLoad(m, 0, 1, 500);
    addMembraneEdgeLoad(m, 1, 0, -500);
    expect(m.edgeLoads).toHaveLength(1);
    expect(m.edgeLoads[0]!.t).toBe(-500);
  });

  it('a konzisztencia-ellenőrző elkapja a hibás adatokat', () => {
    const m = square();
    expect(membrane2DIsConsistent(m)).toBe(true);
    const bad = cloneMembrane2D(m);
    bad.elements[0]![0] = 999;
    expect(membrane2DIsConsistent(bad)).toBe(false);
    const short = cloneMembrane2D(m);
    short.elements[1] = [0, 1, 2];
    expect(membrane2DIsConsistent(short)).toBe(false);
    const dup = cloneMembrane2D(m);
    dup.elements[2] = [0, 0, 2, 3];
    expect(membrane2DIsConsistent(dup)).toBe(false);
    const zeroTh = cloneMembrane2D(m);
    zeroTh.thickness = 0;
    expect(membrane2DIsConsistent(zeroTh)).toBe(false);
    const badFixed = cloneMembrane2D(m);
    badFixed.fixed = [{ node: 42, mask: 3 }];
    expect(membrane2DIsConsistent(badFixed)).toBe(false);
    const badEdge = cloneMembrane2D(m);
    badEdge.edgeLoads = [{ from: 3, to: 3, t: 1 }];
    expect(membrane2DIsConsistent(badEdge)).toBe(false);
  });
});

describe('2D modell — ütközésvizsgálat', () => {
  it('a csomópont- és élkeresés a megfelelő elemet találja', () => {
    const m = square(2, 2);
    // 3x3 csomópont háló: indexek 0..8, bal alsó = 0
    expect(nodeNear(m, { x: 0, y: 0 }, 0.1)).toBe(0);
    expect(nodeNear(m, { x: 1, y: 0 }, 0.1)).toBe(1);
    expect(nodeNear(m, { x: 0.05, y: 0.05 }, 0.1)).toBe(0);
    expect(nodeNear(m, { x: 1.34, y: 1.34 }, 0.1)).toBe(-1);
    const e = edgeNear(m, { x: 0.5, y: 0.02 }, 0.1);
    expect(e).not.toBeNull();
    expect([e!.from, e!.to].sort()).toEqual([0, 1]);
    expect(edgeNear(m, { x: 1.4, y: 1.4 }, 0.05)).toBeNull();
  });

  it('a pont az elemen belül van', () => {
    const m = square(2, 2);
    expect(elementAt(m, { x: 0.5, y: 0.5 })).toBe(0);
    expect(elementAt(m, { x: 1.4, y: 1.6 })).toBe(3);
    expect(elementAt(m, { x: 1.01, y: 1.01 })).toBe(3);
    expect(elementAt(m, { x: 0.9, y: 0.1 })).toBe(0);
    expect(elementAt(m, { x: 5, y: 5 })).toBe(-1);
  });
});

describe('2D modell — számsítás és mentés', () => {
  it('a dokumentum számsításra átfordítható és megoldható', () => {
    // 4 m hosszú, 1 m magas lemez 4x4 hálóval: a bal él befagott, a jobb élon
    // 1 kN/m húzó nyomás. A nyújtott lemezben a feszültség P/(t·h).
    const m = createMembrane2D(0.01, 4);
    addRectMesh(m, { x: 0, y: 0 }, { x: 4, y: 1 });
    for (let j = 0; j <= 4; j++) setFixed(m, j * 5, 3);
    for (let j = 0; j < 4; j++) addMembraneEdgeLoad(m, j * 5 + 4, (j + 1) * 5 + 4, 1000);
    const r = solveMembrane(toMembraneModel(m, E, NU));
    expect(r.ok).toBe(true);
    // négy élszegmens 0,25 m hosszú, 1000 N/m értékű: 4 · 1000 · 0,25 = 1000 N
    expect(r.applied.fx).toBeCloseTo(1000, 6);
    // az elemenkénti átlag mindenütt a P/(t·h) érték 1%-án belül van; a
    // Gauss-pontos maximum a peremréteg miatt kissé nagyobb lehet
    const sigma = 1000 / (0.01 * 1);
    for (const el of r.elements) expect(Math.abs(el.sxx / sigma - 1)).toBeLessThan(0.01);
    expect(r.maxVonMises / sigma).toBeLessThan(1.05);
    expect(membrane2DStats(m, r).elements).toBe(16);
    expect(membrane2DStats(m, r).dof).toBe(50);
    expect(membrane2DStats(m, null).maxVM).toBe(0);
  });

  it('a 2D modell együtt mentődik az 1D modellel', () => {
    const s = createStructure();
    s.membrane2d = square(1, 2);
    setFixed(s.membrane2d, 0, 3);
    const json = JSON.parse(toJSON(s).membrane2d ? JSON.stringify(toJSON(s)) : '{}');
    expect(json.membrane2d.nodes).toHaveLength(9);
    expect(json.membrane2d.elements).toHaveLength(4);
    expect(json.membrane2d.fixed).toEqual([{ node: 0, mask: 3 }]);
    const back = fromJSON(toJSON(s));
    expect(back.membrane2d?.elements).toHaveLength(4);
    expect(membrane2DIsConsistent(back.membrane2d!)).toBe(true);
    expect(structureIsConsistent(back)).toBe(true);
  });

  it('üres 2D modell nem kerül a fájlba, és a visszatöltés sem töri el az 1D-t', () => {
    const s = createStructure();
    s.membrane2d = createMembrane2D();
    expect(toJSON(s).membrane2d).toBeUndefined();
    const back = fromJSON(toJSON(s));
    expect(back.membrane2d).toBeUndefined();
    expect(structureIsConsistent(back)).toBe(true);
  });

  it('a visszatöltés a hiányzó 2D mezőket pótolja', () => {
    const data = JSON.parse(JSON.stringify(toJSON(createStructure())));
    data.membrane2d = { nodes: [], elements: [], thickness: 0.05, divisions: 8 };
    const s = fromJSON(data);
    expect(s.membrane2d?.thickness).toBe(0.05);
    expect(s.membrane2d?.divisions).toBe(8);
    expect(s.membrane2d?.fixed).toEqual([]);
  });

  it('a strukturált klón nem oszt referenciát a 2D modellel', () => {
    const s = createStructure();
    s.membrane2d = square(1, 2);
    const c = cloneStructure(s);
    c.membrane2d!.nodes[0]!.x = 99;
    c.membrane2d!.elements.push([0, 1, 2, 3]);
    expect(s.membrane2d!.nodes[0]!.x).toBe(0);
    expect(s.membrane2d!.elements).toHaveLength(4);
  });
});
