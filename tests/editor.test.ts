import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { structureIsConsistent } from '../src/geometry';
import { screenToWorld, worldToScreen } from '../src/camera';
import type { Camera, Viewport } from '../src/camera';

function makeEditor(): Editor {
  const e = new Editor({ gridStep: 0.25 });
  e.viewport = { width: 800, height: 600 };
  return e;
}

function drawBeam(e: Editor, pts: { x: number; y: number }[]): void {
  e.pointerDown(pts[0]!);
  for (const p of pts.slice(1)) e.pointerDown(p);
  e.finishChain();
}

describe('szerkesztő — rúdrajzolás', () => {
  it('láncban rúdalakot épít és a lánc a végén lezárul', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    expect(e.structure.nodes).toHaveLength(3);
    expect(e.structure.beams).toHaveLength(2);
    expect(structureIsConsistent(e.structure)).toBe(true);
    expect(e.previewFrom).toBe(-1);
  });

  it('meglévő csomópontra kattintva nem hoz létre duplikátumot', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    e.pointerDown({ x: 2, y: 0 });
    e.pointerDown({ x: 2, y: 2 });
    expect(e.structure.nodes).toHaveLength(3);
    expect(e.structure.beams).toHaveLength(2);
  });

  it('azonos pontra zárva nem keletkezik nulla hosszú rúd', () => {
    const e = makeEditor();
    drawBeam(e, [{ x: 1, y: 1 }, { x: 1, y: 1 }]);
    expect(e.structure.beams).toHaveLength(0);
  });

  it('csomópont eszközzel külön node-ot hoz létre', () => {
    const e = makeEditor();
    e.setTool('node');
    e.pointerDown({ x: 0.5, y: 0.5 });
    expect(e.structure.nodes).toHaveLength(1);
    expect(e.structure.beams).toHaveLength(0);
  });

  it('a rácsra ugrás kerekíti a bemenettől függetlenül a pontokat', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0.03, y: 0.02 },
      { x: 1.98, y: 0.04 },
    ]);
    const a = e.structure.nodes[0]!;
    const b = e.structure.nodes[1]!;
    expect(a.x).toBeCloseTo(0, 12);
    expect(a.y).toBeCloseTo(0, 12);
    expect(b.x).toBeCloseTo(2, 12);
    expect(Math.abs(e.totalLength() - 2)).toBeLessThan(1e-9);
  });
});

describe('szerkesztő — kijelölés és mozgatás', () => {
  it('kijelölés eszközzel rúdra kattintva a rúd lesz kijelölve', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: 1, y: 0 });
    expect(e.selectedBeams).toEqual([0]);
    expect(e.selectedNodes).toEqual([]);
  });

  it('csomópontot húzva mozognak a hozzá kapcsolódó rudak', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    expect(e.selectedNodes).toEqual([1]);
    e.pointerMove({ x: 2, y: 1.5 });
    e.pointerUp();
    expect(e.structure.nodes[1]!.y).toBeCloseTo(1.5, 12);
    expect(Math.abs(e.totalLength() - 2.5)).toBeLessThan(1e-9);
  });

  it('üresen húzott téglalap a benne lévő csomópontokat jelöli ki', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: -1, y: -1 },
      { x: 1, y: 1 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: -1.5, y: -1.5 });
    e.pointerMove({ x: 0.5, y: 0.5 });
    e.pointerUp();
    expect(e.selectedNodes.length).toBeGreaterThan(0);
  });

  it('törlés után az invariáns megmarad', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: 1, y: 0 });
    e.pointerMove({ x: 1, y: 0 });
    e.pointerUp();
    expect(e.selectedNodes).toEqual([1]);
    e.deleteSelection();
    expect(e.structure.nodes).toHaveLength(3);
    expect(e.structure.beams).toHaveLength(1);
    expect(structureIsConsistent(e.structure)).toBe(true);
  });
});

describe('szerkesztő — előzmények', () => {
  it('undo és redo visszaállítja a rajzot', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    const beamsAfterDraw = e.structure.beams.length;
    e.clearAll();
    expect(e.structure.beams).toHaveLength(0);
    e.doUndo();
    expect(e.structure.beams).toHaveLength(beamsAfterDraw);
    e.doRedo();
    expect(e.structure.beams).toHaveLength(0);
  });

  it('mozgatás után az undo a régi helyre állítja a csomópontot', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: 0, y: 0 });
    e.pointerMove({ x: 0, y: 1 });
    e.pointerUp();
    expect(e.structure.nodes[0]!.y).toBeCloseTo(1, 12);
    e.doUndo();
    expect(e.structure.nodes[0]!.y).toBeCloseTo(0, 12);
  });

  it('kattintás mozgatás nélkül nem hagy üres előzményt', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    e.pointerUp();
    e.setTool('beam');
    e.pointerDown({ x: 0, y: 0 });
    e.pointerDown({ x: 0, y: 2 });
    e.finishChain();
    expect(e.structure.beams).toHaveLength(2);
    e.doUndo();
    expect(e.structure.beams).toHaveLength(1);
  });
});

