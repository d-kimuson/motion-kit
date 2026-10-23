export type { Clock } from './lib/clock.ts';

export {
  createFixedClock,
  currentDate,
  currentTimestamp,
  dateFromIsoString,
  systemClock,
} from './lib/clock.ts';
export { typedIncludes } from './lib/typedIncludes.ts';
export {
  DiagnosticCodeSchema,
  DiagnosticSchema,
  LocationSchema,
  type DiagnosticCode,
  type Diagnostic,
  type Location,
} from './lib/diagnostic.ts';
