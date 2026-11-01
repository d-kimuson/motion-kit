import { MessageSquarePlus, Pause, Play, StepBack, StepForward } from 'lucide-react';
import { type ReactElement } from 'react';

import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type Locale, localeNames, locales } from './locale.ts';
import { useMessages } from './messages.ts';
import { timecode } from './schedule.ts';
import { Button } from './ui/button.tsx';
import { Toggle } from './ui/toggle.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.tsx';

const Hint = ({ label, children }: { label: string; children: ReactElement }) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/** A toggle per language, each named in its own language. */
const LocaleSwitch = ({
  locale,
  onChoose,
}: {
  locale: Locale;
  onChoose: (locale: Locale) => void;
}) => {
  const label = useMessages().page.language;
  return (
    <div role="group" aria-label={label} className="flex items-center">
      {locales.map((item) => (
        <Toggle
          key={item}
          size="sm"
          lang={item}
          aria-label={localeNames[item]}
          title={localeNames[item]}
          pressed={item === locale}
          onPressedChange={() => onChoose(item)}
          className="px-1.5 text-xs uppercase"
        >
          {item}
        </Toggle>
      ))}
    </div>
  );
};

/**
 * The playback controls, the scrubber, comment mode and the page's language, which stay in view
 * above the scrolling timeline.
 */
export const Transport = ({
  state,
  descriptor,
  fps,
  controller,
  picking,
  onTogglePicking,
  locale,
  onChooseLocale,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  controller: PreviewController;
  picking: boolean;
  onTogglePicking: () => void;
  locale: Locale;
  onChooseLocale: (locale: Locale) => void;
}) => {
  const t = useMessages().transport;
  const last = Math.max(descriptor.durationInFrames - 1, 0);
  const shownFrame = state.shown?.status === 'shown' ? state.shown.frame : undefined;
  const digits = String(last).length;
  // Playback is a frame or two behind on every tick; only half a second behind is worth showing.
  const tolerated =
    state.playback.kind === 'playing'
      ? descriptor.fps.numerator / descriptor.fps.denominator / 2
      : 0;
  const lagging = shownFrame !== undefined && Math.abs(state.playhead - shownFrame) > tolerated;
  // A play waiting for its audio already shows pause, so a second press withdraws it.
  const playing = state.playback.kind === 'playing' || state.starting;
  return (
    <div className="flex items-center gap-3 px-3 py-2 tabular-nums">
      <div className="flex items-center gap-1">
        <Hint label={t.previousHint}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.previous}
            onClick={() => controller.step(-1)}
          >
            <StepBack />
          </Button>
        </Hint>
        <Hint label={t.playHint}>
          <Button
            size="icon"
            aria-label={playing ? t.pause : t.play}
            onClick={() => (playing ? controller.pause() : void controller.play())}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
        </Hint>
        <Hint label={t.nextHint}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.next}
            onClick={() => controller.step(1)}
          >
            <StepForward />
          </Button>
        </Hint>
      </div>
      <span className="font-mono text-sm">
        {timecode(state.playhead, fps)}
        <span className="text-muted-foreground">
          {' '}
          / {timecode(descriptor.durationInFrames, fps)}
        </span>
      </span>
      <input
        type="range"
        aria-label={t.playhead}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
        min={0}
        max={last}
        value={state.playhead}
        onChange={(event) => controller.seek(Number(event.currentTarget.value))}
      />
      <span
        className="text-right font-mono text-xs text-muted-foreground"
        style={{ minWidth: `${2 * digits + 9}ch` }}
      >
        {t.frame(state.playhead, last)}
      </span>
      {/* Always laid out, so the scrubber does not resize as the lag comes and goes. */}
      <span
        data-slot="lag"
        className="font-mono text-xs text-warning"
        style={{ minWidth: `${digits + 8}ch`, visibility: lagging ? 'visible' : 'hidden' }}
        title={t.lagging}
      >
        {t.showing(shownFrame ?? state.playhead)}
      </span>
      <Hint label={t.commentHint}>
        <Toggle
          variant="outline"
          size="sm"
          aria-label={t.commentMode}
          pressed={picking}
          onPressedChange={onTogglePicking}
          className="aria-pressed:bg-comment/25 aria-pressed:text-foreground"
        >
          <MessageSquarePlus />
          {t.comment}
        </Toggle>
      </Hint>
      <LocaleSwitch locale={locale} onChoose={onChooseLocale} />
    </div>
  );
};
