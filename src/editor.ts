import { createCamera, fitToPoints, zoomAt } from './camera';
import type { Camera } from './camera';
import {
  addBeam,
  addNode,
  cloneStructure,
  createStructure,
  findBeamNear,
  findNodeNear,
  moveNode,
  nodeById,
  removeBeam,
  removeNode,
  snapPoint,
  structureIsConsistent,
  toJSON,
  fromJSON,
} from './geometry';
import type { Beam, Point, Structure } from './geometry';
import { canRedo, canUndo, commit, createHistory, redo, undo } from './history';
import type { HistoryState } from './history';
import type { SceneState, Tool } from './render';

export interface EditorOptions {
  gridStep?: number;
}

export type ChangeListener = (s: Editor) => void;

type DragMode = 'none' | 'nodes' | 'marquee';

export class Editor {
  structure: Structure = createStructure();
  camera: Camera = createCamera();
  tool: Tool = 'beam';
  gridStep: number;
  snap = true;
  selectedNodes: number[] = [];
  selectedBeams: number[] = [];
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
      hoverNode: this.hoverNode,
      hoverBeam: this.hoverBeam,
      preview: this.preview,
      previewFrom: this.previewFrom,
      marquee: this.marquee,
      gridStep: this.gridStep,
      snap: this.snap,
    };
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
        addBeam(this.structure, from, to);
      }
      this.previewFrom = to;
      this.emit();
      return;
    }

    const nearNode = findNodeNear(this.structure, w, this.tol());
    if (nearNode) {
      this.dragMode = 'nodes';
      if (!this.selectedNodes.includes(nearNode.id)) {
        this.selectedNodes = [nearNode.id];
        this.selectedBeams = [];
      }
      commit(this.history, this.structure);
      this.emit();
      return;
    }
    const nearBeam = findBeamNear(this.structure, w, this.tol());
    if (nearBeam) {
      this.selectedBeams = [nearBeam.id];
      this.selectedNodes = [];
      this.emit();
      return;
    }
    this.dragMode = 'marquee';
    this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    this.emit();
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
    if (this.selectedNodes.length === 0 && this.selectedBeams.length === 0) return;
    commit(this.history, this.structure);
    for (const id of [...this.selectedBeams]) removeBeam(this.structure, id);
    for (const id of [...this.selectedNodes]) removeNode(this.structure, id);
    this.selectedNodes = [];
    this.selectedBeams = [];
    this.emit();
  }

  clearAll(): void {
    if (this.structure.nodes.length === 0) return;
    commit(this.history, this.structure);
    this.structure = createStructure();
    this.selectedNodes = [];
    this.selectedBeams = [];
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
      addBeam(this.structure, na, nb);
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
