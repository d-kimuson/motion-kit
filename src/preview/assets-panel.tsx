import { Image, TriangleAlert, Type, Volume2, VolumeX } from 'lucide-react';
import { type ReactNode } from 'react';

import { type FrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type RegisteredAsset } from '../lib/preview-protocol.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type Messages, useMessages } from './messages.ts';
import { timecode } from './schedule.ts';
import { basename } from './timeline.tsx';
import { Badge } from './ui/badge.tsx';
import { Toggle } from './ui/toggle.tsx';
import { cn } from './ui/utils.ts';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="grid gap-1">
    <h3 className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {title}
    </h3>
    {children}
  </section>
);

const None = ({ children }: { children: ReactNode }) => (
  <p className="px-1 py-2 text-xs text-muted-foreground">{children}</p>
);

/** A data URL has no file name to show. */
const assetName = (source: string, t: Messages['assets']) =>
  source.startsWith('data:') ? t.dataUrl : basename(source);

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
  const t = useMessages().assets;
  const tracks = descriptor.audio ?? [];
  const sources = [...new Set(tracks.map((track) => track.src))];
  if (sources.length === 0) return <None>{t.noAudio}</None>;
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
              aria-label={muted ? t.unmute(src) : t.mute(src)}
              pressed={!muted}
              onPressedChange={() => controller.toggleMute(src)}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Toggle>
            <div className={cn('min-w-0 flex-1', muted && 'opacity-50')} title={src}>
              <div className="truncate text-xs">{basename(src)}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {src}
                {clips > 1 ? ` · ${t.clips(clips)}` : ''}
              </div>
            </div>
            {unplayable ? (
              <Badge variant="destructive" title={t.unplayableHint}>
                <TriangleAlert />
                {t.unplayable}
              </Badge>
            ) : undefined}
          </li>
        );
      })}
    </ul>
  );
};

const sameAsset = (a: RegisteredAsset, b: RegisteredAsset) =>
  a.kind === b.kind && a.source === b.source;

/**
 * The fonts and images the frames shown since the reload registered, with their latest status;
 * those of the shown frame are marked, and choosing one seeks to where it was first seen.
 */
const RegisteredAssets = ({
  state,
  fps,
  controller,
}: {
  state: PreviewState;
  fps: FrameRate;
  controller: PreviewController;
}) => {
  const t = useMessages().assets;
  const { shown } = state;
  const current = shown?.status === 'shown' || shown?.status === 'failed' ? shown.assets : [];
  if (state.assets.length === 0) return <None>{t.none}</None>;
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {state.assets.map((asset) => {
        const here = current.some((item) => sameAsset(item, asset));
        const Icon = asset.kind === 'font' ? Type : Image;
        return (
          <li
            key={`${asset.kind}:${asset.source}`}
            data-slot="asset"
            data-current={here ? '' : undefined}
            className={cn('flex items-center gap-2 rounded-md px-1 py-1', here && 'bg-muted')}
          >
            <Icon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label={t.kind(asset.kind)}
            />
            <div className="min-w-0 flex-1" title={asset.source}>
              <div className="truncate text-xs">{assetName(asset.source, t)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{asset.source}</div>
            </div>
            {asset.status === 'failed' ? (
              <Badge variant="destructive">
                <TriangleAlert />
                {t.failed}
              </Badge>
            ) : asset.status === 'pending' ? (
              <Badge variant="secondary">{t.pending}</Badge>
            ) : undefined}
            <button
              type="button"
              className="rounded-sm px-1 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t.seek}
              onClick={() => controller.seek(asset.frame)}
            >
              {timecode(asset.frame, fps).replace(/\.\d+$/, '')}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** What the Composition uses: its declared audio and the fonts and images it registered. */
export const AssetsPanel = ({
  state,
  descriptor,
  fps,
  controller,
}: {
  state: PreviewState;
  descriptor: LoadingDescriptor;
  fps: FrameRate;
  controller: PreviewController;
}) => {
  const t = useMessages().assets;
  return (
    <div className="grid gap-4">
      {/* The fonts and images come first: a narrated Composition declares dozens of clips. */}
      <Section title={t.registered}>
        <RegisteredAssets state={state} fps={fps} controller={controller} />
      </Section>
      <Section title={t.audio}>
        <AudioSources state={state} descriptor={descriptor} controller={controller} />
      </Section>
    </div>
  );
};
