import './style.css';
import { screenToWorld } from './camera';
import { Editor } from './editor';
import { drawScene } from './render';
import { SLS, solve, ULS } from './solver';
import type { Tool } from './render';
import type { SupportType } from './geometry';

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
const statSupports = el<HTMLElement>('#stat-supports');
const statLoads = el<HTMLElement>('#stat-loads');
const statLength = el<HTMLElement>('#stat-length');
const statMass = el<HTMLElement>('#stat-mass');
const statWeight = el<HTMLElement>('#stat-weight');
const materialSelect = el<HTMLSelectElement>('#material-select');
const sectionSelect = el<HTMLSelectElement>('#section-select');
const selfWeightBox = el<HTMLInputElement>('#self-weight');
const sectionHint = el<HTMLElement>('#section-hint');
const btnSolve = el<HTMLButtonElement>('#btn-solve');
const btnDeform = el<HTMLButtonElement>('#btn-deform');
const resultsBox = el<HTMLElement>('#results');
const resN = el<HTMLElement>('#res-n');
const resM = el<HTMLElement>('#res-m');
const resV = el<HTMLElement>('#res-v');
const resSigma = el<HTMLElement>('#res-sigma');
const resU = el<HTMLElement>('#res-u');
const resTheta = el<HTMLElement>('#res-theta');
const resDof = el<HTMLElement>('#res-dof');
const resBalance = el<HTMLElement>('#res-balance');
const reactionBody = el<HTMLTableSectionElement>('#reaction-body');
const elementBody = el<HTMLTableSectionElement>('#element-body');
const resUtil = el<HTMLElement>('#res-util');
const resBuckling = el<HTMLElement>('#res-buckling');
const loadGroupSelect = el<HTMLSelectElement>('#load-group');
const comboSelect = el<HTMLSelectElement>('#combo-select');
const diagButtons = {
  n: el<HTMLButtonElement>('#btn-diag-n'),
  v: el<HTMLButtonElement>('#btn-diag-v'),
  m: el<HTMLButtonElement>('#btn-diag-m'),
};
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const supportButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-support]'));
const loadFx = el<HTMLInputElement>('#load-fx');
const loadFy = el<HTMLInputElement>('#load-fy');
const loadMz = el<HTMLInputElement>('#load-mz');
const loadQy = el<HTMLInputElement>('#load-qy');
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
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const fixButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-fix]'));
const panels1D = Array.from(document.querySelectorAll<HTMLElement>('[data-1d-only]'));
const panels2D = Array.from(document.querySelectorAll<HTMLElement>('[data-2d-only]'));
const m2Thickness = el<HTMLInputElement>('#m2-thickness');
const m2Divisions = el<HTMLInputElement>('#m2-divisions');
const m2Edge = el<HTMLInputElement>('#m2-edge');
const m2Fx = el<HTMLInputElement>('#m2-fx');
const m2Fy = el<HTMLInputElement>('#m2-fy');
const m2Results = el<HTMLElement>('#m2-results');
const m2ResU = el<HTMLElement>('#m2-res-u');
const m2ResVm = el<HTMLElement>('#m2-res-vm');
const m2ResSxx = el<HTMLElement>('#m2-res-sxx');
const m2ResSxy = el<HTMLElement>('#m2-res-sxy');
const m2ResDof = el<HTMLElement>('#m2-res-dof');
const m2ResBalance = el<HTMLElement>('#m2-res-balance');
const m2ElementBody = el<HTMLTableSectionElement>('#m2-element-body');
const m2ReactionBody = el<HTMLTableSectionElement>('#m2-reaction-body');

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
  const is2D = editor.mode === '2d';
  statNodes.textContent = is2D
    ? String(editor.structure.membrane2d?.nodes.length ?? 0)
    : String(editor.structure.nodes.length);
  statBeams.textContent = is2D
    ? String(editor.structure.membrane2d?.elements.length ?? 0)
    : String(editor.structure.beams.length);
  statSupports.textContent = is2D
    ? String(editor.structure.membrane2d?.fixed.length ?? 0)
    : String(editor.structure.supports.length);
  statLoads.textContent = is2D
    ? String((editor.structure.membrane2d?.loads.length ?? 0) + (editor.structure.membrane2d?.edgeLoads.length ?? 0))
    : String(editor.structure.loads.length + editor.structure.distLoads.length);
  statLength.textContent = `${editor.totalLength().toFixed(2)} m`;
  const { mass, weight } = editor.totalMassAndWeight();
  statMass.textContent = mass >= 1000 ? `${(mass / 1000).toFixed(2)} t` : `${mass.toFixed(0)} kg`;
  statWeight.textContent = `${weight.toFixed(2)} kN`;
  btnUndo.disabled = !editor.undoAvailable();
  btnRedo.disabled = !editor.redoAvailable();
  btnDeform.disabled = editor.result === null;
  for (const b of Object.values(diagButtons)) b.disabled = editor.result === null;
  if (editor.result === null) {
    resultsBox.hidden = true;
    btnDeform.classList.remove('active');
    btnDeform.setAttribute('aria-pressed', 'false');
    editor.showDeform = false;
    for (const [kind, b] of Object.entries(diagButtons)) {
      const key = kind === 'n' ? 'showDiagN' : kind === 'v' ? 'showDiagV' : 'showDiagM';
      editor[key] = false;
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    }
  }
  const hasSel = is2D
    ? editor.selectedNodes.length > 0
    : editor.selectedNodes.length > 0 ||
      editor.selectedBeams.length > 0 ||
      editor.selectedSupports.length > 0 ||
      editor.selectedLoads.length > 0 ||
      editor.selectedDist.length > 0;
  btnDelete.disabled = !hasSel;
}

