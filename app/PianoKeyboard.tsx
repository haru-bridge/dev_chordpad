// app/PianoKeyboard.tsx
"use client";

import React, { memo, useMemo, useRef, useEffect, useState } from "react";
import { midiToNoteName } from "../lib/musicNote";

type Props = {
  minMidi: number; // inclusive
  maxMidi: number; // inclusive
  height?: number;

  // sounding highlight
  activeMidis?: number[];

  // UI selection highlight
  pickedMidi?: number | null;

  // guide highlight
  guideChordMidis?: number[];
  guideExtMidis?: number[];

  onKeyPress?: (midi: number) => void;
};

const WHITE_MOD12 = new Set([0, 2, 4, 5, 7, 9, 11]); // C D E F G A B
const BLACK_MOD12 = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#

function isWhite(midi: number) {
  return WHITE_MOD12.has(((midi % 12) + 12) % 12);
}
function isBlack(midi: number) {
  return BLACK_MOD12.has(((midi % 12) + 12) % 12);
}

function blackKeyCenterRatio(mod12: number) {
  switch (mod12) {
    case 1:
      return 0.65; // C#
    case 3:
      return 0.6; // D#
    case 6:
      return 0.68; // F#
    case 8:
      return 0.62; // G#
    case 10:
      return 0.58; // A#
    default:
      return 0.62;
  }
}

type KeyModel = {
  midi: number;
  whiteIndex: number;
  isWhite: boolean;
  mod12: number;
};

export const PianoKeyboard = memo(function PianoKeyboard({
  minMidi,
  maxMidi,
  height = 92,
  activeMidis = [],
  pickedMidi = null,
  guideChordMidis = [],
  guideExtMidis = [],
  onKeyPress,
}: Props) {
  const activeSet = useMemo(() => new Set(activeMidis), [activeMidis]);
  const guideChordSet = useMemo(
    () => new Set(guideChordMidis),
    [guideChordMidis]
  );
  const guideExtSet = useMemo(() => new Set(guideExtMidis), [guideExtMidis]);

  const { whiteKeys, blackKeys, totalWhite } = useMemo(() => {
    const whites: KeyModel[] = [];
    const blacks: KeyModel[] = [];
    let whiteCount = 0;

    for (let m = minMidi; m <= maxMidi; m++) {
      const w = isWhite(m);
      const model: KeyModel = {
        midi: m,
        whiteIndex: w ? whiteCount : whiteCount - 1,
        isWhite: w,
        mod12: ((m % 12) + 12) % 12,
      };
      if (w) whites.push(model);
      else if (isBlack(m)) blacks.push(model);
      if (w) whiteCount++;
    }

    return { whiteKeys: whites, blackKeys: blacks, totalWhite: whiteCount };
  }, [minMidi, maxMidi]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState(780);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWrapW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const whiteW = Math.max(18, wrapW / Math.max(1, totalWhite));
  const whiteH = height;
  const blackW = whiteW * 0.62;
  const blackH = whiteH * 0.62;

  const onDown = (midi: number) => {
    onKeyPress?.(midi);
  };

  const guideShadowFor = (midi: number) => {
    // “薄いガイド”＝キー色は変えず、下にラインだけ
    if (guideChordSet.has(midi)) return "inset 0 -6px 0 rgba(20,184,166,0.42)";
    if (guideExtSet.has(midi)) return "inset 0 -6px 0 rgba(251,191,36,0.30)";
    return undefined;
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height: whiteH,
        borderRadius: 8,
        border: "1px solid rgba(212,212,216,0.14)",
        background: "#ffffff",
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* white keys */}
      {whiteKeys.map((k) => {
        const x = k.whiteIndex * whiteW;
        const active = activeSet.has(k.midi);
        const picked = pickedMidi === k.midi;

        return (
          <div
            key={`w-${k.midi}`}
            onPointerDown={(e) => {
              e.preventDefault();
              onDown(k.midi);
            }}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: whiteW,
              height: whiteH,
              background: active ? "#ccfbf1" : "#ffffff",
              borderRight: "1px solid rgba(148,163,184,0.28)",
              boxSizing: "border-box",
              cursor: "pointer",
              boxShadow:
                (picked ? "inset 0 0 0 2px rgba(251,191,36,0.95)" : "") ||
                guideShadowFor(k.midi) ||
                undefined,
            }}
            title={midiToNoteName(k.midi)}
          />
        );
      })}

      {/* black keys */}
      {blackKeys.map((k) => {
        const ratio = blackKeyCenterRatio(k.mod12);
        const x = k.whiteIndex * whiteW + whiteW * ratio - blackW / 2;

        const active = activeSet.has(k.midi);
        const picked = pickedMidi === k.midi;

        return (
          <div
            key={`b-${k.midi}`}
            onPointerDown={(e) => {
              e.preventDefault();
              onDown(k.midi);
            }}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: blackW,
              height: blackH,
              background: active ? "#14b8a6" : "#1f2937",
              borderRadius: 5,
              boxShadow:
                (picked ? "inset 0 0 0 2px rgba(251,191,36,0.95)" : "") ||
                guideShadowFor(k.midi) ||
                "0 6px 18px rgba(0,0,0,0.45)",
              cursor: "pointer",
            }}
            title={midiToNoteName(k.midi)}
          />
        );
      })}
    </div>
  );
});
