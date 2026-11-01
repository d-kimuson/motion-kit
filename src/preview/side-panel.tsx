import { TriangleAlert, Volume2, VolumeX } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { activeSequences } from '../core/sequence/directory.ts';
import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import { CommentsPanel, type Review } from './comments-panel.tsx';
import { type ReviewComment } from './comments.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type CommentDraftState } from './review.ts';
import { timecode } from './schedule.ts';
import { basename, sameSpan } from './timeline.tsx';
import { Badge } from './ui/badge.tsx';
import { ScrollArea } from './ui/scroll-area.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.tsx';
import { Toggle } from './ui/toggle.tsx';
import { cn } from './ui/utils.ts';

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-1 py-6 text-center text-xs text-muted-foreground">{children}</p>
);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 truncate font-mono">{children}</dd>
  </>
);

const rate = ({ numerator, denominator }: LoadingDescriptor['fps']) =>
  denominator === 1
    ? `${numerator} fps`
    : `${(numerator / denominator).toFixed(3)} fps (${numerator}/${denominator})`;

const CompositionFacts = ({
  descriptor,
  fps,
}: {
  descriptor: LoadingDescriptor;
  fps: FrameRate;
}) => (
  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-1 text-xs">
    <Fact label="Composition">{descriptor.id}</Fact>
    <Fact label="Size">
      {descriptor.width}×{descriptor.height}
    </Fact>
    <Fact label="Frame rate">{rate(descriptor.fps)}</Fact>
    <Fact label="Duration">
      {timecode(descriptor.durationInFrames, fps)} ({descriptor.durationInFrames} frames)
    </Fact>
    <Fact label="Audio clips">{(descriptor.audio ?? []).length}</Fact>
  </dl>
);

/** The named Sequences seen so far, in first-seen order; choosing one seeks to its start. */
const Sequences = ({
  state,
  fps,
  controller,
}: {
  state: PreviewState;
  fps: FrameRate;
  controller: PreviewController;
}) => {
  const active: readonly SequenceSpan[] =
    state.shown?.status === 'shown'
      ? activeSequences(state.shown.sequences, state.shown.frame)
      : [];
  if (state.spans.length === 0)
    return <Empty>No named Sequence has been mounted yet. Name one with `name`.</Empty>;
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {state.spans.map((span) => {
        const on = active.some((item) => sameSpan(item, span));
        return (
          <li key={`${span.path.join('\0')}:${span.startFrame}:${span.endFrame}`}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted',
                on && 'bg-sequence/20',
              )}
              style={{ paddingLeft: `${0.5 + (span.path.length - 1) * 0.75}rem` }}
              onClick={() => controller.seek(Math.max(span.startFrame, 0))}
            >
              <span className="min-w-0 flex-1 truncate">{span.path.at(-1)}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {timecode(Math.max(span.startFrame, 0), fps).replace(/\.\d+$/, '')}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** One row per declared audio source; the toggle mutes every clip of that source. */
const AudioSources = ({
  state,
  descriptor,
  controller,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  controller: PreviewController;
}) => {
  const tracks = descriptor.audio ?? [];
  const sources = [...new Set(tracks.map((track) => track.src))];
  if (sources.length === 0) return <Empty>This Composition declares no audio.</Empty>;
  return (
    <ul className="grid grid-cols-1 gap-1">
      {sources.map((src) => {
        const muted = state.muted.has(src);
        const unplayable = state.unplayable.includes(src);
        const clips = tracks.filter((track) => track.src === src).length;
        return (
          <li key={src} className="flex items-center gap-2 rounded-md px-1 py-0.5">
            <Toggle
              size="sm"
              variant="outline"
              aria-label={muted ? `Unmute ${src}` : `Mute ${src}`}
              pressed={!muted}
              onPressedChange={() => controller.toggleMute(src)}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Toggle>
            <div className={cn('min-w-0 flex-1', muted && 'opacity-50')} title={src}>
              <div className="truncate text-xs">{basename(src)}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {src}
                {clips > 1 ? ` · ${clips} clips` : ''}
              </div>
            </div>
            {unplayable ? (
              <Badge variant="destructive" title="Could not be fetched or decoded">
                <TriangleAlert />
                unplayable
              </Badge>
            ) : undefined}
          </li>
        );
      })}
    </ul>
  );
};

const Count = ({ value }: { value: number }) =>
  value === 0 ? undefined : (
    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
      {value}
    </Badge>
  );

/** The side menu next to the stage: a tab per concern, each scrolling on its own. A new draft opens the comments. */
export const SidePanel = ({
  state,
  descriptor,
  fps,
  controller,
  review,
  draft,
  comments,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  controller: PreviewController;
  review: Review;
  draft: CommentDraftState | undefined;
  comments: readonly ReviewComment[];
}) => {
  const [tab, setTab] = useState<unknown>('composition');
  const drafting = draft !== undefined;
  useEffect(() => {
    if (drafting) setTab('comments');
  }, [drafting]);
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b p-2">
        <TabsList className="w-full">
          <TabsTrigger value="composition">Composition</TabsTrigger>
          <TabsTrigger value="sequences">
            Sequences <Count value={state.spans.length} />
          </TabsTrigger>
          <TabsTrigger value="audio">
            Audio <Count value={new Set((descriptor.audio ?? []).map((track) => track.src)).size} />
          </TabsTrigger>
          <TabsTrigger value="comments">
            Comments <Count value={comments.length} />
          </TabsTrigger>
        </TabsList>
      </div>
      {(
        [
          ['composition', <CompositionFacts descriptor={descriptor} fps={fps} />],
          ['sequences', <Sequences state={state} fps={fps} controller={controller} />],
          ['audio', <AudioSources state={state} descriptor={descriptor} controller={controller} />],
          [
            'comments',
            <CommentsPanel
              state={state}
              descriptor={descriptor}
              fps={fps}
              controller={controller}
              review={review}
              draft={draft}
              comments={comments}
            />,
          ],
        ] as const
      ).map(([value, content]) => (
        <TabsContent key={value} value={value} className="min-h-0">
          <ScrollArea className="h-full">
            <div className="p-2">{content}</div>
          </ScrollArea>
        </TabsContent>
      ))}
    </Tabs>
  );
};
