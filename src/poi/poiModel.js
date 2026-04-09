export const POI_MARKERS = ["settlement", "crash-site", "signpost"];

export function normalizePoiMarker(marker) {
  return POI_MARKERS.includes(marker) ? marker : "settlement";
}

export function pickPoiMarker(rng, context = {}) {
  const roadDegree = Math.max(0, Number(context.roadDegree ?? 0));
  const maxRoadDegree = Math.max(1, Number(context.maxRoadDegree ?? 1));
  const allowSignpost = context.allowSignpost ?? true;
  const isEndpoint = context.isEndpoint ?? roadDegree <= 1;
  if (isEndpoint) {
    return "settlement";
  }

  const hubness = clamp01(roadDegree / maxRoadDegree);
  const settlementSuitability = clamp01(
    Number(context.settlementSuitability ?? 0.5),
  );
  const crashSuitability = clamp01(Number(context.crashSuitability ?? 0.4));
  const signpostSuitability = clamp01(
    Number(context.signpostSuitability ?? hubness),
  );
  const transitScore = clamp01(Number(context.transitScore ?? 0));
  const corridorScore = clamp01(Number(context.corridorScore ?? 0));
  const preference = context.preferenceWeights ?? {};
  const settlementPref = normalizePreferenceWeight(preference.settlement);
  const crashPref = normalizePreferenceWeight(preference["crash-site"]);
  const signpostPref = normalizePreferenceWeight(preference.signpost);

  const settlementWeight =
    (0.65 +
      settlementSuitability * 1.55 +
      (1 - crashSuitability) * 0.26 +
      (1 - hubness) * 0.14) *
    settlementPref;

  const crashWeight =
    (0.24 +
      crashSuitability * 1.45 +
      transitScore * 0.26 +
      corridorScore * 0.38 +
      (1 - settlementSuitability) * 0.24 +
      (1 - signpostSuitability) * 0.06) *
    crashPref *
    getCrashDegreeFactor(roadDegree);

  const signpostDegreeGate = getSignpostDegreeGate(
    roadDegree,
    signpostSuitability,
    transitScore,
  );
  const signpostWeight =
    !allowSignpost || signpostSuitability <= 0
      ? 0
      : (0.18 +
          signpostSuitability * 1.7 +
          transitScore * 0.35 +
          hubness * 0.58 -
          (1 - settlementSuitability) * 0.08) *
        signpostPref *
        signpostDegreeGate;

  const markerWeights = {
    settlement: Math.max(0, settlementWeight),
    "crash-site": Math.max(0, crashWeight),
    signpost: Math.max(0, signpostWeight),
  };
  const total =
    markerWeights.settlement +
    markerWeights["crash-site"] +
    markerWeights.signpost;
  if (total <= 0.0001) {
    return "settlement";
  }

  return rng.weighted(POI_MARKERS, (marker) => markerWeights[marker] ?? 0);
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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizePreferenceWeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(0, numeric);
}

function getSignpostDegreeGate(roadDegree, signpostSuitability, transitScore) {
  if (roadDegree >= 3) {
    return 1;
  }
  if (roadDegree === 2) {
    return signpostSuitability >= 0.82 || transitScore >= 0.76 ? 0.16 : 0.03;
  }
  return 0;
}

function getCrashDegreeFactor(roadDegree) {
  if (roadDegree === 2) {
    return 1.58;
  }
  if (roadDegree === 3) {
    return 1.04;
  }
  if (roadDegree >= 4) {
    return 0.7;
  }
  return 0.86;
}
