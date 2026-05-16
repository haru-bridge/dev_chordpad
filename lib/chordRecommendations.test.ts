import { describe, expect, it } from "vitest";
import {
  analyzeChordInKey,
  recommendBetweenChords,
  recommendColorOptions,
  recommendExtensions,
  recommendNextChord,
  recommendSubstitutions,
  type ChordSuggestion,
} from "./chordRecommendations";
import {
  filterProgressionPresets,
  progressionPresetToChords,
  STARTER_PRESETS,
} from "./progressionPresets";

function symbolsOf(suggestions: ChordSuggestion[]) {
  return suggestions.map((suggestion) => suggestion.symbol);
}

function romansOf(suggestions: ChordSuggestion[]) {
  return suggestions.map((suggestion) => suggestion.roman);
}

describe("chord recommendation engine", () => {
  it("recommends common major-key next chords from I", () => {
    const suggestions = recommendNextChord({
      chords: ["C"],
      key: "C",
      mode: "major",
    });

    expect(symbolsOf(suggestions)).toEqual(
      expect.arrayContaining(["F", "Dm7", "G", "Am", "Em"])
    );
    expect(romansOf(suggestions)).toContain("V/ii");
  });

  it("recommends common minor-key next chords from i", () => {
    const suggestions = recommendNextChord({
      chords: ["Am"],
      key: "A",
      mode: "minor",
    });

    expect(symbolsOf(suggestions)).toEqual(
      expect.arrayContaining(["F", "Dm", "E7", "C", "G"])
    );
  });

  it("uses the same roman rules in multiple major keys", () => {
    const inD = symbolsOf(
      recommendNextChord({ chords: ["D"], key: "D", mode: "major" })
    );
    const inE = symbolsOf(
      recommendNextChord({ chords: ["E"], key: "E", mode: "major" })
    );

    expect(inD).toEqual(expect.arrayContaining(["G", "Em7", "A", "Bm", "F#m"]));
    expect(inE).toEqual(
      expect.arrayContaining(["A", "F#m7", "B", "C#m", "G#m"])
    );
    expect(inD).not.toEqual(expect.arrayContaining(["F", "Dm7"]));
  });

  it("uses minor roman rules outside C/A examples", () => {
    const suggestions = recommendNextChord({
      chords: ["F#m"],
      key: "F#",
      mode: "minor",
    });

    expect(symbolsOf(suggestions)).toEqual(
      expect.arrayContaining(["D", "Bm", "C#7", "A", "E"])
    );
  });

  it("keeps display key separate from the source chord text key", () => {
    const suggestions = recommendNextChord({
      chords: ["C"],
      key: "C",
      mode: "major",
      outputKey: "D",
    });
    const iv = suggestions.find((suggestion) => suggestion.roman === "IV");

    expect(iv?.symbol).toBe("G");
    expect(iv?.sourceSymbol).toBe("F");
  });

  it("generates secondary dominants for target chords", () => {
    const suggestions = recommendBetweenChords({
      leftChord: "C",
      rightChord: "Am",
      key: "C",
      mode: "major",
    });

    expect(romansOf(suggestions)).toContain("V/vi");
    expect(symbolsOf(suggestions)).toEqual(expect.arrayContaining(["E7", "Em"]));
  });

  it("scores between-chord suggestions against both neighbors", () => {
    const suggestions = recommendBetweenChords({
      leftChord: "Dm7",
      rightChord: "C",
      key: "C",
      mode: "major",
    });

    expect(suggestions[0]?.symbol).toBe("G7");
    expect(suggestions[0]?.roman).toBe("V7");
  });

  it("suggests borrowed iv between IV and I in major", () => {
    const suggestions = recommendBetweenChords({
      leftChord: "F",
      rightChord: "C",
      key: "C",
      mode: "major",
    });

    expect(symbolsOf(suggestions)).toContain("Fm");
    expect(romansOf(suggestions)).toContain("iv");
  });

  it("analyzes secondary dominants without hardcoded concrete roots", () => {
    expect(
      analyzeChordInKey({ chord: "A7", key: "C", mode: "major" }).roman
    ).toBe("V/ii");
    expect(
      analyzeChordInKey({ chord: "C#7", key: "E", mode: "major" }).roman
    ).toBe("V/ii");
  });

  it("does not crash on ambiguous or mixed modal progressions", () => {
    const mixed = "Cm Bb Ab G Cadd9 Dm7 Bb G7 Cmaj7 G Am G Cmaj7 Am E7 Em7"
      .split(/\s+/)
      .filter(Boolean);
    const suggestions = recommendNextChord({
      chords: mixed,
      key: "C",
      mode: "major",
      maxSuggestions: 6,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.symbol).toEqual(expect.any(String));
      expect(suggestion.roman).toEqual(expect.any(String));
      expect(suggestion.function).toEqual(expect.any(String));
      expect(suggestion.action).toEqual(expect.any(String));
      expect(suggestion.category).toEqual(expect.any(String));
      expect(suggestion.score).toEqual(expect.any(Number));
      expect(suggestion.confidence).toEqual(expect.any(Number));
      expect(suggestion.label).toEqual(expect.any(String));
      expect(suggestion.reason).toEqual(expect.any(String));
    }
  });

  it("returns bounded suggestions with the public display fields", () => {
    const suggestions = recommendNextChord({
      chords: ["C"],
      key: "C",
      mode: "major",
      maxSuggestions: 4,
    });

    expect(suggestions).toHaveLength(4);
    for (const suggestion of suggestions) {
      expect(suggestion.symbol).toEqual(expect.any(String));
      expect(suggestion.sourceSymbol).toEqual(expect.any(String));
      expect(suggestion.roman).toEqual(expect.any(String));
      expect(suggestion.function).toEqual(expect.any(String));
      expect(suggestion.action).toBe("append");
      expect(suggestion.category).toEqual(expect.any(String));
      expect(suggestion.score).toEqual(expect.any(Number));
      expect(suggestion.confidence).toEqual(expect.any(Number));
      expect(suggestion.label).toEqual(expect.any(String));
      expect(suggestion.reason).toEqual(expect.any(String));
    }
  });

  it("filters effectively duplicate bridge suggestions", () => {
    const suggestions = recommendBetweenChords({
      leftChord: "G7",
      rightChord: "Am7",
      key: "C",
      mode: "major",
      maxSuggestions: 6,
    });

    expect(symbolsOf(suggestions)).not.toContain("G7");
    expect(symbolsOf(suggestions)).not.toContain("Am");
    expect(symbolsOf(suggestions)).not.toContain("Am7");
    expect(romansOf(suggestions)).toContain("V/vi");
  });

  it("recommends substitutions without creating hidden state", () => {
    const suggestions = recommendSubstitutions({
      chord: "C",
      key: "C",
      mode: "major",
    });

    expect(symbolsOf(suggestions)).toEqual(
      expect.arrayContaining(["Cmaj7", "Am", "Em"])
    );
    expect(suggestions.every((suggestion) => suggestion.action === "replace")).toBe(
      true
    );
  });

  it("recommends short extensions and turnaround continuations", () => {
    const suggestions = recommendExtensions({
      chords: ["Dm7", "G7"],
      key: "C",
      mode: "major",
    });

    expect(suggestions[0]?.sourceSymbol).toBe("Cmaj7");
    expect(suggestions[0]?.action).toBe("extend");
    expect(suggestions.length).toBeLessThanOrEqual(4);
  });

  it("recommends color options without crashing", () => {
    const suggestions = recommendColorOptions({
      chords: ["F", "C"],
      selectedGap: { leftIndex: 0, rightIndex: 1 },
      key: "C",
      mode: "major",
    });

    expect(symbolsOf(suggestions)).toContain("Fm");
    expect(suggestions.every((suggestion) => suggestion.action === "color")).toBe(
      true
    );
  });
});

