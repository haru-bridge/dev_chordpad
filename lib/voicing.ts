import { Chord, Interval } from "tonal";
import {
  midiFromPc,
  midiToNoteName,
  normalizePc,
  pcToSemitone,
} from "./musicNote";

/**
 * 目的：
 * - 入力された chordSymbol（例: F/G）を解析
 * - Pad preset に応じて “それっぽい” 4声くらいのvoicingを作る
 * - 再生キー差分（shift semitone）で midi をまとめて移調
 * - 度数（ローマ数字）は別関数 romanizeChord で表示（解析基準キーに対して）
 */

export type KeySig = { tonic: string; mode: "major" | "minor" };

export type PadVoicingPreset =
  | "AUTO_VOICE_BASS"
  | "PAD_TRIAD_BASS_35R"
  | "DROP2_1357_NO_BASS"
  | "DROP3_1357_NO_BASS"
  | "DROP24_1357_NO_BASS"
  | "DROP4_1357_NO_BASS"
  | "SHELL_R37_NO_BASS"
  | "GUIDE_379_NO_BASS"
  | "ROOTLESS_37_9_NO_BASS";

export const PAD_PRESETS: { id: PadVoicingPreset; label: string }[] = [
  { id: "AUTO_VOICE_BASS", label: "Auto = bass + essential tones" },
  { id: "PAD_TRIAD_BASS_35R", label: "PAD (Triad) = bass + 3-5-R’" },
  { id: "DROP2_1357_NO_BASS", label: "Drop2 = 1-3-5-7 (no bass)" },
  { id: "DROP3_1357_NO_BASS", label: "Drop3 = 1-3-5-7 (no bass)" },
  { id: "DROP24_1357_NO_BASS", label: "Drop2&4 = 1-3-5-7 (no bass)" },
  { id: "DROP4_1357_NO_BASS", label: "Drop4 = 1-3-5-7 (no bass)" },
  { id: "SHELL_R37_NO_BASS", label: "Shell = R-3-7 (no bass)" },
  { id: "GUIDE_379_NO_BASS", label: "Guide = 3-7-9(+R) (no bass)" },
  { id: "ROOTLESS_37_9_NO_BASS", label: "Rootless = 3-7-9-13 (no bass)" },
];

export type OmitFlags = {
  root?: boolean;
  third?: boolean;
  fifth?: boolean;
  seventh?: boolean;
};

export type VoicingOptions = {
  omit?: OmitFlags;
};

export type VoicingResult = {
  chordSymbol: string;
  preset: PadVoicingPreset;
  midis: number[];
  notes: string[];
};

// -------------------- Pitch-class utils --------------------

/**
 * signed semitone diff (analysis -> play) in range [-6..+5]
 * 例: C -> E なら +4, C -> Ab なら -4
 */
export function signedSemitoneDiff(fromPc: string, toPc: string): number {
  const a = pcToSemitone(fromPc);
  const b = pcToSemitone(toPc);
  const d = (b - a + 12) % 12;
  const signed = ((d + 6) % 12) - 6; // -6..+5
  return signed;
}

// -------------------- Chord parsing --------------------

type Parsed = {
  core: string;        // without slash
  slashBass?: string;  // after slash
  tonic: string;       // chord root pc
  notes: string[];     // chord pcs from tonal
  intervals: string[];
  tones: ChordTonePcs;
  toneLabels: string[];
  qualityGuess: "major" | "minor" | "diminished" | "augmented";
};

type ToneEntry = {
  num: number;
  interval: string;
  pc: string;
};

type ChordTonePcs = {
  root: string | null;
  third: string | null;
  fifth: string | null;
  seventh: string | null;
  ninth: string | null;
  eleventh: string | null;
  thirteenth: string | null;
};

