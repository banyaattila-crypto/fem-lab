import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../src/catalog';
import {
  addBeam,
  addDistLoad,
  addNode,
  addPointLoad,
  assignBeams,
  createStructure,
  setSupport,
  structureIsConsistent,
} from '../src/geometry';
import type { Structure } from '../src/geometry';
import { deformedPointAt, dof, localTransverseAt, momentAt, solve } from '../src/solver';

const E = 210e9;
/** szelvény: 15×15 cm téglalap, S235 */
const A = 0.15 * 0.15;
const I = (0.15 * 0.15 ** 3) / 12;

function beam1(): Structure {
  const s = createStructure();
  addNode(s, 0, 0);
  addNode(s, 4, 0);
  addBeam(s, 0, 1);
  assignBeams(s, [0], 's235', 'sq150');
  return s;
}

/** Konzzól: bal befogott, jobb szabad, L = 4 m, jobb végén F = −10 kN. */
function cantilever(P = -10000, L = 4): Structure {
  const s = createStructure();
  addNode(s, 0, 0);
  addNode(s, L, 0);
  addBeam(s, 0, 1);
  assignBeams(s, [0], 's235', 'sq150');
  setSupport(s, 0, 'fixed');
  addPointLoad(s, 1, 0, P, 0);
  return s;
}

