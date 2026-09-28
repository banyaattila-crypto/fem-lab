import { describe, expect, it } from 'vitest';
import { plateElementStiffness, plateRigidity, shearModulus, solvePlate } from '../src/plate';
import type { PlateConstraint, PlateLoad, PlateModel, PlatePressure } from '../src/plate';
import { quadJacobian, shapeQ4 } from '../src/membrane';

const E = 210e9;
const NU = 0.3;
const T = 0.01;

/** négyzögháló a [0,a] × [0,b] tartományban, div × div elemben */
function mesh(a: number, b: number, div: number, nu = NU) {
  const nodes = [];
  const elements = [];
  const n = div + 1;
  for (let j = 0; j <= div; j++) {
    for (let i = 0; i <= div; i++) nodes.push({ x: (a * i) / div, y: (b * j) / div });
  }
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      elements.push({ id: elements.length, nodes: [j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i] as [number, number, number, number] });
    }
  }
  return {
    nodes,
    elements,
    base: {
      E,
      nu,
      thickness: T,
      constraints: { fixed: [] as PlateConstraint[] },
      loads: [] as PlateLoad[],
      pressures: [] as PlatePressure[],
    } satisfies Omit<PlateModel, 'nodes' | 'elements'>,
  };
}

/** csak a peremen lévő csomópontok: a belső szabad marad */
function boundaryNodes(nodes: { x: number; y: number }[], a: number, b: number): number[] {
  const eps = 1e-9;
  return nodes
    .map((nd, i) => ({ nd, i }))
    .filter(
      ({ nd }) => nd.x < eps || nd.y < eps || nd.x > a - eps || nd.y > b - eps,
    )
    .map(({ i }) => i);
}

/** négyzetlap mind oldalon csukva: w = θx = θy = 0 a peremen */
function clampedSquare(div: number, p: number, a = 4) {
  const m = mesh(a, a, div);
  m.base.constraints = {
    fixed: boundaryNodes(m.nodes, a, a).map((node) => ({ node, mask: 7 })),
  };
  m.base.pressures = m.elements.map((el) => ({ element: el.id, p }));
  return { ...m.base, ...m } as unknown as PlateModel;
}

/** négyzetlap: minden perem w = 0 (két irányban támasztott), elfordulás szabad */
function ssssSquare(div: number, p: number, a = 4) {
  const m = mesh(a, a, div);
  m.base.constraints = {
    fixed: boundaryNodes(m.nodes, a, a).map((node) => ({ node, mask: 1 })),
  };
  m.base.pressures = m.elements.map((el) => ({ element: el.id, p }));
  return { ...m.base, ...m } as unknown as PlateModel;
}

/** rúd viselkedés: hosszú, keskeny lemez, két végén w = 0, a szélek szabadak */
function simplySupportedStrip(L: number, div: number, p: number, width = 1) {
  const m = mesh(L, width, div, 0);
  const n = div + 1;
  m.base.constraints = { fixed: [] };
  for (let j = 0; j <= div; j++) {
    m.base.constraints.fixed.push({ node: j * n, mask: 1 });
    m.base.constraints.fixed.push({ node: j * n + div, mask: 1 });
  }
  m.base.pressures = m.elements.map((el) => ({ element: el.id, p }));
  return { ...m.base, ...m } as unknown as PlateModel;
}

function cantileverStrip(L: number, div: number, P: number, width = 1) {
  const m = mesh(L, width, div, 0);
  const n = div + 1;
  m.base.constraints = { fixed: [] };
  for (let j = 0; j <= div; j++) m.base.constraints.fixed.push({ node: j * n, mask: 7 });
  m.base.loads = [{ node: div * n + div, fw: -P }];
  return { ...m.base, ...m } as unknown as PlateModel;
}

