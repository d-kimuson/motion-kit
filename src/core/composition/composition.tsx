import {
  Component,
  createContext,
  startTransition,
  Suspense,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { isAssetLoadError } from '../assets/diagnostics.ts';
import {
  assetsOf,
  type CompositionRuntime,
  type ContentRegistration,
  type FrameSnapshot,
} from '../runtime/composition-runtime.ts';
import { type PreparedComposition } from './registry.ts';

const RuntimeContext = createContext<{
  runtime: CompositionRuntime;
  snapshot: FrameSnapshot;
} | null>(null);

/** Read explicit owned time; this never reads an ambient clock. */
export const useCompositionFrame = (): FrameSnapshot => {
  const context = useContext(RuntimeContext);
  if (context === null) throw new Error('useCompositionFrame requires a Composition provider.');
  return context.snapshot;
};

const requireRuntime = (hook: string): CompositionRuntime => {
  const context = useContext(RuntimeContext);
  if (context === null) throw new Error(`${hook} requires a Composition provider.`);
  return context.runtime;
};

/** Internal adapter access; registrations belong to this mounted Composition. */
export const useCompositionRuntime = (): CompositionRuntime => requireRuntime('Integration');

/** Internal asset-hook access. Not a package-root export. */
export const useAssetRuntime = (): CompositionRuntime => requireRuntime('useAsset');

/** Internal metadata access for the public timeline hooks and Sequence boundary. */
export const useCompositionDefinition = (): PreparedComposition => {
  const context = useContext(RuntimeContext);
  if (context === null) throw new Error('Timeline hooks require a Composition provider.');
  return context.runtime.definition;
};

/** Register required content outside the subtree that may suspend, then put this
 * acknowledgement inside that subtree. A fallback must never include it.
 */
export const CompositionContent = ({
  registration,
  children,
}: {
  registration: ContentRegistration;
  children: ReactNode;
}) => {
  const snapshot = useCompositionFrame();
  const version = registration.getVersion();
  useLayoutEffect(() => {
    registration.acknowledge(snapshot.generation, version);
  }, [registration, snapshot, version]);
  return children;
};

const RootContent = ({
  runtime,
  definition,
  snapshot,
}: {
  runtime: CompositionRuntime;
  definition: PreparedComposition;
  snapshot: FrameSnapshot;
}) => {
  useLayoutEffect(() => {
    assetsOf(runtime).endPass();
    runtime.acknowledgeContent(
      'composition-root',
      snapshot.generation,
      '1',
      snapshot.resourceRevision,
    );
  }, [runtime, snapshot]);
  return definition.render();
};

class ContentErrorBoundary extends Component<
  { runtime: CompositionRuntime; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    if (isAssetLoadError(error)) {
      this.props.runtime.fail(error.diagnostic);
      return;
    }
    this.props.runtime.fail({
      code: 'render.page-error',
      severity: 'error',
      message: 'The selected Composition failed while rendering.',
      hint: 'Fix the selected component before requesting another frame.',
    });
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * How frame changes reach the screen. `live` commits each frame as soon as the runtime publishes
 * it, so a suspending asset shows its fallback until it loads; the renderer captures only settled
 * frames and never sees that. `held` keeps the committed frame on screen until the next one can
 * commit, for a host that shows the live page (the preview).
 */
export type FramePresentation = 'live' | 'held';

const useLiveSnapshot = (runtime: CompositionRuntime): FrameSnapshot | null =>
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);

// A frame change renders as a transition, so React keeps the committed frame while the next one
// suspends instead of revealing a fallback; a frame cut off before it committed clears the
// runtime's snapshot, which leaves the committed frame in place too.
const useHeldSnapshot = (runtime: CompositionRuntime): FrameSnapshot | null => {
  const [snapshot, setSnapshot] = useState(runtime.getSnapshot);
  useLayoutEffect(() => {
    const follow = () => {
      const next = runtime.getSnapshot();
      if (next !== null) startTransition(() => setSnapshot(next));
    };
    follow();
    return runtime.subscribe(follow);
  }, [runtime]);
  return snapshot;
};

type FramesProps = { definition: PreparedComposition; runtime: CompositionRuntime };

const Frame = ({
  definition,
  runtime,
  snapshot,
}: FramesProps & { snapshot: FrameSnapshot | null }) => {
  if (snapshot === null) return null;
  assetsOf(runtime).beginPass();
  return (
    <RuntimeContext.Provider value={{ runtime, snapshot }}>
      <ContentErrorBoundary runtime={runtime}>
        <Suspense fallback={null}>
          <RootContent runtime={runtime} definition={definition} snapshot={snapshot} />
        </Suspense>
      </ContentErrorBoundary>
    </RuntimeContext.Provider>
  );
};
const LiveFrames = (props: FramesProps) => (
  <Frame {...props} snapshot={useLiveSnapshot(props.runtime)} />
);
const HeldFrames = (props: FramesProps) => (
  <Frame {...props} snapshot={useHeldSnapshot(props.runtime)} />
);

/** The selected, validated runtime root; never a discovery tree or a Sequence. */
export const Composition = ({
  definition,
  compositionRuntime,
  presentation = 'live',
}: {
  definition: PreparedComposition;
  compositionRuntime: CompositionRuntime;
  presentation?: FramePresentation;
}) => {
  const parent = useContext(RuntimeContext);
  useLayoutEffect(() => compositionRuntime.attachRoot(), [compositionRuntime]);
  if (parent !== null)
    throw new Error('Nested Composition roots are not supported; use Sequence for scene timing.');
  if (definition !== compositionRuntime.definition)
    throw new Error("Composition definition must be the runtime's validated selection.");
  return presentation === 'held' ? (
    <HeldFrames definition={definition} runtime={compositionRuntime} />
  ) : (
    <LiveFrames definition={definition} runtime={compositionRuntime} />
  );
};
