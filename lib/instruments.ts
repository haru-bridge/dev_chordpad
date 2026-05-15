export type InstrumentId =
  | "soft_keys"
  | "warm_pad"
  | "glass_fm"
  | "pluck"
  | "organ"
  | "chip_8bit";

export type InstrumentPreset = {
  id: InstrumentId;
  label: string;
  shortLabel: string;
  character: string;
};

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  {
    id: "soft_keys",
    label: "Soft Keys",
    shortLabel: "Keys",
    character: "round FM keys",
  },
  {
    id: "warm_pad",
    label: "Warm Pad",
    shortLabel: "Pad",
    character: "slow, wide, sustained",
  },
  {
    id: "glass_fm",
    label: "Glass FM",
    shortLabel: "Glass",
    character: "clean glass bell",
  },
  {
    id: "pluck",
    label: "Pluck",
    shortLabel: "Pluck",
    character: "snappy filtered string",
  },
  {
    id: "organ",
    label: "Organ",
    shortLabel: "Organ",
    character: "steady drawbar-like",
  },
  {
    id: "chip_8bit",
    label: "8-bit Chip",
    shortLabel: "8-bit",
    character: "arcade square lead",
  },
];

export function instrumentLabel(id: InstrumentId) {
  return INSTRUMENT_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}
