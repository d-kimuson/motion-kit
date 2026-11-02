import { mkdirSync, writeFileSync } from 'node:fs';

import { type Diagnostic } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';

// The CLI writes every frame and manifest it produces, so the file system is one of its
// boundaries. A refusal there — a directory where a frame belongs, a read-only directory, a full
// disk — is the state of the output path: the caller can change it, and it is not a bug. Converting
// it here keeps that domain failure from escaping as an `internal.unexpected` (exit 3) when the
// outer catch would call it one (agent ADR: CLI output contract).

/** The Node.js errno code an exception carries, when it carries one (`EISDIR`, `EACCES`, …). */
const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const outputUnwritable = (output: string, error: unknown): Diagnostic => {
  const code = errorCode(error);
  return {
    code: 'render.output-unwritable',
    severity: 'error',
    message: 'The output path could not be written.',
    hint: 'Check write access and free space on the output path, and remove anything in the way, such as a directory where a PNG frame belongs.',
    location: { file: output },
    details: code === undefined ? { output } : { output, code },
  };
};

/** Writes one file the command owes its caller; a refusal is a Diagnostic, not an exception. */
export const writeOutputFile = (path: string, contents: string | Uint8Array): Result<void> => {
  try {
    writeFileSync(path, contents);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: outputUnwritable(path, error) };
  }
};

/** Creates a directory the command writes into; that creation is part of the same boundary. */
export const createOutputDirectory = (path: string): Result<void> => {
  try {
    mkdirSync(path, { recursive: true });
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: outputUnwritable(path, error) };
  }
};
