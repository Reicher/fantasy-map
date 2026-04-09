export const POI_MARKERS = ["settlement", "crash-site", "signpost"];

export function normalizePoiMarker(marker) {
  return POI_MARKERS.includes(marker) ? marker : "settlement";
}

export function describePoi(poi = {}) {
  const marker = normalizePoiMarker(poi.marker);
  const roadDegree = Math.max(0, Number(poi.roadDegree ?? 0));

  switch (marker) {
    case "signpost":
      return {
        marker,
        kind: "signpost",
        subtitle: "Vägvisare",
        detail:
          roadDegree >= 3
            ? "Stark knutpunkt mellan flera vägar"
            : "Visar riktning mellan närliggande platser",
      };
    case "crash-site":
      return {
        marker,
        kind: "crash-site",
        subtitle: "Kraschplats",
        detail: "Övergivet läger eller trasigt fordon med kvarlämnade resurser",
      };
    case "settlement":
    default:
      return {
        marker: "settlement",
        kind: "settlement",
        subtitle: "Bosättning",
        detail: "Liten nybyggarplats med 1-3 invånare",
      };
  }
}

export function getPoiTitle(poi = {}) {
  const name = String(poi.name ?? "").trim();
  if (name) {
    return name;
  }
  return describePoi(poi).subtitle;
}
