# fem-lab

**2D vázrajzoló, amire a végeselem-számítás épül.**

Az alkalmazás első lépése a rajzolás: a felhasználó a vászonra felrajzolja a szerkezetet
csomópontokból és rudakból. Ez a rajz a későbbi FEM-számítás geometriai bemenete —
a modellezés nem előre gyárilag sávolt sablonokból indul, hanem abból, amit rajzolsz.

## Most (4. iteráció): rajzoló + támaszok/terhek + katalógus + 1D váz-szolver

- **Rúd eszköz** — kattints a kezdőpontra, majd a végpontokra; a lánc folytatódik
  (Esc vagy dupla kattintás zárja). A meglévő csomópontra kattintva az ahhoz csatlakozik,
  duplikátum nem jön létre.
- **Csomópont eszköz** — szabad csomópont lerakása.
- **Kijelölés eszköz** — rúdra/csomópontra kattintás, Shift a lásd, üresen húzva
  téglalap szerinti kijelölés; a kijejlölt csomópont húzható.
- **Rács + ugrás** — adaptív rács, választható lépés (alap 0,25 m) és rácsra ugrás.
- **Nagyítás/képezés** — görgő a horgonypont körül, jobb gomb vagy Alt a húzás.
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z), modell **export/import** JSON-ban.
- **Támasz eszköz** (T) — csukló / görgő / befogás lerakása csomópontra; egy
  csomóponton egy támasz, a szimbólumra kattintva kijelölhető (Del törli).
- **Konc. erő** (E), **nyomaték** (M) — csomópontra rakható, Fx/Fy/M értékek
  kN, kN·m egységben adhatók meg.
- **Megoszló teher** (Q) — rúdra rakható, qy kN/m-ben; pozitív felfelé, negatív
  lefelé mutat.
- Élő statisztika: csomópontok, rudak, támaszok, terhek, teljes rúdhossz.

Az értékbevitel kN / kN·m / kN/m egységben történik, a modell SI-ben (N, N·m,
N/m) tárol — így a szolverhez nem kell konverzió.

### Anyag- és szelvénykatalógus

- **4 anyag** (S235JR, S355, C25/30 beton, GL24h fa) E, ν, ρ és karakterisztikus
  folyáshatár fy értékkel.
- **6 szelvény** (3 téglalap, 1 kör, IPE 160, HEB 200) — a téglalap, kör és I
  szelvény másodlagos momentuma képlettel számolódik, a tárolt szelvényeknél a
  méretezési táblázatoknak megfelelő nagyságrend.
- A kiválasztás **kijelölt rudak** esetén rájuk kerül, egyébként az új rudak
  alapértéke lesz. A rúd vonalvastagsága a keresztmetszet területét követi.
- Élő **tömeg és súly** statisztika (A·ρ·L, illetve ·g), plusz **önsúly**
  kapcsoló a szolverhez.

### Számítás (1D váz-szolver)

A **Számítás** gomb megoldja a szerkezetet: Euler–Bernoulli rúdelem, csomópontonként
3 szabadsági fok (ux, uy, θz), a rúd két végén a nyomaték nem esik ki. A számsítás
magja a `src/solver.ts`, a lineáris egyenletrendszert a `src/linalg.ts` oldja
(Gauss-elimináció, részleges pivotálás).

Eredmények: reakciók, max |N|, |V|, |M|, σ, elmozdulás, forgatás, szabadsági fokok
száma — és a **mérlegellenőrzés**: a terhek és a reakciók globális momentummérlege
a kezdőpont körül. Hibátlan megoldásnál a relatív eltérés 1e-15 nagyságrendű, ezt a
tesztek is ellenőrzik.

Az **Alakzat** gomb a deformált alakzatot rajzolja, automatikus nagyítással
(ezt az üzenetsor kiírja) — a valós lehajlás mm-es, a képernyőn láthatóvá kell
nagyítani. Az **N/V/M diagram** gombok a rúd tengelyére merőlegesen rajzolják a
belső erőket; a skálázás típusonként globális, és az értékek a rúd MENTÉN
keresett maximumokból jönnek, nem csak a csomópontokból. Megoszló teher esetén a
nyomatékdiagram kvadratikus, ezért egyetlen hosszú elemen a valódi maximum a
középen van — ezt a számsítás már figyelembe veszi.

**Pontosság:** egyetlen rúdelem a megoszló teher okozta lehajlás közepén csak ~80%-ot
ad (a pontos alak kvartikus, az elem kubikus). Ha a lehajlás számít, oszd fel a
rudakat 1 m-nél kisebb elemekre — a reakciók és a csomóponti elmozdulások ettől
függetlenül mindig pontosak.

### Adatmodell

A `Structure { nodes, beams, supports, loads, distLoads, selfWeight, catalog }`
a FEM bemenete. Az
`id === index` invariáns minden művelet után is áll — beleértve a csomópont- és
rúdtörlést, ami a terhek hivatkozásait is újraszámolja (`structureIsConsistent`
ellenőrzi, tesztelve van).

## Következő lépések

1. Támaszok (csukló / görgő / befogás) és koncentrált + megoszló terhek rajzolása.
2. 1D váz-szolver (Euler–Bernoulli rúdelem + rácsrúd), N/M/V és σ visszanyeréssel.
3. Deformált alakzat, rúderő- és feszültség-diagramok.
4. Szelvény- és anyagkatalógus, szelvényszerkesztő.

## Fejlesztés

```bash
npm install
npm run dev        # fejlesztői szerver
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tíszta build a dist/-be
```

**Technológia:** Vite · TypeScript (strict) · vanilla DOM · Canvas 2D · Vitest

⚠️ *Oktatási célú projekt — mérnöki döntéshez nem használható!*
