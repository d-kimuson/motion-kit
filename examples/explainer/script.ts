// The `explainer` example's script: Zundamon (ずんだもん) and Shikoku Metan (四国めたん) introduce index
// investing in nineteen spoken lines, with a slide cue on every line and a held disclaimer at the end.
//
// This file is data. `script.schema.ts` validates it and owns the timing arithmetic; the entry
// (TASK-209) turns the numbers here into a `TransitionSeries` of slides, one subtitle `Sequence` per
// line and one sprite `Sequence` per speaker, and never recomputes a duration of its own.
//
// Content rules the text keeps (design doc, "explainer"; TASK-170): it explains the concept — an
// index, diversification, cost, long-term holding and instalments, and the risks — it recommends no
// fund, no broker and no allocation, and the last line is a disclaimer that says the video is
// educational and not investment advice. Both characters keep their registers: Metan sets each slide
// up in です・ます, Zundamon answers with 「なのだ」, and the two alternate line by line.
import {
  assertScript,
  lineStartTimes,
  scriptSchema,
  scriptStats,
  slidePlan,
  totalSeconds as computeTotalSeconds,
  type Script,
  type ScriptLine,
  type SlideCue,
} from './script.schema.ts';

/** The video's title, and the text of the opening slide. */
const title = 'はじめてのインデックス投資';

/**
 * The final disclaimer, word for word what the `disclaimer` slide shows: the schema refuses a script
 * whose last slide says anything else, so the on-screen text and the data cannot drift apart.
 */
const disclaimer =
  'この動画は教育目的でお伝えするもので、特定の商品の勧誘や投資助言ではありません。実際の判断は、ご自身の責任でお願いします。';

// One cue constant per slide: consecutive lines that carry the same cue are on the same slide
// (`groupSlides`), so sharing the constant is what makes a slide, and two lines of one slide cannot
// drift into two slightly different cues.
const titleSlide: SlideCue = { kind: 'title', text: title };

const indexSlide: SlideCue = {
  kind: 'bullets',
  title: 'インデックスってなに？',
  items: [
    '市場全体の値動きを表す指標',
    '指数に連動するように作られた商品',
    '会社を自分で選ばなくてよい',
  ],
};

const diversificationSlide: SlideCue = {
  kind: 'bullets',
  title: '分散して持つ',
  items: ['ひとつの会社に頼らない', 'たくさんの会社をまとめて持つ', 'ひとつの失敗が全体を壊さない'],
};

// `chartId` names a dataset the `chart` example already commits (`examples/chart/data/`), so this
// slide draws the same SVG component from the same JSON rather than a second copy of the data.
const chartSlide: SlideCue = {
  kind: 'chart',
  chartId: 'index-30y',
  caption: '長い目で見れば右肩上がりでも、途中には深い谷がある',
};

const costSlide: SlideCue = {
  kind: 'bullets',
  title: 'コストも見る',
  items: [
    '信託報酬は持ち続けるあいだかかる',
    '何年も積み重なる',
    '同じ運用ならコストが低いほうが残る',
  ],
};

const instalmentSlide: SlideCue = {
  kind: 'bullets',
  title: '長期・積立・分散',
  items: ['一度に大きく賭けない', '決まった金額を決まったペースで', '積立投資・ドルコスト平均法'],
};

const riskSlide: SlideCue = {
  kind: 'bullets',
  title: 'リスクを知る',
  items: ['元本は保証されない', '価格は大きく下がることがある', '生活費や近い予定のお金は回さない'],
};

const scopeSlide: SlideCue = {
  kind: 'bullets',
  title: '向くお金、向かないお金',
  items: ['数年以内に使うお金は別に置く', 'なくなっても困らないお金で', '下がっても続けられるか'],
};

const summarySlide: SlideCue = {
  kind: 'bullets',
  title: 'まとめ',
  items: ['指数に連動する商品を', '分散して、長い期間、積み立てる', 'コストも確かめる'],
};

const disclaimerSlide: SlideCue = { kind: 'disclaimer', text: disclaimer };

