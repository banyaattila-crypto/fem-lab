import { describe, expect, it } from 'vitest';
import type { EdgeLoad, MembraneMesh, MembraneModel, QuadElement } from '../src/membrane';
import { solveMembrane } from '../src/membrane';

const E = 210e9;
const NU = 0.3;
const T = 0.01;
const G = E / (2 * (1 + NU));

/** nx x ny Q4 háló a [0,w] x [0,h] téglalapon, anticlockwise elem-sorrenddel. */
function grid(w: number, h: number, nx: number, ny: number): MembraneMesh {
  const nodes = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) nodes.push({ x: (i * w) / nx, y: (j * h) / ny });
  }
  const id = (i: number, j: number): number => j * (nx + 1) + i;
  const elements: QuadElement[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      elements.push({ id: elements.length, nodes: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
    }
  }
  return { nodes, elements };
}

function model(m: MembraneMesh, extra: Partial<MembraneModel> = {}): MembraneModel {
  return {
    ...m,
    E,
    nu: NU,
    thickness: T,
    constraints: { fixed: new Map() },
    loads: [],
    edgeLoads: [],
    ...extra,
  };
}

/** rögzíti a bal él összes csomópontját (maszk 3 = ux és uy) */
function clampLeft(m: MembraneModel): void {
  m.nodes.forEach((n, i) => {
    if (n.x === 0) m.constraints.fixed.set(i, 3);
  });
}

/** a Timoshenko-féle kantilever-megoldás: hajlítás + nyírás */
function timoshenko(P: number, L: number, h: number, t: number): number {
  const I = (t * h ** 3) / 12;
  const A = t * h;
  return (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * G * A);
}

