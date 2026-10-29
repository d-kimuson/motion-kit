export {
  createRenderer,
  type Renderer,
  type RendererOptions,
  type RenderFrameOptions,
  type RenderFramesOptions,
  type RenderOutcome,
  type RenderedFrame,
} from './renderer.ts';
export {
  createRendererPool,
  defaultConcurrency,
  type RendererPool,
  type RendererPoolOptions,
  type RenderFrameListOptions,
} from './pool.ts';
export { pngCapture, type CaptureFormat, type FrameCaptureResult } from './capture/frame.ts';
export {
  defaultCheckComparison,
  type CheckComparison,
  type CheckDifference,
} from './check/compare.ts';
export { type CheckHistory } from './check/history.ts';
export {
  checkComposition,
  checkReportPassed,
  type CheckCompositionOptions,
  type CheckReport,
  type CheckSampleResult,
  type CheckHistoryResult,
} from './check/check.ts';
