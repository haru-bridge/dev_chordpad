import { Chord } from "tonal";
import { normalizePc, pcToSemitone } from "./musicNote";

export type KeyMode = "major" | "minor";

export type HarmonicFunction =
  | "tonic"
  | "subdominant"
  | "dominant"
  | "passing"
  | "borrowed"
  | "secondaryDominant"
  | "modalColor"
  | "substitution"
  | "turnaround"
  | "unknown";

export type SuggestionAction =
  | "append"
  | "insert"
  | "replace"
  | "extend"
  | "color";

export type SuggestionLabel =
  | "Strong"
  | "Common"
  | "Smooth"
  | "Color"
  | "Tension"
  | "Outside";

export type ChordAnalysis = {
  symbol: string;
  roman: string;
  degree?: number;
  function: HarmonicFunction;
  isDiatonic: boolean;
  quality?: string;
  confidence: number;
};

export type ChordSuggestion = {
  symbol: string;
  sourceSymbol: string;
  roman: string;
  function: HarmonicFunction;
  action: SuggestionAction;
  category: string;
  score: number;
  confidence: number;
  label: SuggestionLabel;
  reason: string;
};

export type RomanCandidate = {
  roman: string;
  function: HarmonicFunction;
  targetRoman?: string;
  category: string;
  reasonTemplate: string;
  baseScore: number;
  label?: SuggestionLabel;
};

type KeySig = {
  tonic: string;
  mode: KeyMode;
};

type ParsedChord = {
  core: string;
  tonic: string;
  intervals: string[];
  quality: ChordQuality;
  hasSlashBass: boolean;
};

type ChordQuality =
  | "major"
  | "minor"
  | "dominant7"
  | "major7"
  | "minor7"
  | "diminished"
  | "halfDiminished"
  | "augmented"
  | "sus"
  | "unknown";

const CACHE_LIMIT = 512;
const MAJOR_DEGREE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const DEGREE_ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

