import { MessageSquarePlus, Pause, Play, Settings, StepBack, StepForward } from 'lucide-react';
import { type ReactElement, useId } from 'react';

import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type Locale, localeNames, localeSchema, locales } from './locale.ts';
import { useMessages } from './messages.ts';
import { timecode } from './schedule.ts';
import { Button } from './ui/button.tsx';
import { NativeSelect, NativeSelectOption } from './ui/native-select.tsx';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.tsx';
import { Toggle } from './ui/toggle.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.tsx';

const Hint = ({ label, children }: { label: string; children: ReactElement }) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/**
 * `text` laid out as wide as `widest`, so the row keeps its width as the text changes in any
 * language: a count of characters would not, since a Japanese character is two columns wide.
 */
const Fixed = ({ text, widest }: { text: string; widest: string }) => (
  <span className="inline-grid justify-items-end">
    <span aria-hidden className="invisible col-start-1 row-start-1">
      {widest}
    </span>
    <span className="col-start-1 row-start-1">{text}</span>
  </span>
);

/** The page's settings, behind an icon: for now only its language, each named in its own language. */
const SettingsMenu = ({
  locale,
  onChooseLocale,
}: {
  locale: Locale;
  onChooseLocale: (locale: Locale) => void;
}) => {
  const t = useMessages();
  const languageId = useId();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t.transport.settings}>
            <Settings />
          </Button>
        }
      />
      <PopoverContent side="top" align="end" className="w-56">
        <PopoverTitle className="text-sm">{t.transport.settings}</PopoverTitle>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <label htmlFor={languageId} className="text-xs text-muted-foreground">
            {t.page.language}
          </label>
          <NativeSelect
            id={languageId}
            size="sm"
            className="w-full"
            value={locale}
            onChange={(event) => {
              const chosen = localeSchema.safeParse(event.currentTarget.value);
              if (chosen.success) onChooseLocale(chosen.data);
            }}
          >
            {locales.map((item) => (
              <NativeSelectOption key={item} value={item} lang={item}>
                {localeNames[item]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * The playback controls, the scrubber, comment mode and the page's settings, which stay in view
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
      <span className="font-mono text-xs text-muted-foreground">
        <Fixed text={t.frame(state.playhead, last)} widest={t.frame(last, last)} />
      </span>
      {/* Always laid out, so the scrubber does not resize as the lag comes and goes. */}
      <span
        data-slot="lag"
        className="font-mono text-xs text-warning"
        style={{ visibility: lagging ? 'visible' : 'hidden' }}
        title={t.lagging}
      >
        <Fixed text={t.showing(shownFrame ?? state.playhead)} widest={t.showing(last)} />
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
      <SettingsMenu locale={locale} onChooseLocale={onChooseLocale} />
    </div>
  );
};
