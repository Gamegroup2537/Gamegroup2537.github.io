# Architecture

## Files

| File | Role | Changes for a new topic |
|---|---|---|
| `src/timeline.js` | Single source of truth: timing, motion, text | Almost everything here |
| `src/body.js` | The 3D subject as signed-distance fields + its shading | Only if the subject changes |
| `src/scene.js` | Stage, camera, sparks, outline pass | Rarely |
| `src/hud.js` | Captions, labels, panels, gauge, effects | Panel wording; new panel types |
| `src/main.js` | Backdrop, layer compositing, URL options | Backdrop colours |
| `tools/render.mjs` | Renders frames through a browser, one at a time | No |
| `tools/audio.mjs` | Synthesizes music and effects from the timeline | Melody / events |
| `tools/build.mjs` | Frames -> audio -> MP4 (`--gpu`, `--hud`) | No |
| `build-clip.bat` | Windows: pull, render on the graphics card, open | No |

Rendering is deterministic: frame N always looks the same, so stills are trustworthy previews of the final clip.

## timeline.js

Times are seconds from 0 to `DURATION` (32). Frame number = seconds x 30.

**Motion channels.** A channel is a function of time returning 0..1, built with `track([[time, value], ...], t)` (eased between keys). The template has one channel per movement (`chLateral`, `chRear`, `chPress`, `chHinge`, `chRack`) plus `chXray`, which drives the scan that swaps outside for inside. `pose(t)` turns channels into joint directions; `activation(t)` turns them into how hard each highlighted part works (0..1). The clip must end in the pose it started in so it loops.

**Camera.** `CAM` is a list of keys `{ t, az, el, d, tx, ty, tz }` - angle round the subject, elevation, distance, look-at point. First and last key must match.

**Text.**
- `CAPTIONS` `{ t0, t1, l1, l2, big? }` - the two-line box at the top; `l2` is the highlighted line
- `LABELS` `{ t0, t1, text, anchor, color, off }` - a tag pinned to a point on the subject; `anchor` names a point published by `scene.js`, `off` is the tag's offset in screen units
- `CALLOUTS` `{ t0, t1, text, anchor, off }` - the big one-word hit
- `CHAPTERS` `{ t0, n, text }` - numbered chip at the start of each section
- `STATUS` - the speed badge (real speed / slowing / slow motion / speeding up)
- `SECTIONS` - title shown in the chart header during each section
- `PANELS` - when the live chart, the summary and the call-to-action panel are on screen
- `HEADS` `{ key, th, color, move }` - the 2-3 compared things: name, accent colour, and the line shown in the summary
- `WATERMARK` - channel name

**Cover.** `COVER` `{ t, split, xray, act, cam, kicker, title, sub, tags, footer }` - the thumbnail. `t` picks the pose, `cam` the view, `split: true` shows the outside on one half of the subject and the inside on the other (keep `cam.az` at 0 so the cut is edge-on), `sub` is three strings whose middle one is highlighted, `tags` get the accent colours of `HEADS` in order.

**Sound.** `EVENTS` lists the moments the soundtrack reacts to; it is derived from the lists above, so sounds follow text automatically.

## Changing things

| Want | Edit |
|---|---|
| Different wording | `CAPTIONS`, `LABELS`, `CALLOUTS`, `CHAPTERS`, panel strings in `hud.js` |
| Different timing of a section | The channel keys, the camera keys and the text times for that section together |
| A new movement | New channel + a branch in `pose()` + weights in `activation()` |
| Different accent colours | `HEADS[i].color` |
| Font / text sharpness / entrance animation | URL options `font=`, `smooth=1`, `motion=0..3` (set via `QUERY`) |
| A label pointing at a new place | Add an anchor in `scene.js` `update()`, then use its name |
| A new chart | Add a `draw...` function in `hud.js`; read values from `activation()` / `pose()` so it stays in sync |

## Render options

- `node tools/render.mjs preview 30 200 366` - stills into `build/preview/`
- `node tools/render.mjs bench 30 366` - milliseconds per frame
- `node tools/render.mjs cover` - the cover image to `out/cover.png`; `QUERY="cam=0,22,4.8,0,1.5,0&ct=11.3"` tries another view or moment
- `QUERY="xray=1"` - pin the inside layer on (0 = outside only), for overlays
- `QUERY="hud=1"` - skip the 3D pass
- `GPU=1` - render through an installed Chrome/Edge with hardware acceleration; `ANGLE=gl|d3d11|vulkan` if the default backend misbehaves

The renderer prints `graphics: ...`. If that line names SwiftShader the render is in software and will be slow.

## Why software rendering is slow, and what does not help

The subject is ray-marched: its shape is computed per pixel. A software rasteriser runs the whole shader for every pixel it draws, including the branches that were skipped, so early exits and bounding tests save nothing there. What does help: evaluating left/right symmetric parts once on a mirrored point, and splitting the work into a march pass and a shading pass that only runs where the march hit (already done in the template). Rendering in parallel processes does not help - the software renderer already uses every core.