function splitSlash(input: string): { core: string; slash?: string } {
  const m = input.trim().match(/^(.+?)\s*\/\s*([A-Ga-g][b#]?)$/);
  if (!m) return { core: input.trim() };
  return { core: m[1].trim(), slash: normalizePc(m[2]) };
}

function guessQuality(symbol: string, tonalQuality?: string): Parsed["qualityGuess"] {
  const s = symbol.toLowerCase();

  if (s.includes("dim") || s.includes("o") || s.includes("m7b5") || s.includes("ø")) return "diminished";
  if (s.includes("aug") || s.includes("+")) return "augmented";

  // tonalの quality が取れるなら優先
  const q = (tonalQuality || "").toLowerCase();
  if (q.includes("minor")) return "minor";
  if (q.includes("major")) return "major";

  // 文字列ヒューリスティック
  // "maj" を含まない "m" は minor とみなす（例: "Bm7"）
  if (s.includes("m") && !s.includes("maj")) return "minor";
  return "major";
}

function parseChordSymbol(input: string): Parsed | null {
  const { core, slash } = splitSlash(input);
  const c = Chord.get(core);
  if (!c?.tonic) return null;

  const tonic = normalizePc(c.tonic);
  const notes = (c.notes ?? []).map(normalizePc);
  const intervals = c.intervals ?? [];
  const tones = buildChordTonePcs(tonic, intervals, notes);

  return {
    core,
    slashBass: slash,
    tonic,
    notes,
    intervals,
    tones,
    toneLabels: intervals.map(intervalLabel),
    qualityGuess: guessQuality(core, c.quality),
  };
}

function intervalNum(interval: string): number | null {
  const m = interval.match(/^-?\d+/);
  return m ? Math.abs(Number(m[0])) : null;
}

function firstByNum(entries: ToneEntry[], nums: number[]) {
  return entries.find((entry) => nums.includes(entry.num)) ?? null;
}

function buildChordTonePcs(
  tonic: string,
  intervals: string[],
  notes: string[]
): ChordTonePcs {
  const rootSemi = pcToSemitone(tonic);
  const entries: ToneEntry[] = intervals
    .map((interval, idx) => {
      const num = intervalNum(interval);
      if (!num) return null;
      const note = notes[idx];
      const semis = Interval.semitones(interval);
      const pc =
        note ??
        midiToNoteName(midiFromPc("C", 4) + ((rootSemi + semis) % 12)).replace(
          /-?\d+$/,
          ""
        );
      return { num, interval, pc: normalizePc(pc) };
    })
    .filter((entry): entry is ToneEntry => Boolean(entry));

  const thirdEntry =
    firstByNum(entries, [3]) ?? firstByNum(entries, [4]) ?? firstByNum(entries, [2]);

  return {
    root: firstByNum(entries, [1])?.pc ?? tonic,
    third: thirdEntry?.pc ?? null,
    fifth: firstByNum(entries, [5])?.pc ?? null,
    seventh: firstByNum(entries, [7])?.pc ?? null,
    ninth:
      firstByNum(entries, [9])?.pc ??
      (thirdEntry?.num === 2 ? null : firstByNum(entries, [2])?.pc ?? null),
    eleventh:
      firstByNum(entries, [11])?.pc ??
      (thirdEntry?.num === 4 ? null : firstByNum(entries, [4])?.pc ?? null),
    thirteenth: firstByNum(entries, [13])?.pc ?? firstByNum(entries, [6])?.pc ?? null,
  };
}

function intervalLabel(interval: string) {
  const num = intervalNum(interval);
  const q = interval.replace(/^-?\d+/, "");

  if (num === 1) return "R";
  if (num === 2) return q === "m" ? "b9" : q === "A" ? "#9" : "9";
  if (num === 3) return q === "m" ? "b3" : "3";
  if (num === 4) return q === "A" ? "#11" : "sus4";
  if (num === 5) return q === "d" ? "b5" : q === "A" ? "#5" : "5";
  if (num === 6) return q === "m" ? "b13" : "13";
  if (num === 7) return q === "d" ? "bb7" : q === "m" ? "b7" : "7";
  if (num === 9) return q === "m" ? "b9" : q === "A" ? "#9" : "9";
  if (num === 11) return q === "A" ? "#11" : q === "d" ? "b11" : "11";
  if (num === 13) return q === "m" ? "b13" : q === "A" ? "#13" : "13";
  return interval;
}

function pushUniquePc(list: string[], pc: string | null | undefined) {
  if (!pc || list.includes(pc)) return;
  list.push(pc);
}

function buildAutoUpperPcs(
  r: string,
  t3: string | null,
  t5: string | null,
  t7: string | null,
  t9: string | null,
  t11: string | null,
  t13: string | null,
  omit?: OmitFlags
) {
  const pcs: string[] = [];
  const colors = [t13, t11, t9].filter(Boolean) as string[];

  if (omitOk("third", omit)) pushUniquePc(pcs, t3);
  if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);

  for (const color of colors) {
    if (pcs.length >= 3) break;
    pushUniquePc(pcs, color);
  }

  if (pcs.length < 3 && omitOk("fifth", omit)) pushUniquePc(pcs, t5);
  if (pcs.length < 3 && omitOk("root", omit)) pushUniquePc(pcs, r);

  return pcs.slice(0, 3);
}

export function describeChordToneSummary(chordSymbol: string) {
  const p = parseChordSymbol(chordSymbol);
  if (!p) return "";
  return p.toneLabels.join(" ");
}

export function getChordToneGroups(chordSymbol: string) {
  const p = parseChordSymbol(chordSymbol);
  if (!p) {
    return {
      chordPcs: [] as string[],
      extPcs: [] as string[],
      ninthPc: null as string | null,
      eleventhPc: null as string | null,
      thirteenthPc: null as string | null,
    };
  }

  const chordPcs: string[] = [];
  pushUniquePc(chordPcs, p.tones.root);
  pushUniquePc(chordPcs, p.tones.third);
  pushUniquePc(chordPcs, p.tones.fifth);
  pushUniquePc(chordPcs, p.tones.seventh);

  const extPcs: string[] = [];
  pushUniquePc(extPcs, p.tones.ninth);
  pushUniquePc(extPcs, p.tones.eleventh);
  pushUniquePc(extPcs, p.tones.thirteenth);

  return {
    chordPcs,
    extPcs,
    ninthPc: p.tones.ninth,
    eleventhPc: p.tones.eleventh,
    thirteenthPc: p.tones.thirteenth,
  };
}

// -------------------- Midi placement --------------------

function midiFrom(pc: string, oct: number): number {
  return midiFromPc(pc, oct);
}

function nearestAbove(pc: string, minMidi: number, anchorOct: number): number {
  let m = midiFrom(pc, anchorOct);
  while (m < minMidi) m += 12;
  return m;
}

function midiCandidatesForPc(pc: string, minMidi: number, maxMidi: number) {
  const res: number[] = [];
  for (let oct = 1; oct <= 8; oct++) {
    const midi = midiFrom(pc, oct);
    if (midi >= minMidi && midi <= maxMidi) res.push(midi);
  }
  return res;
}

function naturalBassMidi(pc: string, centerOctave: number) {
  const target = midiFromPc("C", Math.max(1, centerOctave - 1));
  const candidates = midiCandidatesForPc(pc, target - 7, target + 6);
  if (!candidates.length) return midiFrom(pc, Math.max(1, centerOctave - 1));

  return candidates.reduce((best, midi) => {
    const bestScore = Math.abs(best - target) + (best > target ? 2 : 0);
    const score = Math.abs(midi - target) + (midi > target ? 2 : 0);
    return score < bestScore ? midi : best;
  }, candidates[0]);
}

function placePcsCompact(
  pcs: string[],
  minMidi: number,
  centerOctave: number
) {
  const uniquePcs = pcs.filter((pc, idx) => pcs.indexOf(pc) === idx);
  if (!uniquePcs.length) return [];

  const maxMidi = midiFromPc("B", centerOctave + 1);
  const candidateSets = uniquePcs.map((pc) =>
    midiCandidatesForPc(pc, minMidi, maxMidi)
  );
  if (candidateSets.some((set) => !set.length)) return [];

  const target = midiFromPc("G", Math.max(1, centerOctave - 1));
  let best: number[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  const walk = (idx: number, picked: number[]) => {
    if (idx === candidateSets.length) {
      const sorted = [...picked].sort((a, b) => a - b);
      if (new Set(sorted).size !== sorted.length) return;

      const span = sorted[sorted.length - 1] - sorted[0];
      const avg = sorted.reduce((sum, midi) => sum + midi, 0) / sorted.length;
      const gapPenalty = sorted.slice(1).reduce((sum, midi, i) => {
        const gap = midi - sorted[i];
        if (gap <= 1) return sum + 100;
        return sum + Math.max(0, gap - 12) * 3;
      }, 0);
      const score = span * 2 + Math.abs(avg - target) + gapPenalty;

      if (score < bestScore) {
        best = sorted;
        bestScore = score;
      }
      return;
    }

    for (const midi of candidateSets[idx]) {
      walk(idx + 1, [...picked, midi]);
    }
  };

  walk(0, []);
  return best;
}

function clampLowMud(midis: number[], minTop: number) {
  if (midis.length < 2) return midis;
  const sorted = [...midis].sort((a, b) => a - b);
  const top3 = sorted.slice(-3);
  const topMin = Math.min(...top3);
  if (topMin >= minTop) return sorted;

  const delta = 12 * Math.ceil((minTop - topMin) / 12);
  // bass(最下)以外を上げる
  return sorted.map((m, i) => (i === 0 ? m : m + delta));
}

function applyShift(midis: number[], shift: number) {
  if (!shift) return midis;
  return midis.map((m) => m + shift);
}

function closeWideUpperGaps(midis: number[], maxGap: number) {
  const res = [...midis].sort((a, b) => a - b);
  for (let i = 1; i < res.length; i++) {
    while (res[i] - res[i - 1] > maxGap && res[i] - 12 > res[i - 1] + 1) {
      res[i] -= 12;
    }
    while (res[i] <= res[i - 1]) {
      res[i] += 12;
    }
  }
  return res;
}

export function normalizePadRange(midis: number[], centerOctave: number) {
  if (midis.length < 2) return midis;

  const lowBound = midiFromPc("C", Math.max(1, centerOctave - 1));
  const highBound = midiFromPc("B", centerOctave);
  let res = closeWideUpperGaps(midis, 14);

  while (Math.max(...res) > highBound) {
    const topIdx = res.length - 1;
    const loweredTop = res[topIdx] - 12;
    if (loweredTop > res[topIdx - 1] + 1) {
      res = [...res.slice(0, topIdx), loweredTop].sort((a, b) => a - b);
    } else if (Math.min(...res) - 12 >= lowBound - 7) {
      res = res.map((m) => m - 12);
    } else {
      break;
    }
  }

  while (Math.min(...res) < lowBound - 7 && Math.max(...res) + 12 <= highBound + 5) {
    res = res.map((m) => m + 12);
  }

  return closeWideUpperGaps(res, 14);
}

// -------------------- Voicing builders --------------------

function buildClosedFromPcs(anchorPc: string, pcs: string[], centerOctave: number): number[] {
  if (!pcs.length) return [];
  const baseOct = Math.max(1, centerOctave - 1);
  let min = midiFrom(anchorPc, baseOct) - 1;

  const placed: number[] = [];
  for (const pc of pcs) {
    const m = nearestAbove(pc, min + 1, baseOct);
    placed.push(m);
    min = m + 1;
  }
  return placed;
}

type DropKind = "drop2" | "drop3" | "drop24" | "drop4";
function applyDrop(closed: number[], kind: DropKind): number[] {
  // drop は 4声が前提。omit 等で 4未満の場合はそのまま。
  if (closed.length !== 4) return closed;
  const [v1, v2, v3, v4] = closed; // low..high

  // top order: v4(1st), v3(2nd), v2(3rd), v1(4th)
  if (kind === "drop2") return [v1, v2, v3 - 12, v4].sort((a, b) => a - b);
  if (kind === "drop3") return [v1, v2 - 12, v3, v4].sort((a, b) => a - b);
  if (kind === "drop4") return [v1 - 12, v2, v3, v4].sort((a, b) => a - b);
  return [v1 - 12, v2, v3 - 12, v4].sort((a, b) => a - b);
}

function omitOk(deg: keyof OmitFlags, omit?: OmitFlags) {
  if (!omit) return true;
  return !omit[deg];
}

export function buildPadVoicing(
  chordSymbol: string,
  centerOctave: number,
  preset: PadVoicingPreset,
  transposeShift: number,
  opts: VoicingOptions = {}
): VoicingResult | null {
  const p = parseChordSymbol(chordSymbol);
  if (!p) return null;

  const omit = opts.omit;
  const r = p.tones.root ?? p.tonic;
  const t3 = p.tones.third;
  const t5 = p.tones.fifth;
  const t7 = p.tones.seventh;
  const t9 = p.tones.ninth;
  const t11 = p.tones.eleventh;
  const t13 = p.tones.thirteenth;

  const slashBass = p.slashBass;
  const bassPc = slashBass ?? r;

  let midis: number[] = [];

  if (preset === "AUTO_VOICE_BASS") {
    const bass = naturalBassMidi(bassPc, centerOctave);
    const upperPcs = buildAutoUpperPcs(r, t3, t5, t7, t9, t11, t13, omit);
    const upperMidis = placePcsCompact(upperPcs, bass + 3, centerOctave);

    midis = [
      ...(omit?.root && bassPc === r ? [] : [bass]),
      ...upperMidis,
    ];
    midis = clampLowMud(midis, 55);
  }

  if (preset === "PAD_TRIAD_BASS_35R") {
    // bass + 3 - 5 - R'（3/5が無い場合はnotesで補完）
    const bass = naturalBassMidi(bassPc, centerOctave);

    const tmp: number[] = [];
    if (!(omit?.root && bassPc === r)) tmp.push(bass);

    let cursor = tmp.length ? tmp[tmp.length - 1] + 2 : bass - 6;
    if (omitOk("third", omit)) {
      const m3 = nearestAbove(t3 ?? r, cursor, centerOctave - 1);
      tmp.push(m3);
      cursor = m3 + 2;
    }
    if (omitOk("fifth", omit)) {
      const m5 = nearestAbove(t5 ?? r, cursor, centerOctave - 1);
      tmp.push(m5);
      cursor = m5 + 2;
    }
    if (omitOk("root", omit)) {
      const topR = nearestAbove(r, cursor, centerOctave);
      tmp.push(topR);
    }

    midis = tmp;
    midis = clampLowMud(midis, 55);
  }

  if (preset === "DROP2_1357_NO_BASS") {
    // 1-3-5-7 を作って drop（bass無し）
    const pcs: string[] = [];
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("fifth", omit)) pushUniquePc(pcs, t5);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);

    const closed = buildClosedFromPcs(r, pcs, centerOctave);
    midis = applyDrop(closed, "drop2");
    midis = clampLowMud(midis, 58);
  }

  if (preset === "DROP3_1357_NO_BASS") {
    const pcs: string[] = [];
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("fifth", omit)) pushUniquePc(pcs, t5);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);

    const closed = buildClosedFromPcs(r, pcs, centerOctave);
    midis = applyDrop(closed, "drop3");
    midis = clampLowMud(midis, 58);
  }

  if (preset === "DROP24_1357_NO_BASS") {
    const pcs: string[] = [];
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("fifth", omit)) pushUniquePc(pcs, t5);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);

    const closed = buildClosedFromPcs(r, pcs, centerOctave);
    midis = applyDrop(closed, "drop24");
    midis = clampLowMud(midis, 58);
  }

  if (preset === "DROP4_1357_NO_BASS") {
    const pcs: string[] = [];
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("fifth", omit)) pushUniquePc(pcs, t5);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);

    const closed = buildClosedFromPcs(r, pcs, centerOctave);
    midis = applyDrop(closed, "drop4");
    midis = clampLowMud(midis, 58);
  }

  if (preset === "SHELL_R37_NO_BASS") {
    // R-3-7 + (5 or 9)（bass無し）
    // 7th強調で濁りが出やすいので上側に寄せる
    const pcs: string[] = [];
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("seventh", omit) && t7) {
      pushUniquePc(pcs, t7);
      pushUniquePc(pcs, t9);
    } else {
      pushUniquePc(pcs, t5);
      pushUniquePc(pcs, t9);
    }
    let min = midiFrom(r, Math.max(1, centerOctave - 1)) - 1;

    const placed: number[] = [];
    for (const pc of pcs) {
      const m = nearestAbove(pc, min + 1, centerOctave);
      placed.push(m);
      min = m + 1;
    }
    midis = clampLowMud(placed, 60);
  }

  if (preset === "GUIDE_379_NO_BASS") {
    // 3-7-9 + (R)（bass無し / 5th省略）
    const pcs: string[] = [];
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7 ?? t5);
    pushUniquePc(pcs, t9);
    if (omitOk("root", omit)) pushUniquePc(pcs, r);
    let min = midiFrom(r, Math.max(1, centerOctave - 1)) - 1;

    const placed: number[] = [];
    for (const pc of pcs) {
      const m = nearestAbove(pc, min + 1, centerOctave);
      placed.push(m);
      min = m + 1;
    }
    midis = clampLowMud(placed, 60);
  }

  if (preset === "ROOTLESS_37_9_NO_BASS") {
    // 3-7-9-13（bass無し）: 13が無い場合は5thで代用
    const pcs: string[] = [];
    if (omitOk("third", omit)) pushUniquePc(pcs, t3);
    if (omitOk("seventh", omit)) pushUniquePc(pcs, t7);
    pushUniquePc(pcs, t9);
    pushUniquePc(pcs, t13);
    if (pcs.length < 3) pushUniquePc(pcs, t5);
    let min = midiFrom(r, Math.max(1, centerOctave - 1)) - 1;

    const placed: number[] = [];
    for (const pc of pcs) {
      const m = nearestAbove(pc, min + 1, centerOctave);
      placed.push(m);
      min = m + 1;
    }
    midis = clampLowMud(placed, 62);
  }

  if (!midis.length) return null;

  // 移調
  midis = applyShift(midis, transposeShift);
  midis = normalizePadRange(midis, centerOctave);

  const notes = midis.map(midiToNoteName);

  return {
    chordSymbol,
    preset,
    midis,
    notes,
  };
}

