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

The drift is not only history-dependent, it is **platform-dependent**: the same suite passes on macOS
arm64 and fails on the Linux runner, and each attempt to keep one more "flat" construct in
`explainer-probe` was red there again — a rounded, fractionally transparent corner at frame 23 in
`reverse` (ten pixels of the arc, at most 9/255 apart), then the same frame in the next run with a slide
of glyphs and a 96 %-opaque band behind them:

```text
explainer/reverse: frame 23 PNG bytes differ from the sequential 0..N capture (30399 differing bytes, 41452 vs 41448)
```

## Workaround

A frame that must be byte-identical across platforms may draw only **solid, fully opaque,
integer-pixel rectangles with square corners**: no `border-radius`, no `box-shadow`, no gradient, no
`opacity < 1`, no fractional size or position, no text glyph, no `useAsset` media, and no transition
that changes a paint property — a reveal or a crossfade becomes a discrete switch at a frame boundary,
and only whole-pixel positions may animate. `examples/explainer/flat.tsx` is the primitive the probe
draws with; it rounds, so whole pixels are the rule rather than a caller's habit. Antialiased edges are
a coverage mask, a fractional alpha is a blend, and a glyph is the platform's rasteriser, not ours.

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
