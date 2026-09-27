import { cloneStructure, fromJSON, toJSON } from './geometry';
import type { Structure } from './geometry';

export interface HistoryState {
  past: string[];
  future: string[];
  limit: number;
}

export function createHistory(limit = 100): HistoryState {
  return { past: [], future: [], limit };
}

export function commit(h: HistoryState, s: Structure): void {
  h.past.push(JSON.stringify(toJSON(s)));
  if (h.past.length > h.limit) h.past.shift();
  h.future.length = 0;
}

export function canUndo(h: HistoryState): boolean {
  return h.past.length > 0;
}

export function canRedo(h: HistoryState): boolean {
  return h.future.length > 0;
}

export function undo(h: HistoryState, current: Structure): Structure | null {
  const prev = h.past.pop();
  if (prev === undefined) return null;
  h.future.push(JSON.stringify(toJSON(current)));
  return fromJSON(JSON.parse(prev) as ReturnType<typeof toJSON>);
}

export function redo(h: HistoryState, current: Structure): Structure | null {
  const next = h.future.pop();
  if (next === undefined) return null;
  h.past.push(JSON.stringify(toJSON(current)));
  return fromJSON(JSON.parse(next) as ReturnType<typeof toJSON>);
}

export function snapshot(s: Structure): Structure {
  return cloneStructure(s);
}
