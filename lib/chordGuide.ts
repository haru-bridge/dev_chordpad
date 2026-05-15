// lib/chordGuide.ts
import { toFlatPc } from "./chordSuggest";
import { getChordToneGroups } from "./voicing";

export type ChordGuideOptions = {
  add9?: boolean;
  add11?: boolean;
  add13?: boolean;
};

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
  const groups = getChordToneGroups(chordSymbol);
  const chordPcs = uniq(groups.chordPcs.map(toFlatPc));
  const ext: string[] = [];
  if (opts.add9 && groups.ninthPc) ext.push(toFlatPc(groups.ninthPc));
  if (opts.add11 && groups.eleventhPc) ext.push(toFlatPc(groups.eleventhPc));
  if (opts.add13 && groups.thirteenthPc) ext.push(toFlatPc(groups.thirteenthPc));

  const chordSet = new Set(chordPcs);
  const extPcs = uniq(ext).filter((pc) => !chordSet.has(pc));

  return { chordPcs, extPcs };
}
