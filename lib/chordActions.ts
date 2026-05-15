export type ChordTransformId =
  | "triads"
  | "sevenths"
  | "add9"
  | "sus4"
  | "soft_color";

export type ChordTransform = {
  id: ChordTransformId;
  label: string;
};

export const CHORD_TRANSFORMS: ChordTransform[] = [
  { id: "triads", label: "Triad" },
  { id: "sevenths", label: "7th" },
  { id: "add9", label: "Add9" },
  { id: "sus4", label: "Sus" },
  { id: "soft_color", label: "Color" },
];

type ParsedChordSymbol = {
  root: string;
  suffix: string;
  slash: string;
};

function parseChordSymbol(symbol: string): ParsedChordSymbol | null {
  const trimmed = symbol.trim();
  const match = trimmed.match(/^([A-Ga-g][b#]?)(.*?)(\/[A-Ga-g][b#]?)?$/);
  if (!match) return null;

  const [, rootRaw, suffixRaw, slashRaw] = match;
  const root = rootRaw.charAt(0).toUpperCase() + rootRaw.slice(1);
  return {
    root,
    suffix: suffixRaw ?? "",
    slash: slashRaw ?? "",
  };
}

function isMinorSuffix(suffix: string) {
  const s = suffix.toLowerCase();
  return s.startsWith("m") && !s.startsWith("maj");
}

function hasSeventhOrMore(suffix: string) {
  return /(maj7|m7b5|dim7|7|6|9|11|13)/i.test(suffix);
}

function stripToTriadSuffix(suffix: string) {
  const s = suffix.toLowerCase();
  if (s.includes("sus2")) return "sus2";
  if (s.includes("sus4") || s.includes("sus")) return "sus4";
  if (s.includes("dim") || s.includes("ø") || s.includes("m7b5")) return "dim";
  if (s.includes("aug") || suffix.includes("+")) return "aug";
  if (isMinorSuffix(suffix)) return "m";
  return "";
}

function withSeventhSuffix(suffix: string) {
  if (hasSeventhOrMore(suffix)) return suffix;
  if (suffix.includes("sus")) return `${suffix}7`;
  if (suffix.includes("dim")) return "m7b5";
  if (isMinorSuffix(suffix)) return "m7";
  return "maj7";
}

function withAdd9Suffix(suffix: string) {
  const s = suffix.toLowerCase();
  if (s.includes("9") || s.includes("11") || s.includes("13")) return suffix;
  if (/^maj7$/i.test(suffix)) return "maj9";
  if (/^m7$/i.test(suffix)) return "m9";
  if (/^7$/i.test(suffix)) return "9";
  if (suffix.includes("sus")) return `${suffix}add9`;
  if (isMinorSuffix(suffix)) return "madd9";
  if (!suffix) return "add9";
  return `${suffix}add9`;
}

function softColorSuffix(suffix: string) {
  const s = suffix.toLowerCase();
  if (s.includes("dim") || s.includes("ø") || s.includes("m7b5")) return "m7b5";
  if (s.includes("sus")) return withAdd9Suffix(withSeventhSuffix(suffix));
  if (/^maj7$/i.test(suffix)) return "maj9";
  if (/^m7$/i.test(suffix)) return "m9";
  if (/^7$/i.test(suffix)) return "13";
  if (isMinorSuffix(suffix)) return "m9";
  return "maj9";
}

export function transformChordSymbol(
  symbol: string,
  transform: ChordTransformId
) {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return symbol;

  const { root, suffix, slash } = parsed;
  const nextSuffix =
    transform === "triads"
      ? stripToTriadSuffix(suffix)
      : transform === "sevenths"
        ? withSeventhSuffix(suffix)
        : transform === "add9"
          ? withAdd9Suffix(suffix)
          : transform === "sus4"
            ? "sus4"
            : softColorSuffix(suffix);

  return `${root}${nextSuffix}${slash}`;
}

export function transformChordSymbols(
  symbols: string[],
  transform: ChordTransformId
) {
  return symbols.map((symbol) => transformChordSymbol(symbol, transform));
}
