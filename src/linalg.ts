/**
 * Sűrű lineáris egyenletrendszer-megoldó (Gauss-elimináció részleges
 * pivotálással) és mátrixsegédek. A váz-szolver mérete miatt (3 DOF / csomópont)
 * ez elegendő és átlátható; nagy rácsmodellhez később iteratív megoldó kell.
 */

export type Matrix = number[][];

export interface SolveResult {
  x: number[];
  /** Igaz, ha a mátrix szinguláris volt (nincs egyértelmű megoldás). */
  singular: boolean;
}

function maxAbs(A: Matrix): number {
  let m = 0;
  for (const row of A) for (const v of row) m = Math.max(m, Math.abs(v));
  return m;
}

/** A·x = b megoldása LU-faktorizációval. Szingularitásnál `singular: true`. */
export function solveLinearSystem(A: Matrix, b: number[]): SolveResult {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  const scale = maxAbs(A);
  const eps = scale * 1e-12;

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivotRow]![col]!)) pivotRow = r;
    }
    const pivot = M[pivotRow]![col]!;
    if (Math.abs(pivot) <= eps) return { x: new Array<number>(n).fill(0), singular: true };
    if (pivotRow !== col) {
      const tmp = M[pivotRow]!;
      M[pivotRow] = M[col]!;
      M[col] = tmp;
    }
    const p = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= M[r]![c]! * x[c]!;
    x[r] = sum / M[r]![r]!;
  }
  return { x, singular: false };
}

/** y = A·x */
export function matVec(A: Matrix, x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, i) => s + v * x[i]!, 0));
}

/** y = Aᵀ·x (oszlopvektor transzponált szorzása) */
export function matVecT(A: Matrix, x: number[]): number[] {
  const m = A[0]!.length;
  const out = new Array<number>(m).fill(0);
  for (let t = 0; t < A.length; t++) {
    for (let i = 0; i < m; i++) out[i] = out[i]! + A[t]![i]! * x[t]!;
  }
  return out;
}

/** n×n nullmátrix */
export function zeros(n: number): Matrix {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}