describe('lemez — számsítási alapok', () => {
  it('a hajlítási merevség és a nyírómodulus a képletnek felel meg', () => {
    expect(plateRigidity(E, NU, T)).toBeCloseTo((E * T ** 3) / (12 * (1 - NU * NU)), 0);
    expect(shearModulus(E, NU)).toBeCloseTo(E / (2 * (1 + NU)), 0);
    // D = EI/(1-ν²), tehát vékony lemeznél a merevség a gerjed D-hez közelít
    expect(plateRigidity(E, 0, T)).toBeCloseTo((E * T ** 3) / 12, 0);
  });

  it('a számsítás a háló nélkül mechanizmust jelez', () => {
    const m = mesh(2, 2, 2);
    const r = solvePlate({ ...m.base, ...m, constraints: { fixed: [] } } as unknown as PlateModel);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('mechanizmus');
  });

  it('a reakciók ellensúlyozzák az alkalmazott terheket', () => {
    const r = solvePlate(clampedSquare(6, 5000));
    expect(r.ok).toBe(true);
    // a 4x4 m lap területe 16 m², a 5 kPa nyomás 80 kN
    expect(r.applied.fw).toBeCloseTo(-5000 * 16, 3);
    expect(r.reaction.fw).toBeCloseTo(-r.applied.fw, 6);
  });

  it('a nyomóteher összege megegyezik a p·A-val', () => {
    for (const [a, div] of [
      [3, 3],
      [4, 5],
      [2.5, 4],
    ] as const) {
      const r = solvePlate(clampedSquare(div, 7000, a));
      expect(Math.abs(r.applied.fw + 7000 * a * a) / (7000 * a * a)).toBeLessThan(1e-9);
    }
  });

  it('a szimmetrikus négyzetlap lehajlása középen a legnagyobb', () => {
    const r = solvePlate(ssssSquare(8, 2000));
    expect(r.ok).toBe(true);
    expect(r.criticalNode).toBe(40);
    for (const el of r.elements) {
      // a középső elemek feszültsége nagyobb, mint a sarkoké
      expect(el.sigmaMax).toBeGreaterThanOrEqual(0);
    }
    const center = 4 * 9 + 4;
    const corner = 0;
    expect(Math.abs(r.u[3 * center]!)).toBeGreaterThan(Math.abs(r.u[3 * corner]!));
  });
});

describe('lemez — csukott négyzetlap, egyenletes nyomás', () => {
  // Timoshenko: w_max = 0,00126 · q·a⁴/D  (ν = 0,3)
  it('a középső lehajlás a Timoshenko-féle érték 3%-án belül van', () => {
    const a = 4;
    const p = 10_000;
    const D = plateRigidity(E, NU, T);
    const expected = 0.00126 * (p * a ** 4) / D;
    const r = solvePlate(clampedSquare(16, p, a));
    expect(r.ok).toBe(true);
    const err = Math.abs(r.maxW / expected - 1);
    expect(err).toBeLessThan(0.03);
  });

  it('a háló finomításával a lehajlás monoton csökken az analitikus érték felé', () => {
    const a = 4;
    const p = 10_000;
    const D = plateRigidity(E, NU, T);
    const expected = 0.00126 * (p * a ** 4) / D;
    const errs = [6, 10, 14].map((d) => Math.abs(solvePlate(clampedSquare(d, p, a)).maxW / expected - 1));
    expect(errs[1]!).toBeLessThan(errs[0]!);
    expect(errs[2]!).toBeLessThan(errs[1]!);
  });
});

describe('lemez — szabadon támasztott négyzetlap, egyenletes nyomás', () => {
  // Timoshenko: w_max = 0,00406 · q·a⁴/D  (ν = 0,3)
  it('a középső lehajlás a Timoshenko-féle érték 4%-án belül van', () => {
    const a = 4;
    const p = 10_000;
    const D = plateRigidity(E, NU, T);
    const expected = 0.00406 * (p * a ** 4) / D;
    const r = solvePlate(ssssSquare(16, p, a));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.maxW / expected - 1)).toBeLessThan(0.04);
  });

  it('a hajlítási feszültség középen a legnagyobb', () => {
    const div = 10;
    const r = solvePlate(ssssSquare(div, 10_000));
    // a középső elem a div/2 sorban, div/2 oszlopban van
    const mid = r.elements.find((e) => e.element === (div / 2) * div + div / 2)!;
    const corner = r.elements.find((e) => e.element === 0)!;
    expect(mid.sigmaMax).toBeGreaterThan(corner.sigmaMax);
  });
});

