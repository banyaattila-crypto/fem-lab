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
import type { LoadGroup } from './geometry';
import { materialById } from './catalog';
import {
  addMembraneEdgeLoad,
  addMembraneLoad,
  addRectMesh,
  createMembrane2D,
  edgeNear,
  membrane2DBounds,
  membrane2DIsEmpty,
  nodeNear,
  removeMembraneNode,
  setFixed,
  setMembraneSize,
  toMembraneModel,
} from './membrane2d';
import type { Membrane2D } from './membrane2d';
import { solveMembrane } from './membrane';
import type { MembraneResult } from './membrane';
import type { SolveResult } from './solver';
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
  /** A legutóbbi száítás eredménye; a modell módosításakor érvénytelenítjük. */
  result: SolveResult | null = null;
  showDeform = false;
  showDiagN = false;
  showDiagV = false;
  showDiagM = false;
  loadValue: LoadValues = { fx: 0, fy: -10000, mz: 0, qy: -5000 };
  /** az újonnan rajzolt terhek csoportja (állandó vagy változó teher) */
  loadGroup: LoadGroup = 'dead';
  /** szerkesztési mód: 1D váz vagy 2D membrán */
  mode: '1d' | '2d' = '1d';
  /** a 2D membránmodell számsítási eredménye */
  membraneResult: MembraneResult | null = null;
  /** a 2D rögzítés maszkja: 1 = ux, 2 = uy, 3 = mindkettő */
  membraneFixMask = 3;
  /** az új élterhek értéke [N/m] és a pontterhek [N] */
  membraneEdgeValue = 1000;
  membraneNodeValue: { fx: number; fy: number } = { fx: 0, fy: -1000 };
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
      loadGroup: this.loadGroup,
      materialId: this.materialId,
      sectionId: this.sectionId,
      selfWeight: this.structure.selfWeight,
      result: this.result,
      showDeform: this.showDeform,
      showDiagN: this.showDiagN,
      showDiagV: this.showDiagV,
      showDiagM: this.showDiagM,
      membrane2d: this.mode === '2d' ? this.membrane2d : null,
      membraneResult: this.membraneResult,
      previewFromPoint: this.previewFromPoint,
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
      this.snapshot();
      applied = assignBeams(this.structure, targets, materialId, sectionId);
    }
    if (materialId) this.materialId = materialId;
    if (sectionId) this.sectionId = sectionId;
    this.emit();
    return applied;
  }

  setSelfWeight(on: boolean): void {
    this.structure.selfWeight = on;
    this.invalidateResult();
    this.emit();
  }

  totalMassAndWeight(): { mass: number; weight: number } {
    return massAndWeight(this.structure);
  }

  setLoadValue(v: Partial<LoadValues>): void {
    this.loadValue = { ...this.loadValue, ...v };
    this.emit();
  }

  /** Az új terhek terheléscsoportja — a kombinációk ezt használják. */
  setLoadGroup(g: LoadGroup): void {
    this.loadGroup = g;
  }

  /** A modell megváltozott: a korábbi eredmény már nem érvényes. */
  invalidateResult(): void {
    this.result = null;
    this.membraneResult = null;
  }

  /** Előzmény-mentés a modell módosítása előtt, az eredmény érvénytelenítésével. */
  private snapshot(): void {
    this.invalidateResult();
    commit(this.history, this.structure);
  }

  private toScreen(p: Point): Point {
    return worldToScreen(this.camera, this.viewport, p);
  }

  /** a 2D membránmodell; szükség esetén létrehozva */
  get membrane2d(): Membrane2D {
    if (!this.structure.membrane2d) this.structure.membrane2d = createMembrane2D();
    return this.structure.membrane2d;
  }

  /** Van-e rajzolható 2D modell? (üres modellnél a hálórajzoló eszközt kikapcsoljuk) */
  hasMembraneMesh(): boolean {
    return !!this.structure.membrane2d && !membrane2DIsEmpty(this.structure.membrane2d);
  }

  /**
   * Váltás az 1D és a 2D mód között. A modell megmarad, csak a szerkesztő
   * eszközkészlete és a megjelenítés változik.
   */
  setMode(mode: '1d' | '2d'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.preview = null;
    this.previewFrom = -1;
    this.marquee = null;
    this.clearItemSelection();
    this.tool = mode === '2d' ? 'mesh' : 'beam';
    this.invalidateResult();
    this.emit();
  }

  /** A 2D modell méretei: lemezvastagság [m] és hálófelbontás. */
  setMembraneSize(thickness: number, divisions: number): void {
    this.snapshot();
    setMembraneSize(this.membrane2d, thickness, divisions);
    this.emit();
  }

  /**
   * A 2D modell számsítása a kiválasztott katalógusanyaggal. A háló
   * konzisztenciahibájánál és a szingularitásnál is sikertelen eredményt ad.
   */
  solveMembraneModel(): MembraneResult | null {
    const m = this.structure.membrane2d;
    if (!m || membrane2DIsEmpty(m)) {
      this.membraneResult = null;
      this.emit();
      return null;
    }
    const mat = materialById(this.structure.catalog, this.materialId) ?? this.structure.catalog.materials[0];
    if (!mat) {
      this.membraneResult = null;
      this.emit();
      return null;
    }
    const res = solveMembrane(toMembraneModel(m, mat.E, mat.nu));
    res.yield = (mat.fy * 1e6) / 1.15;
    res.utilization = res.maxVonMises / res.yield;
    this.membraneResult = res;
    this.emit();
    return res;
  }

  /** A 2D modellre állítja a kamerát, hogy teljesen látszódjon. */
  fitMembrane(): void {
    const m = this.structure.membrane2d;
    if (!m || m.nodes.length === 0) return;
    const b = membrane2DBounds(m);
    if (!b) return;
    this.camera = fitToPoints(
      this.camera,
      this.viewport,
      [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.maxY },
      ],
      80,
    );
    this.emit();
  }

  // --- 2D membrán szerkesztés -------------------------------------------

  private pointerDown2D(w: Point): void {
    const m = this.membrane2d;
    switch (this.tool) {
      case 'mesh': {
        // a téglalap első sarokpontja a lenyomás helye, a második az egér
        this.dragFrom2D = w;
        this.preview = w;
        this.emit();
        return;
      }
      case 'fix': {
        const n = nodeNear(m, w, this.tol());
        if (n < 0) return;
        this.snapshot();
        const cur = m.fixed.find((f) => f.node === n)?.mask ?? 0;
        setFixed(m, n, cur === this.membraneFixMask ? 0 : this.membraneFixMask);
        this.emit();
        return;
      }
      case 'edgeLoad': {
        const hit = edgeNear(m, w, this.tol() * 1.5);
        if (!hit) return;
        this.snapshot();
        addMembraneEdgeLoad(m, hit.from, hit.to, this.membraneEdgeValue);
        this.emit();
        return;
      }
      case 'nodeLoad': {
        const n = nodeNear(m, w, this.tol());
        if (n < 0) return;
        this.snapshot();
        addMembraneLoad(m, n, this.membraneNodeValue.fx, this.membraneNodeValue.fy);
        this.emit();
        return;
      }
      default: {
        const n = nodeNear(m, w, this.tol());
        this.selectedNodes = n >= 0 ? [n] : [];
        this.emit();
      }
    }
  }

  /** a 2D hálórajzoló első sarokpontja (húzás közben) */
  private dragFrom2D: Point | null = null;
  /** a húzás első sarokpontja a jelenet számára */
  private previewFromPoint: Point | null = null;

  private pointerMove2D(w: Point): void {
    const m = this.membrane2d;
    if (this.tool === 'mesh') {
      this.preview = this.dragFrom2D ? w : null;
      this.previewFromPoint = this.dragFrom2D;
      this.emit();
      return;
    }
    this.hoverNode = nodeNear(m, w, this.tol());
    this.emit();
  }

  private pointerUp2D(): void {
    const m = this.membrane2d;
    if (this.tool === 'mesh' && this.dragFrom2D && this.preview) {
      const a = this.dragFrom2D;
      const b = this.preview;
      if (Math.abs(a.x - b.x) > this.tol() && Math.abs(a.y - b.y) > this.tol()) {
        this.snapshot();
        addRectMesh(m, a, b, m.divisions);
      }
    }
    this.dragFrom2D = null;
    this.preview = null;
    this.previewFromPoint = null;
    this.emit();
  }

  private deleteSelection2D(): boolean {
    const m = this.structure.membrane2d;
    if (!m || this.selectedNodes.length === 0) return false;
    this.snapshot();
    for (const id of [...this.selectedNodes].sort((a, b) => b - a)) removeMembraneNode(m, id);
    this.selectedNodes = [];
    this.emit();
    return true;
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

    if (this.mode === '2d') {
      this.pointerDown2D(w);
      return;
    }

    if (this.tool === 'node') {
      this.snapshot();
      addNode(this.structure, w.x, w.y);
      this.emit();
      return;
    }

    if (this.tool === 'beam') {
      const near = findNodeNear(this.structure, w, this.tol());
      if (this.previewFrom < 0) {
        if (!near) this.snapshot();
        this.previewFrom = near ? near.id : addNode(this.structure, w.x, w.y);
        this.emit();
        return;
      }
      const from = this.previewFrom;
      let to: number;
      if (near) {
        to = near.id;
      } else {
        this.snapshot();
        to = addNode(this.structure, w.x, w.y);
      }
      if (from !== to && !this.hasBeam(from, to)) {
        if (near) this.snapshot();
        addBeam(this.structure, from, to, this.materialId, this.sectionId);
      }
      this.previewFrom = to;
      this.emit();
      return;
    }

    if (this.tool === 'support') {
      const near = findNodeNear(this.structure, w, this.tol());
      if (!near) return;
      this.snapshot();
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
      this.snapshot();
      addPointLoad(this.structure, near.id, useFx, useFy, useMz, this.loadGroup);
      this.emit();
      return;
    }

    if (this.tool === 'dist') {
      const near = findBeamNear(this.structure, w, this.tol());
      if (!near || this.loadValue.qy === 0) return;
      this.snapshot();
      addDistLoad(this.structure, near.id, this.loadValue.qy, this.loadGroup);
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
      this.snapshot();
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
    if (this.mode === '2d') {
      this.pointerMove2D(w);
      return;
    }
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
    if (this.mode === '2d') {
      this.pointerUp2D();
      return;
    }
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
    if (this.mode === '2d' && this.deleteSelection2D()) return;
    const hasAnything =
      this.selectedNodes.length > 0 ||
      this.selectedBeams.length > 0 ||
      this.selectedSupports.length > 0 ||
      this.selectedLoads.length > 0 ||
      this.selectedDist.length > 0;
    if (!hasAnything) return;
    this.snapshot();
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
    if (this.structure.nodes.length === 0 && !this.hasMembraneMesh()) return;
    this.snapshot();
    this.structure = createStructure();
    this.invalidateResult();
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
      this.snapshot();
      this.structure = s;
      this.invalidateResult();
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
    this.snapshot();
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
