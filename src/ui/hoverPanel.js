export function clearHover(tooltip) {
  tooltip.hidden = true;
}

export function showHoverHit(hit, tooltip, clientX, clientY) {
  tooltip.hidden = false;
  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${clientY}px`;
  tooltip.innerHTML = renderHoverHtml(hit);
}

function renderHoverHtml(hit) {
  return `${[
    `<strong>${hit.title}</strong>`,
    `<span>${hit.subtitle}</span>`,
    hit.detail ? `<span>${hit.detail}</span>` : ""
  ].join("")}`;
}
