export type ChordCandidate = {
  symbol: string;
  tag: "triad" | "7th" | "sus" | "color" | "alt";
};

const SHARP_TO_FLAT: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
  // レア系も一応
  "B#": "C",
  "E#": "F",
};

const FLAT_NORMALIZE: Record<string, string> = {
  "Cb": "B",
  "Fb": "E",
};

export function toPitchClass(noteOrPc: string) {
  // "C#4" -> "C#"
  const s = noteOrPc.trim().replace(/[0-9]/g, "");
  const head = s.charAt(0).toUpperCase();
  const tail = s.slice(1);
  return head + tail;
}

export function toFlatPc(noteOrPc: string) {
  const pc = toPitchClass(noteOrPc);
  if (FLAT_NORMALIZE[pc]) return FLAT_NORMALIZE[pc];
  if (SHARP_TO_FLAT[pc]) return SHARP_TO_FLAT[pc];
  return pc;
}

export function suggestChordsFromPc(rootPc: string): ChordCandidate[] {
  const r = rootPc;

  // 単音から「確定」はできないので、頻出・使い分けしやすい順に固定で出す
  const list: ChordCandidate[] = [
    { symbol: `${r}`, tag: "triad" },      // major triad
    { symbol: `${r}m`, tag: "triad" },
    { symbol: `${r}7`, tag: "7th" },
    { symbol: `${r}maj7`, tag: "7th" },
    { symbol: `${r}m7`, tag: "7th" },
    { symbol: `${r}sus4`, tag: "sus" },
    { symbol: `${r}sus2`, tag: "sus" },
    { symbol: `${r}dim`, tag: "alt" },
    { symbol: `${r}m7b5`, tag: "alt" },
    { symbol: `${r}aug`, tag: "alt" },
    { symbol: `${r}add9`, tag: "color" },
  ];

  // 重複排除（念のため）
  const seen = new Set<string>();
  return list.filter((x) => {
    if (seen.has(x.symbol)) return false;
    seen.add(x.symbol);
    return true;
  });
}
