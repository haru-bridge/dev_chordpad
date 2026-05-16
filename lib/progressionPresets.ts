import {
  romanCandidateToChord,
  type KeyMode,
} from "./chordRecommendations";

export type PresetMode = "major" | "minor" | "either";

export type StarterProgressionPreset = {
  id: string;
  name: string;
  roman: string[];
  mode: PresetMode;
  genres: string[];
  moods: string[];
  complexity: 1 | 2 | 3 | 4 | 5;
  description: string;
  commonUse?: string;
  variationHints?: string[];
};

export type PresetFilter = {
  genre?: string;
  mood?: string;
  complexity?: string;
  search?: string;
};

export const STARTER_PRESETS: StarterProgressionPreset[] = [
  {
    id: "royal-road",
    name: "Royal Road",
    roman: ["IV", "V", "iii", "vi"],
    mode: "major",
    genres: ["J-Pop", "Anime"],
    moods: ["Emotional", "Push"],
    complexity: 2,
    description: "J-Pop staple with a bright lift into relative minor.",
    commonUse: "chorus, pre-chorus",
    variationHints: ["Insert V/vi before vi", "Extend with ii7 V7 Imaj7"],
  },
  {
    id: "komuro",
    name: "Komuro",
    roman: ["vi", "IV", "V", "I"],
    mode: "major",
    genres: ["J-Pop", "Pop"],
    moods: ["Emotional", "Push"],
    complexity: 2,
    description: "90s J-Pop motion from relative minor back to major tonic.",
    commonUse: "chorus loop",
    variationHints: ["Insert ii7 before V", "Add V/vi when looping"],
  },
  {
    id: "anime-pre",
    name: "Anime Pre",
    roman: ["IV", "V", "I", "I"],
    mode: "major",
    genres: ["J-Pop", "Anime"],
    moods: ["Bright", "Push"],
    complexity: 1,
    description: "Direct lift from IV and V into an open tonic hold.",
  },
  {
    id: "jpop-float",
    name: "J-Pop Float",
    roman: ["IVmaj7", "V", "ii7", "vi7"],
    mode: "major",
    genres: ["J-Pop", "Anime"],
    moods: ["Float", "Emotional"],
    complexity: 3,
    description: "Soft major-seventh color with a bittersweet minor landing.",
  },
  {
    id: "emotional-lift",
    name: "Emotional Lift",
    roman: ["vi", "IV", "I", "V"],
    mode: "major",
    genres: ["J-Pop", "Pop"],
    moods: ["Emotional", "Bright"],
    complexity: 1,
    description: "A familiar emotional loop that keeps momentum open.",
  },
  {
    id: "bright-loop",
    name: "Bright Loop",
    roman: ["I", "V", "vi", "IV"],
    mode: "major",
    genres: ["J-Pop", "Pop"],
    moods: ["Bright", "Classic"],
    complexity: 1,
    description: "Clear pop loop with stable tonic and relative minor color.",
  },
  {
    id: "soft-ballad",
    name: "Soft Ballad",
    roman: ["I", "iii", "IV", "V"],
    mode: "major",
    genres: ["J-Pop", "Pop"],
    moods: ["Soft", "Emotional"],
    complexity: 2,
    description: "Gentle mediant color into a classic IV-V lift.",
  },
  {
    id: "descending-emotion",
    name: "Descending Emotion",
    roman: ["I", "V", "vi", "iii", "IV"],
    mode: "major",
    genres: ["J-Pop", "Anime"],
    moods: ["Emotional", "Classic"],
    complexity: 3,
    description: "Practical descending pop shape without slash-degree notation.",
  },
  {
    id: "axis",
    name: "Axis Progression",
    roman: ["I", "V", "vi", "IV"],
    mode: "major",
    genres: ["Pop", "Rock"],
    moods: ["Bright", "Classic"],
    complexity: 1,
    description: "Universal pop-rock seed with strong loopability.",
  },
  {
    id: "fifties",
    name: "50s Progression",
    roman: ["I", "vi", "IV", "V"],
    mode: "major",
    genres: ["Pop", "Rock"],
    moods: ["Classic", "Bright"],
    complexity: 1,
    description: "Classic oldies turnaround with a clean dominant close.",
  },
  {
    id: "pop-punk",
    name: "Pop Punk",
    roman: ["I", "V", "vi", "IV"],
    mode: "major",
    genres: ["Rock", "Pop"],
    moods: ["Bright", "Push"],
    complexity: 1,
    description: "Driving four-chord rock loop.",
  },
  {
    id: "rock-lift",
    name: "Rock Lift",
    roman: ["I", "bVII", "IV", "I"],
    mode: "major",
    genres: ["Rock", "Modal"],
    moods: ["Open", "Classic"],
    complexity: 2,
    description: "Mixolydian rock color that returns home through IV.",
  },
  {
    id: "stadium-rock",
    name: "Stadium Rock",
    roman: ["I", "IV", "vi", "V"],
    mode: "major",
    genres: ["Rock", "Pop"],
    moods: ["Bright", "Push"],
    complexity: 2,
    description: "Broad tonic-subdominant lift with a strong V ending.",
  },
  {
    id: "minor-rock",
    name: "Minor Rock",
    roman: ["i", "bVII", "bVI", "bVII"],
    mode: "minor",
    genres: ["Rock", "Minor"],
    moods: ["Dark", "Push"],
    complexity: 2,
    description: "Aeolian rock descent with a returning bVII push.",
  },
  {
    id: "aeolian-loop",
    name: "Aeolian Loop",
    roman: ["i", "bVI", "bVII", "i"],
    mode: "minor",
    genres: ["Rock", "Pop", "Minor"],
    moods: ["Dark", "Classic"],
    complexity: 1,
    description: "Natural-minor loop with a clear modal return.",
  },
  {
    id: "andalusian",
    name: "Andalusian",
    roman: ["i", "bVII", "bVI", "V"],
    mode: "minor",
    genres: ["Rock", "Minor"],
    moods: ["Dark", "Dramatic"],
    complexity: 2,
    description: "Dramatic minor descent with harmonic-minor dominant.",
  },
  {
    id: "major-ii-v-i",
    name: "Major ii-V-I",
    roman: ["ii7", "V7", "Imaj7"],
    mode: "major",
    genres: ["Jazz", "City Pop"],
    moods: ["Smooth", "Classic"],
    complexity: 3,
    description: "Core functional cadence for jazz and city pop.",
  },
  {
    id: "minor-ii-v-i",
    name: "Minor ii-V-i",
    roman: ["iiø7", "V7", "i"],
    mode: "minor",
    genres: ["Jazz", "Minor"],
    moods: ["Dark", "Smooth"],
    complexity: 4,
    description: "Minor cadence with half-diminished predominant.",
  },
  {
    id: "turnaround",
    name: "Turnaround",
    roman: ["Imaj7", "vi7", "ii7", "V7"],
    mode: "major",
    genres: ["Jazz", "City Pop"],
    moods: ["Smooth", "Classic"],
    complexity: 3,
    description: "Reusable tonic-to-cadence loop.",
  },
  {
    id: "rhythm-a",
    name: "Rhythm Changes A",
    roman: ["Imaj7", "VI7", "ii7", "V7"],
    mode: "major",
    genres: ["Jazz"],
    moods: ["Classic", "Push"],
    complexity: 4,
    description: "Dominant color inside a compact jazz turnaround.",
  },
  {
    id: "city-pop-loop",
    name: "City Pop Loop",
    roman: ["IVmaj7", "III7", "vi7", "V7"],
    mode: "major",
    genres: ["City Pop", "J-Pop", "R&B"],
    moods: ["Float", "Smooth"],
    complexity: 4,
    description: "Glossy IV color with a secondary-dominant pull to vi.",
  },
  {
    id: "mellow-rnb",
    name: "Mellow R&B",
    roman: ["Imaj7", "iii7", "vi7", "IVmaj7"],
    mode: "major",
    genres: ["R&B", "City Pop"],
    moods: ["Mellow", "Float"],
    complexity: 3,
    description: "Soft tonic-area movement with a plush IVmaj7 landing.",
  },
  {
    id: "neo-soul-color",
    name: "Neo Soul Color",
    roman: ["Imaj7", "VII7", "iii7", "vi7"],
    mode: "major",
    genres: ["R&B", "Jazz"],
    moods: ["Smooth", "Color"],
    complexity: 5,
    description: "Outside dominant color for a richer tonic-area loop.",
  },
  {
    id: "backdoor-cadence",
    name: "Backdoor Cadence",
    roman: ["iv7", "bVII7", "Imaj7"],
    mode: "major",
    genres: ["Jazz", "R&B"],
    moods: ["Smooth", "Color"],
    complexity: 4,
    description: "Borrowed minor subdominant into a backdoor resolution.",
  },
  {
    id: "minor-epic",
    name: "Minor Epic",
    roman: ["i", "bVI", "bIII", "bVII"],
    mode: "minor",
    genres: ["Minor", "Cinematic"],
    moods: ["Dark", "Epic"],
    complexity: 2,
    description: "Wide natural-minor motion with cinematic weight.",
  },
  {
    id: "dark-loop",
    name: "Dark Loop",
    roman: ["i", "bVI", "iv", "V"],
    mode: "minor",
    genres: ["Minor", "Rock"],
    moods: ["Dark", "Tension"],
    complexity: 2,
    description: "Minor color that tightens into a harmonic dominant.",
  },
  {
    id: "harmonic-minor",
    name: "Harmonic Minor",
    roman: ["i", "iv", "V"],
    mode: "minor",
    genres: ["Minor"],
    moods: ["Dark", "Classic"],
    complexity: 2,
    description: "Compact minor predominant to dominant cadence.",
  },
  {
    id: "phrygian-color",
    name: "Phrygian Color",
    roman: ["i", "bII", "bVII", "i"],
    mode: "minor",
    genres: ["Minor", "Modal"],
    moods: ["Dark", "Outside"],
    complexity: 3,
    description: "bII modal pull with a grounded return to i.",
  },
  {
    id: "dark-cadence",
    name: "Dark Cadence",
    roman: ["i", "bVI", "V", "i"],
    mode: "minor",
    genres: ["Minor"],
    moods: ["Dark", "Tension"],
    complexity: 2,
    description: "Aeolian color into a strong harmonic-minor close.",
  },
  {
    id: "emotional-minor",
    name: "Emotional Minor",
    roman: ["i", "bIII", "bVI", "V"],
    mode: "minor",
    genres: ["Minor", "Pop"],
    moods: ["Emotional", "Dark"],
    complexity: 2,
    description: "Relative-major warmth with a dramatic V return.",
  },
  {
    id: "sad-pop",
    name: "Sad Pop",
    roman: ["vi", "IV", "I", "V"],
    mode: "major",
    genres: ["Pop", "J-Pop"],
    moods: ["Sad", "Emotional"],
    complexity: 1,
    description: "Relative-minor start with a bright pop resolution.",
  },
  {
    id: "bittersweet",
    name: "Bittersweet",
    roman: ["vi", "iii", "IV", "I"],
    mode: "major",
    genres: ["Pop", "J-Pop"],
    moods: ["Emotional", "Soft"],
    complexity: 2,
    description: "Gentle minor-mediant path into IV and I.",
  },
  {
    id: "perfect-cadence",
    name: "Perfect Cadence",
    roman: ["ii", "V", "I"],
    mode: "major",
    genres: ["Cadence", "Pop"],
    moods: ["Classic", "Resolved"],
    complexity: 1,
    description: "Plain predominant to dominant to tonic.",
  },
  {
    id: "plagal-cadence",
    name: "Plagal Cadence",
    roman: ["IV", "I"],
    mode: "major",
    genres: ["Cadence", "Folk"],
    moods: ["Resolved", "Open"],
    complexity: 1,
    description: "Subdominant return with an amen-cadence feel.",
  },
  {
    id: "minor-plagal",
    name: "Minor Plagal",
    roman: ["iv", "I"],
    mode: "major",
    genres: ["Cadence", "R&B"],
    moods: ["Color", "Resolved"],
    complexity: 2,
    description: "Borrowed iv resolving softly into major tonic.",
  },
  {
    id: "deceptive-cadence",
    name: "Deceptive Cadence",
    roman: ["V", "vi"],
    mode: "major",
    genres: ["Cadence", "Pop"],
    moods: ["Emotional", "Tension"],
    complexity: 1,
    description: "Dominant avoids tonic and lands on relative minor.",
  },
  {
    id: "backdoor",
    name: "Backdoor",
    roman: ["iv", "bVII", "I"],
    mode: "major",
    genres: ["Cadence", "Jazz", "R&B"],
    moods: ["Smooth", "Color"],
    complexity: 3,
    description: "Borrowed subdominant into modal bVII and I.",
  },
  {
    id: "secondary-push",
    name: "Secondary Push",
    roman: ["I", "V/vi", "vi"],
    mode: "major",
    genres: ["Cadence", "Pop"],
    moods: ["Push", "Emotional"],
    complexity: 3,
    description: "Tonic into secondary dominant targeting relative minor.",
  },
  {
    id: "circle-motion",
    name: "Circle Motion",
    roman: ["vi", "ii", "V", "I"],
    mode: "major",
    genres: ["Cadence", "Jazz"],
    moods: ["Classic", "Resolved"],
    complexity: 2,
    description: "Circle progression from vi through a full cadence.",
  },
  {
    id: "extended-turnaround",
    name: "Extended Turnaround",
    roman: ["I", "VI7", "ii7", "V7"],
    mode: "major",
    genres: ["Cadence", "Jazz"],
    moods: ["Push", "Classic"],
    complexity: 4,
    description: "Secondary dominant into a jazz ii-V turnaround.",
  },
  {
    id: "mixolydian-rock",
    name: "Mixolydian Rock",
    roman: ["I", "bVII", "IV", "I"],
    mode: "major",
    genres: ["Modal", "Rock"],
    moods: ["Open", "Classic"],
    complexity: 2,
    description: "Modal rock color centered around bVII and IV.",
  },
  {
    id: "borrowed-lift",
    name: "Borrowed Lift",
    roman: ["I", "bVI", "bVII", "I"],
    mode: "major",
    genres: ["Modal", "Rock"],
    moods: ["Color", "Dark"],
    complexity: 3,
    description: "Flat-side borrowed lift that resolves back to I.",
  },
  {
    id: "minor-borrow",
    name: "Minor Borrow",
    roman: ["I", "iv", "I"],
    mode: "major",
    genres: ["Modal", "R&B"],
    moods: ["Color", "Soft"],
    complexity: 2,
    description: "Major tonic touched by borrowed minor iv.",
  },
  {
    id: "dream-pop",
    name: "Dream Pop",
    roman: ["Imaj7", "bVIImaj7", "IVmaj7", "Imaj7"],
    mode: "major",
    genres: ["Modal", "Pop"],
    moods: ["Float", "Color"],
    complexity: 4,
    description: "Major-seventh modal wash with a soft return home.",
  },
  {
    id: "dark-major",
    name: "Dark Major",
    roman: ["I", "bIII", "bVI", "bVII"],
    mode: "major",
    genres: ["Modal", "Rock"],
    moods: ["Dark", "Outside"],
    complexity: 3,
    description: "Major tonic with parallel-minor borrowed color.",
  },
  {
    id: "lydian-hint",
    name: "Lydian Hint",
    roman: ["I", "II", "IV", "I"],
    mode: "major",
    genres: ["Modal", "Pop"],
    moods: ["Bright", "Color"],
    complexity: 3,
    description: "Raised II color for a practical Lydian-flavored lift.",
  },
  {
    id: "phrygian-pull",
    name: "Phrygian Pull",
    roman: ["i", "bII", "i"],
    mode: "minor",
    genres: ["Modal", "Minor"],
    moods: ["Dark", "Tension"],
    complexity: 2,
    description: "bII tension pulling directly back to minor tonic.",
  },
  {
    id: "modal-loop",
    name: "Modal Loop",
    roman: ["i", "bVII", "IV", "i"],
    mode: "minor",
    genres: ["Modal", "Rock"],
    moods: ["Open", "Dark"],
    complexity: 3,
    description: "Minor-modal loop with a bright IV color.",
  },
  {
    id: "folk-basic",
    name: "Folk Basic",
    roman: ["I", "IV", "V", "I"],
    mode: "major",
    genres: ["Folk", "Pop"],
    moods: ["Open", "Classic"],
    complexity: 1,
    description: "Simple tonic-subdominant-dominant starter.",
  },
  {
    id: "country-loop",
    name: "Country Loop",
    roman: ["I", "V", "I", "IV"],
    mode: "major",
    genres: ["Folk", "Rock"],
    moods: ["Open", "Classic"],
    complexity: 1,
    description: "Plain-spoken country movement around I, V, and IV.",
  },
  {
    id: "gospel-walk",
    name: "Gospel Walk",
    roman: ["I", "iii", "IV", "iv"],
    mode: "major",
    genres: ["R&B", "Gospel"],
    moods: ["Color", "Emotional"],
    complexity: 3,
    description: "Tonic-area lift into a borrowed iv color.",
  },
  {
    id: "minor-pop-loop",
    name: "Minor Pop Loop",
    roman: ["i", "iv", "bVI", "V"],
    mode: "minor",
    genres: ["Pop", "Minor"],
    moods: ["Emotional", "Tension"],
    complexity: 2,
    description: "Minor pop loop with a strong dominant reset.",
  },
  {
    id: "city-night",
    name: "City Night",
    roman: ["ii7", "V7", "iii7", "vi7"],
    mode: "major",
    genres: ["City Pop", "J-Pop"],
    moods: ["Smooth", "Float"],
    complexity: 4,
    description: "City-pop cadence fragment that delays tonic resolution.",
  },
];

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export const PRESET_GENRES = uniqueSorted(
  STARTER_PRESETS.flatMap((preset) => preset.genres)
);