export function smoothVoiceLead(prevMidis: number[], currentMidis: number[]) {
  if (!prevMidis.length || !currentMidis.length) return currentMidis;

  const prevSorted = [...prevMidis].sort((a, b) => a - b);
  const curSorted = [...currentMidis].sort((a, b) => a - b);
  let best = curSorted;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let shift = -24; shift <= 24; shift += 12) {
    const shifted = curSorted.map((m) => m + shift);
    const score = shifted.reduce((sum, midi, idx) => {
      const anchor = prevSorted[Math.min(idx, prevSorted.length - 1)];
      return sum + Math.abs(midi - anchor);
    }, 0);

    if (score < bestScore) {
      best = shifted;
      bestScore = score;
    }
  }

  return best;
}

// -------------------- Roman numeral (degree) --------------------

const DEGREE_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

function degreeIntervals(mode: KeySig["mode"]): number[] {
  // “基準”なので自然短音階で固定（実務上はここが一番ブレる）
  return mode === "major"
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
}

function accidentalPrefix(delta: number): string {
  if (delta === -2) return "bb";
  if (delta === -1) return "b";
  if (delta === 1) return "#";
  if (delta === 2) return "##";
  return "";
}

function isSeventhChord(symbol: string): boolean {
  const s = symbol.toLowerCase();
  return /7/.test(s);
}

