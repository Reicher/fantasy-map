export function buildWorldStats(world) {
  const landTiles = world.terrain.isLand.reduce((sum, value) => sum + value, 0);
  const totalTiles = world.terrain.size;

  return {
    "Landandel": `${Math.round((landTiles / totalTiles) * 100)}%`,
    "Noder": String(world.features.nodes.length),
    "Vägar": String(world.features.roads.length),
    "Floder": String(world.features.rivers.length),
    "Sjöar": String(world.features.lakes.length),
    "Bergsområden": String(world.features.mountainRegions.length),
    "Biomregioner": String(world.features.biomeRegions.length)
  };
}