export const PRESET_MOODS = uniqueSorted(
  STARTER_PRESETS.flatMap((preset) => preset.moods)
);

export const PRESET_COMPLEXITIES = ["1", "2", "3", "4", "5"] as const;

export function progressionPresetRomanLabel(preset: StarterProgressionPreset) {
  return preset.roman.join(" - ");
}

export function progressionPresetToChords(
  preset: StarterProgressionPreset,
  params: { key: string; mode: KeyMode }
) {
  return preset.roman.map((roman) => romanCandidateToChord(roman, params));
}

export function filterProgressionPresets(
  presets: StarterProgressionPreset[],
  filter: PresetFilter
) {
  const genre = filter.genre && filter.genre !== "All" ? filter.genre : "";
  const mood = filter.mood && filter.mood !== "All" ? filter.mood : "";
  const complexity =
    filter.complexity && filter.complexity !== "All"
      ? Number(filter.complexity)
      : 0;
  const query = filter.search?.trim().toLowerCase() ?? "";

  return presets.filter((preset) => {
    if (genre && !preset.genres.includes(genre)) return false;
    if (mood && !preset.moods.includes(mood)) return false;
    if (complexity && preset.complexity !== complexity) return false;
    if (!query) return true;

    const haystack = [
      preset.name,
      progressionPresetRomanLabel(preset),
      preset.description,
      preset.commonUse ?? "",
      preset.mode,
      ...preset.genres,
      ...preset.moods,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}
