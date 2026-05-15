// app/dev/page.tsx  (※パスはあなたの実ファイル構成に合わせて調整)
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PolySynth, ToneAudioNode } from "tone";
import {
  buildPadVoicing,
  describeChordToneSummary,
  PadVoicingPreset,
  PAD_PRESETS,
  normalizePadRange,
  romanizeChord,
  type KeySig,
  signedSemitoneDiff,
  smoothVoiceLead,
  type OmitFlags,
} from "../lib/voicing";
import { PianoKeyboard } from "../app/PianoKeyboard";
import {
  INSTRUMENT_PRESETS,
  instrumentLabel,
  type InstrumentId,
} from "../lib/instruments";
import { midiFromPc, midiToNoteName } from "../lib/musicNote";
import {
  matchesProgressionMood,
  PROGRESSION_CATEGORIES,
  PROGRESSION_MOODS,
  PROGRESSION_PRESETS,
  SECTION_SHAPES,
  generateSectionChords,
  progressionMoods,
  progressionToChords,
  romanTokenToChord,
  suggestNextRomans,
  type ProgressionCategory,
  type ProgressionMood,
  type ProgressionPreset,
  type SectionShapeId,
} from "../lib/progressions";
import {
  CHORD_TRANSFORMS,
  transformChordSymbols,
  type ChordTransformId,
} from "../lib/chordActions";
import { buildChordMidiFile } from "../lib/midiExport";

import {
  buildNoteEvents,
  type PerformanceSettings,
  type StrumDirection,
} from "../lib/performance";

import { suggestChordsFromPc, toFlatPc } from "../lib/chordSuggest";
import { getChordGuidePcs } from "../lib/chordGuide";

type LogRow = {
  t: string;
  chord: string;
  roman?: string;
  preset: PadVoicingPreset;
  instrument: InstrumentId;
  notes: string[];
  midis: number[];
  shift: number;
  perf: PerformanceSettings;
};

const MAX_PADS = 16;
const PAD_KEY_LAYOUT = [
  "1",
  "2",
  "3",
  "4",
  "q",
  "w",
  "e",
  "r",
  "a",
  "s",
  "d",
  "f",
  "z",
  "x",
  "c",
  "v",
] as const;
const STORAGE_KEY = "chordpad.settings.v2";
const DEFAULT_CENTER_OCTAVE = 5;

