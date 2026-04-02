# Fantasy Map Generator

En liten, dependency-fri webbapp som genererar en isolerad fantasivärld i havet med deterministiska seeds, intern världsdata, namn, städer, floder, sjöar, biomer och hover-inspektion.

## Teknikval

- Ren HTML, CSS och JavaScript med ES-moduler.
- Canvas-rendering för snabb, enkel och helt statisk kartbild.
- Cellbaserad intern världsmodell för att hålla generering, hover och rendering kopplade till samma data.
- Inga externa npm-beroenden, vilket gör lösningen lätt att köra, reproducera och bygga vidare på.

## Föreslagen systemdesign

Systemet är uppdelat i fyra lager:

1. `src/generator/*`
   Terräng, hydrologi, klimat, regionsegmentering, naming-steg och stadsplacering.
2. `src/naming.js`
   Deterministisk namngivning byggd på en world-specific språkprofil.
3. `src/render/*`
   Pappersrendering till canvas och hjälpmetoder för koordinatöversättning.
4. `src/query/*`
   Geografiska queries som hover och annan inspektion kan dela utan att gå via renderlagret.
5. `src/app.js` och `src/inspector.js`
   UI, parameterstyrning, hover-logik och export.

Det här håller generering, naming, rendering och UI tydligt separerade så att nästa steg kan byta ut eller förfina en del utan att skriva om allt.

## Genereringspipeline

1. Normalisera användarparametrar och seed.
2. Välj en intern ö-stil per seed, till exempel `shield`, `crescent`, `twin`, `spine` eller `shattered`.
3. Bygg rå landmassa från asymmetriska blobbar, noise och stark edge falloff så att världen alltid omges av hav.
4. Tröska rå terräng till land/hav-mask och skapa höjddata.
5. Lägg på bergsfält via deterministiska bergskedjor och massiver.
6. Beräkna havs- och kustavstånd och använd det för grundfuktighet.
7. Välj flodkällor från regnigare och högre terräng och spåra floder nedför terrängen.
8. Bilda sjöar i lokala sänkor när floder fastnar och vattenrikedom tillåter det.
9. Härled temperatur och fukt från latitud, höjd, hav, inlandsvatten och enkel regnskugga.
10. Klassificera biomer.
11. Segmentera sammanhängande biomregioner och bergsområden.
12. Applicera naming som ett separat steg på regioner, sjöar, floder och världstiteln.
13. Placera städer via en plausibilitetsmodell som favoriserar kust, floder, sjöar, lågland och beboeliga biomer.
14. Rendera kartan i enkel pappersstil och använd query-lagret för hover-inspektion.

## Interna datastrukturer

Världen representeras huvudsakligen som en fast grid på `300 x 220` celler:

- `terrain.isLand: Uint8Array`
- `terrain.elevation: Float32Array`
- `terrain.mountainField: Float32Array`
- `hydrology.oceanDistance / coastDistance / waterDistance: Int16Array`
- `hydrology.riverStrength: Float32Array`
- `hydrology.lakeIdByCell: Int16Array`
- `climate.temperature / moisture: Float32Array`
- `climate.biome: Uint8Array`
- `regions.biomeRegionId / mountainRegionId: Int32Array`

Objektlistor byggs ovanpå detta:

- `hydrology.rivers[]`
- `hydrology.lakes[]`
- `regions.biomeRegions[]`
- `regions.mountainRegions[]`
- `cities[]`

Det gör att samma data kan användas både för rendering, UI-hover och senare funktioner som vägar, fraktioner eller export.

## Köra lokalt

Starta en enkel lokal server:

```bash
npm start
```

Öppna sedan `http://localhost:4173`.

Det går också att öppna [index.html](/Users/robin.reicher/Projects/fantasy-map/index.html) direkt i en browser, men en lokal server är säkrast för modulimporter.

## Verifiering

Kontrollera determinism:

```bash
npm test
```

Skriv ut några exempelvärldar i terminalen:

```bash
npm run examples
```

## Exempelparametrar

1. `seed=saltwind-01`, balanserad karta för allmän testning.
2. `seed=glass-reef`, mer uppbruten kust, mer berg och mer inlandsvatten.
3. `seed=amber-cairn`, större region med fler städer och torrare uttryck.

## Kända avvägningar i version 1

- Floder och sjöar är plausibla men inte fullständigt hydrologiskt korrekta.
- Rendering prioriterar läsbar kartkänsla framför exakt konturpolering.
- Label-placering på kartan är enkel och fokuserar på några större objekt, medan hover visar fler namn.
