import { describe, expect, it } from "vitest";
import { buildNoteEvents, type PerformanceSettings } from "./performance";

const basePerf: PerformanceSettings = {
  playMode: "chord",
  strumMs: 0,
  direction: "up",
  arpPattern: "up",
  arpStepMs: 90,
  arpGate: 0.85,
  timingJitterMs: 0,
  velocityHumanize: 0,
  baseVelocity: 0.8,
  topBoost: 0,
};

describe("performance voice balance", () => {
  it("keeps inner voices softer than the top voice for chord playback", () => {
    const events = buildNoteEvents(
      ["C3", "E4", "G4", "B4"],
      [48, 64, 67, 71],
      basePerf
    );
    const byMidi = new Map(events.map((event) => [event.midi, event.velocity]));

    expect(byMidi.get(48)).toBeLessThan(byMidi.get(71)!);
    expect(byMidi.get(64)).toBeLessThan(byMidi.get(71)!);
    expect(byMidi.get(67)).toBeLessThan(byMidi.get(71)!);
  });

  it("leaves arp velocities unbalanced by voice rank", () => {
    const events = buildNoteEvents(
      ["C3", "E4", "G4", "B4"],
      [48, 64, 67, 71],
      { ...basePerf, playMode: "arp" }
    );

    expect(new Set(events.map((event) => event.velocity)).size).toBe(1);
  });
});
