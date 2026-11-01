import { ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  type ElementNode,
  type ElementTree,
  type InspectedElement,
} from '../lib/preview-protocol.ts';
import { type Result } from '../lib/result.ts';
import { type Review } from './comments-panel.tsx';
import { relativeSource } from './comments.ts';
import { type PreviewController, type PreviewState } from './controller.ts';
import { basename } from './timeline.tsx';
import { cn } from './ui/utils.ts';

export type ElementBox = InspectedElement['box'];

/** Nodes this many levels deep start collapsed. */
const openDepth = 3;

/** `src/title.tsx:3:7` as `title.tsx:3`. */
const shortSource = (source: string) => {
  const match = /^(.*):(\d+):\d+$/.exec(source);
  return match === null ? basename(source) : `${basename(match[1] ?? '')}:${match[2]}`;
};

const element = ({ selector, text, source, box }: ElementNode): InspectedElement => ({
  selector,
  text,
  source,
  box,
});

type Rows = Readonly<{
  review: Review;
  toggled: ReadonlySet<string>;
  toggle: (key: string) => void;
  onHighlight: (box: ElementBox | undefined) => void;
}>;

const Node = ({ node, path, rows }: { node: ElementNode; path: string; rows: Rows }) => {
  const depth = path.split('.').length - 1;
  const open = depth < openDepth !== rows.toggled.has(path);
  const leaf = node.children.length === 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <div
        data-slot="element"
        data-hidden={node.visible ? undefined : ''}
        className={cn(
          'group flex items-center gap-1 rounded-md py-0.5 pr-1 text-xs hover:bg-muted',
          !node.visible && 'opacity-50',
        )}
        style={{ paddingLeft: `${depth * 0.75}rem` }}
        onPointerEnter={() => rows.onHighlight(node.box)}
        onPointerLeave={() => rows.onHighlight(undefined)}
      >
        {leaf ? (
          <span className="size-4 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={open ? 'Collapse' : 'Expand'}
            className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => rows.toggle(path)}
          >
            <Chevron className="size-3.5" />
          </button>
        )}
        {/* A class-heavy selector is cut, so the source and the button stay in the row. */}
        <span className="min-w-0 truncate font-mono" title={node.selector}>
          {node.selector}
        </span>
        {leaf && node.text !== '' ? (
          <span className="min-w-0 flex-1 basis-0 truncate text-muted-foreground">{node.text}</span>
        ) : undefined}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {node.source === null ? undefined : (
            <span
              className="font-mono text-[11px] text-muted-foreground"
              title={relativeSource(node.source, rows.review.site)}
            >
              {shortSource(node.source)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Comment on ${node.selector}`}
            title="Comment on this element"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-comment focus-visible:opacity-100"
            onClick={() => rows.review.controller.commentElement(element(node))}
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
        </span>
      </div>
      {open && !leaf ? <Nodes nodes={node.children} path={path} rows={rows} /> : undefined}
    </li>
  );
};

const Nodes = ({
  nodes,
  path,
  rows,
}: {
  nodes: readonly ElementNode[];
  path: string | undefined;
  rows: Rows;
}) => (
  <ul className="grid grid-cols-1">
    {nodes.map((node, index) => {
      // Elements have no identity across frames; their place in the tree is the closest to one.
      const key = path === undefined ? `${index}` : `${path}.${index}`;
      return <Node key={key} node={node} path={key} rows={rows} />;
    })}
  </ul>
);

const Note = ({ children }: { children: string }) => (
  <p className="px-1 py-6 text-center text-xs text-muted-foreground">{children}</p>
);

/**
 * The elements of the shown frame, asked for again whenever a paused frame is shown: hovering one
 * outlines it on the stage, and its button drafts a comment on it.
 */
export const ElementsPanel = ({
  state,
  controller,
  review,
  onHighlight,
}: {
  state: PreviewState;
  controller: PreviewController;
  review: Review;
  onHighlight: (box: ElementBox | undefined) => void;
}) => {
  const playing = state.playback.kind === 'playing' || state.starting;
  const { shown } = state;
  const [tree, setTree] = useState<Result<ElementTree | null>>();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (playing) return;
    let current = true;
    void controller.describe().then((result) => {
      if (current) setTree(result);
    });
    return () => {
      current = false;
    };
  }, [controller, playing, shown]);
  // A highlight outlives neither the panel nor the tree it came from.
  useEffect(() => () => onHighlight(undefined), [onHighlight, tree, playing]);
  if (playing) return <Note>Pause to see the elements of the shown frame.</Note>;
  if (tree === undefined) return <Note>Loading…</Note>;
  if (!tree.ok) return <Note>{tree.error.message}</Note>;
  if (tree.value === null || tree.value.nodes.length === 0)
    return <Note>The shown frame has no elements.</Note>;
  const rows: Rows = {
    review,
    toggled,
    toggle: (key) =>
      setToggled((keys) => {
        const next = new Set(keys);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    onHighlight,
  };
  return (
    <div className="grid gap-2">
      <Nodes nodes={tree.value.nodes} path={undefined} rows={rows} />
      {tree.value.truncated ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Only the first elements are listed; the frame has more.
        </p>
      ) : undefined}
    </div>
  );
};
