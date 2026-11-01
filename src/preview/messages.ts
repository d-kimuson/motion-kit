import { createContext, use } from 'react';

import { type Locale } from './locale.ts';

/**
 * The text of the preview page in English, the shape every other language follows. What the page
 * hands to a coding agent (the review Markdown) and the diagnostics stay English.
 */
const en = {
  page: {
    loading: 'Loading…',
    loadFailed: 'The Composition could not be loaded',
    choose: 'Choose a Composition',
    summary: (width: number, height: number, frames: number) =>
      `${width}×${height}, ${frames} frames`,
    stage: 'Composition',
    picking: 'Click an element to comment on it · Esc to stop',
    language: 'Language',
  },
  transport: {
    previousHint: 'Previous frame (←, Shift+← for 10)',
    previous: 'Previous frame',
    playHint: 'Play / pause (Space)',
    play: 'Play',
    pause: 'Pause',
    nextHint: 'Next frame (→, Shift+→ for 10)',
    next: 'Next frame',
    playhead: 'Playhead',
    frame: (frame: number, last: number) => `frame ${frame} / ${last}`,
    lagging: 'The realm is still rendering the playhead',
    showing: (frame: number) => `showing ${frame}`,
    commentHint: 'Comment mode: pause and click the stage (C)',
    commentMode: 'Comment mode',
    comment: 'Comment',
  },
  timeline: {
    comments: 'Comments',
    sequences: 'Sequences',
    audio: 'Audio',
    assets: 'Assets',
    failed: ', failed to load',
  },
  tabs: {
    info: 'Info',
    sequences: 'Sequences',
    assets: 'Assets',
    elements: 'Elements',
    comments: 'Comments',
  },
  info: {
    composition: 'Composition',
    size: 'Size',
    frameRate: 'Frame rate',
    duration: 'Duration',
    frames: (count: number) => (count === 1 ? '1 frame' : `${count} frames`),
    sequences: 'Named Sequences',
    audio: 'Audio clips',
    assets: 'Fonts and images',
  },
  sequences: {
    none: 'No named Sequence has been mounted yet. Name one with `name`.',
  },
  assets: {
    registered: 'Fonts and images',
    audio: 'Audio',
    noAudio: 'This Composition declares no audio.',
    mute: (src: string) => `Mute ${src}`,
    unmute: (src: string) => `Unmute ${src}`,
    clips: (count: number) => `${count} clips`,
    unplayable: 'unplayable',
    unplayableHint: 'Could not be fetched or decoded',
    none: 'No frame shown so far has registered a font or image with `useAsset`.',
    failed: 'failed',
    pending: 'loading',
    seek: 'Seek to the frame it was first seen at',
    dataUrl: 'data: URL',
  },
  elements: {
    collapse: 'Collapse',
    expand: 'Expand',
    commentOn: (selector: string) => `Comment on ${selector}`,
    commentHint: 'Comment on this element',
    playing: 'Pause to see the elements of the shown frame.',
    loading: 'Loading…',
    none: 'The shown frame has no elements.',
    truncated: 'Only the first elements are listed; the frame has more.',
  },
  comments: {
    wholeFrame: 'Whole frame',
    point: (x: number, y: number) => `Point (${x}, ${y})`,
    field: 'Comment',
    placeholder: 'What should change here?',
    rangeHint: 'Seek to another frame first; the comment then covers every frame in between.',
    oneFrame: 'One frame',
    rangeTo: (time: string) => `Range to ${time}`,
    cancel: 'Cancel',
    save: 'Save',
    copied: 'Copied',
    copy: 'Copy Markdown',
    markdown: 'Review Markdown',
    clear: 'Clear',
    confirmClear: 'Clear them all?',
    guide:
      'Turn on comment mode (C) and click the stage to comment on an element, or comment on the whole frame at the playhead.',
    commentFrame: 'Comment on this frame',
    remove: (index: number) => `Delete comment ${index}`,
    empty: '(no text)',
  },
};

export type Messages = typeof en;

