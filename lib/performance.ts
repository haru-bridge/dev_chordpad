export type StrumDirection = "up" | "down" | "random";
export type PlayMode = "chord" | "arp";
export type ArpPattern = "up" | "down" | "random" | "1357";

export type PerformanceSettings = {
  // chord: total strum span (ms)
  strumMs: number; // 0..240 etc

  // chord only
  direction: StrumDirection;

  // mode
  playMode: PlayMode;

  // arp only
  arpPattern: ArpPattern;
  arpStepMs: number;
  arpGate: number; // 0.1..1.0

  // humanize
  timingJitterMs: number; // 0..20
  velocityHumanize: number; // 0..0.30 (±30%)

  // dynamics
  baseVelocity: number; // 0.1..1.0
  topBoost: number; // 0..0.6
};

export type NoteEvent = {
  note: string;
  midi: number;
  isTop: boolean;
  delayMs: number;
  velocity: number;

  // for one-shot (arp is typically shorter)
  durSec: number;
};

type Item = { note: string; midi: number; isTop: boolean; idx: number };

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function clamp01(x: number) {
  return clamp(x, 0, 1);
}

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function orderForChord(items: Item[], dir: StrumDirection) {
  const ordered = [...items].sort((a, b) => a.midi - b.midi);
  if (dir === "down") return [...ordered].reverse();
  if (dir === "random") return shuffleInPlace([...ordered]);
  return ordered; // up
}

function orderForArp(items: Item[], pat: ArpPattern) {
  // "1357" respects input order (voicing builder defines the intended order)
  if (pat === "1357") return [...items];

  const ordered = [...items].sort((a, b) => a.midi - b.midi);
  if (pat === "down") return [...ordered].reverse();
  if (pat === "random") return shuffleInPlace([...ordered]);
  return ordered; // up
}

type NormalizedPerf = {
  strumMs: number;
  direction: StrumDirection;
  playMode: PlayMode;
  arpPattern: ArpPattern;
  arpStepMs: number;
  arpGate: number;
  timingJitterMs: number;
  velocityHumanize: number;
  baseVelocity: number;
  topBoost: number;
};

function normalizePerf(perf: PerformanceSettings): NormalizedPerf {
  // Make runtime robust even if UI or callers feed slightly out-of-range values
  return {
    strumMs: Math.max(0, Number.isFinite(perf.strumMs) ? perf.strumMs : 0),
    direction: (perf.direction ?? "up") as StrumDirection,
    playMode: (perf.playMode ?? "chord") as PlayMode,
    arpPattern: (perf.arpPattern ?? "up") as ArpPattern,
    arpStepMs: Math.max(
      10,
      Number.isFinite(perf.arpStepMs) ? perf.arpStepMs : 90
    ),
    arpGate: clamp(
      Number.isFinite(perf.arpGate) ? perf.arpGate : 0.85,
      0.1,
      1.0
    ),
    timingJitterMs: Math.max(
      0,
      Number.isFinite(perf.timingJitterMs) ? perf.timingJitterMs : 0
    ),
    velocityHumanize: Math.max(
      0,
      Number.isFinite(perf.velocityHumanize) ? perf.velocityHumanize : 0
    ),
    baseVelocity: clamp(
      Number.isFinite(perf.baseVelocity) ? perf.baseVelocity : 0.8,
      0.05,
      1.0
    ),
    topBoost: clamp(Number.isFinite(perf.topBoost) ? perf.topBoost : 0, 0, 1.0),
  };
}

/**
 * Build per-note play events from (notes, midis) + performance params.
 *
 * - chord:
 *   - distribute delays over [0..strumMs] based on direction
 *   - durSec = oneShotDurSec for all notes
 * - arp:
 *   - delay = idx * strumMs (step) based on arpPattern
 *   - durSec auto-shrinks relative to step (but bounded)
 *
 * Humanize:
 * - timing jitter (ms) applied per note (clamped to >=0)
 * - velocity randomization applied per note
 *
 * Top boost:
 * - applied only to the highest midi note
 */
export function buildNoteEvents(
  notes: string[],
  midis: number[],
  perf: PerformanceSettings,
  oneShotDurSec = 0.85
): NoteEvent[] {
  if (!notes.length || notes.length !== midis.length) return [];

  const p = normalizePerf(perf);
  const oneShot = clamp(oneShotDurSec, 0.05, 10);

  const topMidi = Math.max(...midis);
  const items: Item[] = notes.map((note, i) => ({
    note,
    midi: midis[i],
    isTop: midis[i] === topMidi,
    idx: i,
  }));

  const playOrder =
    p.playMode === "arp"
      ? orderForArp(items, p.arpPattern)
      : orderForChord(items, p.direction);

  const n = playOrder.length;

  // Delay schedule
  const delays: number[] = [];
  if (p.playMode === "arp") {
    const step = p.arpStepMs; // ms
    for (let i = 0; i < n; i++) delays.push(i * step);
  } else {
    const total = p.strumMs; // ms
    const step = n <= 1 ? 0 : total / (n - 1);
    for (let i = 0; i < n; i++) delays.push(i * step);
  }

  // Arp duration heuristic: shorter than chord, derived from step with bounds.
  // - lower bound avoids inaudible blips
  // - upper bound never exceeds one-shot dur
  const arpStepSec = p.playMode === "arp" ? p.arpStepMs / 1000 : 0;
  const arpDurSec = Math.min(
    oneShot,
    Math.max(0.05, arpStepSec * p.arpGate)
  );

  return playOrder.map((it, idx) => {
    // timing
    let d = delays[idx] ?? 0;
    if (p.timingJitterMs > 0) {
      d += randBetween(-p.timingJitterMs, p.timingJitterMs);
    }
    d = Math.max(0, d);

    // velocity
    let v = p.baseVelocity;
    if (p.velocityHumanize > 0) {
      v *= 1 + randBetween(-p.velocityHumanize, p.velocityHumanize);
    }
    if (it.isTop && p.topBoost > 0) {
      v *= 1 + p.topBoost;
    }

    return {
      note: it.note,
      midi: it.midi,
      isTop: it.isTop,
      delayMs: d,
      velocity: clamp01(v),
      durSec: p.playMode === "arp" ? arpDurSec : oneShot,
    };
  });
}






