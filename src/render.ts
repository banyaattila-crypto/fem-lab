import { beamSection, nodeById } from './geometry';
import type { Beam, LoadGroup, Structure, SupportType } from './geometry';
import { materialById, sectionById } from './catalog';
import { screenToWorld, worldToScreen } from './camera';
import type { Camera, Viewport } from './camera';
import type { SolveResult } from './solver';
import { deformedNode, deformedPointAt, internalAt } from './solver';
import type { Point } from './geometry';
import type { MembraneResult } from './membrane';
import type { Membrane2D } from './membrane2d';

/**
 * Eszközök. Az első hét az 1D vázszerkesztőé, a 'mesh'|'fix'|'edgeLoad'|
 * 'nodeLoad' a 2D membránszerkesztőé.
 */
export type Tool =
  | 'select'
  | 'node'
  | 'beam'
  | 'support'
  | 'force'
  | 'moment'
  | 'dist'
  | 'mesh'
  | 'fix'
  | 'edgeLoad'
  | 'nodeLoad';

export interface SceneState {
  structure: Structure;
  camera: Camera;
  viewport: Viewport;
  tool: Tool;
  selectedNodes: number[];
  selectedBeams: number[];
  selectedSupports: number[];
  selectedLoads: number[];
  selectedDist: number[];
  hoverNode: number;
  hoverBeam: number;
  preview: Point | null;
  previewFrom: number;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  gridStep: number;
  snap: boolean;
  supportType: SupportType;
  materialId: string;
  sectionId: string;
  selfWeight: boolean;
  result: SolveResult | null;
  showDeform: boolean;
  showDiagN: boolean;
  showDiagV: boolean;
  showDiagM: boolean;
  loadValue: { fx: number; fy: number; mz: number; qy: number };
  loadGroup: LoadGroup;
  /** a 2D membránmodell és annak számsítási eredménye (2D módban) */
  membrane2d: Membrane2D | null;
  membraneResult: MembraneResult | null;
  /** a 2D hálórajzoló első sarokpontja (húzás közben) */
  previewFromPoint: Point | null;
}

export const PX = {
  loadArrow: 62,
  distArrow: 38,
  support: 17,
  momentRadius: 20,
};

export const COLORS = {
  bg: '#0e1420',
  gridMinor: 'rgba(120,140,180,0.10)',
  gridMajor: 'rgba(120,140,180,0.22)',
  axis: 'rgba(160,190,255,0.45)',
  beam: '#7fb2ff',
  beamSelected: '#ffd166',
  beamHover: '#a8c8ff',
  node: '#e6edf7',
  deformed: '#ff7ad9',
  diagN: '#6ee7a8',
  diagV: '#ffd166',
  diagM: '#ff8a5c',
  nodeSelected: '#ffd166',
  nodeHover: '#ffffff',
  preview: '#9ad5a0',
  marquee: 'rgba(255,209,102,0.18)',
  marqueeLine: 'rgba(255,209,102,0.7)',
  text: '#9fb0cc',
  support: '#7fe0b0',
  supportSelected: '#ffd166',
  load: '#ff8f6b',
  live: '#7ab8ff',
  loadSelected: '#ffd166',
  ghost: 'rgba(159,176,204,0.55)',
};

function roundPow(value: number): number {
  const exp = Math.floor(Math.log10(value));
  return Math.pow(10, exp);
}

function niceGridStep(zoom: number, base: number): { minor: number; major: number } {
  const target = base / zoom;
  const p = roundPow(target);
  const n = target / p;
  let mult = 1;
  if (n > 5) mult = 5;
  else if (n > 2) mult = 2;
  const minor = mult * p;
  return { minor, major: minor * 5 };
}

/**
 * A terhelésszín a csoporttól függ: állandó teher narancs, változó kék. Így a
 * képen látszik, mi számít bele a szolgálati és mi az ULS kombinációba.
 */
function loadColor(sel: boolean, g: LoadGroup): string {
  if (sel) return COLORS.loadSelected;
  return g === 'live' ? COLORS.live : COLORS.load;
}

