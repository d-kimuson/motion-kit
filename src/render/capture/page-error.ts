import { redactAssetSource } from '../../core/assets/diagnostics.ts';
import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';

/** A cause longer than this is a log, not a cause; the tail is what gets dropped. */
const CAUSE_LIMIT = 500;
/** Error names and codes are identifiers, so anything else is not copied. */
const IDENTIFIER = /^[A-Za-z_$][\w.$-]{0,63}$/u;
/** Engine stack frames: `    at fn (/abs/file.ts:1:2)` and `at async Promise.all (index 0)`. */
const STACK_FRAME = /^\s*at\s/u;
/** URLs first, so a URL's own path is not redacted as an absolute path. */
const URL_OR_PATH =
  /([a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\]]+)|((?:[A-Za-z]:)?(?:[\\/][\w.@+~-]+)+[\\/]?)/giu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const identifier = (value: unknown): string | undefined =>
  typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;

const numericCode = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

/** The directory is machine-specific; the file name is what identifies the failure. */
const pathMarker = (path: string): string => {
  const segments = path.replace(/[\\/]+$/u, '').split(/[\\/]+/u);
  const base = segments.at(-1) ?? '';
  return base === '' ? '[path]' : `[path]/${base}`;
};

/**
 * One line, no stack frames, no URL credentials and no absolute paths, bounded in length.
 * URLs go through the asset-source redactor, which keeps scheme, host, path and a query
 * count marker; `[path]/<basename>` keeps a file identifiable without its directory.
 */
const causeMessage = (value: string): string | undefined => {
  const text = value
    .split(/\r?\n/u)
    .filter((line) => !STACK_FRAME.test(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text === '') return undefined;
  const redacted = text.replace(URL_OR_PATH, (match: string, url?: string) =>
    url === undefined ? pathMarker(match) : redactAssetSource(url),
  );
  return redacted.length <= CAUSE_LIMIT ? redacted : `${redacted.slice(0, CAUSE_LIMIT - 1)}…`;
};

export type PageErrorCause = {
  message: string;
  name?: string;
  code?: string | number;
};

/**
 * The exception's own report, or nothing when it carries none. The stack is never read:
 * a stack frame names a machine-specific file and the contract forbids stack text.
 */
export const pageErrorCause = (error: unknown): PageErrorCause | undefined => {
  if (typeof error === 'string') {
    const message = causeMessage(error);
    return message === undefined ? undefined : { message };
  }
  if (!isRecord(error)) return undefined;
  const name = identifier(error['name']);
  const rawCode = error['code'];
  const code = identifier(rawCode) ?? numericCode(rawCode);
  const message =
    causeMessage(typeof error['message'] === 'string' ? error['message'] : '') ?? name;
  if (message === undefined) return undefined;
  return {
    message,
    ...(name === undefined ? {} : { name }),
    ...(code === undefined ? {} : { code }),
  };
};

/**
 * A frame transport or page exception keeps its deterministic code, message, hint and
 * location, and reports the cause in `details.cause` so a page exception, a transport or
 * CDP failure and a Chromium crash can be told apart (TASK-219).
 */
export const pageErrorDiagnostic = (input: { error: unknown; location: Location }): Diagnostic => {
  const cause = pageErrorCause(input.error);
  return {
    code: 'render.page-error',
    severity: 'error',
    location: input.location,
    message: 'The frame transport or page failed.',
    hint: 'Fix the Composition or browser connection and create a new renderer.',
    ...(cause === undefined ? {} : { details: { cause } }),
  };
};
