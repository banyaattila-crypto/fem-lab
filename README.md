# fem-lab

**2D vázrajzoló, amire a végeselem-számítás épül.**

Az alkalmazás első lépése a rajzolás: a felhasználó a vászonra felrajzolja a szerkezetet
csomópontokból és rudakból. Ez a rajz a későbbi FEM-számítás geometriai bemenete —
a modellezés nem előre gyárilag sávolt sablonokból indul, hanem abból, amit rajzolsz.

## Most (2. iteráció): a rajzoló + támaszok/terhek

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

### Adatmodell

A `Structure { nodes, beams, supports, loads, distLoads }` a FEM bemenete. Az
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