describe('membrán — négyszögletű síkruszalmassági elem', () => {
  it('egyetlen elemen a húzás pontosan a rugalmassági törvényt követi', () => {
    // node-ok: 0=(0,0) 1=(1,0) 2=(0,1) 3=(1,1)
    const m = model(grid(1, 1, 1, 1));
    m.constraints.fixed.set(0, 3);
    m.constraints.fixed.set(2, 1);
    m.loads.push({ node: 1, fx: 500, fy: 0 });
    m.loads.push({ node: 3, fx: 500, fy: 0 });
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    // 1 m hossz, 1 m magas, 1 cm vastag húr: u = P·L/(E·A)
    expect(r.u[2 * 1]!).toBeCloseTo((1000 * 1) / (E * T * 1), 12);
    // a feszültség minden Gauss-pontban pontosan P/A, mert nincs alakfogyatás
    for (const s of r.stresses) {
      expect(s.sxx).toBeCloseTo(1000 / (T * 1), 3);
      expect(s.syy).toBeCloseTo(0, 3);
      expect(s.sxy).toBeCloseTo(0, 3);
    }
    expect(r.reaction.fx).toBeCloseTo(-1000, 6);
    expect(r.applied.fx).toBeCloseTo(1000, 6);
  });

  it('lineáris feszültségmező: Poisson nélkül minden Gauss-pont pontos', () => {
    // ν = 0 esetén a membrán szétválik: nincs keresztirányú alakváltozás, így
    // a húzás nem hoz létre semmilyen peremréteget, és a feszültség a
    // Q4 elem korrekt állandó-alakváltozás miatt mindenütt pontosan P/A.
    const nx = 8;
    const ny = 4;
    const m = model(grid(2, 1, nx, ny), { nu: 0 });
    m.nodes.forEach((n, i) => {
      if (n.x === 0) m.constraints.fixed.set(i, 3);
    });
    for (let j = 0; j < ny; j++) {
      // a jobb él alsó csomópontjától a felső felé haladva +x a normális
      m.edgeLoads.push({ from: j * (nx + 1) + nx, to: (j + 1) * (nx + 1) + nx, t: 1000 });
    }
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    const sigma = 1000 / (T * 1);
    expect(r.applied.fx).toBeCloseTo(1000, 6);
    expect(r.maxVonMises).toBeCloseTo(sigma, 3);
    for (const el of r.elements) {
      expect(el.sxx).toBeCloseTo(sigma, 3);
      expect(el.syy).toBeCloseTo(0, 3);
      expect(el.sxy).toBeCloseTo(0, 3);
    }
    expect(r.reaction.fx).toBeCloseTo(-1000, 6);
  });

  it('valós Poisson-aránnyal a középső zónában tiszta húzás van', () => {
    // A befogott bal él körül peremréteg alakul ki (a keresztirányú
    // összehúzódás helyben gátolt), ezért csak a belső oszlopokat vizsgáljuk
    // — a reakció viszont itt is pontosan -P.
    const nx = 8;
    const ny = 4;
    const m = model(grid(2, 1, nx, ny));
    m.nodes.forEach((n, i) => {
      if (n.x === 0) m.constraints.fixed.set(i, 3);
    });
    for (let j = 0; j < ny; j++) {
      m.edgeLoads.push({ from: j * (nx + 1) + nx, to: (j + 1) * (nx + 1) + nx, t: 1000 });
    }
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    const sigma = 1000 / (T * 1);
    for (const el of r.elements) {
      const col = el.element % nx;
      if (col < 2 || col > nx - 2) continue;
      expect(Math.abs(el.sxx / sigma - 1)).toBeLessThan(0.02);
    }
    expect(r.reaction.fx).toBeCloseTo(-1000, 6);
  });

  it('az élterhelés iránya a from→to él külön normálisa', () => {
    const mk = (edge: EdgeLoad): ReturnType<typeof solveMembrane> => {
      const m = model(grid(2, 1, 1, 1));
      m.constraints.fixed.set(0, 3);
      m.constraints.fixed.set(2, 3);
      m.constraints.fixed.set(3, 2);
      m.edgeLoads.push(edge);
      return solveMembrane(m);
    };
    // a felső él fentről lefelé haladva: a normálisa +y (kifelé)
    const up = mk({ from: 3, to: 2, t: 10 });
    const down = mk({ from: 2, to: 3, t: 10 });
    expect(up.applied.fy).toBeCloseTo(20, 9);
    expect(down.applied.fy).toBeCloseTo(-20, 9);
    expect(up.applied.fx).toBeCloseTo(0, 9);
  });

  it('függőleges terhelésű kantilever: a Timoshenko-féle lehajlás', () => {
    const L = 4;
    const h = 1;
    const P = 1000;
    const m = model(grid(L, h, 32, 32));
    clampLeft(m);
    const tip = m.nodes.findIndex((n) => n.x === L && n.y === h / 2)!;
    m.loads.push({ node: tip, fx: 0, fy: -P });
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    const d = Math.abs(r.u[2 * tip + 1]!);
    const exact = timoshenko(P, L, h, T);
    expect(d / exact).toBeGreaterThan(0.95);
    expect(d / exact).toBeLessThan(1.05);
    expect(r.reaction.fy).toBeCloseTo(P, 6);
  });

  it('mély kantilever: a nyíróenergia hozzájárulása is megjelenik', () => {
    // L = h: a hajlítási és a nyíró tag azonos nagyságrendű, így a megoldás
    // érzékeny a nyíróenergiára — ezt csak 2D elem tudja leképezni
    const m = model(grid(1, 1, 8, 8));
    clampLeft(m);
    const tip = m.nodes.findIndex((n) => n.x === 1 && n.y === 0.5)!;
    m.loads.push({ node: tip, fx: 0, fy: -1000 });
    const r = solveMembrane(m);
    const d = Math.abs(r.u[2 * tip + 1]!);
    const ratio = d / timoshenko(1000, 1, 1, T);
    // L = h mellett a rúdelmélet csak közelítés, ezért tágas sáv
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.15);
  });

  it('hálófinomításkor a kantilever-lehajlás a megoldáshoz tart', () => {
    const L = 4;
    const P = 1000;
    const exact = timoshenko(P, L, 1, T);
    const values: number[] = [];
    for (const n of [4, 8, 16]) {
      const m = model(grid(L, 1, n, n));
      clampLeft(m);
      const tip = m.nodes.findIndex((nd) => nd.x === L && nd.y === 0.5)!;
      m.loads.push({ node: tip, fx: 0, fy: -P });
      values.push(Math.abs(solveMembrane(m).u[2 * tip + 1]!));
    }
    // monoton közelítés az elméleti értékhez
    for (let i = 1; i < values.length; i++) {
      expect(Math.abs(values[i]! - exact)).toBeLessThan(Math.abs(values[i - 1]! - exact));
    }
    expect(Math.abs(values[2]! - exact) / exact).toBeLessThan(0.05);
  });

  it('a reakciók eredője és nyomatéka megegyezik a terhelés ellentettjével', () => {
    const nx = 6;
    const m = model(grid(4, 3, nx, 5));
    clampLeft(m);
    // aszimmetrikus terhelés, hogy a nyomaték-egyenleg is érvényesüljön
    m.loads.push({ node: 3 * (nx + 1) + 4, fx: 12000, fy: -30000 });
    m.edgeLoads.push({ from: 4 * (nx + 1) + 2, to: 4 * (nx + 1) + 1, t: 5000 });
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    expect(r.reaction.fx).toBeCloseTo(-r.applied.fx, 4);
    expect(r.reaction.fy).toBeCloseTo(-r.applied.fy, 4);
    // a nyomatékok a rendszer súlypontjára
    let mA = 0;
    let mR = 0;
    for (const ld of m.loads) {
      const n = m.nodes[ld.node]!;
      mA += ld.fx * n.y - ld.fy * n.x;
    }
    for (const e of m.edgeLoads) {
      // pontosan azzal a lineáris eloszlással számolunk, amit a solver is
      // használ: a két csomópontra f/2, ahol f = t · len
      const a = m.nodes[e.from]!;
      const b = m.nodes[e.to]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx2 = (b.y - a.y) / len;
      const ny2 = -(b.x - a.x) / len;
      const fx = nx2 * e.t * len;
      const fy = ny2 * e.t * len;
      mA += (fx / 2) * a.y - (fy / 2) * a.x;
      mA += (fx / 2) * b.y - (fy / 2) * b.x;
    }
    for (const r2 of r.reactions) {
      const n = m.nodes[r2.node]!;
      mR += r2.fx * n.y - r2.fy * n.x;
    }
    const scale = Math.max(Math.abs(mA), 1);
    expect(Math.abs(mA + mR) / scale).toBeLessThan(1e-9);
  });

  it('a fősajtos és az egyenérték feszültség viszonyai helyesek', () => {
    const m = model(grid(2, 2, 4, 4));
    clampLeft(m);
    m.loads.push({ node: 2 * 5 + 2, fx: 1000, fy: 3000 });
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    for (const s of r.stresses) {
      // s1 >= s2 definíció szerint, és a két fősajtosból is visszaszámítható
      expect(s.s1).toBeGreaterThanOrEqual(s.s2 - 1e-6);
      // az egyenérték feszültség a fősajtosokból és a komponensekből is ugyanaz
      expect(s.vonMises).toBeCloseTo(
        Math.sqrt(s.s1 * s.s1 - s.s1 * s.s2 + s.s2 * s.s2),
        3,
      );
      // tiszta egyirányú állapotban az egyenérték feszültség a fősajtos
      if (Math.abs(s.sxy) < 1e-6) expect(s.vonMises).toBeCloseTo(Math.abs(s.s1), 3);
    }
  });

  it('a feszültség nem függ a vastagságtól, a merevség viszont 1/t arányban', () => {
    const run = (t: number): ReturnType<typeof solveMembrane> => {
      const m = model(grid(2, 1, 6, 3), { thickness: t });
      m.nodes.forEach((n, i) => {
        if (n.x === 0) m.constraints.fixed.set(i, 1);
      });
      m.constraints.fixed.set(0, 3);
      for (let j = 0; j < 3; j++) {
        m.edgeLoads.push({ from: j * 7 + 6, to: (j + 1) * 7 + 6, t: 1000 });
      }
      return solveMembrane(m);
    };
    const a = run(0.01);
    const b = run(0.02);
    // a feszültség a keresztmetszettől függ: P/A = P/(t·h), tehát kétszeres
    // vastagságnál feleakkora — a rugalmassági modulus ettől független
    expect(a.maxVonMises).toBeCloseTo(1000 / (0.01 * 1), 6);
    expect(b.maxVonMises).toBeCloseTo(1000 / (0.02 * 1), 6);
    // a merevség a vastagsággal lineárisan nő, az elmozdulás 1/t
    expect(b.maxU).toBeCloseTo(a.maxU / 2, 12);
  });

  it('tükrözött terhelésre tükrözött feszültség adódik', () => {
    // két azonos, vízszintes erő a jobb él két sarkában: a terhelés és a
    // befogott bal él együtt szimmetrikus az y = h/2 tükrözésre
    const nx = 4;
    const ny = 4;
    const m = model(grid(2, 2, nx, ny));
    clampLeft(m);
    m.loads.push({ node: 0, fx: 20000, fy: 0 });
    m.loads.push({ node: ny * (nx + 1), fx: 20000, fy: 0 });
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    for (let i = 0; i < nx; i++) {
      const top = r.elements.find((e) => e.element === (ny - 1) * nx + i)!;
      const bot = r.elements.find((e) => e.element === i)!;
      // a normálkomponensek szimmetrikusak, a nyíró előjele ellentétes
      expect(bot.sxx).toBeCloseTo(top.sxx, -3);
      expect(bot.syy).toBeCloseTo(top.syy, -3);
      expect(bot.sxy).toBeCloseTo(-top.sxy, -3);
    }
  });

  it('a Poisson-hatás: a keresztirányú alakváltozás -ν-szoros', () => {
    // Széles lemeznél (h >> egy elem) a húzás a keresztirányú ALAKVÁLTOZÁSban
    // jelenik meg, nem a keresztmetszet elmozdulásában: epsyy = -nu·epsxx.
    // A Q4 ezt pontosan reprezentálja, így az arány hálófüggetlen -nu.
    const L = 10;
    const h = 1;
    const nx = 4;
    const ny = 4;
    const m = model(grid(L, h, nx, ny));
    m.nodes.forEach((n, i) => {
      if (n.x === 0) m.constraints.fixed.set(i, 1);
    });
    m.constraints.fixed.set(0, 3);
    for (let j = 0; j < ny; j++) {
      m.edgeLoads.push({ from: j * (nx + 1) + nx, to: (j + 1) * (nx + 1) + nx, t: 1000 });
    }
    const r = solveMembrane(m);
    expect(r.ok).toBe(true);
    const tip = nx;
    const ux = r.u[2 * tip]!;
    const epsxx = ux / L;
    const dh = r.u[2 * ny * (nx + 1) + nx + 1]! - r.u[2 * nx + 1]!;
    expect(dh / h / epsxx).toBeCloseTo(-NU, 9);
    // az axiális alakváltozás éppen P/(E·t·h)
    expect(epsxx).toBeCloseTo(1000 / (E * T * h), 9);
  });
});

