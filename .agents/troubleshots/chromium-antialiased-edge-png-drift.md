# A determinism probe fails on an antialiased edge that is painted twice

## Symptom

The seven-mode determinism suite over `chart-probe` fails 4 of 7 modes with tiny byte counts and PNGs
of nearly the same size, while `sequential-then-n` and `repeated` pass:

```text
chart/random: frame 15 PNG bytes differ from the sequential 0..N capture (9778 differing bytes, 10252 vs 10253)
chart/reverse: frame 19 PNG bytes differ from the sequential 0..N capture (9799 differing bytes, 10753 vs 10753)
chart/fresh-renderer: frame 29 PNG bytes differ from the sequential 0..N capture (9699 differing bytes, 10715 vs 10729)
```

Decoding both captures of the focus frame shows the whole PNG differing only because deflate re-encodes
around a payload change: **8 pixels** differ, on the arc of one marker that sits on the y-axis, by at
most 8/255. Deleting the `<circle>` markers makes all seven modes pass; the rest of the scene (text,
rects, `crispEdges` polyline) is byte-stable.

## Workaround

Do not hand a curved or fractional edge to the rasteriser in a frame that must be byte-identical.
`examples/chart` draws with whole-pixel coordinates, whole-pixel font sizes and **axis-aligned
rectangles** — axes, gridlines, ticks and point markers — and sets `shapeRendering="crispEdges"` on
the polyline, so every mark covers whole pixels and nothing is left with a coverage value to
recompute. A stroked `<circle>` marker at a half-pixel radius brings the failure back.

If a look genuinely needs antialiased curves, the only ways past it are to change the capture, not the
scene: force a full repaint before readback, or give the comparison a tolerance
(`CrossEnvironmentTolerance` exists but is gated on `purpose: 'cross-environment'`).

## Why Not Fixed

The drift is inside Chromium/Skia: the coverage it computes for an antialiased edge is not
history-independent — the same geometry painted after a partial invalidation and painted in one fresh
pass disagrees by a unit or two — and a page cannot control which path the compositor takes. Fixing it
properly means a `src/render` change (readback after a forced full paint, or an exact-bytes comparison
that is not destroyed by one 8/255 pixel), and the suite is specified as exact PNG bytes. Same family
as the teaser's `translateY`/`transform` finding in `examples/teaser/README.md`.
