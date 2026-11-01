import { defineConfig } from 'oxlint';

// Dependency boundaries (docs/CONTEXT-MAP.md): Three.js only in the three context, Node.js only in render and cli.
// Composed per directory in `overrides` below, because `no-restricted-imports` replaces the whole option list.
const THREE_RESTRICTION = {
  paths: [{ name: 'three', message: 'Three.js is used only in src/three (the /three subpath).' }],
  patterns: [
    {
      group: ['three/*', '@react-three/*'],
      message: 'Three.js is used only in src/three (the /three subpath).',
    },
  ],
};
const NODE_RESTRICTION = {
  paths: [],
  patterns: [
    {
      group: ['node:*'],
      message:
        'Node.js APIs are used only in src/render and src/cli; the rest runs in the browser.',
    },
  ],
};
// An example is a consumer of the published package, not part of it: it reaches the framework only
// through `@kimuson/motion-kit`, never a relative path into `src/`, and it runs in the browser.
const EXAMPLE_SRC_PATTERN = {
  group: ['**/src/**'],
  message:
    'Examples import the published package (@kimuson/motion-kit), never a relative path into src/.',
};
const EXAMPLE_NODE_PATTERN = {
  group: ['node:*'],
  message: 'Examples run in the browser; Node.js is allowed only in fetch-assets.ts and tests.',
};
const EXAMPLE_RESTRICTION = {
  paths: [],
  patterns: [EXAMPLE_SRC_PATTERN, EXAMPLE_NODE_PATTERN],
};
// `fetch-assets.ts` is a Node.js process that is still an example: it may use Node.js, but it does
// not reach into `src/` either (docs/design-doc/20261025-reference-examples.md carves out Node.js
// only, not the source boundary).
const EXAMPLE_NODE_RESTRICTION = {
  paths: [],
  patterns: [EXAMPLE_SRC_PATTERN],
};
const CORE_RESTRICTION = {
  paths: [],
  patterns: [
    {
      group: [
        '**/render/**',
        '**/cli/**',
        '**/agent/**',
        '**/motion/**',
        '**/three/**',
        '**/presets/**',
        '**/theme/**',
        'motion-kit/render',
        'motion-kit/cli',
        'motion-kit/agent',
        'motion-kit/motion',
        'motion-kit/three',
        'motion-kit/presets',
        'motion-kit/theme',
        '@kimuson/motion-kit/render',
        '@kimuson/motion-kit/cli',
        '@kimuson/motion-kit/agent',
        '@kimuson/motion-kit/motion',
        '@kimuson/motion-kit/three',
        '@kimuson/motion-kit/presets',
        '@kimuson/motion-kit/theme',
        'vite',
        'vite/*',
        'playwright',
        'playwright/*',
        '@playwright/*',
      ],
      message:
        'Browser core depends only on core, shared utilities, React and Zod; host and integration contexts stay outside its graph.',
    },
  ],
};
// The preview host is a browser page: core and shared utilities, React and Zod, nothing Node-side.
const PREVIEW_RESTRICTION = {
  paths: [],
  patterns: [
    {
      group: [
        '**/render/**',
        '**/cli/**',
        '**/agent/**',
        '**/three/**',
        '**/motion/**',
        '**/theme/**',
        '**/presets/**',
        'vite',
        'vite/*',
        'playwright',
        'playwright/*',
        '@playwright/*',
      ],
      message:
        'The preview host runs in the browser and talks to the realm over the preview protocol only.',
    },
  ],
};
const mergeRestrictions = (...restrictions: (typeof THREE_RESTRICTION)[]) => ({
  paths: restrictions.flatMap((r) => r.paths),
  patterns: restrictions.flatMap((r) => r.patterns),
});

