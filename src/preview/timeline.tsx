import { Image, Type } from 'lucide-react';
import { type PointerEvent } from 'react';

import { activeSequences } from '../core/sequence/directory.ts';
import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import { type AssetSpan } from './asset-usage.ts';
import { type ReviewComment } from './comments.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { packLanes, timecode } from './schedule.ts';
import { cn } from './ui/utils.ts';

export const basename = (src: string) => src.slice(src.lastIndexOf('/') + 1);
export const sameSpan = (a: SequenceSpan, b: SequenceSpan) =>
  a.startFrame === b.startFrame &&
  a.endFrame === b.endFrame &&
  a.path.join('\0') === b.path.join('\0');
const percent = (frame: number, duration: number) =>
  `${(Math.min(Math.max(frame, 0), duration) / Math.max(duration, 1)) * 100}%`;
const placed = (start: number, end: number, duration: number) => ({
  left: percent(start, duration),
  right: `calc(100% - ${percent(end, duration)})`,
});

/** Ruler labels a whole number of seconds apart, about eight of them across the Composition. */
const ticks = (descriptor: LoadingDescriptor) => {
  const duration = descriptor.durationInFrames;
  const perSecond = descriptor.fps.numerator / descriptor.fps.denominator;
  const seconds = duration / perSecond;
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => seconds / s <= 8) ?? 1200;
  return Array.from({ length: Math.floor(seconds / step) + 1 }, (_, index) =>
    Math.round(index * step * perSecond),
  ).filter((frame) => frame < duration);
};

const LANE = 'relative h-5';
const BAR =
  'absolute inset-y-0 overflow-hidden rounded-sm px-1.5 text-[11px] leading-5 whitespace-nowrap text-ellipsis';

const AssetIcon = ({ kind }: { kind: string }) =>
  kind === 'font' ? (
    <Type className="mr-1 inline size-3 align-[-2px]" />
  ) : (
    <Image className="mr-1 inline size-3 align-[-2px]" />
  );

/**
 * Every review comment, named Sequence, audio clip and asset group on one time axis, with the playhead. Pressing or dragging
 * anywhere on it seeks; spans that never overlap share a lane, so many of them stay compact.
 */
