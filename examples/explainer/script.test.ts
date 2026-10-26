// The script's own test: the schema, the reading rate, the content budget and the slide arithmetic.
//
// Every assertion here is written against a literal — 219 s of dialogue, 222 s in total, a 3.6 s
// total of crossfades, a 16 s disclaimer slide — so a change to the rate (`ceil(codePoints / 5)`) or
// to the 0.4 s overlap fails here rather than after a nine-thousand-frame render.
import { describe, expect, it } from 'vitest';

import {
  assertScript,
  codePointLength,
  codePointsPerSecond,
  cueKey,
  disclaimerTailSeconds,
  dialogueSeconds,
  estimateSeconds,
  groupSlides,
  lineStartTimes,
  scriptBudget,
  scriptIssues,
  scriptLineSchema,
  scriptSchema,
  scriptStats,
  seriesSeconds,
  slideOverlapSeconds,
  slideSceneSeconds,
  slideStartsFromSeries,
  slideStartSeconds,
  transitionOverlapSeconds,
  type Script,
  type ScriptLine,
} from './script.schema.ts';
import { lineStarts, script, slideSpans, stats, totalSeconds } from './script.ts';

/** The rate, spelled out again: an independent second opinion on every line's `seconds`. */
const secondsFor = (text: string): number => Math.ceil(Array.from(text).length / 5);

/**
 * A fixture with one generated line per slide, then the script's own disclaimer line: `text` is
 * exactly `seconds × 5` code points, so every line passes the schema's rate check and the only
 * budgets left to fail are the ones the test means to break.
 */
const scriptOfSlideSeconds = (slideSeconds: readonly number[]): Script => {
  const disclaimerLine = script.lines.at(-1);
  if (disclaimerLine === undefined) throw new Error('the script has no lines');
  const lines: ScriptLine[] = slideSeconds.map((seconds, index) => ({
    id: `probe-${index}`,
    speaker: index % 2 === 0 ? 'metan' : 'zundamon',
    text: 'あ'.repeat(seconds * codePointsPerSecond),
    expression: 'normal',
    slide: { kind: 'bullets', title: `slide ${index}`, items: [`item ${index}`] },
    seconds,
  }));
  return { ...script, lines: [...lines, disclaimerLine] };
};