describe("roman progression presets", () => {
  it("keeps a balanced data-driven starter library", () => {
    expect(STARTER_PRESETS.length).toBeGreaterThanOrEqual(40);
    expect(STARTER_PRESETS.length).toBeLessThanOrEqual(60);
    for (const preset of STARTER_PRESETS) {
      expect(preset.roman.length).toBeGreaterThan(0);
      expect(preset.genres.length).toBeGreaterThan(0);
      expect(preset.moods.length).toBeGreaterThan(0);
    }
  });

  it("converts roman presets in multiple keys", () => {
    const royalRoad = STARTER_PRESETS.find((preset) => preset.id === "royal-road");
    expect(royalRoad).toBeTruthy();

    expect(
      progressionPresetToChords(royalRoad!, { key: "D", mode: "major" })
    ).toEqual(["G", "A", "F#m", "Bm"]);
    expect(
      progressionPresetToChords(royalRoad!, { key: "E", mode: "major" })
    ).toEqual(["A", "B", "G#m", "C#m"]);
  });

  it("filters presets by genre, mood, complexity, and search", () => {
    const results = filterProgressionPresets(STARTER_PRESETS, {
      genre: "Anime",
      mood: "Emotional",
      complexity: "2",
      search: "royal",
    });

    expect(results.map((preset) => preset.id)).toEqual(["royal-road"]);
  });
});