export const Timeline = ({
  state,
  descriptor,
  fps,
  controller,
  comments,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  controller: PreviewController;
  comments: readonly ReviewComment[];
}) => {
  const duration = descriptor.durationInFrames;
  // A named Sequence is reported while its parent is mounted, so the shown frame picks the active.
  const active =
    state.shown?.status === 'shown'
      ? activeSequences(state.shown.sequences, state.shown.frame)
      : [];
  // A span past the Composition is clipped to it; one that is empty there is not drawn.
  const spanLanes = packLanes(
    state.spans
      .map((span) => ({
        span,
        start: Math.max(span.startFrame, 0),
        end: Math.min(span.endFrame, duration),
      }))
      .filter((item) => item.start < item.end),
  );
  // Audio clips past the Composition are clipped the same way.
  const audioLanes = packLanes(
    (descriptor.audio ?? [])
      .map((track, index) => ({
        track,
        index,
        start: Math.max(track.startInFrames ?? 0, 0),
        end: Math.min(track.endInFrames ?? duration, duration),
      }))
      .filter((clip) => clip.start < clip.end),
  );
  // Asset groups are known only over the frames shown so far, like the named Sequences.
  const assetLanes = packLanes(
    state.assetSpans
      .map((span: AssetSpan) => ({ span, start: span.start, end: Math.min(span.end, duration) }))
      .filter((item) => item.start < item.end),
  );
  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    controller.seek(Math.min(Math.floor(ratio * duration), Math.max(duration - 1, 0)));
  };
  const lanes = [
    ...(comments.length === 0 ? [] : ['Comments']),
    ...spanLanes.map((_, index) => (index === 0 ? 'Sequences' : '')),
    ...audioLanes.map((_, index) => (index === 0 ? 'Audio' : '')),
    ...assetLanes.map((_, index) => (index === 0 ? 'Assets' : '')),
  ];
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 px-3 pb-2 select-none">
      <div className="grid auto-rows-[1.25rem] gap-y-1 pt-6 text-xs text-muted-foreground">
        {lanes.map((label, index) => (
          <div key={index} className="truncate leading-5">
            {label}
          </div>
        ))}
      </div>
      <div
        className="relative cursor-pointer touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          seekTo(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event);
        }}
      >
        <div className="relative h-5 border-b text-[10px] text-muted-foreground tabular-nums">
          {ticks(descriptor).map((frame) => (
            <div
              key={frame}
              className="absolute inset-y-0 border-l border-border pl-1 leading-5"
              style={{ left: percent(frame, duration) }}
            >
              {timecode(frame, fps).replace(/\.\d+$/, '')}
            </div>
          ))}
        </div>
        <div className="mt-1 grid gap-y-1">
          {comments.length === 0 ? undefined : (
            <div className={LANE} data-slot="timeline-lane">
              {comments.map(({ id, time, body }) => {
                // A one-frame comment is a frame wide, so it stays visible on a long Composition.
                const [start, end] =
                  time.kind === 'frame' ? [time.frame, time.frame + 1] : [time.start, time.end + 1];
                return (
                  <div
                    key={id}
                    data-slot="timeline-comment"
                    className="absolute inset-y-1 min-w-1.5 -translate-x-px rounded-sm bg-comment/70"
                    style={placed(start, end, duration)}
                    title={`${timecode(start, fps)} ${body}`}
                  />
                );
              })}
            </div>
          )}
          {spanLanes.map((lane, laneIndex) => (
            <div className={LANE} data-slot="timeline-lane" key={`span:${laneIndex}`}>
              {lane.map(({ span, start, end }) => {
                const on = active.some((item) => sameSpan(item, span));
                return (
                  <div
                    key={`${span.path.join('\0')}:${span.startFrame}:${span.endFrame}`}
                    data-slot="timeline-span"
                    data-active={on ? '' : undefined}
                    className={cn(
                      BAR,
                      on ? 'bg-sequence text-white' : 'bg-sequence/25 text-foreground/80',
                    )}
                    style={placed(start, end, duration)}
                    title={`${span.path.join(' › ')} [${span.startFrame}, ${span.endFrame})`}
                  >
                    {span.path.join(' › ')}
                  </div>
                );
              })}
            </div>
          ))}
          {audioLanes.map((lane, laneIndex) => (
            <div className={LANE} data-slot="timeline-lane" key={`audio:${laneIndex}`}>
              {lane.map(({ track, start, end, index }) => (
                <div
                  key={index}
                  data-slot="timeline-audio"
                  className={cn(
                    BAR,
                    'bg-audio/30 text-foreground/80',
                    state.muted.has(track.src) && 'opacity-40 line-through',
                    state.unplayable.includes(track.src) && 'bg-destructive/40',
                  )}
                  style={placed(start, end, duration)}
                  title={track.src}
                >
                  ♪ {basename(track.src)}
                </div>
              ))}
            </div>
          ))}
          {assetLanes.map((lane, laneIndex) => (
            <div className={LANE} data-slot="timeline-lane" key={`asset:${laneIndex}`}>
              {lane.map(({ span, start, end }) => (
                <div
                  key={`${span.group.kind}:${span.group.key}:${span.start}`}
                  data-slot="timeline-asset"
                  className={cn(
                    BAR,
                    span.failed ? 'bg-destructive/40' : 'bg-asset/30',
                    'text-foreground/80',
                  )}
                  style={placed(start, end, duration)}
                  title={`${span.group.key} [${span.start}, ${span.end})${span.failed ? ', failed to load' : ''}`}
                >
                  <AssetIcon kind={span.group.kind} />
                  {span.group.label}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          className="pointer-events-none absolute -top-px bottom-0 w-px bg-playhead"
          style={{ left: percent(state.playhead, duration) }}
        >
          <div className="absolute -left-1 top-0 size-2 rotate-45 bg-playhead" />
        </div>
      </div>
    </div>
  );
};
