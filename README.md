# ChordPad

Lightweight browser chord pad for quickly trying progressions, voicings, and simple performance ideas.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Notes

- Audio uses Tone.js and is lazy-loaded on first playback.
- The UI uses system fonts and plain CSS to keep the initial load small.
- Progression presets, chord transforms, section generation, and MIDI export are local/static.
