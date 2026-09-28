import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { membrane2DIsConsistent, membrane2DStats, fixedMask } from '../src/membrane2d';

function makeEditor(): Editor {
  const e = new Editor({ gridStep: 0.25 });
  e.viewport = { width: 800, height: 600 };
  e.setMode('2d');
  e.setTool('mesh');
  return e;
}

/** a háló egy teljes peremét rögzíti, hogy a modell ne legyen mechanizmus */
function fixEdge(e: Editor, side: 'left' | 'right' | 'top' | 'bottom', mask = 3): void {
  const m = e.membrane2d;
  const div = m.divisions;
  const n = div + 1;
  for (let k = 0; k <= div; k++) {
    const i = side === 'left' ? 0 : side === 'right' ? div : k;
    const j = side === 'bottom' ? 0 : side === 'top' ? div : k;
    e.membrane2d.fixed.push({ node: j * n + i, mask });
  }
}

/** téglalap háló húzással, ahogy az UI-ban történik: le, mozgás, fel */
function dragMesh(e: Editor, a: { x: number; y: number }, b: { x: number; y: number }): void {
  e.pointerDown(a);
  e.pointerMove(b);
  e.pointerUp();
}

describe('szerkesztő — 2D hálórajzolás', () => {
  it('a húzás négyzöghálót hoz létre a rácson', () => {
    const e = makeEditor();
    e.setMembraneSize(0.01, 3);
    dragMesh(e, { x: 0, y: 0 }, { x: 3, y: 2 });
    const m = e.membrane2d;
    expect(m.nodes).toHaveLength(16);
    expect(m.elements).toHaveLength(9);
    expect(membrane2DIsConsistent(m)).toBe(true);
    expect(e.hasMembraneMesh()).toBe(true);
  });

  it('a rácsközelítés miatt a sarokpontok a rácson ülnek', () => {
    const e = makeEditor();
    // 0.13 → 0.25 és 2.1 → 2.0: a sarokpontok a rácson ülnek
    dragMesh(e, { x: 0.13, y: 0.11 }, { x: 2.1, y: 1.9 });
    const xs = [...new Set(e.membrane2d.nodes.map((n) => n.x))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.25, 9);
    expect(xs[xs.length - 1]).toBeCloseTo(2, 9);
    // a belső osztásközök egyenletesek
    const d = xs[1]! - xs[0]!;
    for (let i = 2; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(d, 9);
  });

  it('türelmetlen kattintás (nulla kiterjedés) nem hoz létre elemet', () => {
    const e = makeEditor();
    dragMesh(e, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(e.membrane2d.elements).toHaveLength(0);
  });

  it('a rácskikapcsoláskor a sarokpontok szabadon mozdulnak', () => {
    const e = makeEditor();
    e.setSnap(false);
    dragMesh(e, { x: 0.13, y: 0.11 }, { x: 2.1, y: 1.9 });
    const xs = [...new Set(e.membrane2d.nodes.map((n) => n.x))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.13, 9);
  });

  it('minden módosítás előtt van előzmény, és a visszavonás működik', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(e.membrane2d.elements).toHaveLength(16);
    e.doUndo();
    expect(e.structure.membrane2d?.elements ?? []).toHaveLength(0);
    e.doRedo();
    expect(e.membrane2d.elements).toHaveLength(16);
  });

  it('a vastagság és a felbontás állítása előzményt ír, és korlátozott értéket őriz', () => {
    const e = makeEditor();
    e.setMembraneSize(0.025, 6);
    expect(e.membrane2d.thickness).toBe(0.025);
    expect(e.membrane2d.divisions).toBe(6);
    e.setMembraneSize(-1, 100);
    expect(e.membrane2d.thickness).toBe(0.01);
    expect(e.membrane2d.divisions).toBe(40);
  });
});

describe('szerkesztő — 2D rögzítések és terhek', () => {
  it('a peremrögzítés a maszk szerint áll és újra kattintva töröl', () => {
    const e = makeEditor();
    e.setMembraneSize(0.01, 2);
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('fix');
    e.membraneFixMask = 3;
    e.pointerDown({ x: 0, y: 0 });
    e.pointerUp();
    expect(fixedMask(e.membrane2d, 0)).toBe(3);
    e.pointerDown({ x: 2, y: 2 });
    e.pointerUp();
    expect(fixedMask(e.membrane2d, 8)).toBe(3);
    e.membraneFixMask = 1;
    e.pointerDown({ x: 0, y: 2 });
    e.pointerUp();
    expect(fixedMask(e.membrane2d, 6)).toBe(1);
    e.membraneFixMask = 3;
    e.pointerDown({ x: 0, y: 0 });
    e.pointerUp();
    expect(fixedMask(e.membrane2d, 0)).toBe(0);
  });

  it('a rögzítés a megadott szomszédságon belül kattintva is talál', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('fix');
    // (0.99, 0.01) → (1.0, 0.0); a 4 felbontású hálóban ez a (2, 0) csomópont
    e.pointerDown({ x: 0.99, y: 0.01 });
    e.pointerUp();
    expect(fixedMask(e.membrane2d, 2)).toBe(3);
  });

  it('az élteher a kattintott élre kerül a megadott értékkel', () => {
    const e = makeEditor();
    e.setMembraneSize(0.01, 2);
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('edgeLoad');
    e.membraneEdgeValue = 2500;
    e.pointerDown({ x: 0.5, y: 2 });
    e.pointerUp();
    expect(e.membrane2d.edgeLoads).toHaveLength(1);
    const el = e.membrane2d.edgeLoads[0]!;
    expect(el.t).toBe(2500);
    // a felső él csomópontjai: 6 és 7
    expect([el.from, el.to].sort()).toEqual([6, 7]);
  });

  it('a belső élre nem lehet élterhet tenni', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('edgeLoad');
    e.pointerDown({ x: 0.5, y: 1 });
    e.pointerUp();
    expect(e.membrane2d.edgeLoads).toHaveLength(0);
  });

  it('a pontteher a csomópontra kerül kN-ban megadott értékkel', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('nodeLoad');
    e.membraneNodeValue = { fx: 1000, fy: -500 };
    e.pointerDown({ x: 1, y: 1 });
    e.pointerUp();
    // 4x4-es háló, 5x5 csomópont: a középső csomópont (1,1) = 2*5+2 = 12
    expect(e.membrane2d.loads).toEqual([{ node: 12, fx: 1000, fy: -500 }]);
  });

  it('tükrözve megadott él nem hoz létre duplikátumot', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('edgeLoad');
    e.membraneEdgeValue = 1000;
    e.pointerDown({ x: 0.5, y: 0 });
    e.pointerUp();
    const first = e.membrane2d.edgeLoads[0]!;
    e.membraneEdgeValue = -1000;
    e.pointerDown({ x: 0.5, y: 0 });
    e.pointerUp();
    expect(e.membrane2d.edgeLoads).toHaveLength(1);
    expect(e.membrane2d.edgeLoads[0]!.t).toBe(-1000);
    expect([first.from, first.to]).toContain(e.membrane2d.edgeLoads[0]!.from);
  });
});

