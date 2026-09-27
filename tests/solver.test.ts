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
  toJSON,
} from '../src/geometry';
import type { Structure } from '../src/geometry';
import { sectionProps } from '../src/catalog';
import {
  deformedNode,
  deformedPointAt,
  dof,
  extremes,
  internalAt,
  localTransverseAt,
  momentAt,
  SLS,
  solve,
  ULS,
} from '../src/solver';

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

describe('szolver — belső erők a rúd mentén', () => {
  it('a visszanyert diagram egyezik az elem végponti értékeivel', () => {
    const s = chain(2);
    const r = solve(s);
    expect(r.ok).toBe(true);
    for (const e of r.elements) {
      const start = internalAt(s, r, e.beam, 0);
      const end = internalAt(s, r, e.beam, 1);
      expect(start.V).toBeCloseTo(e.V[0], 6);
      expect(start.M).toBeCloseTo(e.M[0], 6);
      expect(start.N).toBeCloseTo(e.N[0], 6);
      expect(end.V).toBeCloseTo(e.V[1], 6);
      expect(end.M).toBeCloseTo(e.M[1], 6);
      expect(end.N).toBeCloseTo(e.N[1], 6);
    }
  });

  it('a nyomatékdiagram megoszló terhelésnél kvadratikus', () => {
    const s = chain(1);
    const r = solve(s);
    // egyetlen elem, q = -5 kN/m: az elemi végponti M mindkét végen nulla,
    // a valódi maximum viszont középen q*L²/8
    expect(r.elements[0]!.M[0]).toBeCloseTo(0, 6);
    expect(r.elements[0]!.M[1]).toBeCloseTo(0, 6);
    const mid = internalAt(s, r, 0, 0.5);
    expect(Math.abs(mid.M)).toBeCloseTo(10000, 3);
    expect(r.maxM).toBeCloseTo(10000, 3);
  });

  it('a nyomaték maximuma és helye a vertexben van', () => {
    const s = chain(1);
    const r = solve(s);
    const ex = extremes(s, r, 0);
    expect(ex.maxM.xi).toBeCloseTo(0.5, 6);
    expect(Math.abs(ex.maxM.value)).toBeCloseTo(10000, 3);
  });
});

describe('szolver — ferde és függőleges rúd', () => {
  /** Függőleges konzol, tetején befogva, alján vízszintes teher: oldalirányú lehajlás. */
  function verticalCantilever(): Structure {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 0, -3);
    addBeam(s, 0, 1);
    assignBeams(s, [0], 's235', 'sq150');
    setSupport(s, 0, 'fixed');
    addPointLoad(s, 1, -1000, 0, 0);
    return s;
  }

  it('a függőleges rúd csúcsa a teher irányában mozdul', () => {
    const s = verticalCantilever();
    const r = solve(s);
    expect(r.ok).toBe(true);
    // a csúcs a vízszintes teher irányába mozdul, a vízszintes helyzete változatlan
    const tip = deformedNode(s, r, 1);
    expect(tip.x).toBeLessThan(0);
    expect(tip.y).toBeCloseTo(-3, 12);
  });

  it('a csúcs lehajlása megegyezik a PL³/(3EI) értékkel', () => {
    const s = verticalCantilever();
    const E = s.catalog.materials.find((m) => m.id === 's235')!.E;
    const sec = sectionProps(s.catalog.sections.find((x) => x.id === 'sq150')!);
    const expected = -(1000 * 27) / (3 * E * sec.I);
    const r = solve(s);
    expect(deformedNode(s, r, 1).x).toBeCloseTo(expected, 12);
  });

  it('a függőleges rúd alakja a csúcs felé monoton görbül', () => {
    const s = verticalCantilever();
    const r = solve(s);
    let prev = 0;
    for (let k = 1; k <= 10; k++) {
      const xi = k / 10;
      const p = deformedPointAt(s, r, 0, xi);
      // a rúd függőleges marad: a lehajlás mindenütt vízszintes
      expect(p.y).toBeCloseTo(-3 * xi, 12);
      expect(p.x).toBeLessThan(0);
      // a lehajlás a csúcs felé nő
      expect(-p.x).toBeGreaterThan(prev);
      prev = -p.x;
    }
  });
});

describe('szolver — feszültségkihasználtság', () => {
  /** Kétszer raktárosott rúd, a szélesség úgy skálázva, hogy a kihasználtság éppen 1 legyen. */
  function sizedToUnity(): { s: Structure; L: number } {
    const s = chain(2);
    const I = 0.15 ** 4 / 12;
    const Mmax = 10000; // q*L²/8
    const fy = s.catalog.materials.find((m) => m.id === 's235')!.fy * 1e6;
    const neededI = (Mmax * 0.075) / fy;
    // hajlításnál σ = M·c/I, ahol c ~ scale és I ~ scale⁴, tehát σ ~ 1/scale³
    const scale = (neededI / I) ** (1 / 3);
    const sec = s.catalog.sections.find((x) => x.id === 'sq150')!;
    if (sec.shape === 'rect') {
      sec.b = sec.b * scale;
      sec.h = sec.h * scale;
    }
    return { s, L: scale };
  }

  it('a méretezéssel a kihasználtság éppen 1.0', () => {
    const { s } = sizedToUnity();
    const r = solve(s);
    expect(r.ok).toBe(true);
    expect(r.maxUtilization).toBeCloseTo(1, 3);
    expect(r.utilizationBeam).toBeGreaterThanOrEqual(0);
  });

  it('kétszer akkora keresztmetszet feleannyi kihasználtságot ad', () => {
    const { s } = sizedToUnity();
    for (const sec of s.catalog.sections) {
      if (sec.shape === 'rect') {
        sec.b *= 2;
        sec.h *= 2;
      }
    }
    const r = solve(s);
    // a másodlagos tengely körüli hajlítás most négyszer kisebb feszültséget ad
    expect(r.maxUtilization).toBeLessThan(0.5);
  });

  it('a hasznos magasságegyenérték a maradék kapacitással egyezik', () => {
    const { s } = sizedToUnity();
    const r = solve(s);
    for (const e of r.elements) {
      expect(e.wNeeded).toBeGreaterThan(0);
      // éppen a határon álló rúdhoz a szükséges W megegyezik a valódival
      const sec = s.catalog.sections.find((x) => x.id === 'sq150')!;
      const props = sectionProps(sec);
      const yMax = Math.max(props.yBot, props.yTop);
      if (e.beam === r.utilizationBeam) {
        expect(e.wNeeded).toBeCloseTo(props.I / yMax, 6);
      }
    }
  });
});

