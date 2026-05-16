// app/dev/page.tsx  (※パスはあなたの実ファイル構成に合わせて調整)
"use client";

import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  SECTION_SHAPES,
  generateSectionChords,
  type SectionShapeId,
} from "../lib/progressions";
import {
  filterProgressionPresets,
  PRESET_CATEGORIES,
  PRESET_CATEGORY_LABELS,
  PRESET_COMPLEXITIES,
  PRESET_GENRES,
  PRESET_MOODS,
  PRESET_USE_CASES,
  progressionPresetRomanLabel,
  progressionPresetToChords,
  STARTER_PRESETS,
  type StarterProgressionPreset,
} from "../lib/progressionPresets";
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
import {
  recommendBetweenChords,
  recommendColorOptions,
  recommendExtensions,
  recommendNextChord,
  recommendSubstitutions,
  type ChordSuggestion,
} from "../lib/chordRecommendations";

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
const PRESET_RENDER_LIMIT = 24;
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
type SmartSuggestionMode = "between" | "next" | "substitute" | "extend" | "color";
type SmartSuggestionTarget = "chord" | "gap";
type PresetDisplayMode = "both" | "chords" | "roman";

function nowStr() {
  return new Date().toLocaleTimeString();
}

function chordListFromText(value: string) {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PADS);
}

const SMART_MODES = ["between", "next", "substitute", "extend", "color"] as const;

const SMART_MODE_LABELS: Record<SmartSuggestionMode, string> = {
  between: "Between",
  next: "Next",
  substitute: "Substitute",
  extend: "Extend",
  color: "Color",
};

const SMART_MODE_HELP: Record<SmartSuggestionMode, string> = {
  between: "左右のコードを見て、間に入れる候補を出します。",
  next: "選んだコードの次に置ける候補を出します。",
  substitute: "選んだコードを機能が近い別案に置き換えます。",
  extend: "今の進行の後ろに短い続きやターンアラウンドを足します。",
  color: "借用和音やセカンダリードミナントなどの色を足します。",
};

