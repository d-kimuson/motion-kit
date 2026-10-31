import { mismatches, mount, pixelsOf, type Mounted, type MountOptions } from './harness.tsx';

export type BClaim = Readonly<{
  /** The Composition's content. The sequential and shuffled/repeated passes share their mount; the
   * fresh-mount pass opens one mount per claimed frame. */
  scene: MountOptions['scene'];
  /** The frames whose pixels must be reproduced. At least two, and they must render differently. */
  frames: readonly number[];
  /** Size and length overrides; `mount`'s defaults apply. */
  mount?: Omit<MountOptions, 'scene' | 'initialSize'>;
}>;

/** One mount the fresh pass opened, and every render it ran before the capture. */
export type FreshMount = Readonly<{
  /** The claimed frame this mount was opened for; its capture is compared with that frame's pixels. */
  frame: number;
  /** The frame of every render this mount ran, in order. A pass that renders each claimed frame as
   * the first and only render of its own mount reports exactly `[frame]`. */
  rendered: readonly number[];
}>;

/** What the fresh-mount pass did: the mounts it opened, and the pixels each one differed by. */
export type FreshPass = Readonly<{
  /** One entry per mount the pass opened, in the order it opened them. */
  mounts: readonly FreshMount[];
  /** Byte differences against the reference, in `frames` order. */
  mismatches: readonly number[];
}>;

/** What the sequential, shuffled/repeated and fresh-mount passes measured. */
export type OrderCheck = Readonly<{
  /** Pixels of every claimed frame, captured in sequential order by the first mount. */
  reference: ReadonlyMap<number, Uint8Array>;
  /** Byte differences when the claimed frames are replayed backwards and repeated on that mount. */
  shuffledMismatches: readonly number[];
  /** The fresh-mount pass: one mount is opened per claimed frame, so no earlier frame of that mount
   * can leave state behind. It reports what it did, which is what pins the pass's structure. */
  fresh: FreshPass;
  /** Byte differences between the first and the last claimed frame; zero means nothing moved. */
  referenceDifference: number;
}>;

/** The mounts a correct fresh pass reports for `frames`: one per frame, that frame rendered once.
 * Every Tier B claim compares `OrderCheck['fresh']['mounts']` with this, so a pass that shares one
 * mount between the claimed frames fails a test instead of merely measuring a different pixel. */
export const freshMountsOf = (frames: readonly number[]): FreshMount[] =>
  frames.map((frame) => ({ frame, rendered: [frame] }));

const pixelsAt = async (instance: Mounted, frame: number): Promise<Uint8Array> => {
  const outcome = await instance.settle(frame);
  if (outcome.status !== 'ready') throw new Error(`Frame ${frame} settled as ${outcome.status}.`);
  return pixelsOf(instance.capture);
};

const differences = async (
  instance: Mounted,
  frames: readonly number[],
  reference: ReadonlyMap<number, Uint8Array>,
): Promise<number[]> => {
  const compared: number[] = [];
  for (const frame of frames) {
    const expected = reference.get(frame);
    if (expected === undefined) throw new Error(`No reference for frame ${frame}.`);
    compared.push(mismatches(await pixelsAt(instance, frame), expected));
  }
  return compared;
};

/** Replay order for the shuffled pass: reversed, then the first and the last frame again. */
const replayOrder = (frames: readonly number[]): readonly number[] => {
  const first = frames.at(0);
  const last = frames.at(-1);
  if (first === undefined || last === undefined) throw new Error('A claim needs frames.');
  return [...frames.toReversed(), first, last];
};

/** Measure a Tier B claim: identical pixels across sequential, shuffled/repeated and fresh-mount
 * frame orders. The first pass renders frames 0 to the last claimed frame in order on one mount, the
 * second replays the claimed frames backwards and repeated on that same mount, and the third renders
 * each claimed frame as the first frame of its own fresh mount. It returns the measurements instead
 * of asserting them, so each test states the claim it makes; the fresh pass also reports the mounts
 * it opened and what each rendered, so a test can pin the pass's structure and not only its pixels.
 * Every mount it opens is disposed here, in both the pass and the failure path.
 */
export const orderCheck = async ({
  scene,
  frames,
  mount: options,
}: BClaim): Promise<OrderCheck> => {
  if (frames.length < 2) throw new Error('A Tier B claim needs at least two frames.');
  const open = () => mount({ scene, ...options });
  const claimed = new Set(frames);
  const reference = new Map<number, Uint8Array>();
  const sequential = await open();
  let shuffledMismatches: readonly number[] = [];
  try {
    for (let frame = 0; frame <= Math.max(...frames); frame++) {
      const pixels = await pixelsAt(sequential, frame);
      if (claimed.has(frame)) reference.set(frame, pixels);
    }
    shuffledMismatches = await differences(sequential, replayOrder(frames), reference);
  } finally {
    sequential.dispose();
  }
  const freshMismatches: number[] = [];
  const freshMounts: FreshMount[] = [];
  for (const frame of frames) {
    const expected = reference.get(frame);
    if (expected === undefined) throw new Error(`No reference for frame ${frame}.`);
    const fresh = await open();
    try {
      freshMismatches.push(mismatches(await pixelsAt(fresh, frame), expected));
    } finally {
      freshMounts.push({ frame, rendered: fresh.rendered });
      fresh.dispose();
    }
  }
  const first = reference.get(frames[0] ?? 0) ?? new Uint8Array();
  const last = reference.get(frames.at(-1) ?? 0) ?? new Uint8Array();
  return {
    reference,
    shuffledMismatches,
    fresh: { mounts: freshMounts, mismatches: freshMismatches },
    referenceDifference: mismatches(first, last),
  };
};