function isMaj7(symbol: string): boolean {
  const s = symbol.toLowerCase();
  return s.includes("maj7") || s.includes("ma7") || s.includes("Δ7");
}

function qualityToRomanCase(q: Parsed["qualityGuess"], base: string, symbol: string): string {
  const s = symbol.toLowerCase();
  const isHalfDim = s.includes("m7b5") || s.includes("ø");
  const isDim = q === "diminished" || s.includes("dim") || s.includes("o");
  const isAug = q === "augmented" || s.includes("+") || s.includes("aug");

  if (isHalfDim) return base.toLowerCase() + "ø";
  if (isDim) return base.toLowerCase() + "°";
  if (isAug) return base.toUpperCase() + "+";
  if (q === "minor") return base.toLowerCase();
  return base.toUpperCase();
}

/**
 * 解析基準キーに対する “ざっくり実用” の度数表示
 * - 借用/転調/二次ドミナント等は厳密には破綻するが、用途的に「当たりを付ける」には十分
 */
export function romanizeChord(chordSymbol: string, key: KeySig): string {
  const p = parseChordSymbol(chordSymbol);
  if (!p) return "";

  const keySemi = pcToSemitone(key.tonic);
  const chordSemi = pcToSemitone(p.tonic);
  const diff = (chordSemi - keySemi + 12) % 12;

  const baseInts = degreeIntervals(key.mode);

  let bestIdx = 0;
  let bestDelta = 0;
  let bestScore = 999;

  for (let i = 0; i < baseInts.length; i++) {
    const base = baseInts[i];
    const deltaSigned = ((diff - base + 6) % 12) - 6; // -6..+5
    const score = Math.abs(deltaSigned);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
      bestDelta = deltaSigned;
    }
  }

  // accidental は実用上 -2..+2 に切る（それ以上は表記として破綻しやすい）
  const clipped = Math.max(-2, Math.min(2, bestDelta));
  const acc = accidentalPrefix(clipped);

  const baseRoman = DEGREE_ROMAN[bestIdx];
  const romanWithQuality = qualityToRomanCase(p.qualityGuess, baseRoman, p.core);

  // 7th表示は最低限（濃くし過ぎない）
  let ext = "";
  if (isMaj7(p.core)) ext = "Δ7";
  else if (isSeventhChord(p.core)) ext = "7";

  return `${acc}${romanWithQuality}${ext}`;
}
