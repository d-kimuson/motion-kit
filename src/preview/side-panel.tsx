import { type ReactNode, useEffect, useState } from 'react';

import { activeSequences } from '../core/sequence/directory.ts';
import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor, type SequenceSpan } from '../lib/loading-protocol.ts';
import { AssetsPanel } from './assets-panel.tsx';
import { CommentsPanel, type Review } from './comments-panel.tsx';
import { type ReviewComment } from './comments.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type ElementBox, ElementsPanel } from './elements-panel.tsx';
import { type CommentDraftState } from './review.ts';
import { timecode } from './schedule.ts';
import { sameSpan } from './timeline.tsx';
import { Badge } from './ui/badge.tsx';
import { ScrollArea } from './ui/scroll-area.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.tsx';
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
  sequences,
  assets,
}: {
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  /** How many the frames shown so far mounted or registered. */
  sequences: number;
  assets: number;
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
    <Fact label="Named Sequences">{sequences}</Fact>
    <Fact label="Audio clips">{(descriptor.audio ?? []).length}</Fact>
    <Fact label="Fonts and images">{assets}</Fact>
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

const Count = ({ value }: { value: number }) =>
  value === 0 ? undefined : (
    <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
      {value > 99 ? '99+' : value}
    </Badge>
  );

/** The side menu next to the stage: a tab per concern, each scrolling on its own. A new or moved draft opens the comments. */
export const SidePanel = ({
  state,
  descriptor,
  fps,
  controller,
  review,
  draft,
  comments,
  onHighlight,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  controller: PreviewController;
  review: Review;
  draft: CommentDraftState | undefined;
  comments: readonly ReviewComment[];
  /** Outline a box of the stage, or none. */
  onHighlight: (box: ElementBox | undefined) => void;
}) => {
  const [tab, setTab] = useState<unknown>('info');
  // A new draft, or a draft moved to another target, opens the comments.
  const target = draft?.place;
  useEffect(() => {
    if (target !== undefined) setTab('comments');
  }, [target]);
  // Five tabs share 22rem, so they take less padding than shadcn's, and a label that still does not
  // fit (a wider system font) is cut rather than pushing the outer tabs out of the list.
  const trigger = 'min-w-0 flex-auto gap-1 px-1 text-xs';
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b p-2">
        <TabsList className="w-full">
          <TabsTrigger value="info" className={trigger}>
            <span className="truncate">Info</span>
          </TabsTrigger>
          <TabsTrigger value="sequences" className={trigger}>
            <span className="truncate">Sequences</span>
          </TabsTrigger>
          <TabsTrigger value="assets" className={trigger}>
            <span className="truncate">Assets</span>
          </TabsTrigger>
          <TabsTrigger value="elements" className={trigger}>
            <span className="truncate">Elements</span>
          </TabsTrigger>
          <TabsTrigger value="comments" className={trigger}>
            <span className="truncate">Comments</span> <Count value={comments.length} />
          </TabsTrigger>
        </TabsList>
      </div>
      {(
        [
          [
            'info',
            <CompositionFacts
              descriptor={descriptor}
              fps={fps}
              sequences={state.spans.length}
              assets={state.assets.length}
            />,
          ],
          ['sequences', <Sequences state={state} fps={fps} controller={controller} />],
          [
            'assets',
            <AssetsPanel state={state} descriptor={descriptor} fps={fps} controller={controller} />,
          ],
          [
            'elements',
            <ElementsPanel
              state={state}
              controller={controller}
              review={review}
              onHighlight={onHighlight}
            />,
          ],
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