describe('szerkesztő — 2D kijelölés és törlés', () => {
  it('a kijelölés a legközelebbi csomópontot választja', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('select');
    // (1.98, 0.02) → (2.0, 0.0), ami a 4 felbontású háló (4, 0) csomópontja
    e.pointerDown({ x: 1.98, y: 0.02 });
    expect(e.selectedNodes).toEqual([4]);
  });

  it('a csomópont törlése az elemeket is eltávolítja és újrasorszámoz', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setTool('select');
    e.pointerDown({ x: 0, y: 0 });
    e.deleteSelection();
    const m = e.membrane2d;
    expect(m.nodes).toHaveLength(24);
    expect(m.elements).toHaveLength(15);
    expect(membrane2DIsConsistent(m)).toBe(true);
    // az ID az index: minden hivatkozás érvényes
    for (const el of m.elements) for (const n of el) expect(n).toBeLessThan(m.nodes.length);
  });

  it('a sarokcsomópont törlése után a modell még számsítható', () => {
    const e = makeEditor();
    e.setMembraneSize(0.01, 2);
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    fixEdge(e, 'left');
    e.setTool('select');
    e.pointerDown({ x: 2, y: 2 });
    e.deleteSelection();
    const r = e.solveMembraneModel();
    expect(r).not.toBeNull();
    expect(r?.ok).toBe(true);
    expect(membrane2DIsConsistent(e.membrane2d)).toBe(true);
  });
});

