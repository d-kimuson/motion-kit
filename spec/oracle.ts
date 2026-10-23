// Shared part of the differential tests (docs/guidelines/quality-assurance/lean-spec.md): sends a request to the
// Lean oracle built by `lake build` and returns the spec's result. Import it from `<name>.oracle.test.ts` only;
// the JSON conversion between Lean types and implementation values stays inside each test.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ORACLE_BIN = '.lake/build/bin/spec-oracle';

export type OracleRequest = { readonly fn: string; readonly args: unknown };

const parseLine = (line: string): unknown => JSON.parse(line) as unknown;

const isErrorResponse = (value: unknown): value is { readonly error: string } =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof value.error === 'string';

/** Evaluates several requests in one oracle process. Results come back in request order. */
export const evalSpecs = (requests: readonly OracleRequest[]): unknown[] => {
  if (!existsSync(ORACLE_BIN)) {
    throw new Error(`${ORACLE_BIN} not found: run \`lake build\` first`);
  }
  const input = requests.map((request) => `${JSON.stringify(request)}\n`).join('');
  const result = spawnSync(ORACLE_BIN, [], { input, encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`spec-oracle exited with ${String(result.status)}: ${result.stderr}`);
  }
  const lines = result.stdout.split('\n').filter((line) => line !== '');
  if (lines.length !== requests.length) {
    throw new Error(
      `spec-oracle returned ${String(lines.length)} lines for ${String(requests.length)} requests`,
    );
  }
  return lines.map((line, index) => {
    const value = parseLine(line);
    if (isErrorResponse(value)) {
      const request = requests[index];
      throw new Error(`spec-oracle could not evaluate ${JSON.stringify(request)}: ${value.error}`);
    }
    return value;
  });
};

/** Evaluates one spec definition. Throws when the oracle is missing or reports an error. */
export const evalSpec = (fn: string, args: unknown): unknown => {
  const [value] = evalSpecs([{ fn, args }]);
  return value;
};
