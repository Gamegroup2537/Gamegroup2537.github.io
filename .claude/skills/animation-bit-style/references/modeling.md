# Modelling the subject

The subject lives in `src/body.js` as signed-distance fields (SDFs): functions that return the distance from a point to a surface. Shapes are combined with a smooth minimum, which melts them into one continuous surface. That is what gives the style its seamless look, and why the subject is not built from meshes - separate meshes always show where they meet.

## Building blocks (GLSL, already in the file)

| Function | Shape | Use for |
|---|---|---|
| `sdCone(p, A, B)` / `cone(...)` | Rounded cone between two points with a radius at each end | Limbs, bones, pipes, shafts |
| `sdEll(p, radii)` | Ellipsoid | Masses: chest, skull, housings |
| `sdSpindle(p, A, B)` / `spindle(...)` | Thick in the middle, thin at both ends | Muscle bellies, anything that tapers to attachments |
| `plate(p, a, b, c, th)` | Thin rounded triangle | Flat bones, fins, blades |
| `sdBox` | Box | Region tests only |
| `smin(a, b, k)` | Smooth union; `k` is how far the blend reaches | Joining parts into one form |
| `smax(a, b, k)` | Smooth intersection / carve (`smax(d, -other, k)`) | Sockets, grooves, open sides |

Units are metres-ish: the figure is about 1.8 tall. A blend `k` of 0.02-0.04 joins neighbouring parts; 0.06+ merges them into one mass.

## Layers

The template has an outside (skin, clothes) and an inside (bones, muscles, the highlighted muscle). `map()` shows the outside below a horizontal scan plane and the inside above it; animating the plane is the X-ray reveal. A machine would use the same idea: casing outside, mechanism inside.

After the surface is found, the shader asks which part is nearest at that point and picks the material from that - so colour regions can share one continuous surface. The deltoid is the example: one belly, coloured in three sectors by the angle round the arm.

## Moving parts

Anything that moves gets its points computed in JavaScript each frame (`setArm` in the template) and passed in as uniforms. Static parts are written directly in the shader. A muscle that attaches to a moving bone takes its origin from the fixed part and its insertion from the moving part, so it stretches correctly on its own.

## Symmetry and speed

Left and right halves are evaluated once on a mirrored point (`m = vec3(abs(q.x), q.y, q.z)`). Model the +x side only. This halves the cost; keep doing it for anything symmetric.

## Getting it right

Rounds of feedback on the template kept returning to the same points:

1. **Attach parts where they really attach.** Look up origins and insertions (or mounting points) and place them from the real structure. A shape that is merely near the right place gets noticed.
2. **Proportion comes from the outside.** Model the outer surface first, then make everything inside smaller than it. Overlay `xray=0` and `xray=1` stills in several poses; the inside must not poke through or look bigger when the skin comes off.
3. **Check the extreme poses.** Shapes that look right at rest balloon or collapse when a limb is fully raised. Preview the start, the peak and the midpoint of every movement.
4. **One muscle is one shape.** Heads of the same muscle share a surface and differ only in colour. Separate blobs that touch look wrong.
5. **No holes between neighbours.** Where two parts meet on the real thing (trapezius and deltoid at the shoulder), make them overlap slightly.
6. **Simplify openly.** Major surface structures only. Say in the delivery note what was left out.

## Adding a highlighted part

To highlight something other than the deltoid: write its distance function (return which sub-region the point is in), include it in `innerAll()`, give it a material branch in the shading pass that reads `uAct[...]` for brightness, publish a point on it as an anchor for labels, and add its entries to `HEADS` and `activation()` in the timeline.
