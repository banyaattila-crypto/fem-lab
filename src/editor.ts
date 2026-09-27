import { createCamera, fitToPoints, zoomAt } from './camera';
import type { Camera } from './camera';
import {
  addBeam,
  addDistLoad,
  addNode,
  addPointLoad,
  cloneStructure,
  createStructure,
  findBeamNear,
  findNodeNear,
  moveNode,
  nodeById,
  removeBeam,
  removeDistLoad,
  removeNode,
  removePointLoad,
  removeSupport,
  setSupport,
  snapPoint,
  structureIsConsistent,
  toJSON,
  fromJSON,
} from './geometry';
import type { Beam, Point, Structure, SupportType } from './geometry';
import { assignBeams, defaultMaterialId, defaultSectionId, massAndWeight } from './geometry';
import { canRedo, canUndo, commit, createHistory, redo, undo } from './history';
import type { HistoryState } from './history';
import type { SceneState, Tool } from './render';
import { worldToScreen } from './camera';
import { PX } from './render';

export interface LoadValues {
  fx: number;
  fy: number;
  mz: number;
  qy: number;
}

export interface EditorOptions {
  gridStep?: number;
}

export type ChangeListener = (s: Editor) => void;

type DragMode = 'none' | 'nodes' | 'marquee';

function segDist(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export class Editor {
  structure: Structure = createStructure();
  camera: Camera = createCamera();
  tool: Tool = 'beam';
  gridStep: number;
  snap = true;
  selectedNodes: number[] = [];
  selectedBeams: number[] = [];
  selectedSupports: number[] = [];
  selectedLoads: number[] = [];
  selectedDist: number[] = [];
  supportType: SupportType = 'pinned';
  materialId = '';
  sectionId = '';
  loadValue: LoadValues = { fx: 0, fy: -10000, mz: 0, qy: -5000 };
  hoverNode = -1;
  hoverBeam = -1;
  preview: Point | null = null;
  previewFrom = -1;
  marquee: SceneState['marquee'] = null;
  history: HistoryState = createHistory();
  viewport = { width: 800, height: 600 };

  private dragMode: DragMode = 'none';
  private dragOrigin: Point = { x: 0, y: 0 };
  private dragMoved = false;
  private listeners: ChangeListener[] = [];

  constructor(opts: EditorOptions = {}) {
    this.gridStep = opts.gridStep ?? 0.25;
    this.materialId = defaultMaterialId(this.structure);
    this.sectionId = defaultSectionId(this.structure);
  }

  onChange(fn: ChangeListener): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }

  scene(): SceneState {
    return {
      structure: this.structure,
      camera: this.camera,
      viewport: this.viewport,
      tool: this.tool,
      selectedNodes: this.selectedNodes,
      selectedBeams: this.selectedBeams,
      selectedSupports: this.selectedSupports,
      selectedLoads: this.selectedLoads,
      selectedDist: this.selectedDist,
      hoverNode: this.hoverNode,
      hoverBeam: this.hoverBeam,
      preview: this.preview,
      previewFrom: this.previewFrom,
      marquee: this.marquee,
      gridStep: this.gridStep,
      snap: this.snap,
      supportType: this.supportType,
      loadValue: this.loadValue,
      materialId: this.materialId,
      sectionId: this.sectionId,
      selfWeight: this.structure.selfWeight,
    };
  }

  /**
   * Az aktuális anyag/szelvény választást érvényben tartja a katalóguson. Ha a
   * modell tartalmaz rudat, a panel a betöltött modell első rúdját követi, hogy
   * a legördülők ne mutassanak mást, mint amit a vászonon lát a felhasználó.
   */
  private syncCatalogSelection(): void {
    const c = this.structure.catalog;
    const first = this.structure.beams[0];
    const matId = first?.materialId ?? this.materialId;
    const secId = first?.sectionId ?? this.sectionId;
    this.materialId = c.materials.some((m) => m.id === matId) ? matId : defaultMaterialId(this.structure);
    this.sectionId = c.sections.some((sec) => sec.id === secId) ? secId : defaultSectionId(this.structure);
  }

  setSupportType(t: SupportType): void {
    this.supportType = t;
    this.emit();
  }

  /**
   * Anyag/szelvény választás. Ha van kijelölt rúd, azokra alkalmazza; ha nincs,
   * csak az új rudak alapértékét állítja be.
   */
  setSection(materialId: string, sectionId: string): number {
    const targets = this.selectedBeams;
    let applied = 0;
    if (targets.length > 0) {
      commit(this.history, this.structure);
      applied = assignBeams(this.structure, targets, materialId, sectionId);
    }
    if (materialId) this.materialId = materialId;
    if (sectionId) this.sectionId = sectionId;
    this.emit();
    return applied;
  }

  setSelfWeight(on: boolean): void {
    this.structure.selfWeight = on;
    this.emit();
  }

  totalMassAndWeight(): { mass: number; weight: number } {
    return massAndWeight(this.structure);
  }

  setLoadValue(v: Partial<LoadValues>): void {
    this.loadValue = { ...this.loadValue, ...v };
    this.emit();
  }

  private toScreen(p: Point): Point {
    return worldToScreen(this.camera, this.viewport, p);
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.preview = null;
    this.previewFrom = -1;
    this.emit();
  }

  setGridStep(step: number): void {
    this.gridStep = step > 0 ? step : 0.25;
    this.emit();
  }

  setSnap(on: boolean): void {
    this.snap = on;
    this.emit();
  }

  private tol(): number {
    return 10 / this.camera.zoom;
  }

  private worldPoint(p: Point): Point {
    return this.snap ? snapPoint(p, this.gridStep) : p;
  }

  pointerDown(p: Point): void {
    const w = this.worldPoint(p);
    this.dragOrigin = p;
    this.dragMoved = false;

    if (this.tool === 'node') {
      commit(this.history, this.structure);
      addNode(this.structure, w.x, w.y);
      this.emit();
      return;
    }

    if (this.tool === 'beam') {
      const near = findNodeNear(this.structure, w, this.tol());
      if (this.previewFrom < 0) {
        if (!near) commit(this.history, this.structure);
        this.previewFrom = near ? near.id : addNode(this.structure, w.x, w.y);
        this.emit();
        return;
      }
      const from = this.previewFrom;
      let to: number;
      if (near) {
        to = near.id;
      } else {
        commit(this.history, this.structure);
        to = addNode(this.structure, w.x, w.y);
      }
      if (from !== to && !this.hasBeam(from, to)) {
        if (near) commit(this.history, this.structure);
        addBeam(this.structure, from, to, this.materialId, this.sectionId);
      }
      this.previewFrom = to;
      this.emit();
      return;
    }

    if (this.tool === 'support') {
      const near = findNodeNear(this.structure, w, this.tol());
      if (!near) return;
      commit(this.history, this.structure);
      setSupport(this.structure, near.id, this.supportType);
      this.emit();
      return;
    }

    if (this.tool === 'force' || this.tool === 'moment') {
      const near = findNodeNear(this.structure, w, this.tol());
      if (!near) return;
      const { fx, fy, mz } = this.loadValue;
      const useFx = this.tool === 'force' ? fx : 0;
      const useFy = this.tool === 'force' ? fy : 0;
      const useMz = this.tool === 'moment' ? mz : 0;
      if (useFx === 0 && useFy === 0 && useMz === 0) return;
      commit(this.history, this.structure);
      addPointLoad(this.structure, near.id, useFx, useFy, useMz);
      this.emit();
      return;
    }

    if (this.tool === 'dist') {
      const near = findBeamNear(this.structure, w, this.tol());
      if (!near || this.loadValue.qy === 0) return;
      commit(this.history, this.structure);
      addDistLoad(this.structure, near.id, this.loadValue.qy);
      this.emit();
      return;
    }

    const nearNode = findNodeNear(this.structure, w, this.tol());
    if (nearNode) {
      this.dragMode = 'nodes';
      this.clearItemSelection();
      if (!this.selectedNodes.includes(nearNode.id)) this.selectedBeams = [];
      if (!this.selectedNodes.includes(nearNode.id)) {
        this.selectedNodes = [nearNode.id];
      }
      commit(this.history, this.structure);
      this.emit();
      return;
    }
    const hit = this.hitSelect(w);
    if (hit && hit.kind === 'support') {
      this.selectedSupports = [hit.id];
      this.selectedNodes = [];
      this.selectedBeams = [];
      this.selectedLoads = [];
      this.selectedDist = [];
      this.emit();
      return;
    }
    if (hit && hit.kind === 'load') {
      this.selectedLoads = [hit.id];
      this.selectedSupports = [];
      this.selectedNodes = [];
      this.selectedBeams = [];
      this.selectedDist = [];
      this.emit();
      return;
    }
    if (hit && hit.kind === 'dist') {
      this.selectedDist = [hit.id];
      this.selectedSupports = [];
      this.selectedNodes = [];
      this.selectedBeams = [];
      this.selectedLoads = [];
      this.emit();
      return;
    }

    const nearBeam = findBeamNear(this.structure, w, this.tol());
    if (nearBeam) {
      this.clearItemSelection();
      this.selectedBeams = [nearBeam.id];
      this.selectedNodes = [];
      this.emit();
      return;
    }
    this.clearItemSelection();
    this.dragMode = 'marquee';
    this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    this.emit();
  }

  private clearItemSelection(): void {
    this.selectedSupports = [];
    this.selectedLoads = [];
    this.selectedDist = [];
  }

  /**
   * Kijelölésnél a képernyőn rajzolt szimbólumok (támasz, teher-nyíl) közelében
   * keresünk — ezek pixel-méretűek, nem világ-koordinátásak.
   */
  private hitSelect(world: Point): { kind: 'support' | 'load' | 'dist'; id: number } | null {
    const sp = this.toScreen(world);
    for (const sup of this.structure.supports) {
      const n = nodeById(this.structure, sup.node);
      if (!n) continue;
      const p = this.toScreen(n);
      if (Math.hypot(sp.x - p.x, sp.y - (p.y + 20)) < 22) return { kind: 'support', id: sup.node };
    }
    for (const ld of this.structure.loads) {
      const n = nodeById(this.structure, ld.node);
      if (!n) continue;
      const p = this.toScreen(n);
      if (ld.mz !== 0 && Math.abs(Math.hypot(sp.x - p.x, sp.y - p.y) - PX.momentRadius) < 9) {
        return { kind: 'load', id: ld.id };
      }
      if (ld.fx !== 0 || ld.fy !== 0) {
        const mag = Math.hypot(ld.fx, ld.fy);
        const tip = {
          x: p.x + (ld.fx / mag) * PX.loadArrow,
          y: p.y - (ld.fy / mag) * PX.loadArrow,
        };
        if (segDist(sp, p, tip) < 8) return { kind: 'load', id: ld.id };
      }
    }
    for (const dl of this.structure.distLoads) {
      const bm = this.structure.beams.find((b) => b.id === dl.beam);
      if (!bm) continue;
      const a = nodeById(this.structure, bm.nodeI);
      const b = nodeById(this.structure, bm.nodeJ);
      if (!a || !b) continue;
      const pa = this.toScreen(a);
      const pb = this.toScreen(b);
      const sign = dl.qy >= 0 ? 1 : -1;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      if (len < 12) continue;
      const nx = (-dy / len) * PX.distArrow * sign;
      const ny = (dx / len) * PX.distArrow * sign;
      if (segDist(sp, { x: pa.x + nx, y: pa.y + ny }, { x: pb.x + nx, y: pb.y + ny }) < 10) {
        return { kind: 'dist', id: dl.id };
      }
    }
    return null;
  }

  private hasBeam(a: number, b: number): boolean {
    return this.structure.beams.some(
      (bm) =>
        (bm.nodeI === a && bm.nodeJ === b) || (bm.nodeI === b && bm.nodeJ === a),
    );
  }

  pointerMove(p: Point): void {
    const w = this.worldPoint(p);
    if (this.dragMode === 'nodes') {
      this.dragMoved = true;
      for (const id of this.selectedNodes) moveNode(this.structure, id, w.x, w.y);
      this.emit();
      return;
    }
    if (this.dragMode === 'marquee') {
      this.dragMoved = true;
      this.marquee = { x0: this.dragOrigin.x, y0: this.dragOrigin.y, x1: p.x, y1: p.y };
      this.emit();
      return;
    }
    if (this.tool === 'beam' || this.tool === 'node') {
      this.preview = w;
      this.hoverNode = findNodeNear(this.structure, w, this.tol())?.id ?? -1;
      this.hoverBeam = -1;
      this.emit();
      return;
    }
    const nearNode = findNodeNear(this.structure, w, this.tol());
    this.hoverNode = nearNode?.id ?? -1;
    this.hoverBeam = nearNode ? -1 : (findBeamNear(this.structure, w, this.tol())?.id ?? -1);
    this.emit();
  }

  pointerUp(additive = false): void {
    if (this.dragMode === 'marquee' && this.marquee) this.applyMarquee(additive);
    if (this.dragMode === 'nodes' && !this.dragMoved) {
      this.history.past.pop();
    }
    this.dragMode = 'none';
    this.marquee = null;
    this.emit();
  }

  private applyMarquee(additive: boolean): void {
    const m = this.marquee;
    if (!m) return;
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    const inside = (n: Point): boolean =>
      n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY;
    const nodes = this.structure.nodes.filter(inside);
    const beams = this.structure.beams.filter((bm) => {
      const a = nodeById(this.structure, bm.nodeI);
      const b = nodeById(this.structure, bm.nodeJ);
      if (!a || !b) return false;
      return inside(a) && inside(b);
    });
    if (!additive) this.clearItemSelection();
    this.selectedNodes = additive
      ? [...new Set([...this.selectedNodes, ...nodes.map((n) => n.id)])]
      : nodes.map((n) => n.id);
    this.selectedBeams = additive
      ? [...new Set([...this.selectedBeams, ...beams.map((b) => b.id)])]
      : beams.map((b) => b.id);
  }

  finishChain(): void {
    this.previewFrom = -1;
    this.preview = null;
    this.emit();
  }

  deleteSelection(): void {
    const hasAnything =
      this.selectedNodes.length > 0 ||
      this.selectedBeams.length > 0 ||
      this.selectedSupports.length > 0 ||
      this.selectedLoads.length > 0 ||
      this.selectedDist.length > 0;
    if (!hasAnything) return;
    commit(this.history, this.structure);
    for (const id of [...this.selectedDist]) removeDistLoad(this.structure, id);
    for (const id of [...this.selectedLoads]) removePointLoad(this.structure, id);
    for (const id of [...this.selectedSupports]) removeSupport(this.structure, id);
    for (const id of [...this.selectedBeams]) removeBeam(this.structure, id);
    for (const id of [...this.selectedNodes]) removeNode(this.structure, id);
    this.selectedNodes = [];
    this.selectedBeams = [];
    this.selectedSupports = [];
    this.selectedLoads = [];
    this.selectedDist = [];
    this.emit();
  }

  clearAll(): void {
    if (this.structure.nodes.length === 0) return;
    commit(this.history, this.structure);
    this.structure = createStructure();
    this.materialId = defaultMaterialId(this.structure);
    this.sectionId = defaultSectionId(this.structure);
    this.selectedNodes = [];
    this.selectedBeams = [];
    this.clearItemSelection();
    this.previewFrom = -1;
    this.preview = null;
    this.emit();
  }

  wheel(p: Point, deltaY: number): void {
    this.camera = zoomAt(this.camera, this.viewport, p, deltaY < 0 ? 1.12 : 1 / 1.12);
    this.emit();
  }

  pan(dx: number, dy: number): void {
    this.camera = {
      ...this.camera,
      x: this.camera.x - dx / this.camera.zoom,
      y: this.camera.y + dy / this.camera.zoom,
    };
    this.emit();
  }

  fit(): void {
    this.camera = fitToPoints(this.camera, this.viewport, this.structure.nodes);
    this.emit();
  }

  resetCamera(): void {
    this.camera = createCamera();
    this.emit();
  }

  doUndo(): void {
    const prev = undo(this.history, this.structure);
    if (!prev) return;
    this.structure = prev;
    this.pruneSelection();
    this.emit();
  }

  doRedo(): void {
    const next = redo(this.history, this.structure);
    if (!next) return;
    this.structure = next;
    this.pruneSelection();
    this.emit();
  }

  undoAvailable(): boolean {
    return canUndo(this.history);
  }

  redoAvailable(): boolean {
    return canRedo(this.history);
  }

  private pruneSelection(): void {
    this.selectedNodes = this.selectedNodes.filter((id) => nodeById(this.structure, id));
    this.selectedBeams = this.selectedBeams.filter(
      (id) => this.structure.beams.some((b: Beam) => b.id === id),
    );
    this.selectedSupports = this.selectedSupports.filter((id) => nodeById(this.structure, id));
    this.selectedLoads = this.selectedLoads.filter(
      (id) => this.structure.loads.some((l) => l.id === id),
    );
    this.selectedDist = this.selectedDist.filter(
      (id) => this.structure.distLoads.some((l) => l.id === id),
    );
  }

  exportJSON(): string {
    return JSON.stringify(toJSON(this.structure), null, 2);
  }

  importJSON(text: string): boolean {
    try {
      const parsed = JSON.parse(text) as ReturnType<typeof toJSON>;
      const s = fromJSON(parsed);
      if (!structureIsConsistent(s)) return false;
      commit(this.history, this.structure);
      this.structure = s;
      this.syncCatalogSelection();
      this.pruneSelection();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  duplicateSelection(): void {
    if (this.selectedBeams.length === 0) return;
    commit(this.history, this.structure);
    for (const id of [...this.selectedBeams]) {
      const bm = this.structure.beams.find((b) => b.id === id);
      if (!bm) continue;
      const a = nodeById(this.structure, bm.nodeI);
      const b = nodeById(this.structure, bm.nodeJ);
      if (!a || !b) continue;
      const na = addNode(this.structure, a.x, a.y + this.gridStep * 2);
      const nb = addNode(this.structure, b.x, b.y + this.gridStep * 2);
      addBeam(this.structure, na, nb, this.materialId, this.sectionId);
    }
    this.emit();
  }

  totalLength(): number {
    let sum = 0;
    for (const bm of this.structure.beams) {
      const a = nodeById(this.structure, bm.nodeI);
      const b = nodeById(this.structure, bm.nodeJ);
      if (a && b) sum += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return sum;
  }

  structureCopy(): Structure {
    return cloneStructure(this.structure);
  }
}