describe('szerkesztő — 2D mód és számsítás', () => {
  it('a módváltás nem törli a modelleket', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    e.setMode('1d');
    expect(e.mode).toBe('1d');
    expect(e.structure.membrane2d?.elements).toHaveLength(16);
    e.setMode('2d');
    expect(e.membrane2d.elements).toHaveLength(16);
  });

  it('a módváltás érvényteleníti az eredményt és törli a kijelölést', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    fixEdge(e, 'left');
    e.solveMembraneModel();
    expect(e.membraneResult?.ok).toBe(true);
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    expect(e.selectedNodes).toHaveLength(1);
    e.setMode('1d');
    expect(e.membraneResult).toBeNull();
    expect(e.selectedNodes).toEqual([]);
  });

  it('a modell módosítása érvényteleníti a számsítási eredményt', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    fixEdge(e, 'left');
    e.solveMembraneModel();
    expect(e.membraneResult?.ok).toBe(true);
    e.setMembraneSize(0.02, 4);
    expect(e.membraneResult).toBeNull();
  });

  it('üres modellre a számsítás nullát ad vissza hiba nélkül', () => {
    const e = makeEditor();
    expect(e.hasMembraneMesh()).toBe(false);
    expect(e.solveMembraneModel()).toBeNull();
  });

  it('a kiválasztott katalógusanyag E és nu értékét használja', () => {
    const e = makeEditor();
    e.setMembraneSize(0.01, 1);
    dragMesh(e, { x: 0, y: 0 }, { x: 1, y: 1 });
    fixEdge(e, 'left');
    e.setTool('edgeLoad');
    e.membraneEdgeValue = 1000;
    e.pointerDown({ x: 1, y: 0.5 });
    e.pointerUp();
    e.setSection('c25', '');
    const r = e.solveMembraneModel();
    // beton: E = 30 GPa, vastagság 10 mm → a feszültség a kétszerese a 1000/0.01/1-nek
    expect(r?.ok).toBe(true);
    expect(r?.maxVonMises).toBeGreaterThan(80e3);
    expect(r?.yield).toBeCloseTo((13.5 * 1e6) / 1.15, 0);
  });

  it('a statisztika a megoldott modellhez tartozó értékeket adja', () => {
    const e = makeEditor();
    dragMesh(e, { x: 0, y: 0 }, { x: 2, y: 2 });
    fixEdge(e, 'left');
    e.setTool('edgeLoad');
    e.membraneEdgeValue = 1000;
    e.pointerDown({ x: 1, y: 2 });
    e.pointerUp();
    // eredmény nélkül a szabadsági fokok száma a hálóból számítható,
    // de a feszültség- és elmozdulásértékek érvénytelenek
    const empty = membrane2DStats(e.membrane2d, null);
    expect(empty.dof).toBe(50);
    expect(empty.maxVM).toBe(0);
    expect(empty.maxU).toBe(0);
    const r = e.solveMembraneModel();
    const st = membrane2DStats(e.membrane2d, r);
    expect(st.elements).toBe(16);
    expect(st.dof).toBe(50);
    expect(st.maxVM).toBeCloseTo(r!.maxVonMises, 3);
  });
});
