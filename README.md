# Färdväg

En webbapp för att generera, utforska och spela på en deterministisk fantasikarta. Projektet består i dag av två tydliga lägen:

- `Editor`: generera kartor, justera parametrar och exportera kartbild
- `Spelläge`: utforska kartan med fog of war, resa mellan noder och växla mellan kartvy och färdvy

Projektet är byggt i HTML, CSS och TypeScript med ES-moduler och körs via Vite.

## Snabbstart

Starta den lokala servern:

```bash
npm install
npm start
```

Obs: kör via `npm start` (Vite). En enkel statisk server (`python -m http.server`) kan inte köra TypeScript-modulerna direkt.

Öppna sedan:

- [http://localhost:4173/](http://localhost:4173/) för spelläget
- [http://localhost:4173/?mode=editor](http://localhost:4173/?mode=editor) för editorn
  (`/editor` finns kvar som redirect till samma läge)

Verifiering:

```bash
npm test
```

Baslinje för generationsprestanda:

```bash
npm run benchmark:worldgen
```

Skriv aktuell generationsbaslinje till `baselines/worldgen-baseline.json`:

```bash
npm run baseline:worldgen
```

Visuell regressionssvit (Playwright):

```bash
npm run test:e2e:visual
```

Exempelvärldar i terminalen:

```bash
npm run examples
```

## Deploy till GitHub Pages

Projektet måste byggas först så att Pages serverar JavaScript från `dist` i stället för råa `.ts`-filer.

- Workflow finns i `.github/workflows/deploy-pages.yml` och körs på push till `main`.
- Vite sätter automatiskt `base` till `/<repo>/` i GitHub Actions, så asset-URL:er fungerar på Pages.
- I GitHub-repot: `Settings -> Pages -> Build and deployment -> Source: GitHub Actions`.

## Vad appen gör

Vid generering skapas en komplett värld med bland annat:

- landmassa och kustlinje
- höjddata och bergsområden
- klimat, biomer och biomregioner
- floder och sjöar
- bosättningar, vägvisare och övergivna noder
- vägnät och sjövägar
- etiketter för regioner, sjöar, berg och städer

Allt genereras deterministiskt från seed + parametrar, så samma inställningar ger samma värld.

## Lägen och flöde

### Editor

Editorn används för att bygga världen och justera parametrar som till exempel:

- kartstorlek
- bergighet
- stadsmängd
- floder
- sjöar
- kustdetalj
- minsta biomstorlek
- renderupplösning
- siktradie i spelläget

I editorn finns också:

- hover-inspektion av karta
- toggles för kartnamn, nodnamn, snö och svartvitt
- export till PNG
- statistikpanel

### Delade editorinställningar (checkas in)

Standardvärden för editor/spel läses nu från:

- `public/editor-defaults.json`

Så här uppdaterar du dem för GitHub Pages:

1. Justera inställningarna i editorn.
2. Klicka `Spara defaults-fil` (laddar ner en ny `editor-defaults.json`).
3. Ersätt `public/editor-defaults.json` i repot med den nedladdade filen.
4. Commit + push.

Efter deploy används den filen som utgångsläge när man öppnar editorn eller startar ett nytt spel.
Om du redan har gamla lokala värden sparade i webbläsaren kan du klicka `Återställ` för att gå tillbaka till filens värden.

### Spelläge

Spelläget startar från `/` och börjar i kartvyn.

I spelkartan finns bland annat:

- fog of war
- spelarmarkör
- noder
- resbara mål
- legend för kartnamn, nodnamn och hoverinfo

När spelaren klickar på en direkt ansluten plats startar resa och vyn byter automatiskt till färdvy.

Under resa:

- `M` växlar mellan kartvy och färdvy
- resan fortsätter i samma underliggande spelstate
- fog of war uppdateras permanent när spelaren upptäcker nya områden

### Färdvy

Färdvyn är en sidovy som visar resan som en stiliserad scen med:

- himmel
- havslager
- främre marklager som rullar åt vänster
- små biomanpassade markdetaljer
- spelarkaraktär sedd från sidan
- nodmarkör vid destinationen

Färdvyn är medvetet enklare och mer grafisk än kartan. Den är byggd så att marken rör sig medan spelaren i huvudsak står kvar i scenen.

## Arkitektur

Kodbasen är i praktiken uppdelad i sex huvuddelar.

### Paketstruktur

Projektet är nu uppdelat i workspaces med tydligare domängränser:

- `apps/web`: framtida app-shell/web-entrypoint
- `packages/shared`: delade typer, konstanter och hjälpmoduler
- `packages/world-gen`: exportyta för världsgenerering
- `packages/game-core`: exportyta för spelstate/logik
- `packages/render-canvas`: exportyta för canvas-rendering

### `packages/world-gen/*`

Ansvarar för att bygga världen:

- terräng
- hydrologi
- klimat
- regioner
- städer
- vägar
- geometri för rendering

Några centrala filer:

- [packages/world-gen/src/worldGenerator.ts](./packages/world-gen/src/worldGenerator.ts)
- [packages/world-gen/src/terrain.ts](./packages/world-gen/src/terrain.ts)
- [packages/world-gen/src/hydrology.ts](./packages/world-gen/src/hydrology.ts)
- [packages/world-gen/src/regions.ts](./packages/world-gen/src/regions.ts)
- [packages/world-gen/src/compileGeometry.ts](./packages/world-gen/src/compileGeometry.ts)

### `packages/render-canvas/*`

Canvas-rendering av kartan:

- terräng
- vägar
- floder
- skog
- berg
- labels
- fog of war

Några centrala filer:

- [packages/render-canvas/src/renderer.ts](./packages/render-canvas/src/renderer.ts)
- [packages/render-canvas/src/terrainLayer.ts](./packages/render-canvas/src/terrainLayer.ts)
- [packages/render-canvas/src/waterLayer.ts](./packages/render-canvas/src/waterLayer.ts)
- [packages/render-canvas/src/forestLayer.ts](./packages/render-canvas/src/forestLayer.ts)
- [packages/render-canvas/src/fogLayer.ts](./packages/render-canvas/src/fogLayer.ts)

### `packages/game-core/*`

Spelstate och färdlogik:

- spelarens position
- giltiga resmål
- pågående resa
- upptäckt mark för fog of war
- färdvytext
- färdscen

Några centrala filer:

- [packages/game-core/src/travel.ts](./packages/game-core/src/travel.ts)
- [packages/game-core/src/playQueries.ts](./packages/game-core/src/playQueries.ts)
- [packages/game-core/src/playStateReducer.ts](./packages/game-core/src/playStateReducer.ts)
- [packages/game-core/src/playViewText.ts](./packages/game-core/src/playViewText.ts)

### `packages/shared/*`

Delad domän och infrastruktur för övriga paket:

- typer (`types/*`)
- generella utilities (`utils`)
- seedad slump (`random`)
- globala konstanter/parametrar (`config`)
- biomer, färgsystem och namngivning (`biomes`, `colorSystem`, `naming`)
- nodmodell (`node/model`)

Några centrala filer:

- [packages/shared/src/config.ts](./packages/shared/src/config.ts)
- [packages/shared/src/types/world.ts](./packages/shared/src/types/world.ts)
- [packages/shared/src/random.ts](./packages/shared/src/random.ts)
- [packages/shared/src/biomes/index.ts](./packages/shared/src/biomes/index.ts)

### `src/ui/*`

UI-shell och kontrollflöden för editor och spel:

- boot/routing mellan `/` (default: play) och `/?mode=editor`
- editor-session
- play-session
- play-controller
- hoverpanel
- kamera- och canvasupplösning

Några centrala filer:

- [src/app.ts](./src/app.ts)
- [src/ui/appShell.ts](./src/ui/appShell.ts)
- [src/ui/editorSession.ts](./src/ui/editorSession.ts)
- [src/ui/playSession.ts](./src/ui/playSession.ts)
- [src/ui/playController.ts](./src/ui/playController.ts)

### Toppnivåfiler

- [index.html](./index.html): primär entrypoint för både play och editor (via `mode`-query)
- [editor/index.html](./editor/index.html): kompatibilitetsentrypoint som redirectar till `/?mode=editor`
- [styles.css](./styles.css): gemensam styling
- [packages/shared/src/config.ts](./packages/shared/src/config.ts): standardvärden och centrala konstanter

## Nuvarande datastruktur

Världen representeras främst som ett fast rutnät på `300 x 220` celler och ett antal objektlistor ovanpå det.

Exempel på griddata:

- `terrain.isLand`
- `terrain.elevation`
- `terrain.mountainField`
- `climate.temperature`
- `climate.moisture`
- `climate.biome`
- `regions.biomeRegionId`
- `regions.mountainRegionId`
- `hydrology.riverStrength`
- `hydrology.lakeIdByCell`

Objektlistor ovanpå detta:

- `settlements[]`
- `hydrology.rivers[]`
- `hydrology.lakes[]`
- `regions.biomeRegions[]`
- `regions.mountainRegions[]`

Spelläget lägger dessutom på egen state:

- aktuell nod
- aktuell position
- pågående resa
- upptäckta celler för fog of war

## Render- och spelmodell

### Editor-rendering

Editorn renderar hela kartan direkt till canvas med full dekor och full hover-inspektion.

### Play-rendering

Spelläget använder en delad modell:

- en cachead statisk bakgrundskarta
- dynamiska overlays för spelarmarkör, labels, noder och fog of war

Detta gör kartläget lättare än att rita om hela världen från grunden vid varje frame.

### Fog of war

Foggen bygger på två principer:

- upptäckt mark sparas permanent i spelstate
- oupptäckta områden täcks av ett separat fog-overlay

Noder och kartnamn i spelkartan filtreras mot upptäckt mark och resbarhet, så att kartan inte läcker mer information än tänkt.

## Några viktiga designval

- Ingen extern render- eller UI-stack
- Samma underliggande världsdata används för både editor, spel, hover och rendering
- Determinism prioriteras högt
- Kartan är stiliserad och handritad i uttrycket, inte strikt realistisk
- Färdvy och spelkarta är separata presentationer av samma resa

## Kända avvägningar

- Floder, sjöar och klimat är plausibla men inte vetenskapligt simulerade
- Färdvyn är stiliserad och prioriterar läsbar resa framför fysisk realism
- Labelplacering är heuristisk, inte perfekt optimerad
- Fog of war är fortfarande ett aktivt spelspår som sannolikt kommer att fintrimmas vidare visuellt

## Bra filer att börja i

Om du ska vidareutveckla projektet är det här de bästa ingångarna:

1. [src/app.ts](./src/app.ts)
2. [packages/world-gen/src/worldGenerator.ts](./packages/world-gen/src/worldGenerator.ts)
3. [packages/render-canvas/src/renderer.ts](./packages/render-canvas/src/renderer.ts)
4. [src/ui/playSession.ts](./src/ui/playSession.ts)
5. [packages/render-canvas/src/journeyScene.ts](./packages/render-canvas/src/journeyScene.ts)

Det ger en ganska bra bild av hela flödet från generering till rendering och spel.
