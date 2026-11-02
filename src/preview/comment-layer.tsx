import { useEffect, useRef, type MouseEvent } from 'react';

import { type ElementBox } from './elements-panel.tsx';
import { type ReviewController, type ReviewState } from './review.ts';
import { cn } from './ui/utils.ts';

/** A pointer position on the layer in design pixels; the layer is the Composition's size, scaled. */
const designPoint = (event: MouseEvent<HTMLDivElement>, width: number, height: number) => {
  const box = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) * width) / box.width,
    y: ((event.clientY - box.top) * height) / box.height,
  };
};

/**
 * How far a wheel scrolls, in pixels, to move the highlight by one element: a mouse notch scrolls
 * about 100, a trackpad a few pixels an event.
 */
const wheelStep = 40;
/** A wheel's scroll in pixels, whether it counts in pixels, lines (Firefox) or pages. */
const wheelPixels = (event: WheelEvent) =>
  event.deltaY *
  (event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? wheelStep
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? 10 * wheelStep
      : 1);
/** A pause after which a wheel starts a new turn, forgetting what the last one scrolled. */
const wheelPauseMs = 200;

/**
 * Comment mode over the stage. The realm frame takes no pointer input, so this layer, laid over it
 * at the same size and scale, turns the pointer into design pixels: it highlights the element under
 * the pointer and picks it on a click. The wheel moves the highlight through the other elements
 * under the pointer, from the likeliest meant down to the layout boxes. Outside comment mode it only
 * marks the highlighted box, or what the draft is about.
 */
export const CommentLayer = ({
  width,
  height,
  scale,
  state,
  controller,
  highlight,
}: {
  width: number;
  height: number;
  scale: number;
  /** A box to outline outside comment mode, before the draft's element. */
  highlight: ElementBox | undefined;
  state: ReviewState;
  controller: ReviewController;
}) => {
  const { picking, hovered, draft } = state;
  const target = hovered === null ? undefined : hovered.elements[hovered.index];
  const box = picking
    ? target?.box
    : (highlight ?? (draft?.place.kind === 'element' ? draft.place.element.box : undefined));
  const point =
    !picking && highlight === undefined && draft?.place.kind === 'point' ? draft.place : undefined;
  // Outlines and labels keep their on-screen size whatever the scale.
  const px = (value: number) => `${value / scale}px`;
  const layer = useRef<HTMLDivElement>(null);
  // React listens to the wheel passively, and the wheel must not scroll the page while it picks.
  useEffect(() => {
    const element = layer.current;
    if (element === null || !picking) return;
    let scrolled = 0;
    let last = -Infinity;
    const turn = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = wheelPixels(event);
      // A new turn, or one the other way, starts from nothing.
      if (event.timeStamp - last > wheelPauseMs || Math.sign(pixels) !== Math.sign(scrolled))
        scrolled = 0;
      last = event.timeStamp;
      scrolled += pixels;
      // One step at most per event, so a mouse notch moves by one element.
      if (Math.abs(scrolled) < wheelStep) return;
      controller.cycle(scrolled > 0 ? 1 : -1);
      scrolled = 0;
    };
    element.addEventListener('wheel', turn, { passive: false });
    return () => element.removeEventListener('wheel', turn);
  }, [picking, controller]);
  return (
    <div
      ref={layer}
      data-slot="comment-layer"
      className={cn('absolute', picking ? 'cursor-crosshair' : 'pointer-events-none')}
      style={{ width, height, transform: `scale(${scale})` }}
      onPointerMove={(event) => {
        const { x, y } = designPoint(event, width, height);
        controller.hover(x, y);
      }}
      onPointerLeave={() => controller.leave()}
      onClick={(event) => {
        const { x, y } = designPoint(event, width, height);
        void controller.pick(x, y);
      }}
    >
      {box === undefined ? undefined : (
        <div
          data-slot="comment-target"
          className="pointer-events-none absolute bg-comment/15 outline-comment"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            outlineStyle: 'solid',
            outlineWidth: px(2),
          }}
        >
          {picking && hovered !== null && target !== undefined ? (
            <span
              className="absolute bottom-full left-0 rounded-sm bg-comment px-1 font-mono whitespace-nowrap text-white"
              style={{ fontSize: px(11), marginBottom: px(2) }}
            >
              {target.selector}
              {hovered.elements.length > 1 ? (
                <span className="ml-1 opacity-75">
                  {hovered.index + 1}/{hovered.elements.length}
                </span>
              ) : undefined}
            </span>
          ) : undefined}
        </div>
      )}
      {point === undefined ? undefined : (
        <div
          data-slot="comment-target"
          className="pointer-events-none absolute -translate-1/2 rounded-full bg-comment"
          style={{
            left: point.x,
            top: point.y,
            width: px(10),
            height: px(10),
            boxShadow: `0 0 0 ${px(2)} white`,
          }}
        />
      )}
    </div>
  );
};
