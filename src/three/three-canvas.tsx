import { Canvas, type CanvasProps, type RootState } from '@react-three/fiber';
import {
  Suspense,
  useCallback,
  useId,
  useLayoutEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { type WebGLRendererParameters } from 'three';

import { useCompositionFrame, useCompositionRuntime } from '../core/composition/composition.tsx';
import { classifyCanvas } from './seekability.ts';
import { createCanvasSettlement, type CanvasTarget } from './settlement.ts';

export type ThreeCanvasProps = Omit<CanvasProps, 'frameloop' | 'gl' | 'dpr'> & {
  /** WebGLRenderer parameters. `preserveDrawingBuffer` is forced to true: the capture reads
   * the default framebuffer. A renderer factory and a pre-made `context` are not accepted, because
   * both would fix the drawing buffer's attributes (or its canvas) before this component can. */
  gl?: Omit<WebGLRendererParameters, 'preserveDrawingBuffer' | 'canvas' | 'context'>;
  /** Device pixel ratio; defaults to 1 so output does not depend on the host display. */
  dpr?: number;
};

/** Reports the generation of the commit it belongs to. It is the last child of the canvas's
 * own Suspense boundary, so it commits only when every sibling has resolved. */
const GenerationProbe = ({ report }: { readonly report: (generation: number) => void }) => {
  const { generation } = useCompositionFrame();
  useLayoutEffect(() => {
    report(generation);
  }, [generation, report]);
  return null;
};

const adapter = (state: RootState): CanvasTarget => ({
  sized: () => {
    const size = state.get().size;
    return size.width > 0 && size.height > 0;
  },
  // Root-local Manual Advance with runGlobalEffects=false: this canvas progresses, no other
  // canvas and no global effect does.
  advance: (seconds: number) => state.advance(seconds, false),
  context: () => state.gl.getContext(),
  useFrameSubscribers: () => state.get().internal.subscribers.length,
});

/** An R3F canvas whose frames are advanced from motion-kit time, once per settled frame. */
export const ThreeCanvas = ({
  children,
  gl,
  dpr,
  onCreated,
  ...canvasProps
}: ThreeCanvasProps): ReactElement => {
  const runtime = useCompositionRuntime();
  const [settlement] = useState(createCanvasSettlement);
  const integrationId = `three-canvas:${useId()}`;
  const reportGeneration = useCallback(
    (generation: number) => settlement.reportGeneration(generation),
    [settlement],
  );
  const created = useCallback(
    (state: RootState) => {
      // frameloop="never" already stops R3F's loop; stop three's own loop explicitly too.
      state.gl.setAnimationLoop(null);
      settlement.reportTarget(adapter(state));
      onCreated?.(state);
    },
    [onCreated, settlement],
  );
  useLayoutEffect(
    () =>
      runtime.registerIntegration({
        id: integrationId,
        version: '1',
        // Evaluated at warning time: a useFrame subscriber may mount after this effect.
        seekability: () => classifyCanvas(settlement.target()?.useFrameSubscribers() ?? 0),
        settle: settlement.settle,
      }),
    [integrationId, runtime, settlement],
  );
  const content: ReactNode = children;
  return (
    <Canvas
      {...canvasProps}
      frameloop="never"
      dpr={dpr ?? 1}
      gl={{ ...gl, preserveDrawingBuffer: true }}
      onCreated={created}
    >
      <Suspense fallback={null}>
        {content}
        <GenerationProbe report={reportGeneration} />
      </Suspense>
    </Canvas>
  );
};
