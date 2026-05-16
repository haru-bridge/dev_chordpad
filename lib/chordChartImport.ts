export type ChordChartExtraction = {
  chords: string[];
  text: string;
};

type ExtractChordOptions = {
  maxChords?: number;
  allowSingleChordLines?: boolean;
};

const DEFAULT_MAX_CHORDS = 128;
const ROOT_SRC = String.raw`[A-Ga-g](?:#|b)?`;
const SUFFIX_SRC = String.raw`(?:(?:maj|min|mi|dim|aug|sus|add|omit|no|M|m)|[0-9#b+\-()])*`;
const ON_NOTATION_RE = new RegExp(
  String.raw`\b(${ROOT_SRC}${SUFFIX_SRC})\s+on\s+(${ROOT_SRC})\b`,
  "gi"
);
const COMPACT_ON_RE = new RegExp(
  String.raw`^(${ROOT_SRC}${SUFFIX_SRC})on(${ROOT_SRC})$`,
  "i"
);

function normalizeCommonText(input: string) {
  return input
    .normalize("NFKC")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/[△Δ]/g, "maj")
    .replace(/／/g, "/")
    .replace(/\r\n?/g, "\n");
}

function trimTokenPunctuation(input: string) {
  return input
    .replace(/^[\s"'`([{<【「『]+/g, "")
    .replace(/[\s"'`.,;:!?。、「」『』\])}>】]+$/g, "");
}

function hasInvalidSuffixLetters(suffix: string) {
  const leftovers = suffix
    .replace(/maj|min|mi|dim|aug|sus|add|omit|no/gi, "")
    .replace(/[MmIlTø°0-9#b+\-()]/g, "");
  return leftovers.length > 0;
}

function normalizeSuffix(suffix: string) {
  let next = suffix.replace(/[()]/g, "");
  next = next.replace(/(maj|[mM])[IlT]$/i, (_, prefix: string) => `${prefix}7`);
  next = next.replace(/△|Δ/g, "maj");
  next = next.replace(/^M(?=\d|$)/, "maj");
  next = next.replace(/^min/i, "m");
  next = next.replace(/^mi/i, "m");
  next = next.replace(/^-(?=\d|$)/, "m");
  next = next.replace(/ø7?/gi, "m7b5");
  next = next.replace(/°/g, "dim");
  next = next.replace(/^MAJ/i, "maj");
  return next;
}

export function normalizeChordSymbol(input: string): string | null {
  let token = trimTokenPunctuation(normalizeCommonText(input));
  if (!token) return null;
  if (/^(?:N\.?C\.?|NC|休符|-+)$/i.test(token)) return null;

  const compactOn = token.match(COMPACT_ON_RE);
  if (compactOn) token = `${compactOn[1]}/${compactOn[2]}`;

  const match = token.match(
    /^([A-Ga-g])([#b]?)([^/\s]*)(?:\/([A-Ga-g])([#b]?))?$/
  );
  if (!match) return null;

  const [, rootLetter, rootAccidental, suffixRaw, bassLetter, bassAccidental] =
    match;
  if (hasInvalidSuffixLetters(suffixRaw)) return null;

  const root = `${rootLetter.toUpperCase()}${rootAccidental}`;
  const suffix = normalizeSuffix(suffixRaw);
  const bass = bassLetter
    ? `/${bassLetter.toUpperCase()}${bassAccidental ?? ""}`
    : "";

  return `${root}${suffix}${bass}`;
}

export function normalizeChordInputText(input: string) {
  return normalizeCommonText(input)
    .replace(ON_NOTATION_RE, "$1/$2")
    .replace(/[|｜,，、]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isMetaLine(line: string) {
  return /(key|キー|capo|カポ|bpm|動画|再生|artist|title|作詞|作曲|原曲|移調|transpose|copyright|閉じる|設定)/i.test(
    line
  );
}

function isSectionLabelLine(line: string) {
  const compact = line.replace(/\s+/g, "");
  return /^[A-G]?(?:メロ|サビ|イントロ|アウトロ|間奏|verse|chorus|intro|outro|bridge|hook|ending)$/i.test(
    compact
  );
}

function isIgnorableToken(token: string) {
  if (!token) return true;
  if (/^\|+$/.test(token)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(token)) return true;
  if (/^\d+(?:\.\d+)?$/.test(token)) return true;
  if (/^x\d+$/i.test(token)) return true;
  if (/^(key|capo|bpm|on)$/i.test(token)) return true;
  if (/^(メロ|サビ|イントロ|アウトロ|間奏)$/i.test(token)) return true;
  return false;
}

function tokenPartsForLine(line: string) {
  return line
    .replace(ON_NOTATION_RE, "$1/$2")
    .replace(/[\[\]{}<>【】「」『』]/g, " ")
    .replace(/[|｜]/g, " | ")
    .replace(/[,\u3001，;]/g, " ")
    .split(/\s+/)
    .map(trimTokenPunctuation)
    .filter(Boolean);
}

function extractChordLine(line: string, options: ExtractChordOptions = {}) {
  const normalized = normalizeCommonText(line).trim();
  if (!normalized) return [] as string[];
  if (isMetaLine(normalized) || isSectionLabelLine(normalized)) return [];

  const hadBars = /[|｜]/.test(normalized);
  const hadBracketedChord = /\[[^\]]+\]/.test(normalized);
  const parts = tokenPartsForLine(normalized);
  const chords = parts
    .map((part) => normalizeChordSymbol(part))
    .filter((symbol): symbol is string => Boolean(symbol));

  if (!chords.length) return [];
  if (chords.length >= 2) return chords;

  const meaningfulParts = parts.filter((part) => !isIgnorableToken(part));
  if (options.allowSingleChordLines && meaningfulParts.length <= 1) return chords;
  if (hadBars || hadBracketedChord || meaningfulParts.length <= 1) return chords;

  return [];
}

export function extractChordSymbols(
  input: string,
  options: ExtractChordOptions = {}
) {
  const maxChords = options.maxChords ?? DEFAULT_MAX_CHORDS;
  const chords: string[] = [];

  for (const line of normalizeCommonText(input).split("\n")) {
    for (const chord of extractChordLine(line, options)) {
      chords.push(chord);
      if (chords.length >= maxChords) return chords;
    }
  }

  return chords;
}

export function extractChordChart(
  input: string,
  options: ExtractChordOptions = {}
): ChordChartExtraction {
  const chords = extractChordSymbols(input, options);
  return {
    chords,
    text: chords.join(" "),
  };
}

export function extractOcrChordChart(
  input: string,
  options: ExtractChordOptions = {}
): ChordChartExtraction {
  const strict = extractChordSymbols(input, options);
  const relaxed = extractChordSymbols(input, {
    ...options,
    allowSingleChordLines: true,
  });
  const chords = relaxed.length > Math.max(strict.length + 2, strict.length * 1.5)
    ? relaxed
    : strict.length
      ? strict
      : relaxed;

  return {
    chords,
    text: chords.join(" "),
  };
}
