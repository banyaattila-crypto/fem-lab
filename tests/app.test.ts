// @vitest-environment jsdom
/**
 * Alkalmazás-wiring smoke-teszt: a valódi index.html-t tölti be a jsdom-ba,
 * a main.ts modul-importján keresztül végigfuttatja az inicializálást. Így
 * kiszűrődnek a hiányzó elem-ID-k és a vászon-inicializálási hibák is, akkor
 * is, ha nincs böngésző a környezetben.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

function fakeContext(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const ctx = {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    setTransform: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    setLineDash: noop,
    measureText: () => ({ width: 10 }),
    fillText: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  document.documentElement.innerHTML = html;
  HTMLCanvasElement.prototype.getContext = fakeContext as never;
  HTMLCanvasElement.prototype.setPointerCapture = function setPointerCapture(): void {};
  HTMLCanvasElement.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  HTMLCanvasElement.prototype.getBoundingClientRect = function rect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}) } as DOMRect;
  };
  globalThis.URL.createObjectURL = (): string => 'blob:mock';
  globalThis.URL.revokeObjectURL = (): void => {};
});

describe('app wiring', () => {
  it('az index.html minden azonosítója megvan, amit a kód keres', async () => {
    const ids = [
      'board',
      'stat-nodes',
      'stat-beams',
      'stat-supports',
      'stat-loads',
      'stat-length',
      'message',
      'coord',
      'btn-undo',
      'btn-redo',
      'btn-fit',
      'btn-clear',
      'btn-delete',
      'btn-export',
      'btn-import',
      'file-input',
      'grid-step',
      'snap-toggle',
      'load-fx',
      'load-fy',
      'stat-mass',
      'stat-weight',
      'material-select',
      'section-select',
      'self-weight',
      'section-hint',
      'btn-solve',
      'btn-deform',
      'solve-hint',
      'results',
      'res-n',
      'res-m',
      'res-v',
      'res-sigma',
      'res-u',
      'res-theta',
      'res-dof',
      'res-balance',
      'reaction-table',
      'reaction-body',
      'load-mz',
      'load-qy',
    ];
    for (const id of ids) {
      expect(document.querySelector(`#${id}`), `#${id} hiányzik az index.html-ből`).not.toBeNull();
    }
    expect(document.querySelectorAll('[data-tool]').length).toBe(7);
    expect(document.querySelectorAll('[data-support]').length).toBe(3);
  });

  it('a főmodul inicializálás hibátlan lefut és a HUD a nulláról indul', async () => {
    await import('../src/main');
    expect(document.querySelector<HTMLElement>('#stat-nodes')?.textContent).toBe('0');
    expect(document.querySelector<HTMLElement>('#stat-beams')?.textContent).toBe('0');
    expect(document.querySelector<HTMLElement>('#stat-supports')?.textContent).toBe('0');
    expect(document.querySelector<HTMLElement>('#stat-loads')?.textContent).toBe('0');
    expect(document.querySelector<HTMLElement>('#stat-length')?.textContent).toBe('0.00 m');
    const undo = document.querySelector<HTMLButtonElement>('#btn-undo');
    const del = document.querySelector<HTMLButtonElement>('#btn-delete');
    expect(undo?.disabled).toBe(true);
    expect(del?.disabled).toBe(true);
  });

  it('az alapértelmezett eszköz a rúd, és az eszközváltás frissíti az üzenetet', async () => {
    await import('../src/main');
    const beamBtn = document.querySelector<HTMLButtonElement>('[data-tool="beam"]');
    expect(beamBtn?.classList.contains('active')).toBe(true);
    const selectBtn = document.querySelector<HTMLButtonElement>('[data-tool="select"]');
    selectBtn?.click();
    expect(selectBtn?.classList.contains('active')).toBe(true);
    expect(document.querySelector<HTMLElement>('#message')?.textContent).toContain('Kijelölés');
  });

  it('a katalógus legördülők feltöltődnek, és a választás a rudakra kerül', async () => {
    await import('../src/main');
    const mat = document.querySelector<HTMLSelectElement>('#material-select');
    const sec = document.querySelector<HTMLSelectElement>('#section-select');
    expect(mat?.options.length).toBe(4);
    expect(sec?.options.length).toBe(6);
    expect(mat?.value).toBe('s235');
    expect(sec?.value).toBe('sq150');
    if (mat) {
      mat.value = 's355';
      mat.dispatchEvent(new Event('change'));
    }
    expect(document.querySelector<HTMLElement>('#message')?.textContent).toContain('Szelvény');
  });

  it('az önsúly-kapcsoló átbillen és a súlystatisztika megjelenik', async () => {
    await import('../src/main');
    const box = document.querySelector<HTMLInputElement>('#self-weight');
    expect(box?.checked).toBe(false);
    box?.click();
    expect(box?.checked).toBe(true);
    expect(document.querySelector<HTMLElement>('#message')?.textContent).toContain('Önsúly');
    expect(document.querySelector<HTMLElement>('#stat-weight')?.textContent).toBe('0.00 kN');
    expect(document.querySelector<HTMLElement>('#stat-mass')?.textContent).toBe('0 kg');
  });

  it('üres modellen a számítás magyar hibaüzenetet ad', async () => {
    await import('../src/main');
    document.querySelector<HTMLButtonElement>('#btn-solve')?.click();
    const msg = document.querySelector<HTMLElement>('#message')?.textContent ?? '';
    expect(msg).toMatch(/Üres|nincs mit számolni/i);
    expect(document.querySelector<HTMLElement>('#results')?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#btn-deform')?.disabled).toBe(true);
  });

  it('a támasztípus-választó kijelöli az aktív típust', async () => {
    await import('../src/main');
    const roller = document.querySelector<HTMLButtonElement>('[data-support="roller"]');
    roller?.click();
    expect(roller?.classList.contains('active')).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-support="pinned"]')?.classList.contains('active'),
    ).toBe(false);
  });

  it('a teherértékek kN-ban érkeznek, a modell N-ben tárolja őket', async () => {
    await import('../src/main');
    const fy = document.querySelector<HTMLInputElement>('#load-fy');
    if (fy) {
      fy.value = '-12.5';
      fy.dispatchEvent(new Event('input'));
    }
    const qy = document.querySelector<HTMLInputElement>('#load-qy');
    if (qy) {
      qy.value = '-3';
      qy.dispatchEvent(new Event('input'));
    }
    const stats = document.querySelector<HTMLElement>('#stat-loads');
    expect(stats?.textContent).toBe('0');
  });
});
