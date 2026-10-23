import { Suspense, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BufferGeometry,
  CanvasTexture,
  Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createRegistry } from './registry.ts';

export type Kind = 'font' | 'image' | 'gltf' | 'texture';
export type Mode = 'immediate' | 'delayed' | 'fail' | 'stalled';
let serial = 0;
export const mountFixture = (
  kind: Kind,
  mode: Mode,
  suspense = false,
  imageSignal: 'decode' | 'onload' = 'decode',
) => {
  const id = `asset-${++serial}`;
  const url = `/spike-assets?kind=${kind}&mode=${mode}&id=${id}`;
  const sourceUrl = `/spike-assets?kind=image&mode=${mode === 'fail' ? 'fail' : 'immediate'}&id=source-${id}`;
  const asset = kind === 'texture' ? `${kind}:${url};source=${sourceUrl}` : `${kind}:${url}`;
  const sourceReady = Promise.withResolvers<void>();
  if (kind !== 'texture') sourceReady.resolve();
  const host = document.createElement('div');
  host.style.cssText =
    'width:320px;height:180px;background:#fff;color:#000;position:relative;overflow:hidden;';
  document.body.append(host);
  const root = createRoot(host);
  const registry = createRegistry();
  const events: string[] = [];
  let ready = false;
  let frame = 0;
  let committed = -1;
  let disposed = false;
  const visual = document.createElement('div');
  visual.style.cssText = 'width:256px;height:160px;position:absolute;left:0;top:0;';
  const image = new Image(128, 128);
  const face = new FontFace('SpikeAbel', `url("${url}")`, { display: 'swap' });
  let renderer: WebGLRenderer | undefined;
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Missing canvas 2D');
  context.fillStyle = '#08f';
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  let uploads = 0;
  texture.onUpdate = () => {
    uploads++;
    events.push('texture.onUpdate');
  };
  const render = () => {
    if (renderer === undefined) return;
    const gl = renderer.getContext();
    if (gl.isContextLost()) throw new Error(`WebGL context lost: ${asset}`);
    renderer.render(scene, camera);
    gl.finish();
  };
  if (kind === 'gltf' || kind === 'texture') {
    renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(160, 160);
    renderer.setPixelRatio(1);
    renderer.setClearColor('#222222');
    renderer.setAnimationLoop(null);
    visual.append(renderer.domElement);
    if (kind === 'texture') {
      scene.add(new Mesh(new PlaneGeometry(1.5, 1.5), new MeshBasicMaterial({ map: texture })));
      render(); // Blue pixels are actually uploaded before changing the CPU canvas.
    } else render();
  } else if (kind === 'font') {
    visual.style.font = '48px SpikeAbel, monospace';
    visual.textContent = 'ASSET 123';
    document.fonts.add(face);
  } else visual.append(image);

  const load = async () => {
    if (kind === 'font') {
      await face.load();
      events.push(`FontFace:${face.status}`);
      await document.fonts.ready;
      if (!document.fonts.check('48px SpikeAbel', 'ASSET 123'))
        throw new Error('Required font unavailable');
      events.push('document.fonts.ready');
    } else if (kind === 'image') {
      const loaded = Promise.withResolvers<boolean>();
      image.onload = () => {
        events.push('image.onload');
        loaded.resolve(true);
      };
      image.onerror = () => {
        events.push('image.onerror');
        loaded.resolve(false);
      };
      image.src = url;
      if (imageSignal === 'decode') {
        await image.decode();
        events.push('image.decode');
      } else if (!(await loaded.promise)) throw new Error(`image.onerror: ${url}`);
    } else if (kind === 'gltf') {
      const model = await new GLTFLoader().loadAsync(url);
      events.push('GLTFLoader.loadAsync');
      scene.add(model.scene);
    } else {
      image.src = sourceUrl;
      await image.decode();
      context.drawImage(image, 0, 0);
      events.push('cpu-canvas-ready');
      sourceReady.resolve();
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      await response.text();
      if (renderer?.getContext().isContextLost() === true)
        throw new Error(`WebGL context lost before upload: ${asset}`);
      const before = uploads;
      texture.needsUpdate = true;
      renderer?.initTexture(texture);
      if (uploads <= before) throw new Error(`No texture upload acknowledgement: ${asset}`);
      events.push('upload-submitted');
    }
    if (!disposed) ready = true;
  };
  const work = registry.register(asset, load());
  void work.then(() => sourceReady.resolve());
  const Content = () => {
    if (suspense && !ready && registry.pending().length > 0) throw work;
    useLayoutEffect(() => {
      const slot = host.querySelector('[data-slot]');
      slot?.append(visual);
      committed = frame;
    });
    return <div data-slot="visual" />;
  };
  const commit = () => {
    flushSync(() =>
      root.render(
        <Suspense fallback={<div data-fallback="true">Loading asset</div>}>
          <Content />
        </Suspense>,
      ),
    );
    host.dataset['frame'] = String(frame);
    visual.style.transform = `translateX(${frame * 12}px)`;
  };
  commit();
  let released = false;
  const release = async () => {
    if (released || (mode !== 'delayed' && mode !== 'stalled')) return;
    released = true;
    await fetch(`/spike-assets?id=${id}&release=1`);
  };
  const seek = async (nextFrame: number, timeoutMs = 5000) => {
    const result = await registry.awaitReady(timeoutMs);
    if (!result.ok) return result;
    frame = nextFrame;
    commit();
    if (committed !== frame) throw new Error('React commit not acknowledged');
    render();
    return result;
  };
  const gl = renderer?.getContext();
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const backend: unknown =
    debug === undefined || debug === null
      ? undefined
      : gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  return {
    environment: {
      userAgent: navigator.userAgent,
      renderer: typeof backend === 'string' ? backend : null,
    },
    host,
    asset,
    events,
    registry,
    release,
    seek,
    sourceReady: sourceReady.promise,
    loseContext: () => renderer?.forceContextLoss(),
    pending: () => !ready,
    fallback: () => host.querySelector('[data-fallback]') !== null,
    measure: () => ({
      fontStatus: face.status,
      imageComplete: image.complete,
      imageWidth: image.naturalWidth,
      uploads,
      committed,
    }),
    dom: () => {
      const clone = host.cloneNode(true);
      if (!(clone instanceof HTMLElement)) throw new Error('Invalid clone');
      clone.querySelector('img')?.setAttribute('src', 'fixture:image');
      return clone.outerHTML;
    },
    dispose: async () => {
      disposed = true;
      await release();
      await work;
      flushSync(() => root.unmount());
      document.fonts.delete(face);
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          if (object.geometry instanceof BufferGeometry) object.geometry.dispose();
          const materials: unknown[] = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) if (material instanceof Material) material.dispose();
        }
      });
      texture.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      host.remove();
    },
  };
};