describe('szerkesztő — mentés, betöltés, kamera', () => {
  it('exportált modell visszatöltése azonos szerkezetet ad', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 },
    ]);
    const json = e.exportJSON();
    const e2 = makeEditor();
    expect(e2.importJSON(json)).toBe(true);
    expect(e2.structure.nodes).toHaveLength(e.structure.nodes.length);
    expect(e2.structure.beams).toHaveLength(e.structure.beams.length);
    expect(structureIsConsistent(e2.structure)).toBe(true);
  });

  it('hibás JSON eldobása nem rontja el a rajzot', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(e.importJSON('nem json')).toBe(false);
    expect(e.structure.beams).toHaveLength(1);
  });

  it('a kamera fordítottan járja körbe a pontokat', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 50 };
    const vp: Viewport = { width: 800, height: 600 };
    const s = worldToScreen(cam, vp, { x: 1, y: 0 });
    const w = screenToWorld(cam, vp, s);
    expect(w.x).toBeCloseTo(1, 12);
    expect(w.y).toBeCloseTo(0, 12);
    const up = worldToScreen(cam, vp, { x: 0, y: 1 });
    expect(up.y).toBeLessThan(vp.height / 2);
  });

  it('a zoom a horgonypont alatt marad', () => {
    const e = makeEditor();
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(e.camera, e.viewport, anchor);
    e.wheel(anchor, -100);
    const after = screenToWorld(e.camera, e.viewport, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(e.camera.zoom).toBeGreaterThan(60);
  });

  it('fit a rajz közepére hoz és a méretet is beleszabályozza', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 8, y: 4 },
    ]);
    e.fit();
    expect(e.camera.x).toBeCloseTo(4, 9);
    expect(e.camera.y).toBeCloseTo(2, 9);
    expect(e.camera.zoom).toBeCloseTo(80, 6);
  });
});

