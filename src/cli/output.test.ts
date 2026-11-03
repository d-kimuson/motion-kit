import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Diagnostic } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';
import {
  createOutputDirectory,
  readOutputFile,
  removeOutputFile,
  writeOutputFile,
} from './output.ts';

// The file system is a boundary of the CLI: a refusal there is the caller's to fix (TASK-243), so
// these cases are about the Diagnostic the helper produces, not about the write itself.
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'motion-kit-cli-output-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const refusalOf = <T>(result: Result<T>): Diagnostic => {
  if (result.ok) throw new Error('expected the write to be refused');
  return result.error;
};

describe('CLI output writes', () => {
  it('writes the bytes and reports success', () => {
    const path = join(root, 'written.png');
    expect(writeOutputFile(path, Buffer.from([1, 2, 3]))).toEqual({ ok: true, value: undefined });
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('creates the directory and every missing parent', () => {
    const path = join(root, 'created', 'nested', 'frames');
    expect(createOutputDirectory(path)).toEqual({ ok: true, value: undefined });
    expect(writeOutputFile(join(path, 'frame-00001.png'), Buffer.from([4]))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(readFileSync(join(path, 'frame-00001.png'))).toEqual(Buffer.from([4]));
  });

  it('reports a directory where a file belongs as render.output-unwritable', () => {
    const path = join(root, 'blocked.png');
    mkdirSync(path);

    expect(refusalOf(writeOutputFile(path, Buffer.from([1])))).toEqual({
      code: 'render.output-unwritable',
      severity: 'error',
      message: 'The output path could not be written.',
      hint: 'Check write access and free space on the output path, and remove anything in the way, such as a directory where a PNG frame belongs.',
      location: { file: path },
      details: { output: path, code: 'EISDIR' },
    });
  });

  it('reports a directory it cannot create as render.output-unwritable', () => {
    const path = join(root, 'occupied');
    writeFileSync(path, 'a file, not a directory');

    const diagnostic = refusalOf(createOutputDirectory(path));
    expect(diagnostic).toMatchObject({
      code: 'render.output-unwritable',
      severity: 'error',
      location: { file: path },
      details: { output: path, code: 'EEXIST' },
    });
  });

  it('reads a missing file as absent and a directory as render.output-unwritable', () => {
    const missing = join(root, 'missing-manifest.json');
    expect(readOutputFile(missing)).toEqual({ ok: true, value: undefined });

    const directory = join(root, 'manifest-is-a-directory.json');
    mkdirSync(directory, { recursive: true });
    expect(refusalOf(readOutputFile(directory))).toMatchObject({
      code: 'render.output-unwritable',
      location: { file: directory },
      details: { output: directory, code: 'EISDIR' },
    });
  });

  it('removes a file it owns and reports a removal it cannot make', () => {
    const path = join(root, 'removed-manifest.json');
    writeFileSync(path, '{}');
    expect(removeOutputFile(path)).toEqual({ ok: true, value: undefined });
    expect(existsSync(path)).toBe(false);
    expect(refusalOf(removeOutputFile(path))).toMatchObject({
      code: 'render.output-unwritable',
      details: { output: path, code: 'ENOENT' },
    });
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'reports a read-only directory as render.output-unwritable',
    () => {
      const directory = join(root, 'read-only');
      mkdirSync(directory, { recursive: true });
      chmodSync(directory, 0o500);
      try {
        const path = join(directory, 'frame-00000.png');
        expect(refusalOf(writeOutputFile(path, Buffer.from([1])))).toMatchObject({
          code: 'render.output-unwritable',
          location: { file: path },
          details: { output: path, code: 'EACCES' },
        });
      } finally {
        chmodSync(directory, 0o700);
      }
    },
  );
});
