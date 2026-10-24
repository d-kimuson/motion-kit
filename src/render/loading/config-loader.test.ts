import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('intercepts config imports before Vite attempts project-relative package lookup', () => {
  const root = mkdtempSync(join(tmpdir(), 'motion-kit-interception-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import {version,defineConfig} from 'vite';if(version!=='7.3.7')throw new Error('wrong Vite');export default defineConfig({});`,
    );
    const script = `import fs from 'node:fs';
import {installBundledVite} from ${JSON.stringify(new URL('./config-loader.ts', import.meta.url).href)};
installBundledVite(${JSON.stringify(root)});
const {loadConfigFromFile}=await import('vite');
// Vite can leave an unresolved import external, accidentally letting the later
// Node hook hide the missing first stage. Observe the actual filesystem boundary.
let attempted=false;const original=fs.existsSync;
fs.existsSync=(path)=>{if(String(path).endsWith('/node_modules/vite/package.json'))attempted=true;return original(path);};
await loadConfigFromFile({command:'serve',mode:'development'},undefined,${JSON.stringify(root)});
if(attempted)throw new Error('FORBIDDEN_PROJECT_LOOKUP');
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.stderr).not.toContain('FORBIDDEN_PROJECT_LOOKUP');
    expect(result.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
