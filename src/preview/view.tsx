import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type LayoutStorage, useDefaultLayout } from 'react-resizable-panels';

import { type Diagnostic } from '../lib/diagnostic.ts';
import { CommentLayer } from './comment-layer.tsx';
import { type Review } from './comments-panel.tsx';
import { type PreviewController, type PreviewState } from './controller.ts';
import { type ElementBox } from './elements-panel.tsx';
import { SidePanel } from './side-panel.tsx';
import { previewCss } from './styles.generated.ts';
import { Timeline } from './timeline.tsx';
import { Transport } from './transport.tsx';
import { Button } from './ui/button.tsx';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.tsx';
import { ScrollArea } from './ui/scroll-area.tsx';
import { TooltipProvider } from './ui/tooltip.tsx';

const DiagnosticText = ({ diagnostic }: { diagnostic: Diagnostic }) => (
  <div className="font-mono text-xs whitespace-pre-wrap text-destructive">
    <code className="font-semibold">{diagnostic.code}</code> {diagnostic.message}
    {'\n'}
    <span className="text-muted-foreground">{diagnostic.hint}</span>
  </div>
);

/** Fit the Composition's pixel size into the stage without upscaling. */
const useFit = (width: number, height: number) => {
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const fit = () =>
      setScale(Math.min(element.clientWidth / width, element.clientHeight / height, 1));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  return { stage, scale };
};

