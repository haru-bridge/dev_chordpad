const LETTER_BASE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export function normalizePc(pc: string): string {
  const s = pc.trim().replace(/♭/g, "b").replace(/♯/g, "#");
  const head = s.charAt(0).toUpperCase();
  const tail = s.slice(1);
  return head + tail;
}

export function pcToSemitone(pc: string): number {
  const s = normalizePc(pc);
  const letter = s.charAt(0);
  const base = LETTER_BASE[letter] ?? 0;
  const acc = s.slice(1);
  let delta = 0;

  for (const ch of acc) {
    if (ch === "#") delta += 1;
    if (ch === "b") delta -= 1;
  }

  const v = (base + delta) % 12;
  return v < 0 ? v + 12 : v;
}

export function midiFromPc(pc: string, octave: number): number {
  return (octave + 1) * 12 + pcToSemitone(pc);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NAMES[pc]}${octave}`;
}
