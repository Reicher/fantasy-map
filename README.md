# Fantasy Map

En dependency-fri webbapp för att generera, utforska och spela på en deterministisk fantasikarta. Projektet består i dag av två tydliga lägen:

- `Editor`: generera kartor, justera parametrar och exportera kartbild
- `Spelläge`: utforska kartan med fog of war, resa mellan noder och växla mellan kartvy och färdvy

Projektet är byggt i ren HTML, CSS och JavaScript med ES-moduler och använder ingen extern frontend-stack eller npm-beroenden.

## Snabbstart

Starta den lokala servern:

```bash
npm start
```

Öppna sedan:

- [http://localhost:4173/](http://localhost:4173/) för spelläget
- [http://localhost:4173/?mode=editor](http://localhost:4173/?mode=editor) för editorn
  (`/editor` finns kvar som redirect till samma läge)

Verifiering:

```bash
npm test
```

Exempelvärldar i terminalen:

```bash
npm run examples
```

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

Kodbasen är i praktiken uppdelad i fem huvuddelar.

### `src/generator/*`

Ansvarar för att bygga världen:

- terräng
- hydrologi
- klimat
- regioner
- städer
- vägar
- geometri för rendering

Några centrala filer:

- [src/generator/worldGenerator.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/worldGenerator.js)
- [src/generator/terrain.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/terrain.js)
- [src/generator/hydrology.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/hydrology.js)
- [src/generator/regions.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/regions.js)
- [src/generator/compileGeometry.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/compileGeometry.js)

### `src/render/*`

Canvas-rendering av kartan:

- terräng
- vägar
- floder
- skog
- berg
- labels
- fog of war

Några centrala filer:

- [src/render/renderer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/renderer.js)
- [src/render/terrainLayer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/terrainLayer.js)
- [src/render/waterLayer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/waterLayer.js)
- [src/render/forestLayer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/forestLayer.js)
- [src/render/fogLayer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/fogLayer.js)

### `src/game/*`

Spelstate och färdlogik:

- spelarens position
- giltiga resmål
- pågående resa
- upptäckt mark för fog of war
- färdvytext
- färdscen

Några centrala filer:

- [src/game/travel.js](/Users/robin.reicher/Projects/fantasy-map/src/game/travel.js)
- [src/game/playQueries.js](/Users/robin.reicher/Projects/fantasy-map/src/game/playQueries.js)
- [src/game/journeyScene.js](/Users/robin.reicher/Projects/fantasy-map/src/game/journeyScene.js)
- [src/game/playViewText.js](/Users/robin.reicher/Projects/fantasy-map/src/game/playViewText.js)

### `src/ui/*`

UI-shell och kontrollflöden för editor och spel:

- boot/routing mellan `/` (default: play) och `/?mode=editor`
- editor-session
- play-session
- play-controller
- hoverpanel
- kamera- och canvasupplösning

Några centrala filer:

- [src/app.js](/Users/robin.reicher/Projects/fantasy-map/src/app.js)
- [src/ui/appShell.js](/Users/robin.reicher/Projects/fantasy-map/src/ui/appShell.js)
- [src/ui/editorSession.js](/Users/robin.reicher/Projects/fantasy-map/src/ui/editorSession.js)
- [src/ui/playSession.js](/Users/robin.reicher/Projects/fantasy-map/src/ui/playSession.js)
- [src/ui/playController.js](/Users/robin.reicher/Projects/fantasy-map/src/ui/playController.js)

### Toppnivåfiler

- [index.html](/Users/robin.reicher/Projects/fantasy-map/index.html): primär entrypoint för både play och editor (via `mode`-query)
- [editor/index.html](/Users/robin.reicher/Projects/fantasy-map/editor/index.html): kompatibilitetsentrypoint som redirectar till `/?mode=editor`
- [styles.css](/Users/robin.reicher/Projects/fantasy-map/styles.css): gemensam styling
- [src/config.js](/Users/robin.reicher/Projects/fantasy-map/src/config.js): standardvärden och centrala konstanter

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

1. [src/app.js](/Users/robin.reicher/Projects/fantasy-map/src/app.js)
2. [src/generator/worldGenerator.js](/Users/robin.reicher/Projects/fantasy-map/src/generator/worldGenerator.js)
3. [src/render/renderer.js](/Users/robin.reicher/Projects/fantasy-map/src/render/renderer.js)
4. [src/ui/playSession.js](/Users/robin.reicher/Projects/fantasy-map/src/ui/playSession.js)
5. [src/game/journeyScene.js](/Users/robin.reicher/Projects/fantasy-map/src/game/journeyScene.js)

Det ger en ganska bra bild av hela flödet från generering till rendering och spel.
