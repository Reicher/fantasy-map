export function buildFeatureCatalog(world) {
  const pointsOfInterest = world.cities.map((city) =>
    toPointFeature({
      ...city,
      kind: "city",
      marker: "dot"
    })
  );
  const cities = pointsOfInterest;
  const lakes = world.hydrology.lakes.map((lake) => toAreaFeature(lake));
  const rivers = world.hydrology.rivers.map((river) => toLinearFeature(river));
  const biomeRegions = world.regions.biomeRegions.map((region) => toAreaFeature(region));
  const mountainRegions = world.regions.mountainRegions.map((region) => toAreaFeature(region));
  const roads = world.roads.roads.map((road) => toLinearFeature(road));

  return {
    pointsOfInterest,
    cities,
    lakes,
    rivers,
    biomeRegions,
    mountainRegions,
    roads,
    indices: {
      lakeIdByCell: world.hydrology.lakeIdByCell,
      biomeRegionId: world.regions.biomeRegionId,
      mountainRegionId: world.regions.mountainRegionId
    }
  };
}

function toPointFeature(feature) {
  return {
    ...feature
  };
}

function toAreaFeature(feature) {
  return {
    ...feature
  };
}

function toLinearFeature(feature) {
  return {
    ...feature
  };
}
