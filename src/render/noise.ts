// The renderer's own processes say a few things on every run that are about the machine rather than
// about the Composition: Chromium's software-WebGL fallback notice and its GL driver messages, the
// development server's handshake and dependency optimizer, React's development hint, and the
// loading child's own Node warnings. They are the first thing a failure report drops (agent ADR:
// CLI stderr), so they are matched in one place, beside the launch options that make them appear.

/** The notices a healthy render emits every time, as the page or the service spells them. */
const knownNoise = [
  // Chromium, whenever a Composition opens a WebGL context without an unsafe SwiftShader opt-in
  // (dev-docs/contexts/agent/knowledge/20261029-swiftshader-warning.md).
  /Automatic fallback to software WebGL has been deprecated/iu,
  // Chromium's driver notices, for example "GPU stall due to ReadPixels" on a software renderer.
  /GL Driver Message \(/iu,
  // The Vite client the loading service injects, and the optimizer it runs on first use.
  /\[vite\] (?:connecting|connected|hot updated|page reload)/iu,
  /new dependencies optimized:/iu,
  /optimized dependencies changed/iu,
  // react-dom's development build.
  /Download the React DevTools for a better development experience/iu,
  // The loading child strips types the way the bin does, and Node says so on every start.
  /\(node:\d+\) ExperimentalWarning: stripTypeScriptTypes/iu,
  /\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)/iu,
];

/**
 * Whether a line is one of those notices. Every pattern matches anywhere in the line, never only at
 * its start: a page console message arrives with its arguments in front of its text
 * (`[]Automatic fallback to software WebGL …`), and the loader prefixes some of its own output.
 */
export const isKnownRendererNoise = (text: string): boolean =>
  knownNoise.some((pattern) => pattern.test(text));
