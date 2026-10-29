import { useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { defineComposition, defineCompositions } from '../../../core/composition/registry.ts';
import { useFrame } from '../../../core/timeline/hooks.ts';

const metadata = {
  schema: z.object({}),
  width: 160,
  height: 90,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 12,
};

const STAGE = {
  position: 'relative' as const,
  width: metadata.width,
  height: metadata.height,
  overflow: 'hidden' as const,
  background: '#f4f1e8',
  color: '#1f1d1a',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

// The headline is laid out at this size on the first render and then fitted to the line box.
const BASE_FONT_SIZE = 20;
const MIN_FONT_SIZE = 9;
const LINE_WIDTH = 148;
const LINE_HEIGHT = 32;
const MARKER_WIDTH = 10;
const MARKER_GAP = 6;

const clampFontSize = (size: number): number =>
  Math.min(BASE_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));

const fittedFontSize = (laidOutWidth: number): number =>
  clampFontSize(Math.floor((BASE_FONT_SIZE * LINE_WIDTH) / laidOutWidth));

type FitMode = 'frame-dependent' | 'frame-independent';

/**
 * Fits the headline to its line box the first time the realm lays it out, then keeps that size:
 * the ref guard skips measuring again on later frames.
 *
 * The authoring error in `frame-dependent` is what this measures. The line box contains a small
 * marker whose transform follows the frame, and the fit reads the marker's laid-out right edge.
 * The measured width therefore belongs to whichever frame entered the realm first, and that frame's
 * font size stays for the realm's lifetime. A fresh realm per frame (stills, a cold capture), or a
 * pool that always deals the same frames to the same renderer, shows a plausible result and hides
 * it. Only a capture history that visits a different frame first exposes the stale size.
 *
 * `frame-independent` is the same scene fitted against styles that do not read the frame: the text
 * span's width plus the marker's untransformed footprint. Every realm fits to the same size, so
 * every capture history produces the same pixels.
 */
const FitHeadline = ({ mode }: { mode: FitMode }) => {
  const frame = useFrame();
  const line = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(BASE_FONT_SIZE);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    if (fitted.current || line.current === null) return;
    fitted.current = true;
    const box = line.current.getBoundingClientRect();
    const text = line.current.firstElementChild;
    const marker = line.current.lastElementChild;
    if (text === null || marker === null) return;
    // The frame-dependent fit reads the marker where this frame put it; the frame-independent fit
    // reserves only the marker's own width and gap where it was authored, which the transform
    // cannot move.
    const laidOutWidth =
      mode === 'frame-dependent'
        ? marker.getBoundingClientRect().right - box.left
        : text.getBoundingClientRect().right - box.left + MARKER_GAP + MARKER_WIDTH;
    setFontSize(fittedFontSize(laidOutWidth));
  }, [mode]);

  return (
    <div
      ref={line}
      style={{
        position: 'absolute',
        left: 6,
        top: 24,
        width: LINE_WIDTH,
        height: LINE_HEIGHT,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        lineHeight: `${LINE_HEIGHT}px`,
        fontSize,
        background: '#fffdf7',
      }}
    >
      <span>MOTION KIT</span>
      <span
        style={{
          display: 'inline-block',
          width: MARKER_WIDTH,
          height: MARKER_WIDTH,
          marginLeft: MARKER_GAP,
          background: '#d94f2b',
          transform: `translateX(${frame * 12}px)`,
        }}
      />
    </div>
  );
};

const TraversalScene = ({ mode }: { mode: FitMode }) => {
  const frame = useFrame();
  return (
    <div style={STAGE}>
      <FitHeadline mode={mode} />
      <div
        style={{
          position: 'absolute',
          left: 6,
          bottom: 8,
          width: 12 + frame * 11,
          height: 6,
          background: '#2f6f4f',
        }}
      />
    </div>
  );
};

export const compositions = defineCompositions([
  defineComposition({
    id: 'traversal-dependent',
    component: () => <TraversalScene mode="frame-dependent" />,
    ...metadata,
  }),
  defineComposition({
    id: 'traversal-fixed',
    component: () => <TraversalScene mode="frame-independent" />,
    ...metadata,
  }),
]);
