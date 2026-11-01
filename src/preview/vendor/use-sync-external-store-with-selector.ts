/**
 * The build aliases `use-sync-external-store/shim/with-selector` to this module (tsdown.config.ts),
 * for the reason in use-sync-external-store-shim.ts. A TypeScript port of
 * use-sync-external-store-shim/with-selector.production.js from use-sync-external-store 1.7.0:
 *
 * MIT License
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/** The selection last committed, which an equal new selection is replaced by. */
type Instance<Selection> =
  | { readonly hasValue: false }
  | { readonly hasValue: true; readonly value: Selection };

export const useSyncExternalStoreWithSelector = <Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection => {
  const instRef = useRef<Instance<Selection>>({ hasValue: false });
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;
    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        const inst = instRef.current;
        if (isEqual !== undefined && inst.hasValue && isEqual(inst.value, nextSelection))
          return (memoizedSelection = inst.value);
        return (memoizedSelection = nextSelection);
      }
      const currentSelection = memoizedSelection;
      if (Object.is(memoizedSnapshot, nextSnapshot)) return currentSelection;
      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }
      memoizedSnapshot = nextSnapshot;
      return (memoizedSelection = nextSelection);
    };
    const maybeGetServerSnapshot = getServerSnapshot ?? null;
    return [
      () => memoizedSelector(getSnapshot()),
      maybeGetServerSnapshot === null
        ? undefined
        : () => memoizedSelector(maybeGetServerSnapshot()),
    ] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);
  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);
  useEffect(() => {
    instRef.current = { hasValue: true, value };
  }, [value]);
  useDebugValue(value);
  return value;
};