describe('szerkesztő — támaszok', () => {
  function portal(): Editor {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    drawBeam(e, [
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    return e;
  }

  it('támasz eszközzel csomópontra lerak', () => {
    const e = portal();
    e.setTool('support');
    e.setSupportType('pinned');
    e.pointerDown({ x: 0, y: 0 });
    expect(e.structure.supports).toHaveLength(1);
    expect(e.structure.supports[0]!.node).toBe(0);
    expect(e.structure.supports[0]!.type).toBe('pinned');
  });

  it('támasz csak csomópontra rakódik, üres helyre nincs', () => {
    const e = portal();
    e.setTool('support');
    e.pointerDown({ x: 5, y: 5 });
    expect(e.structure.supports).toHaveLength(0);
  });

  it('a típusváltás a helyén cseréli a támaszt', () => {
    const e = portal();
    e.setTool('support');
    e.setSupportType('pinned');
    e.pointerDown({ x: 0, y: 0 });
    e.setSupportType('fixed');
    e.pointerDown({ x: 0, y: 0 });
    expect(e.structure.supports).toHaveLength(1);
    expect(e.structure.supports[0]!.type).toBe('fixed');
  });

  it('a támaszszimbólumra kattintva a támasz jelölődik ki és törölhető', () => {
    const e = portal();
    e.setTool('support');
    e.setSupportType('roller');
    e.pointerDown({ x: 0, y: 0 });
    e.setTool('select');
    const cam = e.camera;
    const vp = e.viewport;
    // a támasz szimbóluma a csomópont alatt 20 px-rel rajzolódik
    const sx = 0 * cam.zoom + vp.width / 2;
    const sy = vp.height / 2 + 20;
    e.pointerDown({
      x: (sx - vp.width / 2) / cam.zoom,
      y: -(sy - vp.height / 2) / cam.zoom,
    });
    expect(e.selectedSupports).toEqual([0]);
    e.deleteSelection();
    expect(e.structure.supports).toHaveLength(0);
    expect(e.structure.nodes).toHaveLength(3);
  });

  it('a rácson futó portál két támasza egy kattintással kész', () => {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    e.setTool('support');
    e.pointerDown({ x: 0, y: 0 });
    e.pointerDown({ x: 4, y: 0 });
    e.setSupportType('roller');
    e.pointerDown({ x: 4, y: 0 });
    expect(e.structure.supports).toHaveLength(2);
    expect(structureIsConsistent(e.structure)).toBe(true);
  });
});

describe('szerkesztő — terhek', () => {
  function beamed(): Editor {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    return e;
  }

  it('konc. erő eszköz a beírt értékkel rak le erőt a csomópontra', () => {
    const e = beamed();
    e.setTool('force');
    e.setLoadValue({ fx: 0, fy: -10000 });
    e.pointerDown({ x: 4, y: 0 });
    expect(e.structure.loads).toHaveLength(1);
    expect(e.structure.loads[0]!.fy).toBe(-10000);
    expect(e.structure.loads[0]!.node).toBe(1);
  });

  it('a rúd közepére nem tesz koncentrált erőt, ott csak megoszló mehet', () => {
    const e = beamed();
    e.setTool('force');
    e.setLoadValue({ fy: -10000 });
    e.pointerDown({ x: 2, y: 0 });
    expect(e.structure.loads).toHaveLength(0);
  });

  it('nulla erővel nem jön létre teher', () => {
    const e = beamed();
    e.setTool('force');
    e.setLoadValue({ fx: 0, fy: 0 });
    e.pointerDown({ x: 4, y: 0 });
    expect(e.structure.loads).toHaveLength(0);
  });

  it('nyomaték eszköz csak a mz komponenst használja', () => {
    const e = beamed();
    e.setTool('moment');
    e.setLoadValue({ fy: -10000, mz: 2500 });
    e.pointerDown({ x: 4, y: 0 });
    expect(e.structure.loads[0]!.mz).toBe(2500);
    expect(e.structure.loads[0]!.fy).toBe(0);
  });

  it('megoszló teher eszköz a rúdra rakja', () => {
    const e = beamed();
    e.setTool('dist');
    e.setLoadValue({ qy: -5000 });
    e.pointerDown({ x: 2, y: 0 });
    expect(e.structure.distLoads).toHaveLength(1);
    expect(e.structure.distLoads[0]!.beam).toBe(0);
    expect(e.structure.distLoads[0]!.qy).toBe(-5000);
  });

  it('megoszló teher üres helyre nem jön létre', () => {
    const e = beamed();
    e.setTool('dist');
    e.pointerDown({ x: 9, y: 9 });
    expect(e.structure.distLoads).toHaveLength(0);
  });

  it('a teher-nyílra kattintva a teher jelölődik ki és törölhető', () => {
    const e = beamed();
    e.setTool('force');
    e.setLoadValue({ fy: -10000 });
    e.pointerDown({ x: 4, y: 0 });
    e.setTool('select');
    const vp = e.viewport;
    const sx = 4 * e.camera.zoom + vp.width / 2;
    const sy = vp.height / 2 + 31;
    e.pointerDown({
      x: (sx - vp.width / 2) / e.camera.zoom,
      y: -(sy - vp.height / 2) / e.camera.zoom,
    });
    expect(e.selectedLoads).toEqual([0]);
    e.deleteSelection();
    expect(e.structure.loads).toHaveLength(0);
  });

  it('a csomópont kijelölése és törlése a hozzá tartozó terhet is törli', () => {
    const e = beamed();
    e.setTool('force');
    e.setLoadValue({ fy: -10000 });
    e.pointerDown({ x: 4, y: 0 });
    e.setTool('select');
    e.pointerDown({ x: 4, y: 0 });
    expect(e.selectedNodes).toEqual([1]);
    e.deleteSelection();
    expect(e.structure.loads).toHaveLength(0);
    expect(structureIsConsistent(e.structure)).toBe(true);
  });

  it('undo a támaszt és a terhet is visszahozza', () => {
    const e = beamed();
    e.setTool('support');
    e.pointerDown({ x: 0, y: 0 });
    e.setTool('force');
    e.setLoadValue({ fy: -10000 });
    e.pointerDown({ x: 4, y: 0 });
    expect(e.structure.supports).toHaveLength(1);
    expect(e.structure.loads).toHaveLength(1);
    e.doUndo();
    expect(e.structure.loads).toHaveLength(0);
    e.doUndo();
    expect(e.structure.supports).toHaveLength(0);
    e.doRedo();
    e.doRedo();
    expect(e.structure.supports).toHaveLength(1);
    expect(e.structure.loads).toHaveLength(1);
  });

  it('a rajz törlése a támaszokat és terheket is elviszi, és visszavonható', () => {
    const e = beamed();
    e.setTool('support');
    e.pointerDown({ x: 0, y: 0 });
    e.setTool('force');
    e.setLoadValue({ fy: -10000 });
    e.pointerDown({ x: 4, y: 0 });
    e.clearAll();
    expect(e.structure.supports).toHaveLength(0);
    expect(e.structure.loads).toHaveLength(0);
    e.doUndo();
    expect(e.structure.supports).toHaveLength(1);
    expect(e.structure.loads).toHaveLength(1);
  });

  it('export és import megőrzi a támaszokat és terheket', () => {
    const e = beamed();
    e.setTool('support');
    e.setSupportType('fixed');
    e.pointerDown({ x: 0, y: 0 });
    e.setTool('dist');
    e.setLoadValue({ qy: -5000 });
    e.pointerDown({ x: 2, y: 0 });
    const json = e.exportJSON();
    expect(json).toContain('fixed');
    const e2 = makeEditor();
    expect(e2.importJSON(json)).toBe(true);
    expect(e2.structure.supports[0]!.type).toBe('fixed');
    expect(e2.structure.distLoads[0]!.qy).toBe(-5000);
  });
});

describe('szerkesztő — anyag és szelvény', () => {
  function beam(): Editor {
    const e = makeEditor();
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    return e;
  }

  it('az új rúd a szerkesztő aktuális alapértékét kapja', () => {
    const e = makeEditor();
    e.setSection('c25', 'sq200');
    drawBeam(e, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(e.structure.beams[0]!.materialId).toBe('c25');
    expect(e.structure.beams[0]!.sectionId).toBe('sq200');
    expect(e.structure.beams[0]!.id).toBe(0);
  });

  it('kijelölt rúdra a választás rákerül, és visszavonható', () => {
    const e = beam();
    const before = e.structure.beams[0]!.sectionId;
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    expect(e.selectedBeams).toEqual([0]);
    const applied = e.setSection('s355', 'ipe160');
    expect(applied).toBe(1);
    expect(e.structure.beams[0]!.sectionId).toBe('ipe160');
    expect(e.structure.beams[0]!.materialId).toBe('s355');
    e.doUndo();
    expect(e.structure.beams[0]!.sectionId).toBe(before);
  });

  it('kijelölés nélkül csak az alapérték változik, a meglévő rúd érintetlen', () => {
    const e = beam();
    const before = e.structure.beams[0]!.sectionId;
    expect(e.setSection('gl24', 'd60')).toBe(0);
    expect(e.structure.beams[0]!.sectionId).toBe(before);
    expect(e.materialId).toBe('gl24');
    expect(e.sectionId).toBe('d60');
  });

  it('az önsúly-kapcsoló a modellben tárolódik és a tömeg/súly számítása érinti', () => {
    const e = beam();
    e.setSection('s235', 'sq150');
    const before = e.totalMassAndWeight();
    expect(before.mass).toBeGreaterThan(0);
    e.setSelfWeight(true);
    expect(e.structure.selfWeight).toBe(true);
    e.setSelfWeight(false);
    expect(e.structure.selfWeight).toBe(false);
  });

  it('a tömeg a kijelölt rúd szelvényváltásával változik', () => {
    const e = beam();
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    e.setSection('s235', 'sq100');
    const small = e.totalMassAndWeight().mass;
    e.setSection('s235', 'sq200');
    const big = e.totalMassAndWeight().mass;
    expect(small).toBeGreaterThan(0);
    expect(big / small).toBeCloseTo(4, 6);
  });

  it('a törlés után visszamaradó kijelölésből a katalógus nem csúszik el', () => {
    const e = beam();
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    e.deleteSelection();
    expect(e.selectedBeams).toEqual([]);
    expect(structureIsConsistent(e.structure)).toBe(true);
  });

  it('az import után a kijelölés a betöltött katalógushoz igazodik', () => {
    const e = makeEditor();
    const donor = beam();
    donor.setTool('select');
    donor.pointerDown({ x: 2, y: 0 });
    donor.setSection('gl24', 'd60');
    const json = donor.exportJSON();
    expect(e.importJSON(json)).toBe(true);
    expect(e.structure.beams[0]!.sectionId).toBe('d60');
    expect(e.sectionId).toBe(e.structure.beams[0]!.sectionId);
    expect(structureIsConsistent(e.structure)).toBe(true);
  });

  it('a teljes modell mentés-visszatöltés után a katalógust is megőrzi', () => {
    const e = beam();
    e.setTool('select');
    e.pointerDown({ x: 2, y: 0 });
    e.setSection('s355', 'heb200');
    e.setSelfWeight(true);
    const json = e.exportJSON();
    const back = makeEditor();
    expect(back.importJSON(json)).toBe(true);
    expect(back.structure.beams[0]!.materialId).toBe('s355');
    expect(back.structure.beams[0]!.sectionId).toBe('heb200');
    expect(back.structure.selfWeight).toBe(true);
    expect(back.totalMassAndWeight().mass).toBeCloseTo(e.totalMassAndWeight().mass, 6);
  });
});
