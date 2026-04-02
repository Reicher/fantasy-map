export function updateStats(statsContainer, stats) {
  statsContainer.innerHTML = Object.entries(stats)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}
