import {
  Component,
  createContext,
  Suspense,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
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
    runtime.acknowledgeContent('composition-root', snapshot.generation, '1');
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
  override componentDidCatch() {
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

/** The selected, validated runtime root; never a discovery tree or a Sequence. */
export const Composition = ({
  definition,
  compositionRuntime,
}: {
  definition: PreparedComposition;
  compositionRuntime: CompositionRuntime;
}) => {
  const parent = useContext(RuntimeContext);
  const snapshot = useSyncExternalStore(
    compositionRuntime.subscribe,
    compositionRuntime.getSnapshot,
    compositionRuntime.getSnapshot,
  );
  useLayoutEffect(() => compositionRuntime.attachRoot(), [compositionRuntime]);
  if (parent !== null)
    throw new Error('Nested Composition roots are not supported; use Sequence for scene timing.');
  if (definition !== compositionRuntime.definition)
    throw new Error("Composition definition must be the runtime's validated selection.");
  if (snapshot === null) return null;
  return (
    <RuntimeContext.Provider value={{ runtime: compositionRuntime, snapshot }}>
      <ContentErrorBoundary runtime={compositionRuntime}>
        <Suspense fallback={null}>
          <RootContent runtime={compositionRuntime} definition={definition} snapshot={snapshot} />
        </Suspense>
      </ContentErrorBoundary>
    </RuntimeContext.Provider>
  );
};