const ja: Messages = {
  page: {
    loading: '読み込み中…',
    loadFailed: 'Composition を読み込めませんでした',
    choose: 'Composition を選択',
    summary: (width, height, frames) => `${width}×${height}、${frames} フレーム`,
    stage: 'Composition',
    picking: '要素をクリックしてコメント · Esc で終了',
    language: '言語',
  },
  transport: {
    previousHint: '前のフレーム（←、Shift+← で 10 フレーム）',
    previous: '前のフレーム',
    playHint: '再生 / 一時停止（Space）',
    play: '再生',
    pause: '一時停止',
    nextHint: '次のフレーム（→、Shift+→ で 10 フレーム）',
    next: '次のフレーム',
    playhead: '再生位置',
    frame: (frame, last) => `フレーム ${frame} / ${last}`,
    lagging: 'realm がまだ再生位置のフレームを描画しています',
    showing: (frame) => `表示中 ${frame}`,
    commentHint: 'コメントモード：一時停止してステージをクリック（C）',
    commentMode: 'コメントモード',
    comment: 'コメント',
  },
  timeline: {
    comments: 'コメント',
    sequences: 'Sequence',
    audio: '音声',
    assets: 'アセット',
    failed: '、読み込みに失敗',
  },
  tabs: {
    info: '情報',
    sequences: 'Sequence',
    assets: 'アセット',
    elements: '要素',
    comments: 'コメント',
  },
  info: {
    composition: 'Composition',
    size: 'サイズ',
    frameRate: 'フレームレート',
    duration: '長さ',
    frames: (count) => `${count} フレーム`,
    sequences: '名前付き Sequence',
    audio: '音声クリップ',
    assets: 'フォントと画像',
  },
  sequences: {
    none: '名前付きの Sequence はまだマウントされていません。`name` で名前を付けてください。',
  },
  assets: {
    registered: 'フォントと画像',
    audio: '音声',
    noAudio: 'この Composition は音声を宣言していません。',
    mute: (src) => `${src} をミュート`,
    unmute: (src) => `${src} のミュートを解除`,
    clips: (count) => `${count} クリップ`,
    unplayable: '再生不可',
    unplayableHint: '取得またはデコードできませんでした',
    none: 'これまでに表示したフレームは `useAsset` でフォントや画像を登録していません。',
    failed: '失敗',
    pending: '読み込み中',
    seek: '最初に現れたフレームへ移動',
    dataUrl: 'data: URL',
  },
  elements: {
    collapse: '折りたたむ',
    expand: '展開',
    commentOn: (selector) => `${selector} にコメント`,
    commentHint: 'この要素にコメント',
    playing: '一時停止すると、表示中のフレームの要素が表示されます。',
    loading: '読み込み中…',
    none: '表示中のフレームに要素はありません。',
    truncated: '先頭の要素だけを表示しています。フレームにはさらに要素があります。',
  },
  comments: {
    wholeFrame: 'フレーム全体',
    point: (x, y) => `点 (${x}, ${y})`,
    field: 'コメント',
    placeholder: 'ここをどう変えたいですか？',
    rangeHint: '先に別のフレームへ移動すると、その間のすべてのフレームが対象になります。',
    oneFrame: '1 フレーム',
    rangeTo: (time) => `${time} までの範囲`,
    cancel: 'キャンセル',
    save: '保存',
    copied: 'コピーしました',
    copy: 'Markdown をコピー',
    markdown: 'レビュー Markdown',
    clear: 'クリア',
    confirmClear: 'すべて削除しますか？',
    guide:
      'コメントモード（C）をオンにしてステージをクリックすると要素にコメントできます。再生位置のフレーム全体にもコメントできます。',
    commentFrame: 'このフレームにコメント',
    remove: (index) => `コメント ${index} を削除`,
    empty: '（本文なし）',
  },
};

export const messages: Readonly<Record<Locale, Messages>> = { en, ja };

/** The text in the page's language; outside a provider, English. */
export const MessagesContext = createContext<Messages>(en);

export const useMessages = (): Messages => use(MessagesContext);