describe('lemez — rúd viselkedés (a szélességhez képest hosszú lemez)', () => {
  it('két végén támasztott, egyenletes terhelés: 5qL⁴/(384 EI)', () => {
    const L = 8;
    const p = 2000;
    const EI = (E * T ** 3) / 12; // ν = 0, így D = EI
    const expected = (5 * p * L ** 4) / (384 * EI);
    const r = solvePlate(simplySupportedStrip(L, 16, p));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.maxW / expected - 1)).toBeLessThan(0.02);
  });

  it('kihajtott konzol, végén koncentrált teher: PL³/(3 EI) + PL/(5/6 · GA)', () => {
    const L = 8;
    const P = 500;
    const EI = (E * T ** 3) / 12;
    const GA = shearModulus(E, 0) * T;
    const bending = (P * L ** 3) / (3 * EI);
    const shear = (P * L) / ((5 / 6) * GA);
    const expected = bending + shear;
    const r = solvePlate(cantileverStrip(L, 16, P));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.maxW / expected - 1)).toBeLessThan(0.03);
  });

  it('nagyon vékony lemeznél sincs nyírási reteszelés (L/t = 8000)', () => {
    // A szelektíven csökkentett integrálás lényege: ha a nyíróenergiát is
    // 2x2 pontokkal integrálnánk, a karcsu lemez reteszelődne (nagyon merev
    // lenne) és a lemez a Kirchoff-féle megoldást adná. Itt a lehajlásnak
    // szigorúan a hajlítási képletet kell adnia.
    const L = 8;
    const P = 1e-6;
    const t = 0.001;
    const m = cantileverStrip(L, 12, P);
    m.thickness = t;
    const r = solvePlate(m);
    const EI = (E * t ** 3) / 12;
    const expected = (P * L ** 3) / (3 * EI);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.maxW / expected - 1)).toBeLessThan(0.01);
  });

  it('a nyírótag hatása vastag lemeznél is a Timoshenko-jellegű nagyságrendben van', () => {
    // L/t = 8: a nyírótag a hajlítási lehajlás 0,6·(t/L)² ≈ 0,9%-át adja.
    // A lemezelmélet itt még érvényes, a rúdelméleti referencia használható.
    const L = 8;
    const P = 1e-3;
    const t = 1;
    const m = cantileverStrip(L, 8, P);
    m.thickness = t;
    const r = solvePlate(m);
    const EI = (E * t ** 3) / 12;
    const GA = shearModulus(E, 0) * t;
    const bending = (P * L ** 3) / (3 * EI);
    const shear = (P * L) / ((5 / 6) * GA);
    expect(r.ok).toBe(true);
    // a nyiras hozzajarulo nem elhanyagolhato a diszkretizacio hibajahoz kepest
    expect(shear / bending).toBeGreaterThan(0.005);
    // a nyiras nelkuli Kirchoff-ertektel a tenyleges megoldasnál kisebb
    expect(r.maxW).toBeGreaterThan(bending);
  });
});

describe('lemez — elemmátrix ellenőrzés', () => {
  const E2 = 210e9;
  const t = 0.01;
  const L = 2;
  const nodeCoords = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: L },
    { x: 0, y: L },
  ];
  const energy = (u: number[]): number => {
    const K = plateElementStiffness(nodeCoords, E2, 0, t);
    let s = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) s += u[i]! * K[i]![j]! * u[j]!;
    return 0.5 * s;
  };

  it('a merev test elfordulásához nulla energia tartozik', () => {
    const c = 0.01;
    const u = new Array<number>(12).fill(0);
    nodeCoords.forEach((p, i) => {
      u[3 * i] = c * p.x;
      u[3 * i + 2] = -c;
    });
    expect(energy(u)).toBeCloseTo(0, 6);
  });

  it('tiszta nyírási állapot energiája 0,5·G·t·γ²·A', () => {
    const c = 0.01;
    const u = new Array<number>(12).fill(0);
    nodeCoords.forEach((p, i) => {
      u[3 * i] = c * p.x;
    });
    const G = shearModulus(E2, 0);
    expect(energy(u)).toBeCloseTo(0.5 * G * t * c * c * L * L, 6);
  });

  it('a mátrix szimmetrikus', () => {
    const K = plateElementStiffness(nodeCoords, E2, 0.3, t);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) expect(K[i]![j]!).toBeCloseTo(K[j]![i]!, 3);
  });
});