describe('explainer script', () => {
  it('validates against its schema, with every line carrying the duration its text earns', () => {
    const parsed = scriptSchema.safeParse({
      title: script.title,
      disclaimer: script.disclaimer,
      lines: script.lines,
    });
    expect(parsed.success).toBe(true);
    for (const line of script.lines) {
      expect(line.seconds).toBe(secondsFor(line.text));
    }
    // Both characters keep their part: Metan opens and the speakers alternate line by line.
    const speakers = script.lines.map((line) => line.speaker);
    expect(
      speakers.every((speaker, index) => speaker === (index % 2 === 0 ? 'metan' : 'zundamon')),
    ).toBe(true);
  });

  it('stays inside the content budget TASK-170 sets', () => {
    expect(scriptIssues(script)).toEqual([]);
    expect(stats.characters).toBe(1066);
    expect(stats.characters).toBeGreaterThanOrEqual(scriptBudget.minCharacters);
    expect(stats.characters).toBeLessThanOrEqual(scriptBudget.maxCharacters);
    expect(stats.dialogueSeconds).toBe(219);
    // The bound is on the whole timeline: the dialogue plus the held tail is what renders.
    expect(stats.totalSeconds).toBe(222);
    expect(stats.totalSeconds).toBeGreaterThanOrEqual(scriptBudget.minTotalSeconds);
    expect(stats.totalSeconds).toBeLessThanOrEqual(scriptBudget.maxTotalSeconds);
    expect(stats.lineCount).toBe(19);
    expect(stats.lineCount).toBeGreaterThanOrEqual(scriptBudget.minLines);
    expect(stats.lineCount).toBeLessThanOrEqual(scriptBudget.maxLines);
    expect(stats.slideCount).toBe(10);
    expect(totalSeconds).toBe(222);
    expect(totalSeconds).toBe(stats.totalSeconds);
  });

  it('bounds the whole timeline, not only the dialogue', () => {
    // Twelve bullet slides of 23–24 s plus the script's own 13 s disclaimer line: 1481 characters,
    // 13 lines, a cue every 16–24 s, and the total lands exactly on the window's edge.
    const inside = scriptOfSlideSeconds([24, 24, 24, 24, 24, 24, 24, 24, 23, 23, 23, 23]);
    expect(scriptSchema.safeParse(inside).success).toBe(true);
    expect(scriptStats(inside).dialogueSeconds).toBe(297);
    expect(scriptStats(inside).totalSeconds).toBe(300);
    expect(scriptIssues(inside)).toEqual([]);

    // One second past the window, while the dialogue is still inside the old 180–300 s reading: the
    // tail is what overflows, so a dialogue-only bound let this render 9030 frames.
    const overLong = scriptOfSlideSeconds([24, 24, 24, 24, 24, 24, 24, 24, 24, 23, 23, 23]);
    expect(scriptSchema.safeParse(overLong).success).toBe(true);
    expect(scriptStats(overLong).dialogueSeconds).toBe(298);
    expect(scriptStats(overLong).totalSeconds).toBe(301);
    expect(scriptIssues(overLong)).toEqual([
      '301 s in total (298 s of dialogue plus the 3 s tail) is outside 180-300',
    ]);
    expect(() => assertScript(overLong)).toThrow(/301 s in total .* is outside 180-300/);
  });

  it('puts a cue on screen for 15 to 25 seconds, the disclaimer slide held for the tail', () => {
    expect(slideSpans.map((span) => span.onScreenSeconds)).toEqual([
      22, 24, 24, 22, 22, 24, 20, 24, 24, 16,
    ]);
    for (const span of slideSpans) {
      expect(span.onScreenSeconds).toBeGreaterThanOrEqual(scriptBudget.minSlideSeconds);
      expect(span.onScreenSeconds).toBeLessThanOrEqual(scriptBudget.maxSlideSeconds);
    }
    const last = slideSpans.at(-1);
    expect(last?.cue.kind).toBe('disclaimer');
    expect(disclaimerTailSeconds).toBe(3);
    expect(last?.onScreenSeconds).toBe((last?.dialogueSeconds ?? 0) + disclaimerTailSeconds);
    expect(script.disclaimer).toContain('教育目的');
    expect(script.disclaimer).toContain('投資助言ではありません');
  });

  it('counts code points at five per second and rejects a line that does not', () => {
    expect(codePointLength('ずんだもん')).toBe(5);
    expect(codePointLength('あ、い。')).toBe(4);
    expect(estimateSeconds('あいうえ')).toBe(1);
    expect(estimateSeconds('あいうえお')).toBe(1);
    expect(estimateSeconds('あいうえおか')).toBe(2);
    expect(estimateSeconds('')).toBe(0);

    const base = {
      id: 'probe-1',
      speaker: 'zundamon' as const,
      text: 'あいうえおか',
      expression: 'normal' as const,
      slide: { kind: 'title' as const, text: 'probe' },
    };
    expect(scriptLineSchema.safeParse({ ...base, seconds: 2 }).success).toBe(true);
    // The schema does not trust the number: a line that under- or over-states its text is rejected.
    expect(() => scriptLineSchema.parse({ ...base, seconds: 3 })).toThrow(/is 2 s, not 3 s/);
  });

  it('groups consecutive lines into slides and starts each one at its first line', () => {
    const groups = groupSlides(script.lines);
    expect(groups).toHaveLength(10);
    expect(groups[0]?.cue.kind).toBe('title');
    expect(groups.map((group) => group.cue.kind)).toEqual([
      'title',
      'bullets',
      'bullets',
      'chart',
      'bullets',
      'bullets',
      'bullets',
      'bullets',
      'bullets',
      'disclaimer',
    ]);
    // No two slides share a cue: the picture changes exactly when the cue does.
    const keys = groups.map((group) => cueKey(group.cue));
    expect(new Set(keys).size).toBe(keys.length);

    const starts = slideStartSeconds(groups);
    expect(starts).toEqual([0, 22, 46, 70, 92, 114, 138, 158, 182, 206]);
    expect(slideStartsFromSeries(groups)).toEqual(starts);
    // The same starts read off the line clock: slide i begins at its first line.
    let first = 0;
    const fromLines = groups.map((group) => {
      const at = lineStarts[first] ?? -1;
      first += group.lines.length;
      return at;
    });
    expect(fromLines).toEqual(starts);
    expect(lineStartTimes(script.lines)).toEqual(lineStarts);
  });

  it('overlaps telescope, so the TransitionSeries is exactly the dialogue total', () => {
    const groups = groupSlides(script.lines);
    const scenes = slideSceneSeconds(groups);
    const sceneTotal = scenes.reduce((sum, seconds) => sum + seconds, 0);
    expect(slideOverlapSeconds).toBe(0.4);
    expect(transitionOverlapSeconds(groups.length)).toBe(3.6);
    // Nine adjacent pairs of 0.4 s are declared by the nine non-final scenes...
    expect(sceneTotal).toBeCloseTo(222.6, 10);
    // ...and the last scene declares no outgoing overlap, because there is nothing to cross to.
    expect(scenes.at(-1)).toBe(dialogueSeconds(groups.at(-1)?.lines ?? []));
    // ...so subtracting every overlap lands back on the dialogue, exactly.
    expect(sceneTotal - transitionOverlapSeconds(groups.length)).toBeCloseTo(219, 10);
    expect(seriesSeconds(groups)).toBe(dialogueSeconds(script.lines));
  });

  it('rejects a script that breaks the format or the budget', () => {
    const withDuplicateId = { ...script, lines: [script.lines[0], ...script.lines] };
    expect(scriptSchema.safeParse(withDuplicateId).success).toBe(false);

    const withoutDisclaimer = { ...script, lines: script.lines.slice(0, -1) };
    expect(scriptSchema.safeParse(withoutDisclaimer).success).toBe(false);

    const conflictingDisclaimer = { ...script, disclaimer: 'また別の文言です。' };
    expect(scriptSchema.safeParse(conflictingDisclaimer).success).toBe(false);

    // The budget is not the schema's: a short script that still ends on the disclaimer parses, and
    // `scriptIssues` says why it is not usable.
    const truncated = {
      ...script,
      lines: [...script.lines.slice(0, 4), ...script.lines.slice(-1)],
    };
    expect(scriptSchema.safeParse(truncated).success).toBe(true);
    expect(scriptIssues(truncated)).not.toEqual([]);
    expect(scriptIssues(truncated).join('; ')).toContain('lines');
  });
});
