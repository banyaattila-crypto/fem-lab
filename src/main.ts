import './style.css';
import { screenToWorld } from './camera';
import { Editor } from './editor';
import { drawScene } from './render';
import type { Tool } from './render';

const el = <T extends HTMLElement>(sel: string): T => {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`elem hiányzik: ${sel}`);
  return node;
};

const canvas = el<HTMLCanvasElement>('#board');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D context nem elérhető');
const context: CanvasRenderingContext2D = ctx;

const editor = new Editor({ gridStep: 0.25 });

const statNodes = el<HTMLElement>('#stat-nodes');
const statBeams = el<HTMLElement>('#stat-beams');
const statLength = el<HTMLElement>('#stat-length');
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const btnUndo = el<HTMLButtonElement>('#btn-undo');
const btnRedo = el<HTMLButtonElement>('#btn-redo');
const btnFit = el<HTMLButtonElement>('#btn-fit');
const btnClear = el<HTMLButtonElement>('#btn-clear');
const btnDelete = el<HTMLButtonElement>('#btn-delete');
const btnExport = el<HTMLButtonElement>('#btn-export');
const btnImport = el<HTMLButtonElement>('#btn-import');
const fileInput = el<HTMLInputElement>('#file-input');
const gridInput = el<HTMLInputElement>('#grid-step');
const snapInput = el<HTMLInputElement>('#snap-toggle');
const coordLabel = el<HTMLElement>('#coord');
const message = el<HTMLElement>('#message');

function resize(): void {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  editor.viewport = { width: rect.width, height: rect.height };
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function pointOf(e: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function draw(): void {
  drawScene(context, editor.scene());
}

function refresh(): void {
  statNodes.textContent = String(editor.structure.nodes.length);
  statBeams.textContent = String(editor.structure.beams.length);
  statLength.textContent = `${editor.totalLength().toFixed(2)} m`;
  btnUndo.disabled = !editor.undoAvailable();
  btnRedo.disabled = !editor.redoAvailable();
  const hasSel = editor.selectedNodes.length > 0 || editor.selectedBeams.length > 0;
  btnDelete.disabled = !hasSel;
}

function setMessage(text: string): void {
  message.textContent = text;
}

editor.onChange(() => {
  draw();
  refresh();
});

function setTool(tool: Tool): void {
  editor.setTool(tool);
  editor.finishChain();
  for (const b of toolButtons) {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }
  setMessage(
    tool === 'beam'
      ? 'Rúd: kattints a kezdőpontra, majd a végpontokra — lánc folytatódik, Esc vagy dupla kattintás zárja.'
      : tool === 'node'
        ? 'Csomópont: kattints oda, ahová a csomópont kerül.'
        : 'Kijelölés: kattints a rúdra/csomópontra, Shift a lásd, üresen húzva téglalapos kijelölés.',
  );
  draw();
}

for (const btn of toolButtons) {
  btn.addEventListener('click', () => setTool(btn.dataset.tool as Tool));
}

let dragging = false;
let panning = false;
let last = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2 || e.altKey) {
    panning = true;
    last = pointOf(e);
    return;
  }
  dragging = true;
  editor.pointerDown(screenToWorld(editor.camera, editor.viewport, pointOf(e)));
});

canvas.addEventListener('pointermove', (e) => {
  const sp = pointOf(e);
  const w = screenToWorld(editor.camera, editor.viewport, sp);
  coordLabel.textContent = `x = ${w.x.toFixed(2)} m   y = ${w.y.toFixed(2)} m`;
  if (panning) {
    editor.pan(sp.x - last.x, sp.y - last.y);
    last = sp;
    return;
  }
  editor.pointerMove(w);
});

canvas.addEventListener('pointerup', (e) => {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (panning) {
    panning = false;
    return;
  }
  if (!dragging) return;
  dragging = false;
  editor.pointerUp(e.shiftKey);
});

canvas.addEventListener('dblclick', () => {
  editor.finishChain();
  setMessage('Lánc lezárva.');
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    editor.wheel(pointOf(e), e.deltaY);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.doRedo();
    else editor.doUndo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    editor.doRedo();
    return;
  }
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      editor.deleteSelection();
      break;
    case 'Escape':
      editor.finishChain();
      break;
    case 'v':
      setTool('select');
      break;
    case 'b':
      setTool('beam');
      break;
    case 'n':
      setTool('node');
      break;
    case 'f':
      editor.fit();
      break;
    default:
      break;
  }
});

btnUndo.addEventListener('click', () => editor.doUndo());
btnRedo.addEventListener('click', () => editor.doRedo());
btnFit.addEventListener('click', () => editor.fit());
btnClear.addEventListener('click', () => {
  editor.clearAll();
  setMessage('Rajz törölve (undo: Ctrl+Z).');
});
btnDelete.addEventListener('click', () => editor.deleteSelection());

btnExport.addEventListener('click', () => {
  const blob = new Blob([editor.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fem-lab-structure.json';
  a.click();
  URL.revokeObjectURL(url);
  setMessage('Modell letöltve: fem-lab-structure.json');
});

btnImport.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const ok = editor.importJSON(text);
  setMessage(ok ? `Betöltve: ${file.name}` : 'A fájl nem érvényes modell.');
  fileInput.value = '';
});

gridInput.addEventListener('input', () => {
  editor.setGridStep(Number(gridInput.value) || 0.25);
});
snapInput.addEventListener('change', () => editor.setSnap(snapInput.checked));

window.addEventListener('resize', resize);
resize();
setTool('beam');