function setMessage(text: string): void {
  message.textContent = text;
}

editor.onChange(() => {
  draw();
  refresh();
});

const TOOL_HINTS: Record<Tool, string> = {
  beam: 'Rúd: kattints a kezdőpontra, majd a végpontokra — lánc folytatódik, Esc vagy dupla kattintás zárja.',
  node: 'Csomópont: kattints oda, ahová a csomópont kerül.',
  select: 'Kijelölés: kattints a rúdra/csomópontra, Shift a lásd, üresen húzva téglalapos kijelölés.',
  support: 'Támasz: kattints a csomópontra. A típust a Támaszok panelen váltod.',
  force: 'Konc. erő: kattints a csomópontra. Az értéket a Terhek panelen írd be.',
  moment: 'Nyomaték: kattints a csomópontra. Az értéket a Terhek panelen írd be.',
  dist: 'Megoszló teher: kattints a rúdra. Az értéket a Terhek panelen írd be.',
  mesh: 'Négyzögháló: húzd a két sarokpont között a téglalapot; a felbontás a Lemez panelen állítható.',
  fix: 'Peremrögzítés: kattints a csomópontra. Az irányt a gombok választják; újra kattintva töröl.',
  edgeLoad: 'Élteher: kattints a perem élre. A t értéke a Terhek panelen állítható.',
  nodeLoad: 'Pontteher: kattints a csomópontra. Az értéket a Terhek panelen írd be.',
};

function setTool(tool: Tool): void {
  editor.setTool(tool);
  editor.finishChain();
  for (const b of toolButtons) {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }
  setMessage(TOOL_HINTS[tool]);
  draw();
}

function setSupportType(type: SupportType): void {
  editor.setSupportType(type);
  for (const b of supportButtons) b.classList.toggle('active', b.dataset.support === type);
  draw();
}

for (const btn of supportButtons) {
  btn.addEventListener('click', () => setSupportType(btn.dataset.support as SupportType));
}

