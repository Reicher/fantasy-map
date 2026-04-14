const NODE_MARKERS = ["settlement", "signpost", "abandoned"] as const;

export type NodeMarker = (typeof NODE_MARKERS)[number];

export interface NodeLike {
  marker?: unknown;
  roadDegree?: unknown;
  name?: unknown;
}

export interface NodeDescriptor {
  marker: NodeMarker;
  kind: "settlement" | "signpost" | "abandoned";
  subtitle: string;
  detail: string;
}

export function normalizeNodeMarker(marker: unknown): NodeMarker {
  return isNodeMarker(marker) ? marker : "settlement";
}

function isNodeMarker(marker: unknown): marker is NodeMarker {
  return NODE_MARKERS.includes(marker as NodeMarker);
}

export function describeNode(node: NodeLike = {}): NodeDescriptor {
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

export function getNodeTitle(node: NodeLike = {}): string {
  const name = String(node.name ?? "").trim();
  if (name) {
    return name;
  }
  return describeNode(node).subtitle;
}
