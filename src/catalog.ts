/**
 * Anyag- és szelvénykatalógus. A rúdok ezekre hivatkoznak (id-val), így a
 * modell önmagában hordozza a számszerű jellemzőket — a szolvernek nem kell
 * külső adatbázis.
 *
 * Mértékegységek SI-ben: E Pa, ρ kg/m³, fy MPa, hossz m, A m², I m⁴.
 */

export interface Material {
  id: string;
  name: string;
  E: number;
  nu: number;
  rho: number;
  /** karakterisztikus folyáshatár (MPa) — a feszültségellenőrzéshez kell */
  fy: number;
}

/** Téglalap és I szelvény: b = övszélesség, h = magasság. Kör: b = átmérő. */
export type SectionShape = 'rect' | 'circle' | 'i';

export interface Section {
  id: string;
  name: string;
  shape: SectionShape;
  b: number;
  h: number;
  /** I szelvény övegyvastagsága (a többi alaknál 0) */
  tw: number;
  /** I szelvény övvastagsága (a többi alaknál 0) */
  tf: number;
}

export interface SectionProps {
  A: number;
  I: number;
  /** súlyponttávolságok a szélső szálakig (két tengelyen szimmetrikus, de nem feltétlenül egyenlő) */
  yBot: number;
  yTop: number;
}

export interface Catalog {
  materials: Material[];
  sections: Section[];
}

export const GRAVITY = 9.81;

export function sectionProps(sec: Section): SectionProps {
  if (sec.shape === 'circle') {
    const d = sec.b;
    return { A: (Math.PI * d * d) / 4, I: (Math.PI * Math.pow(d, 4)) / 64, yBot: d / 2, yTop: d / 2 };
  }
  if (sec.shape === 'i') {
    const { b, h, tw, tf } = sec;
    const web = Math.max(h - 2 * tf, 0);
    return {
      A: 2 * b * tf + web * tw,
      // a két öv és az övegy másodlagos momentuma a semleges tengelyre
      I: (b * Math.pow(h, 3) - (b - tw) * Math.pow(web, 3)) / 12,
      yBot: h / 2,
      yTop: h / 2,
    };
  }
  return { A: sec.b * sec.h, I: (sec.b * Math.pow(sec.h, 3)) / 12, yBot: sec.h / 2, yTop: sec.h / 2 };
}

export function defaultCatalog(): Catalog {
  return {
    materials: [
      { id: 's235', name: 'S235JR acél', E: 210e9, nu: 0.3, rho: 7850, fy: 235 },
      { id: 's355', name: 'S355 acél', E: 210e9, nu: 0.3, rho: 7850, fy: 355 },
      { id: 'c25', name: 'C25/30 beton', E: 30e9, nu: 0.2, rho: 2500, fy: 13.5 },
      { id: 'gl24', name: 'GL24h fa', E: 11e9, nu: 0.4, rho: 420, fy: 24 },
    ],
    sections: [
      { id: 'sq100', name: 'Téglalap 10×10 cm', shape: 'rect', b: 0.1, h: 0.1, tw: 0, tf: 0 },
      { id: 'sq150', name: 'Téglalap 15×15 cm', shape: 'rect', b: 0.15, h: 0.15, tw: 0, tf: 0 },
      { id: 'sq200', name: 'Téglalap 20×20 cm', shape: 'rect', b: 0.2, h: 0.2, tw: 0, tf: 0 },
      { id: 'd60', name: 'Kör Ø60 mm', shape: 'circle', b: 0.06, h: 0.06, tw: 0, tf: 0 },
      { id: 'ipe160', name: 'IPE 160 (idealizált)', shape: 'i', b: 0.082, h: 0.16, tw: 0.005, tf: 0.0074 },
      { id: 'heb200', name: 'HEB 200 (idealizált)', shape: 'i', b: 0.2, h: 0.2, tw: 0.009, tf: 0.015 },
    ],
  };
}

export function materialById(c: Catalog, id: string): Material | undefined {
  return c.materials.find((m) => m.id === id);
}

export function sectionById(c: Catalog, id: string): Section | undefined {
  return c.sections.find((sec) => sec.id === id);
}

/** A rúd önsúlyintenzitása y irányban: q = A·ρ·g (negatív = lefelé). */
export function selfWeightPerLength(mat: Material, sec: Section): number {
  return -sectionProps(sec).A * mat.rho * GRAVITY;
}

export function catalogIsConsistent(c: Catalog): boolean {
  if (c.materials.some((m) => !(m.E > 0) || !(m.rho > 0))) return false;
  for (const sec of c.sections) {
    if (!(sec.b > 0) || !(sec.h > 0)) return false;
    if (sec.shape === 'i' && (!(sec.tw > 0) || !(sec.tf > 0))) return false;
    if (sectionProps(sec).A <= 0 || sectionProps(sec).I <= 0) return false;
  }
  if (new Set(c.materials.map((m) => m.id)).size !== c.materials.length) return false;
  if (new Set(c.sections.map((s) => s.id)).size !== c.sections.length) return false;
  return true;
}

export function cloneCatalog(c: Catalog): Catalog {
  return {
    materials: c.materials.map((m) => ({ ...m })),
    sections: c.sections.map((s) => ({ ...s })),
  };
}