function setMode(mode: '1d' | '2d'): void {
  editor.setMode(mode);
  for (const b of modeButtons) {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
  for (const p of panels1D) p.hidden = mode === '2d';
  for (const p of panels2D) p.hidden = mode === '1d';
  for (const b of toolButtons) b.classList.toggle('active', false);
  if (mode === '1d') {
    setTool('beam');
    btnFit.onclick = () => { editor.fit(); };
  } else {
    setTool('mesh');
    btnFit.onclick = () => { editor.fitMembrane(); };
    m2Thickness.value = String(editor.membrane2d.thickness * 1000);
    m2Divisions.value = String(editor.membrane2d.divisions);
    push2DInputs();
  }
  setMessage(mode === '1d' ? '1D váz mód — rúdháló szerkesztése.' : '2D membrán mód — négyzögháló szerkesztése.');
  draw();
}

function push2DInputs(): void {
  editor.membraneEdgeValue = (Number(m2Edge.value) || 0) * 1000;
  editor.membraneNodeValue = {
    fx: (Number(m2Fx.value) || 0) * 1000,
    fy: (Number(m2Fy.value) || 0) * 1000,
  };
}

function pushLoadValues(): void {
  editor.setLoadValue({
    fx: (Number(loadFx.value) || 0) * 1000,
    fy: (Number(loadFy.value) || 0) * 1000,
    mz: (Number(loadMz.value) || 0) * 1000,
    qy: (Number(loadQy.value) || 0) * 1000,
  });
}

loadGroupSelect.addEventListener('change', () => {
  editor.setLoadGroup(loadGroupSelect.value === 'live' ? 'live' : 'dead');
});

for (const input of [loadFx, loadFy, loadMz, loadQy]) {
  input.addEventListener('input', () => {
    pushLoadValues();
    draw();
  });
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
    case 't':
      setTool('support');
      break;
    case 'e':
      setTool(editor.mode === '2d' ? 'nodeLoad' : 'force');
      break;
    case 'm':
      if (editor.mode === '1d') setTool('moment');
      break;
    case 'q':
      setTool(editor.mode === '2d' ? 'edgeLoad' : 'dist');
      break;
    case 'h':
      if (editor.mode === '2d') setTool('mesh');
      break;
    case 'f':
      if (editor.mode === '1d') { setTool('support'); } else { setTool('fix'); }
      break;
    case 'F':
      editor.mode === '1d' ? editor.fit() : editor.fitMembrane();
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
pushLoadValues();

function fillCatalogSelects(): void {
  const c = editor.structure.catalog;
  materialSelect.innerHTML = '';
  for (const m of c.materials) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    materialSelect.append(opt);
  }
  sectionSelect.innerHTML = '';
  for (const sec of c.sections) {
    const opt = document.createElement('option');
    opt.value = sec.id;
    opt.textContent = sec.name;
    sectionSelect.append(opt);
  }
  materialSelect.value = editor.materialId;
  sectionSelect.value = editor.sectionId;
}

function pushSection(): void {
  const applied = editor.setSection(materialSelect.value, sectionSelect.value);
  if (applied > 0) {
    setMessage(`Szelvény beállítva ${applied} rudon.`);
  } else {
    setMessage('Szelvény beállítva — ez lesz az új rudak alapértéke.');
  }
  draw();
}

materialSelect.addEventListener('change', pushSection);
sectionSelect.addEventListener('change', pushSection);
selfWeightBox.addEventListener('change', () => {
  editor.setSelfWeight(selfWeightBox.checked);
  setMessage(
    selfWeightBox.checked
      ? 'Önsúly beleszámít a teherbe.'
      : 'Önsúly kikapcsolva.',
  );
  draw();
});

function syncSectionPanel(): void {
  materialSelect.value = editor.materialId;
  sectionSelect.value = editor.sectionId;
  selfWeightBox.checked = editor.structure.selfWeight;
  const n = editor.selectedBeams.length;
  sectionHint.textContent =
    n > 0
      ? `Kijelölt rúd: ${n} db — a választás rájuk is rákerül.`
      : 'Nincs kijelölt rúd — a választás az új rudak alapértéke lesz.';
}

const kN = (v: number): string => (v / 1000).toFixed(2);
const kNm = (v: number): string => (v / 1000).toFixed(2);
const MPa = (v: number): string => (v / 1e6).toFixed(1);
const mm = (v: number): string => (v * 1000).toFixed(2);
const mrad = (v: number): string => (v * 1000).toFixed(3);

const SUPPORT_LABEL: Record<SupportType, string> = {
  pinned: 'csukló',
  roller: 'görgő',
  fixed: 'befogás',
};

function runSolve2D(): void {
  const r = editor.solveMembraneModel();
  if (!r || !r.ok) {
    m2Results.hidden = true;
    setMessage(r?.error ?? 'Nincs háló a számításhoz.');
    draw();
    return;
  }
  const toMPa = (v: number) => (v / 1e6).toFixed(1);
  const toMM = (v: number) => (v * 1000).toFixed(3);
  m2ResU.textContent = `${toMM(r.maxU)} mm`;
  m2ResVm.textContent = `${toMPa(r.maxVonMises)} MPa`;
  m2ResSxx.textContent = `${toMPa(r.maxSxx)} MPa`;
  m2ResSxy.textContent = `${toMPa(r.maxSxy)} MPa`;
  m2ResDof.textContent = `${r.dof.fixed} / ${r.dof.total}`;
  const rel = r.forceBalance.error / Math.max(1, Math.abs(r.forceBalance.appliedFx));
  m2ResBalance.textContent = rel < 1e-6 ? 'zárt' : `eltérés ${rel.toExponential(1)}`;
  m2ElementBody.innerHTML = '';
  for (const e of r.elements) {
    const tr = document.createElement('tr');
    if (e.element === r.criticalElement) tr.classList.add('governing');
    for (const text of [
      `#${e.element + 1}`,
      toMPa(e.sxx),
      toMPa(e.syy),
      toMPa(Math.abs(e.sxy)),
      toMPa(e.vonMises),
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    m2ElementBody.append(tr);
  }
  m2ReactionBody.innerHTML = '';
  for (const rx of r.reactions) {
    const tr = document.createElement('tr');
    const mask = editor.structure.membrane2d?.fixed.find((f) => f.node === rx.node);
    const label = mask?.mask === 3 ? 'ux+uy' : mask?.mask === 1 ? 'ux' : 'uy';
    for (const text of [`#${rx.node + 1}`, label, toMPa(rx.fx), toMPa(rx.fy)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    m2ReactionBody.append(tr);
  }
  m2Results.hidden = false;
  if (r.utilization > 1) {
    setMessage(
      `Feszültség túl magas (${toMPa(r.maxVonMises)} MPa > ${toMPa(r.yield)} MPa) — ` +
        `a folyáshatár átlépve a ${r.criticalElement + 1}. elemen.`,
    );
  } else {
    setMessage(`Számsítás kész: max σ = ${toMPa(r.maxSxx)} MPa, max von Mises = ${toMPa(r.maxVonMises)} MPa.`);
  }
  draw();
}

function runSolve(): void {
  if (editor.mode === '2d') { runSolve2D(); return; }
  const combo = comboSelect.value === 'uls' ? ULS : SLS;
  const r = solve(editor.structure, combo);
  editor.result = r;
  if (!r.ok) {
    resultsBox.hidden = true;
    btnDeform.disabled = true;
    for (const b of Object.values(diagButtons)) b.disabled = true;
    setMessage(r.error ?? 'A számítás nem sikerült.');
    draw();
    return;
  }
  resN.textContent = `${kN(r.maxN)} kN`;
  resM.textContent = `${kNm(r.maxM)} kN·m`;
  resV.textContent = `${kN(r.maxV)} kN`;
  resSigma.textContent = `${MPa(r.maxSigma)} MPa`;
  resU.textContent = `${mm(r.maxAbsU)} mm`;
  resTheta.textContent = `${mrad(r.maxAbsTheta)} mrad`;
  resDof.textContent = `${r.dof.fixed} / ${r.dof.total}`;
  const scale = Math.max(1, Math.abs(r.momentBalance.applied));
  const rel = r.momentBalance.error / scale;
  resBalance.textContent = rel < 1e-6 ? 'zárt' : `eltérés ${rel.toExponential(1)}`;
  const utilPct = r.maxUtilization * 100;
  resUtil.textContent = `${utilPct.toFixed(1)} % (rúd #${r.utilizationBeam + 1})`;
  resUtil.classList.toggle('over', r.maxUtilization > 1);
  resBuckling.textContent =
    r.bucklingBeam < 0 ? 'nincs nyomott rúd' : `${r.maxBuckling.toFixed(2)} (rúd #${r.bucklingBeam + 1})`;
  resBuckling.classList.toggle('over', r.maxBuckling > 1);

  elementBody.innerHTML = '';
  for (const e of r.elements) {
    const tr = document.createElement('tr');
    if (e.beam === r.utilizationBeam) tr.classList.add('governing');
    for (const text of [
      `#${e.beam + 1}`,
      `${e.length.toFixed(2)} m`,
      kN(e.extremes.N),
      kN(e.extremes.V),
      kNm(e.extremes.M),
      MPa(e.extremes.sigma),
      `${(e.extremes.def * 1000).toFixed(2)} mm`,
      `${(e.utilization * 100).toFixed(1)} %`,
      e.buckling ? `${e.buckling.ratio.toFixed(2)}` : '—',
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    elementBody.append(tr);
  }

  reactionBody.innerHTML = '';
  for (const rx of r.reactions) {
    const tr = document.createElement('tr');
    for (const text of [
      `#${rx.node + 1}`,
      SUPPORT_LABEL[rx.type],
      kN(rx.fx),
      kN(rx.fy),
      kNm(rx.mz),
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    reactionBody.append(tr);
  }
  resultsBox.hidden = false;
  btnDeform.disabled = false;
  for (const b of Object.values(diagButtons)) b.disabled = false;
  if (r.maxBuckling > 1) {
    setMessage(
      `Kihajlás veszélyes: |N|/N_cr = ${r.maxBuckling.toFixed(2)} (rúd #${r.bucklingBeam + 1}) — ` +
        `a rúd a kihajlási kritikus terhelés fölött van.`,
    );
  } else if (r.maxUtilization > 1) {
    setMessage(
      `Kihasználtság ${(r.maxUtilization * 100).toFixed(1)} %: a folyáshatár TÚLLEPED — ` +
        `rúd #${r.utilizationBeam + 1} nem bírja el a terhet.`,
    );
  } else if (r.maxUtilization > 0.8) {
    setMessage(
      `Számsítás kész, de a kihasználtság ${(r.maxUtilization * 100).toFixed(1)} % — ` +
        `már nem nagyon van tartalék.`,
    );
  } else {
      setMessage(
      `Számsítás kész (${r.combo.name}). Az „Alakzat” és a diagram gombok mutatják az eredményt.`,
    );
  }
  draw();
}

btnSolve.addEventListener('click', runSolve);

for (const kind of ['n', 'v', 'm'] as const) {
  diagButtons[kind].addEventListener('click', () => {
    if (!editor.result) return;
    const key = kind === 'n' ? 'showDiagN' : kind === 'v' ? 'showDiagV' : 'showDiagM';
    editor[key] = !editor[key];
    diagButtons[kind].classList.toggle('active', editor[key]);
    diagButtons[kind].setAttribute('aria-pressed', String(editor[key]));
    const on = (['n', 'v', 'm'] as const).filter((k) => editor[k === 'n' ? 'showDiagN' : k === 'v' ? 'showDiagV' : 'showDiagM']);
    setMessage(on.length ? `Diagramok: ${on.map((k) => k.toUpperCase()).join(', ')}` : 'Diagramok kikapcsolva.');
    draw();
  });
}

btnDeform.addEventListener('click', () => {
  if (!editor.result) return;
  editor.showDeform = !editor.showDeform;
  btnDeform.classList.toggle('active', editor.showDeform);
  btnDeform.setAttribute('aria-pressed', String(editor.showDeform));
  if (editor.showDeform) {
    const r = editor.result;
    const cam = editor.camera;
    const factor = r.maxAbsU > 0 ? 120 / (r.maxAbsU * cam.zoom) : 1;
    setMessage(
      `Deformált alakzat, ${factor.toLocaleString('hu-HU', { maximumFractionDigits: 0 })}-szoros nagyítással.`,
    );
  } else {
    setMessage('Eredeti alakzat.');
  }
  draw();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    runSolve();
  }
});

for (const btn of fixButtons) {
  btn.addEventListener('click', () => {
    editor.membraneFixMask = Number(btn.dataset.fix) || 3;
    for (const b of fixButtons) b.classList.toggle('active', b === btn);
  });
}

for (const btn of modeButtons) {
  btn.addEventListener('click', () => setMode(btn.dataset.mode as '1d' | '2d'));
}

for (const input of [m2Thickness, m2Divisions, m2Edge, m2Fx, m2Fy]) {
  input.addEventListener('input', () => {
    editor.setMembraneSize(Number(m2Thickness.value) || 10, Number(m2Divisions.value) || 4);
    push2DInputs();
  });
}

editor.onChange(() => {
  if (editor.mode === '2d') {
    m2Thickness.value = String(editor.membrane2d.thickness * 1000);
    m2Divisions.value = String(editor.membrane2d.divisions);
  }
});

fillCatalogSelects();
syncSectionPanel();
editor.onChange(syncSectionPanel);
