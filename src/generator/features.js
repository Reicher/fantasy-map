export function buildFeatureCatalog(world) {
  const pointsOfInterest = world.cities.map((city) => ({
    ...city,
    kind: "city",
    marker: "dot"
  }));

  return {
    pointsOfInterest,
    cities: pointsOfInterest,
    lakes: world.hydrology.lakes.map((lake) => ({ ...lake })),
    rivers: world.hydrology.rivers.map((river) => ({ ...river })),
    biomeRegions: world.regions.biomeRegions.map((region) => ({ ...region })),
    mountainRegions: world.regions.mountainRegions.map((region) => ({ ...region })),
    roads: world.roads.roads.map((road) => ({ ...road })),
    indices: {
      lakeIdByCell: world.hydrology.lakeIdByCell,
      biomeRegionId: world.regions.biomeRegionId,
      mountainRegionId: world.regions.mountainRegionId
    }
  };
}
