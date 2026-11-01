import { type MouseEvent } from 'react';

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
 * Comment mode over the stage. The realm frame takes no pointer input, so this layer, laid over it
 * at the same size and scale, turns the pointer into design pixels: it highlights the element under
 * the pointer and picks it on a click. Outside comment mode it only marks what the draft is about.
 */
export const CommentLayer = ({
  width,
  height,
  scale,
  state,
  controller,
}: {
  width: number;
  height: number;
  scale: number;
  state: ReviewState;
  controller: ReviewController;
}) => {
  const { picking, hovered, draft } = state;
  const box = picking
    ? hovered?.box
    : draft?.place.kind === 'element'
      ? draft.place.element.box
      : undefined;
  const point = !picking && draft?.place.kind === 'point' ? draft.place : undefined;
  // Outlines and labels keep their on-screen size whatever the scale.
  const px = (value: number) => `${value / scale}px`;
  return (
    <div
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
          {picking && hovered !== null ? (
            <span
              className="absolute bottom-full left-0 rounded-sm bg-comment px-1 font-mono whitespace-nowrap text-white"
              style={{ fontSize: px(11), marginBottom: px(2) }}
            >
              {hovered.selector}
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
