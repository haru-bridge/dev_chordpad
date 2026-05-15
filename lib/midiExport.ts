export type MidiChord = {
  name: string;
  midis: number[];
};

export type MidiExportOptions = {
  bpm?: number;
  ticksPerChord?: number;
  strumTicks?: number;
};

type MidiEvent = {
  tick: number;
  order: number;
  bytes: number[];
};

const PPQ = 480;

function textBytes(text: string) {
  return Array.from(new TextEncoder().encode(text));
}

function uint32(value: number) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function uint16(value: number) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function variableLength(value: number) {
  let buffer = value & 0x7f;
  const bytes: number[] = [];

  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }

  return bytes;
}

function chunk(id: string, data: number[]) {
  return [...textBytes(id), ...uint32(data.length), ...data];
}

function tempoEvent(bpm: number) {
  const microsPerQuarter = Math.round(60_000_000 / bpm);
  return [
    0x00,
    0xff,
    0x51,
    0x03,
    (microsPerQuarter >>> 16) & 0xff,
    (microsPerQuarter >>> 8) & 0xff,
    microsPerQuarter & 0xff,
  ];
}

function trackNameEvent(name: string) {
  const bytes = textBytes(name).slice(0, 80);
  return [0x00, 0xff, 0x03, ...variableLength(bytes.length), ...bytes];
}

export function buildChordMidiFile(
  chords: MidiChord[],
  options: MidiExportOptions = {}
) {
  const bpm = options.bpm ?? 108;
  const ticksPerChord = options.ticksPerChord ?? PPQ * 2;
  const strumTicks = options.strumTicks ?? 8;
  const events: MidiEvent[] = [];

  chords.forEach((chord, chordIdx) => {
    const start = chordIdx * ticksPerChord;
    const duration = Math.round(ticksPerChord * 0.82);
    const midis = chord.midis
      .filter((midi) => Number.isFinite(midi))
      .map((midi) => Math.max(0, Math.min(127, Math.round(midi))));

    midis.forEach((midi, noteIdx) => {
      const offset = noteIdx * strumTicks;
      events.push({
        tick: start + offset,
        order: 1,
        bytes: [0x90, midi, 84],
      });
      events.push({
        tick: start + duration + offset,
        order: 0,
        bytes: [0x80, midi, 0],
      });
    });
  });

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [
    ...tempoEvent(bpm),
    ...trackNameEvent("ChordPad progression"),
  ];
  let cursor = 0;

  for (const event of events) {
    track.push(...variableLength(Math.max(0, event.tick - cursor)));
    track.push(...event.bytes);
    cursor = event.tick;
  }

  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = chunk("MThd", [
    ...uint16(0),
    ...uint16(1),
    ...uint16(PPQ),
  ]);
  return new Uint8Array([...header, ...chunk("MTrk", track)]);
}
