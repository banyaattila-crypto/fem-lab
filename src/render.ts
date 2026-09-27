import { beamSection, nodeById } from './geometry';
import type { Beam, Structure, SupportType } from './geometry';
import { materialById, sectionById } from './catalog';
import { screenToWorld, worldToScreen } from './camera';
import type { Camera, Viewport } from './camera';
import type { SolveResult } from './solver';
import { deformedNode, deformedPointAt, internalAt } from './solver';
import type { Point } from './geometry';

export type Tool = 'select' | 'node' | 'beam' | 'support' | 'force' | 'moment' | 'dist';

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
    const color = sel.has(ld.id) ? COLORS.loadSelected : COLORS.load;
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
    const color = sel.has(dl.id) ? COLORS.loadSelected : COLORS.load;
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
