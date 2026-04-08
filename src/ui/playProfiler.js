export function createPlayProfiler() {
  const state = {
    enabled: false,
    lastReportAt: 0,
    durations: new Map(),
    counters: new Map(),
    snapshot: {},
  };

  return {
    isEnabled,
    toggle,
    measure,
    count,
    setSnapshot,
    frame,
  };

  function isEnabled() {
    return state.enabled;
  }

  function toggle() {
    state.enabled = !state.enabled;
    resetWindow();
    return state.enabled;
  }

  function measure(label, fn) {
    if (!state.enabled) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    recordDuration(label, performance.now() - start);
    return result;
  }

  function count(label, value = 1) {
    if (!state.enabled) {
      return;
    }

    state.counters.set(label, (state.counters.get(label) ?? 0) + value);
  }

  function setSnapshot(snapshot) {
    if (!state.enabled) {
      return;
    }

    state.snapshot = {
      ...state.snapshot,
      ...snapshot,
    };
  }

  function frame(timestamp) {
    if (!state.enabled) {
      return;
    }

    count("frames");
    if (!state.lastReportAt) {
      state.lastReportAt = timestamp;
      return;
    }

    const elapsed = timestamp - state.lastReportAt;
    if (elapsed < 1000) {
      return;
    }

    const report = {};
    for (const [label, sample] of state.durations.entries()) {
      report[`${label} avg`] =
        `${(sample.total / Math.max(1, sample.count)).toFixed(2)}ms`;
      report[`${label} max`] = `${sample.max.toFixed(2)}ms`;
    }
    for (const [label, value] of state.counters.entries()) {
      report[label] = value;
    }
    for (const [label, value] of Object.entries(state.snapshot)) {
      report[label] = value;
    }

    console.groupCollapsed("[play-profiler]");
    console.table(report);
    console.groupEnd();
    resetWindow(timestamp);
  }

  function recordDuration(label, duration) {
    const sample = state.durations.get(label) ?? { total: 0, count: 0, max: 0 };
    sample.total += duration;
    sample.count += 1;
    sample.max = Math.max(sample.max, duration);
    state.durations.set(label, sample);
  }

  function resetWindow(timestamp = 0) {
    state.lastReportAt = timestamp;
    state.durations.clear();
    state.counters.clear();
    state.snapshot = {};
  }
}
