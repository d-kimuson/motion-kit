import { spawnSync } from 'node:child_process';

import { flagProfiles } from './flags.ts';

// Diagnostic matrix: supported profiles run the full order comparison; disabled WebGL must fail.
// Other outcomes are reported rather than frozen as cross-platform expectations.
let disabledWebglRejected = false;
let softwarePassed = false;
for (const [profile, flags] of Object.entries(flagProfiles)) {
  const result = spawnSync('pnpm', ['spike:three', '-t', 'absolute time:'], {
    env: { ...process.env, SPIKE_THREE_FLAGS: profile },
    encoding: 'utf8',
    timeout: 180_000,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(
    JSON.stringify({ profile, flags, exitCode: result.status, error: result.error?.message }),
  );
  if (profile === 'swiftshader')
    softwarePassed = result.status === 0 && /"renderer":"[^"]*SwiftShader/.test(result.stdout);
  if (profile === 'disabled-webgl')
    disabledWebglRejected =
      result.status !== 0 && result.stdout.concat(result.stderr).includes('WebGL2 unavailable');
}
if (!softwarePassed || !disabledWebglRejected) process.exitCode = 1;
