// app/dev/page.tsx  (※パスはあなたの実ファイル構成に合わせて調整)
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import {
  buildPadVoicing,
  PadVoicingPreset,
  PAD_PRESETS,
  romanizeChord,
  type KeySig,
  signedSemitoneDiff,
  type OmitFlags,
} from "../lib/voicing";
import { PianoKeyboard } from "../app/PianoKeyboard";

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
  notes: string[];
  midis: number[];
  shift: number;
  perf: PerformanceSettings;
};

const MAX_PADS = 16;

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

function nowStr() {
  return new Date().toLocaleTimeString();
}

type HoldState = {
  notes: string[];
  scheduleIds: number[]; // Tone.Transport.scheduleOnce ids
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
  const [centerOctave, setCenterOctave] = useState(5);

  // --- per pad preset ---
  const [padPresets, setPadPresets] = useState<PadVoicingPreset[]>(() =>
    Array.from({ length: MAX_PADS }, () => "PAD_TRIAD_BASS_35R")
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
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const limiterRef = useRef<Tone.Limiter | null>(null);
  const audioReadyRef = useRef(false);

  // hold state (multi-press allowed): cancelable schedule per pad idx
  const activeHoldRef = useRef<Record<number, HoldState>>({});

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
    return Array.from({ length: MAX_PADS }, (_, i) => {
      const chord = chordSymbols[i] ?? "";
      const preset = padPresets[i] ?? "PAD_TRIAD_BASS_35R";
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
        };
      }

      const v = buildPadVoicing(chord, centerOctave, preset, shift, { omit });
      const roman = romanizeChord(chord, analysisKey);

      return {
        idx: i,
        chord,
        roman,
        preset,
        notes: v?.notes ?? [],
        midis: v?.midis ?? [],
        ok: Boolean(v),
        omit,
      };
    });
  }, [chordSymbols, padPresets, padOmits, centerOctave, shift, analysisKey]);

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

  const romanProgression = useMemo(() => {
    const romans = chordSymbols
      .map((c) => romanizeChord(c, analysisKey))
      .filter(Boolean);
    return romans.join("  ");
  }, [chordSymbols, analysisKey]);

  const ensureSynth = () => {
    if (synthRef.current) return synthRef.current;

    const limiter = new Tone.Limiter(-12).toDestination();
    limiterRef.current = limiter;

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.08, sustain: 0.75, release: 0.28 },
    }).connect(limiter);

    synth.volume.value = -16;
    synthRef.current = synth;
    return synth;
  };

  const ensureAudioReady = async () => {
    // Always try to resume on user gesture (iOS can suspend)
    await Tone.start();
    ensureSynth();

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

  const stopHoldByIndex = (idx: number) => {
    const h = activeHoldRef.current[idx];
    if (!h) return;

    // cancel scheduled attacks for this hold only
    h.scheduleIds.forEach((id) => Tone.Transport.clear(id));

    const synth = synthRef.current;
    if (synth) synth.triggerRelease(h.notes, Tone.now());

    delete activeHoldRef.current[idx];
    delete holdMidisRef.current[idx];
    requestSyncActiveMidis();
  };

  const startHoldByIndex = async (idx: number) => {
    const p = padModelsRef.current[idx];
    if (!p?.ok || !p.notes.length) return;
    if (activeHoldRef.current[idx]) return; // already holding

    setGuidePadIdx(idx);

    await ensureAudioReady();
    const synth = ensureSynth();

    // Visualizer: light full chord immediately (stable, cheap)
    holdMidisRef.current[idx] = p.midis;
    requestSyncActiveMidis();

    // schedule strum/arp attacks via Transport (cancelable, less timer jitter)
    const events = buildNoteEvents(p.notes, p.midis, perfRef.current, 0.9);

    const scheduleIds: number[] = [];
    const notesToRelease: string[] = [];

    for (const ev of events) {
      notesToRelease.push(ev.note);

      const delaySec = Math.max(0, ev.delayMs) / 1000;
      const id = Tone.Transport.scheduleOnce((time) => {
        // Use `time` provided by Tone for sample-accurate scheduling
        synth.triggerAttack(ev.note, time, ev.velocity);
      }, `+${delaySec}`);

      scheduleIds.push(id);
    }

    activeHoldRef.current[idx] = { notes: notesToRelease, scheduleIds };

    // Log only at hold start (avoid spam)
    pushLog({
      t: nowStr(),
      chord: p.chord,
      roman: p.roman,
      preset: p.preset,
      notes: p.notes,
      midis: p.midis,
      shift: shiftRef.current,
      perf: perfRef.current,
    });
  };

  const stopAll = () => {
    // cancel everything scheduled
    Tone.Transport.stop();
    Tone.Transport.cancel(0);

    // release any held notes
    const synth = synthRef.current;
    if (synth) synth.releaseAll();

    // clear holds bookkeeping
    activeHoldRef.current = {};
    holdMidisRef.current = {};

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
      synthRef.current?.dispose();
      limiterRef.current?.dispose();
      synthRef.current = null;
      limiterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // -------------------------
  // Keyboard hold (1..9)
  // -------------------------
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;
      if (e.repeat) return;

      const n = Number(e.key);
      if (!Number.isFinite(n) || n < 1 || n > 9) return;

      const idx = n - 1;
      await startHoldByIndex(idx);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!Number.isFinite(n) || n < 1 || n > 9) return;
      const idx = n - 1;
      stopHoldByIndex(idx);
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
    const synth = ensureSynth();

    const note = Tone.Frequency(midi, "midi").toNote();
    const events = buildNoteEvents([note], [midi], perfRef.current, 0.35);

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
    const min = Tone.Frequency(`C${Math.max(1, centerOctave - 2)}`).toMidi();
    const max = Tone.Frequency(`B${centerOctave + 2}`).toMidi();
    return { min, max };
  }, [centerOctave]);

  const pickedInfo = useMemo(() => {
    if (pickedMidi == null) return null;

    const soundingNote = Tone.Frequency(pickedMidi, "midi").toNote();

    // テキスト窓は「解析側」なので -shift で戻す
    const inputMidi = pickedMidi - shift;
    const inputNote = Tone.Frequency(inputMidi, "midi").toNote();
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
      const pc = toFlatPc(Tone.Frequency(m, "midi").toNote());
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
          style={styles.dockToggle}
          title="PadDock"
        >
          {dockOpen ? "Dock×" : "Dock"}
        </button>

        {dockOpen ? (
          <div style={styles.dockPanel}>
            <div style={styles.dockGrid}>
              {padModels.map((p) => {
                const disabled = !p.ok;
                return (
                  <button
                    key={`dock-${p.idx}`}
                    type="button"
                    disabled={disabled}
                    onPointerDown={async (e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).setPointerCapture?.(
                        e.pointerId
                      );
                      await startHoldByIndex(p.idx);
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault();
                      stopHoldByIndex(p.idx);
                      (e.currentTarget as HTMLElement).releasePointerCapture?.(
                        e.pointerId
                      );
                    }}
                    onPointerCancel={(e) => {
                      e.preventDefault();
                      stopHoldByIndex(p.idx);
                    }}
                    style={{
                      ...styles.dockPad,
                      opacity: disabled ? 0.35 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                      outline:
                        guidePadIdx === p.idx
                          ? "2px solid rgba(147,197,253,0.55)"
                          : "1px solid rgba(148,163,184,0.18)",
                    }}
                    title={
                      p.chord ? `#${p.idx + 1} ${p.chord}` : `#${p.idx + 1}`
                    }
                  >
                    <div style={styles.dockPadTop}>#{p.idx + 1}</div>
                    <div style={styles.dockPadChord}>{p.chord || "—"}</div>
                    <div style={styles.dockPadRoman}>{p.roman || " "}</div>
                  </button>
                );
              })}
            </div>
            <div style={styles.dockHint}>
              押している間鳴る（同時押しOK） / 離すと止まる
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
        <h1 style={styles.h1}>Tone.js Pad Voicing Test</h1>

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
              min={2}
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
            <button onClick={stopAll} style={styles.btnDanger} type="button">
              Stop
            </button>
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
            1〜9キーも、Dockも、情報Padも「押している間鳴る / 離すと止まる」。
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
            Pads（押している間鳴る / 1〜9でもホールド） ※Padごとにボイシング指定
          </div>

          <div style={styles.grid}>
            {padModels.map((p) => {
              const disabled = !p.ok;
              return (
                <div key={p.idx} style={styles.padWrap}>
                  <button
                    type="button"
                    disabled={disabled}
                    onPointerDown={async (e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).setPointerCapture?.(
                        e.pointerId
                      );
                      await startHoldByIndex(p.idx);
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault();
                      stopHoldByIndex(p.idx);
                      (e.currentTarget as HTMLElement).releasePointerCapture?.(
                        e.pointerId
                      );
                    }}
                    onPointerCancel={(e) => {
                      e.preventDefault();
                      stopHoldByIndex(p.idx);
                    }}
                    style={{
                      ...styles.pad,
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                      outline:
                        guidePadIdx === p.idx
                          ? "2px solid rgba(147,197,253,0.55)"
                          : "none",
                    }}
                  >
                    <div style={styles.padTop}>
                      #{p.idx + 1} {p.chord || "—"}
                    </div>
                    <div style={styles.padRoman}>{p.roman || " "}</div>
                    <div style={styles.padNotes}>
                      {p.notes.length
                        ? p.notes.join(" ")
                        : "（解析できません）"}
                    </div>
                    <div style={styles.mutedSmall}>
                      midis: {p.midis.length ? p.midis.join(", ") : "-"}
                    </div>
                  </button>

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
    background: "#020617",
    color: "#e5e7eb",
    padding: 24,
    display: "flex",
    justifyContent: "center",
    fontFamily: 'system-ui, -apple-system, "SF Pro Text", sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: 980,
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: 18,
    background: "#0b1220",
    boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
  },
  h1: { fontSize: 18, margin: 0, marginBottom: 14, fontWeight: 800 },

  section: { marginTop: 14 },
  sectionRow: { marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" },

  label: { fontSize: 12, fontWeight: 800, marginBottom: 6 },
  muted: { fontSize: 12, color: "#94a3b8" },
  mutedSmall: { fontSize: 11, color: "#94a3b8" },

  row2: { display: "flex", gap: 8 },

  textarea: {
    width: "100%",
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: 10,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
  },
  select: {
    width: "100%",
    height: 34,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "0 10px",
  },

  btnMini: {
    height: 28,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid #334155",
    background: "#0b1220",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },
  btnDanger: {
    height: 36,
    padding: "0 12px",
    borderRadius: 10,
    border: "1px solid #7f1d1d",
    background: "#111827",
    color: "#fecaca",
    cursor: "pointer",
    fontWeight: 900,
  },

  romanBox: {
    border: "1px solid #1f2937",
    borderRadius: 10,
    padding: 10,
    background: "#020617",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    color: "#cbd5e1",
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
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
  },
  perfItem: {
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(2,6,23,0.35)",
  },
  perfHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 800,
    color: "#cbd5e1",
  },
  perfVal: { fontSize: 11, color: "#94a3b8", fontWeight: 800 },

  // guide
  guideRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.12)",
    background: "rgba(2,6,23,0.35)",
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
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(2,6,23,0.35)",
  },
  suggestTitle: { fontSize: 12, fontWeight: 900, marginBottom: 8 },
  suggestMeta: {
    display: "grid",
    gap: 4,
    marginBottom: 10,
    fontSize: 12,
  },
  suggestKey: { color: "#94a3b8", fontWeight: 800 },
  suggestVal: {
    color: "#e5e7eb",
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
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.20)",
    background: "#020617",
    color: "#e5e7eb",
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
    color: "#93c5fd",
    fontWeight: 800,
  },

  // pads
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  padWrap: {
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(2,6,23,0.35)",
  },
  pad: {
    width: "100%",
    textAlign: "left",
    borderRadius: 14,
    border: "1px solid #263045",
    padding: 12,
    background: "radial-gradient(circle at 30% 30%, #1f2937, #020617 70%)",
    color: "#e5e7eb",
    userSelect: "none",
    touchAction: "none",
  },
  padTop: { fontSize: 12, fontWeight: 900, marginBottom: 6 },
  padRoman: {
    fontSize: 11,
    color: "#93c5fd",
    marginBottom: 6,
    fontWeight: 700,
  },
  padNotes: { fontSize: 13, fontFamily: "Menlo, Monaco, Consolas, monospace" },
  padSelectLabel: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 11,
    color: "#94a3b8",
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
    color: "#cbd5e1",
  },

  // log
  logBox: {
    marginTop: 8,
    border: "1px solid #1f2937",
    borderRadius: 10,
    padding: 10,
    background: "#020617",
    maxHeight: 220,
    overflow: "auto",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  },
  logRow: {
    display: "grid",
    gridTemplateColumns: "80px 90px 90px 1fr",
    gap: 10,
    padding: "3px 0",
    borderBottom: "1px solid rgba(148,163,184,0.12)",
  },
  logT: { color: "#94a3b8" },
  logChord: { color: "#e5e7eb" },
  logRoman: { color: "#93c5fd" },
  logNotes: { color: "#e5e7eb" },

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
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(2,6,23,0.85)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    backdropFilter: "blur(6px)",
  },
  dockPanel: {
    width: 320,
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.82)",
    boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
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
    borderRadius: 14,
    background: "radial-gradient(circle at 30% 30%, #1f2937, #020617 75%)",
    color: "#e5e7eb",
    border: "1px solid rgba(148,163,184,0.18)",
    userSelect: "none",
    touchAction: "none",
    padding: 8,
    textAlign: "left",
  },
  dockPadTop: { fontSize: 11, fontWeight: 900, color: "#cbd5e1" },
  dockPadChord: {
    fontSize: 12,
    fontWeight: 900,
    marginTop: 2,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  dockPadRoman: {
    fontSize: 11,
    marginTop: 2,
    color: "#93c5fd",
    fontWeight: 800,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  },
  dockHint: {
    marginTop: 8,
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: 700,
  },
};
