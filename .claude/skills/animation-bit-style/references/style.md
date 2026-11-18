# The look, and why

## Picture

- **Resolution.** The 3D layer renders at 360x640 and is scaled up 3x with nearest-neighbour, giving visible, clean pixels. The HUD is drawn at full 1080x1920 on a 540x960 grid so text stays legible.
- **Shading.** A stepped light ramp (about seven flat tones) and one flat highlight shape. No smooth gradients, no dithering, no surface texture. Dither and line-hatching were tried and rejected as noisy.
- **Outlines.** Only two: a pale rim where the subject meets the backdrop, and a coloured edge round the highlighted part that is currently working. Dark ink lines round every internal part were tried and rejected once the forms became smooth.
- **Palette.** Backdrop near-black navy; subject's inside in a muted slate so the accents pop; bone in cream; accents cyan `#3fd9f2`, pink `#ff4fa8`, green `#8be04e`; gold `#ffd23f` for emphasised text and needles.
- **Backdrop.** Flat dark colour with concentric stepped bands forming a spotlight behind the subject, darker floor with a faint grid, a glowing ring on the podium, a contact shadow. Curtains and stripes were removed because they competed with the subject.
- **Reveal.** A horizontal scan plane sweeps down with a bright ring; the outside disappears above it. The cut surface glows.
- **Sparks.** Chunky square particles fly off the highlighted part while it works, in its accent colour.

## On-screen graphics

Every panel reads the timeline, so nothing can drift out of sync.

- **Speed badge** top-left: real speed (red) / slow motion (cyan).
- **Caption** top centre: hard drop shadow, gold corner brackets, text types itself, a sheen passes once it lands.
- **Labels**: leader line with a travelling pulse, a radar ping on the target.
- **Callouts**: one gold word that punches in oversized with a burst of rays, at the peak of each movement.
- **Live chart**: powers on like a CRT; 12 bevelled segments per row with a glowing leading segment, a peak-hold tick that falls back, a percentage, sparks and a pulsing row when a value peaks.
- **Signal trace** bottom-left: three scrolling bursts, one per compared thing.
- **Gauge** bottom-right: swept arc, needle with motion ghosts, a target zone that turns the ring pink and swaps the label when reached.
- **Summary**: checklist ticking off, a radar chart filling out, "100%".
- **Call to action**: marching dotted border, bobbing chip, twinkles.

Keep the bottom 15% of the frame free of essential text - platform buttons and captions cover it.

## Text

- Thai in **Kanit** bold, rendered then thresholded so edges are hard pixels. Mitr breaks up at this size; Prompt and IBM Plex Sans Thai are acceptable alternatives (`font=` option).
- English technical terms stay in capitals in the accent colour.
- Entrance styles: `motion=1` typed (default), `2` slide with a spring, `3` glitch, `0` instant.

## Sound

Synthesized in `tools/audio.mjs`; no samples.

- 120 BPM chiptune in A minor: one movement per bar, so motion and music line up.
- During slow motion the music drops to half-time and is low-pass filtered ("underwater"), then opens up when time speeds up - the ear hears the time change.
- Effects: blips when captions and labels appear, typing ticks, a low thump on callouts, sweeps on the time changes, a soft tone following the main number, crackle that thickens with activity.
- Target about -13 LUFS with peaks under -1 dBFS.

There is no voice-over by design. If the user wants one, it has to be recorded or generated separately and mixed in.