const KEY_ROOTS = [
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

type KeyRoot = (typeof KEY_ROOTS)[number];
type KeyMode = "major" | "minor";
type ProgressionCategoryFilter = ProgressionCategory | "All";

function nowStr() {
  return new Date().toLocaleTimeString();
}

type HoldState = {
  notes: string[];
};

type ToneModule = typeof import("tone");

type AudioNodeRef = ToneAudioNode;
type AudioSynthRef = PolySynth;

type NoteHoldState = {
  count: number;
  attackId: number | null;
  sounding: boolean;
};

export default function Page() {
  // --- core input ---
  const [text, setText] = useState("Dbm7 C7 Fm7 Bb7 Ab7 Bbm7 Cm7 F/G F7");

  // --- key settings (analysis vs playback) ---
  const [analysisRoot, setAnalysisRoot] = useState<KeyRoot>("C");
  const [analysisMode, setAnalysisMode] = useState<KeyMode>("major");
  const [playRoot, setPlayRoot] = useState<KeyRoot>("C");
  const [playMode, setPlayMode] = useState<KeyMode>("major");

  // --- voicing ---
  const [centerOctave, setCenterOctave] = useState(DEFAULT_CENTER_OCTAVE);
  const [voiceLead, setVoiceLead] = useState(true);

  // --- sound ---
  const [instrument, setInstrument] = useState<InstrumentId>("soft_keys");
  const [latchMode, setLatchMode] = useState(false);
  const [sustainDown, setSustainDown] = useState(false);
  const [progressionCategory, setProgressionCategory] =
    useState<ProgressionCategoryFilter>("All");
  const [progressionMood, setProgressionMood] =
    useState<ProgressionMood>("All");
  const [progressionSearch, setProgressionSearch] = useState("");
  const [sectionBars, setSectionBars] = useState(8);
  const [sectionShape, setSectionShape] = useState<SectionShapeId>("story");
  const [shareStatus, setShareStatus] = useState("");

  // --- per pad preset ---
  const [padPresets, setPadPresets] = useState<PadVoicingPreset[]>(() =>
    Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS")
  );

  const [padOmits, setPadOmits] = useState<OmitFlags[]>(() =>
    Array.from({ length: MAX_PADS }, () => ({
      root: false,
      third: false,
      fifth: false,
      seventh: false,
    }))
  );

  const setPadPresetAt = (i: number, p: PadVoicingPreset) => {
    setPadPresets((prev) => prev.map((v, idx) => (idx === i ? p : v)));
  };

  const setPadOmitAt = (i: number, patch: Partial<OmitFlags>) => {
    setPadOmits((prev) =>
      prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v))
    );
  };

  // --- performance ---
  const [perf, setPerf] = useState<PerformanceSettings>({
    playMode: "chord",
    strumMs: 20,
    direction: "up",
    arpPattern: "up",
    arpStepMs: 90,
    arpGate: 0.85,
    timingJitterMs: 2,
    velocityHumanize: 0.06,
    baseVelocity: 0.75,
    topBoost: 0.18,
  });

  // --- logs ---
  const [logs, setLogs] = useState<LogRow[]>([]);

  // --- audio refs ---
  const toneRef = useRef<ToneModule | null>(null);
  const synthRef = useRef<AudioSynthRef | null>(null);
  const limiterRef = useRef<AudioNodeRef | null>(null);
  const fxRefs = useRef<AudioNodeRef[]>([]);
  const audioReadyRef = useRef(false);

  // hold state (multi-press allowed): cancelable schedule per pad idx
  const activeHoldRef = useRef<Record<number, HoldState>>({});
  const noteHoldsRef = useRef<Record<string, NoteHoldState>>({});
  const sustainedPadsRef = useRef<Set<number>>(new Set());
  const latchModeRef = useRef(latchMode);
  const sustainDownRef = useRef(sustainDown);
  const instrumentRef = useRef(instrument);
  const [activePadIndices, setActivePadIndices] = useState<number[]>([]);

  // -------------------------
  // Keyboard visualizer state
  // -------------------------
  const [activeMidis, setActiveMidis] = useState<number[]>([]);
  const holdMidisRef = useRef<Record<number, number[]>>({});
  const oneShotMidisRef = useRef<number[]>([]);
  const oneShotTimerRef = useRef<number | null>(null);

  const rafSyncRef = useRef<number | null>(null);
  const requestSyncActiveMidis = () => {
    if (rafSyncRef.current != null) return;
    rafSyncRef.current = window.requestAnimationFrame(() => {
      rafSyncRef.current = null;
      const u = new Set<number>();
      for (const arr of Object.values(holdMidisRef.current)) {
        for (const m of arr) u.add(m);
      }
      for (const m of oneShotMidisRef.current) u.add(m);
      setActiveMidis(Array.from(u).sort((a, b) => a - b));
    });
  };

  // -------------------------
  // Keyboard picker state
  // -------------------------
  const [pickedMidi, setPickedMidi] = useState<number | null>(null);

  // -------------------------
  // Scale guide state
  // -------------------------
  const [guideEnabled, setGuideEnabled] = useState(true);
  const [guidePadIdx, setGuidePadIdx] = useState(0);
  const [guide9, setGuide9] = useState(true);
  const [guide11, setGuide11] = useState(false);
  const [guide13, setGuide13] = useState(false);

  // -------------------------
  // Dock UI state
  // -------------------------
  const [dockOpen, setDockOpen] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const analysisKey: KeySig = useMemo(
    () => ({ tonic: analysisRoot, mode: analysisMode }),
    [analysisRoot, analysisMode]
  );

  const playKey: KeySig = useMemo(
    () => ({ tonic: playRoot, mode: playMode }),
    [playRoot, playMode]
  );

  const shift = useMemo(
    () => signedSemitoneDiff(analysisKey.tonic, playKey.tonic),
    [analysisKey.tonic, playKey.tonic]
  );

  const chordSymbols = useMemo(() => {
    const items = text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return items.slice(0, MAX_PADS);
  }, [text]);

  const padModels = useMemo(() => {
    let prevMidis: number[] = [];

    return Array.from({ length: MAX_PADS }, (_, i) => {
      const chord = chordSymbols[i] ?? "";
      const preset = padPresets[i] ?? "AUTO_VOICE_BASS";
      const omit = padOmits[i] ?? {};

      if (!chord) {
        return {
          idx: i,
          chord: "",
          roman: "",
          preset,
          notes: [] as string[],
          midis: [] as number[],
          ok: false,
          omit,
          toneSummary: "",
        };
      }

      const v = buildPadVoicing(chord, centerOctave, preset, shift, { omit });
      const toneSummary = describeChordToneSummary(chord);
      const rawMidis =
        voiceLead && v ? smoothVoiceLead(prevMidis, v.midis) : v?.midis ?? [];
      const ledMidis = normalizePadRange(rawMidis, centerOctave);
      if (ledMidis.length) prevMidis = ledMidis;
      const roman = romanizeChord(chord, analysisKey);

      return {
        idx: i,
        chord,
        roman,
        preset,
        notes: ledMidis.map(midiToNoteName),
        midis: ledMidis,
        ok: Boolean(v),
        omit,
        toneSummary,
      };
    });
  }, [
    chordSymbols,
    padPresets,
    padOmits,
    centerOctave,
    shift,
    analysisKey,
    voiceLead,
  ]);

  // keep latest models/perf/shift in refs for stable event handlers
  const padModelsRef = useRef(padModels);
  const perfRef = useRef(perf);
  const shiftRef = useRef(shift);

  useEffect(() => {
    padModelsRef.current = padModels;
  }, [padModels]);
  useEffect(() => {
    perfRef.current = perf;
  }, [perf]);
  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);
  useEffect(() => {
    latchModeRef.current = latchMode;
  }, [latchMode]);
  useEffect(() => {
    sustainDownRef.current = sustainDown;
  }, [sustainDown]);
  useEffect(() => {
    instrumentRef.current = instrument;
  }, [instrument]);

  const syncActivePads = () => {
    setActivePadIndices(
      Object.keys(activeHoldRef.current)
        .map(Number)
        .sort((a, b) => a - b)
    );
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedText = params.get("c");

      if (sharedText) {
        setText(sharedText);
        if (KEY_ROOTS.includes(params.get("ak") as KeyRoot)) {
          setAnalysisRoot(params.get("ak") as KeyRoot);
        }
        if (params.get("am") === "major" || params.get("am") === "minor") {
          setAnalysisMode(params.get("am") as KeyMode);
        }
        if (KEY_ROOTS.includes(params.get("pk") as KeyRoot)) {
          setPlayRoot(params.get("pk") as KeyRoot);
        }
        if (params.get("pm") === "major" || params.get("pm") === "minor") {
          setPlayMode(params.get("pm") as KeyMode);
        }
        const oct = Number(params.get("oct"));
        if (Number.isFinite(oct)) setCenterOctave(Math.max(4, Math.min(6, oct)));
        if (params.get("vl") === "0") setVoiceLead(false);
        if (INSTRUMENT_PRESETS.some((preset) => preset.id === params.get("inst"))) {
          setInstrument(params.get("inst") as InstrumentId);
        }
        return;
      }

      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;

      if (typeof saved.text === "string") setText(saved.text);
      if (KEY_ROOTS.includes(saved.analysisRoot as KeyRoot)) {
        setAnalysisRoot(saved.analysisRoot as KeyRoot);
      }
      if (saved.analysisMode === "major" || saved.analysisMode === "minor") {
        setAnalysisMode(saved.analysisMode);
      }
      if (KEY_ROOTS.includes(saved.playRoot as KeyRoot)) {
        setPlayRoot(saved.playRoot as KeyRoot);
      }
      if (saved.playMode === "major" || saved.playMode === "minor") {
        setPlayMode(saved.playMode);
      }
      if (typeof saved.centerOctave === "number") {
        setCenterOctave(Math.max(4, Math.min(6, saved.centerOctave)));
      }
      if (typeof saved.voiceLead === "boolean") setVoiceLead(saved.voiceLead);
      if (
        INSTRUMENT_PRESETS.some((preset) => preset.id === saved.instrument)
      ) {
        setInstrument(saved.instrument as InstrumentId);
      }
      if (typeof saved.latchMode === "boolean") {
        setLatchMode(saved.latchMode);
      }
      if (
        saved.progressionCategory === "All" ||
        PROGRESSION_CATEGORIES.includes(saved.progressionCategory as ProgressionCategory)
      ) {
        setProgressionCategory(saved.progressionCategory as ProgressionCategoryFilter);
      }
      if (PROGRESSION_MOODS.includes(saved.progressionMood as ProgressionMood)) {
        setProgressionMood(saved.progressionMood as ProgressionMood);
      }
      if (typeof saved.progressionSearch === "string") {
        setProgressionSearch(saved.progressionSearch);
      }
      if (typeof saved.sectionBars === "number") {
        const bars = [4, 8, 12, 16].includes(saved.sectionBars)
          ? saved.sectionBars
          : 8;
        setSectionBars(bars);
      }
      if (SECTION_SHAPES.some((shape) => shape.id === saved.sectionShape)) {
        setSectionShape(saved.sectionShape as SectionShapeId);
      }
      const savedPadPresets = saved.padPresets;
      if (Array.isArray(savedPadPresets)) {
        setPadPresets(
          Array.from({ length: MAX_PADS }, (_, idx) => {
            const candidate = savedPadPresets[idx];
            return PAD_PRESETS.some((preset) => preset.id === candidate)
              ? (candidate as PadVoicingPreset)
              : "AUTO_VOICE_BASS";
          })
        );
      }
      const savedPadOmits = saved.padOmits;
      if (Array.isArray(savedPadOmits)) {
        setPadOmits(
          Array.from({ length: MAX_PADS }, (_, idx) => {
            const candidate = savedPadOmits[idx] as OmitFlags | undefined;
            return {
              root: !!candidate?.root,
              third: !!candidate?.third,
              fifth: !!candidate?.fifth,
              seventh: !!candidate?.seventh,
            };
          })
        );
      }
      if (saved.perf && typeof saved.perf === "object") {
        setPerf((prev) => ({
          ...prev,
          ...(saved.perf as Partial<PerformanceSettings>),
        }));
      }
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          text,
          analysisRoot,
          analysisMode,
          playRoot,
          playMode,
          centerOctave,
          voiceLead,
          instrument,
          latchMode,
          progressionCategory,
          progressionMood,
          progressionSearch,
          sectionBars,
          sectionShape,
          padPresets,
          padOmits,
          perf,
        })
      );
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    settingsLoaded,
    text,
    analysisRoot,
    analysisMode,
    playRoot,
    playMode,
    centerOctave,
    voiceLead,
    instrument,
    latchMode,
    progressionCategory,
    progressionMood,
    progressionSearch,
    sectionBars,
    sectionShape,
    padPresets,
    padOmits,
    perf,
  ]);

  const romanProgression = useMemo(() => {
    const romans = chordSymbols
      .map((c) => romanizeChord(c, analysisKey))
      .filter(Boolean);
    return romans.join("  ");
  }, [chordSymbols, analysisKey]);

  const visibleProgressions = useMemo(
    () => {
      const query = progressionSearch.trim().toLowerCase();

      return PROGRESSION_PRESETS.filter((preset) => {
        if (
          progressionCategory !== "All" &&
          preset.category !== progressionCategory
        ) {
          return false;
        }
        if (!matchesProgressionMood(preset, progressionMood)) return false;
        if (!query) return true;

        const haystack = [
          preset.category,
          preset.name,
          preset.alias,
          preset.feel,
          ...progressionMoods(preset),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    },
    [progressionCategory, progressionMood, progressionSearch]
  );

  const applyProgression = (preset: ProgressionPreset) => {
    const next = progressionToChords(preset, analysisKey).slice(0, MAX_PADS);
    setText(next.join(" "));
    setPadPresets(Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS"));
  };

  const appendProgression = (preset: ProgressionPreset) => {
    const next = progressionToChords(preset, analysisKey);
    setText((prev) => {
      const merged = [...prev.split(/[\s,]+/).filter(Boolean), ...next].slice(
        0,
        MAX_PADS
      );
      return merged.join(" ");
    });
  };

  const applyRandomProgression = () => {
    const source = visibleProgressions.length
      ? visibleProgressions
      : PROGRESSION_PRESETS;
    const preset = source[Math.floor(Math.random() * source.length)];
    if (preset) applyProgression(preset);
  };

  const transformCurrentChords = (transform: ChordTransformId) => {
    if (!chordSymbols.length) return;
    setText(transformChordSymbols(chordSymbols, transform).join(" "));
    setPadPresets(Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS"));
  };

  const lastRoman = useMemo(() => {
    const lastChord = chordSymbols[chordSymbols.length - 1];
    return lastChord ? romanizeChord(lastChord, analysisKey) : "";
  }, [chordSymbols, analysisKey]);

  const nextChordSuggestions = useMemo(() => {
    return suggestNextRomans(lastRoman).map((suggestion) => ({
      ...suggestion,
      chord: romanTokenToChord(suggestion.token, analysisKey),
    }));
  }, [lastRoman, analysisKey]);

  const appendNextChord = (chord: string) => {
    setText((prev) => {
      const merged = [...prev.split(/[\s,]+/).filter(Boolean), chord].slice(
        0,
        MAX_PADS
      );
      return merged.join(" ");
    });
  };

  const makeSectionChords = (mode: "replace" | "append") =>
    generateSectionChords(
      sectionShape,
      sectionBars,
      analysisKey,
      mode === "append" ? lastRoman : ""
    ).slice(0, MAX_PADS);

  const replaceWithSection = () => {
    setText(makeSectionChords("replace").join(" "));
    setPadPresets(Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS"));
  };

  const appendSection = () => {
    const next = makeSectionChords("append");
    setText((prev) => {
      const merged = [...prev.split(/[\s,]+/).filter(Boolean), ...next].slice(
        0,
        MAX_PADS
      );
      return merged.join(" ");
    });
  };

  const copyShareUrl = async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("c", text);
    url.searchParams.set("ak", analysisRoot);
    url.searchParams.set("am", analysisMode);
    url.searchParams.set("pk", playRoot);
    url.searchParams.set("pm", playMode);
    url.searchParams.set("oct", String(centerOctave));
    url.searchParams.set("inst", instrument);
    url.searchParams.set("vl", voiceLead ? "1" : "0");

    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("copied");
    } catch {
      setShareStatus("copy failed");
    }

    window.setTimeout(() => setShareStatus(""), 1400);
  };

  const exportMidi = () => {
    const chords = padModels
      .filter((pad) => pad.ok && pad.midis.length)
      .map((pad) => ({ name: pad.chord, midis: pad.midis }));
    if (!chords.length) return;

    const file = buildChordMidiFile(chords, {
      bpm: 108,
      ticksPerChord: 960,
      strumTicks: Math.max(0, Math.round(perf.strumMs / 3)),
    });
    const blob = new Blob([file], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chordpad-${Date.now()}.mid`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadTone = async () => {
    if (!toneRef.current) {
      toneRef.current = await import("tone");
    }
    return toneRef.current;
  };

  const disposeAudioGraph = () => {
    synthRef.current?.dispose?.();
    limiterRef.current?.dispose?.();
    fxRefs.current.forEach((fx) => fx?.dispose?.());
    synthRef.current = null;
    limiterRef.current = null;
    fxRefs.current = [];
  };

  const ensureSynth = async () => {
    if (synthRef.current) return synthRef.current;

    const Tone = await loadTone();
    const limiter = new Tone.Limiter(-10).toDestination();
    limiterRef.current = limiter;

    const addFx = <T extends AudioNodeRef>(fx: T) => {
      fxRefs.current.push(fx);
      return fx;
    };

    let synth: AudioSynthRef;
    const id = instrumentRef.current;

    if (id === "warm_pad") {
      const chorus = addFx(new Tone.Chorus(0.7, 2.1, 0.28));
      chorus.start?.();
      const filter = addFx(new Tone.Filter(3600, "lowpass")).connect(limiter);
      chorus.connect(filter);
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.18, decay: 0.18, sustain: 0.78, release: 1.4 },
      }).connect(chorus);
      synth.volume.value = -18;
    } else if (id === "glass_fm") {
      const delay = addFx(new Tone.FeedbackDelay("16n", 0.12));
      delay.wet.value = 0.16;
      const filter = addFx(new Tone.Filter(6200, "lowpass")).connect(limiter);
      delay.connect(filter);
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.52,
        modulationIndex: 2.8,
        envelope: { attack: 0.012, decay: 0.34, sustain: 0.22, release: 0.95 },
        modulationEnvelope: {
          attack: 0.006,
          decay: 0.22,
          sustain: 0.03,
          release: 0.5,
        },
      }).connect(delay);
      synth.volume.value = -18;
    } else if (id === "pluck") {
      synth = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1.2, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.002, decay: 0.16, sustain: 0.02, release: 0.18 },
        filterEnvelope: {
          attack: 0.001,
          decay: 0.14,
          sustain: 0.08,
          release: 0.12,
          baseFrequency: 520,
          octaves: 3.4,
        },
      }).connect(limiter);
      synth.volume.value = -16;
    } else if (id === "organ") {
      const filter = addFx(new Tone.Filter(3000, "lowpass")).connect(limiter);
      synth = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.995,
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.82, release: 0.12 },
        modulation: { type: "square" },
        modulationEnvelope: {
          attack: 0.01,
          decay: 0.03,
          sustain: 0.72,
          release: 0.08,
        },
      }).connect(filter);
      synth.volume.value = -21;
    } else if (id === "chip_8bit") {
      const crusher = addFx(new Tone.BitCrusher({ bits: 5 })).connect(limiter);
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "square" },
        envelope: { attack: 0.002, decay: 0.055, sustain: 0.42, release: 0.075 },
      }).connect(crusher);
      synth.volume.value = -18;
    } else {
      const filter = addFx(new Tone.Filter(4400, "lowpass")).connect(limiter);
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.45,
        modulationIndex: 2.2,
        envelope: { attack: 0.012, decay: 0.18, sustain: 0.52, release: 0.52 },
        modulationEnvelope: {
          attack: 0.006,
          decay: 0.14,
          sustain: 0.18,
          release: 0.34,
        },
      }).connect(filter);
      synth.volume.value = -17;
    }

    synthRef.current = synth;
    return synth;
  };

  const ensureAudioReady = async () => {
    // Always try to resume on user gesture (iOS can suspend)
    const Tone = await loadTone();
    await Tone.start();
    await ensureSynth();

    if (Tone.Transport.state !== "started") {
      // Needed for scheduleOnce callbacks to fire
      Tone.Transport.start();
    }

    audioReadyRef.current = true;
  };

  const pushLog = (row: LogRow) => {
    setLogs((p) => [row, ...p].slice(0, 200));
    console.log("PLAY", row);
  };

  const clearOneShotViz = () => {
    if (oneShotTimerRef.current !== null) {
      window.clearTimeout(oneShotTimerRef.current);
      oneShotTimerRef.current = null;
    }
    oneShotMidisRef.current = [];
  };

  const releaseNoteOwner = (note: string) => {
    const state = noteHoldsRef.current[note];
    if (!state) return;

    state.count -= 1;
    if (state.count > 0) return;

    const Tone = toneRef.current;
    if (Tone && state.attackId !== null) {
      Tone.Transport.clear(state.attackId);
    }
    if (state.sounding) {
      synthRef.current?.triggerRelease?.(note, Tone?.now?.() ?? undefined);
    }
    delete noteHoldsRef.current[note];
  };

  const stopHoldByIndex = (idx: number, opts: { force?: boolean } = {}) => {
    const h = activeHoldRef.current[idx];
    if (!h) return;

    if (!opts.force && sustainDownRef.current) {
      sustainedPadsRef.current.add(idx);
      return;
    }

    h.notes.forEach((note) => releaseNoteOwner(note));
    delete activeHoldRef.current[idx];
    delete holdMidisRef.current[idx];
    sustainedPadsRef.current.delete(idx);
    syncActivePads();
    requestSyncActiveMidis();
  };

  const startHoldByIndex = async (idx: number) => {
    const p = padModelsRef.current[idx];
    if (!p?.ok || !p.notes.length) return;
    if (activeHoldRef.current[idx]) return; // already holding

    setGuidePadIdx(idx);

    await ensureAudioReady();
    const Tone = toneRef.current;
    const synth = await ensureSynth();
    if (!Tone) return;

    // Visualizer: light full chord immediately (stable, cheap)
    holdMidisRef.current[idx] = p.midis;
    requestSyncActiveMidis();

    // schedule strum/arp attacks via Transport (cancelable, less timer jitter)
    const events = buildNoteEvents(p.notes, p.midis, perfRef.current, 0.9);

    const notesToRelease: string[] = [];

    for (const ev of events) {
      notesToRelease.push(ev.note);

      const existing = noteHoldsRef.current[ev.note];
      if (existing) {
        existing.count += 1;
        continue;
      }

      const state: NoteHoldState = {
        count: 1,
        attackId: null,
        sounding: false,
      };
      noteHoldsRef.current[ev.note] = state;

      const delaySec = Math.max(0, ev.delayMs) / 1000;
      state.attackId = Tone.Transport.scheduleOnce((time) => {
        state.sounding = true;
        synth.triggerAttack(ev.note, time, ev.velocity);
      }, `+${delaySec}`);
    }

    activeHoldRef.current[idx] = { notes: notesToRelease };
    syncActivePads();

    // Log only at hold start (avoid spam)
    pushLog({
      t: nowStr(),
      chord: p.chord,
      roman: p.roman,
      preset: p.preset,
      instrument: instrumentRef.current,
      notes: p.notes,
      midis: p.midis,
      shift: shiftRef.current,
      perf: perfRef.current,
    });
  };

  const stopAll = () => {
    const Tone = toneRef.current;

    // cancel everything scheduled
    if (Tone) {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
    }

    // release any held notes
    const synth = synthRef.current;
    synth?.releaseAll?.();

    // clear holds bookkeeping
    activeHoldRef.current = {};
    noteHoldsRef.current = {};
    sustainedPadsRef.current.clear();
    holdMidisRef.current = {};
    syncActivePads();

    // clear viz one-shot
    clearOneShotViz();
    requestSyncActiveMidis();
  };

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") stopAll();
    };
    const onBlur = () => stopAll();
    const onPageHide = () => stopAll();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      stopAll();
      disposeAudioGraph();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!audioReadyRef.current && !synthRef.current) return;
    stopAll();
    disposeAudioGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument]);

  // -------------------------
  // Text window helpers
  // -------------------------
  const appendChordToText = (symbol: string) => {
    setText((prev) => {
      const s = prev ?? "";
      const trimmedRight = s.replace(/\s+$/g, "");
      return trimmedRight.length ? `${trimmedRight} ${symbol}` : symbol;
    });
  };

  const padIndexForKey = (key: string) => {
    const normalized = key.toLowerCase();
    const idx = PAD_KEY_LAYOUT.findIndex((k) => k === normalized);
    return idx >= 0 ? idx : null;
  };

  const releaseSustainPads = () => {
    const pads = Array.from(sustainedPadsRef.current);
    sustainedPadsRef.current.clear();
    pads.forEach((idx) => stopHoldByIndex(idx, { force: true }));
  };

  const triggerPadDown = async (idx: number) => {
    if (latchModeRef.current) {
      if (activeHoldRef.current[idx]) {
        stopHoldByIndex(idx, { force: true });
      } else {
        await startHoldByIndex(idx);
      }
      return;
    }

    await startHoldByIndex(idx);
  };

  const triggerPadUp = (idx: number) => {
    if (latchModeRef.current) return;
    stopHoldByIndex(idx);
  };

  const renderPadButton = (
    p: (typeof padModels)[number],
    variant: "quick" | "dock" | "detail"
  ) => {
    const disabled = !p.ok;
    const active = activePadIndices.includes(p.idx);
    const baseStyle =
      variant === "quick"
        ? styles.quickPad
        : variant === "dock"
          ? styles.dockPad
          : styles.pad;
    const activeStyle =
      variant === "quick"
        ? styles.quickPadActive
        : variant === "dock"
          ? styles.dockPadActive
          : styles.padActive;

    return (
      <button
        key={`${variant}-${p.idx}`}
        type="button"
        disabled={disabled}
        aria-label={`Pad ${p.idx + 1} ${p.chord || "empty"}`}
        onPointerDown={async (e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          await triggerPadDown(p.idx);
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          triggerPadUp(p.idx);
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={(e) => {
          e.preventDefault();
          triggerPadUp(p.idx);
        }}
        style={{
          ...baseStyle,
          ...(active ? activeStyle : {}),
          opacity: disabled ? 0.42 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          outline:
            guidePadIdx === p.idx
              ? "2px solid rgba(59,130,246,0.36)"
              : variant === "dock"
                ? "1px solid rgba(148,163,184,0.24)"
                : undefined,
        }}
        title={p.chord ? `${PAD_KEY_LAYOUT[p.idx].toUpperCase()} ${p.chord}` : ""}
      >
        <div
          style={
            variant === "detail"
              ? styles.padTop
              : variant === "dock"
                ? styles.dockPadTop
                : styles.quickPadTop
          }
        >
          {variant === "detail" ? (
            <>
              <span>{PAD_KEY_LAYOUT[p.idx].toUpperCase()}</span>
              <span>
                #{p.idx + 1} {p.chord || "—"}
              </span>
            </>
          ) : (
            `${PAD_KEY_LAYOUT[p.idx].toUpperCase()} · #${p.idx + 1}`
          )}
        </div>
        <div
          style={
            variant === "dock"
              ? styles.dockPadChord
              : variant === "quick"
                ? styles.quickPadChord
                : styles.padRoman
          }
        >
          {variant === "detail" ? p.roman || " " : p.chord || "—"}
        </div>
        {variant === "detail" ? (
          <>
            <div style={styles.padToneSummary}>
              tones: {p.toneSummary || "-"}
            </div>
            <div style={styles.padNotes}>
              {p.notes.length ? p.notes.join(" ") : "（解析できません）"}
            </div>
            <div style={styles.mutedSmall}>
              midis: {p.midis.length ? p.midis.join(", ") : "-"}
            </div>
          </>
        ) : (
          <div style={variant === "dock" ? styles.dockPadRoman : styles.quickPadRoman}>
            {p.roman || " "}
          </div>
        )}
      </button>
    );
  };

  // -------------------------
  // Keyboard hold (4x4 pad layout)
  // -------------------------
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;
      if (e.repeat) return;

      if (e.code === "Space") {
        e.preventDefault();
        sustainDownRef.current = true;
        setSustainDown(true);
        return;
      }

      if (e.key.toLowerCase() === "l") {
        setLatchMode((v) => !v);
        return;
      }

      const idx = padIndexForKey(e.key);
      if (idx == null) return;
      e.preventDefault();
      await triggerPadDown(idx);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        sustainDownRef.current = false;
        setSustainDown(false);
        releaseSustainPads();
        return;
      }

      const idx = padIndexForKey(e.key);
      if (idx == null) return;
      e.preventDefault();
      triggerPadUp(idx);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // startHoldByIndex/stopHoldByIndex are stable via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // Keyboard click: play single note + suggest chords
  // -------------------------
  const playSingleMidi = async (midi: number) => {
    await ensureAudioReady();
    const Tone = toneRef.current;
    const synth = await ensureSynth();
    if (!Tone) return;

    const note = midiToNoteName(midi);
    const events = buildNoteEvents([note], [midi], perfRef.current, 0.35);

    clearOneShotViz();
    oneShotMidisRef.current = [midi];
    oneShotTimerRef.current = window.setTimeout(() => {
      clearOneShotViz();
      requestSyncActiveMidis();
    }, 260);
    requestSyncActiveMidis();

    const start = Tone.now();
    events.forEach((ev) => {
      synth.triggerAttackRelease(
        ev.note,
        ev.durSec,
        start + ev.delayMs / 1000,
        ev.velocity
      );
    });
  };

  const onKeyboardPress = async (midi: number) => {
    setPickedMidi(midi);
    await playSingleMidi(midi);
  };

  const kbRange = useMemo(() => {
    const min = midiFromPc("C", Math.max(1, centerOctave - 2));
    const max = midiFromPc("B", centerOctave + 2);
    return { min, max };
  }, [centerOctave]);

  const pickedInfo = useMemo(() => {
    if (pickedMidi == null) return null;

    const soundingNote = midiToNoteName(pickedMidi);

    // テキスト窓は「解析側」なので -shift で戻す
    const inputMidi = pickedMidi - shift;
    const inputNote = midiToNoteName(inputMidi);
    const inputPc = toFlatPc(inputNote);

    const candidates = suggestChordsFromPc(inputPc);

    return {
      soundingMidi: pickedMidi,
      soundingNote,
      inputMidi,
      inputNote,
      inputPc,
      candidates,
    };
  }, [pickedMidi, shift]);

  // -------------------------
  // Scale guide midis (by pitch class across keyboard range)
  // -------------------------
  const guide = useMemo(() => {
    if (!guideEnabled) return { chord: [] as number[], ext: [] as number[] };

    const chordSymbol = padModels[guidePadIdx]?.chord || "";
    if (!chordSymbol) return { chord: [] as number[], ext: [] as number[] };

    const { chordPcs, extPcs } = getChordGuidePcs(chordSymbol, {
      add9: guide9,
      add11: guide11,
      add13: guide13,
    });

    const chordSet = new Set(chordPcs);
    const extSet = new Set(extPcs);

    const chordMidis: number[] = [];
    const extMidis: number[] = [];

    for (let m = kbRange.min; m <= kbRange.max; m++) {
      const pc = toFlatPc(midiToNoteName(m));
      if (chordSet.has(pc)) chordMidis.push(m);
      else if (extSet.has(pc)) extMidis.push(m);
    }

    return { chord: chordMidis, ext: extMidis };
  }, [guideEnabled, guidePadIdx, padModels, kbRange, guide9, guide11, guide13]);

  // -------------------------
  // Dock (4x4 performance pads; 1:1 mapping)
  // -------------------------
  const Dock = () => {
    return (
      <div style={styles.dockWrap}>
        <button
          type="button"
          onClick={() => setDockOpen((v) => !v)}
          aria-expanded={dockOpen}
          style={styles.dockToggle}
          title="PadDock"
        >
          {dockOpen ? "Dock×" : "Dock"}
        </button>

        {dockOpen ? (
          <div style={styles.dockPanel}>
            <div style={styles.dockGrid}>
              {padModels.map((p) => renderPadButton(p, "dock"))}
            </div>
            <div style={styles.dockHint}>
              4x4 keys: 1-4 / Q-R / A-F / Z-V · Space sustain · L latch
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // -------------------------
  // UI
  // -------------------------
  return (
    <main style={styles.page}>
      <Dock />

      <div style={styles.card}>
        <header style={styles.appHeader}>
          <div>
            <h1 style={styles.h1}>ChordPad</h1>
            <div style={styles.headerMeta}>
              {instrumentLabel(instrument)} / {voiceLead ? "voice lead" : "fixed"} /{" "}
              {activePadIndices.length} active
            </div>
          </div>

          <div style={styles.headerControls}>
            <div style={styles.controlGroup}>
              <div style={styles.mutedSmall}>Instrument</div>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value as InstrumentId)}
                style={styles.select}
              >
                {INSTRUMENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} · {preset.character}
                  </option>
                ))}
              </select>
              <div style={styles.instrumentStrip}>
                {INSTRUMENT_PRESETS.map((preset) => {
                  const selected = preset.id === instrument;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setInstrument(preset.id)}
                      aria-pressed={selected}
                      style={{
                        ...styles.instrumentChip,
                        ...(selected ? styles.instrumentChipOn : {}),
                      }}
                      title={preset.character}
                    >
                      {preset.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={copyShareUrl}
              style={styles.modeButton}
              title="Copy share URL"
            >
              {shareStatus || "Share"}
            </button>

            <button
              type="button"
              onClick={exportMidi}
              style={styles.modeButton}
              title="Download MIDI"
            >
              MIDI
            </button>

            <button
              type="button"
              onClick={() => setLatchMode((v) => !v)}
              aria-pressed={latchMode}
              style={{
                ...styles.modeButton,
                ...(latchMode ? styles.modeButtonOn : {}),
              }}
              title="L key"
            >
              Latch
            </button>

            <button
              type="button"
              aria-pressed={sustainDown}
              onPointerDown={(e) => {
                e.preventDefault();
                sustainDownRef.current = true;
                setSustainDown(true);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                sustainDownRef.current = false;
                setSustainDown(false);
                releaseSustainPads();
              }}
              onPointerCancel={() => {
                sustainDownRef.current = false;
                setSustainDown(false);
                releaseSustainPads();
              }}
              style={{
                ...styles.modeButton,
                ...(sustainDown ? styles.modeButtonOn : {}),
              }}
              title="Hold Space"
            >
              Sustain
            </button>

            <button onClick={stopAll} style={styles.btnDanger} type="button">
              Stop
            </button>
          </div>
        </header>

        <section style={styles.section}>
          <div style={styles.label}>
            Chord list（スペース/カンマ区切り → Pad割当）
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            style={styles.textarea}
            placeholder="例: Dbm7 C7 Fm7 Bb7 ..."
          />

          <div style={styles.actionRow}>
            {CHORD_TRANSFORMS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => transformCurrentChords(action.id)}
                style={styles.pillButton}
              >
                {action.label}
              </button>
            ))}
            <div style={styles.actionSpacer} />
            {nextChordSuggestions.map((suggestion) => (
              <button
                key={`${suggestion.token}-${suggestion.chord}`}
                type="button"
                onClick={() => appendNextChord(suggestion.chord)}
                style={styles.nextButton}
                title={suggestion.label}
              >
                + {suggestion.chord}
                <span style={styles.nextTag}>{suggestion.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionBuilder}>
            <div>
              <div style={styles.label}>Section builder</div>
              <div style={styles.sectionMeta}>
                {sectionBars} bars / {SECTION_SHAPES.find((shape) => shape.id === sectionShape)?.label}
              </div>
            </div>

            <div style={styles.sectionControls}>
              <select
                value={sectionBars}
                onChange={(e) => setSectionBars(Number(e.target.value))}
                style={{ ...styles.select, width: 92 }}
              >
                {[4, 8, 12, 16].map((bars) => (
                  <option key={bars} value={bars}>
                    {bars} bars
                  </option>
                ))}
              </select>

              <select
                value={sectionShape}
                onChange={(e) => setSectionShape(e.target.value as SectionShapeId)}
                style={{ ...styles.select, width: 132 }}
              >
                {SECTION_SHAPES.map((shape) => (
                  <option key={shape.id} value={shape.id}>
                    {shape.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={replaceWithSection}
                style={styles.modeButton}
              >
                Replace
              </button>

              <button
                type="button"
                onClick={appendSection}
                style={styles.modeButton}
              >
                Append
              </button>
            </div>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.progressionHead}>
            <div>
              <div style={styles.label}>Progression presets</div>
              <div style={styles.mutedSmall}>
                解析キーを基準にコードへ変換します。クリックで置き換え、+で追加。
              </div>
            </div>
            <div style={styles.progressionControls}>
              <select
                value={progressionCategory}
                onChange={(e) =>
                  setProgressionCategory(
                    e.target.value as ProgressionCategoryFilter
                  )
                }
                style={{ ...styles.select, width: 120 }}
              >
                {(["All", ...PROGRESSION_CATEGORIES] as const).map(
                  (category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  )
                )}
              </select>
              <select
                value={progressionMood}
                onChange={(e) => setProgressionMood(e.target.value as ProgressionMood)}
                style={{ ...styles.select, width: 120 }}
              >
                {PROGRESSION_MOODS.map((mood) => (
                  <option key={mood} value={mood}>
                    {mood}
                  </option>
                ))}
              </select>
              <input
                value={progressionSearch}
                onChange={(e) => setProgressionSearch(e.target.value)}
                style={styles.searchInput}
                placeholder="search"
              />
              <button
                type="button"
                onClick={applyRandomProgression}
                style={styles.modeButton}
              >
                Random
              </button>
            </div>
          </div>

          <div style={styles.progressionGrid}>
            {visibleProgressions.map((preset) => {
              const chords = progressionToChords(preset, analysisKey).join(" ");
              return (
                <div key={preset.id} style={styles.progressionItem}>
                  <button
                    type="button"
                    onClick={() => applyProgression(preset)}
                    style={styles.progressionMain}
                    title={chords}
                  >
                    <span style={styles.progressionName}>{preset.name}</span>
                    <span style={styles.progressionAlias}>{preset.alias}</span>
                    <span style={styles.progressionChords}>{chords}</span>
                    <span style={styles.progressionTags}>
                      {progressionMoods(preset).slice(0, 3).join(" / ")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => appendProgression(preset)}
                    style={styles.progressionAppend}
                    title="Append to chord list"
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
          {visibleProgressions.length === 0 ? (
            <div style={styles.emptyHint}>No matching presets</div>
          ) : null}
        </section>

        <section style={styles.sectionRow}>
          <div style={{ flex: 1 }}>
            <div style={styles.label}>元キー（解析基準）</div>
            <div style={styles.row2}>
              <select
                value={analysisRoot}
                onChange={(e) => setAnalysisRoot(e.target.value as KeyRoot)}
                style={styles.select}
              >
                {KEY_ROOTS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select
                value={analysisMode}
                onChange={(e) => setAnalysisMode(e.target.value as KeyMode)}
                style={styles.select}
              >
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={styles.label}>再生キー（移調先）</div>
            <div style={styles.row2}>
              <select
                value={playRoot}
                onChange={(e) => setPlayRoot(e.target.value as KeyRoot)}
                style={styles.select}
              >
                {KEY_ROOTS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select
                value={playMode}
                onChange={(e) => setPlayMode(e.target.value as KeyMode)}
                style={styles.select}
              >
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
          </div>

          <div style={{ width: 220 }}>
            <div style={styles.label}>Center octave（手の位置）</div>
            <input
              type="range"
              min={4}
              max={6}
              value={centerOctave}
              onChange={(e) => setCenterOctave(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={styles.muted}>
              centerOctave: {centerOctave} / shift: {shift} semitone(s)
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <button
              type="button"
              onClick={() =>
                setPadPresets(
                  Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS")
                )
              }
              style={styles.modeButton}
            >
              Auto all
            </button>
            <button
              type="button"
              onClick={() => setVoiceLead((v) => !v)}
              aria-pressed={voiceLead}
              style={{
                ...styles.modeButton,
                ...(voiceLead ? styles.modeButtonOn : {}),
              }}
            >
              Voice lead
            </button>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.playSurfaceHead}>
            <div>
              <div style={styles.label}>Play pads</div>
              <div style={styles.mutedSmall}>
                1-4 / Q-R / A-F / Z-V で押している間だけ鳴ります
              </div>
            </div>
            <div style={styles.playSurfaceMeta}>
              {latchMode ? "Latch on" : "Hold"} ·{" "}
              {sustainDown ? "Sustain on" : instrumentLabel(instrument)}
            </div>
          </div>
          <div style={styles.quickGrid}>
            {padModels.map((p) => renderPadButton(p, "quick"))}
          </div>
        </section>

        {/* Performance */}
        <section style={styles.section}>
          <div style={styles.label}>Performance（Chord / Arp / Humanize）</div>

          <div style={styles.perfTopRow}>
            <div style={{ flex: 1 }}>
              <div style={styles.mutedSmall}>Play mode</div>
              <select
                value={
                  perf.playMode === "chord" ? "chord" : `arp_${perf.arpPattern}`
                }
                onChange={(e) =>
                  setPerf((p) => {
                    const v = e.target.value;
                    if (v === "chord") {
                      return { ...p, playMode: "chord" };
                    }
                    const pat = v.replace(
                      /^arp_/,
                      ""
                    ) as PerformanceSettings["arpPattern"];
                    return { ...p, playMode: "arp", arpPattern: pat };
                  })
                }
                style={styles.select}
              >
                <option value="chord">Chord (strum)</option>
                <option value="arp_up">Arp up</option>
                <option value="arp_down">Arp down</option>
                <option value="arp_1357">Arp 1357</option>
                <option value="arp_random">Arp random</option>
              </select>
            </div>

            {perf.playMode !== "chord" ? (
              <>
                <div style={{ width: 220 }}>
                  <div style={styles.mutedSmall}>
                    Arp step: {perf.arpStepMs}ms
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={220}
                    value={perf.arpStepMs}
                    onChange={(e) =>
                      setPerf((p) => ({
                        ...p,
                        arpStepMs: Number(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ width: 220 }}>
                  <div style={styles.mutedSmall}>
                    Gate: {Math.round(perf.arpGate * 100)}%
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(perf.arpGate * 100)}
                    onChange={(e) =>
                      setPerf((p) => ({
                        ...p,
                        arpGate: Number(e.target.value) / 100,
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              </>
            ) : null}
          </div>

          <div style={styles.perfGrid}>
            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Strum (ms)</span>
                <span style={styles.perfVal}>{perf.strumMs}ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={120}
                value={perf.strumMs}
                onChange={(e) =>
                  setPerf((p) => ({ ...p, strumMs: Number(e.target.value) }))
                }
                style={{ width: "100%" }}
                disabled={perf.playMode !== "chord"}
              />
            </div>

            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Direction</span>
              </div>
              <select
                value={perf.direction}
                onChange={(e) =>
                  setPerf((p) => ({
                    ...p,
                    direction: e.target.value as StrumDirection,
                  }))
                }
                style={styles.select}
                disabled={perf.playMode !== "chord"}
              >
                <option value="up">up (low → high)</option>
                <option value="down">down (high → low)</option>
                <option value="random">random</option>
              </select>
            </div>

            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Top boost</span>
                <span style={styles.perfVal}>
                  {Math.round(perf.topBoost * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={Math.round(perf.topBoost * 100)}
                onChange={(e) =>
                  setPerf((p) => ({
                    ...p,
                    topBoost: Number(e.target.value) / 100,
                  }))
                }
                style={{ width: "100%" }}
              />
            </div>

            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Humanize timing</span>
                <span style={styles.perfVal}>{perf.timingJitterMs}ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                value={perf.timingJitterMs}
                onChange={(e) =>
                  setPerf((p) => ({
                    ...p,
                    timingJitterMs: Number(e.target.value),
                  }))
                }
                style={{ width: "100%" }}
              />
            </div>

            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Humanize velocity</span>
                <span style={styles.perfVal}>
                  ±{Math.round(perf.velocityHumanize * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                value={Math.round(perf.velocityHumanize * 100)}
                onChange={(e) =>
                  setPerf((p) => ({
                    ...p,
                    velocityHumanize: Number(e.target.value) / 100,
                  }))
                }
                style={{ width: "100%" }}
              />
            </div>

            <div style={styles.perfItem}>
              <div style={styles.perfHead}>
                <span>Base velocity</span>
                <span style={styles.perfVal}>
                  {Math.round(perf.baseVelocity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(perf.baseVelocity * 100)}
                onChange={(e) =>
                  setPerf((p) => ({
                    ...p,
                    baseVelocity: Number(e.target.value) / 100,
                  }))
                }
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={styles.mutedSmall}>
            Holdは Tone.Transport で Attack をスケジュール（キャンセル可能）。
            4x4キー、Dock、Padは「押している間鳴る / 離すと止まる」。
          </div>
        </section>

        {/* Keyboard: visualizer + note->chord */}
        <section style={styles.section}>
          <div style={styles.label}>
            Keyboard（Visualizer + Scale guide + 単音→コード候補）
          </div>

          <div style={styles.guideRow}>
            <label style={styles.chk}>
              <input
                type="checkbox"
                checked={guideEnabled}
                onChange={(e) => setGuideEnabled(e.target.checked)}
              />
              <span>Scale guide</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={styles.mutedSmall}>Source</span>
              <select
                value={guidePadIdx}
                onChange={(e) => setGuidePadIdx(Number(e.target.value))}
                style={{ ...styles.select, height: 30, width: 140 }}
              >
                {padModels.map((p) => (
                  <option key={p.idx} value={p.idx}>
                    {p.chord ? `#${p.idx + 1} ${p.chord}` : `#${p.idx + 1} —`}
                  </option>
                ))}
              </select>
            </div>

            <label style={styles.chk}>
              <input
                type="checkbox"
                checked={guide9}
                onChange={(e) => setGuide9(e.target.checked)}
              />
              <span>+9</span>
            </label>
            <label style={styles.chk}>
              <input
                type="checkbox"
                checked={guide11}
                onChange={(e) => setGuide11(e.target.checked)}
              />
              <span>+11</span>
            </label>
            <label style={styles.chk}>
              <input
                type="checkbox"
                checked={guide13}
                onChange={(e) => setGuide13(e.target.checked)}
              />
              <span>+13</span>
            </label>

            <div style={styles.mutedSmall}>
              chord tones = 強め / tensions = 薄め（コード基準）
            </div>
          </div>

          <div style={styles.kbRow}>
            <PianoKeyboard
              minMidi={kbRange.min}
              maxMidi={kbRange.max}
              activeMidis={activeMidis}
              pickedMidi={pickedMidi}
              guideChordMidis={guide.chord}
              guideExtMidis={guide.ext}
              onKeyPress={onKeyboardPress}
              height={92}
            />

            <div style={styles.suggestPanel}>
              <div style={styles.suggestTitle}>Note → Chords</div>

              {pickedInfo ? (
                <>
                  <div style={styles.suggestMeta}>
                    <div>
                      <span style={styles.suggestKey}>Sounding</span>{" "}
                      <span style={styles.suggestVal}>
                        {toFlatPc(pickedInfo.soundingNote)} (midi{" "}
                        {pickedInfo.soundingMidi})
                      </span>
                    </div>
                    <div>
                      <span style={styles.suggestKey}>Input root</span>{" "}
                      <span style={styles.suggestVal}>
                        {pickedInfo.inputPc}{" "}
                        <span style={styles.mutedSmall}>
                          （クリック音を -shift して窓に入れる）
                        </span>
                      </span>
                    </div>
                  </div>

                  <div style={styles.chipGrid}>
                    {pickedInfo.candidates.map((c) => (
                      <button
                        key={c.symbol}
                        type="button"
                        onClick={() => appendChordToText(c.symbol)}
                        style={styles.chip}
                        title="クリックで上のChord listに追加"
                      >
                        {c.symbol}
                        <span style={styles.chipTag}>{c.tag}</span>
                      </button>
                    ))}
                  </div>

                  <div style={styles.mutedSmall}>
                    ここは「窓にコード文字を入れる」だけ。Padは窓が更新されて初めて変化します。
                  </div>
                </>
              ) : (
                <div style={styles.mutedSmall}>
                  鍵盤をタップすると単音が鳴り、候補を出します。
                </div>
              )}
            </div>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.label}>度数（ローマ数字）</div>
          <div style={styles.romanBox}>
            {romanProgression || "（まだありません）"}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.label}>
            Pads（4x4キーでホールド / Space sustain / L latch） ※Padごとにボイシング指定
          </div>

          <div style={styles.grid}>
            {padModels.map((p) => {
              return (
                <div key={p.idx} style={styles.padWrap}>
                  {renderPadButton(p, "detail")}

                  <div style={styles.padSelectLabel}>Pad voicing preset</div>
                  <select
                    value={p.preset}
                    onChange={(e) =>
                      setPadPresetAt(p.idx, e.target.value as PadVoicingPreset)
                    }
                    style={styles.select}
                  >
                    {PAD_PRESETS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>

                  <div style={styles.padSelectLabel}>Omit (per-pad)</div>
                  <div style={styles.omitRow}>
                    <label style={styles.chkMini}>
                      <input
                        type="checkbox"
                        checked={!!p.omit?.root}
                        onChange={(e) =>
                          setPadOmitAt(p.idx, { root: e.target.checked })
                        }
                      />
                      <span>omit R</span>
                    </label>

                    <label style={styles.chkMini}>
                      <input
                        type="checkbox"
                        checked={!!p.omit?.third}
                        onChange={(e) =>
                          setPadOmitAt(p.idx, { third: e.target.checked })
                        }
                      />
                      <span>omit 3</span>
                    </label>

                    <label style={styles.chkMini}>
                      <input
                        type="checkbox"
                        checked={!!p.omit?.fifth}
                        onChange={(e) =>
                          setPadOmitAt(p.idx, { fifth: e.target.checked })
                        }
                      />
                      <span>omit 5</span>
                    </label>

                    <label style={styles.chkMini}>
                      <input
                        type="checkbox"
                        checked={!!p.omit?.seventh}
                        onChange={(e) =>
                          setPadOmitAt(p.idx, { seventh: e.target.checked })
                        }
                      />
                      <span>omit 7</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionRow}>
            <div style={styles.label}>
              Log（ホールド開始時だけ積む / 最新が上）
            </div>
            <button onClick={() => setLogs([])} style={styles.btnMini}>
              clear
            </button>
          </div>

          <div style={styles.logBox}>
            {logs.length === 0 ? (
              <div style={styles.muted}>（ログなし）</div>
            ) : (
              logs.map((r, idx) => (
                <div key={idx} style={styles.logRow}>
                  <span style={styles.logT}>{r.t}</span>
                  <span style={styles.logChord}>{r.chord}</span>
                  <span style={styles.logRoman}>{r.roman || ""}</span>
                  <span style={styles.logInstrument}>
                    {INSTRUMENT_PRESETS.find((p) => p.id === r.instrument)
                      ?.shortLabel ?? r.instrument}
                  </span>
                  <span style={styles.logNotes}>{r.notes.join(" ")}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 48%, #f7fff9 100%)",
    color: "#172033",
    padding: 24,
    display: "flex",
    justifyContent: "center",
    fontFamily: 'system-ui, -apple-system, "SF Pro Text", sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: 1180,
    border: "1px solid rgba(148,163,184,0.24)",
    borderRadius: 8,
    padding: 18,
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 24px 70px rgba(15,23,42,0.12)",
  },
  appHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    paddingBottom: 14,
    borderBottom: "1px solid rgba(148,163,184,0.22)",
  },
  h1: { fontSize: 26, margin: 0, fontWeight: 900, letterSpacing: 0 },
  headerMeta: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  headerControls: {
    display: "flex",
    alignItems: "end",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  controlGroup: { width: 300, maxWidth: "100%" },
  instrumentStrip: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 7,
  },
  instrumentChip: {
    height: 24,
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#64748b",
    padding: "0 9px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 900,
  },
  instrumentChipOn: {
    border: "1px solid rgba(37,99,235,0.32)",
    background: "#eff6ff",
    color: "#1d4ed8",
    boxShadow: "inset 0 -2px 0 rgba(37,99,235,0.18)",
  },

  section: { marginTop: 14 },
  sectionRow: { marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" },

  label: { fontSize: 12, fontWeight: 800, marginBottom: 6 },
  muted: { fontSize: 12, color: "#64748b" },
  mutedSmall: { fontSize: 11, color: "#64748b" },

  row2: { display: "flex", gap: 8 },
  actionRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 8,
  },
  actionSpacer: {
    width: 1,
    height: 24,
    background: "rgba(148,163,184,0.24)",
    margin: "0 2px",
  },
  pillButton: {
    height: 28,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 900,
  },
  nextButton: {
    height: 28,
    padding: "0 9px",
    borderRadius: 999,
    border: "1px solid rgba(20,184,166,0.32)",
    background: "#f0fdfa",
    color: "#115e59",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 900,
  },
  nextTag: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 800,
  },
  sectionBuilder: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    border: "1px solid rgba(37,99,235,0.18)",
    borderRadius: 8,
    padding: 10,
    background: "linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)",
  },
  sectionMeta: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 900,
  },
  sectionControls: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },

  textarea: {
    width: "100%",
    background: "#ffffff",
    color: "#172033",
    border: "1px solid rgba(148,163,184,0.30)",
    borderRadius: 8,
    padding: 10,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
  },
  select: {
    width: "100%",
    height: 34,
    background: "#ffffff",
    color: "#172033",
    border: "1px solid rgba(148,163,184,0.30)",
    borderRadius: 8,
    padding: "0 10px",
  },

  btnMini: {
    height: 28,
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#172033",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },
  btnDanger: {
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid rgba(239,68,68,0.34)",
    background: "#fff1f2",
    color: "#be123c",
    cursor: "pointer",
    fontWeight: 900,
  },
  modeButton: {
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    userSelect: "none",
    touchAction: "none",
  },
  modeButtonOn: {
    border: "1px solid rgba(20,184,166,0.48)",
    background: "#ecfeff",
    color: "#0f766e",
    boxShadow: "inset 0 -2px 0 rgba(20,184,166,0.28)",
  },

  romanBox: {
    border: "1px solid rgba(148,163,184,0.24)",
    borderRadius: 8,
    padding: 10,
    background: "#f8fafc",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    color: "#334155",
  },

  perfTopRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "end",
    marginBottom: 10,
  },

  perfGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  perfItem: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 8,
    padding: 10,
    background: "#ffffff",
  },
  perfHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 800,
    color: "#172033",
  },
  perfVal: { fontSize: 11, color: "#64748b", fontWeight: 800 },

  // guide
  guideRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "#ffffff",
  },
  chk: { display: "flex", gap: 8, alignItems: "center", fontSize: 12 },

  // keyboard section
  kbRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  suggestPanel: {
    width: 360,
    maxWidth: "100%",
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 8,
    padding: 10,
    background: "#ffffff",
  },
  suggestTitle: { fontSize: 12, fontWeight: 900, marginBottom: 8 },
  suggestMeta: {
    display: "grid",
    gap: 4,
    marginBottom: 10,
    fontSize: 12,
  },
  suggestKey: { color: "#64748b", fontWeight: 800 },
  suggestVal: {
    color: "#172033",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },

  chipGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#172033",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  chipTag: {
    fontSize: 10,
    color: "#0f766e",
    fontWeight: 800,
  },

  progressionHead: {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  progressionControls: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  searchInput: {
    width: 120,
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#172033",
    padding: "0 10px",
    fontSize: 12,
  },
  progressionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 8,
  },
  progressionItem: {
    display: "grid",
    gridTemplateColumns: "1fr 34px",
    gap: 6,
  },
  progressionMain: {
    minHeight: 76,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#172033",
    padding: "9px 10px",
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    gap: 3,
  },
  progressionName: {
    fontSize: 12,
    fontWeight: 900,
  },
  progressionAlias: {
    color: "#0f766e",
    fontSize: 11,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontWeight: 900,
  },
  progressionChords: {
    color: "#64748b",
    fontSize: 11,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  progressionTags: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  progressionAppend: {
    borderRadius: 8,
    border: "1px solid rgba(20,184,166,0.34)",
    background: "#ecfeff",
    color: "#0f766e",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 18,
  },
  emptyHint: {
    marginTop: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    borderRadius: 8,
    padding: 10,
    background: "#f8fafc",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },

  playSurfaceHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "end",
    gap: 12,
    marginBottom: 10,
  },
  playSurfaceMeta: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: 900,
  },
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
    gap: 10,
  },
  quickPad: {
    minHeight: 82,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "linear-gradient(160deg, #ffffff 0%, #eef7ff 100%)",
    color: "#172033",
    padding: 10,
    textAlign: "left",
    userSelect: "none",
    touchAction: "none",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
  },
  quickPadActive: {
    border: "1px solid rgba(20,184,166,0.68)",
    background: "linear-gradient(160deg, #ecfeff 0%, #ffffff 74%)",
    boxShadow: "0 0 0 3px rgba(20,184,166,0.16), 0 16px 34px rgba(15,118,110,0.16), inset 0 -3px 0 rgba(20,184,166,0.24)",
  },
  quickPadTop: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    marginBottom: 8,
  },
  quickPadChord: {
    color: "#172033",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  quickPadRoman: {
    marginTop: 6,
    color: "#0f766e",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    fontWeight: 900,
  },

  // pads
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 12,
  },
  padWrap: {
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 8,
    padding: 10,
    background: "#ffffff",
  },
  pad: {
    width: "100%",
    textAlign: "left",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    padding: 12,
    background: "linear-gradient(160deg, #ffffff 0%, #eef7ff 100%)",
    color: "#172033",
    userSelect: "none",
    touchAction: "none",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
  },
  padActive: {
    border: "1px solid rgba(20,184,166,0.68)",
    background: "linear-gradient(160deg, #ecfeff 0%, #ffffff 74%)",
    boxShadow: "0 0 0 3px rgba(20,184,166,0.16), 0 16px 34px rgba(15,118,110,0.16), inset 0 -3px 0 rgba(20,184,166,0.24)",
  },
  padTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 6,
  },
  padRoman: {
    fontSize: 11,
    color: "#0f766e",
    marginBottom: 6,
    fontWeight: 700,
  },
  padToneSummary: {
    marginBottom: 5,
    color: "#64748b",
    fontSize: 11,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  padNotes: { fontSize: 13, fontFamily: "Menlo, Monaco, Consolas, monospace" },
  padSelectLabel: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 11,
    color: "#64748b",
    fontWeight: 800,
  },
  omitRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    paddingTop: 2,
  },
  chkMini: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: 12,
    color: "#334155",
  },

  // log
  logBox: {
    marginTop: 8,
    border: "1px solid rgba(148,163,184,0.22)",
    borderRadius: 8,
    padding: 10,
    background: "#f8fafc",
    maxHeight: 220,
    overflow: "auto",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  },
  logRow: {
    display: "grid",
    gridTemplateColumns: "80px 90px 90px 90px 1fr",
    gap: 10,
    padding: "3px 0",
    borderBottom: "1px solid rgba(148,163,184,0.16)",
  },
  logT: { color: "#64748b" },
  logChord: { color: "#172033" },
  logRoman: { color: "#0f766e" },
  logInstrument: { color: "#b45309" },
  logNotes: { color: "#172033" },

  // dock
  dockWrap: {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    pointerEvents: "auto",
  },
  dockToggle: {
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.28)",
    background: "rgba(255,255,255,0.92)",
    color: "#172033",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    backdropFilter: "blur(6px)",
  },
  dockPanel: {
    width: 320,
    maxWidth: "calc(100vw - 32px)",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 18px 45px rgba(15,23,42,0.14)",
    padding: 10,
    backdropFilter: "blur(8px)",
  },
  dockGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8,
    touchAction: "none",
  },
  dockPad: {
    height: 68,
    borderRadius: 8,
    background: "linear-gradient(160deg, #ffffff 0%, #f1f7ff 100%)",
    color: "#172033",
    border: "1px solid rgba(148,163,184,0.24)",
    userSelect: "none",
    touchAction: "none",
    padding: 8,
    textAlign: "left",
  },
  dockPadActive: {
    border: "1px solid rgba(20,184,166,0.68)",
    background: "linear-gradient(160deg, #ecfeff 0%, #ffffff 80%)",
    boxShadow: "0 0 0 2px rgba(20,184,166,0.14), inset 0 -3px 0 rgba(20,184,166,0.24)",
  },
  dockPadTop: { fontSize: 11, fontWeight: 900, color: "#334155" },
  dockPadChord: {
    fontSize: 12,
    fontWeight: 900,
    marginTop: 2,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  dockPadRoman: {
    fontSize: 11,
    marginTop: 2,
    color: "#0f766e",
    fontWeight: 800,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  dockHint: {
    marginTop: 8,
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
  },
};