export default defineConfig({
  plugins: ['unicorn', 'typescript', 'oxc', 'import', 'jsdoc', 'promise', 'node', 'jest'],
  categories: {},
  rules: {
    /* Correctness (違反するとそのままランタイムエラーになるような無条件適用しやすいルール群) */
    'constructor-super': 'error',
    'for-direction': 'error',
    'no-async-promise-executor': 'error',
    'no-caller': 'error',
    'no-class-assign': 'error',
    'no-compare-neg-zero': 'error',
    'no-cond-assign': 'error',
    'no-const-assign': 'error',
    'no-constant-binary-expression': 'error',
    'no-constant-condition': 'error',
    'no-control-regex': 'error',
    'no-debugger': 'error',
    'no-delete-var': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-else-if': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty-character-class': 'error',
    'no-empty-pattern': 'error',
    'no-empty-static-block': 'error',
    'no-eval': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-func-assign': 'error',
    'no-global-assign': 'error',
    'no-import-assign': 'error',
    'no-invalid-regexp': 'error',
    'no-irregular-whitespace': 'error',
    'no-loss-of-precision': 'error',
    'no-new-native-nonconstructor': 'error',
    'no-nonoctal-decimal-escape': 'error',
    'no-obj-calls': 'error',
    'no-self-assign': 'error',
    'no-setter-return': 'error',
    'no-shadow-restricted-names': 'error',
    'no-sparse-arrays': 'error',
    'no-this-before-super': 'error',
    'no-unassigned-vars': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'no-unused-expressions': 'error',
    'no-unused-labels': 'error',
    'no-unused-private-class-members': 'error',
    'no-unused-vars': 'error',
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-useless-escape': 'error',
    'no-useless-rename': 'error',
    'no-with': 'error',
    'require-yield': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',

    'oxc/bad-array-method-on-arguments': 'error',
    'oxc/bad-char-at-comparison': 'error',
    'oxc/bad-comparison-sequence': 'error',
    'oxc/bad-min-max-func': 'error',
    'oxc/bad-object-literal-comparison': 'error',
    'oxc/bad-replace-all-arg': 'error',
    'oxc/const-comparisons': 'error',
    'oxc/double-comparisons': 'error',
    'oxc/erasing-op': 'error',
    'oxc/missing-throw': 'error',
    'oxc/number-arg-out-of-range': 'error',
    'oxc/only-used-in-recursion': 'error',
    'oxc/uninvoked-array-callback': 'error',

    'typescript/await-thenable': 'error',
    'typescript/no-array-delete': 'error',
    'typescript/no-base-to-string': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-duplicate-type-constituents': 'error',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-for-in-array': 'error',
    'typescript/no-implied-eval': 'error',
    'typescript/no-meaningless-void-operator': 'error',
    'typescript/no-misused-new': 'error',
    'typescript/no-misused-spread': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/no-redundant-type-constituents': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-parameter-property-assignment': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-unary-minus': 'error',
    'typescript/no-useless-empty-export': 'error',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/require-array-sort-compare': 'error',
    'typescript/restrict-template-expressions': 'error',
    'typescript/triple-slash-reference': 'error',
    'typescript/unbound-method': 'error',

    'unicorn/no-await-in-promise-methods': 'error',
    'unicorn/no-empty-file': 'error',
    'unicorn/no-invalid-fetch-options': 'error',
    'unicorn/no-invalid-remove-event-listener': 'error',
    'unicorn/no-new-array': 'error',
    'unicorn/no-single-promise-in-promise-methods': 'error',
    'unicorn/no-thenable': 'error',
    'unicorn/no-unnecessary-await': 'error',
    'unicorn/no-useless-fallback-in-spread': 'error',
    'unicorn/no-useless-length-check': 'error',
    'unicorn/no-useless-spread': 'error',
    'unicorn/prefer-set-size': 'error',
    'unicorn/prefer-string-starts-ends-with': 'error',

    // customized rules
    'import/default': 'off', // 存在しない default import の検出は型チェックに委譲
    'import/namespace': 'off', // 存在しない named import の検出は型チェックに委譲

    'jsdoc/check-property-names': 'error', // JSDoc の property 名重複を検出
    'jsdoc/check-tag-names': 'error', // 不正な JSDoc タグ名を検出
    'jsdoc/implements-on-classes': 'off', // @implements の使用制約はプロジェクト依存
    'jsdoc/no-defaults': 'error', // @default とデフォルト引数の重複を防止
    // JSDoc での型付けはしないので
    'jsdoc/require-property': 'off', // property 強制
    'jsdoc/require-property-description': 'off', // property description 強制
    'jsdoc/require-property-name': 'off', // property name 強制
    'jsdoc/require-property-type': 'off', // property type 強制
    'jsdoc/require-yields': 'off', // yield 強制

    'promise/no-callback-in-promise': 'error', // Promise 内コールバックスタイをを直接書く
    'promise/no-new-statics': 'off', // new Promise.resolve の検出は型チェックに委譲
    'promise/valid-params': 'off', // Promise 引数の検証は型チェックに委譲

    /* Perf */
    'unicorn/prefer-array-find': 'error', // 単一要素の検索には find を使用

    /* Restriction */
    'default-case': 'error', // switch 文に default case を強制
    'no-var': 'error', // var の使用を禁止
    'no-restricted-globals': [
      'error',
      {
        name: 'Date',
        message:
          '現在時刻は src/lib/clock.ts の currentDate/currentTimestamp を使用してください。固定日時の生成も dateFromIsoString を使用してください。',
      },
      // Determinism: every frame is a pure function of time. Rendering drives time explicitly (design.md §4).
      {
        name: 'requestAnimationFrame',
        message:
          'Do not drive time from the browser; read time from useTime/useFrame or take it as an argument.',
      },
      {
        name: 'cancelAnimationFrame',
        message:
          'Do not drive time from the browser; read time from useTime/useFrame or take it as an argument.',
      },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message:
          'Randomness breaks seekability; take a seed as an input and use a seeded generator.',
      },
      {
        object: 'performance',
        property: 'now',
        message:
          'Wall-clock time breaks seekability; read time from useTime/useFrame or take it as an argument.',
      },
    ],
    'no-restricted-imports': ['error', mergeRestrictions(THREE_RESTRICTION, NODE_RESTRICTION)],
    'import/no-nodejs-modules': 'error', // Node.js built-ins only where no-restricted-imports allows them (overrides below)
    'import/no-cycle': 'error', // Contexts depend in one direction (docs/CONTEXT-MAP.md); cycles hide ordering bugs

    'typescript/no-explicit-any': 'error', // any 型の使用を禁止
    'typescript/no-non-null-assertion': 'error', // non-null assertion operator の使用を禁止
    'typescript/use-unknown-in-catch-callback-variable': 'error', // catch 節では unknown 型を使用
    'typescript/no-empty-object-type': 'error', // 空オブジェクト型 {} の使用を禁止
    'typescript/no-import-type-side-effects': 'off', // 副作用を持つ type import を防止, typescript/consistent-type-imports に寄せる

    'unicorn/prefer-node-protocol': 'error', // Node.js 組み込みモジュールは node: プロトコルで import

    /* Suspicious */
    'import/no-empty-named-blocks': 'error', // 空の named import ブロックを検出

    'promise/no-multiple-resolved': 'error', // Promise の複数回 resolve/reject を検出

    'typescript/no-unnecessary-template-expression': 'error', // 不要なテンプレートリテラルを検出
    'typescript/no-unnecessary-type-assertion': 'error', // 不要な型アサーションを検出
    'typescript/no-unsafe-type-assertion': 'error', // 安全でない型アサーションを禁止

    /* Pedantic */
    eqeqeq: 'error', // 厳格等価演算子 === の使用を強制

    'typescript/ban-ts-comment': [
      'error',
      {
        'ts-ignore': true,
        'ts-expect-error': 'allow-with-description',
        'ts-nocheck': 'allow-with-description',
        'ts-check': false,
        minimumDescriptionLength: 2,
      },
    ], // TypeScript コメントディレクティブに理由の記述を強制
    'typescript/prefer-ts-expect-error': 'error', // ts-ignore より ts-expect-error を優先（不要になった際の検出のため）
    'typescript/no-deprecated': 'error', // 非推奨 API の使用を検出
    'typescript/no-misused-promises': 'error', // Promise の誤用を検出
    'typescript/prefer-nullish-coalescing': 'error', // null/undefined チェックには nullish coalescing を使用
    'typescript/require-await': 'error', // async 関数には await を含めることを強制
    'typescript/switch-exhaustiveness-check': 'error', // switch 文の網羅性をチェック
    'typescript/strict-boolean-expressions': 'error', // 条件式での truthy/falsy の暗黙的変換を禁止
    'typescript/restrict-plus-operands': 'error', // + 演算子のオペランド型を制限
    'typescript/no-unsafe-assignment': 'error', // any 型からの代入を検出
    'typescript/no-unsafe-member-access': 'error', // any 型のメンバーアクセスを検出
    'typescript/no-unsafe-call': 'error', // any 型の関数呼び出しを検出
    'typescript/no-unsafe-return': 'error', // any 型の return を検出
    'typescript/no-unsafe-argument': 'error', // any 型の引数渡しを検出

    /* Style */
    'func-style': ['error', 'expression'], // 関数宣言よりアロー関数式を優先
    'no-duplicate-imports': 'error', // 同一モジュールからの import を統合
    'sort-imports': 'off', // 自動修正対応してない・不安定・oxcfmt の experimentalSortImports でソートできるため無効

    'import/consistent-type-specifier-style': 'off', // type import は inline スタイルを使用, typescript/consistent-type-imports に寄せる

    'typescript/prefer-for-of': 'error', // インデックスアクセス不要な場合は for-of を使用
    'typescript/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ], // 型 import は type キーワードを使用
    'typescript/consistent-type-definitions': ['error', 'type'], // 型定義は type を使用（interface より優先）

    /* Custom Restrictions */
    // "node/no-process-env": "error", // process.env への直接アクセスを禁止 (腐敗防止層を用意する場合)
  },
  overrides: [
    {
      files: ['src/core/**', 'src/lib/**', 'src/index.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          mergeRestrictions(THREE_RESTRICTION, NODE_RESTRICTION, CORE_RESTRICTION),
        ],
      },
    },
    {
      // The preview host page runs in the user's browser next to the realm it drives; it reaches the
      // realm only over the preview protocol, never through the Node-side render or CLI graph.
      files: ['src/preview/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          mergeRestrictions(THREE_RESTRICTION, NODE_RESTRICTION, PREVIEW_RESTRICTION),
        ],
      },
    },
    {
      files: ['**/*.{test,spec}.?([mc])[jt]s?(x)'],
      rules: {
        'jest/expect-expect': 'error', // テスト関数に expect の呼び出しを強制
        'jest/no-conditional-expect': 'error', // 条件分岐内での expect を禁止
        'jest/no-disabled-tests': 'off', // test.skip の使用はプロジェクト運用に依存
        'jest/no-export': 'error', // テストファイルからの export を禁止
        'jest/no-focused-tests': 'error', // test.only の使用を禁止（コミット防止）
        'jest/no-standalone-expect': 'error', // test/it ブロック外での expect を禁止
        'jest/require-to-throw-message': 'off', // エラーメッセージの検証強制はプロジェクト依存
        'jest/valid-describe-callback': 'error', // describe コールバックの制約（非同期禁止等）を検証
        'jest/valid-expect': 'error', // expect 後のアサーションメソッド呼び出しを強制
        'jest/valid-title': 'error', // test/describe のタイトルが空文字でないことを検証
      },
    },
    {
      files: ['src/lib/clock.ts'],
      rules: {
        'no-restricted-globals': 'off', // clock 境界だけ Date 直接利用を許可
      },
    },
    {
      // The three context and its non-shipped experiment own the Three.js / R3F integration.
      files: ['src/three/**', 'spikes/b-r3f/fixture.tsx', 'spikes/d-assets/fixture.tsx'],
      rules: {
        'no-restricted-imports': ['error', NODE_RESTRICTION],
      },
    },
    {
      // Node-only contexts (render pipeline and CLI) and repository tooling.
      files: [
        'src/render/**',
        'src/cli/**',
        'scripts/**',
        'spec/**',
        'configs/**',
        'spikes/b-r3f/run-flags.ts',
        'spikes/d-assets/vitest.config.ts',
        '.agents/**/scripts/**',
        // Separate Node processes; the test-file override glob does not match `*.test.ts`.
        'src/motion/spring-determinism.test.ts',
      ],
      rules: {
        'no-restricted-imports': ['error', THREE_RESTRICTION],
        'import/no-nodejs-modules': 'off',
      },
    },
    {
      // Reference examples (docs/design-doc/20261025-reference-examples.md, "How examples/ enters
      // the checks"): the default rules plus the consumer boundary above. `mergeRestrictions`, so
      // the Three.js restriction the top-level `rules` apply survives into `examples/**`.
      files: ['examples/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          mergeRestrictions(THREE_RESTRICTION, EXAMPLE_RESTRICTION),
        ],
      },
    },
    {
      // The setup script and an example's tests are Node.js processes, like src/render and src/cli,
      // so they may import `node:*`; they are still examples, so the source boundary holds. The test
      // files are listed here explicitly because the repository-wide test override below matches a
      // glob that does not cover `*.test.ts` (the same gap the `spring-determinism.test.ts` entry
      // above records).
      files: ['examples/*/fetch-assets.ts', 'examples/**/*.test.ts', 'examples/**/*.test.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          mergeRestrictions(THREE_RESTRICTION, EXAMPLE_NODE_RESTRICTION),
        ],
        'import/no-nodejs-modules': 'off',
      },
    },
    {
      // Tests may use Node.js and whatever the module under test uses; they are not shipped.
      files: ['**/*.{test,spec}.?([mc])[jt]s?(x)'],
      rules: {
        'no-restricted-imports': 'off',
        'import/no-nodejs-modules': 'off',
      },
    },
  ],
  settings: {
    jsdoc: {
      ignorePrivate: false,
      ignoreInternal: false,
      ignoreReplacesDocs: true,
      overrideReplacesDocs: true,
      augmentsExtendsReplacesDocs: false,
      implementsReplacesDocs: false,
      exemptDestructuredRootsFromChecks: false,
      tagNamePreference: {},
    },
    vitest: {
      typecheck: false,
    },
  },
  env: {
    builtin: true,
  },
  globals: {},
  ignorePatterns: [
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/.cache/**',
    '**/.vite/**',
    '**/*.generated.*',
    '**/generated/**',
    '**/*.tsbuildinfo',
    'config/**',
    '**/*.gen.ts',
    '**/*.generated.ts',
    'dev/**',
  ],
  options: {
    typeCheck: false,
    typeAware: true,
    reportUnusedDisableDirectives: 'deny',
    maxWarnings: 10,
    denyWarnings: false,
  },
});