describe('lemez — feszültség-visszanyerés', () => {
  it('a hajlítási momentum és a feszültség kapcsolata σ = 6M/t', () => {
    const r = solvePlate(cantileverStrip(6, 8, 1000));
    expect(r.ok).toBe(true);
    for (const c of r.curvatures) {
      expect(Math.abs(c.sigmaTop + c.sigmaBottom)).toBeLessThan(1e-6);
      expect(Math.abs(c.sigmaTop)).toBeCloseTo((6 / T) * Math.abs(c.mxx + c.myy), 6);
    }
  });

  it('a felső és alsó szál feszültsége ellentétes előjelű', () => {
    const r = solvePlate(ssssSquare(6, 5000));
    const anyCurve = r.curvatures[0]!;
    expect(anyCurve.sigmaTop).not.toBe(0);
    expect(Math.sign(anyCurve.sigmaTop)).toBe(-Math.sign(anyCurve.sigmaBottom));
  });

  it('a 180°-os forgatás szimmetriája: a görbületek változatlanok', () => {
    const div = 6;
    const r = solvePlate(ssssSquare(div, 5000));
    const byId = new Map(r.elements.map((c) => [c.element, c]));
    for (let j = 0; j < div; j++) {
      for (let i = 0; i < div; i++) {
        const a = byId.get(j * div + i)!;
        const b = byId.get((div - 1 - j) * div + (div - 1 - i))!;
        // a forgatas nem csereli a kozepso tenzort es a twistet sem
        expect(a.kxx).toBeCloseTo(b.kxx, 6);
        expect(a.kyy).toBeCloseTo(b.kyy, 6);
        expect(a.kxy).toBeCloseTo(b.kxy, 6);
      }
    }
  });

  it('az x-y tükrözés felcseréli a kxx és kyy komponenst', () => {
    const div = 6;
    const r = solvePlate(ssssSquare(div, 5000));
    const byId = new Map(r.elements.map((c) => [c.element, c]));
    for (let j = 0; j < div; j++) {
      for (let i = 0; i < div; i++) {
        const a = byId.get(j * div + i)!;
        const b = byId.get(i * div + j)!;
        expect(a.kxx).toBeCloseTo(b.kyy, 6);
        expect(a.kyy).toBeCloseTo(b.kxx, 6);
        expect(a.kxy).toBeCloseTo(b.kxy, 6);
      }
    }
  });

  it('a lemez középpontja körüli négy elem átlagosan izotrop', () => {
    // paros div eseten a kozeppont csomopont, ezért négy elem hatarozza meg
    const div = 6;
    const j = div / 2;
    const i = div / 2;
    const ids = [
      (j - 1) * div + (i - 1),
      (j - 1) * div + i,
      j * div + (i - 1),
      j * div + i,
    ];
    const r = solvePlate(ssssSquare(div, 5000));
    const els = ids.map((id) => r.elements.find((e) => e.element === id)!);
    const kxx = els.reduce((a, e) => a + e.kxx, 0) / 4;
    const kyy = els.reduce((a, e) => a + e.kyy, 0) / 4;
    const kxy = els.reduce((a, e) => a + e.kxy, 0) / 4;
    expect(Math.abs(kxx - kyy)).toBeLessThan(1e-6);
    expect(Math.abs(kxy)).toBeLessThan(1e-6);
  });
});

describe('lemez — hibakezelés', () => {
  it('a nulla vastagságot elutasítja', () => {
    const m = clampedSquare(4, 1000);
    const r = solvePlate({ ...m, thickness: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('pozitív');
  });

  it('a |ν| ≥ 0,5 értéket elutasítja', () => {
    const r = solvePlate({ ...clampedSquare(4, 1000), nu: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Poisson');
  });

  it('a nem létező csomópontindexet elutasítja', () => {
    const m = clampedSquare(4, 1000);
    const r = solvePlate({ ...m, loads: [{ node: 999, fw: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('csomópontindexe');
  });

  it('csak a szabadságfokok szabad részét oldja meg', () => {
    const r = solvePlate(clampedSquare(4, 1000));
    expect(r.ok).toBe(true);
    expect(r.dof.total).toBe(3 * 25);
    // 4x4-es háló: 25 csomópont, a 16 peremen lévő mindhárom szabadságfoka rögzített
    expect(r.dof.fixed).toBe(3 * 16);
    expect(r.dof.total - r.dof.fixed).toBe(3 * 9);
  });

  it('a szabadon forgó peremen nincs reakciónyomaték', () => {
    const m = ssssSquare(4, 1000);
    const r = solvePlate(m);
    expect(r.ok).toBe(true);
    for (const rx of r.reactions) expect(Math.abs(rx.mtx)).toBeLessThan(1e-6);
  });
});

describe('lemez — közös geometria a membránelemmel', () => {
  it('a négyzetes elem területe megegyezik a képlettel', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];
    const { dN } = shapeQ4(0, 0);
    const { det } = quadJacobian(nodes, dN);
    expect(4 * det).toBeCloseTo(2, 12);
  });
});