describe('szolver — terheléskombinációk', () => {
  /** Két elemes kétszer raktárosott rúd: 5 kN/m állandó + 5 kN/m változó teher. */
  function mixed(): Structure {
    const s = chain(2);
    s.distLoads = [];
    for (const bm of s.beams) {
      addDistLoad(s, bm.id, -2500, 'dead');
      addDistLoad(s, bm.id, -2500, 'live');
    }
    return s;
  }

  it('SLS-ben mindkét csoport a tényező nélkül számít', () => {
    const r = solve(mixed(), SLS);
    expect(r.maxM).toBeCloseTo(10000, 3);
    expect(r.combo).toBe(SLS);
  });

  it('ULS-ben a parancsszorzók érvényesülnek', () => {
    const r = solve(mixed(), ULS);
    // q = 1,35*2500 + 1,50*2500 = 7125 N/m → M = q*L²/8
    expect(r.maxM).toBeCloseTo((7125 * 16) / 8, 3);
    // a reakciók és az elemi végi nyomatékok is a kombináció szerint kellenek
    expect(r.reaction.fy).toBeCloseTo(28500, 6);
    // az első elem végpontja a gerincben van, ahol a maximum van
    expect(r.elements[0]!.M[1]).toBeCloseTo(-(7125 * 16) / 8, 3);
  });

  it('csak a változó teher eltávolítása is módosítja az eredményt', () => {
    const s = mixed();
    s.distLoads = s.distLoads.filter((dl) => dl.group === 'dead');
    const r = solve(s, ULS);
    // csak az állandó teher: q = 1,35*2500 = 3375 N/m
    expect(r.maxM).toBeCloseTo((3375 * 16) / 8, 3);
  });

  it('az önsúly is a dead tényezővel szorzódik', () => {
    const s = chain(2);
    s.distLoads = [];
    s.selfWeight = true;
    const sls = solve(s, SLS);
    const uls = solve(s, ULS);
    expect(uls.maxM / sls.maxM).toBeCloseTo(1.35, 9);
  });

  it('a kombináció a szerkezetet nem módosítja', () => {
    const s = mixed();
    const before = JSON.stringify(toJSON(s));
    solve(s, ULS);
    expect(JSON.stringify(toJSON(s))).toBe(before);
  });
});

describe('szolver — kihajlásellenőrzés', () => {
  /** Oszlop: felül csukló, alul csukló, gyengébb kihajlásnál nagyobb N. */
  function column(bScale: number, L = 4): Structure {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 0, -L);
    addBeam(s, 0, 1);
    assignBeams(s, [0], 's235', 'sq150');
    // alulról befogva: különben a csúcsban a teher közvetlenül a támaszra kerül
    // és a rúd nem kap nyomóerőt
    setSupport(s, 1, 'fixed');
    // a szélességet állítjuk: karcsú = nagyobb karcsúsági fok
    const sec = s.catalog.sections.find((x) => x.id === 'sq150')!;
    if (sec.shape === 'rect') {
      sec.b = 0.15 * bScale;
      sec.h = 0.15;
    }
    addPointLoad(s, 0, 0, -100000, 0);
    return s;
  }

  it('karcsú oszlopnál nagyobb a kihajlási arány', () => {
    const fat = solve(column(1));
    const thin = solve(column(0.2));
    expect(fat.maxBuckling).toBeGreaterThan(0);
    expect(thin.maxBuckling).toBeGreaterThan(fat.maxBuckling);
  });

  it('a kihajlási arány a fy-nél kisebb arányt ad, mint a kihajlás', () => {
    const r = solve(column(1));
    // 150x150 acéloszlop, 4 m: N_cr ≈ 5,1 MN, a teher 100 kN → ~0,02
    expect(r.maxBuckling).toBeGreaterThan(0.005);
    expect(r.maxBuckling).toBeLessThan(0.1);
  });

  it('húzott rúdnál nincs kihajlási figyelmeztetés', () => {
    const s = column(1);
    s.loads[0]!.fy = 100000; // felfelé húzás
    const r = solve(s);
    expect(r.bucklingBeam).toBe(-1);
    expect(r.maxBuckling).toBe(0);
  });

  it('a karcsúsági határ 200 felett jelez', () => {
    // téglalapnál r_gy = h/√12, tehát a hossz vagy a magasság dönt
    expect(solve(column(1, 4)).elements[0]!.buckling?.slender).toBe(true);
    expect(solve(column(1, 0.2)).elements[0]!.buckling?.slender).toBe(false);
  });
});
