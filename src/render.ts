import { nodeById } from './geometry';
import type { Structure } from './geometry';
import { screenToWorld, worldToScreen } from './camera';
import type { Camera, Viewport } from './camera';
import type { Point } from './geometry';

export type Tool = 'select' | 'node' | 'beam';

export interface SceneState {
  structure: Structure;
  camera: Camera;
  viewport: Viewport;
  tool: Tool;
  selectedNodes: number[];
  selectedBeams: number[];
  hoverNode: number;
  hoverBeam: number;
  preview: Point | null;
  previewFrom: number;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  gridStep: number;
  snap: boolean;
}

export const COLORS = {
  bg: '#0e1420',
  gridMinor: 'rgba(120,140,180,0.10)',
  gridMajor: 'rgba(120,140,180,0.22)',
  axis: 'rgba(160,190,255,0.45)',
  beam: '#7fb2ff',
  beamSelected: '#ffd166',
  beamHover: '#a8c8ff',
  node: '#e6edf7',
  nodeSelected: '#ffd166',
  nodeHover: '#ffffff',
  preview: '#9ad5a0',
  marquee: 'rgba(255,209,102,0.18)',
  marqueeLine: 'rgba(255,209,102,0.7)',
  text: '#9fb0cc',
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
    ctx.lineWidth = selected ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
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

export function drawPreview(ctx: CanvasRenderingContext2D, st: SceneState): void {
  const { structure: s, camera: cam, viewport: vp, tool } = st;
  if (st.preview === null) return;
  const p = worldToScreen(cam, vp, st.preview);
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
  drawPreview(ctx, st);
  drawMarquee(ctx, st);
}
