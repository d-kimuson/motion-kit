import { fork } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openLoadingSession } from './session.ts';

const require = createRequire(import.meta.url);
const directories: string[] = [];
const sessions: Awaited<ReturnType<typeof openLoadingSession>>[] = [];
const fixture = (config?: string) => {
  const root = mkdtempSync(join(tmpdir(), 'motion-kit-project-'));
  directories.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(dirname(require.resolve(`${name}/package.json`)), join(root, 'node_modules', name));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(root, 'entry.tsx'),
    `import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';
export const compositions = defineCompositions(['one','two'].map(id => defineComposition({
id, component: () => <div>not rendered before owned time</div>, schema: z.object({text:z.string().default('hello')}),
width:320,height:180,fps:{numerator:30,denominator:1},durationInFrames:10})));`,
  );
  if (config !== undefined) writeFileSync(join(root, 'vite.config.ts'), config);
  return root;
};
const open = async (root: string, loadingTimeoutMs = 15_000) => {
  const result = await openLoadingSession({
    projectRoot: root,
    entry: 'entry.tsx',
    loadingTimeoutMs,
  });
  sessions.push(result);
  return result;
};
afterEach(async () => {
  for (const session of sessions.splice(0)) if (session.ok) await session.value.dispose();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('supervised loading session', () => {
  it('honors async serve config, aliases, plugin transforms, CSS, public assets, base and root without reevaluating config', async () => {
    const root = fixture();
    mkdirSync(join(root, 'site/static'), { recursive: true });
    writeFileSync(join(root, 'site/static/asset.txt'), 'asset-ok');
    writeFileSync(join(root, 'style.css'), 'body { --loading-test: css-ok; }');
    writeFileSync(
      join(root, 'alias.tsx'),
      `export const token = 'TRANSFORM_ME'; export const element = <div/>;`,
    );
    const count = join(root, 'config-count.txt');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import {defineConfig} from 'vite'; import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(count)},'once');
export default defineConfig(async ({command,mode})=>{if(command!=='serve'||mode!=='development')throw new Error('wrong env');return {
root:'site',base:'/video/',publicDir:'static',resolve:{alias:{'scene-alias':${JSON.stringify(join(root, 'alias.tsx'))}}},
plugins:[{name:'fixture-transform',transform(code,id){if(id.endsWith('alias.tsx'))return code.replace('TRANSFORM_ME','plugin-ok');},transformIndexHtml(){return [{tag:'script',children:'globalThis.WebSocket = class { constructor() { throw new Error("renderer must not open HMR transport"); } };',injectTo:'head-prepend'},{tag:'meta',attrs:{name:'loading-shell',content:'plugin-ok'},injectTo:'head'}]}}]
};});`,
    );
    writeFileSync(
      join(root, 'entry.tsx'),
      `import './style.css';import {token,element} from 'scene-alias';
if(token!=='plugin-ok' || !element || !document.querySelector('meta[name="loading-shell"]') || getComputedStyle(document.body).getPropertyValue('--loading-test').trim()!=='css-ok')throw new Error('config not applied');
if(await (await fetch(import.meta.env.BASE_URL+'asset.txt')).text()!=='asset-ok')throw new Error('public/base failed');
${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    const result = await open(root);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Loading failed');
    expect(result.value.url).toContain('/video/__motion-kit/');
    expect((await result.value.select({ compositionId: 'two' })).ok).toBe(true);
    expect(readFileSync(count, 'utf8')).toBe('once');
    expect(await (await fetch(result.value.url.replace('__motion-kit/', 'asset.txt'))).text()).toBe(
      'asset-ok',
    );
  }, 30_000);

  it('enforces owned settings after asynchronous configResolved hooks finish', async () => {
    const root = fixture(`export default {plugins:[{name:'late-settings',enforce:'post',
configResolved:{order:'post',async handler(c){await new Promise(done=>setTimeout(done,20));c.server.ws=true;c.server.hmr={port:0};c.server.middlewareMode=false;c.server.open=true;c.server.host='0.0.0.0';c.appType='spa';}},
configureServer(s){const c=s.config;if(c.server.ws!==false||c.server.hmr!==false||c.server.middlewareMode!==true||c.server.open!==false||c.server.host!=='127.0.0.1'||c.appType!=='custom')throw new Error('owned settings escaped');}}]};`);
    expect(await open(root)).toMatchObject({ ok: true });
  });

  it.each(['resolve', 'environments.client.resolve'])(
    'restores singleton aliases on the actual optimizer path after mutating %s',
    async (target) => {
      const root = fixture(`export default {plugins:[{name:'late-alias',configResolved(c){
for(const a of c.${target}.alias)if(String(a.find).includes('react'))a.replacement='/missing-review-react.js';
}}]};`);
      const result = await open(root);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error('Loading failed');
      const metadata = readFileSync(
        join(result.value.workspace, 'cache/deps/_metadata.json'),
        'utf8',
      );
      expect(metadata).toContain('react/jsx-runtime');
      expect(metadata).toContain('react-dom/client');
      expect(metadata).not.toContain('missing-review-react');
      expect((await result.value.select({ compositionId: 'one' })).ok).toBe(true);
    },
  );

  it('restores React dedupe in the effective client environment after in-place clearing', async () => {
    const root =
      fixture(`export default {plugins:[{name:'late-dedupe',configResolved(c){c.resolve.dedupe.splice(0);},configureServer(s){
for(const name of ['react','react-dom'])if(!s.environments.client.config.resolve.dedupe.includes(name))throw Error('dedupe escaped');
}}]};`);
    expect(await open(root)).toMatchObject({ ok: true });
  });

  it.each(['config', 'configEnvironment', 'configResolved'])(
    'preserves project singleton identity and React dedupe supplied through %s',
    async (hook) => {
      const policy = `resolve:{dedupe:['scene-singleton','other-singleton','scene-singleton']}`;
      const root =
        fixture(`export default {optimizeDeps:{exclude:['linked-scene','scene-singleton']},plugins:[{
name:'project-dedupe',${hook === 'configResolved' ? `configResolved(c){for(const e of Object.values(c.environments))e.resolve.dedupe=['scene-singleton','other-singleton','scene-singleton'];c.resolve.dedupe=['scene-singleton','other-singleton'];}` : `${hook}(){return {${policy}};}`},
configureServer(s){s.middlewares.use('/dedupe-policy',(_req,res)=>res.end(JSON.stringify({top:s.config.resolve.dedupe,...Object.fromEntries(Object.entries(s.environments).map(([name,e])=>[name,e.config.resolve.dedupe]))})));}
}]};`);
      const linked = mkdtempSync(join(tmpdir(), 'motion-kit-linked-'));
      directories.push(linked);
      for (const name of ['scene-singleton', 'react', 'react-dom']) {
        const dependency = join(linked, 'node_modules', name);
        mkdirSync(dependency, { recursive: true });
        writeFileSync(
          join(dependency, 'package.json'),
          JSON.stringify({ name, type: 'module', main: 'index.js' }),
        );
        writeFileSync(join(dependency, 'index.js'), `throw Error('duplicate ${name} singleton');`);
      }
      const singleton = join(root, 'node_modules/scene-singleton');
      mkdirSync(singleton);
      writeFileSync(
        join(singleton, 'package.json'),
        '{"name":"scene-singleton","type":"module","main":"index.js"}',
      );
      writeFileSync(join(singleton, 'index.js'), `export const identity={project:true};`);
      writeFileSync(
        join(linked, 'package.json'),
        '{"name":"linked-scene","type":"module","main":"index.js"}',
      );
      writeFileSync(
        join(linked, 'index.js'),
        `export {identity} from 'scene-singleton';export {createElement} from 'react';export {flushSync} from 'react-dom';`,
      );
      symlinkSync(linked, join(root, 'node_modules/linked-scene'));
      writeFileSync(
        join(root, 'entry.tsx'),
        `import {identity} from 'scene-singleton';import {createElement} from 'react';import {flushSync} from 'react-dom';import * as linked from 'linked-scene';
if(identity!==linked.identity||!identity.project||createElement!==linked.createElement||flushSync!==linked.flushSync)throw Error('module identity split');
${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
      );
      const result = await open(root);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw Error('Loading failed');
      const policies: unknown = await (
        await fetch(new URL('/dedupe-policy', result.value.url))
      ).json();
      expect(policies).toEqual(
        Object.fromEntries(
          ['top', 'client', 'ssr'].map((name) => [
            name,
            name === 'top' && hook === 'configEnvironment'
              ? ['react', 'react-dom']
              : ['scene-singleton', 'other-singleton', 'react', 'react-dom'],
          ]),
        ),
      );
      expect((await result.value.select({ compositionId: 'one' })).ok).toBe(true);
    },
  );

  it('applies supported late client conditions and define while restoring optimizer entries and includes', async () => {
    const root = fixture(`export default {plugins:[{name:'late-environment',configResolved(c){
const e=c.environments.client;e.resolve.conditions=['audit-condition'];e.define={__AUDIT_TOKEN__:JSON.stringify('defined-ok')};
e.optimizeDeps={...e.optimizeDeps,noDiscovery:true,entries:['/missing-audit-entry.ts'],include:['missing-audit-dependency']};
}}]};`);
    const dependency = join(root, 'node_modules/condition-probe');
    mkdirSync(dependency);
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: 'condition-probe',
        type: 'module',
        exports: { 'audit-condition': './chosen.js', default: './wrong.js' },
      }),
    );
    writeFileSync(join(dependency, 'chosen.js'), `export default 'condition-ok';`);
    writeFileSync(join(dependency, 'wrong.js'), `throw Error('condition ignored');`);
    writeFileSync(
      join(root, 'entry.tsx'),
      `import token from 'condition-probe';if(token!=='condition-ok'||__AUDIT_TOKEN__!=='defined-ok')throw Error('environment ignored');\n${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    expect(await open(root)).toMatchObject({ ok: true });
  });

  it.each([
    'config',
    'configResolved',
    'configureServer',
    'async config',
    'async configResolved',
    'async configureServer',
  ])('reports an awaited %s hook failure in exactly one IPC message', async (hook) => {
    const root = fixture(
      `export default {plugins:[{name:'throwing-hook',${hook}(){throw Error('private');}}]};`,
    );
    const workspace = mkdtempSync(join(tmpdir(), 'motion-kit-ipc-'));
    directories.push(workspace);
    const child = fork(
      new URL('./child.js', import.meta.url),
      [JSON.stringify({ projectRoot: root, entry: 'entry.tsx', workspace })],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        detached: true,
        execArgv: [],
      },
    );
    const messages: unknown[] = [];
    child.on('message', (message) => messages.push(message));
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((done) => child.once('disconnect', done)),
        new Promise<never>((_done, reject) => {
          timer = setTimeout(() => reject(Error('Child did not close')), 10_000);
        }),
      ]);
      expect(messages).toEqual([
        {
          type: 'failure',
          error: {
            code: 'render.page-error',
            severity: 'error',
            message: 'Loading configuration rejected "throwing-hook".',
            hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
          },
        },
      ]);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined)
        process.kill(-child.pid, 'SIGKILL');
      await closed;
    }
  });

  it('deduplicates React for linked packages against the project installation', async () => {
    const root = fixture();
    const linked = mkdtempSync(join(tmpdir(), 'motion-kit-linked-'));
    directories.push(linked);
    mkdirSync(join(linked, 'node_modules/react'), { recursive: true });
    writeFileSync(
      join(linked, 'package.json'),
      '{"name":"linked-scene","type":"module","main":"index.tsx"}',
    );
    writeFileSync(
      join(linked, 'node_modules/react/package.json'),
      '{"name":"react","type":"module","main":"index.js"}',
    );
    writeFileSync(
      join(linked, 'node_modules/react/index.js'),
      `throw new Error('second React must never load');`,
    );
    writeFileSync(
      join(linked, 'index.tsx'),
      `export {createElement as linkedCreateElement} from 'react';`,
    );
    symlinkSync(linked, join(root, 'node_modules/linked-scene'));
    writeFileSync(
      join(root, 'entry.tsx'),
      `import {createElement} from 'react';import {linkedCreateElement} from 'linked-scene';if(createElement!==linkedCreateElement)throw new Error('React split');\n${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    expect(await open(root)).toMatchObject({ ok: true });
  });

  it('rejects an imported missing preprocessor by name, not a generic module failure', async () => {
    const root = fixture();
    writeFileSync(join(root, 'style.scss'), '$color:red; body{color:$color}');
    writeFileSync(
      join(root, 'entry.tsx'),
      `import './style.scss';\n${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    expect(await open(root)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading configuration rejected "sass".',
        hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
      },
    });
  }, 20_000);

  it('rejects imported Sass before Vite attempts optional-preprocessor package lookup', async () => {
    const root = fixture();
    const markerRoot = mkdtempSync(join(tmpdir(), 'motion-kit-preprocessor-order-'));
    directories.push(markerRoot);
    const marker = join(markerRoot, 'lookup-attempted');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import fs from 'node:fs';
export default {plugins:[{name:'preprocessor-order',configResolved(){
const original=fs.existsSync;fs.existsSync=path=>{
if(/\\/node_modules\\/sass(?:-embedded)?\\/package\\.json$/.test(String(path))){fs.writeFileSync(${JSON.stringify(marker)},'FORBIDDEN_PREPROCESSOR_LOOKUP');throw Error('FORBIDDEN_PREPROCESSOR_LOOKUP');}
return original(path);};}}]};`,
    );
    writeFileSync(join(root, 'style.scss'), '$color:red;body{color:$color}');
    writeFileSync(
      join(root, 'entry.tsx'),
      `import './style.scss';\n${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    const result = await open(root);
    expect({ forbiddenPreprocessorLookup: existsSync(marker) }).toEqual({
      forbiddenPreprocessorLookup: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'Loading configuration rejected "sass".' },
    });
  });

  it('names a missing preprocessor reached through nested CSS imports', async () => {
    const root = fixture();
    writeFileSync(join(root, 'style.css'), '@import "./nested.css";');
    writeFileSync(join(root, 'nested.css'), '@import "./colors.scss";');
    writeFileSync(join(root, 'colors.scss'), '$color:red; body{color:$color}');
    writeFileSync(
      join(root, 'entry.tsx'),
      `import './style.css';\n${readFileSync(join(root, 'entry.tsx'), 'utf8')}`,
    );
    expect(await open(root)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading configuration rejected "sass".',
        hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
      },
    });
  });

  it.each(['accept', 'reject'])(
    'cancels a pending %s props parse on caller disposal without a Diagnostic',
    async (outcome) => {
      const root = fixture();
      const markerRoot = mkdtempSync(join(tmpdir(), 'motion-kit-parse-'));
      directories.push(markerRoot);
      const marker = join(markerRoot, 'parse-started');
      writeFileSync(
        join(root, 'vite.config.ts'),
        `import {writeFileSync} from 'node:fs';export default {plugins:[{name:'parse-marker',configureServer(s){s.middlewares.use('/parse-started',(_req,res)=>{writeFileSync(${JSON.stringify(marker)},'started');res.end();});}}]};`,
      );
      writeFileSync(
        join(root, 'entry.tsx'),
        readFileSync(join(root, 'entry.tsx'), 'utf8').replace(
          "z.object({text:z.string().default('hello')})",
          `z.object({text:z.string().default('hello')}).superRefine(async (props,ctx)=>{if(props.text==='hello')return;await fetch('/parse-started');await new Promise(done=>setTimeout(done,2000));if(props.text==='reject')ctx.addIssue({code:'custom',message:'rejected'});})`,
        ),
      );
      const result = await open(root);
      if (!result.ok) throw new Error('Loading failed');
      const pending = result.value.select({ compositionId: 'one', props: { text: outcome } });
      await expect.poll(() => existsSync(marker)).toBe(true);
      await new Promise((done) => setTimeout(done, 500));
      expect(await result.value.dispose()).toEqual({ ok: true, value: undefined });
      expect(await pending).toEqual({ ok: false, aborted: true });
      expect(existsSync(result.value.workspace)).toBe(false);
      expect(() => process.kill(result.value.servicePid, 0)).toThrow('ESRCH');
      expect(() => process.kill(result.value.browserPid, 0)).toThrow('ESRCH');
    },
  );

  it('restarts individual defaults and later props budgets, kills a blocked later parse, and never keeps the poisoned realm', async () => {
    const root = fixture();
    const source = readFileSync(join(root, 'entry.tsx'), 'utf8').replace(
      "z.object({text:z.string().default('hello')})",
      `z.object({text:z.string().default('hello')}).superRefine(async props=>{if(props.text==='hang'){while(true){}} await new Promise(done=>setTimeout(done,1600));})`,
    );
    writeFileSync(join(root, 'entry.tsx'), source);
    const result = await open(root, 3000);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Loading failed');
    // Two sequential defaults consume >3000ms; each must receive its own full budget.
    expect((await result.value.select({ compositionId: 'one', props: { text: 'later' } })).ok).toBe(
      true,
    );
    expect(await result.value.select({ compositionId: 'two', props: { text: 'hang' } })).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading props parse and mount timed out.',
        hint: 'Increase loadingTimeoutMs or fix blocked props parse and mount; no late result will be mounted.',
      },
    });
    expect(existsSync(result.value.workspace)).toBe(false);
    expect(() => process.kill(result.value.servicePid, 0)).toThrow('ESRCH');
    expect(() => process.kill(result.value.browserPid, 0)).toThrow('ESRCH');
  }, 30_000);

  it('returns import and metadata failures without waiting for a missing global', async () => {
    const missing = fixture();
    writeFileSync(join(missing, 'entry.tsx'), 'export default () => null;');
    expect(await open(missing)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading page bootstrap failed.',
        hint: 'Check page bootstrap and the project configuration; the loader uses bundled Vite 7.3.7.',
      },
    });
    const invalid = fixture();
    writeFileSync(
      join(invalid, 'entry.tsx'),
      readFileSync(join(invalid, 'entry.tsx'), 'utf8').replace(
        'durationInFrames:10',
        'durationInFrames:-1',
      ),
    );
    expect(await open(invalid)).toEqual({
      ok: false,
      error: {
        code: 'composition.duration-invalid',
        severity: 'error',
        message: 'Composition duration must be a nonnegative safe integer frame count.',
        hint: 'Supply durationInFrames; zero is listable but has no output frame.',
        location: { compositionId: 'one' },
      },
    });
  });

  it('fails detected source changes and closes an idle session', async () => {
    const root = fixture();
    const result = await open(root);
    if (!result.ok) throw new Error('Loading failed');
    writeFileSync(
      join(root, 'entry.tsx'),
      readFileSync(join(root, 'entry.tsx'), 'utf8') + '\n// changed',
    );
    await expect.poll(() => existsSync(result.value.workspace)).toBe(false);
    expect(await result.value.select({ compositionId: 'one' })).toMatchObject({
      ok: false,
      error: {
        code: 'render.page-error',
        message: 'Loading source changed; start a fresh session failed.',
      },
    });
  });

  it('loads no-config TSX without project Vite; reuses one server, replaces realms and tears down handles/directories', async () => {
    const root = fixture();
    writeFileSync(
      join(root, 'entry.tsx'),
      readFileSync(join(root, 'entry.tsx'), 'utf8').replace(
        "z.object({text:z.string().default('hello')})",
        `z.object({text:z.string().default('hello')}).superRefine((props,ctx)=>{if(props.text==='second' && window.selectionMarker==='first')ctx.addIssue({code:'custom',message:'realm reused'});if(props.text==='first')window.selectionMarker='first';})`,
      ),
    );
    expect(existsSync(join(root, 'node_modules/vite'))).toBe(false);
    const result = await open(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.value;
    expect(session.compositions.map((item) => item.id)).toEqual(['one', 'two']);
    const first = await session.select({ compositionId: 'one', props: { text: 'first' } });
    expect(first.ok).toBe(true);
    const pid = session.servicePid;
    const second = await session.select({ compositionId: 'one', props: { text: 'second' } });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Selection failed');
    expect(first.value.instance).not.toBe(second.value.instance);
    expect(session.servicePid).toBe(pid);
    expect((await session.select({ compositionId: 'two' })).ok).toBe(true);
    const workspace = session.workspace;
    expect(existsSync(workspace)).toBe(true);
    expect(await session.dispose()).toEqual({ ok: true, value: undefined });
    expect(existsSync(workspace)).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    expect(() => process.kill(session.browserPid, 0)).toThrow('ESRCH');
    expect(session.browserConnected()).toBe(false);
    await expect(fetch(session.url)).rejects.toThrow('fetch failed');
  }, 60_000);

  it('keeps independent invocations separate while retaining each service across selections', async () => {
    const root = fixture();
    const [first, second] = await Promise.all([open(root), open(root)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error('Loading failed');
    expect(first.value.servicePid).not.toBe(second.value.servicePid);
    expect(first.value.browserPid).not.toBe(second.value.browserPid);
    await first.value.dispose();
    expect((await second.value.select({ compositionId: 'one' })).ok).toBe(true);
    expect((await second.value.select({ compositionId: 'two' })).ok).toBe(true);
  });

  it.each(['absent', '8'])(
    'intercepts config bundling and external ESM/CJS Vite imports with project Vite %s',
    async (major) => {
      const root = fixture(`import {defineConfig,version} from 'vite';
import './helper.ts';
import esm from 'probe-esm'; import cjs from 'probe-cjs';
if(version !== '7.3.7' || esm !== version || cjs !== version) throw new Error('wrong Vite');
export default defineConfig({});`);
      writeFileSync(join(root, 'helper.ts'), 'export {};');
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'user-project',
          type: 'module',
          ...(major === '8' ? { dependencies: { vite: '^8.0.0' } } : {}),
        }),
      );
      for (const kind of ['esm', 'cjs']) {
        const directory = join(root, `node_modules/probe-${kind}`);
        mkdirSync(directory);
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            name: `probe-${kind}`,
            type: kind === 'esm' ? 'module' : 'commonjs',
            main: 'index.js',
          }),
        );
        writeFileSync(
          join(directory, 'index.js'),
          kind === 'esm'
            ? `import {version} from 'vite'; import {ModuleRunner} from 'vite/module-runner'; if(typeof ModuleRunner!=='function')throw new Error('public subpath'); export default version;`
            : `if(require('vite/package.json').version!=='7.3.7')throw new Error('package subpath');module.exports = require('vite').version;`,
        );
      }
      if (major === '8') {
        mkdirSync(join(root, 'node_modules/vite'));
        writeFileSync(
          join(root, 'node_modules/vite/package.json'),
          '{"name":"vite","version":"8.0.0","type":"module","main":"index.js"}',
        );
        writeFileSync(
          join(root, 'node_modules/vite/index.js'),
          `throw new Error('project Vite must never execute');`,
        );
      }
      expect(await open(root)).toMatchObject({ ok: true });
    },
    30_000,
  );

  it.each([
    ['build', `export default {build:{minify:true}}`, 'build'],
    [
      'plugin hook',
      `export default {plugins:[{name:'broken-config-plugin',config(){throw new Error('secret stack')}}]}`,
      'broken-config-plugin',
    ],
    [
      'unsupported Vite subpath',
      `import 'vite/private-api'; export default {}`,
      'vite/private-api',
    ],
    ['nested key', `export default {css:{futureOption:true}}`, 'css.futureOption'],
    [
      'nested optimizer option',
      `export default {optimizeDeps:{esbuildOptions:{futureOption:true}}}`,
      'optimizeDeps.esbuildOptions',
    ],
    ...['client', 'ssr'].flatMap((environment) =>
      ['return', 'mutate'].map((operation) => [
        `configEnvironment ${environment} ${operation} optimizer option`,
        `export default {plugins:[{name:'environment-optimizer',enforce:'${operation === 'return' ? 'post' : 'pre'}',configEnvironment:{order:'${operation === 'return' ? 'post' : 'pre'}',handler(name,c){if(name===${JSON.stringify(environment)})${operation === 'return' ? `return {optimizeDeps:{esbuildOptions:{outdir:'ignored'}}}` : `c.optimizeDeps={...c.optimizeDeps,esbuildOptions:{outdir:'ignored'}}`};}}}]}`,
        'optimizeDeps.esbuildOptions',
      ]),
    ),
    ...['client', 'ssr'].map((environment) => [
      `configEnvironment ${environment} unsupported plugin list`,
      `export default {plugins:[{name:'environment-plugins',configEnvironment(name){if(name===${JSON.stringify(environment)})return {plugins:[]};}}]}`,
      'plugins',
    ]),
    [
      'late optimizer option',
      `export default {plugins:[{name:'late-key',configResolved(c){c.optimizeDeps.esbuildOptions={outdir:'ignored'};}}]}`,
      'optimizeDeps.esbuildOptions',
    ],
    ...[
      ['late nested key', `c.css.futureOption=true`, 'css.futureOption'],
      ['late build option', `c.build.outDir='ignored'`, 'build'],
      ['late server option', `c.server.fs.futureOption=true`, 'server.fs.futureOption'],
      [
        'late client optimizer option',
        `c.environments.client.optimizeDeps={...c.environments.client.optimizeDeps,esbuildOptions:{outdir:'ignored'}}`,
        'environments.client.optimizeDeps.esbuildOptions',
      ],
      [
        'late in-place optimizer option',
        `c.optimizeDeps.esbuildOptions.outdir='ignored'`,
        'optimizeDeps.esbuildOptions',
      ],
      [
        'late client resolve option',
        `c.environments.client.resolve.futureOption=true`,
        'environments.client.resolve.futureOption',
      ],
      [
        'late client server option',
        `c.environments.client.server={ws:true}`,
        'environments.client.server',
      ],
      [
        'late SSR optimizer option',
        `c.environments.ssr.optimizeDeps={...c.environments.ssr.optimizeDeps,esbuildOptions:{outdir:'ignored'}}`,
        'environments.ssr.optimizeDeps.esbuildOptions',
      ],
      ['late extra environment', `c.environments.extra={}`, 'environments'],
    ].map(([name, mutation, key]) => [
      name,
      `export default {plugins:[{name:'late-key',configResolved(c){${mutation};}}]}`,
      key,
    ]),
    [
      'deferred plugin hook',
      `export default {plugins:[{name:'post-configure-r',configureServer(){return ()=>{throw new Error('boom');};}}]}`,
      'post-configure-r',
    ],
    [
      'async deferred plugin hook',
      `export default {plugins:[{name:'async-post-configure-r',async configureServer(){return async ()=>{throw new Error('boom');};}}]}`,
      'async-post-configure-r',
    ],
    [
      'plugin-added key',
      `export default {plugins:[{name:'bad-key',config(){return {build:{minify:true}}}}]}`,
      'build',
    ],
    [
      'reserved alias',
      `export default {resolve:{alias:{'@kimuson/motion-kit/browser':'./fake.ts'}}}`,
      'resolve.alias:@kimuson/motion-kit/browser',
    ],
    ['preprocessor', `export default {css:{preprocessorOptions:{scss:{}}}}`, 'sass'],
  ])('rejects %s with the exact named Diagnostic', async (_case, config, name) => {
    const root = fixture(config);
    expect(await open(root)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: `Loading configuration rejected "${name}".`,
        hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
      },
    });
  });

  it('loads CommonJS config through bundled Vite and reports the discovered config location on early failure', async () => {
    const root = fixture();
    writeFileSync(
      join(root, 'vite.config.cjs'),
      `const {defineConfig,version}=require('vite');if(version!=='7.3.7')throw new Error('wrong Vite');module.exports=defineConfig({});`,
    );
    expect(await open(root)).toMatchObject({ ok: true });
    const bad = fixture();
    writeFileSync(join(bad, 'vite.config.mjs'), `import 'vite/private-api';export default {};`);
    expect(await open(bad)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading configuration rejected "vite/private-api".',
        hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(bad, 'vite.config.mjs')}.`,
      },
    });
  });

  it('rejects a detected absolute-path second Vite before its code executes', async () => {
    const root = fixture();
    mkdirSync(join(root, 'node_modules/vite'));
    writeFileSync(
      join(root, 'node_modules/vite/package.json'),
      '{"name":"vite","version":"8.0.0","type":"module"}',
    );
    const bypass = join(root, 'node_modules/vite/index.js');
    writeFileSync(bypass, `throw new Error('second Vite');`);
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import ${JSON.stringify(bypass)};export default {};`,
    );
    expect(await open(root)).toEqual({
      ok: false,
      error: {
        code: 'render.page-error',
        severity: 'error',
        message: 'Loading configuration rejected "vite@8.0.0".',
        hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
      },
    });
  });

  it.each(['peerDependencies', 'dependencies', 'optionalDependencies'])(
    'rejects a Vite 8-only plugin bound through %s by package name',
    async (binding) => {
      const root = fixture(
        `import react from '@vitejs/plugin-react'; export default {plugins:[react()]};`,
      );
      const directory = join(root, 'node_modules/@vitejs/plugin-react');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          name: '@vitejs/plugin-react',
          version: '6.0.0',
          type: 'module',
          main: 'index.js',
          [binding]: { vite: '^8.0.0' },
        }),
      );
      writeFileSync(
        join(directory, 'index.js'),
        `export default () => ({name:'vite:react-babel'});`,
      );
      expect(await open(root)).toEqual({
        ok: false,
        error: {
          code: 'render.page-error',
          severity: 'error',
          message: 'Loading configuration rejected "@vitejs/plugin-react".',
          hint: `Use a Vite 7.3.7-compatible plugin, serve setting or installed preprocessor; check ${join(root, 'vite.config.ts')}.`,
        },
      });
    },
  );

  it('cancels startup without a Diagnostic and tears down the blocked service', async () => {
    const root = fixture(`export default {plugins:[{name:'blocked',config(){while(true){}}}]};`);
    const controller = new AbortController();
    const pending = openLoadingSession({
      projectRoot: root,
      entry: 'entry.tsx',
      signal: controller.signal,
    });
    const timer = setTimeout(() => controller.abort(), 400);
    try {
      expect(await pending).toEqual({ ok: false, aborted: true });
    } finally {
      clearTimeout(timer);
    }
  });

  it('bounds a synchronously blocked plugin and removes its service process/workspace', async () => {
    const root = fixture();
    const record = join(root, 'blocked.json');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import {writeFileSync} from 'node:fs'; export default {plugins:[{name:'blocked-plugin',config(){writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,workspace:JSON.parse(process.argv[2]).workspace}));while(true){}}}]};`,
    );
    const started = process.hrtime.bigint();
    const result = await open(root, 1500);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'render.page-error', message: 'Loading startup timed out.' },
    });
    const recordValue: unknown = JSON.parse(readFileSync(record, 'utf8'));
    if (
      typeof recordValue !== 'object' ||
      recordValue === null ||
      !('pid' in recordValue) ||
      typeof recordValue.pid !== 'number' ||
      !('workspace' in recordValue) ||
      typeof recordValue.workspace !== 'string'
    )
      throw new Error('Missing blocked-plugin record');
    const pid = recordValue.pid;
    expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    expect(existsSync(recordValue.workspace)).toBe(false);
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(5000);
  }, 10_000);
});
