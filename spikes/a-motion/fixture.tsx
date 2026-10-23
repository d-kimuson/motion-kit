import {
  animate,
  frame,
  motionValue,
  spring,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'motion';
import { AnimatePresence, motion, useSpring } from 'motion/react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export const controlledFeatures = [
  'external-value',
  'react-style',
  'animate-value',
  'animate-dom',
  'animate-spring',
  'sampled-spring',
] as const;
export type ControlledFeature = (typeof controlledFeatures)[number];
export type UncontrolledFeature = 'presence' | 'layout' | 'use-spring' | 'autonomous';
type Feature = ControlledFeature | UncontrolledFeature;

// A render-queue acknowledgement, not an elapsed-time sleep. Assets here are solid CSS only.
export const afterMotionRender = (): Promise<void> =>
  new Promise((resolve) => {
    frame.postRender(() => resolve());
  });

const box = { width: 40, height: 40, backgroundColor: '#3060c0' };
const springOptions = { stiffness: 120, damping: 14, mass: 1, velocity: 0 };

const UncontrolledSpring = ({ source }: { source: MotionValue<number> }) => {
  const x = useSpring(source, { stiffness: 10, damping: 2 });
  return <motion.div data-box="" style={{ ...box, x }} />;
};

export const mountFixture = async (feature: Feature, initialTime = 0) => {
  const host = document.createElement('div');
  Object.assign(host.style, {
    width: '300px',
    height: '80px',
    backgroundColor: '#fff',
    overflow: 'hidden',
    position: 'relative',
  });
  document.body.append(host);
  const root = createRoot(host);
  const value = motionValue(feature === 'use-spring' && initialTime >= 0.5 ? 160 : 0);
  let controls: AnimationPlaybackControls | undefined;
  const render = (time: number) => {
    const target = time < 0.5 ? 0 : 160;
    switch (feature) {
      case 'presence':
        return (
          <AnimatePresence initial={false}>
            {time < 0.5 && (
              <motion.div
                key="box"
                data-box=""
                style={box}
                exit={{ x: 160 }}
                transition={{ duration: 100, ease: 'linear' }}
              />
            )}
          </AnimatePresence>
        );
      case 'layout':
        return (
          <motion.div
            data-box=""
            layout
            style={{ ...box, marginLeft: target }}
            transition={{ duration: 100, ease: 'linear' }}
          />
        );
      case 'use-spring':
        return <UncontrolledSpring source={value} />;
      case 'autonomous':
        return (
          <motion.div
            data-box=""
            style={box}
            initial={false}
            animate={{ x: target }}
            transition={{ duration: 100, ease: 'linear' }}
          />
        );
      case 'react-style':
        return <motion.div data-box="" style={{ ...box, x: Math.min(time, 1) * 160 }} />;
      case 'animate-dom':
        return <div data-box="" style={{ ...box, opacity: 0 }} />;
      case 'external-value':
      case 'animate-value':
      case 'animate-spring':
      case 'sampled-spring':
        return <motion.div data-box="" style={{ ...box, x: value }} />;
      default:
        throw new Error(`Unknown feature: ${String(feature)}`);
    }
  };
  flushSync(() => root.render(render(initialTime)));
  await afterMotionRender();
  const element = host.querySelector<HTMLElement>('[data-box]');
  if (feature === 'animate-dom') {
    if (element === null) throw new Error('Missing DOM animation target');
    controls = animate(
      element,
      { opacity: [0, 1] },
      { duration: 1, ease: 'linear', autoplay: false },
    );
  } else if (feature === 'animate-value' || feature === 'animate-spring') {
    controls = animate(
      value,
      [0, 160],
      feature === 'animate-spring'
        ? { type: 'spring', ...springOptions, autoplay: false }
        : { duration: 1, ease: 'linear', autoplay: false },
    );
  }
  // Keyframe resolution can enqueue work before the first seek.
  await afterMotionRender();
  const inspect = () =>
    [...host.querySelectorAll<HTMLElement>('[data-box]')].map((node) => {
      const style = getComputedStyle(node);
      return {
        transform: style.transform,
        opacity: style.opacity,
        left: node.getBoundingClientRect().left - host.getBoundingClientRect().left,
      };
    });
  return {
    host,
    inspect,
    seek: async (time: number) => {
      if (feature === 'use-spring') value.set(time < 0.5 ? 0 : 160);
      else if (feature === 'external-value') value.set(Math.min(time, 1) * 160);
      else if (feature === 'sampled-spring') {
        // Fresh evaluator avoids treating a mutable generator as a Pure Motion contract.
        value.set(spring({ keyframes: [0, 160], ...springOptions }).next(time * 1000).value);
      } else if (controls !== undefined) {
        controls.pause();
        controls.time = time;
      } else flushSync(() => root.render(render(time)));
      const immediate = inspect();
      await afterMotionRender();
      return { immediate, settled: inspect(), value: value.get() };
    },
    dispose: () => {
      controls?.stop();
      flushSync(() => root.unmount());
      value.destroy();
      host.remove();
    },
  };
};
