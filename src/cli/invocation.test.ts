import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { CommandSchema, EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';
// The three argv shapes an agent actually types when it invokes no usable subcommand, checked
// against the committed schema: each must still yield one envelope the contract accepts.
import { resolveCommand } from './invocation.ts';

const jsonSchema = new Ajv2020({ strictTypes: false }).compile(committedSchema);

/** The envelope `runCli` builds for a failed invocation: one document, one Diagnostic. */
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
        hint: `Pass one of the known subcommands: ${CommandSchema.options.join(', ')}.`,
      },
    ],
    durationMs: 1,
  });

describe('resolveCommand', () => {
  it.each([
    { argv: ['render', '--bogus', '--json'], command: 'render' },
    { argv: ['--json'], command: null },
    { argv: ['unknown', '--json'], command: null },
  ])('resolves $argv to $command', ({ argv, command }) => {
    expect(resolveCommand(argv)).toBe(command);
  });

  it('knows the contract enum and nothing else, so no sentinel member is possible', () => {
    expect(CommandSchema.options).toEqual(['render', 'frame', 'inspect', 'validate']);
    expect(resolveCommand(['unknown'])).toBeNull();
    expect(resolveCommand([])).toBeNull();
  });

  it.each([
    { argv: ['render', '--bogus', '--json'] },
    { argv: ['--json'] },
    { argv: ['unknown', '--json'] },
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
