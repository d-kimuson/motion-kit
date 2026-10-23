/* eslint-disable no-restricted-globals, no-restricted-properties -- This non-shipped experiment deliberately measures browser clocks and replaces rAF. */
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export type Mechanism = 'own' | 'raf' | 'cdp';
export type Fault = 'none' | 'skip-css' | 'skip-video' | 'skip-barrier' | 'accumulate';
const epoch = 1_700_000_000_000;
const nativeNow = performance.now.bind(performance);
const nativeDate = Date.now.bind(Date);
const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeCancel = window.cancelAnimationFrame.bind(window);
let time = 0;
let serial = 0;
const queue = new Map<number, FrameRequestCallback>();
const mechanism = new URL(location.href).searchParams.get('mechanism');
if (mechanism !== 'own' && mechanism !== 'raf' && mechanism !== 'cdp')
  throw new Error('Unknown clock mechanism');
if (mechanism !== 'cdp') {
  window.requestAnimationFrame = (callback) => {
    queue.set(++serial, callback);
    return serial;
  };
  window.cancelAnimationFrame = (id) => queue.delete(id);
}
if (mechanism === 'own') {
  performance.now = () => time;
  Date.now = () => epoch + time;
}
let origin = performance.now();
let dateOrigin = Date.now();
const host = document.createElement('main');
host.id = 'scene';
host.innerHTML = `<style>
  body { margin:0; background:white }
  #scene { width:320px; height:240px; background:#fff; overflow:hidden }
  .row { height:30px; position:relative; width:320px }
  .box { width:20px; height:20px; background:#3060c0 }
  @keyframes slide { from { transform:translateX(0px) } to { transform:translateX(200px) } }
  #css { animation:slide 2s linear both }
  #transition { transition:transform 2s linear; transform:translateX(0px) }
  video { width:160px; height:90px; display:block }
</style><div id="react" class="row"></div><div class="row"><div id="css" class="box"></div></div><div class="row"><div id="transition" class="box"></div></div><div class="row"><div id="raf-timestamp" class="box" style="height:10px"></div><div id="raf" class="box" style="height:10px"></div></div><div class="row"><div id="async" class="box"></div></div><video muted preload="auto" src="./sample.webm"></video>`;
document.body.append(host);
const element = (id: string) => {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing ${id}`);
  return node;
};
const video = host.querySelector('video');
if (video === null) throw new Error('Missing video');
const media = video;
const root = createRoot(element('react'));
let setReact: (value: number) => void = () => {
  throw new Error('React not mounted');
};
let committed = -1;
const Scene = () => {
  const [value, setValue] = useState(0);
  setReact = setValue;
  useLayoutEffect(() => {
    committed = value;
  }, [value]);
  return (
    <div className="box" data-time={value} style={{ transform: `translateX(${value / 10}px)` }} />
  );
};
flushSync(() => root.render(<Scene />));
const css = element('css');
const transition = element('transition');
// Force both endpoints to exist so this is a real CSSTransition, not a WAAPI imitation.
if (getComputedStyle(transition).transform !== 'matrix(1, 0, 0, 1, 0, 0)')
  throw new Error('Unexpected transition start');
transition.style.transform = 'translateX(200px)';
if (getComputedStyle(transition).transform === 'none') throw new Error('Missing transition style');
const animations = [css.getAnimations()[0], transition.getAnimations()[0]];
if (animations.some((animation) => animation === undefined))
  throw new Error('Missing CSS animation/transition');
let rafTime = -1;
let rafClock = -1;
let rafCalls = 0;
let accumulated = 0;
let fault: Fault = 'none';
const callback = (timestamp: number) => {
  rafTime = mechanism === 'cdp' ? timestamp - origin : timestamp;
  rafClock = performance.now() - origin;
  rafCalls++;
  element('raf-timestamp').style.transform = `translateX(${rafTime / 10}px)`;
  accumulated += Math.abs(rafClock);
  element('raf').style.transform =
    `translateX(${(fault === 'accumulate' ? accumulated : rafClock) / 10}px)`;
  window.requestAnimationFrame(callback);
};
window.requestAnimationFrame(callback);
let microtask = -1;
let timer = -1;
let pending: Promise<void> = Promise.resolve();
let releasePending = () => {};
const seekVideo = async (milliseconds: number) => {
  const seconds = milliseconds / 1000;
  if (media.currentTime === seconds && !media.seeking) return;
  const ready = new Promise<void>((resolve, reject) => {
    media.addEventListener('seeked', () => resolve(), { once: true });
    media.addEventListener('error', () => reject(new Error('Video seek failed')), { once: true });
  });
  media.currentTime = seconds;
  await ready;
};
const inspect = () => ({
  react: committed,
  now: performance.now() - origin,
  date: Date.now() - dateOrigin,
  rafTime,
  rafClock,
  rafCalls,
  css: animations.map((animation) => Number(animation?.currentTime)),
  transforms: [css, transition].map((node) => getComputedStyle(node).transform),
  video: media.currentTime,
  mediaReady: media.readyState,
  seeking: media.seeking,
  microtask,
  timer,
});
const ready = async () => {
  if (media.readyState < 2)
    await new Promise<void>((resolve, reject) => {
      media.addEventListener('loadeddata', () => resolve(), { once: true });
      media.addEventListener('error', () => reject(new Error('Video load failed')), { once: true });
    });
  await document.fonts.ready;
};
const prepare = (milliseconds: number, adapted: boolean, nextFault: Fault = 'none') => {
  fault = nextFault;
  time = milliseconds;
  flushSync(() => setReact(performance.now() - origin));
  if (mechanism !== 'cdp') {
    const batch = [...queue];
    for (const [id, callback] of batch) {
      if (!queue.delete(id)) continue;
      callback(milliseconds);
    }
  }
  if (adapted && fault !== 'skip-css')
    for (const animation of animations) {
      animation?.pause();
      if (animation !== undefined) animation.currentTime = milliseconds;
    }
  // A tracked microtask -> task -> microtask chain, not a guessed number of Promise.resolve calls.
  microtask = -1;
  timer = -1;
  element('async').style.transform = 'translateX(0px)';
  const gate =
    fault === 'skip-barrier'
      ? new Promise<void>((resolve) => {
          releasePending = resolve;
        })
      : Promise.resolve();
  pending = gate.then(() => {
    microtask = milliseconds;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        queueMicrotask(() => {
          timer = milliseconds;
          element('async').style.transform = `translateX(${milliseconds / 10}px)`;
          resolve();
        });
      }, 5);
    });
  });
  return inspect();
};
const settle = async (milliseconds: number, adapted: boolean) => {
  if (fault !== 'skip-barrier') await pending;
  if (adapted && fault !== 'skip-video') await seekVideo(milliseconds);
  return inspect();
};
const snapshot = () => {
  // Exclude observational wall clocks/callback counts; include actual markup and rendered state.
  const state = inspect();
  return JSON.stringify({
    html: host.outerHTML,
    react: state.react,
    rafClock: state.rafClock,
    css: state.css,
    transforms: state.transforms,
    video: state.video,
    seeking: state.seeking,
    microtask: state.microtask,
    timer: state.timer,
  });
};
window.clockFixture = {
  ready,
  prepare,
  settle,
  inspect,
  snapshot,
  release: async () => {
    releasePending();
    await pending;
  },
  injectReact: (milliseconds: number) => {
    flushSync(() => setReact(milliseconds));
    return committed;
  },
  resetOrigin: () => {
    origin = performance.now();
    dateOrigin = Date.now();
  },
  restore: () => {
    performance.now = nativeNow;
    Date.now = nativeDate;
    window.requestAnimationFrame = nativeRaf;
    window.cancelAnimationFrame = nativeCancel;
  },
};
declare global {
  // eslint-disable-next-line typescript/consistent-type-definitions -- Browser fixture global augmentation.
  interface Window {
    clockFixture: {
      ready: typeof ready;
      prepare: typeof prepare;
      settle: typeof settle;
      inspect: typeof inspect;
      snapshot: typeof snapshot;
      release: () => Promise<void>;
      injectReact: (milliseconds: number) => number;
      resetOrigin: () => void;
      restore: () => void;
    };
  }
}
