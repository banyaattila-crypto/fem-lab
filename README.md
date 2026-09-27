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

A **Rúdonkénti eredmények** táblázat minden rúdra megadja a hosszt, a rúd
mentén keresett max |N|, |V|, |M|, σ értékeket, a lehajlást és a
**kihasználtságot** (max σ / fy). A kihasználtság 100% fölött a folyáshatár
túllépését jelenti — ezt az üzenetsor is kiemeli. A táblázat a legnagyobb
kihasználtságú rúd sorát kiemeli, és az eredménypanel megmondja, melyik az.

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

### Számítás (2D membránelem)

A `src/membrane.ts` négyszögletű (Q4) **síkrugalmassági — membrán — elemet**
tartalmaz: csomópontonként 2 szabadsági fok (ux, uy), a lemez a saját síkjában
nyúlik. A `MembraneModel` a bemenet (E, ν, vastagság, csomópontok, elemek,
rögzítések, pont- és élterhek), a `solveMembrane()` a megoldó.

- **Merevségi mátrix:** 2×2-es Gauss-integrálás (síkbeli nyúlásnál nincs
  locking, és a nyíróenergiát is jól közelíti).
- **Feszültség-visszanyerés:** 2×2 Gauss-pontonként σxx, σyy, τxy, fősajtos
  értékek és von Mises; elemenként az átlag és a maximum.
- **Terhek:** koncentrált csomóponti erők és élterhek. Az élteher a
  `from → to` élre merőleges; a pozitív `t` anticlockwise elemhálónál a lemezből
  kifelé húz (t = σ·n), és a belső él csak egyszer számítódik.
- **Eredmények:** elmozdulásvektor, reakciók, a globális terhelés- és
  reakciómérleg (erő és nyomaték, ~1e-10 relatív hibával), max |u|,
  max von Mises és a meghatározó elem.

**Ellenőrzés (21 teszt):** egyetlen elemen a húzás pontos; ν = 0 esetén a
lineáris feszültségmező minden Gauss-pontban pontosan P/A; valós ν-val a
középső zónában tiszta húzás; a Timoshenko-féle kantilever-megoldás
(lehajlás + nyírás) 5%-on belül, hálófinomítással monoton közelítve; a Poisson-
hatás (`εyy = −ν·εxx`) hálófüggetlenül pontos; tükrözési szimmetria; a
feszültség a vastagságtól a keresztmetszeten keresztül függ (`P/(t·h)`), az
elmozdulás `1/t`.

**Korlát:** a membránelem a síkra merőleges kihajlást NEM számolja. Ehhez három
szabadsági fokos (w, θx, θy) lemezelem kell — ez külön feladat.

## Következő lépések

1. A membránelem integrálása a rajzolóba: négyzögháló generálás, peremtámaszok,
   élterhek, feszültségszínkép.
2. Három szabadsági fokos lemezhajlítási elem (w, θx, θy) a síkra merőleges
   kihajlításhoz.
3. Szelvényszerkesztő; használhatósági ellenőrzés (lehajláskorlátok).
4. A kihajlásnál a hatékony hossz valódi végfeltételekből (K-faktor).

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
