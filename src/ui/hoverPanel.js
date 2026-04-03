export function clearHover(tooltip) {
  if (!tooltip) {
    return;
  }
  tooltip.hidden = true;
}

export function showHoverHit(hit, tooltip, clientX, clientY) {
  showHoverContent(tooltip, renderHoverHtml(hit), clientX, clientY);
}

export function showHoverContent(tooltip, html, clientX, clientY) {
  if (!tooltip) {
    return;
  }
  tooltip.hidden = false;
  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${clientY}px`;
  tooltip.innerHTML = html;
}

function renderHoverHtml(hit) {
  return `${[
    `<strong>${hit.title}</strong>`,
    `<span>${hit.subtitle}</span>`,
    hit.detail ? `<span>${hit.detail}</span>` : ""
  ].join("")}`;
}
