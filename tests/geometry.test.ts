import { describe, expect, it } from 'vitest';
import {
  addBeam,
  addDistLoad,
  addNode,
  addPointLoad,
  createStructure,
  findBeamNear,
  findNodeNear,
  fromJSON,
  pointToSegmentDist,
  removeBeam,
  removeDistLoad,
  removeNode,
  removePointLoad,
  removeSupport,
  setSupport,
  snap,
  snapPoint,
  supportAt,
  structureIsConsistent,
  toJSON,
} from '../src/geometry';

describe('geometria — invariánsok', () => {
  it('a node.id és a beam.id megegyezik a tömbindexszel', () => {
    const s = createStructure();
    const a = addNode(s, 0, 0);
    const b = addNode(s, 1, 0);
    addBeam(s, a, b);
    addNode(s, 2, 0);
    addBeam(s, b, 2);
    expect(s.nodes.map((n) => n.id)).toEqual([0, 1, 2]);
    expect(s.beams.map((bm) => bm.id)).toEqual([0, 1]);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('csomópont törlésekor az azonosítók újraszámázódnak és a rudak átirányulnak', () => {
    const s = createStructure();
    const n0 = addNode(s, 0, 0);
    const n1 = addNode(s, 1, 0);
    const n2 = addNode(s, 2, 0);
    const n3 = addNode(s, 3, 0);
    addBeam(s, n0, n1);
    addBeam(s, n1, n2);
    addBeam(s, n2, n3);

    removeNode(s, n1);

    expect(s.nodes).toHaveLength(3);
    expect(s.nodes.map((n) => n.id)).toEqual([0, 1, 2]);
    expect(s.beams).toHaveLength(1);
    expect(s.beams[0]!.nodeI).toBe(1);
    expect(s.beams[0]!.nodeJ).toBe(2);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a végpont törlésekor a szomszédos rúd megmarad és átirányul', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    removeNode(s, 0);
    expect(s.beams).toHaveLength(1);
    expect(s.beams[0]!.nodeI).toBe(0);
    expect(s.beams[0]!.nodeJ).toBe(1);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('rúd eltávolítás után újraszámazza a beam.id-kat', () => {
    const s = createStructure();
    for (let i = 0; i < 4; i++) addNode(s, i, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    addBeam(s, 2, 3);
    removeBeam(s, 0);
    expect(s.beams.map((bm) => bm.id)).toEqual([0, 1]);
    expect(structureIsConsistent(s)).toBe(true);
  });
});

describe('geometria — rúd létrehozás szabályai', () => {
  it('nem hoz létre nulla hosszú rudat', () => {
    const s = createStructure();
    const a = addNode(s, 1, 1);
    addNode(s, 1, 1);
    expect(addBeam(s, a, a)).toBeNull();
    expect(s.beams).toHaveLength(0);
  });

  it('nem hoz létre duplikátumot, de megfordított irányban sem', () => {
    const s = createStructure();
    const a = addNode(s, 0, 0);
    const b = addNode(s, 1, 0);
    expect(addBeam(s, a, b)).not.toBeNull();
    expect(addBeam(s, a, b)).toBeNull();
    expect(addBeam(s, b, a)).toBeNull();
    expect(s.beams).toHaveLength(1);
  });

  it('ismérfelve szomszédos rudak jönnek létre', () => {
    const s = createStructure();
    for (let i = 0; i < 3; i++) addNode(s, i, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    expect(s.beams).toHaveLength(2);
  });
});

describe('geometria — ütközéskeresés és rács', () => {
  it('findNodeNear a megfelelő közeli csomópontot adja', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 2, 0);
    expect(findNodeNear(s, { x: 0.05, y: 0.02 }, 0.1)?.id).toBe(0);
    expect(findNodeNear(s, { x: 2, y: 0 }, 0.1)?.id).toBe(1);
    expect(findNodeNear(s, { x: 1, y: 0 }, 0.1)).toBeUndefined();
  });

  it('findBeamNear a szakasz legközelebbi pontját méri', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 4, 0);
    addBeam(s, 0, 1);
    expect(findBeamNear(s, { x: 2, y: 0.1 }, 0.2)?.id).toBe(0);
    expect(findBeamNear(s, { x: 2, y: 1 }, 0.2)).toBeUndefined();
  });

  it('pont–szakasz távolság a végpontokon nullára csökken', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    expect(pointToSegmentDist(a, a, b)).toBeCloseTo(0, 12);
    expect(pointToSegmentDist(b, a, b)).toBeCloseTo(0, 12);
    expect(pointToSegmentDist({ x: 0, y: 2 }, a, b)).toBeCloseTo(1.2, 12);
  });

  it('snap a megadott lépésre kerekít', () => {
    expect(snap(0.38, 0.25)).toBeCloseTo(0.5, 12);
    expect(snap(0.37, 0.25)).toBeCloseTo(0.25, 12);
    expect(snap(-0.13, 0.25)).toBeCloseTo(-0.25, 12);
    expect(snap(1.234, 0)).toBeCloseTo(1.234, 12);
    expect(snapPoint({ x: 0.6, y: 1.1 }, 0.5)).toEqual({ x: 0.5, y: 1 });
  });
});

describe('geometria — mentés / betöltés', () => {
  it('a JSON kerekítés megőrzi a szerkezetet', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 3, 4);
    addBeam(s, 0, 1);
    const back = fromJSON(toJSON(s));
    expect(back.nodes).toEqual(s.nodes);
    expect(back.beams).toEqual(s.beams);
    expect(structureIsConsistent(back)).toBe(true);
  });
});

