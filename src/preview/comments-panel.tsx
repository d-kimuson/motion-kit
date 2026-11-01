import { Check, Copy, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type CommentBook } from './comment-book.ts';
import {
  commentTime,
  firstFrame,
  relativeSource,
  reviewMarkdown,
  type CommentPlace,
  type CommentTime,
  type ReviewComment,
  type ReviewSite,
} from './comments.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type Messages, useMessages } from './messages.ts';
import { type CommentDraftState, type ReviewController } from './review.ts';
import { timecode } from './schedule.ts';
import { Button } from './ui/button.tsx';
import { Textarea } from './ui/textarea.tsx';

/** What the page needs to take review comments: comment mode, where they are kept, the project. */
export type Review = Readonly<{
  controller: ReviewController;
  book: CommentBook;
  site: ReviewSite;
}>;

export const timeLabel = (time: CommentTime, fps: FrameRate) =>
  time.kind === 'frame'
    ? timecode(time.frame, fps)
    : `${timecode(time.start, fps)} – ${timecode(time.end, fps)}`;

const placeLabel = (place: CommentPlace, site: ReviewSite, t: Messages['comments']) => {
  if (place.kind === 'frame') return t.wholeFrame;
  if (place.kind === 'point') return t.point(Math.round(place.x), Math.round(place.y));
  const { selector, source } = place.element;
  return source === null ? selector : `${selector} · ${relativeSource(source, site)}`;
};

/**
 * The comment being written; Ctrl/⌘+Enter saves it and Escape drops it. Picking another target
 * moves the draft and keeps its text, and the field takes the focus again.
 */
const Composer = ({
  draft,
  playhead,
  fps,
  review,
}: {
  draft: CommentDraftState;
  playhead: number;
  fps: FrameRate;
  review: Review;
}) => {
  const t = useMessages().comments;
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), [draft.anchor, draft.place]);
  const save = () => review.controller.save();
  return (
    <div data-slot="comment-draft" className="grid grid-cols-1 gap-2 rounded-lg border bg-card p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono">{timeLabel(commentTime(draft.anchor, draft.end), fps)}</span>
        <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
          {placeLabel(draft.place, review.site, t)}
        </span>
      </div>
      <Textarea
        ref={field}
        aria-label={t.field}
        placeholder={t.placeholder}
        value={draft.body}
        onChange={(event) => review.controller.write(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            review.controller.cancel();
          }
        }}
      />
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          disabled={playhead === draft.end}
          title={t.rangeHint}
          onClick={() => review.controller.endAtPlayhead()}
        >
          {playhead === draft.anchor ? t.oneFrame : t.rangeTo(timecode(playhead, fps))}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => review.controller.cancel()}>
          {t.cancel}
        </Button>
        <Button size="xs" onClick={save}>
          {t.save}
        </Button>
      </div>
    </div>
  );
};

/** Copies the Markdown; where the clipboard is refused, shows it to copy by hand. */
const CopyMarkdown = ({ markdown, disabled }: { markdown: string; disabled: boolean }) => {
  const t = useMessages().comments;
  const [copied, setCopied] = useState<'copied' | 'refused' | undefined>();
  useEffect(() => {
    if (copied !== 'copied') return;
    const handle = setTimeout(() => setCopied(undefined), 2000);
    return () => clearTimeout(handle);
  }, [copied]);
  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        onClick={() =>
          void navigator.clipboard.writeText(markdown).then(
            () => setCopied('copied'),
            () => setCopied('refused'),
          )
        }
      >
        {copied === 'copied' ? <Check /> : <Copy />}
        {copied === 'copied' ? t.copied : t.copy}
      </Button>
      {copied === 'refused' ? (
        <Textarea
          readOnly
          aria-label={t.markdown}
          className="order-last col-span-full max-h-40 font-mono text-[11px] md:text-[11px]"
          value={markdown}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : undefined}
    </>
  );
};

/** Removing every comment takes a second press, since nothing brings them back. */
const ClearComments = ({ onClear, disabled }: { onClear: () => void; disabled: boolean }) => {
  const t = useMessages().comments;
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? 'destructive' : 'ghost'}
      size="sm"
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) onClear();
        setArmed(!armed);
      }}
    >
      {armed ? t.confirmClear : t.clear}
    </Button>
  );
};

/**
 * Review comments on the mounted Composition: the draft being written, the comments so far
 * (earliest first; the time seeks to it), and the Markdown to paste to a coding agent.
 */
export const CommentsPanel = ({
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
  const t = useMessages().comments;
  const sorted = comments.toSorted(
    (a, b) => firstFrame(a.time) - firstFrame(b.time) || a.id - b.id,
  );
  const markdown = reviewMarkdown(
    {
      ...review.site,
      compositionId: descriptor.id,
      fps,
      width: descriptor.width,
      height: descriptor.height,
    },
    sorted,
  );
  return (
    <div className="grid grid-cols-1 gap-3">
      {draft === undefined ? (
        <div className="grid grid-cols-1 gap-2">
          <p className="px-1 text-xs text-muted-foreground">{t.guide}</p>
          <Button variant="outline" size="sm" onClick={() => review.controller.commentFrame()}>
            <MessageSquarePlus />
            {t.commentFrame}
          </Button>
        </div>
      ) : (
        <Composer draft={draft} playhead={state.playhead} fps={fps} review={review} />
      )}
      {sorted.length === 0 ? undefined : (
        <ol className="grid grid-cols-1 gap-1">
          {sorted.map((comment, index) => (
            <li
              key={comment.id}
              data-slot="comment"
              className="grid grid-cols-1 gap-0.5 rounded-md px-1.5 py-1 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{index + 1}.</span>
                <button
                  type="button"
                  className="font-mono text-comment hover:underline"
                  onClick={() => controller.seek(firstFrame(comment.time))}
                >
                  {timeLabel(comment.time, fps)}
                </button>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {placeLabel(comment.place, review.site, t)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.remove(index + 1)}
                  onClick={() => review.book.remove(comment.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <p className="pl-4 text-xs whitespace-pre-wrap">
                {comment.body === '' ? (
                  <span className="text-muted-foreground">{t.empty}</span>
                ) : (
                  comment.body
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-1.5 border-t pt-2">
        <CopyMarkdown markdown={markdown} disabled={sorted.length === 0} />
        <ClearComments
          disabled={sorted.length === 0}
          onClear={() => review.book.clear(descriptor.id)}
        />
      </div>
    </div>
  );
};