// The nineteen lines. `seconds` is written out rather than computed so a reviewer can see the timing
// in the file; the schema rejects any line whose `seconds` is not `ceil(codePoints / 5)`, so the two
// can never disagree. The lines alternate speakers, one slide every two lines, and the last slide is
// the disclaimer, which the entry holds for a further three seconds.
const lines: readonly ScriptLine[] = [
  {
    id: 'title-1',
    speaker: 'metan',
    text: '今日は「インデックス投資」という考え方を、ずんだもんと一緒に紹介しますね。むずかしい言葉はなるべく使わずに、やさしくお話しします。',
    expression: 'normal',
    slide: titleSlide,
    seconds: 13,
  },
  {
    id: 'title-2',
    speaker: 'zundamon',
    text: '投資ってなんだか難しそうなのだ。でも、仕組みがわかれば、きっと身近に感じられるはずなのだ！',
    expression: 'happy',
    slide: titleSlide,
    seconds: 9,
  },
  {
    id: 'index-1',
    speaker: 'metan',
    text: 'まずインデックスというのは、市場全体の値動きをひとつの数字にまとめた指標のことです。日経平均株価も、そのひとつですね。',
    expression: 'normal',
    slide: indexSlide,
    seconds: 12,
  },
  {
    id: 'index-2',
    speaker: 'zundamon',
    text: 'その指数と同じように動くように作られた商品が、インデックスファンドなのだ。どの会社を買うかを自分で選ばなくてよいのだ。',
    expression: 'normal',
    slide: indexSlide,
    seconds: 12,
  },
  {
    id: 'diversification-1',
    speaker: 'metan',
    text: '投資の基本は、ひとつの会社に頼りきらないことです。たくさんの会社をまとめて持てば、ひとつの失敗が全体を壊すことはありません。',
    expression: 'normal',
    slide: diversificationSlide,
    seconds: 13,
  },
  {
    id: 'diversification-2',
    speaker: 'zundamon',
    text: 'お菓子をひとつの箱に全部入れておくと、落としたときに全部なくなっちゃうのだ。小分けにしておくのと同じなのだ！',
    expression: 'happy',
    slide: diversificationSlide,
    seconds: 11,
  },
  {
    id: 'chart-1',
    speaker: 'metan',
    text: 'この線を見てください。長い目で見れば右肩上がりでも、途中には深い谷があります。短い期間の上下だけで判断しないことですね。',
    expression: 'serious',
    slide: chartSlide,
    seconds: 12,
  },
  {
    id: 'chart-2',
    speaker: 'zundamon',
    text: 'でも、値段はずっと上がり続けるわけではないのだ。大きく下がる年もあれば、ゆっくり上がる年もあるのだ。',
    expression: 'surprised',
    slide: chartSlide,
    seconds: 10,
  },
  {
    id: 'cost-1',
    speaker: 'metan',
    text: 'もうひとつ大事なのがコストです。ファンドを持っているあいだ、信託報酬という手数料がかかり続けます。',
    expression: 'normal',
    slide: costSlide,
    seconds: 10,
  },
  {
    id: 'cost-2',
    speaker: 'zundamon',
    text: '手数料って地味だけど、何年も積み重なっていくのだ。同じ運用なら、コストが低いほうが手元に残るお金は多くなるのだ。',
    expression: 'thinking',
    slide: costSlide,
    seconds: 12,
  },
  {
    id: 'instalment-1',
    speaker: 'metan',
    text: 'だから「長期・積立・分散」という合言葉が出てくるんですね。決まった金額を決まったペースで買い続けるのが、積立投資やドルコスト平均法です。',
    expression: 'normal',
    slide: instalmentSlide,
    seconds: 14,
  },
  {
    id: 'instalment-2',
    speaker: 'zundamon',
    text: '一度に大きく賭けるより、毎月コツコツ続けるのが大事なのだ。高い時期も安い時期も買うことになるのだ。',
    expression: 'happy',
    slide: instalmentSlide,
    seconds: 10,
  },
  {
    id: 'risk-1',
    speaker: 'metan',
    text: 'いいことばかりではありません。元本は保証されませんし、価格が大きく下がることもあります。',
    expression: 'serious',
    slide: riskSlide,
    seconds: 9,
  },
  {
    id: 'risk-2',
    speaker: 'zundamon',
    text: '生活費や、近いうちに使うお金を回すのは禁物なのだ。なくなっても困らない、余裕のあるお金でやるのが基本なのだ。',
    expression: 'serious',
    slide: riskSlide,
    seconds: 11,
  },
  {
    id: 'scope-1',
    speaker: 'metan',
    text: '数年以内に使う予定のあるお金は、元本が保証されている手段に置いておきましょう。投資に向くお金と向かないお金を分けて考えるのが基本です。',
    expression: 'normal',
    slide: scopeSlide,
    seconds: 14,
  },
  {
    id: 'scope-2',
    speaker: 'zundamon',
    text: 'それから、値段が下がったときに慌てて売ってしまう人は、実はこの方法に向いていないのかもしれないのだ。',
    expression: 'thinking',
    slide: scopeSlide,
    seconds: 10,
  },
  {
    id: 'summary-1',
    speaker: 'metan',
    text: 'まとめると、指数に連動する商品を、分散して、長い期間、積み立てる。コストも確かめる。これがインデックス投資の考え方です。',
    expression: 'normal',
    slide: summarySlide,
    seconds: 12,
  },
  {
    id: 'summary-2',
    speaker: 'zundamon',
    text: '特定の商品や会社をすすめているわけではないのだ。仕組みを知って、自分に合うかどうかを、ゆっくり考えてほしいのだ。',
    expression: 'wink',
    slide: summarySlide,
    seconds: 12,
  },
  {
    id: 'disclaimer-1',
    speaker: 'metan',
    text: disclaimer,
    expression: 'serious',
    slide: disclaimerSlide,
    seconds: 13,
  },
];

/**
 * The script, validated once at module load: the schema enforces `seconds`, unique ids, and that the
 * last slide is the disclaimer; `assertScript` enforces the content budget (900–1500 characters,
 * 180–300 s of dialogue, 10–20 lines, a cue every 15–25 s). A script outside either throws on import
 * rather than rendering a video of the wrong length.
 */
export const script: Script = assertScript(scriptSchema.parse({ title, disclaimer, lines }));

/**
 * The dialogue total plus the 3-second disclaimer tail: 222 s, which is what the Composition's
 * `durationInFrames` comes from (`frameCount(createTimelineTime(totalSeconds), fps)`).
 */
export const totalSeconds: number = computeTotalSeconds(script.lines);

/** Where each line starts, as the `from` of its subtitle and sprite `Sequence`s. */
export const lineStarts: readonly number[] = lineStartTimes(script.lines);

/**
 * One span per slide, with the overlap arithmetic applied: `sceneSeconds` is what each
 * `TransitionScene` declares (its lines plus the outgoing 0.4 s, zero for the last), `startSeconds`
 * is its first line's start, and the series total is exactly `totalSeconds` less the tail.
 */
export const slideSpans = slidePlan(script.lines);

/** The numbers a reviewer checks against the task: 1068 characters, 219 s of dialogue, 19 lines, 10 slides. */
export const stats = scriptStats(script);
