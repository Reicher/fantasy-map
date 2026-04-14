interface HoverHit {
  title?: string;
  subtitle?: string;
  detail?: string;
}

export function clearHover(tooltip: HTMLElement | null): void {
  if (!tooltip) {
    return;
  }
  tooltip.hidden = true;
}

export function showHoverHit(
  hit: HoverHit,
  tooltip: HTMLElement | null,
  clientX: number,
  clientY: number,
): void {
  showHoverContent(tooltip, renderHoverHtml(hit), clientX, clientY);
}

function showHoverContent(
  tooltip: HTMLElement | null,
  html: string,
  clientX: number,
  clientY: number,
): void {
  if (!tooltip) {
    return;
  }
  tooltip.hidden = false;
  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${clientY}px`;
  tooltip.innerHTML = html;
}

function renderHoverHtml(hit: HoverHit): string {
  const lines: string[] = [];
  lines.push(`<strong>${hit.title ?? "Okand plats"}</strong>`);
  if (hit.subtitle) {
    lines.push(`<span>${hit.subtitle}</span>`);
  }
  if (hit.detail) {
    lines.push(`<span>${hit.detail}</span>`);
  }
  return lines.join("");
}
