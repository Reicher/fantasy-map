export function createEditorCamera(world) {
  return {
    zoom: 1,
    centerX: world?.terrain.width * 0.5 ?? 150,
    centerY: world?.terrain.height * 0.5 ?? 110
  };
}

export function createPlayCamera(world, playState) {
  return {
    zoom: 1.5,
    centerX: playState?.position?.x ?? world?.playerStart?.x ?? world?.terrain.width * 0.5 ?? 150,
    centerY: playState?.position?.y ?? world?.playerStart?.y ?? world?.terrain.height * 0.5 ?? 110
  };
}

export function clampEditorCamera(world, camera) {
  if (!world) {
    return camera;
  }

  const zoom = clampNumber(camera.zoom, 1, 4.5);
  const visibleWidth = world.terrain.width / zoom;
  const visibleHeight = world.terrain.height / zoom;
  const oceanPadX = Math.max(12, visibleWidth * 0.24);
  const oceanPadY = Math.max(10, visibleHeight * 0.24);

  return {
    zoom,
    centerX: clampNumber(
      camera.centerX,
      visibleWidth * 0.5 - oceanPadX,
      world.terrain.width - visibleWidth * 0.5 + oceanPadX
    ),
    centerY: clampNumber(
      camera.centerY,
      visibleHeight * 0.5 - oceanPadY,
      world.terrain.height - visibleHeight * 0.5 + oceanPadY
    )
  };
}

export function zoomCameraAroundPoint(world, viewport, worldX, worldY, canvasX, canvasY, zoom) {
  const margin = viewport.margin;
  const innerWidth = viewport.innerWidth;
  const innerHeight = viewport.innerHeight;
  const scaleX = (innerWidth / world.terrain.width) * zoom;
  const scaleY = (innerHeight / world.terrain.height) * zoom;
  const visibleWidth = innerWidth / scaleX;
  const visibleHeight = innerHeight / scaleY;
  const leftWorld = worldX + 0.5 - (canvasX - margin) / scaleX;
  const topWorld = worldY + 0.5 - (canvasY - margin) / scaleY;

  return {
    zoom,
    centerX: leftWorld + visibleWidth * 0.5,
    centerY: topWorld + visibleHeight * 0.5
  };
}

export function isDefaultEditorCamera(world, camera) {
  const defaultCamera = createEditorCamera(world);
  return (
    Math.abs(camera.zoom - defaultCamera.zoom) < 0.001 &&
    Math.abs(camera.centerX - defaultCamera.centerX) < 0.01 &&
    Math.abs(camera.centerY - defaultCamera.centerY) < 0.01
  );
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
