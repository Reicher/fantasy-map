export const NODE_MARKERS = ["settlement", "signpost", "abandoned"];

export function normalizeNodeMarker(marker) {
  return NODE_MARKERS.includes(marker) ? marker : "settlement";
}

export function describeNode(node = {}) {
  const marker = normalizeNodeMarker(node.marker);
  const roadDegree = Math.max(0, Number(node.roadDegree ?? 0));

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
    case "abandoned":
      return {
        marker,
        kind: "abandoned",
        subtitle: "Övergiven plats",
        detail:
          "Övergiven lägerplats eller trasigt fordon med kvarlämnade resurser",
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

export function getNodeTitle(node = {}) {
  const name = String(node.name ?? "").trim();
  if (name) {
    return name;
  }
  return describeNode(node).subtitle;
}