describe('membrán — hibakezelés', () => {
  it('üres modell magyar hibaüzenetet ad', () => {
    const r = solveMembrane(model({ nodes: [], elements: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/legalább 4 csomópont/i);
    expect(solveMembrane(model({ nodes: grid(1, 1, 1, 1).nodes, elements: [] })).error).toMatch(
      /Nincs lemezelem/i,
    );
  });

  it('mechanizmus esetén hibát ad', () => {
    const r = solveMembrane(model(grid(2, 2, 2, 2)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mechanizmus/i);
  });

  it('fordított körüljárású elemet elutasít', () => {
    const m = model(grid(2, 2, 2, 2));
    m.constraints.fixed.set(0, 3);
    m.constraints.fixed.set(2, 2);
    m.constraints.fixed.set(6, 2);
    m.elements[0]!.nodes.reverse();
    const r = solveMembrane(m);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fordított|szugorodott/i);
  });

  it('érvénytelen Poisson-arányt, vastagságot és modult elutasít', () => {
    const m = model(grid(2, 2, 2, 2));
    m.constraints.fixed.set(0, 3);
    m.constraints.fixed.set(2, 2);
    m.constraints.fixed.set(6, 2);
    const base = solveMembrane(m);
    expect(base.ok).toBe(true);
    m.nu = 0.6;
    expect(solveMembrane(m).error).toMatch(/Poisson/i);
    m.nu = -1.2;
    expect(solveMembrane(m).error).toMatch(/Poisson/i);
    m.nu = 0.3;
    m.thickness = 0;
    expect(solveMembrane(m).error).toMatch(/vastagság/i);
    m.thickness = T;
    m.E = 0;
    expect(solveMembrane(m).error).toMatch(/Young/i);
  });

  it('túl merev megtámasztást jelez', () => {
    const m = model(grid(2, 2, 2, 2));
    for (const n of m.nodes) m.constraints.fixed.set(m.nodes.indexOf(n), 3);
    const r = solveMembrane(m);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/minden szabadsági fok/i);
  });

  it('a hibás modell azonnal kilép, részleges eredmény nélkül', () => {
    const r = solveMembrane(model({ nodes: [], elements: [] }));
    expect(r.u).toEqual([]);
    expect(r.elements).toEqual([]);
    expect(r.stresses).toEqual([]);
    expect(r.applied).toEqual({ fx: 0, fy: 0 });
  });
});

// A modul belső, de exportált segédfüggvényeinek öntesztje
import { GAUSS, planeStressStiffness, shapeQ4 } from '../src/membrane';

describe('membrán — segédfüggvények', () => {
  it('a 2x2-es Gauss-pontok szabálya a 16-os területet adja', () => {
    expect(GAUSS).toHaveLength(4);
    for (const [xi, eta] of GAUSS) {
      expect(Math.abs(xi)).toBeCloseTo(1 / Math.sqrt(3), 12);
      expect(Math.abs(eta)).toBeCloseTo(1 / Math.sqrt(3), 12);
    }
  });

  it('a Q4 alakfüggvény partíciós egysége és szimmetriája', () => {
    const { N } = shapeQ4(0, 0);
    const sum = N.reduce((acc: number, v: number) => acc + v, 0);
    expect(sum).toBeCloseTo(1, 12);
    // a sarokalakfüggvények szimmetriája: N1 és N4 felcserélhető az x -> -x
    // tükrözésnél
    expect(N[0]!).toBeCloseTo(N[3]!, 12);
    expect(N[1]!).toBeCloseTo(N[2]!, 12);
    // a középpontban minden alakfüggvény 1/4
    const mid = shapeQ4(0, 0);
    expect(mid.N.every((v: number) => Math.abs(v - 0.25) < 1e-12)).toBe(true);
  });

  it('a síkrugalmassági mátrix szimmetrikus és a Lamé-paramétereket követi', () => {
    const D = planeStressStiffness(210e9, 0.3, 0.01);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(D[i]![j]!).toBeCloseTo(D[j]![i]!, 3);
    }
    expect(D[0]![1]!).toBeCloseTo(D[1]![0]!, 3);
    // nyírómodulus: G·t
    expect(D[2]![2]! / 0.01).toBeCloseTo(G, 3);
    // síkrugalmasságban egyedül epsxx ≠ 0 esetén:
    //   sxx = E/(1-nu²)·t·epsxx,  syy = nu·sxx
    const mul = (e: [number, number, number]): number[] =>
      [0, 1, 2].map((a) => D[a]![0]! * e[0] + D[a]![1]! * e[1] + D[a]![2]! * e[2]);
    const k = (210e9 * 0.01) / (1 - 0.3 * 0.3);
    const sx = mul([1e-9, 0, 0]);
    expect(sx[0]!).toBeCloseTo(k * 1e-9, 3);
    expect(sx[1]!).toBeCloseTo(0.3 * k * 1e-9, 3);
    // a másik irányban ugyanígy
    const sy = mul([0, 1e-9, 0]);
    expect(sy[1]!).toBeCloseTo(k * 1e-9, 3);
    expect(sy[0]!).toBeCloseTo(0.3 * k * 1e-9, 3);
  });
});
