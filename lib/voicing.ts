import * as Tone from "tone";
import { Chord } from "tonal";

/**
 * 目的：
 * - 入力された chordSymbol（例: F/G）を解析
 * - Pad preset に応じて “それっぽい” 4声くらいのvoicingを作る
 * - 再生キー差分（shift semitone）で midi をまとめて移調
 * - 度数（ローマ数字）は別関数 romanizeChord で表示（解析基準キーに対して）
 */

export type KeySig = { tonic: string; mode: "major" | "minor" };

export type PadVoicingPreset =
  | "PAD_TRIAD_BASS_35R"
  | "DROP2_1357_NO_BASS"
  | "SHELL_R37_NO_BASS"
  | "GUIDE_379_NO_BASS"
  | "ROOTLESS_37_9_NO_BASS";

export const PAD_PRESETS: { id: PadVoicingPreset; label: string }[] = [
  { id: "PAD_TRIAD_BASS_35R", label: "PAD (Triad) = bass + 3-5-R’" },
  { id: "DROP2_1357_NO_BASS", label: "Drop2 = 1-3-5-7 (no bass)" },
  { id: "SHELL_R37_NO_BASS", label: "Shell = R-3-7 (no bass)" },
  { id: "GUIDE_379_NO_BASS", label: "Guide = 3-7-9(+R) (no bass)" },
  { id: "ROOTLESS_37_9_NO_BASS", label: "Rootless = 3-7-9-13 (no bass)" },
];

export type VoicingResult = {
  chordSymbol: string;
  preset: PadVoicingPreset;
  midis: number[];
  notes: string[];
};

// -------------------- Pitch-class utils --------------------

const LETTER_BASE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function normalizePc(pc: string): string {
  const s = pc.trim().replace("♭", "b").replace("♯", "#");
  const head = s.charAt(0).toUpperCase();
  const tail = s.slice(1);
  return head + tail;
}

function pcToSemitone(pc: string): number {
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
  qualityGuess: "major" | "minor" | "diminished" | "augmented";
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

  return {
    core,
    slashBass: slash,
    tonic,
    notes,
    qualityGuess: guessQuality(core, c.quality),
  };
}

// chord tones helper
function toneAt(p: Parsed, idx: number): string | null {
  return p.notes[idx] ?? null;
}
function rootPc(p: Parsed) { return p.tonic; }
function thirdPc(p: Parsed) { return toneAt(p, 1); }
function fifthPc(p: Parsed) { return toneAt(p, 2); }
function seventhPc(p: Parsed) { return toneAt(p, 3); }
function ninthPc(p: Parsed) { return toneAt(p, 4); }
function thirteenthPc(p: Parsed) { return toneAt(p, 6) ?? null; } // 13thは構造上遠いので無ければnull

// -------------------- Midi placement --------------------

function midiFrom(pc: string, oct: number): number {
  return Tone.Frequency(`${pc}${oct}`).toMidi();
}

function nearestAbove(pc: string, minMidi: number, anchorOct: number): number {
  let m = midiFrom(pc, anchorOct);
  while (m < minMidi) m += 12;
  return m;
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

// -------------------- Voicing builders --------------------

function buildClosed1357(p: Parsed, centerOctave: number): number[] {
  const r = rootPc(p);
  const t3 = thirdPc(p) ?? r;
  const t5 = fifthPc(p) ?? r;
  const t7 = seventhPc(p) ?? r;

  // closed: r(低) 3 5 7（centerOctave-1 を起点にする）
  const baseOct = Math.max(1, centerOctave - 1);
  const min = midiFrom(r, baseOct) - 1;

  const rM = nearestAbove(r, min + 1, baseOct);
  const m3 = nearestAbove(t3, rM + 1, baseOct);
  const m5 = nearestAbove(t5, m3 + 1, baseOct);
  const m7 = nearestAbove(t7, m5 + 1, baseOct);

  return [rM, m3, m5, m7];
}

function drop2FromClosed(closed: number[]): number[] {
  if (closed.length !== 4) return closed;
  // closed [v1 v2 v3 v4] (low..high)
  // drop2: 2nd highest (v3) を 1oct 下げる
  const [v1, v2, v3, v4] = closed;
  const v3d = v3 - 12;
  const res = [v1, v2, v3d, v4].sort((a, b) => a - b);
  return res;
}

export function buildPadVoicing(
  chordSymbol: string,
  centerOctave: number,
  preset: PadVoicingPreset,
  transposeShift: number
): VoicingResult | null {
  const p = parseChordSymbol(chordSymbol);
  if (!p) return null;

  const r = rootPc(p);
  const t3 = thirdPc(p);
  const t5 = fifthPc(p);
  const t7 = seventhPc(p);
  const t9 = ninthPc(p);
  const t13 = thirteenthPc(p);

  const slashBass = p.slashBass;
  const bassPc = slashBass ?? r;

  let midis: number[] = [];

  if (preset === "PAD_TRIAD_BASS_35R") {
    // bass + 3 - 5 - R'（3/5が無い場合はnotesで補完）
    const bassOct = Math.max(1, centerOctave - 2);
    const bass = midiFrom(bassPc, bassOct);

    let min = bass + 2;
    const m3 = nearestAbove(t3 ?? r, min, centerOctave - 1);
    min = m3 + 2;
    const m5 = nearestAbove(t5 ?? r, min, centerOctave - 1);
    min = m5 + 2;
    const topR = nearestAbove(r, min, centerOctave);

    midis = [bass, m3, m5, topR];
    midis = clampLowMud(midis, 55);
  }

  if (preset === "DROP2_1357_NO_BASS") {
    // 1-3-5-7 を作って drop2（bass無し）
    const closed = buildClosed1357(p, centerOctave);
    midis = drop2FromClosed(closed);
    midis = clampLowMud(midis, 58);
  }

  if (preset === "SHELL_R37_NO_BASS") {
    // R-3-7 + (5 or 9)（bass無し）
    // 7th強調で濁りが出やすいので上側に寄せる
    const pcs = [r, t3 ?? r, t7 ?? (t5 ?? r), t9 ?? (t5 ?? r)];
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
    const pcs = [t3 ?? r, t7 ?? (t5 ?? r), t9 ?? (t5 ?? r), r];
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
    const pcs = [t3 ?? r, t7 ?? (t5 ?? r), t9 ?? (t5 ?? r), t13 ?? (t5 ?? r)];
    let min = midiFrom(r, Math.max(1, centerOctave - 1)) - 1;

    const placed: number[] = [];
    for (const pc of pcs) {
      const m = nearestAbove(pc, min + 1, centerOctave);
      placed.push(m);
      min = m + 1;
    }
    midis = clampLowMud(placed, 62);
  }

  // 移調
  midis = applyShift(midis, transposeShift);

  const notes = midis.map((m) => Tone.Frequency(m, "midi").toNote());

  return {
    chordSymbol,
    preset,
    midis,
    notes,
  };
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
