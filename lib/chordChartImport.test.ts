import { describe, expect, it } from "vitest";
import {
  extractChordChart,
  extractOcrChordChart,
  extractChordSymbols,
  normalizeChordInputText,
  normalizeChordSymbol,
} from "./chordChartImport";

describe("chord chart import", () => {
  it("extracts chord lines from a Japanese chord chart without key metadata", () => {
    const input = `
イントロ Key G（カポなし）
Aメロ
00:13 いつか馴染みあるこの景色が
G D Em7 Bm7
00:18 還り変わるように
C C on D G
C | C on D | G | D on F#
Bメロ
Em7 Bm7 C G
`;

    expect(extractChordSymbols(input)).toEqual([
      "G",
      "D",
      "Em7",
      "Bm7",
      "C",
      "C/D",
      "G",
      "C",
      "C/D",
      "G",
      "D/F#",
      "Em7",
      "Bm7",
      "C",
      "G",
    ]);
  });

  it("normalizes common Japanese and jazz chord spellings", () => {
    expect(normalizeChordSymbol("Ｆ♯ｍ７")).toBe("F#m7");
    expect(normalizeChordSymbol("B♭maj7")).toBe("Bbmaj7");
    expect(normalizeChordSymbol("C△7")).toBe("Cmaj7");
    expect(normalizeChordSymbol("C-7")).toBe("Cm7");
    expect(normalizeChordSymbol("Dø7")).toBe("Dm7b5");
    expect(normalizeChordSymbol("N.C.")).toBeNull();
  });

  it("keeps direct typed on-notation cheap and pad-friendly", () => {
    expect(normalizeChordInputText("C on D, D on F# | G")).toBe(
      "C/D D/F# G"
    );
  });

  it("keeps bracketed inline chords but avoids single lyric letters", () => {
    expect(extractChordSymbols("00:13 G いつか馴染みある")).toEqual([]);
    expect(extractChordSymbols("いつか [G] から [D] へ")).toEqual(["G", "D"]);
  });

  it("can relax single-line OCR chord output after recognition", () => {
    const ocrText = `
G
D
EmT
BmI
C
C on D
G
`;

    expect(extractOcrChordChart(ocrText).chords).toEqual([
      "G",
      "D",
      "Em7",
      "Bm7",
      "C",
      "C/D",
      "G",
    ]);
  });

  it("returns editable text and respects max chord limits", () => {
    const result = extractChordChart("C Dm7 G7 Cmaj7 Am7 D7 G", {
      maxChords: 4,
    });

    expect(result.chords).toEqual(["C", "Dm7", "G7", "Cmaj7"]);
    expect(result.text).toBe("C Dm7 G7 Cmaj7");
  });
});
