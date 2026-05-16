import { describe, expect, it } from "vitest";
import { pcToSemitone } from "./musicNote";
import { buildPadVoicing, signedSemitoneDiff } from "./voicing";

const KEY_ROOTS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

function pitchClasses(midis: number[]) {
  return new Set(midis.map((midi) => ((midi % 12) + 12) % 12));
}

function shiftedPc(root: string, shift: number, interval = 0) {
  return (pcToSemitone(root) + shift + interval + 24) % 12;
}

function expectContainsPcs(midis: number[], pcs: number[]) {
  const actual = pitchClasses(midis);
  for (const pc of pcs) {
    expect(actual.has(pc)).toBe(true);
  }
}

describe("pad voicing MIDI pitch classes", () => {
  it("keeps major-seventh chord tones correct across all source and playback keys", () => {
    for (const sourceKey of KEY_ROOTS) {
      for (const playKey of KEY_ROOTS) {
        const shift = signedSemitoneDiff(sourceKey, playKey);
        const voicing = buildPadVoicing(
          `${sourceKey}maj7`,
          5,
          "AUTO_VOICE_BASS",
          shift
        );

        expect(voicing).not.toBeNull();
        expectContainsPcs(voicing!.midis, [
          shiftedPc(sourceKey, shift, 0),
          shiftedPc(sourceKey, shift, 4),
          shiftedPc(sourceKey, shift, 11),
        ]);
      }
    }
  });

  it("keeps minor-triad chord tones correct across all source and playback keys", () => {
    for (const sourceKey of KEY_ROOTS) {
      for (const playKey of KEY_ROOTS) {
        const shift = signedSemitoneDiff(sourceKey, playKey);
        const voicing = buildPadVoicing(
          `${sourceKey}m`,
          5,
          "AUTO_VOICE_BASS",
          shift
        );

        expect(voicing).not.toBeNull();
        expectContainsPcs(voicing!.midis, [
          shiftedPc(sourceKey, shift, 0),
          shiftedPc(sourceKey, shift, 3),
          shiftedPc(sourceKey, shift, 7),
        ]);
      }
    }
  });

  it("keeps dominant-seventh guide tones correct across all source and playback keys", () => {
    for (const sourceKey of KEY_ROOTS) {
      for (const playKey of KEY_ROOTS) {
        const shift = signedSemitoneDiff(sourceKey, playKey);
        const voicing = buildPadVoicing(
          `${sourceKey}7`,
          5,
          "AUTO_VOICE_BASS",
          shift
        );

        expect(voicing).not.toBeNull();
        expectContainsPcs(voicing!.midis, [
          shiftedPc(sourceKey, shift, 0),
          shiftedPc(sourceKey, shift, 4),
          shiftedPc(sourceKey, shift, 10),
        ]);
      }
    }
  });

  it("keeps slash bass pitch class correct after transposition", () => {
    const shift = signedSemitoneDiff("C", "D");
    const voicing = buildPadVoicing("C/E", 5, "AUTO_VOICE_BASS", shift);

    expect(voicing).not.toBeNull();
    expect(((Math.min(...voicing!.midis) % 12) + 12) % 12).toBe(
      pcToSemitone("F#")
    );
  });

  it("parses unicode accidentals before MIDI placement", () => {
    const voicing = buildPadVoicing("B♭m7", 5, "AUTO_VOICE_BASS", 0);

    expect(voicing).not.toBeNull();
    expectContainsPcs(voicing!.midis, [
      pcToSemitone("Bb"),
      pcToSemitone("Db"),
      pcToSemitone("Ab"),
    ]);
  });
});
