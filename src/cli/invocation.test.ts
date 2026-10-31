import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { CommandSchema, EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';
import { valueTakingOptions, commands } from './commands.ts';
// How an agent's argv becomes the envelope's `command`, checked against the committed schema: an
// unusable invocation must still yield one envelope the contract accepts.
import { resolveCommand } from './invocation.ts';

const jsonSchema = new Ajv2020({ strictTypes: false }).compile(committedSchema);

/**
 * The envelope `runCli` builds for a failed invocation: one document, one Diagnostic. The hint is
 * a literal on purpose — the exact hints the CLI prints are asserted against the real CLI
 * (`cli.test.ts`), so nothing here can pass by deriving its expectation from the contract's enum.
 */
const invocationEnvelope = (argv: readonly string[]): Envelope =>
  EnvelopeSchema.parse({
    schemaVersion: 1,
    command: resolveCommand(argv),
    ok: false,
    data: null,
    diagnostics: [
      {
        code: 'cli.invalid-arguments',
        severity: 'error',
        message: 'Command-line arguments are invalid.',
        hint: 'Pass one of the known subcommands: render, frame, docs, check, inspect, validate.',
      },
    ],
    durationMs: 1,
  });

describe('resolveCommand', () => {
  it.each([
    // A usable invocation, and one that fails inside commander: both still name the subcommand.
    { argv: ['render', '--bogus', '--json'], command: 'render' },
    { argv: ['frame', 'entry.tsx', '--frame', '0', '--out', 'f.png'], command: 'frame' },
    // The shipped docs command and the reserved subcommands resolve to themselves: the enum is
    // the contract's.
    { argv: ['docs', '--json'], command: 'docs' },
    { argv: ['docs', 'cli'], command: 'docs' },
    { argv: ['check', 'entry.tsx', '--frame', '1', '--json'], command: 'check' },
    { argv: ['inspect', '--json'], command: 'inspect' },
    { argv: ['validate', '--json'], command: 'validate' },
    // A value-taking option's value is not a positional argument, so it cannot take the slot or
    // become the command: the subcommand written after it is the candidate.
    { argv: ['--out', '/tmp/a.png', 'render', 'entry.tsx', '--json'], command: 'render' },
    { argv: ['--out', 'x.mp4', 'check', 'entry.tsx', '--json'], command: 'check' },
    { argv: ['--composition', 'frame', 'render', 'entry.tsx', '--json'], command: 'render' },
    { argv: ['--props', '{"text":"frame"}', 'render', 'entry.tsx'], command: 'render' },
    { argv: ['--frame', '3', 'frame', 'entry.tsx'], command: 'frame' },
    // `--opt=value` carries its value in the same token, so the next token stays positional.
    { argv: ['--out=/tmp/a.png', 'render', 'entry.tsx', '--json'], command: 'render' },
    { argv: ['--composition=frame', 'render', 'entry.tsx'], command: 'render' },
    // No positional at all, and a positional the CLI does not know.
    { argv: ['--json'], command: null },
    { argv: [], command: null },
    { argv: ['unknown', '--json'], command: null },
  ])('resolves $argv to $command', ({ argv, command }) => {
    expect(resolveCommand(argv)).toBe(command);
  });

  it('knows the contract enum and nothing else, so no sentinel member is possible', () => {
    expect(CommandSchema.options).toEqual([
      'render',
      'frame',
      'docs',
      'check',
      'preview',
      'inspect',
      'validate',
    ]);
    expect(resolveCommand(['unknown'])).toBeNull();
    expect(resolveCommand([])).toBeNull();
  });

  it('takes its value-taking options from the CLI declarations, so it cannot fall behind', () => {
    expect([...valueTakingOptions].sort()).toEqual([
      '--changed-ratio',
      '--channel-tolerance',
      '--composition',
      '--concurrency',
      '--fps',
      '--frame',
      '--history',
      '--out',
      '--port',
      '--predecessor',
      '--preview-fps',
      '--project-root',
      '--props',
      '--scale',
      '--video-bitrate',
      '--video-crf',
      '--vite-config',
    ]);
  });

  it('collects long names only, and no value-taking option has a short alias to miss', () => {
    // `valueTakingOptions` holds the long form the resolver skips, because `--opt <value>` is what
    // argv carries. A value-taking short alias (`-o <value>`) would not be skipped, so this test
    // fails as soon as one is declared: the derivation in `commands.ts` then has to collect
    // `option.short` too rather than let the resolver fall behind silently.
    const valueTaking = Object.values(commands).flatMap((command) =>
      command.options.filter((option) => option.required || option.optional),
    );
    expect(valueTaking.map((option) => option.long).filter((long) => long === undefined)).toEqual(
      [],
    );
    expect(
      valueTaking.filter((option) => option.short !== undefined).map((option) => option.long),
    ).toEqual([]);
  });

  it.each([...valueTakingOptions].map((option) => ({ option })))(
    'skips the value of $option',
    ({ option }) => {
      expect(resolveCommand([option, 'frame', 'render', 'entry.tsx', '--json'])).toBe('render');
    },
  );

  it.each([
    { argv: ['render', '--bogus', '--json'] },
    { argv: ['--json'] },
    { argv: ['unknown', '--json'] },
    { argv: ['docs', '--json'] },
    { argv: ['inspect', '--json'] },
    { argv: ['--out', '/tmp/a.png', 'render', 'entry.tsx', '--json'] },
  ])('produces an envelope both validators accept for $argv', ({ argv }) => {
    const envelope = invocationEnvelope(argv);
    expect(envelope.command).toBe(resolveCommand(argv));
    expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(jsonSchema(envelope)).toBe(true);
  });

  it('rejects a null command that claims success, data or an invented name', () => {
    const envelope = invocationEnvelope(['--json']);
    for (const payload of [
      { ...envelope, ok: true },
      { ...envelope, data: {} },
      { ...envelope, command: 'unknown' },
    ]) {
      expect(EnvelopeSchema.safeParse(payload).success).toBe(false);
      expect(jsonSchema(payload)).toBe(false);
    }
  });
});
