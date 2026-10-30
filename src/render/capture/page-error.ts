import { redactAssetSource } from '../../core/assets/diagnostics.ts';
import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';

/** A cause longer than this is a log, not a cause; the tail is what gets dropped. */
const CAUSE_LIMIT = 500;
/** Error names and codes are identifiers, so anything else is not copied. */
const IDENTIFIER = /^[A-Za-z_$][\w.$-]{0,63}$/u;
/** Engine stack frames: `    at fn (/abs/file.ts:1:2)` and `at async Promise.all (index 0)`. */
const STACK_FRAME = /^\s*at\s/u;
/** One segment of a URL or a path: a separator, a quote or prose punctuation ends it. */
const SEGMENT = '[^\\s/\\\\"\'`<>|,;]+';
/**
 * A segment holding spaces is a directory name only when a separator follows it, so a
 * path never swallows the sentence after it and its basename stays space-free.
 */
const NAMED = `(?:${SEGMENT}(?: ${SEGMENT})+(?=[/\\\\])|${SEGMENT})`;
/** A path root only a real filesystem path has: a known root, or a Windows drive. */
const ROOT = '(?:\\/(?:Users|home|tmp|private|var|opt|Volumes)[/\\\\]|[A-Za-z]:[/\\\\])';
/** Absolute or protocol-relative URL: both carry a scheme-then-authority or `//`. */
const URL = '(?:[A-Za-z][A-Za-z0-9+.-]*:)?//[^\\s"\'`<>]+';
/** A relative source is a URL only when it carries a query; a bare path is not one. */
const RELATIVE_URL = '(?:\\.{1,2})?/[^\\s"\'`<>?]*\\?[^\\s"\'`<>]*';
/** A path is matched only as a whole token, never as the tail of another token. */
const TOKEN_START = '(?<![A-Za-z0-9_.~+@/\\\\-])';
/**
 * URLs first, so a URL's own path is not read as an absolute path, then the path
 * alternative restricted to real filesystem paths so fractions and ratios survive.
 */
const SOURCE = new RegExp(
  `(${URL})|(${RELATIVE_URL})|(${TOKEN_START}${ROOT}${NAMED}(?:[/\\\\]${NAMED})*)`,
  'giu',
);
/** Punctuation a sentence leaves against a source: `see https://host/x.js).` */
const TRAILING = new Set(['.', ',', ';', ':', "'", '"', '`', ')', ']', '}']);
/** A closing bracket that balances an opening one belongs to the URL, not to the sentence. */
const OPENING: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };
const FILE_SCHEME = /^file:/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const identifier = (value: unknown): string | undefined =>
  typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;

const numericCode = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

const occurrences = (value: string, character: string): number => value.split(character).length - 1;

/**
 * Splits the punctuation the sentence owns from the source. A balanced bracket pair
 * such as `https://host/wiki/Foo_(bar)` stays inside the source.
 */
const trimTrailing = (value: string): { source: string; tail: string } => {
  let end = value.length;
  for (;;) {
    const last = value.charAt(end - 1);
    if (!TRAILING.has(last)) break;
    const opening = OPENING[last];
    if (opening !== undefined) {
      const body = value.slice(0, end);
      if (occurrences(body, last) <= occurrences(body, opening)) break;
    }
    end -= 1;
  }
  return { source: value.slice(0, end), tail: value.slice(end) };
};

/** The directory is machine-specific; the file name is what identifies the failure. */
const pathMarker = (path: string): string => {
  const segments = path.replace(/[\\/]+$/u, '').split(/[\\/]+/u);
  const base = segments.at(-1) ?? '';
  return base === '' ? '[path]' : `[path]/${base}`;
};

/**
 * A `file:` URL carries no authority, so it is a machine-specific path with a scheme:
 * only its basename survives, exactly as for the same path written without one.
 */
const fileMarker = (url: string): string =>
  pathMarker(url.replace(/^file:\/*/iu, '').split(/[?#]/u)[0] ?? '');

/** URLs go through the asset-source redactor: userinfo and fragment stripped, count only. */
const urlMarker = (url: string): string =>
  FILE_SCHEME.test(url) ? fileMarker(url) : redactAssetSource(url);

/**
 * One line, no stack frames, no URL credentials and no machine-specific directories.
 * URLs go through the asset-source redactor, which keeps scheme, host, path and a query
 * count marker; a real filesystem path becomes `[path]/<basename>`.
 */
const causeMessage = (value: string): string | undefined => {
  const text = value
    .split(/\r?\n/u)
    .filter((line) => !STACK_FRAME.test(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text === '') return undefined;
  const redacted = text.replace(
    SOURCE,
    (match: string, url?: string, relative?: string): string => {
      if (url === undefined && relative === undefined) {
        const path = trimTrailing(match);
        return `${pathMarker(path.source)}${path.tail}`;
      }
      const source = trimTrailing(match);
      return `${urlMarker(source.source)}${source.tail}`;
    },
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
 * location, and, when it yields a usable message or name, reports evidence in `details.cause`
 * for investigating a page exception, transport or CDP failure, or Chromium crash;
 * the diagnostic itself does not classify it.
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