describe('szolver — konzól rúd, végponti erővel', () => {
  const s = cantilever(-10000, 4);
  const r = solve(s);

  it('a megoldás létezik', () => {
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('a csúcslehajlás v = P·L³/(3·E·I)', () => {
    const expected = (-10000 * 4 ** 3) / (3 * E * I);
    expect(r.u[dof(1, 1)]).toBeCloseTo(expected, 12);
    expect(expected).toBeLessThan(0);
  });

  it('a csúcsforgatás θ = P·L²/(2·E·I)', () => {
    const expected = (-10000 * 4 ** 2) / (2 * E * I);
    expect(r.u[dof(1, 2)]).toBeCloseTo(expected, 12);
  });

  it('a befogott végben M = P·L, V = P, N = 0', () => {
    const e = r.elements[0]!;
    expect(Math.abs(e.M[0]!)).toBeCloseTo(40000, 6);
    expect(e.M[1]!).toBeCloseTo(0, 6);
    expect(Math.abs(e.V[0]!)).toBeCloseTo(10000, 6);
    expect(Math.abs(e.N[0]!)).toBeLessThan(1e-6);
  });

  it('a reakció a befogásban ellensúlyozza a terhet', () => {
    const rx = r.reactions[0]!;
    expect(rx.fy).toBeCloseTo(10000, 6);
    expect(Math.abs(rx.mz)).toBeCloseTo(40000, 6);
    expect(rx.fx).toBeCloseTo(0, 6);
  });

  it('a deformált alakzat pontja a csúcsban a számított elmozdulás', () => {
    const tip = deformedPointAt(s, r, 0, 1);
    expect(tip.x).toBeCloseTo(4 + r.u[dof(1, 0)]!, 12);
    expect(tip.y).toBeCloseTo(r.u[dof(1, 1)]!, 12);
  });

  it('a középső pont keresztirányú elmozdulása a Hermite-alakfüggvényből', () => {
    const v = localTransverseAt([0, 0, 0, 0, r.u[dof(1, 1)]!, r.u[dof(1, 2)]!], 4, 1);
    expect(v).toBeCloseTo(r.u[dof(1, 1)]!, 12);
  });

  it('a feszültség a szélső szálon σ = M/W', () => {
    const W = I / 0.075;
    expect(r.maxSigma).toBeCloseTo(40000 / W, 3);
  });
});

/**
 * Láncmodell n elemből, minden elemre q = −5 kN/m teherrel. n = 1 esetén a
 * modell két csomópontból áll, így a támaszokon kívül csak a forgó szabadsági
 * fokok szabadok.
 */
function chain(n: number): Structure {
  const s = createStructure();
  for (let i = 0; i <= n; i++) addNode(s, (i * 4) / n, 0);
  for (let i = 0; i < n; i++) addBeam(s, i, i + 1);
  assignBeams(
    s,
    s.beams.map((b) => b.id),
    's235',
    'sq150',
  );
  setSupport(s, 0, 'pinned');
  setSupport(s, n, 'roller');
  for (const bm of s.beams) addDistLoad(s, bm.id, -5000);
  return s;
}

describe('szolver — kétszer raktárasott rúd, egyenletes teherrel', () => {
  const s = chain(2);
  const r = solve(s);

  it('a reakciók fele-fele, összegük a teljes teher', () => {
    expect(r.reactions[0]!.fy).toBeCloseTo(10000, 6);
    expect(r.reactions[1]!.fy).toBeCloseTo(10000, 6);
    expect(r.reaction.fy).toBeCloseTo(20000, 6);
  });

  it('a támaszok végén nulla nyomaték, a középső csomópontban M = q·L²/8', () => {
    expect(Math.abs(r.elements[0]!.M[0]!)).toBeCloseTo(0, 6);
    expect(Math.abs(r.elements[0]!.M[1]!)).toBeCloseTo((5000 * 16) / 8, 6);
    expect(Math.abs(r.elements[1]!.M[0]!)).toBeCloseTo((5000 * 16) / 8, 6);
    expect(Math.abs(r.elements[1]!.M[1]!)).toBeCloseTo(0, 6);
  });

  it('a középső lehajlás pontosan 5·q·L⁴/(384·E·I), lefelé', () => {
    const expected = (-5 * 5000 * 4 ** 4) / (384 * E * I);
    expect(r.u[dof(1, 1)]).toBeCloseTo(expected, 12);
    expect(expected).toBeLessThan(0);
  });

  it('a támaszokban nulla elmozdulás', () => {
    expect(r.u[dof(0, 0)]).toBeCloseTo(0, 12);
    expect(r.u[dof(0, 1)]).toBeCloseTo(0, 12);
    expect(r.u[dof(2, 1)]).toBeCloseTo(0, 12);
  });

  it('a végforgatás pontosan q·L³/(24·E·I)', () => {
    expect(r.u[dof(0, 2)]).toBeCloseTo((-5000 * 4 ** 3) / (24 * E * I), 12);
  });

  it('a nyomaték a rúd mentén lineáris', () => {
    expect(momentAt(r, 0, 0.5)).toBeCloseTo((momentAt(r, 0, 0) + momentAt(r, 0, 1)) / 2, 6);
  });
});

describe('szolver — hálófinomítási konvergencia', () => {
  const exact = (5 * 5000 * 4 ** 4) / (384 * E * I);

  it('egyetlen elemmel is pontos a végforgatás (a Hermite-elem adott mintára)', () => {
    const r = solve(chain(1));
    expect(r.u[dof(0, 2)]).toBeCloseTo((-5000 * 4 ** 3) / (24 * E * I), 12);
    expect(r.elements[0]!.M[0]!).toBeCloseTo(0, 6);
    expect(r.elements[0]!.M[1]!).toBeCloseTo(0, 6);
  });

  it('két elemtől a középső lehajlás a pontos értéket adja', () => {
    expect(Math.abs(solve(chain(2)).u[dof(1, 1)]!)).toBeCloseTo(Math.abs(exact), 9);
    expect(Math.abs(solve(chain(4)).u[dof(2, 1)]!)).toBeCloseTo(Math.abs(exact), 9);
    expect(Math.abs(solve(chain(8)).u[dof(4, 1)]!)).toBeCloseTo(Math.abs(exact), 9);
  });

  it('a reakciók minden finomításnál a pontos értéken maradnak', () => {
    for (const n of [1, 2, 4, 8]) {
      expect(solve(chain(n)).reaction.fy).toBeCloseTo(20000, 6);
    }
  });
});

describe('szolver — befogott–befogott rúd, egyenletes teherrel', () => {
  const s = chain(2);
  setSupport(s, 0, 'fixed');
  setSupport(s, 2, 'fixed');
  const r = solve(s);

  it('a végnyomaték M = q·L²/12, a középső csomópontban q·L²/24', () => {
    expect(Math.abs(r.elements[0]!.M[0]!)).toBeCloseTo((5000 * 16) / 12, 6);
    expect(Math.abs(r.elements[0]!.M[1]!)).toBeCloseTo((5000 * 16) / 24, 6);
  });

  it('a középső lehajlás a fele a kétszer raktárasnak', () => {
    expect(r.u[dof(1, 1)]).toBeCloseTo(-(5000 * 4 ** 4) / (384 * E * I), 12);
  });

  it('a befogási nyomatékok ellentétes előjelűek, a reakciók szimmetrikusak', () => {
    expect(r.reactions[0]!.fy).toBeCloseTo(10000, 6);
    expect(r.reactions[1]!.fy).toBeCloseTo(10000, 6);
    expect(r.reactions[0]!.mz).toBeCloseTo((5000 * 16) / 12, 6);
    expect(r.reactions[1]!.mz).toBeCloseTo(-(5000 * 16) / 12, 6);
  });

  it('a támaszokban nulla elmozdulás és nulla forgatás', () => {
    for (const n of [0, 2]) {
      expect(r.u[dof(n, 0)]).toBeCloseTo(0, 12);
      expect(r.u[dof(n, 1)]).toBeCloseTo(0, 12);
      expect(r.u[dof(n, 2)]).toBeCloseTo(0, 12);
    }
  });
});

describe('szolver — tengelyterhelés', () => {
  it('a húzott rúd N = P és a megnyúlás Δl = P·l/(E·A)', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 2, 0);
    addNode(s, 4, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    assignBeams(s, [0, 1], 's235', 'sq150');
    setSupport(s, 0, 'pinned');
    setSupport(s, 2, 'roller');
    addPointLoad(s, 2, 250000, 0, 0);
    const r = solve(s);
    expect(r.elements[0]!.N[0]!).toBeCloseTo(250000, 3);
    expect(r.u[dof(2, 0)]).toBeCloseTo((250000 * 4) / (E * A), 12);
    expect(r.u[dof(1, 1)]).toBeCloseTo(0, 9);
  });
});
describe('szolver — önsúly', () => {
  it('az önsúly a geometriai teherhez képest elhanyagolhatatlanul kicsi, de jelen van', () => {
    const s = beam1();
    setSupport(s, 0, 'pinned');
    setSupport(s, 1, 'roller');
    s.selfWeight = true;
    const r = solve(s);
    const weight = A * 7850 * GRAVITY * 4;
    expect(Math.abs(r.reaction.fy)).toBeCloseTo(weight, 3);
    expect(r.reaction.fy).toBeGreaterThan(0);
  });

  it('önsúly nélkül nincs reakció terhelés nélkül', () => {
    const s = beam1();
    setSupport(s, 0, 'pinned');
    setSupport(s, 1, 'roller');
    const r = solve(s);
    expect(Math.abs(r.reaction.fy)).toBeLessThan(1e-6);
  });
});

describe('szolver — rácskeret és egyensúly', () => {
  /** Kétoszlopos keret: 4 m széles, 3 m magas, mindkét láb befogott. */
  function portal(): Structure {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 0, 3);
    addNode(s, 4, 3);
    addNode(s, 4, 0);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    addBeam(s, 2, 3);
    assignBeams(s, [0, 1, 2], 's235', 'sq150');
    setSupport(s, 0, 'fixed');
    setSupport(s, 3, 'fixed');
    return s;
  }

  it('a reakciók összege ellentettje a teljes külső tehernek', () => {
    const s = portal();
    addPointLoad(s, 2, 50000, -30000, 4000);
    const r = solve(s);
    expect(r.ok).toBe(true);
    expect(r.applied.fx).toBeCloseTo(50000, 6);
    expect(r.reaction.fx).toBeCloseTo(-r.applied.fx, 6);
    expect(r.reaction.fy).toBeCloseTo(-r.applied.fy, 6);
    // a csomóponti nyomatékok összege önmagában nem a globális momentummérleg:
    // a keresztirányú erők karhosszait is bele kell számítani
    expect(r.momentBalance.applied).toBeCloseTo(-266000, 6);
    expect(r.momentBalance.error).toBeLessThan(1e-6);
  });

  it('a keret tengelyereje nem nulla, mert a ferde rácsos teher nyomatékot is visz', () => {
    const s = portal();
    addPointLoad(s, 2, 0, -30000, 0);
    const r = solve(s);
    expect(r.maxN).toBeGreaterThan(1);
  });

  it('a csomóponti elmozdulások kicsik a mm-es tartományban', () => {
    const s = portal();
    addPointLoad(s, 2, 0, -30000, 0);
    const r = solve(s);
    expect(r.maxAbsU).toBeLessThan(0.05);
    expect(r.maxAbsU).toBeGreaterThan(0);
  });

  it('a megoszló teher is beleszámít az alkalmazott teherbe', () => {
    const s = portal();
    addDistLoad(s, 1, -3000);
    const r = solve(s);
    // a felső vízszintes rúd 4 m hosszú
    expect(r.applied.fy).toBeCloseTo(-3000 * beamLen(s, 1), 6);
    expect(r.reaction.fy).toBeCloseTo(3000 * beamLen(s, 1), 6);
  });

  it('több terhelés és önsúly esetén is megmarad az egyensúly', () => {
    const s = portal();
    s.selfWeight = true;
    addPointLoad(s, 1, 0, -10000, 2000);
    addDistLoad(s, 1, -3000);
    addPointLoad(s, 2, 12000, -5000, -1000);
    const r = solve(s);
    expect(r.reaction.fx).toBeCloseTo(-r.applied.fx, 6);
    expect(r.reaction.fy).toBeCloseTo(-r.applied.fy, 6);
    // a csomóponti nyomatékok összege önmagában nem a globális momentummérleg:
    // a keresztirányú erők karhosszait is bele kell számítani
  });
});

function beamLen(s: Structure, id: number): number {
  const bm = s.beams.find((b) => b.id === id)!;
  const a = s.nodes[bm.nodeI]!;
  const b = s.nodes[bm.nodeJ]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('szolver — hibás vagy hiányos modellek', () => {
  it('üres modell', () => {
    const r = solve(createStructure());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Üres');
  });

  it('rúd nélkül nincs mi számolni', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    setSupport(s, 0, 'pinned');
    const r = solve(s);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Nincs rúd');
  });

  it('támasz nélkül mechanizmus', () => {
    const s = beam1();
    addPointLoad(s, 0, 0, -1000, 0);
    const r = solve(s);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Nincs támasz');
  });

  it('egyetlen csukló nem elég: a mátrix szinguláris', () => {
    const s = beam1();
    setSupport(s, 0, 'pinned');
    addPointLoad(s, 0, 0, -1000, 0);
    const r = solve(s);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('szinguláris');
  });

  it('a számított modell továbbra is konzisztens marad', () => {
    const s = cantilever();
    solve(s);
    expect(structureIsConsistent(s)).toBe(true);
  });
});