function suggestionActionLabel(suggestion: ChordSuggestion) {
  if (suggestion.action === "replace") return "Replace";
  if (suggestion.action === "insert") return "Insert";
  if (suggestion.action === "extend") return "Add";
  return "+";
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
  const [progressionCategory, setProgressionCategory] = useState("All");
  const [progressionGenre, setProgressionGenre] = useState("All");
  const [progressionMood, setProgressionMood] = useState("All");
  const [progressionUseCase, setProgressionUseCase] = useState("All");
  const [progressionComplexity, setProgressionComplexity] = useState("All");
  const [progressionSearch, setProgressionSearch] = useState("");
  const [presetDisplayMode, setPresetDisplayMode] =
    useState<PresetDisplayMode>("both");
  const [presetVisibleCount, setPresetVisibleCount] =
    useState(PRESET_RENDER_LIMIT);
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);
  const [copiedPresetId, setCopiedPresetId] = useState<string | null>(null);
  const [presetPanelOpen, setPresetPanelOpen] = useState(true);
  const [sectionBars, setSectionBars] = useState(8);
  const [sectionShape, setSectionShape] = useState<SectionShapeId>("story");
  const [smartMode, setSmartMode] = useState<SmartSuggestionMode>("next");
  const [suggestionTarget, setSuggestionTarget] =
    useState<SmartSuggestionTarget>("chord");
  const [suggestionAnchorIndex, setSuggestionAnchorIndex] = useState<
    number | null
  >(null);
  const [suggestionGapIndex, setSuggestionGapIndex] = useState(0);
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
  const previewTimerRef = useRef<number | null>(null);

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
  const [dockOpen, setDockOpen] = useState(false);
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

  const deferredText = useDeferredValue(text);

  const chordSymbols = useMemo(() => {
    return chordListFromText(deferredText);
  }, [deferredText]);

  const chordTextPending = deferredText !== text;

  const romanContext = useMemo(
    () => chordSymbols.map((chord) => romanizeChord(chord, analysisKey)),
    [chordSymbols, analysisKey]
  );

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
      const roman = romanContext[i] ?? "";

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
    romanContext,
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
        PRESET_CATEGORIES.includes(
          saved.progressionCategory as (typeof PRESET_CATEGORIES)[number]
        )
      ) {
        setProgressionCategory(saved.progressionCategory as string);
      }
      if (
        saved.progressionGenre === "All" ||
        PRESET_GENRES.includes(saved.progressionGenre as string)
      ) {
        setProgressionGenre(saved.progressionGenre as string);
      }
      if (
        saved.progressionMood === "All" ||
        PRESET_MOODS.includes(saved.progressionMood as string)
      ) {
        setProgressionMood(saved.progressionMood as string);
      }
      if (
        saved.progressionUseCase === "All" ||
        PRESET_USE_CASES.includes(saved.progressionUseCase as string)
      ) {
        setProgressionUseCase(saved.progressionUseCase as string);
      }
      if (
        saved.progressionComplexity === "All" ||
        PRESET_COMPLEXITIES.includes(
          saved.progressionComplexity as (typeof PRESET_COMPLEXITIES)[number]
        )
      ) {
        setProgressionComplexity(saved.progressionComplexity as string);
      }
      if (typeof saved.progressionSearch === "string") {
        setProgressionSearch(saved.progressionSearch);
      }
      if (
        saved.presetDisplayMode === "both" ||
        saved.presetDisplayMode === "chords" ||
        saved.presetDisplayMode === "roman"
      ) {
        setPresetDisplayMode(saved.presetDisplayMode);
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
          progressionGenre,
          progressionMood,
          progressionUseCase,
          progressionComplexity,
          progressionSearch,
          presetDisplayMode,
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
    progressionGenre,
    progressionMood,
    progressionUseCase,
    progressionComplexity,
    progressionSearch,
    presetDisplayMode,
    sectionBars,
    sectionShape,
    padPresets,
    padOmits,
    perf,
  ]);

  const romanProgression = useMemo(
    () => romanContext.filter(Boolean).join("  "),
    [romanContext]
  );

  useEffect(() => {
    setPresetVisibleCount(PRESET_RENDER_LIMIT);
  }, [
    analysisMode,
    analysisRoot,
    progressionCategory,
    progressionComplexity,
    progressionGenre,
    progressionMood,
    progressionSearch,
    progressionUseCase,
  ]);

  const visibleProgressions = useMemo(() => {
    const includeConvertedChords = progressionSearch.trim().length > 0;
    return filterProgressionPresets(STARTER_PRESETS, {
      category: progressionCategory,
      genre: progressionGenre,
      mood: progressionMood,
      useCase: progressionUseCase,
      complexity: progressionComplexity,
      search: progressionSearch,
    }, {
      convertedChords: includeConvertedChords
        ? (preset) =>
            progressionPresetToChords(preset, {
              key: analysisRoot,
              mode: analysisMode,
            })
        : undefined,
    });
  }, [
    analysisMode,
    analysisRoot,
    progressionCategory,
    progressionComplexity,
    progressionGenre,
    progressionMood,
    progressionSearch,
    progressionUseCase,
  ]);

  const visiblePresetCards = useMemo(() => {
    if (!presetPanelOpen) return [];
    return visibleProgressions.slice(0, presetVisibleCount).map((preset) => ({
      preset,
      romanLabel: progressionPresetRomanLabel(preset),
      chords: progressionPresetToChords(preset, {
        key: analysisRoot,
        mode: analysisMode,
      }),
    }));
  }, [
    analysisMode,
    analysisRoot,
    presetPanelOpen,
    presetVisibleCount,
    visibleProgressions,
  ]);

  const applyProgression = (preset: StarterProgressionPreset) => {
    const next = progressionPresetToChords(preset, {
      key: analysisRoot,
      mode: analysisMode,
    }).slice(0, MAX_PADS);
    setText(next.join(" "));
    setPadPresets(Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS"));
    setSmartMode("next");
    setSuggestionTarget("chord");
    setSuggestionAnchorIndex(null);
    setSuggestionGapIndex(0);
  };

  const appendProgression = (preset: StarterProgressionPreset) => {
    const next = progressionPresetToChords(preset, {
      key: analysisRoot,
      mode: analysisMode,
    });
    setText((prev) => {
      const merged = [...chordListFromText(prev), ...next].slice(0, MAX_PADS);
      return merged.join(" ");
    });
    setSmartMode("next");
    setSuggestionTarget("chord");
    setSuggestionAnchorIndex(null);
  };

  const copyProgression = async (preset: StarterProgressionPreset) => {
    const chords = progressionPresetToChords(preset, {
      key: analysisRoot,
      mode: analysisMode,
    }).join(" ");

    try {
      await navigator.clipboard.writeText(chords);
      setCopiedPresetId(preset.id);
      window.setTimeout(() => setCopiedPresetId(null), 1200);
    } catch {
      setCopiedPresetId(null);
    }
  };

  const applyRandomProgression = () => {
    const source = visibleProgressions.length
      ? visibleProgressions
      : STARTER_PRESETS;
    const preset = source[Math.floor(Math.random() * source.length)];
    if (preset) applyProgression(preset);
  };

  const transformCurrentChords = (transform: ChordTransformId) => {
    const currentChords = chordListFromText(text);
    if (!currentChords.length) return;
    setText(transformChordSymbols(currentChords, transform).join(" "));
    setPadPresets(Array.from({ length: MAX_PADS }, () => "AUTO_VOICE_BASS"));
  };

  const lastRoman = romanContext[romanContext.length - 1] ?? "";

  const activeSuggestionIndex = chordSymbols.length
    ? Math.min(
        suggestionAnchorIndex ?? chordSymbols.length - 1,
        chordSymbols.length - 1
      )
    : undefined;

  const activeGapIndex =
    chordSymbols.length > 1
      ? Math.min(suggestionGapIndex, chordSymbols.length - 2)
      : undefined;

  const smartSuggestions = useMemo(() => {
    const common = {
      key: analysisRoot,
      mode: analysisMode,
      outputKey: playRoot,
      outputMode: analysisMode,
      maxSuggestions: 5,
    } as const;

    if (smartMode === "between") {
      if (activeGapIndex == null) return [];
      return recommendBetweenChords({
        leftChord: chordSymbols[activeGapIndex],
        rightChord: chordSymbols[activeGapIndex + 1],
        ...common,
      });
    }

    if (smartMode === "substitute") {
      if (activeSuggestionIndex == null) return [];
      return recommendSubstitutions({
        chord: chordSymbols[activeSuggestionIndex],
        previousChord: chordSymbols[activeSuggestionIndex - 1],
        nextChord: chordSymbols[activeSuggestionIndex + 1],
        ...common,
      });
    }

    if (smartMode === "extend") {
      return recommendExtensions({
        chords: chordSymbols,
        ...common,
        maxSuggestions: 4,
      });
    }

    if (smartMode === "color") {
      return recommendColorOptions({
        chords: chordSymbols,
        selectedIndex:
          suggestionTarget === "chord" ? activeSuggestionIndex : undefined,
        selectedGap:
          suggestionTarget !== "gap" || activeGapIndex == null
            ? undefined
            : { leftIndex: activeGapIndex, rightIndex: activeGapIndex + 1 },
        ...common,
      });
    }

    return recommendNextChord({
      chords: chordSymbols,
      selectedIndex: activeSuggestionIndex,
      ...common,
    });
  }, [
    activeGapIndex,
    activeSuggestionIndex,
    analysisMode,
    analysisRoot,
    chordSymbols,
    playRoot,
    smartMode,
    suggestionTarget,
  ]);

  const insertSuggestionIntoText = (
    suggestion: ChordSuggestion,
    mode: SmartSuggestionMode
  ) => {
    const insertSymbols = chordListFromText(
      suggestion.sourceSymbol || suggestion.symbol
    );
    setText((prev) => {
      const items = chordListFromText(prev);
      if (!items.length) return insertSymbols.join(" ");

      if (suggestion.action === "replace") {
        const replaceAt = Math.min(activeSuggestionIndex ?? 0, items.length - 1);
        return [
          ...items.slice(0, replaceAt),
          ...insertSymbols,
          ...items.slice(replaceAt + 1),
        ]
          .slice(0, MAX_PADS)
          .join(" ");
      }

      const insertAt =
        suggestion.action === "insert" ||
        (suggestion.action === "color" && mode === "between")
          ? Math.min((activeGapIndex ?? 0) + 1, items.length)
          : suggestion.action === "extend"
            ? items.length
            : Math.min((activeSuggestionIndex ?? items.length - 1) + 1, items.length);

      return [
        ...items.slice(0, insertAt),
        ...insertSymbols,
        ...items.slice(insertAt),
      ]
        .slice(0, MAX_PADS)
        .join(" ");
    });
  };

  const selectChordForSuggestions = (index: number) => {
    setSuggestionAnchorIndex(index);
    setSuggestionTarget("chord");
    if (smartMode === "between") setSmartMode("next");
  };

  const selectGapForSuggestions = (index: number) => {
    setSuggestionGapIndex(index);
    setSuggestionTarget("gap");
    setSmartMode("between");
  };

  const smartContextText = useMemo(() => {
    if (smartMode === "between") {
      if (activeGapIndex == null) return "Between needs at least two chords.";
      return `${chordSymbols[activeGapIndex]} → ? → ${
        chordSymbols[activeGapIndex + 1]
      }`;
    }

    if (smartMode === "substitute") {
      return activeSuggestionIndex == null
        ? "Replace: no chord selected"
        : `Replace: ${chordSymbols[activeSuggestionIndex]}`;
    }

    if (smartMode === "extend") {
      const tail = chordSymbols.slice(-2).join(" ");
      return tail ? `Continue from: ... ${tail}` : "Continue from: tonic";
    }

    if (smartMode === "color") {
      if (suggestionTarget === "gap" && activeGapIndex != null) {
        return `Add color to: ${chordSymbols[activeGapIndex]} → ? → ${
          chordSymbols[activeGapIndex + 1]
        }`;
      }
      return activeSuggestionIndex == null
        ? "Add color to: tonic"
        : `Add color to: ${chordSymbols[activeSuggestionIndex]}`;
    }

    return activeSuggestionIndex == null
      ? "Next after: tonic"
      : `Next after: ${chordSymbols[activeSuggestionIndex]}`;
  }, [
    activeGapIndex,
    activeSuggestionIndex,
    chordSymbols,
    smartMode,
    suggestionTarget,
  ]);

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

  const clearPreviewState = () => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewPresetId(null);
  };

  const playProgressionPreview = async (preset: StarterProgressionPreset) => {
    const chords = progressionPresetToChords(preset, {
      key: analysisRoot,
      mode: analysisMode,
    }).slice(0, MAX_PADS);
    if (!chords.length) return;

    await ensureAudioReady();
    const Tone = toneRef.current;
    const synth = await ensureSynth();
    if (!Tone) return;

    clearPreviewState();
    setPreviewPresetId(preset.id);

    let previousMidis: number[] = [];
    const startAt = Tone.now() + 0.035;
    const chordStepSec = 0.58;
    const releaseSec = 0.44;

    chords.forEach((chord, chordIndex) => {
      const voicing = buildPadVoicing(
        chord,
        centerOctave,
        "AUTO_VOICE_BASS",
        shift
      );
      if (!voicing?.midis.length) return;

      const rawMidis = voiceLead
        ? smoothVoiceLead(previousMidis, voicing.midis)
        : voicing.midis;
      const midis = normalizePadRange(rawMidis, centerOctave);
      if (!midis.length) return;
      previousMidis = midis;

      const notes = midis.map(midiToNoteName);
      const events = buildNoteEvents(notes, midis, perfRef.current, 0.72);
      const chordStart = startAt + chordIndex * chordStepSec;

      events.forEach((event) => {
        synth.triggerAttackRelease(
          event.note,
          releaseSec,
          chordStart + Math.max(0, event.delayMs) / 1000,
          Math.min(0.92, event.velocity)
        );
      });
    });

    previewTimerRef.current = window.setTimeout(
      () => clearPreviewState(),
      Math.ceil(chords.length * chordStepSec * 1000 + 360)
    );
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
    clearPreviewState();
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
          <div style={styles.presetHead}>
            <div>
              <div style={styles.stepLabel}>1. Progression Library</div>
              <div style={styles.label}>
                Browse {STARTER_PRESETS.length} roman-first progression seeds
              </div>
              <div style={styles.mutedSmall}>
                定番から少し変わったものまで、選んで鳴らして chord text に入れます。
              </div>
            </div>
            <div style={styles.presetControls}>
              <button
                type="button"
                onClick={applyRandomProgression}
                style={styles.modeButton}
              >
                Random
              </button>
              <button
                type="button"
                onClick={() => setPresetPanelOpen((v) => !v)}
                aria-expanded={presetPanelOpen}
                style={{
                  ...styles.modeButton,
                  ...(presetPanelOpen ? styles.modeButtonOn : {}),
                }}
              >
                {presetPanelOpen ? "Hide presets" : "Show presets"}
              </button>
            </div>
          </div>

          {presetPanelOpen ? (
            <>
              <div style={styles.presetControls}>
                <select
                  value={progressionCategory}
                  onChange={(e) => setProgressionCategory(e.target.value)}
                  style={{ ...styles.select, width: 146 }}
                >
                  {(["All", ...PRESET_CATEGORIES] as const).map((category) => (
                    <option key={category} value={category}>
                      {category === "All"
                        ? "All categories"
                        : PRESET_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <select
                  value={progressionGenre}
                  onChange={(e) => setProgressionGenre(e.target.value)}
                  style={{ ...styles.select, width: 112 }}
                >
                  {(["All", ...PRESET_GENRES] as const).map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                </select>
                <select
                  value={progressionMood}
                  onChange={(e) => setProgressionMood(e.target.value)}
                  style={{ ...styles.select, width: 112 }}
                >
                  {(["All", ...PRESET_MOODS] as const).map((mood) => (
                    <option key={mood} value={mood}>
                      {mood}
                    </option>
                  ))}
                </select>
                <select
                  value={progressionUseCase}
                  onChange={(e) => setProgressionUseCase(e.target.value)}
                  style={{ ...styles.select, width: 124 }}
                >
                  {(["All", ...PRESET_USE_CASES] as const).map((useCase) => (
                    <option key={useCase} value={useCase}>
                      {useCase === "All" ? "Any use" : useCase}
                    </option>
                  ))}
                </select>
                <select
                  value={progressionComplexity}
                  onChange={(e) => setProgressionComplexity(e.target.value)}
                  style={{ ...styles.select, width: 116 }}
                >
                  {(["All", ...PRESET_COMPLEXITIES] as const).map(
                    (complexity) => (
                      <option key={complexity} value={complexity}>
                        {complexity === "All" ? "Any C" : `C${complexity}`}
                      </option>
                    )
                  )}
                </select>
                <input
                  value={progressionSearch}
                  onChange={(e) => setProgressionSearch(e.target.value)}
                  style={styles.searchInput}
                  placeholder="search name, roman, chords"
                />
                <div style={styles.segmented}>
                  {(["both", "chords", "roman"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPresetDisplayMode(mode)}
                      aria-pressed={presetDisplayMode === mode}
                      style={{
                        ...styles.segmentButton,
                        ...(presetDisplayMode === mode
                          ? styles.segmentButtonOn
                          : {}),
                      }}
                    >
                      {mode === "both"
                        ? "Both"
                        : mode === "chords"
                          ? "Chords"
                          : "Roman"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={styles.libraryMeta}>
                Showing {visiblePresetCards.length} of {visibleProgressions.length}
                {visibleProgressions.length !== STARTER_PRESETS.length
                  ? ` filtered from ${STARTER_PRESETS.length}`
                  : ""}
              </div>

              <div style={styles.presetList}>
                {visiblePresetCards.map(({ preset, romanLabel, chords }) => {
                  const chordLabel = chords.join(" ");
                  const presetTags = [
                    PRESET_CATEGORY_LABELS[preset.category],
                    preset.genres.slice(0, 2).join(" / "),
                    preset.moods.slice(0, 2).join(" / "),
                    preset.useCases.slice(0, 2).join(" / "),
                    `C${preset.complexity}`,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  const vibe = preset.vibeExamples?.slice(0, 2).join(" / ");
                  return (
                    <div key={preset.id} style={styles.presetItem}>
                      <div style={styles.presetMain}>
                        <div style={styles.presetTopLine}>
                          <span style={styles.presetName}>{preset.name}</span>
                          <span style={styles.presetTags}>{presetTags}</span>
                        </div>
                        {presetDisplayMode !== "chords" ? (
                          <div style={styles.presetAlias}>{romanLabel}</div>
                        ) : null}
                        {presetDisplayMode !== "roman" ? (
                          <div style={styles.presetChords}>{chordLabel}</div>
                        ) : null}
                        <div style={styles.presetDescription}>
                          {preset.description}
                        </div>
                        {vibe ? (
                          <div style={styles.presetVibe}>
                            Similar vibe: {vibe}
                          </div>
                        ) : null}
                      </div>
                      <div style={styles.presetActions}>
                        <button
                          type="button"
                          onClick={() => playProgressionPreview(preset)}
                          style={{
                            ...styles.presetActionButton,
                            ...(previewPresetId === preset.id
                              ? styles.presetActionButtonOn
                              : {}),
                          }}
                          title="Audition this progression"
                        >
                          {previewPresetId === preset.id ? "Playing" : "Play"}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyProgression(preset)}
                          style={styles.presetActionButton}
                          title="Replace current chord text"
                        >
                          Use
                        </button>
                        <button
                          type="button"
                          onClick={() => appendProgression(preset)}
                          style={styles.presetActionButton}
                          title="Append to chord list"
                        >
                          Append
                        </button>
                        <button
                          type="button"
                          onClick={() => copyProgression(preset)}
                          style={styles.presetActionButton}
                          title="Copy converted chords"
                        >
                          {copiedPresetId === preset.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {visibleProgressions.length > visiblePresetCards.length ? (
                <button
                  type="button"
                  onClick={() =>
                    setPresetVisibleCount((count) =>
                      Math.min(count + PRESET_RENDER_LIMIT, visibleProgressions.length)
                    )
                  }
                  style={styles.showMoreButton}
                >
                  Show more
                </button>
              ) : null}

              {visibleProgressions.length === 0 ? (
                <div style={styles.emptyHint}>No matching presets</div>
              ) : null}
            </>
          ) : null}
        </section>

        <section style={styles.section}>
          <div style={styles.workflowHead}>
            <div>
              <div style={styles.stepLabel}>2. Your Progression</div>
              <div style={styles.label}>
                Chord list（スペース/カンマ区切り → Pad割当）
                {chordTextPending ? (
                  <span style={styles.pendingTag}>updating</span>
                ) : null}
              </div>
            </div>
            <div style={styles.mutedSmall}>Text is the source of truth</div>
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
          </div>

          {chordSymbols.length ? (
            <div style={styles.progressionChipRow}>
              {chordSymbols.map((chord, idx) => (
                <React.Fragment key={`${chord}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => selectChordForSuggestions(idx)}
                    aria-pressed={
                      suggestionTarget === "chord" && activeSuggestionIndex === idx
                    }
                    style={{
                      ...styles.chordChip,
                      ...(suggestionTarget === "chord" &&
                      activeSuggestionIndex === idx
                        ? styles.chordChipOn
                        : {}),
                    }}
                    title={`Use ${chord} for suggestions`}
                  >
                    <span style={styles.chordChipIndex}>#{idx + 1}</span>
                    <span>{chord}</span>
                  </button>
                  {idx < chordSymbols.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => selectGapForSuggestions(idx)}
                      aria-pressed={
                        suggestionTarget === "gap" && activeGapIndex === idx
                      }
                      style={{
                        ...styles.gapMiniButton,
                        ...(suggestionTarget === "gap" && activeGapIndex === idx
                          ? styles.gapMiniButtonOn
                          : {}),
                      }}
                      title={`Between ${chord} and ${chordSymbols[idx + 1]}`}
                    >
                      ?
                    </button>
                  ) : null}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div style={styles.emptyHint}>
              プリセットを選ぶか、コードを入力するとここに進行が並びます。
            </div>
          )}
        </section>

        <section style={styles.section}>
          <div style={styles.smartHead}>
            <div>
              <div style={styles.stepLabel}>3. Make It Original</div>
              <div style={styles.label}>Smart chord suggestions</div>
              <div style={styles.mutedSmall}>
                {SMART_MODE_HELP[smartMode]}
              </div>
            </div>

            <div style={styles.smartControls}>
              <div style={styles.segmented}>
                {SMART_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setSmartMode(mode);
                      if (mode === "between") setSuggestionTarget("gap");
                      if (mode === "next" || mode === "substitute") {
                        setSuggestionTarget("chord");
                      }
                    }}
                    aria-pressed={smartMode === mode}
                    style={{
                      ...styles.segmentButton,
                      ...(smartMode === mode ? styles.segmentButtonOn : {}),
                    }}
                  >
                    {SMART_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>

              {smartMode === "next" ||
              smartMode === "substitute" ||
              (smartMode === "color" && suggestionTarget === "chord") ? (
                <select
                  value={activeSuggestionIndex ?? 0}
                  onChange={(e) => {
                    setSuggestionTarget("chord");
                    setSuggestionAnchorIndex(Number(e.target.value));
                  }}
                  style={{ ...styles.select, width: 168 }}
                  disabled={!chordSymbols.length}
                >
                  {chordSymbols.length ? (
                    chordSymbols.map((chord, idx) => (
                      <option key={`${chord}-${idx}`} value={idx}>
                        After #{idx + 1} {chord}
                      </option>
                    ))
                  ) : (
                    <option value={0}>Start from tonic</option>
                  )}
                </select>
              ) : null}
            </div>
          </div>

          <div style={styles.contextLine}>{smartContextText}</div>

          <div style={styles.suggestionRows}>
            {smartSuggestions.map((suggestion) => (
              <div
                key={`${smartMode}-${suggestion.roman}-${suggestion.sourceSymbol}`}
                style={styles.suggestionRow}
              >
                <div style={styles.suggestionMain}>
                  <div style={styles.suggestionTop}>
                    <span style={styles.smartChord}>{suggestion.symbol}</span>
                    <span style={styles.smartRoman}>{suggestion.roman}</span>
                  </div>
                  <div style={styles.smartMeta}>
                    <span>{suggestion.label}</span>
                    <span>{suggestion.category}</span>
                  </div>
                  <div style={styles.smartReason}>{suggestion.reason}</div>
                </div>
                <button
                  type="button"
                  onClick={() => insertSuggestionIntoText(suggestion, smartMode)}
                  style={styles.smartAction}
                  title={
                    suggestion.sourceSymbol !== suggestion.symbol
                      ? `Writes ${suggestion.sourceSymbol} into the source chord list`
                      : "Update chord list"
                  }
                >
                  {suggestionActionLabel(suggestion)}
                </button>
              </div>
            ))}
          </div>

          {!smartSuggestions.length ? (
            <div style={styles.emptyHint}>No suggestions yet.</div>
          ) : null}
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
  stepLabel: {
    color: "#0f766e",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  muted: { fontSize: 12, color: "#64748b" },
  mutedSmall: { fontSize: 11, color: "#64748b" },
  pendingTag: {
    marginLeft: 8,
    color: "#0f766e",
    fontSize: 10,
    fontWeight: 900,
  },

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
  workflowHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "end",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 6,
  },
  progressionChipRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.20)",
    background: "#f8fafc",
  },
  chordChip: {
    height: 32,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#172033",
    padding: "0 9px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  chordChipOn: {
    border: "1px solid rgba(20,184,166,0.52)",
    background: "#ecfeff",
    color: "#0f766e",
    boxShadow: "inset 0 -2px 0 rgba(20,184,166,0.20)",
  },
  chordChipIndex: {
    color: "#94a3b8",
    fontSize: 10,
    fontFamily: 'system-ui, -apple-system, "SF Pro Text", sans-serif',
  },
  gapMiniButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px dashed rgba(148,163,184,0.42)",
    background: "#ffffff",
    color: "#64748b",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  },
  gapMiniButtonOn: {
    border: "1px solid rgba(20,184,166,0.52)",
    background: "#f0fdfa",
    color: "#0f766e",
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

  presetHead: {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  presetControls: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  searchInput: {
    width: 184,
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#172033",
    padding: "0 10px",
    fontSize: 12,
  },
  libraryMeta: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    marginBottom: 8,
  },
  presetList: {
    display: "grid",
    gap: 8,
  },
  presetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 8,
  },
  presetItem: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "#ffffff",
    padding: 10,
  },
  presetMain: {
    flex: "1 1 360px",
    minWidth: 0,
    color: "#172033",
    textAlign: "left",
    display: "grid",
    gap: 4,
  },
  presetTopLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
  },
  presetName: {
    fontSize: 12,
    fontWeight: 900,
  },
  presetAlias: {
    color: "#0f766e",
    fontSize: 11,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontWeight: 900,
  },
  presetChords: {
    color: "#64748b",
    fontSize: 11,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  presetTags: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  presetAppend: {
    borderRadius: 8,
    border: "1px solid rgba(20,184,166,0.34)",
    background: "#ecfeff",
    color: "#0f766e",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 18,
  },
  presetDescription: {
    color: "#334155",
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  presetVibe: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  presetActions: {
    flex: "0 1 230px",
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    maxWidth: 230,
  },
  presetActionButton: {
    height: 30,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 11,
    padding: "0 9px",
  },
  presetActionButtonOn: {
    border: "1px solid rgba(20,184,166,0.42)",
    background: "#ecfeff",
    color: "#0f766e",
  },
  showMoreButton: {
    width: "100%",
    height: 34,
    marginTop: 8,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#f8fafc",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  },

  smartHead: {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  smartControls: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  segmented: {
    display: "inline-flex",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    overflow: "hidden",
  },
  segmentButton: {
    height: 34,
    padding: "0 12px",
    border: 0,
    borderRight: "1px solid rgba(148,163,184,0.22)",
    background: "#ffffff",
    color: "#64748b",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
  },
  segmentButtonOn: {
    background: "#ecfeff",
    color: "#0f766e",
    boxShadow: "inset 0 -2px 0 rgba(20,184,166,0.28)",
  },
  contextLine: {
    marginBottom: 8,
    borderRadius: 8,
    border: "1px solid rgba(20,184,166,0.20)",
    background: "#f0fdfa",
    color: "#115e59",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  gapRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  gapButton: {
    height: 34,
    maxWidth: 220,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.30)",
    background: "#ffffff",
    color: "#172033",
    padding: "0 9px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  gapButtonOn: {
    border: "1px solid rgba(20,184,166,0.48)",
    background: "#f0fdfa",
    color: "#0f766e",
  },
  gapArrow: {
    color: "#94a3b8",
    fontWeight: 900,
  },
  smartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 8,
  },
  suggestionRows: {
    display: "grid",
    gap: 8,
  },
  suggestionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#172033",
    padding: 10,
  },
  suggestionMain: {
    minWidth: 0,
    display: "grid",
    gap: 4,
  },
  suggestionTop: {
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  smartCard: {
    display: "grid",
    gridTemplateRows: "auto auto 1fr auto",
    gap: 6,
    minHeight: 126,
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#172033",
    padding: 10,
  },
  smartCardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "baseline",
  },
  smartChord: {
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 18,
    fontWeight: 900,
    color: "#172033",
  },
  smartRoman: {
    color: "#0f766e",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    fontWeight: 900,
  },
  smartMeta: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
  },
  smartReason: {
    color: "#334155",
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  smartAction: {
    height: 30,
    borderRadius: 8,
    border: "1px solid rgba(20,184,166,0.34)",
    background: "#ecfeff",
    color: "#0f766e",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
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