const Overlay = ({ state, controller }: { state: PreviewState; controller: PreviewController }) => {
  const { session } = state;
  if (session.kind === 'ready') return undefined;
  return (
    <div className="absolute inset-0 grid place-items-center bg-background p-6">
      <div className="grid w-full max-w-xl gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
        {session.kind === 'connecting' ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : session.kind === 'failed' ? (
          <>
            <h2 className="text-sm font-semibold">The Composition could not be loaded</h2>
            <DiagnosticText diagnostic={session.diagnostic} />
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold">Choose a Composition</h2>
            <div className="grid gap-1.5">
              {session.compositions.map((composition) => (
                <Button
                  key={composition.id}
                  variant="outline"
                  className="justify-between"
                  onClick={() => void controller.choose(composition.id)}
                >
                  <span>{composition.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {composition.width}×{composition.height}, {composition.durationInFrames} frames
                  </span>
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * The keys a focused control acts on itself, which the shortcuts then leave alone: a text field,
 * a tab and the resize handle take every key, and Space activates a button or toggles a checkbox. Focus stays on the scrubber
 * or a checkbox after it is used, so the other keys still reach the shortcuts.
 */
const nativeKeys = (target: EventTarget | null): 'all' | 'space' | 'none' => {
  // A tab moves between its siblings with the arrows and is chosen with Space; the side panel's
  // resize handle moves with the arrows.
  const role = target instanceof Element ? target.getAttribute('role') : null;
  if (role === 'tab' || role === 'separator') return 'all';
  if (target instanceof HTMLTextAreaElement) return 'all';
  if (target instanceof HTMLButtonElement) return 'space';
  if (!(target instanceof HTMLInputElement)) return 'none';
  if (target.type === 'range') return 'none';
  return target.type === 'checkbox' ? 'space' : 'all';
};

/** The preview host page. The realm iframe is the only element React does not own the contents of. */
export const PreviewView = ({
  controller,
  frame,
  review,
  layoutStorage,
}: {
  controller: PreviewController;
  frame: (element: HTMLIFrameElement | null) => void;
  review: Review;
  /** Where the width the side panel was dragged to is kept across reloads. */
  layoutStorage: LayoutStorage;
}) => {
  const state = useSyncExternalStore(controller.subscribe, controller.state);
  const reviewState = useSyncExternalStore(review.controller.subscribe, review.controller.state);
  const allComments = useSyncExternalStore(review.book.subscribe, review.book.comments);
  const ready = state.session.kind === 'ready' ? state.session : undefined;
  const descriptor = ready?.descriptor;
  const comments = allComments.filter((comment) => comment.compositionId === descriptor?.id);
  // The box an element row of the side panel points at.
  const [highlight, setHighlight] = useState<ElementBox>();
  const layout = useDefaultLayout({
    id: 'motion-kit-preview:layout',
    panelIds: ['stage', 'side'],
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });
  const { stage, scale } = useFit(descriptor?.width ?? 1280, descriptor?.height ?? 720);
  useEffect(() => {
    void controller.reload();
    return () => controller.dispose();
  }, [controller]);
  // Shortcuts work wherever focus is on the page; the realm frame takes neither pointer input
  // (pointer-events: none) nor focus (tabIndex), so its keys never go to the realm.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A modified key belongs to the browser: Alt+Arrow navigates history, Ctrl+Space is the IME.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const keys = nativeKeys(event.target);
      if (keys === 'all' || (keys === 'space' && event.key === ' ')) return;
      const delta = event.shiftKey ? 10 : 1;
      if (event.key === ' ') {
        event.preventDefault();
        // A held Space would toggle playback on every repeat.
        if (event.repeat) return;
        const current = controller.state();
        if (current.playback.kind === 'playing' || current.starting) controller.pause();
        else void controller.play();
      } else if (event.key === 'c' || event.key === 'C') {
        if (controller.state().session.kind === 'ready') review.controller.togglePicking();
      } else if (event.key === 'Escape') {
        if (review.controller.state().picking) review.controller.togglePicking();
        else review.controller.cancel();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // A focused scrubber would move by itself as well, and the page would scroll.
        event.preventDefault();
        controller.step(event.key === 'ArrowLeft' ? -delta : delta);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, review]);
  return (
    <TooltipProvider>
      {/* `href` and `precedence` let React hoist the sheet into <head>, out of the accessibility tree. */}
      <style href="motion-kit-preview" precedence="default">
        {previewCss}
      </style>
      {/* The stage and the side panel share the top row, split by a handle that drags the side
          panel wider or narrower; the bottom menu spans the page. */}
      <div className="isolate grid h-screen grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <ResizablePanel id="stage" minSize="25%">
            <div
              className="relative grid h-full place-items-center overflow-hidden bg-black"
              ref={stage}
            >
              <iframe
                ref={frame}
                className="pointer-events-none absolute border-0 bg-black"
                title="Composition"
                tabIndex={-1}
                width={descriptor?.width ?? 1280}
                height={descriptor?.height ?? 720}
                style={{ transform: `scale(${scale})` }}
              />
              {descriptor === undefined ? undefined : (
                <CommentLayer
                  width={descriptor.width}
                  height={descriptor.height}
                  scale={scale}
                  state={reviewState}
                  controller={review.controller}
                  highlight={highlight}
                />
              )}
              {reviewState.picking ? (
                <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-comment px-2 py-1 text-xs text-white shadow">
                  Click an element to comment on it · Esc to stop
                </div>
              ) : undefined}
              <Overlay state={state} controller={controller} />
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="side"
            defaultSize="22rem"
            minSize="16rem"
            maxSize="60%"
            groupResizeBehavior="preserve-pixel-size"
          >
            <aside className="h-full min-h-0 bg-card/40">
              {ready === undefined ? undefined : (
                <SidePanel
                  state={state}
                  descriptor={ready.descriptor}
                  fps={ready.fps}
                  controller={controller}
                  review={review}
                  draft={reviewState.draft}
                  comments={comments}
                  onHighlight={setHighlight}
                />
              )}
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
        <div className="flex max-h-[40vh] min-h-0 flex-col border-t bg-card/40">
          {ready === undefined ? undefined : (
            <>
              <Transport
                state={state}
                descriptor={ready.descriptor}
                fps={ready.fps}
                controller={controller}
                picking={reviewState.picking}
                onTogglePicking={() => review.controller.togglePicking()}
              />
              {state.shown?.status === 'failed' ? (
                <div className="grid max-h-24 shrink-0 gap-1 overflow-y-auto border-t px-3 py-2">
                  {state.shown.diagnostics.map((diagnostic, index) => (
                    <DiagnosticText key={index} diagnostic={diagnostic} />
                  ))}
                </div>
              ) : undefined}
              <ScrollArea className="min-h-0 flex-1 border-t">
                <div className="pt-2">
                  <Timeline
                    state={state}
                    descriptor={ready.descriptor}
                    fps={ready.fps}
                    controller={controller}
                    comments={comments}
                  />
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
