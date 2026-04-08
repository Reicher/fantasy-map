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
  const lines = [];
  lines.push(`<strong>${hit.title ?? "Okand plats"}</strong>`);
  if (hit.subtitle) {
    lines.push(`<span>${hit.subtitle}</span>`);
  }
  if (hit.detail) {
    lines.push(`<span>${hit.detail}</span>`);
  }
  return lines.join("");
}