describe('geometria — támaszok', () => {
  it('támasz csak létező csomópontra kerülhet', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    expect(setSupport(s, 0, 'pinned')).not.toBeNull();
    expect(setSupport(s, 7, 'pinned')).toBeNull();
    expect(s.supports).toHaveLength(1);
  });

  it('egy csomóponton csak egy támasz van: az új felülírja a régit', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    setSupport(s, 0, 'pinned');
    setSupport(s, 0, 'fixed');
    expect(s.supports).toHaveLength(1);
    expect(s.supports[0]!.type).toBe('fixed');
  });

  it('támasz eltávolítása és a támaszkeresés', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    setSupport(s, 0, 'roller');
    setSupport(s, 1, 'pinned');
    expect(supportAt(s, 1)?.type).toBe('pinned');
    removeSupport(s, 0);
    expect(s.supports).toHaveLength(1);
    expect(supportAt(s, 0)).toBeUndefined();
  });

  it('csomópont törlésekor a támasza és a terhei is eltűnnek, a többiek átirányulnak', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    setSupport(s, 1, 'pinned');
    setSupport(s, 2, 'roller');
    addPointLoad(s, 1, 0, -1000, 0);
    addPointLoad(s, 2, 0, -2000, 0);

    removeNode(s, 1);

    expect(s.supports).toHaveLength(1);
    expect(s.supports[0]!.node).toBe(1);
    expect(s.loads).toHaveLength(1);
    expect(s.loads[0]!.id).toBe(0);
    expect(s.loads[0]!.node).toBe(1);
    expect(structureIsConsistent(s)).toBe(true);
  });
});

describe('geometria — terhek', () => {
  it('nulla teher nem jön létre', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    expect(addPointLoad(s, 0, 0, 0, 0)).toBeNull();
    expect(s.loads).toHaveLength(0);
  });

  it('megoszló teher csak létező rúdra kerülhet', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 2, 0);
    addBeam(s, 0, 1);
    expect(addDistLoad(s, 5, -5000)).toBeNull();
    expect(addDistLoad(s, 0, 0)).toBeNull();
    expect(addDistLoad(s, 0, -5000)).not.toBeNull();
  });

  it('megoszló teher eltávolítása', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    addDistLoad(s, 0, -5000);
    addDistLoad(s, 1, -3000);
    removeDistLoad(s, 0);
    expect(s.distLoads).toHaveLength(1);
    expect(s.distLoads[0]!.id).toBe(0);
    expect(s.distLoads[0]!.beam).toBe(1);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('teher eltávolítás után újraszámítódnak az azonosítók', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addPointLoad(s, 0, 0, -1000, 0);
    addPointLoad(s, 1, 0, -2000, 0);
    addPointLoad(s, 2, 0, -3000, 0);
    removePointLoad(s, 1);
    expect(s.loads.map((l) => l.id)).toEqual([0, 1]);
    expect(s.loads.map((l) => l.node)).toEqual([0, 2]);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('rúd törlésekor a rúd megoszló terhét is eldobja', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    addDistLoad(s, 0, -5000);
    addDistLoad(s, 1, -3000);
    removeBeam(s, 0);
    expect(s.distLoads).toHaveLength(1);
    expect(s.distLoads[0]!.id).toBe(0);
    expect(s.distLoads[0]!.beam).toBe(0);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a mentés és visszatöltés a támaszokat és terheket is körbeviszi', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 4, 0);
    addBeam(s, 0, 1);
    setSupport(s, 0, 'pinned');
    setSupport(s, 1, 'roller');
    addPointLoad(s, 1, 0, -12500, 3000);
    addDistLoad(s, 0, -5000);
    const back = fromJSON(toJSON(s));
    expect(back.supports).toEqual(s.supports);
    expect(back.loads).toEqual(s.loads);
    expect(back.distLoads).toEqual(s.distLoads);
    expect(structureIsConsistent(back)).toBe(true);
  });
});

describe('geometria — dangling referenciák', () => {
  it('csomópont törlésekor az ahhoz tartozó rudak megoszló terhei is eltűnnek', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    addDistLoad(s, 0, -5000);
    addDistLoad(s, 1, -3000);

    removeNode(s, 1);

    expect(s.beams).toHaveLength(0);
    expect(s.distLoads).toHaveLength(0);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('csomópont törlésekor a megmaradó rudak megoszló terhei átirányulnak', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addNode(s, 2, 0);
    addBeam(s, 1, 2);
    addBeam(s, 0, 1);
    addDistLoad(s, 0, -5000);
    addDistLoad(s, 1, -3000);

    removeNode(s, 0);

    expect(s.beams).toHaveLength(1);
    expect(s.distLoads).toHaveLength(1);
    expect(s.distLoads[0]!.id).toBe(0);
    expect(s.distLoads[0]!.beam).toBe(0);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a konzisztencia-ellenőrző kiszúrja a lógó hivatkozásokat', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addBeam(s, 0, 1);
    addPointLoad(s, 0, 0, -1000, 0);
    const good = structureIsConsistent(s);
    s.loads[0]!.node = 9;
    expect(good).toBe(true);
    expect(structureIsConsistent(s)).toBe(false);
  });
});
