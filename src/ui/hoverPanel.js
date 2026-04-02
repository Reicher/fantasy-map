export function clearHover(tooltip) {
  tooltip.hidden = true;
}

export function showHoverHit(hit, tooltip, canvasX, canvasY) {
  tooltip.hidden = false;
  tooltip.style.left = `${canvasX}px`;
  tooltip.style.top = `${canvasY}px`;
  tooltip.innerHTML = renderHoverHtml(hit);
}

function renderHoverHtml(hit) {
  return `${[
    `<strong>${hit.title}</strong>`,
    `<span>${hit.subtitle}</span>`,
    hit.detail ? `<span>${hit.detail}</span>` : ""
  ].join("")}`;
}
