export function updateStats(
  statsContainer: HTMLElement | null,
  stats: unknown,
): void {
  if (!statsContainer || !stats || typeof stats !== "object") {
    return;
  }
  statsContainer.innerHTML = Object.entries(stats as Record<string, unknown>)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}
