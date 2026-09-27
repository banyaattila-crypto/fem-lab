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
