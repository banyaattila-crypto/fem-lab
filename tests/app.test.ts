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
    ];
    for (const id of ids) {
      expect(document.querySelector(`#${id}`), `#${id} hiányzik az index.html-ből`).not.toBeNull();
    }
    expect(document.querySelectorAll('[data-tool]').length).toBe(3);
  });

  it('a főmodul inicializálás hibátlan lefut és a HUD a nulláról indul', async () => {
    await import('../src/main');
    expect(document.querySelector<HTMLElement>('#stat-nodes')?.textContent).toBe('0');
    expect(document.querySelector<HTMLElement>('#stat-beams')?.textContent).toBe('0');
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
});
