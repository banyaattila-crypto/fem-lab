import { describe, expect, it } from 'vitest';
import {
  GRAVITY,
  catalogIsConsistent,
  cloneCatalog,
  defaultCatalog,
  materialById,
  sectionById,
  sectionProps,
  selfWeightPerLength,
} from '../src/catalog';
import {
  addBeam,
  addNode,
  assignBeams,
  beamLength,
  beamSection,
  createStructure,
  defaultMaterialId,
  defaultSectionId,
  fromJSON,
  massAndWeight,
  structureIsConsistent,
  toJSON,
} from '../src/geometry';

describe('katalógus — alapadatok', () => {
  it('az alapkatalógus konzisztens és nem üres', () => {
    const c = defaultCatalog();
    expect(c.materials.length).toBeGreaterThan(3);
    expect(c.sections.length).toBeGreaterThan(3);
    expect(catalogIsConsistent(c)).toBe(true);
  });

  it('téglalap szelvény: A = b·h, I = b·h³/12', () => {
    const p = sectionProps({ id: 'x', name: 'x', shape: 'rect', b: 0.2, h: 0.3, tw: 0, tf: 0 });
    expect(p.A).toBeCloseTo(0.06, 12);
    expect(p.I).toBeCloseTo((0.2 * 0.3 ** 3) / 12, 15);
    expect(p.yBot).toBeCloseTo(0.15, 12);
  });

  it('kör szelvény: A = πd²/4, I = πd⁴/64', () => {
    const p = sectionProps({ id: 'x', name: 'x', shape: 'circle', b: 0.06, h: 0.06, tw: 0, tf: 0 });
    expect(p.A).toBeCloseTo((Math.PI * 0.06 ** 2) / 4, 12);
    expect(p.I).toBeCloseTo((Math.PI * 0.06 ** 4) / 64, 18);
  });

  it('I szelvény: az öv és az övegy összege, a kivételek nélkül', () => {
    const p = sectionProps({ id: 'x', name: 'x', shape: 'i', b: 0.2, h: 0.2, tw: 0.009, tf: 0.015 });
    const web = 0.2 - 2 * 0.015;
    expect(p.A).toBeCloseTo(2 * 0.2 * 0.015 + web * 0.009, 12);
    expect(p.I).toBeCloseTo((0.2 * 0.2 ** 3 - (0.2 - 0.009) * web ** 3) / 12, 15);
  });

  it('az IPE 160 mérete a katalógus-számokhoz közeli területet ad (kb. 19–21 cm²)', () => {
    const c = defaultCatalog();
    const p = sectionProps(sectionById(c, 'ipe160')!);
    expect(p.A * 1e4).toBeGreaterThan(19);
    expect(p.A * 1e4).toBeLessThan(22);
  });

  it('az önsúlyintenzitás q = A·ρ·g, lefelé negatív', () => {
    const c = defaultCatalog();
    const mat = materialById(c, 's235')!;
    const sec = sectionById(c, 'sq150')!;
    const q = selfWeightPerLength(mat, sec);
    expect(q).toBeCloseTo(-0.15 * 0.15 * 7850 * GRAVITY, 3);
    expect(q).toBeLessThan(0);
  });

  it('a konzisztencia-ellenőrző elkapja a hibás méreteket', () => {
    const c = defaultCatalog();
    c.sections[0]!.b = 0;
    expect(catalogIsConsistent(c)).toBe(false);
    c.sections[0]!.b = 0.1;
    const c2 = defaultCatalog();
    c2.materials[0]!.E = 0;
    expect(catalogIsConsistent(c2)).toBe(false);
  });

  it('a klónozás mély másolat, nem a katalógus referenciája', () => {
    const c = defaultCatalog();
    const copy = cloneCatalog(c);
    copy.materials[0]!.E = 1;
    copy.sections[0]!.b = 9;
    expect(c.materials[0]!.E).toBe(210e9);
    expect(c.sections[0]!.b).toBe(0.1);
  });
});

describe('katalógus — rúdhoz rendelés', () => {
  function portal(): ReturnType<typeof createStructure> {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 4, 0);
    addNode(s, 4, 3);
    addBeam(s, 0, 1);
    addBeam(s, 1, 2);
    return s;
  }

  it('az új rúd az alapértelmezett anyagot és szelvényt kapja', () => {
    const s = portal();
    expect(s.beams[0]!.materialId).toBe(defaultMaterialId(s));
    expect(s.beams[0]!.sectionId).toBe(defaultSectionId(s));
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a kijelölt rudak anyag/szelvénye módosítható', () => {
    const s = portal();
    expect(assignBeams(s, [1], 'c25', 'sq200')).toBe(1);
    expect(s.beams[1]!.materialId).toBe('c25');
    expect(s.beams[1]!.sectionId).toBe('sq200');
    expect(s.beams[0]!.materialId).toBe(defaultMaterialId(s));
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('ismeretlen katalógus-hivatkozással nem rontunk el semmit', () => {
    const s = portal();
    expect(assignBeams(s, [0], 'nincs-ilyen', 'sq100')).toBe(0);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a konzisztencia-ellenőrző a hiányzó katalógusbejegyzést is kiszúrja', () => {
    const s = portal();
    s.beams[0]!.sectionId = 'törölt-szelvény';
    expect(structureIsConsistent(s)).toBe(false);
  });

  it('a rúd keresztmetszeti adatai a katalógusból jönnek', () => {
    const s = portal();
    assignBeams(s, [0], 's235', 'sq200');
    const props = beamSection(s, s.beams[0]!);
    expect(props?.A).toBeCloseTo(0.04, 12);
    expect(props?.I).toBeCloseTo((0.2 * 0.2 ** 3) / 12, 15);
  });

  it('a tömeg és a súly a hosszból és a sűrűségből számolódik', () => {
    const s = portal();
    assignBeams(s, [0, 1], 's235', 'sq150');
    const { mass, weight } = massAndWeight(s);
    const volume = 0.15 * 0.15 * (4 + 3);
    expect(mass).toBeCloseTo(volume * 7850, 6);
    expect(weight).toBeCloseTo((mass * GRAVITY) / 1000, 9);
  });
});

describe('katalógus — mentés', () => {
  it('a 2. verzió megőrzi a katalógust és a rúdbeállításokat', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 3, 0);
    addBeam(s, 0, 1, 'gl24', 'd60');
    const back = fromJSON(toJSON(s));
    expect(back.beams[0]!.materialId).toBe('gl24');
    expect(back.beams[0]!.sectionId).toBe('d60');
    expect(beamLength(back, back.beams[0]!)).toBeCloseTo(3, 12);
    expect(structureIsConsistent(back)).toBe(true);
  });

  it('a régi 1. verziójú fájl is betölthető, alapértelmezett katalógussal', () => {
    const old = {
      version: 1 as const,
      nodes: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      beams: [{ nodeI: 0, nodeJ: 1 }],
    };
    const s = fromJSON(old);
    expect(s.beams).toHaveLength(1);
    expect(s.beams[0]!.materialId).toBe(defaultMaterialId(s));
    expect(s.selfWeight).toBe(false);
    expect(structureIsConsistent(s)).toBe(true);
  });

  it('a mentett katalógus módosítása nem szivárog vissza a forrásba', () => {
    const s = createStructure();
    addNode(s, 0, 0);
    addNode(s, 1, 0);
    addBeam(s, 0, 1);
    const json = toJSON(s);
    json.materials![0]!.fy = 999;
    expect(s.catalog.materials[0]!.fy).toBe(235);
  });
});
