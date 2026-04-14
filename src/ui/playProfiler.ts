interface DurationSample {
  total: number;
  count: number;
  max: number;
}

interface PlayProfiler {
  isEnabled: () => boolean;
  toggle: () => boolean;
  measure: <T>(label: string, fn: () => T) => T;
  count: (label: string, value?: number) => void;
  setSnapshot: (snapshot: Record<string, unknown>) => void;
  frame: (timestamp: number) => void;
}

export function createPlayProfiler(): PlayProfiler {
  const state: {
    enabled: boolean;
    lastReportAt: number;
    durations: Map<string, DurationSample>;
    counters: Map<string, number>;
    snapshot: Record<string, unknown>;
  } = {
    enabled: false,
    lastReportAt: 0,
    durations: new Map<string, DurationSample>(),
    counters: new Map<string, number>(),
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

  function isEnabled(): boolean {
    return state.enabled;
  }

  function toggle(): boolean {
    state.enabled = !state.enabled;
    resetWindow();
    return state.enabled;
  }

  function measure<T>(label: string, fn: () => T): T {
    if (!state.enabled) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    recordDuration(label, performance.now() - start);
    return result;
  }

  function count(label: string, value = 1): void {
    if (!state.enabled) {
      return;
    }

    state.counters.set(label, (state.counters.get(label) ?? 0) + value);
  }

  function setSnapshot(snapshot: Record<string, unknown>): void {
    if (!state.enabled) {
      return;
    }

    state.snapshot = {
      ...state.snapshot,
      ...snapshot,
    };
  }

  function frame(timestamp: number): void {
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

    const report: Record<string, unknown> = {};
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

  function recordDuration(label: string, duration: number): void {
    const sample = state.durations.get(label) ?? { total: 0, count: 0, max: 0 };
    sample.total += duration;
    sample.count += 1;
    sample.max = Math.max(sample.max, duration);
    state.durations.set(label, sample);
  }

  function resetWindow(timestamp = 0): void {
    state.lastReportAt = timestamp;
    state.durations.clear();
    state.counters.clear();
    state.snapshot = {};
  }
}