export function drawGrid(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { camera: cam, viewport: vp, gridStep } = st;
  const tl = screenToWorld(cam, vp, { x: 0, y: 0 });
  const br = screenToWorld(cam, vp, { x: vp.width, y: vp.height });
  const { minor, major } = niceGridStep(cam.zoom, gridStep);

  const drawSet = (step: number, color: string, width: number): void => {
    if (step * cam.zoom < 6) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const sx = worldToScreen(cam, vp, { x, y: 0 }).x;
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, vp.height);
    }
    for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      const sy = worldToScreen(cam, vp, { x: 0, y }).y;
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(vp.width, Math.round(sy) + 0.5);
    }
    ctx.stroke();
  };

  drawSet(minor, COLORS.gridMinor, 1);
  drawSet(major, COLORS.gridMajor, 1);

  const o = worldToScreen(cam, vp, { x: 0, y: 0 });
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(Math.round(o.x) + 0.5, 0);
  ctx.lineTo(Math.round(o.x) + 0.5, vp.height);
  ctx.moveTo(0, Math.round(o.y) + 0.5);
  ctx.lineTo(vp.width, Math.round(o.y) + 0.5);
  ctx.stroke();
}

/**
 * A vonalvastagság a keresztmetszet területét követi, hogy a rajzon látszódjon,
 * melyik rúd nagyobb (√A skálázás, 2–11 px közé szorítva).
 */
function beamLineWidth(s: Structure, bm: Beam, selected: boolean): number {
  const props = beamSection(s, bm);
  if (!props) return selected ? 7 : 5;
  const w = Math.sqrt(props.A) * 2.6;
  const base = Math.max(2, Math.min(11, w));
  return selected ? base + 2 : base;
}

function drawBeamLabel(
  ctx: CanvasRenderingContext2D,
  st: SceneState,
  bm: Beam,
  at: Point,
): void {
  const sec = sectionById(st.structure.catalog, bm.sectionId);
  const mat = materialById(st.structure.catalog, bm.materialId);
  if (!sec || !mat) return;
  const text = `${sec.name} · ${mat.name}`;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const w = ctx.measureText(text).width;
  const x = at.x + 10;
  const y = at.y - 10;
  ctx.fillStyle = 'rgba(14,17,23,0.88)';
  ctx.fillRect(x, y - 11, w + 10, 16);
  ctx.strokeStyle = COLORS.beamSelected;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y - 10.5, w + 9, 15);
  ctx.fillStyle = COLORS.beamSelected;
  ctx.fillText(text, x + 5, y);
}

