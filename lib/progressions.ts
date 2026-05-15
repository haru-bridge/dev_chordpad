import { pcToSemitone } from "./musicNote";
import type { KeySig } from "./voicing";

export type ProgressionCategory =
  | "Pop"
  | "J-Pop"
  | "Rock"
  | "Blues"
  | "Jazz"
  | "R&B"
  | "Minor"
  | "Folk";

export type ProgressionMood =
  | "All"
  | "Bright"
  | "Emotional"
  | "Dark"
  | "Float"
  | "Push"
  | "Classic"
  | "Jazz"
  | "Blues";

export type ProgressionPreset = {
  id: string;
  category: ProgressionCategory;
  name: string;
  alias: string;
  formula: string[];
  feel: string;
};

export const PROGRESSION_PRESETS: ProgressionPreset[] = [
  {
    id: "axis",
    category: "Pop",
    name: "Axis",
    alias: "I-V-vi-IV",
    formula: ["I", "V", "vi", "IV"],
    feel: "anthem pop",
  },
  {
    id: "sensitive",
    category: "Pop",
    name: "Sensitive",
    alias: "vi-IV-I-V",
    formula: ["vi", "IV", "I", "V"],
    feel: "emotional loop",
  },
  {
    id: "doo-wop",
    category: "Pop",
    name: "Doo-wop",
    alias: "I-vi-IV-V",
    formula: ["I", "vi", "IV", "V"],
    feel: "classic 50s",
  },
  {
    id: "ice-cream",
    category: "Pop",
    name: "Ice Cream",
    alias: "I-vi-ii-V",
    formula: ["I", "vi", "ii", "V"],
    feel: "oldies turnaround",
  },
  {
    id: "pachelbel",
    category: "Pop",
    name: "Pachelbel",
    alias: "I-V-vi-iii-IV-I-IV-V",
    formula: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
    feel: "canon descent",
  },
  {
    id: "pop-punk",
    category: "Pop",
    name: "Pop Punk",
    alias: "I-V-vi-IV",
    formula: ["I", "V", "vi", "IV"],
    feel: "driving chorus",
  },
  {
    id: "let-it-be",
    category: "Pop",
    name: "Let It Be",
    alias: "I-V-vi-IV",
    formula: ["I", "V", "vi", "IV"],
    feel: "singalong",
  },
  {
    id: "plagal-pop",
    category: "Pop",
    name: "Plagal Pop",
    alias: "I-IV-I-V",
    formula: ["I", "IV", "I", "V"],
    feel: "open major",
  },
  {
    id: "royal-road",
    category: "J-Pop",
    name: "Royal Road",
    alias: "IV-V-iii-vi",
    formula: ["IV", "V", "iii", "vi"],
    feel: "anime lift",
  },
  {
    id: "royal-road-cadence",
    category: "J-Pop",
    name: "Royal Road Cadence",
    alias: "IV-V-iii-vi-ii-V-I",
    formula: ["IV", "V", "iii", "vi", "ii", "V", "I"],
    feel: "resolved anime",
  },
  {
    id: "komuro",
    category: "J-Pop",
    name: "Komuro",
    alias: "vi-IV-V-I",
    formula: ["vi", "IV", "V", "I"],
    feel: "90s J-pop",
  },
  {
    id: "anime-prechorus",
    category: "J-Pop",
    name: "Anime Pre",
    alias: "IV-V-vi-I",
    formula: ["IV", "V", "vi", "I"],
    feel: "pre-chorus push",
  },
  {
    id: "jpop-float",
    category: "J-Pop",
    name: "J-Pop Float",
    alias: "IVmaj7-V-iii7-vi7",
    formula: ["IVmaj7", "V", "iii7", "vi7"],
    feel: "bright bittersweet",
  },
  {
    id: "three-chord",
    category: "Rock",
    name: "Three Chord",
    alias: "I-IV-V",
    formula: ["I", "IV", "V", "I"],
    feel: "rock basic",
  },
  {
    id: "mixolydian-rock",
    category: "Rock",
    name: "Mixolydian Rock",
    alias: "I-bVII-IV",
    formula: ["I", "bVII", "IV", "I"],
    feel: "guitar rock",
  },
  {
    id: "rock-descent",
    category: "Rock",
    name: "Rock Descent",
    alias: "I-bVII-bVI-bVII",
    formula: ["I", "bVII", "bVI", "bVII"],
    feel: "modal descent",
  },
  {
    id: "minor-rock",
    category: "Rock",
    name: "Minor Rock",
    alias: "i-bVII-bVI-bVII",
    formula: ["i", "bVII", "bVI", "bVII"],
    feel: "dark loop",
  },
  {
    id: "borrowed-rock",
    category: "Rock",
    name: "Borrowed Rock",
    alias: "I-bIII-IV-I",
    formula: ["I", "bIII", "IV", "I"],
    feel: "borrowed color",
  },
  {
    id: "twelve-bar",
    category: "Blues",
    name: "12-Bar Blues",
    alias: "I7-IV7-V7",
    formula: ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
    feel: "standard form",
  },
  {
    id: "quick-change",
    category: "Blues",
    name: "Quick Change",
    alias: "quick IV",
    formula: ["I7", "IV7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
    feel: "bar two IV",
  },
  {
    id: "minor-blues",
    category: "Blues",
    name: "Minor Blues",
    alias: "i7-iv7-V7",
    formula: ["i7", "i7", "i7", "i7", "iv7", "iv7", "i7", "i7", "bVI7", "V7", "i7", "V7"],
    feel: "minor blues",
  },
  {
    id: "eight-bar-blues",
    category: "Blues",
    name: "8-Bar Blues",
    alias: "I-V-IV-I",
    formula: ["I7", "V7", "IV7", "IV7", "I7", "V7", "I7", "V7"],
    feel: "compact blues",
  },
  {
    id: "ii-v-i",
    category: "Jazz",
    name: "ii-V-I",
    alias: "ii7-V7-Imaj7",
    formula: ["ii7", "V7", "Imaj7"],
    feel: "jazz cadence",
  },
  {
    id: "minor-ii-v",
    category: "Jazz",
    name: "Minor ii-V-i",
    alias: "iiø7-V7-i",
    formula: ["iiø7", "V7", "i"],
    feel: "minor cadence",
  },
  {
    id: "jazz-turnaround",
    category: "Jazz",
    name: "Turnaround",
    alias: "Imaj7-vi7-ii7-V7",
    formula: ["Imaj7", "vi7", "ii7", "V7"],
    feel: "standard tag",
  },
  {
    id: "rhythm-a",
    category: "Jazz",
    name: "Rhythm A",
    alias: "I-vi-ii-V",
    formula: ["Imaj7", "vi7", "ii7", "V7", "iii7", "VI7", "ii7", "V7"],
    feel: "rhythm changes A",
  },
  {
    id: "circle",
    category: "Jazz",
    name: "Circle",
    alias: "cycle of fourths",
    formula: ["Imaj7", "IVmaj7", "viiø7", "iii7", "vi7", "ii7", "V7", "Imaj7"],
    feel: "functional cycle",
  },
  {
    id: "backdoor",
    category: "Jazz",
    name: "Backdoor",
    alias: "iv7-bVII7-Imaj7",
    formula: ["iv7", "bVII7", "Imaj7"],
    feel: "smooth cadence",
  },
  {
    id: "tritone-sub",
    category: "Jazz",
    name: "Tritone Sub",
    alias: "ii7-bII7-Imaj7",
    formula: ["ii7", "bII7", "Imaj7"],
    feel: "chromatic resolve",
  },
  {
    id: "rhythm-turnaround",
    category: "Jazz",
    name: "Rhythm Turn",
    alias: "III7-VI7-II7-V7",
    formula: ["III7", "VI7", "II7", "V7"],
    feel: "dominant chain",
  },
  {
    id: "neo-soul",
    category: "R&B",
    name: "Neo Soul",
    alias: "Imaj7-iii7-IVmaj7-iv7",
    formula: ["Imaj7", "iii7", "IVmaj7", "iv7"],
    feel: "soft borrowed iv",
  },
  {
    id: "rnb-float",
    category: "R&B",
    name: "R&B Float",
    alias: "Imaj7-IVmaj7",
    formula: ["Imaj7", "IVmaj7", "Imaj7", "IVmaj7"],
    feel: "two-chord float",
  },
  {
    id: "gospel-walk",
    category: "R&B",
    name: "Gospel Walk",
    alias: "I-iii-IV-iv",
    formula: ["I", "iii", "IV", "iv"],
    feel: "church color",
  },
  {
    id: "secondary-pop",
    category: "R&B",
    name: "Secondary Lift",
    alias: "I-III7-vi-IV",
    formula: ["I", "III7", "vi", "IV"],
    feel: "dominant lift",
  },
  {
    id: "andalusian",
    category: "Minor",
    name: "Andalusian",
    alias: "i-bVII-bVI-V",
    formula: ["i", "bVII", "bVI", "V"],
    feel: "flamenco descent",
  },
  {
    id: "aeolian-loop",
    category: "Minor",
    name: "Aeolian Loop",
    alias: "i-bVI-bVII-i",
    formula: ["i", "bVI", "bVII", "i"],
    feel: "minor pop",
  },
  {
    id: "minor-epic",
    category: "Minor",
    name: "Minor Epic",
    alias: "i-bVI-bIII-bVII",
    formula: ["i", "bVI", "bIII", "bVII"],
    feel: "cinematic",
  },
  {
    id: "minor-plagal",
    category: "Minor",
    name: "Minor Plagal",
    alias: "i-iv-bVII-bIII",
    formula: ["i", "iv", "bVII", "bIII"],
    feel: "dark folk",
  },
  {
    id: "harmonic-minor",
    category: "Minor",
    name: "Harmonic Minor",
    alias: "i-bVI-iv-V",
    formula: ["i", "bVI", "iv", "V"],
    feel: "minor dominant",
  },
  {
    id: "folk-basic",
    category: "Folk",
    name: "Folk Basic",
    alias: "I-IV-V",
    formula: ["I", "IV", "V", "I"],
    feel: "plain major",
  },
  {
    id: "folk-open",
    category: "Folk",
    name: "Folk Open",
    alias: "I-V-IV-I",
    formula: ["I", "V", "IV", "I"],
    feel: "guitar open",
  },
  {
    id: "country",
    category: "Folk",
    name: "Country",
    alias: "I-V-I-IV",
    formula: ["I", "V", "I", "IV"],
    feel: "country loop",
  },
  {
    id: "plagal-cadence",
    category: "Folk",
    name: "Amen",
    alias: "IV-I",
    formula: ["IV", "I", "IV", "I"],
    feel: "plagal cadence",
  },
];

export const PROGRESSION_CATEGORIES: ProgressionCategory[] = [
  "Pop",
  "J-Pop",
  "Rock",
  "Blues",
  "Jazz",
  "R&B",
  "Minor",
  "Folk",
];

export const PROGRESSION_MOODS: ProgressionMood[] = [
  "All",
  "Bright",
  "Emotional",
  "Dark",
  "Float",
  "Push",
  "Classic",
  "Jazz",
  "Blues",
];

const DEGREE_TO_INDEX: Record<string, number> = {
  I: 0,
  II: 1,
  III: 2,
  IV: 3,
  V: 4,
  VI: 5,
  VII: 6,
};

const MODE_INTERVALS: Record<KeySig["mode"], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const FLAT_NAMES = [
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

function preferSharps(key: KeySig) {
  return ["G", "D", "A", "E", "B", "F#"].includes(key.tonic);
}

function pcName(semitone: number, key: KeySig) {
  const pc = ((semitone % 12) + 12) % 12;
  return preferSharps(key) ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
}

function parseRomanToken(token: string) {
  const match = token.match(/^([b#]*)([ivIV]+)(.*)$/);
  if (!match) return null;

  const [, accidental, roman, suffixRaw] = match;
  let accidentalShift = 0;
  for (const ch of accidental) {
    accidentalShift += ch === "#" ? 1 : -1;
  }

  return {
    accidentalShift,
    roman,
    romanUpper: roman.toUpperCase(),
    isLower: roman === roman.toLowerCase(),
    suffixRaw,
  };
}

function suffixFor(token: ReturnType<typeof parseRomanToken>) {
  if (!token) return "";

  const suffix = token.suffixRaw;
  if (suffix.includes("ø")) return "m7b5";
  if (suffix.includes("°") || suffix.toLowerCase().includes("dim")) {
    return suffix.includes("7") ? "dim7" : "dim";
  }
  if (/^maj7$/i.test(suffix)) return "maj7";
  if (/^m7b5$/i.test(suffix)) return "m7b5";
  if (/^m7$/i.test(suffix)) return "m7";
  if (/^7/.test(suffix)) return token.isLower ? `m${suffix}` : suffix;
  if (/^6/.test(suffix)) return token.isLower ? `m${suffix}` : suffix;
  if (/^9/.test(suffix)) return token.isLower ? `m${suffix}` : suffix;
  if (/^13/.test(suffix)) return token.isLower ? `m${suffix}` : suffix;
  if (suffix) return suffix;
  return token.isLower ? "m" : "";
}

export function romanTokenToChord(token: string, key: KeySig) {
  const parsed = parseRomanToken(token);
  if (!parsed) return token;

  const degreeIdx = DEGREE_TO_INDEX[parsed.romanUpper];
  if (degreeIdx == null) return token;

  const root =
    pcToSemitone(key.tonic) +
    MODE_INTERVALS[key.mode][degreeIdx] +
    parsed.accidentalShift;

  return `${pcName(root, key)}${suffixFor(parsed)}`;
}

export function progressionToChords(preset: ProgressionPreset, key: KeySig) {
  return preset.formula.map((token) => romanTokenToChord(token, key));
}

export function progressionLabel(preset: ProgressionPreset, key: KeySig) {
  return progressionToChords(preset, key).join(" ");
}

export function progressionMoods(preset: ProgressionPreset): ProgressionMood[] {
  const text = `${preset.category} ${preset.name} ${preset.alias} ${preset.feel}`.toLowerCase();
  const moods = new Set<ProgressionMood>();

  if (preset.category === "Jazz") moods.add("Jazz");
  if (preset.category === "Blues") moods.add("Blues");
  if (/(classic|oldies|canon|standard|basic|amen|country|50s)/.test(text)) {
    moods.add("Classic");
  }
  if (/(emotional|bittersweet|sad|minor|dark|flamenco|cinematic)/.test(text)) {
    moods.add("Emotional");
  }
  if (/(dark|minor|phrygian|flamenco|cinematic)/.test(text)) {
    moods.add("Dark");
  }
  if (/(float|neo|smooth|soft|maj7|m9|maj9)/.test(text)) {
    moods.add("Float");
  }
  if (/(push|lift|dominant|cadence|chorus|driving|anthem|anime)/.test(text)) {
    moods.add("Push");
  }
  if (/(bright|open|major|anthem|singalong|pop)/.test(text)) {
    moods.add("Bright");
  }

  if (!moods.size) moods.add("Bright");
  return Array.from(moods);
}

export function matchesProgressionMood(
  preset: ProgressionPreset,
  mood: ProgressionMood
) {
  return mood === "All" || progressionMoods(preset).includes(mood);
}

export type NextRomanSuggestion = {
  token: string;
  label: string;
};

export type SectionShapeId =
  | "loop"
  | "story"
  | "lift"
  | "float"
  | "dark"
  | "jazz"
  | "continue";

export type SectionShape = {
  id: SectionShapeId;
  label: string;
};

export const SECTION_SHAPES: SectionShape[] = [
  { id: "loop", label: "Loop" },
  { id: "story", label: "Story" },
  { id: "lift", label: "Lift" },
  { id: "float", label: "Float" },
  { id: "dark", label: "Dark" },
  { id: "jazz", label: "Jazz" },
  { id: "continue", label: "Continue" },
];

const NEXT_BY_DEGREE: Record<string, NextRomanSuggestion[]> = {
  I: [
    { token: "IVmaj7", label: "open" },
    { token: "V7", label: "push" },
    { token: "vi7", label: "soft" },
    { token: "ii7", label: "jazz" },
  ],
  II: [
    { token: "V7", label: "resolve" },
    { token: "IVmaj7", label: "lift" },
    { token: "bVII", label: "modal" },
  ],
  III: [
    { token: "vi7", label: "fall" },
    { token: "IVmaj7", label: "bright" },
    { token: "VI7", label: "dominant" },
  ],
  IV: [
    { token: "V7", label: "royal" },
    { token: "Imaj7", label: "home" },
    { token: "iii7", label: "j-pop" },
    { token: "iv7", label: "borrow" },
  ],
  V: [
    { token: "Imaj7", label: "resolve" },
    { token: "vi7", label: "deceptive" },
    { token: "IV", label: "loop" },
  ],
  VI: [
    { token: "IVmaj7", label: "pop" },
    { token: "ii7", label: "circle" },
    { token: "V7", label: "push" },
    { token: "bVII", label: "minor" },
  ],
  VII: [
    { token: "Imaj7", label: "resolve" },
    { token: "III", label: "lift" },
    { token: "IV", label: "modal" },
  ],
};

const SECTION_PATTERNS: Record<Exclude<SectionShapeId, "continue">, string[][]> = {
  loop: [
    ["I", "V", "vi", "IV"],
    ["vi", "IV", "I", "V"],
    ["Imaj7", "IVmaj7", "Imaj7", "IVmaj7"],
    ["I", "bVII", "IV", "I"],
  ],
  story: [
    ["I", "V", "vi7", "IVmaj7", "ii7", "V7", "Imaj7", "V7"],
    ["Imaj7", "iii7", "IVmaj7", "iv7", "ii7", "V7", "Imaj7", "V7"],
    ["vi7", "IVmaj7", "I", "V7", "ii7", "V7", "Imaj7", "V7"],
  ],
  lift: [
    ["IVmaj7", "V7", "iii7", "vi7", "ii7", "V7", "Imaj7", "Imaj7"],
    ["I", "III7", "vi7", "IVmaj7", "ii7", "V7", "Imaj7", "V7"],
    ["IV", "V", "vi", "I", "ii7", "V7", "Imaj7", "V7"],
  ],
  float: [
    ["Imaj7", "iii7", "IVmaj7", "iv7"],
    ["Imaj7", "IVmaj7", "iii7", "vi7"],
    ["vi9", "IVmaj7", "Imaj7", "V7"],
  ],
  dark: [
    ["i", "bVII", "bVI", "V7"],
    ["i7", "iv7", "bVII", "bIII"],
    ["i", "bVI", "bIII", "bVII"],
  ],
  jazz: [
    ["Imaj7", "vi7", "ii7", "V7"],
    ["ii7", "V7", "Imaj7", "VI7"],
    ["Imaj7", "VI7", "ii7", "V7", "iii7", "VI7", "ii7", "V7"],
  ],
};

function choose<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function fitSection(pattern: string[], bars: number) {
  return Array.from({ length: bars }, (_, idx) => pattern[idx % pattern.length]);
}

function normalizeBars(bars: number) {
  if (bars <= 4) return 4;
  if (bars <= 8) return 8;
  if (bars <= 12) return 12;
  return 16;
}

function romanDegree(token: string) {
  return token.match(/^[b#]*([ivIV]+)/)?.[1].toUpperCase() ?? "";
}

export function suggestNextRomans(lastRoman: string): NextRomanSuggestion[] {
  const match = lastRoman.match(/[b#]*[ivIV]+/);
  if (!match) return NEXT_BY_DEGREE.I;

  const accidental = match[0].match(/^[b#]+/)?.[0] ?? "";
  const degree = match[0].replace(/^[b#]+/, "").toUpperCase();

  if (accidental === "b" && degree === "VII") {
    return [
      { token: "IV", label: "rock" },
      { token: "I", label: "home" },
      { token: "bVI", label: "dark" },
    ];
  }

  return NEXT_BY_DEGREE[degree] ?? NEXT_BY_DEGREE.I;
}

export function generateSectionRomans(
  shape: SectionShapeId,
  bars: number,
  lastRoman = ""
) {
  const length = normalizeBars(bars);

  if (shape !== "continue") {
    return fitSection(choose(SECTION_PATTERNS[shape]), length);
  }

  const romans: string[] = [];
  let current = lastRoman || "I";

  for (let idx = 0; idx < length; idx++) {
    const options = suggestNextRomans(current);
    const weighted =
      idx === length - 2
        ? options.filter((option) => romanDegree(option.token) === "V")
        : idx === length - 1
          ? options.filter((option) => romanDegree(option.token) === "I")
          : options;
    const picked = choose(weighted.length ? weighted : options);
    romans.push(picked.token);
    current = picked.token;
  }

  return romans;
}

export function generateSectionChords(
  shape: SectionShapeId,
  bars: number,
  key: KeySig,
  lastRoman = ""
) {
  return generateSectionRomans(shape, bars, lastRoman).map((token) =>
    romanTokenToChord(token, key)
  );
}
