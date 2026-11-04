/**
 * The motion-kit mark and the project's public links, shared by the preview page and its shell.
 * The mark is the one drawn in examples/promo (`Mark` in parts.tsx); `.github/assets/mark.svg` is
 * this same document, kept equal by brand.test.ts.
 */

/** The wordmark's accent: the hyphen in "motion-kit", the end of the mark's gradient. */
export const accentColor = '#2fe3d0';

export const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="motion-kit-mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b6cff"/>
      <stop offset="1" stop-color="${accentColor}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#motion-kit-mark)"/>
  <path d="M24 18 L46 32 L24 46 Z" fill="#090b14"/>
  <rect x="14" y="52" width="36" height="4" rx="2" fill="#090b14" opacity="0.55"/>
</svg>
`;

/** The mark as a `data:` URL, for an `<img>` or a favicon. */
export const markDataUrl = `data:image/svg+xml,${encodeURIComponent(markSvg)}`;

export const repositoryUrl = 'https://github.com/d-kimuson/motion-kit';
export const npmUrl = 'https://www.npmjs.com/package/@kimuson/motion-kit';