export function drawStructure(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp } = st;
  const selN = new Set(st.selectedNodes);
  const selB = new Set(st.selectedBeams);

  ctx.lineCap = 'round';
  for (const bm of s.beams) {
    const a = nodeById(s, bm.nodeI);
    const b = nodeById(s, bm.nodeJ);
    if (!a || !b) continue;
    const pa = worldToScreen(cam, vp, a);
    const pb = worldToScreen(cam, vp, b);
    const selected = selB.has(bm.id);
    ctx.strokeStyle = selected
      ? COLORS.beamSelected
      : st.hoverBeam === bm.id
        ? COLORS.beamHover
        : COLORS.beam;
    ctx.lineWidth = beamLineWidth(s, bm, selected);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    if (selected) drawBeamLabel(ctx, st, bm, pb);
  }

  for (const n of s.nodes) {
    const p = worldToScreen(cam, vp, n);
    const selected = selN.has(n.id);
    const r = selected || st.hoverNode === n.id ? 6 : 4.5;
    if (selected || st.hoverNode === n.id) {
      ctx.fillStyle = 'rgba(255,209,102,0.25)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = selected ? COLORS.nodeSelected : COLORS.node;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A deformált alakzat. A valós elmozdulás milliméteres, ezért a megjelenítés
 * automatikusan nagyít: a legnagyobb elmozdulás ~120 px lesz a képernyőn.
 * Visszaadja a nagyítási tényezőt, hogy a felhasználó tudja, mit lát.
 */
/**
 * Az N, V és M diagramok a rúd tengelyére merőlegesen, a helyi y' irányába
 * rajzolódnak. A skálázás típusonként globális, hogy a legnagyobb érték
 * minden diagramspecifikációban kb. 70 px legyen. Az M a pozitív, a V a negatív
 * oldalra kerül, hogy ne fedjék egymást.
 */
export function drawDiagrams(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp, result } = st;
  if (!result || !result.ok) return;
  if (!st.showDiagN && !st.showDiagV && !st.showDiagM) return;
  const px = 70;
  const scaleOf = (max: number): number => (max > 0 ? px / (max * cam.zoom) : 0);
  const scales = { N: scaleOf(result.maxN), V: scaleOf(result.maxV), M: scaleOf(result.maxM) };
  const steps = 24;

  ctx.save();
  for (const bm of s.beams) {
    const a = nodeById(s, bm.nodeI);
    const b = nodeById(s, bm.nodeJ);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // a helyi y' tengely a rúd irányára merőleges
    const ny = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    for (const kind of ['M', 'V', 'N'] as const) {
      const on = kind === 'M' ? st.showDiagM : kind === 'V' ? st.showDiagV : st.showDiagN;
      const scale = scales[kind];
      if (!on || scale === 0) continue;
      // a V diagram az ellenkező oldalra rajzolódik
      const side = kind === 'V' ? -1 : 1;
      const base: Point[] = [];
      const curve: Point[] = [];
      for (let i = 0; i <= steps; i++) {
        const xi = i / steps;
        const w = { x: a.x + xi * (b.x - a.x), y: a.y + xi * (b.y - a.y) };
        const f = internalAt(s, result, bm.id, xi);
        const d = (kind === 'N' ? f.N : kind === 'V' ? f.V : f.M) * scale * side;
        base.push(w);
        curve.push({ x: w.x + ny.x * d, y: w.y + ny.y * d });
      }
      ctx.beginPath();
      base.forEach((p, i) => {
        const sp = worldToScreen(cam, vp, p);
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      for (let i = curve.length - 1; i >= 0; i--) {
        const sp = worldToScreen(cam, vp, curve[i]!);
        ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
      ctx.fillStyle = COLORS[`diag${kind}`];
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS[`diag${kind}`];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      curve.forEach((p, i) => {
        const sp = worldToScreen(cam, vp, p);
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawDeformed(ctx: CanvasRenderingContext2D, st: SceneState): number {
  const { structure: s, camera: cam, viewport: vp, result } = st;
  if (!result || !result.ok || result.maxAbsU <= 0) return 1;
  const scale = 120 / (result.maxAbsU * cam.zoom);

  // nagyított pont: eredeti + scale · (deformált − eredeti)
  const exag = (orig: Point, deformed: Point): Point => ({
    x: orig.x + (deformed.x - orig.x) * scale,
    y: orig.y + (deformed.y - orig.y) * scale,
  });

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.deformed;
  const steps = 12;
  for (const bm of s.beams) {
    const a = nodeById(s, bm.nodeI);
    if (!a) continue;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const xi = i / steps;
      const sp = worldToScreen(cam, vp, exag(a, deformedPointAt(s, result, bm.id, xi)));
      if (i === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = COLORS.deformed;
  for (const n of s.nodes) {
    const sp = worldToScreen(cam, vp, exag(n, deformedNode(s, result, n.id)));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return scale;
}

export function drawPreview(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp, tool } = st;
  if (st.preview === null) return;
  const p = worldToScreen(cam, vp, st.preview);
  ctx.save();
  ctx.save();
  if (tool === 'beam' && st.previewFrom >= 0) {
    const a = nodeById(s, st.previewFrom);
    if (a) {
      const pa = worldToScreen(cam, vp, a);
      ctx.strokeStyle = COLORS.preview;
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const len = Math.hypot(st.preview.x - a.x, st.preview.y - a.y);
      drawLabel(ctx, p.x + 12, p.y - 12, `${len.toFixed(2)} m`);
    }
  } else {
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = '12px ui-monospace, monospace';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(14,20,32,0.85)';
  ctx.fillRect(x - 4, y - 12, w + 8, 18);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(text, x, y + 1);
}

export function drawMarquee(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const m = st.marquee;
  if (!m) return;
  const x = Math.min(m.x0, m.x1);
  const y = Math.min(m.y0, m.y1);
  const w = Math.abs(m.x1 - m.x0);
  const h = Math.abs(m.y1 - m.y0);
  ctx.fillStyle = COLORS.marquee;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.marqueeLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}

export function drawScene(ctx: CanvasRenderingContext2D, st: SceneState): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, st.viewport.width, st.viewport.height);
  drawGrid(ctx, st);
  if (st.membrane2d) {
    drawMembrane2D(ctx, st, st.membrane2d, st.membraneResult, st.showDeform);
    drawMembranePreview(ctx, st);
    drawMarquee(ctx, st);
    return;
  }
  drawStructure(ctx, st);
  drawDiagrams(ctx, st);
  if (st.showDeform && st.result) drawDeformed(ctx, st);
  drawDistLoads(ctx, st);
  drawSupports(ctx, st);
  drawPointLoads(ctx, st);
  drawGhost(ctx, st);
  drawPreview(ctx, st);
  drawMarquee(ctx, st);
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Point, angle: number, size: number): void {
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + size * Math.cos(a1), tip.y + size * Math.sin(a1));
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + size * Math.cos(a2), tip.y + size * Math.sin(a2));
  ctx.stroke();
}

function arrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  width = 2.5,
  head = 9,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  arrowHead(ctx, to, Math.atan2(to.y - from.y, to.x - from.x), head);
}

function fmtKN(v: number): string {
  const kn = v / 1000;
  const text = Math.abs(kn) >= 10 ? kn.toFixed(0) : kn.toFixed(1);
  return `${text} kN`;
}

function fmtKNM(v: number): string {
  const knm = v / 1000;
  const text = Math.abs(knm) >= 10 ? knm.toFixed(0) : knm.toFixed(1);
  return `${text} kN·m`;
}

function drawSupports(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp } = st;
  const sel = new Set(st.selectedSupports);
  for (const sp of s.supports) {
    const n = nodeById(s, sp.node);
    if (!n) continue;
    const p = worldToScreen(cam, vp, n);
    const color = sel.has(sp.node) ? COLORS.supportSelected : COLORS.support;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.2;
    if (sp.type === 'pinned') {
      drawPinned(ctx, p);
    } else if (sp.type === 'roller') {
      drawRoller(ctx, p);
    } else {
      drawFixed(ctx, p);
    }
  }
}

export function drawGhost(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { camera: cam, viewport: vp, tool, preview } = st;
  if (preview === null) return;
  if (tool !== 'support' && tool !== 'force' && tool !== 'moment' && tool !== 'dist') return;
  const p = worldToScreen(cam, vp, preview);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = tool === 'support' ? COLORS.support : COLORS.load;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2.2;
  if (tool === 'support') {
    if (st.supportType === 'pinned') drawPinned(ctx, p);
    else if (st.supportType === 'roller') drawRoller(ctx, p);
    else drawFixed(ctx, p);
  } else if (tool === 'force') {
    const { fx, fy } = st.loadValue;
    const mag = Math.hypot(fx, fy);
    if (mag === 0) {
      ctx.restore();
      return;
    }
    const ux = fx / mag;
    const uy = -fy / mag;
    arrow(ctx, p, { x: p.x + ux * PX.loadArrow, y: p.y + uy * PX.loadArrow }, COLORS.load);
  } else if (tool === 'moment') {
    drawMoment(ctx, p, st.loadValue.mz, COLORS.load);
  }
  ctx.restore();
}

function hatch(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 6) {
    ctx.moveTo(x, y);
    ctx.lineTo(x - 7, y + 9);
  }
  ctx.stroke();
}

function drawPinned(ctx: CanvasRenderingContext2D, p: Point): void {
  const h = PX.support;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - h, p.y + h * 1.15);
  ctx.lineTo(p.x + h, p.y + h * 1.15);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - h * 1.5, p.y + h * 1.15);
  ctx.lineTo(p.x + h * 1.5, p.y + h * 1.15);
  ctx.stroke();
  hatch(ctx, p.x - h * 1.5, p.x + h * 1.5, p.y + h * 1.15);
}

function drawRoller(ctx: CanvasRenderingContext2D, p: Point): void {
  const h = PX.support;
  drawPinned(ctx, p);
  const baseY = p.y + h * 1.15;
  const r = 4.2;
  for (const dx of [-h * 0.6, h * 0.6]) {
    ctx.beginPath();
    ctx.arc(p.x + dx, baseY + 6, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(p.x - h * 1.7, baseY + 12);
  ctx.lineTo(p.x + h * 1.7, baseY + 12);
  ctx.stroke();
}

function drawFixed(ctx: CanvasRenderingContext2D, p: Point): void {
  const h = PX.support;
  ctx.beginPath();
  ctx.moveTo(p.x - h * 1.5, p.y - 2);
  ctx.lineTo(p.x + h * 1.5, p.y - 2);
  ctx.lineTo(p.x + h * 1.5, p.y + 6);
  ctx.lineTo(p.x - h * 1.5, p.y + 6);
  ctx.closePath();
  ctx.fill();
  hatch(ctx, p.x - h * 1.5, p.x + h * 1.5, p.y + 6);
}

function drawPointLoads(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp } = st;
  const sel = new Set(st.selectedLoads);
  for (const ld of s.loads) {
    const n = nodeById(s, ld.node);
    if (!n) continue;
    const p = worldToScreen(cam, vp, n);
    const color = loadColor(sel.has(ld.id), ld.group);
    if (ld.fx !== 0 || ld.fy !== 0) {
      const mag = Math.hypot(ld.fx, ld.fy);
      const ux = ld.fx / mag;
      const uy = -ld.fy / mag;
      arrow(ctx, p, { x: p.x + ux * PX.loadArrow, y: p.y + uy * PX.loadArrow }, color);
      drawLabel(
        ctx,
        p.x + ux * (PX.loadArrow + 8),
        p.y + uy * (PX.loadArrow + 8),
        fmtKN(mag),
      );
    }
    if (ld.mz !== 0) {
      drawMoment(ctx, p, ld.mz, color);
    }
  }
}

function drawMoment(ctx: CanvasRenderingContext2D, p: Point, mz: number, color: string): void {
  const r = PX.momentRadius;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  const start = mz > 0 ? -Math.PI * 0.35 : Math.PI * 1.35;
  ctx.arc(p.x, p.y, r, start, start + Math.PI * 1.7, mz < 0);
  ctx.stroke();
  const end = start + Math.PI * 1.7;
  const tangent = mz > 0 ? end + Math.PI / 2 : end - Math.PI / 2;
  arrowHead(ctx, { x: p.x + r * Math.cos(end), y: p.y + r * Math.sin(end) }, tangent, 8);
  drawLabel(ctx, p.x + r + 8, p.y - 4, fmtKNM(mz));
}

function drawDistLoads(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp } = st;
  const sel = new Set(st.selectedDist);
  for (const dl of s.distLoads) {
    const bm = s.beams.find((b) => b.id === dl.beam);
    if (!bm) continue;
    const a = nodeById(s, bm.nodeI);
    const b = nodeById(s, bm.nodeJ);
    if (!a || !b) continue;
    const pa = worldToScreen(cam, vp, a);
    const pb = worldToScreen(cam, vp, b);
    const color = loadColor(sel.has(dl.id), dl.group);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len < 12) continue;
    const dirX = (pb.x - pa.x) / len;
    const dirY = (pb.y - pa.y) / len;
    const nrmX = -dirY;
    const nrmY = dirX;
    const sign = dl.qy >= 0 ? 1 : -1;
    const off = PX.distArrow * sign;
    const count = Math.max(2, Math.min(16, Math.floor(len / 26)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pa.x + nrmX * off, pa.y + nrmY * off);
    ctx.lineTo(pb.x + nrmX * off, pb.y + nrmY * off);
    ctx.stroke();
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const tail = {
        x: pa.x + (pb.x - pa.x) * t + nrmX * off,
        y: pa.y + (pb.y - pa.y) * t + nrmY * off,
      };
      arrow(ctx, tail, { x: tail.x - nrmX * 10 * sign, y: tail.y - nrmY * 10 * sign }, color, 1.8, 6);
    }
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    drawLabel(ctx, mid.x + 10, mid.y + nrmY * off * 0.5, `q = ${fmtKN(dl.qy)}/m`);
  }
}

/**
 * A 2D membránmodell rajzolása. A háló vonalazása, a rögzítések, a terhek és
 * — ha van eredmény — a von Mises feszültségszínkép és a deformált alak.
 */
export function drawMembrane2D(
  ctx: CanvasRenderingContext2D,
  st: SceneState,
  m: Membrane2D,
  res: MembraneResult | null,
  showDeform: boolean,
): void {
  const { camera: cam, viewport: vp } = st;
  if (m.nodes.length === 0) return;
  const sel = new Set(st.selectedNodes);
  const toS = (i: number): Point => worldToScreen(cam, vp, m.nodes[i]!);

  // 1. feszültségszínkép (a szín a max von Mises-hoz igazodik)
  if (res?.ok && res.maxVonMises > 0) {
    for (const el of res.elements) {
      const nodes = m.elements[el.element];
      if (!nodes) continue;
      const ratio = Math.min(1, el.vonMisesMax / res.maxVonMises);
      ctx.fillStyle = stressColor(ratio);
      ctx.beginPath();
      nodes.forEach((n, k) => {
        const p = toS(n);
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  // 2. háló
  ctx.strokeStyle = 'rgba(160,190,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const el of m.elements) {
    for (let k = 0; k < 4; k++) {
      const a = toS(el[k]!);
      const b = toS(el[(k + 1) % 4]!);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();

  // 3. kontúr: a szabad perem vastagabban
  const used = new Set<string>();
  ctx.strokeStyle = COLORS.beam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const el of m.elements) {
    for (let k = 0; k < 4; k++) {
      const from = el[k]!;
      const to = el[(k + 1) % 4]!;
      const key = from < to ? `${from}-${to}` : `${to}-${from}`;
      if (used.has(key)) continue;
      used.add(key);
      const a = toS(from);
      const b = toS(to);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();

  // 4. deformált alak
  if (showDeform && res?.ok && res.maxU > 0) {
    const scale = autoScale(res.maxU, 120);
    ctx.strokeStyle = COLORS.deformed;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const el of m.elements) {
      for (let k = 0; k < 4; k++) {
        const a = deformScreen(el[k]!);
        const b = deformScreen(el[(k + 1) % 4]!);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    function deformScreen(i: number): Point | null {
      const p = toS(i);
      const ux = res!.u[2 * i];
      const uy = res!.u[2 * i + 1];
      if (ux === undefined || uy === undefined) return null;
      return { x: p.x + ux * cam.zoom * scale, y: p.y - uy * cam.zoom * scale };
    }
  }

  // 5. rögzítések
  for (const f of m.fixed) {
    const p = toS(f.node);
    if (f.mask === 3) drawFixed(ctx, p);
    else if (f.mask === 1) drawPinnedX(ctx, p);
    else if (f.mask === 2) drawPinnedY(ctx, p);
  }

  // 6. pontterhek
  for (const ld of m.loads) {
    const p = toS(ld.node);
    const len = Math.hypot(ld.fx, ld.fy);
    if (len < 1e-9) continue;
    const ux = ld.fx / len;
    const uy = ld.fy / len;
    arrow(ctx, p, { x: p.x + ux * PX.loadArrow, y: p.y - uy * PX.loadArrow }, COLORS.load, 2, 7);
  }

  // 7. élterhek: a t pozitív előjele kifelé húz
  for (const e of m.edgeLoads) {
    const a = m.nodes[e.from];
    const b = m.nodes[e.to];
    if (!a || !b) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    const nx = (b.y - a.y) / len;
    const ny = -(b.x - a.x) / len;
    const pa = toS(e.from);
    const pb = toS(e.to);
    const sign = e.t >= 0 ? 1 : -1;
    const ux = (pb.x - pa.x) / Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const uy = (pb.y - pa.y) / Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const off = 26 * sign;
    const count = 3;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const mid = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
      const nxS = nx * cam.zoom;
      const nyS = -ny * cam.zoom;
      const nlen = Math.hypot(nxS, nyS) || 1;
      const tail = { x: mid.x + (nxS / nlen) * off, y: mid.y + (nyS / nlen) * off };
      arrow(ctx, tail, { x: tail.x - (ux * nxS) / nlen, y: tail.y - (uy * nyS) / nlen }, COLORS.load, 1.8, 6);
    }
  }

  // 8. csomópontok — csak közelről, hogy a háló ne legyen tömör
  if (cam.zoom > 26) {
    for (let i = 0; i < m.nodes.length; i++) {
      const p = toS(i);
      ctx.fillStyle = sel.has(i) ? COLORS.nodeSelected : 'rgba(230,237,247,0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, sel.has(i) ? 3.4 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** a 2D mód háló-előnézete: a kattintás előtti téglalap */
function drawMembranePreview(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const m = st.membrane2d;
  if (st.tool !== 'mesh' || !m || !st.previewFromPoint || !st.preview) return;
  const { camera: cam, viewport: vp } = st;
  const a = worldToScreen(cam, vp, st.previewFromPoint);
  const b = worldToScreen(cam, vp, st.preview);
  const { x0, y0, x1, y1 } = {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = COLORS.preview;
  ctx.fillStyle = 'rgba(154,213,160,0.10)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  const div = Math.max(1, m.divisions);
  ctx.beginPath();
  for (let i = 1; i < div; i++) {
    const x = x0 + ((x1 - x0) * i) / div;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let j = 1; j < div; j++) {
    const y = y0 + ((y1 - y0) * j) / div;
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** feszültségszínkép: zöld ( nulla ) → sárga → piros ( maximum ) */
function stressColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  if (r < 0.5) {
    const k = r / 0.5;
    return `rgb(${Math.round(40 + 215 * k)}, ${Math.round(190 - 30 * k)}, ${Math.round(110 - 70 * k)})`;
  }
  const k = (r - 0.5) / 0.5;
  return `rgb(255, ${Math.round(160 - 130 * k)}, ${Math.round(40 + 20 * k)})`;
}

/** a legnagyobb elmozdulást adott pixelszámra nagyító tényező */
function autoScale(maxU: number, targetPx: number): number {
  if (!(maxU > 0)) return 1;
  return targetPx / maxU;
}

/** csak ux irányban rögzített csomópont: függőleges vonal a csomópontban */
function drawPinnedX(ctx: CanvasRenderingContext2D, p: Point): void {
  const h = PX.support;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - h * 0.9);
  ctx.lineTo(p.x, p.y + h * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - h, p.y);
  ctx.lineTo(p.x + h, p.y);
  ctx.stroke();
  for (const dx of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(p.x + dx, p.y);
    ctx.lineTo(p.x + dx * 0.55, p.y - h * 0.4);
    ctx.moveTo(p.x + dx, p.y);
    ctx.lineTo(p.x + dx * 0.55, p.y + h * 0.4);
    ctx.stroke();
  }
}

/** csak uy irányban rögzített csomópont: vízszintes vonal */
function drawPinnedY(ctx: CanvasRenderingContext2D, p: Point): void {
  const h = PX.support;
  ctx.beginPath();
  ctx.moveTo(p.x - h * 0.9, p.y);
  ctx.lineTo(p.x + h * 0.9, p.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - h);
  ctx.lineTo(p.x, p.y + h);
  ctx.stroke();
  for (const dy of [-h, h]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + dy);
    ctx.lineTo(p.x - h * 0.4, p.y + dy * 0.55);
    ctx.moveTo(p.x, p.y + dy);
    ctx.lineTo(p.x + h * 0.4, p.y + dy * 0.55);
    ctx.stroke();
  }
}