const DEGREE_TO_INDEX: Record<string, number> = {
  I: 0,
  II: 1,
  III: 2,
  IV: 3,
  V: 4,
  VI: 5,
  VII: 6,
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

const parsedChordCache = new Map<string, ParsedChord | null>();
const romanRootCache = new Map<string, number | null>();
const analysisCache = new Map<string, ChordAnalysis>();
const romanToChordCache = new Map<string, string>();
const relationStrengthCache = new Map<string, number>();

function cacheGet<T>(cache: Map<string, T>, key: string, build: () => T) {
  if (cache.has(key)) return cache.get(key) as T;

  const value = build();
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

function keySig(key: string, mode: KeyMode): KeySig {
  return { tonic: normalizePc(key), mode };
}

function preferSharps(key: KeySig) {
  return ["G", "D", "A", "E", "B", "F#", "C#", "F#m", "C#m", "G#m"].includes(
    key.tonic
  );
}

function pcName(semitone: number, key: KeySig) {
  const pc = ((semitone % 12) + 12) % 12;
  return preferSharps(key) ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
}

function splitSlash(input: string) {
  const match = input.trim().match(/^(.+?)\s*\/\s*([A-Ga-g][b#♭♯]?)$/);
  if (!match) return { core: input.trim(), hasSlashBass: false };
  return { core: match[1].trim(), hasSlashBass: true };
}

function normalizeChordCore(input: string) {
  return input.replace(/♭/g, "b").replace(/♯/g, "#").replace(/ø/g, "m7b5");
}

function parseChordSymbol(symbol: string): ParsedChord | null {
  const cacheKey = normalizeChordCore(symbol.trim());
  return cacheGet(parsedChordCache, cacheKey, () => {
    const { core, hasSlashBass } = splitSlash(symbol);
    const chord = Chord.get(normalizeChordCore(core));
    if (!chord?.tonic) return null;

    const intervals = chord.intervals ?? [];
    return {
      core,
      tonic: normalizePc(chord.tonic),
      intervals,
      quality: chordQuality(core, intervals, chord.quality),
      hasSlashBass,
    };
  });
}

function hasInterval(intervals: string[], needle: string) {
  return intervals.includes(needle);
}

function chordQuality(
  symbol: string,
  intervals: string[],
  tonalQuality?: string
): ChordQuality {
  const text = symbol.toLowerCase();
  const quality = (tonalQuality ?? "").toLowerCase();

  if (text.includes("m7b5") || text.includes("ø")) return "halfDiminished";
  if (text.includes("dim") || text.includes("°")) return "diminished";
  if (text.includes("aug") || text.includes("+")) return "augmented";

  const hasMinorThird = hasInterval(intervals, "3m");
  const hasMajorThird = hasInterval(intervals, "3M");
  const hasMinorSeventh = hasInterval(intervals, "7m");
  const hasMajorSeventh = hasInterval(intervals, "7M");

  if (hasMajorThird && hasMinorSeventh) return "dominant7";
  if (hasMajorSeventh || text.includes("maj7") || text.includes("Δ")) {
    return "major7";
  }
  if (hasMinorThird && hasMinorSeventh) return "minor7";
  if (hasMinorThird || (quality.includes("minor") && !quality.includes("major"))) {
    return "minor";
  }
  if (hasMajorThird || quality.includes("major")) return "major";
  if (text.includes("sus")) return "sus";
  return "unknown";
}

function isDominantLike(parsed: ParsedChord) {
  return (
    parsed.quality === "dominant7" ||
    (parsed.quality === "major" && !parsed.hasSlashBass)
  );
}

function accidentalPrefix(delta: number) {
  if (delta > 0) return "#".repeat(delta);
  if (delta < 0) return "b".repeat(Math.abs(delta));
  return "";
}

function degreeInfoForDiff(diff: number) {
  let bestIdx = 0;
  let bestDelta = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let idx = 0; idx < MAJOR_DEGREE_INTERVALS.length; idx++) {
    const base = MAJOR_DEGREE_INTERVALS[idx];
    const delta = ((diff - base + 6) % 12) - 6;
    const score = Math.abs(delta);
    if (score < bestScore) {
      bestIdx = idx;
      bestDelta = delta;
      bestScore = score;
    }
  }

  return {
    degree: bestIdx + 1,
    roman: DEGREE_ROMANS[bestIdx],
    accidental: accidentalPrefix(Math.max(-2, Math.min(2, bestDelta))),
    accidentalDelta: bestDelta,
    distance: bestScore,
  };
}

function romanForQuality(baseRoman: string, quality: ChordQuality) {
  if (quality === "halfDiminished") return `${baseRoman.toLowerCase()}ø`;
  if (quality === "diminished") return `${baseRoman.toLowerCase()}°`;
  if (quality === "augmented") return `${baseRoman.toUpperCase()}+`;
  if (quality === "minor") return baseRoman.toLowerCase();
  if (quality === "minor7") return `${baseRoman.toLowerCase()}7`;
  if (quality === "major7") return `${baseRoman.toUpperCase()}maj7`;
  if (quality === "dominant7") return `${baseRoman.toUpperCase()}7`;
  return baseRoman.toUpperCase();
}

function parseRomanRoot(roman: string) {
  const clean = roman.trim();
  const match = clean.match(/^([b#]*)([ivIV]+)(.*)$/);
  if (!match) return null;

  const [, accidentalRaw, romanRaw, suffixRaw] = match;
  let accidental = 0;
  for (const ch of accidentalRaw) accidental += ch === "#" ? 1 : -1;

  const romanUpper = romanRaw.toUpperCase();
  const degreeIdx = DEGREE_TO_INDEX[romanUpper];
  if (degreeIdx == null) return null;

  return {
    accidental,
    degreeIdx,
    degree: degreeIdx + 1,
    romanRaw,
    romanUpper,
    suffixRaw,
    isLower: romanRaw === romanRaw.toLowerCase(),
  };
}

function romanRootSemitone(roman: string, key: KeySig): number | null {
  return cacheGet(romanRootCache, `${roman}|${key.tonic}|${key.mode}`, () => {
    const secondary = roman.match(/^(V7?)\/(.+)$/);
    if (secondary) {
      const targetRoot = romanRootSemitone(secondary[2], key);
      return targetRoot == null ? null : targetRoot + 7;
    }

    const parsed = parseRomanRoot(roman);
    if (!parsed) return null;
    return (
      pcToSemitone(key.tonic) +
      MAJOR_DEGREE_INTERVALS[parsed.degreeIdx] +
      parsed.accidental
    );
  });
}

function secondaryTargets(mode: KeyMode) {
  return mode === "major"
    ? ["ii", "iii", "IV", "V", "vi"]
    : ["iv", "V", "bVI", "bIII"];
}

function findSecondaryDominant(parsed: ParsedChord, key: KeySig) {
  if (!isDominantLike(parsed)) return null;

  const chordRoot = pcToSemitone(parsed.tonic);
  for (const targetRoman of secondaryTargets(key.mode)) {
    const targetRoot = romanRootSemitone(targetRoman, key);
    if (targetRoot == null) continue;
    const dominantRoot = (targetRoot + 7) % 12;
    if (dominantRoot === chordRoot) {
      return {
        roman: `V/${targetRoman}`,
        targetRoman,
      };
    }
  }

  return null;
}

function romanFamily(roman: string): string {
  const secondary = roman.match(/^V7?\/(.+)$/);
  if (secondary) return `V/${romanFamily(secondary[1])}`;

  const match = roman.match(/^([b#]*[ivIV]+)(?:maj7|Δ7|7|6|9|add9)?/);
  if (!match) return roman;

  const root = match[1];
  if (roman.includes("ø")) return `${root.toLowerCase()}ø`;
  if (roman.includes("°")) return `${root.toLowerCase()}°`;
  return root;
}

function romanWithoutSeventh(roman: string) {
  return romanFamily(roman).replace(/7$/, "");
}

function isSameRomanFamily(a: string, b: string) {
  return romanWithoutSeventh(a) === romanWithoutSeventh(b);
}

function isDiatonicRoman(roman: string, mode: KeyMode) {
  const family = romanFamily(roman);
  const noSeventh = romanWithoutSeventh(roman);
  const parsed = parseRomanRoot(roman);

  if (parsed?.suffixRaw.startsWith("7") && !parsed.isLower) {
    if (mode === "major" && noSeventh !== "V") return false;
    if (mode === "minor" && noSeventh !== "V") return false;
  }

  if (/^(maj7|Δ7)$/i.test(parsed?.suffixRaw ?? "")) {
    if (mode === "major" && !["I", "IV"].includes(noSeventh)) return false;
    if (mode === "minor") return false;
  }

  if (mode === "major") {
    return [
      "I",
      "ii",
      "iii",
      "IV",
      "V",
      "vi",
      "vii°",
      "Imaj7",
      "IVmaj7",
      "ii7",
      "V7",
    ].includes(family);
  }

  return ["i", "iiø", "bIII", "iv", "V", "vii°", "bVI", "bVII"].includes(
    noSeventh
  );
}

function functionForRoman(roman: string, mode: KeyMode): HarmonicFunction {
  if (roman.includes("/")) return "secondaryDominant";

  const family = romanFamily(roman);
  const noSeventh = romanWithoutSeventh(roman);

  if (mode === "major") {
    if (["I", "vi", "iii"].includes(noSeventh)) return "tonic";
    if (["ii", "IV"].includes(noSeventh)) return "subdominant";
    if (["V", "vii°"].includes(noSeventh)) return "dominant";
    if (["iv"].includes(noSeventh)) return "borrowed";
    if (["bVI", "bVII", "bIII"].includes(noSeventh)) return "modalColor";
  } else {
    if (["i", "bIII", "bVI"].includes(noSeventh)) return "tonic";
    if (["iv", "iiø"].includes(noSeventh)) return "subdominant";
    if (["V", "vii°"].includes(noSeventh)) return "dominant";
    if (["bVII"].includes(noSeventh)) return "modalColor";
  }

  if (family.includes("°")) return "passing";
  return "unknown";
}

function labelForCandidate(
  item: RomanCandidate,
  score: number
): SuggestionLabel {
  if (item.label) return item.label;
  if (item.function === "secondaryDominant") return "Tension";
  if (item.function === "borrowed" || item.function === "modalColor") return "Color";
  if (item.function === "passing") return "Smooth";
  if (score >= 118) return "Strong";
  if (score >= 92) return "Common";
  if (score < 70) return "Outside";
  return "Smooth";
}

export function analyzeChordInKey(params: {
  chord: string;
  key: string;
  mode: KeyMode;
}): ChordAnalysis {
  return cacheGet(
    analysisCache,
    `${params.chord}|${params.key}|${params.mode}`,
    () => {
      const parsed = parseChordSymbol(params.chord);
      if (!parsed) {
        return {
          symbol: params.chord,
          roman: "?",
          function: "unknown",
          isDiatonic: false,
          confidence: 0.1,
        };
      }

      const key = keySig(params.key, params.mode);
      const diff =
        (pcToSemitone(parsed.tonic) - pcToSemitone(key.tonic) + 12) % 12;
      const degree = degreeInfoForDiff(diff);
      const directRoman = `${degree.accidental}${romanForQuality(
        degree.roman,
        parsed.quality
      )}`;

      const directDiatonic = isDiatonicRoman(directRoman, params.mode);
      const secondary = directDiatonic ? null : findSecondaryDominant(parsed, key);
      const roman = secondary?.roman ?? directRoman;
      const isDiatonic = !secondary && directDiatonic;
      const confidence =
        parsed.quality === "unknown"
          ? 0.55
          : secondary
            ? parsed.quality === "dominant7"
              ? 0.92
              : 0.78
            : isDiatonic
              ? 0.92
              : parsed.hasSlashBass
                ? 0.62
                : 0.74;

      return {
        symbol: params.chord,
        roman,
        degree: degree.degree,
        function: functionForRoman(roman, params.mode),
        isDiatonic,
        quality: parsed.quality,
        confidence,
      };
    }
  );
}

function candidate(
  roman: string,
  fn: HarmonicFunction,
  category: string,
  reasonTemplate: string,
  baseScore: number,
  targetRoman?: string,
  label?: SuggestionLabel
): RomanCandidate {
  return {
    roman,
    function: fn,
    category,
    reasonTemplate,
    baseScore,
    targetRoman,
    label,
  };
}

const MAJOR_NEXT: Record<string, RomanCandidate[]> = {
  I: [
    candidate("IV", "subdominant", "Predominant", "Subdominant lift away from tonic", 90),
    candidate("ii7", "subdominant", "Predominant", "Predominant setup before dominant", 87),
    candidate("V", "dominant", "Dominant", "Dominant motion that can resolve back home", 82),
    candidate("vi", "tonic", "Tonic color", "Relative minor color from tonic", 78),
    candidate("iii", "passing", "Passing", "Mediant step that points toward vi", 72),
    candidate(
      "V/ii",
      "secondaryDominant",
      "Secondary dominant",
      "Secondary dominant leading to ii",
      65,
      "ii"
    ),
  ],
  ii: [
    candidate("V7", "dominant", "Cadence", "Dominant resolving back to tonic", 96),
    candidate("V", "dominant", "Cadence", "Dominant preparation after ii", 90),
    candidate("IV", "subdominant", "Predominant", "Keeps the harmony in the predominant area", 64),
  ],
  IV: [
    candidate("V", "dominant", "Dominant", "Subdominant preparation before dominant", 88),
    candidate("I", "tonic", "Plagal", "Plagal motion back to tonic", 83),
    candidate("iv", "borrowed", "Borrowed", "Borrowed iv color resolving to I", 80),
    candidate("iii", "passing", "Passing", "Smooth mediant color toward vi", 63),
  ],
  V: [
    candidate("I", "tonic", "Resolution", "Dominant resolving back to tonic", 98),
    candidate("vi", "tonic", "Deceptive", "Deceptive resolution from V", 84),
    candidate("IV", "subdominant", "Loop", "Backs up into a plagal loop", 62),
  ],
  vi: [
    candidate("ii7", "subdominant", "Predominant", "Circle motion from vi into ii", 88),
    candidate("IV", "subdominant", "Predominant", "Common pop move from vi to IV", 84),
    candidate(
      "V/IV",
      "secondaryDominant",
      "Secondary dominant",
      "Secondary dominant leading to IV",
      68,
      "IV"
    ),
    candidate("V", "dominant", "Dominant", "Turns the loop toward a cadence", 62),
  ],
  iii: [
    candidate("vi", "tonic", "Passing", "Mediant motion leading into vi", 91),
    candidate("IV", "subdominant", "Predominant", "Stepwise lift into IV", 70),
    candidate(
      "V/vi",
      "secondaryDominant",
      "Secondary dominant",
      "Secondary dominant leading to vi",
      66,
      "vi"
    ),
  ],
  iv: [
    candidate("I", "tonic", "Borrowed", "Borrowed iv color resolving to I", 94),
    candidate("V", "dominant", "Dominant", "Moves borrowed color into a cadence", 60),
  ],
  bVII: [
    candidate("I", "tonic", "Modal color", "Modal bVII resolving back to tonic", 85),
    candidate("IV", "subdominant", "Modal color", "Mixolydian color moving to IV", 70),
  ],
  bVI: [
    candidate("bVII", "modalColor", "Modal connector", "Modal connector from bVI toward I", 86),
    candidate("I", "tonic", "Modal color", "Direct modal color back to tonic", 66),
  ],
  bIII: [
    candidate("IV", "subdominant", "Modal color", "Borrowed bIII lifting into IV", 72),
    candidate("bVI", "modalColor", "Modal color", "Modal color continuing around the flat side", 62),
  ],
};

const MINOR_NEXT: Record<string, RomanCandidate[]> = {
  i: [
    candidate("bVI", "tonic", "Minor color", "Natural-minor color from tonic", 90),
    candidate("iv", "subdominant", "Predominant", "Minor subdominant move away from tonic", 86),
    candidate("V7", "dominant", "Dominant", "Harmonic-minor dominant pulling back to i", 84),
    candidate("bIII", "tonic", "Relative major", "Relative major color from i", 78),
    candidate("bVII", "modalColor", "Aeolian color", "Natural-minor back-cycle color", 72),
  ],
  iv: [
    candidate("V7", "dominant", "Cadence", "Minor predominant leading to V7", 97),
    candidate("i", "tonic", "Plagal", "Minor plagal return to tonic", 74),
    candidate("bVII", "modalColor", "Aeolian color", "Keeps the progression in natural minor", 66),
  ],
  V: [
    candidate("i", "tonic", "Resolution", "Dominant resolving back to i", 99),
    candidate("bVI", "tonic", "Deceptive", "Deceptive color from V to bVI", 83),
    candidate("iv", "subdominant", "Loop", "Backs up into minor subdominant color", 58),
  ],
  bVI: [
    candidate("bVII", "modalColor", "Aeolian color", "Natural-minor motion from bVI to bVII", 89),
    candidate("iv", "subdominant", "Predominant", "Shared minor color moving to iv", 73),
    candidate("bIII", "tonic", "Relative major", "Relative-major color from bVI", 70),
    candidate(
      "V/bIII",
      "secondaryDominant",
      "Secondary dominant",
      "Secondary dominant leading to bIII",
      62,
      "bIII"
    ),
  ],
  bVII: [
    candidate("i", "tonic", "Modal resolution", "Aeolian bVII resolving to i", 88),
    candidate("bIII", "tonic", "Relative major", "bVII lifting to the relative major", 80),
  ],
  bIII: [
    candidate("bVI", "tonic", "Minor color", "Relative-major motion toward bVI", 88),
    candidate("iv", "subdominant", "Predominant", "Slides back into the minor subdominant", 70),
    candidate(
      "V/bVI",
      "secondaryDominant",
      "Secondary dominant",
      "Secondary dominant leading to bVI",
      62,
      "bVI"
    ),
  ],
  "iiø": [
    candidate("V7", "dominant", "Minor cadence", "Half-diminished ii leading to V7", 97),
    candidate("i", "tonic", "Resolution", "Soft resolution back to minor tonic", 62),
  ],
};

const GENERIC_MAJOR = [
  candidate("IV", "subdominant", "Predominant", "Subdominant preparation before dominant", 70),
  candidate("V7", "dominant", "Cadence", "Dominant resolving back to tonic", 68),
  candidate("vi", "tonic", "Tonic color", "Relative minor color", 62),
  candidate("ii7", "subdominant", "Predominant", "Predominant setup before dominant", 60),
  candidate("bVII", "modalColor", "Modal color", "Modal color that can return to I", 48),
];

const GENERIC_MINOR = [
  candidate("bVI", "tonic", "Minor color", "Natural-minor color from tonic", 70),
  candidate("iv", "subdominant", "Predominant", "Minor subdominant preparation", 68),
  candidate("V7", "dominant", "Cadence", "Harmonic-minor dominant resolving to i", 66),
  candidate("bIII", "tonic", "Relative major", "Relative major color", 62),
  candidate("bVII", "modalColor", "Aeolian color", "Natural-minor connector", 58),
];

function modeTransitions(mode: KeyMode) {
  return mode === "major" ? MAJOR_NEXT : MINOR_NEXT;
}

function lookupNextCandidates(roman: string, mode: KeyMode) {
  const family = romanFamily(roman);
  const base = romanWithoutSeventh(roman);
  const transitions = modeTransitions(mode);

  if (roman.startsWith("V/")) {
    const target = roman.slice(2);
    return [
      candidate(
        target,
        functionForRoman(target, mode),
        "Secondary resolution",
        `Secondary dominant resolving to ${target}`,
        96
      ),
    ];
  }

  if (family === "V7") return transitions.V ?? [];
  if (family === "ii7") return transitions.ii ?? [];
  return transitions[family] ?? transitions[base] ?? [];
}

function dedupeCandidates(candidates: RomanCandidate[]) {
  const byRoman = new Map<string, RomanCandidate>();
  for (const item of candidates) {
    const prev = byRoman.get(item.roman);
    if (!prev || item.baseScore > prev.baseScore) byRoman.set(item.roman, item);
  }
  return Array.from(byRoman.values());
}

function suffixForRoman(parsed: NonNullable<ReturnType<typeof parseRomanRoot>>) {
  const suffix = parsed.suffixRaw;

  if (suffix.includes("ø") || /^m7b5$/i.test(suffix)) return "m7b5";
  if (suffix.includes("°") || suffix.toLowerCase().includes("dim")) {
    return suffix.includes("7") ? "dim7" : "dim";
  }
  if (/^(maj7|Δ7)$/i.test(suffix)) return "maj7";
  if (/^7/.test(suffix)) return parsed.isLower ? "m7" : "7";
  if (/^6/.test(suffix)) return parsed.isLower ? `m${suffix}` : suffix;
  if (/^9/.test(suffix)) return parsed.isLower ? `m${suffix}` : suffix;
  if (/^add9/i.test(suffix)) return parsed.isLower ? "madd9" : "add9";
  if (suffix) return suffix;
  return parsed.isLower ? "m" : "";
}

export function romanCandidateToChord(roman: string, params: { key: string; mode: KeyMode }) {
  return cacheGet(romanToChordCache, `${roman}|${params.key}|${params.mode}`, () => {
    const key = keySig(params.key, params.mode);
    const secondary = roman.match(/^(V7?)\/(.+)$/);
    if (secondary) {
      const targetRoot = romanRootSemitone(secondary[2], key);
      if (targetRoot == null) return roman;
      const root = targetRoot + 7;
      return `${pcName(root, key)}7`;
    }

    const parsed = parseRomanRoot(roman);
    if (!parsed) return roman;
    const root =
      pcToSemitone(key.tonic) +
      MAJOR_DEGREE_INTERVALS[parsed.degreeIdx] +
      parsed.accidental;

    return `${pcName(root, key)}${suffixForRoman(parsed)}`;
  });
}

function relationStrength(fromRoman: string, toRoman: string, mode: KeyMode) {
  return cacheGet(relationStrengthCache, `${fromRoman}|${toRoman}|${mode}`, () => {
    if (!fromRoman || fromRoman === "?") return 0;
    if (isSameRomanFamily(fromRoman, toRoman)) return -16;

    const direct = lookupNextCandidates(fromRoman, mode).find((item) =>
      isSameRomanFamily(item.roman, toRoman)
    );
    if (direct) return Math.max(12, (direct.baseScore - 50) * 0.75);

    const fromBase = romanWithoutSeventh(fromRoman);
    const toBase = romanWithoutSeventh(toRoman);

    if (mode === "major") {
      if (["ii", "IV", "iv"].includes(fromBase) && ["V", "V7"].includes(toBase)) {
        return 25;
      }
      if (["V", "V7"].includes(fromBase) && ["I", "vi"].includes(toBase)) return 28;
      if (["bVI", "bVII", "bIII"].includes(fromBase) && toBase === "I") return 20;
    } else {
      if (["iv", "iiø"].includes(fromBase) && ["V", "V7"].includes(toBase)) return 28;
      if (["V", "V7"].includes(fromBase) && ["i", "bVI"].includes(toBase)) return 30;
      if (fromBase === "bVII" && ["i", "bIII"].includes(toBase)) return 24;
    }

    return 0;
  });
}

function outputKey(params: {
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
}) {
  return {
    key: params.outputKey ?? params.key,
    mode: params.outputMode ?? params.mode,
  };
}

function toSuggestion(
  item: RomanCandidate,
  params: {
    key: string;
    mode: KeyMode;
    outputKey?: string;
    outputMode?: KeyMode;
    action: SuggestionAction;
    score: number;
    confidence: number;
    reason?: string;
  }
): ChordSuggestion {
  const score = Math.round(params.score);
  return {
    symbol: romanCandidateToChord(item.roman, outputKey(params)),
    sourceSymbol: romanCandidateToChord(item.roman, params),
    roman: item.roman,
    function: item.function,
    action: params.action,
    category: item.category,
    score,
    confidence: Number(params.confidence.toFixed(2)),
    label: labelForCandidate(item, score),
    reason: params.reason ?? item.reasonTemplate,
  };
}

function toSequenceSuggestion(
  romans: string[],
  params: {
    key: string;
    mode: KeyMode;
    outputKey?: string;
    outputMode?: KeyMode;
    action: SuggestionAction;
    fn: HarmonicFunction;
    category: string;
    score: number;
    confidence: number;
    label: SuggestionLabel;
    reason: string;
  }
): ChordSuggestion {
  const sourceSymbols = romans.map((roman) =>
    romanCandidateToChord(roman, params)
  );
  const displaySymbols = romans.map((roman) =>
    romanCandidateToChord(roman, outputKey(params))
  );

  return {
    symbol: displaySymbols.join(" "),
    sourceSymbol: sourceSymbols.join(" "),
    roman: romans.join(" "),
    function: params.fn,
    action: params.action,
    category: params.category,
    score: Math.round(params.score),
    confidence: Number(params.confidence.toFixed(2)),
    label: params.label,
    reason: params.reason,
  };
}

function suggestionSort(a: ChordSuggestion, b: ChordSuggestion) {
  return b.score - a.score || b.confidence - a.confidence || a.roman.localeCompare(b.roman);
}

export function recommendNextChord(params: {
  chords: string[];
  selectedIndex?: number;
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
  maxSuggestions?: number;
}): ChordSuggestion[] {
  const maxSuggestions = params.maxSuggestions ?? 6;
  const usableChords = params.chords.filter(Boolean);
  const selectedIndex =
    params.selectedIndex == null
      ? usableChords.length - 1
      : Math.max(0, Math.min(params.selectedIndex, usableChords.length - 1));
  const selectedChord = usableChords[selectedIndex];
  const fallbackRoman = params.mode === "minor" ? "i" : "I";

  const analysis = selectedChord
    ? analyzeChordInKey({ chord: selectedChord, key: params.key, mode: params.mode })
    : ({
        roman: fallbackRoman,
        confidence: 0.72,
      } as ChordAnalysis);

  const base = lookupNextCandidates(analysis.roman, params.mode);
  const candidates = base.length
    ? base
    : params.mode === "major"
      ? GENERIC_MAJOR
      : GENERIC_MINOR;

  return dedupeCandidates(candidates)
    .map((item) => {
      const duplicatePenalty = isSameRomanFamily(analysis.roman, item.roman) ? 16 : 0;
      const diatonicBonus = isDiatonicRoman(item.roman, params.mode) ? 6 : 0;
      const secondaryBonus = item.function === "secondaryDominant" ? 4 : 0;
      const modalPenalty =
        item.function === "modalColor" || item.function === "borrowed" ? 3 : 0;

      return toSuggestion(item, {
        ...params,
        action: "append",
        score:
          item.baseScore +
          relationStrength(analysis.roman, item.roman, params.mode) +
          diatonicBonus +
          secondaryBonus -
          modalPenalty -
          duplicatePenalty,
        confidence: Math.min(0.98, analysis.confidence * 0.88 + 0.1),
      });
    })
    .sort(suggestionSort)
    .slice(0, maxSuggestions);
}

function dominantOfTarget(targetRoman: string, mode: KeyMode): RomanCandidate[] {
  const target = romanWithoutSeventh(targetRoman);

  if ((mode === "major" && target === "I") || (mode === "minor" && target === "i")) {
    return [
      candidate("V7", "dominant", "Target dominant", "Dominant resolving into the right chord", 94),
      candidate("vii°", "passing", "Leading-tone", "Leading-tone chord approaching the target", 70),
    ];
  }

  const allowedTargets =
    mode === "major"
      ? ["ii", "iii", "IV", "V", "vi"]
      : ["iv", "V", "bVI", "bIII"];

  if (!allowedTargets.includes(target)) return [];
  return [
    candidate(
      `V/${target}`,
      "secondaryDominant",
      "Target dominant",
      `Secondary dominant leading to ${target}`,
      92,
      target
    ),
  ];
}

function predominantBeforeTarget(targetRoman: string, mode: KeyMode) {
  const target = romanWithoutSeventh(targetRoman);
  if (!["V", "V7"].includes(target)) return [];

  return mode === "major"
    ? [
        candidate("ii7", "subdominant", "Predominant", "Predominant setup before the right chord", 82),
        candidate("IV", "subdominant", "Predominant", "Subdominant preparation before dominant", 78),
      ]
    : [
        candidate("iv", "subdominant", "Predominant", "Minor subdominant before the right chord", 82),
        candidate("iiø", "subdominant", "Minor cadence", "Half-diminished ii before dominant", 80),
      ];
}

function contextualBridgeCandidates(
  leftRoman: string,
  rightRoman: string,
  mode: KeyMode
) {
  const left = romanWithoutSeventh(leftRoman);
  const right = romanWithoutSeventh(rightRoman);
  const items: RomanCandidate[] = [];

  if (mode === "major") {
    if (left === "I" && right === "vi") {
      items.push(
        candidate("iii", "passing", "Passing", "Mediant connector pointing toward vi", 86),
        candidate(
          "V/vi",
          "secondaryDominant",
          "Target dominant",
          "Secondary dominant leading to vi",
          90,
          "vi"
        )
      );
    }
    if (left === "IV" && right === "I") {
      items.push(
        candidate("iv", "borrowed", "Borrowed", "Borrowed iv color resolving to I", 94),
        candidate("V", "dominant", "Dominant", "Dominant approach into I", 76)
      );
    }
    if (left === "I" && right === "V") {
      items.push(
        candidate("ii7", "subdominant", "Predominant", "Predominant setup before V", 90),
        candidate("IV", "subdominant", "Predominant", "Subdominant preparation before V", 84)
      );
    }
    if (left === "bVI" && right === "I") {
      items.push(
        candidate("bVII", "modalColor", "Modal connector", "Modal connector from bVI toward I", 92)
      );
    }
    if (left === "V" && right === "I") {
      items.push(
        candidate("V7", "dominant", "Dominant color", "Adds stronger dominant pull into I", 78),
        candidate("vii°", "passing", "Leading-tone", "Leading-tone approach into I", 72)
      );
    }
    if (left === "ii" && right === "I") {
      items.push(
        candidate("V7", "dominant", "Cadence", "Dominant resolving into I", 92)
      );
    }
    if (left === "vi" && right === "IV") {
      items.push(
        candidate(
          "V/IV",
          "secondaryDominant",
          "Target dominant",
          "Secondary dominant leading to IV",
          82,
          "IV"
        )
      );
    }
  } else {
    if (left === "bVI" && right === "i") {
      items.push(
        candidate("bVII", "modalColor", "Aeolian connector", "Natural-minor connector into i", 88),
        candidate("V7", "dominant", "Target dominant", "Harmonic-minor dominant resolving to i", 86)
      );
    }
    if (left === "i" && right === "V") {
      items.push(
        candidate("iv", "subdominant", "Predominant", "Minor subdominant before V", 88),
        candidate("iiø", "subdominant", "Minor cadence", "Half-diminished ii before V", 84)
      );
    }
    if (left === "iv" && right === "i") {
      items.push(
        candidate("V7", "dominant", "Cadence", "Dominant resolving into i", 90)
      );
    }
  }

  return items;
}

function rootDistanceBonus(leftRoman: string, candidateRoman: string, rightRoman: string, key: KeySig) {
  const left = romanRootSemitone(leftRoman, key);
  const middle = romanRootSemitone(candidateRoman, key);
  const right = romanRootSemitone(rightRoman, key);
  if (left == null || middle == null || right == null) return 0;

  const toRight = Math.min(
    (right - middle + 12) % 12,
    (middle - right + 12) % 12
  );
  const fromLeft = Math.min(
    (middle - left + 12) % 12,
    (left - middle + 12) % 12
  );

  let bonus = 0;
  if (toRight === 1 || toRight === 2) bonus += 5;
  if (toRight === 5 || toRight === 7) bonus += 7;
  if (fromLeft === 1 || fromLeft === 2) bonus += 3;
  if (fromLeft === 5 || fromLeft === 7) bonus += 3;
  return bonus;
}

function isAwkwardBridgeDuplicate(
  leftRoman: string,
  candidateRoman: string,
  rightRoman: string
) {
  const left = romanWithoutSeventh(leftRoman);
  const candidate = romanWithoutSeventh(candidateRoman);
  const right = romanWithoutSeventh(rightRoman);

  if (candidate === right) return true;

  if (candidate === left) {
    const leftExact = romanWithoutSeventh(leftRoman);
    const candidateExact = romanWithoutSeventh(candidateRoman);
    const candidateHasSeventh = /7/.test(candidateRoman);
    const rightIsTonic = ["I", "i"].includes(right);
    return !(leftExact === "V" && candidateExact === "V" && candidateHasSeventh && rightIsTonic);
  }

  return false;
}

export function recommendBetweenChords(params: {
  leftChord: string;
  rightChord: string;
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
  maxSuggestions?: number;
}): ChordSuggestion[] {
  const maxSuggestions = params.maxSuggestions ?? 6;
  const left = analyzeChordInKey({
    chord: params.leftChord,
    key: params.key,
    mode: params.mode,
  });
  const right = analyzeChordInKey({
    chord: params.rightChord,
    key: params.key,
    mode: params.mode,
  });

  const pool = dedupeCandidates([
    ...dominantOfTarget(right.roman, params.mode),
    ...predominantBeforeTarget(right.roman, params.mode),
    ...contextualBridgeCandidates(left.roman, right.roman, params.mode),
    ...lookupNextCandidates(left.roman, params.mode),
    ...(params.mode === "major" ? GENERIC_MAJOR : GENERIC_MINOR),
  ]);

  const analysisKey = keySig(params.key, params.mode);

  return pool
    .filter((item) => !isAwkwardBridgeDuplicate(left.roman, item.roman, right.roman))
    .map((item) => {
      const leftToCandidateStrength = relationStrength(
        left.roman,
        item.roman,
        params.mode
      );
      const candidateToRightStrength = relationStrength(
        item.roman,
        right.roman,
        params.mode
      );
      const targetResolutionBonus =
        item.targetRoman && isSameRomanFamily(item.targetRoman, right.roman)
          ? 28
          : item.function === "dominant" &&
              ["I", "i"].includes(romanWithoutSeventh(right.roman))
            ? 14
            : 0;
      const voiceLeadingApproximationBonus = rootDistanceBonus(
        left.roman,
        item.roman,
        right.roman,
        analysisKey
      );
      const diatonicOrBorrowedSuitabilityBonus = isDiatonicRoman(
        item.roman,
        params.mode
      )
        ? 8
        : item.function === "borrowed" || item.function === "modalColor"
          ? 5
          : item.function === "secondaryDominant"
            ? 6
            : 0;
      const awkwardnessPenalty =
        (isSameRomanFamily(left.roman, item.roman) ? 18 : 0) +
        (isSameRomanFamily(right.roman, item.roman) ? 18 : 0) +
        (left.confidence < 0.5 || right.confidence < 0.5 ? 10 : 0);

      const score =
        item.baseScore +
        leftToCandidateStrength +
        candidateToRightStrength +
        targetResolutionBonus +
        voiceLeadingApproximationBonus +
        diatonicOrBorrowedSuitabilityBonus -
        awkwardnessPenalty;

      return toSuggestion(item, {
        ...params,
        action: "insert",
        score,
        confidence: Math.min(0.98, (left.confidence + right.confidence) / 2),
      });
    })
    .sort(suggestionSort)
    .slice(0, maxSuggestions);
}

function substitutionCandidates(roman: string, mode: KeyMode) {
  const base = romanWithoutSeventh(roman);

  if (mode === "major") {
    const map: Record<string, RomanCandidate[]> = {
      I: [
        candidate("Imaj7", "substitution", "Tonic substitute", "Adds color while keeping tonic function", 86, undefined, "Smooth"),
        candidate("vi", "substitution", "Tonic substitute", "Relative minor substitute for tonic", 78, undefined, "Common"),
        candidate("iii", "substitution", "Tonic substitute", "Mediant tonic-area substitute", 70, undefined, "Smooth"),
      ],
      vi: [
        candidate("I", "substitution", "Tonic substitute", "Major tonic substitute for relative minor", 82, undefined, "Common"),
        candidate("iii", "substitution", "Tonic substitute", "Mediant color that still points through vi", 74, undefined, "Smooth"),
      ],
      iii: [
        candidate("Imaj7", "substitution", "Tonic substitute", "Major tonic color in place of mediant", 72, undefined, "Smooth"),
        candidate("vi", "substitution", "Tonic substitute", "Relative minor target for mediant motion", 78, undefined, "Common"),
      ],
      ii: [
        candidate("IV", "substitution", "Predominant substitute", "Subdominant substitute for ii", 82, undefined, "Common"),
        candidate("ii7", "substitution", "Predominant color", "Adds seventh color while keeping ii function", 86, undefined, "Smooth"),
      ],
      IV: [
        candidate("ii7", "substitution", "Predominant substitute", "Softer predominant substitute for IV", 86, undefined, "Common"),
        candidate("IVmaj7", "substitution", "Predominant color", "Adds major-seventh color to IV", 82, undefined, "Smooth"),
        candidate("iv", "borrowed", "Borrowed substitute", "Borrowed minor iv for softer resolution", 76, undefined, "Color"),
      ],
      V: [
        candidate("V7", "substitution", "Dominant color", "Adds stronger dominant pull", 88, undefined, "Strong"),
        candidate("vii°", "substitution", "Leading-tone substitute", "Leading-tone substitute for dominant", 74, undefined, "Tension"),
      ],
    };
    return map[base] ?? [];
  }

  const map: Record<string, RomanCandidate[]> = {
    i: [
      candidate("i7", "substitution", "Minor tonic color", "Adds seventh color while staying on i", 82, undefined, "Smooth"),
      candidate("bIII", "substitution", "Relative major", "Relative-major substitute for minor tonic", 76, undefined, "Color"),
      candidate("bVI", "substitution", "Minor tonic area", "Flat-six color in the tonic area", 70, undefined, "Color"),
    ],
    iv: [
      candidate("iiø", "substitution", "Predominant substitute", "Half-diminished predominant substitute for iv", 84, undefined, "Tension"),
      candidate("bVI", "substitution", "Predominant color", "Shared minor color that can prepare V", 72, undefined, "Color"),
    ],
    V: [
      candidate("V7", "substitution", "Dominant color", "Adds stronger harmonic-minor pull", 90, undefined, "Strong"),
      candidate("vii°", "substitution", "Leading-tone substitute", "Leading-tone substitute for V", 72, undefined, "Tension"),
    ],
    bVI: [
      candidate("iv", "substitution", "Minor color", "Subdominant substitute for bVI", 76, undefined, "Smooth"),
      candidate("bIII", "substitution", "Relative major", "Relative-major color from bVI", 72, undefined, "Color"),
    ],
    bVII: [
      candidate("V", "substitution", "Dominant color", "Harmonic-minor dominant for a stronger return", 70, undefined, "Tension"),
      candidate("bIII", "substitution", "Relative major", "Relative-major substitute for bVII motion", 72, undefined, "Color"),
    ],
  };
  return map[base] ?? [];
}

export function recommendSubstitutions(params: {
  chord: string;
  previousChord?: string;
  nextChord?: string;
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
  maxSuggestions?: number;
}): ChordSuggestion[] {
  const maxSuggestions = params.maxSuggestions ?? 5;
  const current = analyzeChordInKey({
    chord: params.chord,
    key: params.key,
    mode: params.mode,
  });
  const previous = params.previousChord
    ? analyzeChordInKey({
        chord: params.previousChord,
        key: params.key,
        mode: params.mode,
      })
    : null;
  const next = params.nextChord
    ? analyzeChordInKey({
        chord: params.nextChord,
        key: params.key,
        mode: params.mode,
      })
    : null;

  return dedupeCandidates(substitutionCandidates(current.roman, params.mode))
    .filter((item) => item.roman !== current.roman)
    .map((item) => {
      const contextBonus =
        (previous ? relationStrength(previous.roman, item.roman, params.mode) : 0) +
        (next ? relationStrength(item.roman, next.roman, params.mode) : 0);
      const diatonicBonus = isDiatonicRoman(item.roman, params.mode) ? 6 : 0;

      return toSuggestion(item, {
        ...params,
        action: "replace",
        score: item.baseScore + contextBonus + diatonicBonus,
        confidence: Math.min(0.96, current.confidence * 0.86 + 0.08),
      });
    })
    .sort(suggestionSort)
    .slice(0, maxSuggestions);
}

function extensionSequences(mode: KeyMode, lastRoman: string) {
  const last = romanWithoutSeventh(lastRoman);

  if (mode === "minor") {
    const base = [
      {
        romans: ["iv", "V7", "i"],
        reason: "Minor predominant into a strong tonic return",
        score: 92,
        label: "Strong" as SuggestionLabel,
      },
      {
        romans: ["iiø7", "V7", "i"],
        reason: "Minor ii-V-i cadence to close the phrase",
        score: 90,
        label: "Strong" as SuggestionLabel,
      },
      {
        romans: ["bVI", "bVII", "i"],
        reason: "Natural-minor modal continuation",
        score: 80,
        label: "Common" as SuggestionLabel,
      },
      {
        romans: ["i", "bVI", "iv", "V7"],
        reason: "Loop-ready minor continuation",
        score: 76,
        label: "Color" as SuggestionLabel,
      },
    ];
    return last === "V" ? [{ romans: ["i"], reason: "Resolve the dominant back to i", score: 98, label: "Strong" as SuggestionLabel }, ...base] : base;
  }

  const base = [
    {
      romans: ["ii7", "V7", "Imaj7"],
      reason: "Adds a clear ii-V-I ending",
      score: 94,
      label: "Strong" as SuggestionLabel,
    },
    {
      romans: ["Imaj7", "vi7", "ii7", "V7"],
      reason: "Turns the seed into a reusable turnaround",
      score: 88,
      label: "Common" as SuggestionLabel,
    },
    {
      romans: ["vi7", "ii7", "V7", "Imaj7"],
      reason: "Circle motion back to tonic",
      score: 86,
      label: "Smooth" as SuggestionLabel,
    },
    {
      romans: ["V/vi", "vi", "ii7", "V7"],
      reason: "Secondary dominant pushes into a longer loop",
      score: 78,
      label: "Tension" as SuggestionLabel,
    },
  ];

  return last === "V" ? [{ romans: ["Imaj7"], reason: "Resolve the dominant back to tonic", score: 98, label: "Strong" as SuggestionLabel }, ...base] : base;
}

export function recommendExtensions(params: {
  chords: string[];
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
  maxSuggestions?: number;
}): ChordSuggestion[] {
  const maxSuggestions = params.maxSuggestions ?? 4;
  const lastChord = params.chords.filter(Boolean).at(-1);
  const last = lastChord
    ? analyzeChordInKey({ chord: lastChord, key: params.key, mode: params.mode })
    : ({ roman: params.mode === "minor" ? "i" : "I", confidence: 0.72 } as ChordAnalysis);

  return extensionSequences(params.mode, last.roman)
    .map((item) =>
      toSequenceSuggestion(item.romans, {
        ...params,
        action: "extend",
        fn: "turnaround",
        category: "Continuation",
        score:
          item.score +
          relationStrength(last.roman, item.romans[0] ?? last.roman, params.mode),
        confidence: Math.min(0.96, last.confidence * 0.84 + 0.1),
        label: item.label,
        reason: item.reason,
      })
    )
    .sort(suggestionSort)
    .slice(0, maxSuggestions);
}

function colorCandidatesForRoman(roman: string, mode: KeyMode) {
  const base = romanWithoutSeventh(roman);

  if (mode === "major") {
    const map: Record<string, RomanCandidate[]> = {
      I: [
        candidate("iv", "borrowed", "Borrowed color", "Borrowed iv color can resolve back to I", 84, undefined, "Color"),
        candidate("bVII", "modalColor", "Modal color", "Mixolydian bVII adds a backdoor shade", 74, undefined, "Color"),
        candidate("bVI", "modalColor", "Modal color", "Flat-six borrowed color makes the loop darker", 68, undefined, "Outside"),
      ],
      IV: [
        candidate("iv", "borrowed", "Borrowed color", "Minor iv turns IV into a smoother return", 88, undefined, "Color"),
        candidate("bVII", "modalColor", "Modal color", "bVII gives IV a rock/modal path", 68, undefined, "Color"),
      ],
      V: [
        candidate("V7", "dominant", "Dominant color", "Dominant seventh increases pull", 82, undefined, "Tension"),
        candidate("vii°", "passing", "Leading-tone color", "Leading-tone chord adds a tighter approach", 70, undefined, "Tension"),
      ],
      vi: [
        candidate("V/vi", "secondaryDominant", "Secondary dominant", "Secondary dominant targets vi", 86, "vi", "Tension"),
        candidate("III7", "secondaryDominant", "Secondary dominant", "Dominant-color lift toward vi", 78, "vi", "Tension"),
      ],
      ii: [
        candidate("V/ii", "secondaryDominant", "Secondary dominant", "Secondary dominant targets ii", 78, "ii", "Tension"),
      ],
    };
    return map[base] ?? [
      candidate("iv", "borrowed", "Borrowed color", "Borrowed iv is a compact color option", 62, undefined, "Color"),
      candidate("bVII", "modalColor", "Modal color", "bVII adds modal color without changing the whole form", 60, undefined, "Color"),
    ];
  }

  const map: Record<string, RomanCandidate[]> = {
    i: [
      candidate("bII", "modalColor", "Phrygian color", "bII adds a dark Phrygian pull", 78, undefined, "Outside"),
      candidate("V7", "dominant", "Harmonic minor", "Dominant seventh sharpens the return to i", 86, undefined, "Tension"),
    ],
    iv: [
      candidate("iiø", "subdominant", "Predominant color", "Half-diminished ii adds minor-cadence tension", 76, undefined, "Tension"),
      candidate("V/iv", "secondaryDominant", "Secondary dominant", "Secondary dominant targets iv", 74, "iv", "Tension"),
    ],
    bVI: [
      candidate("V/bVI", "secondaryDominant", "Secondary dominant", "Secondary dominant targets bVI", 74, "bVI", "Tension"),
      candidate("bVII", "modalColor", "Aeolian color", "bVII continues the natural-minor path", 78, undefined, "Color"),
    ],
    bIII: [
      candidate("V/bIII", "secondaryDominant", "Secondary dominant", "Secondary dominant targets bIII", 74, "bIII", "Tension"),
    ],
  };
  return map[base] ?? [
    candidate("bII", "modalColor", "Phrygian color", "bII adds a dark modal pull", 58, undefined, "Outside"),
    candidate("V7", "dominant", "Harmonic minor", "Dominant seventh adds tension", 66, undefined, "Tension"),
  ];
}

export function recommendColorOptions(params: {
  chords: string[];
  selectedIndex?: number;
  selectedGap?: { leftIndex: number; rightIndex: number };
  key: string;
  mode: KeyMode;
  outputKey?: string;
  outputMode?: KeyMode;
  maxSuggestions?: number;
}): ChordSuggestion[] {
  const maxSuggestions = params.maxSuggestions ?? 5;

  if (params.selectedGap) {
    const leftChord = params.chords[params.selectedGap.leftIndex];
    const rightChord = params.chords[params.selectedGap.rightIndex];
    if (leftChord && rightChord) {
      return recommendBetweenChords({
        leftChord,
        rightChord,
        key: params.key,
        mode: params.mode,
        outputKey: params.outputKey,
        outputMode: params.outputMode,
        maxSuggestions: maxSuggestions + 2,
      })
        .filter((suggestion) =>
          ["borrowed", "modalColor", "secondaryDominant", "passing"].includes(
            suggestion.function
          )
        )
        .map((suggestion) => ({
          ...suggestion,
          action: "color" as SuggestionAction,
          label:
            suggestion.function === "secondaryDominant" ? "Tension" : suggestion.label,
        }))
        .slice(0, maxSuggestions);
    }
  }

  const usableChords = params.chords.filter(Boolean);
  const selectedIndex =
    params.selectedIndex == null
      ? usableChords.length - 1
      : Math.max(0, Math.min(params.selectedIndex, usableChords.length - 1));
  const selectedChord = usableChords[selectedIndex];
  const analysis = selectedChord
    ? analyzeChordInKey({ chord: selectedChord, key: params.key, mode: params.mode })
    : ({ roman: params.mode === "minor" ? "i" : "I", confidence: 0.7 } as ChordAnalysis);

  return dedupeCandidates(colorCandidatesForRoman(analysis.roman, params.mode))
    .filter((item) => !isSameRomanFamily(item.roman, analysis.roman))
    .map((item) =>
      toSuggestion(item, {
        ...params,
        action: "color",
        score: item.baseScore + (isDiatonicRoman(item.roman, params.mode) ? 4 : 0),
        confidence: Math.min(0.94, analysis.confidence * 0.82 + 0.08),
      })
    )
    .sort(suggestionSort)
    .slice(0, maxSuggestions);
}
