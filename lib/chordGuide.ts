// lib/chordGuide.ts
import { Chord } from "tonal";
import { toFlatPc } from "./chordSuggest";

export type ChordGuideOptions = {
  add9?: boolean;
  add11?: boolean;
  add13?: boolean;
};

function coreSymbol(symbol: string) {
  // "F/G" -> "F"
  return symbol.trim().split("/")[0].trim();
}

function uniq(list: string[]) {
  return Array.from(new Set(list.filter(Boolean)));
}

/**
 * “コード基準”のガイド用 pitch class を返す
 * - chordPcs: 1,3,5,7（存在する分だけ）
 * - extPcs: 9,11,13（存在し、かつONのものだけ）
 *
 * ※available-note理論（スケール推定等）は入れない。まずは安全側。
 */
export function getChordGuidePcs(
  chordSymbol: string,
  opts: ChordGuideOptions = {}
) {
  const c = Chord.get(coreSymbol(chordSymbol));
  if (!c?.tonic) return { chordPcs: [] as string[], extPcs: [] as string[] };

  const notes = (c.notes ?? []).map(toFlatPc);

  const chordPcs = uniq([notes[0], notes[1], notes[2], notes[3]]);

  const ext: string[] = [];
  if (opts.add9 && notes[4]) ext.push(notes[4]);
  if (opts.add11 && notes[5]) ext.push(notes[5]);
  if (opts.add13 && notes[6]) ext.push(notes[6]);

  const chordSet = new Set(chordPcs);
  const extPcs = uniq(ext).filter((pc) => !chordSet.has(pc));

  return { chordPcs, extPcs };
}
