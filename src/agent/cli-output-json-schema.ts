import { z } from 'zod';

import { DiagnosticSchema } from '../lib/diagnostic.ts';
import { EnvelopeSchema } from './cli-output.ts';

// Zod cannot translate superRefine. Express the same predicates in JSON Schema,
// and test both validators against the same generated and invalid payloads.
export const createCliOutputJsonSchema = () =>
  z.toJSONSchema(EnvelopeSchema, {
    target: 'draft-2020-12',
    reused: 'ref',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema !== EnvelopeSchema) return;
      const errorSeverity = { const: DiagnosticSchema.options[0].shape.severity.value };
      jsonSchema.allOf = [
        {
          if: { properties: { ok: { const: true } }, required: ['ok'] },
          // JSON Schema's `then` is a keyword with an object value, not a thenable method.
          // oxlint-disable-next-line unicorn/no-thenable
          then: {
            properties: {
              diagnostics: {
                not: {
                  contains: { properties: { severity: errorSeverity }, required: ['severity'] },
                },
              },
              data: { not: { type: 'null' } },
            },
          },
          else: {
            properties: {
              diagnostics: {
                contains: { properties: { severity: errorSeverity }, required: ['severity'] },
              },
            },
          },
        },
      ];
    },
  });
